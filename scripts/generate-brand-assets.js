#!/usr/bin/env node
/* =====================================================================
   scripts/generate-brand-assets.js: every PNG of the brand that is not a share image (those are scripts/generate-og.js), drawn from HTML templates and the SVG logo set
   (scripts/brand/build_logo.py writes the SVGs) with headless Chromium. No photographs, no network, fonts from assets/fonts.

     NODE_PATH=<folder with playwright>/node_modules [CHROME_PATH=<chromium>] node scripts/generate-brand-assets.js [group,group]

   groups:  logo      assets/brand/png/*  and the legacy logo-mark / logo-lockup PNGs
            icons     favicon.ico, apple-touch-icon.png, assets/brand/icon-192.png and icon-512.png, site.webmanifest
            listing   brand/listing-icons/*   (512 and 1024 px square icons for directory listings)
            social    brand/social/*          (profile images, headers, covers, post and story templates, thumbnails)

   One-off images in the same style (a post, a story or a thumbnail) with your own words:
     node scripts/generate-brand-assets.js make --kind post|story|thumb|wide --headline "..." [--sub "..."] [--light] --out file.png
   Platform sizes and where each file is uploaded: brand/social/README.md and brand/listing-icons/README.md.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const art = require('./brand/art.js');
const gen = require('./generate-og.js');
const { TAGLINE } = require('../lib/site-footer.js');
const { C, esc, uri, ROOT, BRAND } = art;

const png = (dir, name, w, h, html, transparent) => ({ out: path.join(dir, name), w, h, html, transparent });
const SOCIAL = path.join(ROOT, 'brand', 'social'), LISTING = path.join(ROOT, 'brand', 'listing-icons'), PNGDIR = path.join(BRAND, 'png');
const img = (file, style) => '<img src="' + uri(file) + '" style="display:block;' + (style || '') + '" alt="">';

// ---------- logo PNGs ----------
function logoJobs() {
  const jobs = [];
  const marks = { 'logo-mark': 'logo-mark.svg', 'logo-mark-dark': 'logo-mark-dark.svg', 'logo-mark-white': 'logo-mark-white.svg', 'logo-mark-black': 'logo-mark-mono.svg' };
  const box = (file, w, h, fit) => '<style>html,body{background:transparent!important}</style>' + img(file, 'width:' + w + 'px;height:' + h + 'px;object-fit:contain');
  for (const [name, file] of Object.entries(marks)) for (const s of [64, 128, 256, 512, 1024]) jobs.push(png(PNGDIR, name + '-' + s + '.png', s, s, art.shell(s, s, 'transparent', '', box(file.replace('mono', 'mono'), s, s)), true));
  const ratio = (f) => { const m = /viewBox="[\d. -]+ ([\d.]+) ([\d.]+)"/.exec(fs.readFileSync(path.join(BRAND, f), 'utf8')); return +m[2] / +m[1]; };
  for (const name of ['logo-lockup', 'logo-lockup-dark', 'logo-lockup-white', 'logo-stacked', 'logo-stacked-dark', 'logo-stacked-white']) {
    const f = name + '.svg';
    for (const w of (name.includes('stacked') ? [400, 800, 1600] : [600, 1200, 2400])) { const h = Math.round(w * ratio(f)); jobs.push(png(PNGDIR, name + '-' + w + '.png', w, h, art.shell(w, h, 'transparent', '', box(f, w, h)), true)); }
  }
  for (const [name, file] of Object.entries({ 'logo-badge': 'logo-badge.svg', 'logo-badge-light': 'logo-badge-light.svg' })) for (const s of [32, 64, 128, 256, 512, 1024]) jobs.push(png(PNGDIR, name + '-' + s + '.png', s, s, art.shell(s, s, 'transparent', '', box(file, s, s)), true));
  // the legacy names (JSON-LD, the integrations and old links)
  jobs.push(png(BRAND, 'logo-mark.png', 512, 512, art.shell(512, 512, 'transparent', '', box('logo-mark.svg', 512, 512)), true));
  jobs.push(png(BRAND, 'logo-mark-dark.png', 512, 512, art.shell(512, 512, 'transparent', '', box('logo-mark-dark.svg', 512, 512)), true));
  for (const [n, f] of [['logo-lockup.png', 'logo-lockup.svg'], ['logo-lockup-dark.png', 'logo-lockup-dark.svg']]) { const h = Math.round(1200 * ratio(f)); jobs.push(png(BRAND, n, 1200, h, art.shell(1200, h, 'transparent', '', box(f, 1200, h)), true)); }
  return jobs;
}

// ---------- app icons: the hound on a full-bleed ink square ----------
const squareIcon = (s, rx, pad) => art.shell(s, s, 'transparent', '', '<div style="width:' + s + 'px;height:' + s + 'px;background:' + C.ink + ';border-radius:' + rx + 'px;display:flex;align-items:center;justify-content:center">' + img('logo-mark-dark.svg', 'width:' + Math.round(s * (1 - pad * 2)) + 'px;height:auto') + '</div>');
function iconJobs() {
  const jobs = [png(ROOT, 'apple-touch-icon.png', 180, 180, squareIcon(180, 0, 0.17)), png(BRAND, 'icon-192.png', 192, 192, squareIcon(192, 0, 0.17)), png(BRAND, 'icon-512.png', 512, 512, squareIcon(512, 0, 0.17))];
  for (const s of [16, 32, 48]) jobs.push(png(path.join(BRAND, 'png'), 'favicon-' + s + '.png', s, s, art.shell(s, s, 'transparent', '', '<div style="width:' + s + 'px;height:' + s + 'px">' + img('favicon.svg', 'width:' + s + 'px;height:' + s + 'px') + '</div>'), true));
  return jobs;
}
function writeIco() {   // PNG-in-ICO from the three favicon PNGs
  const sizes = [16, 32, 48], data = sizes.map((s) => fs.readFileSync(path.join(BRAND, 'png', 'favicon-' + s + '.png')));
  const hdr = Buffer.alloc(6); hdr.writeUInt16LE(1, 2); hdr.writeUInt16LE(sizes.length, 4);
  let off = 6 + 16 * sizes.length; const ents = [];
  sizes.forEach((s, i) => { const e = Buffer.alloc(16); e[0] = s; e[1] = s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(data[i].length, 8); e.writeUInt32LE(off, 12); off += data[i].length; ents.push(e); });
  fs.writeFileSync(path.join(ROOT, 'favicon.ico'), Buffer.concat([hdr].concat(ents, data)));
  fs.writeFileSync(path.join(ROOT, 'site.webmanifest'), JSON.stringify({ name: 'Citehound', short_name: 'Citehound', description: TAGLINE, start_url: '/', display: 'browser', background_color: C.paper, theme_color: C.ink, icons: [{ src: '/assets/brand/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/assets/brand/icon-512.png', sizes: '512x512', type: 'image/png' }] }, null, 2) + '\n');
  console.log('wrote favicon.ico and site.webmanifest');
}

// ---------- listing icons ----------
function listingJobs() {
  const jobs = [];
  for (const s of [512, 1024]) {
    jobs.push(png(LISTING, 'citehound-icon-' + s + '.png', s, s, squareIcon(s, 0, 0.17)));                       // full-bleed square: the platform rounds or masks it
    jobs.push(png(LISTING, 'citehound-icon-rounded-' + s + '.png', s, s, squareIcon(s, Math.round(s * 0.22), 0.17), true));   // rounded corners, transparent outside
    jobs.push(png(LISTING, 'citehound-icon-light-' + s + '.png', s, s, art.shell(s, s, 'transparent', '', '<div style="width:' + s + 'px;height:' + s + 'px;background:' + C.paper + ';display:flex;align-items:center;justify-content:center">' + img('logo-mark.svg', 'width:' + Math.round(s * 0.66) + 'px;height:auto') + '</div>')));
    jobs.push(png(LISTING, 'citehound-hound-transparent-' + s + '.png', s, s, art.shell(s, s, 'transparent', '', '<div style="width:' + s + 'px;height:' + s + 'px;display:flex;align-items:center;justify-content:center">' + img('logo-mark.svg', 'width:' + Math.round(s * 0.8) + 'px;height:auto') + '</div>'), true));
  }
  return jobs;
}

// ---------- social templates ----------
const COPY = { headline: 'See how AI reads your site. Then fix it.', tagline: TAGLINE, url: 'getcitehound.com' };
const houndOrange = (css) => '<img src="' + uri('logo-mark-orange.svg') + '" style="position:absolute;display:block;' + css + '" alt="">';
const lock = (w, light) => img(light ? 'logo-lockup.svg' : 'logo-lockup-dark.svg', 'width:' + w + 'px;height:auto');

// a wide banner: lockup, one line, the hound cropped at the right. opt: { w, h, x0 (left edge of the content), lockW, size, y, hound: css }
function wide(o) {
  const bg = C.ink;
  const css = 'body{background:' + bg + ';color:#fff}.t{position:absolute;left:' + o.x0 + 'px;top:' + o.y + 'px}.l{margin-top:' + (o.gap || 28) + 'px;font-family:"Bricolage Grotesque";font-weight:800;letter-spacing:-0.04em;font-size:' + o.size + 'px;line-height:1.04;max-width:' + (o.max || 900) + 'px;color:#fff}.u{margin-top:14px;font-weight:700;font-size:' + Math.round(o.size * 0.42) + 'px;color:' + C.orangeSoft + '}';
  return art.shell(o.w, o.h, bg, css, '<div class="t">' + lock(o.lockW) + (o.line === false ? '' : '<div class="l">' + esc(o.line || COPY.tagline) + '</div>') + (o.url ? '<div class="u">' + COPY.url + '</div>' : '') + '</div>' + houndOrange(o.hound));
}
// a post, story or thumbnail: lockup, headline, sub, hound. opt: { w, h, light, headline, sub, pad, size, top }
function post(o) {
  const light = !!o.light, bg = light ? C.paper : C.ink, ink = light ? C.ink : '#fff', soft = light ? '#435064' : C.soft, tag = light ? C.orangeDeep : C.orangeSoft;
  const css = 'body{background:' + bg + ';color:' + ink + ';padding:' + o.pad + 'px}.h{font-family:"Bricolage Grotesque";font-weight:800;letter-spacing:-0.045em;font-size:' + o.size + 'px;line-height:1.0;margin-top:' + o.gap + 'px;max-width:' + o.max + 'px}.s{font-size:' + Math.round(o.size * 0.3) + 'px;line-height:1.35;color:' + soft + ';margin-top:' + Math.round(o.size * 0.3) + 'px;max-width:' + Math.round(o.max * 0.82) + 'px}.u{position:absolute;left:' + o.pad + 'px;bottom:' + (o.bottom || o.pad) + 'px;font-weight:700;font-size:' + Math.round(o.size * 0.3) + 'px;color:' + tag + '}';
  return art.shell(o.w, o.h, bg, css, '<div style="margin-top:' + (o.top || 0) + 'px">' + lock(o.lockW, light) + '</div><div class="h">' + esc(o.headline) + '</div>' + (o.sub ? '<div class="s">' + esc(o.sub) + '</div>' : '') + '<div class="u">' + COPY.url + '</div>' + houndOrange(o.hound));
}
const avatar = (s, pad, rx) => art.shell(s, s, C.ink, '', '<div style="width:' + s + 'px;height:' + s + 'px;background:' + C.ink + ';border-radius:' + (rx || 0) + 'px;display:flex;align-items:center;justify-content:center">' + img('logo-mark-dark.svg', 'width:' + Math.round(s * (1 - pad * 2)) + 'px;height:auto') + '</div>');

function socialJobs() {
  const j = [];
  j.push(png(SOCIAL, 'x-profile-400x400.png', 400, 400, avatar(400, 0.2)));
  j.push(png(SOCIAL, 'x-header-1500x500.png', 1500, 500, wide({ w: 1500, h: 500, x0: 420, y: 96, lockW: 440, size: 48, gap: 30, max: 540, hound: 'right:70px;bottom:-30px;height:430px;width:auto' })));
  j.push(png(SOCIAL, 'linkedin-logo-300x300.png', 300, 300, avatar(300, 0.2)));
  j.push(png(SOCIAL, 'linkedin-cover-1128x191.png', 1128, 191, wide({ w: 1128, h: 191, x0: 330, y: 44, lockW: 250, size: 24, gap: 14, max: 560, hound: 'right:40px;bottom:-14px;height:170px;width:auto' })));
  j.push(png(SOCIAL, 'linkedin-cover-2256x382.png', 2256, 382, wide({ w: 2256, h: 382, x0: 660, y: 88, lockW: 500, size: 48, gap: 28, max: 1120, hound: 'right:80px;bottom:-28px;height:340px;width:auto' })));
  j.push(png(SOCIAL, 'youtube-icon-800x800.png', 800, 800, avatar(800, 0.2)));
  // YouTube banner: 2560x1440; everything that must be seen sits in the safe area 1546x423, centred (x 507..2053, y 508..931)
  j.push(png(SOCIAL, 'youtube-banner-2560x1440.png', 2560, 1440, wide({ w: 2560, h: 1440, x0: 560, y: 540, lockW: 560, size: 64, gap: 30, max: 1000, hound: 'right:400px;bottom:-40px;height:420px;width:auto;opacity:1' })));
  j.push(png(SOCIAL, 'github-org-avatar-500x500.png', 500, 500, avatar(500, 0.2)));
  j.push(png(SOCIAL, 'github-social-preview-1280x640.png', 1280, 640, wide({ w: 1280, h: 640, x0: 80, y: 84, lockW: 440, size: 66, gap: 56, max: 620, url: true, hound: 'right:60px;bottom:-26px;height:440px;width:auto' })));
  j.push(png(SOCIAL, 'producthunt-logo-240x240.png', 240, 240, avatar(240, 0.18)));
  // Product Hunt gallery (1270x760): the real report preview from the home page share image, with the headline
  const gal = '<div style="position:absolute;left:0;top:0;width:1200px;height:630px;transform:translate(-150px,40px) scale(1.28);transform-origin:0 0">' + art.doorDefs() + gen.VISUAL.home() + '</div>';
  j.push(png(SOCIAL, 'producthunt-gallery-1270x760.png', 1270, 760, art.shell(1270, 760, C.ink, 'body{background:' + C.ink + '}' + gen.visualCss(false).replace('.card{position:absolute;right:64px;top:92px', '.card{position:absolute;right:64px;top:92px'), '<div style="position:absolute;left:80px;top:150px">' + lock(380) + '<div style="font-family:Bricolage Grotesque;font-weight:800;letter-spacing:-0.045em;font-size:76px;line-height:1.0;color:#fff;margin-top:60px;max-width:520px">' + esc(COPY.headline) + '</div><div style="font-size:26px;color:' + C.soft + ';margin-top:26px;max-width:480px">Free. No email. About 30 seconds.</div></div><div style="position:absolute;right:40px;top:200px;width:560px;height:520px;overflow:visible"><div style="position:absolute;right:0;top:0;width:500px;transform:scale(1.2);transform-origin:100% 0">' + art.doorDefs() + gen.VISUAL.home().replace('class="card"', 'class="card" style="position:relative;right:auto;top:auto;width:440px"') + '</div></div>')));
  j.push(png(SOCIAL, 'post-square-1080x1080.png', 1080, 1080, post({ w: 1080, h: 1080, pad: 80, lockW: 360, size: 104, gap: 84, max: 800, headline: COPY.headline, sub: 'Free scan. No email.', hound: 'right:40px;bottom:-30px;height:430px;width:auto' })));
  j.push(png(SOCIAL, 'post-square-light-1080x1080.png', 1080, 1080, post({ w: 1080, h: 1080, pad: 80, lockW: 360, size: 104, gap: 84, max: 800, light: true, headline: COPY.headline, sub: 'Free scan. No email.', hound: 'right:40px;bottom:-30px;height:430px;width:auto' })));
  // story / vertical: no text in the top 250 px or the bottom 340 px (platform interface)
  j.push(png(SOCIAL, 'story-vertical-1080x1920.png', 1080, 1920, post({ w: 1080, h: 1920, pad: 80, lockW: 380, size: 120, gap: 90, max: 860, top: 250, headline: COPY.headline, sub: 'Free scan. No email.', bottom: 360, hound: 'right:30px;bottom:300px;height:560px;width:auto' })));
  j.push(png(SOCIAL, 'video-thumbnail-1280x720.png', 1280, 720, post({ w: 1280, h: 720, pad: 70, lockW: 330, size: 112, gap: 44, max: 760, headline: 'See how AI reads your site.', hound: 'right:40px;bottom:-34px;height:520px;width:auto' })));
  return jobs_dedupe(j);
}
const jobs_dedupe = (j) => j;

function make(argv) {
  const get = (k) => { const i = argv.indexOf('--' + k); return i === -1 ? null : argv[i + 1]; };
  const kind = get('kind') || 'post', out = get('out'), headline = get('headline');
  if (!out || !headline) { console.error('usage: make --kind post|story|thumb --headline "..." [--sub "..."] [--light] --out file.png'); process.exit(2); }
  const light = argv.includes('--light'), sub = get('sub') || '';
  const spec = { post: [1080, 1080, { pad: 80, lockW: 360, size: 104, gap: 84, max: 800, hound: 'right:40px;bottom:-30px;height:430px;width:auto' }], story: [1080, 1920, { pad: 80, lockW: 380, size: 120, gap: 90, max: 860, top: 250, bottom: 360, hound: 'right:30px;bottom:300px;height:560px;width:auto' }], thumb: [1280, 720, { pad: 70, lockW: 330, size: 112, gap: 44, max: 760, hound: 'right:40px;bottom:-34px;height:520px;width:auto' }] }[kind];
  if (!spec) { console.error('--kind must be post, story or thumb'); process.exit(2); }
  return [png(path.dirname(path.resolve(out)), path.basename(out), spec[0], spec[1], post(Object.assign({ w: spec[0], h: spec[1], light, headline, sub }, spec[2])))];
}

// --check: every file of every group exists with the size its template asks for (no browser needed), and the manifest and the ico are there
function check() {
  const errs = [];
  [].concat(logoJobs(), iconJobs(), listingJobs(), socialJobs()).forEach((j) => {
    if (!fs.existsSync(j.out)) { errs.push('missing ' + path.relative(ROOT, j.out)); return; }
    const b = fs.readFileSync(j.out);
    if (b.slice(1, 4).toString() !== 'PNG' || b.readUInt32BE(16) !== j.w || b.readUInt32BE(20) !== j.h) errs.push(path.relative(ROOT, j.out) + ' is not ' + j.w + 'x' + j.h + ' PNG');
  });
  ['favicon.ico', 'site.webmanifest', 'brand/social/README.md', 'brand/listing-icons/README.md', 'brand/brand.json'].forEach((f) => { if (!fs.existsSync(path.join(ROOT, f))) errs.push('missing ' + f); });
  if (errs.length) { errs.forEach((e) => console.error('FAIL: ' + e)); return 1; }
  console.log('OK: the logo PNGs, icons, listing icons and social pack exist at the sizes their templates ask for');
  return 0;
}

async function main() {
  if (process.argv.includes('--check')) process.exit(check());
  const arg = process.argv[2];
  if (arg === 'make') return art.render(make(process.argv.slice(3)));
  const groups = (arg || 'logo,icons,listing,social').split(',');
  let jobs = [];
  if (groups.includes('logo')) jobs = jobs.concat(logoJobs());
  if (groups.includes('icons')) jobs = jobs.concat(iconJobs());
  if (groups.includes('listing')) jobs = jobs.concat(listingJobs());
  if (groups.includes('social')) jobs = jobs.concat(socialJobs());
  await art.render(jobs);
  if (groups.includes('icons')) writeIco();
}

if (require.main === module) main().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
