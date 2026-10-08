#!/usr/bin/env node
/* =====================================================================
   scripts/launch-report-stats.js

   Aggregate statistics for the launch research report. Reads the stored
   benchmark scans only: data/benchmarks.json and, for every category in it,
   data/<category>-raw.json (one record per attempted site) and
   data/<category>-summary.json (the published aggregate). No network, no new
   scans, no clock: the same input always gives the same bytes.

   Writes local/launch-report/stats.json, which is gitignored. The output holds
   aggregate numbers only. No domain, no site name and no per-site score is ever
   written; the raw files, which name the sites, stay out of the repository
   (see .gitignore).

   It also reconciles its own totals with what the site already publishes: the
   tracked summaries (what get_benchmark and the benchmark pages read), the
   homepage benchmark strip and the crawler-access research page. Every
   difference is written to stats.json under "reconciliation", never smoothed.

     node scripts/launch-report-stats.js            write local/launch-report/stats.json
     node scripts/launch-report-stats.js --check    exit 1 if stats.json is not what the data gives now

   Definitions
     failed check   a check that scores below its maximum (pts < max)
     restricted     a crawler whose state is "partial" (an applicable Disallow rule) or "block"
     blocked        a crawler whose state is "block" (the whole site is disallowed)
     quartiles      linear interpolation between order statistics (R type 7)
     reportable     a group of 20 or more scored sites
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT_DIR = path.join(ROOT, 'local', 'launch-report');
const OUT = path.join(OUT_DIR, 'stats.json');
const MIN_N = 20;
const PILLARS = ['discover', 'tech', 'trust'];
const PILLAR_MAX = { discover: 40, tech: 20, trust: 40 };
const CRAWLER_CHECK = /^AI crawler access/;

/* ---------- small numeric helpers ---------- */

const round = (x, d) => { const f = Math.pow(10, d); return Math.round(x * f) / f; };
const sum = (a) => a.reduce((s, v) => s + v, 0);
const mean = (a) => (a.length ? sum(a) / a.length : null);
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function sd(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(sum(a.map((v) => (v - m) * (v - m))) / (a.length - 1));
}
const pct = (n, of) => (of ? round((n / of) * 100, 1) : null);
const count = (n, of) => ({ n: n, of: of, pct: pct(n, of) });

function dist(values) {
  const s = values.slice().sort((a, b) => a - b);
  return {
    n: s.length,
    mean: round(mean(s), 2),
    median: round(quantile(s, 0.5), 2),
    q1: round(quantile(s, 0.25), 2),
    q3: round(quantile(s, 0.75), 2),
    min: s[0],
    max: s[s.length - 1],
    sd: s.length > 1 ? round(sd(s), 2) : null
  };
}

/* ---------- load ---------- */

function load() {
  const index = JSON.parse(fs.readFileSync(path.join(DATA, 'benchmarks.json'), 'utf8'));
  const cats = index.map((e) => {
    const rawFile = path.join(DATA, e.category + '-raw.json');
    if (!fs.existsSync(rawFile)) {
      throw new Error('Missing ' + path.relative(ROOT, rawFile) + '. The raw scan files are gitignored; this script needs the local copies.');
    }
    const raw = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
    const summary = JSON.parse(fs.readFileSync(path.join(DATA, e.category + '-summary.json'), 'utf8'));
    return { meta: e, raw: raw, summary: summary, ok: raw.filter((r) => r.ok).map((r) => r.data), failed: raw.filter((r) => !r.ok) };
  });
  return { index: index, cats: cats };
}

/* ---------- per-group statistics ---------- */

function checkRows(sites) {
  const by = {};
  sites.forEach((d) => {
    d.result.checks.forEach((c) => {
      const label = CRAWLER_CHECK.test(c.label) ? 'AI crawler access' : c.label;
      const row = by[label] || (by[label] = { label: label, pillar: c.cat, max: c.max, n: 0, failed: 0, lost: 0 });
      row.n++;
      if (c.pts < c.max) { row.failed++; row.lost += c.max - c.pts; }
    });
  });
  return Object.values(by).map((r) => ({
    label: r.label,
    pillar: r.pillar,
    maxPoints: r.max,
    n: r.n,
    failedN: r.failed,
    failRatePct: pct(r.failed, r.n),
    passRatePct: pct(r.n - r.failed, r.n),
    avgPointsAddedByFix: r.failed ? round(r.lost / r.failed, 2) : 0,
    avgPointsLostPerSite: round(r.lost / r.n, 2)
  }));
}

function rankChecks(rows) {
  // ranked by how often the check fails; the crawler-access check is listed apart because any
  // applicable Disallow rule (an admin path, say) already scores below maximum.
  return rows
    .filter((r) => r.label !== 'AI crawler access')
    .sort((a, b) => b.failRatePct - a.failRatePct || b.avgPointsLostPerSite - a.avgPointsLostPerSite || (a.label < b.label ? -1 : 1))
    .map((r, i) => Object.assign({ rank: i + 1 }, r));
}

function crawlerStats(sites) {
  const names = [];
  sites[0].botResults.forEach((b) => names.push(b.name));
  const perBot = names.map((name) => {
    let open = 0, partial = 0, block = 0;
    sites.forEach((d) => {
      const b = d.botResults.filter((x) => x.name === name)[0];
      if (b.state === 'block') block++; else if (b.state === 'partial') partial++; else open++;
    });
    return {
      crawler: name, n: sites.length, open: open, limited: partial, blocked: block,
      openPct: pct(open, sites.length), limitedPct: pct(partial, sites.length), blockedPct: pct(block, sites.length),
      restrictedPct: pct(partial + block, sites.length)
    };
  });
  const any = (pred) => sites.filter((d) => d.botResults.some(pred)).length;
  const all = (pred) => sites.filter((d) => d.botResults.every(pred)).length;
  const pairs = sites.length * names.length;
  const pairCount = (state) => sum(perBot.map((b) => b[state]));
  return {
    n: sites.length,
    trackedCrawlers: names.length,
    perBot: perBot,
    pairs: {
      total: pairs,
      open: count(pairCount('open'), pairs),
      limited: count(pairCount('limited'), pairs),
      blocked: count(pairCount('blocked'), pairs)
    },
    sitesBlockingAtLeastOne: count(any((b) => b.state === 'block'), sites.length),
    sitesRestrictingAtLeastOne: count(any((b) => b.state !== 'open'), sites.length),
    sitesFullyOpenToAll: count(all((b) => b.state === 'open'), sites.length),
    sitesBlockingEveryCrawler: count(all((b) => b.state === 'block'), sites.length),
    noRobotsTxt: count(sites.filter((d) => !d.robotsOk).length, sites.length)
  };
}

const SIGNALS = {
  llmsTxt: 'llms.txt present',
  sitemapDeclared: 'Sitemap declared',
  jsonLd: 'Structured data (JSON-LD)',
  organizationSchema: 'Organization / WebSite schema',
  canonical: 'Canonical tag',
  singleH1: 'Single H1 heading'
};
function signalStats(sites) {
  const out = {};
  Object.keys(SIGNALS).forEach((k) => {
    const passed = sites.filter((d) => d.result.checks.some((c) => c.label === SIGNALS[k] && c.pts >= c.max)).length;
    out[k] = count(passed, sites.length);
  });
  return out;
}

function group(sites) {
  const totals = sites.map((d) => d.result.total);
  const lost = sites.map((d) => 100 - d.result.total);
  return {
    n: sites.length,
    reportable: sites.length >= MIN_N,
    score: dist(totals),
    pillarMeans: {
      discover: { mean: round(mean(sites.map((d) => d.result.discover)), 2), of: PILLAR_MAX.discover },
      tech: { mean: round(mean(sites.map((d) => d.result.tech)), 2), of: PILLAR_MAX.tech },
      trust: { mean: round(mean(sites.map((d) => d.result.trust)), 2), of: PILLAR_MAX.trust }
    },
    meanPointsBelowMaximum: round(mean(lost), 2),
    scoreBands: {
      below50: count(totals.filter((t) => t < 50).length, sites.length),
      from50to79: count(totals.filter((t) => t >= 50 && t < 80).length, sites.length),
      from80: count(totals.filter((t) => t >= 80).length, sites.length)
    },
    signals: signalStats(sites),
    crawlers: crawlerStats(sites)
  };
}

/* ---------- reconciliation with what the site publishes ---------- */

function reconcile(data, stats) {
  const items = [];
  const note = (area, what, published, computed, same, why) => items.push({ area: area, what: what, published: published, computed: computed, same: !!same, note: why || null });

  // 1. tracked summaries (what get_benchmark and the benchmark pages read)
  data.cats.forEach((c) => {
    const s = c.summary, g = stats.categories[c.meta.category];
    const roundInt = (x) => Math.round(x);
    note('summary:' + c.meta.category, 'sites scanned', s.scanned, g.n, s.scanned === g.n);
    note('summary:' + c.meta.category, 'sites that could not be scanned', s.failed, c.failed.length, s.failed === c.failed.length);
    note('summary:' + c.meta.category, 'average score', s.score.average, g.score.mean, s.score.average === roundInt(g.score.mean), 'published figure is the mean rounded to a whole number');
    const med = roundInt(g.score.median);
    note('summary:' + c.meta.category, 'median score', s.score.median, g.score.median, s.score.median === med, 'published figure is the median rounded to a whole number');
    note('summary:' + c.meta.category, 'lowest and highest', s.score.lowest + '–' + s.score.highest, g.score.min + '–' + g.score.max, s.score.lowest === g.score.min && s.score.highest === g.score.max);
    ['averageDiscoverability:discover', 'averageTechnical:tech', 'averageTrust:trust'].forEach((p) => {
      const parts = p.split(':');
      note('summary:' + c.meta.category, 'pillar mean ' + parts[1], s.score[parts[0]], g.pillarMeans[parts[1]].mean, s.score[parts[0]] === roundInt(g.pillarMeans[parts[1]].mean), 'published figure is the mean rounded to a whole number');
    });
    let perBotSame = true;
    g.crawlers.perBot.forEach((b) => { const p = s.crawlers.perBot[b.crawler]; if (!p || p.open !== b.open || p.limited !== b.limited || p.blocked !== b.blocked) perBotSame = false; });
    note('summary:' + c.meta.category, 'per-crawler open, limited, blocked counts', 'summary', 'recomputed', perBotSame);
    note('summary:' + c.meta.category, 'sites blocking at least one crawler (%)', s.crawlers.blockingAtLeastOnePct, g.crawlers.sitesBlockingAtLeastOne.pct, s.crawlers.blockingAtLeastOnePct === Math.round((g.crawlers.sitesBlockingAtLeastOne.n / g.crawlers.sitesBlockingAtLeastOne.of) * 100), 'published figure is rounded to a whole percent');
    const rates = {}; checkRows(c.ok).filter((r) => r.label !== 'AI crawler access').forEach((r) => { rates[r.label] = Math.round((r.failedN / r.n) * 100); });
    const differing = Object.keys(s.checkFailureRates).filter((k) => s.checkFailureRates[k] !== rates[k]);
    note('summary:' + c.meta.category, 'check failure rates (%)', 'summary', 'recomputed', differing.length === 0 && Object.keys(s.checkFailureRates).length === Object.keys(rates).length, differing.length ? 'differs for: ' + differing.join(', ') : 'published figures are rounded to whole percents');
  });

  // 2. the overall figure on the homepage strip and in get_benchmark: weighted mean of the rounded category averages
  const publishedWeighted = Math.round(sum(data.cats.map((c) => c.summary.score.average * c.summary.scanned)) / sum(data.cats.map((c) => c.summary.scanned)));
  const exact = stats.overall.score.mean;
  note('overall', 'sites scanned (homepage strip, get_benchmark)', sum(data.cats.map((c) => c.summary.scanned)), stats.overall.n, sum(data.cats.map((c) => c.summary.scanned)) === stats.overall.n);
  note('overall', 'average score (homepage strip, get_benchmark)', publishedWeighted, exact, publishedWeighted === Math.round(exact), 'the public figure is the site-weighted mean of the six rounded category averages (' + round(sum(data.cats.map((c) => c.summary.score.average * c.summary.scanned)) / sum(data.cats.map((c) => c.summary.scanned)), 2) + '); the mean of the 219 individual scores is ' + exact);
  note('overall', 'median score', 'not published', stats.overall.score.median, true, 'the site publishes category medians only; this overall median is new');

  // the methodology changelog quotes 7 of 219 for the parser caveat; measure the same signature on the stored records
  note('methodology changelog', 'Meta description failures with 1 to 49 characters captured (parser caveat)', 7, stats.checks.metaDescriptionParserCaveat.failedWithOneTo49CharactersCaptured, stats.checks.metaDescriptionParserCaveat.failedWithOneTo49CharactersCaptured === 7);

  // 3. the crawler-access research page
  const file = path.join(ROOT, 'research', 'crawler-access-2026.html');
  if (fs.existsSync(file)) {
    const html = fs.readFileSync(file, 'utf8');
    const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
    const c = stats.overall.crawlers;
    const m = /(\d+) of the (\d+) crawler-and-homepage pairs|of the (\d+) crawler-and-homepage pairs/.exec(text);
    const pairsPublished = /Of the (\d+) crawler-and-homepage pairs/.exec(text);
    const pairLine = /(\d+) of the (\d+) pairs are limited, (\d+) are blocked and (\d+) are open/.exec(text);
    note('research page', 'crawler-and-homepage pairs', pairsPublished ? +pairsPublished[1] : null, c.pairs.total, pairsPublished && +pairsPublished[1] === c.pairs.total);
    if (pairLine) note('research page', 'pairs limited / blocked / open', pairLine[1] + ' / ' + pairLine[3] + ' / ' + pairLine[4], c.pairs.limited.n + ' / ' + c.pairs.blocked.n + ' / ' + c.pairs.open.n, +pairLine[1] === c.pairs.limited.n && +pairLine[3] === c.pairs.blocked.n && +pairLine[4] === c.pairs.open.n);
    c.perBot.forEach((b) => {
      const re = new RegExp(b.crawler.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + ': blocked (\\d+), limited (\\d+), open (\\d+) of (\\d+)');
      const r = re.exec(text);
      note('research page', b.crawler + ' blocked / limited / open', r ? r[1] + ' / ' + r[2] + ' / ' + r[3] : null, b.blocked + ' / ' + b.limited + ' / ' + b.open, r && +r[1] === b.blocked && +r[2] === b.limited && +r[3] === b.open);
    });
    const notScored = /(\d+) more could not be reached/.exec(text);
    note('research page', 'sites that could not be reached', notScored ? +notScored[1] : null, stats.access.notScored, notScored && +notScored[1] === stats.access.notScored);
    const b2b = /(\d+) B2B and (\d+) consumer/.exec(text);
    note('research page', 'B2B and consumer split', b2b ? b2b[1] + ' / ' + b2b[2] : null, stats.tracks['B2B SaaS'].n + ' / ' + stats.tracks['Consumer & e-commerce'].n, b2b && +b2b[1] === stats.tracks['B2B SaaS'].n && +b2b[2] === stats.tracks['Consumer & e-commerce'].n);
    const oct = /October 2026 rescan/.test(text);
    note('research page', 'October 2026 rescan referred to', oct ? 'yes' : 'no', 'no rescan records in data/', !oct, 'the page and the methodology changelog cite a rescan on 2 October 2026 (156 reachable sites); its results are not stored in the repository, so no figure here can be traced to it');
  }

  const diffs = items.filter((i) => !i.same);
  return { checked: items.length, differences: diffs.length, items: items };
}

/* ---------- build ---------- */

function build() {
  const data = load();
  const allSites = [].concat.apply([], data.cats.map((c) => c.ok));
  const stats = { meta: {}, access: {}, overall: {}, categories: {}, tracks: {}, checks: {}, categoryDifferences: {}, reconciliation: {} };

  const dates = {};
  data.cats.forEach((c) => { dates[c.meta.category] = c.summary.scannedAt; });
  const dateList = Object.keys(dates).map((k) => dates[k]).sort();
  const lists = {};
  data.cats.forEach((c) => {
    const f = path.join(ROOT, 'domains', c.meta.category + '.txt');
    lists[c.meta.category] = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && l[0] !== '#').length : null;
  });

  stats.meta = {
    schema: 1,
    sources: ['data/benchmarks.json'].concat(data.cats.map((c) => 'data/' + c.meta.category + '-raw.json'), data.cats.map((c) => 'data/' + c.meta.category + '-summary.json'), ['research/crawler-access-2026.html']),
    scanDates: dates,
    scanWindow: { from: dateList[0], to: dateList[dateList.length - 1] },
    scoring: { checks: allSites[0].result.checks.length, pillarMax: PILLAR_MAX, pointsMax: 100, trackedCrawlers: allSites[0].botResults.map((b) => b.name) },
    selection: 'hand-picked, well-known sites listed in domains/<category>.txt; one scan per site, homepage only; sites that could not be scored are excluded from every figure',
    listedDomains: lists,
    quartileMethod: 'linear interpolation (R type 7)',
    reportableMinN: MIN_N,
    failedCheckDefinition: 'pts below the check maximum',
    namesNoSites: true
  };

  const attempted = sum(data.cats.map((c) => c.raw.length));
  const robotsUnreachable = sum(data.cats.map((c) => c.failed.filter((f) => /robots\.txt/.test(f.error || '')).length));
  const homepageUnreadable = sum(data.cats.map((c) => c.failed.filter((f) => /homepage could not be read/.test(f.error || '')).length));
  const otherFail = sum(data.cats.map((c) => c.failed.length)) - robotsUnreachable - homepageUnreadable;
  stats.access = {
    attempted: attempted,
    scored: allSites.length,
    notScored: attempted - allSites.length,
    notScoredShare: count(attempted - allSites.length, attempted),
    robotsUnreachable: count(robotsUnreachable, attempted),
    homepageUnreadable: count(homepageUnreadable, attempted),
    otherFailure: otherFail,
    wafClassNote: 'The stored records keep the scanner message, not the HTTP status. "robots.txt unreachable" is every non-404 failure to read robots.txt (403 and 429 from a WAF, other 4xx and 5xx, timeouts, connection errors), so the WAF/403 class cannot be separated from the others in this data. It is an upper bound for that class.',
    byCategory: {}
  };
  data.cats.forEach((c) => {
    stats.access.byCategory[c.meta.category] = {
      attempted: c.raw.length,
      scored: c.ok.length,
      notScored: c.failed.length,
      notScoredShare: count(c.failed.length, c.raw.length),
      robotsUnreachable: c.failed.filter((f) => /robots\.txt/.test(f.error || '')).length,
      homepageUnreadable: c.failed.filter((f) => /homepage could not be read/.test(f.error || '')).length
    };
  });

  stats.overall = group(allSites);
  const rows = checkRows(allSites);
  const metaFail = allSites.filter((d) => d.result.checks.some((c) => c.label === 'Meta description' && c.pts < c.max));
  const metaCut = metaFail.filter((d) => d.siteInfo && typeof d.siteInfo.metaDesc === 'string' && d.siteInfo.metaDesc.length >= 1 && d.siteInfo.metaDesc.length <= 49);
  stats.checks = {
    rankedByFailure: rankChecks(rows),
    metaDescriptionParserCaveat: {
      failedMetaDescription: metaFail.length,
      failedWithOneTo49CharactersCaptured: metaCut.length,
      upperBoundOnFalseFailures: metaCut.length,
      methodologyChangelogSays: 'up to 7 of 219 (2026-10-03); the published benchmark data stays at the original scans',
      meanScoreEffectUpperBound: round((metaCut.length * 4) / allSites.length, 2)
    },
    crawlerAccess: rows.filter((r) => r.label === 'AI crawler access')[0],
    note: 'AI crawler access is listed apart: any applicable Disallow rule, usually an ordinary path, already scores below maximum.',
    totalPointsAvailableToAdd: round(mean(allSites.map((d) => 100 - d.result.total)), 2)
  };

  data.cats.forEach((c) => {
    const g = group(c.ok);
    g.label = c.meta.label;
    g.track = c.meta.track;
    g.scannedOn = c.summary.scannedAt;
    g.topFailedChecks = rankChecks(checkRows(c.ok)).slice(0, 5).map((r) => ({ label: r.label, failRatePct: r.failRatePct, avgPointsAddedByFix: r.avgPointsAddedByFix }));
    g.checkFailRates = Object.fromEntries(rankChecks(checkRows(c.ok)).map((r) => [r.label, r.failRatePct]));
    stats.categories[c.meta.category] = g;
  });

  const tracks = {};
  data.cats.forEach((c) => { (tracks[c.meta.track] = tracks[c.meta.track] || []).push(c); });
  Object.keys(tracks).sort().forEach((t) => {
    const sites = [].concat.apply([], tracks[t].map((c) => c.ok));
    const g = group(sites);
    g.categories = tracks[t].map((c) => c.meta.category).sort();
    stats.tracks[t] = g;
  });

  // how the categories differ
  const cat = stats.categories;
  const keys = Object.keys(cat).filter((k) => cat[k].reportable);
  const byMean = keys.slice().sort((a, b) => cat[b].score.mean - cat[a].score.mean || (a < b ? -1 : 1));
  const checkLabels = stats.checks.rankedByFailure.map((r) => r.label);
  const spread = checkLabels.map((l) => {
    const rates = keys.map((k) => ({ category: k, rate: cat[k].checkFailRates[l] }));
    const hi = rates.slice().sort((a, b) => b.rate - a.rate || (a.category < b.category ? -1 : 1))[0];
    const lo = rates.slice().sort((a, b) => a.rate - b.rate || (a.category < b.category ? -1 : 1))[0];
    return { label: l, highest: hi, lowest: lo, rangePoints: round(hi.rate - lo.rate, 1) };
  }).sort((a, b) => b.rangePoints - a.rangePoints || (a.label < b.label ? -1 : 1));
  const tr = stats.tracks;
  stats.categoryDifferences = {
    reportableCategories: keys.length,
    notReportable: Object.keys(cat).filter((k) => !cat[k].reportable),
    rankedByMeanScore: byMean.map((k) => ({ category: k, mean: cat[k].score.mean, median: cat[k].score.median, n: cat[k].n })),
    meanScoreRange: { high: cat[byMean[0]].score.mean, low: cat[byMean[byMean.length - 1]].score.mean, points: round(cat[byMean[0]].score.mean - cat[byMean[byMean.length - 1]].score.mean, 2) },
    trackMeanDifference: { track: Object.keys(tr), means: Object.keys(tr).map((t) => tr[t].score.mean), points: round(Math.abs(tr[Object.keys(tr)[0]].score.mean - tr[Object.keys(tr)[1]].score.mean), 2) },
    pillarMeanSpread: Object.fromEntries(PILLARS.map((p) => {
      const v = keys.map((k) => cat[k].pillarMeans[p].mean);
      return [p, { high: Math.max.apply(null, v), low: Math.min.apply(null, v), points: round(Math.max.apply(null, v) - Math.min.apply(null, v), 2), of: PILLAR_MAX[p] }];
    })),
    checksWithWidestCategorySpread: spread.slice(0, 5),
    restrictedCrawlerShareRange: {
      blockingAtLeastOnePct: { high: Math.max.apply(null, keys.map((k) => cat[k].crawlers.sitesBlockingAtLeastOne.pct)), low: Math.min.apply(null, keys.map((k) => cat[k].crawlers.sitesBlockingAtLeastOne.pct)) }
    }
  };

  stats.reconciliation = reconcile(data, stats);
  return stats;
}

function main() {
  const check = process.argv.indexOf('--check') !== -1;
  let stats;
  try { stats = build(); } catch (e) { console.error(e.message); process.exit(1); }
  const text = JSON.stringify(stats, null, 2) + '\n';
  if (check) {
    const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
    if (now !== text) { console.error('local/launch-report/stats.json is missing or out of date; run node scripts/launch-report-stats.js'); process.exit(1); }
    console.log('OK: stats.json equals what the stored data gives (' + stats.overall.n + ' sites).');
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log('Wrote local/launch-report/stats.json: ' + stats.overall.n + ' scored of ' + stats.access.attempted + ' attempted; ' + stats.reconciliation.differences + ' of ' + stats.reconciliation.checked + ' reconciliation items differ.');
}

if (require.main === module) main();
module.exports = { build: build };
