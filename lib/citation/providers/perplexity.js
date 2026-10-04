/* =====================================================================
   lib/citation/providers/perplexity.js: Perplexity chat completions, as a
   provider. Its answers carry the pages they drew on (`citations`), returned
   as sources.

   Reports "not configured" without making any request when PERPLEXITY_API_KEY
   (or options.key) is absent. Not yet run against a live key.
   ===================================================================== */
'use strict';
const { NotConfigured } = require('../common');

const ENV = 'PERPLEXITY_API_KEY';
const BASE = process.env.PERPLEXITY_API_BASE || 'https://api.perplexity.ai';

function configured() { return !!process.env[ENV]; }

async function ask(question, options) {
  options = options || {};
  const key = options.key || process.env[ENV];
  if (!key) throw new NotConfigured('perplexity', ENV);
  const model = options.model || process.env.PERPLEXITY_MODEL || 'sonar';
  const t0 = Date.now();
  const res = await fetch(BASE + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: model, messages: [{ role: 'user', content: question }] }),
    signal: AbortSignal.timeout(120000)
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error('perplexity: HTTP ' + res.status + ' ' + ((json && json.error && json.error.message) || ''));
  const text = (json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';
  const u = (json && json.usage) || {};
  const sources = ((json && json.citations) || []).map((c) => (typeof c === 'string' ? { title: null, uri: c } : { title: c.title || null, uri: c.url || null }));
  return { text: text, sources: sources, model: (json && json.model) || model, usage: { inputTokens: u.prompt_tokens === undefined ? null : u.prompt_tokens, outputTokens: u.completion_tokens === undefined ? null : u.completion_tokens, searchQueries: null }, response: json, latencyMs: Date.now() - t0, attempts: 1 };
}

module.exports = { name: 'perplexity', envVar: ENV, configured, ask };
