#!/usr/bin/env node
/* =====================================================================
   scripts/generate-beyond-technical.js

   Writes beyond.html (served at /beyond; /beyond-technical redirects to it, vercel.json) from content/beyond-technical.json, and the "Beyond technical" block of the homepage
   between <!-- BEYOND:START --> and <!-- BEYOND:END -->. The words are the owner's, set in the content file; the generator only lays them
   out. Edit the JSON, never the page.

   --check fails if either is out of date, if the page is not indexable or not in the sitemap and llms.txt, if the call to action is not the one
   mailto address, if the page says anything the brief for it did not (a price, a result, a promise of citations) or uses a banned word, with ONE
   exception named below.

     node scripts/generate-beyond-technical.js            write the page, the homepage block, the sitemap and llms.txt entries
     node scripts/generate-beyond-technical.js --check    exit 1 on any mismatch
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const shell = require('../lib/page-shell.js');
const site = require('../lib/site-config.js');
const icons = require('../lib/icons.js');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'beyond.html');
const dialog = require('../lib/request-dialog.js');
const CSS_VERSION = 86;
const content = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'beyond-technical.json'), 'utf8'));
const esc = shell.esc;
const FAQ_LINK = '<p class="bt-faq"><a href="/#why-pay">If nobody can promise a citation, why pay?</a></p>';
const BACK_LINK = '<p class="bt-back"><a href="/#ladder">Back to the four steps</a></p>';
const START = '<!-- BEYOND:START -->';
const END = '<!-- BEYOND:END -->';

function build() {
  const sections = content.sections.map((s, i) => {
    let h = '        <div class="doc-section bt-section">\n          <h2 class="doc-section__heading"' + (i === 0 ? ' id="bt-first"' : '') + '>' + esc(s.heading) + '</h2>\n';
    (s.paragraphs || []).forEach((p) => { h += '          <p>' + esc(p) + '</p>\n'; });
    if (s.bullets) h += '          <ul class="doc-list">\n' + s.bullets.map((b) => '            <li><strong>' + esc(b.lead) + '</strong> ' + esc(b.text) + '</li>').join('\n') + '\n          </ul>\n';
    if (s.steps) h += '          <ol class="doc-list bt-steps">\n' + s.steps.map((x) => '            <li>' + esc(x) + '</li>').join('\n') + '\n          </ol>\n';
    return h + '        </div>';
  }).join('\n\n');
  const body = shell.banner({ kicker: 'Citehound Beyond', title: esc(content.title), desc: esc(content.lede), icon: icons.svg('layers', {}) }) +
    '\n    <section class="verticals" aria-labelledby="bt-first">\n      <div class="section__inner">\n' + (content.lead ? '        <p class="bt-lead">' + esc(content.lead) + '</p>\n\n' : '') + sections + '\n\n' +
    '        <div class="bt-cta">\n          <button type="button" class="btn btn--gold" data-request="beyond">' + esc(content.cta.label) + '</button>\n          <p class="bt-fine">' + esc(content.smallPrint) + '</p>\n          ' + FAQ_LINK + '\n          ' + BACK_LINK + '\n        </div>\n' +
    '      </div>\n    </section>\n\n    ' + dialog.html('    ') + '\n';
  return shell.page({
    title: 'Citehound Beyond: ' + content.title,
    headExtra: '  <script src="/request-form.js?v=1" defer></script>\n',
    description: content.description,
    path: content.path,
    cssVersion: CSS_VERSION,
    jsonld: [{ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Citehound Beyond', description: content.description, url: site.baseUrl + content.path, publisher: { '@id': site.baseUrl + '/#org' } }],
    body: body
  });
}

// The homepage block, between markers: a contained light panel with a dot-grid texture, the same width and radius as the gold commerce card that follows it.
// The owner's headline, line and link are untouched; the eyebrow and the two layer labels are ours. The headline is cut at the sentence boundary so a wide
// screen can give each sentence its own line (CSS decides), never mid-sentence. The texture is an inline SVG <pattern> (hard-edged dots, no gradient
// function, no image file), the same technique as the Pro band's field.
const ARROW = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 8h10M9 4l4 4-4 4"/></svg>';
const DOTS = '<svg class="bt-panel__dots" width="100%" height="100%" aria-hidden="true" focusable="false"><defs><pattern id="btDots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="11" cy="11" r="1.1" fill="currentColor"/></pattern></defs><rect width="100%" height="100%" fill="url(#btDots)"/></svg>';
function homeBlock() {
  const h = content.home;
  const parts = h.heading.split(/(?<=\.)\s+/);
  if (parts.length !== 2) throw new Error('the homepage headline must be two sentences');
  const L = h.layers;
  return START + '\n    <section class="bt-sec" aria-labelledby="bt-home-h">\n      <div class="section__inner">\n        <div class="bt-panel">\n          ' + DOTS + '\n          <div class="bt-panel__body">\n' +
    '            <p class="kicker">' + esc(h.eyebrow) + '</p>\n' +
    '            <h2 id="bt-home-h" class="bt-panel__title"><span>' + esc(parts[0]) + '</span> <span><em>' + esc(parts[1]) + '</em></span></h2>\n' +
    '            <div class="bt-panel__grid">\n              <div class="bt-panel__text">\n                <p class="bt-panel__line">' + esc(h.line) + '</p>\n' +
    '                <a class="btn btn--gold bt-panel__cta" href="' + content.path + '">' + esc(h.link) + ARROW + '</a>\n              </div>\n' +
    '              <div class="bt-layers" role="img" aria-label="' + esc(L.label) + '">\n' +
    '                <div class="bt-layer bt-layer--content"><span class="bt-layer__tag">' + esc(L.content.tag) + '</span><p class="bt-layer__name">' + esc(L.content.name) + '</p><p class="bt-layer__text">' + esc(L.content.text) + '</p></div>\n' +
    '                <div class="bt-layer bt-layer--tech"><span class="bt-layer__tag">' + esc(L.tech.tag) + '</span><p class="bt-layer__name">' + esc(L.tech.name) + '</p><p class="bt-layer__text">' + esc(L.tech.text) + '</p></div>\n' +
    '              </div>\n            </div>\n          </div>\n        </div>\n      </div>\n    </section>\n    ' + END;
}

function applyHome(html) {
  // The homepage block was retired on 13 Oct 2026 (the ladder's Beyond card replaced it); it is refreshed only where it still stands.
  if (html.indexOf(START) !== -1) return html.replace(new RegExp(START + '[\\s\\S]*?' + END), () => homeBlock());
  return html;
}

function ensureSitemap() {
  const file = path.join(ROOT, 'sitemap.xml');
  const xml = fs.readFileSync(file, 'utf8');
  const loc = site.baseUrl + content.path;
  const old = site.baseUrl + '/beyond-technical';
  if (xml.indexOf('<loc>' + old + '</loc>') !== -1) { fs.writeFileSync(file, xml.replace('<loc>' + old + '</loc>', '<loc>' + loc + '</loc>'), 'utf8'); return true; }
  if (xml.indexOf('<loc>' + loc + '</loc>') !== -1) return false;
  fs.writeFileSync(file, xml.replace('</urlset>', '  <url>\n    <loc>' + loc + '</loc>\n  </url>\n</urlset>'), 'utf8');
  return true;
}
function ensureLlms() {
  const file = path.join(ROOT, 'llms.txt');
  const t = fs.readFileSync(file, 'utf8');
  const line = '- [Beyond](' + site.baseUrl + content.path + '): early access. What the score cannot see, what we know and what we do not, and how a content review works. We do not promise citations.\n';
  if (t.indexOf('(' + site.baseUrl + content.path + ')') !== -1) return false;
  const old = /^- \[Beyond technical\]\(https:[^\n]*\n/m;
  if (old.test(t)) { fs.writeFileSync(file, t.replace(old, line), 'utf8'); return true; }
  const anchor = '## About\n\n';
  if (t.indexOf(anchor) === -1) throw new Error('llms.txt has no About section');
  fs.writeFileSync(file, t.replace(anchor, anchor + line), 'utf8');
  return true;
}

// Words the voice rules ban. One is in the copy as the owner wrote it ("actually", in "Which questions your market actually asks") and is allowed
// there and only there; delete that one word, and this exception, if you want the page to follow the rule too.
const BANNED = /\b(quietly|seamlessly|effortless(ly)?|powerful|unlock|elevate|supercharge|game-changing|revolutioni[sz]e|landscape|delve|crucial|robust|coming soon)\b/i;
const ACTUALLY_OK = 'Which questions your market actually asks';

function check() {
  const errors = [];
  const bad = (m) => errors.push(m);
  const page = fs.existsSync(PAGE) ? fs.readFileSync(PAGE, 'utf8') : '';
  if (page !== build()) bad('beyond.html is out of date; run node scripts/generate-beyond-technical.js');
  const home = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = new RegExp(START + '[\\s\\S]*?' + END).exec(home);
  if (m && m[0] !== homeBlock()) bad('the homepage block is out of date; run node scripts/generate-beyond-technical.js');
  if (m && (home.indexOf(START) > home.indexOf('<footer class="site-footer') || home.indexOf(START) < home.indexOf('id="main"'))) bad('the homepage block must sit inside main, before the agentic commerce section');
  const noDialog = page.replace(/<dialog[\s\S]*?<\/dialog>/, '');
  if ((noDialog.match(/<h1[ >]/g) || []).length !== 1) bad('the page needs exactly one h1');
  if ((noDialog.match(/<h2[ >]/g) || []).length !== 4) bad('the page needs exactly four h2 headings (the brief’s four)');
  if (!/name="robots" content="index, follow"/.test(page)) bad('the page must be indexable');
  if (!/<button type="button" class="btn btn--gold" data-request="beyond">Request a content review<\/button>/.test(page)) bad('the call to action must be the "Request a content review" button that opens the request form');
  const text = page.replace(/<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>|<dialog[\s\S]*?<\/dialog>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/\s+/g, ' ');
  const stripped = text.replace(ACTUALLY_OK, '');
  if (BANNED.test(stripped) || /\bactually\b/i.test(stripped)) bad('a banned word is on the page: ' + (BANNED.exec(stripped) || /\bactually\b/i.exec(stripped))[0]);
  if (/[$€£]\s?\d|\b\d+\s?(USD|EUR|dollars|euros)\b|per month|per hour|free consult/i.test(text.replace(/Citehound shows you for free/, ''))) bad('the page must state no price');
  if (/\b(guarantee[sd]?|proven|will (?:get|make) you (?:cited|rank)|ranks? (?:first|higher|number))\b/i.test(text.replace(/We don’t promise citations\. Nobody honestly can\./, ''))) bad('the page must promise no result');
  if (!text.includes('We don’t promise citations. Nobody honestly can.')) bad('the small print is missing');
  // Typographic apostrophes only; no straight ones in the copy.
  if (/[A-Za-z]'[a-z]/.test(JSON.stringify(content).replace(/\\u2019/g, ''))) bad('a straight apostrophe is in the copy');
  const paras = (page.match(/<p[^>]*>[\s\S]*?<\/p>/g) || []).filter((p) => (p.match(/\u2014|&mdash;/g) || []).length > 1);
  if (paras.length) bad('more than one em dash in a paragraph');
  if (fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').indexOf('<loc>' + site.baseUrl + content.path + '</loc>') === -1) bad('sitemap.xml has no ' + content.path);
  if (fs.readFileSync(path.join(ROOT, 'llms.txt'), 'utf8').indexOf('(' + site.baseUrl + content.path + ')') === -1) bad('llms.txt has no ' + content.path);
  if (!/<footer class="site-footer[\s\S]*?<a href="\/beyond">Beyond<\/a>/.test(fs.readFileSync(path.join(ROOT, 'about.html'), 'utf8'))) bad('the footer has no Beyond link (lib/site-footer.js, then node scripts/site-footer.js)');
  return errors;
}

function main() {
  if (process.argv.indexOf('--check') !== -1) {
    const errors = check();
    if (errors.length) { errors.forEach((e) => console.error('FAIL: ' + e)); process.exit(1); }
    console.log('OK: /beyond is current, indexable, in the sitemap and llms.txt, one request-form call to action, no price, no promised result');
    return;
  }
  fs.writeFileSync(PAGE, build(), 'utf8');
  const idx = path.join(ROOT, 'index.html');
  fs.writeFileSync(idx, applyHome(fs.readFileSync(idx, 'utf8')), 'utf8');
  console.log('beyond.html written (the homepage block only where it still stands); ' + (ensureSitemap() ? 'added to sitemap.xml' : 'already in sitemap.xml') + '; ' + (ensureLlms() ? 'added to llms.txt' : 'already in llms.txt'));
}

if (require.main === module) main();
module.exports = { build: build, homeBlock: homeBlock, content: content };
