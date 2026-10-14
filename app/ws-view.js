/* =====================================================================
   app/ws-view.js: the behaviour of the workspace dashboards (client views and demos). Presentation only: it changes how the page is shown, never what is stored.

   - sections: one at a time, chosen by the address hash (#fixes, #files ...), so the back button works; without this script every section is shown in turn
   - details drawer: a card or row with data-drawer opens the content of the <template> it names in a right-hand drawer (Escape or the scrim closes it, focus returns)
   - filter chips (.wsf), sortable table headers (th[data-sort]), the Files switcher, Copy (with a "Copied" toast)
   - tooltips: any element with data-tip, on hover and on keyboard focus (plain text only)
   - first view: charts draw in and numbers count up when a section is first shown; skipped under prefers-reduced-motion (the finished state is in the HTML)
   - Verify (Fix) and Approve / Request changes (Beyond): the same requests as before, from this page's own address (/w/<id>); on a demo these controls are disabled
     in the HTML and nothing here binds them
   Text from the server is only ever put into the page as text or cloned from the page's own <template>s. Nothing is stored in the browser.
   ===================================================================== */
(function () {
  'use strict';

  var root = document.querySelector('.ws');
  if (!root) return;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var demo = root.classList.contains('ws--demo');
  var panels = Array.prototype.slice.call(root.querySelectorAll('.ws-panel'));
  var links = Array.prototype.slice.call(root.querySelectorAll('.wsapp__link'));
  var names = panels.map(function (p) { return p.id; });
  var played = {};
  var $ = function (id) { return document.getElementById(id); };
  var all = function (sel, r) { return Array.prototype.slice.call((r || document).querySelectorAll(sel)); };

  /* ---------- toast ---------- */
  function toast(msg) {
    var t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('toast--show');
    setTimeout(function () { t.classList.remove('toast--show'); }, 2000);
  }

  /* ---------- first-view animation ---------- */
  function countUp(el) {
    var final = parseInt(el.getAttribute('data-count'), 10);
    if (isNaN(final) || final <= 0) return;
    var sign = el.getAttribute('data-sign') === '+' ? '+' : el.getAttribute('data-sign') === '-' ? '-' : '';
    var t0 = null, dur = 900;
    (function step(t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = sign + Math.round(final * e);
      if (p < 1) requestAnimationFrame(step); else el.textContent = (sign === '-' ? '-' : sign) + final;
    }(performance.now()));
  }
  function prepare(panel) {
    if (reduced) return;
    all('.wc-ring__bar', panel).forEach(function (c) { c.style.strokeDashoffset = c.getAttribute('data-full'); });
    all('[data-chart]', panel).forEach(function (c) { c.classList.add('is-armed'); });
    all('[data-count]', panel).forEach(function (n) { n.textContent = (n.getAttribute('data-sign') || '') + '0'; });
  }
  function play(panel) {
    if (played[panel.id]) return; played[panel.id] = true;
    if (reduced) return;
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      all('.wc-ring__bar', panel).forEach(function (c) { c.style.strokeDashoffset = c.getAttribute('data-off'); });
      all('[data-chart]', panel).forEach(function (c) { c.classList.remove('is-armed'); });
      all('[data-count]', panel).forEach(countUp);
    }); });
  }

  /* ---------- sections ---------- */
  function show(name) {
    if (names.indexOf(name) === -1) name = root.getAttribute('data-default-tab') || names[0];
    panels.forEach(function (p) { p.hidden = p.id !== name; });
    links.forEach(function (a) { if (a.getAttribute('data-ws-tab') === name) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    var panel = $(name); if (panel) play(panel);
  }
  root.classList.add('ws--js');
  panels.forEach(prepare);
  window.addEventListener('hashchange', function () { closeDrawer(true); show(location.hash.replace('#', '')); window.scrollTo(0, 0); });
  show(location.hash.replace('#', ''));
  if (location.hash) window.scrollTo(0, 0);
  // Links inside a section that point at another one: let the hash change do the work.

  /* ---------- tooltips ---------- */
  var tip = $('wsTip');
  function showTip(el) {
    var t = el.getAttribute('data-tip'); if (!t || !tip) return;
    tip.textContent = t; tip.hidden = false;
    var r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    var x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    var y = r.top - h - 10; if (y < 8) y = r.bottom + 10;
    tip.style.left = Math.round(x + window.scrollX) + 'px'; tip.style.top = Math.round(y + window.scrollY) + 'px';
  }
  function hideTip() { if (tip) tip.hidden = true; }
  function tipTarget(e) { return e.target && e.target.closest ? e.target.closest('[data-tip]') : null; }
  document.addEventListener('mouseover', function (e) { var el = tipTarget(e); if (el) showTip(el); });
  document.addEventListener('mouseout', function (e) { if (tipTarget(e)) hideTip(); });
  document.addEventListener('focusin', function (e) { var el = tipTarget(e); if (el) showTip(el); });
  document.addEventListener('focusout', function (e) { if (tipTarget(e)) hideTip(); });
  window.addEventListener('scroll', hideTip, { passive: true });

  /* ---------- the details drawer ---------- */
  var drawer = $('wsDrawer'), scrim = $('wsScrim'), body = $('wsdBody'), title = $('wsdTitle'), opener = null;
  function openDrawer(id, from) {
    var tpl = $(id); if (!tpl || !tpl.content || !drawer) return;
    opener = from || document.activeElement;
    title.textContent = tpl.getAttribute('data-title') || '';
    body.textContent = ''; body.appendChild(tpl.content.cloneNode(true));
    drawer.hidden = false; scrim.hidden = false; drawer.setAttribute('aria-hidden', 'false'); document.body.classList.add('wsd-open');
    all('.ws-ro', body).forEach(function (n) { n.setAttribute('data-tip', 'Demo is read-only'); });
    var close = drawer.querySelector('.wsd__close'); if (close) close.focus();
  }
  function closeDrawer(quiet) {
    if (!drawer || drawer.hidden) return;
    drawer.hidden = true; scrim.hidden = true; drawer.setAttribute('aria-hidden', 'true'); document.body.classList.remove('wsd-open'); hideTip();
    if (!quiet && opener && opener.focus) opener.focus();
  }
  if (drawer) {
    drawer.querySelector('.wsd__close').addEventListener('click', function () { closeDrawer(); });
    scrim.addEventListener('click', function () { closeDrawer(); });
    drawer.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var f = all('a[href], button:not([disabled]), [tabindex="0"]', drawer); if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeDrawer(); hideTip(); } });
  root.addEventListener('click', function (e) {
    var d = e.target.closest ? e.target.closest('[data-drawer]') : null;
    if (d) { openDrawer(d.getAttribute('data-drawer'), d); return; }
    var o = e.target.closest ? e.target.closest('[data-open]') : null;
    if (o) { var id = o.getAttribute('data-open'); setTimeout(function () { openDrawer(id, o); }, 30); }
  });
  if (drawer) drawer.addEventListener('click', function (e) {
    var c = e.target.closest ? e.target.closest('[data-close]') : null; if (c) { closeDrawer(true); return; }
    var d = e.target.closest ? e.target.closest('[data-drawer]') : null;   // a link from one drawer to another (a gap to its piece)
    if (d) openDrawer(d.getAttribute('data-drawer'), opener);
  });
  // A table row that opens the drawer is a button for the keyboard too.
  root.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var tr = e.target.closest ? e.target.closest('tr[data-drawer]') : null;
    if (tr && e.target === tr) { e.preventDefault(); openDrawer(tr.getAttribute('data-drawer'), tr); }
  });

  /* ---------- filter chips and sortable headers ---------- */
  all('.wsf').forEach(function (group) {
    var list = $(group.getAttribute('data-for')), attr = group.getAttribute('data-attr') || 'status', none = $(group.getAttribute('data-none'));
    if (!list) return;
    group.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.wsf__chip') : null; if (!b) return;
      var f = b.getAttribute('data-filter'), shown = 0;
      all('.wsf__chip', group).forEach(function (x) { var on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      all('[data-' + attr + ']', list).forEach(function (row) { var ok = f === 'all' || row.getAttribute('data-' + attr) === f; row.hidden = !ok; if (ok) shown++; });
      if (none) none.hidden = shown !== 0;
    });
  });
  all('th[data-sort]').forEach(function (th) {
    th.tabIndex = 0;
    var go = function () {
      var table = th.closest('table'), tbody = table.tBodies[0], idx = Array.prototype.indexOf.call(th.parentNode.children, th);
      var dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
      all('th[data-sort]', table).forEach(function (x) { x.removeAttribute('aria-sort'); });
      th.setAttribute('aria-sort', dir);
      var rows = Array.prototype.slice.call(tbody.rows);
      rows.sort(function (a, b) {
        var av = a.cells[idx].getAttribute('data-v') || a.cells[idx].textContent, bv = b.cells[idx].getAttribute('data-v') || b.cells[idx].textContent;
        var an = parseFloat(av), bn = parseFloat(bv), c = (!isNaN(an) && !isNaN(bn)) ? an - bn : String(av).localeCompare(String(bv));
        return dir === 'ascending' ? c : -c;
      });
      rows.forEach(function (r) { tbody.appendChild(r); });
    };
    th.addEventListener('click', go);
    th.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });

  /* ---------- the Files switcher and Copy ---------- */
  all('.wsfile').forEach(function (box) {
    var tabs = all('.wsfile__tab', box), panes = all('.wsfile__pane', box);
    var go = function (i, focus) {
      tabs.forEach(function (b, k) { b.classList.toggle('is-on', k === i); b.setAttribute('aria-selected', k === i ? 'true' : 'false'); b.tabIndex = k === i ? 0 : -1; });
      panes.forEach(function (p, k) { if (k === i) p.removeAttribute('data-off'); else p.setAttribute('data-off', '1'); });
      if (focus) tabs[i].focus();
    };
    tabs.forEach(function (b, k) { b.addEventListener('click', function () { go(k); }); });
    box.querySelector('.wsfile__tabs').addEventListener('keydown', function (e) {
      var cur = tabs.indexOf(document.activeElement); if (cur === -1) return;
      var to = e.key === 'ArrowRight' ? (cur + 1) % tabs.length : e.key === 'ArrowLeft' ? (cur - 1 + tabs.length) % tabs.length : null;
      if (to === null) return; e.preventDefault(); go(to, true);
    });
  });
  all('.ws-copy').forEach(function (b) {
    b.addEventListener('click', function () {
      var pre = $(b.getAttribute('data-copy')); var code = pre && pre.querySelector('code'); if (!code) return;
      var text = code.textContent;
      var done = function () { toast('Copied'); };
      var fallback = function () { var r = document.createRange(); r.selectNodeContents(code); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); try { document.execCommand('copy'); done(); } catch (e) { toast('Select the text and copy it'); } };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
    });
  });

  /* ---------- Verify and the client's review (live workspaces only) ---------- */
  var m = /^\/w\/([0-9a-f]{32})\/?$/.exec(location.pathname);
  function post(url, data) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, cache: 'no-store', credentials: 'omit', body: JSON.stringify(data) })
      .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, body: j }; }, function () { return { ok: false, body: {} }; }); });
  }
  if (m && !demo) {
    document.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.ws-verify') : null;
      if (b) {
        var out = b.parentNode.querySelector('.ws-verify__out'), label = b.textContent;
        b.disabled = true; b.textContent = 'Checking…'; out.textContent = '';
        post('/api/pro/wsverify', { id: m[1], key: b.getAttribute('data-key') }).then(function (r) {
          b.disabled = false; b.textContent = label;
          if (r.ok && r.body.passed) { out.textContent = r.body.message || 'Verified.'; setTimeout(function () { location.reload(); }, 900); return; }
          out.textContent = r.body.message || 'That did not work. Try again in a few minutes.';
        }, function () { b.disabled = false; b.textContent = label; out.textContent = 'We could not reach the server.'; });
        return;
      }
      var rb = e.target.closest ? e.target.closest('.ws-review__btn') : null;
      if (rb) {
        var box = rb.closest('.ws-review'), o2 = box.querySelector('.ws-review__out'), text = box.querySelector('.ws-review__text'), btns = all('.ws-review__btn', box);
        btns.forEach(function (x) { x.disabled = true; }); o2.textContent = '';
        post('/api/pro/wscontent', { id: m[1], cid: box.getAttribute('data-cid'), action: rb.getAttribute('data-action'), comment: text.value }).then(function (r) {
          if (r.ok) { o2.textContent = r.body.message || 'Done.'; setTimeout(function () { location.reload(); }, 900); return; }
          btns.forEach(function (x) { x.disabled = false; }); o2.textContent = r.body.message || 'That did not work. Try again in a few minutes.';
        }, function () { btns.forEach(function (x) { x.disabled = false; }); o2.textContent = 'We could not reach the server.'; });
      }
    });
  } else {
    all('.ws-verify, .ws-review__btn', document).forEach(function (b) { b.hidden = true; });
  }
}());
