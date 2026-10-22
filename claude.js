/* =====================================================================
   claude.js: the copy buttons on /claude.

   Each button (data-copy-from) copies the text of the field or code block it names. They are hidden until this script runs, so a page without JavaScript shows the
   address in a field you can select. The result is announced in the polite live region next to the button ("Copied" or "Select the text and copy it"), and the
   button label returns after three seconds. Nothing is stored or sent.
   ===================================================================== */
(function () {
  'use strict';
  var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-copy-from]'));
  if (!buttons.length) return;

  function textOf(el) { return (el.value !== undefined ? el.value : el.textContent || '').trim(); }

  function fallback(el) {
    try {
      if (el.select) { el.focus(); el.select(); } else { var r = document.createRange(); r.selectNodeContents(el); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
      return document.execCommand('copy');
    } catch (e) { return false; }
  }

  buttons.forEach(function (btn) {
    var target = document.querySelector(btn.getAttribute('data-copy-from'));
    if (!target) return;
    var wrap = btn.closest('[data-copy-wrap]');
    var status = wrap ? wrap.querySelector('.cl-status') : null;
    var label = btn.textContent, timer = null;
    btn.hidden = false;
    btn.addEventListener('click', function () {
      var done = function (ok) {
        btn.textContent = ok ? (btn.getAttribute('data-copied') || 'Copied') : label;
        if (status) status.textContent = ok ? 'Copied to the clipboard.' : 'Could not copy. Select the text and copy it.';
        clearTimeout(timer);
        timer = setTimeout(function () { btn.textContent = label; if (status) status.textContent = ''; }, 3000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(textOf(target)).then(function () { done(true); }, function () { done(fallback(target)); });
      else done(fallback(target));
    });
  });
})();
