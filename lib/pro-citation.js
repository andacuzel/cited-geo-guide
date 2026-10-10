/* =====================================================================
   lib/pro-citation.js: the Pro citation check, one small step at a time, inside the crawl's own steps.

   After the pages are read (and only when at least one was), a job goes through three more phases, each driven
   by the same browser-made step calls and the same per-job lock as the crawl, so it is idempotent and resumable:

     profile    read the homepage and up to four key pages again (politely), ask the model what the site is
                (lib/site-profile.js). One step.
     questions  write 18 + 3 questions in the site's language (lib/citation-prompts.js). One model call per step,
                at most two (the second asks for what the first left short).
     cite       ask the questions to an assistant with live web search (lib/citation-check.js), about three per step.
                Every answer is stored before the next call, so a closed tab loses nothing.

   Controls, enforced here: at most 21 questions and so 21 calls per job; a global daily cap (CITATION_DAILY_CAP,
   default 60 calls a day) and a monthly cap on search queries (CITATION_MONTHLY_QUERY_CAP, default 4000, under
   Google's 5,000 free a month for Gemini 3 and newer); calls one after another with a short pause and a timeout of
   their own; a quota answer (HTTP 429) ends the check at once and marks every question not yet asked "not tested",
   with no retry. Three failed calls in a row end it the same way. The check never fails the report: whatever
   happens, the crawl's results stand and the report says what was and was not tested. If the questions were
   written but could not be tested, the report still lists them to copy, marked "not tested".
   ===================================================================== */

'use strict';

const Profile = require('./site-profile.js');
const Prompts = require('./citation-prompts.js');
const Check = require('./citation-check.js');
const LlmGemini = require('./llm-gemini.js');
const Stats = require('./pro-stats.js');
const scannerLib = require('./scanner.js');
const F = require('./safe-fetch.js');

const MAX_CALLS = 21;
const PER_STEP = 3;
const CALL_DELAY_MS = 700;
const START_BUDGET_MS = 24000;      // do not start a call later than this into a step (the step allows ~42 s, a call up to 16 s)
const MAX_FAIL_STREAK = 3;
const DEFAULT_DAILY_CAP = 60;
const DEFAULT_MONTHLY_QUERY_CAP = 4000;
const PHASES = ['profile', 'questions', 'cite'];

const REASONS = {
  quota: 'The assistant’s search service reached its limit, or is not available for this project, so the remaining questions were not tested.',
  daily_cap: 'Citehound’s daily limit for citation checks was reached, so the remaining questions were not tested.',
  monthly_cap: 'Citehound’s monthly limit for search queries was reached, so the remaining questions were not tested.',
  provider: 'The assistant could not be reached, so the remaining questions were not tested.',
  timeout: 'The assistant did not answer in time, so the remaining questions were not tested.',
  empty: 'The assistant returned no answer, so the remaining questions were not tested.',
  ai_unavailable: 'The language model was not available, so no citation questions could be written.',
  no_homepage: 'The homepage could not be read a second time, so the site could not be profiled and no questions were written.',
  bad_profile: 'The site could not be read reliably enough to write questions about it, so none were written.',
  few_questions: 'Too few valid questions could be written, so none were tested.',
  disabled: 'The citation check is not switched on.'
};

const num = (v, d) => { const n = parseInt(v, 10); return n >= 0 ? n : d; };
const caps = (env) => ({ daily: num((env || process.env).CITATION_DAILY_CAP, DEFAULT_DAILY_CAP), monthly: num((env || process.env).CITATION_MONTHLY_QUERY_CAP, DEFAULT_MONTHLY_QUERY_CAP) });

// The check is OFF unless it is switched on on purpose: a Gemini key AND CITATION_ENABLED=1. Google's terms for Grounding
// with Google Search restrict what may be done with grounded results (see docs/citation-check.md, "Terms"), and the free
// tier cannot ground at all, so a key alone never starts it.
function enabled(env) { env = env || process.env; return !!env.GEMINI_API_KEY && env.CITATION_ENABLED === '1'; }

// The real model and provider for this process; tests pass their own through deps.citation.
function defaultsFrom(env) {
  env = env || process.env;
  const model = LlmGemini.modelName(env);
  return { llm: LlmGemini.makeJsonLlm({ apiKey: env.GEMINI_API_KEY, model: model }), provider: Check.geminiProvider({ apiKey: env.GEMINI_API_KEY, model: model }), resolve: Check.makeResolver(F.safeGet, scannerLib.CRAWLER_UA), sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); } };
}

function viewOf(job) {
  const c = job.citation;
  if (!c) return null;
  const total = c.questions && c.questions.items ? c.questions.items.length : 0;
  const tested = Object.keys(c.results).filter(function (k) { return c.results[k] && c.results[k].state === 'tested'; }).length;
  const asked = Object.keys(c.results).length;
  return { status: c.status, stage: c.stage, language: c.profile ? c.profile.language : null, total: total || Prompts.N_OPEN + Prompts.N_BRAND, asked: asked, tested: tested };
}

async function end(store, job, status, reason, extra) {
  await store.setCitation(job.id, Object.assign({ status: status, stage: 'done', reason: reason || '' }, extra || {}));
  await Stats.count(store, status === 'ok' ? 'citation_complete' : (status === 'partial' ? 'citation_partial' : 'citation_not_tested'));
  return { finished: true };
}

/* ---------------- phases ---------------- */

async function begin(store, job) {
  await store.setCitation(job.id, { status: 'running', stage: 'profile' });
  await store.setJob(job.id, { phase: 'profile' });
  await Stats.count(store, 'citation_runs');
}

async function doProfile(store, job, c) {
  const origin = new URL(job.pages[0].url).origin;
  const r = await Profile.buildProfile(job, origin, { get: c.get, llm: c.deps.llm });
  if (!r.ok) return end(store, job, 'not_tested', REASONS[r.reason] || REASONS.bad_profile);
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
  if (v.open.length < Prompts.MIN_OPEN || !v.brand.length) return end(store, job, 'not_tested', REASONS.few_questions);
  const fin = Prompts.finalize(v, source || 'llm');
  await store.setCitation(job.id, { questions: fin, source: fin.source, stage: 'cite', status: 'running', qdraft: '' });
  await store.setJob(job.id, { phase: 'cite' });
  return { finished: false };
}

async function stopCite(store, job, items, results, code) {
  for (let i = 0; i < items.length; i++) if (!results[i]) await store.setCitationResult(job.id, i, { state: 'not_tested', reason: code });
  const tested = Object.keys(results).filter(function (k) { return results[k].state === 'tested'; }).length;
  return end(store, job, tested ? 'partial' : 'not_tested', REASONS[code] || REASONS.provider);
}

async function doCite(store, job, c) {
  const A = store.adapter;
  const cit = job.citation, items = cit.questions.items;
  const results = Object.assign({}, cit.results);
  const site = { domain: job.domain, brand: cit.profile.brandName };
  const limits = caps(c.env);
  let streak = 0, done = 0, calls = cit.calls;
  for (let i = 0; i < items.length && done < PER_STEP; i++) {
    if (results[i]) continue;
    if (c.now() - c.started > START_BUDGET_MS) break;
    if (calls >= MAX_CALLS + 3) return stopCite(store, job, items, results, 'provider');
    const day = c.now() ? new Date(c.now()).toISOString().slice(0, 10) : '';
    const month = day.slice(0, 7);
    if (parseInt((await A.hget('pro:cit:months', month)) || '0', 10) >= limits.monthly) return stopCite(store, job, items, results, 'monthly_cap');
    const n = await A.incr('pro:cit:day:' + day);
    await A.expire('pro:cit:day:' + day, 2 * 86400);
    if (n > limits.daily) { await A.decr('pro:cit:day:' + day); return stopCite(store, job, items, results, 'daily_cap'); }
    if (done > 0) await c.deps.sleep(CALL_DELAY_MS);
    calls++; done++;
    await Stats.count(store, 'citation_calls');
    let res;
    try {
      res = await Check.checkQuestion(items[i].text, site, { provider: c.deps.provider, resolve: c.deps.resolve });
      streak = 0;
    } catch (e) {
      const kind = e && e.kind ? e.kind : 'provider';
      await store.setCitation(job.id, { calls: calls });
      if (kind === 'quota') return stopCite(store, job, items, results, 'quota');
      streak++;
      res = { state: 'not_tested', reason: kind };
      await store.setCitationResult(job.id, i, res); results[i] = res;
      if (streak >= MAX_FAIL_STREAK) return stopCite(store, job, items, results, kind === 'timeout' ? 'timeout' : 'provider');
      continue;
    }
    await store.setCitationResult(job.id, i, res); results[i] = res;
    await A.hincrby('pro:cit:months', month, Math.max(1, res.queries));
    await A.expire('pro:cit:months', 400 * 86400);
    await store.setCitation(job.id, { calls: calls, model: res.model, date: res.date });
  }
  if (items.every(function (_, i) { return results[i]; })) {
    const tested = items.filter(function (_, i) { return results[i].state === 'tested'; }).length;
    return end(store, job, tested === items.length ? 'ok' : (tested ? 'partial' : 'not_tested'), tested === items.length ? '' : REASONS.provider);
  }
  return { finished: false };
}

// One step of the citation phases. c: { get, now, started, env, deps }. Returns { finished }.
async function step(store, job, c) {
  c.deps = Object.assign(defaultsFrom(c.env), c.deps || {});
  try {
    if (job.phase === 'profile') return await doProfile(store, job, c);
    if (job.phase === 'questions') return await doQuestions(store, job, c);
    return await doCite(store, job, c);
  } catch (e) {
    console.error('[pro-citation] ' + job.phase + ' failed: ' + (e && e.name ? e.name : 'Error') + (e && e.kind ? ' ' + e.kind : ''));
    return end(store, job, 'not_tested', REASONS.provider);
  }
}

module.exports = { enabled: enabled, begin: begin, step: step, viewOf: viewOf, defaultsFrom: defaultsFrom, caps: caps, REASONS: REASONS, MAX_CALLS: MAX_CALLS, PER_STEP: PER_STEP, PHASES: PHASES, DEFAULT_DAILY_CAP: DEFAULT_DAILY_CAP, DEFAULT_MONTHLY_QUERY_CAP: DEFAULT_MONTHLY_QUERY_CAP };
