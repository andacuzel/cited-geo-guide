/* =====================================================================
   lib/pro-citation.js: the Pro citation questions and, behind their own switches, the live citation check and the model knowledge
   check, one small step at a time, inside the crawl's own steps.

   After the pages are read (and only when at least one was), a job goes through up to four more phases. Each is driven by the same
   browser-made step calls and the same per-job lock as the crawl, so a closed tab pauses it and the same link resumes it:

     profile    read the homepage and up to four key pages again (politely), ask the question writer (Claude without search; Gemini only as a
                disabled fallback) what the site is (lib/site-profile.js). One step.
     questions  write 18 + 3 questions in the site's language, grouped by topic (lib/citation-prompts.js). With only the questions switch
                on, this is the end: the report lists them as predictions, "Not tested".
     cite       CITATION_TEST_ENABLED: a deterministic sample of the questions (CITATION_QUESTION_SAMPLE, default 10), one run each, on every
                provider that is switched on (lib/citation-providers.js): Claude with web search, and ChatGPT (OpenAI API) and Perplexity if enabled.
                The same questions go to every engine, one run each: a dated sample, never a ranking. An engine that fails or times out is marked
                "unavailable" in the report; the others stand and nothing is filled in.
     know       CITATION_KNOWLEDGE_ENABLED: the same sample to Claude with no search; only "named" is stored.

   What each step does in cite: it picks the next questions not yet started and runs at most two Claude calls and two ChatGPT calls in parallel and,
   beside them, two Perplexity calls one after the other (Perplexity's limit is one request a second), so never more than five at once; every call is cut
   off at 35 s and none starts after 30 s into a step, so a step stays under the function's 60 s. A question's attempt is marked in Redis BEFORE its call (set once). If a step dies between the call and the stored result, the
   next step finds the marker without a result and records "interrupted": the call is never paid twice.

   Every paid call goes through lib/citation-budget.js: kill switch, per-report calls and cost, daily and monthly budgets, reserved before the call and
   reconciled with the real cost after. A provider that hits a rate limit (HTTP 429, after one backoff), or fails three times in a row, is stopped for
   that report; a budget cap or the kill switch stops them all. Whatever happens, the crawl's results stand and the report says what was and was not done.
   ===================================================================== */

'use strict';

const crypto = require('crypto');
const Config = require('./citation-config.js');
const Profile = require('./site-profile.js');
const Prompts = require('./citation-prompts.js');
const Check = require('./citation-check.js');
const LlmGemini = require('./llm-gemini.js');
const Providers = require('./citation-providers.js');
const Budget = require('./citation-budget.js');
const Stats = require('./pro-stats.js');

const START_BUDGET_MS = 30000;      // do not start a call later than this into a step (the function allows 60 s, a call up to 35 s)
const PERPLEXITY_GAP_MS = 1100;     // Perplexity answers one request a second (x-ratelimit-limit: 1 in its replies)
const LANES = { anthropic: 2, openai: 2, perplexity: 2 };   // calls per step; Claude's and ChatGPT's two run in parallel, Perplexity's two one after the other
const KNOW_PER_STEP = 3;
const MAX_FAIL_STREAK = 3;
const PHASES = ['profile', 'questions', 'cite', 'know'];

const REASONS = {
  quota: 'The provider’s rate limit was reached, so the remaining questions were not tested.',
  kill: 'The citation check was switched off, so the remaining questions were not tested.',
  report_calls: 'This report reached its limit of paid calls, so the remaining questions were not tested.',
  report_cost: 'This report reached its cost limit, so the remaining questions were not tested.',
  daily_budget: 'Citehound’s daily budget for citation checks was used up, so the remaining questions were not tested.',
  monthly_budget: 'Citehound’s monthly budget for citation checks was used up, so the remaining questions were not tested.',
  engine_calls: 'This report reached its limit of paid calls for this provider, so the remaining questions were not tested on it.',
  engine_cost: 'This report reached its cost limit for this provider, so the remaining questions were not tested on it.',
  engine_daily: 'Citehound’s daily budget for this provider was used up, so the remaining questions were not tested on it.',
  budget_unavailable: 'The usage counters could not be reached, so the remaining questions were not tested.',
  provider: 'The provider could not be reached, so the remaining questions were not tested.',
  timeout: 'The provider did not answer in time, so the remaining questions were not tested.',
  empty: 'The provider returned no answer, so the remaining questions were not tested.',
  refusal: 'The provider declined to answer, so the remaining questions were not tested.',
  incomplete: 'The provider did not finish its search, so the remaining questions were not tested.',
  no_search: 'The provider answered without searching the web, so the remaining questions were not tested.',
  interrupted: 'The request was interrupted, so the question was not tested.',
  ai_unavailable: 'The language model was not available, so no citation questions could be written.',
  no_homepage: 'The homepage could not be read a second time, so the site could not be profiled and no questions were written.',
  bad_profile: 'The site could not be read reliably enough to write questions about it, so none were written.',
  few_questions: 'Too few valid questions could be written, so none were tested.',
  disabled: 'The citation questions are not switched on.'
};
const BUDGET_REASONS = ['kill', 'report_calls', 'report_cost', 'daily_budget', 'monthly_budget', 'engine_calls', 'engine_cost', 'engine_daily', 'budget_unavailable'];

// The citation part exists for a job only when the questions switch is on and the question writer is ready (lib/citation-config.js).
function enabled(env) { return Config.flags(env).questions; }

// The real writer and providers for this process; tests pass their own through deps.citation ({ llm, providers: { id: adapter }, sleep }).
function defaultsFrom(env) {
  env = env || process.env;
  const f = Config.flags(env);
  const adapters = {};
  Config.ORDER.forEach(function (id) { if (f.providers.indexOf(id) !== -1) adapters[id] = Providers.make(id, env); });
  return {
    llm: f.generator === 'gemini' ? LlmGemini.makeJsonLlm({ apiKey: env.GEMINI_API_KEY, model: LlmGemini.modelName(env) }) : Providers.make('anthropic', env),
    providers: adapters,
    sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  };
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// The questions that are asked of a provider: a deterministic sample of the questions that do not name the brand, balanced across the topics
// (round robin over the groups, each group ordered by a hash of the job id and the question), so the same report always picks the same ones.
function pickSample(items, jobId, k) {
  const groups = Prompts.KINDS.map(function (kind) {
    return items.map(function (q, i) { return { q: q, i: i }; }).filter(function (x) { return !x.q.brand && x.q.kind === kind; }).sort(function (a, b) { return sha(jobId + '|' + a.q.text) < sha(jobId + '|' + b.q.text) ? -1 : 1; });
  });
  const out = [];
  for (let round = 0; out.length < k; round++) {
    let any = false;
    for (const g of groups) { if (round < g.length && out.length < k) { out.push(g[round].i); any = true; } }
    if (!any) break;
  }
  return out.sort(function (a, b) { return a - b; });
}

function viewOf(job) {
  const c = job.citation;
  if (!c) return null;
  const total = c.questions && c.questions.items ? c.questions.items.length : 0;
  const sample = c.sample || [];
  const live = c.stage === 'know' ? Object.keys(c.knowledge).length : Object.keys(c.results).reduce(function (n, p) { return n + Object.keys(c.results[p]).length; }, 0);
  const of = c.stage === 'know' ? sample.length : sample.length * Math.max(1, c.modes.providers.length);
  const tested = Object.keys(c.results).reduce(function (n, p) { return n + Object.keys(c.results[p]).filter(function (k) { return c.results[p][k] && c.results[p][k].state === 'tested'; }).length; }, 0);
  return { status: c.status, stage: c.stage, language: c.profile ? c.profile.language : null, total: of || total || Prompts.N_OPEN + Prompts.N_BRAND, asked: live, tested: tested, test: !!c.modes.test, knowledge: !!c.modes.knowledge, providers: c.modes.providers };
}

/* ---------------- ending ---------------- */

async function endAll(store, job, status, reason) {
  await store.setCitation(job.id, { status: status, stage: 'done', reason: reason || '' });
  return { finished: true };
}
async function endQuestions(store, job, status, reason) {
  await Stats.count(store, status === 'not_tested' ? 'citation_not_tested' : 'citation_questions');
  return endAll(store, job, status, reason);
}
async function afterQuestions(store, job) {
  const m = job.citation.modes;
  if (m.test) { await store.setCitation(job.id, { stage: 'cite', status: 'running' }); await store.setJob(job.id, { phase: 'cite' }); return { finished: false }; }
  if (m.knowledge) { await store.setCitation(job.id, { stage: 'know', status: 'questions' }); await store.setJob(job.id, { phase: 'know' }); return { finished: false }; }
  await Stats.count(store, 'citation_questions');
  return endAll(store, job, 'questions', '');
}
async function endTest(store, job, status, reason, pstat) {
  await Stats.count(store, status === 'ok' ? 'citation_complete' : (status === 'partial' ? 'citation_partial' : 'citation_not_tested'));
  const set = { status: status, reason: reason || '', pstat: pstat };
  if (job.citation.modes.knowledge) { await store.setCitation(job.id, Object.assign(set, { stage: 'know' })); await store.setJob(job.id, { phase: 'know' }); return { finished: false }; }
  await store.setCitation(job.id, Object.assign(set, { stage: 'done' }));
  return { finished: true };
}
async function endKnow(store, job, status, reason) {
  await Stats.count(store, 'citation_knowledge_runs');
  const set = { kstatus: status, kreason: reason || '', stage: 'done' };
  if (!job.citation.modes.test) set.status = 'questions';
  await store.setCitation(job.id, set);
  return { finished: true };
}

/* ---------------- phases ---------------- */

// Returns { finished: true } when the citation part ends at once (switched off or killed since the report was started), else { finished: false }.
async function begin(store, job, env) {
  env = env || process.env;
  const f = Config.flags(env);
  const modes = { test: f.test, knowledge: f.knowledge, generator: f.generator, providers: f.providers, models: f.models, sample: f.limits.sample };
  if (!f.questions || await Budget.killed(store, env)) {
    await store.setCitation(job.id, { status: 'not_tested', stage: 'done', reason: f.questions ? REASONS.kill : (f.kill ? REASONS.kill : REASONS.disabled), modes: modes });
    await Stats.count(store, 'citation_not_tested');
    return { finished: true };
  }
  await store.setCitation(job.id, { status: 'running', stage: 'profile', modes: modes });
  await store.setJob(job.id, { phase: 'profile' });
  await Stats.count(store, 'citation_runs');
  return { finished: false };
}

// The question writer, with every call reserved and reconciled against the budget.
function guardedWriter(store, job, c) {
  const raw = c.deps.llm;
  const w = { model: raw.model, lastReason: null };
  w.json = async function (req) {
    const g = await Budget.reserve(store, job.id, { provider: 'generate', estMicro: Budget.ESTIMATE.generate, env: c.env, now: c.now() });
    if (!g.ok) { w.lastReason = g.reason; throw new LlmGemini.LlmError('budget', g.reason); }
    try {
      const r = raw.generate ? await raw.generate(req) : { value: await raw.json(req), costUsd: 0 };
      await Budget.reconcile(store, g.g, Budget.micro(r.costUsd || 0));
      return r.value;
    } catch (e) { await Budget.reconcile(store, g.g, Budget.micro(e && e.costUsd || 0)); throw e; }
  };
  return w;
}

async function doProfile(store, job, c) {
  const origin = new URL(job.pages[0].url).origin;
  const w = guardedWriter(store, job, c);
  const r = await Profile.buildProfile(job, origin, { get: c.get, llm: w });
  if (!r.ok) return endQuestions(store, job, 'not_tested', w.lastReason ? REASONS[w.lastReason] : (REASONS[r.reason] || REASONS.bad_profile));
  await store.setCitation(job.id, { profile: r.profile, stage: 'questions', status: 'running', model: w.model, date: new Date().toISOString().slice(0, 10) });
  await store.setJob(job.id, { phase: 'questions' });
  return { finished: false };
}

async function doQuestions(store, job, c) {
  const cit = job.citation, profile = cit.profile, domain = job.domain;
  const vertical = Prompts.verticalFor(profile);
  const draft = cit.qdraft || { open: [], brand: [] };
  const w = guardedWriter(store, job, c);
  let raw = null, llmFailed = false;
  try {
    raw = await w.json(Prompts.buildRequest(profile, { vertical: vertical, have: draft.open.map(function (q) { return q.text; }), want: Prompts.N_OPEN - draft.open.length }));
  } catch (e) { llmFailed = true; }
  if (w.lastReason && !draft.open.length) return endQuestions(store, job, 'not_tested', REASONS[w.lastReason]);
  let v = llmFailed ? { open: draft.open, brand: draft.brand, rejected: [] } : Prompts.validate(raw, profile, domain, draft);
  const complete = v.open.length >= Prompts.N_OPEN && v.brand.length >= Prompts.N_BRAND;
  if (!complete && cit.qattempts < 1 && !llmFailed) {
    await store.setCitation(job.id, { qdraft: { open: v.open, brand: v.brand }, qattempts: 1 });
    return { finished: false }; // one more call next step, asking for what is missing
  }
  let source = draft.open.length || v.open.length ? 'llm' : null;
  if (v.open.length < Prompts.N_OPEN) { const t = Prompts.topUp(v, profile, domain, vertical); if (t.usedVertical) { v = t; source = source ? 'llm+vertical:' + vertical : 'vertical:' + vertical; } }
  if (!v.brand.length) v = Object.assign({}, v, { brand: Prompts.brandFallback(profile, domain) });
  if (v.open.length < Prompts.MIN_OPEN || !v.brand.length) return endQuestions(store, job, 'not_tested', REASONS.few_questions);
  const fin = Prompts.finalize(v, source || 'llm');
  const set = { questions: fin, source: fin.source, qdraft: '' };
  if (cit.modes.test || cit.modes.knowledge) set.sample = pickSample(fin.items, job.id, Math.min(cit.modes.sample || 10, fin.items.filter(function (q) { return !q.brand; }).length));
  await store.setCitation(job.id, set);
  job.citation.questions = fin;
  return afterQuestions(store, job);
}

/* ---------------- the live check ---------------- */

const outcomeOf = async (store, job, c, prov, idx) => {
  // One paid call for one question on one provider. Returns { stop } when this provider (or all) must stop; the result is stored here.
  const cit = job.citation, adapter = c.deps.providers[prov], item = cit.questions.items[idx];
  const site = { domain: job.domain, brand: cit.profile.brandName };
  const locale = cit.profile.language;
  const put = (res) => store.setCitationResult(job.id, prov, idx, res);
  if (!adapter) { await put({ state: 'not_tested', reason: 'provider' }); return { stop: 'provider' }; }
  if (!(await store.markAttempt(job.id, prov, idx))) return {};                       // someone else has started it: never twice
  const g = await Budget.reserve(store, job.id, { provider: prov, estMicro: Budget.ESTIMATE[prov] || Budget.ESTIMATE.anthropic, env: c.env, now: c.now() });
  // An engine's own cap stops that engine only; the kill switch and the overall caps stop every engine.
  if (!g.ok) { await put({ state: 'not_tested', reason: g.reason }); return /^engine_/.test(g.reason) ? { stop: g.reason } : { stopAll: g.reason }; }
  await Stats.count(store, 'citation_calls');
  let res;
  try { res = await adapter.runPrompt({ prompt: item.text, locale: locale, search: true }); } catch (e) { res = { error: { kind: 'provider' }, costUsd: 0 }; }
  await Budget.reconcile(store, g.g, Budget.micro(res.costUsd || 0));
  if (res.error) {
    const kind = REASONS[res.error.kind] ? res.error.kind : 'provider';
    await put({ state: 'not_tested', reason: kind, micro: Budget.micro(res.costUsd || 0) });
    return kind === 'quota' ? { stop: 'quota', failed: true } : { failed: true, kind: kind };
  }
  await put(Check.analyze(res, site));
  return { ok: true };
};

async function doCite(store, job, c) {
  const cit = job.citation, sample = cit.sample || [], provs = cit.modes.providers;
  const results = {}; provs.forEach(function (p) { results[p] = Object.assign({}, cit.results[p] || {}); });
  const pstat = JSON.parse(JSON.stringify(cit.pstat || {}));
  provs.forEach(function (p) { pstat[p] = pstat[p] || { streak: 0, stop: null }; });
  const put = async (p, i, res) => { results[p][i] = res; await store.setCitationResult(job.id, p, i, res); };
  // An attempt without a result is one a dead step left behind: it may already have been paid, so it is not asked again.
  for (const p of provs) for (const i of sample) if ((cit.pending[p] || {})[i] && !results[p][i]) await put(p, i, { state: 'not_tested', reason: 'interrupted' });
  let stopAll = null;
  const stopProvider = async (p, why) => { pstat[p].stop = why; for (const i of sample) if (!results[p][i]) { await store.markAttempt(job.id, p, i); await put(p, i, { state: 'not_tested', reason: why }); } };
  for (const p of provs) if (pstat[p].stop) await stopProvider(p, pstat[p].stop);

  const lane = async (p) => {
    const todo = sample.filter(function (i) { return !results[p][i] && !pstat[p].stop; }).slice(0, LANES[p] || 1);
    const run = async (i) => {
      if (stopAll || pstat[p].stop) return;
      if (c.now() - c.started > START_BUDGET_MS) return;
      const o = await outcomeOf(store, job, c, p, i);
      const fresh = (await store.getCitation(job.id));
      results[p][i] = fresh.results[p] && fresh.results[p][i] ? fresh.results[p][i] : results[p][i];
      if (o.stopAll) stopAll = o.stopAll;
      else if (o.stop) pstat[p].stop = o.stop;
      else if (o.ok) pstat[p].streak = 0;
      else if (o.failed && ++pstat[p].streak >= MAX_FAIL_STREAK) pstat[p].stop = o.kind || 'provider';
    };
    if (p === 'anthropic' || p === 'openai') await Promise.all(todo.map(run));
    else for (let k = 0; k < todo.length; k++) { if (k > 0) await c.deps.sleep(PERPLEXITY_GAP_MS); await run(todo[k]); }
  };
  await Promise.all(provs.map(lane));

  if (stopAll) { for (const p of provs) if (!pstat[p].stop) pstat[p].stop = stopAll; }
  for (const p of provs) if (pstat[p].stop) await stopProvider(p, pstat[p].stop);
  await store.setCitation(job.id, { pstat: pstat });

  const open = provs.some(function (p) { return sample.some(function (i) { return !results[p][i]; }); });
  if (open) return { finished: false };
  const summary = {}; let okAll = true, anyTested = false, why = '';
  provs.forEach(function (p) {
    const tested = sample.filter(function (i) { return results[p][i] && results[p][i].state === 'tested'; }).length;
    const st = tested === sample.length ? 'ok' : (tested ? 'partial' : 'not_tested');
    summary[p] = { status: st, tested: tested, of: sample.length, reason: st === 'ok' ? '' : (REASONS[pstat[p].stop] || REASONS[firstReason(results[p], sample)] || REASONS.provider), stop: pstat[p].stop || null };
    if (st !== 'ok') { okAll = false; if (!why) why = summary[p].reason; }
    if (tested) anyTested = true;
  });
  return endTest(store, job, okAll ? 'ok' : (anyTested ? 'partial' : 'not_tested'), okAll ? '' : why, summary);
}
function firstReason(res, sample) { for (const i of sample) if (res[i] && res[i].reason) return res[i].reason; return 'provider'; }

/* ---------------- the model knowledge check ---------------- */

async function doKnow(store, job, c) {
  const cit = job.citation, sample = cit.sample || [], adapter = c.deps.providers.anthropic;
  const known = Object.assign({}, cit.knowledge);
  const site = { domain: job.domain, brand: cit.profile.brandName };
  const todo = sample.filter(function (i) { return !known[i]; }).slice(0, KNOW_PER_STEP);
  let stop = null;
  await Promise.all(todo.map(async function (i) {
    if (stop || !adapter || c.now() - c.started > START_BUDGET_MS) { if (!adapter) { stop = 'provider'; } return; }
    if (!(await store.markAttempt(job.id, 'know', i))) { return; }
    const g = await Budget.reserve(store, job.id, { provider: 'knowledge', estMicro: Budget.ESTIMATE.knowledge, env: c.env, now: c.now() });
    if (!g.ok) { stop = g.reason; known[i] = { state: 'not_tested', reason: g.reason }; await store.setKnowledgeResult(job.id, i, known[i]); return; }
    await Stats.count(store, 'citation_knowledge_calls');
    let res; try { res = await adapter.runPrompt({ prompt: cit.questions.items[i].text, locale: cit.profile.language, search: false }); } catch (e) { res = { error: { kind: 'provider' }, costUsd: 0 }; }
    await Budget.reconcile(store, g.g, Budget.micro(res.costUsd || 0));
    known[i] = res.error ? { state: 'not_tested', reason: REASONS[res.error.kind] ? res.error.kind : 'provider' } : Check.analyzeKnowledge(res, site);
    if (res.error && res.error.kind === 'quota') stop = 'quota';
    await store.setKnowledgeResult(job.id, i, known[i]);
    await store.setCitation(job.id, { kmodel: res.modelId || '', kdate: new Date().toISOString().slice(0, 10) });
  }));
  if (stop) { for (const i of sample) if (!known[i]) { await store.markAttempt(job.id, 'know', i); known[i] = { state: 'not_tested', reason: stop }; await store.setKnowledgeResult(job.id, i, known[i]); } }
  // An attempt without a result (a dead step) is not asked again.
  for (const i of sample) if (!known[i] && (cit.pending.know || {})[i]) { known[i] = { state: 'not_tested', reason: 'interrupted' }; await store.setKnowledgeResult(job.id, i, known[i]); }
  if (!sample.every(function (i) { return known[i]; })) return { finished: false };
  const tested = sample.filter(function (i) { return known[i].state === 'tested'; }).length;
  return endKnow(store, job, tested === sample.length ? 'ok' : (tested ? 'partial' : 'not_tested'), tested === sample.length ? '' : (REASONS[stop] || REASONS.provider));
}

// One step of the citation phases. c: { get, now, started, env, deps }. Returns { finished }.
async function step(store, job, c) {
  c.deps = Object.assign(defaultsFrom(c.env), c.deps || {});
  try {
    if (job.phase === 'profile') return await doProfile(store, job, c);
    if (job.phase === 'questions') return await doQuestions(store, job, c);
    if (job.phase === 'know') return await doKnow(store, job, c);
    return await doCite(store, job, c);
  } catch (e) {
    console.error('[pro-citation] ' + job.phase + ' failed: ' + (e && e.name ? e.name : 'Error') + (e && e.kind ? ' ' + e.kind : ''));
    return endAll(store, job, 'not_tested', REASONS.provider);
  }
}

module.exports = { enabled: enabled, begin: begin, step: step, viewOf: viewOf, defaultsFrom: defaultsFrom, pickSample: pickSample, REASONS: REASONS, PHASES: PHASES, BUDGET_REASONS: BUDGET_REASONS };
