#!/usr/bin/env node
/* =====================================================================
   scripts/capture-pro-shots.js

   Produces the "screenshot crops" of the Pro dashboard shown on /pro and in
   the homepage Pro band, from the real sample data
   (content/pro/sample-report.json, a crawl of our own site) and the real
   renderer (lib/report-render.js), the code the dashboard itself runs.

   NO HEADLESS BROWSER IS AVAILABLE in the environment this was built in (no
   Chrome, Chromium, Playwright or Puppeteer, and no new dependencies are
   allowed), so the crops are not raster images. Each crop is the dashboard's
   own markup for a named region (the regions carry data-shot="..." in
   lib/report-render.js), cleaned of links and controls, and written to
   assets/pro/<name>.frag (a fragment, not a page: the .frag extension keeps the page
   checks from reading it as one). scripts/generate-pro.js puts each one inside the
   frame component (.pro-shot) with its alt text and caption. They are cropped
   by the frame (a fixed height with overflow hidden), the way a screenshot is.
   If a headless browser is ever added, load app/report.html?sample=1 at a
   1000px viewport and 2x, and clip each [data-shot="<name>"]; the names and
   the sample mode are already in place.

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
const icons = require('../lib/icons.js');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'content', 'pro', 'sample-report.json');
const OUT = path.join(ROOT, 'assets', 'pro');
const CITATION = path.join(ROOT, 'content', 'citations', 'sample-crm.json');

const MATRIX_ROWS = 12;   // the frame clips below this; rows past the clip are left out of the markup
const PAGE_ROWS = 8;      // pages shown in the list crop
const FIX_COUNT = 2;      // fix cards shown in the fixes crop
const CIT_ROWS = 3;       // rows of the open group in the citations crop
const TRY_ROWS = 3;       // rows of the open group in the tries crop
const NAMES = ['summary', 'gap', 'matrix', 'pages', 'fixes', 'print', 'citations', 'tries', 'band-explorer'];

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

function wrap(inner) { return '<div class="rp-report rp-js">\n' + inner.replace(/\n+$/, '') + '\n</div>\n'; }

/* ---------- the crops ---------- */

function crops(data) {
  const withBm = Object.assign({}, data, { benchmark: data.benchmark || factsLib.benchmarkFromData(path.join(ROOT, 'data')) });
  const sample = JSON.parse(fs.readFileSync(CITATION, 'utf8'));
  const html = render.render(withBm, { schema: schema, label: 'Sample report', bar: false, citation: { result: citationPanel.fromSample(sample), sample: true } });
  const out = {};

  out.summary = wrap(clean(byAttr(html, 'data-shot="summary"')));

  // The gap: the site-wide score, the homepage score and the gap between them (three of the four KPI tiles).
  const tiles = all(byAttr(html, 'data-shot="summary"'), '<li class="rp-kpi" data-kpi="(avg|home|gap)"', 'li');
  out.gap = wrap(clean('<ul class="rp-kpis rp-kpis--three">\n' + tiles.join('\n') + '\n</ul>'));

  // The matrix: header, then the first rows of the real table. The frame clips the rest.
  const mx = byAttr(html, 'data-shot="matrix"');
  const head = /^[\s\S]*?<\/thead>\n/.exec(mx)[0];
  const bodies = all(mx, '<tbody class="rp-cluster"', 'tbody');
  let kept = 0, parts = '';
  for (const b of bodies) {
    if (kept >= MATRIX_ROWS) break;
    const rows = all(b, '<tr class="rp-matrix__row"', 'tr');
    const headRow = all(b, '<tr class="rp-cluster__head"', 'tr')[0];
    const take = rows.slice(0, MATRIX_ROWS - kept);
    kept += take.length;
    parts += '<tbody class="rp-cluster">' + headRow + '\n' + take.join('\n') + '\n</tbody>\n';
  }
  out.matrix = wrap(clean(head.replace(/<div class="rp-matrixwrap"[^>]*>/, '<div class="rp-matrixwrap">') + parts + '</table></div>'));

  // Pages: the list (worst first) and the detail pane for the worst page, built the way
  // lib/report-ui.js builds the pane when a row is selected. The first snippet is open.
  const pg = byAttr(html, 'data-shot="pages"');
  const ulStart = pg.indexOf('<ul class="rp-list"');
  const items = all(balanced(pg, ulStart, 'ul').slice(1), '<li class="rp-item', 'li').slice(0, PAGE_ROWS);
  const first = items[0];
  const firstPath = /data-path="([^"]*)"/.exec(first)[1];
  const firstDetail = byAttr(first, 'class="rp-detail"').replace('<details class="rp-snippet">', '<details class="rp-snippet" open>');
  const lis = items.map((li, i) => {
    const detail = byAttr(li, 'class="rp-detail"');
    const bare = li.replace(detail, '');
    const keep = i === 0 ? li.replace('class="rp-item', 'class="rp-item is-selected is-open').replace(detail, firstDetail) : bare;
    return keep;
  });
  out.pages = wrap(clean('<div class="rp-pages"><ul class="rp-list">\n' + lis.join('\n') + '\n</ul>\n<div class="rp-pane"><p class="rp-pane__path">' + firstPath + '</p>' + firstDetail + '</div></div>'));

  // band-explorer (homepage Pro band only): the dashboard's navy top bar and its five tabs, Pages selected,
  // with the pages explorer under them: worst page selected, detail open, one fix snippet visible. The tabs
  // are built the way lib/report-ui.js builds them, but as inert spans (the band holds one link and no buttons).
  // Paths get a middle ellipsis (a head that shortens, a tail that stays) so a clipped path still ends in its
  // last segment; that styling lives in the band's own rules, not in the dashboard.
  const ellipsis = (li) => li.replace(/(<span class="rp-item__path"[^>]*>)([^<]*)(<\/span>)/, (m, a, t, c) => {
    const cut = Math.max(0, t.length - 8);
    return a + '<span class="pro-band-path__head">' + t.slice(0, cut) + '</span><span class="pro-band-path__tail">' + t.slice(cut) + '</span>' + c;
  });
  const dashBar = render.topBar({ domain: data.domain, date: data.createdAt, label: 'Sample report' }).replace(' hidden>', '>').replace('<button type="button"', '<span').replace('</button>', '</span>');
  const tabs = render.TABS.map((t) => '<span class="rp-tab" role="tab" aria-selected="' + (t.id === 'pages' ? 'true' : 'false') + '">' + icons.svg(t.icon) + t.name + '</span>').join('');
  out['band-explorer'] = '<div class="rp-report rp-js pro-band-dash">\n' + clean(dashBar + '<div class="pro-band-dash__body"><div class="rp-tablist" role="tablist">' + tabs + '</div>\n<div class="rp-pages"><ul class="rp-list">\n' + lis.map(ellipsis).join('\n') + '\n</ul>\n<div class="rp-pane"><p class="rp-pane__path">' + firstPath + '</p>' + firstDetail + '</div></div></div>') + '\n</div>\n';

  // Fixes: two cards, the ones that apply to the most pages after the robots.txt block (which lists crawler
  // names; the marketing crops leave product names out). The page lists are folded away.
  const fx = byAttr(html, 'data-shot="fixes"');
  const pagesOf = (c) => +/Applies to <strong[^>]*>(\d+)<\/strong>/.exec(c)[1];
  const cards = all(fx, '<article class="rp-fix"', 'article')
    .filter((c) => c.indexOf('<h3 class="rp-fix__title">robots.txt') === -1)
    .map((c, i) => ({ c: c, i: i }))
    .sort((a, b) => pagesOf(b.c) - pagesOf(a.c) || a.i - b.i)
    .slice(0, FIX_COUNT)
    .map((x) => x.c.replace(/<ul class="rp-pagelist">[\s\S]*?<\/ul>/, ''));
  out.fixes = wrap(clean('<div>\n' + cards.join('\n') + '\n</div>'));

  // Citations: the dashboard's Citations tab with the published CRM sample (the Citations panel's own
  // markup, lib/citation-panel.js). 'citations' opens the never-named group; 'tries' opens the one named
  // only sometimes. The other groups are folded to their summary lines.
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
  out.citations = wrap(clean('<div class="rp-cit">\n' + label + '\n' + kpis + '\n' + note + '\n' + grp('never', CIT_ROWS) + '\n</div>'));
  out.tries = wrap(clean('<div class="rp-cit">\n' + note + '\n' + grp('unstable', TRY_ROWS) + '\n</div>'));

  // Print: the dashboard's own top bar, with its Print button shown (the script un-hides it).
  const bar = render.topBar({ domain: data.domain, date: data.createdAt, label: 'Sample report' }).replace(' hidden>', '>');
  out.print = wrap(clean(bar, true));

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
