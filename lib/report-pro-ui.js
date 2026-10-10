/* =====================================================================
   lib/report-pro-ui.js: the behaviour of the Pro report layout.

   lib/report-render.js renderPro() writes a complete page: anchors work, the tables are
   plain tables, every <details> opens. This script only adds:
     - the section nav marks the section being read (aria-current)
     - the page table: sort by a column heading, search, filter, with a live count
     - Copy link, Email me this report, Print or save as PDF
     - copy buttons on the snippets
     - every <details> opened for printing, then restored

   The citation check section only filters its table and copies its questions here. No request is made except the one the email button asks for (POST /api/pro/email with
   the job id, and nothing else). Nothing is stored in the browser.
   ===================================================================== */
(function () {
  'use strict';

  var root = document.querySelector('.pr-report');
  if (!root) return;
  function $(sel, ctx) { return (ctx || root).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || root).querySelectorAll(sel)); }

  var statusEl = $('[data-pr-status-msg]');
  function say(text) {
    if (statusEl) statusEl.textContent = text;
    var toast = document.getElementById('toast');
    if (toast && text) { toast.textContent = text; toast.classList.add('is-visible'); clearTimeout(say.t); say.t = setTimeout(function () { toast.classList.remove('is-visible'); }, 2600); }
  }

  /* ---------- section nav ---------- */
  var links = $$('.pr-nav a');
  var targets = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });
  function mark(i) { links.forEach(function (a, k) { if (k === i) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); }); }
  function current() {
    var nav = $('.pr-nav');
    var navH = (nav ? nav.getBoundingClientRect().bottom : 56) + 24;
    var idx = 0;
    targets.forEach(function (t, i) { if (t && t.getBoundingClientRect().top <= navH) idx = i; });
    // At the very bottom the last section is the one being read.
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) idx = targets.length - 1;
    mark(idx);
  }
  var tick = 0;
  window.addEventListener('scroll', function () { if (tick) return; tick = requestAnimationFrame(function () { tick = 0; current(); }); }, { passive: true });
  window.addEventListener('hashchange', function () { setTimeout(current, 50); });
  current();

  /* ---------- copy link ---------- */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); } finally { document.body.removeChild(ta); }
    });
  }
  function reveal(sel) { $$(sel).forEach(function (b) { b.hidden = false; }); }

  reveal('[data-action="copy-link"]'); reveal('[data-action="print"]'); reveal('[data-action="email"]');
  var copyBtn = $('[data-action="copy-link"]');
  if (copyBtn) copyBtn.addEventListener('click', function () {
    var url = location.origin + location.pathname;
    copyText(url).then(function () { say('Link copied. Anyone with it can open this report.'); }, function () { say('The link could not be copied. Copy it from the address bar.'); });
  });

  /* ---------- print ---------- */
  var reopen = [];
  function openAll() { reopen = []; $$('details').forEach(function (d) { if (!d.open) { reopen.push(d); d.open = true; } }); }
  function restore() { reopen.forEach(function (d) { d.open = false; }); reopen = []; }
  window.addEventListener('beforeprint', openAll);
  window.addEventListener('afterprint', restore);
  var printBtn = $('[data-action="print"]');
  if (printBtn) printBtn.addEventListener('click', function () { window.print(); });

  /* ---------- email ---------- */
  var emailBtn = $('[data-action="email"]');
  if (emailBtn) emailBtn.addEventListener('click', function () {
    var id = root.getAttribute('data-job');
    if (!id) return;
    emailBtn.disabled = true;
    var label = emailBtn.textContent;
    emailBtn.textContent = 'Sending…';
    fetch('/api/pro/email', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, cache: 'no-store', credentials: 'omit', body: JSON.stringify({ id: id }) })
      .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, status: res.status, body: b }; }, function () { return { ok: false, status: res.status, body: {} }; }); })
      .then(function (r) {
        emailBtn.textContent = label; emailBtn.disabled = false;
        if (r.ok) { say((r.body.message || 'Sent to the address you gave us.') + (typeof r.body.remaining === 'number' && r.body.remaining === 0 ? ' That was the last send for this report.' : '')); if (r.body.remaining === 0) emailBtn.disabled = true; return; }
        if (r.status === 503) { emailBtn.hidden = true; say('Email is not available right now.'); return; }
        if (r.status === 429 && r.body.error === 'email_limit') { emailBtn.disabled = true; say(r.body.message || 'This report has already been emailed three times.'); return; }
        say(r.body.message || 'The email could not be sent. Try again in a few minutes.');
      }, function () { emailBtn.textContent = label; emailBtn.disabled = false; say('We could not reach the server. Check your connection and try again.'); });
  });

  /* ---------- the citation questions: copy them, and (with live testing) filter the table ---------- */
  var citRows = $$('.pr-citerow');
  var citControls = $('[data-cit-controls]');
  if (citControls) {
    citControls.hidden = false;
    var citFilter = $('[data-cit-filter]'), citCount = $('[data-cit-count]'), citEmpty = $('[data-cit-empty]');
    if (citFilter && citRows.length) {
      var citApply = function () {
        var v = citFilter.value, shown = 0;
        citRows.forEach(function (r) { var show = !v || r.getAttribute('data-cited') === v; r.hidden = !show; if (show) shown++; });
        if (citCount) citCount.textContent = 'Showing ' + shown + ' of ' + citRows.length + ' questions';
        if (citEmpty) citEmpty.hidden = shown !== 0;
      };
      citFilter.addEventListener('change', citApply); citApply();
    }
    var citCopy = $('[data-cit-copy]');
    if (citCopy) citCopy.addEventListener('click', function () {
      var text = $$('[data-cit-q]').map(function (q) { return q.textContent; }).join('\n');
      copyText(text).then(function () { say('The questions are copied, one per line.'); }, function () { say('The questions could not be copied. Open "Show all questions as plain text" and select them.'); });
    });
  }

  /* ---------- snippet copy buttons ---------- */
  $$('.pr-snippet').forEach(function (d) {
    var b = $('[data-copy]', d), code = $('pre', d);
    if (!b || !code) return;
    b.hidden = false;
    b.addEventListener('click', function () { copyText(code.textContent).then(function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 2000); }, function () { b.textContent = 'Select and copy'; }); });
  });

  /* ---------- the page table ---------- */
  var table = $('[data-pr-table]');
  if (table) {
    var body = $('tbody', table);
    var rows = $$('.pr-row', table);
    var controls = $('[data-pr-controls]');
    var q = $('[data-pr-q]'), statusSel = $('[data-pr-status]'), checkSel = $('[data-pr-check]');
    var count = $('[data-pr-count]'), empty = $('[data-pr-empty]');
    var sortKey = 'path', sortDir = 1;
    if (controls) controls.hidden = false;

    // Sortable headings become buttons.
    $$('th[data-sort]', table).forEach(function (th) {
      var key = th.getAttribute('data-sort');
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'pr-sortbtn'; btn.textContent = th.textContent;
      th.textContent = ''; th.appendChild(btn);
      if (!th.hasAttribute('aria-sort')) th.setAttribute('aria-sort', 'none');
      btn.addEventListener('click', function () {
        sortDir = sortKey === key ? -sortDir : 1; sortKey = key;
        $$('th[data-sort]', table).forEach(function (o) { o.setAttribute('aria-sort', o === th ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'); });
        apply();
        say('Sorted by ' + btn.textContent.toLowerCase() + ', ' + (sortDir === 1 ? 'ascending' : 'descending') + '.');
      });
    });

    var value = function (r, key) {
      if (key === 'path') return r.getAttribute('data-path');
      var v = r.getAttribute('data-' + key);
      return v === '' || v === null ? null : parseFloat(v);
    };
    function matches(r) {
      var term = (q && q.value || '').trim().toLowerCase();
      if (term && r.getAttribute('data-path').toLowerCase().indexOf(term) === -1) return false;
      var kind = r.getAttribute('data-kind');
      var st = statusSel && statusSel.value;
      if (st === 'ok' && kind !== 'ok') return false;
      if (st === 'fail' && !(kind === 'ok' && parseInt(r.getAttribute('data-failed'), 10) > 0)) return false;
      if (st === 'blocked' && kind !== 'blocked') return false;
      if (st === 'unread' && (kind === 'ok' || kind === 'blocked')) return false;
      var chk = checkSel && checkSel.value;
      if (chk && (r.getAttribute('data-checks') || '').split('|').indexOf(chk) === -1) return false;
      return true;
    }
    function apply() {
      var sorted = rows.slice().sort(function (a, b) {
        var x = value(a, sortKey), y = value(b, sortKey);
        // A page without a score (blocked, not read) goes after the scored ones whichever way the column runs.
        if (x === null && y === null) return a.getAttribute('data-path') < b.getAttribute('data-path') ? -1 : 1;
        if (x === null) return 1;
        if (y === null) return -1;
        if (x === y) return a.getAttribute('data-path') < b.getAttribute('data-path') ? -1 : 1;
        return (x < y ? -1 : 1) * sortDir;
      });
      var shown = 0;
      sorted.forEach(function (r) { var m = matches(r); r.hidden = !m; if (m) shown++; body.appendChild(r); });
      if (count) count.textContent = 'Showing ' + shown + ' of ' + rows.length + ' pages';
      if (empty) empty.hidden = shown !== 0;
    }
    [q, statusSel, checkSel].forEach(function (c) { if (c) c.addEventListener(c === q ? 'input' : 'change', apply); });
    apply();
  }
}());
