/* =====================================================================
   watch.js: the /watch page. A Pro API key is pasted into the page and kept in this script's memory only: not in localStorage, sessionStorage, a cookie or the URL, and
   it is cleared from the field as soon as it is used. It is sent only to this site's /v1 API, as a Bearer token. Everything the API returns is put on the page with
   textContent, never as HTML. Reloading or closing the page forgets the key.
   ===================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var form = $('wKeyForm');
  if (!form) return;
  var key = null;                       // in memory only
  var nextCursor = null;
  var els = { keyInput: $('wKey'), keyError: $('wKeyError'), keyStatus: $('wKeyStatus'), connect: $('wConnect'), panel: $('wPanel'), panelHead: $('wPanelHead'), plan: $('wPlan'), forget: $('wForget'),
    free: $('wFree'), pro: $('wPro'), addForm: $('wAddForm'), domain: $('wDomain'), domainError: $('wDomainError'), email: $('wEmail'), emailError: $('wEmailError'), add: $('wAdd'), addStatus: $('wAddStatus'),
    listBody: $('wListBody'), listEmpty: $('wListEmpty'), listWrap: $('wListWrap'), used: $('wUsed'), histBox: $('wHistBox'), histTitle: $('wHistTitle'), histBody: $('wHistBody'), histClose: $('wHistClose'), histStatus: $('wHistStatus'),
    evBody: $('wEvBody'), evEmpty: $('wEvEmpty'), evWrap: $('wEvWrap'), evMore: $('wEvMore'), evStatus: $('wEvStatus') };

  function say(el, text) { el.textContent = text || ''; }
  function utc(iso) { if (!iso) return 'not yet'; var d = new Date(iso); return isNaN(d) ? '' : d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function cell(row, label, text, header) {
    var c = document.createElement(header ? 'th' : 'td');
    if (header) c.setAttribute('scope', 'row');
    c.setAttribute('data-label', label); c.textContent = text; row.appendChild(c); return c;
  }
  function button(text, label, onClick) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn--ghost'; b.textContent = text; b.setAttribute('aria-label', label); b.addEventListener('click', onClick); return b;
  }

  // One call to the API. Resolves { ok, status, body, retry }.
  function api(method, path, body) {
    var headers = { Accept: 'application/json', Authorization: 'Bearer ' + key };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(path, { method: method, headers: headers, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, status: res.status, body: b, retry: res.headers.get('Retry-After') }; }, function () { return { ok: false, status: res.status, body: {}, retry: null }; }); });
  }
  function problem(r) {
    if (r.status === 401) return 'That key is not valid. Check it and try again.';
    if (r.status === 403) return r.body && r.body.error === 'key_revoked' ? 'That key has been revoked.' : ((r.body && r.body.message) || 'This key cannot do that.');
    if (r.status === 429) return 'A limit was reached. Try again in ' + (r.retry || 'a few') + ' seconds.';
    if (r.status === 503) return 'The API is not available on this server yet.';
    return (r.body && r.body.message) || 'Something went wrong. Try again in a few minutes.';
  }
  var offline = function (el) { return function () { say(el, 'We could not reach the server. Check your connection and try again.'); }; };

  /* ---------- connect ---------- */

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    say(els.keyStatus, ''); els.keyError.hidden = true; els.keyInput.removeAttribute('aria-invalid');
    var v = els.keyInput.value.trim();
    if (!/^chk_[A-Za-z0-9_-]{32}$/.test(v)) { els.keyError.hidden = false; els.keyError.textContent = 'A key starts with chk_ and has 36 characters. Paste it as it came in the email.'; els.keyInput.setAttribute('aria-invalid', 'true'); els.keyInput.focus(); return; }
    key = v; els.keyInput.value = '';
    els.connect.disabled = true; var label = els.connect.textContent; els.connect.textContent = 'Connecting…';
    api('GET', '/v1/me').then(function (r) {
      els.connect.disabled = false; els.connect.textContent = label;
      if (!r.ok) { key = null; say(els.keyStatus, problem(r)); els.keyStatus.focus(); return; }
      show(r.body);
    }, function () { els.connect.disabled = false; els.connect.textContent = label; key = null; offline(els.keyStatus)(); els.keyStatus.focus(); });
  });

  function forget() {
    key = null; nextCursor = null;
    [els.listBody, els.evBody, els.histBody].forEach(clear);
    els.panel.hidden = true; form.hidden = false; els.histBox.hidden = true;
    say(els.keyStatus, 'The key is forgotten. Nothing was saved in this browser.'); els.keyInput.focus();
  }
  els.forget.addEventListener('click', forget);

  function show(me) {
    form.hidden = true; els.panel.hidden = false;
    var L = me.limits || {};
    els.plan.textContent = 'Plan: ' + me.plan + '. This key may make ' + L.requests_per_hour + ' requests an hour.';
    var pro = me.plan === 'pro';
    els.free.hidden = pro; els.pro.hidden = !pro;
    els.panelHead.focus();
    if (pro) { loadList(); loadEvents(false); }
  }

  /* ---------- the watchlist ---------- */

  function loadList() {
    api('GET', '/v1/watchlist').then(function (r) {
      if (!r.ok) { say(els.addStatus, problem(r)); return; }
      var d = r.body.domains || [];
      clear(els.listBody);
      els.used.textContent = d.length + ' of ' + r.body.limit + ' domains watched.';
      els.listEmpty.hidden = d.length > 0; els.listWrap.hidden = d.length === 0;
      d.forEach(function (w) {
        var tr = document.createElement('tr');
        cell(tr, 'Domain', w.domain, true);
        cell(tr, 'Score', w.last_score === null ? 'none yet' : w.last_score + '/100');
        cell(tr, 'Last scan', utc(w.last_scan_at));
        cell(tr, 'Next scan after', utc(w.next_scan_after));
        cell(tr, 'Alerts', w.alerts ? 'on' : 'off');
        var act = cell(tr, 'Actions', '');
        act.appendChild(button('History', 'Show the score history of ' + w.domain, function () { loadHistory(w.domain); }));
        act.appendChild(document.createTextNode(' '));
        act.appendChild(button('Remove', 'Stop watching ' + w.domain, function () { remove(w.domain); }));
        els.listBody.appendChild(tr);
      });
    }, offline(els.addStatus));
  }

  els.addForm.addEventListener('submit', function (e) {
    e.preventDefault();
    say(els.addStatus, ''); [els.domainError, els.emailError].forEach(function (x) { x.hidden = true; });
    var dom = els.domain.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    var em = els.email.value.trim();
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(dom)) { els.domainError.hidden = false; els.domainError.textContent = 'Enter a domain such as example.com.'; els.domain.focus(); return; }
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { els.emailError.hidden = false; els.emailError.textContent = 'Enter a valid email address, or leave it empty.'; els.email.focus(); return; }
    var body = { domain: dom }; if (em) body.alert_email = em;
    els.add.disabled = true; var label = els.add.textContent; els.add.textContent = 'Scanning…';
    say(els.addStatus, 'The first scan runs now. It can take up to 20 seconds.');
    api('POST', '/v1/watchlist', body).then(function (r) {
      els.add.disabled = false; els.add.textContent = label;
      if (!r.ok) { say(els.addStatus, problem(r)); els.addStatus.focus(); return; }
      say(els.addStatus, r.status === 201 ? dom + ' is on the watchlist. The first scan is the baseline: ' + r.body.baseline.score + '/100.' : dom + ' was already watched. Its alert settings were updated.');
      els.domain.value = ''; els.email.value = ''; loadList(); loadEvents(false);
    }, function () { els.add.disabled = false; els.add.textContent = label; offline(els.addStatus)(); });
  });

  function remove(domain) {
    if (!window.confirm('Stop watching ' + domain + '?')) return;
    api('DELETE', '/v1/watchlist?domain=' + encodeURIComponent(domain)).then(function (r) {
      say(els.addStatus, r.ok ? domain + ' was removed.' : problem(r));
      if (r.ok) { els.histBox.hidden = true; loadList(); loadEvents(false); }
    }, offline(els.addStatus));
  }

  /* ---------- history and events ---------- */

  function loadHistory(domain) {
    say(els.histStatus, 'Loading…'); els.histBox.hidden = false; els.histTitle.textContent = 'Score history for ' + domain; clear(els.histBody);
    api('GET', '/v1/history?domain=' + encodeURIComponent(domain) + '&limit=24').then(function (r) {
      if (!r.ok) { say(els.histStatus, problem(r)); return; }
      var s = r.body.snapshots || [];
      say(els.histStatus, s.length ? '' : 'No scans stored yet.');
      s.forEach(function (x) {
        var tr = document.createElement('tr');
        cell(tr, 'Scanned', utc(x.at), true);
        cell(tr, 'Score', x.score + '/100');
        cell(tr, 'Checks failing', String(x.failed.length));
        var blocked = Object.keys(x.crawlers).filter(function (n) { return x.crawlers[n] === 'blocked'; }).length;
        cell(tr, 'Crawlers blocked', blocked + ' of ' + Object.keys(x.crawlers).length);
        cell(tr, 'llms.txt', x.llms_txt ? 'found' : 'not found');
        els.histBody.appendChild(tr);
      });
      els.histTitle.focus();
    }, offline(els.histStatus));
  }
  els.histClose.addEventListener('click', function () { els.histBox.hidden = true; });

  function loadEvents(more) {
    var path = '/v1/events?limit=20' + (more && nextCursor ? '&cursor=' + encodeURIComponent(nextCursor) : '');
    if (!more) { clear(els.evBody); nextCursor = null; }
    api('GET', path).then(function (r) {
      if (!r.ok) { say(els.evStatus, problem(r)); return; }
      say(els.evStatus, '');
      (r.body.events || []).forEach(function (ev) {
        var tr = document.createElement('tr');
        cell(tr, 'When', utc(ev.at), true); cell(tr, 'Domain', ev.domain); cell(tr, 'Event', ev.type.replace(/_/g, ' ')); cell(tr, 'What changed', ev.summary);
        els.evBody.appendChild(tr);
      });
      nextCursor = r.body.next_cursor;
      var n = els.evBody.children.length;
      els.evMore.hidden = !r.body.has_more; els.evEmpty.hidden = n > 0; els.evWrap.hidden = n === 0;
    }, offline(els.evStatus));
  }
  els.evMore.addEventListener('click', function () { loadEvents(true); });
}());
