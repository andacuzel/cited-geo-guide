#!/usr/bin/env node
/* =====================================================================
   scripts/test-facts.js

   Tests lib/report-facts.js. Every derived number is recomputed from the raw
   per-page results by a separate code path (verify() below) and compared; the
   gain simulation is compared with a real lib/scanner.js rescore for three
   checks; planted errors must make verify() report problems.

     node scripts/test-facts.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const F = require('../lib/report-facts.js');
const scanner = require('../lib/scanner.js');
const schema = require('../lib/schema.js');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; const fails = [];
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); console.log((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const clean = (l) => l.replace(/\s*\(\d+\/\d+ open\)\s*$/, '');
const siteLevel = (l) => /^(robots\.txt present|llms\.txt present|Sitemap declared|AI crawler access)/.test(l);

// A second implementation, written differently on purpose: totals-based rescoring instead of per-check sums.
function verify(data, f) {
  const problems = []; const bad = (m) => problems.push(m);
  const ok = data.pages.filter((p) => p.status === 'ok');
  const n = ok.length;
  const totals = ok.map((p) => p.result.total);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  if (f.coverage.pagesRead !== n) bad('pagesRead');
  if (f.coverage.pagesFailed !== data.pages.filter((p) => p.status === 'failed').length) bad('pagesFailed');
  if (f.coverage.cap !== 50) bad('cap');
  if (f.coverage.sampled !== (data.pages.length >= 50)) bad('sampled');
  if (f.verdict.siteWide !== Math.round(mean(totals))) bad('siteWide');
  if (f.verdict.homepage !== ok.filter((p) => p.url === data.pages[0].url)[0].result.total) bad('homepage');
  if (f.verdict.gap !== f.verdict.siteWide - f.verdict.homepage) bad('gap');
  const withFail = ok.filter((p) => p.result.checks.some((c) => !c.ok && !siteLevel(c.label))).length;
  if (f.verdict.pagesWithAFailure !== withFail) bad('pagesWithAFailure');
  if (f.verdict.benchmark) {
    let tot = 0, w = 0;
    JSON.parse(fs.readFileSync(path.join(ROOT, 'data/benchmarks.json'), 'utf8')).forEach((e) => { const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/' + e.category + '-summary.json'), 'utf8')); tot += s.scanned; w += s.score.average * s.scanned; });
    if (f.verdict.benchmark.average !== Math.round(w / tot) || f.verdict.benchmark.sites !== tot) bad('benchmark');
    if (f.verdict.vsBenchmark !== f.verdict.siteWide - f.verdict.benchmark.average) bad('vsBenchmark');
  }
  const labels = Array.from(new Set(ok.reduce((a, p) => a.concat(p.result.checks.map((c) => clean(c.label))), [])));
  if (f.checks.length !== labels.length) bad('check count');
  labels.forEach((label) => {
    const c = f.checks.filter((x) => x.label === label)[0];
    if (!c) { bad('missing check ' + label); return; }
    const failingPages = ok.filter((p) => p.result.checks.some((x) => clean(x.label) === label && !x.ok));
    if (c.failingPages !== failingPages.length) bad(label + ': failingPages');
    if (c.failingShare !== Math.round(failingPages.length / n * 100) / 100) bad(label + ': failingShare');
    const hp = data.pages[0].result.checks.filter((x) => clean(x.label) === label)[0];
    if (c.passesOnHomepage !== !!hp.ok) bad(label + ': passesOnHomepage');
    if (c.likelyShared !== (!siteLevel(label) && failingPages.length > 0 && failingPages.length / n >= 0.8)) bad(label + ': likelyShared');
    // Rescore: every failing page's total rises by that check's missing points; compare the new mean with the old one.
    const after = ok.map((p) => { const x = p.result.checks.filter((y) => clean(y.label) === label)[0]; return p.result.total + (x.ok ? 0 : x.max - x.pts); });
    const gain = Math.round((mean(after) - mean(totals)) * 10) / 10;
    if (c.gainIfFixedEverywhere !== gain) bad(label + ': gain ' + c.gainIfFixedEverywhere + ' vs ' + gain);
    if (JSON.stringify(c.pages.slice().sort()) !== JSON.stringify(failingPages.map((p) => p.url).sort())) bad(label + ': pages list');
    if (!c.effort || !c.effort.typical || !F.EFFORT[c.effort.key]) bad(label + ': effort');
  });
  // sorted by pages affected
  for (let i = 1; i < f.checks.length; i++) if (f.checks[i].failingPages > f.checks[i - 1].failingPages) bad('checks not sorted');
  // clusters
  const g = {};
  ok.forEach((p) => { const seg = new URL(p.url).pathname.split('/').filter(Boolean)[0]; const key = '/' + (seg || '') + '|' + p.result.checks.filter((c) => !c.ok && !siteLevel(c.label)).map((c) => clean(c.label)).sort().join(';'); (g[key] = g[key] || []).push(p); });
  const all = Object.keys(g).map((k) => ({ k: k, n: g[k].length, avg: Math.round(mean(g[k].map((p) => p.result.total))) })).sort((a, b) => b.n - a.n || a.avg - b.avg || (a.k < b.k ? -1 : 1));
  if (f.clusters.length !== Math.min(5, all.length)) bad('cluster count');
  f.clusters.forEach((c, i) => { if (c.pages !== all[i].n || c.avgScore !== all[i].avg) bad('cluster ' + i + ' ' + c.pages + '/' + c.avgScore + ' vs ' + all[i].n + '/' + all[i].avg); });
  if (f.clustersAll.reduce((s, c) => s + c.pages, 0) !== n) bad('clusters do not cover every page');
  // priorities
  const anyBlocked = (data.siteContext.botResults || []).some((b) => b.state === 'block');
  const eff = (label) => F.EFFORT[F.EFFORT_BY_CHECK[label] || 'page-copy'].weight;
  const rank = f.checks.filter((c) => c.gainIfFixedEverywhere > 0 && !(c.label === 'AI crawler access' && !anyBlocked)).map((c) => ({ l: c.label, s: c.gainIfFixedEverywhere / eff(c.label), p: c.failingPages })).sort((a, b) => b.s - a.s || b.p - a.p || (a.l < b.l ? -1 : 1)).slice(0, 3);
  if (JSON.stringify(f.priorities.map((p) => p.label)) !== JSON.stringify(rank.map((r) => r.l))) bad('priorities ' + f.priorities.map((p) => p.label) + ' vs ' + rank.map((r) => r.l));
  f.priorities.forEach((p) => { const c = f.checks.filter((x) => x.label === p.label)[0]; if (p.gain !== c.gainIfFixedEverywhere || p.failingPages !== c.failingPages || p.of !== n) bad('priority facts ' + p.label); });
  // working
  const everywhere = f.checks.filter((c) => c.failingPages === 0).map((c) => c.label).sort();
  if (JSON.stringify(f.working.slice().sort()) !== JSON.stringify(everywhere)) bad('working');
  // fixes: unique snippets, and each lists exactly the pages that need it
  const codes = f.fixes.map((x) => x.kind + '\n' + x.code);
  if (new Set(codes).size !== codes.length) bad('a snippet appears twice');
  f.fixes.filter((x) => x.kind === 'organization').forEach((x) => {
    const need = ok.filter((p) => p.result.checks.some((c) => c.label === 'Organization / WebSite schema' && !c.ok)).map((p) => p.url).sort();
    if (JSON.stringify(x.pages.slice().sort()) !== JSON.stringify(need)) bad('organization snippet pages');
  });
  return problems;
}

function run(name, data) {
  console.log(name);
  const f = F.facts(data, { schema: schema });
  const problems = verify(data, f);
  t('every derived number equals a separate recomputation', problems.length === 0, problems.join('; '));
  const prose = []; (function walk(v, k) { if (Array.isArray(v)) v.forEach((x) => walk(x, k)); else if (v && typeof v === 'object') Object.keys(v).forEach((kk) => walk(v[kk], kk)); else if (typeof v === 'string' && k !== 'code' && (/[.!?]$/.test(v) || v.split(/\s+/).length > 7)) prose.push(k + ': ' + v); }(f, ''));
  t('no prose in the facts object (no sentences, only labels and tokens)', prose.length === 0, prose.slice(0, 3).join(' | '));
  t('likelyShared only where the share is at least 80%', f.checks.every((c) => c.likelyShared === (!c.siteLevel && c.failingShare >= 0.8 && c.failingPages > 0)));
  t('three priorities at most, each with gain and effort', f.priorities.length <= 3 && f.priorities.every((p) => typeof p.gain === 'number' && p.effort));
  t('the benchmark average comes from data/*-summary.json', !!f.verdict.benchmark);
  return f;
}

const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/pro/sample-report.json'), 'utf8'));
const demo = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/pro/demo-fixture.json'), 'utf8'));
sample.benchmark = demo.benchmark = F.benchmarkFromData(path.join(ROOT, 'data'));
const fs1 = run('sample report', sample);
run('demo fixture', demo);

// --- the gain simulation against a real rescore with lib/scanner.js ---
console.log('real rescore (lib/scanner.js scoreAll)');
const HEAD = '<html lang="en"><head><title>A page title that is long enough</title>';
const DESC = '<meta name="description" content="A description that is comfortably between fifty and one hundred seventy characters long.">';
const variants = [
  { canonical: false, desc: false, h1: 1 }, { canonical: false, desc: true, h1: 2 }, { canonical: true, desc: false, h1: 0 },
  { canonical: true, desc: true, h1: 1 }, { canonical: false, desc: false, h1: 2 }, { canonical: true, desc: false, h1: 1 }
];
const html = (v, fix) => HEAD + (v.desc || fix === 'desc' ? DESC : '') + ((v.canonical || fix === 'canonical') ? '<link rel="canonical" href="https://x.test/">' : '') +
  '</head><body>' + new Array(fix === 'h1' ? 1 : v.h1).fill('<h1>H</h1>').join('') + '<h2>a</h2><h2>b</h2><a href="/contact">c</a></body></html>';
const score = (v, fix) => scanner.scoreAll(true, true, true, [], scanner.parseSignals(html(v, fix)));
const synthetic = { domain: 'x.test', pages: variants.map((v, i) => ({ url: 'https://x.test/p' + i, status: 'ok', result: score(v), siteInfo: { title: 'T', metaDesc: '', lang: 'en' } })), siteContext: { botResults: [] }, summary: {} };
const sf = F.facts(synthetic, { schema: schema });
[['Meta description', 'desc'], ['Canonical tag', 'canonical'], ['Single H1 heading', 'h1']].forEach(([label, fix]) => {
  const real = variants.reduce((s, v) => s + (score(v, fix).total - score(v).total), 0) / variants.length;
  const sim = sf.checks.filter((c) => c.label === label)[0].gainIfFixedEverywhere;
  t(label + ': simulated gain ' + sim + ' equals a real rescore (' + (Math.round(real * 10) / 10) + ')', sim === Math.round(real * 10) / 10 && sim > 0, sim + ' vs ' + real);
});
t('the synthetic crawl also verifies', verify(synthetic, sf).length === 0, verify(synthetic, sf).join('; '));

// --- planted errors must fail ---
console.log('planted errors');
const clone = () => JSON.parse(JSON.stringify(fs1));
const plant = (name, mutate) => { const f = clone(); mutate(f); t('planted: ' + name + ' is caught', verify(sample, f).length > 0); };
plant('a wrong failing-page count', (f) => { f.checks[0].failingPages += 1; });
plant('a wrong gain', (f) => { f.checks[1].gainIfFixedEverywhere += 0.4; });
plant('a wrong homepage score', (f) => { f.verdict.homepage -= 1; });
plant('a wrong cluster size', (f) => { f.clusters[0].pages += 1; });
plant('a wrong priority order', (f) => { f.priorities.reverse(); });
plant('a duplicated snippet', (f) => { f.fixes.push(JSON.parse(JSON.stringify(f.fixes[0]))); });
plant('likelyShared flipped', (f) => { const c = f.checks.filter((x) => x.failingPages > 0)[0]; c.likelyShared = !c.likelyShared; });
plant('a wrong benchmark average', (f) => { f.verdict.benchmark.average += 1; });

console.log('\n' + pass + ' passed' + (fails.length ? ', ' + fails.length + ' failed' : ''));
if (fails.length) { console.error('\n' + fails.join('\n')); process.exit(1); }
