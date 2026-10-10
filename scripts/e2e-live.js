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
     6. /api/pro/email: "not configured" and no button when the mail variables are unset; with the mail
        variables in .env.local, one real send to the test contact, the limit of 3, nothing about the address
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
const created = { tokens: [], jobs: [] };

async function http(method, path, body, extra) {
  const res = await fetch(BASE + path, Object.assign({ method: method, redirect: 'manual', headers: Object.assign({ Accept: '*/*' }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }, extra || {}));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* html */ }
  return { status: res.status, headers: res.headers, text: text, json: json };
}

async function cleanup() {
  const keys = [];
  for (const tok of created.tokens) keys.push('pro:order:' + tok, 'pro:order-claim:' + tok);
  for (const id of created.jobs) keys.push('pro:job:' + id, 'pro:job:' + id + ':pages', 'pro:job:' + id + ':lock', 'pro:job-order:' + id);
  for (const k of keys) await adapter.del(k);
  let left = 0; for (const k of keys) left += await adapter.exists(k);
  return { n: keys.length, left: left };
}

(async function main() {
  out('End-to-end against ' + BASE + ', target ' + SITE);
  const first = await orders.issueOrder(store); created.tokens.push(first.order.token);
  const tok = first.order.token;
  t('a token was issued and its link is on the right host', first.url.indexOf('/pro/start/' + tok) !== -1);

  // 2. the start page, from the function
  const page = await http('GET', '/pro/start/' + tok);
  t('GET /pro/start/<token>: 200 and the form', page.status === 200 && /id="psForm"/.test(page.text), String(page.status));
  t('the start page is noindex and sends no referrer', /noindex/.test(page.headers.get('x-robots-tag') || '') && page.headers.get('referrer-policy') === 'no-referrer');
  t('it is served by the function, not the static fallback copy (no redirect, no static-file headers, no-store)', page.status === 200 && !page.headers.get('content-disposition') && !page.headers.get('accept-ranges') && /no-store/.test(page.headers.get('cache-control') || ''), JSON.stringify({ cd: page.headers.get('content-disposition'), ar: page.headers.get('accept-ranges'), cc: page.headers.get('cache-control') }));
  const order = await http('GET', '/api/pro/order?token=' + tok);
  t('/api/pro/order says ready', order.status === 200 && order.json && order.json.state === 'ready');

  // 3. start and run
  const bad = await http('POST', '/api/pro/start', { token: tok, site: 'http://169.254.169.254/', name: CONTACT.name, email: CONTACT.email, consent: true });
  t('a start with an internal address is refused and does not spend the token', bad.status === 400 && bad.json && bad.json.fields && !!bad.json.fields.site && (await store.getOrder(tok)).status === 'unused');
  const start = await http('POST', '/api/pro/start', { token: tok, site: SITE, name: CONTACT.name, email: CONTACT.email, consent: true });
  t('POST /api/pro/start answers 200 with a job id', start.status === 200 && start.json && /^[a-f0-9]{32}$/.test(start.json.jobId), start.status + ' ' + start.text.slice(0, 120));
  if (!start.json || !start.json.jobId) { const c = await cleanup(); out('stopped early; cleaned ' + c.n + ' keys, ' + c.left + ' left'); process.exit(1); }
  const id = start.json.jobId; created.jobs.push(id);
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
  t('no email button when the mail provider is not configured', /data-action="email"/.test(report.text) === !!(process.env.RESEND_API_KEY && process.env.PRO_MAIL_FROM));
  const unknown = await http('GET', '/r/' + 'f'.repeat(32) + '/');
  t('an unknown report id gets the generic 404', unknown.status === 404 && /This report is not available/.test(unknown.text));

  // 5. the used token and another one
  const reload = await http('GET', '/pro/start/' + tok);
  t('the used token redirects to its own report (302)', reload.status === 302 && reload.headers.get('location') === '/r/' + id + '/', reload.status + ' ' + reload.headers.get('location'));
  const second = await orders.issueOrder(store); created.tokens.push(second.order.token);
  const other = await http('GET', '/pro/start/' + second.order.token);
  t('a second, unused token shows its form and never mentions the first report', other.status === 200 && other.text.indexOf(id) === -1 && other.headers.get('location') === null);
  const badTok = await http('GET', '/pro/start/' + 'a'.repeat(32));
  t('an unknown token gets the generic page', badTok.status === 404 && /This link is not available/.test(badTok.text));

  // 6. email
  const mail = await http('POST', '/api/pro/email', { id: id, to: 'someone-else@example.org' });
  if (!process.env.RESEND_API_KEY || !process.env.PRO_MAIL_FROM) {
    t('/api/pro/email answers "not configured" while the mail variables are unset', mail.status === 503 && mail.json && mail.json.error === 'not_configured', mail.status + ' ' + mail.text.slice(0, 80));
  } else {
    t('/api/pro/email sent, and the response never reveals the address', mail.status === 200 && mail.text.indexOf('@') === -1 && /Sent to the address you gave us/.test(mail.text), mail.status + ' ' + mail.text.slice(0, 80));
    const m2 = await http('POST', '/api/pro/email', { id: id }); const m3 = await http('POST', '/api/pro/email', { id: id }); const m4 = await http('POST', '/api/pro/email', { id: id });
    t('the third send works and the fourth is refused (limit of 3)', m2.status === 200 && m3.status === 200 && m4.status === 429 && (await store.getOrder(tok)).emailSends === 3, [m2.status, m3.status, m4.status].join());
    out('      one real message was sent to the project contact address; check the inbox');
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
