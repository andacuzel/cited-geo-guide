/* =====================================================================
   lib/ws-shell.js: the app shell of the workspace pages (client views and the public demos), for Fix and Beyond.

   A navy sidebar (the product lockup once, the project's domain, the sections with icons and counts, the active one in gold), a slim top bar (the domain, status
   chips, "Included: Citehound Pro"), and the content on the light base. No marketing footer on these pages. The details drawer, the tooltip and the toast are
   here too; app/ws-view.js drives them. Presentation only: nothing here reads or changes data.
   Without JavaScript every section is shown one after the other and the sidebar links jump to them.
   ===================================================================== */

'use strict';

const Page = require('./pro-report-page.js');
const icons = require('./icons.js');
const lockup = require('./lockup.js');

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const date = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
const shortDate = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); };

const SCRIPTS = '  <script src="/app/ws-view.js?v=3" defer></script>\n';

// The sidebar and top bar. nav: [{ id, label, icon, count?, tag? }].
function sidebar(o) {
  const links = o.nav.map((n, i) => '<a class="wsapp__link" href="#' + esc(n.id) + '" data-ws-tab="' + esc(n.id) + '"' + (i === 0 ? ' aria-current="true"' : '') + '>' + icons.svg(n.icon, { cls: 'wsapp__ico' }) + '<span class="wsapp__lbl">' + esc(n.label) + '</span>' +
    (n.count !== undefined && n.count !== null ? '<span class="wsapp__count">' + esc(n.count) + '</span>' : '') + (n.tag ? '<span class="wsapp__tag">' + esc(n.tag) + '</span>' : '') + '</a>').join('');
  return '<aside class="wsapp__side" aria-label="Workspace">\n' +
    '<a class="wsapp__brand" href="/" aria-label="Citehound home">' + lockup.html(o.tier, 'navy') + '</a>\n' +
    '<div class="wsapp__project"><span class="wsapp__plabel">Project</span><span class="wsapp__pdomain">' + esc(o.meta.domain) + '</span></div>\n' +
    '<nav class="wsapp__nav" aria-label="Workspace sections">' + links + '</nav>\n</aside>\n';
}

function topbar(o) {
  const chips = (o.archived ? '<span class="ws-chip">Archived</span>' : '<span class="ws-chip ws-chip--verified">Active</span>');
  return '<header class="wsapp__top"><div class="wsapp__titles"><h1 class="ws-head__title">' + esc(o.meta.domain) + '</h1><p class="ws-head__sub">' + esc(o.kindLabel) + ' &middot; started ' + esc(date(o.meta.createdAt)) + (o.archived ? ' &middot; archived, read-only' : '') + '</p>' + (o.summary ? '<p class="ws-head__sum">' + o.summary + '</p>' : '') + '</div>' +
    '<div class="wsapp__topr">' + chips + '<a class="wsapp__incl" href="#pro" data-ws-tab="pro"><b>Included:</b> Citehound Pro</a></div></header>\n';
}

// o: { title, tier ('FIX' | 'BEYOND'), kind ('fix' | 'beyond'), kindLabel, meta, demo, archived, nav, panels, defaultTab, drawers }
function appPage(o) {
  const ribbon = o.demo ? '<div class="ws-ribbon" role="note"><b>Product demo &middot; Sample data</b><span>A fictional project. Nothing here belongs to a real customer, and nothing can be changed.</span></div>\n' : '';
  const body = ribbon + '<div class="ws wsapp wsapp--' + esc(o.kind) + (o.demo ? ' ws--demo' : '') + '" data-default-tab="' + esc(o.defaultTab || o.nav[0].id) + '">\n' +
    sidebar(o) + '<div class="wsapp__main">\n' + topbar(o) + '<main id="main" class="wsapp__content">\n' + o.panels + '</main>\n</div>\n</div>\n' +
    (o.drawers || '') +
    '<div class="wsd-scrim" id="wsScrim" hidden></div>\n' +
    '<aside class="wsd" id="wsDrawer" role="dialog" aria-modal="true" aria-labelledby="wsdTitle" aria-hidden="true" tabindex="-1" hidden><div class="wsd__head"><h2 class="wsd__title" id="wsdTitle"></h2><button type="button" class="wsd__close" aria-label="Close the details">&times;</button></div><div class="wsd__body" id="wsdBody"></div></aside>\n' +
    '<div class="wst" id="wsTip" role="tooltip" hidden></div>\n<div class="toast" id="toast" role="status" aria-live="polite"></div>\n';
  return Page.shell(o.title, 'ws-body wsapp-body', body, SCRIPTS, { footer: false });
}

// A control a visitor of a demo sees but cannot use: disabled, with a tooltip that says why (the wrapper takes the hover and focus, a disabled button does not).
const readOnlyButton = (label, cls) => '<span class="ws-ro" tabindex="0" data-tip="Demo is read-only" role="note" aria-label="' + esc(label) + ': the demo is read-only"><button type="button" class="btn ' + esc(cls || 'btn--ghost') + ' ws-ro-btn" disabled aria-disabled="true">' + esc(label) + '</button></span>';

const chip = (status, label) => '<span class="ws-chip ws-chip--' + esc(status) + '">' + esc(label) + '</span>';

module.exports = { appPage: appPage, esc: esc, date: date, shortDate: shortDate, chip: chip, readOnlyButton: readOnlyButton, SCRIPTS: SCRIPTS };
