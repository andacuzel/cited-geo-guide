#!/usr/bin/env node
/* =====================================================================
   scripts/test-pro-admin.js: the pilot tooling.

   scripts/pro-issue-token.js (options, output only links, validation), scripts/pro-admin.js (list, revoke,
   stats, feedback) and the pilot flow itself: an issued link opens the real start page and runs the real
   code path, a pilot order and a paid one behave the same, a revoked link is the generic 404, a failed scan
   gives the link back, and nothing printed shows a full token, an email address or a name.

     node scripts/test-pro-admin.js
   ===================================================================== */

'use strict';

process.env.PRO_HASH_SECRET = 'test-only-secret-0123456789abcdef';
const S = require('../lib/pro-store.js');
const api = require('../lib/pro-api.js');
const Issue = require('./pro-issue-token.js');
const Admin = require('./pro-admin.js');
const Stats = require('../lib/pro-stats.js');
const site = require('../lib/site-config.js');

let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
['log', 'warn', 'error', 'info'].forEach((k) => { console[k] = function () {}; });

let ipc = 0;
function call(fn, o, deps) {
  o = o || {}; o.ip = o.ip || '10.9.' + Math.floor(ipc / 250) + '.' + (ipc++ % 250);
  return new Promise((resolve, reject) => {
    const headers = {};
    const req = { method: o.method || 'GET', url: '/', headers: { 'x-forwarded-for': o.ip, 'content-type': 'application/json' }, query: o.query || {}, body: o.body, socket: {} };
    const res = { statusCode: 200, setHeader: (k, v) => { headers[k.toLowerCase()] = v; }, end: (b) => { let json = null; try { json = JSON.parse(b); } catch (e) { /* html */ } resolve({ status: res.statusCode, headers, body: b, json }); } };
    Promise.resolve(fn(req, res, deps)).catch(reject);
  });
}
const okHost = async () => ({ ok: true });
function site1(opts) {
  opts = opts || {};
  return async function (url) {
    const p = url.replace('https://example.com', '');
    if (opts.status && p !== '/robots.txt') return { ok: false, status: opts.status, text: 'no', headers: {}, finalUrl: url };
    if (p === '/robots.txt') return { ok: true, status: 200, text: opts.robots || 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n', headers: {}, finalUrl: url };
    if (p === '/sitemap.xml') return { ok: true, status: 200, text: '<urlset>' + ['/', '/a', '/b'].map((x) => '<url><loc>https://example.com' + x + '</loc></url>').join('') + '</urlset>', headers: {}, contentType: 'application/xml', finalUrl: url };
    if (p === '/llms.txt') return { ok: false, status: 404, text: '', headers: {}, finalUrl: url };
    return { ok: true, status: 200, text: '<html lang="en"><head><title>A page on the example site</title></head><body><h1>x</h1></body></html>', contentType: 'text/html', headers: {}, finalUrl: url };
  };
}
const crawlWith = (f) => ({ fetch: f, sleep: async () => {}, now: (() => { let c = 1e9; return () => (c += 1100); })() });
const GOOD = (token) => ({ token: token, site: 'example.com', name: 'Grace Hopper', email: 'grace.hopper@mail.example.org', consent: true });
async function runToEnd(store, id, crawl) { let last = null; for (let i = 0; i < 20; i++) { last = (await call(api.step, { method: 'POST', query: { id } }, { store, crawl })).json; if (['done', 'partial', 'failed'].indexOf(last.status) !== -1) break; } return last; }

(async function main() {
  /* ---- issuing ---- */
  {
    const d = Issue.parse([]);
    t('issue: defaults are one pilot link valid 14 days', d.errors.length === 0 && d.options.count === 1 && d.options.source === 'pilot' && d.options.expiresDays === 14 && d.options.label === '');
    const p = Issue.parse(['--count', '5', '--label', 'Agency friends', '--expires-days', '30', '--source', 'paid']);
    t('issue: --count, --label, --expires-days and --source are read', p.errors.length === 0 && p.options.count === 5 && p.options.label === 'Agency friends' && p.options.expiresDays === 30 && p.options.source === 'paid');
    const bad = [['--count', '0'], ['--count', '51'], ['--count', 'x'], ['--expires-days', '0'], ['--expires-days', '91'], ['--source', 'gift'], ['--label', 'x'.repeat(61)], ['--label', 'ada@example.org'], ['--nope']];
    t('issue: out-of-range, unknown and contact-looking values are refused with a message', bad.every((a) => Issue.parse(a).errors.length >= 1));
    const store = S.createStore(S.memoryAdapter());
    const urls = await Issue.issue(store, Issue.parse(['--count', '3', '--label', 'Pilot A']).options);
    t('issue: three links, each /pro/start/<32 hex> on this site, all different', urls.length === 3 && new Set(urls).size === 3 && urls.every((u) => new RegExp('^' + site.baseUrl.replace(/[.]/g, '\\.') + '/pro/start/[0-9a-f]{32}$').test(u)));
    const orders = await store.listOrders();
    t('issue: all three carry the label and the pilot source, and live 14 days', orders.length === 3 && orders.every((o) => o.label === 'Pilot A' && o.source === 'pilot' && o.validDays === 14) && (await store.adapter.ttl('pro:order:' + orders[0].token)) <= 14 * 86400);
    const cp = require('child_process').spawnSync(process.execPath, [require('path').join(__dirname, 'pro-issue-token.js'), '--memory', '--count', '2'], { encoding: 'utf8' });
    t('issue (the real command): stdout is exactly the links, one per line, nothing else', cp.status === 0 && cp.stdout.trim().split('\n').length === 2 && cp.stdout.trim().split('\n').every((l) => /^https:\/\/[^\s]+\/pro\/start\/[0-9a-f]{32}$/.test(l)), cp.stdout);
    const cb = require('child_process').spawnSync(process.execPath, [require('path').join(__dirname, 'pro-issue-token.js'), '--memory', '--count', '99'], { encoding: 'utf8' });
    t('issue (the real command): a bad option exits 1 and prints nothing on stdout', cb.status === 1 && cb.stdout === '' && /--count/.test(cb.stderr));
  }

  /* ---- the pilot flow: the real code path ---- */
  {
    const store = S.createStore(S.memoryAdapter());
    const [pilotUrl] = await Issue.issue(store, Issue.parse(['--label', 'Pilot']).options);
    const orders = require('../lib/pro-orders.js');
    const paid = await orders.issueOrder(store, { source: 'paid' });
    const token = pilotUrl.split('/').pop();
    const page = await call(api.startPage, { query: { token } }, { store });
    t('pilot: the issued link opens the real start page', page.status === 200 && /id="psForm"/.test(page.body));
    const s1 = await call(api.start, { method: 'POST', body: GOOD(token) }, { store, checkHost: okHost });
    const s2 = await call(api.start, { method: 'POST', body: GOOD(paid.order.token) }, { store, checkHost: okHost });
    t('pilot: a pilot link and a paid link both start a job the same way', s1.status === 200 && s2.status === 200 && /^[0-9a-f]{32}$/.test(s1.json.jobId) && /^[0-9a-f]{32}$/.test(s2.json.jobId));
    const e1 = await runToEnd(store, s1.json.jobId, crawlWith(site1())), e2 = await runToEnd(store, s2.json.jobId, crawlWith(site1()));
    const r1 = await call(api.report, { query: { id: s1.json.jobId } }, { store }), r2 = await call(api.report, { query: { id: s2.json.jobId } }, { store });
    t('pilot: both finish and both reports render through the same renderer', e1.status === e2.status && ['done', 'partial'].indexOf(e1.status) !== -1 && r1.status === 200 && r2.status === 200 && /id="pr-summary"/.test(r1.body) && /id="pr-summary"/.test(r2.body));
    t('pilot: the pilot report shows the feedback form and no sign of being a pilot', /id="fbForm"/.test(r1.body) && !/pilot/i.test(r1.body.replace(/<script[\s\S]*?<\/script>/g, '')));
    const days = (await Stats.read(store, 1))[0].counts;
    t('stats: orders by source, jobs started and finished', days.orders_pilot === 1 && days.orders_paid === 1 && days.jobs_started === 2 && days.jobs_done + days.jobs_partial === 2);
  }

  /* ---- failed jobs give the link back (zero pages read), partial jobs do not ---- */
  {
    const store = S.createStore(S.memoryAdapter());
    const cases = [
      ['robots.txt forbids everything', crawlWith(site1({ robots: 'User-agent: *\nDisallow: /\n' }))],
      ['the site answers 403 to every page', crawlWith(site1({ status: 403 }))],
      ['the site answers 429 before the first page', crawlWith(site1({ status: 429 }))]
    ];
    for (const [name, crawl] of cases) {
      const o = await store.createOrder({ source: 'pilot', label: 'R' });
      const s = await call(api.start, { method: 'POST', body: GOOD(o.token) }, { store, checkHost: okHost });
      const end = await runToEnd(store, s.json.jobId, crawl);
      const after = await store.getOrder(o.token);
      const view = await call(api.status, { query: { id: s.json.jobId } }, { store });
      const page = await call(api.report, { query: { id: s.json.jobId } }, { store });
      const again = await call(api.order, { method: 'POST', body: { token: o.token } }, { store });
      t('restore (' + name + '): the job fails, the link is unused again, the contact is kept', end.status === 'failed' && after.status === 'unused' && after.restores === 1 && after.contact && after.contact.email === 'grace.hopper@mail.example.org');
      t('restore (' + name + '): the failed page says "We couldn’t scan this site. Your link is still valid, try again or use a different site."', /We couldn’t scan this site\. Your link is still valid, try again or use a different site\./.test(page.body) && view.json.linkRestored === true);
      t('restore (' + name + '): asking about the restored link never mentions the failed job\'s id', again.json.state === 'ready' && again.body.indexOf(s.json.jobId) === -1 && (await call(api.startPage, { query: { token: o.token } }, { store })).body.indexOf(s.json.jobId) === -1);
    }
    const o = await store.createOrder();
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const s = await call(api.start, { method: 'POST', body: GOOD(o.token) }, { store, checkHost: okHost });
      if (s.status !== 200) { ids.push('refused'); break; }
      await runToEnd(store, s.json.jobId, crawlWith(site1({ status: 403 })));
      ids.push((await store.getOrder(o.token)).status);
    }
    t('restore: at most 3 times per order, then the link stays spent', JSON.stringify(ids) === JSON.stringify(['unused', 'unused', 'unused', 'used']), JSON.stringify(ids));
    const partialOrder = await store.createOrder();
    const s = await call(api.start, { method: 'POST', body: GOOD(partialOrder.token) }, { store, checkHost: okHost });
    const mixed = async (url) => (/\/a$/.test(url) || /\/b$/.test(url) ? { ok: false, status: 403, text: 'no', headers: {}, finalUrl: url } : site1()(url));
    const pend = await runToEnd(store, s.json.jobId, crawlWith(mixed));
    t('partial: a job that read at least one page keeps its link spent and its report', ['partial', 'done'].indexOf(pend.status) !== -1 && (await store.getOrder(partialOrder.token)).status === 'used' && (await store.getOrder(partialOrder.token)).restores === 0);
    const days = (await Stats.read(store, 1))[0].counts;
    t('stats: failed and restored jobs are counted', days.jobs_failed >= 6 && days.jobs_restored >= 6);
  }

  /* ---- admin ---- */
  {
    const store = S.createStore(S.memoryAdapter());
    const empty = await Admin.run(store, ['list']);
    t('admin list: an empty list says how to issue links', empty.code === 0 && /pro-issue-token/.test(empty.lines.join('\n')));
    const urls = await Issue.issue(store, Issue.parse(['--count', '3', '--label', 'Friends']).options);
    const tokens = urls.map((u) => u.split('/').pop());
    const s = await call(api.start, { method: 'POST', body: GOOD(tokens[0]) }, { store, checkHost: okHost });
    await runToEnd(store, s.json.jobId, crawlWith(site1()));
    const list = await Admin.run(store, ['list']);
    const text = list.lines.join('\n');
    t('admin list: label, source, status, date and job status are shown for every link', /PREFIX/.test(text) && (text.match(/Friends/g) || []).length === 3 && /pilot/.test(text) && /used/.test(text) && /unused/.test(text) && /\b(done|partial)\b/.test(text) && /3 links: 2 unused, 1 used/.test(text), text);
    t('admin list: only the first 8 characters of a token, never an email address or a name', tokens.every((tk) => text.indexOf(tk) === -1 && text.indexOf(tk.slice(0, 8)) !== -1) && !/@|Grace|Hopper/.test(text));
    const short = await Admin.run(store, ['revoke', 'abc']);
    const nope = await Admin.run(store, ['revoke', 'ffffffff']);
    t('admin revoke: a prefix under 6 characters or matching nothing changes nothing', short.code === 1 && nope.code === 1 && (await store.getOrder(tokens[1])).status === 'unused');
    const usedTry = await Admin.run(store, ['revoke', tokens[0].slice(0, 8)]);
    t('admin revoke: a used link is not revoked and the report is left alone', usedTry.code === 1 && /already used/.test(usedTry.lines.join()) && (await call(api.report, { query: { id: s.json.jobId } }, { store })).status === 200);
    const rv = await Admin.run(store, ['revoke', tokens[1].slice(0, 8)]);
    t('admin revoke: an unused link is revoked by its prefix', rv.code === 0 && /Revoked/.test(rv.lines.join()) && (await store.getOrder(tokens[1])).status === 'revoked');
    const page = await call(api.startPage, { query: { token: tokens[1] } }, { store });
    const unknown = await call(api.startPage, { query: { token: 'c'.repeat(32) } }, { store });
    const start = await call(api.start, { method: 'POST', body: GOOD(tokens[1]) }, { store, checkHost: okHost });
    t('admin revoke: the revoked link now behaves exactly like an unknown one, and cannot start a job', page.status === 404 && page.body === unknown.body && start.status !== 200);
    const again = await Admin.run(store, ['revoke', tokens[1].slice(0, 8)]);
    t('admin revoke: doing it twice is harmless', again.code === 0 && /already revoked/.test(again.lines.join()));
    const stats = await Admin.run(store, ['stats', '--days', '3']);
    const st = stats.lines.join('\n');
    t('admin stats: daily totals and a sum, as numbers', stats.code === 0 && /orders pilot 3/.test(st) && /jobs started 1/.test(st) && /TOTAL/.test(st) && /emails sent \(all\)/.test(st), st);
    t('admin stats: a bad --days is refused', (await Admin.run(store, ['stats', '--days', '0'])).code === 1);
    const none = await Admin.run(store, ['feedback']);
    await call(api.handle, { method: 'POST', query: { a: 'feedback' }, body: { id: s.json.jobId, rating: 5, text: 'Very clear.' } }, { store });
    await call(api.handle, { method: 'POST', query: { a: 'feedback' }, body: { id: s.json.jobId, rating: 1, text: 'second answer is ignored' } }, { store });
    const fb = await Admin.run(store, ['feedback']);
    const ft = fb.lines.join('\n');
    t('admin feedback: empty, then the answer with its rating, date, shortened report id and average', /No feedback/.test(none.lines.join()) && /5\/5/.test(ft) && /Very clear\./.test(ft) && ft.indexOf(s.json.jobId) === -1 && ft.indexOf(s.json.jobId.slice(0, 8)) !== -1 && /1 answer\(s\), average 5\.0 of 5/.test(ft) && !/@|Grace/.test(ft), ft);
    t('admin: an unknown command prints the usage and exits 1', (await Admin.run(store, ['nope'])).code === 1);
  }

  /* ---- purge, waitlist-remove, health, review ---- */
  {
    const store = S.createStore(S.memoryAdapter());
    const A = store.adapter;
    const Waitlist = require('../lib/waitlist.js');
    const keep = await store.createOrder({ source: 'pilot', label: 'Real friend' });
    const t1 = await store.createOrder({ source: 'pilot', label: 'Self test' });
    const t2 = await store.createOrder({ source: 'pilot', label: 'Self test' });
    const s1 = await call(api.start, { method: 'POST', body: GOOD(t1.token) }, { store, checkHost: okHost });
    await runToEnd(store, s1.json.jobId, crawlWith(site1()));
    await call(api.handle, { method: 'POST', query: { a: 'feedback' }, body: { id: s1.json.jobId, rating: 4 } }, { store });
    const sk = await call(api.start, { method: 'POST', body: GOOD(keep.token) }, { store, checkHost: okHost });
    await runToEnd(store, sk.json.jobId, crawlWith(site1()));

    const noLabel = await Admin.run(store, ['purge']);
    t('purge: without a label nothing is removed', noLabel.code === 1 && (await store.listOrders()).length === 3);
    const dry = await Admin.run(store, ['purge', '--label', 'Self test']);
    const dryText = dry.lines.join('\n');
    t('purge: without --yes it lists what it would remove and changes nothing', dry.code === 0 && /Would remove 2 order\(s\)/.test(dryText) && /Nothing was changed/.test(dryText) && (await store.listOrders()).length === 3 && (await store.getJob(s1.json.jobId)) !== null);
    t('purge: the dry run shows prefixes only, never a full token, report id, address or name', [t1.token, t2.token, s1.json.jobId].every((x) => dryText.indexOf(x) === -1) && !/@|Grace|Hopper/.test(dryText));
    const real = await Admin.run(store, ['purge', '--label', 'Self test', '--yes']);
    const left = await store.listOrders();
    t('purge --yes: the test orders, their report, its pages, citation record and feedback are gone', real.code === 0 && /Removed 2 order/.test(real.lines.join()) && left.length === 1 && left[0].token === keep.token && (await store.getJob(s1.json.jobId)) === null && (await A.exists('pro:feedback:' + s1.json.jobId)) === 0 && (await A.exists('pro:job:' + s1.json.jobId + ':pages')) === 0 && (await A.exists('pro:job-order:' + s1.json.jobId)) === 0);
    t('purge --yes: an order with another label, and its report, are untouched', (await store.getJob(sk.json.jobId)) !== null && (await store.getOrder(keep.token)).status === 'used');
    t('purge: the label must match exactly (a part of it removes nothing)', /No order has the label/.test((await Admin.run(store, ['purge', '--label', 'Real', '--yes'])).lines.join()) && (await store.listOrders()).length === 1);

    // waitlist
    const rec = await Waitlist.join(A, { email: 'Someone@Example.org', name: 'Someone' });
    await Waitlist.join(A, { email: 'other@example.org', name: '' });
    const nf = await Admin.run(store, ['waitlist-remove', 'nobody@example.org', '--yes']);
    t('waitlist-remove: an address that is not on the list changes nothing', nf.code === 0 && /No waitlist entry/.test(nf.lines.join()) && (await A.smembers('wl:index')).length === 2);
    const dryW = await Admin.run(store, ['waitlist-remove', ' SOMEONE@example.org ']);
    t('waitlist-remove: without --yes it only says one entry matches', /One waitlist entry matches/.test(dryW.lines.join()) && (await A.smembers('wl:index')).length === 2 && dryW.lines.join().indexOf('omeone') === -1);
    const rmW = await Admin.run(store, ['waitlist-remove', ' SOMEONE@example.org ', '--yes']);
    t('waitlist-remove --yes: the entry (typed in another case) is gone from record, mail marker and index, the other stays, the address is never printed', /Removed 1 waitlist entry/.test(rmW.lines.join()) && (await A.exists('wl:e:' + rec.id)) === 0 && (await A.smembers('wl:index')).length === 1 && rmW.lines.join().indexOf('omeone') === -1);
    t('waitlist-remove: a missing or malformed address is refused', (await Admin.run(store, ['waitlist-remove'])).code === 1 && (await Admin.run(store, ['waitlist-remove', 'not-an-address'])).code === 1);

    // health
    await Stats.count(store, 'mail_failed'); await Stats.count(store, 'webhook_rejected'); await Stats.count(store, 'webhook_rejected'); await Stats.count(store, 'waitlist_signups');
    const h = await Admin.run(store, ['health']);
    const ht = h.lines.join('\n');
    t('health: orders, reports started, restored links, webhook and email failures, waitlist signups, all as numbers', h.code === 0 && /Orders issued\s+1/.test(ht) && /Reports started\s+1 /.test(ht) && /Links restored/.test(ht) && /Webhook failures\s+2 rejected/.test(ht) && /Email failures\s+1/.test(ht) && /Waitlist signups\s+1 /.test(ht), ht);
    t('health: failures are called out, and no token, address or name appears', /Needs a look/.test(ht) && !/@|Grace|Hopper/.test(ht) && ht.indexOf(sk.json.jobId) === -1);
    const quiet = await Admin.run(S.createStore(S.memoryAdapter()), ['health']);
    t('health: with nothing wrong it says so', /Nothing needs attention/.test(quiet.lines.join()));

    // review
    await store.flagReview(keep.token, 'partial_refund');
    const lr = (await Admin.run(store, ['list'])).lines.join('\n');
    t('list: an order flagged for review shows "CHECK: partial_refund" and the instruction', /CHECK: partial_refund/.test(lr) && /clear-review/.test(lr));
    t('health: a flagged order is counted', /1 order\(s\) flagged for your review/.test((await Admin.run(store, ['health'])).lines.join()));
    const cl = await Admin.run(store, ['clear-review', keep.token.slice(0, 8)]);
    t('clear-review: removes the flag by prefix', cl.code === 0 && (await store.getOrder(keep.token)).review === '' && (await Admin.run(store, ['clear-review', 'abc'])).code === 1);
  }

  /* ---- an expired link ---- */
  {
    const adapter = S.memoryAdapter();
    let clock = Date.now();
    const store = S.createStore(adapter, { now: () => clock });
    const o = await store.createOrder({ validDays: 14 });
    clock += 15 * 86400000;
    const late = S.createStore(adapter, { now: () => clock });
    const page = await call(api.startPage, { query: { token: o.token } }, { store: late });
    t('an expired pilot link gives the generic page', page.status === 404 && /This link is not available/.test(page.body));
  }

  out('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
}()).catch((e) => { process.stderr.write('The test stopped: ' + (e && e.stack) + '\n'); process.exit(1); });
