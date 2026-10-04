#!/usr/bin/env node
/* =====================================================================
   scripts/test-own-site.js

   The scanner's own checks, run on our page files with lib/scanner.js, must
   equal what the frozen crawl (content/pro/sample-report.json) recorded for
   the same pages: same total, same pass or fail on every check. The crawl read
   the live site and this reads the files, so a difference means the files
   changed after the crawl or the live site differs from the repository.

   /sample-report is left out: it is generated from the crawl it reports on.
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
  if (sameTotal && !diffs.length) pass++; else fails.push(name + ': file scores ' + mine.total + ', crawl recorded ' + p.result.total + (diffs.length ? '; differs on ' + diffs.join(', ') : ''));
});
console.log(pass + ' pages: the scanner\'s checks on the files equal the crawl' + (fails.length ? '; ' + fails.length + ' differ' : ''));
if (fails.length) { console.error(fails.join('\n')); process.exit(1); }
