/* Shared mocks for scripts/test-citation.js and scripts/test-citation-pipeline.js: a question writer, provider adapters, a pretend site, switches, and a job runner
   that drives the real crawler steps (and so the real citation phases) against the in-memory store. No network. */
'use strict';

const S = require('../../lib/pro-store.js');
const Crawler = require('../../lib/pro-crawler.js');
const Prompts = require('../../lib/citation-prompts.js');

const ENV_Q = { CITATION_QUESTIONS_ENABLED: '1', CITATION_ANTHROPIC_ENABLED: '1', ANTHROPIC_API_KEY: 'test-anthropic-key' };
const ENV_T = Object.assign({}, ENV_Q, { CITATION_TEST_ENABLED: '1' });
const ENV_TP = Object.assign({}, ENV_T, { CITATION_PERPLEXITY_ENABLED: '1', PERPLEXITY_API_KEY: 'test-perplexity-key' });
const ENV_ALL = Object.assign({}, ENV_TP, { CITATION_OPENAI_ENABLED: '1', OPENAI_API_KEY: 'test-openai-key' });
const ENV_K = Object.assign({}, ENV_Q, { CITATION_KNOWLEDGE_ENABLED: '1' });

// The question writer. A profile for a profile request, questions for a question request. generate() reports a cost, json() does not (the Gemini shape).
function mockLlm(site, opts) {
  opts = opts || {};
  const llm = {
    model: 'mock-writer', calls: [], failWith: opts.failWith || null, failFrom: opts.failFrom || 0,
    async json(req) {
      llm.calls.push(req);
      if (llm.failWith && llm.calls.length > llm.failFrom) { const e = new Error('x'); e.kind = llm.failWith; throw e; }
      if (req.schema.properties.siteType) return opts.profile || site.profile;
      const nonEn = site.lang !== 'en';
      const gl = (q, i) => (nonEn ? { gloss: 'English version of question ' + (i + 1) } : {});
      const qs = opts.questions || site.open.map((text, i) => Object.assign({ text: text, kind: Prompts.KINDS[i % 5] }, gl(text, i)));
      const bq = opts.brandQs || site.brandQs.map((text, i) => Object.assign({ text: text }, gl(text, i)));
      if (opts.perCall) return opts.perCall(llm.calls.length, { questions: qs, brandQuestions: bq });
      return { questions: qs, brandQuestions: bq };
    }
  };
  if (opts.cost !== undefined) llm.generate = async function (req) { return { value: await llm.json(req), costUsd: opts.cost, usage: {} }; };
  return llm;
}

const DEFAULT_COST = { anthropic: 0.012, openai: 0.02, perplexity: 0.0045 };
const LABELS = { anthropic: 'Claude', openai: 'ChatGPT', perplexity: 'Perplexity' };
const MODELS = { anthropic: 'mock-claude', openai: 'mock-gpt', perplexity: 'mock-sonar' };
// A provider adapter. handler(prompt, n, o) may return a runPrompt result or throw; calls (search) and plain (no search) record the prompts.
function mockAdapter(id, handler, o) {
  o = o || {};
  const a = {
    id: id, label: LABELS[id] || id, model: o.model || MODELS[id] || 'mock', calls: [], plain: [], args: [], active: 0, maxActive: 0,
    async runPrompt(arg) {
      a.args.push(arg);
      const search = arg.search !== false;
      (search ? a.calls : a.plain).push(arg.prompt);
      a.active++; a.maxActive = Math.max(a.maxActive, a.active);
      try {
        if (o.delay) await new Promise((r) => setTimeout(r, o.delay));
        if (handler) return await handler(arg.prompt, search ? a.calls.length : a.plain.length, arg);
        if (!search) return { answerText: 'There are several tools. Examples include ExampleOne and ExampleTwo.', citations: [], usage: {}, costUsd: 0.0005, providerLabel: a.label, modelId: a.model, searches: 0 };
        return { answerText: 'Several tools are popular. Examples include ExampleOne and ExampleTwo.', citations: [{ url: 'https://www.example-two.com/a?utm=1#x', domain: 'example-two.com', title: 'Two' }, { url: 'https://example-one.com/b', domain: 'example-one.com', title: 'One' }], usage: {}, costUsd: DEFAULT_COST[id] || 0.01, providerLabel: a.label, modelId: a.model, citationKind: id === 'perplexity' ? 'returned' : 'cited', searches: 1 };
      } finally { a.active--; }
    }
  };
  return a;
}
const failResult = (kind, cost) => ({ answerText: '', citations: [], usage: {}, costUsd: cost || 0, error: { kind: kind, message: kind }, searches: 0 });

function siteFetch(site, log) {
  return async function (url) {
    log && log.push(url);
    const u = new URL(url);
    const p = u.pathname;
    if (p === '/robots.txt') return { ok: true, status: 200, text: 'User-agent: *\nAllow: /\nSitemap: https://' + site.domain + '/sitemap.xml\n', headers: {}, finalUrl: url };
    if (p === '/sitemap.xml') return { ok: true, status: 200, text: '<urlset>' + Object.keys(site.pages).map((x) => '<url><loc>https://' + site.domain + x + '</loc></url>').join('') + '</urlset>', headers: {}, contentType: 'application/xml', finalUrl: url };
    if (p === '/llms.txt') return { ok: false, status: 404, text: '', headers: {}, finalUrl: url };
    if (site.pages[p]) return { ok: true, status: 200, text: site.pages[p], contentType: 'text/html', headers: {}, finalUrl: url };
    return { ok: false, status: 404, text: '', headers: {}, finalUrl: url };
  };
}

// Runs a job to its end through the real steps. o: { env, llm, providers: { id: adapter }, adapter, store, stopAfter, fetchLog, citation (false = a job with the part off) }.
async function runJob(site, o) {
  o = o || {};
  const adapter = o.adapter || S.memoryAdapter();
  const store = o.store || S.createStore(adapter);
  const id = o.jobId || await store.createJob({ domain: site.domain, citation: o.citation !== false });
  if (!o.jobId) await store.reserveDomainSlot(site.domain, 2);
  const llm = o.llm || mockLlm(site);
  const providers = o.providers || { anthropic: mockAdapter('anthropic') };
  const clock = o.clock || { t: Date.now() };
  const deps = { fetch: siteFetch(site, o.fetchLog), sleep: async () => {}, now: () => (clock.t += 1100), env: o.env || ENV_T, citation: { llm: llm, providers: providers, sleep: async () => {} } };
  const views = [];
  for (let i = 0; i < 90; i++) {
    const r = await Crawler.runStep(store, id, deps);
    views.push(r);
    if (['done', 'partial', 'failed'].indexOf(r.status) !== -1) break;
    if (o.stopAfter && views.length >= o.stopAfter) break;
  }
  return { store, adapter, id, llm, providers, views, deps, job: await store.getJob(id) };
}

module.exports = { ENV_Q, ENV_T, ENV_TP, ENV_ALL, ENV_K, mockLlm, mockAdapter, failResult, siteFetch, runJob };
