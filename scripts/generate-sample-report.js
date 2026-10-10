#!/usr/bin/env node
/* =====================================================================
   scripts/generate-sample-report.js

   Writes sample-report.html (served at /sample-report) from
   content/pro/sample-report.json with lib/report-render.js, the same
   renderer the dashboard (app/report.html) uses. The JSON is a real crawl of
   our own site, frozen; nothing here is edited or improved.

     node scripts/generate-sample-report.js           write the page and the sitemap entry
     node scripts/generate-sample-report.js --check   exit 1 if the page is out of date
   ===================================================================== */

'use strict';

const siteChrome = require('./site-chrome.js');

const fs = require('fs');
const path = require('path');
const render = require('../lib/report-render.js');
const schema = require('../lib/schema.js');
const factsLib = require('../lib/report-facts.js');
const estimateLib = require('../lib/pro-estimate.js');
const citationPanel = require('../lib/citation-panel.js');

const ROOT = path.resolve(__dirname, '..');
const SITE = require('../lib/site-config.js').baseUrl;
const DATA = path.join(ROOT, 'content', 'pro', 'sample-report.json');
const PAGE = path.join(ROOT, 'sample-report.html');
const CSS_VERSION = 61;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function shellParts() {
  const about = fs.readFileSync(path.join(ROOT, 'about.html'), 'utf8');
  const grab = (re, what) => { const m = about.match(re); if (!m) throw new Error('about.html: could not find ' + what); return m[0]; };
  return {
    favicon: grab(/<link rel="icon"[^>]*>/, 'favicon'),
    fonts: grab(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com" \/>[\s\S]*?rel="stylesheet" \/>/, 'font links'),
    header: grab(/<header class="site-header">[\s\S]*?<\/header>/, 'header'),
    footerNav: grab(/<nav class="site-nav footer-links"[\s\S]*?<\/nav>/, 'footer nav')
  };
}

function build(data) {
  const a = render.analyze(data);
  const date = render.longDate(data.createdAt);
  const pages = a.ok.length;
  const title = 'Citehound — Sample report: a real crawl of our own site';
  const desc = 'A real full-site crawl of ' + data.domain + ', ' + pages + ' pages, run on ' + date + ': site-wide score, every page, the checks that fail and an estimated score.';
  if (desc.length < 120 || desc.length > 160) throw new Error('description is ' + desc.length + ' characters');
  const shell = shellParts();
  const ld = { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Sample report: a real crawl of ' + data.domain, description: desc, url: SITE + '/sample-report', dateCreated: String(data.createdAt).slice(0, 10) };

  const before = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'pro', 'sample-before.json'), 'utf8'));
  const bm = factsLib.benchmarkFromData(path.join(ROOT, 'data'));
  const fAfter = factsLib.facts(Object.assign({}, data, { benchmark: bm }), { schema: schema });
  const fBefore = factsLib.facts(Object.assign({}, before, { benchmark: bm }), { schema: schema });
  const dateBefore = render.longDate(before.createdAt);
  const change = fAfter.verdict.siteWide - fBefore.verdict.siteWide;
  const signed = (n) => (n > 0 ? '+' + n : String(n));
  const labels = Array.from(new Set(fBefore.checks.concat(fAfter.checks).filter((c) => !c.siteLevel).map((c) => c.label)));
  const find = (f, l) => f.checks.filter((c) => c.label === l)[0];
  const rowsBA = labels.map((l) => ({ l: l, b: find(fBefore, l) ? find(fBefore, l).failingPages : 0, a: find(fAfter, l) ? find(fAfter, l).failingPages : 0 })).filter((r) => r.b > 0 || r.a > 0).sort((x, y) => y.b - x.b || y.a - x.a || (x.l < y.l ? -1 : 1));
  const beforeAfter = '<section class="rp-ba" aria-labelledby="rp-ba-h">\n<h2 id="rp-ba-h" class="rp-h3 rp-ba__title">Before and after</h2>\n' +
    '<p class="rp-note">We crawled our own site twice: on ' + esc(dateBefore) + ' and on ' + esc(date) + '. Between the two we added Organization and WebSite JSON-LD to every page that lacked it, put a Contact link in every footer and turned an existing line into an H2 on six pages. We changed pages, not the scanner and not the scoring. Both crawls are published as they came out.</p>\n' +
    '<ul class="rp-kpis rp-kpis--three">\n' +
    '<li class="rp-kpi"><span class="rp-kpi__num"><span data-fig="ba-before">' + fBefore.verdict.siteWide + '</span></span><span class="rp-kpi__label">Before, site-wide<br /><small>' + esc(dateBefore) + ', ' + fBefore.coverage.pagesRead + ' pages, homepage ' + fBefore.verdict.homepage + ', gap ' + signed(fBefore.verdict.gap) + '</small></span></li>\n' +
    '<li class="rp-kpi"><span class="rp-kpi__num"><span data-fig="ba-after">' + fAfter.verdict.siteWide + '</span></span><span class="rp-kpi__label">After, site-wide<br /><small>' + esc(date) + ', ' + fAfter.coverage.pagesRead + ' pages, homepage ' + fAfter.verdict.homepage + ', gap ' + signed(fAfter.verdict.gap) + '</small></span></li>\n' +
    '<li class="rp-kpi"><span class="rp-kpi__num"><span data-fig="ba-change">' + signed(change) + '</span></span><span class="rp-kpi__label">Change<br /><small>points, site-wide average</small></span></li>\n</ul>\n' +
    '<div class="rp-matrixwrap"><table class="rp-table rp-ba__table"><caption class="rp-vh">Pages failing each check, before and after</caption><thead><tr><th scope="col">Check</th><th scope="col" class="rp-num">Before</th><th scope="col" class="rp-num">After</th></tr></thead><tbody>\n' +
    rowsBA.map((r) => '<tr><th scope="row">' + esc(r.l) + '</th><td class="rp-num"><span data-fig="ba-row-before">' + r.b + '</span> of ' + fBefore.coverage.pagesRead + '</td><td class="rp-num"><span data-fig="ba-row-after">' + r.a + '</span> of ' + fAfter.coverage.pagesRead + '</td></tr>').join('\n') + '\n</tbody></table></div>\n' +
    '<p class="rp-note">The number of pages differs because the site grew between the crawls. Pages still failing are listed in the report below. Two of them, the research report and the case study, are not ours to edit here.</p>\n</section>\n';
  const banner = '<div class="rp-sample-banner">\n        <p class="rp-kicker">Sample report</p>\n' +
    '        <p><strong>This is a real crawl of our own site, ' + esc(data.domain) + ', run on ' + esc(date) + '.</strong> ' + pages + ' pages, read 1.5 seconds apart, with robots.txt respected. We crawled it earlier on ' + esc(dateBefore) + ', fixed what that crawl found, and crawled again. Both results are below. Nothing in either has been edited or improved. The crawl engine ran from our own machine against the live pages.</p>\n      </div>\n' + beforeAfter;
  const withBm = Object.assign({}, data, { benchmark: factsLib.benchmarkFromData(path.join(ROOT, 'data')) });
  const citationSample = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'citations', 'sample-crm.json'), 'utf8'));
  // The same layout as a Pro report (lib/report-render.js renderPro), so the sample and the real thing cannot drift.
  const body = render.renderPro(withBm, { schema: schema, estimate: estimateLib.estimate(data), cap: factsLib.CRAWL_CAP, label: 'Sample report', bar: false, bannerHtml: banner, actions: { copy: true, print: true }, citation: { result: citationPanel.fromSample(citationSample), sample: true } });

  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n\n' +
    '  <title>' + esc(title) + '</title>\n  <meta name="description" content="' + esc(desc) + '" />\n' +
    '  <meta name="author" content="Citehound" />\n  <meta name="robots" content="index, follow" />\n  <link rel="canonical" href="' + SITE + '/sample-report" />\n\n' +
    '  <meta property="og:type" content="website" />\n  <meta property="og:title" content="' + esc(title) + '" />\n  <meta property="og:description" content="' + esc(desc) + '" />\n' +
    '  <meta property="og:url" content="' + SITE + '/sample-report" />\n  <meta property="og:image" content="' + SITE + '/assets/brand/og-default.png" />\n  <meta property="og:site_name" content="Citehound" />\n' +
    '  <meta name="twitter:card" content="summary_large_image" />\n  <meta name="twitter:title" content="' + esc(title) + '" />\n  <meta name="twitter:description" content="' + esc(desc) + '" />\n\n' +
    '  ' + shell.favicon + '\n\n  ' + shell.fonts + '\n\n  <link rel="stylesheet" href="styles.css?v=' + CSS_VERSION + '" />\n\n' +
    '  <script type="application/ld+json">\n' + JSON.stringify(ld, null, 2).replace(/^/gm, '  ') + '\n  </script>\n' + siteChrome.schemaBlock().replace(/^/gm, '  ') + '\n</head>\n<body>\n\n' +
    '  <a class="skip-link" href="#main">Skip to content</a>\n\n  ' + shell.header + '\n\n' +
    '  <main id="main">\n' + body.replace(/\n$/, '') + '\n' +
    '    <div class="rp-body rp-body--foot"><p class="rp-sample-foot">A Pro report is this for your site. <a href="/pro">About Pro</a> &middot; <a href="/">Run the free scan first</a></p></div>\n\n    <footer class="site-footer" aria-label="Footer">\n      <div class="section__inner">\n        ' + shell.footerNav.replace(/\n/g, '\n        ') + '\n' +
    '        <p class="site-footer__coda">\u00A9 2026 Citehound. Built for teams navigating the shift from search to answers.</p>\n      </div>\n    </footer>\n  </main>\n\n' +
    '  <div class="toast" id="toast" role="status" aria-live="polite"></div>\n\n  <script src="lib/report-pro-ui.js?v=1" defer></script>\n  <script src="nav.js?v=3"></script>\n</body>\n</html>\n';
}

function ensureSitemap() {
  const file = path.join(ROOT, 'sitemap.xml');
  let xml = fs.readFileSync(file, 'utf8');
  const loc = SITE + '/sample-report';
  if (xml.indexOf('<loc>' + loc + '</loc>') !== -1) return false;
  fs.writeFileSync(file, xml.replace('</urlset>', '  <url>\n    <loc>' + loc + '</loc>\n  </url>\n</urlset>'), 'utf8');
  return true;
}

function main() {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const html = build(data);
  if (process.argv.indexOf('--check') !== -1) {
    if (!fs.existsSync(PAGE) || fs.readFileSync(PAGE, 'utf8') !== html) { console.error('sample-report.html is out of date; run node scripts/generate-sample-report.js'); process.exit(1); }
    const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
    if (sm.indexOf('<loc>' + SITE + '/sample-report</loc>') === -1) { console.error('sitemap.xml has no /sample-report'); process.exit(1); }
    console.log('OK: sample-report.html matches content/pro/sample-report.json');
    return;
  }
  fs.writeFileSync(PAGE, html, 'utf8');
  console.log('sample-report.html written; ' + (ensureSitemap() ? 'added to sitemap.xml' : 'already in sitemap.xml'));
}

if (require.main === module) main();
module.exports = { build: build };
