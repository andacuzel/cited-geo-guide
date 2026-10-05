#!/usr/bin/env node
/* =====================================================================
   scripts/generate-research-index.js

   Writes content/research-index.json, the data behind the get_research MCP
   tool: for each published report its title, date, one-line finding, key
   findings, method limits, URL and a ready "how to cite" line.

   The findings of the two reports are the reports' own words (the figures in
   them are checked against the pages by scripts/check-research-index.js). The
   benchmark entry is derived from data/*-summary.json at build time, never
   typed. Research 002 (crawler access) is added by scripts/generate-research-002.js
   through the same ENTRIES list below once that report exists.

     node scripts/generate-research-index.js           write the file
     node scripts/generate-research-index.js --check   exit 1 if it is out of date
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const site = require('../lib/site-config.js');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'content', 'research-index.json');
const BASE = site.baseUrl;

function benchmarkEntry() {
  const entries = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'benchmarks.json'), 'utf8'));
  const rows = entries.map((e) => ({ e: e, s: JSON.parse(fs.readFileSync(path.join(ROOT, 'data', e.category + '-summary.json'), 'utf8')) })).filter((r) => r.s && r.s.score && r.s.scanned);
  const total = rows.reduce((n, r) => n + r.s.scanned, 0);
  const avg = Math.round(rows.reduce((n, r) => n + r.s.score.average * r.s.scanned, 0) / total);
  const sorted = rows.slice().sort((a, b) => b.s.score.average - a.s.score.average);
  const top = sorted[0], low = sorted[sorted.length - 1];
  const latest = rows.map((r) => r.s.scannedAt).sort().pop();
  const longDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return {
    slug: 'benchmarks',
    kind: 'benchmark',
    title: 'AI readiness benchmarks',
    date: latest,
    dateLabel: longDate(latest),
    url: BASE + '/benchmarks',
    summary: 'The average AI readiness score across ' + total + ' homepages in ' + rows.length + ' categories is ' + avg + ' out of 100.',
    findings: [
      'We scanned ' + total + ' homepages in ' + rows.length + ' categories. The average score is ' + avg + ' out of 100.',
      top.e.label + ' scores highest, ' + top.s.score.average + ' out of 100. ' + low.e.label + ' scores lowest, ' + low.s.score.average + ' out of 100.'
    ],
    limits: [
      'Homepages only, from hand-picked well-known sites in each category, not a random sample.',
      'One scan date per category. A rescan in October 2026 moved category averages by one point or less.',
      'It measures readiness, not whether any assistant names a brand.'
    ],
    cite: 'Answerable, "AI readiness benchmarks," ' + longDate(latest) + '. ' + BASE + '/benchmarks',
    sources: ['benchmarks/index.html', 'data/']
  };
}

function entries() {
  const list = [
    {
      slug: 'llms-txt-adoption-2026',
      kind: 'research',
      title: 'Who controls your brand\'s AI representation?',
      date: '2026-07-29',
      dateLabel: '29 July 2026',
      url: BASE + '/research/llms-txt-adoption-2026',
      summary: 'We scanned 64 sites and found blocking is rare: 10% of B2B sites and 3% of consumer brands restrict AI crawlers.',
      findings: [
        '76% of consumer brands have an llms.txt file, but the two files we examined by hand were near-identical and said nothing specific about the brand.',
        '91% of consumer-brand homepages and 48% of B2B homepages are missing content schema.',
        '22 of 85 attempted scans could not complete, blocked by protection that may also stop AI crawlers. The report leaves that question open.'
      ],
      limits: [
        'Homepages only: 64 domains completed a scan out of 85 attempted, 31 B2B and 33 consumer brands.',
        'It does not tell whether the 22 unreachable sites block AI crawlers specifically, or only generic cloud traffic.',
        'The Shopify-generated llms.txt pattern was checked in two files read by hand, Magic Spoon and Allbirds.',
        'It measures inputs, not outcomes: whether any of these signals correlate with being cited in an AI answer is not known.'
      ],
      cite: 'Andaç Üzel, “Who Controls Your Brand\'s AI Representation?,” Answerable Research, 29 July 2026. ' + BASE + '/research/llms-txt-adoption-2026',
      sources: ['research/llms-txt-adoption-2026.html']
    },
    {
      slug: 'case-study-agaone',
      kind: 'case-study',
      title: 'Two sites, launched with good SEO, invisible to AI crawlers',
      date: '2026-08',
      dateLabel: 'August 2026',
      url: BASE + '/research/case-study-agaone',
      summary: 'AgaOne Commodities scanned two new corporate sites, fixed what the report ranked first, and scanned again. Average score moved from 56.5 to 94.5.',
      findings: [
        'Both sites scored in the mid-fifties before the work: 58 and 55.',
        'One site reached 100 out of 100 on the checks Answerable runs today. The other reached 89.',
        'The average gain was 38 points across 2 sites and 16 checks.'
      ],
      limits: [
        'Two sites from one company, published with permission: a case study, not a sample.',
        'A score of 100 means the site passes all 16 checks Answerable runs today. It does not mean the site will be cited in an AI answer.',
        'The scoring model will get harder, so the same sites are expected to move.'
      ],
      cite: 'Andaç Üzel, “Two Sites, Launched With Good SEO, Invisible to AI Crawlers,” Answerable Case Studies, August 2026. ' + BASE + '/research/case-study-agaone',
      sources: ['research/case-study-agaone.html']
    },
    benchmarkEntry()
  ];
  // Reports generated by their own scripts register themselves here once the page exists.
  try {
    const extra = require('./generate-research-002.js');
    if (extra && typeof extra.indexEntry === 'function') list.splice(2, 0, extra.indexEntry());
  } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  return list;
}

function build() {
  return JSON.stringify({ site: BASE, entries: entries() }, null, 2) + '\n';
}

function main() {
  const text = build();
  if (process.argv.indexOf('--check') !== -1) {
    if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== text) { console.error('content/research-index.json is out of date; run node scripts/generate-research-index.js'); process.exit(1); }
    console.log('OK: content/research-index.json is current (' + JSON.parse(text).entries.length + ' entries)');
    return;
  }
  fs.writeFileSync(OUT, text, 'utf8');
  console.log('content/research-index.json written (' + JSON.parse(text).entries.length + ' entries)');
}

if (require.main === module) main();
module.exports = { entries, build };
