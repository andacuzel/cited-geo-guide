/* =====================================================================
   wl-bar.js: closes the Pro waitlist bar on the homepage and remembers it for the session.

   The bar is plain HTML in index.html and shows on a first visit. If it was closed earlier in this session, the head script of index.html has already
   put .wl-off on <html>, which hides it before anything is painted. This file only adds the close button's behaviour. The choice is kept in
   sessionStorage, inside try/catch (blocked storage means the bar comes back on the next page load). Nothing leaves the browser.
   ===================================================================== */
(function () {
  'use strict';
  var bar = document.getElementById('wlBar');
  var btn = bar && bar.querySelector('.wl-bar__close');
  if (!btn) return;
  btn.addEventListener('click', function () {
    bar.hidden = true;
    try { sessionStorage.setItem('ch-wlbar', '1'); } catch (e) { /* kept for this page only */ }
  });
}());
