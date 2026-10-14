#!/usr/bin/env node
/* =====================================================================
   scripts/generate-service-pages.js

   Writes fix.html (/fix) and beyond.html (/beyond) from content/service-pages.json, on the structure of /pro: a navy banner with the product lockup,
   a four-step "how it works", icon cards or illustrative mockups, a navy band, the FAQ and a navy closing band with the early-access form
   (lib/request-dialog.js, inline). It also refreshes the homepage's dialog copy and keeps the sitemap and llms.txt entries. Edit the JSON, never the page.

   --check fails if a page is out of date, not indexable, not in the sitemap and llms.txt, if a form differs from the shared one, if the FAQ answer
   differs from the homepage's, if a mockup is not labelled as an illustration, or if the copy has a price, a promise of results or a banned word.

     node scripts/generate-service-pages.js            write the pages, the homepage form, the sitemap and llms.txt entries
     node scripts/generate-service-pages.js --check    exit 1 on any mismatch
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const shell = require('../lib/page-shell.js');
const site = require('../lib/site-config.js');
const icons = require('../lib/icons.js');
const dialog = require('../lib/request-dialog.js');
const lockup = require('../lib/lockup.js');

const ROOT = path.resolve(__dirname, '..');
const CSS_VERSION = 90;
const content = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'service-pages.json'), 'utf8'));
const esc = shell.esc;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ic = (name, cls) => icons.svg(name, { cls: cls });

const PAGES = [
  { key: 'fix', file: 'fix.html', tier: 'FIX', interest: 'fix', bannerIcon: 'wrench' },
  { key: 'beyond', file: 'beyond.html', tier: 'BEYOND', interest: 'beyond', bannerIcon: 'layers' }
];

function head(kicker, id, title) {
  return '      <div class="section-head">\n        <p class="kicker">' + esc(kicker) + '</p>\n        <h2 id="' + id + '" class="section-title">' + esc(title) + '</h2>\n      </div>\n';
}

function hero(p, c) {
  return '    <section aria-labelledby="hero-heading">\n      <div class="section__inner">\n        <div class="page-banner svc-banner">\n          <div class="page-banner__body">\n' +
    '            <p class="page-lockup">' + lockup.html(p.tier, 'navy') + '</p>\n' +
    '            <h1 id="hero-heading" class="page-banner__title">' + esc(c.h1) + '</h1>\n' +
    '            <p class="page-banner__desc">' + esc(c.sub) + '</p>\n' +
    '            <p class="svc-includes">' + lockup.includes('navy') + '</p>\n' +
    '            <div class="pro-actions"><button type="button" class="btn btn--gold" data-request="' + p.interest + '">' + esc(c.cta) + '</button><a href="#how" class="btn btn--ghost-on-navy">How it works</a></div>\n' +
    '          </div>\n          <span class="page-banner__icon" aria-hidden="true">' + icons.svg(p.bannerIcon, {}) + '</span>\n        </div>\n      </div>\n    </section>\n';
}

function steps(c) {
  return '    <section class="verticals hp-light" id="how" aria-labelledby="how-heading">\n      <div class="section__inner">\n' + head(c.stepsKicker, 'how-heading', c.stepsTitle).replace(/^/gm, '  ').replace(/^  $/gm, '') +
    '        <ol class="pro-steps pro-steps--4">\n' + c.steps.map((s) =>
      '          <li class="pro-step">\n            <span class="pro-row__icon">' + ic(s.icon, 'pro-icon') + '</span>\n            <h3 class="pro-step__title">' + esc(s.title) + '</h3>\n            <p class="pro-step__text">' + esc(s.text) + '</p>\n          </li>').join('\n') +
    '\n        </ol>\n' + (c.scope ? '        <p class="svc-scope">' + esc(c.scope) + '</p>\n' : '') + '      </div>\n    </section>\n';
}

function items(c) {
  return '    <section class="verticals band-white hp-band" aria-labelledby="items-heading">\n      <div class="section__inner">\n' + head(c.itemsKicker, 'items-heading', c.itemsTitle).replace(/^/gm, '  ').replace(/^  $/gm, '') +
    '        <ul class="pro-cards pro-cards--3">\n' + c.items.map((s) =>
      '          <li class="pro-card">\n            <span class="pro-row__icon">' + ic(s.icon, 'pro-icon') + '</span>\n            <h3 class="pro-card__title">' + esc(s.title) + '</h3>\n            <p class="pro-card__text">' + esc(s.text) + '</p>\n          </li>').join('\n') +
    '\n        </ul>\n      </div>\n    </section>\n';
}

// The AgaOne before/after component, taken from the homepage so there is one source; a note under the chart says what the score is.
function proof(c) {
  const home = read('index.html');
  const m = /<section class="proof-band hp-band"[\s\S]*?<\/section>/.exec(home);
  if (!m) throw new Error('the homepage has no AgaOne proof band to reuse');
  let sec = m[0].replace(/ hp-band"/, ' hp-band"');
  const end = sec.lastIndexOf('</svg>') + '</svg>'.length;
  sec = sec.slice(0, end) + '\n                <p class="case-study-figure__note">' + esc(c.proofNote) + '</p>' + sec.slice(end);
  return '    ' + sec + '\n';
}

function mockups(c) {
  const m = c.mock;
  const note = (n) => '<figcaption class="bm-note">' + esc(c.mockNote) + '</figcaption>';
  const list = '      <figure class="bm-fig">\n        <div class="bm-card">\n          <p class="bm-card__tag">Market questions</p>\n          <p class="bm-card__sub">' + esc(m.category) + '</p>\n          <ul class="bm-list">\n' +
    m.questions.map((q) => '            <li>' + esc(q) + '</li>').join('\n') + '\n          </ul>\n        </div>\n        ' + note() + '\n      </figure>\n';
  const table = '      <figure class="bm-fig">\n        <div class="bm-card">\n          <p class="bm-card__tag">Gap table</p>\n          <p class="bm-card__sub">' + esc(m.category) + '</p>\n          <table class="bm-table">\n            <thead><tr><th scope="col">Question</th><th scope="col">Page</th><th scope="col">Gap</th></tr></thead>\n            <tbody>\n' +
    m.gaps.map((g) => '              <tr><td>' + esc(g.q) + '</td><td class="bm-mono">' + esc(g.page) + '</td><td>' + esc(g.gap) + '</td></tr>').join('\n') + '\n            </tbody>\n          </table>\n        </div>\n        ' + note() + '\n      </figure>\n';
  const d = m.draft;
  const brief = '      <figure class="bm-fig">\n        <div class="bm-card">\n          <p class="bm-card__tag">' + esc(d.tag) + '</p>\n          <p class="bm-card__sub">' + esc(m.category) + '</p>\n          <div class="bm-snippet"><p class="bm-snippet__label">' + esc(d.briefLabel) + '</p><p class="bm-snippet__text">' + esc(d.brief) + '</p></div>\n          <div class="bm-draft"><p class="bm-draft__title">' + esc(d.title) + '</p><p class="bm-draft__text">' + esc(d.text) + '</p></div>\n          <p class="bm-status">' + esc(d.status) + '</p>\n        </div>\n        ' + note() + '\n      </figure>\n';
  return '    <section class="verticals band-white hp-band" aria-labelledby="mock-heading">\n      <div class="section__inner">\n' + head(c.mockKicker, 'mock-heading', c.mockTitle).replace(/^/gm, '  ').replace(/^  $/gm, '') +
    '        <div class="bm-grid">\n' + list + table + brief + '        </div>\n      </div>\n    </section>\n';
}

function band(c) {
  return '    <section class="svc-band hp-band" aria-labelledby="band-heading">\n      <div class="section__inner">\n        <div class="svc-band__grid">\n          <div>\n            <p class="kicker kicker--on-navy">Beyond</p>\n            <h2 id="band-heading" class="svc-band__title">' + esc(c.bandTitle) + '</h2>\n            <p class="svc-band__lede">' + esc(c.bandText) + '</p>\n          </div>\n          <ul class="svc-band__cols">\n' +
    c.bandCols.map((x) => '            <li class="svc-band__col"><span class="svc-band__icon">' + ic(x.icon, 'pro-icon') + '</span><h3 class="svc-band__coltitle">' + esc(x.title) + '</h3><p class="svc-band__coltext">' + esc(x.text) + '</p></li>').join('\n') + '\n          </ul>\n        </div>\n      </div>\n    </section>\n';
}

function faq(c) {
  return '    <section class="home-faq hp-light" id="faq" aria-labelledby="faq-heading">\n      <div class="section__inner">\n' + head(c.faqKicker, 'faq-heading', c.faqTitle).replace(/^/gm, '  ').replace(/^  $/gm, '') + '        <div class="ac-faq">\n' +
    c.faq.map((f) => '          <details>\n            <summary>' + esc(f.q) + '</summary>\n            <p>' + esc(f.a) + '</p>\n          </details>').join('\n') + '\n        </div>\n      </div>\n    </section>\n';
}

function request(p, c) {
  return '    <section class="svc-request hp-band" aria-labelledby="request-heading">\n      <div class="section__inner">\n        <div class="svc-request__grid">\n          <div class="svc-request__copy">\n            <p class="page-lockup">' + lockup.html(p.tier, 'navy') + '</p>\n            <h2 id="request-heading" class="svc-request__title">' + esc(c.requestTitle) + '</h2>\n            <p class="svc-request__text">' + esc(c.requestText) + '</p>\n            <p class="svc-includes">' + lockup.includes('navy') + '</p>\n            <p class="svc-request__back"><a href="/#ladder">Back to the four steps</a></p>\n          </div>\n          <div class="svc-request__card">\n            ' +
    dialog.inline(p.interest, '            ') + '\n          </div>\n        </div>\n      </div>\n    </section>\n';
}

function build(p) {
  const c = content[p.key];
  const body = hero(p, c) + '\n' + steps(c) + '\n' + (p.key === 'fix' ? items(c) + '\n' + proof(c) : mockups(c) + '\n' + band(c)) + '\n' + faq(c) + '\n' + request(p, c);
  const ld = [
    { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Citehound ' + (p.key === 'fix' ? 'Fix' : 'Beyond'), description: c.description, url: site.baseUrl + c.path, publisher: { '@id': site.baseUrl + '/#org' } },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: c.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }
  ];
  return shell.page({
    title: c.title, description: c.description, path: c.path, cssVersion: CSS_VERSION,
    headExtra: '  <script src="/request-form.js?v=1" defer></script>\n', jsonld: ld, body: body
  });
}

function ensureSitemap(c) {
  const file = path.join(ROOT, 'sitemap.xml');
  const xml = fs.readFileSync(file, 'utf8');
  const loc = site.baseUrl + c.path;
  if (xml.indexOf('<loc>' + loc + '</loc>') !== -1) return false;
  fs.writeFileSync(file, xml.replace('</urlset>', '  <url>\n    <loc>' + loc + '</loc>\n  </url>\n</urlset>'), 'utf8');
  return true;
}

const LLMS = {
  fix: '- [Fix](' + site.baseUrl + '/fix): early access. We prepare and apply the technical changes the scan asks for (schema, robots.txt, llms.txt, sitemap, titles and descriptions), rescan, and show the before and after. Includes Citehound Pro.\n',
  beyond: '- [Beyond](' + site.baseUrl + '/beyond): early access. We research the questions your customers ask, read your pages against them, write the content (new pages, FAQ and comparison blocks, rewrites; human-edited), you approve it, we publish or hand it over, and we re-measure every month. Includes Citehound Pro.\n'
};
function ensureLlms(key) {
  const file = path.join(ROOT, 'llms.txt');
  const t = fs.readFileSync(file, 'utf8');
  const line = LLMS[key];
  const re = new RegExp('^- \\[' + (key === 'fix' ? 'Fix' : 'Beyond') + '\\]\\(' + site.baseUrl.replace(/[.]/g, '\\.') + '/' + key + '\\)[^\\n]*\\n', 'm');
  if (re.test(t)) { const next = t.replace(re, line); if (next === t) return false; fs.writeFileSync(file, next, 'utf8'); return true; }
  const anchor = '## About\n\n';
  if (t.indexOf(anchor) === -1) throw new Error('llms.txt has no About section');
  fs.writeFileSync(file, t.replace(anchor, anchor + line), 'utf8');
  return true;
}

const BANNED = /\b(quietly|actually|seamlessly|effortless(ly)?|powerful|unlock|elevate|supercharge|game-changing|revolutioni[sz]e|landscape|delve|crucial|robust|coming soon)\b/i;
const WHY_Q = 'If nobody can promise a citation, why pay?';

function check() {
  const errors = [];
  const bad = (m) => errors.push(m);
  const home = read('index.html');
  const homeAnswer = (new RegExp('<summary>' + WHY_Q.replace(/[?]/g, '\\?') + '</summary>\\s*<p>([^<]*)</p>').exec(home) || [])[1];
  if (dialog.normalize(home) !== home) bad('the form in index.html differs from lib/request-dialog.js; run node scripts/generate-service-pages.js');
  if (home.indexOf('<details id="why-pay">') === -1) bad('the homepage FAQ answer has lost its id (why-pay)');
  PAGES.forEach((p) => {
    const c = content[p.key];
    const page = fs.existsSync(path.join(ROOT, p.file)) ? read(p.file) : '';
    const name = p.file;
    if (page !== build(p)) bad(name + ' is out of date; run node scripts/generate-service-pages.js');
    if (!/name="robots" content="index, follow"/.test(page)) bad(name + ' must be indexable');
    if ((page.match(/<h1[ >]/g) || []).length !== 1) bad(name + ' needs exactly one h1');
    if ((page.match(/<li class="pro-step">/g) || []).length !== 4) bad(name + ' needs exactly four steps');
    if (page.indexOf(dialog.inline(p.interest, '            ')) === -1) bad('the form in ' + name + ' differs from lib/request-dialog.js');
    if (/<dialog/.test(page)) bad(name + ' carries a dialog; the form is inline here');
    if (page.indexOf('<script src="/request-form.js?v=1" defer></script>') === -1) bad(name + ' does not load request-form.js');
    if (page.indexOf(lockup.html(p.tier, 'navy')) === -1) bad(name + ' has no ' + p.tier + ' lockup');
    if ((page.match(/<span class="includes-pro includes-pro--navy">/g) || []).length < 2) bad(name + ' needs the "Includes Citehound PRO" badge in the hero and beside the form');
    if (c.description.indexOf('Includes Citehound Pro.') === -1) bad(name + ': the meta description must say it includes Citehound Pro');
    if (!c.faq.some((f) => f.q === 'Do I need to buy Pro separately?' && f.a === 'No. Fix and Beyond both include Citehound Pro.')) bad(name + ' has no "Do I need to buy Pro separately?" FAQ entry');
    if (c.faq[0].q !== WHY_Q || c.faq[0].a !== homeAnswer) bad(name + ': the first FAQ entry must be the homepage answer, word for word');
    if (!/<script type="application\/ld\+json">[\s\S]*"@type": "FAQPage"/.test(page)) bad(name + ' has no FAQPage JSON-LD');
    if (!/<link rel="canonical" href="https:\/\/getcitehound\.com\/(fix|beyond)" \/>/.test(page)) bad(name + ' has no canonical address');
    if (!/property="og:title"/.test(page)) bad(name + ' has no Open Graph tags');
    if (p.key === 'beyond') {
      if ((page.match(/<figcaption class="bm-note">Illustration\. Not a real client\.<\/figcaption>/g) || []).length !== 3) bad(name + ': each of the three mockups needs the label "Illustration. Not a real client."');
      if (page.indexOf('Human-approved, automated.') === -1) bad(name + ' has no "Human-approved, automated" band');
      if (page.indexOf('Draft for approval') === -1 || /Content brief/.test(page)) bad(name + ': the third mockup must be the draft for approval, not a content brief');
      if (!/write the content/i.test(page) || page.indexOf('is agreed in the pilot') === -1) bad(name + ' must say we write the content and that the scope is agreed in the pilot');
    } else {
      if (!/case-study-figure__chart/.test(page) || page.indexOf('case-study-figure__note') === -1) bad(name + ' has no AgaOne component with its readiness note');
    }
    const text = page.replace(/<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/\s+/g, ' ');
    const body = text.replace(c.faq[0].a, '').replace(c.faq[0].q, '');
    if (BANNED.test(text)) bad(name + ': a banned word is on the page: ' + BANNED.exec(text)[0]);
    if (/[$€£]\s?\d|\b\d+\s?(USD|EUR|dollars|euros)\b|per month|per hour/i.test(body)) bad(name + ' must state no price');
    if (/\b(guarantee[sd]?|proven|will (?:get|make) you (?:cited|rank)|ranks? (?:first|higher|number))\b/i.test(body)) bad(name + ' must promise no result');
    if (/Nobody honestly can|can.t promise/i.test(body)) bad(name + ': the no-promise line belongs in the FAQ answer only');
    const paras = (page.match(/<p[^>]*>[\s\S]*?<\/p>/g) || []).filter((x) => (x.match(/—|&mdash;/g) || []).length > 1);
    if (paras.length) bad(name + ': more than one em dash in a paragraph');
    if (read('sitemap.xml').indexOf('<loc>' + site.baseUrl + c.path + '</loc>') === -1) bad('sitemap.xml has no ' + c.path);
    if (read('llms.txt').indexOf('(' + site.baseUrl + c.path + ')') === -1) bad('llms.txt has no ' + c.path);
  });
  if (/beyond-technical/.test(read('sitemap.xml') + read('llms.txt'))) bad('the old /beyond-technical address is still in the sitemap or llms.txt');
  return errors;
}

function main() {
  if (process.argv.indexOf('--check') !== -1) {
    const errors = check();
    if (errors.length) { errors.forEach((e) => console.error('FAIL: ' + e)); process.exit(1); }
    console.log('OK: /fix and /beyond are current, indexable, in the sitemap and llms.txt; the form is the shared one; the FAQ answer is the homepage\'s; the mockups are labelled; no price, no promised result');
    return;
  }
  const out = [];
  PAGES.forEach((p) => {
    fs.writeFileSync(path.join(ROOT, p.file), build(p), 'utf8');
    out.push(p.file + (ensureSitemap(content[p.key]) ? ' (added to sitemap.xml)' : '') + (ensureLlms(p.key) ? ' (llms.txt updated)' : ''));
  });
  const idx = path.join(ROOT, 'index.html');
  fs.writeFileSync(idx, dialog.normalize(fs.readFileSync(idx, 'utf8')), 'utf8');
  console.log('written: ' + out.join(', ') + '; the homepage form refreshed');
}

if (require.main === module) main();
module.exports = { build: build, content: content, check: check };
