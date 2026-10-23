/* =====================================================================
   scripts/brand/art.js: shared pieces of the brand image scripts (generate-og.js, generate-brand-assets.js): colours, the local fonts, the logo files as data URIs,
   a page shell and the renderer. Everything is local: fonts are read from assets/fonts through file:// URLs, no network. Playwright is not a dependency of the site
   (see CLAUDE.md): NODE_PATH=<folder with playwright>/node_modules, and CHROME_PATH=<a Chromium that Playwright did not install> if needed.
   ===================================================================== */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BRAND = path.join(ROOT, 'assets', 'brand');
const C = { ink: '#0E1B2C', ink2: '#15263B', paper: '#F4F4F0', white: '#FFFFFF', orange: '#F05A28', orangeSoft: '#FFAE92', orangeDeep: '#B23A10', soft: '#DADFE6', faint: '#566376', ok: '#1B7A4E', amber: '#E0A100', risk: '#B42318' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const uri = (file) => 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(BRAND, file)).toString('base64');
const fontUrl = (f) => 'file://' + path.join(ROOT, 'assets', 'fonts', f);

function fontCss() {
  return '@font-face{font-family:"Bricolage Grotesque";font-weight:200 800;src:url(' + fontUrl('bricolage-grotesque-wght-latin.woff2') + ') format("woff2")}' +
    '@font-face{font-family:"Hanken Grotesk";font-weight:400 700;src:url(' + fontUrl('hanken-grotesk-normal-latin.woff2') + ') format("woff2")}' +
    '@font-face{font-family:"Spline Sans Mono";font-weight:400 500;src:url(' + fontUrl('spline-sans-mono-normal-latin.woff2') + ') format("woff2")}';
}

const BASE_CSS = 'html,body{margin:0;overflow:hidden}*{box-sizing:border-box}body{position:relative;font-family:"Hanken Grotesk",sans-serif;color:' + C.ink + '}' +
  '.d{font-family:"Bricolage Grotesque",sans-serif;font-weight:800;letter-spacing:-0.04em}.m{font-family:"Spline Sans Mono",monospace}';

function shell(w, h, bg, css, body) {
  return '<!doctype html><html><head><meta charset="utf-8"><style>' + fontCss() + BASE_CSS + 'html,body{width:' + w + 'px;height:' + h + 'px;background:' + bg + '}' + css + '</style></head><body>' + body + '</body></html>';
}

// the ten crawler doors of the report preview (functional icons: open, limited, blocked)
function doorDefs() {
  const frame = '<path fill="' + C.ink + '" fill-rule="evenodd" d="M2 40V15a13 13 0 0 1 26 0v25ZM7 40h16V15.5a8 8 0 0 0-16 0Z"/>';
  return '<svg width="0" height="0" style="position:absolute"><defs>' +
    '<symbol id="door-open" viewBox="0 0 30 40"><path fill="' + C.ok + '" d="M7 40V15.5a8 8 0 0 1 16 0V40Z"/>' + frame + '</symbol>' +
    '<symbol id="door-limited" viewBox="0 0 30 40"><path fill="' + C.paper + '" d="M7 40V15.5a8 8 0 0 1 16 0V40Z"/><path fill="' + C.amber + '" d="M7 40V16.3c0-2 1.1-3.6 3-4.4L16 9.6V36Z"/>' + frame + '</symbol>' +
    '<symbol id="door-blocked" viewBox="0 0 30 40"><path fill="' + C.risk + '" d="M7 40V15.5a8 8 0 0 1 16 0V40Z"/>' + frame + '</symbol></defs></svg>';
}

async function launch() {
  let pw;
  try { pw = require('playwright'); } catch (e) { console.error('playwright is not installed. Set NODE_PATH to a node_modules folder that has it (see the header of scripts/brand/art.js).'); process.exit(1); }
  return pw.chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
}

// jobs: [{ out: absolute path, w, h, html, transparent? }]. Writes PNG files.
async function render(jobs) {
  const browser = await launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  for (const j of jobs) {
    const p = await ctx.newPage();
    await p.setViewportSize({ width: j.w, height: j.h });
    const tmp = path.join(os.tmpdir(), 'citehound-art-' + path.basename(j.out).replace(/\.png$/, '.html'));
    fs.writeFileSync(tmp, j.html);
    await p.goto('file://' + tmp, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    fs.mkdirSync(path.dirname(j.out), { recursive: true });
    await p.screenshot({ path: j.out, clip: { x: 0, y: 0, width: j.w, height: j.h }, omitBackground: !!j.transparent });
    await p.close();
    fs.unlinkSync(tmp);
    console.log('wrote ' + path.relative(ROOT, j.out) + ' ' + j.w + 'x' + j.h + ' ' + Math.round(fs.statSync(j.out).size / 1024) + ' KB');
  }
  await browser.close();
}

module.exports = { ROOT, BRAND, C, esc, uri, fontCss, shell, doorDefs, render };
