'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../index.js');

const KEY = 'chk_' + 'Zz1Yy2Xx'.repeat(4);
class ZError extends Error { constructor(m, code, status) { super(m); this.code = code; this.status = status; } }
// A fake z. api(url, options) answers like the Citehound API.
function fakeZ(api) {
  const calls = [];
  return { calls: calls, errors: { Error: ZError }, request: async (o) => { calls.push(o); const r = api(o.url, o); const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body); return { status: r.status, headers: { get: (k) => (r.headers || {})[k.toLowerCase()] || null }, content: body, data: r.body }; } };
}
const ok = (body) => ({ status: 200, body: body });
const bundle = (inputData) => ({ authData: { apiKey: KEY }, inputData: inputData || {} });

test('the app definition: version, platform version, custom authentication with an API key field, one trigger, the creates', () => {
  assert.match(app.version, /^\d+\.\d+\.\d+$/); assert.match(app.platformVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(app.authentication.type, 'custom'); assert.equal(app.authentication.fields[0].key, 'apiKey'); assert.equal(app.authentication.fields[0].type, 'password');
  assert.deepEqual(Object.keys(app.triggers), ['new_event']); assert.equal(app.triggers.new_event.operation.type, 'polling');
  assert.deepEqual(Object.keys(app.creates), ['scan_domain', 'compare_domains', 'generate_llms_txt', 'generate_robots_txt', 'generate_schema', 'watch_domain', 'get_fix_list']);
  Object.values(app.creates).concat([app.triggers.new_event]).forEach((x) => { assert.ok(x.key && x.noun && x.display.label && x.display.description && x.operation.sample, x.key); assert.equal(typeof x.operation.perform, 'function'); });
  assert.doesNotMatch(JSON.stringify(app, (k, v) => (typeof v === 'function' ? 'fn' : v)), /recommend|guarantee|official|partner/i);
});
test('authentication test calls /v1/me with the Bearer key; a wrong key becomes a Zapier error with a plain message', async () => {
  const z = fakeZ(() => ok({ plan: 'pro', email: 'a***@example.com' }));
  assert.deepEqual(await app.authentication.test(z, bundle()), { plan: 'pro', email: 'a***@example.com' });
  assert.equal(z.calls[0].url, 'https://getcitehound.com/v1/me'); assert.equal(z.calls[0].headers.Authorization, 'Bearer ' + KEY); assert.equal(z.calls[0].skipThrowForStatus, true);
  await assert.rejects(() => app.authentication.test(fakeZ(() => ({ status: 401, body: { error: 'invalid_key', message: 'x ' + KEY } })), bundle()), (e) => e instanceof ZError && e.status === 401 && /did not accept that API key/.test(e.message) && !e.message.includes(KEY));
});
test('scan, compare, schema, watch and the fix list call the right paths with the input', async () => {
  const seen = [];
  const z = fakeZ((url, o) => { seen.push(o.method + ' ' + url.replace('https://getcitehound.com/v1', '') + (o.body ? ' ' + o.body : '')); return ok({ ok: true }); });
  const c = app.creates;
  await c.scan_domain.operation.perform(z, bundle({ domain: 'https://www.Example.com/' })); await c.compare_domains.operation.perform(z, bundle({ a: 'a.com', b: 'b.com' })); await c.generate_schema.operation.perform(z, bundle({ domain: 'a.com' }));
  await c.watch_domain.operation.perform(z, bundle({ domain: 'a.com', alert_email: 'me@example.com' })); await c.get_fix_list.operation.perform(z, bundle({ domain: 'a.com' }));
  assert.deepEqual(seen, ['GET /scan?domain=example.com', 'GET /compare?a=a.com&b=b.com', 'GET /generate/schema?domain=a.com&type=organization', 'POST /watchlist {"domain":"a.com","alert_email":"me@example.com"}', 'GET /fixes?domain=a.com']);
});
test('generate llms.txt and robots.txt turn the text fields into lists', async () => {
  const seen = [];
  const z = fakeZ((url, o) => { seen.push(o.body); return ok({ content: 'c' }); });
  await app.creates.generate_llms_txt.operation.perform(z, bundle({ name: 'Example', description: 'Things.', pages: 'https://e.com/a | Page A\nhttps://e.com/b | Page B\n\n' }));
  await app.creates.generate_robots_txt.operation.perform(z, bundle({ allow: 'GPTBot, ClaudeBot', block: 'Bytespider', sitemap: '' }));
  assert.deepEqual(seen.map((s) => JSON.parse(s)), [{ name: 'Example', description: 'Things.', pages: [{ url: 'https://e.com/a', description: 'Page A' }, { url: 'https://e.com/b', description: 'Page B' }] }, { allow: ['GPTBot', 'ClaudeBot'], block: ['Bytespider'] }]);
});
test('the trigger returns the events, newest first, each with its id (Zapier removes what it has seen), and passes the filters', async () => {
  const evs = [{ id: 'evt_3', type: 'score_dropped' }, { id: 'evt_2', type: 'crawler_blocked' }];
  const z = fakeZ(() => ok({ events: evs, has_more: false, next_cursor: null }));
  const r = await app.triggers.new_event.operation.perform(z, bundle({ domain: 'a.com', type: 'score_dropped,crawler_blocked' }));
  assert.deepEqual(r, evs); const u = new URL(z.calls[0].url);
  assert.equal(u.pathname, '/v1/events'); assert.equal(u.searchParams.get('domain'), 'a.com'); assert.equal(u.searchParams.get('type'), 'score_dropped,crawler_blocked'); assert.equal(u.searchParams.get('limit'), '50');
});
test('plan gates, limits and bad domains become Zapier errors with the API\'s own message and never the key', async () => {
  const gate = fakeZ(() => ({ status: 402, body: { error: 'plan_required', required_plan: 'pro', message: 'Monitoring (watchlist, history, events, alerts and webhooks) is available on Pro, Fix and Beyond. This key is on the Free plan. See the plans at https://getcitehound.com/pricing.' } }));
  await assert.rejects(() => app.triggers.new_event.operation.perform(gate, bundle()), (e) => e instanceof ZError && e.status === 402 && /available on Pro, Fix and Beyond/.test(e.message));
  await assert.rejects(() => app.creates.compare_domains.operation.perform(gate, bundle({ a: 'a.com', b: 'b.com' })), (e) => e.code === 'plan_required');
  await assert.rejects(() => app.creates.scan_domain.operation.perform(fakeZ(() => ({ status: 429, body: { message: 'Limit.' }, headers: { 'retry-after': '120' } })), bundle({ domain: 'a.com' })), (e) => e.status === 429 && /about 120 seconds/.test(e.message));
  await assert.rejects(() => app.creates.scan_domain.operation.perform(fakeZ(() => ok({})), bundle({ domain: 'localhost' })), (e) => e instanceof ZError && /not a domain/.test(e.message));
  await assert.rejects(() => app.creates.scan_domain.operation.perform(fakeZ(() => { throw new Error('boom ' + KEY); }), bundle({ domain: 'a.com' })), (e) => !String(e.message).includes(KEY));
});
