#!/usr/bin/env node
/* =====================================================================
   scripts/test-api-monitoring.js

   Monitoring in the Citehound API (lib/api-v1/monitor.js, webhooks.js, alerts.js, monitor-routes.js), with an in-memory store, a fake clock, fake scans, a fake mail provider and a fake webhook
   receiver: no network, no real key, no real address.

   - the diff: every event type from fixtures, thresholds, stable ids, nothing for no change;
   - plan gating: every monitoring endpoint answers 403 pro_required to a free key and 401 to no key;
   - the watchlist: limits (configurable), validation, the baseline scan, shared scans, failed scans, delete;
   - the scheduled job: its secret, what is due, the batch, retries of a failed scan, a lock, revoked and downgraded keys skipped;
   - history and events: order, filters, cursor pagination, since, retention;
   - alerts: only the three types, once a day, the one-click unsubscribe and its signature, the List-Unsubscribe header, a failed mail frees the day;
   - webhooks: address checks, the secret shown once and stored encrypted, signatures, retries with backoff, auto-disable, the test event, the delivery log;
   - the POST of a webhook goes through lib/safe-fetch.js: one request, no redirect followed, private addresses refused;
   - revoking a key deletes all of it; one key never sees another's data; live answers validate against the OpenAPI schemas; nothing secret is logged.

     node scripts/test-api-monitoring.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const Api = require('../lib/api-v1/index.js');
const Keys = require('../lib/api-v1/keys.js');
const Monitor = require('../lib/api-v1/monitor.js');
const Webhooks = require('../lib/api-v1/webhooks.js');
const Alerts = require('../lib/api-v1/alerts.js');
const OA = require('../lib/api-v1/openapi.js');
const store = require('../lib/pro-store.js');
const scanner = require('../lib/scanner.js');
const safeFetch = require('../lib/safe-fetch.js');

let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const logged = [];
['log', 'warn', 'error', 'info'].forEach((k) => { console[k] = function () { logged.push(Array.prototype.slice.call(arguments).map(String).join(' ')); }; });

/* ---------- the harness ---------- */

const DAY = 86400 * 1000;
const PEPPER = 'monitor-pepper-' + 'y'.repeat(40);
const ENV = { API_KEY_PEPPER: PEPPER, RESEND_API_KEY: 're_test_not_real', PRO_MAIL_FROM: 'Citehound <keys@example.test>', ADMIN_TOKEN: 'admin-token-for-tests-only', CRON_SECRET: 'cron-secret-for-tests-only' };
let clock = Date.UTC(2026, 9, 22, 12, 0, 0);
let A = store.memoryAdapter({ now: () => clock });
const mails = []; let mailOk = true;
const fakeFetch = async (url, init) => { const b = JSON.parse(init.body); mails.push({ url: url, to: b.to[0], subject: b.subject, text: b.text, html: b.html, headers: b.headers || null }); return { ok: mailOk, status: mailOk ? 200 : 500 }; };

const BOTS = ['GPTBot', 'ClaudeBot', 'Bytespider', 'CCBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'meta-externalagent', 'Amazonbot', 'cohere-ai'];
const FULL = read('claude.html'), THIN = '<html><head><title>x</title></head><body><p>hi</p></body></html>';
function scan(o) { o = o || {}; const sig = scanner.parseSignals(o.thin ? THIN : FULL); const bots = BOTS.map((n) => ({ name: n, state: (o.bots && o.bots[n]) || 'open' })); return { ok: true, robotsOk: true, botResults: bots, result: scanner.scoreAll(true, o.llms !== false, true, bots, sig) }; }
const world = {}; let scanCalls = [];
const hooks = {}; let posts = [];
const deps = {
  env: ENV, adapter: A, fetch: fakeFetch, now: () => clock,
  scanPage: async (url, opts) => { scanCalls.push({ url: url, opts: opts }); const d = new URL(url).hostname; const w = world[d]; if (w === 'fail') return { ok: false, stage: 'robots', kind: 'timeout' }; return typeof w === 'function' ? w() : (w || scan()); },
  webhookPost: async (url, o) => { posts.push({ url: url, headers: o.headers, body: o.body }); const h = hooks[url]; return h ? h(o) : { ok: true, status: 200 }; }
};
function request(method, url, o) {
  o = o || {};
  const headers = Object.assign({ 'x-forwarded-for': o.ip || '198.51.100.9' }, o.headers || {});
  if (o.json !== undefined) headers['content-type'] = 'application/json';
  const req = { method: method, url: url, headers: headers, query: undefined };
  if (o.json !== undefined) req.body = typeof o.json === 'string' ? o.json : JSON.stringify(o.json);
  return new Promise((resolve, reject) => {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[String(k).toLowerCase()] = String(v); }, end(b) { let json = null; try { json = JSON.parse(b); } catch (e) { /* html */ } resolve({ status: this.statusCode, headers: this.headers, text: b || '', json: json }); } };
    Api.handle(req, res, o.deps || deps).catch(reject);
  });
}
// A fresh store for a section, so the domains of an earlier section are not due in this one.
function reset() { A = store.memoryAdapter({ now: () => clock }); deps.adapter = A; }
let ipN = 40; const freshIp = () => '203.0.113.' + (ipN++);
const call = (key, method, url, json, o) => request(method, url, Object.assign({ headers: { authorization: 'Bearer ' + key }, json: json, ip: freshIp() }, o || {}));
async function makeKey(email, plan) {
  const before = mails.length;
  await request('POST', '/v1/keys', { json: { email: email }, ip: freshIp() });
  const key = /chk_[A-Za-z0-9_-]{32}/.exec(mails[before].text)[0];
  if (plan === 'pro') await request('POST', '/v1/admin/plan', { headers: { authorization: 'Bearer ' + ENV.ADMIN_TOKEN }, json: { email: email, plan: 'pro' } });
  return { key: key, email: email, hash: Keys.keyHash(PEPPER, key), id: Keys.idOf(Keys.keyHash(PEPPER, key)), mail: mails[before] };
}
const envDeps = (extra) => Object.assign({}, deps, { env: Object.assign({}, ENV, extra) });
// Runs the job until nothing is left that is due (a run takes at most the batch), and adds up the counts.
async function runAll(o) {
  const sum = { due: 0, scanned: 0, failed: 0, skipped: 0, events: 0, alerts_sent: 0, webhooks_sent: 0, retries: 0 };
  for (let i = 0; i < 40; i++) { const r = await cron(o); Object.keys(sum).forEach((k) => { sum[k] += r.json[k] || 0; }); if ((r.json.due || 0) <= Monitor.config((o && o.deps ? o.deps : deps).env).batch) break; }
  return { status: 200, json: sum };
}
const cron = (o) => request('GET', '/v1/cron/run', Object.assign({ headers: { authorization: 'Bearer ' + ENV.CRON_SECRET } }, o || {}));
const snap = (o) => Monitor.snapshotFrom('example.com', scan(o), Date.UTC(2026, 9, 22, 12, 0, 0));
const snapAt = (o, ms) => Monitor.snapshotFrom('example.com', scan(o), ms);

(async function main() {
  /* ---------- the diff ---------- */
  out('diff');
  const base = snapAt({}, Date.UTC(2026, 9, 22, 12, 0, 0));
  t('a snapshot holds the score, three pillars, failed check ids, ten crawler states, llms.txt and JSON-LD flags', Number.isInteger(base.score) && base.pillars.length === 3 && Array.isArray(base.failed) && Object.keys(base.crawlers).length === 10 && typeof base.llms_txt === 'boolean' && typeof base.schema === 'boolean' && /^snp_\d{14}$/.test(base.id), JSON.stringify(base).slice(0, 200));
  t('failed check ids are stable slugs, without the counts in a label', Monitor.checkId('AI crawler access (3/10 open)') === 'ai-crawler-access' && Monitor.checkId('Content schema (Article, FAQ…)') === 'content-schema' && Monitor.checkId('Organization / WebSite schema') === 'organization-website-schema' && Monitor.checkId('llms.txt present') === 'llms-txt-present');
  t('no change, no event', Monitor.diff(base, snapAt({}, Date.UTC(2026, 9, 29, 12, 0, 0))).length === 0);
  const thin = snapAt({ thin: true }, Date.UTC(2026, 9, 29, 12, 0, 0));
  const dropped = Monitor.diff(base, thin, { scoreDelta: 5 });
  t('score_dropped when the score falls by the threshold or more, with from, to and delta', thin.score <= base.score - 5 && dropped.some((e) => e.type === 'score_dropped' && e.data.from === base.score && e.data.to === thin.score && e.data.delta === thin.score - base.score && /dropped from/.test(e.summary)), JSON.stringify(dropped.map((e) => e.type)));
  const improved = Monitor.diff(thin, snapAt({}, Date.UTC(2026, 10, 5, 12, 0, 0)), { scoreDelta: 5 });
  t('score_improved when it rises by the threshold or more', improved.some((e) => e.type === 'score_improved' && /rose from/.test(e.summary)));
  const small = snapAt({ llms: false }, Date.UTC(2026, 9, 29, 12, 0, 0));
  t('a change under the threshold is not a score event, and a lower threshold catches it', base.score - small.score > 0 && base.score - small.score < 5 && !Monitor.diff(base, small, { scoreDelta: 5 }).some((e) => /^score_/.test(e.type)) && Monitor.diff(base, small, { scoreDelta: 2 }).some((e) => e.type === 'score_dropped'));
  const blocked = Monitor.diff(base, snapAt({ bots: { GPTBot: 'blocked', CCBot: 'limited' } }, Date.UTC(2026, 9, 29, 12, 0, 0)));
  t('crawler_blocked names the crawler; open to limited is no event', blocked.filter((e) => e.type === 'crawler_blocked').length === 1 && blocked.find((e) => e.type === 'crawler_blocked').data.crawler === 'GPTBot' && /GPTBot is now blocked/.test(blocked.find((e) => e.type === 'crawler_blocked').summary) && !blocked.some((e) => e.data && e.data.crawler === 'CCBot'));
  const unblocked = Monitor.diff(snapAt({ bots: { GPTBot: 'blocked' } }, Date.UTC(2026, 9, 22, 12, 0, 0)), snapAt({ bots: { GPTBot: 'limited' } }, Date.UTC(2026, 9, 29, 12, 0, 0)));
  t('crawler_unblocked when a blocked crawler is no longer blocked', unblocked.some((e) => e.type === 'crawler_unblocked' && e.data.crawler === 'GPTBot' && e.data.to === 'limited'));
  const noLlms = snapAt({ llms: false }, Date.UTC(2026, 9, 29, 12, 0, 0));
  t('llms_txt_removed and llms_txt_added', base.llms_txt === true && noLlms.llms_txt === false && Monitor.diff(base, noLlms).some((e) => e.type === 'llms_txt_removed') && Monitor.diff(noLlms, snapAt({}, Date.UTC(2026, 10, 5, 12, 0, 0))).some((e) => e.type === 'llms_txt_added'));
  const chk = Monitor.diff(base, thin);
  t('check_failed names a check that now fails, check_fixed one that now passes', chk.some((e) => e.type === 'check_failed' && e.data.check && e.data.name && /now failing/.test(e.summary)) && Monitor.diff(thin, base).some((e) => e.type === 'check_fixed' && /now passing/.test(e.summary)));
  const again = Monitor.diff(base, thin);
  t('ids are stable: the same two snapshots give the same ids; another snapshot gives other ids', JSON.stringify(again.map((e) => e.id)) === JSON.stringify(chk.map((e) => e.id)) && new Set(chk.map((e) => e.id)).size === chk.length && Monitor.diff(base, snapAt({ thin: true }, Date.UTC(2026, 10, 12, 12, 0, 0))).every((e) => chk.map((x) => x.id).indexOf(e.id) === -1));
  t('ids sort in time order and every event has a short summary, a time and the domain', chk.every((e) => /^evt_\d{14}_[0-9a-f]{10}$/.test(e.id) && e.summary.length > 10 && e.summary.length < 200 && e.domain === 'example.com' && !isNaN(Date.parse(e.at))) && Monitor.diff(base, snapAt({ thin: true }, Date.UTC(2026, 10, 12, 12, 0, 0)))[0].id > chk[chk.length - 1].id);
  t('every documented event type can be produced (scan_failed by the job, below)', ['score_dropped', 'score_improved', 'crawler_blocked', 'crawler_unblocked', 'llms_txt_added', 'llms_txt_removed', 'check_failed', 'check_fixed'].every((ty) => [dropped, improved, blocked, unblocked, Monitor.diff(base, noLlms), Monitor.diff(noLlms, base), chk, Monitor.diff(thin, base)].some((l) => l.some((e) => e.type === ty))) && Monitor.EVENT_TYPES.length === 9);
  const cfgD = Monitor.config({});
  t('defaults: 5 domains, 3 webhooks, 5 points, 365 days, a batch of 6, 5 failures; values are clamped', cfgD.watchLimit === 5 && cfgD.webhookLimit === 3 && cfgD.scoreDelta === 5 && cfgD.retentionDays === 365 && cfgD.batch === 6 && cfgD.maxFails === 5 && Monitor.config({ API_V1_WATCH_LIMIT: '0' }).watchLimit === 1 && Monitor.config({ API_V1_WATCH_LIMIT: '9999' }).watchLimit === 100 && Monitor.config({ API_V1_SCORE_DELTA: 'x' }).scoreDelta === 5 && Monitor.config({ API_V1_RETENTION_DAYS: '10' }).retentionDays === 30);

  /* ---------- plan gating ---------- */
  out('plan gating');
  const free = await makeKey('free-user@example.com', 'free');
  const pro = await makeKey('pro-user@example.com', 'pro');
  const gates = [['POST', '/v1/watchlist', { domain: 'gate-site.com' }], ['GET', '/v1/watchlist'], ['DELETE', '/v1/watchlist?domain=gate-site.com'], ['GET', '/v1/history?domain=gate-site.com'], ['GET', '/v1/events'], ['POST', '/v1/webhooks', { url: 'https://example.com/h' }], ['GET', '/v1/webhooks'], ['GET', '/v1/webhooks/whk_0123456789abcdef'], ['DELETE', '/v1/webhooks/whk_0123456789abcdef'], ['GET', '/v1/webhooks/whk_0123456789abcdef/deliveries'], ['POST', '/v1/webhooks/whk_0123456789abcdef/test']];
  let gateOk = true, noKeyOk = true;
  for (const [m, u, b] of gates) {
    const r = await call(free.key, m, u, b); if (r.status !== 403 || r.json.error !== 'pro_required') { gateOk = false; out('    free key: ' + m + ' ' + u + ' -> ' + r.status); }
    const r2 = await request(m, u, { json: b, ip: freshIp() }); if (r2.status !== 401) { noKeyOk = false; out('    no key: ' + m + ' ' + u + ' -> ' + r2.status); }
  }
  t('every monitoring endpoint answers a free key 403 pro_required, and nothing was scanned for it', gateOk && scanCalls.length === 0);
  t('and answers no key 401', noKeyOk);
  t('the message points to Pro and the contact address', /Pro plan/.test((await call(free.key, 'GET', '/v1/watchlist')).json.message) && /hey@getcitehound\.com/.test((await call(free.key, 'GET', '/v1/watchlist')).json.message));
  t('a pro key is let in', (await call(pro.key, 'GET', '/v1/watchlist')).status === 200);

  /* ---------- the watchlist ---------- */
  out('watchlist');
  const SCHEMAS = OA.spec().components.schemas;
  const Ajv = require('ajv/dist/2020'); const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  const valid = (name, value) => { const v = ajv.compile({ $ref: '#/components/schemas/' + name, components: { schemas: SCHEMAS } }); const ok = v(value); if (!ok) out('    schema ' + name + ': ' + JSON.stringify(v.errors.slice(0, 2))); return ok; };
  scanCalls = [];
  const add1 = await call(pro.key, 'POST', '/v1/watchlist', { domain: 'Alpha-Watch.com' });
  t('POST /v1/watchlist: 201, the first scan is the baseline, one scan was made', add1.status === 201 && add1.json.watch.domain === 'alpha-watch.com' && add1.json.baseline.score > 0 && /^snp_/.test(add1.json.baseline.snapshot_id) && scanCalls.length === 1 && scanCalls[0].url === 'https://alpha-watch.com/' && add1.json.watch.status === 'ok', add1.text.slice(0, 200));
  t('the answer matches the OpenAPI schema', valid('WatchAdded', add1.json));
  const nextDue = Date.parse(add1.json.next_scan_after);
  t('the next scan is about 7 days away (7 days minus 12 hours)', Math.abs(nextDue - (clock + 7 * DAY - 12 * 3600 * 1000)) < 1000);
  t('no event for a baseline', (await call(pro.key, 'GET', '/v1/events')).json.events.length === 0);
  const again1 = await call(pro.key, 'POST', '/v1/watchlist', { domain: 'alpha-watch.com' });
  t('adding it again is a 200 with no second scan', again1.status === 200 && scanCalls.length === 1);
  const bads = ['localhost', '127.0.0.1', 'http://example.com', 'example.com:8080', 'user:pass@example.com', '169.254.169.254', '', 'a b.com', 'metadata.google.internal'];
  let badOk = true; for (const b of bads) { const r = await call(pro.key, 'POST', '/v1/watchlist', { domain: b }); if (r.status !== 400 || r.json.error !== 'invalid_domain') badOk = false; }
  t('invalid and internal domains are refused with 400 before any fetch', badOk && scanCalls.length === 1);
  t('the body must be JSON and "alerts" a boolean', (await request('POST', '/v1/watchlist', { headers: { authorization: 'Bearer ' + pro.key }, rawBody: 'x', ip: freshIp() })).status === 415 && (await call(pro.key, 'POST', '/v1/watchlist', { domain: 'beta-watch.com', alerts: 'no' })).status === 400);
  world['fail-watch.com'] = 'fail';
  const failAdd = await call(pro.key, 'POST', '/v1/watchlist', { domain: 'fail-watch.com' });
  t('a domain that cannot be scanned is not added (502 scan_failed)', failAdd.status === 502 && failAdd.json.error === 'scan_failed' && !Object.keys((await call(pro.key, 'GET', '/v1/watchlist')).json.domains.map((d) => d.domain)).some((d) => d === 'fail-watch.com') && !(await A.smembers('api:wd:all')).includes('fail-watch.com'));
  const small2 = envDeps({ API_V1_WATCH_LIMIT: '2' });
  const lim = await makeKey('limit-user@example.com', 'pro');
  const l1 = await call(lim.key, 'POST', '/v1/watchlist', { domain: 'lim-one.com' }, { deps: small2 });
  const l2 = await call(lim.key, 'POST', '/v1/watchlist', { domain: 'lim-two.com' }, { deps: small2 });
  const l3 = await call(lim.key, 'POST', '/v1/watchlist', { domain: 'lim-three.com' }, { deps: small2 });
  t('the limit is configurable (API_V1_WATCH_LIMIT) and a full watchlist is a 409 watchlist_full', l1.status === 201 && l2.status === 201 && l3.status === 409 && l3.json.error === 'watchlist_full' && l3.json.limit === 2);
  t('the default limit is 5 per Pro key', await (async () => { const k = await makeKey('five@example.com', 'pro'); const st = []; for (let i = 0; i < 6; i++) st.push((await call(k.key, 'POST', '/v1/watchlist', { domain: 'five-' + i + '-site.com' })).status); return st.slice(0, 5).every((s) => s === 201) && st[5] === 409; })());
  const list = await call(pro.key, 'GET', '/v1/watchlist');
  t('GET /v1/watchlist lists the domains with the last scan, the next one and the score', list.status === 200 && list.json.used === 1 && list.json.limit === 5 && list.json.domains[0].last_score === add1.json.baseline.score && valid('WatchList', list.json), list.text.slice(0, 200));
  // one scan for everybody who watches a domain
  const pro2 = await makeKey('pro-two@example.com', 'pro');
  scanCalls = [];
  const sh = await call(pro2.key, 'POST', '/v1/watchlist', { domain: 'alpha-watch.com' });
  t('a second key watching the same domain within a day reuses the snapshot (no scan)', sh.status === 201 && scanCalls.length === 0 && sh.json.baseline.score === add1.json.baseline.score);
  t('adding a domain that needs a scan counts toward the 4-an-hour limit of that domain: the 5th is a 429 and nothing is scanned', await (async () => { const Limits = require('../lib/api-v1/limits.js'); for (let i = 0; i < 4; i++) await Limits.checkDomains(A, PEPPER, ['limited-site.com'], clock); scanCalls = []; const r = await call(pro2.key, 'POST', '/v1/watchlist', { domain: 'limited-site.com' }); return r.status === 429 && r.json.limit_scope === 'domain' && Number(r.headers['retry-after']) > 0 && scanCalls.length === 0; })());
  const del = await call(pro2.key, 'DELETE', '/v1/watchlist?domain=alpha-watch.com');
  t('DELETE /v1/watchlist removes the domain from this key only', del.status === 200 && del.json.removed === true && (await call(pro2.key, 'GET', '/v1/watchlist')).json.used === 0 && (await call(pro.key, 'GET', '/v1/watchlist')).json.used === 1 && (await A.smembers('api:wd:all')).includes('alpha-watch.com'));
  t('removing something that is not watched is a 404, a missing domain a 400', (await call(pro2.key, 'DELETE', '/v1/watchlist?domain=alpha-watch.com')).status === 404 && (await call(pro2.key, 'DELETE', '/v1/watchlist')).status === 400);
  const temp = await makeKey('temp@example.com', 'pro');
  await call(temp.key, 'POST', '/v1/watchlist', { domain: 'temp-only-site.com' });
  await call(temp.key, 'DELETE', '/v1/watchlist?domain=temp-only-site.com');
  t('when nobody watches a domain any more its snapshots, events and schedule are deleted', !(await A.smembers('api:wd:all')).includes('temp-only-site.com') && (await A.hgetall('api:hist:temp-only-site.com')) === null && (await A.hgetall('api:ws:temp-only-site.com')) === null);

  /* ---------- the scheduled job ---------- */
  out('scheduled job');
  const unsetCron = await request('GET', '/v1/cron/run', { deps: envDeps({ CRON_SECRET: '' }), headers: { authorization: 'Bearer x' } });
  t('the job is a 404 while CRON_SECRET is unset or short', unsetCron.status === 404 && (await request('GET', '/v1/cron/run', { deps: envDeps({ CRON_SECRET: 'short' }), headers: { authorization: 'Bearer short' } })).status === 404);
  t('without the secret, or with a key instead of it, the job answers 401 and runs nothing', (await request('GET', '/v1/cron/run', {})).status === 401 && (await request('GET', '/v1/cron/run', { headers: { authorization: 'Bearer wrong-wrong-wrong-wrong' } })).status === 401 && (await request('GET', '/v1/cron/run', { headers: { authorization: 'Bearer ' + pro.key } })).status === 401);
  t('the job refuses other methods', (await request('DELETE', '/v1/cron/run', { headers: { authorization: 'Bearer ' + ENV.CRON_SECRET } })).status === 405);
  scanCalls = [];
  const run0 = await cron();
  t('right after adding, nothing is due: the job scans nothing and answers only counts', run0.status === 200 && run0.json.scanned === 0 && scanCalls.length === 0 && Object.keys(run0.json).every((k) => typeof run0.json[k] === 'number' || typeof run0.json[k] === 'boolean'), run0.text);
  // seven days later alpha-watch.com changes: the thin page, GPTBot blocked, llms.txt gone
  clock += 7 * DAY;
  world['alpha-watch.com'] = scan({ thin: true, llms: false, bots: { GPTBot: 'blocked' } });
  scanCalls = [];
  const run1 = await runAll();
  t('seven days later the domain is due: scanned once with commerce off, events created', run1.status === 200 && run1.json.scanned >= 1 && scanCalls.some((c) => c.url === 'https://alpha-watch.com/' && c.opts && c.opts.commerce === false) && run1.json.events >= 4, run1.text);
  const ev1 = (await call(pro.key, 'GET', '/v1/events?domain=alpha-watch.com')).json;
  const types1 = ev1.events.map((e) => e.type);
  t('the events: score_dropped, crawler_blocked, llms_txt_removed and check_failed', ['score_dropped', 'crawler_blocked', 'llms_txt_removed', 'check_failed'].every((x) => types1.indexOf(x) !== -1), types1.join());
  t('the answer matches the OpenAPI schema', valid('EventsResult', ev1) && ev1.events.every((e) => valid('Event', e)));
  const run1b = await cron();
  t('running the job again the same day does nothing (not due again)', run1b.json.scanned === 0 && (await call(pro.key, 'GET', '/v1/events?domain=alpha-watch.com')).json.events.length === ev1.events.length);

  // the batch
  reset();
  const bk = await makeKey('batch@example.com', 'pro');
  const batchDeps = envDeps({ API_V1_CRON_BATCH: '2', API_V1_WATCH_LIMIT: '10' });
  for (const d of ['batch-a.com', 'batch-b.com', 'batch-c.com']) await call(bk.key, 'POST', '/v1/watchlist', { domain: d }, { deps: batchDeps });
  clock += 7 * DAY; scanCalls = [];
  const b1 = await cron({ deps: batchDeps });
  const batched = scanCalls.filter((c) => /batch-/.test(c.url)).length;
  t('at most API_V1_CRON_BATCH domains are scanned in a run, the rest wait', batched === 2 && b1.json.due >= 3, JSON.stringify(b1.json));
  scanCalls = []; const b2 = await cron({ deps: batchDeps });
  t('the next run takes what is left, oldest first', scanCalls.filter((c) => /batch-/.test(c.url)).length === 1 && b2.json.scanned >= 1);
  t('the time budget is respected: a run past its deadline starts no new work', await (async () => { const tiny = envDeps({ API_V1_CRON_BUDGET_MS: '5000' }); return Monitor.config(tiny.env).budgetMs === 5000 && Monitor.config({ API_V1_CRON_BUDGET_MS: '1' }).budgetMs === 5000; })());

  // failed scans
  reset();
  const fk = await makeKey('failer@example.com', 'pro');
  await call(fk.key, 'POST', '/v1/watchlist', { domain: 'flaky-site.com' });
  clock += 7 * DAY; world['flaky-site.com'] = 'fail';
  const f1 = await cron();
  const evF = (await call(fk.key, 'GET', '/v1/events?type=scan_failed')).json.events;
  t('a failed scan makes one scan_failed event', evF.length === 1 && evF[0].type === 'scan_failed' && /could not read https:\/\/flaky-site\.com\//.test(evF[0].summary) && f1.json.failed >= 1, f1.text);
  const stF = await A.hgetall('api:ws:flaky-site.com');
  t('it is tried again the next day', Math.abs(Number(stF.nextDue) - (clock + DAY)) < 1000 && stF.status === 'failed' && stF.streak === '1');
  clock += DAY; await cron(); clock += DAY; await cron();
  const stF3 = await A.hgetall('api:ws:flaky-site.com');
  t('a second and third failure make no new event, and after three it waits a week', (await call(fk.key, 'GET', '/v1/events?type=scan_failed')).json.events.length === 1 && stF3.streak === '3' && Number(stF3.nextDue) - clock > 6 * DAY);
  world['flaky-site.com'] = scan(); clock += 7 * DAY; await cron();
  t('a later success resets the streak and the schedule', (await A.hgetall('api:ws:flaky-site.com')).streak === '0' && (await A.hgetall('api:ws:flaky-site.com')).status === 'ok');
  t('the first success after failures is compared with the last good snapshot (no baseline reset)', (await Monitor.snapshots(A, 'flaky-site.com')).length === 2);

  // a lock
  await A.set('api:lock:cron', '1', { nx: true, ex: 300 });
  t('a second run while one is running does nothing', (await cron()).json.locked === true);
  await A.del('api:lock:cron');
  await A.set('api:lock:alpha-lock.com', '1', { nx: true, ex: 120 });
  t('a domain being scanned is not scanned twice at once', (await Monitor.scanDomain({ A: A, cfg: Monitor.config({}), clock: () => clock, scan: async () => { throw new Error('should not scan'); } }, 'alpha-lock.com')).skipped === 'locked');
  await A.del('api:lock:alpha-lock.com');

  // revoked and downgraded keys are skipped
  reset();
  const dk = await makeKey('downgrade@example.com', 'pro');
  await call(dk.key, 'POST', '/v1/watchlist', { domain: 'downgrade-site.com' });
  await request('POST', '/v1/admin/plan', { headers: { authorization: 'Bearer ' + ENV.ADMIN_TOKEN }, json: { email: 'downgrade@example.com', plan: 'free' } });
  clock += 8 * DAY; scanCalls = [];
  const dr = await cron();
  t('a key that is no longer Pro costs no scans: its domains are skipped', !scanCalls.some((c) => /downgrade-site/.test(c.url)) && dr.json.skipped >= 1 && (await call(dk.key, 'GET', '/v1/watchlist')).status === 403);

  /* ---------- history and events ---------- */
  out('history and events');
  reset();
  const hk = await makeKey('history@example.com', 'pro');
  world['hist-site.com'] = scan();
  await call(hk.key, 'POST', '/v1/watchlist', { domain: 'hist-site.com' });
  const variants = [{ thin: true }, {}, { llms: false }, { bots: { GPTBot: 'blocked' } }, {}, { thin: true, bots: { ClaudeBot: 'blocked' } }, { llms: false, bots: { CCBot: 'blocked' } }];
  for (const v of variants) { clock += 7 * DAY; world['hist-site.com'] = scan(v); await runAll(); }
  const h = await call(hk.key, 'GET', '/v1/history?domain=hist-site.com');
  t('GET /v1/history: snapshots newest first, as many as scans (one baseline and seven re-scans)', h.status === 200 && h.json.snapshots.length === 8 && h.json.snapshots.every((s, i, a) => i === 0 || a[i - 1].id > s.id) && valid('HistoryResult', h.json), h.text.slice(0, 160));
  const hmid = h.json.snapshots[3].at;
  t('history: since and limit', (await call(hk.key, 'GET', '/v1/history?domain=hist-site.com&since=' + encodeURIComponent(hmid))).json.snapshots.length === 3 && (await call(hk.key, 'GET', '/v1/history?domain=hist-site.com&limit=2')).json.snapshots.length === 2 && (await call(hk.key, 'GET', '/v1/history?domain=hist-site.com&since=nope')).status === 400);
  t('history needs a domain, and one that is watched', (await call(hk.key, 'GET', '/v1/history')).status === 400 && (await call(hk.key, 'GET', '/v1/history?domain=never-watched.com')).status === 404 && (await call(hk.key, 'GET', '/v1/history?domain=localhost')).status === 400);
  const all = (await call(hk.key, 'GET', '/v1/events?limit=100')).json;
  t('GET /v1/events: newest first, ids strictly descending', all.events.length >= 8 && all.events.every((e, i, a) => i === 0 || a[i - 1].id > e.id) && all.has_more === false && all.next_cursor === null);
  t('events: filter by one type, by several, and by domain', (await call(hk.key, 'GET', '/v1/events?type=llms_txt_removed')).json.events.every((e) => e.type === 'llms_txt_removed') && (await call(hk.key, 'GET', '/v1/events?type=score_dropped,crawler_blocked')).json.events.every((e) => ['score_dropped', 'crawler_blocked'].indexOf(e.type) !== -1) && (await call(hk.key, 'GET', '/v1/events?domain=hist-site.com&limit=100')).json.events.length === all.events.length && (await call(hk.key, 'GET', '/v1/events?type=nope')).status === 400 && (await call(hk.key, 'GET', '/v1/events?domain=never-watched.com')).status === 404);
  // pagination
  const seen = []; let cursor = null, pages = 0, more = true;
  while (more && pages < 50) { const r = await call(hk.key, 'GET', '/v1/events?limit=3' + (cursor ? '&cursor=' + cursor : '')); r.json.events.forEach((e) => seen.push(e.id)); more = r.json.has_more; cursor = r.json.next_cursor; pages++; if (more && !cursor) break; }
  t('cursor pagination walks every event once, in order, and ends with has_more false and no cursor', seen.length === all.events.length && new Set(seen).size === seen.length && JSON.stringify(seen) === JSON.stringify(all.events.map((e) => e.id)) && pages > 2 && cursor === null, seen.length + '/' + all.events.length);
  const newest = all.events[0].id, mid = all.events[Math.floor(all.events.length / 2)].id;
  const since = (await call(hk.key, 'GET', '/v1/events?since=' + mid)).json.events;
  t('since an event id returns only newer events (a polling client takes what is new)', since.length > 0 && since.every((e) => e.id > mid) && (await call(hk.key, 'GET', '/v1/events?since=' + newest)).json.events.length === 0);
  t('since a date works too, and a bad one is a 400', (await call(hk.key, 'GET', '/v1/events?since=' + encodeURIComponent(new Date(clock + DAY).toISOString()))).json.events.length === 0 && (await call(hk.key, 'GET', '/v1/events?since=yesterday')).status === 400 && (await call(hk.key, 'GET', '/v1/events?cursor=%27%3B--')).status === 400);
  t('ids are the same on every read (stable for deduplication)', JSON.stringify((await call(hk.key, 'GET', '/v1/events?limit=100')).json.events.map((e) => e.id)) === JSON.stringify(all.events.map((e) => e.id)));
  const other = await makeKey('other-user@example.com', 'pro');
  t('one key never sees another key\'s domains or events', (await call(other.key, 'GET', '/v1/events')).json.events.length === 0 && (await call(other.key, 'GET', '/v1/history?domain=hist-site.com')).status === 404);

  // retention
  reset();
  const rk = await makeKey('retention@example.com', 'pro');
  const retDeps = envDeps({ API_V1_RETENTION_DAYS: '30' });
  await call(rk.key, 'POST', '/v1/watchlist', { domain: 'retain-site.com' }, { deps: retDeps });
  for (let i = 0; i < 6; i++) { clock += 7 * DAY; world['retain-site.com'] = scan(i % 2 ? {} : { thin: true }); await runAll({ deps: retDeps }); }
  const keptH = (await call(rk.key, 'GET', '/v1/history?domain=retain-site.com&limit=120', undefined, { deps: retDeps })).json.snapshots;
  t('snapshots and events older than the retention period are deleted', keptH.length <= 6 && keptH.every((s) => Date.parse(s.at) >= clock - 30 * DAY - 1000) && (await call(rk.key, 'GET', '/v1/events?limit=100', undefined, { deps: retDeps })).json.events.every((e) => Date.parse(e.at) >= clock - 30 * DAY - 1000));
  t('the stored records expire on their own as well (retention plus 30 days)', await (async () => { const ttl = await A.ttl('api:hist:retain-site.com'); return ttl > 0 && ttl <= 60 * 86400; })());

  /* ---------- alerts ---------- */
  out('alerts');
  reset();
  const ak = await makeKey('alerts@example.com', 'pro');
  world['alert-site.com'] = scan();
  const wrongMail = await call(ak.key, 'POST', '/v1/watchlist', { domain: 'alert-site.com', alert_email: 'someone-else@example.com' });
  t('alert_email must be the address the key was sent to (compared by hash), otherwise 400 and nothing is stored', wrongMail.status === 400 && (await A.hgetall('api:ae:' + ak.id)) === null && !(await A.smembers('api:wd:all')).includes('alert-site.com'));
  const addA = await call(ak.key, 'POST', '/v1/watchlist', { domain: 'alert-site.com', alert_email: 'Alerts@Example.com' });
  t('with the right address it is accepted and stored (readable, only for sending the alerts)', addA.status === 201 && addA.json.alert_email === true && (await A.hget('api:ae:' + ak.id, 'email')) === 'Alerts@Example.com');
  t('the answers never show the address or any secret', !/alerts@example\.com/i.test(addA.text) && !/alerts@example\.com/i.test((await call(ak.key, 'GET', '/v1/watchlist')).text));
  const mails0 = mails.length;
  clock += 7 * DAY; world['alert-site.com'] = scan({ thin: true, llms: false, bots: { GPTBot: 'blocked' } }); await runAll();
  const alertMail = mails.slice(mails0).filter((m) => m.to === 'Alerts@Example.com');
  t('a drop, a blocked crawler and a removed llms.txt send ONE email with every summary', alertMail.length === 1 && /dropped from/.test(alertMail[0].text) && /GPTBot is now blocked/.test(alertMail[0].text) && /llms\.txt is no longer found/.test(alertMail[0].text) && !/Now failing/.test(alertMail[0].text) && /alert-site\.com/.test(alertMail[0].subject));
  t('the mail is transactional: no tracking, the readiness sentence, a one-click unsubscribe link and header', !/<img|unsubscribe from all|newsletter/i.test(alertMail[0].html) && /does not measure whether any assistant names a brand/.test(alertMail[0].text) && /\/v1\/watchlist\/unsubscribe\/[0-9a-f]{20}\/alert-site\.com\/[0-9a-f]{32}/.test(alertMail[0].text) && /^<https:\/\/getcitehound\.com\/v1\/watchlist\/unsubscribe\//.test(alertMail[0].headers['List-Unsubscribe']) && alertMail[0].headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click');
  const sentBefore = mails.length;
  const evs = (await call(ak.key, 'GET', '/v1/events?type=score_dropped')).json.events;
  const ctxA = Api.__ctx ? null : { A: A, p: PEPPER, deps: deps, cfg: Monitor.config(ENV), clock: () => clock };
  t('at most one email per domain per day: the same events again send nothing', (await Alerts.send(ctxA, 'alert-site.com', evs)) === 0 && mails.length === sentBefore);
  clock += DAY;
  t('the next day an alert may be sent again', (await Alerts.send(ctxA, 'alert-site.com', evs)) === 1);
  t('only score_dropped, crawler_blocked and llms_txt_removed are alert types', JSON.stringify(Monitor.ALERT_TYPES) === JSON.stringify(['score_dropped', 'crawler_blocked', 'llms_txt_removed']));
  t('other events never send an email', await (async () => { clock += DAY; const ok = await Alerts.send(ctxA, 'alert-site.com', [Monitor.makeEvent('alert-site.com', { id: 'snp_x', at: new Date(clock).toISOString() }, 'score_improved', 's', 'Readiness score rose from 70 to 80 (+10 points).', {}), Monitor.makeEvent('alert-site.com', { id: 'snp_x', at: new Date(clock).toISOString() }, 'check_fixed', 'c', 'Check now passing: x.', {})]); return ok === 0; })());
  const urlMatch = /https:\/\/getcitehound\.com(\/v1\/watchlist\/unsubscribe\/[0-9a-f]{20}\/alert-site\.com\/[0-9a-f]{32})/.exec(alertMail[0].text);
  const unsubPath = urlMatch[1];
  const ug = await request('GET', unsubPath);
  t('the unsubscribe link opens a page with one button and does not change anything by itself', ug.status === 200 && /<form method="post"/.test(ug.text) && (await Monitor.entries(A, ak.id))['alert-site.com'].alerts === true);
  t('a wrong or foreign signature is a 404 page', (await request('GET', unsubPath.slice(0, -1) + (unsubPath.slice(-1) === '0' ? '1' : '0'))).status === 404 && (await request('POST', unsubPath.replace('alert-site.com', 'other-site.com'))).status === 404 && (await request('GET', '/v1/watchlist/unsubscribe/abc/def/ghi')).status === 404);
  const up = await request('POST', unsubPath, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, rawBody: 'List-Unsubscribe=One-Click' });
  t('a POST (the button, or a mail client\'s one-click) turns alerts off for that domain', up.status === 200 && (await Monitor.entries(A, ak.id))['alert-site.com'].alerts === false);
  const m2 = mails.length; clock += 7 * DAY; world['alert-site.com'] = scan({ thin: true, bots: { ClaudeBot: 'blocked' } }); await runAll();
  t('after that no alert is sent for that domain, but events are still recorded', mails.length === m2 && (await call(ak.key, 'GET', '/v1/events?type=crawler_blocked')).json.events.length >= 2);
  const nk = await makeKey('noalert@example.com', 'pro');
  await call(nk.key, 'POST', '/v1/watchlist', { domain: 'noalert-site.com' });
  const m3 = mails.length; clock += 7 * DAY; world['noalert-site.com'] = scan({ thin: true }); await runAll();
  t('a key with no alert address gets no email', mails.length === m3 && (await call(nk.key, 'GET', '/v1/events?type=score_dropped')).json.events.length === 1);
  const mk2 = await makeKey('mailfail@example.com', 'pro');
  await call(mk2.key, 'POST', '/v1/watchlist', { domain: 'mailfail-site.com', alert_email: 'mailfail@example.com' });
  mailOk = false; clock += 7 * DAY; world['mailfail-site.com'] = scan({ thin: true }); await runAll(); mailOk = true;
  t('a failed email does not use up the day', (await A.get(Alerts.capKey(mk2.id, 'mailfail-site.com', new Date(clock).toISOString().slice(0, 10)))) === null);

  /* ---------- webhooks ---------- */
  out('webhooks');
  reset();
  const wk = await makeKey('hooks@example.com', 'pro');
  const URL1 = 'https://hooks.example.org/citehound';
  const w1 = await call(wk.key, 'POST', '/v1/webhooks', { url: URL1, events: ['score_dropped', 'crawler_blocked'] });
  t('POST /v1/webhooks: 201, a generated secret shown once, the id, the events, enabled', w1.status === 201 && /^whsec_/.test(w1.json.secret) && /^whk_[0-9a-f]{16}$/.test(w1.json.webhook.id) && w1.json.webhook.enabled === true && w1.json.webhook.events.length === 2 && /only time/.test(w1.json.secret_note) && valid('WebhookCreated', w1.json), w1.text.slice(0, 200));
  const secret1 = w1.json.secret, hook1 = w1.json.webhook.id;
  t('the secret is not in the list, the single read or the stored record in plain text', !/whsec_/.test((await call(wk.key, 'GET', '/v1/webhooks')).text) && !/whsec_/.test((await call(wk.key, 'GET', '/v1/webhooks/' + hook1)).text) && JSON.stringify(A._dump()).indexOf(secret1) === -1 && JSON.stringify(A._dump()).indexOf(secret1.slice(6)) === -1);
  t('the stored secret is AES-GCM sealed with the pepper and opens to the secret', await (async () => { const rec = await Webhooks.get(A, wk.id, hook1); return !!rec.secret.iv && !!rec.secret.tag && Webhooks.open(PEPPER, rec.secret) === secret1 && Webhooks.open(PEPPER + 'x', rec.secret) === null; })());
  t('the list and one webhook match the OpenAPI schema', valid('WebhookList', (await call(wk.key, 'GET', '/v1/webhooks')).json) && valid('WebhookOne', (await call(wk.key, 'GET', '/v1/webhooks/' + hook1)).json));
  const own = await call(wk.key, 'POST', '/v1/webhooks', { url: 'https://hooks.example.net/own', secret: 'my-own-secret-of-sixteen+' });
  t('a secret you send is used and never returned', own.status === 201 && own.json.secret === undefined && !/my-own-secret/.test(own.text));
  const badUrls = ['http://hooks.example.org/x', 'https://hooks.example.org:8443/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://localhost/x', 'https://user:pw@hooks.example.org/x', 'https://hooks.example.org/x#f', 'https://intranet.internal/x', 'https://printer.local/x', 'https://169.254.169.254/latest', 'ftp://hooks.example.org/x', 'javascript:alert(1)', 'https://hooks.example.org/' + 'a'.repeat(500), 'https://no-dot/x', 'not a url', '', 12];
  let urlOk = true; for (const u of badUrls) { const r = await call(wk.key, 'POST', '/v1/webhooks', { url: u }); if (r.status !== 400) { urlOk = false; out('    accepted: ' + String(u).slice(0, 50) + ' ' + r.status); } }
  t('addresses that are not https on 443 to a public host are refused (SSRF at registration)', urlOk && Webhooks.validateUrl('https://hooks.example.org/x').ok && Webhooks.validateUrl('https://hooks.example.org:443/x').ok);
  t('events must be known types, the secret 16 to 128 characters without spaces', (await call(wk.key, 'POST', '/v1/webhooks', { url: 'https://hooks.example.com/a', events: ['nope'] })).status === 400 && (await call(wk.key, 'POST', '/v1/webhooks', { url: 'https://hooks.example.com/a', events: [] })).status === 400 && (await call(wk.key, 'POST', '/v1/webhooks', { url: 'https://hooks.example.com/a', secret: 'short' })).status === 400 && (await call(wk.key, 'POST', '/v1/webhooks', { url: 'https://hooks.example.com/a', secret: 'has a space in it but long' })).status === 400);
  t('the same address twice is a 409, and the limit (3 by default, configurable) is a 409 webhook_limit', (await call(wk.key, 'POST', '/v1/webhooks', { url: URL1 })).json.error === 'webhook_exists' && (await call(wk.key, 'POST', '/v1/webhooks', { url: 'https://hooks.example.com/third' })).status === 201 && (await call(wk.key, 'POST', '/v1/webhooks', { url: 'https://hooks.example.com/fourth' })).json.error === 'webhook_limit' && (await call(wk.key, 'POST', '/v1/webhooks', { url: 'https://hooks.example.com/fourth' }, { deps: envDeps({ API_V1_WEBHOOK_LIMIT: '5' }) })).status === 201);

  // signatures
  const test1 = await call(wk.key, 'POST', '/v1/webhooks/' + hook1 + '/test');
  const p1 = posts[posts.length - 1];
  t('POST /v1/webhooks/{id}/test sends one signed test event now and returns the delivery', test1.status === 200 && test1.json.delivery.status === 'delivered' && test1.json.delivery.test === true && test1.json.delivery.attempt === 1 && test1.json.delivery.http_status === 200 && p1.url === URL1 && valid('TestResult', test1.json), test1.text.slice(0, 200));
  const bodyObj = JSON.parse(p1.body);
  t('the body is JSON with the event id, type, time, domain and summary', bodyObj.type === 'test' && /^evt_test_/.test(bodyObj.id) && !!bodyObj.created_at && !!bodyObj.summary && typeof bodyObj.data === 'object');
  t('the signature is v1= and the HMAC-SHA-256 of "<timestamp>.<body>" with the secret; verify() accepts it', /^v1=[0-9a-f]{64}$/.test(p1.headers['X-Citehound-Signature']) && Webhooks.verify(secret1, p1.headers['X-Citehound-Timestamp'], p1.body, p1.headers['X-Citehound-Signature'], 300, clock) && p1.headers['X-Citehound-Signature'] === require('crypto').createHmac('sha256', secret1).update(p1.headers['X-Citehound-Timestamp'] + '.' + p1.body).digest('hex').replace(/^/, 'v1='));
  t('a wrong secret, a changed body and an old timestamp all fail verification', !Webhooks.verify(secret1 + 'x', p1.headers['X-Citehound-Timestamp'], p1.body, p1.headers['X-Citehound-Signature'], 300, clock) && !Webhooks.verify(secret1, p1.headers['X-Citehound-Timestamp'], p1.body + ' ', p1.headers['X-Citehound-Signature'], 300, clock) && !Webhooks.verify(secret1, p1.headers['X-Citehound-Timestamp'], p1.body, p1.headers['X-Citehound-Signature'], 300, clock + 3600 * 1000) && !Webhooks.verify(secret1, p1.headers['X-Citehound-Timestamp'], p1.body, 'v1=short', 300, clock));
  t('the headers carry the event, event id, delivery id and timestamp, and no credential of ours or the caller', ['X-Citehound-Event', 'X-Citehound-Event-Id', 'X-Citehound-Delivery', 'X-Citehound-Timestamp', 'X-Citehound-Signature', 'Content-Type'].every((h) => !!p1.headers[h]) && !Object.keys(p1.headers).some((h) => /authorization|cookie|x-citehound-key/i.test(h)) && p1.headers['X-Citehound-Timestamp'] === String(Math.floor(clock / 1000)));

  // real events reach the hooks that asked for them
  const wd = await makeKey('dispatch@example.com', 'pro');
  const U_ALL = 'https://dispatch.example.org/all', U_DROP = 'https://dispatch.example.org/drop';
  await call(wd.key, 'POST', '/v1/webhooks', { url: U_ALL });
  await call(wd.key, 'POST', '/v1/webhooks', { url: U_DROP, events: ['score_dropped'] });
  world['dispatch-site.com'] = scan();
  await call(wd.key, 'POST', '/v1/watchlist', { domain: 'dispatch-site.com' });
  posts = []; clock += 7 * DAY; world['dispatch-site.com'] = scan({ thin: true, bots: { GPTBot: 'blocked' } }); await runAll();
  const toAll = posts.filter((x) => x.url === U_ALL).map((x) => JSON.parse(x.body).type), toDrop = posts.filter((x) => x.url === U_DROP).map((x) => JSON.parse(x.body).type);
  t('each webhook gets the events it asked for: all of them, or only score_dropped', toAll.length >= 3 && toAll.indexOf('crawler_blocked') !== -1 && toDrop.length === 1 && toDrop[0] === 'score_dropped');
  const dl = (await call(wd.key, 'GET', '/v1/webhooks')).json.webhooks.find((x) => x.url === U_DROP);
  const dlog = await call(wd.key, 'GET', '/v1/webhooks/' + dl.id + '/deliveries');
  t('GET /v1/webhooks/{id}/deliveries: the log shows the event, delivered, the HTTP status; no body, no secret', dlog.status === 200 && dlog.json.deliveries.length === 1 && dlog.json.deliveries[0].status === 'delivered' && dlog.json.deliveries[0].event_type === 'score_dropped' && dlog.json.deliveries[0].http_status === 200 && !/whsec_|"body"/.test(dlog.text) && valid('DeliveryList', dlog.json), dlog.text.slice(0, 200));

  // retries
  const RETRY_URL = 'https://retry.example.org/hook';
  const rkk = await makeKey('retry@example.com', 'pro');
  const rh = await call(rkk.key, 'POST', '/v1/webhooks', { url: RETRY_URL, events: ['score_dropped'] });
  world['retry-site.com'] = scan(); await call(rkk.key, 'POST', '/v1/watchlist', { domain: 'retry-site.com' });
  let status = 500; hooks[RETRY_URL] = async () => (status === 200 ? { ok: true, status: 200 } : { ok: false, status: status });
  posts = []; clock += 7 * DAY; world['retry-site.com'] = scan({ thin: true }); await runAll();
  const firstTry = posts.filter((x) => x.url === RETRY_URL).length;
  let lg = (await call(rkk.key, 'GET', '/v1/webhooks/' + rh.json.webhook.id + '/deliveries')).json.deliveries;
  const pending0 = lg.filter((d) => d.status === 'pending');
  t('a failing endpoint: the first attempt is made, the delivery stays pending with the time of the next try (1 minute)', firstTry >= 1 && pending0.length >= 1 && pending0.every((d) => d.attempt === 1 && d.http_status === 500 && d.error === 'http_500' && Math.abs(Date.parse(d.next_at) - (clock + 60000)) < 1000), JSON.stringify(lg[0]));
  const ctxR = { A: A, p: PEPPER, deps: deps, cfg: Monitor.config(ENV), clock: () => clock, deadlineAt: 0 };
  posts = []; const early = await Webhooks.processPending(ctxR, 50);
  t('before its time nothing is retried', early === 0 && posts.length === 0);
  clock += 61 * 1000; posts = []; const r2 = await Webhooks.processPending(ctxR, 50);
  lg = (await call(rkk.key, 'GET', '/v1/webhooks/' + rh.json.webhook.id + '/deliveries')).json.deliveries;
  t('after a minute: retry 1 fails and the next try is 10 minutes away', r2 >= 1 && lg.filter((d) => d.status === 'pending').every((d) => d.attempt === 2 && Math.abs(Date.parse(d.next_at) - (clock + 600000)) < 1000));
  clock += 601 * 1000; await Webhooks.processPending(ctxR, 50);
  lg = (await call(rkk.key, 'GET', '/v1/webhooks/' + rh.json.webhook.id + '/deliveries')).json.deliveries;
  t('retry 2 fails and the next try is an hour away', lg.filter((d) => d.status === 'pending').every((d) => d.attempt === 3 && Math.abs(Date.parse(d.next_at) - (clock + 3600000)) < 1000));
  clock += 3601 * 1000; await Webhooks.processPending(ctxR, 50);
  lg = (await call(rkk.key, 'GET', '/v1/webhooks/' + rh.json.webhook.id + '/deliveries')).json.deliveries;
  t('after the third retry (four attempts in all) the delivery has failed for good and is no longer pending', lg.every((d) => d.status === 'failed' && d.attempt === 4 && d.next_at === null) && Object.keys(await A.hgetall('api:wh:pend') || {}).length === 0);
  const fwh = (await call(rkk.key, 'GET', '/v1/webhooks/' + rh.json.webhook.id)).json.webhook;
  t('the webhook counts the failed deliveries in a row', fwh.consecutive_failures === lg.length && fwh.enabled === true);
  // success on a retry
  const OK_LATER = 'https://later.example.org/hook';
  const lk = await makeKey('later@example.com', 'pro');
  const lh = await call(lk.key, 'POST', '/v1/webhooks', { url: OK_LATER, events: ['score_dropped'] });
  world['later-site.com'] = scan(); await call(lk.key, 'POST', '/v1/watchlist', { domain: 'later-site.com' });
  let laterStatus = 503; hooks[OK_LATER] = async () => (laterStatus === 200 ? { ok: true, status: 200 } : { ok: false, status: laterStatus });
  clock += 7 * DAY; world['later-site.com'] = scan({ thin: true }); await runAll();
  laterStatus = 200; clock += 61 * 1000; await Webhooks.processPending(ctxR, 50);
  const llg = (await call(lk.key, 'GET', '/v1/webhooks/' + lh.json.webhook.id + '/deliveries')).json.deliveries;
  t('a retry that succeeds marks the delivery delivered (attempt 2) and resets the failure count', llg.every((d) => d.status === 'delivered' && d.attempt === 2) && (await call(lk.key, 'GET', '/v1/webhooks/' + lh.json.webhook.id)).json.webhook.consecutive_failures === 0);
  t('timeouts and refused connections are recorded as short codes, never as a message from the receiver', await (async () => { hooks[OK_LATER] = async () => ({ ok: false, kind: 'timeout' }); const r = await call(lk.key, 'POST', '/v1/webhooks/' + lh.json.webhook.id + '/test'); hooks[OK_LATER] = async () => { throw new Error('secret receiver detail'); }; const r2 = await call(lk.key, 'POST', '/v1/webhooks/' + lh.json.webhook.id + '/test'); hooks[OK_LATER] = undefined; return r.json.delivery.error === 'timeout' && r.json.delivery.status === 'failed' && r2.json.delivery.error === 'network' && r2.text.indexOf('secret receiver detail') === -1; })());
  t('test events never queue a retry and never count as failures', Object.keys(await A.hgetall('api:wh:pend') || {}).length === 0 && (await call(lk.key, 'GET', '/v1/webhooks/' + lh.json.webhook.id)).json.webhook.consecutive_failures === 0);

  // auto-disable
  const DEAD = 'https://dead.example.org/hook';
  const dk2 = await makeKey('dead@example.com', 'pro');
  const dh = await call(dk2.key, 'POST', '/v1/webhooks', { url: DEAD });
  hooks[DEAD] = async () => ({ ok: false, status: 500 });
  const fakeEv = (i) => Monitor.makeEvent('dead-site.com', { id: 'snp_' + i, at: new Date(clock).toISOString() }, 'score_dropped', 's' + i, 'Readiness score dropped from 90 to 70 (-20 points).', { from: 90, to: 70, delta: -20 });
  const hookRec = () => Webhooks.get(A, dk2.id, dh.json.webhook.id);
  for (let i = 0; i < 5; i++) {
    await Webhooks.deliver(ctxR, dk2.id, await hookRec(), fakeEv(i));
    for (let k = 0; k < 3; k++) { clock += 3601 * 1000; await Webhooks.processPending(ctxR, 50); }
  }
  const dead = (await call(dk2.key, 'GET', '/v1/webhooks/' + dh.json.webhook.id)).json.webhook;
  t('after 5 deliveries in a row failed all their attempts the webhook is disabled, with the time and the reason', dead.enabled === false && dead.consecutive_failures === 5 && dead.disabled_reason === 'repeated_failures' && !!dead.disabled_at, JSON.stringify(dead));
  posts = []; await Webhooks.dispatch({ A: A, p: PEPPER, deps: deps, cfg: Monitor.config(ENV), clock: () => clock }, 'dead-site.com', [fakeEv(9)]);
  t('a disabled webhook is not called any more, but the test endpoint still works', posts.length === 0 && (await call(dk2.key, 'POST', '/v1/webhooks/' + dh.json.webhook.id + '/test')).status === 200);
  t('the failure limit is configurable (API_V1_WEBHOOK_MAX_FAILS)', Monitor.config({ API_V1_WEBHOOK_MAX_FAILS: '2' }).maxFails === 2);
  // out of time: the delivery is queued, not dropped
  const qk = await makeKey('queue@example.com', 'pro');
  const qh = await call(qk.key, 'POST', '/v1/webhooks', { url: 'https://queue.example.org/hook' });
  posts = []; const late = await Webhooks.deliver({ A: A, p: PEPPER, deps: deps, cfg: Monitor.config(ENV), clock: () => clock, deadlineAt: Date.now() - 1000 }, qk.id, await Webhooks.get(A, qk.id, qh.json.webhook.id), fakeEv(77));
  t('when a run is out of time a delivery is queued for the next run instead of being sent or lost', late.status === 'pending' && late.attempt === 0 && posts.length === 0 && Object.keys(await A.hgetall('api:wh:pend')).length === 1);
  await Webhooks.processPending(ctxR, 50);
  t('and the queued delivery is sent by the next run', posts.length === 1 && (await call(qk.key, 'GET', '/v1/webhooks/' + qh.json.webhook.id + '/deliveries')).json.deliveries[0].status === 'delivered');
  // log size
  const logk = await makeKey('log@example.com', 'pro');
  const logh = await call(logk.key, 'POST', '/v1/webhooks', { url: 'https://log.example.org/hook' });
  for (let i = 0; i < 55; i++) { clock += 1000; await call(logk.key, 'POST', '/v1/webhooks/' + logh.json.webhook.id + '/test'); }
  t('the delivery log keeps the last 50 and expires after 90 days', (await call(logk.key, 'GET', '/v1/webhooks/' + logh.json.webhook.id + '/deliveries')).json.deliveries.length === 50 && (await A.ttl('api:wdl:' + logh.json.webhook.id)) > 89 * 86400);
  // delete
  const delh = await call(wk.key, 'DELETE', '/v1/webhooks/' + hook1);
  t('DELETE /v1/webhooks/{id} removes the webhook and its log', delh.status === 200 && (await call(wk.key, 'GET', '/v1/webhooks/' + hook1)).status === 404 && (await A.hgetall('api:wdl:' + hook1)) === null);
  t('another key cannot read, delete or test it', await (async () => { const stranger = await makeKey('stranger@example.com', 'pro'); const o = await call(wd.key, 'GET', '/v1/webhooks/' + dl.id); const o2 = await call(stranger.key, 'DELETE', '/v1/webhooks/' + dl.id); const o3 = await call(stranger.key, 'POST', '/v1/webhooks/' + dl.id + '/test'); return o.status === 200 && (await call(stranger.key, 'GET', '/v1/webhooks/' + dl.id)).status === 404 && o2.status === 404 && o3.status === 404; })());
  t('an id that is not a webhook id is a 404 and the path is not trusted', (await call(wk.key, 'GET', '/v1/webhooks/..%2Fadmin')).status === 404 && (await call(wk.key, 'GET', '/v1/webhooks/whk_zzzz')).status === 404 && (await call(wk.key, 'PUT', '/v1/webhooks')).status === 405);

  /* ---------- the webhook POST goes through the fetch guard ---------- */
  out('fetch guard');
  const seenReq = [];
  const srv = http.createServer((rq, rs) => { let b = ''; rq.on('data', (c) => { b += c; }); rq.on('end', () => { seenReq.push({ method: rq.method, url: rq.url, headers: rq.headers, body: b }); if (rq.url === '/redirect') { rs.writeHead(302, { Location: '/target' }); return rs.end(); } rs.writeHead(rq.url === '/fail' ? 500 : 200, { 'Content-Type': 'text/plain' }); rs.end('ok'); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port;
  const testGet = safeFetch.makeSafeGet({ lookup: (host, o, cb) => (o && o.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)), allowPort: true });
  const pr = await testGet('http://hook.test:' + port + '/in', { ua: 'Citehound-Webhook/1.0', method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'application/json', 'X-Citehound-Signature': 'v1=abc' }, maxRedirects: 4 });
  t('safe-fetch can POST a body with its headers, once, and returns the status', pr.ok && pr.status === 200 && seenReq.length === 1 && seenReq[0].method === 'POST' && seenReq[0].body === '{"a":1}' && seenReq[0].headers['x-citehound-signature'] === 'v1=abc' && seenReq[0].headers['content-type'] === 'application/json' && !seenReq[0].headers.authorization && !seenReq[0].headers.cookie);
  const pr2 = await testGet('http://hook.test:' + port + '/redirect', { ua: 'x', method: 'POST', body: '{"secret":"body"}', headers: { 'X-Citehound-Signature': 'v1=abc' }, maxRedirects: 4 });
  t('a redirect is never followed for a POST: the body and the signature are not replayed to another address', pr2.status === 302 && pr2.ok === false && seenReq.filter((x) => x.url === '/target').length === 0 && seenReq.filter((x) => x.url === '/redirect').length === 1);
  t('a 500 is returned as a failure, not as an error of the guard', (await testGet('http://hook.test:' + port + '/fail', { ua: 'x', method: 'POST', body: '{}' })).status === 500);
  await new Promise((r) => srv.close(r));
  const real = await safeFetch.safeGet('https://127.0.0.1/hook', { ua: 'x', method: 'POST', body: '{}' });
  const real2 = await safeFetch.safeGet('https://localhost/hook', { ua: 'x', method: 'POST', body: '{}', timeoutMs: 3000 });
  const real3 = await safeFetch.safeGet('http://hooks.example.org:8080/hook', { ua: 'x', method: 'POST', body: '{}' });
  t('the production guard refuses numeric addresses, names that resolve to private addresses and non-default ports for a POST too', real.ok === false && real.kind === 'blocked_host' && real2.ok === false && real2.kind === 'blocked_host' && real3.ok === false && real3.kind === 'bad_url', JSON.stringify([real.kind, real2.kind, real3.kind]));
  t('the delivery code calls only the guarded fetch (no direct request in webhooks.js)', /require\('\.\.\/safe-fetch\.js'\)\.safeGet/.test(read('lib/api-v1/webhooks.js')) && !/\bfetch\(|https?\.request|net\.connect/.test(read('lib/api-v1/webhooks.js').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));

  /* ---------- revoking a key deletes everything ---------- */
  out('revoke and purge');
  reset();
  const pk = await makeKey('purge@example.com', 'pro');
  world['purge-site.com'] = scan();
  await call(pk.key, 'POST', '/v1/watchlist', { domain: 'purge-site.com', alert_email: 'purge@example.com' });
  world['alpha-watch.com'] = scan();
  const keeper = await makeKey('keeper@example.com', 'pro');
  await call(keeper.key, 'POST', '/v1/watchlist', { domain: 'alpha-watch.com' });
  await call(pk.key, 'POST', '/v1/watchlist', { domain: 'alpha-watch.com' });
  const ph = await call(pk.key, 'POST', '/v1/webhooks', { url: 'https://purge.example.org/hook' });
  hooks['https://purge.example.org/hook'] = async () => ({ ok: false, status: 500 });
  clock += 7 * DAY; world['purge-site.com'] = scan({ thin: true }); await runAll();
  const hadPending = Object.keys(await A.hgetall('api:wh:pend') || {}).length;
  const tokenP = /\/v1\/keys\/revoke\/([0-9a-f.]+)/.exec(pk.mail.text)[1];
  await request('POST', '/v1/keys/revoke/' + tokenP);
  const d2 = JSON.stringify(A._dump());
  t('revoking a key deletes its watchlist, alert address, webhooks, delivery logs and pending retries', hadPending >= 1 && (await A.hgetall('api:wl:' + pk.id)) === null && (await A.hgetall('api:ae:' + pk.id)) === null && (await A.hgetall('api:wh:' + pk.id)) === null && (await A.hgetall('api:wdl:' + ph.json.webhook.id)) === null && !Object.keys(await A.hgetall('api:wh:pend') || {}).some((k) => /purge/.test(k)) && d2.indexOf('purge-site.com') === -1 && d2.indexOf('purge@example.com') === -1 && d2.indexOf('purge.example.org') === -1);
  t('a domain somebody else still watches keeps its data', (await A.smembers('api:wd:all')).includes('alpha-watch.com') && (await Monitor.snapshots(A, 'alpha-watch.com')).length >= 1 && (await call(keeper.key, 'GET', '/v1/watchlist')).json.used === 1);
  t('a domain nobody watches is gone', !(await A.smembers('api:wd:all')).includes('purge-site.com') && (await A.hgetall('api:hist:purge-site.com')) === null);

  /* ---------- the documents ---------- */
  out('documents');
  const spec = OA.spec();
  const monOps = []; Object.keys(spec.paths).forEach((p) => Object.keys(spec.paths[p]).forEach((m) => { const o = spec.paths[p][m]; if (o.tags.indexOf('Monitoring') !== -1 || o.tags.indexOf('Webhooks') !== -1) monOps.push(o); }));
  t('every monitoring operation is marked Pro (x-plan, the summary and the description), and nothing else is', monOps.length === 11 && monOps.every((o) => o['x-plan'] === 'pro' && /^Pro: /.test(o.summary) && /^Pro plan only\./.test(o.description) && o.responses['403']) && Object.keys(spec.paths).every((p) => Object.keys(spec.paths[p]).every((m) => monOps.indexOf(spec.paths[p][m]) !== -1 || !spec.paths[p][m]['x-plan'])));
  t('the examples in the document match their schemas', OA.ENDPOINTS.every((e) => valid(e.ok.schema, e.ok.example)));
  const page = read('api.html');
  const text = page.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
  t('the /api page has a Monitoring (Pro) section with the event types, the signature headers, the retries and a verify sample', /Monitoring \(Pro\)/.test(text) && Monitor.EVENT_TYPES.every((e) => text.indexOf(e) !== -1) && /X-Citehound-Signature/.test(text) && /1 minute, 10 minutes and 1 hour/.test(text) && /timingSafeEqual/.test(text) && /<strong>Pro<\/strong>/.test(page));
  t('the page says only what is built: a daily job, weekly re-scans per domain, retries that wait for the job, no dashboard, no paid checkout', /scheduled job runs once a day/.test(text) && /about 7 days after their last scan/.test(text) && /up to a day late/.test(text) && /no checkout/.test(text) && !/real-time|instant alert|unlimited|dashboard/i.test(text));
  t('the page and the document name no third-party automation tool', !/Zapier|Make\.com|n8n|IFTTT|Slack|Looker/i.test(page + read('openapi.yaml')));
  t('vercel.json has one cron: the job, once a day (Hobby allows nothing more often), and the function keeps 12 of 12', (() => { const v = JSON.parse(read('vercel.json')); const fn = []; (function walk(d) { fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).forEach((e) => { if (e.isDirectory()) walk(d + '/' + e.name); else if (/\.js$/.test(e.name) && e.name[0] !== '_') fn.push(d + '/' + e.name); }); })('api'); return v.crons.length === 1 && v.crons[0].path === '/api/v1/cron' && /^\d+ \d+ \* \* \*$/.test(v.crons[0].schedule) && fn.length === 12; })());
  t('the path Vercel Cron calls (/api/v1/cron, one segment: the catch-all file matches one segment only) reaches the job, and so does /v1/cron/run', (await request('GET', '/api/v1/cron', { headers: { authorization: 'Bearer ' + ENV.CRON_SECRET }, query: { path: 'cron' } })).status === 200 && (await request('GET', '/v1/cron/run', { headers: { authorization: 'Bearer ' + ENV.CRON_SECRET }, query: { path: 'r', route: 'cron/run' } })).status === 200 && (await request('GET', '/api/v1/cron', { query: { path: 'cron' } })).status === 401);
  t('the cron route and the unsubscribe route are not in the public document', JSON.stringify(spec).indexOf('cron') === -1 && JSON.stringify(spec).indexOf('unsubscribe') === -1);

  /* ---------- nothing secret is logged ---------- */
  out('logs');
  const allLogs = logged.join('\n');
  t('nothing logged contains a key, an address, a webhook secret, a webhook address, the pepper or a token', !/chk_[A-Za-z0-9_-]{32}/.test(allLogs) && !/@example\.com/i.test(allLogs) && !/whsec_/.test(allLogs) && !/example\.org/.test(allLogs) && allLogs.indexOf(PEPPER) === -1 && allLogs.indexOf(ENV.ADMIN_TOKEN) === -1 && allLogs.indexOf(ENV.CRON_SECRET) === -1 && allLogs.indexOf('my-own-secret') === -1, allLogs.slice(0, 200));
  t('the monitoring code logs nothing', !/console\.(log|info|warn|error)/.test(['monitor.js', 'monitor-routes.js', 'webhooks.js', 'alerts.js', 'util.js'].map((f) => read('lib/api-v1/' + f)).join('\n')));

  out('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { fails.forEach((f) => out('FAIL: ' + f)); process.exit(1); }
})().catch((e) => { out('CRASH ' + (e && e.stack || e)); process.exit(1); });
