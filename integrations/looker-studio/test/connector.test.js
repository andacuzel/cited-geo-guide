'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const KEY = 'chk_' + 'Ll5Ss6Tt'.repeat(4);

// A small stand-in for the Apps Script and Looker Studio services the connector uses.
function load(api, opts) {
  opts = opts || {};
  const props = {}, cacheStore = {}, calls = [];
  const chain = (f) => new Proxy(f, { get: (t, p) => (p in t ? t[p] : (...a) => { if (/^set/.test(String(p))) t[String(p).slice(3).toLowerCase()] = a[0]; return chain(t); }) });
  const fields = () => { const items = []; const mk = (kind) => () => { const f = { kind: kind, getId() { return this.id; } }; f.setId = (x) => { f.id = x; return chain(f); }; items.push(f); return chain(f); }; const o = { items: items, newDimension: mk('dim'), newMetric: mk('metric'), forIds(ids) { const s = fields(); s.items = ids.map((id) => items.find((f) => f.id === id)); s.asArray = () => s.items; s.build = () => s.items; return s; }, asArray: () => items, build: () => items }; return o; };
  const thrown = [];
  const cc = {
    AuthType: { KEY: 'KEY' }, FieldType: new Proxy({}, { get: (t, p) => String(p) }), AggregationType: new Proxy({}, { get: (t, p) => String(p) }),
    newAuthTypeResponse: () => { const r = { setAuthType(t) { r.type = t; return r; }, setHelpUrl(u) { r.help = u; return r; }, build() { return r; } }; return r; },
    getConfig: () => { const cfg = { entries: [], options: [], newInfo() { return chain({ setId() { return this; } }); }, newTextInput() { const e = { kind: 'text' }; cfg.entries.push(e); return chain(e); }, newSelectSingle() { const e = { kind: 'select' }; e.addOption = (o) => { cfg.options.push(o); return chain(e); }; cfg.entries.push(e); return chain(e); }, newOptionBuilder() { const o = {}; const c = new Proxy(o, { get: (t, p) => (p in t ? t[p] : (a) => { t[String(p).slice(3).toLowerCase()] = a; return c; }) }); return c; }, setDateRangeRequired(v) { cfg.dateRequired = v; }, build() { return cfg; } }; return cfg; },
    getFields: fields,
    newUserError: () => { const e = {}; const c = { setText(t) { e.text = t; return c; }, setDebugText(t) { e.debug = t; return c; }, throwException() { thrown.push(e); const x = new Error('USER:' + e.text); x.user = e; throw x; } }; return c; },
  };
  const ctx = {
    DataStudioApp: { createCommunityConnector: () => cc },
    PropertiesService: { getUserProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; } }) },
    CacheService: { getUserCache: () => ({ get: (k) => (k in cacheStore ? cacheStore[k] : null), put: (k, v, s) => { cacheStore[k] = v; ctx._ttl = s; } }) },
    UrlFetchApp: { fetch: (url, o) => { calls.push({ url, o }); const r = api(url, o); return { getResponseCode: () => r.status, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)), getHeaders: () => r.headers || {} }; } },
    encodeURIComponent: encodeURIComponent, JSON: JSON, console: console,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  return { ctx, props, cacheStore, calls, thrown, cc };
}
const ok = (body) => ({ status: 200, body: body });
const SCAN = { domain: 'example.com', scannedAt: '2026-10-22T12:00:00.000Z', score: 62, pillars: [{ id: 'discover', score: 20 }, { id: 'tech', score: 12 }, { id: 'trust', score: 30 }], failed: [{ fix: 'Add an llms.txt' }], crawlerSummary: { open: 1, limited: 0, blocked: 1 } };
const req = (source, domains, fields) => ({ configParams: { source: source, domains: domains }, fields: fields.map((n) => ({ name: n })) });

test('the manifest: V8, only getcitehound.com may be fetched, the Looker Studio block with the readiness sentence', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'appsscript.json'), 'utf8'));
  assert.equal(m.runtimeVersion, 'V8'); assert.deepEqual(m.urlFetchWhitelist, ['https://getcitehound.com/']); assert.equal(m.dataStudio.name, 'Citehound'); assert.match(m.dataStudio.description, /does not measure whether any assistant names a brand/);
});
test('authentication: a key type with the signup link; a valid key is stored in the user properties after /v1/me answers; a wrong or malformed key is refused and not stored', () => {
  const c = load((url) => (url.endsWith('/me') ? ok({ plan: 'pro' }) : { status: 404, body: {} }));
  const a = ctxCall(c, 'getAuthType'); assert.equal(a.type, 'KEY'); assert.equal(a.help, 'https://getcitehound.com/api');
  assert.deepEqual(ctxCall(c, 'setCredentials', { key: 'nope' }), { errorCode: 'INVALID_CREDENTIALS' }); assert.equal(c.calls.length, 0);
  assert.deepEqual(ctxCall(c, 'setCredentials', { key: KEY }), { errorCode: 'NONE' }); assert.equal(c.props['dscc.key'], KEY); assert.equal(c.calls[0].o.headers.Authorization, 'Bearer ' + KEY); assert.equal(ctxCall(c, 'isAuthValid'), true);
  ctxCall(c, 'resetAuth'); assert.equal(ctxCall(c, 'isAuthValid'), false);
  const bad = load(() => ({ status: 401, body: { error: 'invalid_key' } })); assert.deepEqual(ctxCall(bad, 'setCredentials', { key: KEY }), { errorCode: 'INVALID_CREDENTIALS' }); assert.equal(bad.props['dscc.key'], undefined);
  assert.equal(ctxCall(c, 'isAdminUser'), false);
});
// Values made inside the sandbox have another Object prototype: a JSON round trip makes them comparable.
function ctxCall(c, fn, arg) { const r = vm.runInContext(fn, c.ctx)(arg); return r === undefined || typeof r === 'boolean' ? r : JSON.parse(JSON.stringify(r, (k, v) => (typeof v === 'function' ? undefined : v))); }
test('the configuration: three data sources, a domains box, no date range', () => {
  const c = load(() => ok({})); const cfg = ctxCall(c, 'getConfig', {});
  assert.deepEqual(cfg.options.map((o) => o.value), ['scan', 'history', 'events']); assert.equal(cfg.dateRequired, false); assert.ok(cfg.entries.some((e) => e.kind === 'text' && e.id === 'domains'));
  assert.match(cfg.options[1].label, /Pro, Fix, Beyond/);
});
test('the schema per source: scan, history and events have their fields, the plan-gated ones say so in the option labels', () => {
  const c = load(() => ok({}));
  const ids = (s) => ctxCall(c, 'getSchema', { configParams: { source: s } }).schema.map((f) => f.id);
  assert.deepEqual(ids('scan'), ['domain', 'scanned_on', 'score', 'discoverability', 'technical', 'content_trust', 'crawlers_open', 'crawlers_limited', 'findings_shown', 'top_fix', 'crawlers_blocked']);
  assert.deepEqual(ids('history'), ['domain', 'scanned_at', 'score', 'failed_checks', 'crawlers_blocked', 'llms_txt', 'json_ld']); assert.deepEqual(ids('events'), ['event_id', 'at', 'domain', 'type', 'summary', 'count']);
});
test('scan data: one call per domain with the Bearer key, cleaned domains, at most ten, values in the order of the requested fields; a refresh is served from the cache', () => {
  const c = load((url) => ok(Object.assign({}, SCAN, { domain: new URL(url).searchParams.get('domain') })));
  ctxCall(c, 'setCredentials', { key: KEY }); c.calls.length = 0;
  const r1 = ctxCall(c, 'getData', req('scan', 'https://www.Example.com/x, other.org', ['score', 'domain', 'discoverability', 'top_fix']));
  assert.deepEqual(r1.rows, [{ values: [62, 'example.com', 20, 'Add an llms.txt'] }, { values: [62, 'other.org', 20, 'Add an llms.txt'] }]);
  assert.deepEqual(c.calls.map((x) => x.url), ['https://getcitehound.com/v1/scan?domain=example.com', 'https://getcitehound.com/v1/scan?domain=other.org']); assert.equal(c.calls[0].o.headers.Authorization, 'Bearer ' + KEY);
  ctxCall(c, 'getData', req('scan', 'example.com, other.org', ['score'])); assert.equal(c.calls.length, 2); assert.equal(c.ctx._ttl, 21600);
  const many = Array.from({ length: 14 }, (_, i) => 'site' + i + '.com').join(',');
  c.calls.length = 0; ctxCall(c, 'getData', req('scan', many, ['domain'])); assert.equal(c.calls.length, 10);
});
test('history data: one row per stored scan, with the counts and the flags', () => {
  const c = load(() => ok({ domain: 'a.com', snapshots: [{ at: '2026-10-22T12:00:00.000Z', score: 70, failed: ['x', 'y'], crawlers: { GPTBot: 'blocked', CCBot: 'open' }, llms_txt: true, schema: false }] }));
  ctxCall(c, 'setCredentials', { key: KEY });
  const r = ctxCall(c, 'getData', req('history', 'a.com', ['domain', 'scanned_at', 'score', 'failed_checks', 'crawlers_blocked', 'llms_txt', 'json_ld']));
  assert.deepEqual(r.rows, [{ values: ['a.com', '2026102212', 70, 2, 1, true, false] }]); assert.match(c.calls[c.calls.length - 1].url, /\/history\?domain=a\.com&limit=120$/);
});
test('events data: one row per event for all watched domains, or one domain', () => {
  const c = load(() => ok({ events: [{ id: 'evt_2', at: '2026-10-22T12:00:00.000Z', domain: 'a.com', type: 'score_dropped', summary: 'Score dropped.' }], has_more: false }));
  ctxCall(c, 'setCredentials', { key: KEY });
  const r = ctxCall(c, 'getData', req('events', '', ['event_id', 'at', 'domain', 'type', 'summary', 'count']));
  assert.deepEqual(r.rows, [{ values: ['evt_2', '2026102212', 'a.com', 'score_dropped', 'Score dropped.', 1] }]); assert.match(c.calls[c.calls.length - 1].url, /\/events\?limit=100$/);
});
test('a plan gate, a limit, a wrong key and no domains each become a plain message in Looker Studio; the key is in none of them', () => {
  const run = (resp, source, domains) => { const c = load(() => resp); ctxCall(c, 'setCredentials', { key: KEY }); c.props['dscc.key'] = KEY; try { ctxCall(c, 'getData', req(source, domains, ['score'])); } catch (e) { return e.user; } return null; };
  const gate = run({ status: 402, body: { error: 'plan_required', message: 'Monitoring (watchlist, history, events, alerts and webhooks) is available on Pro, Fix and Beyond. See the plans at https://getcitehound.com/pricing. ' + KEY } }, 'history', 'a.com');
  assert.match(gate.text, /available on Pro, Fix and Beyond/);
  const lim = run({ status: 429, body: { message: 'A free key may scan 5 sites a day.' }, headers: { 'Retry-After': '3600' } }, 'scan', 'a.com'); assert.match(lim.text, /scan 5 sites a day\. Try again in about 3600 seconds/);
  assert.match(run({ status: 401, body: {} }, 'scan', 'a.com').text, /did not accept the API key/);
  assert.match(run({ status: 502, body: { message: 'Could not read https://a.com/.' } }, 'scan', 'a.com').text, /Could not read/);
  assert.match(run(ok({}), 'scan', '').text, /at least one domain/);
  [gate, lim].forEach((e) => assert.ok(!JSON.stringify(e).includes(KEY)));
});
test('the connector names no recommendation, ranking or guarantee, and puts the key in no field or configuration', () => {
  const src = fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8');
  assert.doesNotMatch(src, /recommend|guarantee|official|partner|ranking/i); assert.doesNotMatch(src, /chk_[A-Za-z0-9_-]{20,}/);
  assert.match(src, /does not measure whether any assistant names a brand/);
});
