/* Results dashboard: loads one crawl by id (?id=...) from /api/crawl-result, or the demo fixture (?demo=1),
   and renders it with lib/report-render.js, the same renderer the static /sample-report uses.
   When a finished crawl has no executive summary yet, the final stage "Writing the summary" asks
   /api/crawl-summarize for one before the report appears; if that fails the report shows the summary
   written by rules. */
(function () {
  'use strict';
  var R = window.ANSWERABLE_REPORT;
  var root = document.getElementById('reportRoot');
  var params = new URLSearchParams(location.search);

  function state(msg, isError) {
    root.innerHTML = R.topBar({ print: false }) + '<div class="rp-body"><p class="rp-state' + (isError ? ' rp-state--error' : '') + '"></p></div>';
    root.querySelector('.rp-state').textContent = msg;
  }

  function draw(data, demo) {
    root.innerHTML = R.render(data, { schema: window.ANSWERABLE_SCHEMA, label: demo ? 'Demo data' : null });
    window.ANSWERABLE_REPORT_UI.init(root.querySelector('.rp-report'));
    document.title = 'Crawl report: ' + data.domain;
  }

  function getJson(url) {
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (res) {
      return res.json().then(function (body) { return { ok: res.ok, status: res.status, body: body }; }, function () { return { ok: false, status: res.status, body: {} }; });
    });
  }

  function load(url, demo, id) {
    getJson(url).then(function (r) {
      if (!r.ok) { state(r.body.error || 'The report could not be loaded.', true); return; }
      var d = r.body;
      if (d.status && d.status !== 'done' && !demo) {
        state('This crawl is still running: ' + d.pagesDone + ' of ' + d.pageCount + ' pages read. This page checks again every few seconds.');
        setTimeout(function () { load(url, demo, id); }, 6000);
        return;
      }
      if (!d.executiveSummary && !demo && id) {
        state('Writing the summary…');
        getJson('/api/crawl-summarize?id=' + encodeURIComponent(id)).then(function (s) {
          if (s.ok && s.body.summary) d.executiveSummary = s.body.summary;
          draw(d, demo);
        }, function () { draw(d, demo); });
        return;
      }
      draw(d, demo);
    }).catch(function () { state('The report could not be loaded. Check your connection and try again.', true); });
  }

  if (params.get('demo') === '1') {
    load('../content/pro/demo-fixture.json', true);
  } else {
    var id = params.get('id');
    if (!id) state('This page needs a report link. A link looks like /app/report?id=… and comes from the crawl that made the report.', true);
    else if (!/^[a-f0-9]{32}$/.test(id)) state('That is not a report id. A report id is 32 lowercase hex characters.', true);
    else load('/api/crawl-result?id=' + encodeURIComponent(id), false, id);
  }
}());
