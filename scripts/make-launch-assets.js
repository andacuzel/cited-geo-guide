#!/usr/bin/env node
/* =====================================================================
   scripts/make-launch-assets.js: the launch kit (logos, social banners, store screenshots, Product Hunt and G2/Capterra images) in launch/ at the repo root.

     NODE_PATH=<a folder with playwright installed>/node_modules node scripts/make-launch-assets.js [base-url]

   launch/ is in .gitignore: it is never committed or deployed. Playwright is not a dependency of this repository (see CLAUDE.md and scripts/capture-tour.js):
   install it anywhere and point NODE_PATH at it. The templates use the brand files in assets/brand/ and the site's own fonts (Gloock, Hanken Grotesk,
   Spline Sans Mono from Google Fonts), so the machine needs a network connection. The four screenshots are taken from the LIVE site (default
   https://getcitehound.com): the free scan runs one real scan of getcitehound.com, the other three are /sample-report, /demo/fix and /demo/beyond with their
   own "Product demo · Sample data" ribbons. Nothing on a page is edited. Every image is PNG; each one that is not transparent also gets a JPG (quality 90).
   Writes launch/README.txt (path, pixel size, use) and launch/_contact-sheet.png for a look by eye.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'launch');
const BASE = (process.argv[2] || 'https://getcitehound.com').replace(/\/$/, '');
const NAVY = '#0B1526', GOLD = '#C2922F', GOLD_SOFT = '#E7C77C', BG = '#EEF1F5';
const TAGLINE = 'See if AI assistants can read and trust your site';
const LINE = 'Free scan · No sign-up · getcitehound.com';
const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Gloock&family=Hanken+Grotesk:wght@400;500;600&family=Spline+Sans+Mono:wght@500&display=swap" rel="stylesheet">';

const brand = (f) => fs.readFileSync(path.join(ROOT, 'assets', 'brand', f), 'utf8');
const uri = (svg) => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
const MARK = { light: uri(brand('logo-mark.svg')), dark: uri(brand('logo-mark-dark.svg')) };
const LOCKUP = { light: uri(brand('logo-lockup.svg')), dark: uri(brand('logo-lockup-dark.svg')) };

const manifest = [];   // { file, w, h, use }
const dir = (d) => fs.mkdirSync(path.join(OUT, d), { recursive: true });
const note = (file, w, h, use) => manifest.push({ file: file, w: w, h: h, use: use });

/* One page per template: render, shoot the PNG (transparent when asked) and, for a filled image, the JPG too. */
async function render(browser, html, w, h, file, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: opts.scale || 1 });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const png = path.join(OUT, file + '.png');
  await page.screenshot({ path: png, omitBackground: !!opts.transparent, clip: { x: 0, y: 0, width: w, height: h } });
  if (!opts.transparent) await page.screenshot({ path: path.join(OUT, file + '.jpg'), type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: w, height: h } });
  await ctx.close();
}

const shell = (w, h, bg, body, css) => '<!doctype html><html><head><meta charset="utf-8">' + FONTS + '<style>*{box-sizing:border-box;margin:0}html,body{width:' + w + 'px;height:' + h + 'px;background:' + bg + ';overflow:hidden}' +
  'body{font-family:"Hanken Grotesk",sans-serif;-webkit-font-smoothing:antialiased}' + (css || '') + '</style></head><body>' + body + '</body></html>';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/* ---------- logos ---------- */
async function logos(browser) {
  dir('logo');
  for (const n of [1024, 512, 240]) {
    await render(browser, shell(n, n, 'transparent', '<img src="' + MARK.light + '" style="width:' + n + 'px;height:' + n + 'px;display:block">'), n, n, 'logo/mark-' + n, { transparent: true });
    note('logo/mark-' + n + '.png', n, n, 'Mark only, navy with the gold eye, transparent. For light backgrounds.');
  }
  const lh = Math.round(2000 * 54.9 / 374.4);
  for (const t of ['light', 'dark']) {
    await render(browser, shell(2000, lh, 'transparent', '<img src="' + LOCKUP[t] + '" style="width:2000px;height:' + lh + 'px;display:block">'), 2000, lh, 'logo/lockup-horizontal-' + t, { transparent: true });
    note('logo/lockup-horizontal-' + t + '.png', 2000, lh, 'Horizontal lockup (mark and wordmark), transparent. ' + (t === 'light' ? 'Navy: for light backgrounds.' : 'White: for dark backgrounds.'));
  }
  await render(browser, shell(1024, 1024, NAVY, '<div style="width:1024px;height:1024px;display:flex;align-items:center;justify-content:center"><img src="' + MARK.dark + '" style="width:600px;height:600px"></div>'), 1024, 1024, 'logo/mark-on-navy-1024');
  note('logo/mark-on-navy-1024.png and .jpg', 1024, 1024, 'Mark on a solid navy square, for platforms that need a filled logo.');
}

/* ---------- social ---------- */
function banner(w, h, safe) {
  // The profile photo covers the lower left of an X banner and a LinkedIn page; the text block starts to the right of it and stays off the edges.
  const x = safe.x, y = safe.y;
  return shell(w, h, NAVY, '<div style="position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + (w - x - safe.right) + 'px">' +
    '<img src="' + LOCKUP.dark + '" style="height:' + safe.logo + 'px;display:block">' +
    '<p style="font-size:' + safe.tag + 'px;line-height:1.2;font-weight:500;color:#fff;margin-top:' + safe.g1 + 'px">' + esc(TAGLINE) + '</p>' +
    '<p style="font-family:\'Spline Sans Mono\',monospace;font-weight:500;font-size:' + safe.line + 'px;letter-spacing:.04em;color:' + GOLD_SOFT + ';margin-top:' + safe.g2 + 'px">' + esc(LINE) + '</p></div>');
}
async function social(browser) {
  dir('social');
  await render(browser, banner(1500, 500, { x: 470, y: 130, right: 100, logo: 66, tag: 44, g1: 36, line: 24, g2: 24 }), 1500, 500, 'social/x-banner-1500x500');
  note('social/x-banner-1500x500.png and .jpg', 1500, 500, 'X header. Text sits right of the profile photo and inside the crop zone.');
  await render(browser, shell(400, 400, NAVY, '<div style="width:400px;height:400px;display:flex;align-items:center;justify-content:center"><img src="' + MARK.dark + '" style="width:236px;height:236px"></div>'), 400, 400, 'social/x-profile-400x400');
  note('social/x-profile-400x400.png and .jpg', 400, 400, 'X profile picture (mark centered, safe for the round crop).');
  await render(browser, banner(1584, 396, { x: 440, y: 92, right: 80, logo: 56, tag: 40, g1: 28, line: 22, g2: 20 }), 1584, 396, 'social/linkedin-banner-1584x396');
  note('social/linkedin-banner-1584x396.png and .jpg', 1584, 396, 'LinkedIn company page banner. The page logo covers the lower left.');
}

/* ---------- screenshots of the live site ---------- */
const SHOTS = [
  { file: '01-free-scan', path: '/?scan=getcitehound.com', wait: '#scanReport:not([hidden])', use: 'The free scan result for getcitehound.com (a real scan, run on capture).' },
  { file: '02-pro-report', path: '/sample-report', use: 'The sample Pro report (a real crawl of our own site, as published).' },
  { file: '03-fix-workspace', path: '/demo/fix', use: 'The Fix workspace demo, with its "Product demo · Sample data" ribbon.' },
  { file: '04-beyond-workspace', path: '/demo/beyond', use: 'The Beyond workspace demo, with its "Product demo · Sample data" ribbon.' }
];
async function screenshots(browser) {
  dir('screenshots');
  for (const s of SHOTS) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(BASE + s.path, { waitUntil: 'networkidle', timeout: 90000 });
    if (s.wait) await page.waitForSelector(s.wait, { timeout: 90000 });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.addStyleTag({ content: '.toast, .wl-bar, .rc-card { display: none !important; }' });
    await page.waitForTimeout(3500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    if (s.file === '01-free-scan') {
      const bad = await page.evaluate(() => /could not|rate limit|try again/i.test((document.querySelector('#scanReport') || document.body).innerText.slice(0, 400)));
      if (bad) throw new Error('the free scan did not produce a report');
    }
    const f = path.join(OUT, 'screenshots', s.file);
    await page.screenshot({ path: f + '.png' });
    await page.screenshot({ path: f + '.jpg', type: 'jpeg', quality: 90 });
    note('screenshots/' + s.file + '.png and .jpg', 1600, 900, s.use);
    await ctx.close();
  }
}

/* ---------- Product Hunt ---------- */
const CAPTIONS = ['Free scan. No sign-up.', 'Pro: a page-by-page report', 'Fix: before and after', 'Beyond: questions, gaps, content'];
async function producthunt(browser) {
  dir('producthunt'); dir('g2-capterra');
  for (let i = 0; i < SHOTS.length; i++) {
    const s = SHOTS[i];
    const img = 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, 'screenshots', s.file + '.png')).toString('base64');
    const html = shell(1270, 760, NAVY, '<div style="width:1270px;height:680px;overflow:hidden"><img src="' + img + '" style="width:1270px;height:714px;display:block;object-fit:cover;object-position:top"></div>' +
      '<div style="height:80px;display:flex;align-items:center;padding:0 40px"><span style="font-family:Gloock,serif;font-size:32px;color:#fff">' + esc(CAPTIONS[i]) + '</span></div>');
    await render(browser, html, 1270, 760, 'producthunt/' + s.file);
    note('producthunt/' + s.file + '.png and .jpg', 1270, 760, 'Product Hunt gallery image ' + (i + 1) + ' of 4, with the caption bar "' + CAPTIONS[i] + '".');
    for (const ext of ['png', 'jpg']) fs.copyFileSync(path.join(OUT, 'screenshots', s.file + '.' + ext), path.join(OUT, 'g2-capterra', s.file + '.' + ext));
    note('g2-capterra/' + s.file + '.png and .jpg', 1600, 900, 'The same screenshot as screenshots/' + s.file + ', no caption bar.');
  }
  await render(browser, shell(240, 240, NAVY, '<div style="width:240px;height:240px;display:flex;align-items:center;justify-content:center"><img src="' + MARK.dark + '" style="width:140px;height:140px"></div>'), 240, 240, 'producthunt/thumbnail-240');
  note('producthunt/thumbnail-240.png and .jpg', 240, 240, 'Product Hunt thumbnail: the mark on navy.');
  await render(browser, shell(512, 512, NAVY, '<div style="width:512px;height:512px;display:flex;align-items:center;justify-content:center"><img src="' + MARK.dark + '" style="width:300px;height:300px"></div>'), 512, 512, 'g2-capterra/logo-512');
  note('g2-capterra/logo-512.png and .jpg', 512, 512, 'Logo for G2 and Capterra: the mark on navy.');
}

/* ---------- README, size check, contact sheet ---------- */
function size(file) {
  const b = fs.readFileSync(file);
  if (file.endsWith('.png')) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  for (let i = 2; i < b.length;) { if (b[i] !== 0xFF) return null; const m = b[i + 1]; const len = b.readUInt16BE(i + 2); if (m >= 0xC0 && m <= 0xC3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; i += 2 + len; }
  return null;
}
function walk(d, acc) { fs.readdirSync(d).forEach((n) => { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p, acc); else if (/\.(png|jpg)$/.test(n) && !/^_/.test(n)) acc.push(p); }); return acc; }

async function finish(browser) {
  const bad = [];
  manifest.forEach((m) => {
    const f = m.file.split(' ')[0];
    const files = [path.join(OUT, f)].concat(/\.png and \.jpg/.test(m.file) ? [path.join(OUT, f.replace(/\.png$/, '.jpg'))] : []);
    files.forEach((p) => { if (!fs.existsSync(p)) { bad.push('missing ' + p); return; } const d = size(p); if (!d || d[0] !== m.w || d[1] !== m.h) bad.push(path.relative(OUT, p) + ' is ' + (d ? d.join('x') : '?') + ', expected ' + m.w + 'x' + m.h); });
  });
  fs.writeFileSync(path.join(OUT, 'README.txt'), 'Citehound launch kit. Local only (launch/ is in .gitignore). Made by scripts/make-launch-assets.js on ' + new Date().toISOString().slice(0, 10) + ' from ' + BASE + '.\n' +
    'Every non-transparent image also has a .jpg (quality 90) next to the .png. Screenshots show the live pages unedited; the demos are fictional and carry their own "Product demo · Sample data" ribbon.\n\n' +
    manifest.map((m) => m.file + '  ' + m.w + 'x' + m.h + '  ' + m.use).join('\n') + '\n' +
    'og-1200x630: not remade. assets/brand/og-default.png is the current share image (new tagline, 14 Oct 2026) and is served by the site.\n' +
    '_contact-sheet.png  all PNG outputs at low resolution, for a look by eye.\n');
  const imgs = walk(OUT, []).filter((p) => p.endsWith('.png')).sort();
  const cells = imgs.map((p) => '<figure><img src="file://' + p + '"><figcaption>' + esc(path.relative(OUT, p)) + '</figcaption></figure>').join('');
  const ctx = await browser.newContext({ viewport: { width: 1800, height: 1000 } });
  const page = await ctx.newPage();
  const sheet = path.join(OUT, '_sheet.html');
  fs.writeFileSync(sheet, '<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:16px;background:#888;font:12px sans-serif;display:grid;grid-template-columns:repeat(6,1fr);gap:12px}figure{margin:0;background:#d5d9df;padding:6px}img{width:100%;height:150px;object-fit:contain;display:block}figcaption{background:#fff;padding:2px 4px;margin-top:4px;word-break:break-all}</style>' + cells);
  await page.goto('file://' + sheet);
  await page.waitForLoadState('load');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, '_contact-sheet.png'), fullPage: true });
  await ctx.close();
  fs.unlinkSync(sheet);
  return bad;
}

async function main() {
  let pw;
  try { pw = require('playwright'); } catch (e) { console.error('playwright is not installed. Set NODE_PATH to a node_modules folder that has it (see the header).'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await pw.chromium.launch({ args: ['--allow-file-access-from-files'] });
  await logos(browser);
  await social(browser);
  await screenshots(browser);
  await producthunt(browser);
  const bad = await finish(browser);
  await browser.close();
  walk(OUT, []).sort().forEach((p) => { const d = size(p); console.log(path.relative(OUT, p) + '  ' + (d ? d.join('x') : '?') + '  ' + Math.round(fs.statSync(p).size / 1024) + ' KB'); });
  if (bad.length) { console.error('\nSIZE PROBLEMS:\n  ' + bad.join('\n  ')); process.exit(1); }
  console.log('\nAll sizes match.');
}

main().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
