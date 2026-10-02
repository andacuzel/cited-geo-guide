/* =====================================================================
   /api/llms-check — fetches a domain's llms.txt and assesses it.
   Usage: GET /api/llms-check?domain=example.com[&brand=Example]

   Fetching is lib/scanner.js's fetchText (with a body-size cap) and the
   assessment is lib/llms.js; this file is only the HTTP handler: rate
   limit, validate, call, shape the response. Same rate limit and
   no-store rule as /api/scan. Nothing is stored.
   ===================================================================== */

const { checkRateLimit } = require('./_rateLimit');
const scanner = require('../lib/scanner');
const llms = require('../lib/llms');

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

  var q = req.query || {};
  var rawDomain = q.domain;
  var rawBrand = q.brand;
  if (rawDomain === undefined) {
    try {
      var u = new URL(req.url, 'http://localhost');
      rawDomain = u.searchParams.get('domain');
      rawBrand = u.searchParams.get('brand');
    } catch (e) { /* fall through to the validation error below */ }
  }

  var domain = scanner.normalizeDomain(rawDomain);
  if (!domain) {
    res.status(400).json({ error: 'Enter a valid domain, e.g. example.com' });
    return;
  }
  var brand = typeof rawBrand === 'string' ? rawBrand.trim().slice(0, 60) : '';

  try {
    var fetched = await scanner.fetchText('https://' + domain + '/llms.txt', 8000, 'llms.txt', undefined, { maxBytes: llms.MAX_BYTES });

    // A network failure says nothing about the file, so it is an error,
    // not a "missing" verdict. HTTP answers (404, 403…) are real answers.
    if (!fetched.ok && !fetched.notFound && !fetched.status) {
      res.status(502).json({ error: 'Couldn’t reach ' + domain + ' (' + (fetched.kind || 'network error') + '). Check the domain and try again.' });
      return;
    }

    res.status(200).json(llms.analyze(fetched, domain, brand));
  } catch (err) {
    console.error('[llms-check] unhandled error for', domain, '—', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Unexpected server error. Please try again.' });
  }
};
