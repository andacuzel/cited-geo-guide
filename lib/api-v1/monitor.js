/* =====================================================================
   lib/api-v1/monitor.js: monitoring for Pro keys. A watchlist of domains, a snapshot of each scan, the differences between two snapshots as events.

   Storage (Redis, through the same adapter as the keys), all of it deleted when the last watcher of a domain leaves or when a key is revoked:
     api:wl:<keyid>      hash   domain -> JSON { addedAt, alerts }         the key's watchlist
     api:ae:<keyid>      hash   email, since                               the address alerts go to (only when the key owner gave it, and it matched the key's own address hash)
     api:wd:all          set    every domain somebody watches
     api:wk:<domain>     set    the ids of the keys that watch it
     api:ws:<domain>     hash   lastAt, nextDue (ms), status, streak       the schedule of the domain's scans
     api:hist:<domain>   hash   snapshot id -> JSON snapshot               kept RETENTION days (default 365)
     api:ev:<domain>     hash   event id -> JSON event                     kept RETENTION days
   A domain is scanned once for everybody who watches it. Scanning is scanPage() through lib/safe-fetch.js, the summary is lib/action-scan.js, nothing here scores anything.

   Schedule: a domain is due again about 7 days after its last scan (a little less, 12 hours, so a daily job that runs within an hour of its time still lands on the seventh day). A failed scan is
   retried the next day, three times, then weekly. runDue() takes the oldest due domains, at most API_V1_CRON_BATCH (default 6) per run, inside a time budget.
   ===================================================================== */

'use strict';

const crypto = require('crypto');
const ActionScan = require('../action-scan.js');
const Data = require('./data.js');
const Plans = require('../plans.js');

const DAY = 86400 * 1000;
const EVENT_TYPES = ['score_dropped', 'score_improved', 'crawler_blocked', 'crawler_unblocked', 'llms_txt_added', 'llms_txt_removed', 'check_failed', 'check_fixed', 'scan_failed'];
const ALERT_TYPES = ['score_dropped', 'crawler_blocked', 'llms_txt_removed'];
const INTERVAL_MS = 7 * DAY - 12 * 3600 * 1000;
const RETRY_MS = DAY;

const int = (v, d, lo, hi) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
function config(env) {
  env = env || process.env;
  return {
    watchLimit: int(env.API_V1_WATCH_LIMIT, 5, 1, 100),
    webhookLimit: int(env.API_V1_WEBHOOK_LIMIT, 3, 1, 20),
    scoreDelta: int(env.API_V1_SCORE_DELTA, 5, 1, 100),
    retentionDays: int(env.API_V1_RETENTION_DAYS, 365, 30, 730),
    batch: int(env.API_V1_CRON_BATCH, 6, 1, 20),
    maxFails: int(env.API_V1_WEBHOOK_MAX_FAILS, 5, 1, 50),
    budgetMs: int(env.API_V1_CRON_BUDGET_MS, 45000, 5000, 280000),
    retentionPinned: !!env.API_V1_RETENTION_DAYS
  };
}

const pad = (n) => String(n).padStart(2, '0');
function stamp(ms) { const d = new Date(ms); return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()); }
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const parse = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };

/* ---------- snapshots ---------- */

const checkName = (label) => String(label).replace(/\s*\(.*$/, '').trim();
const checkId = (label) => checkName(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// The record of one scan: the score, the pillar scores, the ids of the failed checks, the state of each crawler, whether llms.txt and JSON-LD are present.
function snapshotFrom(domain, scan, now) {
  const base = ActionScan.summarize(domain, scan, now);
  const checks = scan.result.checks;
  const failed = checks.filter((c) => !c.ok);
  const names = {}; failed.forEach((c) => { names[checkId(c.label)] = checkName(c.label); });
  const crawlers = {}; (scan.botResults || []).forEach((b) => { crawlers[b.name] = b.state === 'partial' ? 'limited' : b.state; });
  const has = (label) => { const c = checks.filter((x) => checkName(x.label) === label)[0]; return !!(c && c.ok); };
  return {
    id: 'snp_' + stamp(now), at: new Date(now).toISOString(), domain: domain, score: base.score,
    pillars: base.pillars.map((p) => ({ id: p.id, score: p.score, max: p.max })),
    failed: failed.map((c) => checkId(c.label)), check_names: names, crawlers: crawlers,
    llms_txt: has('llms.txt present'), schema: has('Structured data')
  };
}

/* ---------- the differences ---------- */

function makeEvent(domain, snapshot, type, subject, summary, data) {
  const at = snapshot.at, ms = Date.parse(at);
  return { id: 'evt_' + stamp(ms) + '_' + sha(domain + '|' + type + '|' + subject + '|' + snapshot.id).slice(0, 10), type: type, domain: domain, at: at, summary: summary, snapshot_id: snapshot.id, data: data || {} };
}

// Events between two snapshots of one domain. Pure: the same two snapshots always give the same events, with the same ids.
function diff(prev, next, opts) {
  const th = (opts && opts.scoreDelta) || 5, d = next.domain, ev = [];
  const delta = next.score - prev.score;
  if (delta <= -th) ev.push(makeEvent(d, next, 'score_dropped', 'score', 'Readiness score dropped from ' + prev.score + ' to ' + next.score + ' (' + delta + ' points).', { from: prev.score, to: next.score, delta: delta }));
  else if (delta >= th) ev.push(makeEvent(d, next, 'score_improved', 'score', 'Readiness score rose from ' + prev.score + ' to ' + next.score + ' (+' + delta + ' points).', { from: prev.score, to: next.score, delta: delta }));
  Object.keys(next.crawlers).sort().forEach((name) => {
    const was = prev.crawlers[name], now = next.crawlers[name];
    if (!was || was === now) return;
    if (now === 'blocked') ev.push(makeEvent(d, next, 'crawler_blocked', name, name + ' is now blocked in robots.txt (it was ' + was + ').', { crawler: name, from: was, to: now }));
    else if (was === 'blocked') ev.push(makeEvent(d, next, 'crawler_unblocked', name, name + ' is no longer blocked in robots.txt (now ' + now + ').', { crawler: name, from: was, to: now }));
  });
  if (prev.llms_txt && !next.llms_txt) ev.push(makeEvent(d, next, 'llms_txt_removed', 'llms', 'llms.txt is no longer found at the site root.', {}));
  else if (!prev.llms_txt && next.llms_txt) ev.push(makeEvent(d, next, 'llms_txt_added', 'llms', 'llms.txt was added at the site root.', {}));
  const was = new Set(prev.failed), isNow = new Set(next.failed);
  next.failed.filter((id) => !was.has(id)).sort().forEach((id) => { const name = (next.check_names && next.check_names[id]) || id; ev.push(makeEvent(d, next, 'check_failed', id, 'Check now failing: ' + name + '.', { check: id, name: name })); });
  prev.failed.filter((id) => !isNow.has(id)).sort().forEach((id) => { const name = (prev.check_names && prev.check_names[id]) || id; ev.push(makeEvent(d, next, 'check_fixed', id, 'Check now passing: ' + name + '.', { check: id, name: name })); });
  return ev;
}

/* ---------- storage helpers ---------- */

const keys = {
  wl: (id) => 'api:wl:' + id, ae: (id) => 'api:ae:' + id, all: 'api:wd:all', wk: (d) => 'api:wk:' + d, ws: (d) => 'api:ws:' + d, hist: (d) => 'api:hist:' + d, ev: (d) => 'api:ev:' + d
};

async function readJsonHash(A, key) {
  const h = await A.hgetall(key); const out = [];
  if (h) Object.keys(h).forEach((f) => { const v = parse(h[f]); if (v) out.push(v); });
  return out;
}
const newestFirst = (list) => list.slice().sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

async function snapshots(A, domain) { return newestFirst(await readJsonHash(A, keys.hist(domain))); }
async function events(A, domain) { return newestFirst(await readJsonHash(A, keys.ev(domain))); }
async function latestSnapshot(A, domain) { return (await snapshots(A, domain))[0] || null; }

// Removes snapshots and events older than the retention period, and keeps the two records from expiring while somebody watches.
async function prune(A, domain, cfg, now) {
  const cutoff = now - cfg.retentionDays * DAY, idCut = (key) => key.slice(4, 18);
  for (const k of [keys.hist(domain), keys.ev(domain)]) {
    const h = await A.hgetall(k); if (!h) continue;
    for (const f of Object.keys(h)) { if (f.length >= 18 && idCut(f) < stamp(cutoff)) await A.hdel(k, f); }
    await A.expire(k, (cfg.retentionDays + 30) * 86400);
  }
}

async function writeResult(A, domain, snapshot, evs, cfg, now) {
  if (snapshot) await A.hset(keys.hist(domain), { [snapshot.id]: JSON.stringify(snapshot) });
  if (evs.length) { const o = {}; evs.forEach((e) => { o[e.id] = JSON.stringify(e); }); await A.hset(keys.ev(domain), o); }
  await prune(A, domain, cfg, now);
}

/* ---------- one scan of one domain ---------- */

function scanMessage(domain, scan) {
  const kind = scan.kind || scan.stage || 'unknown error';
  return 'The scheduled scan could not read https://' + domain + '/ (' + kind + ').';
}

// -> { ok, snapshot, events, skipped }. baseline: store the first snapshot without diffing.
async function scanDomain(ctx, domain, o) {
  o = o || {};
  const { A } = ctx, now = ctx.clock();
  const lock = await A.set('api:lock:' + domain, '1', { nx: true, ex: 120 });
  if (!lock) return { ok: false, skipped: 'locked' };
  try {
    const scan = await ctx.scan(domain);
    const st = (await A.hgetall(keys.ws(domain))) || {};
    const wp = await watcherPlans(A, domain), top = Plans.best(wp.length ? wp : [o.plan || 'pro']);
    const cfg = ctx.cfg.retentionPinned ? ctx.cfg : Object.assign({}, ctx.cfg, { retentionDays: Plans.planOf(top).retentionDays || ctx.cfg.retentionDays });
    if (!scan.ok) {
      const streak = (parseInt(st.streak, 10) || 0) + 1;
      await A.hset(keys.ws(domain), { lastAt: String(now), nextDue: String(now + (streak < 3 ? RETRY_MS : 7 * DAY)), status: 'failed', streak: String(streak) });
      let evs = [];
      if (streak === 1 && !o.baseline) {
        const snap = { id: 'snp_' + stamp(now), at: new Date(now).toISOString(), domain: domain };
        evs = [makeEvent(domain, snap, 'scan_failed', 'scan', scanMessage(domain, scan), { stage: scan.stage || null, kind: scan.kind || null })];
        await writeResult(A, domain, null, evs, cfg, now);
      }
      return { ok: false, events: evs, error: scan };
    }
    const snapshot = snapshotFrom(domain, scan, now);
    const prev = await latestSnapshot(A, domain);
    const evs = prev && !o.baseline ? diff(prev, snapshot, cfg) : [];
    await writeResult(A, domain, snapshot, evs, cfg, now);
    await A.hset(keys.ws(domain), { lastAt: String(now), nextDue: String(now + intervalFor(top)), status: 'ok', streak: '0' });
    await A.expire(keys.ws(domain), (cfg.retentionDays + 30) * 86400);
    return { ok: true, snapshot: snapshot, events: evs };
  } finally { await A.del('api:lock:' + domain); }
}

/* ---------- the watchlist ---------- */

async function entries(A, id) {
  const h = await A.hgetall(keys.wl(id)) || {}, out = {};
  Object.keys(h).forEach((d) => { const v = parse(h[d]); if (v) out[d] = v; });
  return out;
}
async function addWatch(A, id, domain, now, alerts) {
  await A.hset(keys.wl(id), { [domain]: JSON.stringify({ addedAt: new Date(now).toISOString(), alerts: alerts !== false }) });
  await A.sadd(keys.wk(domain), id); await A.sadd(keys.all, domain);
}
async function setAlerts(A, id, domain, on) {
  const cur = parse(await A.hget(keys.wl(id), domain)); if (!cur) return false;
  cur.alerts = !!on; await A.hset(keys.wl(id), { [domain]: JSON.stringify(cur) }); return true;
}
async function dropDomainIfUnwatched(A, domain) {
  if ((await A.smembers(keys.wk(domain))).length) return false;
  await A.srem(keys.all, domain);
  for (const k of [keys.hist(domain), keys.ev(domain), keys.ws(domain), keys.wk(domain)]) await A.del(k);
  return true;
}
async function removeWatch(A, id, domain) {
  if (!(await A.hget(keys.wl(id), domain))) return false;
  await A.hdel(keys.wl(id), domain); await A.srem(keys.wk(domain), id);
  await dropDomainIfUnwatched(A, domain);
  if (!Object.keys(await entries(A, id)).length) await A.del(keys.ae(id));
  return true;
}

// Everything monitoring holds for a key: its watchlist, its alert address, its webhooks (called when the key is revoked).
async function purgeKey(A, id, webhooks) {
  for (const d of Object.keys(await entries(A, id))) { await A.hdel(keys.wl(id), d); await A.srem(keys.wk(d), id); await dropDomainIfUnwatched(A, d); }
  await A.del(keys.wl(id)); await A.del(keys.ae(id));
  if (webhooks) await webhooks.purgeKey(A, id);
}

// The plans of the active keys that watch a domain (the best of them decides how often the domain is scanned and how long its history is kept).
async function watcherPlans(A, domain) {
  const out = [];
  for (const id of await A.smembers(keys.wk(domain))) { const hash = await A.get('api:id:' + id); const rec = hash ? await A.hgetall('api:k:' + hash) : null; if (rec && rec.status === 'active' && Plans.planOf(rec.plan).monitoring) out.push(rec.plan); }
  return out;
}

// The key ids that watch a domain and are still active keys of a plan with monitoring.
async function validWatchers(A, domain) {
  const out = [];
  for (const id of await A.smembers(keys.wk(domain))) {
    const hash = await A.get('api:id:' + id); const rec = hash ? await A.hgetall('api:k:' + hash) : null;
    if (rec && rec.status === 'active' && Plans.planOf(rec.plan).monitoring) out.push(id);
  }
  return out;
}

// The limits of one key's plan (an environment variable still wins, for tests and for the owner): watched domains, webhooks, how long history is kept.
function configFor(env, plan) {
  const e = env || process.env, base = config(e), P = Plans.planOf(plan);
  return Object.assign({}, base, { watchLimit: e.API_V1_WATCH_LIMIT ? base.watchLimit : P.watch, webhookLimit: e.API_V1_WEBHOOK_LIMIT ? base.webhookLimit : P.webhooks, retentionDays: e.API_V1_RETENTION_DAYS ? base.retentionDays : P.retentionDays });
}
const intervalFor = (plan) => (Plans.planOf(plan).intervalDays || 7) * DAY - 12 * 3600 * 1000;

module.exports = { configFor, intervalFor, EVENT_TYPES, ALERT_TYPES, INTERVAL_MS, RETRY_MS, config, stamp, checkId, checkName, snapshotFrom, diff, makeEvent, keys, snapshots, events, latestSnapshot, scanDomain, entries, addWatch, setAlerts, removeWatch, dropDomainIfUnwatched, purgeKey, validWatchers, watcherPlans, prune, parse };
