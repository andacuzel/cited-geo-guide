'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const KEY = 'chk_' + 'Pp3Dd4Ee'.repeat(4);
const load = (f) => import(path.join(ROOT, f)).then((m) => m.default);
const reply = (status, body, headers) => ({ status: status, headers: { get: (k) => (headers || {})[k.toLowerCase()] || null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

// A component instance: its props, with the app's methods and a fake fetch.
async function make(file, props, api) {
  const comp = await load(file), app = await load('citehound.app.mjs');
  const calls = [];
  const bound = Object.assign({}, app.methods, { $auth: { api_key: KEY }, fetchImpl: async (url, init) => { calls.push({ url, init }); return api(url, init); } });
  bound.run = app.methods.run; bound.pollEvents = app.methods.pollEvents; bound._core = app.methods._core;
  const self = Object.assign({}, comp.methods || {}, props || {}, { citehound: bound, calls: calls });
  const exported = [];
  self.$emit = (e, meta) => { self.emitted = (self.emitted || []).concat([{ e, meta }]); };
  self.db = { _m: {}, get(k) { return this._m[k]; }, set(k, v) { this._m[k] = v; } };
  return { comp, self, calls, exported };
}
const $ = () => ({ _exports: {}, export(k, v) { this._exports[k] = v; } });

test('the app: type app, a name, the shared prop definitions, and the client reads the key from $auth', async () => {
  const app = await load('citehound.app.mjs');
  assert.equal(app.type, 'app'); assert.equal(app.app, 'citehound'); assert.ok(app.propDefinitions.domain && app.propDefinitions.eventTypes.options.length === 9);
  assert.equal(fs.readFileSync(path.join(ROOT, 'common/citehound-core.js'), 'utf8').includes('integrations/shared/citehound-core.js'), true);
});
test('every component has a key, a name, a description that names the plans where they matter, a version and a type', async () => {
  const files = ['actions/scan-domain/scan-domain.mjs', 'actions/compare-domains/compare-domains.mjs', 'actions/generate-file/generate-file.mjs', 'actions/watch-domain/watch-domain.mjs', 'actions/get-fix-list/get-fix-list.mjs', 'sources/new-event/new-event.mjs'];
  const keys = new Set();
  for (const f of files) { const c = await load(f); assert.match(c.key, /^citehound-/); assert.ok(c.name && c.description && /^\d+\.\d+\.\d+$/.test(c.version) && ['action', 'source'].includes(c.type), f); assert.ok(c.props.citehound, f); keys.add(c.key); }
  assert.equal(keys.size, files.length);
  assert.match((await load('actions/compare-domains/compare-domains.mjs')).description, /Pro, Fix or Beyond/); assert.match((await load('actions/get-fix-list/get-fix-list.mjs')).description, /Fix or Beyond/);
  assert.match((await load('sources/new-event/new-event.mjs')).description, /Pro, Fix or Beyond/);
});
test('scan: GET /v1/scan with the key, the answer is returned and a summary is exported', async () => {
  const { comp, self, calls } = await make('actions/scan-domain/scan-domain.mjs', { domain: 'https://Example.com/' }, () => reply(200, { domain: 'example.com', score: 62 }));
  const d = $(); const r = await comp.run.call(self, { $: d });
  assert.deepEqual(r, { domain: 'example.com', score: 62 }); assert.equal(calls[0].url, 'https://getcitehound.com/v1/scan?domain=example.com'); assert.equal(calls[0].init.headers.Authorization, 'Bearer ' + KEY); assert.match(d._exports.$summary, /Scan a Domain/);
});
test('compare, watch and the fix list call the right paths', async () => {
  const seen = [];
  const api = (url, init) => { seen.push(init.method + ' ' + url.replace('https://getcitehound.com/v1', '') + (init.body ? ' ' + init.body : '')); return reply(200, { ok: 1 }); };
  for (const [f, props] of [['actions/compare-domains/compare-domains.mjs', { a: 'a.com', b: 'b.com' }], ['actions/watch-domain/watch-domain.mjs', { domain: 'a.com', alertEmail: 'me@example.com' }], ['actions/get-fix-list/get-fix-list.mjs', { domain: 'a.com' }]]) { const { comp, self } = await make(f, props, api); await comp.run.call(self, { $: $() }); }
  assert.deepEqual(seen, ['GET /compare?a=a.com&b=b.com', 'POST /watchlist {"domain":"a.com","alert_email":"me@example.com"}', 'GET /fixes?domain=a.com']);
});
test('generate: llms.txt with pages, robots.txt with lists, schema with a type', async () => {
  const seen = [];
  const api = (url, init) => { seen.push(init.method + ' ' + url.replace('https://getcitehound.com/v1', '') + (init.body ? ' ' + init.body : '')); return reply(200, { content: 'c' }); };
  const f = 'actions/generate-file/generate-file.mjs';
  let m = await make(f, { kind: 'llms.txt', name: 'Example', description: 'Things.', pages: ['https://e.com/a | A', 'https://e.com/b|B'] }, api); await m.comp.run.call(m.self, { $: $() });
  m = await make(f, { kind: 'robots.txt', allow: 'GPTBot, ClaudeBot', block: 'Bytespider', sitemap: '' }, api); await m.comp.run.call(m.self, { $: $() });
  m = await make(f, { kind: 'schema', domain: 'a.com' }, api); await m.comp.run.call(m.self, { $: $() });
  assert.deepEqual(seen, ['POST /generate/llms-txt {"name":"Example","description":"Things.","pages":[{"url":"https://e.com/a","description":"A"},{"url":"https://e.com/b","description":"B"}]}', 'POST /generate/robots-txt {"allow":["GPTBot","ClaudeBot"],"block":["Bytespider"]}', 'GET /generate/schema?domain=a.com&type=organization']);
});
test('errors become plain Errors with the API\'s message: a plan gate names the plans; the key is never in it', async () => {
  const gate = () => reply(402, { error: 'plan_required', required_plan: 'pro', message: 'Comparing two sites through the API is available on Pro, Fix and Beyond. See the plans at https://getcitehound.com/pricing. ' + KEY });
  const { comp, self } = await make('actions/compare-domains/compare-domains.mjs', { a: 'a.com', b: 'b.com' }, gate);
  await assert.rejects(() => comp.run.call(self, { $: $() }), (e) => e instanceof Error && /available on Pro, Fix and Beyond/.test(e.message) && !e.message.includes(KEY));
  const bad = await make('actions/scan-domain/scan-domain.mjs', { domain: 'localhost' }, () => reply(200, {}));
  await assert.rejects(() => bad.comp.run.call(bad.self, { $: $() }), /not a domain/);
});
test('the source: deploy sends the latest few and remembers the newest; run emits only new events, each with its id for de-duplication', async () => {
  const feed = [{ id: 'evt_3', type: 'score_dropped', summary: 's3', at: '2026-10-23T00:00:03Z' }, { id: 'evt_2', type: 'score_dropped', summary: 's2', at: '2026-10-23T00:00:02Z' }];
  const api = (url) => { const u = new URL(url), since = u.searchParams.get('since'); return reply(200, { events: feed.filter((e) => !since || e.id > since), has_more: false, next_cursor: null }); };
  const { comp, self } = await make('sources/new-event/new-event.mjs', { domain: '', eventTypes: ['score_dropped'] }, api);
  await comp.hooks.deploy.call(self);
  assert.deepEqual(self.emitted.map((x) => x.e.id), ['evt_2', 'evt_3']); assert.equal(self.db.get('lastId'), 'evt_3'); assert.deepEqual(self.emitted[0].meta, { id: 'evt_2', summary: 's2', ts: Date.parse('2026-10-23T00:00:02Z') });
  self.emitted = []; await comp.run.call(self); assert.equal(self.emitted.length, 0);
  feed.unshift({ id: 'evt_4', type: 'score_dropped', summary: 's4', at: '2026-10-23T00:00:04Z' });
  await comp.run.call(self); assert.deepEqual(self.emitted.map((x) => x.e.id), ['evt_4']); assert.equal(self.db.get('lastId'), 'evt_4');
  assert.equal((await load('sources/new-event/new-event.mjs')).dedupe, 'unique');
});
test('the source on a free key: the plan message surfaces', async () => {
  const { comp, self } = await make('sources/new-event/new-event.mjs', { domain: '', eventTypes: [] }, () => reply(402, { error: 'plan_required', required_plan: 'pro', message: 'Monitoring is available on Pro, Fix and Beyond.' }));
  self.db.set('lastId', 'evt_1');
  await assert.rejects(() => comp.run.call(self), /Monitoring is available on Pro, Fix and Beyond/);
});
