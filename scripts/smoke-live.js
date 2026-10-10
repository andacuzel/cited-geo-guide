#!/usr/bin/env node
/* =====================================================================
   scripts/smoke-live.js (npm run smoke): the post-push gate.

     node scripts/smoke-live.js                 wait for the deployment of HEAD to be Ready, then check the live site
     node scripts/smoke-live.js --sha <commit>  wait for that commit instead
     node scripts/smoke-live.js --no-wait       skip the wait (the site is already deployed)
     node scripts/smoke-live.js --base <url>    check another address (default: site.config.json)

   Waiting: the deployment's state comes from the commit status GitHub keeps for it (set by Vercel), polled until it is
   success, failure or error (10 minutes at most). A failed deployment stops the run with the address of its log.

   Then, on the live site:
     - /, /mcp, /sample-report, /pro and /tools answer 200, and the homepage carries the stylesheet version of this
       checkout (so the new files are the ones being served)
     - the MCP endpoint answers tools/list with every tool titled and read-only
     - /r/<bad id> and /pro/start/<bad token> answer 404 with the one generic message, and /api/pro/order, which reaches
       the storage, answers its generic "unavailable" (a storage that is not configured, or down, fails here)
     - /r/* and /pro/start/* send X-Robots-Tag noindex and Referrer-Policy no-referrer
     - sitemap.xml, robots.txt and llms.txt do not list a Pro path
     - the waitlist: GET /api/waitlist is the public Pro switch; a POST without consent is a 400 with the field named; a POST
       with the honeypot filled answers like a signup and stores nothing; /waitlist/remove/<bad token> is the 404 page, with
       noindex and no referrer; no Pro call to action on /, /pro, /citation-tracking or /sample-report is a mailto
     - the pilot token flow, when the Upstash credentials are in the environment or .env.local: a pilot link is issued, its
       start page and order lookup say it is ready, it is revoked and then looks like an unknown link, and it is deleted.
       Without credentials this part says it was skipped.
     - /scan answers a 301 to / ; the MCP endpoint serves a request with no MCP-Protocol-Version header (assumed 2025-03-26) with
       all its tools, answers OPTIONS (204, CORS) and GET (405 with Allow)
     - /pro/welcome is a noindex, no-store page; POST /api/pro/welcome answers "waiting" for an id with no order; an unsigned POST to
       /api/pro/webhook is refused (403, or 503 while PRO_WEBHOOK_SECRET is not set: never a 2xx); a GET on it is 405
     - the About portrait is served, and no page cites the October 2026 rescan (only the July snapshot)
     - fail-closed without PRO_HASH_SECRET cannot be tried on the live site (it would need the secret removed). The live Pro API
       answering normally proves the secret is set; scripts/test-pro-api.js proves what happens when it is not.

   There is no /scan page on this site (the scanner is the homepage), so it is not checked.
   If this fails after a push, fix forward or revert with a normal revert commit, at once.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const site = require('../lib/site-config.js');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i === -1 ? d : args[i + 1]; };
const BASE = String(val('--base', site.baseUrl)).replace(/\/$/, '');
const git = (a) => cp.execFileSync('git', a, { cwd: ROOT }).toString().trim();

const out = (s) => process.stdout.write(s + '\n');
let pass = 0; const fails = [];
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(p, init) {
  const res = await fetch(BASE + p, Object.assign({ redirect: 'manual', headers: { 'User-Agent': 'citehound-smoke/1' } }, init || {}));
  const text = await res.text();
  return { status: res.status, headers: res.headers, text: text };
}

// The repository on GitHub, from the origin remote.
function repoSlug() {
  const url = git(['remote', 'get-url', 'origin']);
  const m = /github\.com[:/]([^/]+\/[^/.]+)(\.git)?$/.exec(url);
  if (!m) throw new Error('origin is not a GitHub address: ' + url.replace(/\/\/[^@]*@/, '//'));
  return m[1];
}

async function waitForDeployment(sha) {
  const slug = repoSlug();
  const deadline = Date.now() + 10 * 60 * 1000;
  let last = '';
  while (Date.now() < deadline) {
    let state = 'pending', link = '';
    try {
      const res = await fetch('https://api.github.com/repos/' + slug + '/commits/' + sha + '/status', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'citehound-smoke/1' } });
      if (res.ok) {
        const j = await res.json();
        const v = (j.statuses || []).filter((s) => /vercel/i.test(s.context))[0];
        state = v ? v.state : 'pending';
        link = v && v.target_url || '';
        if (state !== last) out('  deployment of ' + sha.slice(0, 7) + ': ' + state + (v && v.description ? ' (' + v.description.split(' — ')[0] + ')' : ''));
        last = state;
        if (state === 'success') return { ok: true };
        if (state === 'failure' || state === 'error') return { ok: false, link: link };
      }
    } catch (e) { /* try again */ }
    await sleep(10000);
  }
  return { ok: false, timeout: true };
}

(async function main() {
  out('Smoke test of ' + BASE);
  if (args.indexOf('--no-wait') === -1) {
    const sha = val('--sha', git(['rev-parse', 'HEAD']));
    const d = await waitForDeployment(sha);
    if (!d.ok) { out(d.timeout ? 'The deployment was not Ready after 10 minutes.' : 'The deployment FAILED. Log: ' + (d.link || '(none given)') + '\nFix forward or revert with a normal revert commit.'); process.exit(1); }
  }

  /* ---- pages ---- */
  for (const p of ['/', '/mcp', '/sample-report', '/pro', '/tools']) {
    const r = await get(p);
    t('GET ' + p + ' is 200', r.status === 200, String(r.status));
  }
  const home = await get('/');
  const localCss = /styles\.css\?v=(\d+)/.exec(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  const liveCss = /styles\.css\?v=(\d+)/.exec(home.text);
  t('the live homepage carries this checkout\'s stylesheet version (' + (localCss && localCss[1]) + ')', !!(localCss && liveCss && localCss[1] === liveCss[1]), 'live ' + (liveCss && liveCss[1]));

  /* ---- MCP ---- */
  const mcp = await get('/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'MCP-Protocol-Version': '2025-06-18', 'Mcp-Method': 'tools/list' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  let tools = null; try { tools = JSON.parse(mcp.text).result.tools; } catch (e) { /* reported below */ }
  t('MCP tools/list answers with tools', mcp.status === 200 && Array.isArray(tools) && tools.length >= 13, mcp.status + ' ' + mcp.text.slice(0, 100));
  if (tools) t('every MCP tool has a title and is read-only and non-destructive', tools.every((x) => x.title && x.annotations && x.annotations.readOnlyHint === true && x.annotations.destructiveHint === false), tools.filter((x) => !(x.title && x.annotations && x.annotations.readOnlyHint === true && x.annotations.destructiveHint === false)).map((x) => x.name).join());

  /* ---- Pro: generic answers, headers, storage ---- */
  const hex = 'e'.repeat(32);
  const cases = [['/r/invalid-id', null], ['/r/' + hex + '/', /This report is not available/], ['/pro/start/invalid-token', null], ['/pro/start/' + hex, /This link is not available/]];
  for (const [p, re] of cases) {
    const r = await get(p);
    t('GET ' + p + ' is 404', r.status === 404, String(r.status));
    t('... with noindex and no referrer', /noindex/.test(r.headers.get('x-robots-tag') || '') && r.headers.get('referrer-policy') === 'no-referrer', JSON.stringify({ robots: r.headers.get('x-robots-tag'), ref: r.headers.get('referrer-policy') }));
    if (re) t('... and the one generic message', re.test(r.text) && !/expired|invalid|used|not found/i.test(r.text.replace(/<[^>]+>/g, ' ').replace(/Page Not Found/i, '')), r.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 120));
  }
  const order = await get('/api/pro/order', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'citehound-smoke/1' }, body: JSON.stringify({ token: hex }) });
  const orderGet = await get('/api/pro/order?token=' + hex);
  t('a GET on /api/pro/order is refused (405): a token is never read from an address', orderGet.status === 405, String(orderGet.status));
  t('/api/pro/order reaches the storage and answers "unavailable" for an unknown token', order.status === 404 && /"state":"unavailable"/.test(order.text), order.status + ' ' + order.text.slice(0, 100));
  t('the Pro API answers noindex and no-store', /noindex/.test(order.headers.get('x-robots-tag') || '') && /no-store/.test(order.headers.get('cache-control') || ''));
  const noStep = await get('/api/pro/step?id=' + hex);
  t('a GET on /api/pro/step is refused (405), so a link prefetcher cannot start work', noStep.status === 405, String(noStep.status));

  /* ---- not listed ---- */
  for (const p of ['/sitemap.xml', '/robots.txt', '/llms.txt']) {
    const r = await get(p);
    t(p + ' does not list a Pro path', r.status === 200 && !/\/pro\/start|\/api\/pro|\/r\/[a-f0-9]{16}/.test(r.text), String(r.status));
  }

  /* ---- the waitlist ---- */
  const cfg = await get('/api/waitlist');
  let cfgJson = null; try { cfgJson = JSON.parse(cfg.text); } catch (e) { /* reported below */ }
  t('GET /api/waitlist answers the public Pro switch (checkoutUrl and priceText, no secret)', cfg.status === 200 && cfgJson && 'checkoutUrl' in cfgJson && 'priceText' in cfgJson && Object.keys(cfgJson).length === 2, cfg.status + ' ' + cfg.text.slice(0, 100));
  const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'citehound-smoke/1' }, body: JSON.stringify(body) });
  const noConsent = await get('/api/waitlist', json({ email: 'smoke-test@example.invalid', consent: false }));
  t('a signup without consent is a 400 that names the field and stores nothing', noConsent.status === 400 && /"consent"/.test(noConsent.text), noConsent.status + ' ' + noConsent.text.slice(0, 100));
  const trap = await get('/api/waitlist', json({ email: 'smoke-test@example.invalid', consent: true, company_fax: 'x' }));
  t('a signup with the honeypot filled answers 200 (and stores nothing)', trap.status === 200 && /"ok":true/.test(trap.text), trap.status + ' ' + trap.text.slice(0, 100));
  const badMail = await get('/api/waitlist', json({ email: 'not-an-address', consent: true }));
  t('a signup with a bad address is a 400', badMail.status === 400 && /"email"/.test(badMail.text));
  const foreign = await get('/api/waitlist', Object.assign(json({ email: 'smoke-test@example.invalid', consent: true }), { headers: { 'Content-Type': 'application/json', Origin: 'https://example.invalid', 'User-Agent': 'citehound-smoke/1' } }));
  t('a signup posted from another site is refused (403)', foreign.status === 403, String(foreign.status));
  for (const [method, tok] of [['GET', 'a'.repeat(64)], ['POST', 'a'.repeat(64)], ['GET', 'short']]) {
    const r = await get('/waitlist/remove/' + tok, { method: method });
    t(method + ' /waitlist/remove/<bad token> is the 404 page, noindex, no referrer, no-store', r.status === 404 && /noindex/.test(r.headers.get('x-robots-tag') || '') && r.headers.get('referrer-policy') === 'no-referrer' && /no-store/.test(r.headers.get('cache-control') || ''), String(r.status));
  }
  for (const p of ['/', '/pro', '/citation-tracking', '/sample-report']) {
    const r = await get(p);
    t(p + ' has no mailto call to action for Pro', r.status === 200 && !/mailto:[^"']*[?&](subject|body)=/.test(r.text) && !/Citation(%20| )run(%20| )request/i.test(r.text));
  }
  const pro = await get('/pro');
  t('/pro has the waitlist form with an unchecked consent box and the honeypot', /id="waitlist"/.test(pro.text) && /<input id="wlConsent" name="consent" type="checkbox"(?![^>]*checked)/.test(pro.text) && /name="company_fax"/.test(pro.text) && /Tell me when Citehound Pro opens/.test(pro.text));
  const wlJs = await get('/waitlist.js'), ctaJs = await get('/pro-cta.js');
  t('the form script and the switch script are served', wlJs.status === 200 && ctaJs.status === 200 && /\/api\/waitlist/.test(wlJs.text + ctaJs.text));
  const png = await fetch(BASE + '/assets/email/hound-mark.png');
  t('the hound image used in the email is served as a PNG', png.status === 200 && /image\/png/.test(png.headers.get('content-type') || ''), String(png.status));

  /* ---- small fixes and payments ---- */
  const scan = await get('/scan?scan=example.com');
  t('/scan is a 301 to the homepage and keeps the query', scan.status === 301 && /^(https:\/\/[^/]+)?\/(\?scan=example\.com)?$/.test(scan.headers.get('location') || ''), scan.status + ' ' + scan.headers.get('location'));
  const noHdr = await get('/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'citehound-smoke/1' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  let noHdrTools = null; try { noHdrTools = JSON.parse(noHdr.text).result.tools; } catch (e) { /* reported below */ }
  t('MCP: a request with no MCP-Protocol-Version header is served (assumed 2025-03-26) with 13 tools, titled and read-only', noHdr.status === 200 && Array.isArray(noHdrTools) && noHdrTools.length === 13 && noHdrTools.every((x) => x.title && x.annotations && x.annotations.readOnlyHint === true), noHdr.status + ' ' + noHdr.text.slice(0, 100));
  const opt = await get('/api/mcp', { method: 'OPTIONS', headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST', 'User-Agent': 'citehound-smoke/1' } });
  t('MCP: OPTIONS answers the preflight (204, any origin, MCP-Protocol-Version allowed)', opt.status === 204 && opt.headers.get('access-control-allow-origin') === '*' && /MCP-Protocol-Version/i.test(opt.headers.get('access-control-allow-headers') || ''), String(opt.status));
  const mget = await get('/api/mcp');
  t('MCP: GET is 405 with Allow (no SSE stream)', mget.status === 405 && /POST/.test(mget.headers.get('allow') || ''), String(mget.status));
  const mbad = await get('/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'MCP-Protocol-Version': '1999-01-01', 'User-Agent': 'citehound-smoke/1' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  t('MCP: an unsupported version is 400', mbad.status === 400, String(mbad.status));
  const welcome = await get('/pro/welcome');
  t('/pro/welcome is 200, noindex, no referrer, no-store, and has no link in it', welcome.status === 200 && /noindex/.test(welcome.headers.get('x-robots-tag') || '') && welcome.headers.get('referrer-policy') === 'no-referrer' && /no-store/.test(welcome.headers.get('cache-control') || '') && /Payment received/.test(welcome.text) && !/\/pro\/start\/[a-f0-9]{32}/.test(welcome.text), String(welcome.status));
  const wpoll = await get('/api/pro/welcome', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'citehound-smoke/1' }, body: JSON.stringify({ checkout: 'co_smoke_not_a_real_checkout' }) });
  t('POST /api/pro/welcome answers "waiting" for a checkout with no order', wpoll.status === 200 && /"state":"waiting"/.test(wpoll.text), wpoll.status + ' ' + wpoll.text.slice(0, 80));
  const wh = await get('/api/pro/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'citehound-smoke/1' }, body: JSON.stringify({ type: 'order.paid', data: { id: 'ord_smoke_unsigned', status: 'paid' } }) });
  t('an unsigned POST to the payment webhook is refused: 403 (secret set) or 503 (not set yet), never a 2xx', wh.status === 403 || wh.status === 503, String(wh.status));
  const whBad = await get('/api/pro/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'webhook-id': 'msg_smoke', 'webhook-timestamp': String(Math.floor(Date.now() / 1000)), 'webhook-signature': 'v1,' + Buffer.from('not a real signature').toString('base64'), 'User-Agent': 'citehound-smoke/1' }, body: JSON.stringify({ type: 'order.paid', data: { id: 'ord_smoke_badsig', status: 'paid' } }) });
  t('a wrongly signed POST to the payment webhook is refused too', whBad.status === 403 || whBad.status === 503, String(whBad.status));
  t('a GET on the payment webhook is 405', (await get('/api/pro/webhook')).status === 405);
  const wjs = await get('/app/pro-welcome.js');
  t('the welcome script is served', wjs.status === 200 && /api\/pro\/welcome/.test(wjs.text));
  const portrait = await fetch(BASE + '/assets/andac.jpg');
  t('the About portrait is served as a JPEG', portrait.status === 200 && /image\/jpeg/.test(portrait.headers.get('content-type') || ''), String(portrait.status));
  for (const p of ['/benchmarks/crm', '/methodology', '/research/crawler-access-2026']) {
    const r = await get(p);
    t(p + ' cites no October 2026 rescan', r.status === 200 && !/October 2026 rescan|rescan of the same|rescan in October/i.test(r.text), String(r.status));
  }

  /* ---- the pilot token flow (needs the Upstash credentials) ---- */
  require('./env-local.js').load();
  const S = require('../lib/pro-store.js');
  if (!S.hasRedisEnv()) {
    out('  skip the pilot token flow: no Upstash credentials in the environment or .env.local');
  } else {
    const store = S.createStore(S.adapterFromEnv());
    const orders = require('../lib/pro-orders.js');
    const issued = await orders.issueOrder(store, { source: 'pilot', label: 'smoke test', validDays: 1 });
    const tok = issued.order.token;
    try {
      t('the issued pilot link is on this site', issued.url === BASE + '/pro/start/' + tok || issued.url.endsWith('/pro/start/' + tok));
      const page = await get('/pro/start/' + tok);
      t('the pilot start page is served by the function (200, the form, no-store)', page.status === 200 && /id="psForm"/.test(page.text) && /no-store/.test(page.headers.get('cache-control') || ''), String(page.status));
      const ord = await get('/api/pro/order', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'citehound-smoke/1' }, body: JSON.stringify({ token: tok }) });
      t('the order lookup says ready', ord.status === 200 && /"state":"ready"/.test(ord.text), ord.status + ' ' + ord.text.slice(0, 80));
      const revoked = await store.revokeOrder(tok);
      const after = await get('/pro/start/' + tok), unknown = await get('/pro/start/' + 'd'.repeat(32));
      t('after revoking, the link is the generic 404, the same page as an unknown link', revoked === true && after.status === 404 && after.text === unknown.text);
    } finally {
      await store.adapter.del('pro:order:' + tok); await store.adapter.del('pro:order-claim:' + tok); await store.adapter.srem('pro:orders', tok);
      const stats = require('../lib/pro-stats.js');
      await store.adapter.hincrby('pro:stats:' + stats.dayOf(), 'orders_pilot', -1);
    }
    t('the smoke order was deleted again', (await store.getOrder(tok)) === null);
  }

  out('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
}()).catch((e) => { process.stderr.write('The smoke test stopped: ' + (e && e.message) + '\n'); process.exit(1); });
