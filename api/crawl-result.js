/* =====================================================================
   /api/crawl-result — read one finished (or running) crawl.

   Input: a job id, the 32-hex id /api/crawl-start returned.
   Returns: the job's summary and every page's result, which is what the
   report dashboard (app/report.html) renders.

   Usage: GET /api/crawl-result?id=<jobId>

   This endpoint reads one record by its id and nothing else:
     - no listing, no search, no "recent jobs"
     - no write path: POST and everything else but GET and HEAD is a 405
     - nothing is recorded about the requester. The only per-caller state
       is the hashed-IP rate counter every endpoint shares (_rateLimit.js)

   A job id is 128 bits from crypto.randomBytes (api/_crawlStore.js), so an
   id cannot be guessed; holding the link is what grants access. The record
   itself expires 90 days after the last crawl step.

   Storage cannot tell an id that never existed from one that has expired
   (both are simply absent), so the 404 says both.
   ===================================================================== */

const { checkRateLimit } = require('./_rateLimit');
const { getJob, TTL_SECONDS } = require('./_crawlStore');

var ID_RE = /^[a-f0-9]{32}$/;

// The public shape of a job. Exported so tests and the sample generator use
// the same projection as the endpoint.
function jobToResult(job) {
  return {
    id: job.id,
    domain: job.domain,
    status: job.status,
    createdAt: job.created_at,
    pageCount: job.pages.length,
    pagesDone: job.pages_done,
    retentionDays: Math.round(TTL_SECONDS / 86400),
    summary: job.summary || null,
    siteContext: job.siteContext ? {
      robotsOk: !!job.siteContext.robotsOk,
      llmsOk: !!job.siteContext.llmsOk,
      sitemapOk: !!job.siteContext.sitemapOk,
      botResults: job.siteContext.botResults || []
    } : null,
    pages: job.pages.map(function (p) {
      var out = { url: p.url, status: p.status };
      if (p.error) out.error = p.error;
      if (p.result) out.result = p.result;
      if (p.siteInfo) out.siteInfo = p.siteInfo;
      return out;
    })
  };
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.status(405).json({ error: 'This endpoint only reads. Use GET with ?id=<job id>.' });
    return;
  }

  var id = (req.query && req.query.id) || null;
  if (!id) {
    try {
      id = new URL(req.url, 'http://localhost').searchParams.get('id');
    } catch (e) { /* fall through */ }
  }
  if (!id) {
    res.status(400).json({ error: 'Missing job id. Pass ?id=<the id returned by /api/crawl-start>.' });
    return;
  }
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    res.status(400).json({ error: 'That is not a job id. A job id is 32 lowercase hex characters.' });
    return;
  }

  var rl = await checkRateLimit(req);
  if (rl.limited) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    res.status(429).json({
      error: rl.scope === 'hour'
        ? 'You’ve hit the hourly limit. Try again in a little while.'
        : 'You’ve hit the daily limit. Try again tomorrow.',
      limit: rl.scope
    });
    return;
  }

  var loaded = await getJob(id);
  if (!loaded.ok) {
    if (loaded.error === 'storage-unavailable') {
      res.status(503).json({ error: 'Storage is temporarily unavailable. Please try again.' });
    } else if (loaded.error === 'not-found') {
      res.status(404).json({ error: 'No crawl with this id. Either it never existed or it has expired: crawl records are kept for 90 days.' });
    } else {
      res.status(500).json({ error: 'The crawl record could not be read.' });
    }
    return;
  }

  res.status(200).json(jobToResult(loaded.job));
}

module.exports = handler;
module.exports.jobToResult = jobToResult;
