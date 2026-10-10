/* =====================================================================
   app/pro-feedback.js: the optional feedback form at the end of a Pro report.

   Posts { id, rating (1 to 5), text (up to 1000 characters), company_fax (honeypot) } to /api/pro/feedback.
   The server stores it for 90 days under the report's id, with no contact data. One answer per report: a second
   one gets the same thanks and changes nothing. Nothing is kept in the browser.
   ===================================================================== */
(function () {
  'use strict';

  var form = document.getElementById('fbForm');
  var report = document.querySelector('.pr-report');
  if (!form || !report) return;
  var jobId = report.getAttribute('data-job');
  if (!jobId) return;
  var status = document.getElementById('fbStatus'), submit = document.getElementById('fbSubmit'), text = document.getElementById('fbText'), count = document.getElementById('fbCount');

  function updateCount() { count.textContent = text.value.length + ' of 1000'; }
  text.addEventListener('input', updateCount); updateCount();

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    status.textContent = '';
    var picked = form.querySelector('input[name="rating"]:checked');
    if (!picked) { status.textContent = 'Choose a number from 1 to 5.'; status.className = 'pr-feedback__status is-error'; return; }
    submit.disabled = true;
    var label = submit.textContent; submit.textContent = 'Sending…';
    fetch('/api/pro/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, cache: 'no-store', credentials: 'omit',
      body: JSON.stringify({ id: jobId, rating: parseInt(picked.value, 10), text: text.value, company_fax: (form.elements.company_fax || {}).value || '' }) })
      .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, status: res.status, body: b }; }, function () { return { ok: false, status: res.status, body: {} }; }); })
      .then(function (r) {
        submit.disabled = false; submit.textContent = label;
        if (r.ok) { form.hidden = true; status.textContent = 'Thank you. That helps.'; status.className = 'pr-feedback__status is-done'; status.focus(); return; }
        status.className = 'pr-feedback__status is-error';
        status.textContent = r.status === 429 ? 'Too many requests from your network. Try again later.' : (r.body && r.body.message) || 'We could not save that. Try again in a few minutes.';
      }, function () {
        submit.disabled = false; submit.textContent = label;
        status.className = 'pr-feedback__status is-error';
        status.textContent = 'We could not reach the server. Check your connection and try again.';
      });
  });
}());
