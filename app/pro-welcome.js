/* =====================================================================
   app/pro-welcome.js: /pro/welcome, where the payment provider's success URL lands.

   Reads the checkout id from the address (checkout_id or checkout), takes it out of the address bar, and asks POST /api/pro/welcome
   every two seconds whether the payment has been confirmed. When it has, the answer carries the start path once and the page goes
   there. Nothing is stored in the browser. If it takes too long, it says so and points to the email and to support.
   ===================================================================== */
(function () {
  'use strict';

  var status = document.getElementById('pwStatus'), title = document.getElementById('pwTitle'), wait = document.getElementById('pwWait');
  if (!status) return;
  var q = new URLSearchParams(location.search);
  var id = (q.get('checkout_id') || q.get('checkout') || '').trim();
  try { history.replaceState(null, '', '/pro/welcome'); } catch (e) { /* the page still works */ }

  function say(heading, text) { title.textContent = heading; status.textContent = text; if (wait) wait.hidden = true; title.focus({ preventScroll: true }); }
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(id)) { say('We could not find your order', 'This page needs the link the payment page sent you to. If you paid, check your email: we send the report link there too. Otherwise write to hey@getcitehound.com.'); return; }

  var tries = 0, MAX = 45;
  function poll() {
    tries++;
    fetch('/api/pro/welcome', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, cache: 'no-store', credentials: 'omit', body: JSON.stringify({ checkout: id }) })
      .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, body: b }; }, function () { return { ok: false, body: {} }; }); })
      .then(function (r) {
        var b = r.body || {};
        if (r.ok && b.state === 'ready' && /^\/pro\/start\/[a-f0-9]{32}$/.test(b.path || '')) { status.textContent = 'Opening your report link…'; location.replace(b.path); return; }
        if (r.ok && b.state === 'gone') { say('This order is no longer available', 'The order was refunded or cancelled, so its report link no longer works. If that is a surprise, write to hey@getcitehound.com.'); return; }
        if (r.ok && b.state === 'taken') { say('Your link was already shown', 'The report link was opened or sent to you already. Check your email for it, or write to hey@getcitehound.com.'); return; }
        again();
      }, again);
  }
  function again() {
    if (tries >= MAX) { say('This is taking longer than expected', 'Your payment may still be confirming. We email the report link to the address you paid with as soon as it is. If nothing arrives within an hour, write to hey@getcitehound.com.'); return; }
    setTimeout(poll, 2000);
  }
  poll();
}());
