#!/usr/bin/env node
/* =====================================================================
   scripts/apply-og.js: writes the share-image tags (lib/og.js: og:image and its size, type and alt, twitter:card, twitter:image and its alt) into every public page,
   and checks them. The generated pages get the same tags from their generators; this script covers the hand-written pages and verifies all of them.

     node scripts/apply-og.js          write the tags into the pages that need them
     node scripts/apply-og.js --check  fail if any page has other tags, a missing image file or a URL that is not absolute https
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const og = require('../lib/og.js');

const ROOT = path.resolve(__dirname, '..');
const CHECK = process.argv.includes('--check');

const pages = cp.execSync('git ls-files "*.html"', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
  .filter((f) => !/^(r|app)\//.test(f));

const pathOf = (f) => '/' + f.replace(/(^|\/)index\.html$/, '').replace(/\.html$/, '');

let bad = 0, changed = 0;
for (const f of pages) {
  const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (!/<meta property="og:url"/.test(html)) continue;
  const p = pathOf(f) === '/' ? '/' : pathOf(f).replace(/\/$/, '');
  const next = og.apply(html, p);
  if (next !== html) {
    if (CHECK) { console.log('FAIL: ' + f + ' has the wrong share-image tags; run node scripts/apply-og.js'); bad++; } else { fs.writeFileSync(path.join(ROOT, f), next, 'utf8'); changed++; }
  }
  const i = og.info(p);
  if (!fs.existsSync(path.join(ROOT, 'assets', 'brand', i.file))) { console.log('FAIL: ' + f + ' names ' + i.file + ', which does not exist'); bad++; }
}
if (CHECK) console.log(bad ? 'FAIL: ' + bad + ' problem(s)' : 'OK: ' + pages.length + ' pages carry the share-image tags of lib/og.js (absolute URLs, size, type, alt, summary_large_image)');
else console.log('updated ' + changed + ' page(s)');
process.exit(bad ? 1 : 0);
