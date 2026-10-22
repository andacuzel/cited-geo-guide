/* =====================================================================
   lib/api-v1/keys.js: API keys for /v1, and what is stored about them.

   A key is "chk_" and 32 random characters. It is shown once, in the email that carries it. Only a keyed hash is stored: HMAC-SHA-256 of the key with a server-side pepper
   (the environment variable API_KEY_PEPPER, at least 32 characters; without it the API answers 503). Records, all in Redis:

     api:k:<hash>     hash   id, plan (free|pro), status (active|revoked), createdAt, emailHash (HMAC of the lowercased address), maskedEmail ("a***@example.com")
     api:id:<id>      string the record's hash; the id is the first 20 characters of the hash and is what the revoke link carries (never the key)
     api:em:<ehash>   set    the ids of the keys made for one address (at most 3 active)
     api:mk:<ehash>   hash   the address and the time, ONLY when the person ticked marketing_optin; nothing else uses it

   The address itself is not kept with the key: the record holds a keyed hash (to count requests per address) and a masked form (for GET /v1/me). The raw address lives
   only in the one email, and, if the person opted in, in the separate marketing record.
   ===================================================================== */

'use strict';

const crypto = require('crypto');

const PREFIX = 'chk_';
const PEPPER_MIN = 32;
const MAX_ACTIVE_PER_EMAIL = 3;
const MARKETING_TTL = 365 * 86400;   // the opt-in record: 12 months
const REVOKED_TTL = 90 * 86400;      // a revoked key's record: 90 days, then gone
const PLANS = require('../plans.js').NAMES;

function pepper(env) { const p = String((env || process.env).API_KEY_PEPPER || ''); return p.length >= PEPPER_MIN ? p : ''; }
const mac = (p, label, s) => crypto.createHmac('sha256', p).update(label + '|' + s).digest('hex');
const newKey = () => PREFIX + crypto.randomBytes(24).toString('base64url');
const keyHash = (p, key) => mac(p, 'key', key);
const emailHash = (p, email) => mac(p, 'email', String(email).trim().toLowerCase());
const ipHash = (p, ip) => mac(p, 'ip', ip);
const idOf = (hash) => hash.slice(0, 20);
const revokeToken = (p, id) => id + '.' + mac(p, 'revoke', id).slice(0, 32);
const looksLikeKey = (s) => typeof s === 'string' && /^chk_[A-Za-z0-9_-]{32}$/.test(s);

function maskEmail(email) {
  const e = String(email).trim().toLowerCase(), at = e.lastIndexOf('@');
  return e.slice(0, 1) + '***' + e.slice(at);
}

function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// The key a request carries: Authorization: Bearer <key>, or X-Citehound-Key. '' when there is none.
function keyFromRequest(req) {
  const h = (req && req.headers) || {};
  const auth = String(h.authorization || '');
  const m = /^Bearer\s+(\S+)\s*$/i.exec(auth);
  if (m) return m[1];
  const x = h['x-citehound-key'];
  return typeof x === 'string' ? x.trim() : '';
}

// The record for a key, or null. Constant-time: the stored hash is compared with the computed one even though the lookup already used it.
async function lookup(A, p, key) {
  if (!looksLikeKey(key)) return null;
  const hash = keyHash(p, key);
  const rec = await A.hgetall('api:k:' + hash);
  if (!rec || !rec.hash || !safeEq(rec.hash, hash)) return null;
  return rec;
}

// Makes a key for an address. Returns { key, id, hash } (the key only to put in the email) or { skipped: 'limit' } when the address already has the most active keys.
async function create(A, p, email, o) {
  o = o || {};
  const eh = emailHash(p, email);
  const ids = await A.smembers('api:em:' + eh);
  let active = 0;
  for (const id of ids) { const h = await A.get('api:id:' + id); const r = h ? await A.hgetall('api:k:' + h) : null; if (r && r.status === 'active') active++; }
  if (active >= MAX_ACTIVE_PER_EMAIL) return { skipped: 'limit' };
  const key = newKey(), hash = keyHash(p, key), id = idOf(hash), now = new Date(o.now || Date.now()).toISOString();
  await A.hset('api:k:' + hash, { hash: hash, id: id, plan: 'free', status: 'active', createdAt: now, emailHash: eh, maskedEmail: maskEmail(email) });
  await A.set('api:id:' + id, hash);
  await A.sadd('api:em:' + eh, id);
  if (o.marketing === true) { await A.hset('api:mk:' + eh, { email: String(email).trim(), optInAt: now, source: 'api-key' }); await A.expire('api:mk:' + eh, MARKETING_TTL); }
  return { key: key, id: id, hash: hash };
}

// Removes a key that was made but could not be mailed.
async function discard(A, p, c) {
  await A.del('api:k:' + c.hash); await A.del('api:id:' + c.id);
}

async function revoke(A, p, token) {
  const m = /^([0-9a-f]{20})\.([0-9a-f]{32})$/.exec(String(token || ''));
  if (!m || !safeEq(revokeToken(p, m[1]), m[0])) return { ok: false };
  const hash = await A.get('api:id:' + m[1]);
  if (!hash) return { ok: false };
  const rec = await A.hgetall('api:k:' + hash);
  if (!rec) return { ok: false };
  // A revoked key keeps answering "revoked" for REVOKED_TTL, with nothing that points at a person: the address hash and the masked address are cleared and the record expires.
  await A.hset('api:k:' + hash, { status: 'revoked', revokedAt: new Date().toISOString(), emailHash: '', maskedEmail: '' });
  if (rec.emailHash) await A.srem('api:em:' + rec.emailHash, m[1]);
  await A.expire('api:k:' + hash, REVOKED_TTL); await A.expire('api:id:' + m[1], REVOKED_TTL);
  return { ok: true, already: rec.status === 'revoked' };
}

// Sets the plan of every active key made for an address (the admin endpoint). Returns how many keys changed.
async function setPlan(A, p, email, plan) {
  if (PLANS.indexOf(plan) === -1) return { ok: false, reason: 'plan' };
  const ids = await A.smembers('api:em:' + emailHash(p, email));
  let n = 0;
  for (const id of ids) { const h = await A.get('api:id:' + id); if (h && await A.hgetall('api:k:' + h)) { await A.hset('api:k:' + h, { plan: plan }); n++; } }
  return { ok: true, changed: n };
}

module.exports = { MARKETING_TTL, REVOKED_TTL, PREFIX, PEPPER_MIN, MAX_ACTIVE_PER_EMAIL, PLANS, pepper, newKey, keyHash, emailHash, ipHash, idOf, revokeToken, looksLikeKey, maskEmail, safeEq, keyFromRequest, lookup, create, discard, revoke, setPlan };
