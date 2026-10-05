/* =====================================================================
   lib/mcp-limits.js

   Rate limiting for the MCP server's live-fetching tools only (scan_site,
   compare_sites, generate_schema). /api/scan keeps its own per-IP limiter,
   untouched.

   Why not per IP: every user of an Anthropic-hosted client reaches this
   server from the same few addresses, so a per-IP limit would throttle
   strangers for each other's calls. The thing worth protecting is the site
   being fetched, and the server's own capacity, so the limits are:
     - per target domain: DOMAIN_PER_HOUR fetches of the same domain an hour
     - global: GLOBAL_PER_HOUR live fetches an hour across every caller

   Storage: Vercel KV through api/_kv.js. Keys are a SHA-256 hash of the
   scanned domain (or the current hour for the global counter) with a one-hour
   TTL. No caller identity is stored. Fails open: if KV is not configured or
   errors, the call is allowed.
   ===================================================================== */

'use strict';

const crypto = require('crypto');
const { kvPipeline } = require('../api/_kv');

// The configurable constants. Environment variables override them.
const DOMAIN_PER_HOUR = parseInt(process.env.MCP_LIMIT_PER_DOMAIN, 10) || 6;
const GLOBAL_PER_HOUR = parseInt(process.env.MCP_LIMIT_GLOBAL, 10) || 300;
const WINDOW_SECONDS = 3600;

let kv = kvPipeline;
function _setKv(fn) { kv = fn || kvPipeline; }

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const minutes = (seconds) => Math.max(1, Math.ceil(seconds / 60));

/* Resolves to { limited: false } or { limited: true, scope: 'domain'|'global', retryAfter: seconds, message }.
   Never rejects. */
async function checkLiveLimit(domain, now) {
  try {
    const dKey = 'mcp:d:' + hash(domain);
    const gKey = 'mcp:g:' + Math.floor((now || Date.now()) / (WINDOW_SECONDS * 1000));
    const out = await kv([['INCR', dKey], ['TTL', dKey], ['INCR', gKey], ['TTL', gKey]]);
    if (!out || out.length < 4) return { limited: false };
    const num = (i) => (out[i] && typeof out[i].result === 'number' ? out[i].result : null);
    const dCount = num(0), dTtl = num(1), gCount = num(2), gTtl = num(3);
    const expire = [];
    if (dCount === 1 || dTtl === -1) expire.push(['EXPIRE', dKey, WINDOW_SECONDS]);
    if (gCount === 1 || gTtl === -1) expire.push(['EXPIRE', gKey, WINDOW_SECONDS]);
    if (expire.length) await kv(expire); // best effort
    const wait = (ttl) => (ttl !== null && ttl > 0 ? ttl : WINDOW_SECONDS);
    if (dCount !== null && dCount > DOMAIN_PER_HOUR) {
      const w = wait(dTtl);
      return { limited: true, scope: 'domain', retryAfter: w, message: 'Rate limit reached for ' + domain + ': this server fetches the same domain at most ' + DOMAIN_PER_HOUR + ' times an hour, so one site is not scanned repeatedly. Try again in about ' + minutes(w) + ' minute' + (minutes(w) === 1 ? '' : 's') + '.' };
    }
    if (gCount !== null && gCount > GLOBAL_PER_HOUR) {
      const w = wait(gTtl);
      return { limited: true, scope: 'global', retryAfter: w, message: 'This server has reached its hourly ceiling of ' + GLOBAL_PER_HOUR + ' live fetches across all callers. Try again in about ' + minutes(w) + ' minute' + (minutes(w) === 1 ? '' : 's') + '.' };
    }
    return { limited: false };
  } catch (e) {
    return { limited: false };
  }
}

module.exports = { checkLiveLimit, DOMAIN_PER_HOUR, GLOBAL_PER_HOUR, WINDOW_SECONDS, _setKv };
