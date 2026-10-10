#!/usr/bin/env node
/* =====================================================================
   scripts/test-pro-security.js: the public Pro endpoints as an outsider would try them: waitlist, removal, feedback, order, start, step,
   status, email, welcome and the payment webhook (plus the report and start pages).

   For every JSON POST: a foreign Origin is refused (403), a content type other than application/json is refused (415), a declared length over
   16 KB is refused (413) and a body object bigger than the endpoint's cap is refused. Unknown, expired, revoked and used things give the same
   answer where they must (no enumeration of tokens, job ids, checkouts or addresses). No endpoint sets an Access-Control header. Every response
   carries no-store, noindex, no-referrer and nosniff. A storage failure gives a generic 500 with nothing inside it. Every action has a rate limit;
   the webhook slows down a caller that keeps failing the signature check but never one that sends valid events; and replays do nothing.

     node scripts/test-pro-security.js
   ===================================================================== */

'use strict';

process.env.PRO_HASH_SECRET = 'test-only-secret-0123456789abcdef';
const crypto = require('crypto');
const S = require('../lib/pro-store.js');
const api = require('../lib/pro-api.js');
const Waitlist = require('../lib/waitlist.js');
const site = require('../lib/site-config.js');

let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const logged = [];
['log', 'warn', 'error', 'info'].forEach((k) => { console[k] = function () { logged.push(Array.prototype.slice.call(arguments).join(' ')); }; });

let ipc = 0;
function call(o, deps) {
  o = o || {};
  const ip = o.ip || '10.20.' + Math.floor(ipc / 250) + '.' + (ipc++ % 250);
  return new Promise((resolve, reject) => {
    const headers = {};
    const req = Object.assign({ method: o.method || 'POST', url: '/', headers: Object.assign({ 'x-forwarded-for': ip, 'content-type': 'application/json' }, o.headers || {}), query: o.query || {}, body: o.body, socket: {} }, o.rawBody !== undefined ? { rawBody: o.rawBody } : {});
    const res = { statusCode: 200, setHeader: (k, v) => { headers[k.toLowerCase()] = v; }, end: (b) => { let json = null; try { json = JSON.parse(b); } catch (e) { /* html */ } resolve({ status: res.statusCode, headers, body: b, json }); } };
    Promise.resolve(api.handle(req, res, deps)).catch(reject);
  });
}
const mk = () => { const adapter = S.memoryAdapter(); return { adapter, store: S.createStore(adapter) }; };

// Every JSON POST action with a plausible body.
const JSON_POSTS = [
  ['waitlist', { email: 'a@example.org', consent: true }],
  ['feedback', { id: 'a'.repeat(32), rating: 5 }],
  ['order', { token: 'b'.repeat(32) }],
  ['start', { token: 'b'.repeat(32), site: 'example.com', name: 'A', email: 'a@example.org', consent: true }],
  ['step', { id: 'a'.repeat(32) }],
  ['email', { id: 'a'.repeat(32) }],
  ['welcome', { checkout: 'chk_0123456789' }]
];

(async function main() {
  const { store, adapter } = mk();
  const deps = { store, env: {} };

  /* ---- origin, content type, size ---- */
  for (const [a, body] of JSON_POSTS) {
    const foreign = await call({ query: { a }, body, headers: { origin: 'https://evil.example' } }, deps);
    const form = await call({ query: { a }, body, headers: { 'content-type': 'text/plain;charset=UTF-8' } }, deps);
    const urlenc = await call({ query: { a }, body, headers: { 'content-type': 'application/x-www-form-urlencoded' } }, deps);
    const nocontent = await call({ query: { a }, body, headers: { 'content-type': '' } }, deps);
    const huge = await call({ query: { a }, body, headers: { 'content-length': '5000000' } }, deps);
    t(a + ': a POST from another origin is refused (403) before anything is read', foreign.status === 403 && foreign.json.error === 'forbidden');
    t(a + ': text/plain, a form type or no content type is refused (415): no "simple request" can reach it', form.status === 415 && urlenc.status === 415 && nocontent.status === 415);
    t(a + ': a declared length over 16 KB is refused (413)', huge.status === 413);
    const ok = await call({ query: { a }, body, headers: { origin: site.baseUrl, 'content-type': 'application/json; charset=utf-8' } }, deps);
    t(a + ': this site\'s own origin with application/json (and a charset) passes the guard', [403, 413, 415].indexOf(ok.status) === -1, String(ok.status));
  }
  {
    const big = { email: 'a@example.org', consent: true, name: 'x'.repeat(3000) };
    const r = await call({ query: { a: 'waitlist' }, body: big }, deps);
    t('waitlist: a body object over its 2 KB cap is refused even when the platform has already parsed it', r.status === 400 && r.json.error === 'bad_request');
    const fb = await call({ query: { a: 'feedback' }, body: { id: 'a'.repeat(32), rating: 5, text: 'y'.repeat(6000) } }, deps);
    t('feedback: a parsed body over its 4 KB cap is refused', fb.status === 400);
    const wl = await call({ query: { a: 'welcome' }, body: { checkout: 'c'.repeat(5000) } }, deps);
    t('welcome: an oversized body is refused or answered "waiting", never stored', wl.status === 400 || (wl.json && wl.json.state === 'waiting'));
    const st = await call({ query: { a: 'start' }, body: { token: 'b'.repeat(32), site: 'x'.repeat(9000) } }, deps);
    t('start: an oversized body is refused (400) before the token is looked at', st.status === 400);
    const arr = await call({ query: { a: 'waitlist' }, body: [1, 2, 3] }, deps);
    t('waitlist: a JSON array instead of an object is refused', arr.status === 400);
  }
  {
    // The removal form and the webhook are the two POSTs that do not take JSON.
    const tok = Waitlist.tokenFor('x@example.org');
    const form = await call({ query: { a: 'waitremove', token: tok }, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' }, deps);
    t('removal: the form post and a mail client\'s one-click POST (urlencoded, no Origin) still work', form.status === 200 && /removed/i.test(form.body));
    const bad = await call({ query: { a: 'waitremove', token: 'z'.repeat(64) }, headers: { 'content-type': 'application/x-www-form-urlencoded' } }, deps);
    const none = await call({ query: { a: 'waitremove', token: tok.slice(0, 63) + (tok[63] === '0' ? '1' : '0') }, headers: { 'content-type': 'application/x-www-form-urlencoded' } }, deps);
    t('removal: a token with a wrong signature is the same generic 404 whether it is nonsense or one character off', bad.status === 404 && none.status === 404 && bad.body === none.body);
    const again = await call({ query: { a: 'waitremove', token: tok }, headers: { 'content-type': 'application/x-www-form-urlencoded' } }, deps);
    t('removal: a valid token for an address that is not on the list (or already removed) gives the same page as a real removal: no enumeration', again.status === 200 && again.body === form.body);
  }

  /* ---- no enumeration ---- */
  {
    const { store: s2 } = mk();
    const live = await s2.createOrder({ label: 'a' }), expired = await s2.createOrder({ label: 'b' }), revoked = await s2.createOrder({ label: 'c' });
    await s2.revokeOrder(revoked.token);
    await s2.adapter.hset('pro:order:' + expired.token, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const d2 = { store: s2, env: {} };
    const ask = async (tok) => call({ query: { a: 'order' }, body: { token: tok } }, d2);
    const unknown = await ask('c'.repeat(32)), rev = await ask(revoked.token), exp = await ask(expired.token), junk = await ask('not-a-token');
    t('order: an unknown, revoked, expired or malformed token gives the identical answer (404, same body)', [unknown, rev, exp, junk].every((r) => r.status === 404 && r.body === unknown.body), JSON.stringify([unknown.body, rev.body, exp.body, junk.body]));
    const pageU = await call({ method: 'GET', query: { a: 'startpage', token: 'c'.repeat(32) } }, d2), pageR = await call({ method: 'GET', query: { a: 'startpage', token: revoked.token } }, d2), pageE = await call({ method: 'GET', query: { a: 'startpage', token: expired.token } }, d2);
    t('start page: unknown, revoked and expired links are the identical generic 404 page', pageU.status === 404 && pageR.body === pageU.body && pageE.body === pageU.body);
    const st = await call({ method: 'GET', query: { a: 'status', id: 'd'.repeat(32) } }, d2), st2 = await call({ method: 'GET', query: { a: 'status', id: 'nonsense' } }, d2), sp = await call({ query: { a: 'step' }, body: { id: 'd'.repeat(32) } }, d2);
    t('status/step: an unknown job id and a malformed one are the same 404', st.status === 404 && st2.status === 404 && st.body === st2.body && sp.status === 404 && sp.body === st.body);
    const em = await call({ query: { a: 'email' }, body: { id: 'd'.repeat(32) } }, { store: s2, env: { RESEND_API_KEY: 'rk', PRO_MAIL_FROM: 'a <a@mail.example.invalid>' } });
    const em2 = await call({ query: { a: 'email' }, body: { id: 'junk' } }, { store: s2, env: { RESEND_API_KEY: 'rk', PRO_MAIL_FROM: 'a <a@mail.example.invalid>' } });
    t('email: an unknown and a malformed job id are the same 404, and no address in the body is ever used', em.status === 404 && em2.status === 404 && em.body === em2.body);
    const f1 = await call({ query: { a: 'feedback' }, body: { id: 'e'.repeat(32), rating: 4 } }, d2), f2 = await call({ query: { a: 'feedback' }, body: { id: 'zz', rating: 4 } }, d2);
    t('feedback: an unknown and a malformed report id are the same 404', f1.status === 404 && f2.status === 404 && f1.body === f2.body);
    const w1 = await call({ query: { a: 'welcome' }, body: { checkout: 'chk_unknown_one' } }, d2), w2 = await call({ query: { a: 'welcome' }, body: { checkout: '!!' } }, d2);
    t('welcome: an unknown checkout and a malformed one both answer "waiting"', w1.json.state === 'waiting' && w2.json.state === 'waiting');
    const r1 = await call({ method: 'GET', query: { a: 'report', id: 'f'.repeat(32) } }, d2), r2 = await call({ method: 'GET', query: { a: 'report', id: 'x' } }, d2);
    t('report: an unknown and a malformed id are the same generic 404 page', r1.status === 404 && r2.status === 404 && r1.body === r2.body);
    const n1 = await call({ query: { a: 'waitlist' }, body: { email: 'new-person@example.org', consent: true } }, d2), n2 = await call({ query: { a: 'waitlist' }, body: { email: 'new-person@example.org', consent: true } }, d2);
    t('waitlist: a new address and a known one get the same words', n1.status === 200 && n1.body === n2.body && n1.body.indexOf('@') === -1);
    void live;
  }

  /* ---- headers, CORS, methods ---- */
  {
    const { store: s3 } = mk();
    const d3 = { store: s3, env: {} };
    const samples = [
      await call({ query: { a: 'waitlist' }, body: { email: 'a@example.org', consent: true } }, d3),
      await call({ query: { a: 'order' }, body: { token: 'c'.repeat(32) } }, d3),
      await call({ method: 'GET', query: { a: 'startpage', token: 'c'.repeat(32) } }, d3),
      await call({ method: 'GET', query: { a: 'report', id: 'f'.repeat(32) } }, d3),
      await call({ method: 'GET', query: { a: 'welcomepage' } }, d3),
      await call({ query: { a: 'webhook' }, rawBody: '{}', headers: {} }, d3),
      await call({ method: 'GET', query: { a: 'nonsense' } }, d3)
    ];
    t('headers: every response says no-store, noindex, no-referrer and nosniff', samples.every((r) => /no-store/.test(r.headers['cache-control'] || '') && /noindex/.test(r.headers['x-robots-tag'] || '') && r.headers['referrer-policy'] === 'no-referrer' && r.headers['x-content-type-options'] === 'nosniff'), JSON.stringify(samples.map((r) => r.status)));
    t('CORS: no Pro response carries an Access-Control header (these endpoints are for this site\'s own pages only)', samples.every((r) => !Object.keys(r.headers).some((k) => /^access-control-/.test(k))));
    const opt = await call({ method: 'OPTIONS', query: { a: 'start' } }, d3), del = await call({ method: 'DELETE', query: { a: 'waitlist' } }, d3), getPost = await call({ method: 'GET', query: { a: 'start' } }, d3);
    t('methods: OPTIONS, DELETE and a GET on a POST action are 405 with Allow, no CORS preflight answer', opt.status === 405 && del.status === 405 && getPost.status === 405 && opt.headers.allow === 'POST' && !opt.headers['access-control-allow-origin']);
    const unknownAction = samples[samples.length - 1];
    t('an unknown action is the generic 404', unknownAction.status === 404 && /not available/.test(unknownAction.body));
  }

  /* ---- errors say nothing ---- */
  {
    const bad = { adapter: null, store: { adapter: null, hit: async () => { throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.9:6379 password=hunter2'), { name: 'FetchError', code: 'ECONNREFUSED' }); } } };
    const r = await call({ query: { a: 'order' }, body: { token: 'c'.repeat(32) } }, { store: bad.store });
    t('a storage failure gives a generic 500 with no message from the error, no address, no secret, no stack', r.status === 500 && r.json.error === 'server_error' && !/ECONNREFUSED|10\.0\.0\.9|hunter2|at \w+ \(|\.js:\d+/.test(r.body));
    t('... and the log has the error class only, not its message', logged.some((l) => /\[pro\] order failed: FetchError ECONNREFUSED/.test(l)) && !logged.some((l) => /hunter2|10\.0\.0\.9/.test(l)));
    const w = await call({ query: { a: 'webhook' }, rawBody: 'x'.repeat(300000), headers: {} }, { store: mk().store, env: { PRO_WEBHOOK_SECRET: 'whsec_' + 'a'.repeat(30) } });
    t('webhook: a body over 256 KB is refused (413) before it is parsed or verified', w.status === 413);
  }

  /* ---- rate limits ---- */
  {
    const actions = ['start', 'order', 'step', 'status', 'report', 'email', 'waitlist', 'waitlistjoin', 'waitremove', 'feedback', 'welcome', 'webhookbad'];
    t('every public action has a rate limit with a number and a window', actions.every((a) => api.LIMITS[a] && api.LIMITS[a].max > 0 && api.LIMITS[a].window > 0), actions.filter((a) => !api.LIMITS[a]).join(','));
    t('the strict limits are tight: 6 signups, 10 starts, 10 emails, 10 feedback posts an hour', api.LIMITS.waitlistjoin.max === 6 && api.LIMITS.start.max === 10 && api.LIMITS.email.max === 10 && api.LIMITS.feedback.max === 10);
    const { store: s4 } = mk();
    const d4 = { store: s4, env: {} };
    const ip = '203.0.113.201';
    let code = 0; for (let i = 0; i < 61; i++) code = (await call({ query: { a: 'order' }, ip, body: { token: 'c'.repeat(32) } }, d4)).status;
    const other = await call({ query: { a: 'order' }, ip: '203.0.113.202', body: { token: 'c'.repeat(32) } }, d4);
    t('order: the 61st request in an hour from one caller is a 429 and another caller is not affected', code === 429 && other.status === 404);
  }

  /* ---- the webhook: throttling the failing, never the valid; replays ---- */
  {
    const SECRET = 'whsec_' + Buffer.from('a-test-secret-of-32-bytes-long!!!').toString('base64');
    const ENV = { PRO_WEBHOOK_SECRET: SECRET };
    const key = Buffer.from(SECRET.slice(6), 'base64');
    const sign = (id, ts, raw) => 'v1,' + crypto.createHmac('sha256', key).update(id + '.' + ts + '.' + raw).digest('base64');
    const { store: s5 } = mk();
    const d5 = { store: s5, env: ENV };
    const ip = '198.51.100.77';
    const stamp = String(Math.floor(Date.now() / 1000));
    let codes = []; for (let i = 0; i < 62; i++) codes.push((await call({ query: { a: 'webhook' }, ip, rawBody: '{"type":"x"}', headers: { 'webhook-id': 'msg_' + i, 'webhook-timestamp': stamp, 'webhook-signature': 'v1,AAAA' } }, d5)).status);
    t('webhook: the first 60 badly signed requests from one caller get 403, then 429', codes.slice(0, 60).every((c) => c === 403) && codes[61] === 429, codes.slice(58, 62).join(','));
    const raw = JSON.stringify({ type: 'order.paid', data: { id: 'ord_security_1', status: 'paid', paid: true, billing_reason: 'purchase', customer: {} } });
    const sig = sign('msg_valid_1', stamp, raw);
    const valid = await call({ query: { a: 'webhook' }, ip, rawBody: raw, headers: { 'webhook-id': 'msg_valid_1', 'webhook-timestamp': stamp, 'webhook-signature': sig } }, d5);
    t('webhook: a correctly signed event from the same throttled caller is still processed (202): only failures are slowed down', valid.status === 202 && valid.json.ok === true && (await s5.listOrders()).length === 1);
    const replay = await call({ query: { a: 'webhook' }, ip: '198.51.100.78', rawBody: raw, headers: { 'webhook-id': 'msg_valid_1', 'webhook-timestamp': stamp, 'webhook-signature': sig } }, d5);
    t('webhook: the same signed delivery again is acknowledged as a duplicate and creates nothing', replay.status === 202 && replay.json.duplicate === true && (await s5.listOrders()).length === 1);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const stale = await call({ query: { a: 'webhook' }, ip: '198.51.100.79', rawBody: raw, headers: { 'webhook-id': 'msg_old_1', 'webhook-timestamp': old, 'webhook-signature': sign('msg_old_1', old, raw) } }, d5);
    t('webhook: a correctly signed event an hour old is refused (replay window 5 minutes)', stale.status === 403);
    const none = await call({ query: { a: 'webhook' }, ip: '198.51.100.80', rawBody: raw, headers: {} }, { store: s5, env: {} });
    t('webhook: with no secret configured it answers 503 and creates nothing', none.status === 503 && (await s5.listOrders()).length === 1);
  }

  /* ---- nothing personal in the logs ---- */
  {
    const joined = logged.join('\n');
    t('logs: no address, token, id, checkout or secret reached a log', !/@example\.org|b{32}|a{32}|chk_0123|test-only-secret|whsec_/.test(joined), joined.slice(0, 200));
  }

  out('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
}()).catch((e) => { process.stderr.write('The test stopped: ' + (e && e.stack) + '\n'); process.exit(1); });
