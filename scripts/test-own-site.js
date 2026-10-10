#!/usr/bin/env node
/* =====================================================================
   scripts/test-own-site.js

   The scanner's own checks, run on our page files with lib/scanner.js, must
   equal what the frozen crawl (content/pro/sample-report.json) recorded for
   the same pages: same total, same pass or fail on every check. The crawl read
   the live site and this reads the files, so a difference means the files
   changed after the crawl or the live site differs from the repository.

   /sample-report is left out: it is generated from the crawl it reports on.

   Pages edited on purpose after the crawl (4 October 2026) are listed in CHANGED_AFTER_CRAWL with the
   exact checks that differ and the commit that changed them. Each entry must still match exactly: the
   file must score higher than the crawl, differ on those checks and no others. An entry that stops
   matching fails, so the list cannot hide a regression, and a page that is not listed must equal the crawl.
   The frozen crawl itself is never edited: it is the published sample.
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const scanner = require('../lib/scanner.js');
const ROOT = path.resolve(__dirname, '..');
const crawl = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/pro/sample-report.json'), 'utf8'));

function fileFor(url) {
  const p = new URL(url).pathname.replace(/\/$/, '');
  if (p === '') return 'index.html';
  const direct = p.slice(1) + '.html';
  if (fs.existsSync(path.join(ROOT, direct))) return direct;
  const idx = p.slice(1) + '/index.html';
  return fs.existsSync(path.join(ROOT, idx)) ? idx : null;
}
const clean = (l) => l.replace(/\s*\(\d+\/\d+ open\)\s*$/, '');
// Pages that gained headings or structured data after the frozen crawl, on purpose.
const CHANGED_AFTER_CRAWL = {
  '/tools': { checks: ['Content schema (Article, FAQ…)', 'Subheading structure (H2)'], commit: 'c2ad178 (tools/index.html rebuilt as a marketing page)' },
  '/tools/robots-txt': { checks: ['Subheading structure (H2)'], commit: 'f3d614a (tool pages polished: intro, how it works, FAQ)' }
};
let pass = 0; const fails = [];
const ctx = crawl.siteContext;
crawl.pages.filter((p) => p.status === 'ok').forEach(function (p) {
  const rel = fileFor(p.url);
  const name = new URL(p.url).pathname || '/';
  if (name === '/sample-report') return;
  if (!rel) { fails.push(name + ': no file for this page'); return; }
  const sig = scanner.parseSignals(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const mine = scanner.scoreAll(ctx.robotsOk, ctx.llmsOk, ctx.sitemapOk, ctx.botResults, sig);
  const sameTotal = mine.total === p.result.total;
  const diffs = mine.checks.filter((c) => { const r = p.result.checks.filter((x) => clean(x.label) === clean(c.label))[0]; return !r || r.ok !== c.ok; }).map((c) => c.label);
  const allowed = CHANGED_AFTER_CRAWL[name];
  if (allowed) {
    const expected = allowed.checks.slice().sort().join('|');
    if (!sameTotal && mine.total > p.result.total && diffs.slice().sort().join('|') === expected) pass++;
    else fails.push(name + ': listed as changed after the crawl (' + allowed.commit + ') but the file now scores ' + mine.total + ' against ' + p.result.total + ' and differs on [' + diffs.join(', ') + '], not exactly [' + allowed.checks.join(', ') + ']');
    return;
  }
  if (sameTotal && !diffs.length) pass++; else fails.push(name + ': file scores ' + mine.total + ', crawl recorded ' + p.result.total + (diffs.length ? '; differs on ' + diffs.join(', ') : ''));
});
Object.keys(CHANGED_AFTER_CRAWL).forEach((n) => { if (!crawl.pages.some((p) => p.status === 'ok' && (new URL(p.url).pathname || '/') === n)) fails.push(n + ': listed in CHANGED_AFTER_CRAWL but not in the crawl'); });
console.log(pass + ' pages: the scanner\'s checks on the files equal the crawl (' + Object.keys(CHANGED_AFTER_CRAWL).length + ' of them edited on purpose since, each checked exactly)' + (fails.length ? '; ' + fails.length + ' differ' : ''));
if (fails.length) { console.error(fails.join('\n')); process.exit(1); }
