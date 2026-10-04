/* Results dashboard: loads one crawl by id (?id=...) from /api/crawl-result, or the demo fixture (?demo=1),
   and renders it with lib/report-render.js, the same renderer the static /sample-report uses. */
(function () {
  'use strict';
  var root = document.getElementById('reportRoot');
  var label = document.getElementById('reportLabel');
  var demoBadge = document.getElementById('demoBadge');
  var printBtn = document.getElementById('printBtn');
  var params = new URLSearchParams(location.search);
  var timer = null;

  function state(msg, isError) {
    root.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'rp-state' + (isError ? ' rp-state--error' : '');
    p.textContent = msg;
    root.appendChild(p);
  }

  function draw(data, demo) {
    root.innerHTML = window.ANSWERABLE_REPORT.render(data, { schema: window.ANSWERABLE_SCHEMA });
    window.ANSWERABLE_REPORT_UI.initSortable(root);
    label.textContent = data.domain;
    document.title = 'Crawl report: ' + data.domain;
    if (demo) demoBadge.hidden = false;
    printBtn.hidden = false;
  }

  function load(url, demo) {
    fetch(url, { headers: { Accept: 'application/json' } }).then(function (res) {
      return res.json().then(function (body) { return { ok: res.ok, body: body }; }, function () { return { ok: false, body: {} }; });
    }).then(function (r) {
      if (!r.ok) { state(r.body.error || 'The report could not be loaded.', true); return; }
      var d = r.body;
      if (d.status && d.status !== 'done' && !demo) {
        state('This crawl is still running: ' + d.pagesDone + ' of ' + d.pageCount + ' pages read. This page checks again every few seconds.');
        timer = setTimeout(function () { load(url, demo); }, 6000);
        return;
      }
      draw(d, demo);
    }).catch(function () { state('The report could not be loaded. Check your connection and try again.', true); });
  }

  printBtn.addEventListener('click', function () { window.print(); });

  if (params.get('demo') === '1') {
    load('../content/pro/demo-fixture.json', true);
  } else {
    var id = params.get('id');
    if (!id) state('This page needs a report link. A link looks like /app/report?id=… and comes from the crawl that made the report.', true);
    else if (!/^[a-f0-9]{32}$/.test(id)) state('That is not a report id. A report id is 32 lowercase hex characters.', true);
    else load('/api/crawl-result?id=' + encodeURIComponent(id), false);
  }
}());
