#!/usr/bin/env node
/* =====================================================================
   scripts/test-pro-api.js

   Drives lib/pro-api.js (the logic behind api/pro.js) with fake requests, the
   in-memory store and a fake site. Covers the start flow and its concurrency, the
   generic answers for bad links, validation, the per-domain limit, step and
   status, the email endpoint (recipient fixed by the order, limit of 3, nothing
   revealed, refund on failure), the rate limits, and that nothing a person typed
   or an address ever reaches the log.

     node scripts/test-pro-api.js
   ===================================================================== */

'use strict';

const S = require('../lib/pro-store.js');
const api = require('../lib/pro-api.js');
const H = require('../lib/pro-http.js');

let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

// Everything printed during the run is kept, to prove nothing private reaches a log.
const logged = [];
['log', 'warn', 'error', 'info'].forEach((k) => { const orig = console[k]; console[k] = function () { logged.push(Array.prototype.slice.call(arguments).join(' ')); if (k === 'log' && process.env.PRO_TEST_VERBOSE) orig.apply(console, arguments); }; });

let ipCounter = 0;
function call(fn, o, deps) {
  o = o || {};
  if (!o.ip) o.ip = '10.' + Math.floor(ipCounter / 250) + '.' + (ipCounter++ % 250) + '.1'; // a fresh caller per request unless the test names one
  return new Promise((resolve, reject) => {
    const headers = {};
    const req = { method: o.method || 'GET', url: o.url || '/', headers: Object.assign({ 'x-forwarded-for': o.ip || '203.0.113.7' }, o.headers || {}), query: o.query || {}, body: o.body, socket: {} };
    const res = { statusCode: 200, setHeader: (k, v) => { headers[k.toLowerCase()] = v; }, end: (b) => { let json = null; try { json = JSON.parse(b); } catch (e) { /* html */ } resolve({ status: res.statusCode, headers, body: b, json }); } };
    Promise.resolve(fn(req, res, deps)).catch(reject);
  });
}

const okHost = async () => ({ ok: true });
function fakeSiteFetch(log) {
  const pages = {};
  return async function (url, o) {
    log.push(url);
    const path = url.replace('https://example.com', '');
    if (path === '/robots.txt') return { ok: true, status: 200, text: 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n', headers: {}, finalUrl: url };
    if (path === '/sitemap.xml') return { ok: true, status: 200, text: '<urlset>' + ['/', '/a', '/b', '/c'].map((p) => '<url><loc>https://example.com' + p + '</loc></url>').join('') + '</urlset>', headers: {}, contentType: 'application/xml', finalUrl: url };
    if (path === '/llms.txt') return { ok: false, status: 404, text: '', headers: {}, finalUrl: url };
    return { ok: true, status: 200, text: '<html lang="en"><head><title>A page on the example site</title></head><body><h1>x</h1></body></html>', contentType: 'text/html', headers: {}, finalUrl: url };
  };
}
const sleepFast = async () => {};

const GOOD = (token, extra) => Object.assign({ token: token, site: 'https://www.example.com/pricing', name: 'Grace Hopper', email: 'grace.hopper@mail.example.org', consent: true }, extra || {});
const mk = () => { const adapter = S.memoryAdapter(); return { adapter, store: S.createStore(adapter) }; };
const jobKeys = (adapter) => Object.keys(adapter._dump()).filter((k) => /^pro:job:[a-f0-9]{32}$/.test(k));

(async function main() {
  /* ---- start: the happy path ---- */
  {
    const { adapter, store } = mk();
    const o = await store.createOrder();
    const r = await call(api.start, { method: 'POST', body: GOOD(o.token) }, { store, checkHost: okHost });
    t('start: 200 with a job id and the report path', r.status === 200 && /^[a-f0-9]{32}$/.test(r.json.jobId) && r.json.reportPath === '/r/' + r.json.jobId + '/', r.body);
    const job = await store.getJob(r.json.jobId);
    t('start: the job is for the bare domain, queued, in its first phase', job.domain === 'example.com' && job.status === 'queued' && job.phase === 'discover');
    const after = await store.getOrder(o.token);
    t('start: the order is used, points at that job, and holds the contact', after.status === 'used' && after.jobId === r.json.jobId && after.contact.email === 'grace.hopper@mail.example.org' && after.contact.name === 'Grace Hopper');
    t('start: the reverse key is written', (await store.orderForJob(r.json.jobId)).token === o.token);
    const jobText = JSON.stringify(adapter._dump()['pro:job:' + r.json.jobId]);
    t('start: the job record holds no contact data', jobText.indexOf('grace') === -1 && jobText.indexOf('Hopper') === -1 && jobText.indexOf('@') === -1);
    t('start: the response says no-store, noindex and no referrer', r.headers['cache-control'] === 'no-store' && /noindex/.test(r.headers['x-robots-tag']) && r.headers['referrer-policy'] === 'no-referrer');
    const again = await call(api.start, { method: 'POST', body: GOOD(o.token) }, { store, checkHost: okHost });
    t('start: submitting a used token again returns that token\'s own job, no second job', again.status === 200 && again.json.jobId === r.json.jobId && jobKeys(adapter).length === 1);
  }

  /* ---- start: concurrency ---- */
  {
    const { adapter, store } = mk();
    const o = await store.createOrder();
    const rs = await Promise.all(Array.from({ length: 12 }, () => call(api.start, { method: 'POST', body: GOOD(o.token) }, { store, checkHost: okHost, pollMs: 20 })));
    const ids = new Set(rs.filter((r) => r.status === 200).map((r) => r.json.jobId));
    t('concurrency: 12 simultaneous submits on one token start exactly one job', jobKeys(adapter).length === 1, jobKeys(adapter).length + ' jobs');
    t('concurrency: every submit that succeeded got that one job id', ids.size === 1 && rs.filter((r) => r.status === 200).length >= 1, JSON.stringify(rs.map((r) => r.status)));
    t('concurrency: the losers got the same job or a plain "in progress", never an error', rs.every((r) => r.status === 200 || r.status === 409), JSON.stringify(rs.map((r) => r.status)));
    const dups = rs.filter((r) => r.json && r.json.duplicate).length;
    t('concurrency: all but one are marked duplicate', rs.filter((r) => r.status === 200).length - dups === 1, 'dups ' + dups);
  }
  {
    // Two different tokens racing: two jobs, and neither response shows the other's id.
    const { adapter, store } = mk();
    const a = await store.createOrder(); const b = await store.createOrder();
    const [ra, rb] = await Promise.all([
      call(api.start, { method: 'POST', body: GOOD(a.token, { site: 'one.example.com' }) }, { store, checkHost: okHost }),
      call(api.start, { method: 'POST', body: GOOD(b.token, { site: 'two.example.com' }) }, { store, checkHost: okHost })
    ]);
    t('two tokens at once start two jobs', jobKeys(adapter).length === 2 && ra.json.jobId !== rb.json.jobId);
    const oa = await call(api.order, { query: { token: a.token } }, { store });
    const ob = await call(api.order, { query: { token: b.token } }, { store });
    t('a used token only ever points at its own job', oa.json.reportPath === '/r/' + ra.json.jobId + '/' && ob.json.reportPath === '/r/' + rb.json.jobId + '/');
    const wrong = await call(api.start, { method: 'POST', body: GOOD(a.token, { site: 'two.example.com' }) }, { store, checkHost: okHost });
    t('a used token resubmitted with another site still returns only its own job', wrong.json.jobId === ra.json.jobId && wrong.json.jobId !== rb.json.jobId);
  }

  /* ---- start: bad links all look the same ---- */
  {
    const { store } = mk();
    const o = await store.createOrder();
    const unknown = await call(api.start, { method: 'POST', body: GOOD('a'.repeat(32)) }, { store, checkHost: okHost });
    const malformed = await call(api.start, { method: 'POST', body: GOOD('nope') }, { store, checkHost: okHost });
    const missing = await call(api.start, { method: 'POST', body: { site: 'example.com' } }, { store, checkHost: okHost });
    // expire it
    const old = await store.createOrder();
    const late = S.createStore(store.adapter, { now: () => Date.now() + 40 * 86400000 });
    const expired = await call(api.start, { method: 'POST', body: GOOD(old.token) }, { store: late, checkHost: okHost });
    const bodies = [unknown, malformed, missing, expired].map((r) => r.status + r.body);
    t('unknown, malformed, missing and expired tokens get the identical answer', new Set(bodies).size === 1 && unknown.status === 404, JSON.stringify(bodies));
    t('that answer says nothing about why', !/expired|used|unknown|invalid|found/i.test(unknown.json.message), unknown.body);
    const orderUnknown = await call(api.order, { query: { token: 'a'.repeat(32) } }, { store });
    const orderExpired = await call(api.order, { query: { token: old.token } }, { store: late });
    const orderBad = await call(api.order, { query: { token: '../../etc' } }, { store });
    t('the order lookup answers unknown, expired and malformed alike', new Set([orderUnknown, orderExpired, orderBad].map((r) => r.status + r.body)).size === 1 && orderUnknown.status === 404);
    const ready = await call(api.order, { query: { token: o.token } }, { store });
    t('a fresh token reads "ready"', ready.status === 200 && ready.json.state === 'ready');
  }

  /* ---- start: validation, nothing consumed ---- */
  {
    const { store } = mk();
    const o = await store.createOrder();
    const bad = await call(api.start, { method: 'POST', body: { token: o.token, site: 'not a site', name: '', email: 'nope', consent: false } }, { store, checkHost: okHost });
    t('invalid fields: 400 with a message per field', bad.status === 400 && bad.json.fields.site && bad.json.fields.name && bad.json.fields.email && bad.json.fields.consent, bad.body);
    t('a failed validation does not spend the token', (await store.getOrder(o.token)).status === 'unused');
    const emails = ['a@b', 'a b@example.com', 'a@example', '@example.com', 'a@@example.com', 'a..b@example.com', 'a@example.com,b@example.com', '"a"@example.com', 'a@example.com\nBcc: x@y.z', 'a'.repeat(300) + '@example.com', ''];
    for (const em of emails) {
      const r = await call(api.start, { method: 'POST', body: GOOD(o.token, { email: em }) }, { store, checkHost: okHost });
      t('email refused: ' + JSON.stringify(em).slice(0, 40), r.status === 400 && !!r.json.fields.email);
    }
    const consent = await call(api.start, { method: 'POST', body: GOOD(o.token, { consent: 'yes' }) }, { store, checkHost: okHost });
    t('consent must be exactly true', consent.status === 400 && !!consent.json.fields.consent);
    const sites = ['http://localhost', '127.0.0.1', 'http://169.254.169.254/', 'https://user:pw@example.com', 'file:///etc/passwd', 'example.com:8080'];
    for (const sx of sites) {
      const r = await call(api.start, { method: 'POST', body: GOOD(o.token, { site: sx }) }, { store, checkHost: okHost });
      t('site refused before any lookup: ' + sx, r.status === 400 && !!r.json.fields.site);
    }
    const priv = await call(api.start, { method: 'POST', body: GOOD(o.token) }, { store, checkHost: async () => ({ ok: false, kind: 'blocked_host' }) });
    t('a site that resolves to a private address is refused with a plain message', priv.status === 400 && /not a public website/.test(priv.json.fields.site));
    const nx = await call(api.start, { method: 'POST', body: GOOD(o.token) }, { store, checkHost: async () => ({ ok: false, kind: 'dns' }) });
    t('a site that does not exist is refused with a plain message', nx.status === 400 && /could not find/.test(nx.json.fields.site));
    t('refusals never spend the token', (await store.getOrder(o.token)).status === 'unused');
    const huge = await call(api.start, { method: 'POST', body: JSON.stringify({ token: o.token, pad: 'x'.repeat(9000) }) }, { store, checkHost: okHost });
    t('an oversized body is refused', huge.status === 400);
    const junk = await call(api.start, { method: 'POST', body: '{not json' }, { store, checkHost: okHost });
    t('a body that is not JSON is refused', junk.status === 400);
    const get = await call(api.handle, { method: 'GET', query: { a: 'start' } }, { store });
    t('start answers GET with 405', get.status === 405 && get.headers.allow === 'POST');
  }

  /* ---- per-domain limit: 2 at once ---- */
  {
    const { store } = mk();
    const toks = [];
    for (let i = 0; i < 4; i++) toks.push((await store.createOrder()).token);
    const rs = [];
    for (const tk of toks) rs.push(await call(api.start, { method: 'POST', body: GOOD(tk) }, { store, checkHost: okHost }));
    t('at most 2 jobs run for one domain; the third is told to wait', rs[0].status === 200 && rs[1].status === 200 && rs[2].status === 429 && rs[2].json.error === 'busy', rs.map((r) => r.status).join(','));
    t('a refused start does not spend the token', (await store.getOrder(toks[2])).status === 'unused');
    const other = await call(api.start, { method: 'POST', body: GOOD(toks[2], { site: 'other.example.org' }) }, { store, checkHost: okHost });
    t('the same token works for another domain', other.status === 200);
  }

  /* ---- step and status, with a fake site ---- */
  {
    const { store } = mk();
    const o = await store.createOrder();
    const s = await call(api.start, { method: 'POST', body: GOOD(o.token) }, { store, checkHost: okHost });
    const id = s.json.jobId;
    const log = [];
    const crawl = { fetch: fakeSiteFetch(log), sleep: sleepFast, now: (() => { let c = 1e9; return () => (c += 1100); })() };
    const st0 = await call(api.status, { query: { id } }, { store });
    t('status: queued job, no report path', st0.status === 200 && st0.json.status === 'queued' && st0.json.reportPath === null && st0.json.domain === 'example.com');
    let last = null;
    for (let i = 0; i < 6; i++) { last = await call(api.step, { method: 'POST', query: { id } }, { store, crawl }); if (last.json.reportPath) break; }
    t('step: the crawl finishes in a few calls', last.status === 200 && last.json.status === 'done' && last.json.reportPath === '/r/' + id + '/', last.body);
    t('step: counters in the response', last.json.progress.done === 4 && last.json.progress.total === 4);
    t('step: the response carries no contact data', !/grace|hopper|@/i.test(last.body));
    const st1 = await call(api.status, { query: { id } }, { store });
    t('status: done, with the expiry date', st1.json.status === 'done' && /^\d{4}-\d\d-\d\d/.test(st1.json.expiresAt));
    t('status: no contact data either', !/grace|hopper|@/i.test(st1.body));
    const nf = await call(api.status, { query: { id: 'c'.repeat(32) } }, { store });
    const bad = await call(api.status, { query: { id: 'zzz' } }, { store });
    t('status: unknown and malformed ids answer alike', nf.status === 404 && bad.status === 404 && nf.body === bad.body);
    const sGet = await call(api.handle, { method: 'GET', query: { a: 'step', id } }, { store });
    t('step answers GET with 405 (a link prefetcher cannot drive a crawl)', sGet.status === 405);
    const stepNf = await call(api.step, { method: 'POST', query: { id: 'd'.repeat(32) } }, { store, crawl });
    t('step on an unknown id answers generically', stepNf.status === 404 && stepNf.body === nf.body);
  }

  /* ---- email ---- */
  {
    const { adapter, store } = mk();
    const o = await store.createOrder();
    const s = await call(api.start, { method: 'POST', body: GOOD(o.token, { email: 'grace.hopper@mail.example.org' }) }, { store, checkHost: okHost });
    const id = s.json.jobId;
    const crawl = { fetch: fakeSiteFetch([]), sleep: sleepFast, now: (() => { let c = 1e9; return () => (c += 1100); })() };
    const env = { RESEND_API_KEY: 're_test_key', PRO_MAIL_FROM: 'Citehound <reports@mail.example.test>' };
    const sent = [];
    const fetchMail = async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; };

    const early = await call(api.email, { method: 'POST', body: { id } }, { store, env, fetch: fetchMail });
    t('email: refused while the report is not finished', early.status === 409 && sent.length === 0);
    for (let i = 0; i < 6; i++) await call(api.step, { method: 'POST', query: { id } }, { store, crawl });

    const off = await call(api.email, { method: 'POST', body: { id } }, { store, env: {}, fetch: fetchMail });
    t('email: "not configured" when the environment lacks the keys, and nothing is sent', off.status === 503 && off.json.error === 'not_configured' && sent.length === 0);
    const half = await call(api.email, { method: 'POST', body: { id } }, { store, env: { RESEND_API_KEY: 'x' }, fetch: fetchMail });
    t('email: one key is not enough', half.status === 503);

    const r1 = await call(api.email, { method: 'POST', body: { id, to: 'attacker@evil.example', email: 'attacker@evil.example', recipient: 'attacker@evil.example', cc: ['a@evil.example'], bcc: 'b@evil.example' }, query: { to: 'attacker@evil.example', email: 'attacker@evil.example' } }, { store, env, fetch: fetchMail });
    t('email: sent, and only to the address stored on the order', r1.status === 200 && sent.length === 1 && sent[0].body.to.length === 1 && sent[0].body.to[0] === 'grace.hopper@mail.example.org', JSON.stringify(sent[0] && sent[0].body.to));
    t('email: no cc, bcc or other recipient field reaches the provider', !('cc' in sent[0].body) && !('bcc' in sent[0].body) && JSON.stringify(sent[0].body).indexOf('evil.example') === -1);
    t('email: the response never contains the address', r1.body.indexOf('grace') === -1 && r1.body.indexOf('@') === -1 && /Sent to the address you gave us/.test(r1.json.message), r1.body);
    t('email: from comes from the environment, reply-to from the site config', sent[0].body.from === env.PRO_MAIL_FROM && sent[0].body.reply_to === 'hey@getcitehound.com');
    t('email: the key is sent as a bearer token to the provider only', sent[0].url === 'https://api.resend.com/emails' && sent[0].init.headers.Authorization === 'Bearer re_test_key');
    t('email: carries the report link and the expiry, no tracking pixel or image', sent[0].body.text.indexOf('https://getcitehound.com/r/' + id + '/') !== -1 && /until [A-Z][a-z]+ \d+, \d{4}/.test(sent[0].body.text) && !/<img|pixel|track/i.test(sent[0].body.html));
    const r2 = await call(api.email, { method: 'POST', body: { id } }, { store, env, fetch: fetchMail });
    const r3 = await call(api.email, { method: 'POST', body: { id } }, { store, env, fetch: fetchMail });
    const r4 = await call(api.email, { method: 'POST', body: { id } }, { store, env, fetch: fetchMail });
    t('email: three sends per order, then refused', r2.status === 200 && r3.status === 200 && r4.status === 429 && sent.length === 3 && r4.json.error === 'email_limit', [r2.status, r3.status, r4.status].join(','));
    t('email: the order records exactly 3 sends', (await store.getOrder(o.token)).emailSends === 3);
    const par = await Promise.all(Array.from({ length: 6 }, () => call(api.email, { method: 'POST', body: { id } }, { store, env, fetch: fetchMail })));
    t('email: after the limit, parallel requests send nothing', par.every((r) => r.status === 429) && sent.length === 3 && (await store.getOrder(o.token)).emailSends === 3);

    const unknown = await call(api.email, { method: 'POST', body: { id: 'e'.repeat(32) } }, { store, env, fetch: fetchMail });
    const noReverse = await (async () => { const jid = await store.createJob({ domain: 'orphan.example.com' }); await store.setJob(jid, { status: 'done' }); return call(api.email, { method: 'POST', body: { id: jid } }, { store, env, fetch: fetchMail }); })();
    t('email: an unknown job, or a job with no order, answers generically and sends nothing', unknown.status === 404 && noReverse.status === 404 && unknown.body === noReverse.body && sent.length === 3);
  }
  {
    // A provider failure does not use up one of the three.
    const { store } = mk();
    const o = await store.createOrder();
    const s = await call(api.start, { method: 'POST', body: GOOD(o.token) }, { store, checkHost: okHost });
    const id = s.json.jobId;
    const crawl = { fetch: fakeSiteFetch([]), sleep: sleepFast, now: (() => { let c = 1e9; return () => (c += 1100); })() };
    for (let i = 0; i < 6; i++) await call(api.step, { method: 'POST', query: { id } }, { store, crawl });
    const env = { RESEND_API_KEY: 'k', PRO_MAIL_FROM: 'a@b.example' };
    const failing = await call(api.email, { method: 'POST', body: { id } }, { store, env, fetch: async () => ({ ok: false, status: 500 }) });
    const throwing = await call(api.email, { method: 'POST', body: { id } }, { store, env, fetch: async () => { throw new Error('boom'); } });
    t('email: a provider error is reported and does not use up a send', failing.status === 502 && throwing.status === 502 && (await store.getOrder(o.token)).emailSends === 0);
    t('email: the error response does not reveal the address', failing.body.indexOf('@') === -1);
  }

  /* ---- the report page ---- */
  {
    const { store } = mk();
    const o = await store.createOrder();
    const s = await call(api.start, { method: 'POST', body: GOOD(o.token) }, { store, checkHost: okHost });
    const id = s.json.jobId;
    const running = await call(api.report, { query: { id } }, { store });
    t('report: a running job gets the progress screen', running.status === 200 && /data-pro-job/.test(running.body));
    const crawl = { fetch: fakeSiteFetch([]), sleep: sleepFast, now: (() => { let c = 1e9; return () => (c += 1100); })() };
    for (let i = 0; i < 6; i++) await call(api.step, { method: 'POST', query: { id } }, { store, crawl });
    const done = await call(api.report, { query: { id } }, { store, env: {} });
    t('report: a finished job renders the report with noindex and no referrer', done.status === 200 && /id="pr-estimate"/.test(done.body) && /noindex/.test(done.headers['x-robots-tag']) && done.headers['referrer-policy'] === 'no-referrer' && done.headers['cache-control'] === 'no-store', done.status + ' ' + done.body.slice(0, 80));
    t('report: no contact data in the page', !/grace|hopper|mail\.example\.org/i.test(done.body));
    t('report: no email button when the provider is not configured', done.body.indexOf('data-action="email"') === -1);
    const withMail = await call(api.report, { query: { id } }, { store, env: { RESEND_API_KEY: 'k', PRO_MAIL_FROM: 'a@b.example' } });
    t('report: the email button appears when it is configured', withMail.body.indexOf('data-action="email"') !== -1);
    const nf1 = await call(api.report, { query: { id: 'f'.repeat(32) } }, { store });
    const nf2 = await call(api.report, { query: { id: 'not-an-id' } }, { store });
    const nf3 = await call(api.report, { query: {} }, { store });
    t('report: unknown, malformed and missing ids all get the same generic 404', nf1.status === 404 && nf2.status === 404 && nf3.status === 404 && nf1.body === nf2.body && nf2.body === nf3.body && /noindex/.test(nf1.headers['x-robots-tag']));
  }

  /* ---- the start page ---- */
  {
    const { store } = mk();
    const o = await store.createOrder();
    const ready = await call(api.startPage, { query: { token: o.token } }, { store });
    t('start page: a ready link gets the form page, noindex and no referrer', ready.status === 200 && /id="psForm"/.test(ready.body) && /noindex/.test(ready.headers['x-robots-tag']) && ready.headers['referrer-policy'] === 'no-referrer');
    const s = await call(api.start, { method: 'POST', body: GOOD(o.token) }, { store, checkHost: okHost });
    const used = await call(api.startPage, { query: { token: o.token } }, { store });
    t('start page: a used link goes on to its own report, at once, no JavaScript needed', used.status === 302 && used.headers.location === '/r/' + s.json.jobId + '/', used.status + ' ' + used.headers.location);
    const other = await store.createOrder();
    const o2 = await call(api.startPage, { query: { token: other.token } }, { store });
    t('start page: another link still shows the form, never that job', o2.status === 200 && !/\/r\/[a-f0-9]{32}/.test(o2.body));
    const late = S.createStore(store.adapter, { now: () => Date.now() + 40 * 86400000 });
    const noFile = await call(api.startPage, { query: { token: other.token } }, { store, readFile: () => { throw new Error('ENOENT'); } });
    t('start page: if the page file is missing from the bundle, a ready link goes to the static copy', noFile.status === 302 && noFile.headers.location === '/app/pro-start?t=' + other.token);
    const bad = [await call(api.startPage, { query: { token: 'c'.repeat(32) } }, { store }), await call(api.startPage, { query: { token: 'nope' } }, { store }), await call(api.startPage, { query: {} }, { store }), await call(api.startPage, { query: { token: other.token } }, { store: late })];
    t('start page: unknown, malformed, missing and expired links get the identical generic page', bad.every((r) => r.status === 404 && r.body === bad[0].body && /This link is not available/.test(r.body) && !/expired|used|invalid/i.test(r.body.replace(/<[^>]+>/g, ' '))), bad.map((r) => r.status).join());
  }

  /* ---- a failed job gives the link back ---- */
  {
    const { store } = mk();
    const o = await store.createOrder();
    const s1 = await call(api.start, { method: 'POST', body: GOOD(o.token) }, { store, checkHost: okHost });
    const failedId = s1.json.jobId;
    const forbid = async (url, opt) => (url.endsWith('/robots.txt') ? { ok: true, status: 200, text: 'User-agent: *\nDisallow: /\n', headers: {}, finalUrl: url } : fakeSiteFetch([])(url, opt));
    const crawl = { fetch: forbid, sleep: sleepFast, now: (() => { let c = 1e9; return () => (c += 1100); })() };
    let last; for (let i = 0; i < 4; i++) { last = await call(api.step, { method: 'POST', query: { id: failedId } }, { store, crawl }); if (last.json.status === 'failed') break; }
    t('failed job: the step answer says failed and that the link is back', last.json.status === 'failed' && last.json.linkRestored === true && /robots\.txt/.test(last.json.reason), last.body);
    const stat = await call(api.status, { query: { id: failedId } }, { store });
    t('failed job: status says the same, with no report path', stat.json.linkRestored === true && stat.json.reportPath === null);
    const ord = await call(api.order, { query: { token: o.token } }, { store });
    t('the token reads ready again, and nothing in the answer names the failed job', ord.status === 200 && ord.json.state === 'ready' && ord.body.indexOf(failedId) === -1, ord.body);
    const pg = await call(api.startPage, { query: { token: o.token } }, { store });
    t('the start page shows the form again, not a redirect, and does not contain the failed job id', pg.status === 200 && /id="psForm"/.test(pg.body) && pg.body.indexOf(failedId) === -1 && !pg.headers.location);
    const bad = await call(api.start, { method: 'POST', body: GOOD(o.token, { email: 'nope' }) }, { store, checkHost: okHost });
    t('a start with a mistake on the restored token answers with the field errors only', bad.status === 400 && bad.body.indexOf(failedId) === -1);
    const rep = await call(api.report, { query: { id: failedId } }, { store });
    t('the failed job\'s own page says "Your link is still valid" and carries no token', rep.status === 200 && /Your link is still valid/.test(rep.body) && rep.body.indexOf(o.token) === -1 && !/mail\.example\.org|Grace/.test(rep.body));
    const mailOnFailed = await call(api.email, { method: 'POST', body: { id: failedId } }, { store, env: { RESEND_API_KEY: 'k', PRO_MAIL_FROM: 'a@b.example' }, fetch: async () => { throw new Error('must not send'); } });
    t('the failed job cannot be emailed', mailOnFailed.status === 409);
    const s2 = await call(api.start, { method: 'POST', body: GOOD(o.token, { site: 'another.example.org' }) }, { store, checkHost: okHost });
    t('the same token starts a new job for another site, and it is a different job', s2.status === 200 && s2.json.jobId !== failedId && !s2.json.duplicate, s2.body);
    const after = await call(api.order, { query: { token: o.token } }, { store });
    t('the token now leads to the new job only', after.json.reportPath === '/r/' + s2.json.jobId + '/');
    // the contact was kept through the restore (the new start rewrote it from the form, so check the intermediate order via a second failure)
    const o2 = await store.createOrder();
    const s3 = await call(api.start, { method: 'POST', body: GOOD(o2.token, { name: 'Kept Name', email: 'kept@mail.example.org' }) }, { store, checkHost: okHost });
    for (let i = 0; i < 4; i++) { const r = await call(api.step, { method: 'POST', query: { id: s3.json.jobId } }, { store, crawl }); if (r.json.status === 'failed') break; }
    const kept = await store.getOrder(o2.token);
    t('after the restore the order still holds the contact', kept.status === 'unused' && kept.contact.email === 'kept@mail.example.org' && kept.contact.name === 'Kept Name');
    // a partial job is not restored
    const o3 = await store.createOrder();
    const s4 = await call(api.start, { method: 'POST', body: GOOD(o3.token) }, { store, checkHost: okHost });
    const okCrawl = { fetch: fakeSiteFetch([]), sleep: sleepFast, now: (() => { let c = 1e9; return () => (c += 1100); })() };
    for (let i = 0; i < 6; i++) await call(api.step, { method: 'POST', query: { id: s4.json.jobId } }, { store, crawl: okCrawl });
    const done = await call(api.order, { query: { token: o3.token } }, { store });
    const dpage = await call(api.startPage, { query: { token: o3.token } }, { store });
    t('a finished job keeps its link spent: it points at the report', done.json.state === 'started' && dpage.status === 302);
  }

  /* ---- rate limits ---- */
  {
    const { store } = mk();
    const o = await store.createOrder();
    let status = 0;
    for (let i = 0; i < api.LIMITS.order.max + 3; i++) status = (await call(api.order, { query: { token: o.token }, ip: '198.51.100.9' }, { store })).status;
    t('order lookups are limited per caller', status === 429);
    t('another caller is not affected', (await call(api.order, { query: { token: o.token }, ip: '198.51.100.10' }, { store })).status === 200);
    let s2 = 0;
    for (let i = 0; i < api.LIMITS.start.max + 2; i++) s2 = (await call(api.start, { method: 'POST', body: { token: 'x' }, ip: '192.0.2.77' }, { store, checkHost: okHost })).status;
    t('start attempts are limited per caller', s2 === 429);
    t('counter keys hold a hash, never an address', !Object.keys(store.adapter._dump()).some((k) => /198\.51\.100|192\.0\.2|203\.0\.113/.test(k)));
    const k1 = H.callerKey({ headers: { 'x-forwarded-for': '198.51.100.9' } }, Date.UTC(2026, 9, 9));
    const k2 = H.callerKey({ headers: { 'x-forwarded-for': '198.51.100.9' } }, Date.UTC(2026, 9, 10));
    t('the caller key changes every day', k1 !== k2 && /^[a-f0-9]{32}$/.test(k1));
  }

  /* ---- dispatch ---- */
  {
    const { store } = mk();
    const unknown = await call(api.handle, { query: { a: 'admin' } }, { store });
    const proto = await call(api.handle, { query: { a: '__proto__' } }, { store });
    const none = await call(api.handle, { query: {} }, { store });
    t('unknown actions answer generically (including prototype names)', unknown.status === 404 && proto.status === 404 && none.status === 404);
  }

  /* ---- the store is not configured in production ---- */
  {
    const keep = Object.assign({}, process.env);
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN'].forEach((k) => delete process.env[k]);
    process.env.VERCEL = '1'; S.resetSharedStore(null);
    const r = await call(api.handle, { method: 'GET', query: { a: 'status', id: 'a'.repeat(32) } });
    t('production without Redis: a clear 503, not a crash', r.status === 503 && r.json.error === 'storage_not_configured');
    t('... and the log names the missing variables', logged.some((l) => /KV_REST_API_URL/.test(l)));
    Object.keys(process.env).forEach((k) => { if (!(k in keep)) delete process.env[k]; }); Object.assign(process.env, keep); S.resetSharedStore(null);
  }

  /* ---- the log ---- */
  {
    const text = logged.join('\n');
    t('nothing a person typed reached the log (no name, email, token or address)', !/grace|hopper|evil\.example|203\.0\.113|198\.51\.100|192\.0\.2|[a-f0-9]{32}/i.test(text), text.slice(0, 300));
  }

  out('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
}()).catch((e) => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
