#!/usr/bin/env node
/* =====================================================================
   scripts/test-pro-estimate.js

   Tests lib/pro-estimate.js ("Estimated score if you apply these fixes").
   The estimate re-runs the real scoring function, so the tests prove that:
     - the page facts rebuilt from stored checks reproduce every stored score
       exactly, on the frozen sample, the demo fixture and a fresh crawl
     - the rows run from the biggest gain to the smallest, and add up
     - the final figure equals a second, separately written rescoring of the
       site with all the fixes applied
     - no figure is typed anywhere in the module

     node scripts/test-pro-estimate.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const E = require('../lib/pro-estimate.js');
const scanner = require('../lib/scanner.js');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; const fails = [];
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); console.log((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const load = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const clean = E.clean;

const datasets = {
  'frozen sample': load('content/pro/sample-report.json'),
  'sample before': load('content/pro/sample-before.json'),
  'demo fixture': load('content/pro/demo-fixture.json')
};

// A second, separate way to apply a fix to a site: set the fact directly.
function applyDirect(st, check) {
  const page = (f) => st.sigs.forEach(f);
  switch (check) {
    case 'robots.txt present': st.robotsOk = true; break;
    case 'llms.txt present': st.llmsOk = true; break;
    case 'Sitemap declared': st.sitemapOk = true; break;
    case 'AI crawler access': st.botResults = st.botResults.map((b) => ({ name: b.name, desc: b.desc, state: 'open', rule: b.rule })); break;
    case 'Canonical tag': page((s) => { s.canonical = true; }); break;
    case 'html lang attribute': page((s) => { s.lang = 'fr'; }); break;
    case 'Page title': page((s) => { if (!(s.title.length >= 10 && s.title.length <= 70)) s.title = 'Twenty characters!!'; }); break;
    case 'Meta description': page((s) => { if (!(s.metaDesc.length >= 50 && s.metaDesc.length <= 170)) s.metaDesc = 'm'.repeat(100); }); break;
    case 'Open Graph tags': page((s) => { s.ogOk = true; }); break;
    case 'Structured data (JSON-LD)': page((s) => { if (!s.schemaTypes.length) s.schemaTypes = ['Thing']; }); break;
    case 'Single H1 heading': page((s) => { s.h1Count = 1; }); break;
    case 'Subheading structure (H2)': page((s) => { s.h2Count = Math.max(s.h2Count, 5); }); break;
    case 'Organization / WebSite schema': page((s) => { s.hasOrgSchema = true; s.schemaTypes = s.schemaTypes.concat(['Organization']); }); break;
    case 'Content schema (Article, FAQ…)': page((s) => { s.hasContentSchema = true; s.schemaTypes = s.schemaTypes.concat(['Article']); }); break;
    case 'Author / about signals': page((s) => { s.authorSignal = true; }); break;
    case 'Contact signals': page((s) => { s.contactSignal = true; }); break;
    default: throw new Error('unknown check ' + check);
  }
}

Object.keys(datasets).forEach((name) => {
  const data = datasets[name];
  const ok = data.pages.filter((p) => p.status === 'ok' && p.result);
  const st = E.stateOf(data);
  const re = E.scoreState(st);
  const sameTotals = re.results.every((r, i) => r.total === ok[i].result.total);
  t(name + ': the rebuilt page facts reproduce every stored page score (' + ok.length + ' pages)', sameTotals, ok.filter((p, i) => re.results[i].total !== p.result.total).map((p) => p.url).slice(0, 3).join(', '));
  const sameChecks = re.results.every((r, i) => r.checks.every((c) => { const o = ok[i].result.checks.filter((x) => clean(x.label) === clean(c.label))[0]; return o && o.pts === c.pts && o.ok === c.ok; }));
  t(name + ': ... and every single check, point for point', sameChecks);

  const est = E.estimate(data);
  t(name + ': the estimate knows its baseline matches the stored scores', est.baselineMatches === true);
  t(name + ': "now" is the average of the stored page scores', Math.abs(est.now - ok.reduce((a, p) => a + p.result.total, 0) / ok.length) < 0.06);
  const gains = est.steps.map((s) => s.gain);
  t(name + ': rows run from the biggest gain to the smallest', gains.every((g, i) => i === 0 || g <= gains[i - 1] + 1e-9), gains.join(','));
  t(name + ': ties are broken alphabetically', est.steps.every((s, i) => i === 0 || s.gain !== est.steps[i - 1].gain || est.steps[i - 1].check < s.check));
  t(name + ': every gain is positive', est.steps.every((s) => s.gain > 0));
  const sum = Math.round(gains.reduce((a, b) => a + b, 0) * 10) / 10;
  t(name + ': the gains add up exactly to the change in the total', est.steps.length === 0 || Math.abs((est.now + sum) - est.final) < 1e-9, est.now + ' + ' + sum + ' vs ' + est.final);
  t(name + ': each row\'s total is the previous total plus its gain', est.steps.every((s, i) => Math.abs((i === 0 ? est.now : est.steps[i - 1].total) + s.gain - s.total) < 1e-9));
  t(name + ': the estimate never exceeds 100', est.final <= 100);

  // Independent path: every check that appears as a row, applied directly, then scored once.
  const st2 = E.stateOf(data);
  est.steps.forEach((s) => applyDirect(st2, s.check));
  const direct = E.scoreState(st2).avg;
  t(name + ': the final figure equals a separate rescoring with the same fixes applied directly', Math.abs(Math.round(direct * 10) / 10 - est.final) < 1e-9, direct + ' vs ' + est.final);

  // Each check that fails somewhere is either a row or is covered by an earlier row (and so adds nothing on top).
  const failing = new Set();
  ok.forEach((p) => p.result.checks.forEach((c) => { if (!c.ok) failing.add(clean(c.label)); }));
  const anyBlocked = (data.siteContext && data.siteContext.botResults || []).some((b) => b.state === 'block');
  const missing = Array.from(failing).filter((l) => !est.steps.some((s) => s.check === l) && !(l === 'AI crawler access' && !anyBlocked));
  const afterAll = E.stateOf(data); est.steps.forEach((s) => applyDirect(afterAll, s.check));
  const stillFailing = E.scoreState(afterAll).results.some((r) => r.checks.some((c) => missing.indexOf(clean(c.label)) !== -1 && !c.ok));
  t(name + ': a failing check left out of the rows is already fixed by an earlier row', !stillFailing, missing.join(', '));

  console.log('      ' + name + ': ' + est.now + ' -> ' + est.final + ' in ' + est.steps.length + ' rows: ' + est.steps.map((s) => s.check + ' +' + s.gain + ' (' + s.pages + ')').join('; '));
});

// A site that already scores 100 has nothing to estimate.
{
  const open = scanner.BOTS.map((b) => ({ name: b.ua, desc: b.desc, state: 'open', rule: '' }));
  const sig = { title: 'A perfectly fine title', metaDesc: 'd'.repeat(100), canonical: true, lang: 'en', ogOk: true, schemaTypes: ['Organization', 'Article'], hasOrgSchema: true, hasContentSchema: true, h1Count: 1, h2Count: 3, authorSignal: true, contactSignal: true };
  const perfect = scanner.scoreAll(true, true, true, open, sig);
  const e = E.estimate({ pages: [{ url: 'https://x.com/', status: 'ok', result: perfect }], siteContext: { robotsOk: true, llmsOk: true, sitemapOk: true, botResults: open } });
  t('a perfect site scores 100 and has no rows', perfect.total === 100 && e.steps.length === 0 && e.now === 100 && e.final === 100);

  // One fix whose gain is known from the scanner itself: a missing llms.txt costs exactly what the scanner says.
  const mk = (url) => ({ url: url, status: 'ok', result: scanner.scoreAll(true, false, true, open, sig) });
  const e2 = E.estimate({ pages: [mk('https://x.com/'), mk('https://x.com/a')], siteContext: { robotsOk: true, llmsOk: false, sitemapOk: true, botResults: open } });
  const worth = perfect.total - scanner.scoreAll(true, false, true, open, sig).total;
  t('a missing llms.txt: one row, worth exactly what the scanner gives that check', e2.steps.length === 1 && e2.steps[0].check === 'llms.txt present' && e2.steps[0].gain === worth && e2.final === 100, JSON.stringify(e2.steps));
}

// No pages read: nothing to estimate.
{
  const e = E.estimate({ pages: [{ url: 'https://x.com/', status: 'failed' }], siteContext: {} });
  t('no page read: an empty estimate, no error', e.now === null && e.steps.length === 0);
}

// The module holds no point values of its own.
{
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'pro-estimate.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const numbers = (code.match(/\b\d+\b/g) || []).filter((n) => ['0', '1', '2', '9', '10', '61'].indexOf(n) === -1);
  t('lib/pro-estimate.js has no typed weights or scores (only 0, 1, 2, 10, the 1e-9 tolerance and the length filler)', numbers.length === 0, numbers.join(','));
}

console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { console.error('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
