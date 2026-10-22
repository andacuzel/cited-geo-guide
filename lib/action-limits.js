/* =====================================================================
   lib/action-limits.js

   Rate limiting for the Citehound GitHub Action's endpoint (/api/action-scan), and nothing else. The web scanner (/api/scan) and the MCP server keep their own limits.

   The Action runs on shared CI machines, so many unrelated repositories reach this endpoint from the same few addresses, and a request carries nothing but the domain
   (no repository name, no token). The limits are therefore:
     - per target domain: DOMAIN_PER_HOUR scans of the same domain an hour. This is the cap that keeps one repository from scanning a site more than a few times an hour.
     - per address: IP_PER_HOUR scans an hour from one address, generous because CI addresses are shared.
     - global: GLOBAL_PER_HOUR Action scans an hour across every caller.

   Storage: Vercel KV through api/_kv.js. Keys are a SHA-256 hash of the domain, a keyed-free SHA-256 hash of the address, or the current hour, each with a one-hour TTL. No domain,
   address or repository is stored in the clear. Fails open: if KV is not configured or errors, the scan is allowed (a storage outage must not break a build).
   ===================================================================== */

'use strict';

const crypto = require('crypto');
const { kvPipeline } = require('../api/_kv');

const DOMAIN_PER_HOUR = parseInt(process.env.ACTION_LIMIT_PER_DOMAIN, 10) || 4;
const IP_PER_HOUR = parseInt(process.env.ACTION_LIMIT_PER_IP, 10) || 60;
const GLOBAL_PER_HOUR = parseInt(process.env.ACTION_LIMIT_GLOBAL, 10) || 200;
const WINDOW_SECONDS = 3600;

let kv = kvPipeline;
function _setKv(fn) { kv = fn || kvPipeline; }

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const minutes = (seconds) => Math.max(1, Math.ceil(seconds / 60));

// Resolves to { limited: false } or { limited: true, scope: 'domain'|'ip'|'global', retryAfter: seconds, message }. Never rejects.
async function checkActionLimit(domain, ip, now) {
  try {
    const hour = Math.floor((now || Date.now()) / (WINDOW_SECONDS * 1000));
    const dKey = 'act:d:' + hash(domain), iKey = 'act:i:' + hash(ip || 'unknown'), gKey = 'act:g:' + hour;
    const out = await kv([['INCR', dKey], ['TTL', dKey], ['INCR', iKey], ['TTL', iKey], ['INCR', gKey], ['TTL', gKey]]);
    if (!out || out.length < 6) return { limited: false };
    const num = (i) => (out[i] && typeof out[i].result === 'number' ? out[i].result : null);
    const c = [num(0), num(2), num(4)], ttl = [num(1), num(3), num(5)], keys = [dKey, iKey, gKey];
    const expire = [];
    keys.forEach((k, i) => { if (c[i] === 1 || ttl[i] === -1) expire.push(['EXPIRE', k, WINDOW_SECONDS]); });
    if (expire.length) await kv(expire); // best effort
    const wait = (i) => (ttl[i] !== null && ttl[i] > 0 ? ttl[i] : WINDOW_SECONDS);
    if (c[0] !== null && c[0] > DOMAIN_PER_HOUR) return { limited: true, scope: 'domain', retryAfter: wait(0), message: 'Rate limit reached for ' + domain + ': the Action scans the same domain at most ' + DOMAIN_PER_HOUR + ' times an hour. Try again in about ' + minutes(wait(0)) + ' minutes.' };
    if (c[1] !== null && c[1] > IP_PER_HOUR) return { limited: true, scope: 'ip', retryAfter: wait(1), message: 'Rate limit reached for this address: at most ' + IP_PER_HOUR + ' Action scans an hour. Try again in about ' + minutes(wait(1)) + ' minutes.' };
    if (c[2] !== null && c[2] > GLOBAL_PER_HOUR) return { limited: true, scope: 'global', retryAfter: wait(2), message: 'The Action endpoint has reached its hourly ceiling across all callers. Try again in about ' + minutes(wait(2)) + ' minutes.' };
    return { limited: false };
  } catch (e) {
    return { limited: false };
  }
}

module.exports = { checkActionLimit, DOMAIN_PER_HOUR, IP_PER_HOUR, GLOBAL_PER_HOUR, WINDOW_SECONDS, _setKv };
