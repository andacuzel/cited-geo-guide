/* =====================================================================
   Citehound Pro: /pro/start/<token>

   The page asks the server what the link means (POST /api/pro/order), shows the
   form for a link that is ready, sends a link that has already been used on to
   that link's own report, and shows one generic message for anything else. The
   form posts to /api/pro/start; its answer hands over to the progress screen
   (app/pro-progress.js). Nothing here is stored in the browser.
   ===================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  // The token is read from the path and nowhere else: no page of ours takes a token in a query string.
  var token = ((location.pathname.match(/\/pro\/start\/([a-f0-9]{32})\/?$/i) || [])[1] || '').toLowerCase();

  var sections = { loading: $('psLoading'), unavailable: $('psUnavailable'), form: $('psFormWrap'), progress: $('psProgress') };
  function show(name) {
    Object.keys(sections).forEach(function (k) { sections[k].hidden = k !== name; });
  }
  function focusTitle(sec) { var h = sec.querySelector('h1'); if (h) h.focus({ preventScroll: true }); }

  function postJson(url, body) {
    return fetch(url, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', credentials: 'omit' }).then(function (res) {
      return res.json().then(function (body) { return { ok: res.ok, status: res.status, body: body }; }, function () { return { ok: false, status: res.status, body: {} }; });
    });
  }

  /* ---------- what the link means ---------- */
  function check() {
    show('loading');
    if (!token) { unavailable(); return; }
    postJson('/api/pro/order', { token: token }).then(function (r) {
      if (r.ok && r.body.state === 'ready') {
        // A bought link knows who paid: fill the form in. Both fields stay editable and the consent box stays unticked.
        var pf = r.body.prefill;
        if (pf) { if (pf.name && !$('psName').value) $('psName').value = pf.name; if (pf.email && !$('psEmail').value) $('psEmail').value = pf.email; }
        show('form'); focusTitle(sections.form); return;
      }
      if (r.ok && r.body.state === 'started' && r.body.reportPath) { location.replace(r.body.reportPath); return; }
      if (r.status === 429) { unavailable('Too many requests from your network. Wait a few minutes and try again.', true); return; }
      unavailable();
    }, function () { unavailable('We could not check your link. Check your connection and try again.', true); });
  }

  function unavailable(message, retry) {
    show('unavailable');
    if (message) $('psUnavailableTitle').textContent = 'Something went wrong';
    if (message) $('psUnavailableText').textContent = message;
    $('psUnavailableActions').hidden = !retry;
    focusTitle(sections.unavailable);
  }
  $('psRetryCheck').addEventListener('click', check);

  /* ---------- the form ---------- */
  var form = $('psForm');
  var fields = [
    { key: 'site', input: $('psSite'), error: $('psSiteError') },
    { key: 'name', input: $('psName'), error: $('psNameError') },
    { key: 'email', input: $('psEmail'), error: $('psEmailError') },
    { key: 'consent', input: $('psConsent'), error: $('psConsentError') }
  ];
  var EMAIL = /^[^\s@<>"',;:()\[\]\\]{1,64}@[^\s@<>"',;:()\[\]\\]+\.[A-Za-z]{2,}$/;
  var MESSAGES = {
    site: 'Enter the address of a public website, such as example.com.',
    name: 'Enter your name.',
    email: 'Enter a valid email address.',
    consent: 'Tick the box to continue.'
  };

  function localCheck(key) {
    var v = fields.filter(function (f) { return f.key === key; })[0].input;
    if (key === 'site') return /[A-Za-z0-9-]+\.[A-Za-z0-9-]{2,}/.test(v.value.trim()) && !/\s/.test(v.value.trim()) ? '' : MESSAGES.site;
    if (key === 'name') return v.value.trim().length >= 1 ? '' : MESSAGES.name;
    if (key === 'email') return EMAIL.test(v.value.trim()) && v.value.indexOf('..') === -1 ? '' : MESSAGES.email;
    if (key === 'consent') return v.checked ? '' : MESSAGES.consent;
    return '';
  }
  function setError(f, message) {
    if (message) {
      f.error.textContent = message; f.error.hidden = false;
      f.input.setAttribute('aria-invalid', 'true');
      f.input.closest('.ps-field').classList.add('has-error');
    } else {
      f.error.textContent = ''; f.error.hidden = true;
      f.input.removeAttribute('aria-invalid');
      f.input.closest('.ps-field').classList.remove('has-error');
    }
  }
  fields.forEach(function (f) {
    var ev = f.key === 'consent' ? 'change' : 'blur';
    f.input.addEventListener(ev, function () { setError(f, localCheck(f.key)); });
    f.input.addEventListener('input', function () { if (!f.error.hidden) setError(f, localCheck(f.key)); });
  });

  // The summary above the form. A list of field problems gets a heading and one line each; a single plain message is just that.
  function summary(messages, plain) {
    var box = $('psErrors');
    box.textContent = '';
    if (!messages.length) { box.hidden = true; return; }
    box.hidden = false;
    if (plain) { var one = document.createElement('p'); one.textContent = messages[0]; box.appendChild(one); return; }
    var p = document.createElement('p'); p.textContent = messages.length === 1 ? 'One thing to fix:' : messages.length + ' things to fix:';
    var ul = document.createElement('ul');
    messages.forEach(function (m) { var li = document.createElement('li'); li.textContent = m; ul.appendChild(li); });
    box.appendChild(p); box.appendChild(ul);
  }

  var submitting = false;
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (submitting) return;
    var bad = [];
    fields.forEach(function (f) { var m = localCheck(f.key); setError(f, m); if (m) bad.push(f); });
    summary(bad.map(function (f) { return MESSAGES[f.key]; }));
    if (bad.length) { bad[0].input.focus(); return; }

    submitting = true;
    var btn = $('psSubmit');
    btn.disabled = true; btn.textContent = 'Starting…';
    fetch('/api/pro/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      cache: 'no-store', credentials: 'omit',
      body: JSON.stringify({ token: token, site: $('psSite').value.trim(), name: $('psName').value.trim(), email: $('psEmail').value.trim(), consent: $('psConsent').checked })
    }).then(function (res) {
      return res.json().then(function (body) { return { ok: res.ok, status: res.status, body: body }; }, function () { return { ok: false, status: res.status, body: {} }; });
    }).then(function (r) {
      submitting = false; btn.disabled = false; btn.textContent = 'Start my report';
      if (r.ok && r.body.jobId) { begin(r.body.jobId); return; }
      if (r.status === 400 && r.body.fields) {
        var shown = [];
        fields.forEach(function (f) { if (r.body.fields[f.key]) { setError(f, r.body.fields[f.key]); shown.push(f); } });
        summary(shown.map(function (f) { return r.body.fields[f.key]; }));
        if (shown.length) shown[0].input.focus();
        return;
      }
      if (r.status === 404) { unavailable(); return; }
      summary([r.body.message || 'Something went wrong. Try again in a few minutes.'], true);
    }, function () {
      submitting = false; btn.disabled = false; btn.textContent = 'Start my report';
      summary(['We could not reach the server. Check your connection and try again.'], true);
    });
  });

  function begin(jobId) {
    show('progress');
    window.CITEHOUND_PRO_PROGRESS.mount(sections.progress, { jobId: jobId, retryHref: '/pro/start/' + token });
  }

  check();
}());
