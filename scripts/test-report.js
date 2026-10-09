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
const Facts = require('../lib/report-facts.js');

const ROOT = path.resolve(__dirname, '..');
const SITE_LEVEL = ['robots.txt present', 'llms.txt present', 'Sitemap declared', 'AI crawler access'];
const siteLevel = (l) => SITE_LEVEL.some((s) => l.indexOf(s) === 0);
let pass = 0; const fails = [];
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); console.log((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const decode = (x) => x.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
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
  const gainOf = {}; ok.forEach((p) => p.result.checks.forEach((c) => { if (!siteLevel(c.label)) gainOf[c.label] = (gainOf[c.label] || 0) + (c.max - c.pts); }));
  const checkFails = Object.keys(agg).filter((k) => agg[k].f > 0).map((k) => ({ label: k, f: agg[k].f, g: Math.round(gainOf[k] / ok.length * 10) / 10 })).sort((a, b) => b.f - a.f || b.g - a.g || (a.label < b.label ? -1 : 1));
  const checkGains = checkFails.map((x) => String(x.g)); const checkFailsN = checkFails.map((x) => String(x.f));
  const others = ok.slice(1);
  const hidden = [];
  if (home !== null) pages[0].result.checks.forEach((hc) => {
    if (!hc.ok || siteLevel(hc.label)) return;
    const n = others.filter((p) => p.result.checks.some((c) => c.label === hc.label && !c.ok)).length;
    if (others.length && n / others.length > 0.5) hidden.push({ label: hc.label, n: n });
  });
  hidden.sort((a, b) => b.n - a.n || (a.label < b.label ? -1 : 1));
  return { ok: ok.length, failed: pages.filter((p) => p.status === 'failed').length, home: home, avg: avg, gap: home === null ? null : avg - home, rows: rows, checkFails: checkFailsN, checkGains: checkGains, hidden: hidden,
    pillar: { discover: mean(ok.map((p) => p.result.discover)), tech: mean(ok.map((p) => p.result.tech)), trust: mean(ok.map((p) => p.result.trust)) } };
}

function ok_failing(data) { return data.pages.filter((p) => p.status === 'ok' && p.result.checks.some((c) => !c.ok && !siteLevel(c.label))).length; }

function verify(name, data) {
  console.log(name + ' (' + data.domain + ')');
  data = Object.assign({}, data, { benchmark: Facts.benchmarkFromData(path.join(ROOT, 'data')) });
  const html = render.render(data, { schema: schema });
  const e = expected(data);
  const s = data.summary;
  t('summary in the file agrees with its pages (average, homepage, gap)', s.average === e.avg && s.homepageOnlyScore === e.home && s.siteVsHomepageDelta === e.gap, JSON.stringify([s.average, e.avg, s.homepageOnlyScore, e.home, s.siteVsHomepageDelta, e.gap]));
  t('summary pillar averages agree with the pages', s.averageDiscoverability === e.pillar.discover && s.averageTechnical === e.pillar.tech && s.averageTrust === e.pillar.trust);
  t('site-wide score shown equals the source', figs(html, 'avg')[0] === String(e.avg));
  t('homepage-only score shown equals the source', figs(html, 'homeScore')[0] === String(e.home));
  const gapShown = figs(html, 'gap')[0];
  t('gap shown equals the source', gapShown === (e.gap > 0 ? '+' + e.gap : String(e.gap)), gapShown);
  t('pages read and not fetched equal the source', figs(html, 'pagesRead')[0] === String(e.ok) && figs(html, 'pagesFailed')[0] === String(e.failed) && figs(html, 'failedCount')[0] === String(e.failed));
  t('three pillar scores equal the source', ['discover', 'tech', 'trust'].every((k) => figs(html, 'pillar-' + k)[0] === String(e.pillar[k])));
  t('pages are ranked worst first with their own score and failed-check count', JSON.stringify(figs(html, 'page-score')) === JSON.stringify(e.rows.map((r) => String(r.total))) && JSON.stringify(figs(html, 'page-failed')) === JSON.stringify(e.rows.map((r) => String(r.failed))));
  t('per-check failing-page counts equal the source, sorted by pages', JSON.stringify(figs(html, 'check-failing')) === JSON.stringify(e.checkFails) && figs(html, 'check-of').every((x) => x === String(e.ok)));
  t('checks that pass on the homepage and fail on most pages equal the source', JSON.stringify(figs(html, 'hidden-failing')) === JSON.stringify(e.hidden.map((h) => String(h.n))) && figs(html, 'hidden-of').every((x) => x === String(e.ok - 1)));
  e.hidden.forEach((h) => t('"' + h.label + '" is named in that list', html.indexOf('<strong>' + h.label.replace(/&/g, '&amp;') + '</strong> passes on the homepage') !== -1));
  const panel = html.slice(html.indexOf('id="rp-checks"'), html.indexOf('id="rp-fixes"'));
  const cards = panel.slice(panel.indexOf('Checks that fail, by number of pages'), panel.indexOf('Site-level checks'));
  const siteSec = panel.slice(panel.indexOf('Site-level checks'));
  t('site-level checks are listed once, in their own section, and not counted per page', SITE_LEVEL.every((l) => cards.indexOf(l) === -1 && (siteSec.match(new RegExp('<strong>' + l.replace('.', '\\.'), 'g')) || []).length === 1));
  const failedPages = data.pages.filter((p) => p.status === 'failed');
  t('every page that could not be fetched is listed by URL', failedPages.every((p) => html.indexOf(render.shortUrl(p.url, data.domain)) !== -1));
  t('a zero count of unfetched pages is stated, never hidden', e.failed > 0 || /Pages that could not be fetched: <span data-fig="failedCount">0<\/span>/.test(html));
  t('every page has a list item with its detail block', (html.match(/<li class="rp-item/g) || []).length === e.ok && (html.match(/<div class="rp-detail">/g) || []).length === e.ok);
  t('the Organization JSON-LD fix is offered where that check fails', data.pages.filter((p) => p.status === 'ok' && p.result.checks.some((c) => c.label === 'Organization / WebSite schema' && !c.ok)).length === (html.match(/Copy-paste fix: Organization and WebSite JSON-LD/g) || []).length);
  // ---- the new components ----
  const facts = Facts.facts(data, { schema: schema });
  t('KPI tiles: pages with a failure equals the source', figs(html, 'kpi-failing')[0] === String(ok_failing(data)));
  t('KPI tiles: the four tiles are there with their numerals', (html.match(/class="rp-kpi__num"/g) || []).length === 4);
  const exec = (html.match(/<article class="rp-exec"[\s\S]*?<\/article>/) || [''])[0];
  t('executive summary card comes first in Summary and carries its label', html.indexOf('rp-exec') < html.indexOf('rp-kpis') && /Summary written by (rules from the figures below|.+ from the figures below and checked against them)/.test(exec));
  const prio = (html.match(/<li class="rp-priority">[\s\S]*?<\/li>/g) || []);
  const summ = data.executiveSummary ? data.executiveSummary.priorities : require('../lib/summary.js').deterministic(facts).priorities;
  t('top priorities: at most 3, gain chips equal the summary and the facts', prio.length === summ.length && prio.length <= 3 && JSON.stringify(figs(html, 'priority-gain')) === JSON.stringify(summ.map((p) => String(p.gain_pts))) && summ.every((p) => { const c = facts.checks.filter((x) => 'check:' + x.label === p.fact_ref)[0]; return c && c.gainIfFixedEverywhere === p.gain_pts; }));
  t('every failing check card shows the gain from the facts', JSON.stringify(figs(html, 'check-gain')) === JSON.stringify(e.checkGains));
  const clean2 = (l) => l.replace(/\s*\(\d+\/\d+ open\)$/, '');
  const cols = data.pages[0].result.checks.filter((c) => !siteLevel(c.label)).map((c) => clean2(c.label));
  const mrows = (html.match(/<tr class="rp-matrix__row">[\s\S]*?<\/tr>/g) || []);
  t('heat matrix: one row per page and one cell per page-level check', mrows.length === e.ok && mrows.every((r) => (r.match(/data-cell=/g) || []).length === cols.length), mrows.length + ' rows');
  const byPath = {}; data.pages.filter((p) => p.status === 'ok').forEach((p) => { byPath[render.shortUrl(p.url, data.domain) || '/'] = p; });
  let cellOk = true;
  mrows.forEach((r) => { const path2 = r.match(/title="([^"]*)"/)[1].replace(/&amp;/g, '&'); const p = byPath[path2]; const cells = (r.match(/data-cell="(fail|pass)"/g) || []).map((x) => x.slice(11, -1)); const want = cols.map((l) => (p.result.checks.filter((c) => clean2(c.label) === l)[0].ok ? 'pass' : 'fail')); if (cells.join() !== want.join()) cellOk = false; });
  t('heat matrix: every cell equals the source (filled = fails, hollow = passes)', cellOk);
  const colFail = cols.map((l) => data.pages.filter((p) => p.status === 'ok' && !p.result.checks.filter((c) => clean2(c.label) === l)[0].ok).length);
  t('heat matrix: the "pages failing" footer equals the source per column', JSON.stringify(figs(html, 'matrix-col-failing')) === JSON.stringify(colFail.map(String)));
  const footCells = html.split('<tfoot>')[1].split('</tfoot>')[0].match(/<td class="[^"]*">/g);
  t('heat matrix: a column that fails on every page is flagged in the footer', colFail.every((n, i) => (n === e.ok && n > 0) === (footCells[i].indexOf('rp-colfoot--all') !== -1)));
  t('heat matrix is a real table: scope headers, labelled', /<th scope="col"/.test(html) && /<th scope="row"/.test(html) && /aria-labelledby="rp-matrix-h"/.test(html));
  const groupSizes = (html.match(/<tbody class="rp-cluster" data-rows="(\d+)"/g) || []).map((x) => +x.match(/\d+/)[0]);
  t('heat matrix groups cover every page and match the clusters in the facts', groupSizes.reduce((a, b) => a + b, 0) === e.ok && JSON.stringify(groupSizes) === JSON.stringify(facts.clustersAll.map((c) => c.pages)));
  const fixArts = (html.match(/<article class="rp-fix"[\s\S]*?<\/article>/g) || []);
  t('fixes: each distinct snippet appears once, with the number of pages it applies to', fixArts.length === facts.fixes.length && JSON.stringify(figs(html, 'fix-pages')) === JSON.stringify(facts.fixes.map((x) => String(x.pages.length))) && new Set(fixArts.map((x) => x.match(/<pre class="rp-code">([\s\S]*?)<\/pre>/)[1])).size === fixArts.length);
  t('no-JS output contains all five sections, none hidden', ['summary', 'pages', 'checks', 'fixes', 'citations'].every((id) => new RegExp('<section class="rp-panel" id="rp-' + id + '" data-tab="' + id + '"[^>]*>').test(html) && !new RegExp('id="rp-' + id + '"[^>]*hidden').test(html)));
  t('no-JS output has the five section links and exactly one h1', (html.match(/data-tab-link=/g) || []).length === 5 && (html.match(/<h1/g) || []).length === 1);
  t('every control that needs JavaScript is hidden until the script runs', /class="rp-controls" hidden/.test(html) && /data-copy hidden/.test(html) && /data-action="print" hidden/.test(html));
  t('paths are cut in the middle on whole segments, with the full path in a title', (html.match(/class="rp-item__path" title="[^"]*">[^<]*</g) || []).every((m) => { const q = m.match(/title="([^"]*)">([^<]*)</); return q[2] === q[1] || (q[2].indexOf('\u2026') !== -1 && q[2].length <= 34); }));
  t('no figure is missing: every data-fig key appears', ['avg', 'homeScore', 'gap', 'pagesRead', 'pagesFailed', 'pillar-discover', 'page-score', 'check-failing', 'failedCount'].every((k) => figs(html, k).length));
}

verify('demo fixture', JSON.parse(fs.readFileSync(path.join(ROOT, 'content/pro/demo-fixture.json'), 'utf8')));
verify('sample report', JSON.parse(fs.readFileSync(path.join(ROOT, 'content/pro/sample-report.json'), 'utf8')));

// The static page is the renderer's output for the sample, and says what it is.
const page = fs.readFileSync(path.join(ROOT, 'sample-report.html'), 'utf8');
const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/pro/sample-report.json'), 'utf8'));
console.log('static page');
// The page is the Pro layout (renderPro), the one a Pro report uses; its figures are the renderer's own output for the sample.
const fresh = render.renderPro(sample, { schema: schema, estimate: require('../lib/pro-estimate.js').estimate(sample), cap: Facts.CRAWL_CAP, actions: { copy: true, print: true } });
t('sample-report.html carries every figure the renderer produces for the sample, in order', ['pr-score', 'pr-home', 'pr-pages-read', 'pr-pillar-discover', 'pr-pillar-tech', 'pr-pillar-trust', 'pr-page-score', 'pr-page-failed', 'pr-check-failing', 'pr-found-failing', 'pr-est-now', 'pr-est-final', 'pr-est-row-gain', 'pr-est-row-total'].every((k) => JSON.stringify(figs(page, k)) === JSON.stringify(figs(fresh, k)) && figs(page, k).length > 0));
t('the banner states the date and the domain of the crawl', page.indexOf(render.longDate(sample.createdAt)) !== -1 && page.indexOf('real crawl of our own site, ' + sample.domain) !== -1);

// Before and after: every figure equals the two frozen crawls.
{
  const before = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/pro/sample-before.json'), 'utf8'));
  const mean = (d) => Math.round(d.pages.filter((p) => p.status === 'ok').reduce((n, p) => n + p.result.total, 0) / d.pages.filter((p) => p.status === 'ok').length);
  const bAvg = mean(before), aAvg = mean(sample);
  console.log('before and after');
  t('before and after site-wide scores equal the two crawls', figs(page, 'ba-before')[0] === String(bAvg) && figs(page, 'ba-after')[0] === String(aAvg), figs(page, 'ba-before') + ' ' + figs(page, 'ba-after'));
  t('the change equals after minus before', figs(page, 'ba-change')[0] === (aAvg - bAvg > 0 ? '+' + (aAvg - bAvg) : String(aAvg - bAvg)));
  const cnt = (d, l) => d.pages.filter((p) => p.status === 'ok' && p.result.checks.some((c) => c.label === l && !c.ok)).length;
  const rowsBA = (page.match(/<tr><th scope="row">[^<]*<\/th><td class="rp-num"><span data-fig="ba-row-before">\d+<\/span>[\s\S]*?<\/tr>/g) || []);
  t('every before and after row equals the failing-page counts in the two crawls', rowsBA.length > 0 && rowsBA.every((r) => { const l = decode(r.match(/<th scope="row">([^<]*)</)[1]); return r.match(/data-fig="ba-row-before">(\d+)/)[1] === String(cnt(before, l)) && r.match(/data-fig="ba-row-after">(\d+)/)[1] === String(cnt(sample, l)); }));
  t('the sample carries its own executive summary, labelled', !!sample.executiveSummary && /Summary written by/.test(sample.executiveSummary.label) && !!before.executiveSummary);
}

console.log('\n' + pass + ' passed' + (fails.length ? ', ' + fails.length + ' failed' : ''));
if (fails.length) { console.error('\n' + fails.join('\n')); process.exit(1); }
