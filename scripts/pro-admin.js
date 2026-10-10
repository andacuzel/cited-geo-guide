#!/usr/bin/env node
/* =====================================================================
   scripts/pro-admin.js: look after the Citehound Pro pilot.

     node scripts/pro-admin.js list                 every order link: prefix, label, source, status, created, job status
     node scripts/pro-admin.js revoke <prefix>      stop an unused link (at least 6 characters of its prefix from list)
     node scripts/pro-admin.js stats [--days N]     daily totals for the last N days (default 7), and their sum
     node scripts/pro-admin.js feedback             the feedback people left at the end of their reports

   It reads and writes the Redis named by KV_REST_API_URL / KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST_ names), from the
   environment or the gitignored .env.local. Nothing here prints a full token, an email address or a name: list shows
   the first 8 characters of a token, and the order's contact data is never read. Feedback is shown as stored, which is
   under the report's id (shortened) with no contact data.
   ===================================================================== */

'use strict';

const Stats = require('../lib/pro-stats.js');

const pad = (s, n) => (String(s) + ' '.repeat(n)).slice(0, n);

async function list(store) {
  const orders = await store.listOrders();
  if (!orders.length) return ['No order links yet. Issue some with: node scripts/pro-issue-token.js --count 5 --label "Pilot"'];
  const lines = [pad('PREFIX', 10) + pad('LABEL', 24) + pad('SOURCE', 8) + pad('STATUS', 9) + pad('CREATED', 12) + 'JOB'];
  for (const o of orders) {
    const job = o.jobId ? (await store.adapter.hget('pro:job:' + o.jobId, 'status')) || 'expired' : '-';
    lines.push(pad(o.token.slice(0, 8), 10) + pad(o.label || '-', 24) + pad(o.source, 8) + pad(o.status, 9) + pad(o.createdAt.slice(0, 10), 12) + job);
  }
  const by = {}; orders.forEach((o) => { by[o.status] = (by[o.status] || 0) + 1; });
  lines.push('', orders.length + ' links: ' + Object.keys(by).sort().map((k) => by[k] + ' ' + k).join(', '));
  return lines;
}

async function revoke(store, prefix) {
  prefix = String(prefix || '').toLowerCase();
  if (!/^[0-9a-f]{6,32}$/.test(prefix)) return { ok: false, lines: ['Give at least 6 characters of the link\'s prefix, as shown by "list". Nothing was changed.'] };
  const matches = (await store.listOrders()).filter((o) => o.token.startsWith(prefix));
  if (matches.length === 0) return { ok: false, lines: ['No link starts with ' + prefix + '. Nothing was changed.'] };
  if (matches.length > 1) return { ok: false, lines: [matches.length + ' links start with ' + prefix + '. Give more characters. Nothing was changed.'] };
  const o = matches[0];
  if (o.status === 'used') return { ok: false, lines: ['That link was already used, so there is nothing to revoke: its report stays until its 90 days end.'] };
  if (o.status === 'revoked') return { ok: true, lines: ['That link was already revoked.'] };
  if (o.status === 'expired') return { ok: true, lines: ['That link has expired already.'] };
  const done = await store.revokeOrder(o.token);
  return { ok: done, lines: [done ? 'Revoked ' + o.token.slice(0, 8) + (o.label ? ' (' + o.label + ')' : '') + '. Anyone who opens it now sees the generic "link is not available" page.' : 'It could not be revoked (someone used it just now). Run list again.'] };
}

async function stats(store, days) {
  const rows = await Stats.read(store, days);
  const names = Stats.METRICS;
  const total = {}; names.forEach((m) => { total[m] = rows.reduce((n, r) => n + r.counts[m], 0); });
  const lines = [];
  lines.push('Last ' + days + ' day(s), UTC. Numbers only; no person is recorded.', '');
  rows.slice().reverse().forEach((r) => {
    const parts = names.filter((m) => r.counts[m]).map((m) => m.replace(/_/g, ' ') + ' ' + r.counts[m]);
    lines.push(pad(r.day, 12) + (parts.length ? parts.join(', ') : '-'));
  });
  lines.push('', 'TOTAL');
  names.forEach((m) => lines.push('  ' + pad(m.replace(/_/g, ' '), 18) + total[m]));
  lines.push('  ' + pad('emails sent (all)', 18) + (total.waitlist_emails + total.report_emails));
  return lines;
}

async function feedback(store) {
  const A = store.adapter;
  const ids = await A.smembers('pro:feedback-index');
  const rows = [];
  for (const id of ids) {
    const h = await A.hgetall('pro:feedback:' + id);
    if (!h) { await A.srem('pro:feedback-index', id); continue; }
    rows.push({ id: id, rating: parseInt(h.rating, 10), text: h.text || '', createdAt: h.createdAt || '' });
  }
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (!rows.length) return ['No feedback yet.'];
  const lines = [];
  rows.forEach((r) => { lines.push(r.createdAt.slice(0, 10) + '  ' + r.rating + '/5  report ' + r.id.slice(0, 8) + (r.text ? '\n    ' + r.text.replace(/\n/g, '\n    ') : '')); });
  const avg = rows.reduce((n, r) => n + r.rating, 0) / rows.length;
  lines.push('', rows.length + ' answer(s), average ' + avg.toFixed(1) + ' of 5.');
  return lines;
}

async function run(store, argv) {
  const cmd = argv[0];
  if (cmd === 'list') return { code: 0, lines: await list(store) };
  if (cmd === 'revoke') { const r = await revoke(store, argv[1]); return { code: r.ok ? 0 : 1, lines: r.lines }; }
  if (cmd === 'stats') { const i = argv.indexOf('--days'); const d = i === -1 ? 7 : parseInt(argv[i + 1], 10); if (!(d >= 1 && d <= 400)) return { code: 1, lines: ['--days must be a number from 1 to 400.'] }; return { code: 0, lines: await stats(store, d) }; }
  if (cmd === 'feedback') return { code: 0, lines: await feedback(store) };
  return { code: 1, lines: ['Usage: node scripts/pro-admin.js list | revoke <prefix> | stats [--days N] | feedback'] };
}

async function main() {
  const argv = process.argv.slice(2);
  require('./env-local.js').load();
  const S = require('../lib/pro-store.js');
  if (!S.hasRedisEnv()) { console.error('No Redis connection found. Put the Upstash variables in .env.local (see docs/pilot.md).'); process.exit(1); }
  const r = await run(S.createStore(S.adapterFromEnv()), argv);
  r.lines.forEach((l) => (r.code ? console.error(l) : console.log(l)));
  process.exit(r.code);
}

module.exports = { run: run, list: list, revoke: revoke, stats: stats, feedback: feedback };
if (require.main === module) main().catch(function (e) { console.error(e && e.message ? e.message : e); process.exit(1); });
