#!/usr/bin/env node
/* =====================================================================
   scripts/add-footer-links.js

   Puts the Trust and Changelog links in the footer nav of every page, right
   after "Citation tracking", in each page's own indentation. Idempotent.
   Pages generated from about.html's footer (pro, sample report, playbooks,
   citation tracking) pick the links up when regenerated, so run this first
   on about.html or just run it over everything and regenerate.

   The two research reports and the case study are protected (never modified
   in this build), so they are skipped and named in the output.

     node scripts/add-footer-links.js           add the links
     node scripts/add-footer-links.js --check   exit 1 if a page lacks them
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PROTECTED = ['research/case-study-agaone.html', 'research/llms-txt-adoption-2026.html'];
const LINKS = [['/trust', 'Trust'], ['/changelog', 'Changelog']];
const SKIP_DIRS = ['node_modules', '.git', 'local', '.claude', 'asset', 'data', 'supabase', 'content', 'lib', 'api', 'scripts', 'docs', 'plugin', 'assets', 'config', '.well-known'];

function htmlFiles() {
  const out = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      if (SKIP_DIRS.indexOf(e.name) !== -1) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else if (e.name.endsWith('.html')) out.push(path.relative(ROOT, p));
    });
  }(ROOT));
  return out.sort();
}

const hasLink = (s, href) => new RegExp('<nav class="site-nav footer-links"[\\s\\S]*?href="' + href + '"[\\s\\S]*?</nav>').test(s);

function apply(s) {
  const missing = LINKS.filter((l) => !hasLink(s, l[0]));
  if (!missing.length) return s;
  return s.replace(/(<nav class="site-nav footer-links"[\s\S]*?)([ \t]*)(<a href="\/citation-tracking" class="site-nav__link">Citation tracking<\/a>\n)/, (m, before, pad, line) => before + pad + line + missing.map((l) => pad + '<a href="' + l[0] + '" class="site-nav__link">' + l[1] + '</a>\n').join(''));
}

function main() {
  const check = process.argv.indexOf('--check') !== -1;
  const files = htmlFiles().filter((f) => PROTECTED.indexOf(f) === -1);
  const problems = [];
  let changed = 0;
  files.forEach((rel) => {
    const file = path.join(ROOT, rel);
    const s = fs.readFileSync(file, 'utf8');
    if (!/class="site-nav footer-links"/.test(s)) return;   // app pages have no footer
    if (check) { LINKS.forEach((l) => { if (!hasLink(s, l[0])) problems.push(rel + ': footer has no ' + l[1] + ' link'); }); return; }
    const next = apply(s);
    if (next !== s) { fs.writeFileSync(file, next, 'utf8'); changed++; }
  });
  if (check) {
    if (problems.length) { console.error('FAIL:\n  ' + problems.join('\n  ')); process.exit(1); }
    console.log('OK: Trust and Changelog are in the footer of every page except the protected reports (' + PROTECTED.join(', ') + ')');
    return;
  }
  console.log('Footer links added to ' + changed + ' page(s). Skipped (protected): ' + PROTECTED.join(', '));
}

if (require.main === module) main();
module.exports = { htmlFiles, PROTECTED, LINKS };
