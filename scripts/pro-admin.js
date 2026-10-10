#!/usr/bin/env node
/* =====================================================================
   scripts/pro-admin.js: look after the Citehound Pro pilot.

     node scripts/pro-admin.js list                 every order link: prefix, label, source, status, created, job status
     node scripts/pro-admin.js revoke <prefix>      stop an unused link (at least 6 characters of its prefix from list)
     node scripts/pro-admin.js clear-review <prefix> remove the review flag from an order (see docs/payments.md, "Refunds")
     node scripts/pro-admin.js stats [--days N]     daily totals for the last N days (default 7), and their sum
     node scripts/pro-admin.js feedback             the feedback people left at the end of their reports
     node scripts/pro-admin.js purge --label "<label>" [--yes]
                                                    remove test orders with exactly that label and their jobs, pages, citation
                                                    record and feedback. Without --yes it only says what it would remove.
     node scripts/pro-admin.js waitlist-remove <email> [--yes]
                                                    remove one waitlist entry by address (the address is never printed back)
     node scripts/pro-admin.js health               the last 24 hours at a glance: jobs, restored links, webhook and email failures,
                                                    waitlist signups, orders

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
  const lines = [pad('PREFIX', 10) + pad('LABEL', 24) + pad('SOURCE', 8) + pad('STATUS', 9) + pad('CREATED', 12) + pad('JOB', 10) + 'REVIEW'];
  for (const o of orders) {
    const job = o.jobId ? (await store.adapter.hget('pro:job:' + o.jobId, 'status')) || 'expired' : '-';
    lines.push(pad(o.token.slice(0, 8), 10) + pad(o.label || '-', 24) + pad(o.source, 8) + pad(o.status, 9) + pad(o.createdAt.slice(0, 10), 12) + pad(job, 10) + (o.review ? 'CHECK: ' + o.review : ''));
  }
  const by = {}; orders.forEach((o) => { by[o.status] = (by[o.status] || 0) + 1; });
  const flagged = orders.filter((o) => o.review).length;
  lines.push('', orders.length + ' links: ' + Object.keys(by).sort().map((k) => by[k] + ' ' + k).join(', '));
  return lines.concat(flagged ? ['', flagged + ' order(s) flagged for review (a refund the program could not decide on its own). Look at the order in the Polar dashboard; when you have decided, run: node scripts/pro-admin.js clear-review <prefix>'] : []);
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

// The keys one job owns.
const jobKeys = (id) => ['pro:job:' + id, 'pro:job:' + id + ':pages', 'pro:job:' + id + ':lock', 'pro:job:' + id + ':cit', 'pro:job-order:' + id, 'pro:feedback:' + id];

async function purge(store, label, yes) {
  label = String(label || '');
  if (!label.trim()) return { ok: false, lines: ['Give the exact label: purge --label "Self test". Nothing was changed.'] };
  const A = store.adapter;
  const matches = (await store.listOrders()).filter((o) => o.label === label);
  if (!matches.length) return { ok: true, lines: ['No order has the label "' + label + '". Nothing was changed.'] };
  const lines = [];
  let jobs = 0, keys = 0;
  for (const o of matches) {
    const ids = o.jobId ? [o.jobId] : [];
    jobs += ids.length;
    lines.push('  ' + o.token.slice(0, 8) + '  ' + o.status + (o.jobId ? ', report ' + o.jobId.slice(0, 8) : ', no report'));
    if (!yes) continue;
    const ks = ['pro:order:' + o.token, 'pro:order-claim:' + o.token];
    ids.forEach((id) => jobKeys(id).forEach((k) => ks.push(k)));
    for (const k of ks) keys += await A.del(k);
    for (const id of ids) await A.srem('pro:feedback-index', id);
    await A.srem('pro:orders', o.token);
  }
  const head = yes ? 'Removed ' + matches.length + ' order(s) with the label "' + label + '", ' + jobs + ' report(s), ' + keys + ' stored key(s):' : 'Would remove ' + matches.length + ' order(s) with the label "' + label + '" and ' + jobs + ' report(s):';
  return { ok: true, lines: [head].concat(lines, yes ? [] : ['', 'Nothing was changed. Run the same command with --yes to remove them.']) };
}

async function waitlistRemove(store, email, yes) {
  const Waitlist = require('../lib/waitlist.js');
  const want = Waitlist.normalizeEmail(email);
  if (!want || want.indexOf('@') === -1) return { ok: false, lines: ['Give the address to remove: waitlist-remove name@example.com. Nothing was changed.'] };
  const A = store.adapter;
  const found = [];
  for (const id of await A.smembers('wl:index')) { const h = await A.hgetall('wl:e:' + id); if (h && Waitlist.normalizeEmail(h.email) === want) found.push(id); }
  if (!found.length) return { ok: true, lines: ['No waitlist entry for that address. Nothing was changed.'] };
  if (!yes) return { ok: true, lines: ['One waitlist entry matches that address. Nothing was changed. Run the same command with --yes to remove it.'] };
  for (const id of found) { await A.del('wl:e:' + id); await A.del('wl:mail:' + id); await A.srem('wl:index', id); }
  return { ok: true, lines: ['Removed ' + found.length + ' waitlist entry.'] };
}

async function health(store, now) {
  now = now === undefined ? Date.now() : now;
  const A = store.adapter;
  const since = now - 24 * 3600 * 1000;
  const lines = ['Citehound Pro, last 24 hours (to ' + new Date(now).toISOString().slice(0, 16) + ' UTC). Numbers only.', ''];
  const orders = await store.listOrders();
  const recent = orders.filter((o) => Date.parse(o.createdAt) >= since);
  const bySource = (src) => recent.filter((o) => o.source === src).length;
  lines.push('Orders issued     ' + recent.length + ' (' + bySource('pilot') + ' pilot, ' + bySource('paid') + ' paid)');
  const review = orders.filter((o) => o.review);
  const jobs = [];
  for (const o of orders) {
    if (!o.jobId) continue;
    const h = await A.hgetall('pro:job:' + o.jobId);
    if (h && Date.parse(h.createdAt) >= since) jobs.push({ id: o.jobId, status: h.status || '?', reason: h.reason || '', age: Math.round((now - Date.parse(h.createdAt)) / 60000) });
  }
  const n = (st) => jobs.filter((j) => j.status === st).length;
  lines.push('Reports started   ' + jobs.length + ' (' + n('done') + ' done, ' + n('partial') + ' partial, ' + n('failed') + ' failed, ' + jobs.filter((j) => ['queued', 'running'].indexOf(j.status) !== -1).length + ' still running)');
  jobs.filter((j) => j.status === 'failed' || j.status === 'partial').forEach((j) => lines.push('  report ' + j.id.slice(0, 8) + '  ' + j.status + (j.reason ? ', ' + j.reason : '')));
  jobs.filter((j) => ['queued', 'running'].indexOf(j.status) !== -1 && j.age > 30).forEach((j) => lines.push('  report ' + j.id.slice(0, 8) + '  running for ' + j.age + ' minutes: probably abandoned'));
  // The daily counters are per UTC day, so the last 24 hours are read as today plus yesterday.
  const rows = await Stats.read(store, 2, now);
  const sum = (m) => rows.reduce((x, r) => x + r.counts[m], 0);
  lines.push('Links restored    ' + sum('jobs_restored') + '  (a failed report that read no page gave the link back; counters, today and yesterday UTC)');
  lines.push('Webhook failures  ' + sum('webhook_rejected') + ' rejected signatures, ' + sum('webhook_errors') + ' processing errors');
  lines.push('Email failures    ' + sum('mail_failed') + '  (the mail provider refused or was unreachable)');
  lines.push('Waitlist signups  ' + sum('waitlist_signups') + ' requests, ' + sum('waitlist_emails') + ' confirmation emails, ' + sum('waitlist_removed') + ' removals (counters, today and yesterday UTC)');
  lines.push('Refunds           ' + sum('payments_refunded') + ' links cancelled by a refund' + (review.length ? '; ' + review.length + ' order(s) flagged for your review (run list)' : ''));
  const bad = jobs.filter((j) => j.status === 'failed').length + sum('webhook_rejected') + sum('webhook_errors') + sum('mail_failed') + review.length;
  lines.push('', bad ? 'Needs a look: ' + bad + ' item(s) above.' : 'Nothing needs attention.');
  return lines;
}

async function run(store, argv) {
  const cmd = argv[0];
  if (cmd === 'list') return { code: 0, lines: await list(store) };
  if (cmd === 'revoke') { const r = await revoke(store, argv[1]); return { code: r.ok ? 0 : 1, lines: r.lines }; }
  if (cmd === 'clear-review') {
    const p = String(argv[1] || '').toLowerCase();
    if (!/^[0-9a-f]{6,32}$/.test(p)) return { code: 1, lines: ['Give at least 6 characters of the link\'s prefix, as shown by "list". Nothing was changed.'] };
    const m = (await store.listOrders()).filter((o) => o.token.startsWith(p));
    if (m.length !== 1) return { code: 1, lines: [m.length ? 'More than one link starts with that. Give more characters. Nothing was changed.' : 'No link starts with ' + p + '. Nothing was changed.'] };
    if (!m[0].review) return { code: 0, lines: ['That order has no review flag.'] };
    await store.clearReview(m[0].token);
    return { code: 0, lines: ['Cleared the review flag on ' + m[0].token.slice(0, 8) + '.'] };
  }
  if (cmd === 'stats') { const i = argv.indexOf('--days'); const d = i === -1 ? 7 : parseInt(argv[i + 1], 10); if (!(d >= 1 && d <= 400)) return { code: 1, lines: ['--days must be a number from 1 to 400.'] }; return { code: 0, lines: await stats(store, d) }; }
  if (cmd === 'feedback') return { code: 0, lines: await feedback(store) };
  if (cmd === 'purge') { const i = argv.indexOf('--label'); const r = await purge(store, i === -1 ? '' : argv[i + 1], argv.indexOf('--yes') !== -1); return { code: r.ok ? 0 : 1, lines: r.lines }; }
  if (cmd === 'waitlist-remove') { const r = await waitlistRemove(store, argv[1], argv.indexOf('--yes') !== -1); return { code: r.ok ? 0 : 1, lines: r.lines }; }
  if (cmd === 'health') return { code: 0, lines: await health(store) };
  return { code: 1, lines: ['Usage: node scripts/pro-admin.js list | revoke <prefix> | clear-review <prefix> | stats [--days N] | feedback | purge --label "<label>" [--yes] | waitlist-remove <email> [--yes] | health'] };
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

module.exports = { run: run, list: list, revoke: revoke, stats: stats, feedback: feedback, purge: purge, waitlistRemove: waitlistRemove, health: health };
if (require.main === module) main().catch(function (e) { console.error(e && e.message ? e.message : e); process.exit(1); });
