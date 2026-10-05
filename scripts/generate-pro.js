#!/usr/bin/env node
/* =====================================================================
   scripts/generate-pro.js

   Writes pro.html and the homepage Pro band (index.html, between
   <!-- PRO-BAND:START --> and <!-- PRO-BAND:END -->) from
   content/pro/sample-report.json, the frozen real crawl of our own site, and
   from the crops in assets/pro/ (scripts/capture-pro-shots.js). Every figure
   is derived, none is typed: the cap comes from api/crawl-start.js, the scores,
   counts and date from the sample. Each figure carries data-fig="pro-..." so
   --check can read it back and compare it with a separate recomputation from
   the raw crawl.

     node scripts/generate-pro.js            write pro.html and the band
     node scripts/generate-pro.js --check    exit 1 on any mismatch
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const render = require('../lib/report-render.js');
const schema = require('../lib/schema.js');
const factsLib = require('../lib/report-facts.js');
const icons = require('../lib/icons.js');
const siteChrome = require('./site-chrome.js');
const capture = require('./capture-pro-shots.js');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://answerable-app.vercel.app';
const DATA = path.join(ROOT, 'content', 'pro', 'sample-report.json');
const PAGE = path.join(ROOT, 'pro.html');
const INDEX = path.join(ROOT, 'index.html');
const CSS_VERSION = 49;
const START = '<!-- PRO-BAND:START -->';
const END = '<!-- PRO-BAND:END -->';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const icon = (name) => icons.svg(name, { cls: 'pro-icon' });
const signed = (n) => (n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '0');

/* ---------- the figures, all derived ---------- */

// The crawl engine's page cap (MAX_PAGES in api/crawl-start.js), which lib/report-facts.js must agree with.
function crawlCap() {
  const src = fs.readFileSync(path.join(ROOT, 'api', 'crawl-start.js'), 'utf8');
  const m = /^var MAX_PAGES = (\d+);/m.exec(src);
  if (!m) throw new Error('api/crawl-start.js: MAX_PAGES not found');
  const cap = parseInt(m[1], 10);
  if (cap !== factsLib.CRAWL_CAP) throw new Error('MAX_PAGES (' + cap + ') and CRAWL_CAP in lib/report-facts.js (' + factsLib.CRAWL_CAP + ') disagree');
  return cap;
}

function figures(data) {
  const bm = data.benchmark || factsLib.benchmarkFromData(path.join(ROOT, 'data'));
  const f = factsLib.facts(Object.assign({}, data, { benchmark: bm }), { schema: schema });
  const a = render.analyze(data);
  const home = a.pageRows.filter((r) => r.url === data.pages[0].url)[0];
  const hiddenChecks = f.checks.filter((c) => !c.siteLevel && c.passesOnHomepage === true && c.failingPages > 0).map((c) => c.label);
  const others = a.pageRows.filter((r) => r !== home);
  const failingOthers = others.filter((r) => r.failed.some((c) => hiddenChecks.indexOf(render.cleanLabel(c.label)) !== -1)).length;
  const columns = f.checks.filter((c) => !c.siteLevel).length;
  const allDown = f.checks.filter((c) => !c.siteLevel && c.failingPages === f.coverage.pagesRead && c.failingPages > 0).length;
  const worst = a.pageRows[0];
  return {
    cap: crawlCap(),
    domain: data.domain,
    date: render.longDate(data.createdAt),
    homepage: f.verdict.homepage,
    site: f.verdict.siteWide,
    gap: f.verdict.gap,
    pagesRead: f.coverage.pagesRead,
    pagesWithAFailure: f.verdict.pagesWithAFailure,
    hidden: hiddenChecks.length,
    failingOthers: failingOthers,
    others: others.length,
    failingChecks: f.counts.failingChecks,
    columns: columns,
    allDown: allDown,
    worstPath: new URL(worst.url).pathname,
    worstScore: worst.total,
    fixFirst: f.fixes[0] || null,
    summary: data.executiveSummary || null
  };
}

const fig = (key, value) => '<span data-fig="pro-' + key + '">' + esc(value) + '</span>';

/* ---------- the crops, inside the frame ---------- */

const CROP_ORDER = ['summary', 'matrix', 'pages', 'fixes', 'print'];

function cropHtml(name) {
  const file = path.join(ROOT, 'assets', 'pro', name + '.frag');
  if (!fs.existsSync(file)) throw new Error('assets/pro/' + name + '.frag is missing; run node scripts/capture-pro-shots.js');
  return fs.readFileSync(file, 'utf8').replace(/\n+$/, '');
}

function alts(F) {
  const s = F.summary;
  return {
    summary: 'Sample dashboard summary for ' + F.domain + '. Headline: ' + (s ? s.headline : 'readiness report') + '. ' + (s ? s.situation + ' ' : '') + (s ? 'Label under it: ' + s.label + '. ' : '') +
      'Four figures: site-wide score ' + F.site + ', homepage score ' + F.homepage + ', gap ' + signed(F.gap) + ', and ' + F.pagesWithAFailure + ' pages with a failure.',
    matrix: 'Heat matrix from the sample crawl. One row per page, one column per check, a filled square where a page fails a check and a hollow one where it passes. ' + F.failingChecks + ' of the ' + F.columns + ' page-level checks fail on at least one page.',
    pages: 'Pages explorer from the sample crawl. The list shows pages worst first, starting with ' + F.worstPath + ' at ' + F.worstScore + ' out of 100. The pane beside it shows the checks that page fails and an open copy-paste fix.',
    fixes: 'Fixes tab from the sample crawl. Each distinct snippet appears once with the number of pages it applies to and a Copy button.' + (F.fixFirst ? ' The first is ' + F.fixFirst.label + ', applying to ' + F.fixFirst.pages.length + ' pages.' : ''),
    print: 'The top bar of the sample dashboard: the domain ' + F.domain + ', the crawl date ' + F.date + ' and a Print or save as PDF button.'
  };
}

const CAPS = {
  summary: 'The executive summary and four figures.',
  matrix: 'Which pages fail which checks. The top of the matrix.',
  pages: 'Pages, worst first, and the page selected.',
  fixes: 'The first two fixes.',
  print: 'The top bar, with the print button.'
};

function frame(name, F, extra) {
  return '<figure class="pro-shot pro-shot--' + name + (extra ? ' ' + extra : '') + '">\n' +
    '<div role="img" aria-label="' + esc(alts(F)[name]) + '"><div class="pro-shot__view" inert>\n' + cropHtml(name) + '\n</div></div>\n' +
    '<figcaption class="pro-shot__cap">Sample, ' + esc(F.domain) + ', ' + esc(F.date) + '. ' + esc(CAPS[name]) + '</figcaption>\n</figure>';
}

/* ---------- the homepage band ---------- */

function band(F) {
  return START + '\n' +
    '      <section class="pro-mkt" id="pro" aria-labelledby="pro-heading">\n' +
    '        <div class="section__inner">\n' +
    '          <div class="pro-mkt__grid">\n' +
    '            <div class="pro-mkt__text">\n' +
    '              <p class="kicker kicker--on-navy">Pro</p>\n' +
    '              <h2 id="pro-heading">Your homepage isn\'t your site.</h2>\n' +
    '              <p class="pro-mkt__lede">The free scan reads one page. Pro reads up to ' + fig('cap', F.cap) + ' and shows what the homepage hides.</p>\n' +
    '              <p class="pro-mkt__nums">Real crawl of our own site: homepage ' + fig('homepage', F.homepage) + ', whole site ' + fig('site', F.site) + '.</p>\n' +
    '              <p class="pro-mkt__actions"><a href="/sample-report" class="btn btn--gold">See a real report. No signup.</a><a href="/pro" class="pro-mkt__link">What Pro includes</a></p>\n' +
    '              <p class="pro-mkt__price">One-time purchase. No subscription.</p>\n' +
    '            </div>\n' +
    '            ' + frame('matrix', F, 'pro-shot--desktop').replace(/\n/g, '\n            ') + '\n' +
    '            <div class="services-block pro-mkt__services">\n' +
    '              <h3>Need this done for you?</h3>\n' +
    '              <p>From schema rollout to citation-source strategy. We implement it end to end.</p>\n' +
    '              <a href="#" id="agencyLink" class="btn btn--gold">Talk to us</a>\n' +
    '            </div>\n' +
    '          </div>\n' +
    '        </div>\n' +
    '      </section>\n      ' + END;
}

function indexHtml(current, F) {
  const b = band(F);
  if (current.indexOf(START) !== -1) return current.replace(new RegExp(START + '[\\s\\S]*?' + END), () => b);
  const open = current.indexOf('<section class="pro-band" id="pro"');
  if (open === -1) throw new Error('index.html: no Pro band to replace');
  const close = current.indexOf('</section>', open) + '</section>'.length;
  return current.slice(0, open) + b + current.slice(close);
}

/* ---------- the page ---------- */

function faq(F) {
  return [
    { q: 'What do I get with Answerable Pro?',
      a: 'A crawl of up to ' + F.cap + ' pages of your site, and a report built from it: an executive summary, the whole-site score beside the homepage score, a heat matrix of which pages fail which checks, a page-by-page explorer, every fix once with the pages it applies to, and a printable version.' },
    { q: 'How is this different from the free scan?',
      a: 'The free scan reads one page: the full 16-check report, the crawler matrix, copy-paste fixes and every playbook. Pro reads up to ' + F.cap + ' pages and shows what the homepage hides: the whole-site score beside the homepage score, the checks that pass on the homepage and fail elsewhere, and every fix once with the pages it applies to. Comparing two sites is free at /compare.',
      html: 'The free scan reads one page: the full 16-check report, the crawler matrix, copy-paste fixes and every playbook. Pro reads up to ' + F.cap + ' pages and shows what the homepage hides: the whole-site score beside the homepage score, the checks that pass on the homepage and fail elsewhere, and every fix once with the pages it applies to. Comparing two sites is free at <a href="/compare">/compare</a>.' },
    { q: 'What is the sample report?',
      a: 'A real crawl of our own site, ' + F.domain + ', run on ' + F.date + ': ' + F.pagesRead + ' pages. Nothing in it was edited or improved, and our own pages still fail some checks. The report says which.',
      html: 'A real crawl of our own site, ' + esc(F.domain) + ', run on ' + esc(F.date) + ': ' + F.pagesRead + ' pages. Nothing in it was edited or improved, and our own pages still fail some checks. The report says which. <a href="/sample-report">Open it.</a>' },
    { q: 'Does it measure whether AI names me?',
      a: 'No. Pro measures readiness: whether crawlers can reach and read your pages. It does not show whether a model names your brand. Citation tracking, a separate report we run for you, asks a model the questions your customers ask and shows when your name comes up.',
      html: 'No. Pro measures readiness: whether crawlers can reach and read your pages. It does not show whether a model names your brand. <a href="/citation-tracking">Citation tracking</a>, a separate report we run for you, asks a model the questions your customers ask and shows when your name comes up.' },
    { q: 'Is it really a one-time payment?',
      a: 'Yes. Answerable Pro is a single one-time purchase. There is no subscription and no recurring billing.' },
    { q: 'Do I need an account?',
      a: 'No. There is no account or login. Your report is generated and delivered right after payment.' }
  ];
}

const textOf = (html) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

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

const CITATION_MAIL = 'mailto:andacuz@gmail.com?subject=Citation%20run%20request&amp;body=Brand%3A%0D%0ADomain%3A%0D%0ACategory%3A%0D%0AThree%20competitors%3A%0D%0A';

function row(i, name, ic, title, body, F) {
  return '        <div class="pro-row' + (i % 2 ? ' pro-row--flip' : '') + '">\n' +
    '          <div class="pro-row__text">\n' +
    '            <span class="pro-row__icon">' + icon(ic) + '</span>\n' +
    '            <h3 class="pro-row__title">' + title + '</h3>\n' +
    '            <p class="pro-row__body">' + body + '</p>\n' +
    '          </div>\n' +
    '          ' + frame(name, F, name === 'matrix' ? 'pro-shot--desktop' : '').replace(/\n/g, '\n          ') + '\n' +
    '        </div>';
}

function build(data) {
  const F = figures(data);
  const shell = shellParts();
  const title = 'Answerable. — Pro: Your homepage isn\'t your site';
  const desc = 'Pro crawls up to ' + F.cap + ' pages of your site and shows what the homepage hides: the whole-site score, the pages that fail and every fix once.';
  if (desc.length < 120 || desc.length > 165) throw new Error('description is ' + desc.length + ' characters');
  const questions = faq(F);
  const ld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: questions.map((q) => ({ '@type': 'Question', name: q.q, acceptedAnswer: { '@type': 'Answer', text: textOf(q.html || q.a) } })) };

  const gapText = 'Pages other than the homepage fail checks the homepage passes: ' + fig('hidden', F.hidden) + ' checks, failing on ' + fig('failing-others', F.failingOthers) + ' of the ' + fig('others', F.others) + ' other pages.';

  const rows = [
    row(0, 'summary', 'report', 'Start with the answer.',
      'The report opens with the site-wide score beside the homepage score, then the top three checks to fix first, each with the points it adds and a typical effort. A short summary leads, labeled with what wrote it.', F),
    row(1, 'matrix', 'grid', 'See which problems are one template, not fifty pages.',
      'One row per page, one column per check. A column filled all the way down is likely a shared template: an inference from how many pages fail, not something we observed. In this crawl ' + fig('failing-checks', F.failingChecks) + ' of ' + fig('columns', F.columns) + ' page-level checks fail anywhere' + (F.allDown === 0 ? ', and no column fills all the way down.' : ', and ' + fig('all-down', F.allDown) + ' fill all the way down.'), F),
    row(2, 'pages', 'document', 'From the worst page to its fix in two clicks.',
      'Pages are listed worst first. Select one to see the checks it fails, then open its copy-paste fix. Search by path, or filter by a failing check or a section.', F),
    row(3, 'fixes', 'wrench', 'Every fix once, with the pages it applies to.',
      'Identical snippets appear once, with the pages they apply to and a Copy button. JSON-LD uses placeholders where a fact is unknown: fill them in, don\'t publish a placeholder.', F),
    row(4, 'print', 'printer', 'Hand it to your developer as a PDF.',
      'Print or save as PDF opens every section and drops the controls, so the printout is the whole report: summary, pages, checks and fixes.', F)
  ].join('\n');

  const li = (text) => '<li>' + icon('check') + '<span>' + text + '</span></li>';
  const freeItems = ['One page, scanned on demand', 'All 16 checks, with their point values', 'The AI crawler matrix, 10 crawlers deep', 'Copy-paste fixes for schema and robots.txt', '<a href="/compare">Comparing two sites</a>', 'Every <a href="/playbooks">playbook</a>', 'All the <a href="/tools">tools</a>'].map(li).join('\n            ');
  const proItems = ['Up to ' + fig('cap2', F.cap) + ' pages in one crawl', 'The whole-site score beside the homepage score', 'Pages ranked, worst first', 'The checks that pass on the homepage and fail elsewhere', 'Every fix once, with the pages it applies to', 'A printable report'].map(li).join('\n            ');

  const body = '  <main id="main">\n\n' +
    '    <!-- ---------- Banner ---------- -->\n' +
    '    <section aria-labelledby="pro-heading">\n      <div class="section__inner">\n        <div class="page-banner">\n          <div class="page-banner__body">\n' +
    '            <p class="kicker kicker--on-navy">Pro</p>\n' +
    '            <h1 id="pro-heading" class="page-banner__title">Your homepage isn\'t your site.</h1>\n' +
    '            <p class="page-banner__desc">The free scan reads one page. Pro crawls up to ' + fig('cap', F.cap) + ' and shows what the homepage hides.</p>\n' +
    '            <div class="pro-actions"><a href="/sample-report" class="btn btn--gold">See a real report. No signup.</a><a href="' + CITATION_MAIL + '" class="btn btn--ghost-on-navy">Get early access</a></div>\n' +
    '          </div>\n          <span class="page-banner__icon" aria-hidden="true">' + icons.svg('report', {}) + '</span>\n        </div>\n      </div>\n    </section>\n\n' +
    '    <!-- ---------- The gap ---------- -->\n' +
    '    <section class="verticals" aria-labelledby="gap-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">The gap</p>\n          <h2 id="gap-heading" class="section-title">One site, two scores.</h2>\n        </div>\n' +
    '        <div class="pro-gap">\n' +
    '          <div class="pro-gap__fig"><span class="pro-gap__label">Homepage</span><span class="pro-gap__num">' + fig('homepage', F.homepage) + '</span></div>\n' +
    '          <div class="pro-gap__fig"><span class="pro-gap__label">Whole site</span><span class="pro-gap__num">' + fig('site', F.site) + '</span></div>\n' +
    '        </div>\n' +
    '        <p class="pro-gap__cap">A real crawl of ' + esc(F.domain) + ', ' + esc(F.date) + '. Nothing edited.</p>\n' +
    '        <p class="pro-gap__text">' + gapText + '</p>\n' +
    '      </div>\n    </section>\n\n' +
    '    <!-- ---------- What you get ---------- -->\n' +
    '    <section class="verticals" aria-labelledby="get-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">What you get</p>\n          <h2 id="get-heading" class="section-title">The report, in the order you read it.</h2>\n        </div>\n' +
    rows + '\n      </div>\n    </section>\n\n' +
    '    <!-- ---------- Free versus Pro ---------- -->\n' +
    '    <section class="verticals" aria-labelledby="vs-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">Free vs. Pro</p>\n          <h2 id="vs-heading" class="section-title">Free reads a page. Pro reads the site.</h2>\n          <p class="section-sub">Nothing below is a trial or a teaser. It stays free whether or not you ever buy Pro.</p>\n        </div>\n' +
    '        <div class="pro-cols">\n' +
    '          <div class="pro-col">\n            <p class="kicker">Free</p>\n            <h3 class="pro-col__title">Always free</h3>\n            <ul class="pro-list">\n            ' + freeItems + '\n            </ul>\n            <p class="pro-col__foot"><a href="/" class="btn btn--ghost">Scan your site free</a></p>\n          </div>\n' +
    '          <div class="pro-col">\n            <p class="kicker">Pro</p>\n            <h3 class="pro-col__title">The whole site</h3>\n            <ul class="pro-list">\n            ' + proItems + '\n            </ul>\n            <p class="pro-col__foot pro-col__foot--note">One payment. Full Pro report for your domain. <a href="#" class="btn btn--ghost">In preparation</a></p>\n          </div>\n' +
    '        </div>\n      </div>\n    </section>\n\n' +
    '    <!-- ---------- Citation tracking pointer ---------- -->\n' +
    '    <section aria-label="Citation tracking">\n      <div class="section__inner">\n        <div class="scan-bridge">\n          <p class="scan-bridge__text">Want to know whether a model names you? Citation tracking is a separate report we run for you, with one model, in early access.</p>\n          <a href="/citation-tracking" class="btn btn--ghost">See citation tracking</a>\n        </div>\n      </div>\n    </section>\n\n' +
    '    <!-- ---------- Closing band ---------- -->\n' +
    '    <section class="pro-band" aria-labelledby="close-heading">\n      <div class="section__inner">\n        <p class="kicker kicker--on-navy">Pro</p>\n        <h2 id="close-heading">Read a real report before you decide.</h2>\n        <p class="pro-band__lede">One crawl of our own site, ' + F.pagesRead + ' pages, unedited. No signup.</p>\n' +
    '        <div class="pro-actions pro-actions--band"><a href="/sample-report" class="btn btn--gold">See a real report. No signup.</a><a href="' + CITATION_MAIL + '" class="btn btn--ghost-on-navy">Get early access</a></div>\n      </div>\n    </section>\n\n' +
    '    <!-- ---------- FAQ ---------- -->\n' +
    '    <section class="verticals pro-faq" aria-labelledby="faq-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">Questions</p>\n          <h2 id="faq-heading" class="section-title">Pro, briefly.</h2>\n        </div>\n        <div class="ct-faq">\n' +
    questions.map((q) => '          <details>\n            <summary>' + esc(q.q) + '</summary>\n            <p>' + (q.html || esc(q.a)) + '</p>\n          </details>').join('\n') + '\n        </div>\n      </div>\n    </section>\n\n';

  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n\n' +
    '  <title>' + esc(title) + '</title>\n  <meta name="description" content="' + esc(desc) + '" />\n' +
    '  <meta name="keywords" content="Answerable Pro, AI readiness report, full-site crawl, GEO, AEO" />\n  <meta name="author" content="Answerable." />\n  <meta name="robots" content="index, follow" />\n  <link rel="canonical" href="' + SITE + '/pro" />\n\n' +
    '  <!-- Open Graph -->\n  <meta property="og:type" content="website" />\n  <meta property="og:title" content="' + esc(title) + '" />\n  <meta property="og:description" content="' + esc(desc) + '" />\n  <meta property="og:url" content="' + SITE + '/pro" />\n  <meta property="og:image" content="' + SITE + '/assets/og-image.png" />\n  <meta property="og:site_name" content="Answerable." />\n\n' +
    '  <!-- Twitter -->\n  <meta name="twitter:card" content="summary_large_image" />\n  <meta name="twitter:title" content="' + esc(title) + '" />\n  <meta name="twitter:description" content="' + esc(desc) + '" />\n  <meta name="twitter:image" content="' + SITE + '/assets/og-image.png" />\n\n' +
    '  ' + shell.favicon + '\n\n  ' + shell.fonts + '\n\n  <link rel="stylesheet" href="styles.css?v=' + CSS_VERSION + '" />\n\n' +
    '  <script type="application/ld+json">\n' + JSON.stringify(ld, null, 2).replace(/^/gm, '  ') + '\n  </script>\n' + siteChrome.schemaBlock().replace(/^/gm, '  ') + '\n</head>\n<body>\n\n' +
    '  <a class="skip-link" href="#main">Skip to content</a>\n\n  ' + shell.header + '\n\n' + body +
    '    <footer class="site-footer" aria-label="Footer">\n      <div class="section__inner">\n        ' + shell.footerNav.replace(/\n/g, '\n        ') + '\n' +
    '        <p class="site-footer__coda">© 2026 Answerable. Built for teams navigating the shift from search to answers.</p>\n      </div>\n    </footer>\n\n  </main>\n\n' +
    '  <div class="toast" id="toast" role="status" aria-live="polite"></div>\n\n  <script src="nav.js?v=2"></script>\n</body>\n</html>\n';
}

/* ---------- --check: read every figure back and recompute it from the raw crawl ---------- */

function independent(data) {
  const ok = data.pages.filter((p) => p.status === 'ok' && p.result);
  const total = (p) => p.result.checks.reduce((n, c) => n + c.pts, 0);
  const siteLevel = (l) => /^(robots\.txt present|llms\.txt present|Sitemap declared|AI crawler access)/.test(l);
  const clean = (l) => l.replace(/\s*\(\d+\s*\/\s*\d+\s+open\)\s*$/i, '');
  const homeUrl = data.pages[0].url;
  const home = ok.filter((p) => p.url === homeUrl)[0];
  const labels = home.result.checks.filter((c) => !siteLevel(c.label)).map((c) => clean(c.label));
  const failsOn = (p, l) => p.result.checks.some((c) => clean(c.label) === l && !c.ok);
  const hidden = labels.filter((l) => !failsOn(home, l) && ok.some((p) => p !== home && failsOn(p, l)));
  const failingOthers = ok.filter((p) => p !== home && hidden.some((l) => failsOn(p, l))).length;
  const worst = ok.slice().sort((x, y) => total(x) - total(y) || (x.url < y.url ? -1 : 1))[0];
  const cap = parseInt(/MAX_PAGES = (\d+)/.exec(fs.readFileSync(path.join(ROOT, 'api', 'crawl-start.js'), 'utf8'))[1], 10);
  return {
    cap: cap, cap2: cap,
    homepage: total(home),
    site: Math.round(ok.reduce((n, p) => n + total(p), 0) / ok.length),
    hidden: hidden.length,
    'failing-others': failingOthers,
    others: ok.length - 1,
    'failing-checks': labels.filter((l) => ok.some((p) => failsOn(p, l))).length,
    columns: labels.length,
    'all-down': labels.filter((l) => ok.every((p) => failsOn(p, l))).length,
    date: new Date(data.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }),
    worstScore: total(worst)
  };
}

function readFigs(html) {
  const out = {};
  const re = /data-fig="pro-([a-z0-9-]+)">([^<]*)</g;
  let m;
  while ((m = re.exec(html))) (out[m[1]] = out[m[1]] || []).push(m[2].replace(/&amp;/g, '&'));
  return out;
}

function check(data) {
  const errors = [];
  const bad = (msg) => errors.push(msg);
  const F = figures(data);
  const want = independent(data);
  const page = fs.existsSync(PAGE) ? fs.readFileSync(PAGE, 'utf8') : '';
  const index = fs.readFileSync(INDEX, 'utf8');

  if (page !== build(data)) bad('pro.html is out of date; run node scripts/generate-pro.js');
  if (indexHtml(index, F) !== index) bad('the Pro band in index.html is out of date; run node scripts/generate-pro.js');
  const bandHtml = (index.match(new RegExp(START + '[\\s\\S]*?' + END)) || [''])[0];
  if (!bandHtml) bad('index.html has no PRO-BAND markers');

  // Figures on both surfaces equal the recomputation from the raw crawl.
  [['pro.html', page], ['the homepage band', bandHtml]].forEach(function (s) {
    const got = readFigs(s[1]);
    const keys = Object.keys(got);
    if (!keys.length) bad(s[0] + ' shows no figures');
    keys.forEach(function (k) {
      if (!(k in want)) { bad(s[0] + ': figure "' + k + '" has no recomputation'); return; }
      got[k].forEach(function (v) { if (String(v) !== String(want[k])) bad(s[0] + ': ' + k + ' reads ' + v + ', the crawl gives ' + want[k]); });
    });
  });
  ['cap', 'homepage', 'site'].forEach((k) => { if (!readFigs(bandHtml)[k]) bad('the band does not show ' + k); });
  ['cap', 'homepage', 'site', 'hidden', 'failing-others', 'others', 'failing-checks', 'columns'].forEach((k) => { if (!readFigs(page)[k]) bad('pro.html does not show ' + k); });
  if (F.date !== want.date) bad('date: ' + F.date + ' against ' + want.date);
  if (F.worstScore !== want.worstScore) bad('worst page score: ' + F.worstScore + ' against ' + want.worstScore);
  if (page.indexOf('A real crawl of ' + data.domain + ', ' + want.date + '. Nothing edited.') === -1) bad('the gap caption does not carry the crawl and its date');

  // The crops are current, and the summary label is shown exactly as the product shows it.
  const made = capture.crops(data);
  capture.NAMES.forEach((n) => { if (cropHtml(n).replace(/\n$/, '') !== made[n].replace(/\n+$/, '')) bad('assets/pro/' + n + '.frag is out of date; run node scripts/capture-pro-shots.js'); });
  if (data.executiveSummary && data.executiveSummary.source && data.executiveSummary.source.kind === 'model' && cropHtml('summary').indexOf(esc(data.executiveSummary.label)) === -1) bad('the summary crop does not carry the summary label');

  // The structured data parses and matches the visible FAQ.
  const ldBlocks = (page.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []).map((b) => JSON.parse(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')));
  const ldFaq = ldBlocks.filter((j) => j['@type'] === 'FAQPage')[0];
  const shown = (page.match(/<details>\s*<summary>[\s\S]*?<\/details>/g) || []).map((d) => ({ q: textOf(/<summary>([\s\S]*?)<\/summary>/.exec(d)[1]), a: textOf(/<p>([\s\S]*?)<\/p>/.exec(d)[1]) }));
  if (!ldFaq) bad('no FAQPage JSON-LD');
  else {
    if (ldFaq.mainEntity.length !== shown.length) bad('FAQ: ' + ldFaq.mainEntity.length + ' in JSON-LD, ' + shown.length + ' shown');
    ldFaq.mainEntity.forEach(function (q, i) { if (!shown[i] || shown[i].q !== q.name || shown[i].a !== q.acceptedAnswer.text) bad('FAQ ' + (i + 1) + ' differs between the JSON-LD and the page'); });
  }
  const keep = [['Is it really a one-time payment?', 'Yes. Answerable Pro is a single one-time purchase. There is no subscription and no recurring billing.'], ['Do I need an account?', 'No. There is no account or login. Your report is generated and delivered right after payment.']];
  keep.forEach((k) => { if (!shown.some((s) => s.q === k[0] && s.a === k[1])) bad('the existing answer "' + k[0] + '" changed'); });

  // Page rules.
  [['pro.html', page], ['the band', bandHtml]].forEach(function (s) {
    if (/gradient\(/i.test(s[1])) bad(s[0] + ': a gradient');
    if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s[1].replace(/✓/g, ''))) bad(s[0] + ': an emoji');
    const visible = textOf(s[1].replace(/<script[\s\S]*?<\/script>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, ''));
    ['quietly', 'actually', 'seamlessly', 'effortless', 'powerful', 'unlock', 'elevate', 'supercharge', 'game-changing', 'revolutionize', 'landscape', 'delve', 'crucial', 'robust', 'recommended', 'coming soon'].forEach((w) => { if (new RegExp('\\b' + w + '\\b', 'i').test(visible)) bad(s[0] + ': banned word "' + w + '"'); });
  });
  if ((page.match(/<h1[\s>]/g) || []).length !== 1) bad('pro.html needs exactly one h1');
  const meta = /<meta name="description" content="([^"]*)"/.exec(page);
  if (!meta || meta[1].length < 120 || meta[1].length > 165) bad('meta description length ' + (meta ? meta[1].length : 'missing'));
  if (page.indexOf('<link rel="canonical" href="' + SITE + '/pro" />') === -1) bad('canonical changed');
  ['og:title', 'og:description'].forEach((p) => { if (!new RegExp('property="' + p + '" content="[^"]+"').test(page)) bad('missing ' + p); });
  ['twitter:title', 'twitter:description'].forEach((p) => { if (!new RegExp('name="' + p + '" content="[^"]+"').test(page)) bad('missing ' + p); });
  (page.match(/<img\b[^>]*>/g) || []).concat(bandHtml.match(/<img\b[^>]*>/g) || []).forEach((t) => { if (!/ alt="/.test(t) || !/ width="/.test(t) || !/ height="/.test(t)) bad('an <img> lacks alt, width or height: ' + t.slice(0, 60)); });
  (page.match(/<figure class="pro-shot[\s\S]*?<\/figure>/g) || []).concat(bandHtml.match(/<figure class="pro-shot[\s\S]*?<\/figure>/g) || []).forEach((f) => {
    if (!/role="img" aria-label="[^"]{40,}"/.test(f)) bad('a crop has no alt text');
    if (!new RegExp('Sample, ' + data.domain.replace(/\./g, '\\.') + ', ' + want.date).test(f)) bad('a crop caption does not say Sample with the date');
  });

  return errors;
}

function main() {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  if (process.argv.indexOf('--check') !== -1) {
    const errors = check(data);
    if (errors.length) { errors.forEach((e) => console.error('FAIL: ' + e)); process.exit(1); }
    console.log('OK: pro.html and the homepage band match content/pro/sample-report.json; every figure recomputed from the raw crawl');
    return;
  }
  fs.writeFileSync(PAGE, build(data), 'utf8');
  fs.writeFileSync(INDEX, indexHtml(fs.readFileSync(INDEX, 'utf8'), figures(data)), 'utf8');
  console.log('pro.html written; Pro band in index.html written');
}

if (require.main === module) main();
module.exports = { build, band, figures, check };
