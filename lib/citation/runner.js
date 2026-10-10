/* =====================================================================
   lib/citation/runner.js: citation tracking, background job. The CLI is
   scripts/citation-check.js, a thin entry that calls main() here; the same
   functions serve any future worker.

   Asks Gemini a vertical's buying-intent prompts N times each and records
   whether a brand is named, whether its domain is cited, which competitors
   appear (in order) and which source domains the answer draws on.

   This measures what ONE model said on ONE date. It is not "AI
   visibility". Every output file carries the model, the date and the mode.

   Usage:
     node scripts/citation-check.js --brand "Pipedrive" --domain pipedrive.com --vertical crm
     node scripts/citation-check.js ... --runs 5 --grounded
     node scripts/citation-check.js --from-raw data/citations/<file>.raw.jsonl

   Flags:
     --brand       brand name as a person would write it        (required)
     --domain      the brand's own domain                       (required)
     --vertical    file in content/prompts/<vertical>.json      (required)
     --alias       extra name to match; repeatable
     --ambiguous   brand name is a common word: strict matching
     --runs N      runs per prompt, default 5 (3 is the minimum for a finding)
     --model ID    default gemini-3.8-flash
     --grounded    NOT PERMITTED by Google's terms (grounded results may not be
                   analysed) and refused unless GOOGLE_GROUNDED_ANALYSIS_PERMISSION=
                   confirmed is set as well, which is only for an owner who holds
                   Google's written permission. Also billed per search query
                   beyond the monthly free allowance.
     --date D      YYYY-MM-DD, default today; re-run with the same date to resume
     --prompts a,b only these prompt ids (smoke tests; output is marked partial)
     --delay MS    starting delay between calls, default 6000
     --min-delay   fastest the pacer may go, default 2500
     --max-queries cap on search queries for this run, default 300
     --fresh       discard an existing raw file for this brand/date/mode
     --from-raw F  rebuild the output from a raw file, no API calls

   Key: GEMINI_API_KEY in the environment or in .env.local (gitignored).

   Output (data/citations/):
     <brand>-<date>-<model>-<mode>.json       parsed results and summary
     <brand>-<date>-<model>-<mode>.raw.jsonl  every raw response, one per line; the
                                      parsed file is rebuilt from it, and
                                      each parsed run points at its line.
   The model and mode are in the file name because runs that differ in
   either, on the same day, must never share a file.
   ===================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'data', 'citations');
const STATE_DIR = path.join(OUT_DIR, '_state');
const PROMPT_DIR = path.join(ROOT, 'content', 'prompts');

const DEFAULT_MODEL = 'gemini-3.8-flash';
const DEFAULT_RUNS = 5;
const MIN_RUNS = 3;                 // fewer complete sweeps is never a finding
const WIDE_SPREAD = 0.15;           // a range this wide is flagged, not averaged away
const FREE_SEARCH_QUERIES_PER_MONTH = 5000; // shared across Gemini 3.x (pricing page, 2 Oct 2026)
const PARSER_VERSION = 1;

const START_DELAY_MS = 6000;        // conservative: 10 calls a minute
const MIN_DELAY_MS = 2500;
const MAX_DELAY_MS = 60000;
const SPEEDUP_AFTER = 6;            // consecutive successes before easing the delay

const { sleep, log, Stop, parseRetryDelay } = require('./common');
const gemini = require('./providers/gemini');
const { extractBrands } = require('./brands');
const { answerText } = gemini;

/* ---------------------------------------------------------------------
   Parsing — pure functions, no network. Exported for tests.
   --------------------------------------------------------------------- */

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// "Zoho CRM" also matches "Zoho-CRM" and "Zoho  CRM".
function termPattern(term) {
  return term.trim().split(/\s+/).map(escapeRe).join('[\\s-]+');
}

const B = '(?<![A-Za-z0-9])';
const E = '(?![A-Za-z0-9])';

// Returns a function text -> index of first match, or -1.
function makeMatcher(brand) {
  const terms = [brand.name].concat(brand.aliases || []);
  const regexes = [];
  if (!brand.ambiguous) {
    for (const t of terms) regexes.push(new RegExp(B + termPattern(t) + E, 'i'));
  } else {
    // Common-word names (Close, Copper, Streak...) only count in a name-like
    // position, and case-sensitively.
    for (const t of terms) {
      const p = termPattern(t);
      regexes.push(new RegExp(B + p + '[\\s-]+CRM' + E));
      regexes.push(new RegExp('\\*\\*\\s*(?:\\d+\\.\\s*)?' + p + E));
      regexes.push(new RegExp('^#{1,6}\\s*(?:\\d+\\.\\s*)?' + p + E, 'm'));
      regexes.push(new RegExp('^\\s*(?:\\d+\\.|[-*\\u2022])\\s+' + p + '(?:\\s*[:\\u2013\\u2014(-])', 'm'));
      regexes.push(new RegExp('\\[' + p + E));
    }
  }
  const match = (text) => {
    let best = -1;
    for (const re of regexes) {
      const m = re.exec(text);
      if (m && (best === -1 || m.index < best)) best = m.index;
    }
    return best;
  };

  // "Featured": named in a heading, list label, table cell or bold text,
  // rather than only in running prose. A proxy for being offered as an
  // answer, since a name in an aside ("lighter tools like X") still counts
  // as a mention.
  const flags = brand.ambiguous ? '' : 'i';
  const structural = terms.map((t) => {
    const p = termPattern(t);
    return new RegExp(
      '^#{1,6}[^\\n]*' + B + p + E +
      '|^\\s*(?:\\d+\\.|[-*\\u2022])\\s+\\**\\s*' + B + p + E +
      '|^\\s*\\|[^\\n]*' + B + p + E +
      '|\\*\\*[^*\\n]*' + B + p + E + '[^*\\n]*\\*\\*', flags + 'm');
  });
  match.structural = (text) => structural.some((re) => re.test(text));
  return match;
}

const TLDS = 'com|org|net|io|co|ai|app|dev|edu|gov|us|uk|de|fr|eu|ca|au|nl|se|in|tech|so|ly|me|tv|cloud|software|xyz';
const URL_RE = /https?:\/\/[^\s)\]>"'`<*]+/gi;
const BARE_DOMAIN_RE = new RegExp(
  '(?<![A-Za-z0-9@./-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:' + TLDS + '))(?![A-Za-z0-9-])(?!\\.[a-z]{2,})', 'gi');

function cleanDomain(host) {
  return String(host).toLowerCase().replace(/^www\./, '').replace(/[.,;:]+$/, '');
}

// Domains the model wrote into its answer. Model-stated, never verified.
function domainsInText(text) {
  const found = [];
  const seen = new Set();
  const add = (d) => {
    d = cleanDomain(d);
    if (d && !seen.has(d)) { seen.add(d); found.push(d); }
  };
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text))) {
    try { add(new URL(m[0].replace(/[.,;:]+$/, '')).hostname); } catch (e) { /* skip */ }
  }
  BARE_DOMAIN_RE.lastIndex = 0;
  while ((m = BARE_DOMAIN_RE.exec(text))) add(m[1]);
  return found;
}

function hostMatches(host, domain) {
  host = cleanDomain(host);
  domain = cleanDomain(domain);
  return host === domain || host.endsWith('.' + domain);
}

function looksLikeDomain(s) {
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(String(s || '').trim());
}

// Sources Google reports for a grounded answer. The uri is usually a
// vertexaisearch redirect; the title is normally the site's domain.
function groundingSources(response) {
  const cand = response && response.candidates && response.candidates[0];
  const gm = cand && cand.groundingMetadata;
  const out = { queries: [], sources: [], searched: false };
  if (!gm) return out;
  out.queries = Array.isArray(gm.webSearchQueries) ? gm.webSearchQueries : [];
  out.searched = out.queries.length > 0 || (gm.groundingChunks || []).length > 0;
  for (const chunk of gm.groundingChunks || []) {
    const web = chunk && chunk.web;
    if (!web) continue;
    let domain = null;
    if (looksLikeDomain(web.title)) domain = cleanDomain(web.title);
    else {
      try {
        const host = new URL(web.uri).hostname;
        if (!/vertexaisearch\.cloud\.google\.com$/.test(host)) domain = cleanDomain(host);
      } catch (e) { /* skip */ }
    }
    out.sources.push({ domain, title: web.title || null, uri: web.uri || null });
  }
  return out;
}


const LABEL_STOP = /^(choose|pick|catch|go with|final|quick|tip|best for|ideal for|pros|cons|key features?|why|pricing|price|integrations?|strengths?|weaknesses?|top pick|considerations?|overall|summary|conclusion|note|bottom line|good for|great for|features?|use case|cost|free plan|verdict|recommendation|tip|example|how|what|who|when|where)\b/i;

// Names written like product names that are not in the lexicon. Informational
// only: they never enter share of voice. They show where the lexicon is thin.
function unlistedCandidates(text, knownMatchers, knownNames) {
  const out = new Set();
  const re = /^[ \t]*(?:#{1,6}[ \t]*(?:\d+\.[ \t]*)?|(?:\d+\.|[-*•])[ \t]+)\*{0,2}([A-Z][^*\n:()–—]{1,40}?)\*{0,2}[ \t]*(?:[:(–—]|$|\*\*)/gm;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1].replace(/[*_:]+$/g, '').replace(/^The\s+/, '').trim();
    const words = name.split(/\s+/);
    if (!name || words.length > 3 || LABEL_STOP.test(name)) continue;
    // Product names are Title Case (or carry a digit); labels like
    // "All-in-one feel" and "Best if" are not.
    if (!words.every((w) => /^[A-Z0-9]/.test(w) || /^(of|and|for|&)$/.test(w))) continue;
    if (knownMatchers.some((k) => k(name) !== -1)) continue;
    // Ambiguous names only match in context, so also drop exact lexicon names.
    if (knownNames && knownNames.has(name.toLowerCase())) continue;
    out.add(name);
  }
  return [...out];
}

function parseRun(response, ctx, extracted) {
  const text = answerText(response);
  const target = ctx.targetMatcher(text);
  const mentioned = target !== -1;

  const competitors = [];
  for (const c of ctx.competitors) {
    const pos = c.match(text);
    if (pos !== -1) competitors.push({ name: c.name, pos });
  }
  competitors.sort((a, b) => a.pos - b.pos);
  // A vertical with no lexicon: the brands the model pointed at, each already checked to appear verbatim in the answer.
  if (!ctx.competitors.length && Array.isArray(extracted)) {
    extracted.forEach((name) => { const pos = text.indexOf(name); if (pos !== -1) competitors.push({ name, pos }); });
    competitors.sort((a, b) => a.pos - b.pos);
  }

  const stated = domainsInText(text);
  const g = groundingSources(response);
  const grounded = ctx.grounded;

  return {
    mentioned,
    mentionPos: mentioned ? target : null,
    featured: mentioned && ctx.targetMatcher.structural(text),
    competitors: competitors.map((c) => c.name),
    // Model-stated: whatever the model typed. Unverified in both modes.
    modelStatedDomains: stated,
    domainInText: stated.some((d) => hostMatches(d, ctx.domain)),
    // Verified by Google's grounding metadata. null when grounding was off.
    sourceDomains: grounded ? [...new Set(g.sources.map((s) => s.domain).filter(Boolean))] : null,
    sources: grounded ? g.sources : null,
    domainInSources: grounded ? g.sources.some((s) => s.domain && hostMatches(s.domain, ctx.domain)) : null,
    searched: grounded ? g.searched : null,
    searchQueries: grounded ? g.queries.length : 0,
    unlisted: unlistedCandidates(text, ctx.allMatchers, ctx.knownNames),
    answerChars: text.length,
  };
}

/* ---------------------------------------------------------------------
   Statistics
   --------------------------------------------------------------------- */

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const round = (x, d = 4) => (x === null || x === undefined ? x : Math.round(x * 10 ** d) / 10 ** d);
const rangeOf = (a) => (a.length ? { min: round(Math.min(...a)), max: round(Math.max(...a)) } : null);

// Sample variance of a 0/1 indicator across n runs.
function binaryVariance(k, n) {
  return n > 1 ? (k * (n - k)) / (n * (n - 1)) : null;
}

const REVIEW_SITES = ['g2.com', 'capterra.com', 'trustradius.com', 'softwareadvice.com', 'getapp.com',
  'gartner.com', 'peerspot.com', 'trustpilot.com', 'sourceforge.net', 'crozdesk.com', 'financesonline.com'];
const COMMUNITY_SITES = ['reddit.com', 'quora.com', 'stackoverflow.com', 'stackexchange.com', 'news.ycombinator.com'];

function sourceKind(domain, vendorDomains) {
  if (vendorDomains.some((v) => hostMatches(domain, v))) return 'vendor';
  if (REVIEW_SITES.some((v) => hostMatches(domain, v))) return 'review-site';
  if (COMMUNITY_SITES.some((v) => hostMatches(domain, v))) return 'community';
  return 'other';
}

function buildOutput(meta, raw, promptSet, opts) {
  const ctx = makeContext(meta, promptSet);
  const selected = promptSet.prompts.filter((p) => !meta.promptIds || meta.promptIds.includes(p.id));
  const byPrompt = new Map(selected.map((p) => [p.id, []]));

  const seen = new Set();
  raw.runs.forEach((r) => {
    const key = r.promptId + '#' + r.run;
    if (!byPrompt.has(r.promptId) || seen.has(key)) return;
    seen.add(key);
    byPrompt.get(r.promptId).push({
      run: r.run,
      rawLine: r.line,
      ...parseRun(r.response, ctx, r.extractedBrands),
      model: (r.response && r.response.modelVersion) || null,
    });
  });
  for (const runs of byPrompt.values()) runs.sort((a, b) => a.run - b.run);

  // A sweep is run r across every selected prompt; only complete ones count.
  const maxRun = Math.max(0, ...[...byPrompt.values()].flat().map((r) => r.run));
  const sweeps = [];
  for (let r = 1; r <= maxRun; r++) {
    const rows = [];
    for (const runs of byPrompt.values()) {
      const hit = runs.find((x) => x.run === r);
      if (!hit) break;
      rows.push(hit);
    }
    if (rows.length === selected.length) sweeps.push({ run: r, rows });
  }
  const reportable = sweeps.length >= MIN_RUNS && !meta.promptIds;

  const prompts = selected.map((p) => {
    const runs = byPrompt.get(p.id);
    const n = runs.length;
    const k = runs.filter((x) => x.mentioned).length;
    const cited = runs.filter((x) => (ctx.grounded ? x.domainInSources : x.domainInText)).length;
    const enough = n >= MIN_RUNS;
    const comp = {};
    runs.forEach((x) => x.competitors.forEach((name, i) => {
      const c = comp[name] || (comp[name] = { name, runs: 0, positions: [] });
      c.runs++;
      c.positions.push(i + 1);
    }));
    return {
      id: p.id,
      text: p.text,
      runs: n,
      mentioned: k,
      mentionRate: enough ? round(k / n) : null,
      featured: runs.filter((x) => x.featured).length,
      featuredRate: enough ? round(runs.filter((x) => x.featured).length / n) : null,
      variance: enough ? round(binaryVariance(k, n)) : null,
      stable: enough ? k === 0 || k === n : null,
      domainCited: cited,
      domainCitedRate: enough ? round(cited / n) : null,
      competitors: Object.values(comp)
        .map((c) => ({ name: c.name, runs: c.runs, rate: enough ? round(c.runs / n) : null, avgPosition: round(mean(c.positions), 2) }))
        .sort((a, b) => b.runs - a.runs),
      perRun: runs,
    };
  });

  const out = {
    schema: 1,
    label: `Produced by ${meta.model} on ${meta.date}, ${meta.mode} mode. One model on one date is not "AI visibility"; it is what this model said in these runs.`,
    brand: meta.brand,
    domain: meta.domain,
    aliases: meta.aliases,
    vertical: meta.vertical,
    promptSetVersion: promptSet.version,
    parserVersion: PARSER_VERSION,
    mode: meta.mode,
    model: meta.model,
    modelVersions: [...new Set(prompts.flatMap((p) => p.perRun.map((r) => r.model)).filter(Boolean))],
    date: meta.date,
    startedAt: meta.startedAt,
    runsPerPrompt: meta.runs,
    partial: !!meta.promptIds,
    reportable,
    completeSweeps: sweeps.length,
    rawFile: opts.rawFile,
    sourceDataNote: ctx.grounded
      ? 'Source domains come from Google grounding metadata. modelStatedDomains in each run is prose the model typed; it is unverified and is not aggregated.'
      : 'Grounding was off. Domains in modelStatedDomains are prose the model typed; they are unverified and are not aggregated or ranked anywhere in this file.',
    searchQueries: {
      thisFile: prompts.reduce((s, p) => s + p.perRun.reduce((t, r) => t + r.searchQueries, 0), 0),
      callsWithSearch: ctx.grounded ? prompts.reduce((s, p) => s + p.perRun.filter((r) => r.searched).length, 0) : 0,
      calls: prompts.reduce((s, p) => s + p.runs, 0),
    },
    rateLimit: raw.rate || null,
    warnings: [],
    prompts,
    summary: null,
  };

  if (!reportable) {
    out.warnings.push(meta.promptIds
      ? 'Partial run (--prompts): per-run data only. Not a finding.'
      : `Only ${sweeps.length} complete sweep(s); ${MIN_RUNS} are needed. Per-run data only. Not a finding.`);
    return out;
  }

  // Overall mention rate, with its range across sweeps.
  const nPrompts = selected.length;
  const sweepRates = sweeps.map((s) => s.rows.filter((x) => x.mentioned).length / nPrompts);
  const pooledMentions = sweeps.reduce((s, sw) => s + sw.rows.filter((x) => x.mentioned).length, 0);
  const overall = {
    mentionRate: round(pooledMentions / (nPrompts * sweeps.length)),
    range: rangeOf(sweepRates),
    bySweep: sweepRates.map((x) => round(x)),
    sweeps: sweeps.length,
    promptsPerSweep: nPrompts,
  };
  const featRates = sweeps.map((s) => s.rows.filter((x) => x.featured).length / nPrompts);
  overall.featuredRate = round(mean(featRates));
  overall.featuredRange = rangeOf(featRates);
  overall.spread = round(overall.range.max - overall.range.min);
  overall.wide = overall.spread >= WIDE_SPREAD;
  if (overall.wide) {
    out.warnings.push(`Overall mention rate is unstable: ${pct(overall.range.min)} to ${pct(overall.range.max)} across sweeps. The mean (${pct(overall.mentionRate)}) hides this.`);
  }

  // Competitor appearance and share of voice, each with a range across sweeps.
  const names = new Set([meta.brand]);
  sweeps.forEach((s) => s.rows.forEach((x) => x.competitors.forEach((c) => names.add(c))));
  const pos = {};
  const compStats = [...names].map((name) => {
    const isTarget = name === meta.brand;
    const appear = [];
    const share = [];
    let total = 0, totalAll = 0;
    sweeps.forEach((s) => {
      let hit = 0, all = 0;
      s.rows.forEach((x) => {
        const list = (x.mentioned ? [meta.brand] : []).concat(x.competitors);
        all += list.length;
        list.forEach((c, i) => {
          if (c === name) {
            hit++;
            (pos[name] = pos[name] || []).push(i + 1);
          }
        });
      });
      appear.push(hit / nPrompts);
      share.push(all ? hit / all : 0);
      total += hit;
      totalAll += all;
    });
    const appearanceRange = rangeOf(appear);
    const shareRange = rangeOf(share);
    return {
      name,
      isTarget,
      appearanceRate: round(total / (nPrompts * sweeps.length)),
      appearanceRange,
      shareOfVoice: round(totalAll ? total / totalAll : 0),
      shareRange,
      wide: shareRange.max - shareRange.min >= WIDE_SPREAD,
      avgPosition: round(mean(pos[name] || []), 2),
    };
  }).sort((a, b) => b.shareOfVoice - a.shareOfVoice);

  // Source domains: grounded runs only.
  let sourceDomains = null;
  let sourceMix = null;
  if (ctx.grounded) {
    const vendorDomains = ctx.vendorDomains;
    const runsInScope = sweeps.flatMap((s) => s.rows);
    const tally = {};
    runsInScope.forEach((x, idx) => {
      const uniq = new Set();
      (x.sources || []).forEach((src) => {
        if (!src.domain) return;
        const t = tally[src.domain] || (tally[src.domain] = { domain: src.domain, runs: 0, citations: 0, prompts: new Set() });
        t.citations++;
        uniq.add(src.domain);
      });
      uniq.forEach((d) => { tally[d].runs++; });
    });
    sweeps.forEach((s) => s.rows.forEach((x, i) => {
      new Set((x.sources || []).map((src) => src.domain).filter(Boolean)).forEach((d) => tally[d].prompts.add(selected[i].id));
    }));
    const totalRuns = runsInScope.length;
    sourceDomains = Object.values(tally)
      .map((t) => ({
        domain: t.domain,
        runs: t.runs,
        runShare: round(t.runs / totalRuns),
        citations: t.citations,
        prompts: t.prompts.size,
        kind: sourceKind(t.domain, vendorDomains),
        ownDomain: hostMatches(t.domain, meta.domain),
      }))
      .sort((a, b) => b.runs - a.runs || b.citations - a.citations || a.domain.localeCompare(b.domain));
    const totalCites = sourceDomains.reduce((s, d) => s + d.citations, 0);
    sourceMix = {};
    sourceDomains.forEach((d) => { sourceMix[d.kind] = (sourceMix[d.kind] || 0) + d.citations; });
    Object.keys(sourceMix).forEach((k) => { sourceMix[k] = { citations: sourceMix[k], share: round(sourceMix[k] / (totalCites || 1)) }; });
    const noSearch = runsInScope.filter((x) => !x.searched).length;
    if (noSearch) out.warnings.push(`${noSearch} of ${totalRuns} grounded runs did not search; the model answered from training data and contributed no sources.`);
  }

  const unlisted = {};
  sweeps.forEach((s) => s.rows.forEach((x) => x.unlisted.forEach((u) => { unlisted[u] = (unlisted[u] || 0) + 1; })));

  out.summary = {
    overall,
    competitors: compStats,
    sourceDomains,
    sourceMix,
    sourceDomainsNote: ctx.grounded
      ? 'Ranked by number of runs that cited the domain (once per run), from grounding metadata. "kind" is a heuristic from a short built-in list.'
      : 'Not available: grounding was off, and model-stated domains are never ranked.',
    unlistedCandidates: Object.entries(unlisted).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([name, runs]) => ({ name, runs })),
    thresholds: { minRuns: MIN_RUNS, wideSpread: WIDE_SPREAD },
  };
  return out;
}

function pct(x) {
  return (x * 100).toFixed(0) + '%';
}

function makeContext(meta, promptSet) {
  const lexicon = (promptSet.brands || []).filter((b) => {
    const dom = b.domain && meta.domain && hostMatches(b.domain, meta.domain);
    const same = [b.name].concat(b.aliases || []).some((t) => t.toLowerCase() === meta.brand.toLowerCase());
    return !dom && !same;
  });
  const targetBrand = { name: meta.brand, aliases: meta.aliases, ambiguous: meta.ambiguous };
  const targetMatcher = makeMatcher(targetBrand);
  const competitors = lexicon.map((b) => ({ name: b.name, match: makeMatcher(b) }));
  return {
    domain: meta.domain,
    grounded: meta.mode === 'grounded',
    targetMatcher,
    competitors,
    allMatchers: [targetMatcher].concat(competitors.map((c) => c.match)),
    knownNames: new Set((promptSet.brands || []).concat([targetBrand]).flatMap((b) => [b.name].concat(b.aliases || [])).map((n) => n.toLowerCase())),
    vendorDomains: (promptSet.brands || []).map((b) => b.domain).filter(Boolean).concat([meta.domain]),
  };
}

/* ---------------------------------------------------------------------
   Adaptive pacing. Starts slow, backs off on 429, eases after a streak of
   successes, and records what it learned so the real limit is observed
   rather than assumed.
   --------------------------------------------------------------------- */

class Pacer {
  constructor(startMs, minMs) {
    this.delay = startMs;
    this.startDelay = startMs;
    this.minMs = minMs;
    this.streak = 0;
    this.lastStart = 0;
    this.starts = [];        // timestamps of every call started
    this.events429 = [];
    this.calls = 0;
  }
  async wait() {
    const gap = this.lastStart + this.delay - Date.now();
    if (gap > 0) await sleep(gap);
    this.lastStart = Date.now();
    this.starts.push(this.lastStart);
    this.calls++;
  }
  ok() {
    if (++this.streak >= SPEEDUP_AFTER) {
      this.streak = 0;
      const next = Math.max(this.minMs, Math.round(this.delay * 0.9));
      if (next !== this.delay) this.delay = next;
    }
  }
  limited(retryAfterMs, quotaId) {
    const now = Date.now();
    const inLast60s = this.starts.filter((t) => now - t <= 60000).length;
    this.events429.push({ at: new Date(now).toISOString(), callsInLast60s: inLast60s, delayMsAtTime: this.delay, retryAfterMs, quotaId: quotaId || null });
    this.streak = 0;
    this.delay = Math.min(MAX_DELAY_MS, Math.round(this.delay * 1.5));
  }
  // Highest number of calls in any 60s window that contained no 429.
  report() {
    const bad = this.events429.map((e) => Date.parse(e.at));
    let best = 0;
    for (const t of this.starts) {
      if (bad.some((b) => b > t - 60000 && b <= t)) continue;
      best = Math.max(best, this.starts.filter((s) => s > t - 60000 && s <= t).length);
    }
    return {
      startDelayMs: this.startDelay,
      finalDelayMs: this.delay,
      finalImpliedCallsPerMinute: round(60000 / this.delay, 1),
      calls: this.calls,
      rateLimited: this.events429.length,
      maxCallsPer60sWithoutA429: best,
      events429: this.events429,
    };
  }
}

/* ---------------------------------------------------------------------
   State, files
   --------------------------------------------------------------------- */

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function monthKey(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' }).format(d);
  return p.slice(0, 7);
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function readRaw(file) {
  const out = { meta: null, runs: [], errors: [], rate: null };
  if (!fs.existsSync(file)) return out;
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let o;
    try { o = JSON.parse(line); } catch (e) { return; }
    if (o.type === 'meta') out.meta = o;
    else if (o.type === 'run') out.runs.push({ ...o, line: i + 1 });
    else if (o.type === 'error') out.errors.push({ ...o, line: i + 1 });
    else if (o.type === 'rate') out.rate = o.rate;
  });
  return out;
}

function appendLine(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}

function loadEnvLocal() {
  const f = path.join(ROOT, '.env.local');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

/* ---------------------------------------------------------------------
   Terminal report
   --------------------------------------------------------------------- */

function printReport(out) {
  const line = '-'.repeat(72);
  console.log('\n' + line);
  console.log(out.label);
  console.log(`Brand: ${out.brand} (${out.domain})   Vertical: ${out.vertical}   Runs/prompt: ${out.runsPerPrompt}`);
  console.log(line);
  console.log('Per prompt (mentions / runs, variance):');
  for (const p of out.prompts) {
    const rate = p.mentionRate === null ? 'n/a ' : pct(p.mentionRate).padStart(4);
    const flag = p.stable === false ? '  unstable' : '';
    console.log(`  ${p.id}  ${p.mentioned}/${p.runs} feat ${p.featured}  ${rate}  var ${p.variance === null ? 'n/a' : p.variance.toFixed(2)}${flag}  ${p.text.slice(0, 52)}`);
  }
  out.warnings.forEach((w) => console.log('\n! ' + w));
  if (!out.summary) return;
  const s = out.summary;
  console.log(`\nFeatured (heading, list label, table or bold; not prose only): ${pct(s.overall.featuredRate)}  (range ${pct(s.overall.featuredRange.min)} to ${pct(s.overall.featuredRange.max)})`);
  console.log(`Overall mention rate: ${pct(s.overall.mentionRate)}  (range ${pct(s.overall.range.min)} to ${pct(s.overall.range.max)} across ${s.overall.sweeps} sweeps: ${s.overall.bySweep.map(pct).join(', ')})`);
  console.log('\nShare of voice (appearance rate / share, range of share across sweeps):');
  s.competitors.slice(0, 15).forEach((c) => {
    console.log(`  ${(c.isTarget ? '> ' : '  ') + c.name.padEnd(24)} ${pct(c.appearanceRate).padStart(4)}  ${pct(c.shareOfVoice).padStart(4)}  ${pct(c.shareRange.min)}-${pct(c.shareRange.max)}${c.wide ? '  wide' : ''}`);
  });
  if (s.sourceDomains) {
    console.log('\nSource domains from grounding (runs citing / share of runs):');
    s.sourceDomains.slice(0, 15).forEach((d) => console.log(`  ${d.domain.padEnd(28)} ${String(d.runs).padStart(3)}  ${pct(d.runShare).padStart(4)}  ${d.kind}`));
    console.log('Source mix by citations: ' + Object.entries(s.sourceMix).map(([k, v]) => `${k} ${pct(v.share)}`).join(', '));
  } else {
    console.log('\nSource domains: not ranked (grounding off).');
  }
  if (s.unlistedCandidates.length) {
    console.log('\nNames in answers that are not in the lexicon (2+ runs, not counted): ' + s.unlistedCandidates.slice(0, 12).map((u) => `${u.name} (${u.runs})`).join(', '));
  }
}

function printRate(out) {
  const r = out.rateLimit;
  if (!r) return;
  console.log(`\nRate observed: ${r.calls} calls, ${r.rateLimited} rate-limited. Delay ${(r.startDelayMs / 1000).toFixed(1)}s -> ${(r.finalDelayMs / 1000).toFixed(1)}s (${r.finalImpliedCallsPerMinute}/min). Most calls in any 60s without a 429: ${r.maxCallsPer60sWithoutA429}.`);
  r.events429.forEach((e) => console.log(`  429 at ${e.at.slice(11, 19)} after ${e.callsInLast60s} calls in 60s${e.quotaId ? ' (' + e.quotaId + ')' : ''}`));
}

/* ---------------------------------------------------------------------
   Main
   --------------------------------------------------------------------- */

function parseArgs(argv) {
  const a = { alias: [], runs: DEFAULT_RUNS, model: DEFAULT_MODEL, delay: START_DELAY_MS, minDelay: MIN_DELAY_MS, maxQueries: 300 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--brand') a.brand = v();
    else if (k === '--domain') a.domain = v();
    else if (k === '--vertical') a.vertical = v();
    else if (k === '--alias') a.alias.push(v());
    else if (k === '--ambiguous') a.ambiguous = true;
    else if (k === '--runs') a.runs = parseInt(v(), 10);
    else if (k === '--model') a.model = v();
    else if (k === '--grounded') a.grounded = true;
    else if (k === '--date') a.date = v();
    else if (k === '--prompts') a.prompts = v().split(',');
    else if (k === '--delay') a.delay = parseInt(v(), 10);
    else if (k === '--min-delay') a.minDelay = parseInt(v(), 10);
    else if (k === '--max-queries') a.maxQueries = parseInt(v(), 10);
    else if (k === '--fresh') a.fresh = true;
    else if (k === '--no-extract-brands') a.noExtract = true;
    else if (k === '--from-raw') a.fromRaw = v();
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error('Unknown argument: ' + k);
  }
  return a;
}

function loadPromptSet(vertical) {
  const f = path.join(PROMPT_DIR, vertical + '.json');
  if (!fs.existsSync(f)) throw new Error(`No prompt set at content/prompts/${vertical}.json`);
  const set = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!set.prompts || !set.prompts.length) throw new Error(`content/prompts/${vertical}.json has no prompts yet.`);
  return set;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(fs.readFileSync(__filename, 'utf8').split('====')[0]); return; }

  // Rebuild from an existing raw file: no key, no network.
  if (args.fromRaw) {
    const rawPath = path.resolve(args.fromRaw);
    const raw = readRaw(rawPath);
    if (!raw.meta) throw new Error('No meta line in ' + rawPath);
    const out = buildOutput(raw.meta, raw, loadPromptSet(raw.meta.vertical), { rawFile: path.relative(ROOT, rawPath) });
    const file = rawPath.replace(/\.raw\.jsonl$/, '.json');
    writeJson(file, out);
    printReport(out);
    console.log('\nWrote ' + path.relative(ROOT, file));
    return;
  }

  if (!args.brand || !args.domain || !args.vertical) throw new Error('--brand, --domain and --vertical are required. See --help.');
  if (!(args.runs >= 1)) throw new Error('--runs must be a positive integer.');
  loadEnvLocal();
  // Google's terms for Grounding with Google Search do not allow analysing grounded results (see docs/citation-check.md, "Terms"). The flag
  // stays for the owner who has Google's written permission, and cannot be used by accident: it needs this variable as well.
  if (args.grounded && process.env.GOOGLE_GROUNDED_ANALYSIS_PERMISSION !== 'confirmed') {
    throw new Error('--grounded is refused. Google\'s terms for Grounding with Google Search do not permit analysing grounded results. Set GOOGLE_GROUNDED_ANALYSIS_PERMISSION=confirmed only if Google has given written permission (docs/citation-check.md).');
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set (environment or .env.local).');

  const mode = args.grounded ? 'grounded' : 'ungrounded';
  const date = args.date || new Date().toISOString().slice(0, 10);
  const domain = cleanDomain(args.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
  const promptSet = loadPromptSet(args.vertical);
  const prompts = promptSet.prompts.filter((p) => !args.prompts || args.prompts.includes(p.id));
  if (!prompts.length) throw new Error('No prompts match --prompts.');

  const base = path.join(OUT_DIR, `${slug(args.brand)}-${date}-${slug(args.model)}-${mode}`);
  const rawPath = base + '.raw.jsonl';
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (args.fresh && fs.existsSync(rawPath)) fs.unlinkSync(rawPath);

  const meta = {
    type: 'meta', brand: args.brand, domain, aliases: args.alias, ambiguous: !!args.ambiguous,
    vertical: args.vertical, promptSetVersion: promptSet.version, mode, model: args.model, date,
    runs: args.runs, promptIds: args.prompts || null, startedAt: new Date().toISOString(), parserVersion: PARSER_VERSION,
  };
  let raw = readRaw(rawPath);
  if (raw.meta) {
    const m = raw.meta;
    const diff = ['brand', 'domain', 'vertical', 'mode', 'model', 'promptSetVersion'].filter((k) => m[k] !== meta[k]);
    if (JSON.stringify(m.promptIds) !== JSON.stringify(meta.promptIds)) diff.push('prompts');
    if (diff.length) throw new Error(`${path.relative(ROOT, rawPath)} was produced with different ${diff.join(', ')}. Use --fresh or another --date. Files never mix settings.`);
    meta.startedAt = m.startedAt;
    meta.aliases = m.aliases;
    meta.ambiguous = m.ambiguous;
    log(`Resuming: ${raw.runs.length} runs already on disk.`);
  } else {
    appendLine(rawPath, meta);
  }
  const done = new Set(raw.runs.map((r) => r.promptId + '#' + r.run));

  // Pacer and usage ledger
  const rateFile = path.join(STATE_DIR, 'rate.json');
  const rateState = readJson(rateFile, {});
  const rateKey = args.model + '|' + mode;
  const learned = rateState[rateKey] && rateState[rateKey].delayMs;
  const pacer = new Pacer(Math.max(args.minDelay, learned || args.delay), args.minDelay);
  if (learned) log(`Starting delay ${(pacer.delay / 1000).toFixed(1)}s, learned from a previous run on ${rateState[rateKey].updatedAt.slice(0, 10)}.`);

  const usageFile = path.join(STATE_DIR, 'usage.json');
  const usage = readJson(usageFile, {});
  const mk = monthKey();
  usage[mk] = usage[mk] || { searchQueries: 0, groundedCalls: 0, calls: 0 };

  const total = prompts.length * args.runs;
  log(`${meta.brand} / ${args.vertical} / ${args.model} / ${mode.toUpperCase()} / ${prompts.length} prompts x ${args.runs} runs = ${total} calls`);
  if (mode === 'grounded') {
    log(`BILLING: grounded mode. Search queries this month so far: ${usage[mk].searchQueries} of ${FREE_SEARCH_QUERIES_PER_MONTH} free (local ledger; Google Cloud has the true count).`);
  }

  const cfg = { key, model: args.model, grounded: mode === 'grounded' };
  const provider = gemini; // the provider interface: lib/citation/providers/
  const liveCtx = makeContext(meta, promptSet);
  const extractOn = !args.noExtract && liveCtx.competitors.length === 0;
  if (extractOn) log('No brand lexicon for this vertical: brands are extracted by the model and accepted only if they appear verbatim in the answer.');
  let runQueries = 0, failures = 0, stopReason = null, interrupted = false;
  process.on('SIGINT', () => { interrupted = true; });

  outer:
  for (let run = 1; run <= args.runs; run++) {
    for (const p of prompts) {
      if (done.has(p.id + '#' + run)) continue;
      if (interrupted) { stopReason = 'Interrupted.'; break outer; }
      if (cfg.grounded && usage[mk].searchQueries >= FREE_SEARCH_QUERIES_PER_MONTH) {
        stopReason = `Free monthly search allowance (${FREE_SEARCH_QUERIES_PER_MONTH}) reached per the local ledger. Stopping; billing past it needs your decision.`;
        break outer;
      }
      if (cfg.grounded && runQueries >= args.maxQueries) {
        stopReason = `--max-queries ${args.maxQueries} reached for this run.`;
        break outer;
      }
      try {
        const r = await provider.ask(p.text, Object.assign({ pacer: pacer }, cfg));
        const g = cfg.grounded ? groundingSources(r.response) : { queries: [] };
        // No lexicon for this vertical: ask the model which brands the answer names; keep only those that appear verbatim.
        let extractedBrands;
        if (extractOn) {
          try { extractedBrands = await extractBrands(provider, answerText(r.response), Object.assign({ pacer: pacer }, cfg, { grounded: false }), [meta.brand].concat(meta.aliases || [])); } catch (e) { if (e.stop) throw e; extractedBrands = []; log('  brand extraction failed: ' + e.message); }
          usage[mk].calls++;
        }
        appendLine(rawPath, {
          type: 'run', promptId: p.id, run, ts: new Date().toISOString(),
          request: { model: cfg.model, mode, body: r.body },
          latencyMs: r.latencyMs, attempts: r.attempts, searchQueries: g.queries.length,
          response: r.response,
          ...(extractOn ? { extractedBrands } : {}),
        });
        usage[mk].calls++;
        if (cfg.grounded) { usage[mk].groundedCalls++; usage[mk].searchQueries += g.queries.length; runQueries += g.queries.length; }
        writeJson(usageFile, usage);
        failures = 0;
        const parsed = parseRun(r.response, liveCtx, extractedBrands);
        log(`run ${run}/${args.runs} ${p.id} ${parsed.mentioned ? 'MENTIONED' : 'absent   '} competitors=${parsed.competitors.length}${cfg.grounded ? ` queries=${g.queries.length} sources=${parsed.sourceDomains.length}` : ''} (${(r.latencyMs / 1000).toFixed(1)}s, delay ${(pacer.delay / 1000).toFixed(1)}s)`);
      } catch (e) {
        if (e.stop) { stopReason = e.message; break outer; }
        appendLine(rawPath, { type: 'error', promptId: p.id, run, ts: new Date().toISOString(), message: e.message });
        log(`  FAILED ${p.id} run ${run}: ${e.message}`);
        if (++failures >= 3) { stopReason = '3 consecutive failures.'; break outer; }
      }
    }
  }

  const rate = pacer.report();
  appendLine(rawPath, { type: 'rate', ts: new Date().toISOString(), rate });
  rateState[rateKey] = { delayMs: pacer.delay, updatedAt: new Date().toISOString(), lastObserved: { rateLimited: rate.rateLimited, maxCallsPer60sWithoutA429: rate.maxCallsPer60sWithoutA429 } };
  writeJson(rateFile, rateState);

  raw = readRaw(rawPath);
  const out = buildOutput(meta, { ...raw, rate }, promptSet, { rawFile: path.relative(ROOT, rawPath) });
  out.searchQueries.thisRun = runQueries;
  out.searchQueries.monthToDateLocalLedger = cfg.grounded ? usage[mk].searchQueries : null;
  out.searchQueries.monthlyFreeAllowance = FREE_SEARCH_QUERIES_PER_MONTH;
  if (stopReason) out.warnings.push('Job stopped early: ' + stopReason);
  writeJson(base + '.json', out);

  printReport(out);
  printRate(out);
  if (cfg.grounded) console.log(`Search queries: ${runQueries} this run, ${usage[mk].searchQueries} of ${FREE_SEARCH_QUERIES_PER_MONTH} this month (local ledger).`);
  console.log('\nWrote ' + path.relative(ROOT, base + '.json') + '\nRaw   ' + path.relative(ROOT, rawPath));
  if (stopReason) { console.log('\nSTOPPED: ' + stopReason); process.exitCode = 2; }
}

module.exports = { main, parseRun, makeMatcher, makeContext, domainsInText, groundingSources, unlistedCandidates, buildOutput, binaryVariance, Pacer, parseRetryDelay };
