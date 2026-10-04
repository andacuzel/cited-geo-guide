/* =====================================================================
   lib/citation/providers/gemini.js: Gemini through the REST generateContent
   endpoint. The request, pacing and retry logic is the runner's own, moved
   here unchanged; ask() wraps it in the provider interface.

   Provider interface (lib/citation/providers/index.js):
     name                           'gemini'
     configured()                   true when the key is available
     ask(question, options)         -> { text, sources, model, usage, response, body, latencyMs, attempts }
        options: { key, model, grounded, pacer }
        text     the answer text
        sources  [{ title, uri }] the sources the provider reports (grounded only)
        usage    { inputTokens, outputTokens, searchQueries } (null where unknown)
   ===================================================================== */
'use strict';

const { sleep, log, Stop, NotConfigured, parseRetryDelay } = require('../common');

const API_BASE = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';
const MAX_ATTEMPTS = 8;
const MAX_WAIT_MS = 180000;         // a longer Retry-After than this stops the job (resumable)

function answerText(response) {
  const cand = response && response.candidates && response.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  return parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
}

async function callGemini(prompt, cfg, pacer) {
  const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }] };
  if (cfg.grounded) body.tools = [{ google_search: {} }];
  const url = `${API_BASE}/models/${encodeURIComponent(cfg.model)}:generateContent`;

  let lastErr = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await pacer.wait();
    const t0 = Date.now();
    let res, json;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      json = await res.json().catch(() => null);
    } catch (e) {
      lastErr = 'network: ' + e.message;
      log(`  ${lastErr}; retry ${attempt}/${MAX_ATTEMPTS}`);
      await sleep(Math.min(30000, 2000 * 2 ** attempt));
      continue;
    }

    if (res.ok) {
      if (!answerText(json).trim()) {
        const why = (json && json.promptFeedback && json.promptFeedback.blockReason) ||
          (json && json.candidates && json.candidates[0] && json.candidates[0].finishReason) || 'empty';
        lastErr = 'empty answer (' + why + ')';
        log(`  ${lastErr}; retry ${attempt}/${MAX_ATTEMPTS}`);
        continue;
      }
      pacer.ok();
      return { body, response: json, latencyMs: Date.now() - t0, attempts: attempt };
    }

    const msg = (json && json.error && json.error.message) || `HTTP ${res.status}`;
    if (res.status === 429) {
      const info = parseRetryDelay(json, res.headers);
      pacer.limited(info.ms, info.quotaId);
      if (cfg.grounded && info.ms === null && !info.quotaId) {
        throw new Stop('Grounded call rejected with a quota error and no retry hint. Google Search grounding is not available on this project, which is what a free-tier project returns. Enable billing on the Google Cloud project (with a spend cap), or run without --grounded.');
      }
      if (info.perDay) throw new Stop('Daily quota reached (' + (info.quotaId || msg) + '). Re-run with the same --date to resume.');
      const wait = Math.max(info.ms || 0, pacer.delay);
      if (wait > MAX_WAIT_MS) throw new Stop(`Rate limit asks for a ${Math.round(wait / 1000)}s wait. Stopping; re-run with the same --date to resume.`);
      log(`  429, waiting ${(wait / 1000).toFixed(1)}s; delay now ${(pacer.delay / 1000).toFixed(1)}s (attempt ${attempt}/${MAX_ATTEMPTS})`);
      lastErr = '429 ' + msg;
      await sleep(wait + Math.floor(Math.random() * 500));
      continue;
    }
    if (res.status >= 500) {
      lastErr = `HTTP ${res.status} ${msg}`;
      log(`  ${lastErr}; retry ${attempt}/${MAX_ATTEMPTS}`);
      await sleep(Math.min(30000, 2000 * 2 ** attempt));
      continue;
    }
    // 400, 401, 403, 404: the request itself is wrong. Never loop on these.
    throw new Stop(`HTTP ${res.status}: ${msg}`);
  }
  const e = new Error('gave up after ' + MAX_ATTEMPTS + ' attempts: ' + lastErr);
  e.giveUp = true;
  throw e;
}


function configured() { return !!process.env.GEMINI_API_KEY; }

async function ask(question, options) {
  options = options || {};
  if (!options.key) throw new NotConfigured('gemini', 'GEMINI_API_KEY');
  const r = await callGemini(question, options, options.pacer);
  const cand = r.response && r.response.candidates && r.response.candidates[0];
  const gm = cand && cand.groundingMetadata;
  const um = (r.response && r.response.usageMetadata) || {};
  return {
    text: answerText(r.response),
    sources: ((gm && gm.groundingChunks) || []).filter((c) => c && c.web).map((c) => ({ title: c.web.title || null, uri: c.web.uri || null })),
    model: options.model,
    usage: { inputTokens: um.promptTokenCount === undefined ? null : um.promptTokenCount, outputTokens: um.candidatesTokenCount === undefined ? null : um.candidatesTokenCount, searchQueries: gm && Array.isArray(gm.webSearchQueries) ? gm.webSearchQueries.length : 0 },
    response: r.response,
    body: r.body,
    latencyMs: r.latencyMs,
    attempts: r.attempts
  };
}

module.exports = { name: 'gemini', configured, ask, callGemini, answerText, API_BASE };
