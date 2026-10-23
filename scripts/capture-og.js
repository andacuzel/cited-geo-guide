#!/usr/bin/env node
/* =====================================================================
   scripts/capture-og.js: the share images in assets/brand/ (1200x630 PNG), drawn from an HTML template with the brand lockup (an SVG of paths, so no font is
   needed for the wordmark) and the one line of positioning, TAGLINE in lib/site-footer.js.

     NODE_PATH=<a folder with playwright installed>/node_modules node scripts/capture-og.js

   Playwright is not a dependency of this repository (see CLAUDE.md): install it anywhere (npm i playwright; npx playwright install chromium) and point NODE_PATH
   at that folder. The text is set in Bricolage Grotesque and Hanken Grotesk from the site's own files in assets/fonts (no network). Set CHROME_PATH to use a browser that Playwright did not install.

     og-default.png        ink, wordmark, the tagline and the arch: every page without an image of its own
     og-default-light.png  the same on the light page colour
     og-pro.png, og-fix.png, og-beyond.png   navy, wordmark, one line about the product, the tagline small underneath

   The pages name the files with a version query (OG_VERSION in lib/site-footer.js users: ?v=3), so a platform that cached the old image fetches the new one.
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
  const bg = dark ? '#0E1B2C' : '#F4F4F0', ink = dark ? '#FFFFFF' : '#0E1B2C', main = dark ? '#DADFE6' : '#435064', gold = dark ? '#FFAE92' : '#B23A10', door = dark ? '#0E1B2C' : '#F4F4F0';
  const logo = svg(dark ? 'logo-lockup-dark.svg' : 'logo-lockup.svg');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const font = (f) => 'file://' + path.join(__dirname, '..', 'assets', 'fonts', f);
  return '<!doctype html><html><head><meta charset="utf-8"><style>' +
    '@font-face{font-family:"Bricolage Grotesque";font-weight:200 800;src:url(' + font('bricolage-grotesque-wght-latin.woff2') + ') format("woff2")}' +
    '@font-face{font-family:"Hanken Grotesk";font-weight:400 700;src:url(' + font('hanken-grotesk-normal-latin.woff2') + ') format("woff2")}' +
    'html,body{margin:0;width:1200px;height:630px;background:' + bg + ';overflow:hidden}body{position:relative;font-family:"Hanken Grotesk",sans-serif;padding:72px 80px;box-sizing:border-box}' +
    'img{width:430px;height:auto;display:block}' +
    '.k{font-weight:700;font-size:28px;color:' + gold + ';margin-top:64px}' +
    '.l{font-family:"Bricolage Grotesque",sans-serif;font-weight:800;letter-spacing:-0.04em;font-size:' + (i.kicker ? '64' : '68') + 'px;line-height:1.02;color:' + ink + ';margin-top:' + (i.kicker ? '14px' : '64px') + ';max-width:700px}' +
    '.s{font-size:26px;line-height:1.4;color:' + main + ';margin-top:28px;max-width:640px}' +
    '.arch{position:absolute;right:84px;bottom:0;width:300px;height:380px;border-radius:150px 150px 0 0;background:#F05A28}' +
    '.door{position:absolute;right:84px;bottom:0;width:300px;height:380px;border-radius:150px 150px 0 0;background:' + door + ';clip-path:polygon(15% 100%,15% 40%,40% 22%,40% 100%)}' +
    '</style></head><body><img src="' + logo + '" alt="">' + (i.kicker ? '<div class="k">' + esc(i.kicker) + '</div>' : '') + '<div class="l">' + esc(i.line) + '</div>' + (i.small ? '<div class="s">' + esc(i.small) + '</div>' : '') + '<div class="arch"></div><div class="door"></div></body></html>';
}

async function main() {
  let pw;
  try { pw = require('playwright'); } catch (e) { console.error('playwright is not installed. Set NODE_PATH to a node_modules folder that has it (see the header).'); process.exit(1); }
  const browser = await pw.chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  for (const i of IMAGES) {
    const p = await ctx.newPage();
    const tmp = path.join(require('os').tmpdir(), 'citehound-og-' + i.file.replace('.png', '.html'));
    fs.writeFileSync(tmp, page(i));
    await p.goto('file://' + tmp, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(OUT, i.file), clip: { x: 0, y: 0, width: 1200, height: 630 } });
    await p.close();
    console.log('wrote ' + path.join('assets/brand', i.file));
  }
  await browser.close();
}

if (require.main === module) main().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
