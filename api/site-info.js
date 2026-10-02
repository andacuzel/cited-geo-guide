/* =====================================================================
   /api/site-info — a domain's homepage title, meta description and
   language, used to prefill the schema generator.
   Usage: GET /api/site-info?domain=example.com

   The fetch is lib/scanner.js's fetchSiteInfo (also used by the MCP
   generate_schema tool). Same rate limit and no-store rule as
   /api/scan. Nothing is stored.
   ===================================================================== */

const { checkRateLimit } = require('./_rateLimit');
const scanner = require('../lib/scanner');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

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

  var rawDomain = (req.query && req.query.domain) || null;
  if (!rawDomain) {
    try { rawDomain = new URL(req.url, 'http://localhost').searchParams.get('domain'); } catch (e) { /* validated below */ }
  }

  var domain = scanner.normalizeDomain(rawDomain);
  if (!domain) {
    res.status(400).json({ error: 'Enter a valid domain, e.g. example.com' });
    return;
  }

  try {
    var info = await scanner.fetchSiteInfo(domain);
    if (!info.ok) {
      res.status(502).json({ error: 'Couldn’t read the homepage at ' + domain + ' (' + info.detail + '). You can still fill the form in by hand.' });
      return;
    }
    res.status(200).json({ domain: domain, title: info.siteInfo.title, description: info.siteInfo.metaDesc, lang: info.siteInfo.lang });
  } catch (err) {
    console.error('[site-info] unhandled error for', domain, '—', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Unexpected server error. Please try again.' });
  }
};
