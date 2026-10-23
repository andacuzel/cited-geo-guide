#!/usr/bin/env node
/* =====================================================================
   scripts/generate-readiness-cover.js: the cover picture of the State of AI Readiness report that /research/state-of-ai-readiness shows (480 PNG, 480 and 960 WebP),
   drawn in the brand's current look (the hound, Bricolage Grotesque, ink and orange). The words are the cover's own words (content/readiness.json and the report's cover).
   The gated PDF itself lives only in the database (docs/readiness.md); this picture and the PDF should match: re-export the PDF with the same cover, then upload it with
   node scripts/pro-admin.js readiness-upload <file>.

     NODE_PATH=<folder with playwright>/node_modules [CHROME_PATH=<chromium>] node scripts/generate-readiness-cover.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const art = require('./brand/art.js');
const { C, esc, uri, ROOT } = art;

const OUT = path.join(ROOT, 'assets', 'research');
const W = 480, H = 686;

function html(scale) {
  const css = 'body{background:' + C.ink + ';color:#fff;zoom:' + scale + ';width:' + W + 'px;height:' + H + 'px;padding:46px 46px 0}' +
    '.lk{width:150px;height:auto;display:block}' +
    '.k{font-weight:700;font-size:12.5px;color:' + C.orangeSoft + ';margin-top:150px}' +
    '.t{font-family:"Bricolage Grotesque";font-weight:800;letter-spacing:-0.04em;font-size:54px;line-height:0.98;margin-top:14px}' +
    '.s{font-size:15px;line-height:1.45;color:' + C.soft + ';margin-top:22px;max-width:380px}' +
    '.bar{width:52px;height:4px;background:' + C.orange + ';margin-top:30px}' +
    '.meta{position:absolute;left:46px;right:46px;bottom:62px;border-top:2px solid rgba(255,255,255,.16);padding-top:18px;display:grid;grid-template-columns:auto auto 1fr;gap:20px}' +
    '.meta small{display:block;white-space:nowrap;font-size:11px;font-weight:700;color:' + C.orangeSoft + ';margin-bottom:4px}.meta b{font-size:12px;font-weight:600;white-space:nowrap;line-height:1.35}' +
    '.hd{position:absolute;right:30px;top:420px;height:96px;width:auto}' +
    '.f{position:absolute;left:46px;right:46px;bottom:22px;font-size:10.5px;line-height:1.4;color:#98A1AE}';
  return art.shell(W * scale, H * scale, C.ink, css, '<img class="lk" src="' + uri('logo-lockup-dark.svg') + '" alt=""><img class="hd" src="' + uri('logo-mark-orange.svg') + '" alt="">' +
    '<div class="k">Benchmark report · Launch Edition 2026</div><div class="t">State of AI Readiness</div>' +
    '<div class="s">How ready are 219 well-known websites for AI crawlers and assistants? A benchmark across six categories, scanned 29–31 July 2026.</div><div class="bar"></div>' +
    '<div class="meta"><div><small>Published by</small><b>Citehound</b></div><div><small>Edition</small><b>Launch Edition 2026</b></div><div><small>Data</small><b>219 scored sites · 29–31 July 2026</b></div></div>' +
    '<div class="f">Citehound measures AI readiness (access and on-page signals), not whether any assistant names or cites a site. getcitehound.com</div>');
}

function check() {
  const png = path.join(OUT, 'state-of-ai-readiness-cover-480.png'), errs = [];
  if (!fs.existsSync(png)) errs.push('missing the 480 PNG'); else { const b = fs.readFileSync(png); if (b.readUInt32BE(16) !== W || b.readUInt32BE(20) !== H) errs.push('the PNG is not ' + W + 'x' + H); }
  ['480', '960'].forEach((n) => { const f = path.join(OUT, 'state-of-ai-readiness-cover-' + n + '.webp'); if (!fs.existsSync(f) || fs.readFileSync(f).slice(8, 12).toString() !== 'WEBP') errs.push('missing or not WebP: ' + n); });
  if (errs.length) { errs.forEach((e) => console.error('FAIL: ' + e)); return 1; }
  console.log('OK: the report cover pictures exist (480 PNG, 480 and 960 WebP)');
  return 0;
}

async function main() {
  if (process.argv.includes('--check')) process.exit(check());
  const jobs = [{ out: path.join(OUT, 'state-of-ai-readiness-cover-480.png'), w: W, h: H, html: html(1) }, { out: path.join(OUT, '_cover-960.png'), w: W * 2, h: H * 2, html: html(2) }];
  await art.render(jobs);
  const browser = await art.launch(), page = await browser.newPage();
  const webp = async (png, out, w, h) => {
    const b64 = fs.readFileSync(png).toString('base64');
    const data = await page.evaluate(async ([b64, w, h]) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); return c.toDataURL('image/webp', 0.9).split(',')[1]; }, [b64, w, h]);
    fs.writeFileSync(out, Buffer.from(data, 'base64')); console.log('wrote ' + path.relative(ROOT, out));
  };
  await webp(path.join(OUT, '_cover-960.png'), path.join(OUT, 'state-of-ai-readiness-cover-960.webp'), W * 2, H * 2);
  await webp(path.join(OUT, '_cover-960.png'), path.join(OUT, 'state-of-ai-readiness-cover-480.webp'), W, H);
  fs.unlinkSync(path.join(OUT, '_cover-960.png'));
  await browser.close();
}
if (require.main === module) main().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
