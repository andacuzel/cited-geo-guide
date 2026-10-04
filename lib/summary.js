/* =====================================================================
   lib/summary.js — the executive summary of a crawl report.

   Two ways to write it, one validator in front of both:
     deterministic(facts)   written by rules from the facts object. It is the
                            fallback and stands alone.
     summarize(facts, opts) asks a model to rephrase the facts, validates
                            what comes back, retries once with the error
                            appended, and falls back to deterministic().

   The model never sees page content, URLs or the domain: only the aggregated
   figures in the facts object (lib/report-facts.js). It may only rephrase. The
   validator checks the reply against the facts: schema, caps, every number,
   banned words, and what it may and may not claim.

   UMD (Node and browser). The network call is injected (opts.ask), so this
   file makes no request; lib/summary-gemini.js is the Gemini adapter.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ANSWERABLE_SUMMARY = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BANNED = /\b(quietly|actually|seamlessly|effortless(ly)?|powerful|unlock|elevate|supercharge|game-changing|revolutioni[sz]e|landscape|delve|crucial|robust)\b/i;
  var FORBIDDEN_NAMES = /\b(chatgpt|claude|perplexity|gemini|openai|anthropic|copilot|bard)\b|citation|\bcited?\b/i;
  // "one" is left out: it is an ordinary word ("one link", "one template change").
  var NUMBER_WORDS = /\b(zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/i;
  var LIMITS = { headlineWords: 30, situationSentences: 3, workingSentences: 2, priorities: 3, caveats: 4, caveatWords: 40, fieldWords: 45 };

  function words(s) { return String(s).trim().split(/\s+/).filter(Boolean).length; }
  function sentences(s) { return String(s).split(/(?<=[.!?])\s+/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function list(xs) { return xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; }

  /* ---------------- 1. deterministic ---------------- */

  function deterministic(f) {
    var v = f.verdict, c = f.coverage;
    var headline;
    if (v.siteWide === null) {
      headline = 'No page could be read, so there is no score.';
    } else if (v.homepage === null) {
      headline = 'Site-wide score ' + v.siteWide + ' out of 100. The homepage could not be read.';
    } else if (v.gap === 0) {
      headline = 'Site-wide score ' + v.siteWide + ' out of 100, the same as the homepage.';
    } else {
      headline = 'Site-wide score ' + v.siteWide + ' out of 100. The homepage scores ' + v.homepage + ', ' + plural(Math.abs(v.gap), 'point', 'points') + (v.gap < 0 ? ' above' : ' below') + ' the site average.';
    }

    var sit = [];
    sit.push('We read ' + plural(c.pagesRead, 'page', 'pages') + (c.pagesFailed ? ', and ' + c.pagesFailed + ' could not be fetched' : '') + '. ' + (v.pagesWithAFailure === c.pagesRead ? 'All of them' : v.pagesWithAFailure + ' of them') + ' fail at least one page-level check.');
    if (v.benchmark && v.homepage !== null) {
      sit.push('The average homepage among the ' + v.benchmark.sites + ' sites in our benchmarks scores ' + v.benchmark.average + '; this homepage scores ' + v.homepage + '.');
    }
    if (f.counts.likelyShared > 0) {
      sit.push(plural(f.counts.likelyShared, 'check fails', 'checks fail') + ' on at least ' + f.rules.likelySharedPct + '% of pages, which is likely a shared template.');
    }
    var situation = sit.join(' ');
    // Keep to three sentences.
    situation = sentences(situation).slice(0, LIMITS.situationSentences).join(' ');

    var priorities = f.priorities.map(function (p) {
      var why = p.failingPages + ' of ' + p.of + ' pages fail this check. Fixing it everywhere adds about ' + p.gain + ' points to the site-wide score.' + (p.likelyShared ? ' The pattern is likely a shared template.' : '');
      return {
        title: p.label,
        why: why,
        where: p.failingPages + ' of ' + p.of + ' pages' + (p.passesOnHomepage ? ', and it passes on the homepage' : ''),
        effort: 'Typically ' + p.effort,
        gain_pts: p.gain,
        fact_ref: p.ref
      };
    });

    var working;
    if (f.counts.passingEverywhere > 0) {
      var show = f.working.slice(0, 3);
      working = plural(f.counts.passingEverywhere, 'page-level check passes', 'page-level checks pass') + ' on every page read, including ' + list(show) + '.';
    } else {
      working = 'No page-level check passes on every page read.';
    }

    var caveats = [];
    if (c.sampled) {
      caveats.push('The crawl read ' + c.pagesRead + ' pages, close to the most it reads (' + c.cap + '), so the site may have more.');
    } else if (c.sitemapCandidates !== null) {
      caveats.push('Discovery found ' + c.sitemapCandidates + ' candidate pages and the crawl read ' + c.pagesRead + '.');
    } else {
      caveats.push('The crawl read ' + c.pagesRead + ' pages, chosen from the sitemap or the homepage links.');
    }
    if (v.gap !== null && v.gap !== 0) {
      caveats.push('A homepage scan alone reports ' + v.homepage + '. The site averages ' + v.siteWide + '.');
    }
    caveats.push('This measures readiness: whether pages can be reached and read. It does not show whether any AI assistant names the site.');
    var crawlerCheck = f.checks.filter(function (x) { return x.label === 'AI crawler access'; })[0];
    if (crawlerCheck && crawlerCheck.failingPages > 0 && f.crawlers.blocked === 0) {
      caveats.push('The AI crawler access check gives half credit for any Disallow rule that applies, including ordinary paths. It is left out of the priorities.');
    }
    return { headline: headline, situation: situation, priorities: priorities, working: working, caveats: caveats.slice(0, LIMITS.caveats) };
  }

  /* ---------------- 2. what the model is asked ---------------- */

  // The facts the model sees: figures and labels only. No URLs, no domain, no snippets, no page content.
  function modelFacts(f) {
    return {
      coverage: f.coverage,
      // vsBenchmark compares a site-wide average with homepages, which is not like for like; the model gets only homepageVsBenchmark.
      verdict: (function () { var v = {}; Object.keys(f.verdict).forEach(function (k) { if (k !== 'vsBenchmark') v[k] = f.verdict[k]; }); return v; }()),
      pillars: f.pillars,
      rules: f.rules,
      counts: f.counts,
      crawlers: f.crawlers,
      checks: f.checks.map(function (c) {
        return { label: c.label, siteLevel: c.siteLevel, failingPages: c.failingPages, failingShare: c.failingShare, passesOnHomepage: c.passesOnHomepage, likelyShared: c.likelyShared, gainIfFixedEverywhere: c.gainIfFixedEverywhere, typicalEffort: c.effort.label };
      }),
      clusters: f.clusters.map(function (c) { return { prefix: c.prefix, pages: c.pages, avgScore: c.avgScore, failing: c.failing }; }),
      priorities: f.priorities,
      working: f.working
    };
  }

  function buildPrompt(f, errorNote) {
    var rules = [
      'You rewrite a website crawl report as a short executive summary. You only rephrase the facts below. You add nothing.',
      'Return one JSON object and nothing else, with exactly these keys: headline (string, at most 30 words), situation (string, 2 or 3 sentences), priorities (array of at most 3 objects, each with title, why, where, effort, gain_pts, fact_ref), working (string, at most 2 sentences), caveats (array of strings, at most 4).',
      'Use only figures that appear in the facts. Do not compute new figures. gain_pts must equal gainIfFixedEverywhere for the check you name. fact_ref must be the "ref" of one entry in the facts priorities.',
      'Write about readiness: whether pages can be reached and read. Make no claim about being named, mentioned or shown in AI answers. Do not mention any AI product or company, and do not use the word citation.',
      'Call a pattern "likely a shared template" only for a check whose likelyShared is true, and say "likely". It is an inference.',
      'Voice: declarative, short sentences, numbers before adjectives, plain words. At most one em dash per field. Never use these words: quietly, actually, seamlessly, effortless, powerful, unlock, elevate, supercharge, game-changing, revolutionize, landscape, delve, crucial, robust. Say "named", never "recommended". US English.',
      'Effort is typical, not measured: say "typically".',
      'The benchmark average was measured on homepages only. Compare it with the homepage score, never with the site-wide score.',
      'caveats must include one sentence that says this measures readiness, meaning whether pages can be reached and read, and does not show whether any AI assistant names the site. A crawler marked limited has an ordinary Disallow rule that applies, such as an admin path. Do not present limited crawlers as a failure.',
      'Write complete sentences in situation, why and caveats. Do not write fragments such as "10 crawlers are limited."',
      'Write every figure as digits (6, not six). Never write a number as a word.',
      'Glossary: coverage.pagesFailed is the number of pages that could not be fetched. verdict.pagesWithAFailure is the number of pages that fail at least one page-level check. failingPages is how many pages fail one check. gainIfFixedEverywhere is points added to the site-wide score. crawlers.limited counts crawlers with an ordinary Disallow rule that applies.',
      'In each priority, "where" says how many pages, in the form "18 of 27 pages". "effort" is a different phrase that starts "typically". "why" explains in one sentence.'
    ].join('\n');
    return rules + '\n\nFACTS (JSON):\n' + JSON.stringify(modelFacts(f)) + (errorNote ? '\n\nYour previous reply was rejected for these reasons. Fix them and return the JSON again:\n' + errorNote : '');
  }

  /* ---------------- 3. validation ---------------- */

  function numbersIn(factsObj) {
    var set = {};
    (function walk(v) {
      if (typeof v === 'number') { set[String(v)] = true; set[String(Math.abs(v))] = true; set[String(Math.round(v))] = true; }
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { walk(v[k]); });
    }(factsObj));
    // A share written as a percentage equals its fact (0.8 -> 80).
    Object.keys(set).slice().forEach(function (k) { var x = parseFloat(k); if (x > 0 && x <= 1) set[String(Math.round(x * 100))] = true; });
    // "out of 100", and the scale of the pillars' maxima are in the facts; 100 is the scale of the score itself.
    set['100'] = true;
    return set;
  }

  function textFields(s) {
    var out = [['headline', s.headline], ['situation', s.situation], ['working', s.working]];
    (s.priorities || []).forEach(function (p, i) { ['title', 'why', 'where', 'effort'].forEach(function (k) { out.push(['priorities[' + i + '].' + k, p[k]]); }); });
    (s.caveats || []).forEach(function (c, i) { out.push(['caveats[' + i + ']', c]); });
    return out;
  }

  function validate(s, f) {
    var errors = [];
    var bad = function (m) { errors.push(m); };
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok: false, errors: ['the reply is not a JSON object'] };
    var keys = ['headline', 'situation', 'priorities', 'working', 'caveats'];
    keys.forEach(function (k) { if (!(k in s)) bad('missing key ' + k); });
    Object.keys(s).forEach(function (k) { if (keys.indexOf(k) === -1 && ['source', 'label'].indexOf(k) === -1) bad('unexpected key ' + k); });
    ['headline', 'situation', 'working'].forEach(function (k) { if (typeof s[k] !== 'string' || !s[k].trim()) bad(k + ' must be a non-empty string'); });
    if (!Array.isArray(s.priorities)) bad('priorities must be an array');
    if (!Array.isArray(s.caveats)) bad('caveats must be an array');
    if (errors.length) return { ok: false, errors: errors };

    if (words(s.headline) > LIMITS.headlineWords) bad('headline is over ' + LIMITS.headlineWords + ' words');
    var sc = sentences(s.situation).length;
    if (sc < 2 || sc > LIMITS.situationSentences) bad('situation must be 2 or 3 sentences, found ' + sc);
    if (sentences(s.working).length > LIMITS.workingSentences) bad('working is over ' + LIMITS.workingSentences + ' sentences');
    if (s.priorities.length > LIMITS.priorities) bad('more than ' + LIMITS.priorities + ' priorities');
    if (s.caveats.length > LIMITS.caveats) bad('more than ' + LIMITS.caveats + ' caveats');
    s.caveats.forEach(function (c, i) { if (typeof c !== 'string' || !c.trim()) bad('caveats[' + i + '] must be a non-empty string'); else if (words(c) > LIMITS.caveatWords) bad('caveats[' + i + '] is over ' + LIMITS.caveatWords + ' words'); });

    var priorityFacts = {};
    f.priorities.forEach(function (p) { priorityFacts[p.ref] = p; });
    s.priorities.forEach(function (p, i) {
      if (!p || typeof p !== 'object') { bad('priorities[' + i + '] must be an object'); return; }
      ['title', 'why', 'where', 'effort', 'fact_ref'].forEach(function (k) { if (typeof p[k] !== 'string' || !p[k].trim()) bad('priorities[' + i + '].' + k + ' must be a non-empty string'); });
      if (typeof p.gain_pts !== 'number' || !isFinite(p.gain_pts)) bad('priorities[' + i + '].gain_pts must be a number');
      if (typeof p.where === 'string' && !/\d/.test(p.where)) bad('priorities[' + i + '].where must say how many pages');
      if (typeof p.effort === 'string' && !/^typically\b/i.test(p.effort.trim())) bad('priorities[' + i + '].effort must start "typically"; it is a typical effort, not a measured one');
      ['why', 'where', 'effort', 'title'].forEach(function (k) { if (typeof p[k] === 'string' && words(p[k]) > LIMITS.fieldWords) bad('priorities[' + i + '].' + k + ' is over ' + LIMITS.fieldWords + ' words'); });
      var ref = priorityFacts[p.fact_ref];
      if (!ref) bad('priorities[' + i + '].fact_ref "' + p.fact_ref + '" is not one of the facts priorities');
      else {
        if (p.gain_pts !== ref.gain) bad('priorities[' + i + '].gain_pts ' + p.gain_pts + ' differs from the fact ' + ref.gain);
        if (/shared template/i.test([p.title, p.why, p.where, p.effort].join(' ')) && !ref.likelyShared) bad('priorities[' + i + '] calls a pattern a shared template, but likelyShared is false for ' + ref.label);
      }
    });

    if (!s.caveats.some(function (c) { return /readiness/i.test(c) && /\b(not|does not|doesn't)\b/i.test(c); })) bad('caveats must say that this measures readiness and does not show whether any AI assistant names the site');
    var allowed = numbersIn(f);
    var anyShared = f.checks.some(function (c) { return c.likelyShared; });
    textFields(s).forEach(function (pair) {
      var name = pair[0], text = pair[1];
      if (typeof text !== 'string') return;
      var spelled = text.match(NUMBER_WORDS);
      if (spelled) bad(name + ' writes a number as a word ("' + spelled[0] + '"); write figures as digits so they can be checked');
      (text.match(/\d+(?:\.\d+)?/g) || []).forEach(function (n) {
        if (!allowed[n] && !allowed[String(parseFloat(n))]) bad(name + ' contains the number ' + n + ', which is not in the facts');
      });
      var b = text.match(BANNED); if (b) bad(name + ' uses the banned word "' + b[0] + '"');
      if (/\brecommended?\b/i.test(text)) bad(name + ' says "recommended"; say "named" or leave it out');
      if ((text.match(/—/g) || []).length > 1) bad(name + ' has more than one em dash');
      sentences(text).forEach(function (sen) {
        if (FORBIDDEN_NAMES.test(sen)) bad(name + ' mentions an AI product or citations: "' + sen.slice(0, 60) + '"');
        if (/\b(named|mentioned|shown|surfaced|appears?|ranks?|visible)\b[^.]*\b(AI|answers?|assistants?|chatbots?|LLMs?|models?)\b/i.test(sen) && !/\b(not|nothing|never|no)\b/i.test(sen)) bad(name + ' makes a claim about AI answers: "' + sen.slice(0, 60) + '"');
        if (/site-wide|across the site|site average/i.test(sen) && /benchmark/i.test(sen)) bad(name + ' compares the site-wide score with the benchmark, which measured homepages: "' + sen.slice(0, 60) + '"');
        if (/shared template/i.test(sen) && !/likely/i.test(sen)) bad(name + ' says "shared template" without "likely"; it is an inference');
        if (/shared template/i.test(sen) && !name.startsWith('priorities') && !anyShared) bad(name + ' says "shared template" but no check is likely shared');
      });
    });
    return { ok: errors.length === 0, errors: errors };
  }

  /* ---------------- 4. the whole pass ---------------- */

  function parseJson(text) {
    var t = String(text == null ? '' : text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return { ok: true, value: JSON.parse(t) }; } catch (e) { return { ok: false, error: 'the reply is not valid JSON (' + e.message + ')' }; }
  }

  function labelFor(source) {
    return source.kind === 'model'
      ? 'Summary written by ' + source.model + ' (' + source.date + ') from the figures below and checked against them'
      : 'Summary written by rules from the figures below';
  }

  // opts: { ask: async (prompt, {model}) => text, model, date (YYYY-MM-DD) }
  async function summarize(f, opts) {
    opts = opts || {};
    var log = [];
    var fallback = function (reason) {
      var d = deterministic(f);
      d.source = { kind: 'rules' };
      d.label = labelFor(d.source);
      return { summary: d, attempts: log, fallbackReason: reason };
    };
    if (typeof opts.ask !== 'function') return fallback('no model configured');
    var errorNote = '';
    for (var attempt = 0; attempt < 2; attempt++) {
      var text;
      try {
        text = await opts.ask(buildPrompt(f, errorNote), { model: opts.model });
      } catch (e) {
        log.push({ attempt: attempt + 1, ok: false, errors: ['the model request failed: ' + (e && e.message ? e.message : e)] });
        errorNote = 'The request itself failed; there is nothing to fix in the reply.';
        continue;
      }
      var parsed = parseJson(text);
      var verdict = parsed.ok ? validate(parsed.value, f) : { ok: false, errors: [parsed.error] };
      log.push({ attempt: attempt + 1, ok: verdict.ok, errors: verdict.errors });
      if (verdict.ok) {
        var s = parsed.value;
        var out = { headline: s.headline, situation: s.situation, priorities: s.priorities, working: s.working, caveats: s.caveats };
        out.source = { kind: 'model', model: opts.model, date: opts.date };
        out.label = labelFor(out.source);
        return { summary: out, attempts: log, fallbackReason: null };
      }
      errorNote = verdict.errors.join('\n');
    }
    return fallback('the model reply failed validation or the request failed twice');
  }

  return { deterministic: deterministic, buildPrompt: buildPrompt, modelFacts: modelFacts, validate: validate, summarize: summarize, labelFor: labelFor, LIMITS: LIMITS };
}));
