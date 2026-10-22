#!/usr/bin/env node
/* =====================================================================
   scripts/test-api-v1.js

   The Citehound API, /v1 (lib/api-v1/*, api/v1/[...path].js), with an in-memory store, a fake scan and a fake mail provider: no network, no real key, no real address.

   - the function count: the API is ONE function, and the Hobby plan's 12 are not exceeded;
   - keys: the key is only in the email, never in the HTTP answer, a log or the store (only a hash); marketing_optin is stored apart and only when true; every address gets the same
     answer; per-address, per-email and per-network limits; a failed email gives the key back; a revoke link needs its signature and revokes with one POST;
   - authentication: Bearer or X-Citehound-Key, 401 and 403 as JSON, wrong keys are throttled, the pepper is required, the admin plan route is a 404 while ADMIN_TOKEN is unset or short;
   - limits: free 20 an hour and 100 a day, pro more, the same domain 4 an hour across keys, Retry-After and X-RateLimit headers, counters that expire;
   - input: the domain checks (no scheme, port, credentials, IPs, internal names) answer 400 before anything is fetched; the generators validate their lists;
   - the router: unknown paths, methods, OPTIONS, no CORS headers, every documented path is routed and every routed path is documented;
   - openapi.yaml: current, parses back to the registry's document, validates against the OpenAPI 3.1 JSON Schema (scripts/fixtures/oas-3.1-schema.json, from spec.openapis.org),
     its $refs resolve and its operation ids are unique;
   - /api and /openapi.yaml are served by vercel.json and listed in the sitemap and llms.txt only.

     node scripts/test-api-v1.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const Api = require('../lib/api-v1/index.js');
const Keys = require('../lib/api-v1/keys.js');
const Limits = require('../lib/api-v1/limits.js');
const Data = require('../lib/api-v1/data.js');
const OA = require('../lib/api-v1/openapi.js');
const Gen = require('./generate-api-page.js');
const store = require('../lib/pro-store.js');
const scanner = require('../lib/scanner.js');

let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

// Everything the code logs is captured: a key, an address or a network address must not be in it.
const logged = [];
['log', 'warn', 'error', 'info'].forEach((k) => { console[k] = function () { logged.push(Array.prototype.slice.call(arguments).map(String).join(' ')); }; });

/* ---------- the harness ---------- */

const PEPPER = 'test-pepper-' + 'x'.repeat(40);
const ENV = { API_KEY_PEPPER: PEPPER, RESEND_API_KEY: 're_test_not_real', PRO_MAIL_FROM: 'Citehound <keys@example.test>', ADMIN_TOKEN: 'admin-token-for-tests-only' };
let clock = Date.UTC(2026, 9, 22, 12, 0, 0);
const A = store.memoryAdapter({ now: () => clock });
const mails = [];
let mailOk = true;
const fakeFetch = async (url, init) => {
  const body = JSON.parse(init.body);
  mails.push({ url: url, auth: init.headers.Authorization, to: body.to[0], subject: body.subject, text: body.text, html: body.html });
  return { ok: mailOk, status: mailOk ? 200 : 500 };
};
let scanCalls = 0, infoCalls = 0;
const crawl = JSON.parse(read('content/pro/sample-report.json'));
function fakeScan() {
  const sig = scanner.parseSignals(read('claude.html'));
  const result = scanner.scoreAll(true, true, true, crawl.siteContext.botResults, sig);
  const names = ['GPTBot', 'ClaudeBot', 'Bytespider', 'CCBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'meta-externalagent', 'Amazonbot', 'cohere-ai'];
  const botResults = names.map((n, i) => ({ name: n, state: i < 6 ? 'open' : (i < 8 ? 'partial' : 'blocked'), rule: i >= 6 ? 'Disallow: /' : null }));
  return { ok: true, robotsOk: true, botResults: botResults, result: result };
}
const deps = {
  env: ENV, adapter: A, fetch: fakeFetch, now: () => clock,
  scanPage: async (url, opts) => { scanCalls++; if (/fail\.example/.test(url)) return { ok: false, stage: 'robots', kind: 'timeout' }; return fakeScan(); },
  fetchSiteInfo: async (d) => { infoCalls++; return d === 'down.invalid-host.com' ? { ok: false, detail: 'unreachable' } : { ok: true, siteInfo: { title: 'Example Co', description: 'Project software for small design studios.', lang: 'en', url: 'https://' + d + '/', name: 'Example Co' } }; }
};

function request(method, url, o) {
  o = o || {};
  const headers = Object.assign({ 'x-forwarded-for': o.ip || '198.51.100.1' }, o.headers || {});
  if (o.json !== undefined) { headers['content-type'] = 'application/json'; }
  const req = { method: method, url: url, headers: headers, query: o.query };
  if (o.json !== undefined) req.body = typeof o.json === 'string' ? o.json : JSON.stringify(o.json);
  if (o.rawBody !== undefined) req.body = o.rawBody;
  return new Promise((resolve, reject) => {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return this.headers[String(k).toLowerCase()]; },
      end(b) { let json = null; try { json = JSON.parse(b); } catch (e) { /* html */ } resolve({ status: this.statusCode, headers: this.headers, text: b || '', json: json }); } };
    Api.handle(req, res, o.deps || deps).catch(reject);
  });
}
const get = (url, key, o) => request('GET', url, Object.assign({ headers: key ? { authorization: 'Bearer ' + key } : {} }, o || {}));
let ipN = 10;
const freshIp = () => '203.0.113.' + (ipN++);
async function newKey(email, o) {
  const before = mails.length;
  const r = await request('POST', '/v1/keys', { json: Object.assign({ email: email }, o || {}), ip: freshIp() });
  if (r.status !== 202 || mails.length !== before + 1) return { r: r, key: null };
  const m = /chk_[A-Za-z0-9_-]{32}/.exec(mails[mails.length - 1].text);
  return { r: r, key: m && m[0], mail: mails[mails.length - 1] };
}
const bad = (s) => s >= 400;

(async function main() {
  /* ---------- the function count ---------- */
  out('function count');
  const fnFiles = [];
  (function walk(dir) { fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach((e) => { if (e.isDirectory()) walk(dir + '/' + e.name); else if (/\.js$/.test(e.name) && e.name[0] !== '_') fnFiles.push(dir + '/' + e.name); }); })('api');
  t('the Hobby plan has 12 functions and this change makes exactly 12', fnFiles.length === 12, fnFiles.length + ': ' + fnFiles.join(', '));
  t('the API is one catch-all function', fnFiles.filter((f) => /^api\/v1\//.test(f)).join() === 'api/v1/[...path].js');
  t('the function file only hands over to the router', /require\('\.\.\/\.\.\/lib\/api-v1\/index\.js'\)\.handle\(req, res\)/.test(read('api/v1/[...path].js')) && read('api/v1/[...path].js').split('\n').length < 12);
  const vj = JSON.parse(read('vercel.json'));
  t('vercel.json gives the function its own duration', vj.functions && vj.functions['api/v1/[...path].js'] && vj.functions['api/v1/[...path].js'].maxDuration >= 30);
  t('vercel.json routes /v1/* to the function and /api to the page', (vj.rewrites || []).some((r) => r.source === '/v1/:path*' && r.destination === '/api/v1/:path*') && (vj.rewrites || []).some((r) => r.source === '/api' && r.destination === '/api.html'));
  t('vercel.json serves /openapi.yaml as YAML', (vj.headers || []).some((h) => h.source === '/openapi.yaml' && h.headers.some((x) => /yaml/.test(x.value))));
  t('the sitemap and llms.txt list /api, the footer does not', read('sitemap.xml').indexOf('<loc>https://getcitehound.com/api</loc>') !== -1 && read('llms.txt').indexOf('(https://getcitehound.com/api)') !== -1 && require('../lib/site-footer.js').hrefs().indexOf('/api') === -1);
  t('no CORS header is written anywhere in the API code', !/Access-Control-Allow/i.test(read('lib/api-v1/index.js') + read('lib/api-v1/keys.js') + read('lib/api-v1/limits.js') + read('lib/api-v1/data.js') + read('lib/api-v1/mail.js') + read('api/v1/[...path].js')));
  t('keys are compared in constant time', /timingSafeEqual/.test(read('lib/api-v1/keys.js')) && /timingSafeEqual/.test(read('lib/api-v1/index.js')));

  /* ---------- configuration ---------- */
  out('configuration');
  const noPepper = await request('GET', '/v1/me', { deps: Object.assign({}, deps, { env: { RESEND_API_KEY: 'x', PRO_MAIL_FROM: 'y' } }), headers: { authorization: 'Bearer chk_' + 'a'.repeat(32) } });
  t('without API_KEY_PEPPER every route answers 503', noPepper.status === 503 && noPepper.json && noPepper.json.error === 'not_configured');
  const shortPepper = await request('GET', '/v1/benchmark', { deps: Object.assign({}, deps, { env: Object.assign({}, ENV, { API_KEY_PEPPER: 'short' }) }) });
  t('a pepper under 32 characters is refused', shortPepper.status === 503);
  const noMail = await request('POST', '/v1/keys', { json: { email: 'a@example.com' }, deps: Object.assign({}, deps, { env: { API_KEY_PEPPER: PEPPER } }), ip: freshIp() });
  t('without the mail settings a key request answers 503 and stores nothing', noMail.status === 503 && !Object.keys(A._dump()).some((k) => /^api:k:/.test(k)));
  const opt = await request('OPTIONS', '/v1/scan');
  t('OPTIONS answers 204 with no CORS headers', opt.status === 204 && !Object.keys(opt.headers).some((h) => /^access-control/.test(h)));

  /* ---------- keys ---------- */
  out('keys');
  const logBefore = logged.length;
  const k1 = await newKey('Reader@Example.com', {});
  t('POST /v1/keys answers 202 and sends one email', k1.r.status === 202 && mails.length === 1 && !!k1.key, JSON.stringify(k1.r.json));
  t('the answer never contains the key', k1.r.text.indexOf(k1.key) === -1 && k1.r.json.status === 'accepted');
  t('the email goes to Resend only, with the key, a header example, the docs and a revoke link', mails[0].url === 'https://api.resend.com/emails' && /^Bearer re_/.test(mails[0].auth) && mails[0].to === 'Reader@Example.com' && mails[0].text.indexOf('Authorization: Bearer ' + k1.key) !== -1 && /\/v1\/keys\/revoke\/[0-9a-f]{20}\.[0-9a-f]{32}/.test(mails[0].text) && mails[0].text.indexOf('https://getcitehound.com/api') !== -1);
  t('the email is transactional: no marketing, no tracking', !/unsubscribe|newsletter|offer|<img/i.test(mails[0].html + mails[0].text));
  const dump1 = JSON.stringify(A._dump());
  t('the store holds no plaintext key, address or network address', dump1.indexOf(k1.key) === -1 && !/reader@example\.com/i.test(dump1) && dump1.indexOf('203.0.113.') === -1 && dump1.indexOf('198.51.100.') === -1);
  const rec = await A.hgetall('api:k:' + Keys.keyHash(PEPPER, k1.key));
  t('the key record is a hash with the free plan, a masked address and no key', rec && rec.plan === 'free' && rec.status === 'active' && rec.maskedEmail === 'r***@example.com' && JSON.stringify(rec).indexOf(k1.key) === -1);
  t('the hash is peppered: another pepper gives another hash', Keys.keyHash(PEPPER, k1.key) !== Keys.keyHash(PEPPER + '2', k1.key) && Keys.keyHash(PEPPER, k1.key) !== require('crypto').createHash('sha256').update(k1.key).digest('hex'));
  t('marketing_optin defaults to false: no marketing record', !Object.keys(A._dump()).some((k) => /^api:mk:/.test(k)));
  const k2 = await newKey('optin@example.org', { marketing_optin: true });
  const mk = Object.keys(A._dump()).filter((k) => /^api:mk:/.test(k));
  t('marketing_optin true is stored apart, with its date and source', k2.key && mk.length === 1 && (await A.hgetall(mk[0])).email === 'optin@example.org' && (await A.hgetall(mk[0])).source === 'api-key');
  t('the key record does not carry the opt-in address', JSON.stringify(await A.hgetall('api:k:' + Keys.keyHash(PEPPER, k2.key))).indexOf('optin@example.org') === -1);

  const badBodies = [['no email', {}], ['not an address', { email: 'nope' }], ['two addresses', { email: 'a@example.com,b@example.com' }], ['header injection', { email: 'a@example.com\r\nBcc: x@example.com' }], ['an array', { email: ['a@example.com'] }], ['too long', { email: 'a'.repeat(250) + '@example.com' }], ['optin as a string', { email: 'a@example.com', marketing_optin: 'yes' }]];
  for (const [name, body] of badBodies) { const m0 = mails.length; const r = await request('POST', '/v1/keys', { json: body, ip: freshIp() }); t('rejects: ' + name, r.status === 400 && r.json.error === 'invalid_request' && mails.length === m0, r.status + ' ' + r.text.slice(0, 80)); }
  t('rejects a body that is not JSON', (await request('POST', '/v1/keys', { rawBody: 'email=a@example.com', headers: { 'content-type': 'application/x-www-form-urlencoded' }, ip: freshIp() })).status === 415);
  t('rejects invalid JSON', (await request('POST', '/v1/keys', { json: '{bad', ip: freshIp() })).status === 400);
  t('rejects a body over 4 KB', (await request('POST', '/v1/keys', { json: { email: 'a@example.com', pad: 'x'.repeat(5000) }, ip: freshIp() })).status === 413);
  t('GET /v1/keys is a 405 with Allow', await get('/v1/keys').then((r) => r.status === 405 && r.headers.allow === 'POST'));

  mailOk = false;
  const sizeBefore = A._size();
  const failedMail = await request('POST', '/v1/keys', { json: { email: 'fails@example.com' }, ip: freshIp() });
  const failedKey = /chk_[A-Za-z0-9_-]{32}/.exec(mails[mails.length - 1].text)[0];
  mailOk = true;
  t('a failed email answers 502 and the key is given back (it no longer works)', failedMail.status === 502 && failedMail.json.error === 'mail_failed' && (await get('/v1/me', failedKey)).status === 401);
  t('a failed email leaves no key record behind', !Object.keys(A._dump()).some((k) => /^api:k:/.test(k) && JSON.stringify(A._dump()[k]).indexOf('f***@example.com') !== -1));

  // the same answer for a known and a new address, and for a limit
  const sameIp = freshIp();
  const e1 = await request('POST', '/v1/keys', { json: { email: 'many@example.com' }, ip: sameIp });
  const e2 = await request('POST', '/v1/keys', { json: { email: 'many@example.com' }, ip: freshIp() });
  const e3 = await request('POST', '/v1/keys', { json: { email: 'many@example.com' }, ip: freshIp() });
  const mBefore = mails.length;
  const e4 = await request('POST', '/v1/keys', { json: { email: 'many@example.com' }, ip: freshIp() });
  t('an address gets at most 3 active keys; the fourth answer is identical and sends nothing', e1.text === e2.text && e2.text === e3.text && e3.text === e4.text && mails.length === mBefore);
  const mBefore2 = mails.length;
  for (let i = 0; i < 4; i++) await request('POST', '/v1/keys', { json: { email: 'hourly@example.com' }, ip: freshIp() });
  t('per-email hourly limit stays silent (same answer, no extra mail)', mails.length - mBefore2 === 3);
  const fixedIp = freshIp(); let last = null;
  for (let i = 0; i < 6; i++) last = await request('POST', '/v1/keys', { json: { email: 'ip' + i + '@example.com' }, ip: fixedIp });
  t('one network address may ask 5 times an hour; the sixth is a 429 with Retry-After', last.status === 429 && Number(last.headers['retry-after']) > 0 && last.json.error === 'rate_limited' && last.json.limit_scope === 'ip');

  /* ---------- authentication ---------- */
  out('authentication');
  const me = await get('/v1/me', k1.key);
  t('GET /v1/me with a Bearer key: plan, limits, usage, masked email', me.status === 200 && me.json.plan === 'free' && me.json.email === 'r***@example.com' && me.json.limits.requests_per_hour === 20 && me.json.limits.requests_per_day === 100 && me.json.limits.scans_per_domain_per_hour === 4 && me.json.usage.this_hour === 1 && me.json.usage.today === 1, me.text);
  t('the answer never shows the full address or any key', me.text.toLowerCase().indexOf('reader@example.com') === -1 && me.text.indexOf(k1.key) === -1);
  t('X-Citehound-Key works too', (await request('GET', '/v1/me', { headers: { 'x-citehound-key': k1.key } })).status === 200);
  t('rate-limit headers are set', me.headers['x-ratelimit-limit'] === '20' && Number(me.headers['x-ratelimit-remaining']) === 19 && Number(me.headers['x-ratelimit-reset']) > 0);
  t('answers carry no CORS header, no cookie and are not cached', !Object.keys(me.headers).some((h) => /^access-control|^set-cookie/.test(h)) && /no-store/.test(me.headers['cache-control']));
  const none = await get('/v1/me');
  t('no key: 401 JSON with WWW-Authenticate', none.status === 401 && none.json.error === 'missing_key' && /Bearer/.test(none.headers['www-authenticate']));
  const wrong = await get('/v1/me', 'chk_' + 'z'.repeat(32));
  t('wrong key: 401 JSON', wrong.status === 401 && wrong.json.error === 'invalid_key');
  t('a malformed key is a 401, not an error', (await get('/v1/me', 'not a key')).status === 401 && (await get('/v1/me', 'chk_' + 'a'.repeat(200))).status === 401);
  t('a Bearer key in a different scheme is not accepted', (await request('GET', '/v1/me', { headers: { authorization: 'Basic ' + k1.key } })).status === 401);
  const guessIp = freshIp(); let blocked = null;
  for (let i = 0; i < 22; i++) blocked = await request('GET', '/v1/me', { headers: { authorization: 'Bearer chk_' + String(i).padStart(32, 'q') }, ip: guessIp });
  t('twenty wrong keys from one address block that address (429 with Retry-After), even for a right key', blocked.status === 429 && Number(blocked.headers['retry-after']) > 0 && (await request('GET', '/v1/me', { headers: { authorization: 'Bearer ' + k1.key }, ip: guessIp })).status === 429);

  /* ---------- the revoke link ---------- */
  out('revoke');
  const tokenOf = (m) => /\/v1\/keys\/revoke\/([0-9a-f.]+)/.exec(m.text)[1];
  const kr = await newKey('revoker@example.com', {});
  const tok = tokenOf(kr.mail);
  const page = await request('GET', '/v1/keys/revoke/' + tok);
  t('the revoke link opens a page with one button and does not revoke by itself', page.status === 200 && /<form method="post"/.test(page.text) && (await get('/v1/me', kr.key)).status === 200);
  t('a tampered or malformed link is a 404 page', (await request('GET', '/v1/keys/revoke/' + tok.slice(0, -1) + (tok.slice(-1) === '0' ? '1' : '0'))).status === 404 && (await request('POST', '/v1/keys/revoke/' + tok.slice(0, 20) + '.' + '0'.repeat(32))).status === 404 && (await request('GET', '/v1/keys/revoke/abc')).status === 404);
  const rv = await request('POST', '/v1/keys/revoke/' + tok);
  t('POST on the link revokes the key', rv.status === 200 && /revoked/i.test(rv.text));
  const after = await get('/v1/me', kr.key);
  t('a revoked key answers 403 key_revoked', after.status === 403 && after.json.error === 'key_revoked');
  const revRec = await A.hgetall('api:k:' + Keys.keyHash(PEPPER, kr.key));
  const revTtl = await A.ttl('api:k:' + Keys.keyHash(PEPPER, kr.key));
  t('a revoked record keeps no address hash and no masked address, and expires in 90 days', revRec.status === 'revoked' && revRec.emailHash === '' && revRec.maskedEmail === '' && revTtl > 89 * 86400 && revTtl <= 90 * 86400, JSON.stringify(revRec) + ' ' + revTtl);
  t('revoking drops the key from its address\'s list (it no longer counts toward the 3 keys)', (await A.smembers('api:em:' + Keys.emailHash(PEPPER, 'revoker@example.com'))).length === 0);
  const mkKey = Object.keys(A._dump()).filter((k) => /^api:mk:/.test(k))[0];
  const mkTtl = await A.ttl(mkKey);
  t('the marketing opt-in record expires after 12 months', mkTtl > 364 * 86400 && mkTtl <= 365 * 86400, String(mkTtl));
  t('revoking twice is harmless', (await request('POST', '/v1/keys/revoke/' + tok)).status === 200);

  /* ---------- admin plan ---------- */
  out('plan');
  const adminOff = await request('POST', '/v1/admin/plan', { deps: Object.assign({}, deps, { env: Object.assign({}, ENV, { ADMIN_TOKEN: 'short' }) }), headers: { authorization: 'Bearer short' }, json: { email: 'reader@example.com', plan: 'pro' } });
  t('the admin route is a 404 while ADMIN_TOKEN is under 16 characters', adminOff.status === 404);
  const adminUnset = await request('POST', '/v1/admin/plan', { deps: Object.assign({}, deps, { env: { API_KEY_PEPPER: PEPPER } }), json: { email: 'reader@example.com', plan: 'pro' } });
  t('the admin route is a 404 while ADMIN_TOKEN is unset', adminUnset.status === 404);
  t('a wrong admin token is 401 and a key is not an admin token', (await request('POST', '/v1/admin/plan', { headers: { authorization: 'Bearer wrong-token-wrong-token' }, json: { email: 'reader@example.com', plan: 'pro' } })).status === 401 && (await request('POST', '/v1/admin/plan', { headers: { authorization: 'Bearer ' + k1.key }, json: { email: 'reader@example.com', plan: 'pro' } })).status === 401);
  t('a customer cannot choose a plan any other way', (await request('POST', '/v1/keys', { json: { email: 'self@example.com', plan: 'pro' }, ip: freshIp() })).status === 202 && (await get('/v1/me', (await newKey('self2@example.com', { plan: 'pro' })).key)).json.plan === 'free');
  t('the admin token sets a plan (and validates it)', (await request('POST', '/v1/admin/plan', { headers: { authorization: 'Bearer ' + ENV.ADMIN_TOKEN }, json: { email: 'reader@example.com', plan: 'gold' } })).status === 400);
  const setPro = await request('POST', '/v1/admin/plan', { headers: { authorization: 'Bearer ' + ENV.ADMIN_TOKEN }, json: { email: 'Reader@Example.com', plan: 'pro' } });
  const mePro = await get('/v1/me', k1.key);
  t('after the admin call the key is pro with higher limits', setPro.status === 200 && setPro.json.keys_changed === 1 && mePro.json.plan === 'pro' && mePro.json.limits.requests_per_hour === 200 && mePro.json.limits.requests_per_day === 2000, setPro.text);

  /* ---------- the scan endpoints ---------- */
  out('scan endpoints');
  const ks = (await newKey('scanner@example.com', {})).key;
  await request('POST', '/v1/admin/plan', { headers: { authorization: 'Bearer ' + ENV.ADMIN_TOKEN }, json: { email: 'scanner@example.com', plan: 'pro' } });
  const sc = await get('/v1/scan?domain=Example-One.com', ks);
  t('GET /v1/scan: score, three pillars that add up, failed checks with fixes, ten crawlers, benchmark', sc.status === 200 && sc.json.domain === 'example-one.com' && Number.isInteger(sc.json.score) && sc.json.pillars.length === 3 && sc.json.pillars.reduce((n, p) => n + p.score, 0) === sc.json.score && sc.json.crawlers.length === 10 && sc.json.benchmark && sc.json.benchmark.sitesScanned > 0, sc.text.slice(0, 200));
  t('every failed check has a label, points and a fix', sc.json.failed.every((f) => f.label && typeof f.points === 'number' && f.fix) );
  t('crawler states are open, limited or blocked', sc.json.crawlers.every((c) => ['open', 'limited', 'blocked'].indexOf(c.state) !== -1) && sc.json.crawlerSummary.open + sc.json.crawlerSummary.limited + sc.json.crawlerSummary.blocked === 10);
  t('the answer says it is a readiness score and links the method', /does not measure whether any assistant names a brand/.test(sc.json.note) && /methodology/.test(sc.json.method));
  t('the answer uses no ranking or guarantee words', !/\b(rank|ranking|guarantee|promise)/i.test(sc.text));
  t('the scanner is called with an https URL of the bare domain', scanCalls === 1);
  t('failed reads are a 502 JSON, not a score', await get('/v1/scan?domain=fail.example.com', ks).then((r) => r.status === 502 && r.json.error === 'scan_failed' && !('score' in r.json)));
  const cmp = await get('/v1/compare?a=alpha-site.com&b=beta-site.com', ks);
  t('GET /v1/compare: both summaries and a differences list', cmp.status === 200 && cmp.json.a.domain === 'alpha-site.com' && cmp.json.b.domain === 'beta-site.com' && Array.isArray(cmp.json.differences));
  t('compare needs two different domains', (await get('/v1/compare?a=alpha-site.com&b=alpha-site.com', ks)).status === 400 && (await get('/v1/compare?a=alpha-site.com', ks)).status === 400);
  const cr = await get('/v1/crawlers?domain=crawl-site.com', ks);
  t('GET /v1/crawlers: ten states and a summary', cr.status === 200 && cr.json.crawlers.length === 10 && cr.json.summary.open === 6);
  const llms = await get('/v1/generate/llms-txt?name=Example%20Co&description=Project%20software&page=' + encodeURIComponent('https://example.com/pricing|Plans and prices'), ks);
  t('GET /v1/generate/llms-txt builds the file from the fields', llms.status === 200 && llms.json.type === 'llms.txt' && /^# Example Co/.test(llms.json.content) && llms.json.content.indexOf('https://example.com/pricing') !== -1 && /no demonstrated effect on Google/.test(llms.json.note));
  const llmsPost = await request('POST', '/v1/generate/llms-txt', { headers: { authorization: 'Bearer ' + ks }, json: { name: 'Example Co', description: 'Project software', pages: [{ url: 'https://example.com/a', description: 'A page' }] } });
  t('POST /v1/generate/llms-txt takes JSON', llmsPost.status === 200 && llmsPost.json.pages.length === 1);
  t('llms-txt rejects a missing name, a javascript: URL and over 20 pages', (await get('/v1/generate/llms-txt?description=x', ks)).status === 400 && (await get('/v1/generate/llms-txt?name=A&description=B&page=' + encodeURIComponent('javascript:alert(1)|x'), ks)).status === 400 &&
    (await request('POST', '/v1/generate/llms-txt', { headers: { authorization: 'Bearer ' + ks }, json: { name: 'A', description: 'B', pages: Array.from({ length: 21 }, (_, i) => ({ url: 'https://example.com/' + i, description: 'p' })) } })).status === 400);
  const rb = await get('/v1/generate/robots-txt?allow=GPTBot,ClaudeBot&block=Bytespider&sitemap=' + encodeURIComponent('https://example.com/sitemap.xml'), ks);
  t('GET /v1/generate/robots-txt: allow, block and sitemap', rb.status === 200 && /User-agent: GPTBot\s+Allow: \//.test(rb.json.content) && /User-agent: Bytespider\s+Disallow: \//.test(rb.json.content) && /Sitemap: https:\/\/example.com\/sitemap.xml/.test(rb.json.content));
  t('robots-txt rejects an unknown crawler, a name on both lists, and a bad sitemap', (await get('/v1/generate/robots-txt?allow=NotACrawler', ks)).status === 400 && (await get('/v1/generate/robots-txt?allow=GPTBot&block=GPTBot', ks)).status === 400 && (await get('/v1/generate/robots-txt?allow=GPTBot&sitemap=javascript:x', ks)).status === 400);
  t('robots-txt POST takes arrays', (await request('POST', '/v1/generate/robots-txt', { headers: { authorization: 'Bearer ' + ks }, json: { allow: ['GPTBot'], block: ['CCBot'] } })).status === 200);
  const sch = await get('/v1/generate/schema?domain=schema-site.com&type=organization', ks);
  t('GET /v1/generate/schema: JSON-LD built from the homepage info', sch.status === 200 && sch.json.type === 'organization' && sch.json.json_ld && infoCalls === 1, sch.text.slice(0, 160));
  t('schema rejects an unknown type and an invalid domain', (await get('/v1/generate/schema?domain=schema-site.com&type=cookbook', ks)).status === 400 && (await get('/v1/generate/schema?domain=localhost&type=organization', ks)).status === 400);
  const bm = await get('/v1/benchmark', ks);
  t('GET /v1/benchmark: categories and the overall average', bm.status === 200 && bm.json.categories.length >= 6 && bm.json.overall.overallAverage > 0);
  const cat = bm.json.categories[0].category;
  const bmc = await get('/v1/benchmark?category=' + encodeURIComponent(cat), ks);
  t('GET /v1/benchmark?category= returns one category', bmc.status === 200 && bmc.json.category === cat);
  t('an unknown category is a 404 JSON', await get('/v1/benchmark?category=nope', ks).then((r) => r.status === 404 && r.json.error));

  /* ---------- input checks and SSRF ---------- */
  out('input and SSRF');
  const cases = { 'example.com': 'example.com', 'WWW.Example.COM': 'example.com', 'sub.example.co.uk': 'sub.example.co.uk', 'xn--bcher-kva.example': null,
    'localhost': null, '127.0.0.1': null, '[::1]': null, '::1': null, '10.0.0.1': null, '169.254.169.254': null, '192.168.1.1': null, '0x7f000001': null, '2130706433': null, '017700000001': null,
    'http://example.com': null, 'https://example.com': null, 'example.com/path': null, 'example.com?x=1': null, 'example.com#x': null, 'example.com:8080': null, 'example.com:443': null, 'user@example.com': null, 'user:pass@example.com': null,
    'exa mple.com': null, 'example..com': null, '.example.com': null, 'example.com.': null, '-bad.example.com': null, ['a'.repeat(64) + '.com']: null, 'example': null, 'foo.local': null, 'foo.internal': null, 'foo.localhost': null, 'foo.lan': null, 'foo.test': null, '': null, '   ': null, 'exam\nple.com': null, 'example.com\r\nHost: evil.com': null, 'ex%61mple.com': null, 'münchen.de': null };
  Object.keys(cases).forEach((k) => { const got = Data.validDomain(k); t('validDomain(' + JSON.stringify(k) + ') -> ' + JSON.stringify(cases[k]), got === cases[k], String(got)); });
  t('validDomain refuses non-strings', Data.validDomain(null) === null && Data.validDomain(['example.com']) === null && Data.validDomain({}) === null && Data.validDomain(12) === null);
  const callsBefore = scanCalls, infoBefore = infoCalls;
  const hostile = ['localhost', '127.0.0.1', '169.254.169.254', '10.0.0.5', 'http://example.com', 'example.com:8080', 'user:pass@example.com', 'example.com/../admin', '[::1]', 'metadata.google.internal'];
  for (const h of hostile) {
    const r = await get('/v1/scan?domain=' + encodeURIComponent(h), ks);
    const r2 = await get('/v1/generate/schema?type=organization&domain=' + encodeURIComponent(h), ks);
    t('scan and schema refuse ' + JSON.stringify(h) + ' with 400 before any fetch', r.status === 400 && r2.status === 400 && r.json.error === 'invalid_domain');
  }
  t('nothing was fetched for any refused domain', scanCalls === callsBefore && infoCalls === infoBefore);
  const dupe = await get('/v1/scan?domain=a-one.com&domain=b-one.com', ks);
  t('a repeated domain parameter is refused (no fetch)', dupe.status === 400 && scanCalls === callsBefore);
  const scannerSrc = read('lib/scanner.js');
  t('the scan and the homepage read go through the guarded fetch', /safe-fetch/.test(scannerSrc) && !/\bfetch\(/.test(read('lib/api-v1/data.js').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
  t('the API code makes no request of its own except the one mail call', ['index.js', 'keys.js', 'limits.js', 'data.js'].every((f) => !/\bfetch\(|http\.request|https\.request|net\.connect/.test(read('lib/api-v1/' + f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))) && (read('lib/api-v1/mail.js').match(/fetch\)\(/g) || []).length === 1 && /'https:\/\/api\.resend\.com\/emails'/.test(read('lib/api-v1/mail.js')));
  t('the mail call sends no credential of a caller anywhere else', mails.every((m) => m.url === 'https://api.resend.com/emails'));

  /* ---------- limits ---------- */
  out('limits');
  const kl = (await newKey('limited@example.com', {})).key;
  const lim = [];
  for (let i = 0; i < 21; i++) lim.push(await get('/v1/benchmark', kl, { ip: freshIp() }));
  const l20 = lim[19], l21 = lim[20];
  t('a free key may make 20 requests an hour', lim.slice(0, 20).every((r) => r.status === 200) && l20.headers['x-ratelimit-remaining'] === '0');
  t('the 21st is a 429 with Retry-After, the scope and a plain message', l21.status === 429 && Number(l21.headers['retry-after']) > 0 && Number(l21.headers['retry-after']) <= 3600 && l21.json.limit_scope === 'key_hour' && l21.json.retry_after === Number(l21.headers['retry-after']) && /20 requests/.test(l21.json.message));
  t('the window resets on the hour and the key works again', await (async () => { clock += 3600 * 1000; const r = await get('/v1/me', kl); return r.status === 200 && r.json.usage.this_hour === 1; })());
  // daily: 100 per UTC day; walk hours
  const kd = (await newKey('daily@example.com', {})).key;
  let dayHit = null, okCount = 0;
  const day0 = clock;
  for (let h = 0; h < 6 && !dayHit; h++) {
    for (let i = 0; i < 20 && !dayHit; i++) { const r = await get('/v1/benchmark', kd, { ip: freshIp() }); if (r.status === 429 && r.json.limit_scope === 'key_day') dayHit = r; else if (r.status === 200) okCount++; }
    clock += 3600 * 1000;
    if (new Date(clock).getUTCDate() !== new Date(day0).getUTCDate()) break;
  }
  t('a free key may make 100 requests a day (UTC); the 101st is a 429 for the day', !!dayHit && okCount === 100 && Number(dayHit.headers['retry-after']) > 0, 'ok=' + okCount);
  clock = Date.UTC(2026, 9, 23, 12, 0, 0);
  t('the next UTC day starts a new count', (await get('/v1/me', kd)).status === 200);
  // same domain across keys
  const kA = (await newKey('dom-a@example.com', {})).key, kB = (await newKey('dom-b@example.com', {})).key;
  const stat = [];
  for (let i = 0; i < 4; i++) stat.push((await get('/v1/scan?domain=shared-domain.com', i % 2 ? kB : kA, { ip: freshIp() })).status);
  const fifth = await get('/v1/scan?domain=shared-domain.com', kB, { ip: freshIp() });
  t('the same domain is scanned at most 4 times an hour across all keys', stat.every((s) => s === 200) && fifth.status === 429 && fifth.json.limit_scope === 'domain' && Number(fifth.headers['retry-after']) > 0);
  t('the domain limit counts compare, crawlers and schema too', (await get('/v1/crawlers?domain=shared-domain.com', kA, { ip: freshIp() })).status === 429 && (await get('/v1/generate/schema?domain=shared-domain.com&type=organization', kA, { ip: freshIp() })).status === 429 && (await get('/v1/compare?a=shared-domain.com&b=other-domain.com', kA, { ip: freshIp() })).status === 429);
  t('another domain is unaffected', (await get('/v1/scan?domain=other-domain-two.com', kA, { ip: freshIp() })).status === 200);
  // pro
  const kp = (await newKey('prouser@example.com', {})).key;
  await request('POST', '/v1/admin/plan', { headers: { authorization: 'Bearer ' + ENV.ADMIN_TOKEN }, json: { email: 'prouser@example.com', plan: 'pro' } });
  let proOk = 0; for (let i = 0; i < 40; i++) { if ((await get('/v1/benchmark', kp, { ip: freshIp() })).status === 200) proOk++; }
  t('a pro key passes the free limit (40 of 40 requests)', proOk === 40);
  // network address
  const heavyIp = freshIp(); const keysForIp = []; for (let i = 0; i < 7; i++) keysForIp.push((await newKey('ipkey' + i + '@example.com', {})).key);
  let ipStatus = [];
  for (let i = 0; i < 125; i++) ipStatus.push((await request('GET', '/v1/benchmark', { headers: { authorization: 'Bearer ' + keysForIp[i % 7] }, ip: heavyIp })).status);
  t('one network address is capped at 120 requests an hour across keys', ipStatus.slice(0, 120).every((s) => s === 200) && ipStatus.slice(120).every((s) => s === 429));
  // expiry
  const dump = A._dump();
  const counters = Object.keys(dump).filter((k) => /^api:(rl|dom|ip|bad|ck):/.test(k));
  const ttls = await Promise.all(counters.map((k) => A.ttl(k)));
  t('every counter has an expiry and holds no plain domain, key or address', counters.length > 20 && ttls.every((x) => x > 0 && x <= 2 * 86400) && !counters.some((k) => /shared-domain|example|chk_|\d+\.\d+\.\d+\.\d+/.test(k)), counters.filter((k, i) => !(ttls[i] > 0)).slice(0, 3).join());
  t('counters disappear once their window has passed', await (async () => { const before = A._size(); clock += 3 * 86400 * 1000; await A.get('x'); const left = Object.keys(A._dump()).filter((k) => /^api:(rl|dom|ip|bad|ck):/.test(k)).length; return left === 0 && before > 0; })());

  t('90 days after revocation the record is gone and the key answers 401', await (async () => { clock += 91 * 86400 * 1000; return (await get('/v1/me', kr.key)).status === 401; })());

  /* ---------- the router ---------- */
  out('router');
  t('an unknown endpoint is a JSON 404', await get('/v1/nope', ks).then((r) => r.status === 404 && r.json.error === 'not_found'));
  t('a wrong method is a 405 JSON with Allow', await request('POST', '/v1/scan', { headers: { authorization: 'Bearer ' + ks } }).then((r) => r.status === 405 && /GET/.test(r.headers.allow)) && await request('DELETE', '/v1/me', { headers: { authorization: 'Bearer ' + ks } }).then((r) => r.status === 405));
  t('the path can come from the catch-all query as well as the URL', await request('GET', '/api/v1/benchmark', { headers: { authorization: 'Bearer ' + ks }, query: { path: ['benchmark'] } }).then((r) => r.status === 200) && await request('GET', '/api/v1/benchmark?path=benchmark', { headers: { authorization: 'Bearer ' + ks }, query: { path: 'benchmark' } }).then((r) => r.status === 200));
  t('path tricks are normalized and never reach the admin route without its token', (await get('/v1/benchmark/../admin/plan', ks)).status === 405 && (await get('/v1/%2e%2e/me', ks)).status < 500 && (await get('/v1//me/', ks)).status === 200);
  t('a handler error is a plain 500 with no detail', await (async () => { const r = await request('GET', '/v1/scan?domain=boom-site.com', { headers: { authorization: 'Bearer ' + ks }, deps: Object.assign({}, deps, { scanPage: async () => { throw new Error('secret detail ' + ks); } }) }); return r.status === 502 && r.text.indexOf(ks) === -1 && r.text.indexOf('secret detail') === -1; })());
  t('an unexpected exception is a 500 JSON without the message', await (async () => { const r = await request('GET', '/v1/benchmark', { headers: { authorization: 'Bearer ' + ks }, deps: Object.assign({}, deps, { adapter: Object.assign({}, A, { async hgetall() { throw new Error('boom detail'); } }) }) }); return r.status === 500 && r.json.error === 'server_error' && r.text.indexOf('boom detail') === -1; })());

  /* ---------- openapi.yaml ---------- */
  out('openapi');
  const spec = OA.spec();
  const yamlText = read('openapi.yaml');
  t('openapi.yaml is current (generate-api-page.js --check)', Gen.check().length === 0, Gen.check().join('; '));
  const parsed = parseYaml(yamlText);
  t('openapi.yaml parses back to the registry\'s document', JSON.stringify(parsed) === JSON.stringify(spec));
  const Ajv = require('ajv/dist/2020');
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  // The OAS 3.1 schema points its Schema Object at the JSON Schema 2020-12 dialect with $dynamicRef "#meta", which Ajv cannot resolve across documents; bind it to the 2020-12 meta-schema (the OAS dialect only adds discriminator, xml, externalDocs and example).
  const oasRaw = read('scripts/fixtures/oas-3.1-schema.json').replace(/"\$dynamicRef": "#meta"/g, '"$ref": "https://json-schema.org/draft/2020-12/schema"');
  const validate = ajv.compile(JSON.parse(oasRaw));
  t('openapi.yaml validates against the OpenAPI 3.1 JSON Schema', validate(parsed), JSON.stringify((validate.errors || []).slice(0, 2)));
  const broken = JSON.parse(JSON.stringify(spec)); delete broken.info.title; broken.paths['/scan'].get.responses = 5;
  t('the validator rejects a broken document (it is not vacuous)', validate(broken) === false);
  const refs = []; JSON.stringify(spec, (k, v) => { if (k === '$ref') refs.push(v); return v; });
  t('every $ref resolves', refs.length > 20 && refs.every((r) => { const p = r.replace(/^#\//, '').split('/'); let o = spec; for (const s of p) o = o && o[s]; return !!o; }));
  const ops = []; Object.keys(spec.paths).forEach((p) => Object.keys(spec.paths[p]).forEach((m) => ops.push(spec.paths[p][m].operationId)));
  t('operation ids are unique and every operation has a summary, a tag and responses', new Set(ops).size === ops.length && Object.keys(spec.paths).every((p) => Object.keys(spec.paths[p]).every((m) => { const o = spec.paths[p][m]; return o.summary && o.tags && o.responses && Object.keys(o.responses).length; })));
  t('every route the router knows is documented, and every documented route is routed', await (async () => {
    const MonRoutes = require('../lib/api-v1/monitor-routes.js');
    const documented = [];
    Object.keys(spec.paths).forEach((p) => Object.keys(spec.paths[p]).forEach((m) => documented.push(m.toUpperCase() + ' ' + p)));
    const routed = [];
    Api.KNOWN.forEach((k) => routed.push('GET /' + k)); routed.push('POST /keys', 'POST /generate/llms-txt', 'POST /generate/robots-txt');
    MonRoutes.ROUTES.forEach((r) => r.methods.forEach((m) => routed.push(m + ' ' + r.path)));
    const missing = documented.filter((d) => routed.indexOf(d) === -1), extra = routed.filter((r) => documented.indexOf(r) === -1);
    let ok3 = true;
    for (const d of documented) { const [m, pth] = d.split(' '); if (pth === '/keys') continue; const r = await request(m, '/v1' + pth.replace('{id}', 'whk_0000000000000000'), { headers: { authorization: 'Bearer ' + ks }, ip: freshIp() }); if (r.status === 405 || (r.status === 404 && /No such endpoint/.test(r.text))) { ok3 = false; out('    not routed: ' + d + ' ' + r.status); } }
    if (missing.length || extra.length) out('    missing: ' + missing.join(', ') + ' extra: ' + extra.join(', '));
    return !missing.length && !extra.length && ok3;
  })());
  t('the admin plan route is not in the public document', JSON.stringify(spec).indexOf('admin/plan') === -1);
  t('the document and the page say the score measures readiness, not whether an assistant names a brand', /does not measure whether any assistant names a brand/.test(spec.info.description) && /does not measure whether any assistant names a brand/.test(read('api.html').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')));
  t('the page links no integration, listing or partner', !/\b(GitHub Action|Marketplace|partner|official|verified|Zapier)\b/i.test(read('api.html').replace(/<header[\s\S]*?<\/header>/, '').replace(/<footer[\s\S]*?<\/footer>/, '').replace(/<script[\s\S]*?<\/script>/g, '')));

  /* ---------- no secret is logged ---------- */
  out('logs');
  const allLogs = logged.join('\n');
  t('nothing logged contains a key, an address or a network address', !/chk_[A-Za-z0-9_-]{32}/.test(allLogs) && !/@example\.(com|org)/i.test(allLogs) && !/\b(198\.51\.100|203\.0\.113)\./.test(allLogs) && allLogs.indexOf(PEPPER) === -1 && allLogs.indexOf(ENV.ADMIN_TOKEN) === -1 && allLogs.indexOf(ENV.RESEND_API_KEY) === -1, allLogs.slice(0, 200));
  t('the code does not log request data', !/console\.(log|info|warn)/.test(read('lib/api-v1/index.js') + read('lib/api-v1/keys.js') + read('lib/api-v1/limits.js') + read('lib/api-v1/data.js') + read('lib/api-v1/mail.js')) && (read('lib/api-v1/index.js').match(/console\.error\([^)]*\)/g) || []).every((c) => !/req|body|email|key/i.test(c.replace(/unhandled error/, ''))));
  t('the repository carries no real-looking key', !/chk_[A-Za-z0-9_-]{32}/.test(['lib/api-v1/keys.js', 'lib/api-v1/index.js', 'lib/api-v1/openapi.js', 'api.html', 'openapi.yaml', 'docs/integrations/RULES.md'].map(read).join('\n')));

  out('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { fails.forEach((f) => out('FAIL: ' + f)); process.exit(1); }
})().catch((e) => { out('CRASH ' + (e && e.stack || e)); process.exit(1); });

/* ---------- a parser for the YAML subset the generator writes ---------- */
function parseYaml(text) {
  const lines = text.split('\n').filter((l) => l.trim() && !/^\s*#/.test(l)).map((l) => ({ indent: l.match(/^ */)[0].length, text: l.trim() }));
  const scalar = (s) => { try { return JSON.parse(s); } catch (e) { throw new Error('bad scalar: ' + s); } };
  function keyOf(s) { const m = /^("(?:[^"\\]|\\.)*"|[A-Za-z_][A-Za-z0-9_]*):(?: (.*))?$/.exec(s); if (!m) throw new Error('bad line: ' + s); return { key: m[1][0] === '"' ? JSON.parse(m[1]) : m[1], rest: m[2] }; }
  function block(i, indent) {
    if (lines[i].text.slice(0, 2) === '- ' || lines[i].text === '-') {
      const arr = [];
      while (i < lines.length && lines[i].indent === indent && lines[i].text.slice(0, 2) === '- ') {
        const rest = lines[i].text.slice(2);
        if (rest === '[]') { arr.push([]); i++; } else if (rest === '{}') { arr.push({}); i++; }
        else if (/^("(?:[^"\\]|\\.)*"|[A-Za-z_][A-Za-z0-9_]*):( |$)/.test(rest)) { lines[i] = { indent: indent + 2, text: rest }; const r = block(i, indent + 2); arr.push(r[0]); i = r[1]; }
        else { arr.push(scalar(rest)); i++; }
      }
      return [arr, i];
    }
    const obj = {};
    while (i < lines.length && lines[i].indent === indent && !(lines[i].text.slice(0, 2) === '- ')) {
      const k = keyOf(lines[i].text);
      if (k.rest === undefined) { i++; const r = block(i, lines[i].indent); obj[k.key] = r[0]; i = r[1]; }
      else if (k.rest === '[]') { obj[k.key] = []; i++; } else if (k.rest === '{}') { obj[k.key] = {}; i++; }
      else { obj[k.key] = scalar(k.rest); i++; }
    }
    return [obj, i];
  }
  return block(0, 0)[0];
}
