/* =====================================================================
   lib/pro-data.js: a stored Pro job, shaped like the crawl result the report renderer reads.

   The renderer (lib/report-render.js) and the facts (lib/report-facts.js) were written for
   the crawl result of /api/crawl-result; this maps a Pro job onto the same shape, so the
   public sample and a Pro report go through one code path. No contact data is in a job, and
   none is added here.
   ===================================================================== */

'use strict';

function mean(xs) { return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length : 0; }

function jobToReportData(job) {
  const ok = job.pages.filter(function (p) { return p.status === 'ok' && p.result; });
  return {
    id: job.id,
    domain: job.domain,
    status: job.status,
    reason: job.reason || null,
    createdAt: job.finishedAt || job.startedAt,
    pages: job.pages.map(function (p) {
      const out = { url: p.url, status: p.status };
      if (p.error) out.error = p.error;
      if (p.result) out.result = p.result;
      if (p.siteInfo) out.siteInfo = p.siteInfo;
      return out;
    }),
    discovery: job.discovery,
    siteContext: job.siteContext,
    summary: {
      averageDiscoverability: Math.round(mean(ok.map(function (p) { return p.result.discover; }))),
      averageTechnical: Math.round(mean(ok.map(function (p) { return p.result.tech; }))),
      averageTrust: Math.round(mean(ok.map(function (p) { return p.result.trust; })))
    }
  };
}

module.exports = { jobToReportData: jobToReportData };
