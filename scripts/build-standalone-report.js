#!/usr/bin/env node
/* =====================================================================
   scripts/build-standalone-report.js: the Pro report layout as one self-contained HTML file.

   scripts/encrypt-report.js takes a self-contained page (CSS, script, fonts and icons inlined, no
   external request). This builds one from a crawl result with the same renderer the Pro report
   page and the public sample use (lib/report-render.js renderPro), so a private report, a Pro
   report and the sample look and read the same.

     node scripts/build-standalone-report.js <crawl.json> <out.html> [--fonts <fonts.css>] [--label "Private report"] [--no-fonts]

   <crawl.json> is a crawl result: { domain, createdAt, pages, siteContext, discovery, summary }.
   --fonts is a CSS file with the fonts embedded as data: URIs (kept outside the repository); without
   it, or --no-fonts, the page falls back to system fonts. As a module:

     const { standalone } = require('./build-standalone-report.js');
     standalone(data, { label, fonts, bannerHtml, detailsExtra, citation, title }) -> html string

   Nothing here reads or writes anything but the files named.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const render = require('../lib/report-render.js');
const schema = require('../lib/schema.js');
const Estimate = require('../lib/pro-estimate.js');

const ROOT = path.resolve(__dirname, '..');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function script(file) {
  const s = fs.readFileSync(path.join(ROOT, file), 'utf8');
  if (/<\/script/i.test(s)) throw new Error(file + ' contains </script');
  return s;
}

// opts: { label, title, fonts (css text), cap, bannerHtml, detailsExtra, citation, notice, extraCss }
function standalone(data, opts) {
  opts = opts || {};
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  if (/url\(\s*['"]?https?:|@import/.test(css)) throw new Error('styles.css loads an external resource');
  const favicon = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(ROOT, 'assets', 'brand', 'favicon.svg')).toString('base64');
  const body = render.renderPro(data, {
    schema: schema, estimate: Estimate.estimate(data), cap: opts.cap || 25, label: opts.label || 'Private report', homeHref: opts.homeHref || 'https://getcitehound.com/',
    bannerHtml: opts.bannerHtml, detailsExtra: opts.detailsExtra, citation: opts.citation, notice: opts.notice, actions: { copy: false, print: true }
  });
  const title = opts.title || ('Citehound: ' + (opts.label || 'Private report'));
  const html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    '  <title>' + esc(title) + '</title>\n  <meta name="robots" content="noindex, nofollow, noarchive" />\n  <meta name="referrer" content="no-referrer" />\n' +
    '  <link rel="icon" href="' + favicon + '" type="image/svg+xml" />\n' +
    (opts.fonts ? '  <style>\n' + opts.fonts + '\n</style>\n' : '') +
    '  <style>\n' + css + '\n</style>\n' + (opts.extraCss ? '  <style>\n' + opts.extraCss + '\n</style>\n' : '') + '</head>\n' +
    '<body class="pr-body">\n  <a class="skip-link" href="#main">Skip to content</a>\n  <main id="main">\n' + body.replace(/\n$/, '') + '\n  </main>\n' +
    '  <div class="toast" id="toast" role="status" aria-live="polite"></div>\n  <script>\n' + script('lib/report-pro-ui.js') + '\n</script>\n</body>\n</html>\n';
  if (/(?:src|href)=["']https?:/i.test(html.replace(/<a [^>]*href=["']https?:[^>]*>/gi, ''))) throw new Error('the page makes an external request');
  return html;
}

function main() {
  const args = process.argv.slice(2);
  const val = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1]; };
  const files = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
  if (files.length !== 2) { console.error('usage: node scripts/build-standalone-report.js <crawl.json> <out.html> [--fonts <fonts.css>] [--label <text>] [--no-fonts]'); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(files[0], 'utf8'));
  const fontsFile = val('--fonts');
  if (!fontsFile && args.indexOf('--no-fonts') === -1) console.error('No --fonts file: the page will use system fonts.');
  const html = standalone(data, { label: val('--label') || 'Private report', fonts: fontsFile ? fs.readFileSync(fontsFile, 'utf8') : null });
  fs.writeFileSync(files[1], html, 'utf8');
  console.log(files[1] + ' written (' + html.length + ' bytes); self-contained, ready for scripts/encrypt-report.js');
}

if (require.main === module) main();
module.exports = { standalone: standalone };
