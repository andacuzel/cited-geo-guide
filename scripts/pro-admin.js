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
     node scripts/pro-admin.js kill on|off|status   the citation kill switch in Redis: "on" stops every paid citation call at once, with no
                                                    redeploy (CITATION_KILL=1 in Vercel does the same, after a redeploy)
     node scripts/pro-admin.js spend                today's and this month's paid citation calls and cost per provider, and the budgets
     node scripts/pro-admin.js readiness-upload <file.pdf>
                                                    store the State of AI Readiness PDF in the database (never in a file or the repository):
                                                    checked to be a PDF under 650 KB, stored with its sha256, served only to signed links
     node scripts/pro-admin.js readiness-info       the stored PDF (name, size, hash, date), whether the report is switched on, how many addresses
     node scripts/pro-admin.js readiness on|off     switch signups and downloads off or on at once, with no redeploy
     node scripts/pro-admin.js readiness-export     the report list as CSV on stdout (email, createdAt, consentVersion, updates); messages go to stderr
     node scripts/pro-admin.js readiness-remove <email> [--yes]
                                                    remove one address from the report list (the address is never printed back)
     node scripts/pro-admin.js readiness-pdf-delete --yes
                                                    delete the stored PDF (signups and downloads then say the report is not available)
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

/* ---------- the State of AI Readiness report list ---------- */

async function readinessUpload(store, file) {
  const fs = require('fs');
  const R = require('../lib/readiness.js');
  const content = require('../content/readiness.json');
  if (!file) return { ok: false, lines: ['Give the PDF: readiness-upload <file.pdf>. Nothing was changed.'] };
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { return { ok: false, lines: ['That file could not be read. Nothing was changed.'] }; }
  try {
    const info = await R.putPdf(store.adapter, buf, content.downloadName);
    return { ok: true, lines: ['Stored the report: ' + info.bytes + ' bytes, sha256 ' + info.sha256 + ', served as ' + info.name + '.', 'Compare the hash with: shasum -a 256 <file>. Signups are open unless the report is switched off (readiness-info).'] };
  } catch (e) { return { ok: false, lines: [e && e.message ? e.message : 'The PDF was refused.', 'Nothing was changed.'] }; }
}

async function readinessInfo(store) {
  const R = require('../lib/readiness.js');
  const A = store.adapter;
  const info = await R.pdfInfo(A);
  const off = await R.isOff(A);
  const lines = ['State of AI Readiness report.', ''];
  lines.push('Stored PDF       ' + (info ? info.name + ', ' + info.bytes + ' bytes, uploaded ' + info.uploadedAt.slice(0, 10) + ', sha256 ' + info.sha256 : 'none (signups answer "not available")'));
  const ok = info ? !!(await R.getPdf(A)) : false;
  if (info) lines.push('Integrity        ' + (ok ? 'the stored bytes match the hash' : 'THE STORED BYTES DO NOT MATCH THE HASH: upload the PDF again'));
  lines.push('Switch           ' + (off ? 'OFF (signups and downloads are refused)' : 'on'));
  lines.push('Open             ' + (info && ok && !off ? 'yes' : 'no'));
  const people = await R.list(A);
  lines.push('Addresses        ' + people.length + ' (' + people.filter((p) => p.updates).length + ' also chose occasional updates)');
  const rows = await Stats.read(store, 7);
  const sum = (m) => rows.reduce((n, r) => n + r.counts[m], 0);
  lines.push('Last 7 days      ' + sum('readiness_signups') + ' requests, ' + sum('readiness_emails') + ' emails, ' + sum('readiness_throttled') + ' throttled, ' + sum('readiness_downloads') + ' downloads, ' + sum('readiness_removed') + ' removals');
  return lines;
}

async function readinessSwitch(store, mode) {
  const R = require('../lib/readiness.js');
  if (mode === 'on') { await R.setOff(store.adapter, false); return { ok: true, lines: ['The report is switched ON (it is open only while a PDF is stored: see readiness-info).'] }; }
  if (mode === 'off') { await R.setOff(store.adapter, true); return { ok: true, lines: ['The report is switched OFF. The form says it is not available, and download links answer "not available" until you run: readiness on'] }; }
  return { ok: false, lines: ['Usage: node scripts/pro-admin.js readiness on | off'] };
}

async function readinessExport(store) {
  const R = require('../lib/readiness.js');
  const cell = (v) => { let t = String(v === undefined || v === null ? '' : v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const rows = await R.list(store.adapter);
  const csv = ['email,createdAt,consentVersion,updates'].concat(rows.map((r) => [r.email, r.createdAt, r.consentVersion, r.updates ? 'yes' : 'no'].map(cell).join(','))).join('\n');
  return { csv: csv, count: rows.length, withUpdates: rows.filter((r) => r.updates).length };
}

// By address, with no secret: each record's own address is compared, as waitlist-remove does.
async function readinessRemove(store, email, yes) {
  const R = require('../lib/readiness.js');
  const want = R.normalizeEmail(email);
  if (!want || want.indexOf('@') === -1) return { ok: false, lines: ['Give the address to remove: readiness-remove name@example.com. Nothing was changed.'] };
  const A = store.adapter;
  const found = [];
  for (const id of await A.smembers('sr:index')) { const h = await A.hgetall('sr:e:' + id); if (h && R.normalizeEmail(h.email) === want) found.push(id); }
  if (!found.length) return { ok: true, lines: ['No report-list entry for that address. Nothing was changed.'] };
  if (!yes) return { ok: true, lines: ['One report-list entry matches that address. Nothing was changed. Run the same command with --yes to remove it.'] };
  for (const id of found) await R.removeId(A, id);
  return { ok: true, lines: ['Removed ' + found.length + ' report-list entry. Download links sent to it no longer work.'] };
}

async function readinessPdfDelete(store, yes) {
  const R = require('../lib/readiness.js');
  if (!(await R.pdfInfo(store.adapter))) return { ok: true, lines: ['No PDF is stored. Nothing was changed.'] };
  if (!yes) return { ok: true, lines: ['A PDF is stored. Nothing was changed. Run the same command with --yes to delete it.'] };
  await R.removePdf(store.adapter);
  return { ok: true, lines: ['The stored PDF is deleted. The form and the download links answer "not available" until you upload one again.'] };
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
  lines.push('Report list       ' + sum('readiness_signups') + ' requests, ' + sum('readiness_emails') + ' report emails, ' + sum('readiness_downloads') + ' downloads, ' + sum('readiness_removed') + ' removals (counters, today and yesterday UTC)');
  lines.push('Refunds           ' + sum('payments_refunded') + ' links cancelled by a refund' + (review.length ? '; ' + review.length + ' order(s) flagged for your review (run list)' : ''));
  const bad = jobs.filter((j) => j.status === 'failed').length + sum('webhook_rejected') + sum('webhook_errors') + sum('mail_failed') + review.length;
  lines.push('', bad ? 'Needs a look: ' + bad + ' item(s) above.' : 'Nothing needs attention.');
  return lines;
}

const usd = (micro) => '$' + (micro / 1e6).toFixed(4);

async function kill(store, mode) {
  const Budget = require('../lib/citation-budget.js');
  if (mode === 'on') { await Budget.setKill(store, true); return { ok: true, lines: ['Citation kill switch is ON. No paid citation call will be made from now on, and reports in progress finish without them. Turn it off with: node scripts/pro-admin.js kill off'] }; }
  if (mode === 'off') { await Budget.setKill(store, false); return { ok: true, lines: ['Citation kill switch is OFF in Redis. (CITATION_KILL=1 in the Vercel environment, if set, still stops everything.)'] }; }
  if (mode === 'status') { const flag = (await store.adapter.get(Budget.KILL)) === '1'; return { ok: true, lines: ['Kill switch in Redis: ' + (flag ? 'ON' : 'off') + '. CITATION_KILL in this shell\'s environment: ' + (process.env.CITATION_KILL === '1' ? 'set' : 'not set') + ' (the Vercel value cannot be read from here).'] }; }
  return { ok: false, lines: ['Usage: node scripts/pro-admin.js kill on | off | status'] };
}

async function spend(store) {
  const Budget = require('../lib/citation-budget.js');
  const x = await Budget.summary(store, process.env, Date.now());
  const lines = ['Paid citation calls, UTC. Aggregate numbers only (no report, site or person).', '', pad('PROVIDER', 14) + pad('TODAY CALLS', 13) + pad('TODAY COST', 13) + pad('MONTH CALLS', 13) + 'MONTH COST'];
  let dc = 0, dm = 0, mc = 0, mm = 0;
  x.rows.forEach((r) => { dc += r.dayCalls; dm += r.dayMicro; mc += r.monthCalls; mm += r.monthMicro; lines.push(pad(r.provider === 'generate' ? 'questions' : r.provider, 14) + pad(r.dayCalls, 13) + pad(usd(r.dayMicro), 13) + pad(r.monthCalls, 13) + usd(r.monthMicro)); });
  lines.push(pad('TOTAL', 14) + pad(dc, 13) + pad(usd(dm), 13) + pad(mc, 13) + usd(mm));
  lines.push('', 'Budget today: ' + usd(x.reservedDayMicro) + ' counted of ' + usd(x.dailyBudgetMicro) + ' (the counter includes calls in flight at their worst-case estimate). This month: ' + usd(x.reservedMonthMicro) + ' of ' + usd(x.monthlyBudgetMicro) + '.');
  lines.push('(The budgets shown are the ones set in this shell\'s environment, or the defaults; Vercel\'s values cannot be read from here.)');
  lines.push('Kill switch: ' + (x.killed ? 'ON (no paid call will be made)' : 'off') + '.');
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
  if (cmd === 'readiness-upload') { const r = await readinessUpload(store, argv[1]); return { code: r.ok ? 0 : 1, lines: r.lines }; }
  if (cmd === 'readiness-info') return { code: 0, lines: await readinessInfo(store) };
  if (cmd === 'readiness') { const r = await readinessSwitch(store, argv[1]); return { code: r.ok ? 0 : 1, lines: r.lines }; }
  if (cmd === 'readiness-export') { const r = await readinessExport(store); return { code: 0, lines: [r.csv], note: r.count + ' address(es), ' + r.withUpdates + ' with the updates box ticked.' }; }
  if (cmd === 'readiness-remove') { const r = await readinessRemove(store, argv[1], argv.indexOf('--yes') !== -1); return { code: r.ok ? 0 : 1, lines: r.lines }; }
  if (cmd === 'readiness-pdf-delete') { const r = await readinessPdfDelete(store, argv.indexOf('--yes') !== -1); return { code: r.ok ? 0 : 1, lines: r.lines }; }
  if (cmd === 'health') return { code: 0, lines: await health(store) };
  if (cmd === 'kill') { const r = await kill(store, argv[1]); return { code: r.ok ? 0 : 1, lines: r.lines }; }
  if (cmd === 'spend') return { code: 0, lines: await spend(store) };
  return { code: 1, lines: ['Usage: node scripts/pro-admin.js list | revoke <prefix> | clear-review <prefix> | stats [--days N] | feedback | purge --label "<label>" [--yes] | waitlist-remove <email> [--yes] | readiness-upload <file> | readiness-info | readiness on|off | readiness-export | readiness-remove <email> [--yes] | readiness-pdf-delete --yes | health | kill on|off|status | spend'] };
}

async function main() {
  const argv = process.argv.slice(2);
  require('./env-local.js').load();
  const S = require('../lib/pro-store.js');
  if (!S.hasRedisEnv()) { console.error('No Redis connection found. Put the Upstash variables in .env.local (see docs/pilot.md).'); process.exit(1); }
  const r = await run(S.createStore(S.adapterFromEnv()), argv);
  r.lines.forEach((l) => (r.code ? console.error(l) : console.log(l)));
  if (r.note) console.error(r.note);
  process.exit(r.code);
}

module.exports = { kill: kill, spend: spend, run: run, list: list, revoke: revoke, stats: stats, feedback: feedback, purge: purge, waitlistRemove: waitlistRemove, health: health, readinessUpload: readinessUpload, readinessInfo: readinessInfo, readinessSwitch: readinessSwitch, readinessExport: readinessExport, readinessRemove: readinessRemove, readinessPdfDelete: readinessPdfDelete };
if (require.main === module) main().catch(function (e) { console.error(e && e.message ? e.message : e); process.exit(1); });
