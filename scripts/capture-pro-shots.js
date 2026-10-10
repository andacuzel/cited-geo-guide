#!/usr/bin/env node
/* =====================================================================
   scripts/capture-pro-shots.js

   Produces the "screenshot crops" of the Pro report shown on /pro and in the
   homepage Pro band, from the real sample data (content/pro/sample-report.json,
   a crawl of our own site) and the real renderer (lib/report-render.js renderPro),
   the code a Pro report and /sample-report run.

   The crops are not raster images. Each one is the report's own markup for a
   named region (the regions carry data-shot or data-pillar in renderPro), cleaned
   of links and controls, and written to assets/pro/<name>.frag (a fragment, not a
   page: the .frag extension keeps the page checks from reading it as one).
   scripts/generate-pro.js puts each one inside the frame component (.pro-shot)
   with its alt text and caption. The frame crops it (a fixed height with overflow
   hidden), the way a screenshot is.

   Crops: summary (score, pillars, findings), checks (one pillar's checks),
   pages (the alphabetical page table, one row open), fixes (two snippets),
   estimate (the strip and the first fixes), citations (the published sample from
   a different brand) and band-explorer (the homepage band: the report's top bar,
   its section nav and the page table).

     node scripts/capture-pro-shots.js            write assets/pro/*.frag
     node scripts/capture-pro-shots.js --check    exit 1 if any crop is out of date
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const render = require('../lib/report-render.js');
const schema = require('../lib/schema.js');
const factsLib = require('../lib/report-facts.js');
const citationPanel = require('../lib/citation-panel.js');
const estimateLib = require('../lib/pro-estimate.js');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'content', 'pro', 'sample-report.json');
const OUT = path.join(ROOT, 'assets', 'pro');
const CITATION = path.join(ROOT, 'content', 'citations', 'sample-crm.json');

const PAGE_ROWS = 8;      // pages shown in the page-table crops; the frame clips below, rows past it are left out of the markup
const FIX_COUNT = 2;      // snippets shown in the fixes crop
const EST_ROWS = 3;       // rows of the estimate table shown
const CIT_ROWS = 3;       // rows of the open group in the citations crop
const NAMES = ['summary', 'checks', 'pages', 'fixes', 'estimate', 'citations', 'band-explorer'];

/* ---------- small markup helpers (the renderer's output is well formed) ---------- */

// The element that starts at `start` (the index of its '<'), through its matching close tag.
function balanced(html, start, tag) {
  const re = new RegExp('<(/?)' + tag + '\\b[^>]*>', 'g');
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, re.lastIndex);
  }
  throw new Error('unbalanced <' + tag + '>');
}

function byAttr(html, marker, from) {
  const at = html.indexOf(marker, from || 0);
  if (at === -1) return null;
  const start = html.lastIndexOf('<', at);
  const tag = /^<([a-z0-9]+)/.exec(html.slice(start))[1];
  return balanced(html, start, tag);
}

function all(html, openRe, tag) {
  const out = [];
  const re = new RegExp(openRe, 'g');
  let m;
  while ((m = re.exec(html))) {
    const el = balanced(html, m.index, tag);
    out.push(el);
    re.lastIndex = m.index + el.length;
  }
  return out;
}

// Links become plain spans, controls go, and attributes only the live dashboard uses are dropped.
function clean(html, keepButtons) {
  let s = html;
  if (!keepButtons) s = s.replace(/<button\b[\s\S]*?<\/button>/g, '');
  s = s.replace(/<a\b([^>]*)>/g, (m, attrs) => '<span' + (/class="[^"]*"/.exec(attrs) || [''])[0].replace(/^/, ' ') + '>').replace(/<\/a>/g, '</span>');
  s = s.replace(/<span class="">/g, '<span>');
  s = s.replace(/ (id|title|target|rel|aria-labelledby|data-page|data-index|data-path|data-score|data-failed|data-section|data-checks|data-shown|data-rows|data-toggle-cluster|data-check|data-action)="[^"]*"/g, '');
  s = s.replace(/ (data-toggle-cluster|data-action="print")\b/g, '');
  s = s.replace(/<table class="rp-matrix"[^>]*>/, '<table class="rp-matrix">');
  s = s.replace(/ role="img" aria-label="try \d: [^"]*"/g, '');
  s = s.replace(/(<span class="rp-cit-model__meta">)[a-z]+, /g, '$1');   // the provider name is left out; the model id and date stay
  s = s.replace(/<span class="rp-vh">[^<]*<\/span>/g, '').replace(/ class=""/g, '');   // text for screen readers only; a crop is one labelled image
  return s;
}

function wrap(inner, cls) { return '<div class="' + (cls || 'pr-report') + '">\n' + inner.replace(/\n+$/, '') + '\n</div>\n'; }

/* ---------- the crops ---------- */

// The page table rebuilt with its header and the first rows. The frames are narrow, so the crop shows the first three columns
// (page, score, failed checks) and no row is open.
function pageTable(html, rows) {
  const wrapEl = byAttr(html, 'data-shot="pages"');
  const head = /<thead[\s\S]*?<\/thead>/.exec(wrapEl)[0];
  const all8 = all(wrapEl, '<tr role="row" class="pr-row"', 'tr').slice(0, rows);
  const kept = all8;
  return '<div class="pr-tablewrap"><table class="pr-table pr-table--pages"><caption class="pr-vh">Pages</caption>' + head + '<tbody>\n' + kept.join('\n') + '\n</tbody></table></div>';
}

function crops(data) {
  const withBm = Object.assign({}, data, { benchmark: data.benchmark || factsLib.benchmarkFromData(path.join(ROOT, 'data')) });
  const sample = JSON.parse(fs.readFileSync(CITATION, 'utf8'));
  const html = render.renderPro(withBm, { schema: schema, estimate: estimateLib.estimate(data), cap: factsLib.CRAWL_CAP, label: 'Sample report', bar: false, actions: { copy: true, print: true }, citation: { result: citationPanel.fromSample(sample), sample: true } });
  const out = {};

  // The summary: the score and the three pillars beside the findings in plain words.
  out.summary = wrap(clean(byAttr(html, 'data-shot="summary"')));

  // The checks: one pillar's table, each check with how many pages fail it.
  out.checks = wrap(clean(byAttr(html, 'data-pillar="tech"')));

  // The pages: the alphabetical table.
  out.pages = wrap(clean(pageTable(html, PAGE_ROWS)));

  // The fixes: the two snippets that apply to the most pages (not the robots.txt one, which lists crawler names; the
  // marketing crops leave product names out). Both are open.
  const snippets = all(html, '<details class="pr-snippet"', 'details');
  const appliesTo = (c) => +/applies to (\d+) page/.exec(c)[1];
  const picked = snippets
    .filter((c) => c.indexOf('<span class="pr-snippet__name">robots.txt') === -1)
    .map((c, i) => ({ c: c, i: i }))
    .sort((a, b) => appliesTo(b.c) - appliesTo(a.c) || a.i - b.i)
    .slice(0, FIX_COUNT)
    .map((x) => x.c.replace('<details class="pr-snippet"', '<details class="pr-snippet" open'));
  out.fixes = wrap(clean('<div>\n' + picked.join('\n') + '\n</div>'));

  // The estimate: the strip and the first rows of the table.
  const est = byAttr(html, 'data-shot="estimate"');
  const strip = byAttr(est, 'class="pr-strip"');
  const estHead = /<thead[\s\S]*?<\/thead>/.exec(est)[0];
  const estRows = all(est, '<tr role="row"><th scope="row"', 'tr').slice(0, EST_ROWS);
  out.estimate = wrap(clean(strip + '\n<div class="pr-tablewrap"><table class="pr-table pr-table--estimate"><caption class="pr-vh">Fixes</caption>' + estHead + '<tbody>\n' + estRows.join('\n') + '\n</tbody></table></div>'));

  // Citations: the report's Citations section with the published CRM sample (the panel's own markup, lib/citation-panel.js).
  // The never-named group is open; the others are folded to their summary lines.
  const cit = byAttr(html, 'data-shot="citations"').replace(/<p class="rp-cit-cta">[\s\S]*?<\/p>/, '');
  const groupsAt = cit.indexOf('<div class="rp-cit-groups"');
  const groups = balanced(cit, groupsAt, 'div');
  const detail = (g) => byAttr(groups, 'data-group="' + g + '"');
  const fold = (g) => '<details class="ct-detail" data-group="' + g + '">' + /<summary>[\s\S]*?<\/summary>/.exec(detail(g))[0] + '</details>';
  const openGroup = (g, rows) => {
    const d = detail(g);
    const keep = all(d, '<tr class="rp-cit-row"', 'tr').slice(0, rows);
    const body = d.replace(/<tbody>[\s\S]*?<\/tbody>/, '<tbody>\n' + keep.join('\n') + '\n</tbody>');
    return /<details[^>]*>/.exec(body)[0].indexOf(' open') === -1 ? body.replace(/^<details/, '<details open') : body;
  };
  const pick = (re) => (re.exec(cit) || [''])[0];
  const label = pick(/<p class="rp-cit-label">[\s\S]*?<\/p>/);
  const kpis = pick(/<ul class="rp-kpis rp-kpis--three">[\s\S]*?<\/ul>/);
  const note = pick(/<p class="rp-note">Across all[\s\S]*?<\/p>/);
  const grp = (open, rows) => '<div class="rp-cit-groups">\n' + ['never', 'unstable', 'always'].map((g) => g === open ? openGroup(g, rows) : fold(g)).join('\n') + '\n</div>';
  out.citations = wrap(clean('<div class="rp-cit">\n' + label + '\n' + kpis + '\n' + note + '\n' + grp('never', CIT_ROWS) + '\n</div>'), 'rp-report rp-js');

  // band-explorer (homepage band only): the report's navy top bar, its section nav (inert spans, Pages marked as the current
  // one) and the page table under them. The band holds one link and no buttons, so nothing in the crop is a control.
  const bar = render.proTop({ label: 'Sample report' }).replace(/<a class="logo[^>]*>([\s\S]*?)<\/a>/, '<span class="logo rp-top__logo">$1</span>');
  const nav = '<nav class="pr-nav" aria-label="Report sections"><ul>' + render.PRO_NAV.map((n) => '<li><span' + (n.id === 'pr-pages' ? ' aria-current="true"' : '') + '>' + n.name + '</span></li>').join('') + '</ul></nav>';
  out['band-explorer'] = '<div class="pr-report pro-band-dash">\n' + clean(bar + nav + '<div class="pro-band-dash__body">' + pageTable(html, PAGE_ROWS) + '</div>') + '\n</div>\n';

  return out;
}

function main() {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const made = crops(data);
  const check = process.argv.indexOf('--check') !== -1;
  let bad = 0;
  NAMES.forEach((n) => {
    const file = path.join(OUT, n + '.frag');
    const html = made[n];
    if (check) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== html) { console.error('assets/pro/' + n + '.frag is out of date; run node scripts/capture-pro-shots.js'); bad++; }
    } else {
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(file, html, 'utf8');
      console.log('assets/pro/' + n + '.frag  ' + Buffer.byteLength(html) + ' bytes');
    }
  });
  if (check) { if (bad) process.exit(1); console.log('OK: assets/pro crops match content/pro/sample-report.json'); }
}

if (require.main === module) main();
module.exports = { crops, NAMES };
