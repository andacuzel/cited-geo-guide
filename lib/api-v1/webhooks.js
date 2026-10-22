/* =====================================================================
   lib/api-v1/webhooks.js: webhooks for Pro keys. A webhook is an https address, the event types it wants and a secret that signs every delivery.

   Storage (Redis):
     api:wh:<keyid>     hash  webhook id -> JSON { id, url, events, createdAt, enabled, failures, disabledAt, secret: { iv, tag, ct } }
     api:wdl:<hookid>   hash  delivery id -> JSON { id, event_id, event_type, status, attempt, next_at, http_status, error, created_at, delivered_at, test }   the last 50, expire after 90 days
     api:wh:pend        hash  delivery id -> JSON { keyid, hookid, body, eventId, type, attempt, nextAt }                                   deliveries waiting for a retry
   The secret has to be readable to sign with, so it is stored encrypted (AES-256-GCM, a key derived from API_KEY_PEPPER), never returned after it was shown once, never logged.

   A delivery is a POST of the event as JSON, signed:
     X-Citehound-Signature: v1=<hex HMAC-SHA-256 of "<timestamp>.<body>" with the secret>      X-Citehound-Timestamp: <unix seconds>
     X-Citehound-Event, X-Citehound-Event-Id, X-Citehound-Delivery
   A 2xx answer is a success. Anything else (a status, a timeout, a refused address) is a failure and is retried three times, after 1 minute, 10 minutes and 1 hour (the retry waits for the next run of
   the scheduled job). After API_V1_WEBHOOK_MAX_FAILS (default 5) deliveries in a row that failed all their attempts, the webhook is disabled. The POST goes through lib/safe-fetch.js: public addresses only,
   https and port 443 only, no redirect is followed, short timeout, small answer.
   ===================================================================== */

'use strict';

const crypto = require('crypto');
const Monitor = require('./monitor.js');

const BACKOFF_MS = [60 * 1000, 10 * 60 * 1000, 60 * 60 * 1000];
const LOG_KEEP = 50;
const LOG_TTL = 90 * 86400;
const MIN_SECRET = 16, MAX_SECRET = 128;
const BAD_HOST = /\.(local|localhost|internal|lan|home|corp|test|invalid|onion|arpa|example)$/;
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$/;

/* ---------- the address ---------- */

// -> { ok, url } or { ok: false, message }. https only, the default port, no credentials, no fragment, a real public-looking hostname (the fetch guard checks the addresses again at every delivery).
function validateUrl(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 500 || /[\s\u0000-\u001f]/.test(raw)) return { ok: false, message: '"url" must be an https address of up to 500 characters.' };
  let u; try { u = new URL(raw); } catch (e) { return { ok: false, message: '"url" is not a valid address.' }; }
  if (u.protocol !== 'https:') return { ok: false, message: '"url" must start with https://.' };
  if (u.username || u.password) return { ok: false, message: '"url" must not contain a user name or password.' };
  if (u.port && u.port !== '443') return { ok: false, message: '"url" must use the default https port.' };
  if (u.hash) return { ok: false, message: '"url" must not have a fragment.' };
  const host = u.hostname.toLowerCase();
  if (!HOST_RE.test(host) || BAD_HOST.test(host) || host === 'localhost') return { ok: false, message: '"url" must name a public host, not an address, localhost or an internal name.' };
  return { ok: true, url: u.toString() };
}

/* ---------- the secret ---------- */

const secretKey = (pepper) => crypto.createHmac('sha256', pepper).update('webhook-secret-v1').digest();
function seal(pepper, secret) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', secretKey(pepper), iv);
  const ct = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}
function open(pepper, box) {
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', secretKey(pepper), Buffer.from(box.iv, 'base64'));
    d.setAuthTag(Buffer.from(box.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(box.ct, 'base64')), d.final()]).toString('utf8');
  } catch (e) { return null; }
}
const newSecret = () => 'whsec_' + crypto.randomBytes(24).toString('base64url');
const sign = (secret, ts, body) => 'v1=' + crypto.createHmac('sha256', secret).update(ts + '.' + body).digest('hex');
// For receivers (and the tests): checks a signature and that the timestamp is within the tolerance.
function verify(secret, ts, body, header, toleranceSec, nowMs) {
  const want = Buffer.from(sign(secret, ts, body)), got = Buffer.from(String(header || ''));
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return false;
  return Math.abs(Math.floor((nowMs || Date.now()) / 1000) - parseInt(ts, 10)) <= (toleranceSec || 300);
}

/* ---------- records ---------- */

const hookKey = (keyid) => 'api:wh:' + keyid, logKey = (hookid) => 'api:wdl:' + hookid, PEND = 'api:wh:pend';
const publicView = (h) => ({ id: h.id, url: h.url, events: h.events, enabled: h.enabled, consecutive_failures: h.failures || 0, created_at: h.createdAt, disabled_at: h.disabledAt || null, disabled_reason: h.disabledReason || null });

async function list(A, keyid) {
  const h = await A.hgetall(hookKey(keyid)) || {}; const out = [];
  Object.keys(h).forEach((id) => { const v = Monitor.parse(h[id]); if (v) out.push(v); });
  return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}
async function get(A, keyid, id) { return Monitor.parse(await A.hget(hookKey(keyid), id)); }
const save = (A, keyid, h) => A.hset(hookKey(keyid), { [h.id]: JSON.stringify(h) });

// -> { ok, hook, secret (only when generated) } or { ok: false, status, error, message }
async function create(ctx, keyid, input) {
  const { A, p, cfg } = ctx, now = ctx.clock();
  const u = validateUrl(input.url);
  if (!u.ok) return { ok: false, status: 400, error: 'invalid_request', message: u.message };
  let events = input.events === undefined ? Monitor.EVENT_TYPES.slice() : input.events;
  if (!Array.isArray(events) || !events.length || events.length > 20 || events.some((e) => Monitor.EVENT_TYPES.indexOf(e) === -1)) return { ok: false, status: 400, error: 'invalid_request', message: '"events" must be a list of: ' + Monitor.EVENT_TYPES.join(', ') + '.' };
  events = Array.from(new Set(events));
  let secret = input.secret, generated = false;
  if (secret === undefined || secret === null) { secret = newSecret(); generated = true; }
  else if (typeof secret !== 'string' || secret.length < MIN_SECRET || secret.length > MAX_SECRET || /[\s\u0000-\u001f]/.test(secret)) return { ok: false, status: 400, error: 'invalid_request', message: '"secret" must be ' + MIN_SECRET + ' to ' + MAX_SECRET + ' characters with no spaces, or left out so that one is generated.' };
  const existing = await list(A, keyid);
  if (existing.length >= cfg.webhookLimit) return { ok: false, status: 409, error: 'webhook_limit', message: 'A key may have ' + cfg.webhookLimit + ' webhooks. Delete one first.' };
  if (existing.some((h) => h.url === u.url)) return { ok: false, status: 409, error: 'webhook_exists', message: 'This key already has a webhook for that address.' };
  const hook = { id: 'whk_' + crypto.randomBytes(8).toString('hex'), url: u.url, events: events, createdAt: new Date(now).toISOString(), enabled: true, failures: 0, secret: seal(p, secret) };
  await save(A, keyid, hook);
  return { ok: true, hook: hook, secret: generated ? secret : null };
}

async function remove(A, keyid, id) {
  if (!(await get(A, keyid, id))) return false;
  await A.hdel(hookKey(keyid), id); await A.del(logKey(id));
  const pend = await A.hgetall(PEND) || {};
  for (const d of Object.keys(pend)) { const v = Monitor.parse(pend[d]); if (v && v.hookid === id) await A.hdel(PEND, d); }
  return true;
}
async function purgeKey(A, keyid) { for (const h of await list(A, keyid)) await remove(A, keyid, h.id); await A.del(hookKey(keyid)); }

async function deliveries(A, hookid) {
  const h = await A.hgetall(logKey(hookid)) || {}; const out = [];
  Object.keys(h).forEach((id) => { const v = Monitor.parse(h[id]); if (v) out.push(v); });
  return out.sort((a, b) => (a.id < b.id ? 1 : -1));
}
async function logDelivery(A, hookid, rec) {
  await A.hset(logKey(hookid), { [rec.id]: JSON.stringify(rec) });
  const all = await deliveries(A, hookid);
  for (const old of all.slice(LOG_KEEP)) await A.hdel(logKey(hookid), old.id);
  await A.expire(logKey(hookid), LOG_TTL);
}

/* ---------- delivery ---------- */

const payloadOf = (e) => ({ id: e.id, type: e.type, created_at: e.at, domain: e.domain, summary: e.summary, snapshot_id: e.snapshot_id || null, data: e.data || {} });

// The one place a webhook is called. deps.webhookPost is for tests; it takes (url, { headers, body, timeoutMs }) and returns { ok, status } or { ok: false, kind }.
async function post(ctx, url, headers, body) {
  if (ctx.deps.webhookPost) return ctx.deps.webhookPost(url, { headers: headers, body: body, timeoutMs: 8000 });
  const r = await require('../safe-fetch.js').safeGet(url, { ua: 'Citehound-Webhook/1.0 (+https://getcitehound.com/api)', method: 'POST', body: body, headers: Object.assign({ Accept: 'application/json' }, headers), timeoutMs: 8000, maxBytes: 16 * 1024, accept: 'application/json' });
  return r.status ? { ok: r.ok, status: r.status } : { ok: false, kind: r.kind || 'network' };
}

// One attempt. -> { ok, status, error }
async function attempt(ctx, hook, deliveryId, event, body) {
  const secret = open(ctx.p, hook.secret);
  if (!secret) return { ok: false, error: 'secret_unreadable' };
  if (!validateUrl(hook.url).ok) return { ok: false, error: 'bad_url' };
  const ts = String(Math.floor(ctx.clock() / 1000));
  const headers = { 'Content-Type': 'application/json', 'X-Citehound-Event': event.type, 'X-Citehound-Event-Id': event.id, 'X-Citehound-Delivery': deliveryId, 'X-Citehound-Timestamp': ts, 'X-Citehound-Signature': sign(secret, ts, body) };
  let r; try { r = await post(ctx, hook.url, headers, body); } catch (e) { r = { ok: false, kind: 'network' }; }
  if (r.ok) return { ok: true, status: r.status };
  return { ok: false, status: r.status || null, error: r.status ? 'http_' + r.status : (r.kind || 'network') };
}

const newDeliveryId = (ms) => 'dlv_' + Monitor.stamp(ms) + '_' + crypto.randomBytes(4).toString('hex');

async function recordFailure(ctx, keyid, hook, reason) {
  const fresh = (await get(ctx.A, keyid, hook.id)) || hook;
  fresh.failures = (fresh.failures || 0) + 1;
  if (fresh.failures >= ctx.cfg.maxFails && fresh.enabled) { fresh.enabled = false; fresh.disabledAt = new Date(ctx.clock()).toISOString(); fresh.disabledReason = 'repeated_failures'; }
  await save(ctx.A, keyid, fresh);
  return fresh;
}
async function recordSuccess(ctx, keyid, hook) {
  const fresh = (await get(ctx.A, keyid, hook.id)) || hook;
  if (fresh.failures) { fresh.failures = 0; await save(ctx.A, keyid, fresh); }
}

// Sends an event to one webhook now (or queues it when the run is out of time). Returns the delivery record.
async function deliver(ctx, keyid, hook, event, o) {
  o = o || {};
  const now = ctx.clock(), id = newDeliveryId(now), body = JSON.stringify(payloadOf(event));
  const rec = { id: id, event_id: event.id, event_type: event.type, status: 'pending', attempt: 0, next_at: null, http_status: null, error: null, created_at: new Date(now).toISOString(), delivered_at: null, test: !!o.test };
  if (!o.test && ctx.deadlineAt && Date.now() > ctx.deadlineAt) {
    rec.next_at = new Date(now).toISOString();
    await logDelivery(ctx.A, hook.id, rec);
    await ctx.A.hset(PEND, { [id]: JSON.stringify({ keyid: keyid, hookid: hook.id, body: body, eventId: event.id, type: event.type, attempt: 0, nextAt: now }) });
    return rec;
  }
  const r = await attempt(ctx, hook, id, event, body);
  rec.attempt = 1; rec.http_status = r.status || null;
  if (r.ok) { rec.status = 'delivered'; rec.delivered_at = new Date(now).toISOString(); await logDelivery(ctx.A, hook.id, rec); if (!o.test) await recordSuccess(ctx, keyid, hook); return rec; }
  rec.error = r.error;
  if (o.test) { rec.status = 'failed'; await logDelivery(ctx.A, hook.id, rec); return rec; }
  rec.next_at = new Date(now + BACKOFF_MS[0]).toISOString();
  await logDelivery(ctx.A, hook.id, rec);
  await ctx.A.hset(PEND, { [id]: JSON.stringify({ keyid: keyid, hookid: hook.id, body: body, eventId: event.id, type: event.type, attempt: 1, nextAt: now + BACKOFF_MS[0] }) });
  return rec;
}

// Delivers the events of one domain to every webhook of every valid watcher that asked for them.
async function dispatch(ctx, domain, evs) {
  let n = 0;
  if (!evs.length) return n;
  for (const keyid of await Monitor.validWatchers(ctx.A, domain)) {
    for (const hook of await list(ctx.A, keyid)) {
      if (!hook.enabled) continue;
      for (const e of evs) { if (hook.events.indexOf(e.type) !== -1) { await deliver(ctx, keyid, hook, e); n++; } }
    }
  }
  return n;
}

// The retries that are due. attempt is how many attempts were made; after the third retry (the fourth attempt) the delivery has failed for good.
async function processPending(ctx, max) {
  const pend = await ctx.A.hgetall(PEND) || {}, now = ctx.clock(); let done = 0;
  const due = Object.keys(pend).map((id) => ({ id: id, v: Monitor.parse(pend[id]) })).filter((x) => x.v && x.v.nextAt <= now).sort((a, b) => a.v.nextAt - b.v.nextAt).slice(0, max || 50);
  for (const { id, v } of due) {
    if (ctx.deadlineAt && Date.now() > ctx.deadlineAt) break;
    const hook = await get(ctx.A, v.keyid, v.hookid);
    const rec = (await deliveries(ctx.A, v.hookid)).filter((d) => d.id === id)[0];
    if (!hook || !rec) { await ctx.A.hdel(PEND, id); continue; }
    if (!hook.enabled) { rec.status = 'failed'; rec.error = 'webhook_disabled'; rec.next_at = null; await logDelivery(ctx.A, hook.id, rec); await ctx.A.hdel(PEND, id); continue; }
    const event = { id: v.eventId, type: v.type };
    const r = await attempt(ctx, hook, id, event, v.body);
    rec.attempt = v.attempt + 1; rec.http_status = r.status || null;
    if (r.ok) { rec.status = 'delivered'; rec.delivered_at = new Date(now).toISOString(); rec.next_at = null; rec.error = null; await ctx.A.hdel(PEND, id); await recordSuccess(ctx, v.keyid, hook); }
    else if (rec.attempt > BACKOFF_MS.length) { rec.status = 'failed'; rec.error = r.error; rec.next_at = null; await ctx.A.hdel(PEND, id); await recordFailure(ctx, v.keyid, hook, r.error); }
    else { rec.error = r.error; rec.next_at = new Date(now + BACKOFF_MS[rec.attempt - 1]).toISOString(); await ctx.A.hset(PEND, { [id]: JSON.stringify(Object.assign({}, v, { attempt: rec.attempt, nextAt: now + BACKOFF_MS[rec.attempt - 1] })) }); }
    await logDelivery(ctx.A, hook.id, rec);
    done++;
  }
  return done;
}

function testEvent(domain, now) {
  return { id: 'evt_test_' + Monitor.stamp(now) + '_' + crypto.randomBytes(3).toString('hex'), type: 'test', domain: domain || 'example.com', at: new Date(now).toISOString(), summary: 'This is a test event from Citehound. Nothing changed on any site.', snapshot_id: null, data: { test: true } };
}

module.exports = { BACKOFF_MS, LOG_KEEP, validateUrl, seal, open, sign, verify, newSecret, publicView, list, get, create, remove, purgeKey, deliveries, deliver, dispatch, processPending, testEvent, payloadOf, attempt };
