/* =====================================================================
   lib/pro-store.js: storage for Citehound Pro orders and report jobs.

   Redis through @upstash/redis (Redis.fromEnv reads either
   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN or the Vercel KV names
   KV_REST_API_URL / KV_REST_API_TOKEN). An in-memory adapter with the same
   interface serves local runs and the unit tests. On Vercel, or with
   NODE_ENV=production, a missing connection is an error, never a silent
   fallback to memory.

   Three kinds of record, kept apart on purpose:

     order    pro:order:<token>        hash. status, createdAt, expiresAt, jobId,
                                       contactName, contactEmail, emailSends, restores,
                                       source (pilot | paid), label (operator's note), validDays.
                                       validDays while unused (30 unless the issuer chose), 90 days once used.
              pro:orders               set of order tokens, for scripts/pro-admin.js (list, revoke).
     job      pro:job:<id>             hash. domain, status, phase, timestamps,
                                       counters. NO contact data, ever.
              pro:job:<id>:pages       hash. one field per page, so a page update
                                       is one atomic HSET, never a read-modify-write
                                       of a whole list.
              pro:job:<id>:cit         hash. the citation check: status, reason, model, date, source, the
                                       profile and the questions (JSON), and one result per question (r00 ...).
                                       No contact data. 90 days.
     reverse  pro:job-order:<jobId>    string. job id -> order token, used only by
                                       the email endpoint. Same 90-day TTL as the job.

   Atomicity: every write is one Redis command (HSET, HSETNX, HINCRBY, SET NX,
   SADD). The one multi-step rule, "a token starts exactly one job", rests on a
   SET NX claim key plus a status re-check; see claimOrder().
   ===================================================================== */
'use strict';

const crypto = require('crypto');

var DAY = 86400;
var TTL = {
  orderUnused: 30 * DAY,
  orderUsed: 90 * DAY,
  job: 90 * DAY,
  reverse: 90 * DAY,
  claim: 120,
  lock: 60,
  domainSet: 2 * 3600,
  ordersIndex: 130 * DAY
};
var PAGE_STATUSES = ['pending', 'ok', 'failed', 'blocked', 'skipped'];
var JOB_STATUSES = ['queued', 'running', 'done', 'partial', 'failed'];
var HEX32 = /^[a-f0-9]{32}$/;

function ProConfigError(message) {
  var e = new Error(message);
  e.name = 'ProConfigError';
  e.code = 'pro_store_not_configured';
  return e;
}

function randomHex128() { return crypto.randomBytes(16).toString('hex'); }

/* ---------------- in-memory adapter ---------------- */

function memoryAdapter(opts) {
  opts = opts || {};
  var now = opts.now || function () { return Date.now(); };
  var data = new Map(); // key -> { type: 'str'|'hash'|'set', v, exp }

  function live(key) {
    var e = data.get(key);
    if (!e) return null;
    if (e.exp !== null && e.exp <= now()) { data.delete(key); return null; }
    return e;
  }
  function ensure(key, type) {
    var e = live(key);
    if (!e) { e = { type: type, v: type === 'hash' ? new Map() : (type === 'set' ? new Set() : null), exp: null }; data.set(key, e); }
    if (e.type !== type) throw new Error('WRONGTYPE ' + key);
    return e;
  }

  return {
    kind: 'memory',
    async get(key) { var e = live(key); return e && e.type === 'str' ? e.v : null; },
    async set(key, value, o) {
      o = o || {};
      if (o.nx && live(key)) return false;
      data.set(key, { type: 'str', v: String(value), exp: o.ex ? now() + o.ex * 1000 : null });
      return true;
    },
    async del(key) { return data.delete(key) ? 1 : 0; },
    async delIfEqual(key, value) { var e = live(key); if (e && e.type === 'str' && e.v === String(value)) { data.delete(key); return true; } return false; },
    async incr(key) { var e = ensure(key, 'str'); e.v = String((parseInt(e.v || '0', 10)) + 1); return parseInt(e.v, 10); },
    async decr(key) { var e = ensure(key, 'str'); e.v = String((parseInt(e.v || '0', 10)) - 1); return parseInt(e.v, 10); },
    async expire(key, seconds) { var e = live(key); if (!e) return false; e.exp = now() + seconds * 1000; return true; },
    async ttl(key) { var e = live(key); if (!e) return -2; return e.exp === null ? -1 : Math.max(0, Math.round((e.exp - now()) / 1000)); },
    async exists(key) { return live(key) ? 1 : 0; },
    // Like Redis, the number of fields that were new.
    async hset(key, obj) { var e = ensure(key, 'hash'); var added = 0; Object.keys(obj).forEach(function (f) { if (!e.v.has(f)) added++; e.v.set(f, String(obj[f])); }); return added; },
    async hsetnx(key, field, value) { var e = ensure(key, 'hash'); if (e.v.has(field)) return false; e.v.set(field, String(value)); return true; },
    async hget(key, field) { var e = live(key); return e && e.type === 'hash' && e.v.has(field) ? e.v.get(field) : null; },
    async hgetall(key) { var e = live(key); if (!e || e.type !== 'hash' || !e.v.size) return null; var o = {}; e.v.forEach(function (v, f) { o[f] = v; }); return o; },
    async hdel(key, field) { var e = live(key); return e && e.type === 'hash' && e.v.delete(field) ? 1 : 0; },
    async hincrby(key, field, n) { var e = ensure(key, 'hash'); var next = parseInt(e.v.get(field) || '0', 10) + n; e.v.set(field, String(next)); return next; },
    async sadd(key, member) { var e = ensure(key, 'set'); var had = e.v.has(member); e.v.add(member); return had ? 0 : 1; },
    async srem(key, member) { var e = live(key); return e && e.type === 'set' && e.v.delete(member) ? 1 : 0; },
    async scard(key) { var e = live(key); return e && e.type === 'set' ? e.v.size : 0; },
    async smembers(key) { var e = live(key); return e && e.type === 'set' ? Array.from(e.v) : []; },
    _size: function () { return data.size; },
    _dump: function () { var out = {}; data.forEach(function (e, k) { if (live(k)) out[k] = e.type === 'hash' ? Object.fromEntries(e.v) : (e.type === 'set' ? Array.from(e.v) : e.v); }); return out; }
  };
}

/* ---------------- Redis adapter (@upstash/redis) ---------------- */

function redisAdapter(redis) {
  var RELEASE = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
  return {
    kind: 'redis',
    async get(key) { var v = await redis.get(key); return v === null || v === undefined ? null : String(v); },
    async set(key, value, o) {
      o = o || {};
      var args = {};
      if (o.ex) args.ex = o.ex;
      if (o.nx) args.nx = true;
      var r = await redis.set(key, String(value), args);
      return r === 'OK';
    },
    async del(key) { return redis.del(key); },
    async delIfEqual(key, value) { return (await redis.eval(RELEASE, [key], [String(value)])) === 1; },
    async incr(key) { return redis.incr(key); },
    async decr(key) { return redis.decr(key); },
    async expire(key, seconds) { return (await redis.expire(key, seconds)) === 1; },
    async ttl(key) { return redis.ttl(key); },
    async exists(key) { return redis.exists(key); },
    async hset(key, obj) { var o = {}; Object.keys(obj).forEach(function (f) { o[f] = String(obj[f]); }); return redis.hset(key, o); },
    async hsetnx(key, field, value) { return (await redis.hsetnx(key, field, String(value))) === 1; },
    async hget(key, field) { var v = await redis.hget(key, field); return v === null || v === undefined ? null : String(v); },
    // With automaticDeserialization off, @upstash/redis hands back Redis's flat answer, [field, value, field, value ...],
    // and an empty list for a missing key. With it on it returns an object or null. Both are accepted.
    async hgetall(key) {
      var raw = await redis.hgetall(key);
      if (!raw) return null;
      var out = {};
      if (Array.isArray(raw)) {
        if (!raw.length) return null;
        for (var i = 0; i + 1 < raw.length; i += 2) out[String(raw[i])] = String(raw[i + 1]);
        return out;
      }
      if (!Object.keys(raw).length) return null;
      Object.keys(raw).forEach(function (f) { out[f] = String(raw[f]); });
      return out;
    },
    async hdel(key, field) { return redis.hdel(key, field); },
    async hincrby(key, field, n) { return redis.hincrby(key, field, n); },
    async sadd(key, member) { return redis.sadd(key, member); },
    async srem(key, member) { return redis.srem(key, member); },
    async scard(key) { return redis.scard(key); },
    async smembers(key) { var r = await redis.smembers(key); return Array.isArray(r) ? r.map(String) : []; }
  };
}

// Every key an adapter touches gets a prefix, and onKey hears about each one. scripts/test-real-kv.js runs the whole
// store on a real Redis this way, under a prefix of its own, and deletes exactly the keys it created.
function withPrefix(adapter, prefix, onKey) {
  const wrapped = { kind: adapter.kind + '+prefix' };
  Object.keys(adapter).forEach(function (name) {
    if (typeof adapter[name] !== 'function' || name.charAt(0) === '_') return;
    wrapped[name] = function () {
      const args = Array.prototype.slice.call(arguments);
      args[0] = prefix + args[0];
      if (onKey) onKey(args[0]);
      return adapter[name].apply(adapter, args);
    };
  });
  return wrapped;
}

function hasRedisEnv(env) {
  env = env || process.env;
  return !!((env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL) && (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN));
}
function isProduction(env) {
  env = env || process.env;
  return !!(env.VERCEL || env.NODE_ENV === 'production');
}

// The adapter for this process: Redis when the environment names it, memory only outside production.
function adapterFromEnv(env) {
  env = env || process.env;
  if (hasRedisEnv(env)) {
    var Redis = require('@upstash/redis').Redis;
    // Strings in, strings out: this module does its own JSON.
    return redisAdapter(Redis.fromEnv({ automaticDeserialization: false, retry: { retries: 2 } }));
  }
  if (isProduction(env)) {
    throw ProConfigError('Pro storage is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN) in the Vercel project.');
  }
  if (!adapterFromEnv._warned) { adapterFromEnv._warned = true; console.warn('[pro-store] No Redis connection in the environment: using the in-memory adapter (local runs and tests only).'); }
  return memoryAdapter();
}

/* ---------------- the store ---------------- */

function createStore(adapter, opts) {
  opts = opts || {};
  var now = opts.now || function () { return Date.now(); };
  var iso = function (ms) { return new Date(ms).toISOString(); };
  var A = adapter;

  var orderKey = function (t) { return 'pro:order:' + t; };
  var claimKey = function (t) { return 'pro:order-claim:' + t; };
  var jobKey = function (id) { return 'pro:job:' + id; };
  var pagesKey = function (id) { return 'pro:job:' + id + ':pages'; };
  var lockKey = function (id) { return 'pro:job:' + id + ':lock'; };
  var citKey = function (id) { return 'pro:job:' + id + ':cit'; };
  var reverseKey = function (id) { return 'pro:job-order:' + id; };
  var domainKey = function (d) { return 'pro:domain-active:' + d; };
  var ORDERS_INDEX = 'pro:orders';

  function pad(i) { return ('000' + i).slice(-3); }

  /* ----- orders ----- */

  function orderFromHash(token, h) {
    if (!h) return null;
    var expiresMs = Date.parse(h.expiresAt);
    var status = h.status === 'used' ? 'used' : (h.status === 'revoked' || h.status === 'refunded' ? h.status : (expiresMs && expiresMs <= now() ? 'expired' : 'unused'));
    return {
      token: token,
      status: status,
      createdAt: h.createdAt,
      expiresAt: h.expiresAt,
      jobId: h.jobId || null,
      contact: h.contactEmail ? { name: h.contactName || '', email: h.contactEmail } : null,
      emailSends: parseInt(h.emailSends || '0', 10),
      restores: parseInt(h.restores || '0', 10),
      source: h.source === 'paid' ? 'paid' : 'pilot',
      label: h.label || '',
      buyer: h.buyerEmail ? { name: h.buyerName || '', email: h.buyerEmail } : null,
      review: h.review || '',
      validDays: parseInt(h.validDays || '30', 10) || 30
    };
  }

  // opts: source ('pilot' by default, or 'paid'), label (the issuer's note, max 60 characters, never contact data),
  // validDays (how long the unused link works, 1 to 90, default 30).
  async function createOrder(opts) {
    opts = opts || {};
    var token = randomHex128();
    var t = now();
    var days = Math.max(1, Math.min(90, parseInt(opts.validDays, 10) || 30));
    var fields = { status: 'unused', createdAt: iso(t), expiresAt: iso(t + days * DAY * 1000), emailSends: '0', restores: '0', source: opts.source === 'paid' ? 'paid' : 'pilot', validDays: String(days) };
    var label = String(opts.label || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60);
    if (label) fields.label = label;
    await A.hset(orderKey(token), fields);
    await A.expire(orderKey(token), days * DAY);
    await A.sadd(ORDERS_INDEX, token);
    await A.expire(ORDERS_INDEX, TTL.ordersIndex);
    return orderFromHash(token, await A.hgetall(orderKey(token)));
  }

  // The tokens ever issued that still exist (the index outlives an order by a little; stale members are dropped here).
  async function listOrders() {
    var tokens = await A.smembers(ORDERS_INDEX);
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      var o = await getOrder(tokens[i]);
      if (!o) { await A.srem(ORDERS_INDEX, tokens[i]); continue; }
      out.push(o);
    }
    out.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    return out;
  }

  // A paid order remembers who paid (only to prefill the start form): the order is where contact data lives, never the job.
  async function setOrderBuyer(token, buyer) {
    var o = {};
    if (buyer.email) o.buyerEmail = String(buyer.email).slice(0, 254);
    if (buyer.name) o.buyerName = String(buyer.name).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 100);
    if (Object.keys(o).length) await A.hset(orderKey(token), o);
  }

  // A refund the owner should look at (a partial refund, a refund reported without its amount, a refund after the report was made).
  // The link is not touched. Cleared by the owner with scripts/pro-admin.js clear-review. Returns false when there is no such order.
  async function flagReview(token, reason) {
    if (!HEX32.test(String(token)) || !(await A.exists(orderKey(token)))) return false;
    await A.hset(orderKey(token), { review: String(reason || 'review').slice(0, 40) });
    return true;
  }
  async function clearReview(token) {
    if (!HEX32.test(String(token)) || !(await A.exists(orderKey(token)))) return false;
    await A.hdel(orderKey(token), 'review');
    return true;
  }

  // A refund before use: the link is cancelled (status given by the caller, e.g. 'refunded'). A used order is left alone.
  async function expireOrder(token, status) {
    var o = await getOrder(token);
    if (!o || o.status !== 'unused') return false;
    await A.hset(orderKey(token), { status: status || 'revoked' });
    await A.del(claimKey(token));
    return true;
  }

  // Only a link nobody has used can be revoked. A used order's report is a job, and stays until its own 90 days end.
  async function revokeOrder(token) {
    var o = await getOrder(token);
    if (!o || o.status !== 'unused') return false;
    await A.hset(orderKey(token), { status: 'revoked' });
    await A.del(claimKey(token));
    return true;
  }

  async function getOrder(token) {
    if (!HEX32.test(String(token))) return null;
    return orderFromHash(token, await A.hgetall(orderKey(token)));
  }

  // True for exactly one caller per token. The claim key lives 120 seconds, long enough for the
  // winner to mark the order used; the status is re-read after winning to close the window in
  // which a second caller read "unused" just before the winner finished.
  async function claimOrder(token) {
    var o = await getOrder(token);
    if (!o || o.status !== 'unused') return false;
    var won = await A.set(claimKey(token), randomHex128(), { nx: true, ex: TTL.claim });
    if (!won) return false;
    var again = await getOrder(token);
    if (!again || again.status !== 'unused') return false;
    return true;
  }

  // The winner failed before a job existed: let the holder try again.
  async function releaseClaim(token) { await A.del(claimKey(token)); }

  async function markOrderUsed(token, info) {
    await A.hset(orderKey(token), { status: 'used', jobId: info.jobId, contactName: info.contact.name, contactEmail: info.contact.email });
    await A.expire(orderKey(token), TTL.orderUsed);
    await A.set(reverseKey(info.jobId), token, { ex: TTL.reverse });
  }

  // Atomic: returns the new count; the caller refuses when it passes its maximum.
  async function bumpEmailSends(token) { return A.hincrby(orderKey(token), 'emailSends', 1); }

  // A job that ended with no page read must not cost the customer their link. If the order still points at that job and
  // has been restored fewer than MAX_RESTORES times, it goes back to unused: the job id is dropped (so nothing about the
  // failed job can be reached from the token again), the contact stays, the claim is cleared and the link's validity (30 days unless the issuer chose otherwise) starts over.
  // Returns true when the link was restored.
  async function restoreOrder(token, failedJobId, maxRestores) {
    var key = orderKey(token);
    var h = await A.hgetall(key);
    if (!h || h.status !== 'used' || h.jobId !== failedJobId) return false;
    var n = await A.hincrby(key, 'restores', 1);
    if (n > maxRestores) { await A.hincrby(key, 'restores', -1); return false; }
    var t = now();
    await A.hdel(key, 'jobId');
    var days = parseInt(h.validDays || '30', 10) || 30;
    await A.hset(key, { status: 'unused', expiresAt: iso(t + days * DAY * 1000) });
    await A.expire(key, days * DAY);
    await A.del(claimKey(token));
    return true;
  }

  // Email endpoint only: job id -> order. Returns the order (with contact) or null.
  async function orderForJob(jobId) {
    if (!HEX32.test(String(jobId))) return null;
    var token = await A.get(reverseKey(jobId));
    return token ? getOrder(token) : null;
  }

  /* ----- jobs ----- */

  async function createJob(fields) {
    var id = randomHex128();
    var t = now();
    var rec = {
      id: id,
      domain: fields.domain,
      status: 'queued',
      phase: 'discover',
      createdAt: iso(t),
      startedAt: iso(t),
      expiresAt: iso(t + TTL.job * 1000),
      pageCount: '0',
      done: '0', failed: '0', blocked: '0', skipped: '0',
      cit: fields.citation ? 'on' : 'off'
    };
    await A.hset(jobKey(id), rec);
    await A.expire(jobKey(id), TTL.job);
    return id;
  }

  async function setJob(id, fields) {
    var o = {};
    Object.keys(fields).forEach(function (k) {
      var v = fields[k];
      o[k] = (v !== null && typeof v === 'object') ? JSON.stringify(v) : String(v);
    });
    await A.hset(jobKey(id), o);
  }

  // Writes the discovered page list once. Each page is its own hash field.
  async function setPages(id, urls) {
    var o = {};
    urls.forEach(function (u, i) { o[pad(i)] = JSON.stringify({ url: u, status: 'pending' }); });
    if (urls.length) { await A.hset(pagesKey(id), o); await A.expire(pagesKey(id), TTL.job); }
    await setJob(id, { pageCount: urls.length });
  }

  // One atomic HSET for the page, one HINCRBY for the counter it moves.
  async function updatePage(id, index, page) {
    if (PAGE_STATUSES.indexOf(page.status) === -1) throw new Error('unknown page status ' + page.status);
    await A.hset(pagesKey(id), (function () { var o = {}; o[pad(index)] = JSON.stringify(page); return o; }()));
    var counter = { ok: 'done', failed: 'failed', blocked: 'blocked', skipped: 'skipped' }[page.status];
    if (counter) await A.hincrby(jobKey(id), counter, 1);
  }

  /* ----- the citation check ----- */

  function parseCitation(h) {
    if (!h) return null;
    var j = function (v) { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
    var results = {}, knowledge = {};
    Object.keys(h).forEach(function (k) {
      if (/^r\d{2}$/.test(k)) results[parseInt(k.slice(1), 10)] = j(h[k]);
      else if (/^k\d{2}$/.test(k)) knowledge[parseInt(k.slice(1), 10)] = j(h[k]);
    });
    // modes: which parts this job was started with { test, knowledge, provider, model }. kstatus/kreason: the outcome of the knowledge check.
    var modes = j(h.modes) || {};
    return { status: h.status || 'running', stage: h.stage || null, reason: h.reason || null, model: h.model || null, date: h.date || null, source: h.source || null,
      qattempts: parseInt(h.qattempts || '0', 10), calls: parseInt(h.calls || '0', 10), kcalls: parseInt(h.kcalls || '0', 10), profile: j(h.profile), questions: j(h.questions), qdraft: j(h.qdraft),
      modes: { test: !!modes.test, knowledge: !!modes.knowledge, provider: modes.provider || null, model: modes.model || null },
      kstatus: h.kstatus || null, kreason: h.kreason || null, kmodel: h.kmodel || null, kdate: h.kdate || null, results: results, knowledge: knowledge };
  }
  async function getCitation(id) { return parseCitation(await A.hgetall(citKey(id))); }
  async function setCitation(id, fields) {
    var o = {};
    Object.keys(fields).forEach(function (k) { var v = fields[k]; o[k] = (v !== null && typeof v === 'object') ? JSON.stringify(v) : String(v); });
    await A.hset(citKey(id), o);
    await A.expire(citKey(id), TTL.job);
  }
  async function setCitationResult(id, index, result) { var o = {}; o['r' + ('0' + index).slice(-2)] = JSON.stringify(result); await setCitation(id, o); }
  async function setKnowledgeResult(id, index, result) { var o = {}; o['k' + ('0' + index).slice(-2)] = JSON.stringify(result); await setCitation(id, o); }

  async function getJob(id) {
    if (!HEX32.test(String(id))) return null;
    var h = await A.hgetall(jobKey(id));
    if (!h) return null;
    var raw = (await A.hgetall(pagesKey(id))) || {};
    var pages = Object.keys(raw).sort().map(function (f) { try { return JSON.parse(raw[f]); } catch (e) { return { url: '', status: 'failed', error: 'unreadable' }; } });
    var citation = h.cit === 'on' ? (parseCitation(await A.hgetall(citKey(id))) || { status: 'queued', stage: null, reason: null, model: null, date: null, source: null, qattempts: 0, calls: 0, kcalls: 0, profile: null, questions: null, qdraft: null, modes: { test: false, knowledge: false, provider: null, model: null }, kstatus: null, kreason: null, kmodel: null, kdate: null, results: {}, knowledge: {} }) : null;
    var siteContext = null;
    try { siteContext = h.siteContext ? JSON.parse(h.siteContext) : null; } catch (e) { /* left null */ }
    var total = parseInt(h.pageCount || '0', 10);
    var progress = {
      total: total,
      done: parseInt(h.done || '0', 10),
      failed: parseInt(h.failed || '0', 10),
      blocked: parseInt(h.blocked || '0', 10),
      skipped: parseInt(h.skipped || '0', 10)
    };
    progress.settled = progress.done + progress.failed + progress.blocked + progress.skipped;
    return {
      id: h.id,
      domain: h.domain,
      status: h.status,
      phase: h.phase,
      reason: h.reason || null,
      linkRestored: h.restored === '1',
      citation: citation,
      createdAt: h.createdAt,
      startedAt: h.startedAt,
      finishedAt: h.finishedAt || null,
      expiresAt: h.expiresAt,
      discovery: { source: h.discoverySource || null, candidates: h.candidates ? parseInt(h.candidates, 10) : null },
      siteContext: siteContext,
      progress: progress,
      pages: pages
    };
  }

  // One worker per job at a time. Returns a token to release with, or null when someone else holds it.
  async function acquireLock(id) {
    var nonce = randomHex128();
    var got = await A.set(lockKey(id), nonce, { nx: true, ex: TTL.lock });
    return got ? nonce : null;
  }
  async function releaseLock(id, nonce) { return A.delIfEqual(lockKey(id), nonce); }

  /* ----- per-domain concurrency ----- */

  // INCR hands every caller a distinct number, so with a limit of 2 at most two ever hold a slot.
  // The counter expires on its own, so a job that died without releasing cannot block a domain for long.
  async function reserveDomainSlot(domain, max) {
    var k = domainKey(domain);
    var n = await A.incr(k);
    await A.expire(k, TTL.domainSet);
    if (n > max) { await A.decr(k); return false; }
    return true;
  }
  async function releaseDomainSlot(domain) {
    var n = await A.decr(domainKey(domain));
    if (n < 0) await A.incr(domainKey(domain));
  }

  // True if the caller may proceed now: a key that lives `seconds` and can be set by one caller only.
  async function takeSlot(key, seconds) { return A.set('pro:slot:' + key, '1', { nx: true, ex: seconds }); }

  /* ----- counters for rate limits (keys carry only a keyed hash, never an address) ----- */

  async function hit(key, windowSeconds) {
    var k = 'pro:rl:' + key;
    var n = await A.incr(k);
    if (n === 1) await A.expire(k, windowSeconds);
    return n;
  }

  return {
    adapter: A,
    ttl: TTL,
    getCitation: getCitation, setCitation: setCitation, setCitationResult: setCitationResult, setKnowledgeResult: setKnowledgeResult, setOrderBuyer: setOrderBuyer, expireOrder: expireOrder, flagReview: flagReview, clearReview: clearReview, createOrder: createOrder, listOrders: listOrders, revokeOrder: revokeOrder, getOrder: getOrder, claimOrder: claimOrder, releaseClaim: releaseClaim,
    markOrderUsed: markOrderUsed, bumpEmailSends: bumpEmailSends, restoreOrder: restoreOrder, orderForJob: orderForJob,
    createJob: createJob, setJob: setJob, setPages: setPages, updatePage: updatePage, getJob: getJob,
    acquireLock: acquireLock, releaseLock: releaseLock,
    reserveDomainSlot: reserveDomainSlot, releaseDomainSlot: releaseDomainSlot,
    takeSlot: takeSlot, hit: hit
  };
}

var shared = null;
// The process-wide store. Throws ProConfigError in production without Redis.
function getStore() {
  if (!shared) shared = createStore(adapterFromEnv());
  return shared;
}
function resetSharedStore(store) { shared = store || null; }

module.exports = {
  createStore: createStore, withPrefix: withPrefix, memoryAdapter: memoryAdapter, redisAdapter: redisAdapter, adapterFromEnv: adapterFromEnv,
  getStore: getStore, resetSharedStore: resetSharedStore, hasRedisEnv: hasRedisEnv,
  ProConfigError: ProConfigError, TTL: TTL, HEX32: HEX32, PAGE_STATUSES: PAGE_STATUSES, JOB_STATUSES: JOB_STATUSES, randomHex128: randomHex128
};
