/* =====================================================================
   get-api-key.js: the "Get a key" form on /api.

   Posts { email, marketing_optin } to /v1/keys and shows the one answer the server gives. The key itself is never in the response: it is sent by email. Nothing is
   stored in the browser and nothing is sent anywhere else.
   ===================================================================== */
(function () {
  'use strict';

  var form = document.getElementById('akForm');
  if (!form) return;
  var $ = function (id) { return document.getElementById(id); };
  var email = $('akEmail'), error = $('akEmailError'), status = $('akStatus'), submit = $('akSubmit');

  function clear() {
    error.hidden = true; error.textContent = '';
    email.removeAttribute('aria-invalid');
    var wrap = email.closest('.ps-field'); if (wrap) wrap.classList.remove('has-error');
    status.textContent = '';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clear();
    var value = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      error.hidden = false; error.textContent = 'Enter a valid email address.';
      email.setAttribute('aria-invalid', 'true');
      var wrap = email.closest('.ps-field'); if (wrap) wrap.classList.add('has-error');
      email.focus();
      return;
    }
    submit.disabled = true;
    var label = submit.textContent;
    submit.textContent = 'Sending…';
    fetch('/v1/keys', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, cache: 'no-store', credentials: 'omit', body: JSON.stringify({ email: value, marketing_optin: $('akOptin').checked }) })
      .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, status: res.status, body: b }; }, function () { return { ok: false, status: res.status, body: {} }; }); })
      .then(function (r) {
        submit.disabled = false; submit.textContent = label;
        if (r.ok) {
          form.hidden = true;
          var done = document.createElement('p');
          done.className = 'wl-done'; done.setAttribute('role', 'status'); done.tabIndex = -1;
          done.textContent = r.body.message || 'If this address can receive a key, it is on its way.';
          form.parentNode.insertBefore(done, form.nextSibling);
          done.focus();
          return;
        }
        status.textContent = r.status === 429 ? 'Too many requests. Try again in an hour.' : (r.status === 503 ? 'Keys are not open on this server yet.' : 'We could not send a key. Try again in a few minutes.');
        status.focus();
      }, function () {
        submit.disabled = false; submit.textContent = label;
        status.textContent = 'We could not reach the server. Check your connection and try again.';
        status.focus();
      });
  });
}());
