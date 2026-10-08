/* =====================================================================
   Per-IP rate limiting for /api/scan.

   Backed by Vercel KV, called directly over its REST API via fetch —
   no @vercel/kv dependency needed (this project has none, and this
   sandbox has no npm to add one).

   Required environment variables (set when Vercel KV is connected in
   the dashboard):
     KV_REST_API_URL
     KV_REST_API_TOKEN

   Storage: only a SHA-256 hash of the caller's IP, as two counters
   ("rl:h:<hash>" and "rl:d:<hash>") with a TTL. No raw IP is ever
   stored, and no record of which domain was scanned is kept alongside
   the counter.

   Fails open: if KV isn't configured, times out, or errors in any way,
   the request is allowed through. A storage outage must never take
   scanning down.
   ===================================================================== */

const crypto = require('crypto');
const { kvPipeline } = require('./_kv');

var HOURLY_LIMIT = 20;
var HOURLY_TTL = 60 * 60;
var DAILY_LIMIT = 100;
var DAILY_TTL = 60 * 60 * 24;

function hashIp(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

function getClientIp(req) {
  var fwd = req.headers && req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/* Resolves to { limited: false } to allow the request, or
   { limited: true, scope: 'hour'|'day', retryAfter: seconds } to
   block it. Never rejects — any internal failure resolves to
   { limited: false } so a scan is never blocked by our own bug. */
async function checkRateLimit(req, opts) {
  try {
    // opts (optional) lets another endpoint keep its own counters and limits: { prefix, hourly, daily }.
    // Without it, the scan endpoints behave exactly as before.
    var prefix = (opts && opts.prefix) || 'rl';
    var hourlyLimit = (opts && opts.hourly) || HOURLY_LIMIT;
    var dailyLimit = (opts && opts.daily) || DAILY_LIMIT;
    var hash = hashIp(getClientIp(req));
    var hourKey = prefix + ':h:' + hash;
    var dayKey = prefix + ':d:' + hash;

    var incrResult = await kvPipeline([
      ['INCR', hourKey],
      ['INCR', dayKey]
    ]);
    if (!incrResult) return { limited: false };

    var hourCount = incrResult[0] && typeof incrResult[0].result === 'number' ? incrResult[0].result : null;
    var dayCount = incrResult[1] && typeof incrResult[1].result === 'number' ? incrResult[1].result : null;

    // Set the TTL only the moment a counter is created, so it's a
    // fixed window rather than a self-resetting one.
    var ttlCmds = [];
    if (hourCount === 1) ttlCmds.push(['EXPIRE', hourKey, HOURLY_TTL]);
    if (dayCount === 1) ttlCmds.push(['EXPIRE', dayKey, DAILY_TTL]);
    if (ttlCmds.length) await kvPipeline(ttlCmds); // best-effort

    if (hourCount !== null && hourCount > hourlyLimit) {
      return { limited: true, scope: 'hour', retryAfter: HOURLY_TTL };
    }
    if (dayCount !== null && dayCount > dailyLimit) {
      return { limited: true, scope: 'day', retryAfter: DAILY_TTL };
    }
    return { limited: false };
  } catch (e) {
    return { limited: false };
  }
}

module.exports = { checkRateLimit: checkRateLimit };
