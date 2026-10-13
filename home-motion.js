/* =====================================================================
   home-motion.js: the homepage's scroll motion, all of it skipped under prefers-reduced-motion and without IntersectionObserver.

   - The four ladder cards fade and slide in 80 ms apart, and the gold connectors between them draw in (styles.css, ".ladder-grid.is-armed").
   - The benchmark average (73/100) counts up once when it scrolls into view.
   - The two lines of the AgaOne before/after chart draw in, then their end points and values fade in.
   - The sample Pro report opens larger in a dialog when clicked (a copy of the figure; this one needs no motion, so it always runs).

   Every figure is complete in the HTML; this file only hides it for a moment and reveals it again, and a failure leaves the finished page.
   ===================================================================== */
(function () {
  'use strict';

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canObserve = 'IntersectionObserver' in window;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  function once(el, threshold, fn) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { io.disconnect(); fn(); } });
    }, { threshold: threshold });
    io.observe(el);
  }

  // ---- the sample Pro report, larger
  var stage = $('.preview-stage .pro-shot');
  if (stage && typeof HTMLDialogElement !== 'undefined') {
    var dlg = document.createElement('dialog');
    dlg.className = 'shot-dialog'; dlg.setAttribute('aria-label', 'Sample Pro report');
    var close = document.createElement('button');
    close.type = 'button'; close.className = 'req-close'; close.setAttribute('aria-label', 'Close'); close.innerHTML = '&times;';
    var body = document.createElement('div');
    dlg.appendChild(close); dlg.appendChild(body); document.body.appendChild(dlg);
    stage.setAttribute('role', 'button'); stage.tabIndex = 0; stage.setAttribute('aria-haspopup', 'dialog');
    stage.setAttribute('aria-label', 'Open the sample Pro report larger');
    var open = function () { body.innerHTML = ''; body.appendChild(stage.cloneNode(true)); var c = body.firstChild; c.removeAttribute('role'); c.removeAttribute('tabindex'); c.removeAttribute('aria-label'); c.removeAttribute('aria-haspopup'); dlg.showModal(); };
    stage.addEventListener('click', open);
    stage.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    close.addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('click', function (e) {
      if (e.target !== dlg) return;
      var r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
    });
  }

  if (reduced || !canObserve) return;

  // ---- the ladder
  var grid = $('#ladderGrid');
  if (grid) {
    Array.prototype.forEach.call(grid.children, function (li, i) { li.style.setProperty('--i', i); });
    grid.classList.add('is-armed');
    once(grid, 0.2, function () {
      grid.classList.add('is-in');
      // When the entrance is over, hand the cards back to their plain (hoverable) state.
      setTimeout(function () { grid.classList.remove('is-armed', 'is-in'); }, 1600);
    });
  }

  // ---- the average, counting up
  var avg = $('.benchmark-strip__avg');
  if (avg && avg.firstChild && avg.firstChild.nodeType === 3) {
    var final = parseInt(avg.firstChild.nodeValue, 10);
    if (final > 0) {
      var num = document.createElement('span');
      num.className = 'hm-count'; num.textContent = String(final);
      avg.setAttribute('aria-hidden', 'true');
      avg.replaceChild(num, avg.firstChild);
      num.style.display = 'inline-block'; num.style.minWidth = num.offsetWidth + 'px'; num.style.textAlign = 'right';
      num.textContent = '0';
      once(avg, 0.6, function () {
        var t0 = null, dur = 1200;
        (function step(t) {
          if (t0 === null) t0 = t;
          var p = Math.min(1, (t - t0) / dur), eased = 1 - Math.pow(1 - p, 3);
          num.textContent = String(Math.round(final * eased));
          if (p < 1) requestAnimationFrame(step);
        }(performance.now()));
      });
    }
  }

  // ---- the AgaOne chart
  var chart = $('.case-study-figure__chart');
  if (chart) {
    var lines = Array.prototype.slice.call(chart.querySelectorAll('line[x1="150"][x2="370"]'));
    var late = Array.prototype.slice.call(chart.querySelectorAll('circle[cx="370"], text[x="382"], text[x="260"]'));
    if (lines.length) {
      lines.forEach(function (l) {
        var len = Math.ceil(l.getTotalLength ? l.getTotalLength() : 240);
        l.style.strokeDasharray = len; l.style.strokeDashoffset = len;
      });
      late.forEach(function (n) { n.style.opacity = '0'; });
      once(chart, 0.4, function () {
        lines.forEach(function (l) { l.style.transition = 'stroke-dashoffset 900ms ease'; });
        requestAnimationFrame(function () {
          lines.forEach(function (l) { l.style.strokeDashoffset = '0'; });
        });
        setTimeout(function () {
          late.forEach(function (n) { n.style.transition = 'opacity 400ms ease'; n.style.opacity = '1'; });
        }, 800);
      });
    }
  }
}());
