/* =====================================================================
   lib/llm-gemini.js: structured (JSON) answers from Gemini, for the Pro citation check's profile and questions.

   One request per call, no retry loop. The model is asked for JSON that matches a schema
   (generationConfig.responseMimeType "application/json" with responseJsonSchema, which the Gemini API accepts on
   generateContent: checked against the live API on 10 Oct 2026). A systemInstruction carries the rules; the
   user turn carries data. The key goes in a header and is never logged or put in a URL.

   Errors carry a kind: quota (HTTP 429 or RESOURCE_EXHAUSTED), timeout, provider (any other HTTP error), empty,
   bad_output (not JSON). A caller never retries a quota error.
   ===================================================================== */

'use strict';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

class LlmError extends Error {
  constructor(kind, message, status) { super(message || kind); this.name = 'LlmError'; this.kind = kind; this.status = status || null; }
}

function modelName(env) { return String((env || process.env).CITATION_MODEL || DEFAULT_MODEL).replace(/[^A-Za-z0-9._-]/g, ''); }

// opts: { apiKey, model, fetch, timeoutMs, base, onCall }
function makeJsonLlm(opts) {
  opts = opts || {};
  return {
    name: 'gemini',
    model: opts.model || DEFAULT_MODEL,
    async json(req) {
      if (!opts.apiKey) throw new LlmError('provider', 'No API key.');
      const doFetch = opts.fetch || fetch;
      const base = opts.base || process.env.GEMINI_API_BASE || BASE;
      const url = base + '/models/' + encodeURIComponent(this.model) + ':generateContent';
      const body = {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.user }] }],
        generationConfig: { temperature: req.temperature === undefined ? 0.3 : req.temperature, responseMimeType: 'application/json', responseJsonSchema: req.schema, maxOutputTokens: req.maxOutputTokens || 3000 }
      };
      let status = 0;
      try {
        const res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(opts.timeoutMs || 20000) });
        status = res.status;
        const j = await res.json().catch(function () { return null; });
        if (res.status === 429) throw new LlmError('quota', 'Quota reached.', 429);
        if (!res.ok) throw new LlmError(j && j.error && j.error.status === 'RESOURCE_EXHAUSTED' ? 'quota' : 'provider', 'HTTP ' + res.status, res.status);
        const cand = j && j.candidates && j.candidates[0];
        const text = cand && cand.content && cand.content.parts ? cand.content.parts.filter(function (p) { return typeof p.text === 'string' && !p.thought; }).map(function (p) { return p.text; }).join('') : '';
        if (!text.trim()) throw new LlmError('empty', 'Empty answer.', status);
        let parsed;
        try { parsed = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '')); } catch (e) { throw new LlmError('bad_output', 'The answer was not JSON.', status); }
        const um = (j && j.usageMetadata) || {};
        if (opts.onCall) opts.onCall({ model: this.model, ok: true, status: status, inputTokens: um.promptTokenCount || 0, outputTokens: um.candidatesTokenCount || 0 });
        return parsed;
      } catch (e) {
        if (opts.onCall) opts.onCall({ model: this.model, ok: false, status: status, kind: e && e.kind });
        if (e instanceof LlmError) throw e;
        if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new LlmError('timeout', 'The model did not answer in time.');
        throw new LlmError('provider', 'The model could not be reached.');
      }
    }
  };
}

module.exports = { makeJsonLlm: makeJsonLlm, LlmError: LlmError, DEFAULT_MODEL: DEFAULT_MODEL, modelName: modelName };
