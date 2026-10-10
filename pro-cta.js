/* =====================================================================
   pro-cta.js: the one switch for the Pro buttons.

   Every Pro button in the markup is a link to the waitlist form on /pro (data-pro-cta), and every place that can
   show a price carries "Early access" (data-pro-price). The page works like that with no script at all. This
   script asks GET /api/waitlist, which reads two server variables:

     PRO_CHECKOUT_URL  set: the Pro buttons go there, their label becomes "Get Citehound Pro", and the waitlist
                       form is hidden. Unset: nothing changes.
     PRO_PRICE_TEXT    set: shown where "Early access" stands. Unset: "Early access" stays.

   No cookies, no storage, no data sent; the request is a plain GET of a public answer.
   ===================================================================== */
(function () {
  'use strict';

  var ctas = Array.prototype.slice.call(document.querySelectorAll('[data-pro-cta]'));
  var prices = Array.prototype.slice.call(document.querySelectorAll('[data-pro-price]'));
  if (!ctas.length && !prices.length) return;

  fetch('/api/waitlist', { headers: { Accept: 'application/json' }, credentials: 'omit' })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (cfg) {
      if (!cfg) return;
      if (cfg.priceText) prices.forEach(function (el) { el.textContent = cfg.priceText; });
      if (cfg.checkoutUrl) {
        ctas.forEach(function (a) { a.href = cfg.checkoutUrl; a.rel = 'noopener'; a.textContent = a.getAttribute('data-label-checkout') || 'Get Citehound Pro'; });
        var wl = document.getElementById('waitlist');
        if (wl) wl.hidden = true;
      }
    })
    .catch(function () { /* the markup already works */ });
}());
