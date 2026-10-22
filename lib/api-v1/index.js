/* =====================================================================
   lib/api-v1/index.js: the router of the Citehound API, /v1. One Vercel function (api/v1/[...path].js) calls handle(); everything below is this file's routing.

     POST /v1/keys                    get a free key by email (the key is only in the email)
     GET  /v1/keys/revoke/<token>     the revoke page (one button); POST on the same address revokes
     GET  /v1/me                      plan, limits, usage, masked email
     GET  /v1/scan?domain=            one-page scan: score, pillars, failed checks with fixes, ten crawler states, benchmark comparison
     GET  /v1/compare?a=&b=           two scans and where they differ
     GET  /v1/crawlers?domain=        the ten crawler states
     GET|POST /v1/generate/llms-txt   an llms.txt from a name, a description and pages
     GET|POST /v1/generate/robots-txt a robots.txt from allow and block lists and a sitemap
     GET  /v1/generate/schema?domain=&type=   JSON-LD from the site's own homepage
     GET  /v1/benchmark[?category=]   our archived benchmark data
     POST /v1/admin/plan              set a plan (ADMIN_TOKEN; 404 while that is unset or short)

   Scoring, fetching, text building: lib/scanner.js, lib/safe-fetch.js (through the scanner), lib/file-generators.js, lib/schema.js. No CORS headers are sent (the API is for servers; a key
   in a web page would be public), no cookies are read or set, and nothing a caller sent is logged.
   ===================================================================== */

'use strict';

const crypto = require('crypto');
const H = require('../pro-http.js');
const site = require('../site-config.js');
const Keys = require('./keys.js');
const Limits = require('./limits.js');
const Data = require('./data.js');
const Mail = require('./mail.js');

const MAX_BODY = 4096;
const SCAN_DEADLINE_MS = parseInt(process.env.API_V1_SCAN_DEADLINE_MS, 10) || 20000;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;
const validEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v.trim()) && v.indexOf('..') === -1 && !/^\.|\.@|@\./.test(v.trim());
const MESSAGE_ACCEPTED = 'If this address can receive a key, it is on its way. The key is sent by email only and is shown once.';

let sharedAdapter = null;
function adapterOf(deps) {
  if (deps && deps.adapter) return deps.adapter;
  if (!sharedAdapter) sharedAdapter = require('../pro-store.js').adapterFromEnv();
  return sharedAdapter;
}

function fail(res, status, error, message, extra, headers) {
  const body = Object.assign({ error: error, message: message }, extra || {});
  H.sendJson(res, status, body, headers);
  return null;
}
const limited = (res, rl) => fail(res, 429, 'rate_limited', rl.message, { limit_scope: rl.scope, retry_after: rl.retryAfter }, { 'Retry-After': String(rl.retryAfter) });

// The path after /v1, from the catch-all's query (api/v1/[...path].js) or from the URL.
function pathOf(req) {
  const q = req.query && req.query.path;
  let parts = Array.isArray(q) ? q : (typeof q === 'string' && q ? q.split('/') : null);
  if (!parts) { try { parts = new URL(req.url, 'http://x').pathname.replace(/^\/(api\/)?v1\/?/, '').split('/'); } catch (e) { parts = []; } }
  return parts.filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch (e) { return s; } });
}
function queryOf(req) {
  const out = {};
  let u; try { u = new URL(req.url, 'http://x'); } catch (e) { return out; }
  u.searchParams.forEach((v, k) => { if (k === 'path') return; if (out[k] === undefined) out[k] = v; else out[k] = [].concat(out[k], v); });
  return out;
}

function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, stage: 'deadline', kind: 'timed out after ' + Math.round(ms / 1000) + ' seconds' }), ms); });
  return Promise.race([promise, deadline]).then((r) => { clearTimeout(timer); return r; }, (e) => { clearTimeout(timer); return { ok: false, stage: 'error', kind: 'scan failed' }; });
}
function scanMessage(domain, scan) {
  const kind = scan.kind || 'unknown error';
  if (scan.stage === 'deadline') return 'The scan of https://' + domain + '/ took too long (' + kind + ').';
  if (scan.stage === 'robots') return 'Could not read https://' + domain + '/robots.txt (' + kind + '), so the score would not be reliable.';
  return 'Could not read the homepage at https://' + domain + '/ (' + kind + ').';
}

function ip(req) { return H.clientAddress(req); }

/* ---------- keys ---------- */

async function createKey(req, res, ctx) {
  const { A, p, deps, now } = ctx;
  if (!/^application\/json\s*(;|$)/i.test(String((req.headers || {})['content-type'] || ''))) return fail(res, 415, 'unsupported_media_type', 'Send JSON with Content-Type: application/json.');
  const body = await H.readBody(req, MAX_BODY);
  if (!body.ok || !body.json || typeof body.json !== 'object' || Array.isArray(body.json)) return fail(res, body.reason === 'too_large' ? 413 : 400, body.reason === 'too_large' ? 'too_large' : 'invalid_request', 'The request body could not be read as a JSON object.');
  const b = body.json;
  if (!validEmail(b.email)) return fail(res, 400, 'invalid_request', 'Give a valid email address in "email".');
  if (b.marketing_optin !== undefined && typeof b.marketing_optin !== 'boolean') return fail(res, 400, 'invalid_request', '"marketing_optin" must be true or false.');
  if (!Mail.configured(deps.env)) return fail(res, 503, 'not_configured', 'Keys cannot be sent right now.');
  const email = b.email.trim(), eh = Keys.emailHash(p, email);
  const rl = await Limits.checkCreate(A, p, ip(req), eh, now);
  if (!rl.ok) return limited(res, rl);
  const accepted = () => H.sendJson(res, 202, { status: 'accepted', message: MESSAGE_ACCEPTED });
  if (rl.silent) return accepted();
  const made = await Keys.create(A, p, email, { marketing: b.marketing_optin === true, now: now });
  if (made.skipped) return accepted();
  const revokeUrl = site.baseUrl + '/v1/keys/revoke/' + Keys.revokeToken(p, made.id);
  const sent = await Mail.send(email, Mail.compose(made.key, revokeUrl), { env: deps.env, fetch: deps.fetch });
  if (!sent.ok) { await Keys.discard(A, p, made); return fail(res, 502, 'mail_failed', 'The email with the key could not be sent. Try again later.'); }
  return accepted();
}

const revokePage = (title, body) => '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>' + title + '</title></head>' +
  '<body style="margin:0;padding:24px;background:#EEF1F5;font-family:Arial,Helvetica,sans-serif;color:#14202E;"><main style="max-width:520px;margin:48px auto;background:#fff;border:1px solid #D9DEE6;border-radius:10px;padding:28px;"><p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0B1526;">Citehound</p>' + body + '</main></body></html>';

async function revokeRoute(req, res, ctx, token) {
  const { A, p } = ctx;
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!/^[0-9a-f]{20}\.[0-9a-f]{32}$/.test(token) || !Keys.safeEq(Keys.revokeToken(p, token.slice(0, 20)), token)) return H.sendHtml(res, 404, revokePage('Link not valid', '<h1 style="font-size:22px;">This link is not valid</h1><p>If you want a key revoked, write to <a href="mailto:' + site.contactEmail + '">' + site.contactEmail + '</a>.</p>'));
    return H.sendHtml(res, 200, revokePage('Revoke this key', '<h1 style="font-size:22px;">Revoke this API key?</h1><p>The key stops working at once. You can ask for a new one on the <a href="/api">API page</a>.</p><form method="post" action="/v1/keys/revoke/' + token + '"><button type="submit" style="padding:12px 20px;border:0;border-radius:6px;background:#0B1526;color:#fff;font-size:16px;font-weight:700;cursor:pointer;">Revoke the key</button></form>'));
  }
  if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', 'Use GET or POST.', null, { Allow: 'GET, POST' });
  const r = await Keys.revoke(A, p, token);
  if (!r.ok) return H.sendHtml(res, 404, revokePage('Link not valid', '<h1 style="font-size:22px;">This link is not valid</h1>'));
  return H.sendHtml(res, 200, revokePage('Key revoked', '<h1 style="font-size:22px;">The key is revoked</h1><p>It no longer works. Nothing else changed.</p>'));
}

/* ---------- authentication and limits ---------- */

// -> { rec, rl } or null (the answer has been sent)
async function authenticate(req, res, ctx) {
  const { A, p, now } = ctx, addr = ip(req);
  const key = Keys.keyFromRequest(req);
  if (!key) return fail(res, 401, 'missing_key', 'Send your key as "Authorization: Bearer <key>" or in the X-Citehound-Key header. Get a free key at ' + site.baseUrl + '/api.', null, { 'WWW-Authenticate': 'Bearer realm="Citehound API"' });
  if (await Limits.badKeyBlocked(A, p, addr, now)) return limited(res, { scope: 'bad_key', retryAfter: Limits.resetIn(now, 3600), message: 'Too many requests with a wrong key from this address. Try again later.' });
  const rec = await Keys.lookup(A, p, key);
  if (!rec) { await Limits.badKey(A, p, addr, now); return fail(res, 401, 'invalid_key', 'That key is not valid.', null, { 'WWW-Authenticate': 'Bearer realm="Citehound API", error="invalid_token"' }); }
  if (rec.status !== 'active') return fail(res, 403, 'key_revoked', 'That key has been revoked. Get a new one at ' + site.baseUrl + '/api.');
  const ipl = await Limits.checkIp(A, p, addr, now);
  if (!ipl.ok) return limited(res, ipl);
  const rl = await Limits.checkKey(A, rec.id, rec.plan, now);
  if (!rl.ok) return limited(res, rl);
  res.setHeader('X-RateLimit-Limit', String(rl.hourLimit));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, rl.hourRemaining)));
  res.setHeader('X-RateLimit-Reset', String(rl.reset));
  return { rec: rec, rl: rl };
}

/* ---------- endpoints ---------- */

function me(res, ctx, rec) {
  const L = Limits.PLAN_LIMITS[rec.plan] || Limits.PLAN_LIMITS.free;
  return Limits_usage(ctx, rec).then((u) => H.sendJson(res, 200, { plan: rec.plan, status: rec.status, email: rec.maskedEmail, created_at: rec.createdAt,
    limits: { requests_per_hour: L.hour, requests_per_day: L.day, scans_per_domain_per_hour: Limits.DOMAIN_PER_HOUR }, usage: { this_hour: u.hour, today: u.day } }));
}
const Limits_usage = (ctx, rec) => Limits.usage(ctx.A, rec.id, ctx.now);

async function scanRoute(req, res, ctx, q) {
  const domain = Data.validDomain(q.domain);
  if (!domain) return fail(res, 400, 'invalid_domain', 'Give a bare domain in "domain", for example example.com: no scheme, path or port.');
  const dl = await Limits.checkDomains(ctx.A, ctx.p, [domain], ctx.now);
  if (!dl.ok) return limited(res, dl);
  const scan = await withDeadline(ctx.deps.scanPage('https://' + domain + '/'), SCAN_DEADLINE_MS);
  if (!scan.ok) return fail(res, 502, 'scan_failed', scanMessage(domain, scan));
  return { domain, scan };
}

async function compareRoute(req, res, ctx, q) {
  const a = Data.validDomain(q.a), b = Data.validDomain(q.b);
  if (!a || !b) return fail(res, 400, 'invalid_domain', 'Give two bare domains in "a" and "b", for example example.com.');
  if (a === b) return fail(res, 400, 'invalid_request', '"a" and "b" must be different domains.');
  const dl = await Limits.checkDomains(ctx.A, ctx.p, [a, b], ctx.now);
  if (!dl.ok) return limited(res, dl);
  const sa = await withDeadline(ctx.deps.scanPage('https://' + a + '/', { commerce: false }), SCAN_DEADLINE_MS);
  const sb = await withDeadline(ctx.deps.scanPage('https://' + b + '/', { commerce: false }), SCAN_DEADLINE_MS);
  if (!sa.ok || !sb.ok) return fail(res, 502, 'scan_failed', 'Both sites are needed for a comparison. ' + [!sa.ok ? scanMessage(a, sa) : '', !sb.ok ? scanMessage(b, sb) : ''].filter(Boolean).join(' '));
  return H.sendJson(res, 200, { a: Data.scanSummary(a, sa, ctx.now), b: Data.scanSummary(b, sb, ctx.now), differences: Data.differences(sa, sb), note: Data.NOTE, method: Data.METHOD });
}

async function generateRoute(req, res, ctx, which, q) {
  let input = q;
  if (req.method === 'POST') {
    if (!/^application\/json\s*(;|$)/i.test(String((req.headers || {})['content-type'] || ''))) return fail(res, 415, 'unsupported_media_type', 'Send JSON with Content-Type: application/json.');
    const body = await H.readBody(req, MAX_BODY * 4);
    if (!body.ok || !body.json || typeof body.json !== 'object' || Array.isArray(body.json)) return fail(res, 400, 'invalid_request', 'The request body could not be read as a JSON object.');
    input = body.json;
  }
  if (which === 'robots-txt') {
    const r = Data.robots(input);
    return r.ok ? H.sendJson(res, 200, { type: 'robots.txt', content: r.content, allow: r.allow, block: r.block, sitemap: r.sitemap }) : fail(res, 400, 'invalid_request', r.message);
  }
  const r = Data.llms(input);
  return r.ok ? H.sendJson(res, 200, { type: 'llms.txt', content: r.content, pages: r.pages, note: 'llms.txt is an optional convention. It has no demonstrated effect on Google, and we do not measure whether any AI system reads it.' }) : fail(res, 400, 'invalid_request', r.message);
}

async function schemaRoute(req, res, ctx, q) {
  const domain = Data.validDomain(q.domain);
  if (!domain) return fail(res, 400, 'invalid_domain', 'Give a bare domain in "domain", for example example.com.');
  if (Data.SCHEMA_TYPES.indexOf(q.type) === -1) return fail(res, 400, 'invalid_request', '"type" must be one of: ' + Data.SCHEMA_TYPES.join(', ') + '.');
  const dl = await Limits.checkDomains(ctx.A, ctx.p, [domain], ctx.now);
  if (!dl.ok) return limited(res, dl);
  const r = await Data.schema(domain, q.type, ctx.deps);
  return r.ok ? H.sendJson(res, 200, { domain: domain, type: r.type, json_ld: r.jsonLd, note: 'Fields the scan cannot know are left in square brackets for you to fill in.' }) : fail(res, r.status, r.status === 400 ? 'invalid_request' : 'scan_failed', r.message);
}

function benchmarkRoute(res, q) {
  const cats = Data.categories();
  if (!q.category) return H.sendJson(res, 200, { categories: cats, overall: Data.overall(), note: 'Our own archived scans of well-known sites. ' + Data.NOTE });
  const d = Data.categoryDetail(String(q.category));
  return d ? H.sendJson(res, 200, d) : fail(res, 404, 'unknown_category', 'Unknown category. Use one of: ' + cats.map((c) => c.category).join(', ') + '.');
}

async function adminPlan(req, res, ctx) {
  const t = String((ctx.deps.env || process.env).ADMIN_TOKEN || '');
  if (t.length < 16) return fail(res, 404, 'not_found', 'Not found.');
  if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', 'Use POST.', null, { Allow: 'POST' });
  const given = (/^Bearer\s+(\S+)$/i.exec(String((req.headers || {}).authorization || '')) || [])[1] || '';
  const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
  if (!given || !crypto.timingSafeEqual(sha(given), sha(t))) return fail(res, 401, 'invalid_key', 'That token is not right.');
  const body = await H.readBody(req, MAX_BODY);
  if (!body.ok || !body.json || !validEmail(body.json.email) || Keys.PLANS.indexOf(body.json.plan) === -1) return fail(res, 400, 'invalid_request', 'Send {"email": "...", "plan": "free" or "pro"}.');
  const r = await Keys.setPlan(ctx.A, ctx.p, body.json.email, body.json.plan);
  return H.sendJson(res, 200, { plan: body.json.plan, keys_changed: r.changed });
}

/* ---------- the router ---------- */

async function handle(req, res, deps) {
  deps = Object.assign({ env: process.env, scanPage: null, fetchSiteInfo: null, now: null }, deps || {});
  if (!deps.scanPage) deps.scanPage = require('../scanner.js').scanPage;
  const now = deps.now ? (typeof deps.now === 'function' ? deps.now() : deps.now) : Date.now();
  try {
    const parts = pathOf(req), method = req.method || 'GET';
    if (method === 'OPTIONS') { res.statusCode = 204; res.setHeader('Allow', 'GET, POST, OPTIONS'); res.setHeader('Cache-Control', 'no-store'); return res.end(); }
    const p = Keys.pepper(deps.env);
    if (!p) return fail(res, 503, 'not_configured', 'The API is not configured on this server yet.');
    let A; try { A = adapterOf(deps); } catch (e) { return fail(res, 503, 'not_configured', 'The API storage is not configured on this server yet.'); }
    const ctx = { A: A, p: p, deps: deps, now: now };
    const route = parts.join('/');

    if (route === 'admin/plan') return await adminPlan(req, res, ctx);
    if (route === 'keys') { if (method !== 'POST') return fail(res, 405, 'method_not_allowed', 'Use POST.', null, { Allow: 'POST' }); return await createKey(req, res, ctx); }
    if (parts[0] === 'keys' && parts[1] === 'revoke' && parts.length === 3) return await revokeRoute(req, res, ctx, parts[2]);

    const known = ['me', 'scan', 'compare', 'crawlers', 'generate/llms-txt', 'generate/robots-txt', 'generate/schema', 'benchmark'];
    if (known.indexOf(route) === -1) return fail(res, 404, 'not_found', 'No such endpoint. The reference is at ' + site.baseUrl + '/api.');
    const post = route === 'generate/llms-txt' || route === 'generate/robots-txt';
    if (method !== 'GET' && method !== 'HEAD' && !(post && method === 'POST')) return fail(res, 405, 'method_not_allowed', post ? 'Use GET or POST.' : 'Use GET.', null, { Allow: post ? 'GET, POST, OPTIONS' : 'GET, OPTIONS' });

    const auth = await authenticate(req, res, ctx);
    if (!auth) return;
    const q = queryOf(req);
    if (route === 'me') return await me(res, ctx, auth.rec);
    if (route === 'scan') { const r = await scanRoute(req, res, ctx, q); return r && H.sendJson(res, 200, Data.scanSummary(r.domain, r.scan, now)); }
    if (route === 'crawlers') { const r = await scanRoute(req, res, ctx, q); if (!r) return; const s = Data.scanSummary(r.domain, r.scan, now); return H.sendJson(res, 200, { domain: s.domain, scannedAt: s.scannedAt, crawlers: s.crawlers, summary: s.crawlerSummary, note: s.note }); }
    if (route === 'compare') return await compareRoute(req, res, ctx, q);
    if (route === 'generate/schema') return await schemaRoute(req, res, ctx, q);
    if (route === 'generate/robots-txt' || route === 'generate/llms-txt') return await generateRoute(req, res, ctx, route.split('/')[1], q);
    return benchmarkRoute(res, q);
  } catch (e) {
    console.error('[api-v1] unhandled error: ' + (e && e.name ? e.name : 'Error'));
    return fail(res, 500, 'server_error', 'Unexpected server error. Try again.');
  }
}

module.exports = { handle, pathOf, validEmail, MESSAGE_ACCEPTED };
