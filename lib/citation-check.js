/* =====================================================================
   lib/citation-check.js: ask one question to an assistant that uses live web search, and record what the answer
   cites and mentions.

   A provider has name, model and ask(question) -> { text, sources: [{ uri, title }], queries: [string] }.
   The first adapter is Gemini through generateContent with the Google Search tool (tools: [{ google_search: {} }]).
   Fields read from the response, per Google's API reference (ai.google.dev/api/generate-content, checked
   10 Oct 2026): candidates[0].content.parts[].text; candidates[0].groundingMetadata.groundingChunks[].web.uri and
   .title; groundingMetadata.webSearchQueries. The reference does not say whether a chunk's uri is a direct
   address or a redirect, so both are handled (see sourceDomain). Grounding is billed per search query beyond
   5,000 free a month on Gemini 3 and newer models, and is not available on a free-tier key: that answers HTTP 429,
   which is reported as kind "quota" and is never retried.

   For every question the check stores: the answer (truncated), cited (the site's domain is among the sources),
   mentioned (the brand or the domain appears in the answer text), the other cited domains (own domain left out,
   unique, alphabetical, at most 8), how many search queries the call used, the model and the date. It says
   nothing about rank or quality, and neither does the report that shows it.
   ===================================================================== */

'use strict';

const Profile = require('./site-profile.js');

const ANSWER_CHARS = 700;
const MAX_OTHERS = 8;
const REDIRECT_HOSTS = ['vertexaisearch.cloud.google.com'];
const HOSTNAME = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

class CheckError extends Error {
  constructor(kind, message, status) { super(message || kind); this.name = 'CheckError'; this.kind = kind; this.status = status || null; }
}

/* ---------------- the Gemini adapter ---------------- */

// opts: { apiKey, model, fetch, timeoutMs, base }
function geminiProvider(opts) {
  opts = opts || {};
  const model = opts.model || 'gemini-3.5-flash-lite';
  return {
    name: 'gemini', model: model, grounded: true,
    async ask(question) {
      if (!opts.apiKey) throw new CheckError('provider', 'No API key.');
      const base = opts.base || process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';
      let res, j;
      try {
        res = await (opts.fetch || fetch)(base + '/models/' + encodeURIComponent(model) + ':generateContent', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: question }] }], tools: [{ google_search: {} }] }),
          signal: AbortSignal.timeout(opts.timeoutMs || 16000)
        });
        j = await res.json().catch(function () { return null; });
      } catch (e) {
        if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new CheckError('timeout', 'The assistant did not answer in time.');
        throw new CheckError('provider', 'The assistant could not be reached.');
      }
      if (res.status === 429 || (j && j.error && j.error.status === 'RESOURCE_EXHAUSTED')) throw new CheckError('quota', 'Quota reached or search grounding not available.', res.status);
      if (!res.ok) throw new CheckError('provider', 'HTTP ' + res.status, res.status);
      const cand = j && j.candidates && j.candidates[0];
      const text = cand && cand.content && cand.content.parts ? cand.content.parts.filter(function (p) { return typeof p.text === 'string' && !p.thought; }).map(function (p) { return p.text; }).join('') : '';
      if (!text.trim()) throw new CheckError('empty', 'Empty answer.', res.status);
      const gm = (cand && cand.groundingMetadata) || {};
      return {
        text: text,
        sources: (gm.groundingChunks || []).filter(function (c) { return c && c.web; }).map(function (c) { return { uri: c.web.uri || '', title: c.web.title || '' }; }),
        queries: Array.isArray(gm.webSearchQueries) ? gm.webSearchQueries.filter(function (q) { return typeof q === 'string'; }) : []
      };
    }
  };
}

/* ---------------- domains ---------------- */

const bare = (h) => String(h || '').toLowerCase().replace(/\.$/, '').replace(/^www\./, '');

// The site a grounding source points at. A direct address gives its host. A redirect address (the grounding service's
// own host) is resolved from the chunk title when that is a host name, or else by reading the redirect's Location header
// with the shared safe fetch and never following it. Returns a host, or null.
async function sourceDomain(src, resolve) {
  let host = null;
  try { host = new URL(src.uri).hostname; } catch (e) { /* no usable address */ }
  if (host && REDIRECT_HOSTS.indexOf(host.toLowerCase()) === -1) return bare(host);
  const t = String(src.title || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (HOSTNAME.test(t)) return bare(t);
  if (host && resolve) {
    try { const r = await resolve(src.uri); if (r) { let h = r; try { h = new URL(r).hostname; } catch (e) { /* already a host */ } return bare(h); } } catch (e) { /* leave it out */ }
  }
  return null;
}

// Reads where a redirect leads without fetching the target: safeGet with no redirects allowed reports the next address.
function makeResolver(safeGet, ua) {
  return async function (uri) {
    const r = await safeGet(uri, { ua: ua, timeoutMs: 5000, maxBytes: 4096, maxRedirects: 0 });
    const next = r && (r.finalUrl || '');
    if (!next || next === uri) return null;
    try { const h = new URL(next).hostname; return REDIRECT_HOSTS.indexOf(h.toLowerCase()) === -1 ? h : null; } catch (e) { return null; }
  };
}

const sameSite = (host, domain) => host === bare(domain) || host.endsWith('.' + bare(domain));

/* ---------------- brand and domain in the answer ---------------- */

function mentions(text, brand, domain) {
  const folded = Profile.fold(text);
  const d = bare(domain).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (d && new RegExp('(^|[^a-z0-9])(www\\.)?' + d + '($|[^a-z0-9-])').test(folded)) return true;
  const b = Profile.fold(brand).replace(/[^a-z0-9]+/g, ' ').trim();
  if (b.length < 3) return false;
  return (' ' + folded.replace(/[^a-z0-9]+/g, ' ') + ' ').indexOf(' ' + b + ' ') !== -1;
}

/* ---------------- one question ---------------- */

// deps: { provider, resolve? }. Returns the stored result for the question; throws CheckError for quota, timeout, etc.
async function checkQuestion(question, site, deps) {
  const r = await deps.provider.ask(question);
  const hosts = [];
  for (let i = 0; i < r.sources.length && i < 20; i++) {
    const h = await sourceDomain(r.sources[i], deps.resolve);
    if (h) hosts.push(h);
  }
  const cited = hosts.some(function (h) { return sameSite(h, site.domain); });
  const others = Array.from(new Set(hosts.filter(function (h) { return !sameSite(h, site.domain) && REDIRECT_HOSTS.indexOf(h) === -1; }))).sort().slice(0, MAX_OTHERS);
  return {
    state: 'tested',
    answer: String(r.text).replace(/\s+/g, ' ').trim().slice(0, ANSWER_CHARS),
    cited: cited,
    mentioned: mentions(r.text, site.brand, site.domain),
    others: others,
    queries: r.queries.length,
    model: deps.provider.model,
    date: new Date().toISOString().slice(0, 10)
  };
}

module.exports = { geminiProvider: geminiProvider, checkQuestion: checkQuestion, sourceDomain: sourceDomain, makeResolver: makeResolver, mentions: mentions, sameSite: sameSite, CheckError: CheckError, ANSWER_CHARS: ANSWER_CHARS, MAX_OTHERS: MAX_OTHERS, REDIRECT_HOSTS: REDIRECT_HOSTS };
