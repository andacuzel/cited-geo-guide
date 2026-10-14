/* =====================================================================
   app/ws-view.js: the workspace page's own behaviour: tabs, Copy buttons and Verify.

   Without this script every section is shown one after the other. With it, one section at a time, chosen by the address hash (#fixes, #files ...), so a
   tab can be linked to. Verify posts { id, key } to /api/pro/wsverify, where id is taken from this page's own address (/w/<id>); the server checks the
   check again and answers whether it passes. Nothing is stored in the browser, nothing is sent anywhere else, and no text from the server is put into the
   page as HTML (only as text).
   ===================================================================== */
(function () {
  'use strict';

  var root = document.querySelector('.ws');
  if (!root) return;
  var panels = Array.prototype.slice.call(root.querySelectorAll('.ws-panel'));
  var tabs = Array.prototype.slice.call(root.querySelectorAll('.ws-tabs a'));
  var names = panels.map(function (p) { return p.id; });

  function show(name) {
    if (names.indexOf(name) === -1) name = names[0];
    panels.forEach(function (p) { p.hidden = p.id !== name; });
    tabs.forEach(function (a) { if (a.getAttribute('data-ws-tab') === name) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
  }
  root.classList.add('ws--js');
  window.addEventListener('hashchange', function () { show(location.hash.replace('#', '')); });
  show(location.hash.replace('#', '') || root.getAttribute('data-default-tab') || '');
  // A link inside a section that points at another tab.
  Array.prototype.forEach.call(root.querySelectorAll('a[data-ws-tab]'), function (a) {
    a.addEventListener('click', function () { show(a.getAttribute('data-ws-tab')); });
  });

  // The client's answer on a piece in review (a Beyond workspace): Approve, or Request changes with a comment.
  var mid = /^\/w\/([0-9a-f]{32})\/?$/.exec(location.pathname);
  Array.prototype.forEach.call(root.querySelectorAll('.ws-review'), function (box) {
    Array.prototype.forEach.call(box.querySelectorAll('.ws-review__btn'), function (b) {
      if (!mid) { box.hidden = true; return; }
      b.addEventListener('click', function () {
        var out = box.querySelector('.ws-review__out'), text = box.querySelector('.ws-review__text'), action = b.getAttribute('data-action');
        var btns = box.querySelectorAll('.ws-review__btn');
        Array.prototype.forEach.call(btns, function (x) { x.disabled = true; });
        out.textContent = '';
        fetch('/api/pro/wscontent', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, cache: 'no-store', credentials: 'omit', body: JSON.stringify({ id: mid[1], cid: box.getAttribute('data-cid'), action: action, comment: text.value }) })
          .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, body: j }; }, function () { return { ok: false, body: {} }; }); })
          .then(function (r) {
            if (r.ok) { out.textContent = r.body.message || 'Done.'; setTimeout(function () { location.reload(); }, 900); return; }
            Array.prototype.forEach.call(btns, function (x) { x.disabled = false; });
            out.textContent = r.body.message || 'That did not work. Try again in a few minutes.';
          }, function () { Array.prototype.forEach.call(btns, function (x) { x.disabled = false; }); out.textContent = 'We could not reach the server.'; });
      });
    });
  });

  function toast(msg) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('toast--show');
    setTimeout(function () { t.classList.remove('toast--show'); }, 2200);
  }

  // Copy
  Array.prototype.forEach.call(root.querySelectorAll('.ws-copy'), function (b) {
    b.addEventListener('click', function () {
      var pre = document.getElementById(b.getAttribute('data-copy'));
      if (!pre) return;
      var text = pre.textContent;
      var done = function () { toast('Copied'); };
      var fallback = function () { var r = document.createRange(); r.selectNodeContents(pre); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); try { document.execCommand('copy'); done(); } catch (e) { toast('Select the text and copy it'); } };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
    });
  });

  // Verify
  var m = /^\/w\/([0-9a-f]{32})\/?$/.exec(location.pathname);
  Array.prototype.forEach.call(root.querySelectorAll('.ws-verify'), function (b) {
    if (!m) { b.hidden = true; return; }
    b.addEventListener('click', function () {
      var out = b.parentNode.querySelector('.ws-verify__out');
      var label = b.textContent;
      b.disabled = true; b.textContent = 'Checking…'; out.textContent = '';
      fetch('/api/pro/wsverify', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, cache: 'no-store', credentials: 'omit', body: JSON.stringify({ id: m[1], key: b.getAttribute('data-key') }) })
        .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, body: j }; }, function () { return { ok: false, body: {} }; }); })
        .then(function (r) {
          b.disabled = false; b.textContent = label;
          if (r.ok && r.body.passed) { out.textContent = r.body.message || 'Verified.'; setTimeout(function () { location.reload(); }, 900); return; }
          out.textContent = r.body.message || 'That did not work. Try again in a few minutes.';
        }, function () { b.disabled = false; b.textContent = label; out.textContent = 'We could not reach the server.'; });
    });
  });
}());
