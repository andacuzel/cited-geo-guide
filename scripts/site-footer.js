#!/usr/bin/env node
/* =====================================================================
   scripts/site-footer.js: one footer on every public page (the markup is in lib/site-footer.js).

     node scripts/site-footer.js            put the canonical footer into every hand-written page (the generated pages get it from their generators)
     node scripts/site-footer.js --check    exit 1 if any page has a different footer, if a footer link points at a page that does not exist, or if the
                                            footer links to a page the owner took out of it (/changelog)

   Covered: every tracked .html page that is deployed, plus the start page of Pro (app/pro-start.html, whose small own footer is replaced). The report
   and start pages the function writes (lib/pro-report-page.js) call the same code. Not covered, on purpose: the encrypted private report under /r/<24 hex>/
   (a standalone file whose bytes are not touched) and the two internal pages that are not deployed (app/crawl.html, app/report.html).
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const footer = require('../lib/site-footer.js');

const ROOT = path.resolve(__dirname, '..');
const SKIP = /^(app\/crawl\.html|app\/report\.html|r\/)/;
const START_PAGE = 'app/pro-start.html';

function pages() {
  return cp.execSync('git ls-files "*.html"', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean).filter((f) => !SKIP.test(f));
}

function expected(rel, s) {
  if (rel === START_PAGE) return s.replace(/([ \t]*)<footer class="ps-foot">[\s\S]*?<\/footer>|([ \t]*)<footer class="site-footer"[\s\S]*?<\/footer>/, (m, a, b) => { const ind = a !== undefined ? a : b; return ind + footer.html(ind); });
  return footer.normalize(s);
}

// Every address the footer links to must be a page of this site (a file, an index.html or a clean URL) or a mailto.
function missingTargets() {
  const tracked = new Set(pages().concat(['404.html']));
  const bad = [];
  footer.hrefs().forEach((h) => {
    if (/^mailto:/.test(h)) return;
    const p = h === '/' ? 'index.html' : h.replace(/^\//, '');
    if (!(tracked.has(p + '.html') || tracked.has(p) || tracked.has(p + '/index.html'))) bad.push(h);
  });
  return bad;
}

function main() {
  const check = process.argv.indexOf('--check') !== -1;
  const problems = []; let changed = 0;
  pages().forEach((rel) => {
    const file = path.join(ROOT, rel);
    const s = fs.readFileSync(file, 'utf8');
    if (!/<footer class="(site-footer|ps-foot)/.test(s)) { problems.push(rel + ': no footer'); return; }
    const next = expected(rel, s);
    if (next !== s) { if (check) problems.push(rel + ': the footer is not the canonical one (node scripts/site-footer.js)'); else { fs.writeFileSync(file, next, 'utf8'); changed++; } }
  });
  missingTargets().forEach((h) => problems.push('the footer links to ' + h + ', which is not a page of this site'));
  if (footer.hrefs().some((h) => /changelog/.test(h))) problems.push('the footer must not link to /changelog');
  if (check) {
    if (problems.length) { console.error('FAIL:\n  ' + problems.join('\n  ')); process.exit(1); }
    console.log('OK: ' + pages().length + ' pages carry the one footer; every link in it is a page that exists');
    return;
  }
  if (problems.length) { console.error('Problems:\n  ' + problems.join('\n  ')); process.exit(1); }
  console.log('Footer written to ' + changed + ' page(s).');
}

if (require.main === module) main();
module.exports = { pages: pages, expected: expected, missingTargets: missingTargets };
