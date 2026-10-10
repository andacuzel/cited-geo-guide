/* =====================================================================
   lib/pro-citation.js: the Pro citation questions (and, behind their own switches, live testing and the model knowledge
   check), one small step at a time, inside the crawl's own steps.

   After the pages are read (and only when at least one was), a job goes through up to four more phases, each driven by the
   same browser-made step calls and the same per-job lock as the crawl, so it is idempotent and resumable:

     profile    read the homepage and up to four key pages again (politely), ask the model what the site is
                (lib/site-profile.js). One step.
     questions  write 18 + 3 questions in the site's language (lib/citation-prompts.js). One model call per step, at most two.
                With only CITATION_QUESTIONS_ENABLED this is the end: the report lists the questions, "Not tested".
     cite       only with CITATION_TEST_ENABLED: ask the questions to the provider's assistant with web search
                (lib/citation-check.js), about three per step; every answer is stored before the next call.
     know       only with CITATION_KNOWLEDGE_ENABLED: the same questions to the provider's plain chat API with no search;
                only whether the brand or domain appears in the answer is stored.

   Which of these a job gets is decided once, when the citation phases begin, and stored on the job (modes), so a switch
   changed halfway cannot change a running report. See lib/citation-config.js for the switches.

   Controls, enforced here: at most 21 questions and so 21 calls per phase; CITATION_DAILY_CAP live calls a day (default 60,
   test and knowledge together); CITATION_MONTHLY_QUERY_CAP web searches a month (default 300); CITATION_QUESTIONS_DAILY_CAP
   question-writing jobs a day (default 30); calls one after another with a pause and a timeout of their own; a quota answer
   (HTTP 429) ends that phase at once and marks every question not yet asked "not tested", with no retry; three failed calls in a
   row end it the same way. The citation part never fails the report: whatever happens, the crawl's results stand and the report
   says what was and was not done.
   ===================================================================== */

'use strict';

const Config = require('./citation-config.js');
const Profile = require('./site-profile.js');
const Prompts = require('./citation-prompts.js');
const Check = require('./citation-check.js');
const LlmGemini = require('./llm-gemini.js');
const Anthropic = require('./citation-anthropic.js');
const Stats = require('./pro-stats.js');

const MAX_CALLS = 21;
const PER_STEP = 3;
const PER_STEP_PLAIN = 5;
const CALL_DELAY_MS = 700;
const START_BUDGET_MS = 24000;      // do not start a call later than this into a step (the step allows ~42 s, a call up to 40 s)
const MAX_FAIL_STREAK = 3;
const DEFAULT_DAILY_CAP = 60;
const DEFAULT_MONTHLY_QUERY_CAP = 300;
const DEFAULT_QUESTIONS_DAILY_CAP = 30;
const PHASES = ['profile', 'questions', 'cite', 'know'];

const REASONS = {
  quota: 'The provider’s rate or spending limit was reached, so the remaining questions were not tested.',
  daily_cap: 'Citehound’s daily limit for live checks was reached, so the remaining questions were not tested.',
  monthly_cap: 'Citehound’s monthly limit for web searches was reached, so the remaining questions were not tested.',
  questions_daily_cap: 'Citehound’s daily limit for writing citation questions was reached, so none were written for this report.',
  provider: 'The assistant could not be reached, so the remaining questions were not tested.',
  timeout: 'The assistant did not answer in time, so the remaining questions were not tested.',
  empty: 'The assistant returned no answer, so the remaining questions were not tested.',
  incomplete: 'The assistant did not finish its search, so the remaining questions were not tested.',
  no_search: 'The assistant answered without searching the web, so the remaining questions were not tested.',
  ai_unavailable: 'The language model was not available, so no citation questions could be written.',
  no_homepage: 'The homepage could not be read a second time, so the site could not be profiled and no questions were written.',
  bad_profile: 'The site could not be read reliably enough to write questions about it, so none were written.',
  few_questions: 'Too few valid questions could be written, so none were tested.',
  disabled: 'The citation questions are not switched on.'
};

const num = (v, d) => { const n = parseInt(v, 10); return n >= 0 ? n : d; };
const caps = (env) => { env = env || process.env; return { daily: num(env.CITATION_DAILY_CAP, DEFAULT_DAILY_CAP), monthly: num(env.CITATION_MONTHLY_QUERY_CAP, DEFAULT_MONTHLY_QUERY_CAP), questionsDaily: num(env.CITATION_QUESTIONS_DAILY_CAP, DEFAULT_QUESTIONS_DAILY_CAP) }; };

// The citation part exists for a job only when the questions switch is on and a Gemini key is present (lib/citation-config.js).
function enabled(env) { return Config.flags(env).questions; }

// The real model and provider for this process; tests pass their own through deps.citation.
function defaultsFrom(env) {
  env = env || process.env;
  const f = Config.flags(env);
  return {
    llm: LlmGemini.makeJsonLlm({ apiKey: env.GEMINI_API_KEY, model: LlmGemini.modelName(env) }),
    provider: f.provider === 'anthropic' ? Anthropic.anthropicProvider({ apiKey: env[Config.PROVIDERS.anthropic.keyEnv], model: f.model }) : null,
    sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  };
}

function viewOf(job) {
  const c = job.citation;
  if (!c) return null;
  const total = c.questions && c.questions.items ? c.questions.items.length : 0;
  const ran = c.modes.knowledge && c.stage === 'know' ? c.knowledge : c.results;
  const tested = Object.keys(c.results).filter(function (k) { return c.results[k] && c.results[k].state === 'tested'; }).length;
  return { status: c.status, stage: c.stage, language: c.profile ? c.profile.language : null, total: total || Prompts.N_OPEN + Prompts.N_BRAND, asked: Object.keys(ran).length, tested: tested, test: !!c.modes.test, knowledge: !!c.modes.knowledge };
}

/* ---------------- ending a phase ---------------- */

async function endAll(store, job, status, reason) {
  await store.setCitation(job.id, { status: status, stage: 'done', reason: reason || '' });
  return { finished: true };
}

// The end of the questions phase, or of a failed earlier phase (nothing else can follow a missing question list).
async function endQuestions(store, job, c, status, reason) {
  if (status === 'not_tested') await Stats.count(store, 'citation_not_tested');
  else await Stats.count(store, 'citation_questions');
  return endAll(store, job, status, reason);
}

async function toNextAfterQuestions(store, job) {
  const m = job.citation.modes;
  if (m.test) { await store.setCitation(job.id, { stage: 'cite', status: 'running' }); await store.setJob(job.id, { phase: 'cite' }); return { finished: false }; }
  if (m.knowledge) { await store.setCitation(job.id, { stage: 'know', status: 'questions' }); await store.setJob(job.id, { phase: 'know' }); return { finished: false }; }
  await Stats.count(store, 'citation_questions');
  return endAll(store, job, 'questions', '');
}

async function endTest(store, job, status, reason) {
  await Stats.count(store, status === 'ok' ? 'citation_complete' : (status === 'partial' ? 'citation_partial' : 'citation_not_tested'));
  if (job.citation.modes.knowledge) {
    await store.setCitation(job.id, { status: status, reason: reason || '', stage: 'know' });
    await store.setJob(job.id, { phase: 'know' });
    return { finished: false };
  }
  return endAll(store, job, status, reason);
}

async function endKnow(store, job, status, reason, extra) {
  await Stats.count(store, 'citation_knowledge_runs');
  const set = Object.assign({ kstatus: status, kreason: reason || '', stage: 'done' }, extra || {});
  // With testing off, the overall status is "questions": the knowledge check is reported on its own.
  if (!job.citation.modes.test) set.status = 'questions';
  await store.setCitation(job.id, set);
  return { finished: true };
}

/* ---------------- phases ---------------- */

// Returns { finished: true } when the citation part ends at once (the daily limit for writing questions), else { finished: false }.
async function begin(store, job, env) {
  env = env || process.env;
  const f = Config.flags(env);
  const A = store.adapter;
  const day = new Date().toISOString().slice(0, 10);
  const modes = { test: f.test, knowledge: f.knowledge, provider: f.provider, model: f.model };
  const n = await A.incr('pro:cit:qday:' + day);
  await A.expire('pro:cit:qday:' + day, 2 * 86400);
  if (n > caps(env).questionsDaily) {
    await A.decr('pro:cit:qday:' + day);
    await store.setCitation(job.id, { status: 'not_tested', stage: 'done', reason: REASONS.questions_daily_cap, modes: modes });
    await Stats.count(store, 'citation_not_tested');
    return { finished: true };
  }
  await store.setCitation(job.id, { status: 'running', stage: 'profile', modes: modes });
  await store.setJob(job.id, { phase: 'profile' });
  await Stats.count(store, 'citation_runs');
  return { finished: false };
}

async function doProfile(store, job, c) {
  const origin = new URL(job.pages[0].url).origin;
  const r = await Profile.buildProfile(job, origin, { get: c.get, llm: c.deps.llm });
  if (!r.ok) return endQuestions(store, job, c, 'not_tested', REASONS[r.reason] || REASONS.bad_profile);
  await store.setCitation(job.id, { profile: r.profile, stage: 'questions', status: 'running', model: c.deps.llm.model, date: new Date().toISOString().slice(0, 10) });
  await store.setJob(job.id, { phase: 'questions' });
  return { finished: false };
}

async function doQuestions(store, job, c) {
  const cit = job.citation, profile = cit.profile, domain = job.domain;
  const vertical = Prompts.verticalFor(profile);
  const draft = cit.qdraft || { open: [], brand: [] };
  let raw = null, llmFailed = false;
  try {
    raw = await c.deps.llm.json(Prompts.buildRequest(profile, { vertical: vertical, have: draft.open.map(function (q) { return q.text; }), want: Prompts.N_OPEN - draft.open.length }));
  } catch (e) { llmFailed = true; }
  let v = llmFailed ? { open: draft.open, brand: draft.brand, rejected: [] } : Prompts.validate(raw, profile, domain, draft);
  const complete = v.open.length >= Prompts.N_OPEN && v.brand.length >= Prompts.N_BRAND;
  if (!complete && cit.qattempts < 1 && !llmFailed) {
    await store.setCitation(job.id, { qdraft: { open: v.open, brand: v.brand }, qattempts: 1 });
    return { finished: false }; // one more call next step, asking for what is missing
  }
  let source = draft.open.length || v.open.length ? 'llm' : null;
  if (v.open.length < Prompts.N_OPEN) { const t = Prompts.topUp(v, profile, domain, vertical); if (t.usedVertical) { v = t; source = source ? 'llm+vertical:' + vertical : 'vertical:' + vertical; } }
  if (!v.brand.length) v = Object.assign({}, v, { brand: Prompts.brandFallback(profile, domain) });
  if (v.open.length < Prompts.MIN_OPEN || !v.brand.length) return endQuestions(store, job, c, 'not_tested', REASONS.few_questions);
  const fin = Prompts.finalize(v, source || 'llm');
  await store.setCitation(job.id, { questions: fin, source: fin.source, qdraft: '' });
  job.citation.questions = fin;
  return toNextAfterQuestions(store, job);
}

// The shared loop of the two live phases. kind: 'test' (search) or 'know' (plain). Returns { stop: code } or { finished: bool }.
async function runCalls(store, job, c, kind) {
  const A = store.adapter;
  const cit = job.citation, items = cit.questions.items;
  const test = kind === 'test';
  const results = Object.assign({}, test ? cit.results : cit.knowledge);
  const site = { domain: job.domain, brand: cit.profile.brandName };
  const limits = caps(c.env);
  const provider = c.deps.provider;
  const perStep = test ? PER_STEP : PER_STEP_PLAIN;
  const put = test ? store.setCitationResult : store.setKnowledgeResult;
  const callsKey = test ? 'calls' : 'kcalls';
  let streak = 0, done = 0, calls = test ? cit.calls : cit.kcalls;
  const stop = async function (code) {
    for (let i = 0; i < items.length; i++) if (!results[i]) await put(job.id, i, { state: 'not_tested', reason: code });
    return { stop: code, results: results };
  };
  if (!provider) return stop('provider');
  for (let i = 0; i < items.length && done < perStep; i++) {
    if (results[i]) continue;
    if (c.now() - c.started > START_BUDGET_MS) break;
    if (calls >= MAX_CALLS + 3) return stop('provider');
    const day = new Date(c.now()).toISOString().slice(0, 10), month = day.slice(0, 7);
    if (test && parseInt((await A.hget('pro:cit:months', month)) || '0', 10) >= limits.monthly) return stop('monthly_cap');
    const n = await A.incr('pro:cit:day:' + day);
    await A.expire('pro:cit:day:' + day, 2 * 86400);
    if (n > limits.daily) { await A.decr('pro:cit:day:' + day); return stop('daily_cap'); }
    if (done > 0) await c.deps.sleep(CALL_DELAY_MS);
    calls++; done++;
    await Stats.count(store, test ? 'citation_calls' : 'citation_knowledge_calls');
    let res;
    try {
      res = test ? await Check.checkQuestion(items[i].text, site, { provider: provider }) : await Check.knowledgeQuestion(items[i].text, site, { provider: provider });
      streak = 0;
    } catch (e) {
      const kind2 = e && e.kind ? e.kind : 'provider';
      await store.setCitation(job.id, (function () { const o = {}; o[callsKey] = calls; return o; }()));
      if (kind2 === 'quota') return stop('quota');
      streak++;
      res = { state: 'not_tested', reason: kind2 };
      await put(job.id, i, res); results[i] = res;
      if (streak >= MAX_FAIL_STREAK) return stop(REASONS[kind2] ? kind2 : 'provider');
      continue;
    }
    await put(job.id, i, res); results[i] = res;
    if (test) { await A.hincrby('pro:cit:months', month, Math.max(1, res.queries)); await A.expire('pro:cit:months', 400 * 86400); }
    const upd = {}; upd[callsKey] = calls; upd[test ? 'model' : 'kmodel'] = res.model; upd[test ? 'date' : 'kdate'] = res.date;
    await store.setCitation(job.id, upd);
  }
  const all = items.every(function (_, i) { return results[i]; });
  return { finished: all, results: results };
}

const testedCount = (results) => Object.keys(results).filter(function (k) { return results[k] && results[k].state === 'tested'; }).length;

async function doCite(store, job, c) {
  const r = await runCalls(store, job, c, 'test');
  if (r.stop) { const n = testedCount(r.results); return endTest(store, job, n ? 'partial' : 'not_tested', REASONS[r.stop] || REASONS.provider); }
  if (r.finished) {
    const total = job.citation.questions.items.length, n = testedCount(r.results);
    return endTest(store, job, n === total ? 'ok' : (n ? 'partial' : 'not_tested'), n === total ? '' : REASONS.provider);
  }
  return { finished: false };
}

async function doKnow(store, job, c) {
  const r = await runCalls(store, job, c, 'know');
  if (r.stop) { const n = testedCount(r.results); return endKnow(store, job, n ? 'partial' : 'not_tested', REASONS[r.stop] || REASONS.provider); }
  if (r.finished) {
    const total = job.citation.questions.items.length, n = testedCount(r.results);
    return endKnow(store, job, n === total ? 'ok' : (n ? 'partial' : 'not_tested'), n === total ? '' : REASONS.provider);
  }
  return { finished: false };
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

module.exports = { enabled: enabled, begin: begin, step: step, viewOf: viewOf, defaultsFrom: defaultsFrom, caps: caps, REASONS: REASONS, MAX_CALLS: MAX_CALLS, PER_STEP: PER_STEP, PHASES: PHASES, DEFAULT_DAILY_CAP: DEFAULT_DAILY_CAP, DEFAULT_MONTHLY_QUERY_CAP: DEFAULT_MONTHLY_QUERY_CAP, DEFAULT_QUESTIONS_DAILY_CAP: DEFAULT_QUESTIONS_DAILY_CAP };
