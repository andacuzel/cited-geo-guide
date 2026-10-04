/* =====================================================================
   lib/citation/providers/openai.js: OpenAI chat completions, as a provider.

   Reports "not configured" without making any request when OPENAI_API_KEY (or
   options.key) is absent. With a key it posts one chat completion and returns
   the provider interface's shape. Not yet run against a live key.
   ===================================================================== */
'use strict';
const { NotConfigured } = require('../common');

const ENV = 'OPENAI_API_KEY';
const BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';

function configured() { return !!process.env[ENV]; }

async function ask(question, options) {
  options = options || {};
  const key = options.key || process.env[ENV];
  if (!key) throw new NotConfigured('openai', ENV);
  const model = options.model || process.env.OPENAI_MODEL;
  if (!model) throw new Error('openai: no model given (options.model or OPENAI_MODEL)');
  const t0 = Date.now();
  const res = await fetch(BASE + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: model, messages: [{ role: 'user', content: question }] }),
    signal: AbortSignal.timeout(120000)
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error('openai: HTTP ' + res.status + ' ' + ((json && json.error && json.error.message) || ''));
  const text = (json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';
  const u = (json && json.usage) || {};
  return { text: text, sources: [], model: (json && json.model) || model, usage: { inputTokens: u.prompt_tokens === undefined ? null : u.prompt_tokens, outputTokens: u.completion_tokens === undefined ? null : u.completion_tokens, searchQueries: 0 }, response: json, latencyMs: Date.now() - t0, attempts: 1 };
}

module.exports = { name: 'openai', envVar: ENV, configured, ask };
