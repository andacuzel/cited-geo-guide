#!/usr/bin/env node
/* =====================================================================
   scripts/make-directory-icons.js: square app icons for directory listings (the Claude connector directory and the like), drawn from the brand mark in
   assets/brand/logo-mark-dark.svg and logo-mark.svg: the same path, the same eye, nothing added (no text, no wordmark, no other company's mark).

     NODE_PATH=<a folder with playwright installed>/node_modules node scripts/make-directory-icons.js

   Writes brand/directory-icons/:
     icon-512.png, icon-1024.png        opaque navy (--navy-950, #0B1526), the white mark with its gold-soft eye, centered, 20% of the canvas on each side
     icon-512-transparent.png           the primary mark (navy with the gold eye) on a transparent background, same size and padding
     icon-512-transparent-white.png     the white mark on a transparent background, for a portal that shows the icon on a dark surface
   The mark is centered on its own outline (the SVG viewBox is not centered on it), so the padding is even. Playwright is not a dependency of this repository.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'brand', 'directory-icons');
const NAVY = '#0B1526';
const read = (f) => fs.readFileSync(path.join(ROOT, 'assets', 'brand', f), 'utf8');
const PAD = 0.2;   // of the canvas, on each side: the mark fills the middle 60%

// The path and the eye, as written in the brand files.
const pathD = (svg) => /<path[^>]* d="([^"]+)"/.exec(svg)[1];
const eye = (svg) => { const m = /<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="(#[0-9A-Fa-f]{6})"/.exec(svg); return { cx: m[1], cy: m[2], r: m[3], fill: m[4] }; };
const D_MARK = pathD(read('logo-mark.svg'));
if (D_MARK !== pathD(read('logo-mark-dark.svg'))) throw new Error('the two brand marks no longer share one outline');

function icon(size, bg, markFill, eyeFill, box) {
  // box: the mark's own bounding box, so the viewBox is centered on it and the long side is 60% of the canvas.
  const long = Math.max(box.width, box.height), vw = long / (1 - 2 * PAD);
  const vx = box.x + box.width / 2 - vw / 2, vy = box.y + box.height / 2 - vw / 2;
  const e = eye(read('logo-mark.svg'));
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="' + vx + ' ' + vy + ' ' + vw + ' ' + vw + '">' +
    (bg ? '<rect x="' + vx + '" y="' + vy + '" width="' + vw + '" height="' + vw + '" fill="' + bg + '"/>' : '') +
    '<path fill="' + markFill + '" fill-rule="evenodd" d="' + D_MARK + '"/><circle cx="' + e.cx + '" cy="' + e.cy + '" r="' + e.r + '" fill="' + eyeFill + '"/></svg>';
}

async function main() {
  let pw;
  try { pw = require('playwright'); } catch (e) { console.error('playwright is not installed. Set NODE_PATH to a node_modules folder that has it (see the header).'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await pw.chromium.launch();
  const probe = await (await browser.newContext()).newPage();
  await probe.setContent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><path id="p" fill-rule="evenodd" d="' + D_MARK + '"/></svg>');
  const box = await probe.evaluate(() => { const b = document.getElementById('p').getBBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
  const white = eye(read('logo-mark-dark.svg')), gold = eye(read('logo-mark.svg'));
  const JOBS = [
    ['icon-512.png', 512, NAVY, '#FFFFFF', white.fill, false],
    ['icon-1024.png', 1024, NAVY, '#FFFFFF', white.fill, false],
    ['icon-512-transparent.png', 512, null, NAVY, gold.fill, true],
    ['icon-512-transparent-white.png', 512, null, '#FFFFFF', white.fill, true]
  ];
  for (const [file, size, bg, fill, eyeFill, transparent] of JOBS) {
    const ctx = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.setContent('<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>' + icon(size, bg, fill, eyeFill, box));
    await page.screenshot({ path: path.join(OUT, file), omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
    await ctx.close();
    console.log('wrote brand/directory-icons/' + file);
  }
  await browser.close();
}

main().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
