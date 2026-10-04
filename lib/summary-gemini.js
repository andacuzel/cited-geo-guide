/* =====================================================================
   lib/summary-gemini.js — the Gemini adapter for lib/summary.js (Node only).

   ask(prompt, { model }) returns the model's text, asking for a JSON reply at
   low temperature. The key is GEMINI_API_KEY from the environment or the
   gitignored .env.local; it goes in a header, is never logged and is never in
   a URL. Default model: gemini-3.5-flash-lite.

   Without a key, hasKey() is false and ask() throws before any request.
   GEMINI_API_BASE overrides the endpoint (tests point it at a mock).
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const ROOT = path.resolve(__dirname, '..');

function loadEnvLocal() {
  if (process.env.GEMINI_API_KEY) return;
  try {
    fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n').forEach(function (line) {
      const m = /^\s*GEMINI_API_KEY\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !process.env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = m[1].replace(/^["']|["']$/g, '');
    });
  } catch (e) { /* no .env.local */ }
}

function hasKey(opts) {
  if (!(opts && opts.noEnvFile)) loadEnvLocal();
  return !!process.env.GEMINI_API_KEY;
}

// onCall(info) is told about every request (model, ok, status), never the key or the prompt.
function makeAsk(opts) {
  opts = opts || {};
  return async function ask(prompt, o) {
    if (!hasKey(opts)) throw new Error('GEMINI_API_KEY is not set');
    const base = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';
    const model = (o && o.model) || DEFAULT_MODEL;
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, opts.timeoutMs || 20000);
    let status = 0;
    try {
      const res = await fetch(base + '/models/' + encodeURIComponent(model) + ':generateContent', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 1500 }
        })
      });
      status = res.status;
      if (!res.ok) throw new Error('Gemini answered HTTP ' + res.status);
      const body = await res.json();
      const text = body && body.candidates && body.candidates[0] && body.candidates[0].content && body.candidates[0].content.parts &&
        body.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('');
      if (!text) throw new Error('Gemini returned no text');
      if (opts.onCall) opts.onCall({ model: model, ok: true, status: status });
      return text;
    } catch (e) {
      if (opts.onCall) opts.onCall({ model: model, ok: false, status: status, error: e && e.message });
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = { makeAsk: makeAsk, hasKey: hasKey, DEFAULT_MODEL: DEFAULT_MODEL };
