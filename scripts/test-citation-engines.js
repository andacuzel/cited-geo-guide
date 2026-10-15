#!/usr/bin/env node
/* =====================================================================
   scripts/test-citation-engines.js

   The three engines of the Pro citation check (Claude, ChatGPT through the OpenAI API, Perplexity) and what is new with the second one: the OpenAI adapter
   against a reply built in the documented Responses API shape and every failure mode, the switches (exact "1", off by default, no Gemini engine), the per-engine
   caps beside the overall caps and the kill switch, the cost counted per engine, and the report with all three engines: honest labels, the sample date, the
   "API results can differ" line, and an engine that fails marked unavailable while the others stand. Mocked HTTP only: nothing here reaches the network.

     node scripts/test-citation-engines.js
   ===================================================================== */

'use strict';

process.env.PRO_HASH_SECRET = 'test-only-secret-0123456789abcdef';
const S = require('../lib/pro-store.js');
const Config = require('../lib/citation-config.js');
const Providers = require('../lib/citation-providers.js');
const Budget = require('../lib/citation-budget.js');
const Section = require('../lib/pro-citation-section.js');
const pageLib = require('../lib/pro-report-page.js');
const { SITES } = require('./fixtures/citation-fixtures.js');
const { ENV_T, ENV_TP, ENV_ALL, mockAdapter, failResult, runJob } = require('./fixtures/citation-harness.js');

let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const logged = [];
['log', 'warn', 'error', 'info'].forEach((k) => { console[k] = function () { logged.push(Array.prototype.slice.call(arguments).join(' ')); }; });
const withEnv = (base, extra) => Object.assign({}, base, extra || {});
const testedN = (c, p) => Object.values((c.results && c.results[p]) || {}).filter((x) => x.state === 'tested').length;

// A reply in the shape the OpenAI docs describe: web_search_call items, then a message whose output_text carries url_citation annotations.
const REPLY = {
  id: 'resp_fixture', object: 'response', status: 'completed', model: 'gpt-4.1-mini-2025-04-14',
  output: [
    { type: 'web_search_call', id: 'ws_1', status: 'completed', action: { type: 'search', query: 'best crm for a small team' } },
    { type: 'web_search_call', id: 'ws_2', status: 'completed', action: { type: 'open_page', url: 'https://example-one.com/b' } },
    { type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: 'Several tools are popular. Examples include ExampleOne and ExampleTwo.', annotations: [
      { type: 'url_citation', start_index: 0, end_index: 10, url: 'https://www.example-two.com/a?utm_source=openai', title: 'Two' },
      { type: 'url_citation', start_index: 11, end_index: 20, url: 'https://example-one.com/b?utm_source=openai', title: 'One' },
      { type: 'url_citation', start_index: 21, end_index: 30, url: 'https://example-one.com/b?utm_source=openai', title: 'One again' }
    ] }] }
  ],
  usage: { input_tokens: 8000, output_tokens: 400 }
};
const resp = (body, status, headers) => ({ ok: (status || 200) < 400, status: status || 200, headers: { get: (k) => (headers || {})[String(k).toLowerCase()] || null }, json: async () => body });

(async function main() {
  /* ---- the switches ---- */
  {
    const base = { CITATION_QUESTIONS_ENABLED: '1', CITATION_ANTHROPIC_ENABLED: '1', ANTHROPIC_API_KEY: 'k', CITATION_TEST_ENABLED: '1' };
    t('there are exactly three engines, and Gemini is not one of them', Config.ORDER.join() === 'anthropic,openai,perplexity' && !Config.PROVIDERS.gemini);
    t('everything is off with an empty environment, ChatGPT included', Config.flags({}).providers.length === 0 && !Config.flags({}).test);
    t('ChatGPT needs its own flag and its key: the flag alone, or the key alone, leaves it off', !Config.flags(withEnv(base, { CITATION_OPENAI_ENABLED: '1' })).providers.includes('openai') && !Config.flags(withEnv(base, { OPENAI_API_KEY: 'x' })).providers.includes('openai'));
    t('with flag and key it joins, after Claude and before Perplexity', Config.flags(withEnv(base, { CITATION_OPENAI_ENABLED: '1', OPENAI_API_KEY: 'x', CITATION_PERPLEXITY_ENABLED: '1', PERPLEXITY_API_KEY: 'y' })).providers.join() === 'anthropic,openai,perplexity');
    t('only the exact value 1 switches an engine on: true, yes, on, 2 and " 1" do not', ['true', 'yes', 'on', '2', ' 1', '1 '].every((v) => !Config.flags(withEnv(base, { CITATION_OPENAI_ENABLED: v, OPENAI_API_KEY: 'x' })).providers.includes('openai')));
    t('CITATION_KILL=1 turns every engine off at once', Config.flags(withEnv(base, { CITATION_OPENAI_ENABLED: '1', OPENAI_API_KEY: 'x', CITATION_KILL: '1' })).providers.length === 0);
    t('the model: gpt-4.1-mini by default, CITATION_OPENAI_MODEL overrides, characters outside a model name are dropped', Config.modelFor('openai', {}) === 'gpt-4.1-mini' && Config.modelFor('openai', { CITATION_OPENAI_MODEL: 'gpt-5.4-mini' }) === 'gpt-5.4-mini' && Config.modelFor('openai', { CITATION_OPENAI_MODEL: 'x"; drop' }) === 'xdrop');
    t('the overall per-report defaults grow with the engines on (30 and $0.50 with one or two, 40 and $0.75 with three) and an explicit value wins', Config.limits(base).maxCalls === 30 && Config.limits(ENV_ALL).maxCalls === 40 && Config.limits(ENV_ALL).maxCostUsd === 0.75 && Config.limits(withEnv(ENV_ALL, { CITATION_MAX_CALLS: '25', CITATION_MAX_COST_USD: '0.4' })).maxCalls === 25 && Config.limits(withEnv(ENV_ALL, { CITATION_MAX_COST_USD: '0.4' })).maxCostUsd === 0.4);
    const E = Config.engineLimits('openai', { CITATION_OPENAI_MAX_CALLS: '12', CITATION_OPENAI_MAX_COST_USD: '0.3', CITATION_OPENAI_DAILY_BUDGET_USD: '1' });
    t('per-engine caps are read from CITATION_<ENGINE>_MAX_CALLS, _MAX_COST_USD and _DAILY_BUDGET_USD; unset they equal the overall caps; a typo is clamped; the writer has none', E.maxCalls === 12 && E.maxCostUsd === 0.3 && E.dailyUsd === 1 && Config.engineLimits('perplexity', {}).maxCalls === 30 && Config.engineLimits('openai', { CITATION_OPENAI_MAX_CALLS: '9999', CITATION_OPENAI_MAX_COST_USD: '99' }).maxCalls === 60 && Config.engineLimits('openai', { CITATION_OPENAI_MAX_COST_USD: '99' }).maxCostUsd === 2 && Config.engineLimits('generate', {}) === null);
  }

  /* ---- the OpenAI adapter ---- */
  {
    const seen = [];
    const mk = (r, status, extra) => Providers.openai(Object.assign({ apiKey: 'K-openai-secret-9', sleep: async () => {}, fetch: async (url, init) => { seen.push({ url: String(url), init: init }); return resp(r, status); } }, extra || {}));
    const a = await mk(REPLY).runPrompt({ prompt: 'Best CRM for a small team?', locale: 'de' });
    const sent = JSON.parse(seen[0].init.body);
    t('openai: POST /v1/responses with the web_search tool, search required, nothing stored, the key as a bearer header only, the question as input, the locale as a tag', /api\.openai\.com\/v1\/responses$/.test(seen[0].url) && sent.tools.length === 1 && sent.tools[0].type === 'web_search' && sent.tool_choice === 'required' && sent.store === false && sent.input === 'Best CRM for a small team?' && /tag "de"/.test(sent.instructions) && sent.model === 'gpt-4.1-mini' && seen[0].init.headers.authorization === 'Bearer K-openai-secret-9');
    t('openai: the key is in no URL and no body; only the question and a locale go out (no domain, name, id)', seen.every((x) => !/K-openai-secret/.test(x.url + x.init.body)) && !/example|@|https?:/.test(sent.input + sent.instructions));
    t('openai: the answer text, the url_citation pages as citations (deduplicated, kind "cited", utm parameters kept off the domain), the model, the label and the search count', a.answerText.indexOf('ExampleOne') !== -1 && a.citations.length === 2 && a.citations[0].domain === 'example-two.com' && a.citations[1].domain === 'example-one.com' && a.citationKind === 'cited' && a.providerLabel === 'ChatGPT' && a.modelId === 'gpt-4.1-mini-2025-04-14' && a.searches === 2 && !a.error);
    const expect = (8000 * 0.4 + 400 * 1.6) / 1e6;
    t('openai: the cost is the tokens at the model rate plus $0.01 a search call (gpt-4.1-mini: $0.40 and $1.60 per million)', Math.abs(Providers.openaiCost('gpt-4.1-mini', REPLY.usage, 0) - expect) < 1e-9 && Math.abs(a.costUsd - (Providers.openaiCost('gpt-4.1-mini-2025-04-14', REPLY.usage, 2))) < 1e-9);
    t('openai: a model that is not in the price table is priced as the dearest one, so a mistake overestimates', Providers.openaiCost('gpt-9-unknown', { input_tokens: 1000000, output_tokens: 0 }, 0) === 10);
    const waits = [];
    const e429 = await mk({}, 429, { sleep: async (ms) => waits.push(ms) }).runPrompt({ prompt: 'q' });
    t('openai: HTTP 429 is retried once after a backoff, then "quota"', e429.error.kind === 'quota' && waits.length === 1);
    let n500 = 0;
    t('openai: a 500 is retried once, a second 500 is "provider"; HTTP 401 is "provider" and is not retried', (await mk(null, null, { fetch: async () => { n500++; return resp({}, 500); } }).runPrompt({ prompt: 'q' })).error.kind === 'provider' && n500 === 2 && (await mk({}, 401).runPrompt({ prompt: 'q' })).error.kind === 'provider');
    let nT = 0;
    t('openai: a timeout is "timeout" and is not retried (the call may have been charged)', (await Providers.openai({ apiKey: 'k', sleep: async () => {}, fetch: async () => { nT++; const e = new Error('t'); e.name = 'TimeoutError'; throw e; } }).runPrompt({ prompt: 'q' })).error.kind === 'timeout' && nT === 1);
    const inc = await mk(Object.assign({}, REPLY, { status: 'incomplete' })).runPrompt({ prompt: 'q' });
    t('openai: an incomplete answer is "incomplete" and still reports what it cost', inc.error.kind === 'incomplete' && inc.costUsd > 0.02);
    const refusal = JSON.parse(JSON.stringify(REPLY)); refusal.output[2].content = [{ type: 'refusal', refusal: 'No.' }];
    const noText = JSON.parse(JSON.stringify(REPLY)); noText.output = noText.output.filter((x) => x.type !== 'message');
    const noSearch = JSON.parse(JSON.stringify(REPLY)); noSearch.output = noSearch.output.filter((x) => x.type === 'message');
    const noCites = JSON.parse(JSON.stringify(REPLY)); noCites.output[2].content[0].annotations = [];
    t('openai: a refusal is "refusal", an answer with no text "empty" (both with their cost), an answer that never searched "no_search", an answer with no citations is fine (cited none)', (await mk(refusal).runPrompt({ prompt: 'q' })).error.kind === 'refusal' && (await mk(noText).runPrompt({ prompt: 'q' })).error.kind === 'empty' && (await mk(noText).runPrompt({ prompt: 'q' })).costUsd > 0.02 && (await mk(noSearch).runPrompt({ prompt: 'q' })).error.kind === 'no_search' && (await mk(noCites).runPrompt({ prompt: 'q' })).citations.length === 0 && !(await mk(noCites).runPrompt({ prompt: 'q' })).error);
    t('openai: an error object in the body is "provider"; a body that is not JSON is "provider"; no key sends nothing', (await mk({ error: { message: 'x' } }).runPrompt({ prompt: 'q' })).error.kind === 'provider' && (await mk(null, null, { fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new Error('bad'); } }) }).runPrompt({ prompt: 'q' })).error.kind === 'provider' && await (async () => { const n = seen.length; const r = await Providers.openai({ fetch: async () => { seen.push({ url: 'x', init: { body: '{}' } }); return resp(REPLY); } }).runPrompt({ prompt: 'q' }); return r.error.kind === 'provider' && seen.length === n; })());
    const viaMake = Providers.make('openai', { OPENAI_API_KEY: 'abc', CITATION_OPENAI_MODEL: 'gpt-5.4-mini' });
    t('make() builds the OpenAI adapter with the key and model from the environment', viaMake.id === 'openai' && viaMake.model === 'gpt-5.4-mini' && Providers.make('gemini', {}) === null);
  }

  /* ---- the engine caps and the kill switch ---- */
  {
    const jid = 'a'.repeat(32), fresh = () => S.createStore(S.memoryAdapter());
    let store = fresh();
    const env = { CITATION_OPENAI_MAX_CALLS: '2' };
    const why = []; for (let i = 0; i < 3; i++) { const r = await Budget.reserve(store, jid, { provider: 'openai', estMicro: 1000, env: env }); why.push(r.ok ? 'ok' : r.reason); }
    const h = await store.adapter.hgetall('pro:job:' + jid + ':cit');
    t('budget: the engine\'s own call cap stops that engine (engine_calls) and a refused call leaves no trace anywhere', why.join() === 'ok,ok,engine_calls' && h.calls === '2' && h.spend === '2000' && h['calls:openai'] === '2' && h['spend:openai'] === '2000');
    const other = await Budget.reserve(store, jid, { provider: 'anthropic', estMicro: 1000, env: env });
    t('budget: another engine is not held back by it', other.ok);
    store = fresh();
    const c = []; for (let i = 0; i < 3; i++) { const r = await Budget.reserve(store, jid, { provider: 'perplexity', estMicro: 200000, env: { CITATION_PERPLEXITY_MAX_COST_USD: '0.5', CITATION_MAX_COST_USD: '2' } }); c.push(r.ok ? 'ok' : r.reason); }
    t('budget: the engine\'s cost cap per report (engine_cost) stops it before the overall cap would', c.join() === 'ok,ok,engine_cost');
    store = fresh();
    const d = []; for (let i = 0; i < 3; i++) { const r = await Budget.reserve(store, String(i).repeat(32), { provider: 'openai', estMicro: 600000, env: { CITATION_OPENAI_DAILY_BUDGET_USD: '1.5', CITATION_MAX_COST_USD: '2' } }); d.push(r.ok ? 'ok' : r.reason); }
    t('budget: the engine\'s daily budget is shared by all reports (engine_daily), and the overall daily budget (2) is not what stopped it', d.join() === 'ok,ok,engine_daily');
    store = fresh();
    const g = await Budget.reserve(store, jid, { provider: 'openai', estMicro: 40000, env: {} });
    await Budget.reconcile(store, g.g, 21500);
    const h2 = await store.adapter.hgetall('pro:job:' + jid + ':cit'), sp = await store.adapter.hgetall(Budget.SPEND), st = await store.adapter.hgetall(Budget.STAT);
    const day = new Date().toISOString().slice(0, 10);
    t('budget: reconcile puts the real cost on the engine\'s own counters too, and the stats count the call and the cost per engine', h2['spend:openai'] === '21500' && sp['d:' + day + ':openai'] === '21500' && st['d:' + day + ':openai:calls'] === '1' && st['d:' + day + ':openai:micro'] === '21500');
    const g2 = await Budget.reserve(store, jid, { provider: 'openai', estMicro: 40000, env: {} });
    await Budget.release(store, g2.g);
    const h3 = await store.adapter.hgetall('pro:job:' + jid + ':cit');
    t('budget: a reservation that is released (the call was never made) is taken off the engine counters as well', h3['calls:openai'] === '1' && h3['spend:openai'] === '21500');
    const sum = await Budget.summary(store, {}, undefined);
    t('budget summary lists ChatGPT beside Claude and Perplexity with its own call count and cost', sum.rows.map((r) => r.provider).join() === 'anthropic,openai,perplexity,generate,knowledge' && sum.rows.find((r) => r.provider === 'openai').dayCalls === 1 && sum.rows.find((r) => r.provider === 'openai').dayMicro === 21500);
    store = fresh(); await Budget.setKill(store, true);
    const k = await Budget.reserve(store, jid, { provider: 'openai', estMicro: 1000, env: {} });
    const k2 = await Budget.reserve(fresh(), jid, { provider: 'openai', estMicro: 1000, env: { CITATION_KILL: '1' } });
    t('the kill switch stops ChatGPT as well, from Redis and from the environment', !k.ok && k.reason === 'kill' && !k2.ok && k2.reason === 'kill');
  }

  /* ---- all three engines through the pipeline ---- */
  {
    const site = SITES.en;
    const prov = () => ({ anthropic: mockAdapter('anthropic'), openai: mockAdapter('openai'), perplexity: mockAdapter('perplexity') });
    const all = prov();
    const r = await runJob(site, { env: ENV_ALL, providers: all });
    const c = r.job.citation;
    t('all engines: the same ten questions go to each, one run per question, and the job ends done and ok', r.job.status === 'done' && c.status === 'ok' && JSON.stringify(all.anthropic.calls) === JSON.stringify(all.openai.calls) && JSON.stringify(all.openai.calls) === JSON.stringify(all.perplexity.calls) && all.openai.calls.length === 10 && new Set(all.openai.calls).size === 10 && c.modes.providers.join() === 'anthropic,openai,perplexity');
    t('all engines: the report counts 30 engine calls and 2 for the question writer, and its spend is the three engines\' costs added (365000 micro-dollars)', c.calls === 32 && c.spend === 365000, JSON.stringify([c.calls, c.spend]));
    const stats = await r.adapter.hgetall(Budget.STAT), day = new Date().toISOString().slice(0, 10);
    t('all engines: cost per engine in the spend tracking: Claude 120000, ChatGPT 200000, Perplexity 45000 micro-dollars', stats['d:' + day + ':anthropic:micro'] === '120000' && stats['d:' + day + ':openai:micro'] === '200000' && stats['d:' + day + ':perplexity:micro'] === '45000' && stats['d:' + day + ':openai:calls'] === '10');
    const html = pageLib.render(r.job, {});
    t('report: three sections, each titled with its engine, each with the model and the date', /<h2[^>]*>What Claude’s web search cited<\/h2>/.test(html) && /<h2[^>]*>What ChatGPT’s web search cited<\/h2>/.test(html) && /<h2[^>]*>What Perplexity’s search returned<\/h2>/.test(html) && /ChatGPT \(OpenAI API, web search on\), model mock-gpt, one run per question, [A-Z][a-z]+ \d+, \d{4}/.test(html) && /Perplexity \(Sonar via API, web search on\), model mock-sonar/.test(html) && /Claude \(Anthropic API, web search on\), model mock-claude/.test(html));
    t('report: the line "API results can differ from what the consumer apps show" is in every engine\'s section; no ranking, no share of voice, no composite', (html.match(/API results can differ from what the consumer apps show/g) || []).length === 3 && /not a ranking or a share of voice/.test(html) && !/\bshare of voice (score|%)|\bleaderboard\b|\bwinner\b/i.test(html));
    t('report: the summary card gives each engine its own count, side by side, never merged', /Claude:<\/strong> cited for <span[^>]*>0<\/span> of <span[^>]*>10<\/span>/.test(html) && /ChatGPT:<\/strong> cited for <span[^>]*>0<\/span> of <span[^>]*>10<\/span>/.test(html) && /Perplexity:<\/strong> among the sources returned for/.test(html));
    t('nothing the pipeline logged holds a key, a question or an answer', logged.every((l) => !/test-openai-key|test-anthropic-key|test-perplexity-key|ExampleOne/.test(l)));

    // ChatGPT is down: three failed calls in a row stop it for the report; the other two engines carry on and the report says "unavailable".
    const down = prov(); down.openai = mockAdapter('openai', async () => failResult('provider', 0));
    const d = await runJob(site, { env: ENV_ALL, providers: down });
    const dc = d.job.citation, dh = pageLib.render(d.job, {});
    t('one engine down: Claude and Perplexity are fully tested, ChatGPT is not, the job is "partial" for the citation part, and nothing was invented for ChatGPT', d.job.status === 'done' && testedN(dc, 'anthropic') === 10 && testedN(dc, 'perplexity') === 10 && testedN(dc, 'openai') === 0 && dc.status === 'partial' && Object.values(dc.results.openai).every((x) => x.state === 'not_tested' && !x.cited && !x.others));
    t('one engine down: the report says "Citation check unavailable for ChatGPT", still shows the other two engines, and the card marks ChatGPT unavailable', /Citation check unavailable for ChatGPT/.test(dh) && /<h2[^>]*>What Claude’s web search cited<\/h2>/.test(dh) && /<h2[^>]*>What Perplexity’s search returned<\/h2>/.test(dh) && /ChatGPT:<\/strong> unavailable for this report/.test(dh) && !/ChatGPT:<\/strong> cited for/.test(dh));
    t('one engine down: it is stopped after three failures in a row (two calls run side by side, so four at most), not asked ten times', down.openai.calls.length >= 3 && down.openai.calls.length <= 4, String(down.openai.calls.length));

    // A timeout on ChatGPT is the same: unavailable, never filled in.
    const slow = prov(); slow.openai = mockAdapter('openai', async () => failResult('timeout', 0));
    const sl = await runJob(site, { env: ENV_ALL, providers: slow });
    t('a timeout on one engine: the others stand and that one is marked not tested with the timeout reason', testedN(sl.job.citation, 'anthropic') === 10 && testedN(sl.job.citation, 'openai') === 0 && Object.values(sl.job.citation.results.openai).every((x) => x.reason === 'timeout') && /did not answer in time/.test(sl.job.citation.pstat.openai.reason));

    // ChatGPT's own cap stops ChatGPT only.
    const cap = prov();
    const cr = await runJob(site, { env: withEnv(ENV_ALL, { CITATION_OPENAI_MAX_CALLS: '4' }), providers: cap });
    const cc = cr.job.citation;
    t('an engine cap stops that engine only: ChatGPT is asked four times and the other two are tested on all ten questions', cap.openai.calls.length === 4 && testedN(cc, 'openai') === 4 && testedN(cc, 'anthropic') === 10 && testedN(cc, 'perplexity') === 10 && cc.pstat.openai.stop === 'engine_calls');
    t('the engine cap says so in the report, in words', /for this provider/.test(cc.pstat.openai.reason) && /Partial/.test(pageLib.render(cr.job, {})));

    // The overall cap covers the new engine too.
    const tight = prov();
    const tr = await runJob(site, { env: withEnv(ENV_ALL, { CITATION_MAX_CALLS: '8' }), providers: tight });
    t('the overall per-report call cap covers the new engine: with 8 calls in all (writer included) the check stops for every engine', tight.anthropic.calls.length + tight.openai.calls.length + tight.perplexity.calls.length <= 6 && tr.job.citation.status !== 'ok');

    // A report with the Redis kill switch on ends without a single engine call.
    const kadapter = S.memoryAdapter(), kstore = S.createStore(kadapter);
    await Budget.setKill(kstore, true);
    const kp = prov();
    const kr = await runJob(site, { env: ENV_ALL, providers: kp, adapter: kadapter, store: kstore });
    t('the kill switch in Redis stops all three engines: no engine is called', kp.anthropic.calls.length + kp.openai.calls.length + kp.perplexity.calls.length === 0 && kr.job.citation.status === 'not_tested');
  }

  out('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { out('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
})().catch((e) => { out('CRASH ' + (e && e.stack || e)); process.exit(1); });
