/* =====================================================================
   lib/ws-render.js: the pages of a workspace, as HTML strings.

   The client view (/w/<id>) and the public demo (/demo/fix) are the same page; the demo adds a ribbon and is read-only (no Verify). Every value that
   comes from storage or an admin goes through esc(), and pasted text goes through lib/ws-markdown.js, which escapes first. The page loads one script of
   our own (/app/ws-view.js: tabs, copy, Verify) and nothing from a third party. Without JavaScript every section is simply shown one after the other.
   Every page is noindex and sends no referrer (headers in lib/pro-http.js and vercel.json).
   ===================================================================== */

'use strict';

const Page = require('./pro-report-page.js');
const Fix = require('./ws-fix.js');
const md = require('./ws-markdown.js');
const lockup = require('./lockup.js');

const esc = md.esc;
const SCRIPTS = '  <script src="/app/ws-view.js?v=1" defer></script>\n';

function date(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const BAR = '<header class="rp-top"><div class="rp-top__inner"><a class="logo rp-top__logo" href="/" aria-label="Citehound home"><span class="logo__icon" aria-hidden="true">' + lockup.MARK + '</span><span class="logo__mark">Citehound</span></a><div class="rp-top__meta"><span class="rp-top__label">Fix workspace</span></div></div></header>\n';

const TABS = [['overview', 'Overview'], ['fixes', 'Fix list'], ['files', 'Files'], ['history', 'History'], ['pro', 'Citehound Pro report']];

function chip(status) { return '<span class="ws-chip ws-chip--' + esc(status) + '">' + esc(Fix.STATUS_LABEL[status] || status) + '</span>'; }

function overviewPanel(model) {
  const o = Fix.overview(model.scans, model.last, model.items);
  const stat = (label, big, small) => '<div class="ws-stat"><p class="ws-stat__label">' + esc(label) + '</p><p class="ws-stat__big">' + big + '</p><p class="ws-stat__small">' + small + '</p></div>';
  const delta = o.delta === null ? '' : (o.delta > 0 ? '+' + o.delta : String(o.delta));
  return '<section class="ws-panel" id="overview" aria-labelledby="overview-h"><h2 class="ws-h" id="overview-h">Overview</h2>\n' +
    '<div class="ws-stats">' +
    stat('Before', o.before ? esc(o.before.score) + '<small>/100</small>' : '&ndash;', o.before ? esc(date(o.before.at)) + ', first scan' : 'No scan yet') +
    stat('Now', o.now ? esc(o.now.score) + '<small>/100</small>' : '&ndash;', o.now ? 'Last scan ' + esc(date(o.now.at)) : 'No scan yet') +
    stat('Change', delta === '' ? '&ndash;' : esc(delta) + '<small> points</small>', o.scans > 1 ? esc(o.scans) + ' scans in all' : 'Needs a second scan') +
    stat('Checks passing', o.checksTotal ? esc(o.checksPassing) + '<small>/' + esc(o.checksTotal) + '</small>' : '&ndash;', 'In the latest scan') +
    '</div>\n' +
    '<ul class="ws-counts" aria-label="Fix list by status">' + Fix.STATUSES.map((s) => '<li>' + chip(s) + ' <b>' + esc(o.counts[s]) + '</b></li>').join('') + '</ul>\n' +
    '<p class="ws-note">These are AI-readiness scores: crawler access and on-page signals, the same scan as the free scanner. They do not measure whether any assistant names a brand.</p>\n</section>\n';
}

function fixesPanel(model) {
  const rank = { todo: 0, in_progress: 1, applied: 2, verified: 3 };
  const items = model.items.slice().sort((a, b) => (rank[a.status] - rank[b.status]) || (b.max - a.max));
  const rows = items.map((i) => {
    const p = Fix.passes(i, model.last);
    const canVerify = !model.demo && !model.archived && i.status !== 'verified' && p !== null && !/^x-/.test(i.key);
    return '<li class="ws-item" data-status="' + esc(i.status) + '">\n' +
      '  <div class="ws-item__head"><h3 class="ws-item__title">' + esc(i.label) + '</h3>' + chip(i.status) + '</div>\n' +
      '  <p class="ws-item__meta">' + esc(Fix.PILLAR[i.cat] || '') + (i.max ? ' &middot; ' + esc(i.max) + ' points' : '') + (i.regressed ? ' &middot; failed again after it was verified' : '') + (p === true && i.status !== 'verified' ? ' &middot; passes in the latest scan, not yet verified' : '') + '</p>\n' +
      (i.advice ? '  <p class="ws-item__advice"><b>Fix:</b> ' + esc(i.advice) + '.</p>\n' : '') +
      (i.why ? '  <p class="ws-item__why">' + esc(i.why) + '</p>\n' : '') +
      (i.note ? '  <div class="ws-item__note ws-md">' + md.render(i.note) + '</div>\n' : '') +
      '  <p class="ws-item__actions">' + (i.file ? '<a class="ws-link" href="#files" data-ws-tab="files">See the ' + esc(i.file === 'robots' ? 'robots.txt' : i.file === 'llms' ? 'llms.txt' : 'schema') + ' file</a>' : '') +
      (canVerify ? '<button type="button" class="btn btn--ghost ws-verify" data-key="' + esc(i.key) + '">Verify</button>' : '') + '<span class="ws-verify__out" role="status" aria-live="polite"></span></p>\n</li>';
  }).join('\n');
  return '<section class="ws-panel" id="fixes" aria-labelledby="fixes-h"><h2 class="ws-h" id="fixes-h">Fix list</h2>\n' +
    '<p class="ws-lede">One item for each failed check. We set an item to applied when the change is on your site. Verify runs the check again and marks it verified only if it passes.</p>\n' +
    (items.length ? '<ul class="ws-items">\n' + rows + '\n</ul>\n' : '<p class="ws-empty">Nothing to fix: no check failed in the latest scan.</p>\n') + '</section>\n';
}

function filesPanel(model) {
  const fl = Fix.files(model.meta, model.last);
  return '<section class="ws-panel" id="files" aria-labelledby="files-h"><h2 class="ws-h" id="files-h">Files</h2>\n' +
    '<p class="ws-lede">Generated for this site with the same builders as the free tools. Text in [brackets] is for you to fill in.</p>\n' +
    fl.map((f) => '<div class="ws-file"><div class="ws-file__head"><h3 class="ws-file__title">' + esc(f.name) + '</h3><button type="button" class="btn btn--ghost ws-copy" data-copy="file-' + esc(f.id) + '">Copy</button></div>\n' +
      '<p class="ws-file__where">' + esc(f.where) + '</p>\n<pre class="ws-pre" id="file-' + esc(f.id) + '" tabindex="0"><code>' + esc(f.text) + '</code></pre></div>').join('\n') + '\n</section>\n';
}

function historyPanel(model) {
  const scans = model.scans.slice().reverse();
  const KIND = { baseline: 'First scan', rescan: 'Rescan', verify: 'Verify run' };
  const rows = scans.map((s, idx) => {
    const prev = scans[idx + 1];
    const d = prev ? s.score - prev.score : null;
    return '<li class="ws-tl__row"><span class="ws-tl__date">' + esc(date(s.at)) + '</span><span class="ws-tl__kind">' + esc(KIND[s.kind] || s.kind) + '</span><span class="ws-tl__score">' + esc(s.score) + '/100</span><span class="ws-tl__delta">' +
      (d === null ? '' : (d > 0 ? '+' + d : String(d)) + ' points') + '</span><span class="ws-tl__fail">' + esc(s.failing) + ' failing</span></li>';
  }).join('\n');
  return '<section class="ws-panel" id="history" aria-labelledby="history-h"><h2 class="ws-h" id="history-h">History</h2>\n' +
    '<p class="ws-lede">Every scan of this site in this workspace, newest first.</p>\n' +
    (rows ? '<ol class="ws-tl">\n' + rows + '\n</ol>\n' : '<p class="ws-empty">No scan yet.</p>\n') + '</section>\n';
}

function proPanel(model) {
  let body;
  if (model.demo) body = '<p class="ws-lede">The Citehound Pro report for this project opens here. This is a sample.</p><p><a class="btn btn--primary" href="/sample-report">See the sample Pro report</a></p>';
  else if (model.proJobId && model.proReady) body = '<p class="ws-lede">The Pro report for ' + esc(model.meta.domain) + ': every page scored, every failed check listed, in one report.</p><p><a class="btn btn--primary" href="/r/' + esc(model.proJobId) + '/">Open the Pro report</a></p>';
  else body = '<p class="ws-lede">The Pro report for this project appears here when it is ready.</p>';
  return '<section class="ws-panel" id="pro" aria-labelledby="pro-h"><h2 class="ws-h" id="pro-h">Citehound Pro report <span class="ws-included">Included</span></h2>\n' + body + '\n</section>\n';
}

// model: { meta, items, scans, last, demo, proReady }
function workspacePage(model) {
  const m = model.meta;
  const title = (model.demo ? 'Demo: ' : '') + 'Citehound Fix workspace for ' + m.domain;
  const ribbon = model.demo ? '<div class="ws-ribbon" role="note"><b>Product demo &middot; Sample data</b><span>A fictional project. Nothing here belongs to a real customer, and nothing can be changed.</span></div>\n' : '';
  const tabs = '<nav class="ws-tabs" aria-label="Workspace sections">' + TABS.map((t, i) => '<a href="#' + t[0] + '" data-ws-tab="' + t[0] + '"' + (i === 0 ? ' aria-current="true"' : '') + '>' + esc(t[1]) + '</a>').join('') + '</nav>\n';
  const body = ribbon + BAR + '<main id="main" class="ws' + (model.demo ? ' ws--demo' : '') + '">\n<div class="ws__inner">\n' +
    '<div class="ws-head"><p class="ws-head__lockup">' + lockup.html('FIX', 'light') + '</p><h1 class="ws-head__title">' + esc(m.domain) + '</h1><p class="ws-head__sub">Fix workspace &middot; started ' + esc(date(m.createdAt)) + (model.archived ? ' &middot; archived, read-only' : '') + '</p></div>\n' +
    tabs + overviewPanel(model) + fixesPanel(model) + filesPanel(model) + historyPanel(model) + proPanel(model) + '</div>\n</main>\n<div class="toast" id="toast" role="status" aria-live="polite"></div>\n';
  return Page.shell(title, 'ws-body', body, SCRIPTS);
}

function notFound() {
  return Page.shell('Citehound: link not available', 'ps-body', Page.card('<p class="ps-kicker">Citehound</p><h1 class="ps-title">This link is not available</h1><p class="ps-lead">The link may be wrong, or the workspace may no longer exist.</p>'));
}

module.exports = { workspacePage: workspacePage, notFound: notFound, date: date, esc: esc };
