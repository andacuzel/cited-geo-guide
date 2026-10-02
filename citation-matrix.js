/* =====================================================================
   citation-matrix.js — replays the citation matrix fill, once.

   The finished matrix on /citation-tracking is complete in the HTML and
   is never built here. A snippet in <head> adds .cm-anim to <html> only
   when IntersectionObserver exists and prefers-reduced-motion is not
   set; until the matrix first scrolls into view, that class draws every
   dot as an empty ring. This file then fills the dots in, row by row,
   left to right, over about 1.5 seconds, and never again.

   Without JavaScript, without IntersectionObserver, or under
   prefers-reduced-motion, nothing here runs and the finished state is
   what the visitor sees. If anything below throws, .cm-anim is removed
   so the finished state shows rather than a blank matrix.

   Part of the second motion exception on the site (CLAUDE.md), with the
   homepage teaser scene (teaser-scene.js).
   ===================================================================== */

(function () {
  'use strict';

  var root = document.documentElement;

  function showFinished() {
    root.classList.remove('cm-anim');
  }

  try {
    var figures = Array.prototype.slice.call(document.querySelectorAll('.cm'));
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!figures.length || reduced || !('IntersectionObserver' in window)) {
      showFinished();
      return;
    }

    var TOTAL_MS = 1500;     // whole replay, first dot to last
    var DOT_GAP_MS = 30;     // between the five dots of one row
    var TRANSITION_MS = 150; // matches --t in styles.css

    var play = function (fig) {
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
