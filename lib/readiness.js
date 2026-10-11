/* =====================================================================
   lib/readiness.js: the "State of AI Readiness" report list (storage and rules).

   A separate list from the Pro waitlist: different keys, a different id label, its own removal link, its own counters. What is stored, in
   the same Redis as Pro:

     sr:e:<id>        hash    email, createdAt, consentVersion, updates ("0" or "1": the separate, optional box), 12 months
     sr:index         set     of ids, only so scripts/pro-admin.js can export the list
     sr:n:<id>:<day>  counter report emails handed out to that address that UTC day (at most 3), 2 days
     sr:cap:<day>     counter report emails handed to the provider that UTC day (the daily cap), 2 days
     sr:off           string  exists while the owner has switched the report off (pro-admin readiness off)
     sr:pdf           string  the report PDF, base64, written by pro-admin readiness-upload. Never in a file, never in the repository.
     sr:pdf:meta      hash    sha256, bytes, name, uploadedAt (the PDF is checked against the hash before it is served)

   <id> is HMAC-SHA256(PRO_HASH_SECRET, "sr-id|" + normalized address), 32 hex characters: the same address lands on the same record, and
   nobody without the secret can turn an id back into an address or test whether an address is on the list. The label is not the waitlist's,
   so the two lists cannot be joined by id.

   Two signed links, neither contains an address:
     download  <id 32 hex><expiry 8 hex, unix seconds><HMAC("sr-dl|id|expiry") 32 hex>   72 characters, valid 30 days, and only while the record exists
               (a removal revokes it)
     removal   <id 32 hex><HMAC("sr-remove|id") 32 hex>                                   64 characters, does not expire

   A signup never says whether the address was already there.
   ===================================================================== */

'use strict';

const crypto = require('crypto');
const H = require('./pro-http.js');
const Stats = require('./pro-stats.js');

const CONSENT_VERSION = '2026-10-11';
const KEEP_SECONDS = 365 * 86400;            // 12 months
const LINK_SECONDS = 30 * 86400;             // a download link works for 30 days
const PER_ADDRESS_PER_DAY = 3;               // report emails per address per UTC day
const DEFAULT_DAILY_CAP = 300;               // report emails per UTC day, all addresses
const INDEX_KEY = 'sr:index';
const PDF_KEY = 'sr:pdf';
const META_KEY = 'sr:pdf:meta';
const OFF_KEY = 'sr:off';
const MAX_PDF_BYTES = 650000;                // base64 of this is about 867 KB, under the 1 MB request limit of Upstash's free plan
const REMOVE_RE = /^[0-9a-f]{64}$/;
const DOWNLOAD_RE = /^[0-9a-f]{72}$/;

function normalizeEmail(s) { return String(s || '').normalize('NFKC').trim().toLowerCase(); }
function hmac(label, value) { return crypto.createHmac('sha256', H.secret()).update(label + '|' + value).digest('hex').slice(0, 32); }
function idOf(email) { return hmac('sr-id', normalizeEmail(email)); }
function removeTokenForId(id) { return id + hmac('sr-remove', id); }
function removeTokenFor(email) { return removeTokenForId(idOf(email)); }

function safeEqual(a, b) {
  const x = Buffer.from(String(a), 'utf8'), y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function idFromRemoveToken(token) {
  const t = String(token || '').trim().toLowerCase();
  if (!REMOVE_RE.test(t)) return null;
  const id = t.slice(0, 32);
  return safeEqual(t.slice(32), hmac('sr-remove', id)) ? id : null;
}

// A download link for the record <id>, valid LINK_SECONDS from now.
function downloadToken(id, now) {
  const exp = Math.floor((now === undefined ? Date.now() : now) / 1000) + LINK_SECONDS;
  const e = ('00000000' + exp.toString(16)).slice(-8);
  return id + e + hmac('sr-dl', id + '|' + e);
}
// { id, expiresAt (ms) } for a valid, unexpired token; { expired: true } for a genuine one that has run out; null for anything else.
function readDownloadToken(token, now) {
  const t = String(token || '').trim().toLowerCase();
  if (!DOWNLOAD_RE.test(t)) return null;
  const id = t.slice(0, 32), e = t.slice(32, 40);
  if (!safeEqual(t.slice(40), hmac('sr-dl', id + '|' + e))) return null;
  const expiresAt = parseInt(e, 16) * 1000;
  if (expiresAt <= (now === undefined ? Date.now() : now)) return { expired: true };
  return { id: id, expiresAt: expiresAt };
}

function dailyCap(env) {
  const raw = (env || process.env).READINESS_EMAIL_DAILY_CAP;
  const n = parseInt(raw, 10);
  return raw !== undefined && raw !== '' && n >= 0 ? n : DEFAULT_DAILY_CAP;
}

/* ---------- the list ---------- */

// Adds the address (or recognises it). input: { email, updates }. Returns { id, isNew }.
async function join(A, input, now) {
  const email = normalizeEmail(input.email);
  const id = idOf(email);
  const key = 'sr:e:' + id;
  const isNew = await A.hsetnx(key, 'email', email);
  if (isNew) {
    await A.hset(key, { createdAt: new Date(now === undefined ? Date.now() : now).toISOString(), consentVersion: CONSENT_VERSION, updates: input.updates === true ? '1' : '0' });
    await A.expire(key, KEEP_SECONDS);
  } else if (input.updates === true) {
    // A person who ticks the optional box on a later visit opts in. Unticking is not a way to opt out: the removal link deletes the record.
    await A.hset(key, { updates: '1' });
  }
  await A.sadd(INDEX_KEY, id);
  await A.expire(INDEX_KEY, KEEP_SECONDS + 30 * 86400);
  return { id: id, isNew: isNew };
}

async function exists(A, id) { return (await A.exists('sr:e:' + id)) > 0; }

// Deletes the record a valid removal token names, and its counters. Returns true when something was there.
async function remove(A, token) {
  const id = idFromRemoveToken(token);
  if (!id) return false;
  return removeId(A, id);
}
async function removeId(A, id) {
  const gone = await A.del('sr:e:' + id);
  await A.srem(INDEX_KEY, id);
  return gone > 0;
}
// For the owner's script: remove by address.
async function removeByEmail(A, email) { return removeId(A, idOf(email)); }

async function list(A) {
  const ids = await A.smembers(INDEX_KEY);
  const out = [];
  for (const id of ids) {
    const h = await A.hgetall('sr:e:' + id);
    if (!h) { await A.srem(INDEX_KEY, id); continue; }
    out.push({ email: h.email, createdAt: h.createdAt, consentVersion: h.consentVersion || '', updates: h.updates === '1' });
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return out;
}

/* ---------- mail rights ---------- */

/* Whether a report email may be handed to the provider now, and reserving the right if so.
   Returns { ok: true, n (this address's count today), release() } or { ok: false, reason: 'not_configured' | 'cap' | 'address_limit' }.
   release() gives the reservation back when the provider then refuses the message. */
async function reserveMail(A, id, env, now) {
  const Mail = require('./pro-mail.js');
  if (!Mail.configured(env)) return { ok: false, reason: 'not_configured' };
  const day = Stats.dayOf(now);
  const nKey = 'sr:n:' + id + ':' + day;
  const mine = await A.incr(nKey);
  await A.expire(nKey, 2 * 86400);
  if (mine > PER_ADDRESS_PER_DAY) { await A.decr(nKey); return { ok: false, reason: 'address_limit' }; }
  const capKey = 'sr:cap:' + day;
  const n = await A.incr(capKey);
  await A.expire(capKey, 2 * 86400);
  if (n > dailyCap(env)) { await A.decr(capKey); await A.decr(nKey); return { ok: false, reason: 'cap' }; }
  return { ok: true, n: mine, release: async function () { await A.decr(nKey); await A.decr(capKey); } };
}

/* ---------- the PDF ---------- */

function pdfProblem(buf, name) {
  if (!Buffer.isBuffer(buf)) return 'not a file';
  if (buf.length < 1024) return 'too small to be the report';
  if (buf.length > MAX_PDF_BYTES) return 'larger than ' + MAX_PDF_BYTES + ' bytes (the storage request limit)';
  if (buf.slice(0, 5).toString('latin1') !== '%PDF-') return 'does not start with %PDF-';
  if (name !== undefined && !/^[A-Za-z0-9._-]{1,120}\.pdf$/.test(name)) return 'the download name must be plain letters, digits, dots, dashes and end in .pdf';
  return null;
}

async function putPdf(A, buf, name) {
  const bad = pdfProblem(buf, name);
  if (bad) { const e = new Error('The PDF is refused: ' + bad); e.code = 'readiness_pdf_refused'; throw e; }
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  await A.set(PDF_KEY, buf.toString('base64'));
  await A.hset(META_KEY, { sha256: sha, bytes: String(buf.length), name: name, uploadedAt: new Date().toISOString() });
  return { sha256: sha, bytes: buf.length, name: name };
}

async function pdfInfo(A) {
  const m = await A.hgetall(META_KEY);
  if (!m || !m.sha256) return null;
  return { sha256: m.sha256, bytes: parseInt(m.bytes, 10) || 0, name: m.name, uploadedAt: m.uploadedAt };
}

// { buffer, name, sha256 } or null (nothing stored, or the stored bytes do not match their hash).
async function getPdf(A) {
  const m = await pdfInfo(A);
  if (!m) return null;
  const b64 = await A.get(PDF_KEY);
  if (!b64) return null;
  const buffer = Buffer.from(b64, 'base64');
  if (crypto.createHash('sha256').update(buffer).digest('hex') !== m.sha256) return null;
  return { buffer: buffer, name: m.name, sha256: m.sha256 };
}

async function removePdf(A) { await A.del(PDF_KEY); await A.del(META_KEY); }

/* ---------- the switch ---------- */

async function setOff(A, off) { if (off) await A.set(OFF_KEY, '1'); else await A.del(OFF_KEY); }
async function isOff(A) { return (await A.get(OFF_KEY)) === '1'; }
// Whether signups and downloads are open: a PDF is stored and the owner has not switched the report off.
async function available(A) { return !(await isOff(A)) && !!(await pdfInfo(A)); }

module.exports = {
  CONSENT_VERSION: CONSENT_VERSION, KEEP_SECONDS: KEEP_SECONDS, LINK_SECONDS: LINK_SECONDS, PER_ADDRESS_PER_DAY: PER_ADDRESS_PER_DAY, DEFAULT_DAILY_CAP: DEFAULT_DAILY_CAP, MAX_PDF_BYTES: MAX_PDF_BYTES,
  normalizeEmail: normalizeEmail, idOf: idOf, removeTokenFor: removeTokenFor, removeTokenForId: removeTokenForId, idFromRemoveToken: idFromRemoveToken,
  downloadToken: downloadToken, readDownloadToken: readDownloadToken, dailyCap: dailyCap,
  join: join, exists: exists, remove: remove, removeId: removeId, removeByEmail: removeByEmail, list: list, reserveMail: reserveMail,
  pdfProblem: pdfProblem, putPdf: putPdf, pdfInfo: pdfInfo, getPdf: getPdf, removePdf: removePdf, setOff: setOff, isOff: isOff, available: available
};
