/* =====================================================================
   lib/pro-payments.js: payments, provider-agnostic. The buyer pays on the provider's hosted checkout, the provider
   calls our webhook, the webhook creates the order, and the buyer lands on /pro/welcome, which sends them to
   /pro/start/<token>.

   A provider adapter is { name, verify(raw, headers, env, now), parse(body) }:
     verify  -> { ok: true } or { ok: false, reason }   (signature, timestamp tolerance)
     parse   -> an event, or null for anything we do not act on:
                { kind: 'paid', eventId, orderRef, checkoutId, email, name }
                { kind: 'refund', eventId, orderRef }

   Adapters here: polar (built from Polar's official documentation and OpenAPI, see docs/payments.md for what is verified and
   what is not) and paddle (a documented stub that refuses everything). processEvent() is the one place that changes state.

   Rules: unsigned, wrongly signed, stale or malformed events change nothing; an event id is processed once (a replay or a
   redelivery answers the same and does nothing); an order is created once per provider order id; a refund cancels the link only
   if nobody has used it yet; nothing here logs a token, an address, a name or a checkout id.
   ===================================================================== */

'use strict';

const crypto = require('crypto');
const Orders = require('./pro-orders.js');
const Stats = require('./pro-stats.js');

const DAY = 86400;
const TOLERANCE_SECONDS = 300;        // Standard Webhooks leaves the tolerance to the receiver; five minutes is what its libraries use
const EVENT_KEEP = 7 * DAY;           // an event id is remembered this long (Polar retries over a shorter time)
const CHECKOUT_WINDOW = 30 * 60;      // the buyer can collect the link from the welcome page for 30 minutes
const TAKEN_KEEP = DAY;
const MAX_BODY = 256 * 1024;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/* ---------------- Polar ---------------- */

// Signature: Standard Webhooks (standardwebhooks.com): headers webhook-id, webhook-timestamp, webhook-signature; the signed text is
// "<id>.<timestamp>.<raw body>", HMAC-SHA256, base64; the header holds one or more space-separated "v1,<signature>" entries.
// Polar's page says secrets generated before 8 Sep 2026 00:00 UTC use the UTF-8 bytes of the whole "whsec_..." string as the key, and
// later ones are standard (the base64 text after "whsec_" decoded), and that its SDKs try both. This does the same.
function polarKeys(secret) {
  const keys = [Buffer.from(secret, 'utf8')];
  if (secret.indexOf('whsec_') === 0) { const b = Buffer.from(secret.slice(6), 'base64'); if (b.length) keys.unshift(b); }
  return keys;
}
function header(headers, name) { const h = headers || {}; const k = Object.keys(h).filter(function (x) { return x.toLowerCase() === name; })[0]; return k ? String(Array.isArray(h[k]) ? h[k][0] : h[k]) : ''; }

const polar = {
  name: 'polar',
  verify: function (raw, headers, env, nowMs) {
    const secret = String((env || process.env).PRO_WEBHOOK_SECRET || '');
    if (secret.length < 16) return { ok: false, reason: 'not_configured' };
    const id = header(headers, 'webhook-id'), ts = header(headers, 'webhook-timestamp'), sig = header(headers, 'webhook-signature');
    if (!id || !ts || !sig) return { ok: false, reason: 'missing_headers' };
    if (!/^\d{9,12}$/.test(ts)) return { ok: false, reason: 'bad_timestamp' };
    if (Math.abs((nowMs === undefined ? Date.now() : nowMs) / 1000 - parseInt(ts, 10)) > TOLERANCE_SECONDS) return { ok: false, reason: 'stale' };
    const signed = id + '.' + ts + '.' + raw;
    const candidates = sig.split(/\s+/).filter(function (x) { return x.indexOf('v1,') === 0; }).map(function (x) { return x.slice(3); });
    if (!candidates.length) return { ok: false, reason: 'bad_signature' };
    const good = polarKeys(secret).some(function (k) {
      const want = crypto.createHmac('sha256', k).update(signed).digest('base64');
      return candidates.some(function (c) { return eq(c, want); });
    });
    return good ? { ok: true, eventId: id } : { ok: false, reason: 'bad_signature' };
  },
  // Payload shapes are from Polar's OpenAPI (2026-10): { type, timestamp, api_version, data }, with data an Order for order.* events
  // (id, status paid|refunded|partially_refunded|..., paid, checkout_id, billing_reason, customer { email, name }) and a Refund for refund.*
  // (id, status pending|succeeded|failed|canceled, order_id).
  parse: function (body, eventId) {
    if (!body || typeof body !== 'object' || typeof body.type !== 'string' || !body.data || typeof body.data !== 'object') return null;
    const d = body.data;
    if (body.type === 'order.paid') {
      if (d.status !== 'paid' || d.paid === false || typeof d.id !== 'string') return null;
      if (d.billing_reason && d.billing_reason !== 'purchase') return null;
      const c = d.customer || {};
      return { kind: 'paid', eventId: eventId, orderRef: d.id, checkoutId: typeof d.checkout_id === 'string' ? d.checkout_id : '', email: typeof c.email === 'string' ? c.email : '', name: typeof c.name === 'string' ? c.name : (typeof d.billing_name === 'string' ? d.billing_name : '') };
    }
    // order.refunded is "sent when an order is fully or partially refunded" (Polar OpenAPI); the order's status says which:
    // refunded = in full, partially_refunded = in part. Only a full refund cancels a link. A refund.* event carries the refund's amount
    // but not the order's total, so it cannot tell the two apart: it only flags the order for the owner's review.
    if (body.type === 'order.refunded') {
      if (typeof d.id !== 'string') return null;
      if (d.status === 'refunded') return { kind: 'refund', full: true, eventId: eventId, orderRef: d.id };
      if (d.status === 'partially_refunded') return { kind: 'refund', full: false, why: 'partial_refund', eventId: eventId, orderRef: d.id };
      return null;
    }
    if ((body.type === 'refund.created' || body.type === 'refund.updated') && d.status === 'succeeded' && typeof d.order_id === 'string') {
      return { kind: 'refund', full: false, why: 'refund_reported', eventId: eventId, orderRef: d.order_id };
    }
    return null;
  }
};

/* ---------------- Paddle: a stub ---------------- */

// Paddle Billing (developer.paddle.com/webhooks/signature-verification, read 11 Oct 2026): a "Paddle-Signature" header "ts=<unix>;h1=<hex>"
// (more than one h1 during secret rotation); the signed text is "<ts>:<raw body>", HMAC-SHA256 with the notification destination's secret,
// hex; compare to h1; check ts against the clock (the SDKs allow 5 seconds). NOT verified: which event types mean "paid" and "refunded or
// charged back" (the author expects transaction.completed and adjustment.* but did not read them), the payload fields, and Paddle's checkout
// success URL placeholder. So this adapter refuses everything until someone reads those pages, fills these two functions and adds tests like
// those for Polar.
const paddle = {
  name: 'paddle',
  verify: function () { return { ok: false, reason: 'not_implemented' }; },
  parse: function () { return null; }
};

const ADAPTERS = { polar: polar, paddle: paddle };
function adapterFor(env) { return ADAPTERS[String((env || process.env).PRO_PAYMENT_PROVIDER || 'polar').toLowerCase()] || null; }

/* ---------------- the one place that changes state ---------------- */

// Returns { status, body }: 202 { ok, duplicate? } when handled (or deliberately ignored), 403 for a rejected signature, 400 for a bad body,
// 503 when the secret is not set, 500 for a storage failure (the provider then retries, and the event id is released).
async function processEvent(store, raw, headers, deps) {
  deps = deps || {};
  const env = deps.env || process.env;
  const adapter = deps.adapter || adapterFor(env);
  if (!adapter) return { status: 503, body: { error: 'not_configured' } };
  const v = adapter.verify(raw, headers, env, deps.now);
  if (!v.ok) {
    if (v.reason === 'not_configured') return { status: 503, body: { error: 'not_configured' } };
    await Stats.count(store, 'webhook_rejected');
    return { status: 403, body: { error: 'invalid_signature' } };
  }
  let json; try { json = JSON.parse(raw); } catch (e) { return { status: 400, body: { error: 'bad_body' } }; }
  const A = store.adapter;
  const claimKey = 'pro:wh:' + sha(v.eventId);
  const fresh = await A.set(claimKey, '1', { nx: true, ex: EVENT_KEEP });
  if (!fresh) return { status: 202, body: { ok: true, duplicate: true } };
  try {
    const ev = adapter.parse(json, v.eventId);
    if (!ev) return { status: 202, body: { ok: true, ignored: true } };
    if (ev.kind === 'paid') await onPaid(store, ev, deps, env);
    else if (ev.kind === 'refund') await onRefund(store, ev);
    return { status: 202, body: { ok: true } };
  } catch (e) {
    await A.del(claimKey).catch(function () {});
    console.error('[pro-payments] processing failed: ' + (e && e.name ? e.name : 'Error'));
    await Stats.count(store, 'webhook_errors');
    return { status: 500, body: { error: 'try_again' } };
  }
}

async function onPaid(store, ev, deps, env) {
  const r = await Orders.createOrderFromPayment(store, { paymentRef: ev.orderRef });
  const token = r.order.token;
  const A = store.adapter;
  if (ev.email || ev.name) await store.setOrderBuyer(token, { email: ev.email, name: ev.name });
  if (!r.duplicate && ev.checkoutId) {
    const k = 'pro:checkout:' + sha(ev.checkoutId);
    if (!(await A.get('pro:checkout-taken:' + sha(ev.checkoutId)))) await A.set(k, token, { ex: CHECKOUT_WINDOW });
  }
  // The backup copy of the link, by email, once per order. Skipped silently when mail is not set up, and never fatal.
  if (!r.duplicate && ev.email) {
    try {
      const Mail = require('./pro-mail.js');
      const sent = await Mail.sendStartLink({ token: token, url: r.url, name: ev.name, email: ev.email }, { env: env, fetch: deps && deps.fetch });
      if (sent.ok) await Stats.count(store, 'start_link_emails');
      else if (sent.reason === 'provider_error' || sent.reason === 'provider_unreachable') await Stats.count(store, 'mail_failed');
    } catch (e) { /* the welcome page is the primary way */ }
  }
}

async function onRefund(store, ev) {
  const A = store.adapter;
  const token = await A.get('pro:payment:' + sha(ev.orderRef));
  if (!token) return; // an order we never made (or one older than its keys): nothing to cancel
  if (ev.full) {
    const done = await store.expireOrder(token, 'refunded');
    if (done) { await Stats.count(store, 'payments_refunded'); return; }
    // Nothing to cancel: the report was already made (or the link already ended). The owner decides what to do.
    if (await store.flagReview(token, 'refund_after_use')) await Stats.count(store, 'payments_review');
    return;
  }
  // A partial refund (or a refund whose size we cannot tell): the link stays valid and the order is flagged.
  if (await store.flagReview(token, ev.why || 'partial_refund')) await Stats.count(store, 'payments_review');
}

/* ---------------- the welcome page's lookup ---------------- */

// Hands the link out once. { state: 'ready', token } | { state: 'taken' } | { state: 'gone' } (cancelled) | { state: 'waiting' }.
async function collect(store, checkoutId) {
  const A = store.adapter;
  const h = sha(checkoutId);
  const token = await A.get('pro:checkout:' + h);
  if (token) {
    // A link that was refunded (or revoked) in the meantime is not handed out.
    const o = await store.getOrder(token);
    if (!o || o.status !== 'unused') { await A.del('pro:checkout:' + h); return { state: 'gone' }; }
    const won = await A.del('pro:checkout:' + h);
    if (won === 1) { await A.set('pro:checkout-taken:' + h, '1', { ex: TAKEN_KEEP }); return { state: 'ready', token: token }; }
    return { state: 'taken' };
  }
  if (await A.get('pro:checkout-taken:' + h)) return { state: 'taken' };
  return { state: 'waiting' };
}

module.exports = { processEvent: processEvent, collect: collect, adapterFor: adapterFor, polar: polar, paddle: paddle, ADAPTERS: ADAPTERS, TOLERANCE_SECONDS: TOLERANCE_SECONDS, CHECKOUT_WINDOW: CHECKOUT_WINDOW, MAX_BODY: MAX_BODY };
