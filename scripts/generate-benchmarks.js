#!/usr/bin/env node
/* =====================================================================
   scripts/generate-benchmarks.js

   Reads data/benchmarks.json (which categories appear, how they're
   labelled) plus each matching data/<category>-summary.json (the
   actual numbers, produced by scripts/scan-category.js), and rewrites
   the static HTML block in index.html between:

     <!-- BENCHMARKS:START -->
     <!-- BENCHMARKS:END -->

   — a compact band just above the footer (a big Gloock overall average
   plus a dense inline row per category), creating the markers there if
   they're missing. Re-running is safe — it replaces the block in
   place, never duplicates it.

   No figure here is hand-typed: averages, sample sizes and the total
   scanned count all come from the summary files at generation time.

   Usage:
     node scripts/generate-benchmarks.js
   ===================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const BENCHMARKS_JSON = path.join(DATA_DIR, 'benchmarks.json');
const INDEX_HTML = path.join(ROOT, 'index.html');

const START_MARKER = '<!-- BENCHMARKS:START -->';
const END_MARKER = '<!-- BENCHMARKS:END -->';

// Fixed across the site — matches the research report template
// (styles.css: "B2B SaaS is always --navy-800, consumer brands are
// always --gold. Do not remix these per report.").
const TRACK_FILL_CLASS = {
  'B2B SaaS': 'benchmark-strip__cat-fill--saas',
  'Consumer & e-commerce': 'benchmark-strip__cat-fill--consumer'
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function loadBenchmarkEntries() {
  if (!fs.existsSync(BENCHMARKS_JSON)) {
    throw new Error('data/benchmarks.json not found.');
  }
  const entries = JSON.parse(fs.readFileSync(BENCHMARKS_JSON, 'utf8'));
  if (!Array.isArray(entries)) {
    throw new Error('data/benchmarks.json must be a JSON array of category entries.');
  }
  return entries;
}

function loadSummary(category) {
  const p = path.join(DATA_DIR, category + '-summary.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Resolves each benchmarks.json entry against its summary file.
// Returns { rows, errors } — errors are fatal (caller exits non-zero
// without touching index.html) rather than silently publishing a
// category with no real data behind it.
function buildRows(entries) {
  const rows = [];
  const errors = [];

  entries.forEach(function (entry) {
    const category = entry && entry.category;
    if (!category || !entry.label || !entry.track) {
      errors.push('Entry ' + JSON.stringify(entry) + ' is missing category/label/track.');
      return;
    }
    if (!TRACK_FILL_CLASS[entry.track]) {
      errors.push('"' + category + '" has unknown track "' + entry.track + '" (expected "B2B SaaS" or "Consumer & e-commerce").');
      return;
    }
    const summary = loadSummary(category);
    if (!summary || !summary.score || typeof summary.score.average !== 'number' || !summary.scanned) {
      errors.push('"' + category + '" has no usable data/' + category + '-summary.json — run scripts/scan-category.js first.');
      return;
    }
    rows.push({
      category: category,
      label: entry.label,
      track: entry.track,
      note: entry.note || '',
      average: summary.score.average,
      scanned: summary.scanned
    });
  });

  rows.sort(function (a, b) { return b.average - a.average; });
  return { rows: rows, errors: errors };
}

function renderCat(row) {
  const fillClass = TRACK_FILL_CLASS[row.track];
  const width = Math.max(0, Math.min(100, row.average));
  return (
    '            <span class="benchmark-strip__cat">\n' +
    '              <span class="benchmark-strip__cat-name">' + esc(row.label) + '</span>\n' +
    '              <span class="benchmark-strip__cat-bar"><span class="benchmark-strip__cat-fill ' + fillClass + '" style="width:' + width + '%"></span></span>\n' +
    '              <span class="benchmark-strip__cat-score">' + row.average + '</span>\n' +
    '            </span>'
  );
}

function renderBlock(rows) {
  const totalSites = rows.reduce(function (sum, r) { return sum + r.scanned; }, 0);
  const totalCategories = rows.length;
  // Weighted by sample size so this represents the average across
  // every scanned site, not an average of category averages.
  const overallAverage = totalSites === 0 ? 0 : Math.round(
    rows.reduce(function (sum, r) { return sum + r.average * r.scanned; }, 0) / totalSites
  );

  const sentence = 'We’ve scanned ' + totalSites + ' sites across ' + totalCategories +
    ' categor' + (totalCategories === 1 ? 'y' : 'ies') + '. The average is ' + overallAverage + '/100.';

  const catsHtml = rows.map(renderCat).join('\n');

  const stats = JSON.stringify({
    totalSites: totalSites,
    totalCategories: totalCategories,
    overallAverage: overallAverage
  });

  return (
    START_MARKER + '\n' +
    '      <section class="benchmark-strip" aria-labelledby="benchmark-heading">\n' +
    '        <div class="section__inner">\n' +
    '          <div class="benchmark-strip__top">\n' +
    '            <div class="benchmark-strip__avg">' + overallAverage + '<small>/100</small></div>\n' +
    '            <div class="benchmark-strip__summary">\n' +
    '              <h2 id="benchmark-heading" class="benchmark-strip__text">' + esc(sentence) + '</h2>\n' +
    '              <a href="/methodology" class="benchmark-strip__link">Read the methodology</a>\n' +
    '            </div>\n' +
    '          </div>\n' +
    '          <div class="benchmark-strip__cats">\n' +
    catsHtml + '\n' +
    '          </div>\n' +
    '        </div>\n' +
    '      </section>\n' +
    '      <script>window.ANSWERABLE_BENCHMARKS = ' + stats + ';</script>\n' +
    '      ' + END_MARKER
  );
}

// Replaces content between existing markers. If the markers are
// missing (e.g. a fresh checkout that never had them), inserts a fresh
// pair just above the footer — that's the band's permanent home —
// falling back to right before </main> if no footer is found either.
function spliceIntoIndex(html, block) {
  const startIdx = html.indexOf(START_MARKER);
  const endIdx = html.indexOf(END_MARKER);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return html.slice(0, startIdx) + block + html.slice(endIdx + END_MARKER.length);
  }

  const footerRe = /<footer class="site-footer"/;
  if (footerRe.test(html)) {
    return html.replace(footerRe, block + '\n\n      <footer class="site-footer"');
  }

  if (html.indexOf('</main>') !== -1) {
    return html.replace('</main>', '  ' + block + '\n\n    </main>');
  }

  throw new Error('Could not find BENCHMARKS markers, <footer class="site-footer">, or </main> in index.html.');
}

function main() {
  const entries = loadBenchmarkEntries();
  const { rows, errors } = buildRows(entries);

  if (errors.length > 0) {
    console.error('Could not generate the benchmark section:\n');
    errors.forEach(function (e) { console.error('  - ' + e); });
    process.exit(1);
  }

  if (rows.length === 0) {
    console.error('data/benchmarks.json has no entries — nothing to render.');
    process.exit(1);
  }

  const block = renderBlock(rows);
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const updated = spliceIntoIndex(html, block);
  fs.writeFileSync(INDEX_HTML, updated, 'utf8');

  const totalSites = rows.reduce(function (sum, r) { return sum + r.scanned; }, 0);
  console.log('Wrote ' + rows.length + ' categories (' + totalSites + ' sites total) into index.html:');
  rows.forEach(function (r) {
    console.log('  ' + r.average + '/100  ' + r.label + '  (' + r.scanned + ' ' + (r.note || 'sites') + ', ' + r.track + ')');
  });
}

main();
