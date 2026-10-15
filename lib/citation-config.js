/* =====================================================================
   lib/citation-config.js: which parts of the Pro citation feature are switched on, read from the environment.

   Everything is OFF unless a flag is exactly "1" AND the key it needs is present:

     CITATION_QUESTIONS_ENABLED=1   profile + 18 + 3 questions in the site's language. They are written by Claude without search
                                    (needs ANTHROPIC_API_KEY and CITATION_ANTHROPIC_ENABLED=1). The Gemini writer is a disabled fallback:
                                    it runs only with CITATION_QUESTIONS_PROVIDER=gemini and GEMINI_API_KEY.
     CITATION_TEST_ENABLED=1        the live check: a deterministic sample of the questions (CITATION_QUESTION_SAMPLE, default 10),
                                    one run each, on every provider that is ready:
     CITATION_ANTHROPIC_ENABLED=1   Claude with its web search tool (key ANTHROPIC_API_KEY; model CITATION_MODEL, default claude-haiku-5-5)
     CITATION_OPENAI_ENABLED=1      ChatGPT through the OpenAI API: the Responses API with its web search tool (key OPENAI_API_KEY; model
                                    CITATION_OPENAI_MODEL, default gpt-4.1-mini). The cited pages are the url_citation annotations of the answer.
     CITATION_PERPLEXITY_ENABLED=1  Perplexity's search through its Agent API (key PERPLEXITY_API_KEY; model CITATION_PERPLEXITY_MODEL,
                                    default perplexity/sonar). Off unless you have read docs/citation-check.md, "Perplexity".
                                    Each engine is its own switch, off by default. There is no Gemini engine.
     CITATION_KNOWLEDGE_ENABLED=1   the "model knowledge check" (Claude, no search), same sample.

   Kill switch: CITATION_KILL=1 turns every paid call off at once (checked at the start of a report and before every paid call, with a
   second switch in Redis, `node scripts/pro-admin.js kill on`, that works without a redeploy: lib/citation-budget.js).

   Money: CITATION_MAX_CALLS and CITATION_MAX_COST_USD per report, CITATION_DAILY_BUDGET_USD and CITATION_MONTHLY_BUDGET_USD overall. With more
   than one engine on, the default per-report numbers grow with the engines (sample x engines + 10 calls, $0.25 an engine); an explicit value always wins.
   Each engine also has its own caps (engineLimits): CITATION_<ENGINE>_MAX_CALLS and CITATION_<ENGINE>_MAX_COST_USD per report and
   CITATION_<ENGINE>_DAILY_BUDGET_USD, with ENGINE = ANTHROPIC, OPENAI or PERPLEXITY. Hitting one stops that engine only; the overall caps and the kill
   switch stop them all.
   Every value is clamped to a hard ceiling, so a typo cannot lift a cap far. Removed and ignored now: CITATION_ENABLED,
   CITATION_TEST_PROVIDER, CITATION_DAILY_CAP, CITATION_MONTHLY_QUERY_CAP, CITATION_QUESTIONS_DAILY_CAP (docs/env.md).
   There is no Google Search grounding anywhere in the Pro code.
   ===================================================================== */

'use strict';

const PROVIDERS = {
  anthropic: { id: 'anthropic', label: 'Claude', keyEnv: 'ANTHROPIC_API_KEY', flagEnv: 'CITATION_ANTHROPIC_ENABLED', modelEnv: 'CITATION_MODEL', defaultModel: 'claude-haiku-5-5' },
  openai: { id: 'openai', label: 'ChatGPT', keyEnv: 'OPENAI_API_KEY', flagEnv: 'CITATION_OPENAI_ENABLED', modelEnv: 'CITATION_OPENAI_MODEL', defaultModel: 'gpt-4.1-mini' },
  perplexity: { id: 'perplexity', label: 'Perplexity', keyEnv: 'PERPLEXITY_API_KEY', flagEnv: 'CITATION_PERPLEXITY_ENABLED', modelEnv: 'CITATION_PERPLEXITY_MODEL', defaultModel: 'perplexity/sonar' }
};
const ORDER = ['anthropic', 'openai', 'perplexity'];

// Per-engine caps (engineLimits below) default to the overall caps, so setting nothing changes nothing; set them to hold one engine below the others.

const on = (env, name) => (env || process.env)[name] === '1';
const num = (v, d, lo, hi) => { const n = parseFloat(v); return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : d)); };

// The model name goes into a request body: letters, digits, dot, dash, underscore and one slash only.
function modelFor(id, env) {
  const p = PROVIDERS[id];
  if (!p) return null;
  const m = String((env || process.env)[p.modelEnv] || p.defaultModel).replace(/[^A-Za-z0-9._/-]/g, '');
  return m || p.defaultModel;
}

const ready = (id, env) => !!(PROVIDERS[id] && on(env, PROVIDERS[id].flagEnv) && (env || process.env)[PROVIDERS[id].keyEnv]);

// Limits with their defaults and hard ceilings. Without an engine switched on the defaults are the single-engine ones; with more engines on, the per-report
// defaults grow so the last engine is not cut short (the question writer's calls count too).
function limits(env) {
  env = env || process.env;
  const sample = Math.round(num(env.CITATION_QUESTION_SAMPLE, 10, 1, 18));
  const n = ORDER.filter((id) => ready(id, env)).length;
  return {
    sample: sample,
    maxCalls: Math.round(num(env.CITATION_MAX_CALLS, Math.max(30, sample * n + 10), 1, 60)),
    maxCostUsd: num(env.CITATION_MAX_COST_USD, Math.max(0.5, 0.25 * n), 0.01, 2),
    dailyUsd: num(env.CITATION_DAILY_BUDGET_USD, 2, 0, 50),
    monthlyUsd: num(env.CITATION_MONTHLY_BUDGET_USD, 4, 0, 200)
  };
}

// One engine's own caps, or null for something that is not an engine (the question writer, the knowledge check). Unset means the overall cap.
function engineLimits(id, env) {
  if (!PROVIDERS[id]) return null;
  env = env || process.env;
  const L = limits(env), P = 'CITATION_' + id.toUpperCase() + '_';
  return {
    maxCalls: Math.round(num(env[P + 'MAX_CALLS'], L.maxCalls, 1, 60)),
    maxCostUsd: num(env[P + 'MAX_COST_USD'], L.maxCostUsd, 0.01, 2),
    dailyUsd: num(env[P + 'DAILY_BUDGET_USD'], L.dailyUsd, 0, 50)
  };
}

// { questions, generator, test, knowledge, providers: ['anthropic', ...], models: { id: model }, kill, limits }.
function flags(env) {
  env = env || process.env;
  const kill = on(env, 'CITATION_KILL');
  const gemini = env.CITATION_QUESTIONS_PROVIDER === 'gemini' && !!env.GEMINI_API_KEY;
  const generator = kill || !on(env, 'CITATION_QUESTIONS_ENABLED') ? null : (gemini ? 'gemini' : (ready('anthropic', env) ? 'anthropic' : null));
  const providers = generator && !kill ? ORDER.filter((id) => ready(id, env)) : [];
  const models = {}; ORDER.forEach((id) => { models[id] = modelFor(id, env); });
  return {
    questions: !!generator,
    generator: generator,
    test: !!generator && on(env, 'CITATION_TEST_ENABLED') && providers.length > 0,
    knowledge: !!generator && on(env, 'CITATION_KNOWLEDGE_ENABLED') && providers.indexOf('anthropic') !== -1,
    providers: providers,
    models: models,
    kill: kill,
    limits: limits(env)
  };
}

module.exports = { flags: flags, limits: limits, engineLimits: engineLimits, modelFor: modelFor, PROVIDERS: PROVIDERS, ORDER: ORDER };
