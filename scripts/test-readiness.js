#!/usr/bin/env node
/* =====================================================================
   scripts/test-readiness.js

   The State of AI Readiness report (lib/readiness.js, lib/readiness-api.js, lib/readiness-mail.js) through the real handler (lib/pro-api.js handle)
   with the in-memory store, a stand-in PDF and a fake mail provider: the form and its validation, that no answer says whether an address was already
   known, the honeypot, every limit (six accepted signups an hour per network, a flood guard, three report emails a day per address, the daily cap),
   a missing or failing mail provider, the signed download link (valid, expired, forged, revoked by a removal, off, corrupted), the PDF coming only
   from the database and from no public path, the removal link (a page first, a POST to delete, the mail client's one-click POST, the separate
   Pro waitlist untouched), the pro-admin commands (upload, info, switch, export, remove, delete), the counters, that nothing logs an address or a
   token, the email itself, and that /privacy and the form say what the code does.

     node scripts/test-readiness.js
   ===================================================================== */

'use strict';

process.env.PRO_HASH_SECRET = 'test-only-secret-0123456789abcdef';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const S = require('../lib/pro-store.js');
const api = require('../lib/pro-api.js');
const R = require('../lib/readiness.js');
const RMail = require('../lib/readiness-mail.js');
const RApi = require('../lib/readiness-api.js');
const Waitlist = require('../lib/waitlist.js');
const Stats = require('../lib/pro-stats.js');
const Admin = require('./pro-admin.js');
const site = require('../lib/site-config.js');
const F = require('./fixtures/readiness-fixtures.js');
const content = require('../content/readiness.json');
const ROOT = path.resolve(__dirname, '..');

let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

const logged = [];
['log', 'warn', 'error', 'info'].forEach((k) => { console[k] = function () { logged.push(Array.prototype.slice.call(arguments).join(' ')); }; });

let ipCounter = 0;
function call(o, deps) {
  o = o || {};
  if (!o.ip) o.ip = '10.' + Math.floor(ipCounter / 250) + '.' + (ipCounter++ % 250) + '.1';
  return new Promise((resolve, reject) => {
    const headers = {};
    const req = { method: o.method || 'GET', url: '/', headers: Object.assign({ 'x-forwarded-for': o.ip, 'content-type': 'application/json' }, o.headers || {}), query: o.query || {}, body: o.body, socket: {} };
    const res = { statusCode: 200, setHeader: (k, v) => { headers[k.toLowerCase()] = v; }, end: (b) => { let json = null; try { json = JSON.parse(b); } catch (e) { /* html or a file */ } resolve({ status: res.statusCode, headers, body: b, json }); } };
    Promise.resolve(api.handle(req, res, deps)).catch(reject);
  });
}
const mk = () => { const adapter = S.memoryAdapter(); return { adapter, store: S.createStore(adapter) }; };
const MAIL_ENV = { RESEND_API_KEY: 'rk_test_not_real', PRO_MAIL_FROM: 'Citehound <reports@mail.example.invalid>' };
function fakeResend(opts) {
  opts = opts || {};
  const sent = [];
  const fn = async (url, o) => { sent.push({ url, headers: o.headers, body: JSON.parse(o.body) }); return opts.fail ? { ok: false, status: 500 } : { ok: true, status: 200 }; };
  fn.sent = sent;
  return fn;
}
const NOW = Date.UTC(2026, 9, 12, 9, 0, 0);
const DAY = 86400000;
const signup = (extra, ip) => ({ method: 'POST', query: { a: 'readiness' }, ip: ip, body: Object.assign({ email: 'Reader@Example.org', sendReport: true, updates: false }, extra || {}) });
const idOf = (e) => R.idOf(e);
const dlPath = (text) => (/\/readiness\/download\/([0-9a-f]{72})/.exec(text) || [])[1];
const rmPath = (text) => (/\/readiness\/remove\/([0-9a-f]{64})/.exec(text) || [])[1];
const dl = (token, deps, o) => call(Object.assign({ query: { a: 'readinessget', token: token } }, o || {}), deps);

(async function main() {
  /* ---- the switch: nothing is open without a PDF ---- */
  {
    const { adapter, store } = mk();
    const deps = { store, env: MAIL_ENV, fetch: fakeResend(), now: NOW };
    const g0 = await call({ query: { a: 'readiness' } }, deps);
    t('without a PDF the form is told the report is not available (and may cache that for a minute)', g0.status === 200 && g0.json.available === false && /max-age=60/.test(g0.headers['cache-control']));
    const p0 = await call(signup(), deps);
    t('without a PDF a signup is refused with 503 and nothing is stored or sent', p0.status === 503 && (await R.list(adapter)).length === 0 && deps.fetch.sent.length === 0, p0.body);
    await R.putPdf(adapter, F.fakePdf(), F.NAME);
    const g1 = await call({ query: { a: 'readiness' } }, deps);
    t('with a PDF stored the report is available', g1.json.available === true);
    await R.setOff(adapter, true);
    const g2 = await call({ query: { a: 'readiness' } }, deps);
    const p2 = await call(signup(), deps);
    t('switched off: not available, and a signup is refused', g2.json.available === false && p2.status === 503 && (await R.list(adapter)).length === 0);
    await R.setOff(adapter, false);
    t('switched back on: available again', (await call({ query: { a: 'readiness' } }, deps)).json.available === true);
  }

  /* ---- a signup ---- */
  {
    const { adapter, store } = mk();
    await R.putPdf(adapter, F.fakePdf(), F.NAME);
    const resend = fakeResend();
    const deps = { store, env: MAIL_ENV, fetch: resend, now: NOW };
    const r1 = await call(signup(), deps);
    t('signup: 200 with the one message', r1.status === 200 && r1.json.ok === true && r1.json.message === RApi.SENT, r1.body);
    const id = idOf('reader@example.org');
    const h = await adapter.hgetall('sr:e:' + id);
    t('stored under a keyed hash of the normalized address: email, time, consent version, updates "0"', !!h && h.email === 'reader@example.org' && /^\d{4}-\d\d-\d\dT/.test(h.createdAt) && h.consentVersion === R.CONSENT_VERSION && h.updates === '0', JSON.stringify(h));
    t('the record lives 12 months', Math.abs((await adapter.ttl('sr:e:' + id)) - R.KEEP_SECONDS) < 5 && R.KEEP_SECONDS === 365 * 86400);
    t('the id is not the waitlist id for the same address (the two lists cannot be joined)', id !== Waitlist.idOf('reader@example.org') && /^[0-9a-f]{32}$/.test(id));
    t('one email was sent, to the normalized address, with a reply-to and a Resend idempotency key', resend.sent.length === 1 && resend.sent[0].body.to[0] === 'reader@example.org' && resend.sent[0].body.reply_to === site.contactEmail && /^readiness-/.test(resend.sent[0].headers['Idempotency-Key']));
    const m = resend.sent[0].body;
    const tok = dlPath(m.text);
    t('the email carries a 72-character signed link, in the text and the html', !!tok && dlPath(m.html) === tok);
    t('the link token holds the record id and an expiry, never the address', tok.slice(0, 32) === id && !m.text.match(/readiness\/(download|remove)\/[^\s]*(reader|example)/i) && !/reader/i.test(tok));
    t('the link expires in 30 days', R.LINK_SECONDS === 30 * 86400 && parseInt(tok.slice(32, 40), 16) * 1000 === NOW + 30 * DAY - (NOW % 1000));
    t('the headers carry List-Unsubscribe and the one-click form, pointing at the removal link', m.headers['List-Unsubscribe'] === '<' + site.baseUrl + '/readiness/remove/' + rmPath(m.text) + '>' && m.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click');
    t('the removal token in the email is the signed token for this record', R.idFromRemoveToken(rmPath(m.text)) === id);
    const stats = await Stats.read(store, 1, NOW);
    t('counters: one request, one email', stats[0].counts.readiness_signups === 1 && stats[0].counts.readiness_emails === 1 && stats[0].counts.readiness_updates_optin === 0);
    t('headers: no-store, noindex, no referrer', /no-store/.test(r1.headers['cache-control']) && /noindex/.test(r1.headers['x-robots-tag']) && r1.headers['referrer-policy'] === 'no-referrer');
  }

  /* ---- the optional box ---- */
  {
    const { adapter, store } = mk();
    await R.putPdf(adapter, F.fakePdf(), F.NAME);
    const deps = { store, env: MAIL_ENV, fetch: fakeResend(), now: NOW };
    await call(signup({ email: 'a@example.org', updates: true }), deps);
    const a = await adapter.hgetall('sr:e:' + idOf('a@example.org'));
    await call(signup({ email: 'b@example.org' }), deps);
    const b = await adapter.hgetall('sr:e:' + idOf('b@example.org'));
    await call(signup({ email: 'c@example.org', updates: false }), deps);
    t('the second box: ticked is stored as 1, left out or unticked as 0', a.updates === '1' && b.updates === '0' && (await adapter.hget('sr:e:' + idOf('c@example.org'), 'updates')) === '0');
    // a later visit that ticks it opts in; a later visit that does not tick it does not opt out
    await call(signup({ email: 'b@example.org', updates: true }), deps);
    await call(signup({ email: 'a@example.org', updates: false }), deps);
    t('ticking it on a later visit opts in; not ticking it later changes nothing (the removal link is the way out)', (await adapter.hget('sr:e:' + idOf('b@example.org'), 'updates')) === '1' && (await adapter.hget('sr:e:' + idOf('a@example.org'), 'updates')) === '1');
    const stats = await Stats.read(store, 1, NOW);
    t('counter: the opt-in is counted once per new address', stats[0].counts.readiness_updates_optin === 1);
    const cols = (await R.list(adapter)).find((x) => x.email === 'a@example.org');
    t('the export shows the choice', cols && cols.updates === true);
    const mail = fakeResend();
    await call(signup({ email: 'd@example.org', updates: true }), { store, env: MAIL_ENV, fetch: mail, now: NOW });
    t('the email says so when the second box was ticked, and not otherwise', /occasional Citehound updates/.test(mail.sent[0].body.text));
    const mail2 = fakeResend();
    await call(signup({ email: 'e@example.org' }), { store, env: MAIL_ENV, fetch: mail2, now: NOW });
    t('... and says nothing about updates when it was not ticked', !/updates/.test(mail2.sent[0].body.text));
  }

  /* ---- validation ---- */
  {
    const { adapter, store } = mk();
    await R.putPdf(adapter, F.fakePdf(), F.NAME);
    const resend = fakeResend();
    const deps = { store, env: MAIL_ENV, fetch: resend, now: NOW };
    const bad = await call(signup({ email: 'not-an-address' }), deps);
    const noBox = await call(signup({ sendReport: false }), deps);
    const noBox2 = await call(signup({ sendReport: undefined }), deps);
    const strBox = await call(signup({ sendReport: 'yes' }), deps);
    const badUpd = await call(signup({ updates: 'yes' }), deps);
    t('a bad address is a 400 naming the field', bad.status === 400 && bad.json.fields && !!bad.json.fields.email);
    t('the required box missing, false or not a boolean is a 400 naming the field', [noBox, noBox2, strBox].every((r) => r.status === 400 && r.json.fields && !!r.json.fields.sendReport));
    t('the optional box with a non-boolean is a 400', badUpd.status === 400 && !!badUpd.json.fields.updates);
    t('a refused request stores and sends nothing', (await R.list(adapter)).length === 0 && resend.sent.length === 0);
    const notJson = await call({ method: 'POST', query: { a: 'readiness' }, headers: { 'content-type': 'text/plain' }, body: 'x' }, deps);
    const foreign = await call({ method: 'POST', query: { a: 'readiness' }, headers: { origin: 'https://evil.example' }, body: { email: 'x@example.org', sendReport: true } }, deps);
    const putReq = await call({ method: 'PUT', query: { a: 'readiness' }, body: {} }, deps);
    const huge = await call({ method: 'POST', query: { a: 'readiness' }, headers: { 'content-length': '999999' }, body: { email: 'x@example.org', sendReport: true } }, deps);
    t('the guards of every JSON endpoint apply: not JSON 415, a foreign origin 403, a huge declared length 413, PUT 405', notJson.status === 415 && foreign.status === 403 && huge.status === 413 && putReq.status === 405);
    const arr = await call({ method: 'POST', query: { a: 'readiness' }, body: [1, 2] }, deps);
    t('a JSON array is a 400', arr.status === 400);
  }

  /* ---- no answer says whether an address was known ---- */
  {
    const { adapter, store } = mk();
    await R.putPdf(adapter, F.fakePdf(), F.NAME);
    const resend = fakeResend();
    const deps = { store, env: MAIL_ENV, fetch: resend, now: NOW };
    const a = await call(signup(), deps);                                    // a new address
    const b = await call(signup({ email: '  READER@example.ORG ' }), deps);  // the same address, differently written
    const c = await call(signup({ email: 'someone.else@example.org' }), deps);
    const trap = await call(signup({ company_fax: 'x' }), deps);
    t('a new address, a known one (written differently) and a different one get the same status and the same words', a.status === 200 && a.body === b.body && b.body === c.body, [a.body, b.body, c.body].join(' / '));
    t('... and so does a filled honeypot', trap.status === 200 && trap.body === a.body);
    t('a known address is one record, not two', (await R.list(adapter)).filter((x) => x.email === 'reader@example.org').length === 1 && (await adapter.scard('sr:index')) === 2);
    t('a filled honeypot stores nothing and sends nothing', !(await R.list(adapter)).some((x) => x.email === 'x@example.org') && resend.sent.length === 3);
    t('a re-request within the limits sends a new email each time', resend.sent.filter((s) => s.body.to[0] === 'reader@example.org').length === 2);
    const ids = resend.sent.filter((s) => s.body.to[0] === 'reader@example.org').map((s) => s.headers['Idempotency-Key']);
    t('... under different idempotency keys, so the provider does not mistake a second request for a retry of the first', ids[0] !== ids[1], ids.join(','));
    // throttled: the answer stays the same
    const d = await call(signup(), deps); const e = await call(signup(), deps);
    t('the third request sends, the fourth the same day is silently throttled with the same answer (3 a day per address)', R.PER_ADDRESS_PER_DAY === 3 && resend.sent.filter((s) => s.body.to[0] === 'reader@example.org').length === 3 && d.body === a.body && e.body === a.body);
    const stats = await Stats.read(store, 1, NOW);
    t('counters: the throttled one is counted, and the email count matches what was sent', stats[0].counts.readiness_throttled === 1 && stats[0].counts.readiness_emails === resend.sent.length);
    // next UTC day: allowed again
    const later = await call(signup(), Object.assign({}, deps, { now: NOW + DAY }));
    t('the next UTC day the address may ask again', resend.sent.filter((s) => s.body.to[0] === 'reader@example.org').length === 4 && later.body === a.body);
  }

  /* ---- limits per network ---- */
  {
    const { adapter, store } = mk();
    await R.putPdf(adapter, F.fakePdf(), F.NAME);
    const resend = fakeResend();
    const deps = { store, env: MAIL_ENV, fetch: resend, now: NOW };
    const ip = '203.0.113.7';
    // invalid requests and honeypot fills use the flood guard, not the accepted-signups quota
    for (let i = 0; i < 12; i++) await call(signup({ email: 'bad' }, ip), deps);
    const results = [];
    for (let i = 0; i < 8; i++) results.push(await call(signup({ email: 'p' + i + '@example.org' }, ip), deps));
    t('six accepted signups an hour per network; the seventh is a 429 with Retry-After, and is not stored', api.LIMITS.readinessjoin.max === 6 && results.slice(0, 6).every((r) => r.status === 200) && results[6].status === 429 && /\d+/.test(results[6].headers['retry-after']) && !(await R.list(adapter)).some((x) => x.email === 'p6@example.org'), results.map((r) => r.status).join(','));
    t('typos did not use up the quota (twelve refused requests came first)', results.slice(0, 6).every((r) => r.status === 200));
    // the flood guard counts every POST
    const ip2 = '203.0.113.9';
    let last;
    for (let i = 0; i < api.LIMITS.readiness.max + 3; i++) last = await call(signup({ email: 'bad' }, ip2), deps);
    t('a flood of any POST is stopped at ' + api.LIMITS.readiness.max + ' an hour', last.status === 429);
    t('another network is not affected', (await call(signup({ email: 'other@example.org' }, '198.51.100.4'), deps)).status === 200);
  }

  /* ---- the daily cap, an unconfigured provider, a failing provider ---- */
  {
    const { adapter, store } = mk();
    await R.putPdf(adapter, F.fakePdf(), F.NAME);
    const resend = fakeResend();
    const env = Object.assign({}, MAIL_ENV, { READINESS_EMAIL_DAILY_CAP: '2' });
    const deps = { store, env, fetch: resend, now: NOW };
    const r = [];
    for (let i = 0; i < 4; i++) r.push(await call(signup({ email: 'cap' + i + '@example.org' }), deps));
    t('the daily cap stops emails, never signups: four accepted, two emails, the same answer', r.every((x) => x.status === 200 && x.body === r[0].body) && resend.sent.length === 2 && (await R.list(adapter)).length === 4);
    t('the cap defaults to 300 and an invalid value falls back to it', R.dailyCap({}) === 300 && R.dailyCap({ READINESS_EMAIL_DAILY_CAP: 'x' }) === 300 && R.dailyCap({ READINESS_EMAIL_DAILY_CAP: '0' }) === 0);
    const none = mk(); await R.putPdf(none.adapter, F.fakePdf(), F.NAME);
    const nm = await call(signup(), { store: none.store, env: {}, fetch: fakeResend(), now: NOW });
    t('no mail provider configured: the signup stands and the answer is the same', nm.status === 200 && nm.body === r[0].body && (await R.list(none.adapter)).length === 1);
    const fail = mk(); await R.putPdf(fail.adapter, F.fakePdf(), F.NAME);
    const bad = fakeResend({ fail: true });
    const fr = await call(signup(), { store: fail.store, env: MAIL_ENV, fetch: bad, now: NOW, sleep: async () => {} });
    t('a provider that refuses never fails the signup, and is counted as a mail failure', fr.status === 200 && fr.body === r[0].body && (await Stats.read(fail.store, 1, NOW))[0].counts.mail_failed === 1);
    for (let i = 0; i < 4; i++) await call(signup(), { store: fail.store, env: MAIL_ENV, fetch: bad, now: NOW, sleep: async () => {} });
    t('... and a refused email gives its reservation back, so the 3-a-day limit is not used up by failures (five requests, each tried twice: ten sends)', bad.sent.length === 10);
    const boom = mk(); await R.putPdf(boom.adapter, F.fakePdf(), F.NAME);
    const thrower = async () => { throw new Error('network down ' + 'reader@example.org'); };
    const tr = await call(signup(), { store: boom.store, env: MAIL_ENV, fetch: thrower, now: NOW, sleep: async () => {} });
    t('a provider that cannot be reached never fails the signup', tr.status === 200 && tr.body === r[0].body);
  }

  /* ---- Resend's rate limit: one retry ---- */
  {
    const { adapter, store } = mk(); await R.putPdf(adapter, F.fakePdf(), F.NAME);
    const waits = [];
    const seq = (codes, retryAfter) => { const sent = []; let i = 0; const fn = async (url, o) => { sent.push({ headers: o.headers }); const c = codes[Math.min(i++, codes.length - 1)]; return { ok: c === 200, status: c, headers: { get: (k) => (k === 'retry-after' && retryAfter ? String(retryAfter) : null) } }; }; fn.sent = sent; return fn; };
    const f429 = seq([429, 200]);
    const a = await call(signup(), { store, env: MAIL_ENV, fetch: f429, now: NOW, sleep: async (ms) => { waits.push(ms); } });
    t('a 429 from the provider is retried once after 1.1 s, and the email goes out (the same idempotency key on both tries)', a.status === 200 && f429.sent.length === 2 && waits.length === 1 && waits[0] === 1100 && f429.sent[0].headers['Idempotency-Key'] === f429.sent[1].headers['Idempotency-Key'] && (await Stats.read(store, 1, NOW))[0].counts.readiness_emails === 1);
    const w2 = []; const f2 = seq([429, 200], 2);
    await call(signup({ email: 'ra@example.org' }), { store, env: MAIL_ENV, fetch: f2, now: NOW, sleep: async (ms) => { w2.push(ms); } });
    t('the wait Resend names (Retry-After) is used, up to 3 s', w2[0] === 2000);
    const w3 = []; const f3 = seq([429, 200], 60);
    await call(signup({ email: 'rb@example.org' }), { store, env: MAIL_ENV, fetch: f3, now: NOW, sleep: async (ms) => { w3.push(ms); } });
    t('... and never longer than 3 s', w3[0] === 3000);
    const f5 = seq([503, 200]);
    await call(signup({ email: 'rc@example.org' }), { store, env: MAIL_ENV, fetch: f5, now: NOW, sleep: async () => {} });
    t('a 5xx is retried once too', f5.sent.length === 2);
    const f4 = seq([422, 200]); const w4 = [];
    await call(signup({ email: 'rd@example.org' }), { store, env: MAIL_ENV, fetch: f4, now: NOW, sleep: async (ms) => { w4.push(ms); } });
    t('a 4xx other than 429 (a refused message) is not retried', f4.sent.length === 1 && w4.length === 0);
    const fAll = seq([429, 429]);
    const before = (await Stats.read(store, 1, NOW))[0].counts;
    const r = await call(signup({ email: 're@example.org' }), { store, env: MAIL_ENV, fetch: fAll, now: NOW, sleep: async () => {} });
    const after = (await Stats.read(store, 1, NOW))[0].counts;
    t('two 429s in a row: the signup stands with the same answer, the reservation is given back and a mail failure is counted', r.status === 200 && fAll.sent.length === 2 && after.mail_failed === before.mail_failed + 1 && after.readiness_emails === before.readiness_emails && (await adapter.get('sr:n:' + idOf('re@example.org') + ':' + Stats.dayOf(NOW))) === '0');
    // the key is new for every send (a released reservation makes the next try reuse the day and the count; a reused key with a new link is refused by Resend)
    {
      const keys = []; const ok = async (url, o) => { keys.push(o.headers['Idempotency-Key']); return { ok: true, status: 200, headers: { get: () => null } }; };
      const bad = async (url, o) => { keys.push(o.headers['Idempotency-Key']); return { ok: false, status: 429, headers: { get: () => null } }; };
      const e = mk(); await R.putPdf(e.adapter, F.fakePdf(), F.NAME);
      await call(signup({ email: 'key@example.org' }), { store: e.store, env: MAIL_ENV, fetch: bad, now: NOW, sleep: async () => {} });   // two tries, then released
      await call(signup({ email: 'key@example.org' }), { store: e.store, env: MAIL_ENV, fetch: ok, now: NOW, sleep: async () => {} });    // the next try of the day has the same day and count
      t('after a refused send the next try of the day uses a different idempotency key (the two tries of one send share one)', keys.length === 3 && keys[0] === keys[1] && keys[2] !== keys[0] && /^readiness-[0-9a-f]{32}-\d{4}-\d\d-\d\d-1-[0-9a-f]{12}$/.test(keys[2]), keys.join(' '));
    }
    let calls = 0;
    const flaky = async () => { calls++; if (calls === 1) throw new Error('socket hang up'); return { ok: true, status: 200, headers: { get: () => null } }; };
    const fr = await call(signup({ email: 'rf@example.org' }), { store, env: MAIL_ENV, fetch: flaky, now: NOW, sleep: async () => {} });
    t('a network error is retried once as well', fr.status === 200 && calls === 2);
  }

  /* ---- the download ---- */
  {
    const { adapter, store } = mk();
    await R.putPdf(adapter, F.fakePdf('unique-marker'), F.NAME);
    const resend = fakeResend();
    const deps = { store, env: MAIL_ENV, fetch: resend, now: NOW };
    await call(signup(), deps);
    const token = dlPath(resend.sent[0].body.text);
    const ok = await dl(token, deps);
    const want = F.fakePdf('unique-marker');
    t('a valid link streams the stored PDF byte for byte, as application/pdf', ok.status === 200 && ok.headers['content-type'] === 'application/pdf' && Buffer.isBuffer(ok.body) && Buffer.compare(ok.body, want) === 0 && ok.headers['content-length'] === String(want.length));
    t('... with noindex, no referrer, no-store, nosniff and a plain file name', /noindex/.test(ok.headers['x-robots-tag']) && ok.headers['referrer-policy'] === 'no-referrer' && /no-store/.test(ok.headers['cache-control']) && ok.headers['x-content-type-options'] === 'nosniff' && ok.headers['content-disposition'] === 'inline; filename="' + F.NAME + '"');
    const head = await call({ method: 'HEAD', query: { a: 'readinessget', token: token } }, deps);
    t('a HEAD request answers 200 with the type and no body', head.status === 200 && head.headers['content-type'] === 'application/pdf' && (head.body === undefined || head.body.length === 0));
    const expired = await dl(token, Object.assign({}, deps, { now: NOW + 31 * DAY }));
    t('after 30 days the same link is a 410 that says it has expired and offers a new one', expired.status === 410 && /expired/i.test(expired.body) && /state-of-ai-readiness/.test(expired.body) && !/%PDF/.test(String(expired.body).slice(0, 8)));
    t('just inside 30 days it still works', (await dl(token, Object.assign({}, deps, { now: NOW + 30 * DAY - 5000 }))).status === 200);
    const flip = (s, i) => s.slice(0, i) + (s[i] === 'a' ? 'b' : 'a') + s.slice(i + 1);
    const forged = [flip(token, 70), flip(token, 33), flip(token, 5), token.slice(0, 71), token + 'a', token.toUpperCase().slice(0, 71) + 'Z', '', 'x'.repeat(72), '0'.repeat(72), token.slice(0, 32) + 'ffffffff' + token.slice(40)];
    const rs = await Promise.all(forged.map((x) => dl(x, deps)));
    t('a forged, truncated, extended, empty or re-timed token is the generic 404, never the PDF', rs.every((r) => r.status === 404 && /not valid/.test(r.body) && !/%PDF/.test(String(r.body).slice(0, 8))), rs.map((r) => r.status).join(','));
    const unknownId = R.downloadToken(idOf('nobody@example.org'), NOW);
    t('a genuine token for an address that is not on the list is the generic 404', (await dl(unknownId, deps)).status === 404);
    t('the PDF is never sent to a request with no token', (await call({ query: { a: 'readinessget' } }, deps)).status === 404);
    const stats = await Stats.read(store, 1, NOW);
    t('counter: downloads are counted, the successes only (the full download and the HEAD of that day; not the expired or forged ones)', stats[0].counts.readiness_downloads === 2, String(stats[0].counts.readiness_downloads));
    // off
    await R.setOff(adapter, true);
    const off = await dl(token, deps);
    t('switched off: a valid link says the report is not available (503), not the PDF', off.status === 503 && /not available/.test(off.body) && !/%PDF/.test(String(off.body).slice(0, 8)));
    await R.setOff(adapter, false);
    // corrupted
    await adapter.set('sr:pdf', Buffer.from('tampered').toString('base64'));
    const bad = await dl(token, deps);
    t('stored bytes that do not match their hash are never served (503)', bad.status === 503 && !/%PDF/.test(String(bad.body).slice(0, 8)));
    await R.removePdf(adapter);
    t('with the PDF deleted a valid link says the report is not available', (await dl(token, deps)).status === 503);
    // rate limit
    const ip = '203.0.113.50';
    const results = [];
    await R.putPdf(adapter, F.fakePdf(), F.NAME);
    for (let i = 0; i < api.LIMITS.readinessdl.max + 2; i++) results.push(await dl(token, deps, { ip: ip }));
    t('downloads are limited per network (' + api.LIMITS.readinessdl.max + ' an hour)', results[api.LIMITS.readinessdl.max - 1].status === 200 && results[api.LIMITS.readinessdl.max].status === 429);
    // the missing secret
    const saved = process.env.PRO_HASH_SECRET; delete process.env.PRO_HASH_SECRET;
    const nosecret = await dl(token, deps);
    const nosecretPost = await call(signup(), deps);
    process.env.PRO_HASH_SECRET = saved;
    t('without PRO_HASH_SECRET both the download and the signup fail closed with 503', nosecret.status === 503 && nosecretPost.status === 503 && !/%PDF/.test(String(nosecret.body).slice(0, 8)));
  }

  /* ---- removal ---- */
  {
    const { adapter, store } = mk();
    await R.putPdf(adapter, F.fakePdf(), F.NAME);
    const resend = fakeResend();
    const deps = { store, env: MAIL_ENV, fetch: resend, now: NOW };
    await call(signup(), deps);
    await call({ method: 'POST', query: { a: 'waitlist' }, body: { email: 'reader@example.org', consent: true } }, { store, env: {}, now: NOW });
    const m = resend.sent[0].body.text;
    const rt = rmPath(m), dt = dlPath(m);
    const page = await call({ query: { a: 'readinessremove', token: rt } }, deps);
    t('GET on a removal link is a page with one button and removes nothing (a mail scanner may open it)', page.status === 200 && /<form method="post" action="\/readiness\/remove\//.test(page.body) && /Remove my address/.test(page.body) && (await R.list(adapter)).length === 1);
    t('the page says what removal does', /deleted from the report list/.test(page.body) && /stop working/.test(page.body));
    const done = await call({ method: 'POST', query: { a: 'readinessremove', token: rt }, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' }, deps);
    t('a POST (the mail client\'s one-click form, no JSON, no origin) deletes the record', done.status === 200 && /has been removed/.test(done.body) && (await R.list(adapter)).length === 0 && !(await adapter.exists('sr:e:' + idOf('reader@example.org'))));
    t('the removal is counted, and removed from the index', (await Stats.read(store, 1, NOW))[0].counts.readiness_removed === 1 && (await adapter.scard('sr:index')) === 0);
    t('the same page again is the same for an address that is already gone (nothing reveals whether it was there)', (await call({ method: 'POST', query: { a: 'readinessremove', token: rt }, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '' }, deps)).body === done.body);
    t('the download link of a removed address stops working', (await dl(dt, deps)).status === 404);
    const wl = await Waitlist.list(adapter);
    t('removing from the report list leaves the Pro waitlist untouched', wl.length === 1 && wl[0].email === 'reader@example.org');
    const bad = await Promise.all([rt.slice(0, 63), rt.slice(0, 32) + 'f'.repeat(32), 'z'.repeat(64), '', Waitlist.tokenFor('reader@example.org')].map((x) => call({ method: 'POST', query: { a: 'readinessremove', token: x }, headers: { 'content-type': 'application/x-www-form-urlencoded' } }, deps)));
    t('a bad token, and a Pro waitlist removal token, are the generic 404 and delete nothing', bad.every((r) => r.status === 404) && (await Waitlist.list(adapter)).length === 1);
    // and the other way round
    await call(signup(), deps);
    const wRemove = await call({ method: 'POST', query: { a: 'waitremove', token: Waitlist.tokenFor('reader@example.org') }, headers: { 'content-type': 'application/x-www-form-urlencoded' } }, deps);
    t('removing from the Pro waitlist leaves the report list untouched', wRemove.status === 200 && (await R.list(adapter)).length === 1);
    const put = await call({ method: 'PUT', query: { a: 'readinessremove', token: rt } }, deps);
    t('PUT on a removal link is a 405', put.status === 405);
    // after removal the person can ask again
    const again = fakeResend();
    await R.removeByEmail(adapter, 'reader@example.org');
    await call(signup(), { store, env: MAIL_ENV, fetch: again, now: NOW + 5000 });
    t('after removal the same address may ask again (the per-day count is by id, so a removal does not reset it)', (await R.list(adapter)).length === 1);
  }

  /* ---- the PDF store ---- */
  {
    const { adapter } = mk();
    const bad = [[Buffer.from('not a pdf '.repeat(200)), 'x.pdf'], [Buffer.from('%PDF-1.4 tiny'), 'x.pdf'], [Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(R.MAX_PDF_BYTES)]), 'x.pdf'], [F.fakePdf(), '../x.pdf'], [F.fakePdf(), 'x.exe'], ['string', 'x.pdf']];
    const refused = [];
    for (const [b, n] of bad) { try { await R.putPdf(adapter, b, n); refused.push(false); } catch (e) { refused.push(e.code === 'readiness_pdf_refused'); } }
    t('the store refuses a non-PDF, a tiny file, a file over the request limit, a path or a non-pdf name, and a string', refused.every(Boolean) && !(await adapter.exists('sr:pdf')), refused.join(','));
    const info = await R.putPdf(adapter, F.fakePdf(), F.NAME);
    t('a PDF is stored as base64 with its sha256, size and name', info.sha256 === crypto.createHash('sha256').update(F.fakePdf()).digest('hex') && (await R.pdfInfo(adapter)).bytes === F.fakePdf().length && (await R.pdfInfo(adapter)).name === F.NAME && /^[A-Za-z0-9+/=]+$/.test(await adapter.get('sr:pdf')));
    const got = await R.getPdf(adapter);
    t('and read back identical', Buffer.compare(got.buffer, F.fakePdf()) === 0);
    t('the limit keeps the base64 under 1 MB, the Upstash free plan request size', Math.ceil(R.MAX_PDF_BYTES / 3) * 4 < 1000000);
    t('the real report fits (284 KB)', Math.ceil(284311 / 3) * 4 < 1000000 && 284311 < R.MAX_PDF_BYTES);
  }

  /* ---- no public path to the PDF ---- */
  {
    const tracked = cp.execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', maxBuffer: 1e8 }).split('\n').filter(Boolean);
    t('no PDF (or document) file is tracked in the repository', tracked.filter((f) => /\.(pdf|docx?|pptx?|xlsx?)$/i.test(f)).length === 0);
    t('.gitignore keeps a PDF out of the repository by accident', /^\*\.pdf\s*$/m.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')));
    const walk = (d, acc) => { fs.readdirSync(path.join(ROOT, d)).forEach((n) => { if (/^(node_modules|\.git|local)$/.test(n)) return; const rel = d ? d + '/' + n : n; if (fs.statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, acc); else acc.push(rel); }); return acc; };
    const onDisk = walk('', []).filter((f) => /\.pdf$/i.test(f) && !/^(node_modules)\//.test(f));
    t('no PDF file sits anywhere in the working tree that gets deployed (the tracked and the untracked)', onDisk.length === 0, onDisk.join(','));
    const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    const toFn = vj.rewrites.filter((r) => /readiness/.test(r.source));
    t('the only rewrites for the report go to the function: the signed download, the removal page and the signup', toFn.length === 3 && toFn.every((r) => /^\/api\/pro\?a=readiness(get|remove)?(&token=:token)?$/.test(r.destination)));
    t('the download rewrite accepts only the 72-hex token shape', toFn.some((r) => /download\/:token\(\[0-9a-f\]\{72\}\)/.test(r.source)));
    t('every /readiness/ response is noindex, no referrer and no-store (vercel.json headers)', vj.headers.some((h) => h.source === '/readiness/(.*)' && h.headers.some((x) => x.key === 'Cache-Control' && x.value === 'no-store') && h.headers.some((x) => x.key === 'X-Robots-Tag' && /noindex/.test(x.value)) && h.headers.some((x) => x.key === 'Referrer-Policy' && x.value === 'no-referrer')));
    const rest = ['readiness', 'readinessremove'];
    const { adapter, store } = mk(); await R.putPdf(adapter, F.fakePdf(), F.NAME);
    const probes = [];
    for (const a of ['', 'pdf', 'report', 'file', 'readinessget', 'readiness_pdf', '../sr:pdf']) probes.push(await call({ query: { a: a, token: 'x' } }, { store, env: MAIL_ENV, now: NOW }));
    t('no other route of the function can return the PDF: every probe is a 404 or a 400', probes.every((r) => [404, 400].indexOf(r.status) !== -1 && !/%PDF/.test(String(r.body).slice(0, 8))));
    void rest;
    // the report text is not in the mail either
    t('the PDF is not attached to the email: the message holds a link only', true);
    const mail = fakeResend();
    await call(signup(), { store, env: MAIL_ENV, fetch: mail, now: NOW });
    t('... the provider payload has no attachments field', mail.sent.length === 1 && mail.sent[0].body.attachments === undefined);
  }

  /* ---- pro-admin ---- */
  {
    const { adapter, store } = mk();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-'));
    const file = path.join(tmp, 'report.pdf');
    fs.writeFileSync(file, F.fakePdf());
    const noArg = await Admin.readinessUpload(store);
    const missing = await Admin.readinessUpload(store, path.join(tmp, 'nope.pdf'));
    fs.writeFileSync(path.join(tmp, 'bad.pdf'), 'not a pdf');
    const badFile = await Admin.readinessUpload(store, path.join(tmp, 'bad.pdf'));
    t('upload: no file, a missing file and a file that is not a PDF are refused and change nothing', !noArg.ok && !missing.ok && !badFile.ok && !(await R.pdfInfo(adapter)));
    const up = await Admin.readinessUpload(store, file);
    t('upload: a PDF is stored and the hash is printed', up.ok && up.lines[0].indexOf(crypto.createHash('sha256').update(F.fakePdf()).digest('hex')) !== -1 && !!(await R.pdfInfo(adapter)));
    const deps = { store, env: MAIL_ENV, fetch: fakeResend(), now: NOW };
    await call(signup({ email: 'x1@example.org', updates: true }), deps);
    await call(signup({ email: 'x2@example.org' }), deps);
    const info = await Admin.readinessInfo(store);
    t('info: the PDF, the integrity, the switch and the count, and no address', /sha256/.test(info.join('\n')) && /match the hash/.test(info.join('\n')) && /Addresses +2 \(1 also chose/.test(info.join('\n')) && !/@/.test(info.join('\n').replace(/hey@getcitehound\.com/g, '')));
    const sw = await Admin.readinessSwitch(store, 'off');
    t('switch off: the report is closed at once', sw.ok && !(await R.available(adapter)) && /OFF/.test((await Admin.readinessInfo(store)).join('\n')));
    t('switch with a bad word is refused', !(await Admin.readinessSwitch(store, 'maybe')).ok);
    await Admin.readinessSwitch(store, 'on');
    t('switch on: open again', await R.available(adapter));
    const exp = await Admin.readinessExport(store);
    t('export: a CSV with email, time, consent version and the second box', /^email,createdAt,consentVersion,updates\n/.test(exp.csv) && /x1@example\.org,[^,]+,2026-10-11,yes/.test(exp.csv) && /x2@example\.org,[^,]+,2026-10-11,no/.test(exp.csv) && exp.count === 2 && exp.withUpdates === 1);
    await R.join(adapter, { email: '=cmd@example.org' });
    t('export: a cell that starts with = is neutralised for spreadsheets', /\n'=cmd@example\.org,/.test((await Admin.readinessExport(store)).csv));
    const dry = await Admin.readinessRemove(store, 'x1@example.org', false);
    t('remove: without --yes it only says what it would do', dry.ok && /Nothing was changed/.test(dry.lines[0]) && (await R.list(adapter)).length === 3 && !dry.lines.join('').includes('x1@'));
    const real = await Admin.readinessRemove(store, ' X1@example.org ', true);
    t('remove --yes: the address is removed (found by its own address, no secret needed)', real.ok && /Removed 1/.test(real.lines[0]) && !(await R.list(adapter)).some((x) => x.email === 'x1@example.org'));
    t('remove: an unknown address changes nothing and says so without saying more', /No report-list entry/.test((await Admin.readinessRemove(store, 'nobody@example.org', true)).lines[0]) && !(await Admin.readinessRemove(store, 'junk', true)).ok);
    const pd = await Admin.readinessPdfDelete(store, false);
    t('pdf-delete: without --yes it deletes nothing', /Nothing was changed/.test(pd.lines[0]) && !!(await R.pdfInfo(adapter)));
    await Admin.readinessPdfDelete(store, true);
    t('pdf-delete --yes: the PDF is gone and the form says not available', !(await R.pdfInfo(adapter)) && !(await R.available(adapter)) && !(await adapter.exists('sr:pdf')));
    const run = await Admin.run(store, ['readiness-info']);
    t('the commands are wired into pro-admin run()', run.code === 0 && (await Admin.run(store, ['readiness-export'])).code === 0 && (await Admin.run(store, ['readiness', 'on'])).code === 0);
    const health = await Admin.health(store, NOW);
    t('health has a line for the report list', health.some((l) => /^Report list/.test(l)));
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  /* ---- the email ---- */
  {
    const msg = RMail.compose('reader@example.org', { now: NOW });
    const imgs = msg.html.match(/<img\b[^>]*>/g) || [];
    t('the email: 600px, table layout, a preheader, a plain-text twin, a subject', /width="600"/.test(msg.html) && /<table role="presentation"/.test(msg.html) && /display:none/.test(msg.html) && msg.text.length > 200 && msg.subject === 'Your copy of the State of AI Readiness report');
    t('the email: one image, the hound mark from this site, and no tracking pixel', imgs.length === 1 && imgs[0].indexOf(site.baseUrl + '/assets/email/hound-mark.png') !== -1 && !/1x1|width="1"|pixel|track/i.test(msg.html));
    const links = (msg.html.match(/href="([^"]+)"/g) || []).map((x) => x.slice(6, -1));
    t('the email: every link is on this site or a mailto, none has a query string or fragment', links.length >= 3 && links.every((u) => (u.indexOf(site.baseUrl + '/') === 0 || u.indexOf('mailto:') === 0) && !/[?#]/.test(u)), links.join(' '));
    t('the email: the text and the html link the same download and removal addresses', dlPath(msg.text) === dlPath(msg.html) && rmPath(msg.text) === rmPath(msg.html));
    t('the email states the expiry date, the 12-month keeping and what the report measures', /until 11 November 2026/.test(msg.text) && /12 months/.test(msg.text) && content.honestFraming.split(':')[0].length > 0 && msg.text.indexOf(content.honestFraming) !== -1);
    t('the email says what it holds only as the content file does: 219 sites, the scan window', msg.text.indexOf('219 well-known websites') !== -1 && msg.text.indexOf(content.sample.scanWindow) !== -1);
    t('the email avoids the banned words and claims no effect', !/\b(quietly|actually|seamlessly|effortless|powerful|unlock|elevate|supercharge|game-changing|revolutioni[sz]e|landscape|delve|crucial|robust|proven|guarantee)/i.test(msg.text));
    t('the email has no gradient and no emoji', !/gradient/i.test(msg.html) && !/[\u{1F300}-\u{1FAFF}]/u.test(msg.html));
  }

  /* ---- what is logged ---- */
  {
    const joined = logged.join('\n');
    t('nothing logged contains an address, a token or the stored bytes', !/@example\.org|@example\.invalid|reader|[0-9a-f]{64}|%PDF|unique-marker/i.test(joined), joined.slice(0, 200));
  }

  /* ---- /privacy and the form say what the code does ---- */
  {
    const priv = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8').replace(/&rsquo;/g, '’').replace(/&ldquo;|&rdquo;/g, '"').replace(/&mdash;/g, '—');
    const sec = (/<h2 class="doc-section__heading">The State of AI Readiness report<\/h2>([\s\S]*?)<\/div>/.exec(priv) || [])[1] || '';
    const text = sec.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    t('/privacy has a section for the report list', text.length > 600);
    t('privacy: what is stored (address, time, wording version, the second box) matches the record', /your email address and one box/.test(text) && /the time you asked/.test(text) && /version of the wording/.test(text) && /whether you ticked the second box/.test(text));
    t('privacy: the keeping is 12 months, the link 30 days, the per-address limit three a day (all read from the code)', /after 12 months/.test(text) && R.KEEP_SECONDS === 365 * 86400 && /works for 30 days/.test(text) && R.LINK_SECONDS === 30 * 86400 && /at most three report emails a day/.test(text) && R.PER_ADDRESS_PER_DAY === 3);
    t('privacy: a separate list, no sale or sharing, the PDF only in the database, Resend, no tracking pixel, a removal link and the unsubscribe header, never says whether an address is known', /separate list from the Pro waitlist/.test(text) && /do not sell it or share it/.test(text) && /sits in our database/.test(text) && /Resend/.test(text) && /no tracking pixel and no tracked links/.test(text) && /Remove my address/.test(text) && /unsubscribe header/.test(text) && /never tells anyone whether an address is already on the list/.test(text));
    t('privacy: the second box is separate, optional and unticked, and both box labels are the ones on the form', /"Send me the report"/.test(text) && /"Also send occasional Citehound updates"/.test(text) && /separate, optional and unticked/.test(text));
    t('privacy: the abuse limit and the daily totals are described', /keyed one-way hash of your IP address/.test(text) && /daily totals of how many people asked for the report/.test(text));
    t('privacy: Third parties names the report list in Upstash and the PDF, and Resend\'s third kind of message', /the report list, the State of AI Readiness PDF itself/.test(priv) && /three kinds of message/.test(priv) && /link to the State of AI Readiness PDF/.test(priv));
    t('privacy: the homepage notices that use session storage are named, with no cookie', /session storage/.test(priv) && /sets no cookies|set no cookies/.test(priv));
    t('privacy: dated 11 October 2026', /Last updated 11 October 2026/.test(priv));
    const page = fs.readFileSync(path.join(ROOT, 'research', 'state-of-ai-readiness.html'), 'utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    t('the form note says the same as the code: 12 months, 30 days, three a day, removal, no tracking, Resend', /up to 12 months/.test(page) && /works for 30 days/.test(page) && /at most three report emails a day/.test(page) && /deletes your address at once/.test(page) && /no tracking pixel and no open or click tracking/.test(page) && /sent through Resend/.test(page));
    const html = fs.readFileSync(path.join(ROOT, 'research', 'state-of-ai-readiness.html'), 'utf8');
    t('the form: honeypot, required first box, optional unchecked second box, a noscript fallback', /name="company_fax"/.test(html) && /id="srSend"[^>]*required/.test(html) && !/id="srUpdates"[^>]*(required|checked)/.test(html) && /<noscript>/.test(html));
    const js = fs.readFileSync(path.join(ROOT, 'report-signup.js'), 'utf8');
    t('the form script sends the two boxes, stores nothing in the browser and reaches only /api/readiness', /sendReport: true/.test(js) && /updates: \$\('srUpdates'\)\.checked/.test(js) && !/localStorage|sessionStorage|document\.cookie/.test(js) && (js.match(/fetch\('([^']+)'/g) || []).every((x) => x === "fetch('/api/readiness'"));
  }

  out('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
}()).catch((e) => { process.stderr.write('test run crashed: ' + (e && e.stack || e) + '\n'); process.exit(1); });
