/* =====================================================================
   lib/api-v1/limits.js: the limits of /v1, in fixed windows (an hour, a day) so a Retry-After is exact and a counter needs no TTL query.

   Counters live in Redis under keys that hold only hashes and the window number, each with an expiry a little longer than its window, so they delete themselves:
     per key        the hourly and daily caps of the plan (lib/plans.js: free 10 and 40, pro 200 and 2000, fix 400 and 4000, beyond 600 and 6000) and, for a free key, 5 scans a day
     per domain     the same domain is scanned at most 4 times an hour across every key (a scan, a compare, a crawler read and a schema all count)
     per address    120 authenticated requests an hour from one address (CI machines share addresses, so this is generous), and 20 failed key checks an hour
     key creation   5 requests an hour and 20 a day per address, and 3 an hour and 5 a day per email address
   ===================================================================== */

'use strict';

const HOUR = 3600, DAY = 86400;
const Plans = require('../plans.js');
const PLAN_LIMITS = {}; Plans.NAMES.forEach((n) => { PLAN_LIMITS[n] = { hour: Plans.PLANS[n].hour, day: Plans.PLANS[n].day, scansDay: Plans.PLANS[n].scansDay }; });
const DOMAIN_PER_HOUR = 4;
const IP_PER_HOUR = 120;
const BAD_KEY_PER_HOUR = 20;
const CREATE = { ipHour: 5, ipDay: 20, emailHour: 3, emailDay: 5 };

const bucket = (now, size) => Math.floor((now || Date.now()) / 1000 / size);
const resetIn = (now, size) => size - (Math.floor((now || Date.now()) / 1000) % size);

// Adds one to a counter and returns its new value. The first increment sets the expiry.
async function hit(A, key, ttl) {
  const n = await A.incr(key);
  if (n === 1) await A.expire(key, ttl);
  return n;
}
async function peek(A, key) { const v = await A.get(key); return v === null ? 0 : parseInt(v, 10) || 0; }

// -> { ok: true, hourLimit, hourRemaining, dayLimit, dayRemaining, reset } or { ok: false, scope, retryAfter, message }
async function checkKey(A, id, plan, now) {
  const L = PLAN_LIMITS[plan] || PLAN_LIMITS.free, hb = bucket(now, HOUR), db = bucket(now, DAY);
  const h = await hit(A, 'api:rl:h:' + id + ':' + hb, HOUR * 2);
  if (h > L.hour) return { ok: false, scope: 'key_hour', retryAfter: resetIn(now, HOUR), limit: L.hour, message: 'This key has used its ' + L.hour + ' requests for this hour. Try again in about ' + Math.ceil(resetIn(now, HOUR) / 60) + ' minutes.' + (plan === 'free' || !PLAN_LIMITS[plan] ? ' Paid plans have higher limits: ' + Plans.PRICING_URL + '.' : '') };
  const d = await hit(A, 'api:rl:d:' + id + ':' + db, DAY * 2);
  if (d > L.day) return { ok: false, scope: 'key_day', retryAfter: resetIn(now, DAY), limit: L.day, message: 'This key has used its ' + L.day + ' requests for today (UTC). Try again tomorrow.' + (plan === 'free' || !PLAN_LIMITS[plan] ? ' Paid plans have higher limits: ' + Plans.PRICING_URL + '.' : '') };
  return { ok: true, hourLimit: L.hour, hourRemaining: L.hour - h, dayLimit: L.day, dayRemaining: L.day - d, reset: resetIn(now, HOUR) };
}

// A free key may fetch 5 sites a day (a scan, a compare, crawlers, a schema); plans with scansDay null have no extra cap. -> { ok: true } or { ok: false, scope, retryAfter, message }
async function checkScans(A, id, plan, n, now) {
  const cap = (PLAN_LIMITS[plan] || PLAN_LIMITS.free).scansDay;
  if (cap === null || cap === undefined) return { ok: true };
  const db = bucket(now, DAY);
  const used = await peek(A, 'api:sc:' + id + ':' + db);
  if (used + n > cap) return { ok: false, scope: 'key_scans_day', retryAfter: resetIn(now, DAY), limit: cap, message: 'A free key may scan ' + cap + ' sites a day, and this key has used ' + used + ' today (UTC). Try again tomorrow, or see the plans with more: ' + Plans.PRICING_URL + '.' };
  for (let i = 0; i < n; i++) await hit(A, 'api:sc:' + id + ':' + db, DAY * 2);
  return { ok: true };
}

async function usage(A, id, now) {
  return { hour: await peek(A, 'api:rl:h:' + id + ':' + bucket(now, HOUR)), day: await peek(A, 'api:rl:d:' + id + ':' + bucket(now, DAY)) };
}

// Every domain a request will fetch counts once. Checked before any fetch.
async function checkDomains(A, p, domains, now) {
  const hb = bucket(now, HOUR);
  for (const d of domains) {
    const n = await hit(A, 'api:dom:' + require('./keys.js').ipHash(p, 'domain|' + d) + ':' + hb, HOUR * 2);
    if (n > DOMAIN_PER_HOUR) return { ok: false, scope: 'domain', retryAfter: resetIn(now, HOUR), limit: DOMAIN_PER_HOUR, message: 'The same domain is scanned at most ' + DOMAIN_PER_HOUR + ' times an hour across all keys, and ' + d + ' has reached that. Try again in about ' + Math.ceil(resetIn(now, HOUR) / 60) + ' minutes.' };
  }
  return { ok: true };
}

async function checkIp(A, p, ip, now) {
  const n = await hit(A, 'api:ip:' + require('./keys.js').ipHash(p, ip) + ':' + bucket(now, HOUR), HOUR * 2);
  return n > IP_PER_HOUR ? { ok: false, scope: 'ip', retryAfter: resetIn(now, HOUR), limit: IP_PER_HOUR, message: 'This address has made ' + IP_PER_HOUR + ' requests this hour. Try again in about ' + Math.ceil(resetIn(now, HOUR) / 60) + ' minutes.' } : { ok: true };
}

// Failed key checks: counted when a key is wrong or missing, tested before the lookup so guessing is slow.
async function badKeyBlocked(A, p, ip, now) { return (await peek(A, 'api:bad:' + require('./keys.js').ipHash(p, ip) + ':' + bucket(now, HOUR))) >= BAD_KEY_PER_HOUR; }
async function badKey(A, p, ip, now) { await hit(A, 'api:bad:' + require('./keys.js').ipHash(p, ip) + ':' + bucket(now, HOUR), HOUR * 2); }

// Key creation: per address and per email address. -> { ok } or { ok: false, scope, retryAfter }
async function checkCreate(A, p, ip, emailHash, now) {
  const K = require('./keys.js'), ih = K.ipHash(p, ip), hb = bucket(now, HOUR), db = bucket(now, DAY);
  if (await hit(A, 'api:ck:ih:' + ih + ':' + hb, HOUR * 2) > CREATE.ipHour) return { ok: false, scope: 'ip', retryAfter: resetIn(now, HOUR), message: 'Too many key requests from this address. Try again in about ' + Math.ceil(resetIn(now, HOUR) / 60) + ' minutes.' };
  if (await hit(A, 'api:ck:id:' + ih + ':' + db, DAY * 2) > CREATE.ipDay) return { ok: false, scope: 'ip', retryAfter: resetIn(now, DAY), message: 'Too many key requests from this address today. Try again tomorrow.' };
  const e1 = await hit(A, 'api:ck:eh:' + emailHash + ':' + hb, HOUR * 2), e2 = await hit(A, 'api:ck:ed:' + emailHash + ':' + db, DAY * 2);
  if (e1 > CREATE.emailHour || e2 > CREATE.emailDay) return { ok: true, silent: true };   // the caller answers the same words and sends nothing: no sign of what an address has done
  return { ok: true };
}

module.exports = { checkScans, PLAN_LIMITS, DOMAIN_PER_HOUR, IP_PER_HOUR, BAD_KEY_PER_HOUR, CREATE, checkKey, usage, checkDomains, checkIp, badKeyBlocked, badKey, checkCreate, bucket, resetIn };
