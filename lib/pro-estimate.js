/* =====================================================================
   lib/pro-estimate.js: "Estimated score if you apply these fixes".

   Every number here comes from lib/scanner.js scoreAll(), run again with a fix
   applied hypothetically. Nothing is typed, and no weight is copied.

   A page's score depends only on a few facts about it (does it have a canonical
   tag, how long is its title, how many H2s ...). Those facts are rebuilt from the
   checks stored with the page (sigFromChecks), which reproduces the stored score
   exactly (scripts/test-pro-estimate.js proves it on every page of the frozen
   sample). A fix then changes those facts on every page where its check fails,
   and the whole site is scored again.

   The list is built greedily: at each step the fix that adds the most points on top
   of the fixes already chosen goes next (ties broken alphabetically), so the rows
   run from the biggest gain to the smallest and their gains add up to the total.
   A fix that adds nothing once the earlier ones are applied is left out.

   Node only (it requires the scanner). The renderer receives the result as data.
   ===================================================================== */

'use strict';

const scanner = require('./scanner.js');

function clean(label) { return String(label).replace(/\s*\(\d+\s*\/\s*\d+\s+open\)\s*$/i, '').trim(); }

// The smallest set of page facts that scoreAll reads, rebuilt from a stored result.
function sigFromChecks(checks) {
  const ok = {};
  checks.forEach(function (c) { ok[clean(c.label)] = !!c.ok; });
  return {
    title: ok['Page title'] ? 'A title of a length that passes' : '',
    metaDesc: ok['Meta description'] ? new Array(61).join('d') : '',
    canonical: !!ok['Canonical tag'],
    lang: ok['html lang attribute'] ? 'en' : '',
    ogOk: !!ok['Open Graph tags'],
    schemaTypes: ok['Structured data (JSON-LD)'] ? ['Thing'] : [],
    hasOrgSchema: !!ok['Organization / WebSite schema'],
    hasContentSchema: !!ok['Content schema (Article, FAQ…)'],
    h1Count: ok['Single H1 heading'] ? 1 : 0,
    h2Count: ok['Subheading structure (H2)'] ? 2 : 0,
    authorSignal: !!ok['Author / about signals'],
    contactSignal: !!ok['Contact signals']
  };
}

// What each fix changes. `site` fixes change the shared facts, `page` fixes change one page's facts.
const FIXES = [
  { check: 'robots.txt present', scope: 'site', apply: function (st) { st.robotsOk = true; } },
  { check: 'llms.txt present', scope: 'site', apply: function (st) { st.llmsOk = true; } },
  { check: 'Sitemap declared', scope: 'site', apply: function (st) { st.sitemapOk = true; } },
  { check: 'AI crawler access', scope: 'site', apply: function (st) { st.botResults = st.botResults.map(function (b) { return Object.assign({}, b, { state: 'open' }); }); } },
  { check: 'Canonical tag', scope: 'page', apply: function (sig) { sig.canonical = true; } },
  { check: 'html lang attribute', scope: 'page', apply: function (sig) { sig.lang = 'en'; } },
  { check: 'Page title', scope: 'page', apply: function (sig) { sig.title = 'A title of a length that passes'; } },
  { check: 'Meta description', scope: 'page', apply: function (sig) { sig.metaDesc = new Array(61).join('d'); } },
  { check: 'Open Graph tags', scope: 'page', apply: function (sig) { sig.ogOk = true; } },
  { check: 'Structured data (JSON-LD)', scope: 'page', apply: function (sig) { if (!sig.schemaTypes.length) sig.schemaTypes = ['Thing']; } },
  { check: 'Single H1 heading', scope: 'page', apply: function (sig) { sig.h1Count = 1; } },
  { check: 'Subheading structure (H2)', scope: 'page', apply: function (sig) { sig.h2Count = Math.max(sig.h2Count, 2); } },
  // Adding Organization markup is adding JSON-LD, so it also satisfies "Structured data (JSON-LD)" on that page.
  { check: 'Organization / WebSite schema', scope: 'page', apply: function (sig) { sig.hasOrgSchema = true; if (sig.schemaTypes.indexOf('Organization') === -1) sig.schemaTypes = sig.schemaTypes.concat(['Organization']); } },
  { check: 'Content schema (Article, FAQ…)', scope: 'page', apply: function (sig) { sig.hasContentSchema = true; if (sig.schemaTypes.indexOf('Article') === -1) sig.schemaTypes = sig.schemaTypes.concat(['Article']); } },
  { check: 'Author / about signals', scope: 'page', apply: function (sig) { sig.authorSignal = true; } },
  { check: 'Contact signals', scope: 'page', apply: function (sig) { sig.contactSignal = true; } }
];

function mean(xs) { return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length : 0; }

// The state of the whole site as scoreAll sees it, rebuilt from a crawl result.
function stateOf(data) {
  const ok = (data.pages || []).filter(function (p) { return p.status === 'ok' && p.result; });
  const first = ok[0];
  const find = function (label) { return first ? first.result.checks.filter(function (c) { return clean(c.label) === label; })[0] : null; };
  const ctx = data.siteContext || {};
  return {
    robotsOk: ctx.robotsOk !== undefined ? !!ctx.robotsOk : !!(find('robots.txt present') || {}).ok,
    llmsOk: ctx.llmsOk !== undefined ? !!ctx.llmsOk : !!(find('llms.txt present') || {}).ok,
    sitemapOk: ctx.sitemapOk !== undefined ? !!ctx.sitemapOk : !!(find('Sitemap declared') || {}).ok,
    botResults: (ctx.botResults || []).map(function (b) { return { name: b.name, desc: b.desc, state: b.state, rule: b.rule }; }),
    sigs: ok.map(function (p) { return sigFromChecks(p.result.checks); }),
    urls: ok.map(function (p) { return p.url; }),
    stored: ok.map(function (p) { return p.result; })
  };
}

function scoreState(st) {
  const totals = st.sigs.map(function (sig) { return scanner.scoreAll(st.robotsOk, st.llmsOk, st.sitemapOk, st.botResults, sig); });
  return { avg: mean(totals.map(function (r) { return r.total; })), results: totals };
}

function clone(st) { return { robotsOk: st.robotsOk, llmsOk: st.llmsOk, sitemapOk: st.sitemapOk, botResults: st.botResults.map(function (b) { return Object.assign({}, b); }), sigs: st.sigs.map(function (s) { return Object.assign({}, s, { schemaTypes: s.schemaTypes.slice() }); }), urls: st.urls, stored: st.stored }; }

// Applies one fix to a state; returns how many pages it touched (0 when it changes nothing).
function applyFix(st, fix, before) {
  let touched = 0;
  if (fix.scope === 'site') {
    const was = JSON.stringify([st.robotsOk, st.llmsOk, st.sitemapOk, st.botResults]);
    fix.apply(st);
    if (JSON.stringify([st.robotsOk, st.llmsOk, st.sitemapOk, st.botResults]) !== was) touched = st.sigs.length;
    return touched;
  }
  st.sigs.forEach(function (sig, i) {
    const failing = before.results[i].checks.some(function (c) { return clean(c.label) === fix.check && !c.ok; });
    if (failing) { fix.apply(sig); touched++; }
  });
  return touched;
}

// Whole numbers of tenths, so rounded gains add up exactly to the rounded total.
function tenths(x) { return Math.round(x * 10); }

/* data: a crawl result { pages, siteContext }. Returns
   { now, final, steps: [{ check, scope, pages, gain, total }], baselineMatches } */
function estimate(data, opts) {
  opts = opts || {};
  const st0 = stateOf(data);
  if (!st0.sigs.length) return { now: null, final: null, steps: [], baselineMatches: true };
  const base = scoreState(st0);
  const storedAvg = mean(st0.stored.map(function (r) { return r.total; }));
  const baselineMatches = base.results.every(function (r, i) { return r.total === st0.stored[i].total; });

  // Which fixes are on the table: the check fails somewhere. Crawler access only when a crawler is blocked outright.
  const anyBlocked = st0.botResults.some(function (b) { return b.state === 'block'; });
  const candidates = FIXES.filter(function (fx) {
    if (fx.check === 'AI crawler access' && !anyBlocked) return false;
    return base.results.some(function (r) { return r.checks.some(function (c) { return clean(c.label) === fx.check && (!c.ok || c.pts < c.max); }); });
  });

  const applied = []; let state = clone(st0); let current = base;
  const steps = []; const remaining = candidates.slice();
  while (remaining.length) {
    let best = null;
    remaining.forEach(function (fx) {
      const trial = clone(state);
      const touched = applyFix(trial, fx, current);
      if (!touched) return;
      const sc = scoreState(trial);
      const gain = sc.avg - current.avg;
      if (gain <= 1e-9) return;
      if (!best || gain > best.gain + 1e-9 || (Math.abs(gain - best.gain) <= 1e-9 && fx.check < best.fx.check)) best = { fx: fx, trial: trial, sc: sc, gain: gain, touched: touched };
    });
    if (!best) break;
    steps.push({ check: best.fx.check, scope: best.fx.scope, pages: best.touched, exact: best.sc.avg, gainExact: best.gain });
    state = best.trial; current = best.sc;
    remaining.splice(remaining.indexOf(best.fx), 1);
  }

  // Display numbers: one decimal, additive.
  let prevTenths = tenths(base.avg);
  const out = steps.map(function (s) {
    const tt = tenths(s.exact);
    const row = { check: s.check, scope: s.scope, pages: s.pages, gain: (tt - prevTenths) / 10, total: tt / 10 };
    prevTenths = tt;
    return row;
  });
  return { now: tenths(base.avg) / 10, nowRounded: Math.round(base.avg), storedAverage: storedAvg, final: prevTenths / 10, finalRounded: Math.round(prevTenths / 10), steps: out, pagesScored: st0.sigs.length, baselineMatches: baselineMatches };
}

module.exports = { estimate: estimate, sigFromChecks: sigFromChecks, stateOf: stateOf, scoreState: scoreState, FIXES: FIXES, applyFix: applyFix, clone: clone, clean: clean };
