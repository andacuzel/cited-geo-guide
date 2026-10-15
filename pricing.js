/* =====================================================================
   pricing.js: the Pro billing toggle on the pricing staircase (the homepage section and /pricing).

   Without this script both Pro prices are in the page ($39 a month, and $390 a year beside it). With it, a Monthly / Annual switch appears and one price shows at a
   time. The switch is two buttons (aria-pressed); nothing is stored, nothing is sent, and the only prices are the two in the markup.
   ===================================================================== */
(function () {
  'use strict';
  var root = document.querySelector('[data-pricing]');
  if (!root) return;
  var toggle = root.querySelector('.pr-toggle');
  var views = Array.prototype.slice.call(root.querySelectorAll('[data-period-view]'));
  if (!toggle || views.length < 2) return;
  var buttons = Array.prototype.slice.call(toggle.querySelectorAll('[data-period]'));
  function show(period) {
    views.forEach(function (v) { v.classList.toggle('is-on', v.getAttribute('data-period-view') === period); });
    buttons.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-period') === period ? 'true' : 'false'); });
  }
  buttons.forEach(function (b) { b.addEventListener('click', function () { show(b.getAttribute('data-period')); }); });
  root.classList.add('pr-js');
  toggle.hidden = false;
  show('m');
})();
