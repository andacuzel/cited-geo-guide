/* =====================================================================
   lib/citation-config.js: which parts of the Pro citation feature are switched on, read from the environment.

   Three independent switches, all OFF unless set to exactly "1":

     CITATION_QUESTIONS_ENABLED=1   profile + question writing only (Gemini JSON, no search, no analysis of any result).
                                    Needs GEMINI_API_KEY. This is the only part meant to run in production for now.
     CITATION_TEST_ENABLED=1        live testing of the questions with a provider's web search tool. Needs the questions
                                    switch, CITATION_TEST_PROVIDER and that provider's key.
     CITATION_KNOWLEDGE_ENABLED=1   the "model knowledge check": the same questions sent to the provider's plain chat API
                                    with no search tool. Same requirements as testing.

   CITATION_TEST_PROVIDER names the provider for both of the last two (today: "anthropic"). There is no switch for Google Search
   grounding and no code that sends it: Google's terms for grounded results do not permit what the check would do with them (see
   docs/citation-check.md). The old CITATION_ENABLED variable is not read any more; setting it changes nothing.
   ===================================================================== */

'use strict';

const PROVIDERS = {
  anthropic: { keyEnv: 'ANTHROPIC_API_KEY', defaultModel: 'claude-haiku-5-5', modelEnv: 'CITATION_TEST_MODEL' }
};

const on = (env, name) => (env || process.env)[name] === '1';

// The model name is passed to a URL path or request body: letters, digits, dot, dash, underscore only.
function modelFor(name, env) {
  const p = PROVIDERS[name];
  if (!p) return null;
  const m = String((env || process.env)[p.modelEnv] || p.defaultModel).replace(/[^A-Za-z0-9._-]/g, '');
  return m || p.defaultModel;
}

function providerName(env) {
  const n = String((env || process.env).CITATION_TEST_PROVIDER || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PROVIDERS, n) ? n : null;
}

// { questions, test, knowledge, provider, model }. test and knowledge are only true when the questions switch is on, a known provider is named
// and its key is present, so a half-configured deployment simply does less.
function flags(env) {
  env = env || process.env;
  const questions = on(env, 'CITATION_QUESTIONS_ENABLED') && !!env.GEMINI_API_KEY;
  const provider = providerName(env);
  const providerReady = !!(provider && env[PROVIDERS[provider].keyEnv]);
  return {
    questions: questions,
    test: questions && providerReady && on(env, 'CITATION_TEST_ENABLED'),
    knowledge: questions && providerReady && on(env, 'CITATION_KNOWLEDGE_ENABLED'),
    provider: providerReady ? provider : null,
    model: providerReady ? modelFor(provider, env) : null
  };
}

module.exports = { flags: flags, providerName: providerName, modelFor: modelFor, PROVIDERS: PROVIDERS };
