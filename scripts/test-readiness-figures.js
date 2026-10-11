#!/usr/bin/env node
/* =====================================================================
   scripts/test-readiness-figures.js: the figures of the State of AI Readiness page and email against the stored benchmark data.

   content/readiness.json lists every figure the public page uses, each with the path of the number it comes from in
   local/launch-report/stats.json (written by scripts/launch-report-stats.js from the raw crawl files, which are not in the repository). When that
   file is present each figure is recomputed and compared; a figure that does not match fails. When it is absent (a clean clone, CI) that part is
   skipped and says so, and the checks that need only the repository still run: the data is the July 2026 snapshot (not the 2 October rescan), the
   page shows every listed figure, the shown strings are consistent with the values, and nothing on the page names a scanned site.

     node scripts/test-readiness-figures.js
     READINESS_STATS=/path/to/stats.json node scripts/test-readiness-figures.js
   To check the PDF's own text too, see scripts/verify-readiness-pdf.js.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const content = require('../content/readiness.json');
let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

function dig(obj, p) { return p.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj); }
const round = (x, d) => Math.round((x + 1e-9) * Math.pow(10, d)) / Math.pow(10, d);

const statsFile = process.env.READINESS_STATS || path.join(ROOT, 'local', 'launch-report', 'stats.json');
if (fs.existsSync(statsFile)) {
  const s = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
  content.figures.forEach((f) => {
    let v = dig(s, f.path);
    if (typeof v === 'number' && f.round !== undefined) v = round(v, f.round);
    t('figure "' + f.label + '" is ' + f.value + ' in the stored data (' + f.path + ')', v === f.value, 'the data says ' + v);
  });
  t('the scan window in the content file is the data\'s own', content.sample.scanWindow === '29 to 31 July 2026' && dig(s, 'meta.scanWindow.from') === '2026-07-29' && dig(s, 'meta.scanWindow.to') === '2026-07-31');
  t('the sample counts are the data\'s own', dig(s, 'overall.n') === content.sample.scored && dig(s, 'access.attempted') === content.sample.attempted && dig(s, 'access.notScored') === content.sample.notScored && (dig(s, 'access.notScoredShare.pct') + '%') === content.sample.notScoredPct);
  t('the data has no October rescan in it (only the July scans)', JSON.stringify(dig(s, 'meta.scanDates')).indexOf('2026-10') === -1);
} else {
  out('  skipped: ' + path.relative(ROOT, statsFile) + ' is not here (the raw crawl files and the figures built from them are not in the repository). Run it where local/ exists.');
}

// What needs only the repository.
t('every figure has a path, a shown string and a value', content.figures.every((f) => f.path && typeof f.shown === 'string' && f.value !== undefined));
const page = fs.readFileSync(path.join(ROOT, 'research', 'state-of-ai-readiness.html'), 'utf8').replace(/<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
t('the page shows every listed figure', content.figures.every((f) => page.indexOf(f.shown) !== -1), content.figures.filter((f) => page.indexOf(f.shown) === -1).map((f) => f.label).join(', '));
t('the page dates every finding to the July scans and cites no October rescan', content.findings.every((f) => /Scanned 29 to 31 July 2026/.test(f.date)) && !/rescan|2 October|October 2026 scan/i.test(page));
t('the headline numbers read the same wherever they are written (73 out of 100, 76 against 69, 6.4%, 76.7%)', /73 out of 100/.test(page) && /76 against 69/.test(page) && /\(6\.4%\)/.test(page) && /76\.7%/.test(page));
const names = ['hubspot', 'salesforce', 'shopify', 'notion', 'stripe', 'allbirds', 'magic spoon', 'airbnb', 'booking.com'];
t('the page names no scanned site', !names.some((n) => page.toLowerCase().indexOf(n) !== -1));
t('the page does not claim a link between a score and citations, answers or traffic', !/(higher|better|lower) (scores?|readiness)[^.]{0,60}(cited|citations|answers|traffic)/i.test(page));

out('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
