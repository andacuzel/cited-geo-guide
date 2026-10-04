#!/usr/bin/env node
/* =====================================================================
   scripts/test-report.js

   Renders the demo fixture and the frozen sample through lib/report-render.js,
   reads every data-fig figure back out of the markup, and compares it with the
   same figure recomputed from the source JSON by a separate code path. Also
   checks that the crawl engine's stored summary agrees with the pages.

     node scripts/test-report.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const render = require('../lib/report-render.js');
const schema = require('../lib/schema.js');

const ROOT = path.resolve(__dirname, '..');
const SITE_LEVEL = ['robots.txt present', 'llms.txt present', 'Sitemap declared', 'AI crawler access'];
const siteLevel = (l) => SITE_LEVEL.some((s) => l.indexOf(s) === 0);
let pass = 0; const fails = [];
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); console.log((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const mean = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);

function figs(html, key) {
  const re = new RegExp('data-fig="' + key + '">([^<]*)<', 'g'); const out = []; let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

function expected(data) {
  const pages = data.pages;
  const ok = pages.filter((p) => p.status === 'ok');
  const home = pages[0].status === 'ok' ? pages[0].result.total : null;
  const avg = mean(ok.map((p) => p.result.total));
  const rows = ok.map((p) => ({ total: p.result.total, failed: p.result.checks.filter((c) => !c.ok && !siteLevel(c.label)).length, url: p.url }))
    .sort((a, b) => a.total - b.total || b.failed - a.failed || (a.url < b.url ? -1 : 1));
  const agg = {};
  ok.forEach((p) => p.result.checks.forEach((c) => { if (!siteLevel(c.label)) { agg[c.label] = agg[c.label] || { f: 0 }; if (!c.ok) agg[c.label].f++; } }));
  const checkFails = Object.keys(agg).filter((k) => agg[k].f > 0).map((k) => ({ label: k, f: agg[k].f })).sort((a, b) => b.f - a.f || (a.label < b.label ? -1 : 1)).map((x) => String(x.f));
  const others = ok.slice(1);
  const hidden = [];
  if (home !== null) pages[0].result.checks.forEach((hc) => {
    if (!hc.ok || siteLevel(hc.label)) return;
    const n = others.filter((p) => p.result.checks.some((c) => c.label === hc.label && !c.ok)).length;
    if (others.length && n / others.length > 0.5) hidden.push({ label: hc.label, n: n });
  });
  hidden.sort((a, b) => b.n - a.n || (a.label < b.label ? -1 : 1));
  return { ok: ok.length, failed: pages.filter((p) => p.status === 'failed').length, home: home, avg: avg, gap: home === null ? null : avg - home, rows: rows, checkFails: checkFails, hidden: hidden,
    pillar: { discover: mean(ok.map((p) => p.result.discover)), tech: mean(ok.map((p) => p.result.tech)), trust: mean(ok.map((p) => p.result.trust)) } };
}

function verify(name, data) {
  console.log(name + ' (' + data.domain + ')');
  const html = render.render(data, { schema: schema });
  const e = expected(data);
  const s = data.summary;
  t('summary in the file agrees with its pages (average, homepage, gap)', s.average === e.avg && s.homepageOnlyScore === e.home && s.siteVsHomepageDelta === e.gap, JSON.stringify([s.average, e.avg, s.homepageOnlyScore, e.home, s.siteVsHomepageDelta, e.gap]));
  t('summary pillar averages agree with the pages', s.averageDiscoverability === e.pillar.discover && s.averageTechnical === e.pillar.tech && s.averageTrust === e.pillar.trust);
  t('site-wide score shown equals the source', figs(html, 'avg')[0] === String(e.avg));
  t('homepage-only score shown equals the source', figs(html, 'homeScore')[0] === String(e.home));
  const gapShown = figs(html, 'gap')[0];
  t('gap shown equals the source and says which way', gapShown === (e.gap > 0 ? '+' + e.gap : String(e.gap)) && new RegExp(Math.abs(e.gap) + ' points? ' + (e.gap < 0 ? 'lower' : 'higher')).test(html), gapShown);
  t('pages read and not fetched equal the source', figs(html, 'pagesRead')[0] === String(e.ok) && figs(html, 'pagesFailed')[0] === String(e.failed) && figs(html, 'failedCount')[0] === String(e.failed));
  t('three pillar scores equal the source', ['discover', 'tech', 'trust'].every((k) => figs(html, 'pillar-' + k)[0] === String(e.pillar[k])));
  t('pages are ranked worst first with their own score and failed-check count', JSON.stringify(figs(html, 'page-score')) === JSON.stringify(e.rows.map((r) => String(r.total))) && JSON.stringify(figs(html, 'page-failed')) === JSON.stringify(e.rows.map((r) => String(r.failed))));
  t('per-check failing-page counts equal the source, sorted by pages', JSON.stringify(figs(html, 'check-failing')) === JSON.stringify(e.checkFails) && figs(html, 'check-of').every((x) => x === String(e.ok)));
  t('checks that pass on the homepage and fail on most pages equal the source', JSON.stringify(figs(html, 'hidden-failing')) === JSON.stringify(e.hidden.map((h) => String(h.n))) && figs(html, 'hidden-of').every((x) => x === String(e.ok - 1)));
  e.hidden.forEach((h) => t('"' + h.label + '" is named in that list', html.indexOf('<strong>' + h.label.replace(/&/g, '&amp;') + '</strong> passes on the homepage') !== -1));
  const checksSec = html.slice(html.indexOf('id="rp-checks-h"'), html.indexOf('id="rp-hidden-h"'));
  const siteSec = html.slice(html.indexOf('id="rp-site-h"'), html.indexOf('id="rp-failed-h"'));
  t('site-level checks are listed once, in their own section, and not counted per page', SITE_LEVEL.every((l) => checksSec.indexOf(l) === -1 && (siteSec.match(new RegExp('<strong>' + l.replace('.', '\\.'), 'g')) || []).length === 1));
  const failedPages = data.pages.filter((p) => p.status === 'failed');
  t('every page that could not be fetched is listed by URL', failedPages.every((p) => html.indexOf(render.shortUrl(p.url, data.domain)) !== -1));
  t('a zero count of unfetched pages is stated, never hidden', e.failed > 0 || /Pages that could not be fetched: <span data-fig="failedCount">0<\/span>/.test(html));
  t('every page has a detail block with its failed checks', (html.match(/<details class="rp-page"/g) || []).length === e.ok);
  t('the Organization JSON-LD fix is offered where that check fails', data.pages.filter((p) => p.status === 'ok' && p.result.checks.some((c) => c.label === 'Organization / WebSite schema' && !c.ok)).length === (html.match(/Copy-paste fix: Organization and WebSite JSON-LD/g) || []).length);
  t('no figure is missing: every data-fig key appears', ['avg', 'homeScore', 'gap', 'pagesRead', 'pagesFailed', 'pillar-discover', 'page-score', 'check-failing', 'failedCount'].every((k) => figs(html, k).length));
}

verify('demo fixture', JSON.parse(fs.readFileSync(path.join(ROOT, 'content/pro/demo-fixture.json'), 'utf8')));
verify('sample report', JSON.parse(fs.readFileSync(path.join(ROOT, 'content/pro/sample-report.json'), 'utf8')));

// The static page is the renderer's output for the sample, and says what it is.
const page = fs.readFileSync(path.join(ROOT, 'sample-report.html'), 'utf8');
const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/pro/sample-report.json'), 'utf8'));
console.log('static page');
const fresh = render.render(sample, { schema: schema });
  t('sample-report.html carries every figure the renderer produces for the sample, in order', ['avg', 'homeScore', 'gap', 'pagesRead', 'pagesFailed', 'pillar-discover', 'pillar-tech', 'pillar-trust', 'page-score', 'page-failed', 'check-failing', 'hidden-failing'].every((k) => JSON.stringify(figs(page, k)) === JSON.stringify(figs(fresh, k)) && figs(page, k).length > 0));
t('the banner states the date and the domain of the crawl', page.indexOf(render.longDate(sample.createdAt)) !== -1 && page.indexOf('real crawl of our own site, ' + sample.domain) !== -1);

console.log('\n' + pass + ' passed' + (fails.length ? ', ' + fails.length + ' failed' : ''));
if (fails.length) { console.error('\n' + fails.join('\n')); process.exit(1); }
