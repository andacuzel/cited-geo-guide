'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');

const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { return request === '@activepieces/pieces-framework' ? path.join(__dirname, 'stubs', 'pieces-framework.js') : orig.call(this, request, ...rest); };

const ROOT = path.join(__dirname, '..');
const { citehound } = require(path.join(ROOT, 'dist/src/index.js'));
const KEY = 'chk_' + 'Aa5Pp6Ii'.repeat(4);
const reply = (status, body, headers) => ({ status: status, headers: { get: (k) => (headers || {})[k.toLowerCase()] || null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const act = (n) => citehound.actions.find((a) => a.name === n);
function ctx(props, api, extra) { const calls = []; return Object.assign({ auth: KEY, propsValue: props, calls, fetchImpl: async (url, init) => { calls.push({ url, init }); return api(url, init); } }, extra || {}); }

test('the piece: name, description with the readiness sentence, SecretText auth, a logo from the site, seven actions and one polling trigger', () => {
  assert.equal(citehound.displayName, 'Citehound'); assert.match(citehound.description, /does not measure whether any assistant names a brand/);
  assert.equal(citehound.auth.type, 'SECRET_TEXT'); assert.equal(citehound.auth.required, true); assert.match(citehound.logoUrl, /^https:\/\/getcitehound\.com\//);
  assert.deepEqual(citehound.actions.map((a) => a.name), ['scan_domain', 'compare_domains', 'generate_llms_txt', 'generate_robots_txt', 'generate_schema', 'watch_domain', 'get_fix_list']);
  assert.deepEqual(citehound.triggers.map((t) => [t.name, t.type]), [['new_event', 'POLLING']]);
  citehound.actions.concat(citehound.triggers).forEach((x) => { assert.ok(x.displayName && x.description && x.props, x.name); });
  assert.match(act('compare_domains').description, /Pro, Fix or Beyond/); assert.match(act('get_fix_list').description, /Fix or Beyond/); assert.match(citehound.triggers[0].description, /Pro, Fix or Beyond/);
  assert.doesNotMatch(JSON.stringify(citehound), /recommend|guarantee|official|partner/i);
  assert.equal(fs.readFileSync(path.join(ROOT, 'src/lib/citehound-core.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'dist/src/lib/citehound-core.js'), 'utf8'));
});
test('scan: GET /v1/scan with the key (a string, or { secret_text })', async () => {
  const c = ctx({ domain: 'https://www.Example.com/' }, () => reply(200, { domain: 'example.com', score: 62 }));
  assert.deepEqual(await act('scan_domain').run(c), { domain: 'example.com', score: 62 });
  assert.equal(c.calls[0].url, 'https://getcitehound.com/v1/scan?domain=example.com'); assert.equal(c.calls[0].init.headers.Authorization, 'Bearer ' + KEY);
  const c2 = ctx({ domain: 'a.com' }, () => reply(200, {}), { auth: { secret_text: KEY } }); await act('scan_domain').run(c2); assert.equal(c2.calls[0].init.headers.Authorization, 'Bearer ' + KEY);
});
test('compare, generate, watch and the fix list call the right paths with the input', async () => {
  const seen = [];
  const api = (url, init) => { seen.push(init.method + ' ' + url.replace('https://getcitehound.com/v1', '') + (init.body ? ' ' + init.body : '')); return reply(200, { ok: 1 }); };
  await act('compare_domains').run(ctx({ a: 'a.com', b: 'b.com' }, api)); await act('generate_schema').run(ctx({ domain: 'a.com', type: 'faqpage' }, api));
  await act('generate_llms_txt').run(ctx({ name: 'Example', description: 'Things.', pages: ['https://e.com/a | A', 'https://e.com/b'] }, api));
  await act('generate_robots_txt').run(ctx({ allow: 'GPTBot, ClaudeBot', block: 'Bytespider', sitemap: '' }, api));
  await act('watch_domain').run(ctx({ domain: 'a.com', alertEmail: 'me@example.com' }, api)); await act('get_fix_list').run(ctx({ domain: 'a.com' }, api));
  assert.deepEqual(seen, ['GET /compare?a=a.com&b=b.com', 'GET /generate/schema?domain=a.com&type=faqpage', 'POST /generate/llms-txt {"name":"Example","description":"Things.","pages":[{"url":"https://e.com/a","description":"A"},{"url":"https://e.com/b","description":""}]}', 'POST /generate/robots-txt {"allow":["GPTBot","ClaudeBot"],"block":["Bytespider"]}', 'POST /watchlist {"domain":"a.com","alert_email":"me@example.com"}', 'GET /fixes?domain=a.com']);
});
test('a plan gate or a bad domain becomes a plain Error with the API\'s message; the key never appears', async () => {
  const gate = () => reply(402, { error: 'plan_required', required_plan: 'pro', message: 'Comparing two sites through the API is available on Pro, Fix and Beyond. See the plans at https://getcitehound.com/pricing. ' + KEY });
  await assert.rejects(() => act('compare_domains').run(ctx({ a: 'a.com', b: 'b.com' }, gate)), (e) => e instanceof Error && /available on Pro, Fix and Beyond/.test(e.message) && !e.message.includes(KEY));
  await assert.rejects(() => act('scan_domain').run(ctx({ domain: 'localhost' }, () => reply(200, {}))), /not a domain/);
  await assert.rejects(() => act('scan_domain').run(ctx({ domain: 'a.com' }, () => reply(200, {}), { auth: 'nope' })), (e) => /does not look like a Citehound API key/.test(e.message) && !e.message.includes('nope'));
});
function store() { const m = {}; return { m, get: async (k) => (k in m ? m[k] : null), put: async (k, v) => { m[k] = v; } }; }
test('the trigger: enabling remembers the newest event; a run returns only what is new, oldest first, and moves the mark', async () => {
  const feed = [{ id: 'evt_3', type: 'score_dropped' }, { id: 'evt_2', type: 'score_dropped' }];
  const api = (url) => { const u = new URL(url), since = u.searchParams.get('since'); const evs = feed.filter((e) => !since || e.id > since); return reply(200, { events: u.searchParams.get('limit') === '1' ? evs.slice(0, 1) : evs, has_more: false, next_cursor: null }); };
  const t = citehound.triggers[0], st = store();
  const c = ctx({ domain: '', types: ['score_dropped'] }, api, { store: st });
  await t.onEnable(c); assert.equal(st.m.citehound_last_event_id, 'evt_3'); assert.deepEqual(await t.run(c), []);
  feed.unshift({ id: 'evt_5', type: 'score_dropped' }, { id: 'evt_4', type: 'score_dropped' });
  assert.deepEqual((await t.run(c)).map((e) => e.id), ['evt_4', 'evt_5']); assert.equal(st.m.citehound_last_event_id, 'evt_5');
  assert.match(c.calls[0].url, /type=score_dropped/);
});
test('the trigger test returns the latest events without touching the store; a free key gets the plan message', async () => {
  const t = citehound.triggers[0], st = store();
  const r = await t.test(ctx({ domain: '', types: [] }, () => reply(200, { events: [{ id: 'evt_9' }, { id: 'evt_8' }], has_more: false, next_cursor: null }), { store: st }));
  assert.deepEqual(r.map((e) => e.id), ['evt_8', 'evt_9']); assert.deepEqual(st.m, {});
  await assert.rejects(() => t.run(ctx({ domain: '', types: [] }, () => reply(402, { error: 'plan_required', required_plan: 'pro', message: 'Monitoring is available on Pro, Fix and Beyond.' }), { store: store() })), /Monitoring is available on Pro, Fix and Beyond/);
});
