'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCore, CitehoundError, cleanDomain, OPS } = require('../citehound-core.js');

const KEY = 'chk_' + 'Kk9Zz8Yy'.repeat(4);
const reply = (status, body, headers) => ({ status: status, headers: { get: (k) => (headers || {})[String(k).toLowerCase()] || null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
function mock(handler) { const calls = []; const f = async (url, init) => { calls.push({ url: url, init: init }); return handler(url, init, calls.length); }; f.calls = calls; return f; }
const core = (f) => createCore({ apiKey: KEY, fetch: f, platform: 'test' });

test('a key is required and must look like a key; the base must be https (or localhost)', () => {
  assert.throws(() => createCore({ apiKey: '', fetch: () => {} }), (e) => e.code === 'missing_key' && /api/.test(e.message));
  assert.throws(() => createCore({ apiKey: 'nope', fetch: () => {} }), (e) => e.code === 'bad_key' && !e.message.includes('nope'));
  assert.throws(() => createCore({ apiKey: KEY, fetch: () => {}, baseUrl: 'http://example.org' }), (e) => e.code === 'bad_base');
  assert.doesNotThrow(() => createCore({ apiKey: KEY, fetch: () => {}, baseUrl: 'http://127.0.0.1:8080' }));
});
test('a request: path, query, Bearer header, user agent, JSON body for POST', async () => {
  const f = mock(() => reply(200, { ok: 1 }));
  const c = core(f);
  await c.run('scan', { domain: 'HTTPS://www.Example.com/x' });
  await c.run('robotsTxt', { allow: ['GPTBot'], block: [], sitemap: '' });
  await c.run('events', { since: 'evt_1', type: 'score_dropped,crawler_blocked', limit: 5, ignored: 'x' });
  assert.equal(f.calls[0].url, 'https://getcitehound.com/v1/scan?domain=example.com'); assert.equal(f.calls[0].init.method, 'GET'); assert.equal(f.calls[0].init.headers.Authorization, 'Bearer ' + KEY); assert.match(f.calls[0].init.headers['User-Agent'], /^citehound-test\//); assert.equal(f.calls[0].init.body, undefined);
  assert.equal(f.calls[1].url, 'https://getcitehound.com/v1/generate/robots-txt'); assert.equal(f.calls[1].init.method, 'POST'); assert.equal(f.calls[1].init.headers['Content-Type'], 'application/json'); assert.deepEqual(JSON.parse(f.calls[1].init.body), { allow: ['GPTBot'], block: [] });
  assert.equal(f.calls[2].url, 'https://getcitehound.com/v1/events?since=evt_1&type=score_dropped%2Ccrawler_blocked&limit=5');
});
test('domains are cleaned and refused when they are not domains, before any request', async () => {
  const f = mock(() => reply(200, {}));
  const c = core(f);
  for (const bad of ['localhost', 'a b.com', 'x@y.com', 'example.com:80']) await assert.rejects(() => c.run('scan', { domain: bad }), (e) => e.code === 'invalid_domain');
  assert.equal(f.calls.length, 0); assert.equal(cleanDomain('https://WWW.A-b.co.uk/'), 'a-b.co.uk');
  await assert.rejects(() => c.run('compare', { a: 'a.com', b: 'nope' }), (e) => e.code === 'invalid_domain');
  await assert.rejects(() => c.run('nothing', {}), (e) => e.code === 'bad_operation');
});
test('errors are plain: 401, 402 (with the plan), 403, 429 (with the wait), 4xx, 502, 503, network, not JSON; the key never appears', async () => {
  const cases = [[reply(401, { error: 'invalid_key', message: 'x ' + KEY }), 401, 'invalid_key', /did not accept that API key/], [reply(402, { error: 'plan_required', required_plan: 'fix', message: 'The fix list is available on Fix and Beyond. See https://getcitehound.com/pricing. ' + KEY }), 402, 'plan_required', /available on Fix and Beyond/],
    [reply(403, { error: 'key_revoked', message: 'That key has been revoked.' }), 403, 'key_revoked', /revoked/], [reply(429, { message: 'This key has used its requests.' }, { 'retry-after': '90' }), 429, 'rate_limited', /about 90 seconds/], [reply(400, { error: 'invalid_domain', message: 'Give a bare domain.' }), 400, 'invalid_domain', /Give a bare domain/],
    [reply(502, { message: 'Could not read https://a.com/.' }), 502, 'scan_failed', /Could not read/], [reply(503, {}), 503, 'not_configured', /not available right now/], [reply(500, 'oops'), 500, 'error', /HTTP 500/]];
  for (const [r, status, code, re] of cases) {
    await assert.rejects(() => core(mock(() => r)).run('scan', { domain: 'a.com' }), (e) => e instanceof CitehoundError && e.status === status && e.code === code && re.test(e.message) && !e.message.includes(KEY));
  }
  await assert.rejects(() => core(mock(() => { throw new TypeError('fetch failed ' + KEY); })).run('me'), (e) => e.code === 'network' && !e.message.includes(KEY));
  await assert.rejects(() => core(mock(() => reply(200, '<html>'))).run('me'), (e) => e.code === 'bad_response');
  const plan = await core(mock(() => reply(402, { error: 'plan_required', required_plan: 'beyond', message: 'm' }))).run('exportData', { domain: 'a.com' }).catch((e) => e);
  assert.equal(plan.requiredPlan, 'beyond');
});
test('a CSV export comes back as { csv }', async () => {
  const r = await core(mock(() => reply(200, 'id,at\nevt_1,2026-10-22'))).run('exportData', { domain: 'a.com', format: 'csv' });
  assert.deepEqual(r, { csv: 'id,at\nevt_1,2026-10-22' });
});
test('every operation in the table has a method and a path and uses only /v1 paths', () => {
  Object.keys(OPS).forEach((k) => { assert.ok(['GET', 'POST', 'DELETE'].includes(OPS[k][0]), k); assert.match(OPS[k][1], /^\/[a-z/-]+$/, k); });
  assert.ok(Object.keys(OPS).length >= 15);
});

/* ---------- the polling trigger ---------- */

const ev = (n, type) => ({ id: 'evt_' + String(n).padStart(4, '0'), type: type || 'score_dropped', domain: 'a.com', at: '2026-10-2' + n, summary: 's' + n });
test('the first poll only remembers the newest event: nothing old is sent as new', async () => {
  const f = mock((url) => reply(200, { events: [ev(9)], has_more: true, next_cursor: 'x' }));
  const r = await core(f).pollEvents({}, {});
  assert.deepEqual(r.events, []); assert.equal(r.state.lastId, 'evt_0009'); assert.match(f.calls[0].url, /limit=1/);
});
test('the first poll with firstRun "latest" returns the newest few, oldest first (for a test run)', async () => {
  const f = mock(() => reply(200, { events: [ev(9), ev(8), ev(7)], has_more: false, next_cursor: null }));
  const r = await core(f).pollEvents({}, { firstRun: 'latest', types: ['score_dropped'] });
  assert.deepEqual(r.events.map((e) => e.id), ['evt_0007', 'evt_0008', 'evt_0009']); assert.match(f.calls[0].url, /limit=5/); assert.match(f.calls[0].url, /type=score_dropped/);
});
test('later polls ask for events since the last id, follow the cursor, return oldest first and move the mark', async () => {
  const pages = { undefined: { events: [ev(14), ev(13)], has_more: true, next_cursor: 'evt_0013' }, evt_0013: { events: [ev(12), ev(11)], has_more: false, next_cursor: null } };
  const f = mock((url) => { const u = new URL(url); return reply(200, pages[u.searchParams.get('cursor') || 'undefined']); });
  const r = await core(f).pollEvents({ lastId: 'evt_0010' }, { domain: 'a.com' });
  assert.deepEqual(r.events.map((e) => e.id), ['evt_0011', 'evt_0012', 'evt_0013', 'evt_0014']); assert.equal(r.state.lastId, 'evt_0014');
  assert.equal(new URL(f.calls[0].url).searchParams.get('since'), 'evt_0010'); assert.equal(new URL(f.calls[1].url).searchParams.get('cursor'), 'evt_0013'); assert.equal(new URL(f.calls[0].url).searchParams.get('domain'), 'a.com');
  const none = await core(mock(() => reply(200, { events: [], has_more: false, next_cursor: null }))).pollEvents({ lastId: 'evt_0014' }, {});
  assert.deepEqual(none.events, []); assert.equal(none.state.lastId, 'evt_0014');
});
test('a poll on a free key surfaces the plan message instead of an empty list', async () => {
  await assert.rejects(() => core(mock(() => reply(402, { error: 'plan_required', required_plan: 'pro', message: 'Monitoring is available on Pro, Fix and Beyond.' }))).pollEvents({ lastId: 'evt_1' }, {}), (e) => e.status === 402 && /Pro, Fix and Beyond/.test(e.message));
});
