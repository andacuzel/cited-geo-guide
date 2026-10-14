/* =====================================================================
   lib/ws-render.js: the pages of a workspace, as HTML strings.

   The client view (/w/<id>) and the public demos (/demo/fix, /demo/beyond) are the same page; a demo adds a ribbon and is read-only (its write controls are shown
   disabled, with a tooltip, and never work). The app shell is lib/ws-shell.js, the charts are lib/ws-charts.js. Every value that comes from storage or an admin goes
   through esc(), and pasted text goes through lib/ws-markdown.js, which escapes first. The page loads one script of our own (/app/ws-view.js) and nothing from a
   third party but the site's fonts. Without JavaScript every section is shown one after the other. Every page is noindex and sends no referrer.
   ===================================================================== */

'use strict';

const Fix = require('./ws-fix.js');
const md = require('./ws-markdown.js');
const Bey = require('./ws-beyond.js');
const Shell = require('./ws-shell.js');
const C = require('./ws-charts.js');
const Page = require('./pro-report-page.js');
const methodology = require('./methodology.js');

const esc = md.esc;
const date = Shell.date, shortDate = Shell.shortDate, chip = Shell.chip;
const PILLAR_MAX = {}; methodology.registry().forEach((c) => { PILLAR_MAX[c.cat] = (PILLAR_MAX[c.cat] || 0) + c.max; });
const PILLARS = [['discover', 'Discoverability'], ['tech', 'Technical foundation'], ['trust', 'Content & trust']];
const FIX_STATUS_LABEL = Fix.STATUS_LABEL;

const card = (title, inner, cls) => '<section class="wsc' + (cls ? ' ' + cls : '') + '"><h3 class="wsc__h">' + esc(title) + '</h3>' + inner + '</section>';

// The pro tab: the same for both products.
function proPanel(model) {
  let body;
  if (model.demo) body = '<p class="ws-lede">The Citehound Pro report for this project opens here. This is a sample.</p><p><a class="btn btn--primary" href="/sample-report">See the sample Pro report</a></p>';
  else if (model.proJobId && model.proReady) body = '<p class="ws-lede">The Pro report for ' + esc(model.meta.domain) + ': every page scored, every failed check listed, in one report.</p><p><a class="btn btn--primary" href="/r/' + esc(model.proJobId) + '/">Open the Pro report</a></p>';
  else body = C.emptyState({ title: 'The Pro report is not ready yet', text: 'It appears here when it is ready. It is included with your project.' });
  return '<section class="ws-panel" id="pro" aria-labelledby="pro-h"><h2 class="ws-h" id="pro-h">Citehound Pro report <span class="ws-included">Included</span></h2>\n' + body + '\n</section>\n';
}

/* ---------- Fix ---------- */

const pts = (n) => (n ? '+' + n + ' pts' : 'custom');
const statusCls = { todo: 'todo', in_progress: 'in_progress', applied: 'applied', verified: 'verified' };

function fixOverview(model) {
  const o = Fix.overview(model.scans, model.last, model.items);
  const first = model.scans[0], latest = model.scans[model.scans.length - 1];
  const delta = o.delta === null ? null : o.delta;
  const pillarRows = PILLARS.map((p) => ({ label: p[1], max: PILLAR_MAX[p[0]], now: model.last ? model.last[p[0]] : 0, before: first && first.pillars ? first.pillars[p[0]] : null }));
  const open = model.items.filter((i) => i.status !== 'verified' && i.max).sort((a, b) => b.max - a.max);
  const next = open[0];
  const verified = model.items.filter((i) => i.verifiedAt).map((i) => ({ t: Date.parse(i.verifiedAt), tip: 'Verified: ' + i.label + ' (' + shortDate(i.verifiedAt) + ')' }));
  const counts = o.counts;
  const score = (label, big, small) => '<div class="ws-stat"><p class="ws-stat__label">' + esc(label) + '</p><p class="ws-stat__big">' + big + '</p><p class="ws-stat__small">' + small + '</p></div>';
  const scoreCard = card('Score', '<div class="wsc__score">' + (latest ? '<div class="wsc__ringwrap">' + C.ring({ value: latest.score, max: 100, label: 'Now', cls: 'wc-ring--lg', tip: 'Now: ' + latest.score + ' out of 100 (' + date(latest.at) + ')' }) + '<p class="ws-stat__label">Now</p><p class="ws-stat__small">Last scan ' + esc(date(latest.at)) + '</p></div>' : '') +
    '<div class="wsc__side">' + score('Before', first ? esc(first.score) + '<small>/100</small>' : '&ndash;', first ? esc(date(first.at)) + ', first scan' : '') +
    (delta === null ? '' : '<p class="ws-delta' + (delta < 0 ? ' ws-delta--down' : '') + '"><b data-count="' + esc(Math.abs(delta)) + '" data-sign="' + (delta < 0 ? '-' : '+') + '">' + (delta > 0 ? '+' : '') + esc(delta) + '</b> points since the first scan</p>') + '</div></div>', 'wsc--score');
  const chart = card('Score across scans', C.lineChart({ points: model.scans.map((s) => ({ t: Date.parse(s.at), y: s.score, tip: date(s.at) + ': ' + s.score + '/100 (' + ({ baseline: 'first scan', rescan: 'rescan', verify: 'verify run' }[s.kind] || s.kind) + ')' })), marks: verified, xLabel: shortDate, aria: 'Score at each scan' }) +
    (verified.length ? '<p class="wsc__key"><span class="wsc__diamond" aria-hidden="true"></span>A green marker is a fix verified on that day.</p>' : ''), 'wsc--wide');
  const bars = card('By pillar, before and now', C.pairedBars({ rows: pillarRows }), 'wsc--bars');
  const donut = card('Fix list by status', C.donut({ centreLabel: 'items', aria: 'Fix list by status', segments: Fix.STATUSES.map((st) => ({ label: FIX_STATUS_LABEL[st], value: counts[st], cls: statusCls[st] })) }), 'wsc--donut');
  const nextCard = card('Next up', next
    ? '<p class="wsc__next-t">' + esc(next.label) + '</p><p class="wsc__next-m">' + chip(next.status, FIX_STATUS_LABEL[next.status]) + ' <span class="ws-impact">' + esc(pts(next.max)) + '</span> <span class="wsc__muted">' + esc(Fix.PILLAR[next.cat] || '') + '</span></p>' + (next.advice ? '<p class="wsc__next-a">' + esc(next.advice) + '.</p>' : '') + '<p><a class="btn btn--primary" href="#fixes" data-ws-tab="fixes" data-open="di-' + esc(model.items.indexOf(next)) + '">Open this item</a></p>'
    : C.emptyState({ title: 'Nothing left to fix', text: 'Every failed check in the latest scan is verified.' }), 'wsc--next');
  return '<section class="ws-panel" id="overview" aria-labelledby="overview-h"><h2 class="ws-h" id="overview-h">Overview</h2>\n<div class="wsgrid wsgrid--fix">' + scoreCard + chart + bars + donut + nextCard + '</div>\n' +
    '<p class="ws-note">These are AI-readiness scores: crawler access and on-page signals, the same scan as the free scanner. They do not measure whether any assistant names a brand.</p>\n</section>\n';
}

function itemDrawer(model, i, idx) {
  const p = Fix.passes(i, model.last);
  const canVerify = !model.archived && i.status !== 'verified' && p !== null && !/^x-/.test(i.key);
  const verify = model.demo
    ? (i.status !== 'verified' && p !== null && !/^x-/.test(i.key) ? Shell.readOnlyButton('Verify') : '')
    : (canVerify ? '<button type="button" class="btn btn--ghost ws-verify" data-key="' + esc(i.key) + '">Verify</button>' : '');
  return '<template id="di-' + idx + '" data-title="' + esc(i.label) + '"><div class="wsd-sec"><p class="wsd-chips">' + chip(i.status, FIX_STATUS_LABEL[i.status]) + ' <span class="ws-impact">' + esc(pts(i.max)) + '</span> ' + (Fix.PILLAR[i.cat] ? '<span class="ws-chip">' + esc(Fix.PILLAR[i.cat]) + '</span>' : '') + '</p>' +
    (i.regressed ? '<p class="ws-item__meta">This check failed again after it was verified.</p>' : '') + (p === true && i.status !== 'verified' ? '<p class="ws-item__meta">It passes in the latest scan and is not verified yet.</p>' : '') +
    (i.advice ? '<h3 class="wsd-h">What to do</h3><p>' + esc(i.advice) + '.</p>' : '') + (i.why ? '<h3 class="wsd-h">Why it matters</h3><p>' + esc(i.why) + '</p>' : '') +
    (i.note ? '<h3 class="wsd-h">Note from Citehound</h3><div class="ws-md">' + md.render(i.note) + '</div>' : '') +
    (i.verifiedAt ? '<p class="ws-item__meta">Verified ' + esc(date(i.verifiedAt)) + '.</p>' : '') +
    '<p class="ws-item__actions">' + (i.file ? '<a class="ws-link" href="#files" data-ws-tab="files" data-close="1">See the ' + esc(i.file === 'robots' ? 'robots.txt' : i.file === 'llms' ? 'llms.txt' : 'schema') + ' file</a>' : '') + verify + '<span class="ws-verify__out" role="status" aria-live="polite"></span></p></div></template>';
}

function fixesPanel(model) {
  const rank = { todo: 0, in_progress: 1, applied: 2, verified: 3 };
  const order = model.items.map((it, idx) => ({ it: it, idx: idx })).sort((a, b) => (rank[a.it.status] - rank[b.it.status]) || (b.it.max - a.it.max));
  const o = Fix.overview(model.scans, model.last, model.items);
  const total = model.items.length, ver = o.counts.verified;
  const left = model.last ? Math.max(0, 100 - model.last.total) : 0;
  const filters = [['all', 'All', total]].concat(Fix.STATUSES.map((st) => [st, FIX_STATUS_LABEL[st], o.counts[st]]));
  const chips = '<div class="wsf" role="group" aria-label="Filter the Fix list" data-for="wsiList" data-attr="status" data-none="wsiNone">' + filters.map((f, i) => '<button type="button" class="wsf__chip' + (i === 0 ? ' is-on' : '') + '" data-filter="' + esc(f[0]) + '" aria-pressed="' + (i === 0 ? 'true' : 'false') + '">' + esc(f[1]) + ' <b>' + esc(f[2]) + '</b></button>').join('') + '</div>';
  const cards = order.map((x) => { const i = x.it;
    return '<li class="wsi-li" data-status="' + esc(i.status) + '"><button type="button" class="wsi" data-drawer="di-' + x.idx + '" aria-haspopup="dialog"><span class="wsi__main"><span class="wsi__title">' + esc(i.label) + '</span><span class="wsi__meta">' + esc(Fix.PILLAR[i.cat] || 'Custom item') + (i.regressed ? ' &middot; failed again' : '') + '</span></span><span class="wsi__chips"><span class="ws-impact">' + esc(pts(i.max)) + '</span>' + chip(i.status, FIX_STATUS_LABEL[i.status]) + '</span></button></li>'; }).join('\n');
  return '<section class="ws-panel" id="fixes" aria-labelledby="fixes-h"><h2 class="ws-h" id="fixes-h">Fix list</h2>\n' +
    (total ? C.progress({ value: ver, max: total, caption: '<b>' + esc(ver) + ' of ' + esc(total) + '</b> verified &middot; <b>' + esc(left) + '</b> points still available', aria: ver + ' of ' + total + ' items verified' }) : '') +
    '<p class="ws-lede">One item for each failed check. We set an item to applied when the change is on your site. Verify runs the check again and marks it verified only if it passes. Select an item for the details.</p>\n' +
    (total ? chips + '<ul class="wsi-list" id="wsiList">\n' + cards + '\n</ul>\n<p class="ws-empty" id="wsiNone" hidden>Nothing in this status.</p>\n' : C.emptyState({ title: 'Nothing to fix', text: 'No check failed in the latest scan.' })) + '</section>\n';
}

function codeBlock(text) { return '<pre class="ws-code" tabindex="0"><code>' + text.split('\n').map((l) => '<span class="cl">' + esc(l) + '</span>').join('\n') + '</code></pre>'; }

function filesPanel(model) {
  const fl = Fix.files(model.meta, model.last);
  const tabs = '<div class="wsfile__tabs" role="tablist" aria-label="Files">' + fl.map((f, i) => '<button type="button" class="wsfile__tab' + (i === 0 ? ' is-on' : '') + '" role="tab" id="ft-' + esc(f.id) + '" aria-controls="file-' + esc(f.id) + '" aria-selected="' + (i === 0 ? 'true' : 'false') + '"' + (i === 0 ? '' : ' tabindex="-1"') + ' data-file="' + esc(f.id) + '">' + esc(f.id === 'robots' ? 'robots.txt' : f.id === 'llms' ? 'llms.txt' : 'Schema') + '</button>').join('') + '</div>';
  const panes = fl.map((f, i) => '<div class="wsfile__pane" id="file-' + esc(f.id) + '" role="tabpanel" aria-labelledby="ft-' + esc(f.id) + '"' + (i === 0 ? '' : ' data-off="1"') + '><div class="wsfile__head"><h3 class="wsfile__title">' + esc(f.name) + '</h3><button type="button" class="btn btn--ghost ws-copy" data-copy="file-' + esc(f.id) + '">Copy</button></div><p class="ws-file__where">' + esc(f.where) + '</p>' + codeBlock(f.text) + '</div>').join('\n');
  return '<section class="ws-panel" id="files" aria-labelledby="files-h"><h2 class="ws-h" id="files-h">Files</h2>\n<p class="ws-lede">Generated for this site with the same builders as the free tools. Text in [brackets] is for you to fill in.</p>\n<div class="wsfile">' + tabs + panes + '</div>\n</section>\n';
}

function historyPanel(model) {
  const scans = model.scans.slice().reverse();
  const KIND = { baseline: 'First scan', rescan: 'Rescan', verify: 'Verify run' };
  const rows = scans.map((s, idx) => { const prev = scans[idx + 1]; const d = prev ? s.score - prev.score : null;
    return '<tr><th scope="row">' + esc(date(s.at)) + '</th><td>' + esc(KIND[s.kind] || s.kind) + '</td><td><b>' + esc(s.score) + '</b>/100</td><td>' + (d === null ? '&ndash;' : '<span class="ws-delta-sm' + (d < 0 ? ' ws-delta-sm--down' : d === 0 ? ' ws-delta-sm--flat' : '') + '">' + (d > 0 ? '+' : '') + esc(d) + '</span>') + '</td><td>' + esc(s.failing) + ' failing</td></tr>'; }).join('\n');
  const chart = C.lineChart({ points: model.scans.map((s) => ({ t: Date.parse(s.at), y: s.score, tip: date(s.at) + ': ' + s.score + '/100' })), xLabel: shortDate, aria: 'Score at each scan' });
  return '<section class="ws-panel" id="history" aria-labelledby="history-h"><h2 class="ws-h" id="history-h">History</h2>\n<p class="ws-lede">Every scan of this site in this workspace, newest first.</p>\n' +
    '<div class="wsgrid wsgrid--one">' + card('Score across scans', chart) + '</div>\n' +
    (rows ? '<div class="ws-tablewrap"><table class="ws-table"><thead><tr><th scope="col">Date</th><th scope="col">Scan</th><th scope="col">Score</th><th scope="col">Change</th><th scope="col">Checks failing</th></tr></thead><tbody>\n' + rows + '\n</tbody></table></div>\n' : C.emptyState({ title: 'No scan yet' })) + '</section>\n';
}

function fixPage(model) {
  const m = model.meta;
  const o = Fix.overview(model.scans, model.last, model.items);
  const open = o.counts.todo + o.counts.in_progress + o.counts.applied;
  const nav = [{ id: 'overview', label: 'Overview', icon: 'grid' }, { id: 'fixes', label: 'Fix list', icon: 'wrench', count: open }, { id: 'files', label: 'Files', icon: 'document', count: 3 }, { id: 'history', label: 'History', icon: 'clock', count: model.scans.length }, { id: 'pro', label: 'Pro report', icon: 'report', tag: 'Included' }];
  const drawers = model.items.map((it, idx) => itemDrawer(model, it, idx)).join('\n');
  return Shell.appPage({ title: (model.demo ? 'Demo: ' : '') + 'Citehound Fix workspace for ' + m.domain, tier: 'FIX', kind: 'fix', kindLabel: 'Fix workspace', meta: m, demo: model.demo, archived: model.archived, nav: nav,
    panels: fixOverview(model) + fixesPanel(model) + filesPanel(model) + historyPanel(model) + proPanel(model), drawers: drawers });
}

function workspacePage(model) {
  return model.meta.type === 'beyond' ? beyondPage(model) : fixPage(model);
}

/* ---------- Beyond ---------- */

const bchip = (status) => chip(status, Bey.STATUS_LABEL[status] || status);
const COVER_CLS = { covered: 'verified', progress: 'in_progress', gap: 'todo' };
const coverChip = (st) => chip(COVER_CLS[st], Bey.COVER_LABEL[st]);
const PRIO_N = { high: 3, medium: 2, low: 1 };
const PRIO_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
const heat = (p) => '<span class="ws-heat ws-heat--' + esc(p) + '" aria-hidden="true"><i></i><i></i><i></i></span><span class="ws-heat__lbl">' + esc(PRIO_LABEL[p] || p) + '</span>';
const WHO = { client: 'You', admin: 'Citehound' };
const KIND = { approve: 'approved', changes: 'asked for changes', note: 'added a note' };
const monthName = (m) => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthShort = (m) => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });

// The details of one piece: its text, the thread, the questions it answers, and (when it is in review) the client's two controls. On a demo the controls are disabled.
function pieceDrawer(p, model) {
  const readOnly = model.demo || model.archived;
  const qs = (p.forIds || []).map((id) => model.questions.filter((q) => q.id === id)[0]).filter(Boolean);
  const thread = (p.comments || []).map((c) => '<li class="ws-cm ws-cm--' + esc(c.by) + '"><p class="ws-cm__who"><b>' + esc(WHO[c.by] || c.by) + '</b> ' + esc(KIND[c.kind] || '') + ' &middot; ' + esc(date(c.at)) + '</p>' + (c.text ? '<p class="ws-cm__text">' + esc(c.text) + '</p>' : '') + '</li>').join('');
  let review = '';
  if (p.status === 'in_review') {
    review = model.demo
      ? '<div class="ws-review ws-review--ro"><label class="ps-label">Your comment <span class="wl-opt">(needed to ask for changes)</span></label><textarea class="field ps-input ws-review__text" rows="3" disabled aria-disabled="true"></textarea><p class="ws-review__actions">' + Shell.readOnlyButton('Approve', 'btn--primary') + Shell.readOnlyButton('Request changes') + '</p></div>'
      : model.archived ? '<p class="ws-note">This workspace is archived, so it is read-only.</p>'
      : '<div class="ws-review" data-cid="' + esc(p.id) + '"><label class="ps-label" for="rv-' + esc(p.id) + '">Your comment <span class="wl-opt">(needed to ask for changes)</span></label>' +
        '<textarea class="field ps-input ws-review__text" id="rv-' + esc(p.id) + '" rows="3" maxlength="1000"></textarea>' +
        '<p class="ws-review__actions"><button type="button" class="btn btn--primary ws-review__btn" data-action="approve">Approve</button><button type="button" class="btn btn--ghost ws-review__btn" data-action="changes">Request changes</button><span class="ws-review__out" role="status" aria-live="polite"></span></p></div>';
  }
  return '<template id="dp-' + esc(p.id) + '" data-title="' + esc(p.title) + '"><div class="wsd-sec"><p class="wsd-chips"><span class="ws-chip">' + esc(p.type) + '</span>' + bchip(p.status) + (Bey.changesRequested(p) ? chip('changes', 'Changes requested') : '') + '</p>' +
    '<p class="ws-item__meta">Updated ' + esc(date(p.updatedAt)) + (p.version > 1 ? ' &middot; version ' + esc(p.version) : '') + '</p>' +
    (qs.length ? '<h3 class="wsd-h">Answers</h3><ul class="wsd-list">' + qs.map((q) => '<li>' + esc(q.text) + '</li>').join('') + '</ul>' : '') +
    '<h3 class="wsd-h">The text</h3><div class="ws-md ws-piece-text">' + md.render(p.body) + '</div>' +
    (thread ? '<h3 class="wsd-h">Comments</h3><ul class="ws-cms" aria-label="Comments on ' + esc(p.title) + '">' + thread + '</ul>' : '') + review + '</div></template>';
}

function gapDrawer(g, idx, model) {
  const linked = Bey.piecesForGap(g, model.questions, model.pieces);
  return '<template id="dg-' + idx + '" data-title="' + esc(g.question) + '"><div class="wsd-sec"><p class="wsd-chips"><span class="ws-prio ws-prio--' + esc(g.priority) + '">' + esc(PRIO_LABEL[g.priority] || g.priority) + ' priority</span></p>' +
    '<h3 class="wsd-h">Page</h3><p class="ws-mono">' + (g.page ? esc(g.page) : 'No page covers it yet') + '</p>' +
    '<h3 class="wsd-h">The gap</h3><p>' + esc(g.note || 'No note yet.') + '</p>' +
    '<h3 class="wsd-h">Linked piece</h3>' + (linked.length ? '<ul class="wsd-list">' + linked.map((p) => '<li><button type="button" class="ws-link ws-linkbtn" data-drawer="dp-' + esc(p.id) + '">' + esc(p.title) + '</button> ' + bchip(p.status) + '</li>').join('') + '</ul>' : '<p class="ws-muted">No piece is linked to this question yet.</p>') + '</div></template>';
}

function beyondOverview(model) {
  const c = Bey.counts(model.pieces);
  const cov = Bey.coverage(model.questions, model.pieces);
  const nCov = cov.filter((x) => x.status === 'covered').length, nProg = cov.filter((x) => x.status === 'progress').length, nGap = cov.filter((x) => x.status === 'gap').length;
  const stepper = card('Pipeline', C.stepper({ aria: 'Where the work stands', steps: [
    { label: 'Questions', count: model.questions.length, state: model.questions.length ? 'done' : 'next' }, { label: 'Gaps', count: model.gaps.length, state: model.gaps.length ? 'done' : 'next' },
    { label: 'Draft', count: c.draft, state: c.draft ? 'done' : 'next' }, { label: 'In review', count: c.in_review, state: c.in_review ? 'now' : 'next' },
    { label: 'Approved', count: c.approved, state: c.approved ? 'done' : 'next' }, { label: 'Published', count: c.published, state: c.published ? 'done' : 'next' }] }), 'wsc--full');
  const waiting = model.pieces.filter((p) => p.status === 'in_review');
  const waitCard = card('Waiting for you', waiting.length
    ? '<ul class="ws-wait">' + waiting.map((p) => '<li class="ws-wait__row"><span class="ws-wait__main"><b>' + esc(p.title) + '</b><span class="wsc__muted">' + esc(p.type) + ' &middot; updated ' + esc(date(p.updatedAt)) + '</span></span><span class="ws-wait__act"><button type="button" class="btn btn--ghost" data-drawer="dp-' + esc(p.id) + '">Read</button>' + (model.demo ? Shell.readOnlyButton('Approve', 'btn--primary') : '') + '</span></li>').join('') + '</ul>'
    : C.emptyState({ title: 'Nothing is waiting for you', text: 'When we put a piece in review it appears here, and you can approve it or ask for changes.' }), 'wsc--wide');
  const donut = card('Question coverage', C.donut({ centreLabel: 'questions', aria: 'Questions by coverage', segments: [{ label: 'Covered', value: nCov, cls: 'covered' }, { label: 'In progress', value: nProg, cls: 'progress' }, { label: 'Gap', value: nGap, cls: 'gap' }] }) +
    '<p class="wsc__muted wsc__note">Covered: an approved or published piece answers it. In progress: a draft or a piece in review does. Gap: none yet.</p>');
  const months = Bey.monthsTable(model.scans, model.months).filter((r) => r.score !== null).reverse();
  const chart = card('Readiness score by month', C.lineChart({ points: months.map((r) => ({ t: Date.parse(r.scanAt), y: r.score, tip: monthName(r.month) + ': ' + r.score + '/100' })), xLabel: (t) => monthShort(new Date(t).toISOString().slice(0, 7)), aria: 'Readiness score at each monthly scan' }), 'wsc--wide');
  const feed = Bey.activity(model.pieces, model.scans, 8);
  const feedCard = card('Recent activity', feed.length ? '<ul class="ws-feed">' + feed.map((e) => {
    const who = e.kind === 'measure' ? 'Citehound' : (WHO[e.by] || e.by);
    const what = e.kind === 'start' ? 'started a draft' : e.kind === 'measure' ? '' : (KIND[e.kind] || '');
    const label = e.kind === 'measure' ? esc(e.text) : '<b>' + esc(who) + '</b> ' + esc(what) + ' <button type="button" class="ws-linkbtn" data-drawer="dp-' + esc(e.piece.id) + '">' + esc(e.piece.title) + '</button>' + (e.text && e.kind !== 'start' ? '<span class="ws-feed__txt">' + esc(e.text) + '</span>' : '');
    return '<li class="ws-feed__row ws-feed__row--' + esc(e.by) + '"><span class="ws-feed__dot" aria-hidden="true"></span><span class="ws-feed__body">' + label + '</span><span class="ws-feed__date">' + esc(shortDate(e.at)) + '</span></li>'; }).join('') + '</ul>' : C.emptyState({ title: 'No activity yet' }));
  return '<section class="ws-panel" id="overview" aria-labelledby="overview-h"><h2 class="ws-h" id="overview-h">Overview</h2>\n<div class="wsgrid wsgrid--bey">' + stepper + waitCard + donut + chart + feedCard + '</div></section>\n';
}

function questionsPanel(model) {
  const cov = Bey.coverage(model.questions, model.pieces);
  const cards = cov.map((x) => '<li class="wsq wsq--' + esc(x.status) + '"><p class="wsq__text">' + esc(x.question.text) + '</p><p class="wsq__foot">' + coverChip(x.status) + (x.pieces.length ? x.pieces.map((p) => '<button type="button" class="ws-linkbtn" data-drawer="dp-' + esc(p.id) + '">' + esc(p.title) + '</button>').join('') : '<span class="wsc__muted">No piece yet</span>') + '</p></li>').join('\n');
  return '<section class="ws-panel" id="questions" aria-labelledby="questions-h"><h2 class="ws-h" id="questions-h">Questions</h2>\n' +
    '<p class="ws-lede">The questions your customers ask an assistant, in their words. Your pages are read against these. A question is covered when an approved or published piece answers it.</p>\n' +
    (cards ? '<ul class="wsq-list">\n' + cards + '\n</ul>\n' : C.emptyState({ title: 'The question list is being written' })) + '</section>\n';
}

function gapsPanel(model) {
  const filters = [['all', 'All', model.gaps.length]].concat(Bey.PRIORITIES.map((p) => [p, PRIO_LABEL[p], model.gaps.filter((g) => g.priority === p).length]));
  const chips = '<div class="wsf" role="group" aria-label="Filter the gaps by priority" data-for="wsGaps" data-attr="prio" data-none="wsGapsNone">' + filters.map((f, i) => '<button type="button" class="wsf__chip' + (i === 0 ? ' is-on' : '') + '" data-filter="' + esc(f[0]) + '" aria-pressed="' + (i === 0 ? 'true' : 'false') + '">' + esc(f[1]) + ' <b>' + esc(f[2]) + '</b></button>').join('') + '</div>';
  const rows = model.gaps.map((g, idx) => '<tr data-prio="' + esc(g.priority) + '" data-drawer="dg-' + idx + '" tabindex="0" role="button" aria-haspopup="dialog"><td>' + esc(g.question) + '</td><td class="ws-mono">' + (g.page ? esc(g.page) : 'No page') + '</td><td>' + esc(g.note) + '</td><td data-v="' + PRIO_N[g.priority] + '">' + heat(g.priority) + '</td></tr>').join('\n');
  return '<section class="ws-panel" id="gaps" aria-labelledby="gaps-h"><h2 class="ws-h" id="gaps-h">Gaps</h2>\n' +
    '<p class="ws-lede">For each question: the page that should answer it, and what is missing. Select a row for the details.</p>\n' +
    (rows ? chips + '<div class="ws-tablewrap"><table class="ws-table ws-table--rows"><thead><tr><th scope="col" data-sort>Question</th><th scope="col" data-sort>Page</th><th scope="col">Gap</th><th scope="col" data-sort>Priority</th></tr></thead><tbody id="wsGaps">\n' + rows + '\n</tbody></table></div>\n<p class="ws-empty" id="wsGapsNone" hidden>No gap with this priority.</p>\n' : C.emptyState({ title: 'No gaps entered yet' })) + '</section>\n';
}

function contentPanel(model) {
  const c = Bey.counts(model.pieces);
  const col = (st) => { const ps = model.pieces.filter((p) => p.status === st);
    return '<div class="wsb__col" data-col="' + st + '"><h3 class="wsb__h">' + esc(Bey.STATUS_LABEL[st]) + ' <span>' + esc(ps.length) + '</span></h3>' +
      (ps.length ? ps.map((p) => '<button type="button" class="wsb__card" data-drawer="dp-' + esc(p.id) + '" aria-haspopup="dialog"><span class="wsb__title">' + esc(p.title) + '</span><span class="wsb__meta"><span class="ws-chip">' + esc(p.type) + '</span>' + (Bey.changesRequested(p) ? chip('changes', 'Changes requested') : bchip(p.status)) + '</span><span class="wsb__foot">Updated ' + esc(shortDate(p.updatedAt)) + (p.comments && p.comments.length ? ' &middot; ' + esc(p.comments.length) + ' comment' + (p.comments.length === 1 ? '' : 's') : '') + '</span></button>').join('') : '<p class="wsb__none">None</p>') + '</div>'; };
  return '<section class="ws-panel" id="content" aria-labelledby="content-h"><h2 class="ws-h" id="content-h">Content</h2>\n' +
    '<p class="ws-lede">What we write for you: new pages, FAQ and comparison blocks, rewrites. People edit every draft. You approve each piece before we publish it or hand it over. Select a piece to read it.</p>\n' +
    '<ul class="ws-counts" aria-label="Content by status">' + Bey.STATUSES.map((s) => '<li>' + bchip(s) + ' <b>' + esc(c[s]) + '</b></li>').join('') + '</ul>\n' +
    (model.pieces.length ? '<div class="wsb">' + Bey.STATUSES.map(col).join('') + '</div>\n' : C.emptyState({ title: 'No pieces yet' })) + '</section>\n';
}

function monthlyPanel(model) {
  const rows = Bey.monthsTable(model.scans, model.months);
  const asc = rows.filter((r) => r.score !== null).slice().reverse();
  const chart = card('Readiness score by month', C.lineChart({ points: asc.map((r) => ({ t: Date.parse(r.scanAt), y: r.score, tip: monthName(r.month) + ': ' + r.score + '/100' })), xLabel: (t) => monthShort(new Date(t).toISOString().slice(0, 7)), aria: 'Readiness score at each monthly scan' }));
  const anyCit = rows.some((r) => r.citation);
  const body = rows.map((r, i) => { const prev = rows[i + 1] && rows[i + 1].score !== null ? rows[i + 1].score : null; const d = r.score !== null && prev !== null ? r.score - prev : null;
    return '<tr><th scope="row">' + esc(monthName(r.month)) + '</th><td>' + (r.score === null ? '&ndash;' : '<b>' + esc(r.score) + '</b>/100') + (r.scanAt ? '<br /><span class="ws-note-inline">scanned ' + esc(date(r.scanAt)) + '</span>' : '') + '</td><td>' + (d === null ? '&ndash;' : '<span class="ws-delta-sm' + (d < 0 ? ' ws-delta-sm--down' : d === 0 ? ' ws-delta-sm--flat' : '') + '">' + (d > 0 ? '+' : '') + esc(d) + '</span>') + '</td>' +
      (anyCit ? '<td>' + (r.citation ? 'Named in <b>' + esc(r.citation.named) + '</b> of ' + esc(r.citation.asked) + ' questions' + (r.citation.model ? ' &middot; ' + esc(r.citation.model) : '') + (r.citation.note ? '<br /><span class="ws-note-inline">' + esc(r.citation.note) + '</span>' : '') : '<span class="ws-muted">&ndash;</span>') + '</td>' : '') + '</tr>'; }).join('\n');
  const cit = anyCit ? '' : '<div class="wsc wsc--cit">' + C.emptyState({ title: 'Citation check: pilot. Not run for this project yet.', text: 'When a run is made, its result appears here: a dated sample of one assistant’s answers to your questions, one run each, never a ranking.' }) + '</div>';
  return '<section class="ws-panel" id="monthly" aria-labelledby="monthly-h"><h2 class="ws-h" id="monthly-h">Monthly</h2>\n' +
    '<p class="ws-lede">Each month we measure again. The score is the AI-readiness score of that month’s scan: crawler access and on-page signals.</p>\n' +
    '<div class="wsgrid wsgrid--one">' + chart + '</div>\n' +
    '<p class="ws-pilot"><span class="ws-chip ws-chip--in_progress">Citation check: pilot</span> The citation check is a pilot. It is a dated sample of one assistant’s answers to your questions, one run each, never a ranking.</p>\n' +
    (rows.length ? '<div class="ws-tablewrap"><table class="ws-table ws-table--months"><thead><tr><th scope="col">Month</th><th scope="col">AI-readiness score</th><th scope="col">Change</th>' + (anyCit ? '<th scope="col">Citation check (pilot)</th>' : '') + '</tr></thead><tbody>\n' + body + '\n</tbody></table></div>\n' : C.emptyState({ title: 'No measurement yet' })) + cit + '</section>\n';
}

function beyondPage(model) {
  const m = model.meta;
  const c = Bey.counts(model.pieces);
  const nav = [{ id: 'overview', label: 'Overview', icon: 'grid' }, { id: 'questions', label: 'Questions', icon: 'question', count: model.questions.length }, { id: 'gaps', label: 'Gaps', icon: 'layers', count: model.gaps.length },
    { id: 'content', label: 'Content', icon: 'document', count: model.pieces.length }, { id: 'monthly', label: 'Monthly', icon: 'clock' }, { id: 'pro', label: 'Pro report', icon: 'report', tag: 'Included' }];
  const drawers = model.pieces.map((p) => pieceDrawer(p, model)).join('\n') + '\n' + model.gaps.map((g, i) => gapDrawer(g, i, model)).join('\n');
  return Shell.appPage({ title: (model.demo ? 'Demo: ' : '') + 'Citehound Beyond workspace for ' + m.domain, tier: 'BEYOND', kind: 'beyond', kindLabel: 'Beyond workspace', meta: m, demo: model.demo, archived: model.archived, nav: nav,
    defaultTab: 'overview', summary: esc(model.questions.length) + ' questions &middot; ' + esc(model.gaps.length) + ' gaps &middot; ' + esc(c.approved + c.published) + ' of ' + esc(model.pieces.length) + ' pieces approved' + (c.in_review ? ' &middot; <b>' + esc(c.in_review) + ' waiting for your review</b>' : ''),
    panels: beyondOverview(model) + questionsPanel(model) + gapsPanel(model) + contentPanel(model) + monthlyPanel(model) + proPanel(model), drawers: drawers });
}

function notFound() {
  return Page.shell('Citehound: link not available', 'ps-body', Page.card('<p class="ps-kicker">Citehound</p><h1 class="ps-title">This link is not available</h1><p class="ps-lead">The link may be wrong, or the workspace may no longer exist.</p>'));
}

module.exports = { workspacePage: workspacePage, notFound: notFound, date: date, esc: esc };
