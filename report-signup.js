/* =====================================================================
   report-signup.js: the "Get the full report" form on /research/state-of-ai-readiness.

   Asks /api/readiness whether the report is available (a PDF is stored and the owner has not switched it off), then posts
   { email, sendReport, updates, company_fax } and shows the one answer the server gives. The server's answer is the same whether
   or not the address was already on the list. Nothing is stored in the browser, and nothing is sent anywhere else.
   ===================================================================== */
(function () {
  'use strict';

  var form = document.getElementById('srForm');
  if (!form) return;
  var $ = function (id) { return document.getElementById(id); };
  var status = $('srStatus'), submit = $('srSubmit');
  var fields = {
    email: { input: $('srEmail'), error: $('srEmailError') },
    sendReport: { input: $('srSend'), error: $('srSendError') }
  };

  // Is the report open? If not, say so instead of offering a form that cannot work. On any doubt the form stays (the server decides).
  fetch('/api/readiness', { headers: { Accept: 'application/json' }, credentials: 'omit' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (b) {
      if (b && b.available === false) { form.hidden = true; var n = $('srUnavailable'); if (n) n.hidden = false; }
    }, function () { /* leave the form */ });

  function clearErrors() {
    Object.keys(fields).forEach(function (k) {
      var f = fields[k];
      f.error.hidden = true; f.error.textContent = '';
      f.input.removeAttribute('aria-invalid');
      var wrap = f.input.closest('.ps-field'); if (wrap) wrap.classList.remove('has-error');
    });
    status.textContent = '';
  }
  function fail(key, message) {
    var f = fields[key]; if (!f) return;
    f.error.hidden = false; f.error.textContent = message;
    f.input.setAttribute('aria-invalid', 'true');
    var wrap = f.input.closest('.ps-field'); if (wrap) wrap.classList.add('has-error');
  }
  function firstInvalid() {
    var keys = Object.keys(fields);
    for (var i = 0; i < keys.length; i++) if (fields[keys[i]].input.getAttribute('aria-invalid') === 'true') return fields[keys[i]].input;
    return null;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors();
    var email = fields.email.input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail('email', 'Enter a valid email address.');
    if (!fields.sendReport.input.checked) fail('sendReport', 'Tick the box to get the report.');
    var bad = firstInvalid();
    if (bad) { bad.focus(); return; }

    submit.disabled = true;
    var label = submit.textContent;
    submit.textContent = 'Sending…';
    var body = { email: email, sendReport: true, updates: $('srUpdates').checked, company_fax: (form.elements.company_fax || {}).value || '' };
    fetch('/api/readiness', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, cache: 'no-store', credentials: 'omit', body: JSON.stringify(body) })
      .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, status: res.status, body: b }; }, function () { return { ok: false, status: res.status, body: {} }; }); })
      .then(function (r) {
        submit.disabled = false; submit.textContent = label;
        if (r.ok) {
          form.hidden = true;
          var done = document.createElement('p');
          done.className = 'wl-done'; done.setAttribute('role', 'status'); done.tabIndex = -1;
          done.textContent = r.body.message || 'Thank you. If the address can receive mail, the report is on its way.';
          form.parentNode.insertBefore(done, form.nextSibling);
          done.focus();
          return;
        }
        if (r.status === 400 && r.body.fields) {
          Object.keys(r.body.fields).forEach(function (k) { fail(k, r.body.fields[k]); });
          var f = firstInvalid(); if (f) f.focus();
          return;
        }
        status.textContent = r.status === 429 ? 'Too many requests from your network. Try again in an hour.' : (r.status === 503 ? 'The report is not available right now. Try again later.' : 'We could not save that. Try again in a few minutes.');
        status.focus();
      }, function () {
        submit.disabled = false; submit.textContent = label;
        status.textContent = 'We could not reach the server. Check your connection and try again.';
        status.focus();
      });
  });
}());
