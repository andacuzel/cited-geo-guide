#!/usr/bin/env node
/* =====================================================================
   scripts/test-waitlist.js

   The Pro waitlist (lib/waitlist.js, lib/waitlist-api.js, lib/waitlist-mail.js) through the real handler
   (lib/pro-api.js handle) with the in-memory store and a fake mail provider: what is stored and for how long,
   that no response says whether an address was known, the honeypot, validation, the limits (hashed-address rate
   limit, one mail per address per 30 days, the daily cap), that a missing or failing mail provider never fails
   a signup, the signed removal link (a page first, a POST to delete, nothing forgeable), the public Pro switch,
   the report feedback form, the daily counters, and the email itself (brand, table layout, plain-text twin, one
   hound image, no tracking, only claims the repository backs).

     node scripts/test-waitlist.js
   ===================================================================== */

'use strict';

process.env.PRO_HASH_SECRET = 'test-only-secret-0123456789abcdef';
const fs = require('fs');
const path = require('path');
const S = require('../lib/pro-store.js');
const api = require('../lib/pro-api.js');
const H = require('../lib/pro-http.js');
const Waitlist = require('../lib/waitlist.js');
const WMail = require('../lib/waitlist-mail.js');
const Stats = require('../lib/pro-stats.js');
const site = require('../lib/site-config.js');
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
    const res = { statusCode: 200, setHeader: (k, v) => { headers[k.toLowerCase()] = v; }, end: (b) => { let json = null; try { json = JSON.parse(b); } catch (e) { /* html */ } resolve({ status: res.statusCode, headers, body: b, json }); } };
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
const signup = (extra, ip) => ({ method: 'POST', query: { a: 'waitlist' }, ip: ip, body: Object.assign({ email: 'Reader@Example.org', name: 'Ada Reader', consent: true }, extra || {}) });
const idOf = (e) => Waitlist.idOf(e);

(async function main() {
  /* ---- the public Pro switch ---- */
  {
    const { store } = mk();
    const none = await call({ query: { a: 'waitlist' } }, { store, env: {} });
    t('config: with nothing set there is no checkout address and no price text', none.status === 200 && none.json.checkoutUrl === null && none.json.priceText === null);
    t('config: it may be cached for five minutes (it holds nothing private)', /public/.test(none.headers['cache-control']) && /max-age=300/.test(none.headers['cache-control']));
    const set = await call({ query: { a: 'waitlist' } }, { store, env: { PRO_CHECKOUT_URL: 'https://pay.example.com/checkout/abc?x=1', PRO_PRICE_TEXT: '  $49 <b>one-time</b>  ' } });
    t('config: an https checkout address and a price text are passed on, the text cleaned', set.json.checkoutUrl === 'https://pay.example.com/checkout/abc?x=1' && set.json.priceText === '$49 b one-time /b' || (set.json.checkoutUrl === 'https://pay.example.com/checkout/abc?x=1' && !/[<>]/.test(set.json.priceText) && /\$49/.test(set.json.priceText)));
    const bad = await Promise.all(['http://pay.example.com/x', 'javascript:alert(1)', 'not a url', '//evil.example'].map((v) => call({ query: { a: 'waitlist' } }, { store, env: { PRO_CHECKOUT_URL: v } })));
    t('config: a checkout address that is not https is ignored', bad.every((r) => r.json.checkoutUrl === null));
  }

  /* ---- a signup ---- */
  {
    const { adapter, store } = mk();
    const resend = fakeResend();
    const deps = { store, env: MAIL_ENV, fetch: resend };
    const r1 = await call(signup(), deps);
    t('signup: 200 with the one message', r1.status === 200 && r1.json.ok === true && r1.json.message === require('../lib/waitlist-api.js').JOINED, r1.body);
    const id = idOf('reader@example.org');
    const rec = await adapter.hgetall('wl:e:' + id);
    t('signup: stored under the keyed hash of the normalized address, with email, createdAt and consentVersion', rec && rec.email === 'reader@example.org' && /^\d{4}-\d{2}-\d{2}T/.test(rec.createdAt) && rec.consentVersion === Waitlist.CONSENT_VERSION && rec.name === 'Ada Reader');
    const ttl = await adapter.ttl('wl:e:' + id);
    t('signup: the record lives 12 months', ttl > 364 * 86400 && ttl <= 365 * 86400, String(ttl));
    t('signup: the key holds a hash, not the address', ('wl:e:' + id).indexOf('example') === -1 && /^wl:e:[0-9a-f]{32}$/.test('wl:e:' + id));
    t('signup: one confirmation mail went to that address only', resend.sent.length === 1 && resend.sent[0].url === 'https://api.resend.com/emails' && resend.sent[0].body.to.length === 1 && resend.sent[0].body.to[0] === 'reader@example.org' && resend.sent[0].body.subject === 'You’re on the Citehound Pro waitlist');
    const hdr = resend.sent[0].body.headers;
    t('signup: the mail carries List-Unsubscribe (https) and the one-click header', /^<https:\/\/[^>\s]+\/waitlist\/remove\/[0-9a-f]{64}>$/.test(hdr['List-Unsubscribe']) && hdr['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click');
    t('signup: the mail asks for no tracking and uses no tags', !('tracking' in resend.sent[0].body) && !('tags' in resend.sent[0].body) && resend.sent[0].headers['Idempotency-Key']);

    const r2 = await call(signup({ email: '  READER@example.ORG ', name: '' }), deps);
    t('signup: the same address again (case and spaces differ) gives a byte-identical answer', r2.status === 200 && r2.body === r1.body, r2.body);
    t('signup: ... stays one record, keeps the first details, and sends no second mail within 30 days', (await Waitlist.list(adapter)).length === 1 && resend.sent.length === 1 && (await adapter.hget('wl:e:' + id, 'name')) === 'Ada Reader');
    const days = await Stats.read(store, 1);
    t('stats: two signup requests and one mail were counted, as numbers only', days[0].counts.waitlist_signups === 2 && days[0].counts.waitlist_emails === 1);
    t('stats: the hash holds only metric names and numbers', Object.entries((adapter._dump()['pro:stats:' + days[0].day])).every(([k, v]) => Stats.METRICS.indexOf(k) !== -1 && /^\d+$/.test(v)));
  }

  /* ---- honeypot, validation, consent ---- */
  {
    const { adapter, store } = mk();
    const resend = fakeResend();
    const deps = { store, env: MAIL_ENV, fetch: resend };
    const good = await call(signup({ email: 'a@example.org' }), deps);
    const trap = await call(signup({ email: 'bot@example.org', company_fax: 'x' }), deps);
    t('honeypot: a filled trap gets the same answer as a real signup, and nothing is stored or sent', trap.body === good.body && (await adapter.hgetall('wl:e:' + idOf('bot@example.org'))) === null && resend.sent.length === 1);
    const bad = [
      await call(signup({ email: 'nope' }), deps), await call(signup({ email: '' }), deps), await call(signup({ email: 'a@b' }), deps), await call(signup({ email: 'x'.repeat(260) + '@example.org' }), deps),
      await call(signup({ email: 'ok@example.org', consent: false }), deps), await call(signup({ email: 'ok@example.org', consent: 'true' }), deps), await call(signup({ email: 'ok@example.org', consent: undefined }), deps),
      await call(signup({ email: 'ok@example.org', name: 'n'.repeat(81) }), deps)
    ];
    t('validation: a bad address, a missing or non-true consent, or a long name is a 400 with the field named', bad.every((r) => r.status === 400 && r.json.fields) && bad[0].json.fields.email && bad[4].json.fields.consent && bad[7].json.fields.name);
    t('validation: nothing was stored or sent for any of them', (await Waitlist.list(adapter)).length === 1 && resend.sent.length === 1);
    const notJson = await call({ method: 'POST', query: { a: 'waitlist' }, body: 'not json' }, deps);
    t('validation: a body that is not JSON is a 400', notJson.status === 400);
    const noName = await call(signup({ email: 'noname@example.org', name: undefined }), deps);
    t('the name is optional', noName.status === 200 && (await adapter.hget('wl:e:' + idOf('noname@example.org'), 'name')) === null);
    const foreign = await call(Object.assign(signup({ email: 'f@example.org' }), { headers: { origin: 'https://evil.example' } }), deps);
    t('origin: a post from another site is refused (403) and stores nothing', foreign.status === 403 && (await adapter.hgetall('wl:e:' + idOf('f@example.org'))) === null);
    const own = await call(Object.assign(signup({ email: 'own@example.org' }), { headers: { origin: site.baseUrl } }), deps);
    t('origin: a post from this site is accepted', own.status === 200);
    const wrongMethod = await call({ method: 'DELETE', query: { a: 'waitlist' } }, deps);
    t('a DELETE is refused (405)', wrongMethod.status === 405);
  }

  /* ---- rate limit ---- */
  {
    const { store } = mk();
    const deps = { store, env: {}, fetch: fakeResend() };
    let last = 0; for (let i = 0; i < 8; i++) last = (await call(signup({ email: 'rl' + i + '@example.org' }, '198.51.100.9'), deps)).status;
    const other = await call(signup({ email: 'rl-other@example.org' }, '198.51.100.10'), deps);
    t('rate limit: the 7th signup in an hour from one address is a 429, another caller is not affected', last === 429 && other.status === 200);
    const keys = Object.keys(store.adapter._dump()).filter((k) => /^pro:rl:waitlist/.test(k));
    t('rate limit: counters are keyed by a hash, not by the address', keys.length >= 1 && keys.every((k) => k.indexOf('198.51') === -1 && /:[0-9a-f]{32}$/.test(k)));
  }

  /* ---- test traffic cannot use up a visitor's signup quota ---- */
  {
    const { store } = mk();
    const deps = { store, env: {}, fetch: fakeResend() };
    const ip = '198.51.100.20';
    let bad = 0;
    for (let i = 0; i < 20; i++) {
      const r = await call(signup(i % 3 === 0 ? { email: 'nope', consent: true } : i % 3 === 1 ? { email: 'x@example.org', consent: false } : { email: 'trap@example.org', consent: true, company_fax: 'x' }, ip), deps);
      if (r.status === 400 || r.status === 200) bad++;
    }
    const real = await call(signup({ email: 'real-visitor@example.org' }, ip), deps);
    t('quota: 20 invalid or honeypot requests from one network leave the signup quota untouched, the real signup is accepted', bad === 20 && real.status === 200, bad + ' ' + real.status);
    let st = 0; for (let i = 0; i < 5; i++) st = (await call(signup({ email: 'q' + i + '@example.org' }, ip), deps)).status;
    t('quota: six accepted signups fit in the hour (the real one plus five), the seventh is a 429', st === 200 && (await call(signup({ email: 'q9@example.org' }, ip), deps)).status === 429);
    const f = mk(); const fd = { store: f.store, env: {}, fetch: fakeResend() };
    let code = 0; for (let i = 0; i < 62; i++) code = (await call(signup({ email: 'nope' }, '198.51.100.30'), fd)).status;
    t('quota: a flood of invalid requests still hits the flood guard (429 after 60 an hour)', code === 429);
  }

  /* ---- mail: not configured, cap, provider failure ---- */
  {
    const { adapter, store } = mk();
    const resend = fakeResend();
    const none = await call(signup({ email: 'nomail@example.org' }), { store, env: {}, fetch: resend });
    t('no provider configured: the signup still succeeds and no request is made', none.status === 200 && resend.sent.length === 0 && (await adapter.hgetall('wl:e:' + idOf('nomail@example.org'))) !== null);
    t('... and nothing is reserved, so a later mail is still possible', (await adapter.get('wl:mail:' + idOf('nomail@example.org'))) === null);
  }
  {
    const { store } = mk();
    const resend = fakeResend();
    const deps = { store, env: Object.assign({ WAITLIST_EMAIL_DAILY_CAP: '2' }, MAIL_ENV), fetch: resend };
    const rs = []; for (let i = 0; i < 4; i++) rs.push(await call(signup({ email: 'cap' + i + '@example.org' }), deps));
    t('daily cap: with a cap of 2, four signups all succeed and only two mails are sent', rs.every((r) => r.status === 200) && resend.sent.length === 2, String(resend.sent.length));
    const zero = fakeResend();
    await call(signup({ email: 'zero@example.org' }), { store: mk().store, env: Object.assign({ WAITLIST_EMAIL_DAILY_CAP: '0' }, MAIL_ENV), fetch: zero });
    t('daily cap: a cap of 0 sends nothing', zero.sent.length === 0);
    const def = fakeResend();
    await call(signup({ email: 'def@example.org' }), { store: mk().store, env: MAIL_ENV, fetch: def });
    t('daily cap: without the variable the default is 200', Waitlist.dailyCap({}) === 200 && Waitlist.dailyCap({ WAITLIST_EMAIL_DAILY_CAP: 'abc' }) === 200 && Waitlist.dailyCap({ WAITLIST_EMAIL_DAILY_CAP: '7' }) === 7 && def.sent.length === 1);
  }
  {
    const { adapter, store } = mk();
    const failing = fakeResend({ fail: true });
    const r = await call(signup({ email: 'fail@example.org' }), { store, env: MAIL_ENV, fetch: failing });
    t('provider failure: the signup is still a 200 and the address is kept', r.status === 200 && (await adapter.hgetall('wl:e:' + idOf('fail@example.org'))) !== null && failing.sent.length === 1);
    const ok = fakeResend();
    await call(signup({ email: 'fail@example.org' }), { store, env: MAIL_ENV, fetch: ok });
    t('provider failure: the reservation was given back, so the next signup request can send the mail', ok.sent.length === 1);
    const throws = async () => { throw new Error('network down'); };
    const r3 = await call(signup({ email: 'throw@example.org' }), { store, env: MAIL_ENV, fetch: throws });
    t('provider unreachable: still a 200', r3.status === 200);
    const cooled = fakeResend();
    const { adapter: a2, store: s2 } = mk();
    const t0 = Date.now();
    await call(signup({ email: 'again@example.org' }), { store: s2, env: MAIL_ENV, fetch: cooled });
    t('cooldown: the mail key lives 30 days', (await a2.ttl('wl:mail:' + idOf('again@example.org'))) > 29 * 86400);
    await a2.del('wl:mail:' + idOf('again@example.org'));
    await call(signup({ email: 'again@example.org' }), { store: s2, env: MAIL_ENV, fetch: cooled });
    t('cooldown: once the 30 days have passed another request may send again', cooled.sent.length === 2 && Date.now() - t0 < 60000);
  }

  /* ---- removal ---- */
  {
    const { adapter, store } = mk();
    const resend = fakeResend();
    const deps = { store, env: MAIL_ENV, fetch: resend };
    await call(signup({ email: 'gone@example.org' }), deps);
    await call(signup({ email: 'stay@example.org' }), deps);
    const link = resend.sent[0].body.headers['List-Unsubscribe'].slice(1, -1);
    const token = link.split('/').pop();
    t('removal: the link in the mail is the token for that address, on this site over https', link === site.baseUrl + '/waitlist/remove/' + Waitlist.tokenFor('gone@example.org') && link.startsWith('https://'));
    const get = await call({ query: { a: 'waitremove', token } }, deps);
    t('removal: opening the link shows a page with one button and removes nobody', get.status === 200 && /<form method="post" action="\/waitlist\/remove\/[0-9a-f]{64}"/.test(get.body) && /Remove me from the list/.test(get.body) && (await adapter.hgetall('wl:e:' + idOf('gone@example.org'))) !== null);
    t('removal: the page is noindex, no-referrer and no-store', /noindex/.test(get.headers['x-robots-tag']) && get.headers['referrer-policy'] === 'no-referrer' && /no-store/.test(get.headers['cache-control']));
    const oneClick = await call({ method: 'POST', query: { a: 'waitremove', token }, body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } }, deps);
    t('removal: a POST (the button, or a mail client\'s one-click) deletes the record and the index entry', oneClick.status === 200 && /You have been removed/.test(oneClick.body) && (await adapter.hgetall('wl:e:' + idOf('gone@example.org'))) === null && !(await adapter.smembers('wl:index')).includes(idOf('gone@example.org')));
    t('removal: the other address is untouched', (await adapter.hgetall('wl:e:' + idOf('stay@example.org'))) !== null);
    const again = await call({ method: 'POST', query: { a: 'waitremove', token }, body: '' }, deps);
    t('removal: using the link a second time is harmless and says the same', again.status === 200 && /You have been removed/.test(again.body));
    const days = await Stats.read(store, 1);
    t('stats: one removal was counted, not two', days[0].counts.waitlist_removed === 1);
    const flipped = token.slice(0, 63) + (token[63] === '0' ? '1' : '0');
    const wrongMac = idOf('stay@example.org') + token.slice(32);
    const bads = [flipped, wrongMac, token.slice(0, 40), 'x'.repeat(64), '', token.toUpperCase() + '0'];
    const rs = []; for (const b of bads) rs.push(await call({ method: 'POST', query: { a: 'waitremove', token: b }, body: '' }, deps));
    t('removal: a changed, truncated, foreign or empty token is a 404 and deletes nothing', rs.every((r) => r.status === 404) && (await adapter.hgetall('wl:e:' + idOf('stay@example.org'))) !== null);
    t('removal: forged tokens are rejected by the signature check', Waitlist.idFromToken(wrongMac) === null && Waitlist.idFromToken(flipped) === null && Waitlist.idFromToken(token) === idOf('gone@example.org'));
    const keep = process.env.PRO_HASH_SECRET;
    process.env.PRO_HASH_SECRET = 'a-different-secret-0123456789abc';
    t('removal: a token made with another secret is not accepted', Waitlist.idFromToken(token) === null);
    process.env.PRO_HASH_SECRET = keep;
    const getBad = await call({ query: { a: 'waitremove', token: 'nonsense' } }, deps);
    t('removal: an invalid link\'s page gives a plain way out', getBad.status === 404 && getBad.body.indexOf(site.contactEmail) !== -1);
  }

  /* ---- export ---- */
  {
    const { adapter } = mk();
    await Waitlist.join(adapter, { email: 'B@example.org', name: 'Bea' }, Date.UTC(2026, 9, 11));
    await Waitlist.join(adapter, { email: 'a@example.org' }, Date.UTC(2026, 9, 10));
    await Waitlist.join(adapter, { email: 'c@example.org' }, Date.UTC(2026, 9, 12));
    await adapter.del('wl:e:' + idOf('c@example.org'));
    const rows = await Waitlist.list(adapter);
    t('list: oldest first, expired entries dropped (and cleaned from the index)', rows.length === 2 && rows[0].email === 'a@example.org' && rows[1].email === 'b@example.org' && (await adapter.scard('wl:index')) === 2);
    const exp = require('./export-waitlist.js');
    const csv = exp.toCsv([{ email: 'x,y"z@example.org', name: '=SUM(1)', createdAt: '2026-10-10T00:00:00.000Z', consentVersion: 'v1' }]);
    t('export: CSV with a header row, quotes doubled, and a leading = + - @ neutralized', csv.split('\n')[0] === 'email,name,createdAt,consentVersion' && csv.indexOf('"x,y""z@example.org"') !== -1 && csv.indexOf("'=SUM(1)") !== -1, csv);
  }

  /* ---- feedback on a report ---- */
  {
    const { adapter, store } = mk();
    const o = await store.createOrder();
    const jobId = await store.createJob({ domain: 'example.com' });
    await store.setJob(jobId, { status: 'done' });
    await store.markOrderUsed(o.token, { jobId: jobId, contact: { name: 'Grace', email: 'grace@example.org' } });
    const post = (b, ip) => call({ method: 'POST', query: { a: 'feedback' }, ip: ip, body: b }, { store });
    const r = await post({ id: jobId, rating: 4, text: '  Clear, but I wanted the fixes first.  ' });
    t('feedback: stored with the rating, the text and a date, under the job id', r.status === 200 && (await adapter.hget('pro:feedback:' + jobId, 'rating')) === '4' && (await adapter.hget('pro:feedback:' + jobId, 'text')) === 'Clear, but I wanted the fixes first.' && !!(await adapter.hget('pro:feedback:' + jobId, 'createdAt')));
    t('feedback: kept 90 days', (await adapter.ttl('pro:feedback:' + jobId)) > 89 * 86400 && (await adapter.ttl('pro:feedback:' + jobId)) <= 90 * 86400);
    t('feedback: the record holds no contact data', JSON.stringify(adapter._dump()['pro:feedback:' + jobId]).indexOf('grace') === -1 && JSON.stringify(adapter._dump()['pro:feedback:' + jobId]).indexOf('@') === -1);
    const second = await post({ id: jobId, rating: 1, text: 'changed' });
    t('feedback: a second answer gets the same thanks and changes nothing', second.body === r.body && (await adapter.hget('pro:feedback:' + jobId, 'rating')) === '4');
    const bad = [await post({ id: jobId, rating: 0 }), await post({ id: jobId, rating: 6 }), await post({ id: jobId, rating: 2.5 }), await post({ id: jobId, rating: 'x' }), await post({ id: jobId, rating: 3, text: 'x'.repeat(1001) }), await post({ id: jobId, rating: 3, text: { a: 1 } })];
    t('feedback: a rating outside 1 to 5, or text over 1000 characters, is a 400', bad.every((x) => x.status === 400));
    const j2 = await store.createJob({ domain: 'example.org' });
    const running = await post({ id: j2, rating: 5 });
    const unknown = await post({ id: 'c'.repeat(32), rating: 5 });
    const malformed = await post({ id: 'nope', rating: 5 });
    t('feedback: a job that is not finished, an unknown id and a malformed id all get the one generic 404', [running, unknown, malformed].every((x) => x.status === 404 && x.body === unknown.body));
    const trap = await post({ id: j2, rating: 5, company_fax: 'x' });
    t('feedback: a filled honeypot gets a 200 and stores nothing', trap.status === 200 && (await adapter.hgetall('pro:feedback:' + j2)) === null);
    let lim = 0; for (let i = 0; i < 12; i++) lim = (await post({ id: jobId, rating: 3 }, '198.51.100.77')).status;
    t('feedback: rate limited by hashed address (429 after 10 an hour)', lim === 429);
    t('stats: one feedback was counted', (await Stats.read(store, 1))[0].counts.feedback === 1);
    const get = await call({ method: 'GET', query: { a: 'feedback' } }, { store });
    t('feedback: a GET is refused (405)', get.status === 405);
  }

  /* ---- order options: source, label, validity, list, revoke ---- */
  {
    const { adapter, store } = mk();
    const Orders = require('../lib/pro-orders.js');
    const a = await Orders.issueOrder(store, { source: 'pilot', label: 'Ada (agency)', validDays: 14 });
    const b = await Orders.issueOrder(store, { source: 'paid' });
    const c = await Orders.issueOrder(store, {});
    t('orders: pilot and paid are recorded, a label is kept, the default source is pilot', a.order.source === 'pilot' && a.order.label === 'Ada (agency)' && b.order.source === 'paid' && c.order.source === 'pilot');
    const ttl = await adapter.ttl('pro:order:' + a.order.token);
    t('orders: --expires-days 14 means 14 days, the default 30', ttl > 13 * 86400 && ttl <= 14 * 86400 && (await adapter.ttl('pro:order:' + c.order.token)) > 29 * 86400);
    t('orders: the link is the same /pro/start/<token> for pilot and paid', a.url === site.baseUrl + '/pro/start/' + a.order.token && b.url === site.baseUrl + '/pro/start/' + b.order.token);
    const days = (await Stats.read(store, 1))[0].counts;
    t('stats: orders are counted by source', days.orders_pilot === 2 && days.orders_paid === 1);
    const ok = await store.revokeOrder(a.order.token);
    const page = await call({ query: { a: 'startpage', token: a.order.token } }, { store });
    const ord = await call({ method: 'POST', query: { a: 'order' }, body: { token: a.order.token } }, { store });
    t('revoke: a revoked link gives the same generic answers as an unknown one', ok === true && page.status === 404 && /This link is not available/.test(page.body) && ord.status === 404 && /unavailable/.test(ord.body));
    const claimed = await store.claimOrder(a.order.token);
    t('revoke: a revoked link cannot be claimed', claimed === false);
    const listed = await store.listOrders();
    t('list: all three are listed, newest first, with their source and label', listed.length === 3 && listed.some((o) => o.token === a.order.token && o.status === 'revoked' && o.label === 'Ada (agency)'));
    const used = await store.createOrder(); await store.markOrderUsed(used.token, { jobId: 'd'.repeat(32), contact: { name: 'x', email: 'x@example.org' } });
    t('revoke: a link that is already used is not revoked', (await store.revokeOrder(used.token)) === false);
    t('revoke: an unknown token is not revoked', (await store.revokeOrder('0'.repeat(32))) === false);
    const label = (await store.createOrder({ label: 'x'.repeat(200) + '\n<script>' })).label;
    t('orders: a label is cut to 60 characters and stripped of control characters', label.length <= 60 && !/[\n]/.test(label));
  }

  /* ---- the email ---- */
  {
    process.env.PRO_HASH_SECRET = 'test-only-secret-0123456789abcdef';
    const m = WMail.compose('reader@example.org', 'Ada Reader');
    const f = WMail.facts();
    const methodology = require('../lib/methodology.js');
    t('email: the check, pillar and crawler counts come from the registries', f.checks === methodology.registry().length && f.pillars === methodology.PILLARS.length && f.crawlers === require('../lib/scanner.js').BOTS.length && m.text.indexOf(f.checks + ' checks across ' + f.pillars + ' pillars') !== -1 && m.text.indexOf(f.crawlers + ' AI crawlers') !== -1);
    t('email: the subject is the agreed one and the preheader is in the HTML', m.subject === 'You’re on the Citehound Pro waitlist' && m.html.indexOf(m.preheader) !== -1 && /display:none/.test(m.html));
    t('email: 600px, table-based, with inline styles and no <style> block, scripts, forms or external stylesheets', /<table role="presentation" width="600"/.test(m.html) && !/<style|<script|<form|<link /i.test(m.html) && (m.html.match(/style="/g) || []).length > 20);
    ['#0b1526', '#e7c77c', '#fbf8ef', '#dfe3ea'].forEach((c) => t('email: the brand colour ' + c + ' is used', m.html.toLowerCase().indexOf(c) !== -1));
    t('email: Georgia for display, a system sans for text, a monospace for labels, no web font', /Georgia/.test(m.html) && /-apple-system/.test(m.html) && /Menlo|Consolas/.test(m.html) && !/fonts\.googleapis|@font-face|@import/.test(m.html));
    t('email: no gradient, no pill, radius only 6px and 10px', !/gradient/i.test(m.html) && !/999px|border-radius:50%/.test(m.html) && (m.html.match(/border-radius:([^;"]+)/g) || []).every((x) => /(10px 10px 0 0|0 0 10px 10px|6px)$/.test(x)));
    const imgs = m.html.match(/<img [^>]*>/g) || [];
    t('email: exactly one image, the hound mark served from this site, with size attributes and no tracking', imgs.length === 1 && imgs[0].indexOf('src="' + site.baseUrl + '/assets/email/hound-mark.png"') !== -1 && /width="44" height="44"/.test(imgs[0]));
    const hrefs = (m.html.match(/href="[^"]+"/g) || []).map((h) => h.slice(6, -1).replace(/&amp;/g, '&'));
    t('email: every link is https on this site (or the contact mailto), with no query string, no fragment and no redirect', hrefs.length >= 8 && hrefs.every((h) => /^mailto:/.test(h) || (h.startsWith(site.baseUrl + '/') && !/[?#]/.test(h))), JSON.stringify(hrefs.filter((h) => !(/^mailto:/.test(h) || (h.startsWith(site.baseUrl + '/') && !/[?#]/.test(h))))));
    t('email: the button goes to the free scanner at the site root', m.html.indexOf('<a href="' + site.baseUrl + '/" style="display:inline-block;padding:13px 24px') !== -1 && /Open the free scanner/.test(m.html));
    t('email: no tracking words anywhere', !/utm_|pixel|beacon|track(ing|er)?\b|click\./i.test(m.html + m.text));
    t('email: a visible "Remove me from the list" link whose address is the one in the List-Unsubscribe header', m.html.indexOf('>Remove me from the list</a>') !== -1 && m.html.indexOf('href="' + m.removeUrl + '"') !== -1 && m.headers['List-Unsubscribe'] === '<' + m.removeUrl + '>' && m.removeUrl.startsWith('https://'));
    t('email: a plain-text twin with the same address, the same sentence and no HTML', m.text.indexOf(m.removeUrl) !== -1 && m.text.indexOf(WMail.MEASURE) !== -1 && !/<[a-z][^>]*>/i.test(m.text));
    t('email: it says the score measures AI readiness and not whether an assistant mentions you', /AI readiness/.test(m.html) && /does not measure whether any assistant mentions you/.test(m.html));
    const pages = { '/': 'index.html', '/tools': 'tools/index.html', '/mcp': 'mcp.html', '/research': 'research/index.html', '/benchmarks': 'benchmarks/index.html', '/sample-report': 'sample-report.html' };
    const linked = hrefs.filter((h) => h.startsWith(site.baseUrl)).map((h) => h.slice(site.baseUrl.length).replace(/\/$/, '') || '/').filter((h) => !h.startsWith('/waitlist/') && !h.startsWith('/assets/'));
    t('email: every page it links to exists in the repository', linked.length >= 6 && linked.every((p) => pages[p] && fs.existsSync(path.join(ROOT, pages[p]))), JSON.stringify(linked));
    t('email: no ranking promise, no invented number, none of the banned words', !/\b(rank|ranking|ranked|best|top)\b|quietly|actually|seamlessly|effortless|powerful|unlock|elevate|supercharge|game-changing|revolutionize|landscape|delve|crucial|robust|coming soon/i.test(m.text) && !/\d+%/.test(m.text));
    const paragraphs = m.text.split('\n\n');
    t('email: at most one em dash per paragraph', paragraphs.every((p) => (p.match(/—/g) || []).length <= 1));
    const png = path.join(ROOT, 'assets', 'email', 'hound-mark.png');
    const buf = fs.existsSync(png) ? fs.readFileSync(png) : Buffer.alloc(0);
    t('email: the hound PNG exists, is a PNG and is 88 x 88 (44 at 2x)', buf.length > 200 && buf.slice(1, 4).toString() === 'PNG' && buf.readUInt32BE(16) === 88 && buf.readUInt32BE(20) === 88, buf.length + ' bytes');
    const noName = WMail.compose('reader@example.org', '');
    t('email: without a name it says "Hello," and with one it uses the first name only', /^Hello,$/m.test(noName.text) && /^Hello Ada,$/m.test(m.text) && m.text.indexOf('Reader') === -1);
    const hostile = WMail.compose('x@example.org', '<script>alert(1)</script> Eve');
    t('email: a hostile name cannot inject HTML', hostile.html.indexOf('<script>') === -1);
  }

  /* ---- logs ---- */
  {
    const joined = logged.join('\n');
    t('nothing a person typed, no token and no address reached any log', !/example\.org|reader@|[0-9a-f]{64}|198\.51\.100|Ada/.test(joined), joined.slice(0, 200));
  }

  out('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
}()).catch((e) => { process.stderr.write('The test stopped: ' + (e && e.stack) + '\n'); process.exit(1); });
