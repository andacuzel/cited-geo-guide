#!/usr/bin/env node
/* =====================================================================
   scripts/capture-og.js: the share images in assets/brand/ (1200x630 PNG), drawn from an HTML template with the brand lockup (an SVG of paths, so no font is
   needed for the wordmark) and the one line of positioning, TAGLINE in lib/site-footer.js.

     NODE_PATH=<a folder with playwright installed>/node_modules node scripts/capture-og.js

   Playwright is not a dependency of this repository (see CLAUDE.md): install it anywhere (npm i playwright; npx playwright install chromium) and point NODE_PATH
   at that folder. The text is set in Hanken Grotesk and Spline Sans Mono from Google Fonts, the site's own families, so the machine needs a network connection.

     og-default.png        navy, wordmark and the tagline: every page without an image of its own
     og-default-light.png  the same on the light page colour
     og-pro.png, og-fix.png, og-beyond.png   navy, wordmark, one line about the product, the tagline small underneath

   The pages name the files with a version query (OG_VERSION in lib/site-footer.js users: ?v=2), so a platform that cached the old image fetches the new one.
   Raise the number in every page and generator when an image changes again. Nothing here is a claim: each product line repeats what its page already says.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const { TAGLINE } = require('../lib/site-footer.js');

const OUT = path.join(__dirname, '..', 'assets', 'brand');
const svg = (f) => 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(OUT, f)).toString('base64');

const IMAGES = [
  { file: 'og-default.png', tone: 'dark', line: TAGLINE, small: '' },
  { file: 'og-default-light.png', tone: 'light', line: TAGLINE, small: '' },
  { file: 'og-pro.png', tone: 'dark', kicker: 'Pro', line: 'The whole-site report, page by page.', small: TAGLINE },
  { file: 'og-fix.png', tone: 'dark', kicker: 'Fix', line: 'We make the technical changes.', small: TAGLINE },
  { file: 'og-beyond.png', tone: 'dark', kicker: 'Beyond', line: 'We write the content.', small: TAGLINE }
];

function page(i) {
  const dark = i.tone === 'dark';
  const bg = dark ? '#0B1526' : '#EEF1F5', main = dark ? '#C9CED6' : '#4B5766', soft = dark ? '#98A1AE' : '#5F6B7A', gold = dark ? '#E7C77C' : '#85620F';
  const logo = svg(dark ? 'logo-lockup-dark.svg' : 'logo-lockup.svg');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return '<!doctype html><html><head><meta charset="utf-8"><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500&family=Spline+Sans+Mono:wght@500&display=swap" rel="stylesheet">' +
    '<style>html,body{margin:0;width:1200px;height:630px;background:' + bg + ';}body{display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:"Hanken Grotesk",sans-serif;}' +
    'img{width:750px;height:auto;display:block;margin-top:' + (i.kicker ? '-34px' : '-6px') + ';}' +
    '.k{font-family:"Spline Sans Mono",monospace;font-weight:500;font-size:22px;letter-spacing:0.14em;text-transform:uppercase;color:' + gold + ';margin-top:44px;}' +
    '.l{font-size:' + (i.kicker ? '40' : '39') + 'px;line-height:1.25;color:' + main + ';margin-top:' + (i.kicker ? '16px' : '52px') + ';text-align:center;}' +
    '.s{font-size:24px;color:' + soft + ';margin-top:26px;text-align:center;}</style></head><body>' +
    '<img src="' + logo + '" alt="">' + (i.kicker ? '<div class="k">' + esc(i.kicker) + '</div>' : '') + '<div class="l">' + esc(i.line) + '</div>' + (i.small ? '<div class="s">' + esc(i.small) + '</div>' : '') + '</body></html>';
}

async function main() {
  let pw;
  try { pw = require('playwright'); } catch (e) { console.error('playwright is not installed. Set NODE_PATH to a node_modules folder that has it (see the header).'); process.exit(1); }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  for (const i of IMAGES) {
    const p = await ctx.newPage();
    await p.setContent(page(i), { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(OUT, i.file), clip: { x: 0, y: 0, width: 1200, height: 630 } });
    await p.close();
    console.log('wrote ' + path.join('assets/brand', i.file));
  }
  await browser.close();
}

if (require.main === module) main().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
