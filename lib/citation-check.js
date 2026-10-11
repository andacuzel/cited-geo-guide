/* =====================================================================
   lib/citation-check.js: ask one question to an assistant and record what the answer cites and names.

   Reduces what a provider returned (lib/citation-providers.js runPrompt) to what the report keeps:

     analyze           live testing, with the provider's web search: cited (the site's domain is among the pages the answer cites, or for
                       Perplexity among the pages it returned), mentioned (the brand or the domain appears in the answer text, a plain
                       string match), the other domains (own domain left out, unique, alphabetical, at most 8, each with one https link),
                       how many searches the call made, the model, the date and the cost in micro-dollars.
     analyzeKnowledge  the model knowledge check, with NO search: only whether the brand or the domain appears in the answer text (named),
                       the model and the date. There is no "cited" at all.

   The answer text is read and then dropped. Nothing is fetched from an address a provider returns: a cited page is parsed for
   its host name only. Neither check says anything about rank or quality, and neither does the report that shows it.
   ===================================================================== */

'use strict';

const Profile = require('./site-profile.js');
const { CheckError } = require('./citation-errors.js');

const MAX_OTHERS = 8;
const MAX_LINK = 240;

const bare = (h) => String(h || '').toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
const HOSTNAME = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

// The host a cited page lives on, or null. Only a normal https or http address with a host name is accepted (no credentials, no port tricks).
function sourceDomain(src) {
  let u;
  try { u = new URL(String(src && src.uri)); } catch (e) { return null; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null;
  const h = bare(u.hostname);
  return HOSTNAME.test(h) ? h : null;
}

// One https link per cited domain for the report: the address without its query string or fragment, short enough to store.
function linkFor(src) {
  try {
    const u = new URL(String(src.uri));
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    const s = u.origin + u.pathname;
    return s.length <= MAX_LINK && !/[\s<>"']/.test(s) ? s : null;
  } catch (e) { return null; }
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

const today = () => new Date().toISOString().slice(0, 10);

/* ---------------- one provider answer, reduced to what the report keeps ---------------- */

// res: what a provider's runPrompt returned without an error: { answerText, citations: [{ url, domain, title }], searches, modelId, costUsd, citationKind }.
// Kept: cited (the site's domain is among the cited or returned pages), mentioned (a plain string match of the brand or the domain in the answer
// text), the other domains (own domain left out, unique, alphabetical, at most 8, each with one https link), the number of searches, the model, the
// date and the cost. No answer text is kept.
function analyze(res, site) {
  const byHost = new Map();
  (res.citations || []).slice(0, 20).forEach(function (c) {
    const h = sourceDomain({ uri: c.url });
    if (h && !byHost.has(h)) byHost.set(h, linkFor({ uri: c.url }));
  });
  const hosts = Array.from(byHost.keys());
  const others = hosts.filter(function (h) { return !sameSite(h, site.domain); }).sort().slice(0, MAX_OTHERS);
  const links = {};
  others.forEach(function (h) { if (byHost.get(h)) links[h] = byHost.get(h); });
  return {
    state: 'tested',
    cited: hosts.some(function (h) { return sameSite(h, site.domain); }),
    mentioned: mentions(res.answerText, site.brand, site.domain),
    others: others,
    links: links,
    queries: Math.max(0, res.searches || 0),
    kind: res.citationKind === 'returned' ? 'returned' : 'cited',
    model: res.modelId,
    date: today(),
    micro: Math.max(0, Math.round((res.costUsd || 0) * 1e6))
  };
}

// The model knowledge check keeps only whether the brand or the domain is in the answer text (no search, no cited).
function analyzeKnowledge(res, site) {
  return { state: 'tested', named: mentions(res.answerText, site.brand, site.domain), model: res.modelId, date: today(), micro: Math.max(0, Math.round((res.costUsd || 0) * 1e6)) };
}

module.exports = { analyze: analyze, analyzeKnowledge: analyzeKnowledge, sourceDomain: sourceDomain, linkFor: linkFor, mentions: mentions, sameSite: sameSite, CheckError: CheckError, MAX_OTHERS: MAX_OTHERS };
