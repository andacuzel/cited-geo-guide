'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');

// 'n8n-workflow' resolves to the stub next to this file.
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { return request === 'n8n-workflow' ? path.join(__dirname, 'stubs', 'n8n-workflow.js') : orig.call(this, request, ...rest); };

const ROOT = path.join(__dirname, '..');
const { Citehound } = require(path.join(ROOT, 'dist/nodes/Citehound/Citehound.node.js'));
const { CitehoundTrigger } = require(path.join(ROOT, 'dist/nodes/Citehound/CitehoundTrigger.node.js'));
const { CitehoundApi } = require(path.join(ROOT, 'dist/credentials/CitehoundApi.credentials.js'));
const KEY = 'chk_' + 'Nn8Mm7Ll'.repeat(4);

// A fake `this` for execute and poll. api(url, init) answers like the Citehound API.
function ctx(params, api, extra) {
  const calls = [];
  const self = Object.assign({
    calls: calls,
    getInputData: () => [{ json: {} }],
    getNodeParameter: (name, i, def) => { const v = params[name]; return v === undefined ? (typeof i === 'number' || i === undefined ? def : i) : v; },
    getCredentials: async () => ({ apiKey: KEY }),
    getNode: () => ({ name: 'Citehound' }),
    continueOnFail: () => false,
    getMode: () => 'trigger',
    getWorkflowStaticData: () => self._static,
    _static: {},
    helpers: {
      httpRequest: async (o) => { calls.push(o); const r = api(o.url, o); return { statusCode: r.status, headers: r.headers || {}, body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body) }; },
      returnJsonArray: (a) => a.map((json) => ({ json })),
    },
  }, extra || {});
  return self;
}
const ok = (body) => ({ status: 200, body: body });

test('the package: the n8n field points at files that exist, no dependencies, the community keyword, MIT', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.name, /^n8n-nodes-/); assert.ok(pkg.keywords.includes('n8n-community-node-package')); assert.equal(pkg.license, 'MIT');
  assert.ok(!pkg.dependencies); assert.deepEqual(Object.keys(pkg.peerDependencies), ['n8n-workflow']);
  [].concat(pkg.n8n.nodes, pkg.n8n.credentials).forEach((f) => assert.ok(fs.existsSync(path.join(ROOT, f)), f));
  assert.ok(fs.existsSync(path.join(ROOT, 'dist/nodes/Citehound/citehound-core.js'))); assert.ok(fs.existsSync(path.join(ROOT, 'dist/nodes/Citehound/citehound.svg')));
  assert.equal(fs.readFileSync(path.join(ROOT, 'citehound-core.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'dist/nodes/Citehound/citehound-core.js'), 'utf8'));
});
test('the credential: a password field, a Bearer header, a test call to /v1/me', () => {
  const c = new CitehoundApi();
  assert.equal(c.name, 'citehoundApi'); assert.equal(c.properties[0].typeOptions.password, true); assert.equal(c.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.apiKey}}'); assert.equal(c.test.request.url, '/v1/me');
});
test('the node describes every operation, each parameter shows only for its operations, and the credential is required', () => {
  const d = new Citehound().description, ops = d.properties[0].options.map((o) => o.value);
  assert.deepEqual(ops, ['scan', 'compare', 'crawlers', 'benchmark', 'generateSchema', 'generateLlmsTxt', 'generateRobotsTxt', 'watchAdd', 'watchList', 'watchRemove', 'history', 'events', 'fixes', 'recheck', 'exportData', 'me']);
  assert.equal(d.credentials[0].required, true); assert.deepEqual(d.inputs, ['main']);
  d.properties.slice(1).forEach((p) => assert.ok(p.displayOptions.show.operation.every((o) => ops.includes(o)), p.name));
  assert.match(d.description, /does not measure whether any assistant names a brand/);
  assert.match(d.properties[0].options.find((o) => o.value === 'compare').description, /Pro, Fix and Beyond/); assert.match(d.properties[0].options.find((o) => o.value === 'exportData').description, /Beyond/);
  assert.doesNotMatch(JSON.stringify(d), /recommend|guarantee|official|partner/i);
});
test('scan: calls GET /v1/scan with the key from the credential and returns the answer as an item', async () => {
  const c = ctx({ operation: 'scan', domain: 'https://www.Example.com/x' }, () => ok({ domain: 'example.com', score: 62 }));
  const r = await new Citehound().execute.call(c);
  assert.deepEqual(r[0].map((i) => i.json), [{ domain: 'example.com', score: 62 }]); assert.equal(c.calls[0].url, 'https://getcitehound.com/v1/scan?domain=example.com'); assert.equal(c.calls[0].headers.Authorization, 'Bearer ' + KEY); assert.equal(c.calls[0].ignoreHttpStatusErrors, true);
});
test('compare, crawlers, benchmark, schema, history, fixes, recheck, export and the plan call the right paths', async () => {
  const seen = [];
  const api = (url, o) => { seen.push(o.method + ' ' + url.replace('https://getcitehound.com/v1', '') + (o.body ? ' ' + o.body : '')); return ok({ ok: true }); };
  const run = (params) => new Citehound().execute.call(ctx(params, api));
  await run({ operation: 'compare', domainA: 'a.com', domainB: 'b.com' }); await run({ operation: 'crawlers', domain: 'a.com' }); await run({ operation: 'benchmark', category: 'crm' }); await run({ operation: 'generateSchema', domain: 'a.com', schemaType: 'faqpage' });
  await run({ operation: 'history', domain: 'a.com', limit: 10 }); await run({ operation: 'fixes', domain: 'a.com' }); await run({ operation: 'recheck', domain: 'a.com' }); await run({ operation: 'exportData', domain: 'a.com', exportType: 'events', exportFormat: 'json' }); await run({ operation: 'me' });
  await run({ operation: 'watchAdd', domain: 'a.com', alertEmail: 'me@example.com' }); await run({ operation: 'watchList' }); await run({ operation: 'watchRemove', domain: 'a.com' });
  assert.deepEqual(seen, ['GET /compare?a=a.com&b=b.com', 'GET /crawlers?domain=a.com', 'GET /benchmark?category=crm', 'GET /generate/schema?domain=a.com&type=faqpage', 'GET /history?domain=a.com&limit=10', 'GET /fixes?domain=a.com', 'POST /fixes/recheck {"domain":"a.com"}',
    'GET /export?domain=a.com&type=events&format=json', 'GET /me', 'POST /watchlist {"domain":"a.com","alert_email":"me@example.com"}', 'GET /watchlist', 'DELETE /watchlist?domain=a.com']);
});
test('generate llms.txt and robots.txt send the fields as JSON', async () => {
  const seen = [];
  const api = (url, o) => { seen.push(o.method + ' ' + url.replace('https://getcitehound.com/v1', '') + ' ' + o.body); return ok({ type: 'x', content: 'c' }); };
  await new Citehound().execute.call(ctx({ operation: 'generateLlmsTxt', siteName: 'Example', siteDescription: 'Things.', pages: { page: [{ url: 'https://e.com/a', description: 'A' }] } }, api));
  await new Citehound().execute.call(ctx({ operation: 'generateRobotsTxt', allow: 'GPTBot, ClaudeBot', block: 'Bytespider', sitemap: '' }, api));
  assert.deepEqual(seen, ['POST /generate/llms-txt {"name":"Example","description":"Things.","pages":[{"url":"https://e.com/a","description":"A"}]}', 'POST /generate/robots-txt {"allow":["GPTBot","ClaudeBot"],"block":["Bytespider"]}']);
});
test('events become one item each', async () => {
  const r = await new Citehound().execute.call(ctx({ operation: 'events', domainOptional: '', eventTypes: ['score_dropped'], limit: 5 }, () => ok({ events: [{ id: 'evt_2' }, { id: 'evt_1' }], has_more: false })));
  assert.deepEqual(r[0].map((i) => i.json.id), ['evt_2', 'evt_1']);
});
test('a plan gate stops the run with the API\'s message; continue on fail returns it as an item; the key is never in the message', async () => {
  const gate = () => ({ status: 402, body: { error: 'plan_required', required_plan: 'pro', message: 'Comparing two sites through the API is available on Pro, Fix and Beyond. See the plans at https://getcitehound.com/pricing. ' + KEY } });
  await assert.rejects(() => new Citehound().execute.call(ctx({ operation: 'compare', domainA: 'a.com', domainB: 'b.com' }, gate)), (e) => e.name === 'NodeOperationError' && /available on Pro, Fix and Beyond/.test(e.message) && !e.message.includes(KEY) && e.itemIndex === 0);
  const r = await new Citehound().execute.call(ctx({ operation: 'compare', domainA: 'a.com', domainB: 'b.com' }, gate, { continueOnFail: () => true }));
  assert.match(r[0][0].json.error, /available on Pro/); assert.ok(!JSON.stringify(r).includes(KEY));
  await assert.rejects(() => new Citehound().execute.call(ctx({ operation: 'scan', domain: 'localhost' }, () => ok({}))), /not a domain/);
});
test('the trigger: described as polling, no inputs, the paid-plan note', () => {
  const d = new CitehoundTrigger().description;
  assert.equal(d.polling, true); assert.deepEqual(d.inputs, []); assert.deepEqual(d.outputs, ['main']); assert.match(d.description, /Pro, Fix and Beyond/);
});
test('the trigger: the first poll remembers the newest event and emits nothing; the next poll emits only what is new, oldest first', async () => {
  const feed = [{ id: 'evt_3', type: 'score_dropped' }, { id: 'evt_2', type: 'score_dropped' }, { id: 'evt_1', type: 'score_dropped' }];
  const api = (url) => { const u = new URL(url); const since = u.searchParams.get('since'); const evs = feed.filter((e) => !since || e.id > since); return ok({ events: u.searchParams.get('limit') === '1' ? evs.slice(0, 1) : evs, has_more: false, next_cursor: null }); };
  const c = ctx({ eventTypes: ['score_dropped'], domain: '' }, api);
  assert.equal(await new CitehoundTrigger().poll.call(c), null); assert.equal(c._static.lastId, 'evt_3');
  assert.equal(await new CitehoundTrigger().poll.call(c), null);
  feed.unshift({ id: 'evt_5', type: 'score_dropped' }, { id: 'evt_4', type: 'score_dropped' });
  const r = await new CitehoundTrigger().poll.call(c);
  assert.deepEqual(r[0].map((i) => i.json.id), ['evt_4', 'evt_5']); assert.equal(c._static.lastId, 'evt_5');
  assert.match(c.calls[0].url, /type=score_dropped/);
});
test('the trigger: a manual test run returns the latest events; a free key gets the plan message', async () => {
  const api = () => ok({ events: [{ id: 'evt_9' }, { id: 'evt_8' }], has_more: false, next_cursor: null });
  const r = await new CitehoundTrigger().poll.call(ctx({ eventTypes: [], domain: '' }, api, { getMode: () => 'manual' }));
  assert.deepEqual(r[0].map((i) => i.json.id), ['evt_8', 'evt_9']);
  await assert.rejects(() => new CitehoundTrigger().poll.call(ctx({ eventTypes: [], domain: '' }, () => ({ status: 402, body: { error: 'plan_required', message: 'Monitoring is available on Pro, Fix and Beyond.' } }))), (e) => e.name === 'NodeOperationError' && /Monitoring is available on Pro, Fix and Beyond/.test(e.message));
});
