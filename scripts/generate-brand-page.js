#!/usr/bin/env node
/* =====================================================================
   scripts/generate-brand-page.js

   Writes brand.html (/brand): the press kit. Logo downloads (SVG and PNG from assets/brand), the colours, the type and the usage rules in short, and a link to the full brand
   guide in the repository. The text is a short extract of docs/brand/BRAND.md; the colours and type are read from brand/brand.json, never typed twice. Edit this file, never the page.

     node scripts/generate-brand-page.js            write the page and the sitemap entry
     node scripts/generate-brand-page.js --check    exit 1 if the page is out of date, a download is missing, a colour differs from brand.json, the footer or sitemap miss it, or a wording rule is broken
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const shell = require('../lib/page-shell.js');
const site = require('../lib/site-config.js');

const ROOT = path.resolve(__dirname, '..');
const CSS_VERSION = 105;
const esc = shell.esc;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const B = JSON.parse(read('brand/brand.json'));
const GUIDE = 'https://github.com/andacuzel/cited-geo-guide/blob/main/docs/brand/BRAND.md';

const TITLE = 'Citehound brand and press kit: logo, colors, type';
const DESC = 'Download the Citehound logo as SVG or PNG, and read the colors, type and usage rules. The hound is the only logo. For press and for links.';

const head = (kicker, id, title, sub) => '        <div class="section-head">\n          <p class="kicker">' + esc(kicker) + '</p>\n          <h2 id="' + id + '" class="section-title">' + esc(title) + '</h2>\n' + (sub ? '          <p class="section-sub">' + sub + '</p>\n' : '') + '        </div>\n';

const LOGOS = [
  { name: 'Horizontal lockup', file: 'logo-lockup', png: 'png/logo-lockup-1200.png', pngDark: 'png/logo-lockup-dark-1200.png', dark: false, w: 300, h: 46 },
  { name: 'Horizontal lockup, for dark grounds', file: 'logo-lockup-dark', png: 'png/logo-lockup-dark-1200.png', dark: true, w: 300, h: 46 },
  { name: 'Stacked lockup', file: 'logo-stacked', png: 'png/logo-stacked-800.png', dark: false, w: 170, h: 104 },
  { name: 'The hound', file: 'logo-mark', png: 'png/logo-mark-512.png', dark: false, w: 96, h: 96 },
  { name: 'The hound, for dark grounds', file: 'logo-mark-dark', png: 'png/logo-mark-dark-512.png', dark: true, w: 96, h: 96 },
  { name: 'One colour (black or any single colour)', file: 'logo-mark-mono', png: 'png/logo-mark-black-512.png', dark: false, w: 96, h: 96 },
  { name: 'Badge, for avatars and icons', file: 'logo-badge', png: 'png/logo-badge-512.png', dark: false, w: 96, h: 96 }
];

function tiles() {
  return '        <ul class="br-grid">\n' + LOGOS.map((l) => {
    const dims = (() => { const m = /viewBox="[\d. -]+ ([\d.]+) ([\d.]+)"/.exec(read('assets/brand/' + l.file + '.svg')); const r = +m[2] / +m[1]; return { w: l.w, h: Math.round(l.w * r) }; })();
    return '          <li class="br-tile"><div class="br-art' + (l.dark ? ' br-art--dark' : '') + '"><img src="/assets/brand/' + l.file + '.svg" width="' + dims.w + '" height="' + dims.h + '" alt="' + esc('Citehound ' + l.name.toLowerCase()) + '" /></div>' +
      '<p class="br-name">' + esc(l.name) + '</p><p class="br-links"><a href="/assets/brand/' + l.file + '.svg" download>SVG</a><a href="/assets/brand/' + l.png + '" download>PNG</a></p></li>';
  }).join('\n') + '\n        </ul>\n';
}

function swatches() {
  const C = B.color, rows = [['Ink', C.ink, 'Text, dark fields, the hound on light'], ['Paper', C.paper, 'The page ground'], ['White', C.white, 'Panels, the hound on ink'], ['Door orange', C.orange, 'The one accent: flat fields and buttons, with ink text'], ['Orange on light', C.orangeOnLight, 'Orange text on paper or white'], ['Orange on ink', C.orangeOnInk, 'Orange text on ink']];
  return '        <ul class="br-swatches">\n' + rows.map((r) => '          <li class="br-sw"><span class="br-chip" style="background:' + r[1] + '" aria-hidden="true"></span><span class="br-sw__name">' + esc(r[0]) + '</span><code>' + r[1] + '</code><span class="br-sw__use">' + esc(r[2]) + '</span></li>').join('\n') + '\n        </ul>\n';
}

function body() {
  const T = B.type;
  return shell.banner({ kicker: 'Brand', title: 'Brand and press kit', desc: 'The hound, the colors and the rules for using them. Free to use when you write about Citehound or link to it.' }) + '\n' +
    '    <section class="br-sec hp-light" id="logo" aria-labelledby="logo-heading">\n      <div class="section__inner">\n' + head('Logo', 'logo-heading', 'The hound is the only logo.', 'A greyhound head, drawn in the weight and corner radius of our type. Use the files below; do not redraw or retype them.') + tiles() +
    '        <h3 class="br-h3">Using the logo</h3>\n        <div class="br-cols">\n          <div><p class="br-lead">Do</p><ul class="br-list"><li>Put it on a plain flat ground: ink, paper or white.</li><li>Leave clear space on every side equal to the height of the hound&rsquo;s ear, about a quarter of the mark.</li><li>Keep it at 16 px or larger for the mark, 96 px or wider for the lockup. Below 24 px, use the badge.</li><li>Use the one-colour version on photographs and busy grounds.</li></ul></div>\n' +
    '          <div><p class="br-lead">Do not</p><ul class="br-list"><li>Add a door, an arch or any second symbol beside it.</li><li>Recolor the eye or the body, or add an outline, shadow, glow or gradient.</li><li>Stretch, rotate or crop it, or set the name in another typeface.</li><li>Use an earlier version of the mark.</li></ul></div>\n        </div>\n' +
    '      </div>\n    </section>\n\n' +
    '    <section class="br-sec hp-light" id="color" aria-labelledby="color-heading">\n      <div class="section__inner">\n' + head('Color', 'color-heading', 'Ink, paper and one orange.', 'Flat color only. Orange is a field or a button with ink text. Green, amber and red show status, nothing else. Text meets WCAG AA.') + swatches() + '      </div>\n    </section>\n\n' +
    '    <section class="br-sec hp-light" id="type" aria-labelledby="type-heading">\n      <div class="section__inner">\n' + head('Type', 'type-heading', 'Three open-license typefaces.', 'All three are under the SIL Open Font License and served from this site.') +
    '        <ul class="br-type">\n          <li><span class="br-type__s br-type__s--d">' + esc(T.display.family) + '</span><span>Headlines, weights 700 to 800.</span></li>\n          <li><span class="br-type__s">' + esc(T.text.family) + '</span><span>Text and interface, weights 400 to 700.</span></li>\n          <li><span class="br-type__s br-type__s--m">' + esc(T.mono.family) + '</span><span>Code, addresses and tables only.</span></li>\n        </ul>\n      </div>\n    </section>\n\n' +
    '    <section class="br-sec hp-light" id="words" aria-labelledby="words-heading">\n      <div class="section__inner">\n' + head('Words', 'words-heading', 'How to describe it.', 'Citehound is a free scanner that shows whether AI assistants can reach and read a website, with Pro reports, Fix and Beyond for the work that follows.') +
    '        <ul class="br-list br-list--wide"><li>The score measures readiness: crawler access and on-page signals. It does not measure whether any assistant names a brand.</li><li>Write &ldquo;Citehound&rdquo;, one word, capital C.</li><li>One sentence you can reuse: &ldquo;Scan, fix and write for the way AI answers.&rdquo;</li></ul>\n' +
    '        <p class="br-more"><a class="btn btn--primary" href="' + GUIDE + '">Read the full brand guide</a><a class="btn btn--ghost" href="mailto:' + esc(site.contactEmail) + '">Press and questions</a></p>\n' +
    '      </div>\n    </section>\n';
}

function build() {
  const ld = [{ '@context': 'https://schema.org', '@type': 'WebPage', name: TITLE, description: DESC, url: site.baseUrl + '/brand', publisher: { '@id': site.baseUrl + '/#org' } }];
  return shell.page({ title: TITLE, description: DESC, path: '/brand', cssVersion: CSS_VERSION, jsonld: ld, body: body() });
}

function ensureSitemap() {
  const file = path.join(ROOT, 'sitemap.xml'), xml = fs.readFileSync(file, 'utf8'), loc = site.baseUrl + '/brand';
  if (xml.indexOf('<loc>' + loc + '</loc>') !== -1) return false;
  fs.writeFileSync(file, xml.replace('</urlset>', '  <url>\n    <loc>' + loc + '</loc>\n  </url>\n</urlset>'), 'utf8');
  return true;
}

function check() {
  const errors = [], bad = (m) => errors.push(m);
  let page = ''; try { page = read('brand.html'); } catch (e) { bad('brand.html does not exist'); return errors; }
  if (page !== build()) bad('brand.html is out of date; run node scripts/generate-brand-page.js');
  if ((page.match(/<h1\b/g) || []).length !== 1) bad('the page must have one h1');
  if (TITLE.length > 70 || DESC.length < 120 || DESC.length > 160) bad('title or description length (' + TITLE.length + ', ' + DESC.length + ')');
  (page.match(/(?:href|src)="(\/assets\/brand\/[^"]+)"/g) || []).forEach((m) => { const f = m.replace(/^(href|src)="/, '').replace(/"$/, ''); if (!fs.existsSync(path.join(ROOT, f))) bad('missing download ' + f); });
  const css = read('styles.css'), tokens = { '--navy-950': B.color.ink, '--bg': B.color.paper, '--gold': B.color.orange, '--gold-deep': B.color.orangeOnLight, '--gold-soft': B.color.orangeOnInk };
  Object.keys(tokens).forEach((k) => { const m = new RegExp(k + ':\\s*(#[0-9A-Fa-f]{6})').exec(css); if (!m || m[1].toUpperCase() !== tokens[k].toUpperCase()) bad('brand.json and styles.css differ on ' + k); });
  if (read('sitemap.xml').indexOf('<loc>' + site.baseUrl + '/brand</loc>') === -1) bad('sitemap.xml has no /brand');
  if (require('../lib/site-footer.js').hrefs().indexOf('/brand') === -1) bad('the footer does not link to /brand');
  const text = page.replace(/<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
  if (/\b(guarantee[sd]?|partners?|official(ly)?|verified|recommend(s|ed)? by|cited by)\b/i.test(text)) bad('a forbidden word is on the page');
  if (/\b(quietly|actually|seamlessly|effortless|powerful|unlock|elevate|supercharge|game-changing|revolutionize|landscape|delve|crucial|robust)\b/i.test(text)) bad('a banned word is on the page');
  if (/https?:\/\/(?!getcitehound\.com|github\.com\/andacuzel\/cited-geo-guide|x\.com\/getcitehound|www\.linkedin\.com\/company\/citehound)/.test(page.replace(/<script[\s\S]*?<\/script>/g, '').replace(/http:\/\/www\.w3\.org[^"']*/g, '').replace(/<meta[^>]*>|<link[^>]*>/g, ''))) bad('an address outside this site and the repository is on the page');
  return errors;
}

function main() {
  if (process.argv.indexOf('--check') !== -1) {
    const errors = check();
    if (errors.length) { errors.forEach((e) => console.error('FAIL: ' + e)); process.exit(1); }
    console.log('OK: /brand is current; one h1; every download exists; the colors match brand.json and styles.css; in the sitemap and the footer; no forbidden or banned word');
    return;
  }
  fs.writeFileSync(path.join(ROOT, 'brand.html'), build(), 'utf8');
  console.log('written: brand.html' + (ensureSitemap() ? ', sitemap.xml entry' : ''));
}

if (require.main === module) main();
module.exports = { build, check };
