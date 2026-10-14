#!/usr/bin/env node
/* =====================================================================
   scripts/generate-fix.js

   Writes fix.html (served at /fix) from content/fix.json, puts the shared Fix / Beyond request form (lib/request-dialog.js) into the homepage, and
   keeps the sitemap and llms.txt entries. Edit the JSON, never the page.

   --check fails if the page or the homepage's form is out of date, if the page is not indexable or not in the sitemap and llms.txt, if the form on
   the homepage, /fix or /beyond differs from the shared one, if the FAQ link is missing, or if the copy has a price, a promised result or a banned word.

     node scripts/generate-fix.js            write the page, the homepage form, the sitemap and llms.txt entries
     node scripts/generate-fix.js --check    exit 1 on any mismatch
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const shell = require('../lib/page-shell.js');
const site = require('../lib/site-config.js');
const icons = require('../lib/icons.js');
const dialog = require('../lib/request-dialog.js');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'fix.html');
const CSS_VERSION = 85;
const content = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'fix.json'), 'utf8'));
const esc = shell.esc;
const FAQ_LINK = '<p class="bt-faq"><a href="/#why-pay">If nobody can promise a citation, why pay?</a></p>';

const BACK_LINK = '<p class="bt-back"><a href="/#ladder">Back to the four steps</a></p>';

function build() {
  const sections = content.sections.map((s, i) => {
    let h = '        <div class="doc-section bt-section">\n          <h2 class="doc-section__heading"' + (i === 0 ? ' id="fix-first"' : '') + '>' + esc(s.heading) + '</h2>\n';
    (s.paragraphs || []).forEach((p) => { h += '          <p>' + esc(p) + '</p>\n'; });
    if (s.bullets) h += '          <ul class="doc-list">\n' + s.bullets.map((b) => '            <li><strong>' + esc(b.lead) + '</strong> ' + esc(b.text) + '</li>').join('\n') + '\n          </ul>\n';
    if (s.steps) h += '          <ol class="doc-list bt-steps">\n' + s.steps.map((x) => '            <li>' + esc(x) + '</li>').join('\n') + '\n          </ol>\n';
    return h + '        </div>';
  }).join('\n\n');
  const body = shell.banner({ kicker: content.kicker, title: esc(content.title), desc: esc(content.lede), icon: icons.svg('layers', {}) }) +
    '\n    <section class="verticals" aria-labelledby="fix-first">\n      <div class="section__inner">\n' + sections + '\n\n' +
    '        <div class="bt-cta">\n          <button type="button" class="btn btn--gold" data-request="fix">' + esc(content.cta.label) + '</button>\n          <p class="bt-fine">' + esc(content.smallPrint) + '</p>\n          ' + FAQ_LINK + '\n          ' + BACK_LINK + '\n        </div>\n' +
    '      </div>\n    </section>\n\n    ' + dialog.html('    ') + '\n';
  return shell.page({
    title: 'Citehound Fix: ' + content.title.charAt(0).toLowerCase() + content.title.slice(1),
    description: content.description,
    path: content.path,
    cssVersion: CSS_VERSION,
    headExtra: '  <script src="/request-form.js?v=1" defer></script>\n',
    jsonld: [{ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Citehound Fix', description: content.description, url: site.baseUrl + content.path, publisher: { '@id': site.baseUrl + '/#org' } }],
    body: body
  });
}

function ensureSitemap() {
  const file = path.join(ROOT, 'sitemap.xml');
  const xml = fs.readFileSync(file, 'utf8');
  const loc = site.baseUrl + content.path;
  if (xml.indexOf('<loc>' + loc + '</loc>') !== -1) return false;
  fs.writeFileSync(file, xml.replace('</urlset>', '  <url>\n    <loc>' + loc + '</loc>\n  </url>\n</urlset>'), 'utf8');
  return true;
}
function ensureLlms() {
  const file = path.join(ROOT, 'llms.txt');
  const t = fs.readFileSync(file, 'utf8');
  if (t.indexOf(site.baseUrl + content.path) !== -1) return false;
  const line = '- [Fix](' + site.baseUrl + content.path + '): early access. We prepare and apply the technical changes the scan asks for (schema, robots.txt, llms.txt, sitemap, titles and descriptions), rescan, and show the before and after.\n';
  const anchor = '## About\n\n';
  if (t.indexOf(anchor) === -1) throw new Error('llms.txt has no About section');
  fs.writeFileSync(file, t.replace(anchor, anchor + line), 'utf8');
  return true;
}

const BANNED = /\b(quietly|actually|seamlessly|effortless(ly)?|powerful|unlock|elevate|supercharge|game-changing|revolutioni[sz]e|landscape|delve|crucial|robust|coming soon)\b/i;

function check() {
  const errors = [];
  const bad = (m) => errors.push(m);
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const page = fs.existsSync(PAGE) ? read('fix.html') : '';
  if (page !== build()) bad('fix.html is out of date; run node scripts/generate-fix.js');
  if (dialog.normalize(read('index.html')) !== read('index.html')) bad('the form in index.html differs from lib/request-dialog.js; run node scripts/generate-fix.js');
  ['fix.html', 'beyond.html'].forEach((f) => {
    const h = read(f);
    if (dialog.normalize(h) !== h) bad('the form in ' + f + ' differs from lib/request-dialog.js');
    if ((h.match(/<dialog class="req-dialog"/g) || []).length !== 1) bad(f + ' needs exactly one request form');
    if (h.indexOf('<script src="/request-form.js?v=1" defer></script>') === -1) bad(f + ' does not load request-form.js');
    if (h.indexOf('<a href="/#why-pay">If nobody can promise a citation, why pay?</a>') === -1) bad(f + ' has no link to the FAQ answer');
    if (h.indexOf('<a href="/#ladder">Back to the four steps</a>') === -1) bad(f + ' has no link back to the ladder');
  });
  if (read('index.html').indexOf('<details id="why-pay">') === -1) bad('the homepage FAQ answer has lost its id (why-pay)');
  if (!/name="robots" content="index, follow"/.test(page)) bad('the page must be indexable');
  if ((page.match(/<h1[ >]/g) || []).length !== 1) bad('the page needs exactly one h1');
  if ((page.match(/<ol class="doc-list bt-steps">[\s\S]*?<\/ol>/) || [''])[0].split('<li>').length !== 4) bad('the page needs exactly three steps');
  const text = page.replace(/<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>|<dialog[\s\S]*?<\/dialog>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/\s+/g, ' ');
  if (BANNED.test(text)) bad('a banned word is on the page: ' + BANNED.exec(text)[0]);
  if (/[$€£]\s?\d|\b\d+\s?(USD|EUR|dollars|euros)\b|per month|per hour/i.test(text)) bad('the page must state no price');
  if (/\b(guarantee[sd]?|proven|will (?:get|make) you (?:cited|rank)|ranks? (?:first|higher|number))\b/i.test(text.replace('If nobody can promise a citation, why pay?', ''))) bad('the page must promise no result');
  const paras = (page.match(/<p[^>]*>[\s\S]*?<\/p>/g) || []).filter((p) => (p.match(/—|&mdash;/g) || []).length > 1);
  if (paras.length) bad('more than one em dash in a paragraph');
  if (read('sitemap.xml').indexOf('<loc>' + site.baseUrl + content.path + '</loc>') === -1) bad('sitemap.xml has no ' + content.path);
  if (read('llms.txt').indexOf(site.baseUrl + content.path) === -1) bad('llms.txt has no ' + content.path);
  return errors;
}

function main() {
  if (process.argv.indexOf('--check') !== -1) {
    const errors = check();
    if (errors.length) { errors.forEach((e) => console.error('FAIL: ' + e)); process.exit(1); }
    console.log('OK: /fix is current, indexable, in the sitemap and llms.txt; the request form is identical on the homepage, /fix and /beyond; no price, no promised result');
    return;
  }
  fs.writeFileSync(PAGE, build(), 'utf8');
  const idx = path.join(ROOT, 'index.html');
  fs.writeFileSync(idx, dialog.normalize(fs.readFileSync(idx, 'utf8')), 'utf8');
  console.log('fix.html written, the homepage form refreshed; ' + (ensureSitemap() ? 'added to sitemap.xml' : 'already in sitemap.xml') + '; ' + (ensureLlms() ? 'added to llms.txt' : 'already in llms.txt'));
}

if (require.main === module) main();
module.exports = { build: build, content: content, check: check };
