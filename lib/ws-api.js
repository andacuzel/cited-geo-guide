/* =====================================================================
   lib/ws-api.js: the workspace routes, mounted into lib/pro-api.js (the same function, api/pro.js; Hobby plan function limit).

     GET  /w/<32 hex>        a workspace, by its bearer link (noindex, no-referrer, no-store)
     GET  /demo/fix          the fictional demo workspace, read-only
     POST /api/pro/wsverify  { id, key }: run one check again; the item becomes verified only if it passes
     GET  /admin/ws          the admin page (a login form, or the tool once signed in)
     POST /api/pro/wsadminlogin   { token }: the sign-in
     POST /api/pro/wsadminapi     { action, ... }: list, get, create, setItem, addItem, removeItem, rescan, archive, setPro, logout

   The admin: ADMIN_TOKEN (at least 16 characters) is the only credential. With it unset or too short EVERY admin route answers 404 and renders nothing
   (fail closed). The token is compared in constant time, never logged, never echoed, never stored in a cookie: the sign-in sets an httpOnly,
   SameSite=Strict session cookie that holds an expiry and an HMAC of it keyed with a hash of the token. Sign-in attempts are limited (8 per 15 minutes
   per network). Every state-changing call is JSON, same-origin (lib/pro-http.js guardPost) and needs the session.
   ===================================================================== */

'use strict';

const crypto = require('crypto');
const WS = require('./ws-store.js');
const Svc = require('./ws-service.js');
const Fix = require('./ws-fix.js');
const Render = require('./ws-render.js');
const Page = require('./pro-report-page.js');
const Fetch = require('./safe-fetch.js');

const COOKIE = 'ws_admin';
const SESSION_SECONDS = 8 * 3600;
const MIN_TOKEN = 16;
const BARE_404 = '<!doctype html><title>Not found</title><p>Not found.</p>';

function adminToken(env) { const t = String((env || process.env).ADMIN_TOKEN || ''); return t.length >= MIN_TOKEN ? t : ''; }
function adminConfigured(env) { return adminToken(env) !== ''; }

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
function safeEqual(a, b) { return crypto.timingSafeEqual(sha(a), sha(b)); }

function sign(token, exp) { return crypto.createHmac('sha256', sha(token)).update('ws-admin|' + exp).digest('hex'); }
function makeSession(token, now) { const exp = Math.floor((now === undefined ? Date.now() : now) / 1000) + SESSION_SECONDS; return exp + '.' + sign(token, exp); }
function validSession(token, value, now) {
  const m = /^(\d{9,12})\.([0-9a-f]{64})$/.exec(String(value || ''));
  if (!m || parseInt(m[1], 10) < Math.floor((now === undefined ? Date.now() : now) / 1000)) return false;
  return crypto.timingSafeEqual(Buffer.from(m[2], 'utf8'), Buffer.from(sign(token, m[1]), 'utf8'));
}
function cookieOf(req, name) {
  const raw = String((req.headers && req.headers.cookie) || '');
  const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]*)').exec(raw);
  return m ? m[1] : '';
}
function cookieHeader(req, value, maxAge) {
  const secure = !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(String((req.headers && req.headers.host) || ''));
  return COOKIE + '=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (secure ? '; Secure' : '');
}

function make(ctx) {
  const H = ctx.H;
  const A = (deps) => ctx.storeOf(deps).adapter;
  const env = (deps) => (deps && deps.env) || process.env;
  const limited429Html = (res) => H.sendHtml(res, 429, Page.errorPage(ctx.MSG.limited, 429), { 'Retry-After': '60' });
  const generic404 = (res) => H.sendJson(res, 404, { error: 'unavailable', message: ctx.MSG.generic });
  const bare404 = (res) => H.sendHtml(res, 404, BARE_404);

  async function modelOf(deps, store, meta) {
    const a = store.adapter;
    const [items, scans, last] = await Promise.all([WS.getItems(a, meta.id), WS.getScans(a, meta.id), WS.getLast(a, meta.id)]);
    let proReady = false;
    if (meta.proJobId && !meta.demo) { const job = await store.getJob(meta.proJobId); proReady = !!job && (job.status === 'done' || job.status === 'partial'); }
    return { meta: meta, items: items, scans: scans, last: last, demo: meta.demo, archived: meta.status === 'archived', proReady: proReady, proJobId: meta.proJobId };
  }

  /* ---------- the client view and the demo ---------- */

  async function view(req, res, deps) {
    const store = ctx.storeOf(deps);
    if (await ctx.limited(store, req, 'ws')) return limited429Html(res);
    const id = String(H.queryOf(req).id || '').trim().toLowerCase();
    const meta = WS.HEX32.test(id) ? await WS.getMeta(store.adapter, id) : null;
    if (!meta || meta.demo || meta.type !== 'fix') return H.sendHtml(res, 404, Render.notFound());
    return H.sendHtml(res, 200, Render.workspacePage(await modelOf(deps, store, meta)));
  }

  async function demo(req, res, deps) {
    const store = ctx.storeOf(deps);
    if (await ctx.limited(store, req, 'ws')) return limited429Html(res);
    const meta = await WS.getMeta(store.adapter, WS.DEMO.fix);
    if (!meta) return H.sendHtml(res, 404, Render.notFound());
    return H.sendHtml(res, 200, Render.workspacePage(await modelOf(deps, store, meta)));
  }

  async function verify(req, res, deps) {
    const store = ctx.storeOf(deps);
    if (await ctx.limited(store, req, 'wsverify')) return H.sendJson(res, 429, { error: 'rate_limited', message: ctx.MSG.limited }, { 'Retry-After': '3600' });
    const body = await H.readBody(req, 1024);
    const b = body.ok && body.json && typeof body.json === 'object' ? body.json : {};
    const id = String(b.id || '').trim().toLowerCase();
    const key = typeof b.key === 'string' ? b.key.slice(0, 120) : '';
    if (!WS.HEX32.test(id) || !key) return generic404(res);
    const r = await Svc.verify(store.adapter, id, key, deps || {});
    if (r.ok) return H.sendJson(res, 200, { passed: r.passed, status: r.status, score: r.score === undefined ? null : r.score, message: r.message || (r.already ? 'Already verified.' : '') });
    if (r.reason === 'archived') return H.sendJson(res, 409, { error: 'archived', message: 'This workspace is archived.' });
    if (r.reason === 'wait') return H.sendJson(res, 429, { error: 'wait', message: 'A check ran a moment ago. Try again in ' + Svc.VERIFY_COOLDOWN_SECONDS + ' seconds.' }, { 'Retry-After': String(Svc.VERIFY_COOLDOWN_SECONDS) });
    if (r.reason === 'daily') return H.sendJson(res, 429, { error: 'daily', message: 'This workspace has reached its daily limit of checks. Try again tomorrow.' });
    if (r.reason === 'scan_failed') return H.sendJson(res, 502, { error: 'scan_failed', message: 'We could not scan the site just now. Try again in a few minutes.' });
    return generic404(res);
  }

  /* ---------- the admin ---------- */

  function signedIn(req, deps) { const t = adminToken(env(deps)); return !!t && validSession(t, cookieOf(req, COOKIE)); }

  async function adminPage(req, res, deps) {
    if (!adminConfigured(env(deps))) return bare404(res);
    const store = ctx.storeOf(deps);
    if (await ctx.limited(store, req, 'wsadmin')) return limited429Html(res);
    const inn = signedIn(req, deps);
    const inner = inn
      ? '<p class="ps-kicker">Admin</p><h1 class="ps-title">Workspaces</h1><div id="wsAdmin" class="wsa" data-state="app"><p class="ps-lead">Loading&hellip;</p></div>'
      : '<p class="ps-kicker">Admin</p><h1 class="ps-title">Sign in</h1><form id="wsLogin" class="ps-form wsa-login" novalidate><div class="ps-field"><label class="ps-label" for="wsToken">Token</label><input class="field ps-input" id="wsToken" name="token" type="password" autocomplete="off" required /></div><p class="ps-actions"><button type="submit" class="btn btn--primary">Sign in</button></p><p class="wl-status" id="wsLoginStatus" role="status" aria-live="polite"></p></form>';
    return H.sendHtml(res, 200, Page.shell('Citehound admin', 'ps-body', Page.card(inner + '<noscript><p class="ps-note">The admin page needs JavaScript.</p></noscript>').replace('<span class="rp-top__label">Pro</span>', '<span class="rp-top__label">Admin</span>'), '  <script src="/app/ws-admin.js?v=1" defer></script>\n'),
      { 'X-Frame-Options': 'DENY' });
  }

  async function login(req, res, deps) {
    if (!adminConfigured(env(deps))) return generic404(res);
    const store = ctx.storeOf(deps);
    if (await ctx.limited(store, req, 'wsadminlogin')) return H.sendJson(res, 429, { error: 'rate_limited', message: 'Too many attempts. Try again in a while.' }, { 'Retry-After': '900' });
    const body = await H.readBody(req, 1024);
    const given = body.ok && body.json && typeof body.json.token === 'string' ? body.json.token : '';
    const token = adminToken(env(deps));
    if (!given || !safeEqual(given, token)) return H.sendJson(res, 401, { error: 'unauthorized', message: 'That token is not right.' });
    return H.sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, makeSession(token), SESSION_SECONDS) });
  }

  const cleanId = (v) => { const s = String(v || '').trim().toLowerCase(); return WS.HEX32.test(s) ? s : ''; };
  const REASON = { not_found: 'That workspace or item was not found.', verified_by_check_only: 'An item becomes verified only when a re-run of its check passes. Use Verify.', bad_status: 'That is not a status.', label: 'Give the item a label.', bad_id: 'A Pro report id is 32 characters of 0 to 9 and a to f.' };

  async function adminApi(req, res, deps) {
    if (!adminConfigured(env(deps))) return generic404(res);
    const store = ctx.storeOf(deps);
    if (await ctx.limited(store, req, 'wsadmin')) return H.sendJson(res, 429, { error: 'rate_limited', message: ctx.MSG.limited }, { 'Retry-After': '3600' });
    if (!signedIn(req, deps)) return H.sendJson(res, 401, { error: 'unauthorized', message: 'Sign in first.' });
    const body = await H.readBody(req, 16384);
    const b = body.ok && body.json && typeof body.json === 'object' && !Array.isArray(body.json) ? body.json : null;
    if (!b) return H.sendJson(res, 400, { error: 'bad_request', message: 'The request could not be read.' });
    const a = store.adapter;
    const done = (r, extra) => (r.ok ? H.sendJson(res, 200, Object.assign({ ok: true }, extra || {})) : H.sendJson(res, 400, { error: r.reason || 'failed', message: REASON[r.reason] || 'That did not work.' }));
    const id = cleanId(b.id);
    switch (String(b.action || '')) {
      case 'logout': return H.sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });
      case 'list': {
        const all = await WS.list(a);
        const rows = [];
        for (const m of all) { const last = await WS.getLast(a, m.id); rows.push({ id: m.id, type: m.type, domain: m.domain, status: m.status, createdAt: m.createdAt, score: last ? last.total : null }); }
        return H.sendJson(res, 200, { workspaces: rows });
      }
      case 'get': {
        const meta = id ? await WS.getMeta(a, id) : null;
        if (!meta || meta.demo) return generic404(res);
        const [items, scans, last] = await Promise.all([WS.getItems(a, id), WS.getScans(a, id), WS.getLast(a, id)]);
        return H.sendJson(res, 200, { meta: { id: meta.id, type: meta.type, domain: meta.domain, status: meta.status, createdAt: meta.createdAt, proJobId: meta.proJobId }, items: items, scans: scans, score: last ? last.total : null, statuses: Fix.STATUSES });
      }
      case 'create': {
        if (b.type !== 'fix') return H.sendJson(res, 400, { error: 'type', message: 'Only Fix workspaces can be created so far.' });
        const site = Fetch.parseSiteInput(b.domain);
        if (!site.ok) return H.sendJson(res, 400, { error: 'domain', message: ctx.MSG.site });
        const checkHost = (deps && deps.checkHost) || Fetch.checkHost;
        let host = await checkHost(site.domain);
        if (!host.ok && host.kind === 'dns') host = await checkHost('www.' + site.domain);
        if (!host.ok) return H.sendJson(res, 400, { error: 'domain', message: host.kind === 'blocked_host' ? ctx.MSG.siteNotPublic : ctx.MSG.siteNotFound });
        const r = await Svc.startFix(a, site.domain, deps || {});
        if (!r.ok) return H.sendJson(res, 502, { error: 'scan_failed', message: 'The site could not be scanned. Nothing was created.' });
        return H.sendJson(res, 200, { ok: true, id: r.id, path: '/w/' + r.id });
      }
      case 'setItem': return done(await Svc.setItem(a, id, String(b.key || ''), { status: b.status, note: b.note }));
      case 'addItem': return done(await Svc.addItem(a, id, { label: b.label, advice: b.advice, note: b.note }));
      case 'removeItem': return done(await Svc.removeItem(a, id, String(b.key || '')));
      case 'rescan': { const r = await Svc.rescan(a, id, deps || {}); return r.ok ? H.sendJson(res, 200, { ok: true, score: r.score }) : H.sendJson(res, r.reason === 'not_found' ? 404 : 502, { error: r.reason, message: r.reason === 'not_found' ? REASON.not_found : 'The site could not be scanned. Nothing changed.' }); }
      case 'archive': return done(await Svc.archive(a, id, b.on !== false));
      case 'setPro': return done(await Svc.setPro(a, id, b.proJobId));
      default: return H.sendJson(res, 400, { error: 'bad_action', message: 'Unknown action.' });
    }
  }

  return { ws: ['GET', view], demofix: ['GET', demo], wsverify: ['POST', verify], wsadmin: ['GET', adminPage], wsadminlogin: ['POST', login], wsadminapi: ['POST', adminApi] };
}

module.exports = { make: make, adminConfigured: adminConfigured, adminToken: adminToken, makeSession: makeSession, validSession: validSession, safeEqual: safeEqual, COOKIE: COOKIE, MIN_TOKEN: MIN_TOKEN };
