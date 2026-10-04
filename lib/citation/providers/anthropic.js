/* =====================================================================
   lib/citation/providers/anthropic.js: Anthropic messages API, as a provider.

   Reports "not configured" without making any request when ANTHROPIC_API_KEY
   (or options.key) is absent. Not yet run against a live key.
   ===================================================================== */
'use strict';
const { NotConfigured } = require('../common');

const ENV = 'ANTHROPIC_API_KEY';
const BASE = process.env.ANTHROPIC_API_BASE || 'https://api.anthropic.com/v1';

function configured() { return !!process.env[ENV]; }

async function ask(question, options) {
  options = options || {};
  const key = options.key || process.env[ENV];
  if (!key) throw new NotConfigured('anthropic', ENV);
  const model = options.model || process.env.ANTHROPIC_MODEL;
  if (!model) throw new Error('anthropic: no model given (options.model or ANTHROPIC_MODEL)');
  const t0 = Date.now();
  const res = await fetch(BASE + '/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: model, max_tokens: 1500, messages: [{ role: 'user', content: question }] }),
    signal: AbortSignal.timeout(120000)
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error('anthropic: HTTP ' + res.status + ' ' + ((json && json.error && json.error.message) || ''));
  const text = ((json && json.content) || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('');
  const u = (json && json.usage) || {};
  return { text: text, sources: [], model: (json && json.model) || model, usage: { inputTokens: u.input_tokens === undefined ? null : u.input_tokens, outputTokens: u.output_tokens === undefined ? null : u.output_tokens, searchQueries: 0 }, response: json, latencyMs: Date.now() - t0, attempts: 1 };
}

module.exports = { name: 'anthropic', envVar: ENV, configured, ask };
