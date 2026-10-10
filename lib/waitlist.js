/* =====================================================================
   lib/waitlist.js: the Citehound Pro waitlist (storage and rules).

   What is stored, per address, for 12 months, in the same Redis as Pro:

     wl:e:<id>     hash  email, name (optional), createdAt, consentVersion
     wl:index      set   of ids, only so scripts/export-waitlist.js can list them
     wl:mail:<id>  string, exists for 30 days after a confirmation mail (the "one mail per address per 30 days" rule)
     wl:cap:<day>  counter of confirmation mails handed to the provider that UTC day (the daily cap)

   <id> is HMAC-SHA256(PRO_HASH_SECRET, "wl-id|" + normalized address), 32 hex characters: the same
   address always lands on the same record (the dedupe), and nobody without the secret can turn an id
   back into an address or test whether an address is on the list.

   Removal links carry <id> plus HMAC-SHA256(PRO_HASH_SECRET, "wl-remove|" + id), 64 hex characters in all.
   They need no database lookup to be checked, they cannot be forged without the secret, and using one deletes
   the record. They do not expire: a person can always take their address off, as long as the secret stays.

   The response to a signup never says whether the address was already there.
   ===================================================================== */

'use strict';

const crypto = require('crypto');
const H = require('./pro-http.js');
const Stats = require('./pro-stats.js');

const CONSENT_VERSION = '2026-10-10';
const KEEP_SECONDS = 365 * 86400;          // 12 months
const MAIL_COOLDOWN_SECONDS = 30 * 86400;  // one confirmation mail per address per 30 days
const DEFAULT_DAILY_CAP = 200;
const INDEX_KEY = 'wl:index';
const TOKEN_RE = /^[0-9a-f]{64}$/;

function normalizeEmail(s) { return String(s || '').normalize('NFKC').trim().toLowerCase(); }
function hmac(label, value) { return crypto.createHmac('sha256', H.secret()).update(label + '|' + value).digest('hex').slice(0, 32); }
function idOf(email) { return hmac('wl-id', normalizeEmail(email)); }
function tokenForId(id) { return id + hmac('wl-remove', id); }
function tokenFor(email) { return tokenForId(idOf(email)); }

// The id a valid removal token names, or null.
function idFromToken(token) {
  const t = String(token || '').trim().toLowerCase();
  if (!TOKEN_RE.test(t)) return null;
  const id = t.slice(0, 32);
  const given = Buffer.from(t.slice(32), 'utf8');
  const want = Buffer.from(hmac('wl-remove', id), 'utf8');
  return given.length === want.length && crypto.timingSafeEqual(given, want) ? id : null;
}

function cleanName(v) { return String(v || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80); }

function dailyCap(env) {
  const raw = (env || process.env).WAITLIST_EMAIL_DAILY_CAP;
  const n = parseInt(raw, 10);
  return raw !== undefined && raw !== '' && n >= 0 ? n : DEFAULT_DAILY_CAP;
}

// Adds the address (or recognises it). Returns { id, isNew }.
async function join(A, input, now) {
  const email = normalizeEmail(input.email);
  const id = idOf(email);
  const key = 'wl:e:' + id;
  const isNew = await A.hsetnx(key, 'email', email);
  if (isNew) {
    const fields = { createdAt: new Date(now === undefined ? Date.now() : now).toISOString(), consentVersion: CONSENT_VERSION };
    const name = cleanName(input.name);
    if (name) fields.name = name;
    await A.hset(key, fields);
    await A.expire(key, KEEP_SECONDS);
  }
  await A.sadd(INDEX_KEY, id);
  await A.expire(INDEX_KEY, KEEP_SECONDS + 30 * 86400);
  return { id: id, isNew: isNew };
}

// Deletes the record a valid token names. Returns true when something was there.
async function remove(A, token) {
  const id = idFromToken(token);
  if (!id) return false;
  const gone = await A.del('wl:e:' + id);
  await A.srem(INDEX_KEY, id);
  return gone > 0;
}

// Every record still alive, oldest first. Ids whose record has expired are dropped from the index on the way.
async function list(A) {
  const ids = await A.smembers(INDEX_KEY);
  const out = [];
  for (const id of ids) {
    const h = await A.hgetall('wl:e:' + id);
    if (!h) { await A.srem(INDEX_KEY, id); continue; }
    out.push({ email: h.email, name: h.name || '', createdAt: h.createdAt, consentVersion: h.consentVersion || '' });
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return out;
}

/* Whether a confirmation mail may be handed to the provider now, and reserving the right if so.
   Returns { ok: true, release() } or { ok: false, reason: 'not_configured' | 'cap' | 'cooldown' }.
   release() gives the reservation back when the provider then refuses the message. */
async function reserveMail(A, id, env, now) {
  const Mail = require('./pro-mail.js');
  if (!Mail.configured(env)) return { ok: false, reason: 'not_configured' };
  const cap = dailyCap(env);
  const capKey = 'wl:cap:' + Stats.dayOf(now);
  const n = await A.incr(capKey);
  await A.expire(capKey, 2 * 86400);
  if (n > cap) { await A.decr(capKey); return { ok: false, reason: 'cap' }; }
  const first = await A.set('wl:mail:' + id, '1', { nx: true, ex: MAIL_COOLDOWN_SECONDS });
  if (!first) { await A.decr(capKey); return { ok: false, reason: 'cooldown' }; }
  return { ok: true, release: async function () { await A.del('wl:mail:' + id); await A.decr(capKey); } };
}

module.exports = {
  CONSENT_VERSION: CONSENT_VERSION, KEEP_SECONDS: KEEP_SECONDS, MAIL_COOLDOWN_SECONDS: MAIL_COOLDOWN_SECONDS, DEFAULT_DAILY_CAP: DEFAULT_DAILY_CAP,
  normalizeEmail: normalizeEmail, idOf: idOf, tokenFor: tokenFor, tokenForId: tokenForId, idFromToken: idFromToken,
  dailyCap: dailyCap, join: join, remove: remove, list: list, reserveMail: reserveMail
};
