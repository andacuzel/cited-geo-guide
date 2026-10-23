'use strict';

// The two ways the CLI reaches Citehound:
//   with CITEHOUND_API_KEY: the API (GET /v1/..., Bearer key), which has the limits of the key;
//   without a key: the public MCP endpoint (POST /api/mcp, no account), which has the public limits.
// Both give the same shapes back. Nothing here prints, logs or stores the key.

const { CliError, SIGNUP, NOTE, redact } = require('./util.js');
const parse = require('./parse.js');

const DEFAULT_BASE = 'https://getcitehound.com';
const PRICING = 'https://getcitehound.com/pricing';
const TIMEOUT_MS = 90000;
const RATE_TEXT = /rate limit|too many|limit (was )?reached|try again in|limited/i;

function createClient(env, fetchImpl, version) {
  const base = String(env.CITEHOUND_API_URL || DEFAULT_BASE).replace(/\/+$/, '');
  let host; try { host = new URL(base); } catch (e) { throw new CliError('CITEHOUND_API_URL is not a valid address.', 2); }
  const key = env.CITEHOUND_API_KEY ? String(env.CITEHOUND_API_KEY).trim() : '';
  if (key && !/^chk_[A-Za-z0-9_-]{20,}$/.test(key)) throw new CliError('CITEHOUND_API_KEY is set but does not look like a Citehound key (a key starts with chk_). Unset it to use the public endpoint, or get a free key at ' + SIGNUP + '.', 2);
  if (key && host.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host.hostname)) throw new CliError('A key is only sent over https.', 2);
  const keyed = !!key;
  const ua = 'citehound-cli/' + version;

  async function send(method, url, headers, body) {
    let res;
    try {
      res = await fetchImpl(url, { method: method, headers: Object.assign({ 'User-Agent': ua, Accept: 'application/json, text/event-stream' }, headers), body: body, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      const why = e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'it did not answer in time' : ((e && e.cause && e.cause.code) || 'network error');
      throw new CliError('Could not reach ' + host.host + ' (' + redact(why) + '). Check your connection and try again.', 3);
    }
    const text = await res.text();
    return { status: res.status, retry: res.headers && res.headers.get ? res.headers.get('retry-after') : null, text: text };
  }

  function rateLimited(retry) {
    const wait = retry && /^\d+$/.test(retry) ? ' Try again in about ' + retry + ' seconds.' : ' Try again in a little while.';
    return new CliError(keyed
      ? 'The limit of your API key was reached.' + wait + ' The limits of each plan are listed at ' + SIGNUP + ' and the plans at ' + PRICING + '.'
      : 'The public limit was reached.' + wait + ' An API key has limits of its own: get a free one at ' + SIGNUP + ' and set CITEHOUND_API_KEY. Paid plans have higher limits: ' + PRICING + '.', 3);
  }

  function httpError(r) {
    let j = null; try { j = JSON.parse(r.text); } catch (e) { /* not JSON */ }
    const msg = j && typeof j.message === 'string' ? redact(j.message) : null;
    if (r.status === 429) return rateLimited(r.retry);
    if (r.status === 401) return new CliError(keyed ? 'Citehound did not accept that API key. Check CITEHOUND_API_KEY, or get a new key at ' + SIGNUP + '.' : 'Citehound asked for an API key. Get a free one at ' + SIGNUP + ' and set CITEHOUND_API_KEY.', 3);
    if (r.status === 402) { const e = new CliError(msg || 'That is part of a higher plan. See the plans at ' + PRICING + '.', 3); e.plan = true; return e; }
    if (r.status === 403) return new CliError(msg || 'This key cannot do that.', 3);
    if (r.status === 503) return new CliError('The Citehound API is not available right now. Try again later.', 3);
    if (r.status === 400 && msg) return new CliError(msg, 2);
    if (msg) return new CliError(msg, 3);
    return new CliError('Citehound answered with an error (HTTP ' + r.status + '). Try again later.', 3);
  }

  // GET /v1/<path>?query with the key.
  async function v1(path, query) {
    const qs = Object.keys(query || {}).filter((k) => query[k] !== undefined && query[k] !== null && query[k] !== '').map((k) => [].concat(query[k]).map((v) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&')).join('&');
    const r = await send('GET', base + '/v1' + path + (qs ? '?' + qs : ''), { Authorization: 'Bearer ' + key });
    if (r.status < 200 || r.status >= 300) throw httpError(r);
    try { return JSON.parse(r.text); } catch (e) { throw new CliError('Citehound answered with something that is not JSON. Try again later.', 3); }
  }

  // One tool of the public MCP server. Returns its text.
  async function mcp(tool, args) {
    const r = await send('POST', base + '/api/mcp', { 'Content-Type': 'application/json' }, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args || {} } }));
    if (r.status === 429) throw rateLimited(r.retry);
    if (r.status < 200 || r.status >= 300) throw httpError(r);
    let body = r.text;
    const sse = /^data: (.*)$/m.exec(body);
    if (sse && !/^\s*\{/.test(body)) body = sse[1];
    let j; try { j = JSON.parse(body); } catch (e) { throw new CliError('Citehound answered with something that is not JSON. Try again later.', 3); }
    if (j.error) throw new CliError(redact(j.error.message || 'Citehound could not run that.'), 3);
    const res = j.result || {};
    const text = res.content && res.content[0] && typeof res.content[0].text === 'string' ? res.content[0].text : '';
    if (res.isError) {
      if (RATE_TEXT.test(text)) throw rateLimited(null);
      throw new CliError(redact(text.split('\n')[0] || 'Citehound could not do that.'), /Invalid or missing|must be|required|Unknown crawler|both/i.test(text) ? 2 : 3);
    }
    return text;
  }

  // A generated file from the API. A free key gets a preview: the text is the first lines, and the note says where the whole file is.
  const fileResult = (j) => ({ text: j.content.replace(/\s+$/, '') + '\n', note: j.preview && j.upgrade ? 'This is a preview (the first lines). ' + j.upgrade.message : null });

  const withSource = (o) => Object.assign({ source: keyed ? 'api_key' : 'public' }, o);

  return {
    keyed: keyed,
    // The plan of the key ('free', 'pro', 'fix', 'beyond'), or null when it cannot be read (no key, or the call failed). Used only to decide whether to print the one-line hint.
    async plan() {
      if (!keyed) return null;
      try { const j = await v1('/me'); return typeof j.plan === 'string' ? j.plan : null; } catch (e) { return null; }
    },
    // A key on a plan that has less than the public endpoint gives (the Free plan) must not make the CLI worse than no key: when the answer is limited by the plan, the full output comes from the public
    // endpoint and the plan's message is kept as a note (printed on standard error).
    async scan(domain) {
      if (!keyed) return withSource(parse.parseScan(await mcp('scan_site', { domain: domain })));
      const j = await v1('/scan', { domain: domain });
      if (j.truncated) return Object.assign({ source: 'public' }, parse.parseScan(await mcp('scan_site', { domain: domain })), { plan_note: (j.upgrade && j.upgrade.message) || null });
      return withSource(j);
    },
    async compare(a, b) {
      if (!keyed) return withSource(parse.parseCompare(await mcp('compare_sites', { domain_a: a, domain_b: b })));
      try { return withSource(await v1('/compare', { a: a, b: b })); }
      catch (e) { if (!e.plan) throw e; return Object.assign({ source: 'public' }, parse.parseCompare(await mcp('compare_sites', { domain_a: a, domain_b: b })), { plan_note: e.message }); }
    },
    async crawlerList() { return parse.parseCrawlerList(await mcp('list_ai_crawlers', {})); },
    async crawlersFor(domain) {
      if (keyed) { const j = await v1('/crawlers', { domain: domain }); return withSource({ domain: j.domain, crawlers: j.crawlers, summary: j.summary, note: j.note }); }
      const s = parse.parseScan(await mcp('scan_site', { domain: domain }));
      return withSource({ domain: s.domain, crawlers: s.crawlers, summary: s.crawlerSummary, note: NOTE });
    },
    async schema(domain, type) {
      if (keyed) { try { const j = await v1('/generate/schema', { domain: domain, type: type }); return { json_ld: j.json_ld }; } catch (e) { if (!e.plan) throw e; return { json_ld: parse.parseSchema(await mcp('generate_schema', { domain: domain, type: type })), note: e.message }; } }
      return { json_ld: parse.parseSchema(await mcp('generate_schema', { domain: domain, type: type })) };
    },
    async robots(allow, block, sitemap) {
      if (keyed) { const j = await v1('/generate/robots-txt', { allow: allow.join(','), block: block.join(','), sitemap: sitemap }); if (!j.preview) return fileResult(j); const args = {}; if (allow.length) args.allow = allow; if (block.length) args.block = block; if (sitemap) args.sitemap_url = sitemap; return { text: parse.fileBody(await mcp('generate_robots_txt', args)), note: j.upgrade ? j.upgrade.message : null }; }
      const args = {}; if (allow.length) args.allow = allow; if (block.length) args.block = block; if (sitemap) args.sitemap_url = sitemap;
      return { text: parse.fileBody(await mcp('generate_robots_txt', args)), note: null };
    },
    async llms(name, description, pages) {
      if (keyed) { const j = await v1('/generate/llms-txt', { name: name, description: description, page: pages.map((p) => p.url + '|' + p.description) }); if (!j.preview) return fileResult(j); return { text: parse.fileBody(await mcp('generate_llms_txt', { name: name, description: description, key_pages: pages })), note: j.upgrade ? j.upgrade.message : null }; }
      return { text: parse.fileBody(await mcp('generate_llms_txt', { name: name, description: description, key_pages: pages })), note: null };
    }
  };
}

module.exports = { createClient, DEFAULT_BASE };
