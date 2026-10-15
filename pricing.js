/* =====================================================================
   pricing.js: the Pro billing toggle on the pricing staircase (the homepage section and /pricing), and the screen tabs on /pricing.

   Without this script both Pro prices are in the page ($39 a month, and $390 a year beside it). With it, a Monthly / Annual switch appears and one price shows at a
   time. The switch is two buttons (aria-pressed); nothing is stored, nothing is sent, and the only prices are the two in the markup.
   ===================================================================== */
(function () {
  'use strict';
  function billing() {
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
  }

  // /pricing: one screen at a time (without this script all four are shown in a column). Arrow keys, Home and End move between the tabs.
  function screens() {
    var box = document.getElementById('seeBox');
    if (!box) return;
    var tabs = Array.prototype.slice.call(box.querySelectorAll('.tour__tab')), panels = Array.prototype.slice.call(box.querySelectorAll('.tour__panel'));
    function go(i, focus) {
      tabs.forEach(function (b, k) { b.classList.toggle('is-active', k === i); b.setAttribute('aria-selected', k === i ? 'true' : 'false'); b.tabIndex = k === i ? 0 : -1; });
      panels.forEach(function (p, k) { p.classList.toggle('is-active', k === i); });
      if (focus) tabs[i].focus();
    }
    box.classList.add('tour--js');
    panels.forEach(function (p) { var v = p.querySelector('.tour__view'); if (v) v.classList.add('is-active'); });
    tabs.forEach(function (b, k) { b.addEventListener('click', function () { go(k); }); });
    box.querySelector('.tour__tabs').addEventListener('keydown', function (e) {
      var cur = tabs.indexOf(document.activeElement);
      if (cur === -1) return;
      var to = e.key === 'ArrowRight' ? (cur + 1) % tabs.length : e.key === 'ArrowLeft' ? (cur - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
      if (to === null) return;
      e.preventDefault(); go(to, true);
    });
    go(0);
  }

  billing();
  screens();
})();
