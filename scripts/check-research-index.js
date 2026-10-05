#!/usr/bin/env node
/* =====================================================================
   scripts/check-research-index.js

   Verifies content/research-index.json against its sources: every figure in
   every finding (and in each summary and limit) appears in the source page or
   data file, every "how to cite" line appears on its page, and the URLs and
   dates are well formed. The benchmark entry is also recomputed from
   data/*-summary.json.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', ldquo: '\u201C', rdquo: '\u201D', lsquo: '\u2018', rsquo: '\u2019', mdash: '\u2014', ndash: '\u2013', hellip: '\u2026' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (Object.prototype.hasOwnProperty.call(NAMED, e) ? NAMED[e] : m)));
const textOf = (html) => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

function sourceText(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  if (fs.statSync(p).isDirectory()) {
    return fs.readdirSync(p).filter((f) => /\.json$/.test(f)).map((f) => fs.readFileSync(path.join(p, f), 'utf8')).join(' ');
  }
  const raw = fs.readFileSync(p, 'utf8');
  return /\.html$/.test(p) ? textOf(raw) : raw;
}

// Figures: numbers as written (76%, 56.5, 100). Dates and counts in words are not figures.
function figuresIn(s) {
  return (String(s).match(/\d[\d,]*(?:\.\d+)?%?/g) || []).map((x) => x.replace(/[,.]$/, ''));
}

function main() {
  const errors = [];
  const bad = (m) => errors.push(m);
  const idxFile = path.join(ROOT, 'content', 'research-index.json');
  if (!fs.existsSync(idxFile)) { console.error('content/research-index.json is missing'); process.exit(1); }
  const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
  const base = idx.site;

  idx.entries.forEach((e) => {
    const where = e.slug + ': ';
    if (!e.slug || !e.title || !e.summary || !e.url || !e.cite || !Array.isArray(e.findings) || !e.findings.length || !Array.isArray(e.limits)) { bad(where + 'missing a field'); return; }
    if (e.url.indexOf(base + '/') !== 0) bad(where + 'url is not under the site base');
    if (!/^\d{4}-\d{2}(-\d{2})?$/.test(e.date)) bad(where + 'date is not ISO');
    const sources = (e.sources || []).map((s) => ({ rel: s, text: sourceText(s) }));
    sources.forEach((s) => { if (s.text === null) bad(where + 'source ' + s.rel + ' does not exist'); });
    const blob = sources.map((s) => s.text || '').join(' ');
    const blobNoCommas = blob.replace(/(\d),(\d)/g, '$1$2');
    [e.summary].concat(e.findings, e.limits).forEach((line) => {
      figuresIn(line).forEach((f) => {
        const plain = f.replace(/,/g, '');
        if (blob.indexOf(f) === -1 && blobNoCommas.indexOf(plain) === -1) bad(where + 'figure "' + f + '" in "' + line.slice(0, 60) + '..." is not in ' + e.sources.join(', '));
      });
    });
    // The cite line must be on the page it cites (reports) or computed from data (benchmark).
    if (e.kind !== 'benchmark') {
      const html = sources[0] && sources[0].text;
      if (html && html.indexOf(e.cite) === -1) bad(where + 'cite line is not on the page');
    }
  });

  // The benchmark entry recomputed from the summaries.
  const bm = idx.entries.filter((e) => e.kind === 'benchmark')[0];
  if (!bm) bad('no benchmark entry');
  else {
    const cats = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'benchmarks.json'), 'utf8')).map((c) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', c.category + '-summary.json'), 'utf8')));
    const total = cats.reduce((n, s) => n + s.scanned, 0);
    const avg = Math.round(cats.reduce((n, s) => n + s.score.average * s.scanned, 0) / total);
    if (bm.findings[0].indexOf(total + ' homepages') === -1 || bm.findings[0].indexOf('is ' + avg + ' out of 100') === -1) bad('benchmark finding does not match data/*-summary.json (' + total + ', ' + avg + ')');
  }

  if (errors.length) { errors.forEach((m) => console.error('FAIL: ' + m)); process.exit(1); }
  console.log('OK: every figure in ' + idx.entries.length + ' research index entries appears in its source; cite lines match their pages');
}

main();
