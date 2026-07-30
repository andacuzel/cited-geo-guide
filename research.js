/* =====================================================================
   ANSWERABLE. — Research report template behaviour
   Shared by every report in the /research series. Currently handles
   the "copy citation" button in the How to cite this block. Add future
   report-only behaviour here rather than inlining it per report.
   ===================================================================== */

(function () {
  'use strict';

  var copyBtn = document.getElementById('citeCopyBtn');
  var citeLine = document.getElementById('citeLine');
  if (!copyBtn || !citeLine) return;

  copyBtn.addEventListener('click', function () {
    var toast = document.getElementById('toast');
    navigator.clipboard.writeText(citeLine.textContent.trim()).then(function () {
      if (!toast) return;
      toast.textContent = 'Citation copied.';
      toast.classList.add('is-visible');
      setTimeout(function () { toast.classList.remove('is-visible'); }, 2600);
    });
  });
}());
