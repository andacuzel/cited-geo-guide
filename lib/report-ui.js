/* =====================================================================
   lib/report-ui.js — turns the static report markup into the dashboard.

   The markup from lib/report-render.js is complete without this file: every
   section is there, in order. This script only enhances it:
     - the Summary / Pages / Checks / Fixes / Citations sections become tabs
       (real tablist semantics, arrow/Home/End keys, state in the URL hash)
     - the page list becomes master-detail with search, filters and sort,
       showing the worst ten until "Show all"
     - large heat-matrix groups collapse
     - copy buttons, Print
   Print shows every section: beforeprint opens every <details>, and the
   print stylesheet un-hides the panels.

   Hash: #summary #pages #checks #fixes #citations, and #rp-item-N for one page.
   ===================================================================== */
(function () {
  'use strict';

  var WIDE = '(min-width: 901px)';
  var COLLAPSE_OVER = 12;

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function init(rootEl) {
    var root = rootEl || $('.rp-report');
    if (!root || root.getAttribute('data-ready')) return;
    root.setAttribute('data-ready', '1');
    root.classList.add('rp-js');

    var panels = $$('.rp-panel[data-tab]', root);
    var tabs = {};
    var order = panels.map(function (p) { return p.getAttribute('data-tab'); });

    /* ---------- tabs ---------- */
    var toc = $('.rp-toc', root);
    var list = document.createElement('div');
    list.className = 'rp-tablist';
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', 'Report sections');
    order.forEach(function (id) {
      var link = toc && $('a[data-tab-link="' + id + '"]', toc);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rp-tab';
      btn.id = 'rp-tab-' + id;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', 'rp-' + id);
      btn.innerHTML = link ? link.innerHTML : id;
      btn.addEventListener('click', function () { activate(id, true); });
      btn.addEventListener('keydown', function (e) {
        var i = order.indexOf(id), n = order.length, to = null;
        if (e.key === 'ArrowRight') to = order[(i + 1) % n];
        else if (e.key === 'ArrowLeft') to = order[(i - 1 + n) % n];
        else if (e.key === 'Home') to = order[0];
        else if (e.key === 'End') to = order[n - 1];
        if (to) { e.preventDefault(); activate(to, true); tabs[to].focus(); }
      });
      tabs[id] = btn;
      list.appendChild(btn);
    });
    if (toc) toc.parentNode.insertBefore(list, toc);
    panels.forEach(function (p) {
      var id = p.getAttribute('data-tab');
      p.setAttribute('role', 'tabpanel');
      p.setAttribute('aria-labelledby', 'rp-tab-' + id);
      p.setAttribute('tabindex', '0');
    });

    var current = null;
    function activate(id, writeHash) {
      if (order.indexOf(id) === -1) id = order[0];
      current = id;
      order.forEach(function (t) {
        var on = t === id;
        tabs[t].setAttribute('aria-selected', on ? 'true' : 'false');
        tabs[t].setAttribute('tabindex', on ? '0' : '-1');
        var p = $('#rp-' + t, root);
        if (p) p.hidden = !on;
      });
      if (writeHash && window.history && history.replaceState) history.replaceState(null, '', '#' + id);
    }

    /* ---------- pages: master-detail ---------- */
    var listEl = $('.rp-list', root);
    var items = $$('.rp-item', root);
    var pane = $('[data-pane]', root);
    var controls = $('.rp-controls', root);
    var moreWrap = $('.rp-more-wrap', root);
    var shown = listEl ? parseInt(listEl.getAttribute('data-shown'), 10) || 10 : 10;
    var state = { q: '', check: '', section: '', sort: 'score', all: false };
    var selected = null;

    function isWide() { return window.matchMedia && window.matchMedia(WIDE).matches; }

    function matches(it) {
      if (state.q && it.getAttribute('data-path').toLowerCase().indexOf(state.q.toLowerCase()) === -1) return false;
      if (state.section && it.getAttribute('data-section') !== state.section) return false;
      if (state.check && it.getAttribute('data-checks').split('|').indexOf(state.check) === -1) return false;
      return true;
    }

    function apply() {
      if (!listEl) return;
      var sorted = items.slice().sort(function (a, b) {
        var sa = +a.getAttribute('data-score'), sb = +b.getAttribute('data-score');
        var fa = +a.getAttribute('data-failed'), fb = +b.getAttribute('data-failed');
        var pa = a.getAttribute('data-path'), pb = b.getAttribute('data-path');
        if (state.sort === 'failed') return fb - fa || sa - sb || (pa < pb ? -1 : 1);
        if (state.sort === 'path') return pa < pb ? -1 : pa > pb ? 1 : 0;
        return sa - sb || fb - fa || (pa < pb ? -1 : 1);
      });
      var k = 0;
      sorted.forEach(function (it) {
        listEl.appendChild(it);
        var m = matches(it);
        it.classList.toggle('is-hidden', !m);
        if (m) { it.classList.toggle('rp-more', k >= shown); k++; } else it.classList.remove('rp-more');
      });
      listEl.classList.toggle('is-all', state.all);
      var total = k;
      if (moreWrap) {
        moreWrap.hidden = state.all || total <= shown;
        var btn = $('[data-show-all]', moreWrap);
        if (btn) btn.textContent = 'Show all ' + total;
      }
      var empty = $('[data-empty]', root);
      if (empty) empty.hidden = total !== 0;
    }

    function select(it, quiet) {
      if (!it) return;
      if (!isWide()) {
        var wasOpen = it.classList.contains('is-open');
        items.forEach(function (x) { x.classList.remove('is-open'); });
        if (!wasOpen || !quiet) it.classList.add('is-open');
        selected = it;
      } else if (pane) {
        items.forEach(function (x) { x.classList.remove('is-selected'); });
        it.classList.add('is-selected');
        var d = $('.rp-detail', it);
        pane.innerHTML = '<p class="rp-pane__path">' + (it.getAttribute('data-path') || '').replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>' + (d ? d.outerHTML : '');
        pane.hidden = false;
        selected = it;
      }
    }

    function showPage(index, writeHash) {
      var it = $('#rp-item-' + index, root);
      if (!it) return;
      activate('pages', false);
      // Make sure the page is reachable through the current filters and the ten-page limit.
      if (!matches(it) || it.classList.contains('rp-more')) {
        state.q = ''; state.check = ''; state.section = ''; state.all = true;
        $$('[data-filter]', root).forEach(function (c) { if (c.tagName === 'SELECT' && c.getAttribute('data-filter') !== 'sort') { c.value = ''; c.classList.remove('is-on'); } else if (c.getAttribute('data-filter') === 'q') c.value = ''; });
        var all = $('[data-filter-all]', root); if (all) { all.classList.add('is-on'); all.setAttribute('aria-pressed', 'true'); }
        apply();
      }
      select(it, false);
      if (writeHash && window.history && history.replaceState) history.replaceState(null, '', '#rp-item-' + index);
      if (it.scrollIntoView) it.scrollIntoView({ block: 'nearest' });
    }

    if (listEl) {
      if (controls) controls.hidden = false;
      $$('.rp-item__row', root).forEach(function (row) {
        row.addEventListener('click', function (e) { e.preventDefault(); var it = row.parentNode; select(it, true); var i = it.getAttribute('data-index'); if (window.history && history.replaceState) history.replaceState(null, '', '#rp-item-' + i); });
      });
      var all = $('[data-filter-all]', root);
      function setOn(el, on) { if (el.tagName === 'SELECT') el.classList.toggle('is-on', on); }
      $$('[data-filter]', root).forEach(function (c) {
        var key = c.getAttribute('data-filter');
        c.addEventListener(c.tagName === 'INPUT' ? 'input' : 'change', function () {
          state[key] = c.value;
          if (key !== 'sort') setOn(c, !!c.value);
          if (all) { var any = state.q || state.check || state.section; all.classList.toggle('is-on', !any); all.setAttribute('aria-pressed', any ? 'false' : 'true'); }
          state.all = false;
          apply();
        });
      });
      if (all) all.addEventListener('click', function () {
        state.q = state.check = state.section = ''; state.all = false;
        $$('[data-filter]', root).forEach(function (c) { if (c.getAttribute('data-filter') !== 'sort') { c.value = ''; c.classList.remove('is-on'); } });
        all.classList.add('is-on'); all.setAttribute('aria-pressed', 'true');
        apply();
      });
      var showAll = $('[data-show-all]', root);
      if (showAll) showAll.addEventListener('click', function () { state.all = true; apply(); });
      apply();
    }

    /* ---------- links that jump to a page ---------- */
    $$('a[data-page]', root).forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); showPage(a.getAttribute('data-page'), true); var p = $('#rp-pages', root); if (p && p.scrollIntoView) p.scrollIntoView({ block: 'start' }); });
    });

    /* ---------- heat matrix: collapse large groups ---------- */
    $$('.rp-cluster', root).forEach(function (g) {
      var btn = $('[data-toggle-cluster]', g);
      if (!btn) return;
      btn.hidden = false;
      var rows = parseInt(g.getAttribute('data-rows'), 10) || 0;
      function set(collapsed) { g.classList.toggle('is-collapsed', collapsed); btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true'); btn.setAttribute('aria-label', (collapsed ? 'Expand ' : 'Collapse ') + 'this group of ' + rows + ' pages'); }
      set(rows > COLLAPSE_OVER);
      btn.addEventListener('click', function () { set(!g.classList.contains('is-collapsed')); });
    });

    /* ---------- copy and print ---------- */
    $$('[data-copy]', root).forEach(function (b) {
      b.hidden = false;
      b.addEventListener('click', function () {
        var code = $('.rp-code', b.closest('.rp-fix'));
        var text = code ? code.textContent : '';
        var done = function () { var s = $('span', b); if (s) { s.textContent = 'Copied'; setTimeout(function () { s.textContent = 'Copy'; }, 1600); } };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
        else { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { /* no clipboard */ } document.body.removeChild(ta); }
      });
    });
    $$('[data-action="print"]', document).forEach(function (b) { b.hidden = false; b.addEventListener('click', function () { window.print(); }); });

    /* ---------- hash state ---------- */
    function fromHash() {
      var h = (location.hash || '').replace(/^#/, '');
      var m = /^rp-item-(\d+)$/.exec(h);
      if (m) { showPage(m[1], false); return; }
      h = h.replace(/^rp-/, '');
      if (order.indexOf(h) !== -1) activate(h, false); else if (!current) activate(order[0], false);
    }
    window.addEventListener('hashchange', fromHash);
    activate(order[0], false);
    fromHash();
    // On a wide screen, show the worst page by default so the detail pane is not empty.
    if (isWide() && pane && !selected) { var firstVisible = items.filter(function (x) { return !x.classList.contains('is-hidden'); })[0]; if (firstVisible) select(firstVisible, true); }
  }

  // Print shows what is open, so open everything first and put it back after.
  var opened = [];
  window.addEventListener('beforeprint', function () {
    opened = [];
    $$('.rp-report details').forEach(function (d) { if (!d.open) { d.open = true; opened.push(d); } });
  });
  window.addEventListener('afterprint', function () { opened.forEach(function (d) { d.open = false; }); opened = []; });

  window.CITEHOUND_REPORT_UI = { init: init, initSortable: function () {} };
  function auto() { if ($('.rp-report') && !$('.rp-report').getAttribute('data-ready') && !window.__rpManual) init(); }
  if (document.readyState !== 'loading') auto(); else document.addEventListener('DOMContentLoaded', auto);
}());
