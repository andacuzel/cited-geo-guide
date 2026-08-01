/* =====================================================================
   /api/crawl-step — batch processing for the full-site crawl engine.

   Input: a job id. Scans the next 5 unscanned URLs from that job,
   sequentially, 1.5 seconds apart, using lib/scanner.js and the site
   context computed once in crawl-start. Writes each page's result
   into the job record, updates pages_done, and — on the batch that
   finishes the last page — computes and stores the site-level
   aggregate summary.

   No queue, no cron: the client (app/crawl.html for now) calls this
   repeatedly until the response says the job is done. Each call scans
   at most 5 pages at 1.5s apart, roughly 15 seconds including fetches
   — comfortably inside the function timeout.

   A page that fails to fetch is recorded as failed and never aborts
   the job; a job with some unreachable pages out of many is still a
   successful job.

   Usage: GET /api/crawl-step?id=<jobId>
   ===================================================================== */

const { getJob, saveJob } = require('./_crawlStore');
const scanner = require('../lib/scanner');

var CRAWLER_UA = scanner.CRAWLER_UA;
var BATCH_SIZE = 5;
var STEP_DELAY_MS = 1500;

var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

function average(arr) {
  if (arr.length === 0) return 0;
  return Math.round(arr.reduce(function (a, b) { return a + b; }, 0) / arr.length);
}

// Computed once, when the last pending page finishes. See CLAUDE.md /
// the task spec for exactly what this must contain — this is the
// analysis a single-page scan structurally cannot produce.
function buildSummary(job) {
  var ok = job.pages.filter(function (p) { return p.status === 'ok'; });
  var failed = job.pages.filter(function (p) { return p.status === 'failed'; });

  if (ok.length === 0) {
    return {
      pagesScanned: 0,
      pagesFailed: failed.length,
      failedUrls: failed.map(function (p) { return { url: p.url, error: p.error }; })
    };
  }

  var totals = ok.map(function (p) { return p.result.total; });
  var discovers = ok.map(function (p) { return p.result.discover; });
  var techs = ok.map(function (p) { return p.result.tech; });
  var trusts = ok.map(function (p) { return p.result.trust; });

  var checkAggregates = {};
  ok.forEach(function (p) {
    p.result.checks.forEach(function (c) {
      if (!checkAggregates[c.label]) checkAggregates[c.label] = { passed: 0, failed: 0 };
      if (c.ok) checkAggregates[c.label].passed++;
      else checkAggregates[c.label].failed++;
    });
  });

  var pagesWorstFirst = ok.slice()
    .sort(function (a, b) { return a.result.total - b.result.total; })
    .map(function (p) { return { url: p.url, total: p.result.total }; });

  // Checks that pass on the homepage but fail on most other pages —
  // the finding a single-page scan can't produce, since it never has
  // "most other pages" to compare against.
  var homepageUrl = job.pages[0] && job.pages[0].url;
  var homepage = ok.find(function (p) { return p.url === homepageUrl; });
  var homepagePassesButMostFail = [];
  var siteVsHomepageDelta = null;

  if (homepage) {
    var others = ok.filter(function (p) { return p.url !== homepage.url; });
    if (others.length > 0) {
      homepage.result.checks.forEach(function (hc) {
        if (!hc.ok) return;
        var failCount = 0;
        others.forEach(function (p) {
          var match = p.result.checks.find(function (c) { return c.label === hc.label; });
          if (match && !match.ok) failCount++;
        });
        var failRate = failCount / others.length;
        if (failRate > 0.5) {
          homepagePassesButMostFail.push({
            label: hc.label,
            failedOnPct: Math.round(failRate * 100),
            failedOn: failCount,
            of: others.length
          });
        }
      });
    }
    siteVsHomepageDelta = average(totals) - homepage.result.total;
  }

  return {
    pagesScanned: ok.length,
    pagesFailed: failed.length,
    failedUrls: failed.map(function (p) { return { url: p.url, error: p.error }; }),
    average: average(totals),
    averageDiscoverability: average(discovers),
    averageTechnical: average(techs),
    averageTrust: average(trusts),
    checkAggregates: checkAggregates,
    pagesWorstFirst: pagesWorstFirst,
    homepageOnlyScore: homepage ? homepage.result.total : null,
    siteVsHomepageDelta: siteVsHomepageDelta,
    homepagePassesButMostFail: homepagePassesButMostFail
  };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  var jobId = (req.query && req.query.id) || null;
  if (!jobId) {
    try {
      var u = new URL(req.url, 'http://localhost');
      jobId = u.searchParams.get('id');
    } catch (e) { /* fall through */ }
  }
  if (!jobId || !/^[a-f0-9]{32}$/i.test(jobId)) {
    res.status(400).json({ error: 'Missing or invalid job id.' });
    return;
  }

  var loaded = await getJob(jobId);
  if (!loaded.ok) {
    if (loaded.error === 'storage-unavailable') {
      res.status(503).json({ error: 'Storage is temporarily unavailable. Please try again.' });
    } else if (loaded.error === 'not-found') {
      res.status(404).json({ error: 'Job not found or expired.' });
    } else {
      res.status(500).json({ error: 'Job record could not be read.' });
    }
    return;
  }

  var job = loaded.job;

  if (job.status === 'done') {
    res.status(200).json({
      jobId: jobId,
      domain: job.domain,
      status: 'done',
      pagesDone: job.pages_done,
      pageCount: job.pages.length,
      summary: job.summary
    });
    return;
  }

  try {
    var pending = job.pages.filter(function (p) { return p.status === 'pending'; });
    var batch = pending.slice(0, BATCH_SIZE);

    for (var i = 0; i < batch.length; i++) {
      var page = batch[i];
      var scanResult = await scanner.scanPage(page.url, {
        userAgent: CRAWLER_UA,
        siteContext: job.siteContext
      });

      if (scanResult.ok) {
        page.status = 'ok';
        page.result = scanResult.result;
        page.siteInfo = scanResult.siteInfo;
      } else {
        page.status = 'failed';
        page.error = scanResult.error || scanResult.kind || 'unreachable';
      }
      job.pages_done++;

      if (i < batch.length - 1) await sleep(STEP_DELAY_MS);
    }

    var stillPending = job.pages.some(function (p) { return p.status === 'pending'; });
    if (!stillPending) {
      job.status = 'done';
      job.summary = buildSummary(job);
    } else {
      job.status = 'running';
    }

    var saved = await saveJob(job);
    if (!saved) {
      res.status(503).json({ error: 'Storage is temporarily unavailable. Please try again.' });
      return;
    }

    res.status(200).json({
      jobId: jobId,
      domain: job.domain,
      status: job.status,
      pagesDone: job.pages_done,
      pageCount: job.pages.length,
      justScanned: batch.map(function (p) { return { url: p.url, status: p.status, total: p.result ? p.result.total : null }; }),
      summary: job.status === 'done' ? job.summary : null
    });
  } catch (err) {
    console.error('[crawl-step] unhandled error for job', jobId, '—', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Unexpected server error. Please try again.' });
  }
};
