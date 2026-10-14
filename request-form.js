/* =====================================================================
   request-form.js: the homepage ladder's buttons and the Fix / Beyond early-access form.

   - "Run the free scan" moves to the scan field and focuses it.
   - "Request a Fix quote" and "Join Beyond early access" open the dialog (#reqDialog). The scan report's "Some of these gaps we
     can close for you" line opens it with the scanned domain filled in. That line is shown only for a score below 100; the domain and
     the score are read from the report heading scanner.js already writes, so this file touches nothing in the scanner.
   - The form posts { email, website, note, interest, consent, company_fax } to /api/waitlist, the same endpoint, honeypot and limits
     as the Pro waitlist, and shows the one answer the server gives. Nothing is stored in the browser.
   ===================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var dlg = $('reqDialog'), form = $('reqForm');
  var lastDomain = '';

  // ---- the scan button on the first card
  Array.prototype.forEach.call(document.querySelectorAll('[data-ladder-scan]'), function (b) {
    b.addEventListener('click', function () {
      var hero = $('scan'), input = $('scanInput');
      if (hero && hero.scrollIntoView) hero.scrollIntoView({ block: 'start' });
      if (input) input.focus({ preventScroll: true });
    });
  });

  if (!form) return;   // no form on this page. With no dialog the form is inline (/fix, /beyond) and the buttons scroll to it.

  var TEXT = {
    fix: { kicker: 'Early access · Fix', title: 'Request a Fix quote', lede: 'Leave your email and the site. We reply with a quote.' },
    beyond: { kicker: 'Early access · Beyond', title: 'Join Beyond early access', lede: 'Leave your email and the site. We write to you about early access.' }
  };
  var fields = {
    email: { input: $('reqEmail'), error: $('reqEmailError') },
    consent: { input: $('reqConsent'), error: $('reqConsentError') }
  };
  var status = $('reqStatus'), submit = $('reqSubmit');

  function interest() { return $('reqBeyond').checked ? 'beyond' : 'fix'; }
  function paint() {
    var t = TEXT[interest()];
    $('reqKicker').textContent = t.kicker; $('reqTitle').textContent = t.title; $('reqLede').textContent = t.lede;
  }
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

  function open(kind, website) {
    var done = (dlg || form.parentNode).querySelector('.wl-done'); if (done) done.parentNode.removeChild(done);
    form.hidden = false;
    clearErrors();
    $(kind === 'beyond' ? 'reqBeyond' : 'reqFix').checked = true;
    if (website) $('reqWebsite').value = website; else if (!$('reqWebsite').value && lastDomain) $('reqWebsite').value = lastDomain;
    paint();
    if (!dlg) { form.scrollIntoView({ block: 'center' }); fields.email.input.focus({ preventScroll: true }); return; }
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
    fields.email.input.focus();
  }
  function close() { if (!dlg) return; if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open'); }

  Array.prototype.forEach.call(document.querySelectorAll('[data-request]'), function (b) {
    b.addEventListener('click', function () { open(b.getAttribute('data-request'), b.closest('#scoreFix') ? lastDomain : ''); });
  });
  if ($('reqClose')) $('reqClose').addEventListener('click', close);
  // A click on the backdrop (the dialog element itself, outside its content box) closes it.
  if (dlg) dlg.addEventListener('click', function (e) {
    if (e.target !== dlg) return;
    var r = dlg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
  });
  Array.prototype.forEach.call(form.querySelectorAll('input[name="interest"]'), function (r) { r.addEventListener('change', paint); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors();
    var email = fields.email.input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail('email', 'Enter a valid email address.');
    if (!fields.consent.input.checked) fail('consent', 'Tick the box so we can answer you.');
    var bad = firstInvalid();
    if (bad) { bad.focus(); return; }

    submit.disabled = true;
    var label = submit.textContent;
    submit.textContent = 'Sending…';
    var body = {
      email: email, interest: interest(), website: $('reqWebsite').value.trim(), note: $('reqNote').value.trim(), consent: true,
      company_fax: (form.elements.company_fax || {}).value || ''
    };
    fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, cache: 'no-store', credentials: 'omit', body: JSON.stringify(body) })
      .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, status: res.status, body: b }; }, function () { return { ok: false, status: res.status, body: {} }; }); })
      .then(function (r) {
        submit.disabled = false; submit.textContent = label;
        if (r.ok) {
          form.hidden = true;
          var done = document.createElement('p');
          done.className = 'wl-done'; done.setAttribute('role', 'status'); done.tabIndex = -1;
          done.textContent = r.body.message || 'Thanks, we have it.';
          var inc = $('reqIncludes'); if (inc && inc.content) done.appendChild(inc.content.cloneNode(true));   // "Includes Citehound PRO", the same badge as on the pages
          form.parentNode.insertBefore(done, form.nextSibling);
          done.focus();
          return;
        }
        if (r.status === 400 && r.body.fields) {
          Object.keys(r.body.fields).forEach(function (k) { fail(k, r.body.fields[k]); });
          var f = firstInvalid(); if (f) f.focus(); else status.textContent = r.body.message || 'Check the form and try again.';
          return;
        }
        status.textContent = r.status === 429 ? 'Too many requests from your network. Try again in an hour.' : 'We could not save that. Try again in a few minutes.';
        status.focus();
      }, function () {
        submit.disabled = false; submit.textContent = label;
        status.textContent = 'We could not reach the server. Check your connection and try again.';
        status.focus();
      });
  });

  // ---- the line under the score (shown below 100 only)
  var box = $('scoreFix'), domainEl = $('scoreDomain');
  function sync() {
    var h = document.querySelector('.scan-report__heading');
    var m = h && /^Score for (.+): (\d+) out of 100$/.exec(h.textContent || '');
    if (!m) { if (box) box.hidden = true; return; }
    lastDomain = m[1];
    if (box) box.hidden = !(parseInt(m[2], 10) < 100);
  }
  if (box && domainEl && window.MutationObserver) {
    new MutationObserver(sync).observe(domainEl, { childList: true, characterData: true, subtree: true });
    sync();
  }
}());
