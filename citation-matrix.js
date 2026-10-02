/* =====================================================================
   citation-matrix.js — replays the citation figures, once each.

   Two figures use it, both complete in the HTML and never built here:
     .cm     the dot matrix on /citation-tracking. Dots fill in row by
             row over about 1.5 seconds.
     .tries  the gold homepage block's one question, five tries. The
             five outcomes appear one at a time, 0.4 seconds apart.
   A snippet in <head> adds .cm-anim to <html> only when
   IntersectionObserver exists and prefers-reduced-motion is not set;
   until a figure first scrolls into view, that class draws its dots as
   empty rings (.cm) or holds its outcomes back (.tries). This file then
   plays the figure once and never again.

   Without JavaScript, without IntersectionObserver, or under
   prefers-reduced-motion, nothing here runs and the finished state is
   what the visitor sees. If anything below throws, .cm-anim is removed
   so the finished state shows rather than a blank matrix.

   This is the second and last motion exception on the site (CLAUDE.md).
   It covers both figures above, and nothing else.
   ===================================================================== */

(function () {
  'use strict';

  var root = document.documentElement;

  function showFinished() {
    root.classList.remove('cm-anim');
  }

  try {
    var figures = Array.prototype.slice.call(document.querySelectorAll('.cm, .tries'));
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!figures.length || reduced || !('IntersectionObserver' in window)) {
      showFinished();
      return;
    }

    var TOTAL_MS = 1500;     // whole replay, first dot to last
    var DOT_GAP_MS = 30;     // between the five dots of one row
    var TRANSITION_MS = 150; // matches --t in styles.css

    var TRY_GAP_MS = 400;    // between the five tries on the homepage

    var playTries = function (fig) {
      var chips = fig.querySelectorAll('.tries__chip');
      Array.prototype.forEach.call(chips, function (chip, i) {
        setTimeout(function () { chip.classList.add('is-on'); }, i * TRY_GAP_MS);
      });
      setTimeout(function () { fig.classList.add('is-played'); }, chips.length * TRY_GAP_MS + TRANSITION_MS);
    };

    var play = function (fig) {
      if (fig.classList.contains('tries')) { playTries(fig); return; }
      var rows = Array.prototype.slice.call(fig.querySelectorAll('.cm__row'));
      var n = rows.length;
      var span = TOTAL_MS - TRANSITION_MS - DOT_GAP_MS * 4;
      var step = n > 1 ? span / (n - 1) : 0;
      rows.forEach(function (row, i) {
        var dots = row.querySelectorAll('.cm-dot');
        Array.prototype.forEach.call(dots, function (dot, j) {
          setTimeout(function () { dot.classList.add('is-on'); }, Math.round(i * step + j * DOT_GAP_MS));
        });
      });
      setTimeout(function () { fig.classList.add('is-played'); }, TOTAL_MS + TRANSITION_MS);
    };

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        play(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0 });

    figures.forEach(function (fig) { io.observe(fig); });
  } catch (e) {
    showFinished();
  }
})();
