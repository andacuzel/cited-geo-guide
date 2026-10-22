/* =====================================================================
   citehound-core.js: the one small client every Citehound integration (n8n, Make, Zapier, Pipedream, Activepieces, Raycast, Looker Studio, Sheets, ...) wraps.
   The source is integrations/shared/citehound-core.js. scripts/sync-integrations.js copies it into each integration folder (so each can be published alone) and
   scripts/test-integrations.js fails if a copy differs. Edit the source, never a copy.

   No dependencies. It needs a fetch function (the platform's, or Node 18's) and an API key. It talks only to https://getcitehound.com/v1 (or the base given, for tests).
   It never puts the key anywhere but the Authorization header and never includes it in an error.
   ===================================================================== */

'use strict';

const DEFAULT_BASE = 'https://getcitehound.com';
const PRICING = 'https://getcitehound.com/pricing';
const SIGNUP = 'https://getcitehound.com/api';

// operation: [method, path, query parameters, body fields]
const OPS = {
  me: ['GET', '/me'],
  scan: ['GET', '/scan', ['domain']],
  compare: ['GET', '/compare', ['a', 'b']],
  crawlers: ['GET', '/crawlers', ['domain']],
  benchmark: ['GET', '/benchmark', ['category']],
  schema: ['GET', '/generate/schema', ['domain', 'type']],
  llmsTxt: ['POST', '/generate/llms-txt', [], ['name', 'description', 'pages']],
  robotsTxt: ['POST', '/generate/robots-txt', [], ['allow', 'block', 'sitemap']],
  watchAdd: ['POST', '/watchlist', [], ['domain', 'alert_email', 'alerts']],
  watchList: ['GET', '/watchlist'],
  watchRemove: ['DELETE', '/watchlist', ['domain']],
  history: ['GET', '/history', ['domain', 'since', 'limit']],
  events: ['GET', '/events', ['since', 'domain', 'type', 'limit', 'cursor']],
  fixes: ['GET', '/fixes', ['domain']],
  recheck: ['POST', '/fixes/recheck', [], ['domain']],
  exportData: ['GET', '/export', ['domain', 'type', 'format']]
};

class CitehoundError extends Error {
  constructor(message, status, code, requiredPlan) { super(message); this.name = 'CitehoundError'; this.status = status || 0; this.code = code || 'error'; this.requiredPlan = requiredPlan || null; }
}

// A bare, lower-case domain from what a person typed (a URL, a www. name). null if it cannot be one.
function cleanDomain(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/^www\./, '').replace(/\.$/, '');
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$/.test(s) && s.length <= 253 ? s : null;
}

const redact = (s) => String(s).replace(/chk_[A-Za-z0-9_-]{6,}/g, 'chk_…');

function createCore(opts) {
  const key = String((opts && opts.apiKey) || '').trim();
  const base = String((opts && opts.baseUrl) || DEFAULT_BASE).replace(/\/+$/, '');
  const doFetch = (opts && opts.fetch) || globalThis.fetch;
  const ua = 'citehound-' + ((opts && opts.platform) || 'integration') + '/' + ((opts && opts.version) || '0.1.0');
  if (!key) throw new CitehoundError('Add your Citehound API key. A free one is sent by email at ' + SIGNUP + '.', 0, 'missing_key');
  if (!/^chk_[A-Za-z0-9_-]{20,}$/.test(key)) throw new CitehoundError('That does not look like a Citehound API key (it starts with chk_). Get one at ' + SIGNUP + '.', 0, 'bad_key');
  if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base)) throw new CitehoundError('The API address must use https.', 0, 'bad_base');

  function friendly(status, body, retry) {
    const msg = body && typeof body.message === 'string' ? redact(body.message) : '';
    if (status === 401) return new CitehoundError('Citehound did not accept that API key. Check it, or get a new one at ' + SIGNUP + '.', 401, 'invalid_key');
    if (status === 402) return new CitehoundError(msg || 'That is part of a higher plan. See the plans at ' + PRICING + '.', 402, 'plan_required', body && body.required_plan);
    if (status === 403) return new CitehoundError(msg || 'This key cannot do that.', 403, (body && body.error) || 'forbidden');
    if (status === 429) return new CitehoundError((msg || 'A limit was reached.') + (retry ? ' Try again in about ' + retry + ' seconds.' : ''), 429, 'rate_limited');
    if (status === 400 || status === 404 || status === 409) return new CitehoundError(msg || 'Citehound could not use that input.', status, (body && body.error) || 'invalid_request');
    if (status === 502) return new CitehoundError(msg || 'Citehound could not read that site.', 502, 'scan_failed');
    if (status === 503) return new CitehoundError('The Citehound API is not available right now. Try again later.', 503, 'not_configured');
    return new CitehoundError('Citehound answered with an error (HTTP ' + status + ').', status, 'error');
  }

  // run('scan', { domain: 'example.com' }) -> the parsed JSON answer ({ csv } for a CSV export). Throws CitehoundError.
  async function run(op, params) {
    const def = OPS[op];
    if (!def) throw new CitehoundError('Unknown operation ' + op + '.', 0, 'bad_operation');
    params = Object.assign({}, params || {});
    ['domain', 'a', 'b'].forEach((k) => { if (params[k] !== undefined && params[k] !== '') { const d = cleanDomain(params[k]); if (!d) throw new CitehoundError('"' + redact(String(params[k]).slice(0, 60)) + '" is not a domain. Use a domain such as example.com.', 0, 'invalid_domain'); params[k] = d; } });
    const qs = (def[2] || []).filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '').map((k) => [].concat(params[k]).map((v) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&')).join('&');
    let body;
    if (def[3]) { const o = {}; def[3].forEach((k) => { if (params[k] !== undefined && params[k] !== null && params[k] !== '') o[k] = params[k]; }); body = JSON.stringify(o); }
    let res;
    try {
      res = await doFetch(base + '/v1' + def[1] + (qs ? '?' + qs : ''), { method: def[0], headers: Object.assign({ Authorization: 'Bearer ' + key, Accept: 'application/json', 'User-Agent': ua }, body ? { 'Content-Type': 'application/json' } : {}), body: body });
    } catch (e) { throw new CitehoundError('Could not reach Citehound. Check the connection and try again.', 0, 'network'); }
    const text = await res.text();
    const status = res.status, retry = res.headers && res.headers.get ? res.headers.get('retry-after') : null;
    let json = null; try { json = JSON.parse(text); } catch (e) { /* csv or html */ }
    if (status < 200 || status >= 300) throw friendly(status, json, retry);
    if (json === null) { if (op === 'exportData') return { csv: text }; throw new CitehoundError('Citehound answered with something that is not JSON.', status, 'bad_response'); }
    return json;
  }

  // The new events since the last poll, oldest first, for a polling trigger. state is { lastId } and is returned updated.
  // The first poll only remembers the newest event (nothing old is sent as new), unless firstRun is 'latest' (a few of the newest, for a test).
  async function pollEvents(state, o) {
    o = o || {}; state = Object.assign({}, state || {});
    const base0 = { domain: o.domain, type: o.types && o.types.length ? o.types.join(',') : undefined, limit: 100 };
    if (!state.lastId) {
      const first = await run('events', Object.assign({}, base0, { limit: o.firstRun === 'latest' ? 5 : 1 }));
      const evs = first.events || [];
      if (evs.length) state.lastId = evs[0].id;
      return { events: o.firstRun === 'latest' ? evs.slice().reverse() : [], state: state };
    }
    let all = [], cursor;
    for (let page = 0; page < 5; page++) {
      const r = await run('events', Object.assign({}, base0, { since: state.lastId, cursor: cursor }));
      all = all.concat(r.events || []);
      if (!r.has_more || !r.next_cursor) break;
      cursor = r.next_cursor;
    }
    if (all.length) state.lastId = all[0].id;
    return { events: all.slice().reverse(), state: state };
  }

  return { run, pollEvents, base };
}

module.exports = { createCore, CitehoundError, cleanDomain, redact, OPS, PRICING, SIGNUP, DEFAULT_BASE };
