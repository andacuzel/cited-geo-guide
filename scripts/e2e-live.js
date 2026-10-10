#!/usr/bin/env node
/* =====================================================================
   scripts/e2e-live.js (node scripts/e2e-live.js [--base <url>] [--site <domain>])

   One Pro report, start to finish, against the real deployment (default https://getcitehound.com) with our own
   site as the target. It writes to the real Redis the deployment uses, so it needs the Upstash credentials
   (environment or the gitignored .env.local) and exits 2 without them.

     1. issue an order token (the way scripts/pro-issue-token.js does)
     2. GET /pro/start/<token>: 200, the form, served by the function (not the static fallback copy)
     3. POST /api/pro/start, then POST /api/pro/step until the job is finished
     4. GET /r/<id>/: the report, with the estimate section, noindex and no referrer
     5. GET /pro/start/<token> again: a 302 to this link's own report; a second, unused token does not
        lead anywhere near that report
     6. /api/pro/email: whether the deployment can send mail is read from the deployment itself. Not configured:
        503 and no button. Configured: one real send to the test contact, the limit of 3 (the counter is raised
        to 3 instead of sending two more), nothing about the address
     7. delete everything this run wrote (order, claim, reverse key, job, pages, lock) and check it is gone

   The contact used is the project's own address (hey@getcitehound.com). No value from .env.local is printed.
   ===================================================================== */

'use strict';

require('./env-local.js').load();
const S = require('../lib/pro-store.js');
const orders = require('../lib/pro-orders.js');

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i === -1 ? d : args[i + 1]; };
const BASE = val('--base', 'https://getcitehound.com').replace(/\/$/, '');
const SITE = val('--site', 'getcitehound.com');
const CONTACT = { name: 'Citehound test', email: 'hey@getcitehound.com' };

const out = (s) => process.stdout.write(s + '\n');
let pass = 0; const fails = [];
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!S.hasRedisEnv()) { out('No Upstash credentials found (environment or .env.local). Nothing was done.'); process.exit(2); }

const store = S.createStore(S.adapterFromEnv());
const adapter = store.adapter;
const created = { tokens: [], jobs: [], waitlistIds: [], feedback: [] };
const Stats = require('../lib/pro-stats.js');
const bumps = {}; // the daily counters this run moved, put back at the end
const bump = (m, n) => { bumps[m] = (bumps[m] || 0) + (n === undefined ? 1 : n); };

async function http(method, path, body, extra) {
  const res = await fetch(BASE + path, Object.assign({ method: method, redirect: 'manual', headers: Object.assign({ Accept: '*/*' }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }, extra || {}));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* html */ }
  return { status: res.status, headers: res.headers, text: text, json: json };
}

async function cleanup() {
  const keys = [];
  for (const id of created.waitlistIds) keys.push('wl:e:' + id, 'wl:mail:' + id);
  for (const id of created.feedback) keys.push('pro:feedback:' + id);
  for (const tok of created.tokens) keys.push('pro:order:' + tok, 'pro:order-claim:' + tok);
  for (const id of created.jobs) keys.push('pro:job:' + id, 'pro:job:' + id + ':pages', 'pro:job:' + id + ':lock', 'pro:job-order:' + id);
  for (const k of keys) await adapter.del(k);
  for (const id of created.waitlistIds) await adapter.srem('wl:index', id);
  for (const id of created.feedback) await adapter.srem('pro:feedback-index', id);
  for (const tok of created.tokens) await adapter.srem('pro:orders', tok);
  for (const m of Object.keys(bumps)) if (bumps[m]) await adapter.hincrby('pro:stats:' + Stats.dayOf(), m, -bumps[m]);
  if (bumps.waitlist_emails) await adapter.decr('wl:cap:' + Stats.dayOf());
  let left = 0; for (const k of keys) left += await adapter.exists(k);
  return { n: keys.length, left: left };
}

(async function main() {
  out('End-to-end against ' + BASE + ', target ' + SITE);
  const first = await orders.issueOrder(store, { source: 'pilot', label: 'e2e test', validDays: 1 }); created.tokens.push(first.order.token); bump('orders_pilot');
  const tok = first.order.token;
  t('a token was issued and its link is on the right host', first.url.indexOf('/pro/start/' + tok) !== -1);

  // 2. the start page, from the function
  const page = await http('GET', '/pro/start/' + tok);
  t('GET /pro/start/<token>: 200 and the form', page.status === 200 && /id="psForm"/.test(page.text), String(page.status));
  t('the start page is noindex and sends no referrer', /noindex/.test(page.headers.get('x-robots-tag') || '') && page.headers.get('referrer-policy') === 'no-referrer');
  t('it is served by the function, not the static fallback copy (no redirect, no static-file headers, no-store)', page.status === 200 && !page.headers.get('content-disposition') && !page.headers.get('accept-ranges') && /no-store/.test(page.headers.get('cache-control') || ''), JSON.stringify({ cd: page.headers.get('content-disposition'), ar: page.headers.get('accept-ranges'), cc: page.headers.get('cache-control') }));
  const order = await http('POST', '/api/pro/order', { token: tok });
  t('/api/pro/order says ready', order.status === 200 && order.json && order.json.state === 'ready');

  // 3. start and run
  const bad = await http('POST', '/api/pro/start', { token: tok, site: 'http://169.254.169.254/', name: CONTACT.name, email: CONTACT.email, consent: true });
  t('a start with an internal address is refused and does not spend the token', bad.status === 400 && bad.json && bad.json.fields && !!bad.json.fields.site && (await store.getOrder(tok)).status === 'unused');
  const start = await http('POST', '/api/pro/start', { token: tok, site: SITE, name: CONTACT.name, email: CONTACT.email, consent: true });
  t('POST /api/pro/start answers 200 with a job id', start.status === 200 && start.json && /^[a-f0-9]{32}$/.test(start.json.jobId), start.status + ' ' + start.text.slice(0, 120));
  if (!start.json || !start.json.jobId) { const c = await cleanup(); out('stopped early; cleaned ' + c.n + ' keys, ' + c.left + ' left'); process.exit(1); }
  const id = start.json.jobId; created.jobs.push(id); bump('jobs_started');
  const again = await http('POST', '/api/pro/start', { token: tok, site: SITE, name: CONTACT.name, email: CONTACT.email, consent: true });
  t('submitting the same token again returns the same job, not a second one', again.status === 200 && again.json.jobId === id && again.json.duplicate === true);

  let last = null; const begun = Date.now();
  for (let i = 0; i < 120; i++) {
    const r = await http('POST', '/api/pro/step?id=' + id);
    last = r.json;
    if (!last || r.status !== 200) { t('step ' + i + ' answered', false, r.status + ' ' + r.text.slice(0, 100)); break; }
    if (last.status === 'done' || last.status === 'partial' || last.status === 'failed') break;
    if (last.busy) await sleep(1500);
    if (Date.now() - begun > 8 * 60 * 1000) break;
  }
  if (last && (last.status === 'done' || last.status === 'partial')) bump('jobs_' + last.status);
  t('the crawl finished', last && (last.status === 'done' || last.status === 'partial'), JSON.stringify(last && { s: last.status, p: last.progress, r: last.reason }));
  out('      ' + (last && last.progress ? last.progress.done + ' pages read, ' + last.progress.blocked + ' blocked, ' + last.progress.failed + ' not read' : '') + ' in ' + Math.round((Date.now() - begun) / 1000) + ' s');
  const status = await http('GET', '/api/pro/status?id=' + id);
  t('status says finished and carries the report path, and no contact data', status.json && /^\/r\//.test(status.json.reportPath || '') && status.text.indexOf(CONTACT.email) === -1 && status.text.indexOf('Citehound test') === -1);

  // 4. the report
  const report = await http('GET', '/r/' + id + '/');
  t('GET /r/<id>/: 200, noindex, no referrer, no-store', report.status === 200 && /noindex/.test(report.headers.get('x-robots-tag') || '') && report.headers.get('referrer-policy') === 'no-referrer' && /no-store/.test(report.headers.get('cache-control') || ''), String(report.status));
  const fig = (k) => { const m = new RegExp('data-fig="' + k + '">([^<]*)<').exec(report.text); return m ? m[1] : null; };
  t('the report has a score, three parts and the estimate last', /id="pr-summary"/.test(report.text) && /id="pr-details"/.test(report.text) && report.text.indexOf('id="pr-estimate"') > report.text.indexOf('id="pr-details"') && fig('pr-score') !== null);
  t('the estimate section is there with its heading and note', />Estimated score if you apply these fixes<\/h2>/.test(report.text) && /Estimated from Citehound's scoring rules\. It measures readiness, not how often assistants mention you\./.test(report.text) || /No change to the pages or the site files would raise the score/.test(report.text));
  const now = fig('pr-est-now'), fin = fig('pr-est-final');
  if (now !== null) t('the estimate is not below the current score', parseFloat(fin) >= parseFloat(now), now + ' / ' + fin);
  t('the report page carries no contact data', report.text.indexOf(CONTACT.email.split('@')[0] + '@') === -1 && report.text.indexOf('Citehound test') === -1);
  const unknown = await http('GET', '/r/' + 'f'.repeat(32) + '/');
  t('an unknown report id gets the generic 404', unknown.status === 404 && /This report is not available/.test(unknown.text));

  // 5. the used token and another one
  const reload = await http('GET', '/pro/start/' + tok);
  t('the used token redirects to its own report (302)', reload.status === 302 && reload.headers.get('location') === '/r/' + id + '/', reload.status + ' ' + reload.headers.get('location'));
  const second = await orders.issueOrder(store, { source: 'pilot', label: 'e2e test', validDays: 1 }); created.tokens.push(second.order.token); bump('orders_pilot');
  const other = await http('GET', '/pro/start/' + second.order.token);
  t('a second, unused token shows its form and never mentions the first report', other.status === 200 && other.text.indexOf(id) === -1 && other.headers.get('location') === null);
  const badTok = await http('GET', '/pro/start/' + 'a'.repeat(32));
  t('an unknown token gets the generic page', badTok.status === 404 && /This link is not available/.test(badTok.text));

  // 6. email. Whether the deployment can send mail is read from the deployment itself (its own variables, not ours).
  const hasButton = /data-action="email"/.test(report.text);
  const mail = await http('POST', '/api/pro/email', { id: id, to: 'someone-else@example.org' });
  const liveMail = mail.status !== 503;
  t('the report shows its email button exactly when the deployment can send mail', hasButton === liveMail, 'button ' + hasButton + ', send answered ' + mail.status);
  if (!liveMail) {
    t('/api/pro/email answers "not configured" while the mail variables are unset', mail.json && mail.json.error === 'not_configured', mail.status + ' ' + mail.text.slice(0, 80));
  } else {
    t('/api/pro/email sent once, to the address on the order, and the response never reveals an address', mail.status === 200 && mail.text.indexOf('@') === -1 && /Sent to the address you gave us/.test(mail.text), mail.status + ' ' + mail.text.slice(0, 80));
    bump('report_emails');
    t('the first send reports 2 left (limit of 3)', mail.json && mail.json.remaining === 2);
    t('the order counts exactly one send', (await store.getOrder(tok)).emailSends === 1);
    // The limit itself is proved without sending two more real messages: set the counter to the limit, then ask again.
    await adapter.hset('pro:order:' + tok, { emailSends: '3' });
    const over = await http('POST', '/api/pro/email', { id: id });
    t('at 3 sends the next request is refused (429) and says nothing about the address', over.status === 429 && over.json && over.json.error === 'email_limit' && over.text.indexOf('@') === -1, over.status + ' ' + over.text.slice(0, 80));
    t('a refused request does not change the count', (await store.getOrder(tok)).emailSends === 3);
    out('      one real message was sent to the project contact address; check the inbox (the link in it points at a report this run then deletes)');
  }

  // 6b. feedback on the finished report
  const fb = await http('POST', '/api/pro/feedback', { id: id, rating: 5, text: 'End-to-end test, please ignore.' });
  created.feedback.push(id); if (fb.status === 200) bump('feedback');
  t('feedback on the finished report is accepted and stored under the job id with no contact data', fb.status === 200 && (await adapter.hget('pro:feedback:' + id, 'rating')) === '5' && JSON.stringify(await adapter.hgetall('pro:feedback:' + id)).indexOf('hey@') === -1);
  const fb2 = await http('POST', '/api/pro/feedback', { id: id, rating: 1, text: 'second' });
  t('a second answer gets the same thanks and changes nothing', fb2.text === fb.text && (await adapter.hget('pro:feedback:' + id, 'rating')) === '5');
  t('feedback is kept 90 days', (await adapter.ttl('pro:feedback:' + id)) > 89 * 86400);

  // 6c. the waitlist, with the project's own address (it gets the real confirmation message if the deployment can send mail)
  const wl1 = await http('POST', '/api/waitlist', { email: CONTACT.email, name: 'Citehound test', consent: true });
  if (wl1.status === 200) bump('waitlist_signups');
  const wl2 = await http('POST', '/api/waitlist', { email: ' ' + CONTACT.email.toUpperCase() + ' ', consent: true });
  if (wl2.status === 200) bump('waitlist_signups');
  t('the waitlist signup answers 200 and the same words for the same address typed differently', wl1.status === 200 && wl1.text === wl2.text && wl1.text.indexOf('@') === -1, wl1.status + ' ' + wl1.text.slice(0, 80));
  let found = [];
  for (const wid of await adapter.smembers('wl:index')) { const h = await adapter.hgetall('wl:e:' + wid); if (h && h.email === CONTACT.email) found.push(wid); }
  found.forEach((x) => created.waitlistIds.push(x));
  t('exactly one record exists for it, with email, date and consent version, kept 12 months', found.length === 1 && (await adapter.hget('wl:e:' + found[0], 'createdAt')) !== null && (await adapter.hget('wl:e:' + found[0], 'consentVersion')) !== null && (await adapter.ttl('wl:e:' + found[0])) > 364 * 86400);
  if (found.length === 1) {
    const mailKey = await adapter.ttl('wl:mail:' + found[0]);
    if (liveMail) { bump('waitlist_emails'); t('one confirmation message was handed to the provider (30-day key set), and the second signup sent none', mailKey > 29 * 86400 && mailKey <= 30 * 86400, String(mailKey)); out('      one real confirmation message was sent to the project contact address; check the inbox, its link, and the "Remove me from the list" link'); }
    else t('no mail provider on the deployment: no message reserved', mailKey === -2);
  }

  // 7. clean up
  const c = await cleanup();
  t('cleanup: the ' + c.n + ' keys this run wrote are deleted and gone', c.left === 0, c.left + ' left');
  const gone = await http('GET', '/r/' + id + '/');
  t('the report is gone from the live site after cleanup', gone.status === 404);

  out('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
}()).catch(async (e) => {
  try { const c = await cleanup(); process.stderr.write('cleaned ' + c.n + ' keys, ' + c.left + ' left\n'); } catch (e2) { /* nothing more */ }
  process.stderr.write('The end-to-end run stopped: ' + (e && e.name) + ' ' + String(e && e.message || '').replace(/https?:\/\/\S+/g, '<url>') + '\n');
  process.exit(1);
});
