/* =====================================================================
   teaser-scene.js — plays the homepage teaser scene only while visible.

   The scene (#citeScene in the gold citation block) is complete in the
   HTML: eight question cards, each already resolved to its first answer.
   All motion is CSS (styles.css, "Teaser scene"): one @keyframes drives a
   registered custom property --t from 0 to 14, and every card, chip and
   the refresh icon derives its opacity or rotation from it.

   This file adds one class, .is-live, while the scene is on screen and
   removes it when it is not, which runs and pauses that animation.
   A snippet in <head> adds .scene-anim to <html> only when
   IntersectionObserver and @property exist and prefers-reduced-motion is
   not set. Without that class, without JavaScript, or under reduced
   motion, nothing animates and the static composition is what shows.

   Part of the second motion exception on the site (CLAUDE.md), with the
   /citation-tracking matrix fill (citation-matrix.js).
   ===================================================================== */

(function () {
  'use strict';

  var root = document.documentElement;
  var scene = document.getElementById('citeScene');

  try {
    if (!scene || !root.classList.contains('scene-anim')) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        scene.classList.toggle('is-live', entry.isIntersecting);
      });
    }, { threshold: 0.15 });
    io.observe(scene);
  } catch (e) {
    root.classList.remove('scene-anim');
  }
})();
