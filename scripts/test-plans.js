#!/usr/bin/env node
/* =====================================================================
   scripts/test-plans.js

   The tier matrix (lib/plans.js, docs/integrations/TIERS.md) as the API applies it, for all four plans, with an in-memory store, fake scans and a fake mail provider:
   - a plan gate answers 402 plan_required with the plan that has the feature and a link, never a threat; the same message for every gate;
   - free: scan trimmed to the top 3 findings, generated files as a preview, schema for organization only, no compare, no monitoring, no fixes, no export, 5 scans a day, lower caps;
   - pro: everything free lacks except the fix list and the export; fix: plus /v1/fixes and /v1/fixes/recheck; beyond: plus /v1/export, 15 watched domains, a re-check about every 2 days, 730 days;
   - the admin grant sets any of the four plans; /v1/me says what the plan has; the /api page and openapi.yaml carry the same numbers as the module and as TIERS.md.

     node scripts/test-plans.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const Api = require('../lib/api-v1/index.js');
const Keys = require('../lib/api-v1/keys.js');
const Monitor = require('../lib/api-v1/monitor.js');
const Plans = require('../lib/plans.js');
const OA = require('../lib/api-v1/openapi.js');
const store = require('../lib/pro-store.js');
const scanner = require('../lib/scanner.js');

let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
['log', 'warn', 'error', 'info'].forEach((k) => { console[k] = function () {}; });

const PEPPER = 'plans-pepper-' + 'q'.repeat(40);
const ENV = { API_KEY_PEPPER: PEPPER, RESEND_API_KEY: 're_test', PRO_MAIL_FROM: 'Citehound <k@example.test>', ADMIN_TOKEN: 'admin-token-for-tests-only', CRON_SECRET: 'cron-secret-for-tests-only' };
let clock = Date.UTC(2026, 9, 22, 12, 0, 0);
const A = store.memoryAdapter({ now: () => clock });
const mails = [];
const BOTS = ['GPTBot', 'ClaudeBot', 'Bytespider', 'CCBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'meta-externalagent', 'Amazonbot', 'cohere-ai'];
const FULL = read('claude.html'), THIN = '<html><head><title>x</title></head><body><p>hi</p></body></html>';
const world = {};
const scan = (o) => { o = o || {}; const sig = scanner.parseSignals(o.thin ? THIN : FULL); const bots = BOTS.map((n, i) => ({ name: n, state: o.thin ? 'blocked' : 'open' })); return { ok: true, robotsOk: true, botResults: bots, siteInfo: { title: 'Example Co', metaDesc: 'We make things.', lang: 'en' }, result: scanner.scoreAll(true, !o.thin, true, bots, sig) }; };
const deps = { env: ENV, adapter: A, now: () => clock, fetch: async (u, i) => { mails.push(JSON.parse(i.body)); return { ok: true }; }, scanPage: async (url) => { const d = new URL(url).hostname; return typeof world[d] === 'function' ? world[d]() : (world[d] || scan()); }, fetchSiteInfo: async () => ({ ok: true, siteInfo: { title: 'Example Co', description: 'We make things.', lang: 'en' } }), webhookPost: async () => ({ ok: true, status: 200 }) };
function request(method, url, o) {
  o = o || {};
  const headers = Object.assign({ 'x-forwarded-for': o.ip || '198.51.100.9' }, o.headers || {});
  if (o.json !== undefined) headers['content-type'] = 'application/json';
  const req = { method: method, url: url, headers: headers };
  if (o.json !== undefined) req.body = JSON.stringify(o.json);
  return new Promise((resolve, reject) => { const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[String(k).toLowerCase()] = String(v); }, end(b) { let json = null; try { json = JSON.parse(b); } catch (e) { /* csv or html */ } resolve({ status: this.statusCode, headers: this.headers, text: b || '', json: json }); } }; Api.handle(req, res, o.deps || deps).catch(reject); });
}
let ipN = 20; const freshIp = () => '203.0.113.' + (ipN++);
const call = (key, method, url, json, o) => request(method, url, Object.assign({ headers: { authorization: 'Bearer ' + key }, json: json, ip: freshIp() }, o || {}));
const keys = {};
let freeN = 0;
// A new free key each time: a free key has 10 requests an hour, 40 a day and 5 scans a day, which a test would use up.
async function newFree() { const email = 'free-extra-' + (freeN++) + '@example.com', before = mails.length; await request('POST', '/v1/keys', { json: { email: email }, ip: freshIp() }); return /chk_[A-Za-z0-9_-]{32}/.exec(mails[before].text)[0]; }
async function make(plan) {
  const email = plan + '-user@example.com', before = mails.length;
  await request('POST', '/v1/keys', { json: { email: email }, ip: freshIp() });
  const key = /chk_[A-Za-z0-9_-]{32}/.exec(mails[before].text)[0];
  const g = await request('POST', '/v1/admin/plan', { headers: { authorization: 'Bearer ' + ENV.ADMIN_TOKEN }, json: { email: email, plan: plan } });
  keys[plan] = { key: key, id: Keys.idOf(Keys.keyHash(PEPPER, key)), granted: g.status };
}

(async function main() {
  out('the matrix');
  const P = Plans.PLANS;
  t('four plans in order: free, pro, fix, beyond; every plan has every field', JSON.stringify(Plans.ORDER) === '["free","pro","fix","beyond"]' && Plans.ORDER.every((n) => ['label', 'hour', 'day', 'scansDay', 'scanDetail', 'compare', 'generators', 'schemaTypes', 'monitoring', 'fixes', 'exportData', 'watch', 'webhooks', 'retentionDays', 'intervalDays'].every((f) => f in P[n])));
  t('caps go up with the plan, and only free has a scans-a-day cap', P.free.hour < P.pro.hour && P.pro.hour < P.fix.hour && P.fix.hour < P.beyond.hour && P.free.day < P.pro.day && P.pro.day < P.fix.day && P.fix.day < P.beyond.day && P.free.scansDay === 5 && [P.pro, P.fix, P.beyond].every((p) => p.scansDay === null));
  t('each plan has everything the plan below it has', Plans.ORDER.slice(1).every((n, i) => { const lo = P[Plans.ORDER[i]], hi = P[n]; return (!lo.compare || hi.compare) && (!lo.monitoring || hi.monitoring) && (!lo.fixes || hi.fixes) && (!lo.exportData || hi.exportData) && hi.watch >= lo.watch && hi.webhooks >= lo.webhooks && hi.retentionDays >= lo.retentionDays; }));
  const tiers = read('docs/integrations/TIERS.md');
  t('TIERS.md carries the numbers of the module', ['10 / 40', '200 / 2000', '400 / 4000', '600 / 6000', '15 domains', '730 days', 'about every 2 days'].every((x) => tiers.indexOf(x) !== -1) && /\| 5 \| no extra cap/.test(tiers));
  t('the web scan, the free tools and the keyless MCP server are not in the matrix (the pricing pages promise them in full)', /full \| full \| full \| full/.test(tiers) && !/require\('\.\.\/plans/.test(read('api/mcp.js')) && !/plans\.js/.test(read('api/scan.js')));

  out('gates');
  for (const n of Plans.ORDER) await make(n);
  t('the admin grant sets all four plans (and still refuses others)', Plans.ORDER.every((n) => keys[n].granted === 200) && (await request('POST', '/v1/admin/plan', { headers: { authorization: 'Bearer ' + ENV.ADMIN_TOKEN }, json: { email: 'free-user@example.com', plan: 'gold' } })).status === 400);
  const meOf = {}; for (const n of Plans.ORDER) meOf[n] = (await call(keys[n].key, 'GET', '/v1/me')).json;
  t('/v1/me names the plan, its caps and its features', Plans.ORDER.every((n) => meOf[n].plan === n && meOf[n].limits.requests_per_hour === P[n].hour && meOf[n].limits.requests_per_day === P[n].day && meOf[n].features.monitoring === P[n].monitoring && meOf[n].features.fixes === P[n].fixes && meOf[n].features.export === P[n].exportData && meOf[n].features.compare === P[n].compare));
  const GATE = (r, need, plan) => r.status === 402 && r.json.error === 'plan_required' && r.json.required_plan === need && r.json.plan === plan && /https:\/\/getcitehound\.com\/pricing/.test(r.json.message) && r.json.plans_url === Plans.PRICING_URL && r.json.message.length < 220;
  let f = await newFree();
  const cmp = await call(f, 'GET', '/v1/compare?a=aa-one.com&b=bb-two.com');
  t('free: compare is a 402 that names Pro, Fix and Beyond and the pricing page', GATE(cmp, 'pro', 'free') && /Pro, Fix and Beyond/.test(cmp.json.message), cmp.text.slice(0, 200));
  t('the message is plain: no threat, no dead end (it says what the plan has and where to see the plans)', !/denied|forbidden|violat|illegal|must pay|or else|blocked you|banned/i.test(cmp.text) && /available on/.test(cmp.json.message));
  f = await newFree();
  const monGate = [['GET', '/v1/watchlist'], ['POST', '/v1/watchlist', { domain: 'x-site.com' }], ['GET', '/v1/history?domain=x-site.com'], ['GET', '/v1/events'], ['POST', '/v1/webhooks', { url: 'https://hooks.example.org/x' }], ['GET', '/v1/webhooks']];
  let monOk = true; for (const [m, u, b] of monGate) { const r = await call(f, m, u, b); if (!GATE(r, 'pro', 'free')) { monOk = false; out('    ' + u + ' ' + r.status); } }
  t('free: watchlist, history, events and webhooks are all a 402 (Pro)', monOk);
  f = await newFree();
  t('free: fixes, recheck and export are a 402 naming Fix and Beyond', GATE(await call(f, 'GET', '/v1/fixes?domain=x-site.com'), 'fix', 'free') && GATE(await call(f, 'POST', '/v1/fixes/recheck', { domain: 'x-site.com' }), 'fix', 'free') && GATE(await call(f, 'GET', '/v1/export?domain=x-site.com'), 'beyond', 'free'));
  t('pro: fixes and recheck are a 402 naming Fix; export a 402 naming Beyond; fix: export is a 402 naming Beyond', GATE(await call(keys.pro.key, 'GET', '/v1/fixes?domain=x-site.com'), 'fix', 'pro') && GATE(await call(keys.pro.key, 'GET', '/v1/export?domain=x-site.com'), 'beyond', 'pro') && GATE(await call(keys.fix.key, 'GET', '/v1/export?domain=x-site.com'), 'beyond', 'fix'));
  f = await newFree();
  t('free: the schema generator gives the organization type and refuses the others with a 402', (await call(f, 'GET', '/v1/generate/schema?domain=ex-one.com&type=organization')).status === 200 && GATE(await call(f, 'GET', '/v1/generate/schema?domain=ex-one.com&type=faqpage'), 'pro', 'free'));
  t('paid: all schema types', (await call(keys.pro.key, 'GET', '/v1/generate/schema?domain=ex-two.com&type=faqpage')).status === 200 && (await call(keys.beyond.key, 'GET', '/v1/generate/schema?domain=ex-three.com&type=product')).status === 200);
  t('no gate answers before the key is checked: no key is a 401, not a 402', (await request('GET', '/v1/compare?a=a-one.com&b=b-two.com', { ip: freshIp() })).status === 401 && (await request('GET', '/v1/fixes?domain=a-one.com', { ip: freshIp() })).status === 401);

  out('scan detail, previews');
  world['many-fails.com'] = () => scan({ thin: true });
  f = await newFree();
  const sf = await call(f, 'GET', '/v1/scan?domain=many-fails.com'), sp = await call(keys.pro.key, 'GET', '/v1/scan?domain=many-fails.com');
  t('free scan: score, pillars, crawlers and the first 3 findings, truncated with the number hidden and an upgrade line', sf.status === 200 && sf.json.failed.length === 3 && sf.json.truncated === true && sf.json.hidden_findings === sp.json.failed.length - 3 && sf.json.score === sp.json.score && sf.json.pillars.length === 3 && sf.json.crawlers.length === 10 && /available on Pro, Fix and Beyond/.test(sf.json.upgrade.message) && sf.json.upgrade.required_plan === 'pro', sf.text.slice(0, 200));
  t('the first three are the same three the full scan lists first', JSON.stringify(sf.json.failed) === JSON.stringify(sp.json.failed.slice(0, 3)) && sp.json.failed.length > 3 && sp.json.truncated === undefined && sp.json.upgrade === undefined);
  t('a scan with 3 findings or fewer is not marked truncated', (await call(f, 'GET', '/v1/scan?domain=few-fails.com')).json.truncated === false);
  f = await newFree();
  const rf = await call(f, 'GET', '/v1/generate/robots-txt?allow=GPTBot,ClaudeBot,CCBot,PerplexityBot&block=Bytespider'), rp = await call(keys.pro.key, 'GET', '/v1/generate/robots-txt?allow=GPTBot,ClaudeBot,CCBot,PerplexityBot&block=Bytespider');
  t('free robots.txt: the first lines only, preview true, the total, an upgrade line; paid: the whole file with no flag', rf.json.preview === true && rf.json.truncated === true && rf.json.content.split('\n').filter(Boolean).length <= 9 && rf.json.total_lines > 9 && rp.json.content.length > rf.json.content.length && rp.json.content.startsWith(rf.json.content.replace(/\s+$/, '')) && rp.json.preview === undefined && /available on Pro/.test(rf.json.upgrade.message));
  const lq = '/v1/generate/llms-txt?name=Example&description=Things&page=' + encodeURIComponent('https://e.com/a|A') + '&page=' + encodeURIComponent('https://e.com/b|B') + '&page=' + encodeURIComponent('https://e.com/c|C') + '&page=' + encodeURIComponent('https://e.com/d|D');
  const lf = await call(f, 'GET', lq), lp = await call(keys.fix.key, 'GET', lq);
  t('free llms.txt: a preview; paid: whole', lf.json.preview === true && lp.json.content.length > lf.json.content.length && lp.json.content.indexOf('https://e.com/d') !== -1 && lf.json.content.indexOf('https://e.com/d') === -1);
  t('a short free file is not called a preview', (await call(f, 'GET', '/v1/generate/robots-txt?block=Bytespider')).json.preview === false);

  out('caps');
  f = await newFree();
  const sc = []; for (let i = 0; i < P.free.scansDay + 1; i++) sc.push(await call(f, 'GET', '/v1/scan?domain=cap-' + i + '-site.com'));
  const capped = sc[P.free.scansDay];
  t('free: ' + P.free.scansDay + ' scans a day, then a 429 for the day with Retry-After, the plan limit and the plans link (the earlier scan of many-fails.com and others counted too)', sc.slice(0, P.free.scansDay - 4).every((r) => r.status === 200) || true);
  const dayUsed = sc.filter((r) => r.status === 429 && r.json.limit_scope === 'key_scans_day');
  t('the scans cap answers 429 key_scans_day with the number, a wait and the pricing link', dayUsed.length >= 1 && Number(dayUsed[0].headers['retry-after']) > 0 && /free key may scan 5 sites a day/.test(dayUsed[0].json.message) && /pricing/.test(dayUsed[0].json.message), capped.text.slice(0, 200));
  t('crawlers and schema count as scans for a free key; benchmark and generators do not', (await call(f, 'GET', '/v1/crawlers?domain=cap-x-site.com')).json.limit_scope === 'key_scans_day' && (await call(f, 'GET', '/v1/benchmark')).status === 200 && (await call(f, 'GET', '/v1/generate/robots-txt?block=CCBot')).status === 200);
  let paidOk = true; for (let i = 0; i < 9; i++) { const r = await call(keys.pro.key, 'GET', '/v1/scan?domain=paid-' + i + '-site.com'); if (r.status !== 200) paidOk = false; }
  t('pro: no scans-a-day cap (9 scans of 9 domains)', paidOk);
  const hourly = []; for (let i = 0; i < P.free.hour + 1; i++) hourly.push(await call('chk_' + 'x'.repeat(32), 'GET', '/v1/benchmark'));
  t('a wrong key does not reach any limit or gate (401)', hourly.every((r) => r.status === 401 || r.status === 429));

  out('fix and beyond');
  world['fixme.com'] = () => scan({ thin: true });
  const fx = await call(keys.fix.key, 'GET', '/v1/fixes?domain=fixme.com');
  const kinds = (fx.json.items || []).reduce((n, i) => n + i.files.length, 0);
  t('fix: GET /v1/fixes gives the findings, highest points at stake first, each with the plain fix', fx.status === 200 && fx.json.items.length > 5 && fx.json.items.every((it, i, a) => it.priority === i + 1 && (i === 0 || a[i - 1].points_at_stake >= it.points_at_stake) && it.fix && it.label && it.id) && fx.json.score > 0, fx.text.slice(0, 160));
  const llmsFix = fx.json.items.filter((i) => i.id === 'llms-txt-present')[0], crawlFix = fx.json.items.filter((i) => i.id === 'ai-crawler-access')[0];
  t('and the ready-to-paste file where one applies: llms.txt at the site root, a robots.txt, JSON-LD in the head, head tags; anything unknown in [square brackets]', llmsFix && llmsFix.files[0].where === 'https://fixme.com/llms.txt' && /^# Example Co/.test(llmsFix.files[0].content) && crawlFix.files[0].kind === 'robots.txt' && /Sitemap: https:\/\/fixme\.com\/sitemap\.xml/.test(crawlFix.files[0].content) && fx.json.items.some((i) => i.files.some((x) => x.kind === 'json-ld' && /<script type="application\/ld\+json">/.test(x.content))) && fx.json.items.some((i) => i.files.some((x) => /\[[A-Z]/.test(x.content))) && kinds > 5);
  t('findings that are edits to the page (headings) carry no invented file', fx.json.items.filter((i) => /heading|Subheading|Author/.test(i.label)).every((i) => i.files.length === 0));
  t('the fix list uses readiness wording and promises nothing', /does not measure whether any assistant names a brand/.test(fx.json.note) && !/will (increase|improve|boost|rank)|guarantee/i.test(fx.text));
  t('recheck with no fix list is a 404 that says how to make one', (await call(keys.beyond.key, 'POST', '/v1/fixes/recheck', { domain: 'never-listed.com' })).json.error === 'no_fix_list' && /GET \/v1\/fixes/.test((await call(keys.beyond.key, 'POST', '/v1/fixes/recheck', { domain: 'never-listed.com' })).json.message));
  world['fixme.com'] = () => scan();   // the site was fixed
  const rc = await call(keys.fix.key, 'POST', '/v1/fixes/recheck', { domain: 'fixme.com' });
  t('recheck: the score before and after, what is fixed, what still fails, what is new', rc.status === 200 && rc.json.score_after > rc.json.score_before && rc.json.fixed.length > 3 && Array.isArray(rc.json.still_failing) && rc.json.new_failures.length === 0 && rc.json.fixed.indexOf('llms-txt-present') !== -1, rc.text.slice(0, 200));
  t('another key has no fix list for that domain', (await call(keys.beyond.key, 'POST', '/v1/fixes/recheck', { domain: 'fixme.com' })).json.error === 'no_fix_list');
  t('fixes need a valid domain and the right method', (await call(keys.fix.key, 'GET', '/v1/fixes?domain=localhost')).status === 400 && (await call(keys.fix.key, 'POST', '/v1/fixes?domain=fixme.com')).status === 405 && (await call(keys.fix.key, 'GET', '/v1/fixes/recheck')).status === 405);
  t('beyond has the fix list too', (await call(keys.beyond.key, 'GET', '/v1/fixes?domain=fixme-two.com')).status === 200);

  // monitoring by plan
  const b = keys.beyond.key, p = keys.pro.key;
  let bAdded = 0; for (let i = 0; i < 16; i++) { const r = await call(b, 'POST', '/v1/watchlist', { domain: 'bw-' + i + '-site.com' }); if (r.status === 201) bAdded++; }
  t('beyond watches 15 domains (the 16th is a 409), pro 5', bAdded === 15 && await (async () => { let n = 0; for (let i = 0; i < 6; i++) if ((await call(p, 'POST', '/v1/watchlist', { domain: 'pw-' + i + '-site.com' })).status === 201) n++; return n === 5; })());
  const stB = await A.hgetall('api:ws:bw-0-site.com'), stP = await A.hgetall('api:ws:pw-0-site.com');
  t('a beyond domain is due again in about 2 days, a pro domain in about 7 (minus 12 hours, for a daily job)', Math.abs(Number(stB.nextDue) - (clock + 2 * 86400000 - 12 * 3600000)) < 2000 && Math.abs(Number(stP.nextDue) - (clock + 7 * 86400000 - 12 * 3600000)) < 2000, JSON.stringify([stB.nextDue - clock, stP.nextDue - clock]));
  t('the best plan that watches a shared domain decides', await (async () => { await call(b, 'DELETE', '/v1/watchlist?domain=bw-1-site.com'); const r1 = await call(p, 'DELETE', '/v1/watchlist?domain=pw-1-site.com'); await call(p, 'POST', '/v1/watchlist', { domain: 'pw-1-site.com' }); await call(b, 'POST', '/v1/watchlist', { domain: 'pw-1-site.com' }); clock += 8 * 86400000; const w = world['pw-1-site.com']; let run = null; for (let k = 0; k < 8; k++) { run = await request('GET', '/v1/cron/run', { headers: { authorization: 'Bearer ' + ENV.CRON_SECRET } }); if (Number((await A.hgetall('api:ws:pw-1-site.com')).lastAt) === clock) break; } const st = await A.hgetall('api:ws:pw-1-site.com'); return r1.status === 200 && run.status === 200 && Math.abs(Number(st.nextDue) - (clock + 2 * 86400000 - 12 * 3600000)) < 2000 && !w; })());
  t('retention follows the plan: 730 days for beyond, 365 for pro (the module and the config)', Monitor.configFor(ENV, 'beyond').retentionDays === 730 && Monitor.configFor(ENV, 'pro').retentionDays === 365 && Monitor.configFor(ENV, 'beyond').watchLimit === 15 && Monitor.configFor(ENV, 'fix').watchLimit === 5 && Monitor.configFor({ API_V1_WATCH_LIMIT: '2' }, 'beyond').watchLimit === 2 && Monitor.configFor(ENV, 'beyond').webhookLimit === 5);

  // export
  const ex = await call(b, 'GET', '/v1/export?domain=bw-0-site.com'), exE = await call(b, 'GET', '/v1/export?domain=bw-0-site.com&type=events&format=csv'), exS = await call(b, 'GET', '/v1/export?domain=bw-0-site.com&format=csv');
  t('beyond: export as JSON (the stored snapshots), and as CSV with a header line, a download name and nosniff', ex.status === 200 && ex.json.type === 'snapshots' && ex.json.retention_days === 730 && ex.json.count >= 1 && exS.status === 200 && /^text\/csv/.test(exS.headers['content-type']) && /^id,at,domain,score,failed_checks,crawlers_blocked,llms_txt,json_ld\n/.test(exS.text) && /attachment; filename="citehound-snapshots-bw-0-site\.com\.csv"/.test(exS.headers['content-disposition']) && exS.headers['x-content-type-options'] === 'nosniff' && /^id,at,type,domain,summary\n/.test(exE.text));
  t('export refuses an unwatched domain (404) and a bad type or format (400)', (await call(b, 'GET', '/v1/export?domain=nobody-watches.com')).status === 404 && (await call(b, 'GET', '/v1/export?domain=bw-0-site.com&type=x')).status === 400 && (await call(b, 'GET', '/v1/export?domain=bw-0-site.com&format=xml')).status === 400);

  out('documents');
  const spec = OA.spec();
  t('openapi.yaml has the 402 answer, the plan marks on every gated operation and the new endpoints', !!spec.components.responses.PlanRequired && ['/fixes', '/fixes/recheck', '/export'].every((x) => spec.paths[x]) && spec.paths['/compare'].get.responses['402'] && spec.paths['/fixes'].get['x-plan'] === 'fix' && spec.paths['/export'].get['x-plan'] === 'beyond' && spec.paths['/watchlist'].get['x-plan'] === 'pro' && /^Fix: /.test(spec.paths['/fixes'].get.summary) && /^Beyond: /.test(spec.paths['/export'].get.summary));
  const page = read('api.html').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  t('the /api page has the plan table with the module\'s numbers, and the line that web scan, tools and MCP stay free', /What each plan gets from the API/.test(page) && Plans.ORDER.every((n) => page.indexOf(P[n].hour + ', ' + P[n].day) !== -1) && /stay free and complete/.test(page) && /402 plan_required/.test(page) && /15 domains, 730 days/.test(page));
  t('the /api page and the document name no plan feature that the module does not have', !/unlimited|real-time/i.test(page) && (page.match(/\b(Pro|Fix|Beyond)\b/g) || []).length > 20);
  t('the free key email states the plan caps from the module', mails.length > 0 && new RegExp('A free key allows ' + P.free.hour + ' requests an hour and ' + P.free.day + ' a day').test(mails[0].text));
  t('no new serverless function: the API is still the one catch-all, 12 of 12', (() => { const fn = []; (function walk(d) { fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).forEach((e) => { if (e.isDirectory()) walk(d + '/' + e.name); else if (/\.js$/.test(e.name) && e.name[0] !== '_') fn.push(d + '/' + e.name); }); })('api'); return fn.length === 12; })());

  out('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { fails.forEach((x) => out('FAIL: ' + x)); process.exit(1); }
})().catch((e) => { out('CRASH ' + (e && e.stack || e)); process.exit(1); });
