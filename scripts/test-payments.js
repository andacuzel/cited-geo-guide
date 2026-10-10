#!/usr/bin/env node
/* =====================================================================
   scripts/test-payments.js

   The payment flow with signed sample events built here (the real provider is never called): signature checks (wrong, missing, stale,
   rotated, both Polar key forms), replay and double events, an order made once per provider order, the checkout-to-link hand-over (once,
   short window, never logged), the backup email, prefill, refund before use (the link is cancelled), refund after use (nothing changes),
   fail-closed without PRO_WEBHOOK_SECRET, raw-body handling, and the Paddle stub refusing everything.

     node scripts/test-payments.js
   ===================================================================== */

'use strict';

process.env.PRO_HASH_SECRET = 'test-only-secret-0123456789abcdef';
const crypto = require('crypto');
const { EventEmitter } = require('events');
const S = require('../lib/pro-store.js');
const api = require('../lib/pro-api.js');
const H = require('../lib/pro-http.js');
const Pay = require('../lib/pro-payments.js');
const Mail = require('../lib/pro-mail.js');
const site = require('../lib/site-config.js');

let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const logged = [];
['log', 'warn', 'error', 'info'].forEach((k) => { console[k] = function () { logged.push(Array.prototype.slice.call(arguments).join(' ')); }; });

const SECRET_BYTES = crypto.randomBytes(24);
const SECRET = 'whsec_' + SECRET_BYTES.toString('base64');   // a standard secret
const NOW = 1_800_000_000_000;                                  // a fixed clock (ms)
const ts = (offset) => String(Math.floor(NOW / 1000) + (offset || 0));
const sign = (id, stamp, body, key) => 'v1,' + crypto.createHmac('sha256', key || SECRET_BYTES).update(id + '.' + stamp + '.' + body).digest('base64');
function signed(body, o) {
  o = o || {};
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const id = o.id || 'msg_' + crypto.randomBytes(6).toString('hex'), stamp = o.ts || ts(0);
  return { raw: raw, id: id, headers: { 'webhook-id': id, 'webhook-timestamp': stamp, 'webhook-signature': o.sig || sign(id, stamp, raw, o.key) } };
}
const order = (o) => ({ type: 'order.paid', timestamp: '2026-10-10T10:00:00Z', api_version: '2026-10', data: Object.assign({ id: 'ord_' + crypto.randomBytes(5).toString('hex'), status: 'paid', paid: true, billing_reason: 'purchase', checkout_id: 'co_' + crypto.randomBytes(6).toString('hex'), customer: { email: 'Buyer.Person@Example.org', name: 'Bea Buyer' } }, o || {}) });
const refunded = (ordId, status) => ({ type: 'order.refunded', timestamp: '2026-10-10T11:00:00Z', api_version: '2026-10', data: { id: ordId, status: status || 'refunded', paid: true, billing_reason: 'purchase' } });

let ipc = 0;
function call(o, deps) {
  o = o || {}; o.ip = o.ip || '10.7.' + Math.floor(ipc / 250) + '.' + (ipc++ % 250);
  return new Promise((resolve, reject) => {
    const headers = {};
    const req = Object.assign({ method: o.method || 'POST', url: '/', headers: Object.assign({ 'x-forwarded-for': o.ip }, o.headers || {}), query: o.query || {}, body: o.body, socket: {} }, o.rawBody !== undefined ? { rawBody: o.rawBody } : {});
    const res = { statusCode: 200, setHeader: (k, v) => { headers[k.toLowerCase()] = v; }, end: (b) => { let json = null; try { json = JSON.parse(b); } catch (e) { /* html */ } resolve({ status: res.statusCode, headers, body: b, json }); } };
    Promise.resolve(api.handle(req, res, deps)).catch(reject);
  });
}
const mk = () => { const adapter = S.memoryAdapter(); return { adapter, store: S.createStore(adapter) }; };
const ENV = { PRO_WEBHOOK_SECRET: SECRET };
const MAILENV = Object.assign({ RESEND_API_KEY: 'rk_test', PRO_MAIL_FROM: 'Citehound <a@mail.example.invalid>' }, ENV);
const hook = (s, deps, extra) => call(Object.assign({ method: 'POST', query: { a: 'webhook' }, headers: s.headers, rawBody: s.raw }, extra || {}), deps);
const fakeMail = () => { const sent = []; const f = async (u, o) => { sent.push({ u, body: JSON.parse(o.body) }); return { ok: true, status: 200 }; }; f.sent = sent; return f; };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const orderCount = (adapter) => Object.keys(adapter._dump()).filter((k) => /^pro:order:[a-f0-9]{32}$/.test(k)).length;

(async function main() {
  /* ---- a paid event ---- */
  {
    const { adapter, store } = mk(); const mail = fakeMail();
    const deps = { store, env: MAILENV, fetch: mail, now: NOW };
    const ev = order();
    const r = await hook(signed(ev), deps);
    t('paid: a correctly signed order.paid answers 202', r.status === 202 && r.json.ok === true, r.status + ' ' + r.body);
    t('paid: exactly one order was created, source paid, unused, 30 days, with the buyer kept for prefill', orderCount(adapter) === 1 && (await store.listOrders())[0].source === 'paid' && (await store.listOrders())[0].status === 'unused' && (await store.listOrders())[0].buyer.email === 'Buyer.Person@Example.org' && (await adapter.ttl('pro:order:' + (await store.listOrders())[0].token)) > 29 * 86400);
    const token = (await store.listOrders())[0].token;
    const welcome = await call({ query: { a: 'welcome' }, body: { checkout: ev.data.checkout_id } }, deps);
    t('welcome: the paid checkout hands the start path over', welcome.status === 200 && welcome.json.state === 'ready' && welcome.json.path === '/pro/start/' + token, welcome.body);
    const again = await call({ query: { a: 'welcome' }, body: { checkout: ev.data.checkout_id } }, deps);
    t('welcome: only once: the second ask is "taken" and carries no path', again.json.state === 'taken' && again.body.indexOf(token) === -1);
    const m = adapter._dump(); t('welcome: no key holds the checkout id in the clear', Object.keys(m).every((k) => k.indexOf(ev.data.checkout_id) === -1));
    t('email: the backup copy went to the buyer, once, with the link straight to /pro/start/<token>', mail.sent.length === 1 && mail.sent[0].body.to[0] === 'Buyer.Person@Example.org' && mail.sent[0].body.text.indexOf(site.baseUrl + '/pro/start/' + token) !== -1 && mail.sent[0].body.html.indexOf('href="' + site.baseUrl + '/pro/start/' + token + '"') !== -1 && !/utm_|track/i.test(mail.sent[0].body.html));
    const ord = await call({ query: { a: 'order' }, body: { token } }, deps);
    t('prefill: the order lookup returns the buyer\'s name and email for the form', ord.json.state === 'ready' && ord.json.prefill.name === 'Bea Buyer' && ord.json.prefill.email === 'Buyer.Person@Example.org');
    const unpaid = await call({ query: { a: 'order' }, body: { token: 'f'.repeat(32) } }, deps);
    t('prefill: an unknown link gets no prefill and the generic answer', unpaid.status === 404 && unpaid.body.indexOf('prefill') === -1);
    const stats = (await require('../lib/pro-stats.js').read(store, 1))[0].counts;
    t('stats: one paid order and one backup email counted', stats.orders_paid === 1 && stats.start_link_emails === 1);
    const used = await call({ query: { a: 'start' }, body: { token, site: 'example.com', name: 'Bea Buyer', email: 'bea@example.org', consent: true } }, { store, env: MAILENV, checkHost: async () => ({ ok: true }) });
    t('flow: the bought link starts a report like any other', used.status === 200 && /^[a-f0-9]{32}$/.test(used.json.jobId));
  }

  /* ---- signature, timestamp, secret ---- */
  {
    const { adapter, store } = mk();
    const deps = { store, env: ENV, now: NOW };
    const good = signed(order());
    const bad = [
      ['a wrong signature', Object.assign({}, good, { headers: Object.assign({}, good.headers, { 'webhook-signature': 'v1,' + Buffer.from('nope').toString('base64') }) })],
      ['no signature header', { raw: good.raw, headers: { 'webhook-id': good.id, 'webhook-timestamp': good.headers['webhook-timestamp'] } }],
      ['no headers at all (an unsigned event)', { raw: good.raw, headers: {} }],
      ['a body changed after signing', { raw: good.raw.replace('Bea Buyer', 'Eve Mallory'), headers: good.headers }],
      ['the right signature on another message id', { raw: good.raw, headers: Object.assign({}, good.headers, { 'webhook-id': 'msg_other' }) }],
      ['the wrong secret', signed(order(), { key: crypto.randomBytes(24) })],
      ['a timestamp from ten minutes ago (a replay of a captured event)', signed(order(), { ts: ts(-600) })],
      ['a timestamp ten minutes ahead', signed(order(), { ts: ts(600) })],
      ['a timestamp that is not a number', signed(order(), { ts: 'yesterday' })],
      ['a signature without the v1 prefix', signed(order(), { sig: crypto.createHmac('sha256', SECRET_BYTES).update('x').digest('base64') })]
    ];
    for (const [why, s] of bad) { const r = await hook(s, deps); t('signature: ' + why + ' is refused (403) and changes nothing', r.status === 403 && orderCount(adapter) === 0, r.status + ' ' + r.body); }
    t('signature: refusals are counted as numbers only', (await require('../lib/pro-stats.js').read(store, 1))[0].counts.webhook_rejected === bad.length);
    const rotated = signed(order(), { sig: 'v1,' + Buffer.from('old').toString('base64') + ' ' + sign('id_x', ts(0), 'x') });
    const rot = signed(order(), { id: 'msg_rot' });
    const withTwo = { raw: rot.raw, headers: Object.assign({}, rot.headers, { 'webhook-signature': 'v1,' + Buffer.from('stale-signature').toString('base64') + ' ' + rot.headers['webhook-signature'] }) };
    t('signature: with two signatures in the header (key rotation) it is enough that one is right', (await hook(withTwo, deps)).status === 202 && orderCount(adapter) === 1);
    const legacySecret = 'whsec_legacy-secret-not-base64-0123456789';
    const legacy = signed(order(), { id: 'msg_legacy', key: Buffer.from(legacySecret, 'utf8') });
    const lr = await hook(legacy, { store, env: { PRO_WEBHOOK_SECRET: legacySecret }, now: NOW });
    t('signature: a secret made before 8 Sep 2026 (the whole whsec_ text is the key) verifies too', lr.status === 202 && orderCount(adapter) === 2);
    const upper = signed(order(), { id: 'msg_hdr' }); const hdr = {}; Object.keys(upper.headers).forEach((k) => { hdr[k.toUpperCase()] = upper.headers[k]; });
    t('signature: header names are matched without regard to case', (await hook({ raw: upper.raw, headers: hdr }, deps)).status === 202);
    const none = mk();
    const nr = await hook(signed(order()), { store: none.store, env: {}, now: NOW });
    t('fail closed: without PRO_WEBHOOK_SECRET the endpoint answers 503 and creates nothing', nr.status === 503 && orderCount(none.adapter) === 0);
    const short = await hook(signed(order()), { store: none.store, env: { PRO_WEBHOOK_SECRET: 'short' }, now: NOW });
    t('fail closed: a secret under 16 characters is no secret', short.status === 503);
    const bj = signed('{not json');
    t('a signed body that is not JSON is a 400', (await hook(bj, deps)).status === 400);
    const get = await call({ method: 'GET', query: { a: 'webhook' } }, deps);
    t('a GET on the webhook is refused (405)', get.status === 405);
  }

  /* ---- replay and double events ---- */
  {
    const { adapter, store } = mk(); const mail = fakeMail();
    const deps = { store, env: MAILENV, fetch: mail, now: NOW };
    const ev = order(); const s = signed(ev, { id: 'msg_same' });
    const first = await hook(s, deps), replay = await hook(s, deps);
    t('replay: the same signed event twice (same message id): the second answers 202 "duplicate" and does nothing', first.status === 202 && replay.status === 202 && replay.json.duplicate === true && orderCount(adapter) === 1 && mail.sent.length === 1);
    const other = signed(ev, { id: 'msg_other_delivery' });
    const dbl = await hook(other, deps);
    t('double event: the same provider order under a new message id still makes one order, one email', dbl.status === 202 && orderCount(adapter) === 1 && mail.sent.length === 1);
    const ignored = [];
    for (const e of [{ type: 'checkout.created', timestamp: 'x', api_version: 'x', data: { id: 'c' } }, order({ billing_reason: 'subscription_cycle' }), order({ status: 'pending', paid: false }), { type: 'order.refunded', data: { id: 'ord_x', status: 'paid' } }, { nothing: true }]) ignored.push((await hook(signed(e), deps)).json);
    t('... each answers 202 {ignored} and no order appears for them', ignored.every((j) => j.ok && j.ignored) && orderCount(adapter) === 1, JSON.stringify(ignored));
  }

  /* ---- refunds ---- */
  {
    const { adapter, store } = mk();
    const deps = { store, env: ENV, now: NOW };
    const ev = order(); await hook(signed(ev), deps);
    const token = (await store.listOrders())[0].token;
    const r = await hook(signed(refunded(ev.data.id)), deps);
    const page = await call({ method: 'GET', query: { a: 'startpage', token } }, deps), unknown = await call({ method: 'GET', query: { a: 'startpage', token: 'c'.repeat(32) } }, deps);
    const w = await call({ query: { a: 'welcome' }, body: { checkout: ev.data.checkout_id } }, deps);
    t('refund before use: the link is cancelled: its start page is the generic 404, the lookup says unavailable, it cannot start a report', r.status === 202 && (await store.getOrder(token)).status === 'refunded' && page.status === 404 && page.body === unknown.body && (await call({ query: { a: 'order' }, body: { token } }, deps)).status === 404 && (await call({ query: { a: 'start' }, body: { token, site: 'example.com', name: 'x', email: 'a@example.org', consent: true } }, { store, env: ENV, checkHost: async () => ({ ok: true }) })).status !== 200);
    t('refund before use: the welcome page no longer hands the link out', w.json.state === 'gone' && w.body.indexOf(token) === -1);
    t('refund before use: counted, and a repeat of the refund changes nothing', (await hook(signed(refunded(ev.data.id)), deps)).status === 202 && (await require('../lib/pro-stats.js').read(store, 1))[0].counts.payments_refunded === 1);
    const e2 = order(); await hook(signed(e2), deps);
    const tok2 = (await store.listOrders()).filter((o) => o.status === 'unused')[0].token;
    const used = await call({ query: { a: 'start' }, body: { token: tok2, site: 'example.com', name: 'Bea', email: 'bea@example.org', consent: true } }, { store, env: ENV, checkHost: async () => ({ ok: true }) });
    const rr = await hook(signed(refunded(e2.data.id)), deps);
    const after = await store.getOrder(tok2);
    t('refund after use: nothing changes: the order stays used, the report stays', rr.status === 202 && after.status === 'used' && after.jobId === used.json.jobId && (await store.getJob(used.json.jobId)) !== null && (await call({ method: 'GET', query: { a: 'report', id: used.json.jobId } }, deps)).status !== 404);
    const e3 = order(); await hook(signed(e3), deps);
    const t3 = (await store.listOrders()).filter((o) => o.status === 'unused')[0].token;
    await hook(signed({ type: 'refund.created', data: { id: 'ref_1', status: 'succeeded', order_id: e3.data.id, amount: 500 } }), deps);
    const o3 = await store.getOrder(t3);
    t('refund event: a succeeded refund.created carries the refund amount but not the order total, so it only flags the order: the link stays valid', o3.status === 'unused' && o3.review === 'refund_reported');
    const e4 = order(); await hook(signed(e4), deps);
    await hook(signed({ type: 'refund.created', data: { id: 'ref_2', status: 'pending', order_id: e4.data.id } }), deps);
    const t4 = (await store.listOrders()).filter((o) => o.status === 'unused' && !o.review)[0];
    t('refund event: a pending refund changes and flags nothing', !!t4);
    t('refund of an order we never made is acknowledged and changes nothing', (await hook(signed(refunded('ord_never_seen')), deps)).status === 202 && (await hook(signed(refunded('ord_never_seen', 'partially_refunded')), deps)).status === 202);
    const partial = order(); await hook(signed(partial), deps);
    const tp = (await store.listOrders()).filter((o) => o.status === 'unused' && !o.review && o.token !== t4.token)[0].token;
    const pr = await hook(signed(refunded(partial.data.id, 'partially_refunded')), deps);
    const op = await store.getOrder(tp);
    t('partial refund of an unused link: the link stays valid (its start page opens) and the order is flagged "partial_refund" for review', pr.status === 202 && op.status === 'unused' && op.review === 'partial_refund' && (await call({ method: 'GET', query: { a: 'startpage', token: tp } }, deps)).status === 200);
    t('... it is counted as a review item, not as a cancellation', (await require('../lib/pro-stats.js').read(store, 1))[0].counts.payments_review >= 2);
    const wp = await call({ query: { a: 'welcome' }, body: { checkout: partial.data.checkout_id } }, deps);
    t('... and the welcome page still hands the link out once', wp.json.state === 'ready');
    await hook(signed(refunded(partial.data.id, 'refunded'), { id: 'msg_full_after_partial' }), deps);
    t('a later full refund of the same order does cancel it, and the review flag stays for the owner to clear', (await store.getOrder(tp)).status === 'refunded');
    await store.clearReview(tp);
    t('clearing the review flag removes it', (await store.getOrder(tp)).review === '');
    const fu = await store.getOrder(tok2);
    t('a full refund after use flags the used order "refund_after_use" and changes nothing else', fu.status === 'used' && fu.review === 'refund_after_use');
  }

  /* ---- the welcome page ---- */
  {
    const { adapter, store } = mk();
    const deps = { store, env: ENV, now: NOW };
    const before = await call({ query: { a: 'welcome' }, body: { checkout: 'co_not_paid_yet_1' } }, deps);
    t('welcome: before the webhook has arrived the answer is "waiting", the same as for an id that does not exist', before.json.state === 'waiting' && (await call({ query: { a: 'welcome' }, body: { checkout: 'x' } }, deps)).json.state === 'waiting' && (await call({ query: { a: 'welcome' }, body: {} }, deps)).json.state === 'waiting');
    const ev = order({ checkout_id: 'co_late_webhook_1' });
    const w1 = await call({ query: { a: 'welcome' }, body: { checkout: 'co_late_webhook_1' } }, deps);
    await hook(signed(ev), deps);
    const w2 = await call({ query: { a: 'welcome' }, body: { checkout: 'co_late_webhook_1' } }, deps);
    t('welcome: it polls through a webhook that arrives after the buyer: waiting, then ready', w1.json.state === 'waiting' && w2.json.state === 'ready');
    t('welcome: the mapping carries a short TTL', (await adapter.ttl('pro:checkout:' + sha('co_other'))) === -2 && Pay.CHECKOUT_WINDOW === 1800);
    await hook(signed(order({ checkout_id: 'co_ttl_check_0001' })), deps);
    const ttl = await adapter.ttl('pro:checkout:' + sha('co_ttl_check_0001'));
    t('welcome: the stored mapping lives 30 minutes', ttl > 1700 && ttl <= 1800, String(ttl));
    const queryAddr = await call({ method: 'GET', query: { a: 'welcome', checkout: 'co_ttl_check_0001' } }, deps);
    t('welcome: the lookup is a POST only (a GET with the id in an address is refused)', queryAddr.status === 405);
    const page = await call({ method: 'GET', query: { a: 'welcomepage' } }, deps);
    t('welcome page: 200, noindex, no referrer, no-store, no token, a script, a way out without JavaScript', page.status === 200 && /noindex/.test(page.headers['x-robots-tag']) && page.headers['referrer-policy'] === 'no-referrer' && /no-store/.test(page.headers['cache-control']) && /Payment received/.test(page.body) && /pro-welcome\.js/.test(page.body) && /<noscript>/.test(page.body) && !/[a-f0-9]{32}/.test(page.body));
    let lim = 0; for (let i = 0; i < 125; i++) lim = (await call({ query: { a: 'welcome' }, body: { checkout: 'co_ratelimit_001' }, ip: '198.51.100.44' }, deps)).status;
    t('welcome: rate limited per hashed address', lim === 429);
  }

  /* ---- the backup email ---- */
  {
    const { store } = mk();
    const quiet = fakeMail();
    await hook(signed(order()), { store, env: ENV, fetch: quiet, now: NOW });
    t('email: without Resend configured it is skipped silently and the order is still made', quiet.sent.length === 0 && (await store.listOrders()).length === 1);
    const failing = async () => ({ ok: false, status: 500 });
    const r = await hook(signed(order()), { store, env: MAILENV, fetch: failing, now: NOW });
    t('email: a provider failure does not fail the webhook', r.status === 202 && (await store.listOrders()).length === 2);
    const throwing = async () => { throw new Error('down'); };
    t('email: an unreachable provider does not either', (await hook(signed(order()), { store, env: MAILENV, fetch: throwing, now: NOW })).status === 202);
    const noEmail = fakeMail();
    await hook(signed(order({ customer: { email: null, name: null } })), { store, env: MAILENV, fetch: noEmail, now: NOW });
    t('email: an order with no buyer address sends nothing', noEmail.sent.length === 0);
    const hostile = fakeMail();
    await hook(signed(order({ customer: { email: 'x@example.org', name: '<script>alert(1)</script> Eve' } })), { store, env: MAILENV, fetch: hostile, now: NOW });
    t('email: a hostile name cannot inject HTML', hostile.sent.length === 1 && hostile.sent[0].body.html.indexOf('<script>') === -1);
  }

  /* ---- raw body handling ---- */
  {
    const { store } = mk();
    const deps = { store, env: ENV, now: NOW };
    const s = signed(order());
    // a stream, as on Vercel (req.body is a lazy getter that must not be touched)
    const req = new EventEmitter(); req.method = 'POST'; req.url = '/'; req.query = { a: 'webhook' }; req.headers = Object.assign({ 'x-forwarded-for': '10.1.1.1' }, s.headers); req.socket = {};
    let touched = false; Object.defineProperty(req, 'body', { configurable: true, get() { touched = true; return {}; } });
    const res = { statusCode: 200, setHeader() {}, end(b) { res.b = b; } };
    const p = api.handle(req, res, deps);
    setImmediate(() => { req.emit('data', Buffer.from(s.raw.slice(0, 20))); req.emit('data', Buffer.from(s.raw.slice(20))); req.emit('end'); });
    await p;
    t('raw body: read from the stream, in pieces, without touching the lazy req.body getter, and it verifies', res.statusCode === 202 && touched === false, res.statusCode + ' ' + res.b);
    const parsed = { method: 'POST', query: { a: 'webhook' }, headers: Object.assign({ 'x-forwarded-for': '10.1.1.2' }, signed(order(), { id: 'msg_parsed' }).headers), body: Buffer.from('x') , socket: {} };
    const big = await H.readRaw({ rawBody: 'x'.repeat(300000) }, 262144);
    t('raw body: more than 256 KB is refused', big.ok === false && big.reason === 'too_large');
    const objBody = await H.readRaw(Object.defineProperty({}, 'body', { value: { a: 1 } }), 1000);
    t('raw body: a body the platform already parsed is re-serialized as a last resort and says so', objBody.ok && objBody.raw === '{"a":1}' && objBody.reserialized === true);
  }

  /* ---- adapters ---- */
  {
    const { adapter, store } = mk();
    const r = await hook(signed(order()), { store, env: Object.assign({ PRO_PAYMENT_PROVIDER: 'paddle' }, ENV), now: NOW });
    t('paddle: the stub refuses every event (403) and creates nothing', r.status === 403 && orderCount(adapter) === 0 && Pay.paddle.parse({}) === null);
    const unknown = await hook(signed(order()), { store, env: Object.assign({ PRO_PAYMENT_PROVIDER: 'nobody' }, ENV), now: NOW });
    t('an unknown provider name fails closed (503)', unknown.status === 503);
    t('the default provider is polar', Pay.adapterFor({}).name === 'polar');
  }

  /* ---- logs ---- */
  {
    const joined = logged.join('\n');
    t('logs: no token, no checkout id, no address, no name, no secret', !/[a-f0-9]{32}|co_[a-f0-9]{12}|Buyer\.Person|Bea Buyer|whsec_|Mallory|rk_test/.test(joined), joined.slice(0, 200));
  }

  out('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
}()).catch((e) => { process.stderr.write('The test stopped: ' + (e && e.stack) + '\n'); process.exit(1); });
