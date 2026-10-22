/* =====================================================================
   lib/api-v1/monitor-routes.js: the Pro monitoring endpoints of /v1 and the scheduled job.

     POST|GET|DELETE /v1/watchlist            domains to watch (default 5 per Pro key); the first scan runs when a domain is added, then about every 7 days
     GET  /v1/history?domain=                 the stored snapshots of a watched domain, newest first
     GET  /v1/events?since=&domain=&type=     the events of the watched domains, newest first, with stable ids, a cursor and has_more (for polling)
     POST|GET /v1/webhooks, GET|DELETE /v1/webhooks/<id>, GET /v1/webhooks/<id>/deliveries, POST /v1/webhooks/<id>/test
     GET|POST /v1/watchlist/unsubscribe/<keyid>/<domain>/<signature>   the one-click unsubscribe of an alert email (no key needed: the signature is the credential)
     GET|POST /v1/cron/run                    the scheduled job; answers 404 while CRON_SECRET is unset or short, 401 without it (Vercel sends it as a Bearer token)

   Every watchlist, history, events and webhook route needs a key whose plan is pro (403 pro_required otherwise). Scanning, snapshots and events: lib/api-v1/monitor.js. Webhooks: webhooks.js.
   Alerts: alerts.js. This file only routes, validates input and runs the job.
   ===================================================================== */

'use strict';

const crypto = require('crypto');
const H = require('../pro-http.js');
const Keys = require('./keys.js');
const Limits = require('./limits.js');
const Data = require('./data.js');
const Monitor = require('./monitor.js');
const Webhooks = require('./webhooks.js');
const Alerts = require('./alerts.js');
const { withDeadline } = require('./util.js');
const Plans = require('../plans.js');
const Fixes = require('./fixes.js');

const MAX_BODY = 4096;
const SCAN_DEADLINE_MS = parseInt(process.env.API_V1_SCAN_DEADLINE_MS, 10) || 20000;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;
const validEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v.trim()) && v.indexOf('..') === -1;
const DAY = 86400 * 1000;

// Paths this file answers, for the router and for the test that compares them with the documented ones. {id} is a webhook id.
const ROUTES = [
  { path: '/watchlist', methods: ['POST', 'GET', 'DELETE'] }, { path: '/history', methods: ['GET'] }, { path: '/events', methods: ['GET'] },
  { path: '/fixes', methods: ['GET'] }, { path: '/fixes/recheck', methods: ['POST'] }, { path: '/export', methods: ['GET'] },
  { path: '/webhooks', methods: ['POST', 'GET'] }, { path: '/webhooks/{id}', methods: ['GET', 'DELETE'] }, { path: '/webhooks/{id}/deliveries', methods: ['GET'] }, { path: '/webhooks/{id}/test', methods: ['POST'] }
];
const isMonitoring = (parts) => ['watchlist', 'history', 'events', 'webhooks', 'fixes', 'export'].indexOf(parts[0]) !== -1 && !(parts[0] === 'watchlist' && parts[1] === 'unsubscribe');

function fail(res, status, error, message, extra, headers) { H.sendJson(res, status, Object.assign({ error: error, message: message }, extra || {}), headers); return null; }
const limited = (res, rl) => fail(res, 429, 'rate_limited', rl.message, { limit_scope: rl.scope, retry_after: rl.retryAfter }, { 'Retry-After': String(rl.retryAfter) });

// The context the monitoring code runs in: the store, the pepper, the clock, a scan with a deadline.
function context(base, rec) {
  const deps = base.deps;
  const ctx = { A: base.A, p: base.p, deps: deps, rec: rec || null, cfg: rec ? Monitor.configFor(deps.env, rec.plan) : Monitor.config(deps.env), clock: () => (deps.now ? (typeof deps.now === 'function' ? deps.now() : deps.now) : Date.now()), deadlineAt: 0 };
  ctx.scan = (domain) => withDeadline(deps.scanPage('https://' + domain + '/', { commerce: false }), SCAN_DEADLINE_MS);
  return ctx;
}

async function readObject(req, res) {
  const ct = String((req.headers || {})['content-type'] || '');
  if (!/^application\/json\s*(;|$)/i.test(ct)) { fail(res, 415, 'unsupported_media_type', 'Send JSON with Content-Type: application/json.'); return null; }
  const b = await H.readBody(req, MAX_BODY);
  if (!b.ok || !b.json || typeof b.json !== 'object' || Array.isArray(b.json)) { fail(res, b.reason === 'too_large' ? 413 : 400, b.reason === 'too_large' ? 'too_large' : 'invalid_request', 'The request body could not be read as a JSON object.'); return null; }
  return b.json;
}

async function afterScan(ctx, domain, evs) {
  if (!evs || !evs.length) return { alerts: 0, webhooks: 0 };
  const webhooks = await Webhooks.dispatch(ctx, domain, evs);
  const alerts = await Alerts.send(ctx, domain, evs);
  return { alerts: alerts, webhooks: webhooks };
}

/* ---------- watchlist ---------- */

const entryView = async (A, domain, e) => {
  const st = (await A.hgetall(Monitor.keys.ws(domain))) || {}, last = await Monitor.latestSnapshot(A, domain);
  return { domain: domain, added_at: e.addedAt, alerts: e.alerts !== false, last_scan_at: st.lastAt ? new Date(Number(st.lastAt)).toISOString() : null, next_scan_after: st.nextDue ? new Date(Number(st.nextDue)).toISOString() : null, status: st.status || null, last_score: last ? last.score : null };
};

async function watchlistPost(req, res, ctx, rec) {
  const { A, p, cfg } = ctx, id = rec.id, now = ctx.clock();
  const input = await readObject(req, res); if (!input) return;
  const domain = Data.validDomain(input.domain);
  if (!domain) return fail(res, 400, 'invalid_domain', 'Give a bare domain in "domain", for example example.com: no scheme, path or port.');
  if (input.alerts !== undefined && typeof input.alerts !== 'boolean') return fail(res, 400, 'invalid_request', '"alerts" must be true or false.');
  let alertEmail = null;
  if (input.alert_email !== undefined && input.alert_email !== null) {
    if (!validEmail(input.alert_email) || !rec.emailHash || !Keys.safeEq(Keys.emailHash(p, input.alert_email.trim()), rec.emailHash)) return fail(res, 400, 'invalid_request', '"alert_email" must be the address this key was sent to.');
    alertEmail = input.alert_email.trim();
  }
  const ents = await Monitor.entries(A, id);
  const apply = async () => { if (alertEmail) await A.hset(Monitor.keys.ae(id), { email: alertEmail, since: new Date(now).toISOString() }); };
  if (ents[domain]) { // already watched: only the alert settings change
    if (input.alerts !== undefined) await Monitor.setAlerts(A, id, domain, input.alerts);
    await apply();
    return H.sendJson(res, 200, { watch: await entryView(A, domain, (await Monitor.entries(A, id))[domain]), alert_email: !!(await A.hget(Monitor.keys.ae(id), 'email')) });
  }
  if (Object.keys(ents).length >= cfg.watchLimit) return fail(res, 409, 'watchlist_full', 'A key may watch ' + cfg.watchLimit + ' domains. Remove one first.', { limit: cfg.watchLimit });
  let snap = await Monitor.latestSnapshot(A, domain);
  if (!snap || now - Date.parse(snap.at) >= DAY) {
    const dl = await Limits.checkDomains(A, p, [domain], now);
    if (!dl.ok) return limited(res, dl);
    const watched = (await A.smembers(Monitor.keys.wk(domain))).length > 0;
    const r = await Monitor.scanDomain(ctx, domain, { baseline: !watched, plan: rec.plan });
    if (!r.ok) return fail(res, 502, 'scan_failed', r.skipped ? 'This domain is being scanned right now. Try again in a minute.' : 'Could not read https://' + domain + '/, so it was not added.');
    snap = r.snapshot;
    if (watched) await afterScan(ctx, domain, r.events);
  }
  await Monitor.addWatch(A, id, domain, now, input.alerts);
  await apply();
  const st = (await A.hgetall(Monitor.keys.ws(domain))) || {};
  H.sendJson(res, 201, { watch: await entryView(A, domain, (await Monitor.entries(A, id))[domain]), baseline: { snapshot_id: snap.id, score: snap.score, scanned_at: snap.at }, alert_email: !!(await A.hget(Monitor.keys.ae(id), 'email')), next_scan_after: st.nextDue ? new Date(Number(st.nextDue)).toISOString() : null });
}

async function watchlistGet(res, ctx, rec) {
  const ents = await Monitor.entries(ctx.A, rec.id), out = [];
  for (const d of Object.keys(ents).sort()) out.push(await entryView(ctx.A, d, ents[d]));
  H.sendJson(res, 200, { domains: out, limit: ctx.cfg.watchLimit, used: out.length, alert_email: !!(await ctx.A.hget(Monitor.keys.ae(rec.id), 'email')) });
}

async function watchlistDelete(res, ctx, rec, q) {
  const domain = Data.validDomain(q.domain);
  if (!domain) return fail(res, 400, 'invalid_domain', 'Give the domain to remove in "domain".');
  if (!(await Monitor.removeWatch(ctx.A, rec.id, domain))) return fail(res, 404, 'not_watched', 'That domain is not on this key\'s watchlist.');
  H.sendJson(res, 200, { removed: true, domain: domain });
}

/* ---------- history and events ---------- */

const limitOf = (v, d, max) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : d; };

async function watchedDomain(res, ctx, rec, raw) {
  const domain = Data.validDomain(raw);
  if (!domain) { fail(res, 400, 'invalid_domain', 'Give a bare domain in "domain", for example example.com.'); return null; }
  if (!(await Monitor.entries(ctx.A, rec.id))[domain]) { fail(res, 404, 'not_watched', 'That domain is not on this key\'s watchlist. Add it with POST /v1/watchlist.'); return null; }
  return domain;
}

async function history(res, ctx, rec, q) {
  const domain = await watchedDomain(res, ctx, rec, q.domain); if (!domain) return;
  let list = await Monitor.snapshots(ctx.A, domain);
  if (q.since !== undefined) { const t = Date.parse(q.since); if (!Number.isFinite(t)) return fail(res, 400, 'invalid_request', '"since" must be a date such as 2026-10-01 or 2026-10-01T00:00:00Z.'); list = list.filter((s) => Date.parse(s.at) > t); }
  H.sendJson(res, 200, { domain: domain, retention_days: ctx.cfg.retentionDays, snapshots: list.slice(0, limitOf(q.limit, 52, 120)) });
}

async function eventsRoute(res, ctx, rec, q) {
  let domains;
  if (q.domain !== undefined) { const d = await watchedDomain(res, ctx, rec, q.domain); if (!d) return; domains = [d]; }
  else domains = Object.keys(await Monitor.entries(ctx.A, rec.id));
  let types = null;
  if (q.type !== undefined) { types = String(q.type).split(',').map((s) => s.trim()).filter(Boolean); if (!types.length || types.some((t) => Monitor.EVENT_TYPES.indexOf(t) === -1)) return fail(res, 400, 'invalid_request', '"type" must be a comma-separated list of: ' + Monitor.EVENT_TYPES.join(', ') + '.'); }
  let sinceId = null, sinceAt = null;
  if (q.since !== undefined) { if (/^evt_/.test(q.since)) sinceId = String(q.since); else { sinceAt = Date.parse(q.since); if (!Number.isFinite(sinceAt)) return fail(res, 400, 'invalid_request', '"since" must be an event id or a date such as 2026-10-01T00:00:00Z.'); } }
  if (q.cursor !== undefined && !/^evt_[0-9A-Za-z_]+$/.test(String(q.cursor))) return fail(res, 400, 'invalid_request', '"cursor" must be the next_cursor of a previous answer.');
  let all = [];
  for (const d of domains) all = all.concat(await Monitor.events(ctx.A, d));
  all = all.filter((e) => (!types || types.indexOf(e.type) !== -1) && (sinceId === null || e.id > sinceId) && (sinceAt === null || Date.parse(e.at) > sinceAt) && (q.cursor === undefined || e.id < q.cursor));
  all.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const limit = limitOf(q.limit, 50, 100), page = all.slice(0, limit);
  H.sendJson(res, 200, { events: page, has_more: all.length > limit, next_cursor: all.length > limit ? page[page.length - 1].id : null });
}

/* ---------- webhooks ---------- */

async function webhooksRoute(req, res, ctx, rec, parts) {
  const { A } = ctx, method = req.method, id = rec.id;
  if (parts.length === 1) {
    if (method === 'GET') return H.sendJson(res, 200, { webhooks: (await Webhooks.list(A, id)).map(Webhooks.publicView), limit: ctx.cfg.webhookLimit });
    if (method === 'POST') {
      const input = await readObject(req, res); if (!input) return;
      const r = await Webhooks.create(ctx, id, input);
      if (!r.ok) return fail(res, r.status, r.error, r.message);
      const body = { webhook: Webhooks.publicView(r.hook) };
      if (r.secret) { body.secret = r.secret; body.secret_note = 'This is the only time the secret is shown. Store it now: it signs every delivery.'; }
      return H.sendJson(res, 201, body);
    }
    return fail(res, 405, 'method_not_allowed', 'Use GET or POST.', null, { Allow: 'GET, POST, OPTIONS' });
  }
  const hook = /^whk_[0-9a-f]{16}$/.test(parts[1]) ? await Webhooks.get(A, id, parts[1]) : null;
  if (parts.length === 2) {
    if (method !== 'GET' && method !== 'DELETE') return fail(res, 405, 'method_not_allowed', 'Use GET or DELETE.', null, { Allow: 'GET, DELETE, OPTIONS' });
    if (!hook) return fail(res, 404, 'not_found', 'No such webhook.');
    if (method === 'DELETE') { await Webhooks.remove(A, id, hook.id); return H.sendJson(res, 200, { removed: true, id: hook.id }); }
    return H.sendJson(res, 200, { webhook: Webhooks.publicView(hook) });
  }
  if (parts.length === 3 && parts[2] === 'deliveries') {
    if (method !== 'GET') return fail(res, 405, 'method_not_allowed', 'Use GET.', null, { Allow: 'GET, OPTIONS' });
    if (!hook) return fail(res, 404, 'not_found', 'No such webhook.');
    return H.sendJson(res, 200, { webhook_id: hook.id, deliveries: await Webhooks.deliveries(A, hook.id) });
  }
  if (parts.length === 3 && parts[2] === 'test') {
    if (method !== 'POST') return fail(res, 405, 'method_not_allowed', 'Use POST.', null, { Allow: 'POST, OPTIONS' });
    if (!hook) return fail(res, 404, 'not_found', 'No such webhook.');
    const rec2 = await Webhooks.deliver(ctx, id, hook, Webhooks.testEvent(null, ctx.clock()), { test: true });
    return H.sendJson(res, 200, { delivery: rec2 });
  }
  return fail(res, 404, 'not_found', 'No such endpoint.');
}

/* ---------- Fix and Beyond: the fix list, the re-check, the export ---------- */

const baseKey = (keyid, domain) => 'api:fx:' + keyid + ':' + require('crypto').createHash('sha256').update(domain).digest('hex').slice(0, 16);

async function fixesRoute(req, res, ctx, rec, parts, q) {
  const { A } = ctx, now = ctx.clock();
  const recheck = parts[1] === 'recheck';
  if (parts.length > 2 || (parts.length === 2 && !recheck)) return fail(res, 404, 'not_found', 'No such endpoint.');
  if (recheck ? req.method !== 'POST' : (req.method !== 'GET' && req.method !== 'HEAD')) return fail(res, 405, 'method_not_allowed', recheck ? 'Use POST.' : 'Use GET.', null, { Allow: (recheck ? 'POST' : 'GET') + ', OPTIONS' });
  let raw = q.domain;
  if (recheck) { const input = await readObject(req, res); if (!input) return; raw = input.domain; }
  const domain = Data.validDomain(raw);
  if (!domain) return fail(res, 400, 'invalid_domain', 'Give a bare domain in "domain", for example example.com: no scheme, path or port.');
  let base = null;
  if (recheck) { base = Monitor.parse(await A.get(baseKey(rec.id, domain))); if (!base) return fail(res, 404, 'no_fix_list', 'There is no fix list for that domain yet. Make one first with GET /v1/fixes?domain=' + domain + '.'); }
  const dl = await Limits.checkDomains(A, ctx.p, [domain], now);
  if (!dl.ok) return limited(res, dl);
  const scan = await ctx.scan(domain);
  if (!scan.ok) return fail(res, 502, 'scan_failed', 'Could not read https://' + domain + '/ (' + (scan.kind || scan.stage || 'unknown error') + ').');
  if (recheck) return H.sendJson(res, 200, Fixes.recheck(base, scan, now));
  const list = Fixes.build(domain, scan, now);
  await A.set(baseKey(rec.id, domain), JSON.stringify({ domain: domain, score: list.score, failed: list.items.map((i) => i.id), at: list.scannedAt }), { ex: 90 * 86400 });
  H.sendJson(res, 200, list);
}

const csvCell = (v) => { let s = String(v === null || v === undefined ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

// The history or the events of a watched domain as JSON or CSV, as far back as the plan keeps them.
async function exportRoute(res, ctx, rec, q) {
  const domain = await watchedDomain(res, ctx, rec, q.domain); if (!domain) return;
  const kind = q.type === undefined ? 'snapshots' : q.type, format = q.format === undefined ? 'json' : q.format;
  if (['snapshots', 'events'].indexOf(kind) === -1 || ['json', 'csv'].indexOf(format) === -1) return fail(res, 400, 'invalid_request', '"type" is snapshots or events, and "format" is json or csv.');
  const rows = kind === 'events' ? await Monitor.events(ctx.A, domain) : await Monitor.snapshots(ctx.A, domain);
  if (format === 'json') return H.sendJson(res, 200, { domain: domain, type: kind, exported_at: new Date(ctx.clock()).toISOString(), retention_days: ctx.cfg.retentionDays, count: rows.length, rows: rows });
  const cols = kind === 'events' ? ['id', 'at', 'type', 'domain', 'summary'] : ['id', 'at', 'domain', 'score', 'failed_checks', 'crawlers_blocked', 'llms_txt', 'json_ld'];
  const line = (r) => (kind === 'events' ? [r.id, r.at, r.type, r.domain, r.summary] : [r.id, r.at, r.domain, r.score, r.failed.length, Object.keys(r.crawlers).filter((n) => r.crawlers[n] === 'blocked').length, r.llms_txt, r.schema]).map(csvCell).join(',');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="citehound-' + kind + '-' + domain + '.csv"'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(cols.join(',') + '\n' + rows.map(line).join('\n') + (rows.length ? '\n' : ''));
}

/* ---------- the dispatcher for authenticated monitoring routes ---------- */

async function handle(req, res, base, parts, rec, q) {
  const name = parts[0], P = Plans.planOf(rec.plan);
  const feature = name === 'fixes' ? 'fixes' : (name === 'export' ? 'exportData' : 'monitoring');
  if (!P[feature]) { H.sendJson(res, 402, Plans.gateBody(feature, rec.plan)); return null; }
  const ctx = context(base, rec), method = req.method;
  if (name === 'fixes') return fixesRoute(req, res, ctx, rec, parts, q);
  if (name === 'export') return exportRoute(res, ctx, rec, q);
  if (name === 'watchlist') {
    if (parts.length !== 1) return fail(res, 404, 'not_found', 'No such endpoint.');
    if (method === 'POST') return watchlistPost(req, res, ctx, rec);
    if (method === 'GET' || method === 'HEAD') return watchlistGet(res, ctx, rec);
    if (method === 'DELETE') return watchlistDelete(res, ctx, rec, q);
    return fail(res, 405, 'method_not_allowed', 'Use GET, POST or DELETE.', null, { Allow: 'GET, POST, DELETE, OPTIONS' });
  }
  if (name === 'history' || name === 'events') {
    if (parts.length !== 1) return fail(res, 404, 'not_found', 'No such endpoint.');
    if (method !== 'GET' && method !== 'HEAD') return fail(res, 405, 'method_not_allowed', 'Use GET.', null, { Allow: 'GET, OPTIONS' });
    if (name === 'history') { if (q.domain === undefined) return fail(res, 400, 'invalid_domain', 'Give the watched domain in "domain".'); return history(res, ctx, rec, q); }
    return eventsRoute(res, ctx, rec, q);
  }
  return webhooksRoute(req, res, ctx, rec, parts);
}

/* ---------- the unsubscribe page ---------- */

const page = (title, body) => '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>' + title + '</title></head>' +
  '<body style="margin:0;padding:24px;background:#EEF1F5;font-family:Arial,Helvetica,sans-serif;color:#14202E;"><main style="max-width:520px;margin:48px auto;background:#fff;border:1px solid #D9DEE6;border-radius:10px;padding:28px;"><p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0B1526;">Citehound</p>' + body + '</main></body></html>';

async function unsubscribe(req, res, base, parts) {
  const { A, p } = base, keyid = parts[2], domain = Data.validDomain(parts[3]), sig = parts[4];
  if (!domain || !Alerts.unsubValid(p, keyid, domain, sig)) return H.sendHtml(res, 404, page('Link not valid', '<h1 style="font-size:22px;">This link is not valid</h1><p>If you want alerts stopped, write to hey@getcitehound.com.</p>'));
  if (req.method === 'GET' || req.method === 'HEAD') return H.sendHtml(res, 200, page('Stop alerts', '<h1 style="font-size:22px;">Stop alert emails for ' + domain.replace(/[^a-z0-9.-]/g, '') + '?</h1><p>You will no longer get email about this domain. Events stay available through the API.</p><form method="post" action="/v1/watchlist/unsubscribe/' + keyid + '/' + domain + '/' + sig + '"><button type="submit" style="padding:12px 20px;border:0;border-radius:6px;background:#0B1526;color:#fff;font-size:16px;font-weight:700;cursor:pointer;">Stop alerts</button></form>'));
  if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', 'Use GET or POST.', null, { Allow: 'GET, POST' });
  await Monitor.setAlerts(A, keyid, domain, false);
  H.sendHtml(res, 200, page('Alerts stopped', '<h1 style="font-size:22px;">Alerts are off for ' + domain.replace(/[^a-z0-9.-]/g, '') + '</h1><p>Nothing else changed.</p>'));
}

/* ---------- the scheduled job ---------- */

// -> counts. The oldest due domains first, at most cfg.batch, inside the time budget; then the webhook retries that are due.
async function runDue(ctx) {
  const { A, cfg } = ctx;
  ctx.deadlineAt = Date.now() + cfg.budgetMs;
  const out = { due: 0, scanned: 0, failed: 0, skipped: 0, events: 0, alerts_sent: 0, webhooks_sent: 0, retries: 0 };
  if (!(await A.set('api:lock:cron', '1', { nx: true, ex: 300 }))) return Object.assign(out, { locked: true });
  try {
    const now = ctx.clock(), due = [];
    for (const d of await A.smembers(Monitor.keys.all)) {
      const st = await A.hgetall(Monitor.keys.ws(d));
      if (st && Number(st.nextDue) > now) continue;
      if (!(await Monitor.validWatchers(A, d)).length) { out.skipped++; continue; }
      due.push({ d: d, next: st ? Number(st.nextDue) || 0 : 0 });
    }
    due.sort((a, b) => a.next - b.next); out.due = due.length;
    const batch = due.slice(0, cfg.batch);
    const results = await Promise.all(batch.map(async (x) => ({ d: x.d, r: await Monitor.scanDomain(ctx, x.d) })));
    for (const { d, r } of results) {
      if (r.skipped) { out.skipped++; continue; }
      if (r.ok) out.scanned++; else out.failed++;
      out.events += (r.events || []).length;
      const a = await afterScan(ctx, d, r.events || []);
      out.alerts_sent += a.alerts; out.webhooks_sent += a.webhooks;
    }
    out.retries = await Webhooks.processPending(ctx, 50);
  } finally { await A.del('api:lock:cron'); }
  return out;
}

async function cron(req, res, base) {
  const secret = String((base.deps.env || process.env).CRON_SECRET || '');
  if (secret.length < 16) return fail(res, 404, 'not_found', 'Not found.');
  const given = (/^Bearer\s+(\S+)$/i.exec(String((req.headers || {}).authorization || '')) || [])[1] || '';
  const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
  if (!given || !crypto.timingSafeEqual(sha(given), sha(secret))) return fail(res, 401, 'invalid_key', 'That token is not right.');
  if (req.method !== 'GET' && req.method !== 'POST') return fail(res, 405, 'method_not_allowed', 'Use GET or POST.', null, { Allow: 'GET, POST' });
  return H.sendJson(res, 200, await runDue(context(base)));
}

module.exports = { ROUTES, isMonitoring, handle, unsubscribe, cron, runDue, context, afterScan };
