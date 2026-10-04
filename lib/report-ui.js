/* =====================================================================
   lib/report-ui.js — the only behaviour the report needs on top of its
   static markup: sortable tables, and opening every <details> for print.
   Loaded by the dashboard (app/report.html) and /sample-report. Without it
   the report is complete and readable; it just does not sort.
   ===================================================================== */
(function () {
  'use strict';

  function initSortable(root) {
    var tables = (root || document).querySelectorAll('table[data-sortable]');
    Array.prototype.forEach.call(tables, function (table) {
      if (table.getAttribute('data-ready')) return;
      table.setAttribute('data-ready', '1');
      var heads = table.querySelectorAll('thead th[data-sort]');
      Array.prototype.forEach.call(heads, function (th, col) {
        var label = th.textContent;
        th.textContent = '';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        th.appendChild(btn);
        btn.addEventListener('click', function () {
          var dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
          Array.prototype.forEach.call(heads, function (h) { h.removeAttribute('aria-sort'); });
          th.setAttribute('aria-sort', dir);
          var numeric = th.getAttribute('data-sort') === 'num';
          var body = table.tBodies[0];
          var rows = Array.prototype.slice.call(body.rows);
          rows.sort(function (a, b) {
            var x = a.cells[col].getAttribute('data-v'), y = b.cells[col].getAttribute('data-v');
            var r = numeric ? (+x) - (+y) : (x < y ? -1 : x > y ? 1 : 0);
            return dir === 'ascending' ? r : -r;
          });
          rows.forEach(function (r) { body.appendChild(r); });
        });
      });
    });
  }

  // Print shows what is open, so open everything first and put it back after.
  var opened = [];
  window.addEventListener('beforeprint', function () {
    opened = [];
    Array.prototype.forEach.call(document.querySelectorAll('.rp-report details'), function (d) {
      if (!d.open) { d.open = true; opened.push(d); }
    });
  });
  window.addEventListener('afterprint', function () {
    opened.forEach(function (d) { d.open = false; });
    opened = [];
  });

  window.ANSWERABLE_REPORT_UI = { initSortable: initSortable };
  if (document.readyState !== 'loading') initSortable(); else document.addEventListener('DOMContentLoaded', function () { initSortable(); });
}());
