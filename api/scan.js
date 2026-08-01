/* =====================================================================
   /api/scan — server-side AI visibility scan.
   Runs on Vercel's Node runtime. Fetches robots.txt, llms.txt,
   sitemap.xml and the homepage directly (no CORS, no proxies) and
   returns the same score shape the frontend previously computed
   in-browser.

   All fetch/parse/score logic lives in lib/scanner.js, shared with
   the crawl engine (api/crawl-start.js, api/crawl-step.js). This file
   is just the HTTP handler: rate limit, validate, call scanPage,
   shape the response.

   Usage: GET /api/scan?domain=example.com
   ===================================================================== */

const { checkRateLimit } = require('./_rateLimit');
const { scanPage } = require('../lib/scanner');

function normalizeDomain(raw) {
  var d = (raw || '').trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)) return null;
  return d;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  var rl = await checkRateLimit(req);
  if (rl.limited) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    res.status(429).json({
      error: rl.scope === 'hour'
        ? 'You’ve hit the hourly scan limit. Try again in a little while.'
        : 'You’ve hit the daily scan limit. Try again tomorrow.',
      limit: rl.scope
    });
    return;
  }

  var rawDomain = (req.query && req.query.domain) || null;
  if (!rawDomain) {
    try {
      var u = new URL(req.url, 'http://localhost');
      rawDomain = u.searchParams.get('domain');
    } catch (e) { /* fall through to the validation error below */ }
  }

  var domain = normalizeDomain(rawDomain);
  if (!domain) {
    res.status(400).json({ error: 'Enter a valid domain, e.g. example.com' });
    return;
  }

  try {
    var base = 'https://' + domain;
    var scanResult = await scanPage(base + '/');

    if (!scanResult.ok) {
      if (scanResult.stage === 'robots') {
        console.error('[scan]', domain, 'robots.txt failed — kind:', scanResult.kind);
        res.status(502).json({ error: 'Couldn’t reach robots.txt, so the score wouldn’t be reliable. Please try again.' });
        return;
      }
      console.error('[scan]', domain, 'homepage failed — kind:', scanResult.kind);
      res.status(502).json({ error: 'The homepage could not be read. Please try again.' });
      return;
    }

    res.status(200).json({
      domain: domain,
      robotsOk: scanResult.robotsOk,
      botResults: scanResult.botResults,
      result: scanResult.result,
      siteInfo: scanResult.siteInfo
    });
  } catch (err) {
    console.error('[scan] unhandled error for', domain, '—', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Unexpected server error. Please try again.' });
  }
};
