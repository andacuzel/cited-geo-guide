/* =====================================================================
   ANSWERABLE. — Header nav: Playbooks dropdown
   Loaded on every page. Opens on hover or keyboard focus, closes on
   mouse leave, Escape or click outside. The three links live in the
   HTML at all times; this only toggles their visibility.
   ===================================================================== */

(function () {
  'use strict';

  var container = document.querySelector('.nav-dropdown');
  if (!container) return;

  var trigger = container.querySelector('.nav-dropdown__trigger');
  var menu = container.querySelector('.nav-dropdown__menu');
  var items = Array.prototype.slice.call(menu.querySelectorAll('.nav-dropdown__item'));

  function open() {
    container.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
  }

  function close() {
    container.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
  }

  container.addEventListener('mouseenter', open);
  container.addEventListener('mouseleave', close);

  container.addEventListener('focusin', function (e) {
    if (e.relatedTarget && container.contains(e.relatedTarget)) return;
    open();
  });

  container.addEventListener('focusout', function (e) {
    if (e.relatedTarget && container.contains(e.relatedTarget)) return;
    close();
  });

  container.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      close();
      trigger.focus();
      return;
    }

    var index = items.indexOf(document.activeElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[index === -1 ? 0 : (index + 1) % items.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (index === -1) return;
      items[(index - 1 + items.length) % items.length].focus();
    }
  });

  document.addEventListener('click', function (e) {
    if (!container.contains(e.target)) close();
  });
})();
