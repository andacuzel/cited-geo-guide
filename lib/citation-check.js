/* =====================================================================
   lib/citation-check.js: ask one question to an assistant and record what the answer cites and names.

   A provider has name, model and ask(question, { search }) -> { text, sources: [{ uri, title }], queries, searches }
   (lib/citation-anthropic.js is the one adapter; tests pass their own). Two checks use it:

     checkQuestion     live testing, with the provider's web search: cited (the site's domain is among the pages the answer
                       cites), mentioned (the brand or the domain appears in the answer text), the other cited domains (own
                       domain left out, unique, alphabetical, at most 8, each with one https link to the cited page), how many
                       searches the call made, the model and the date.
     knowledgeQuestion the model knowledge check, with NO search: only whether the brand or the domain appears in the answer
                       text (named), the model and the date. No answer text is kept and there is no "cited" at all.

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

/* ---------------- live testing: one question, with search ---------------- */

// deps: { provider }. Returns the stored result; throws CheckError for quota, timeout, no search, etc.
async function checkQuestion(question, site, deps) {
  const r = await deps.provider.ask(question, { search: true });
  const byHost = new Map();
  (r.sources || []).slice(0, 20).forEach(function (s) {
    const h = sourceDomain(s);
    if (h && !byHost.has(h)) byHost.set(h, linkFor(s));
  });
  const hosts = Array.from(byHost.keys());
  const cited = hosts.some(function (h) { return sameSite(h, site.domain); });
  const others = hosts.filter(function (h) { return !sameSite(h, site.domain); }).sort().slice(0, MAX_OTHERS);
  const links = {};
  others.forEach(function (h) { if (byHost.get(h)) links[h] = byHost.get(h); });
  return {
    state: 'tested',
    cited: cited,
    mentioned: mentions(r.text, site.brand, site.domain),
    others: others,
    links: links,
    queries: Math.max(0, r.searches || (r.queries || []).length),
    model: deps.provider.model,
    date: today()
  };
}

/* ---------------- the model knowledge check: one question, no search ---------------- */

async function knowledgeQuestion(question, site, deps) {
  const r = await deps.provider.ask(question, { search: false });
  return { state: 'tested', named: mentions(r.text, site.brand, site.domain), model: deps.provider.model, date: today() };
}

module.exports = { checkQuestion: checkQuestion, knowledgeQuestion: knowledgeQuestion, sourceDomain: sourceDomain, linkFor: linkFor, mentions: mentions, sameSite: sameSite, CheckError: CheckError, MAX_OTHERS: MAX_OTHERS };
