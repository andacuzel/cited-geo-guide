#!/usr/bin/env node
/* =====================================================================
   scripts/test-action-scan.js

   The GitHub Action's endpoint and the Action itself (citehound-action/), with mocks: no live scan, no storage, no network beyond localhost.

   - /api/action-scan answers only a request that says it is the Action (User-Agent "Citehound-Action/"), takes the domain and nothing else, runs the shared scanner (lib/scanner.js
     scanPage, no scoring of its own), and returns a compact summary whose pillar scores add up to the score;
   - its limits (per domain, per address, across everyone) answer 429 with Retry-After, keep no clear domain or address in a key, and fail open when storage is unavailable;
   - a failed scan is a plain 502, an unexpected error a plain 500 with no detail; the answer is never cached;
   - api/scan.js hands client=action to it, vercel.json rewrites /api/action-scan there, and the Hobby plan's function count has not grown;
   - the Action (action.yml, index.js, README, LICENSE) is complete and run here against a local copy of the endpoint: outputs, job summary, and the exit code for min-score, a blocked
     crawler, a rate limit and an unreachable server.

     node scripts/test-action-scan.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const Handler = require('../lib/action-scan.js');
const Limits = require('../lib/action-limits.js');
const scanner = require('../lib/scanner.js');

let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
['log', 'warn', 'error', 'info'].forEach((k) => { const o = console[k]; console[k] = function () { if (k === 'error') return; o.apply(console, arguments); }; });

// A scan result built by the real scorer from one of our own pages, with a crawler list that has one of each state.
const crawl = JSON.parse(read('content/pro/sample-report.json'));
function fakeScan(overrides) {
  const sig = scanner.parseSignals(read('claude.html'));
  const result = scanner.scoreAll(true, true, true, crawl.siteContext.botResults, sig);
  const botResults = [{ name: 'GPTBot', state: 'open' }, { name: 'ClaudeBot', state: 'partial' }, { name: 'Bytespider', state: 'blocked' }, { name: 'CCBot', state: 'blocked' }];
  return Object.assign({ ok: true, robotsOk: true, botResults: botResults, result: result }, overrides || {});
}
function call(req, deps) {
  return new Promise((resolve) => {
    const res = { headers: {}, code: 200, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; resolve(res); } };
    Handler.handle(Object.assign({ method: 'GET', headers: { 'user-agent': 'Citehound-Action/1.0 (+https://getcitehound.com)', 'x-forwarded-for': '203.0.113.7' }, query: {} }, req), res, deps);
  });
}
const ACT = { 'user-agent': 'Citehound-Action/1.0 (+https://getcitehound.com)', 'x-forwarded-for': '203.0.113.7' };
function memKv() {
  const store = new Map(), ttl = new Map(), seen = [];
  return { seen, fn: async (cmds) => cmds.map((c) => { const [op, key, n] = c; seen.push(key);
    if (op === 'INCR') { store.set(key, (store.get(key) || 0) + 1); return { result: store.get(key) }; }
    if (op === 'TTL') return { result: ttl.has(key) ? ttl.get(key) : -1 };
    if (op === 'EXPIRE') { ttl.set(key, n); return { result: 1 }; }
    return { result: null }; }) };
}

(async function main() {
  /* ---- who may call, and what goes in ---- */
  let scanned = 0, limited = 0;
  const deps = { scanPage: async (u) => { scanned++; deps.last = u; return fakeScan(); }, checkActionLimit: async () => { limited++; return { limited: false }; }, now: Date.UTC(2026, 9, 22, 12) };
  let r = await call({ headers: { 'user-agent': 'Mozilla/5.0' }, query: { domain: 'example.com' } }, deps);
  t('a request that does not say it is the Action gets 400 and a pointer to the web scanner; nothing is scanned and no limit counter is touched', r.code === 400 && /web scanner at https:\/\/getcitehound\.com/.test(r.body.error) && scanned === 0 && limited === 0);
  r = await call({ headers: ACT, query: { domain: 'not a domain' } }, deps);
  t('an invalid domain is 400, nothing scanned', r.code === 400 && scanned === 0);
  r = await call({ method: 'POST', headers: ACT, query: { domain: 'example.com' } }, deps);
  t('only GET is answered (405 with Allow)', r.code === 405 && /GET/.test(r.headers.allow));
  r = await call({ headers: ACT, query: { domain: 'https://www.Example.com/path?x=1' } }, deps);
  t('the domain is normalised (scheme, www and path dropped) and the scanner is asked for its home page only', r.code === 200 && r.body.domain === 'example.com' && deps.last === 'https://example.com/');
  const keys = Object.keys(r.body).sort().join();
  t('the answer is the compact summary: domain, score, pillars, failed, crawlers, scannedAt, note, method; never cached', keys === 'crawlers,domain,failed,method,note,pillars,scannedAt,score' && r.headers['cache-control'] === 'no-store');
  t('the pillar scores add up to the score, the three pillars are named as the methodology names them, and the maximum is 100', r.body.pillars.length === 3 && r.body.pillars.reduce((n, p) => n + p.score, 0) === r.body.score && r.body.pillars.reduce((n, p) => n + p.max, 0) === 100 && r.body.pillars.map((p) => p.name).join() === 'Discoverability,Technical foundation,Content & trust');
  const sc = fakeScan();
  t('the failed checks are exactly the scanner\'s failed checks, each with its pillar, points and fix', r.body.failed.length === sc.result.checks.filter((c) => !c.ok).length && r.body.failed.every((f) => f.label && f.pillar && typeof f.points === 'number' && f.fix));
  t('the crawler counts and the names of the blocked ones come from the scanner\'s list', r.body.crawlers.open === 1 && r.body.crawlers.limited === 1 && r.body.crawlers.blocked === 2 && r.body.crawlers.blockedNames.join() === 'Bytespider,CCBot');
  t('the note says readiness, not whether any assistant names a brand; the answer holds no address and no repository', /does not measure whether any assistant names a brand/.test(r.body.note) && !/203\.0\.113/.test(JSON.stringify(r.body)));
  t('the handler has no scoring of its own: it calls scanPage and sums what the scanner returned', /scanPage\(/.test(read('lib/action-scan.js')) && !/scoreAll|parseSignals/.test(read('lib/action-scan.js')));

  /* ---- failures ---- */
  r = await call({ headers: ACT, query: { domain: 'example.com' } }, { scanPage: async () => ({ ok: false, stage: 'robots', kind: 'timeout' }), checkActionLimit: async () => ({ limited: false }) });
  const r2 = await call({ headers: ACT, query: { domain: 'example.com' } }, { scanPage: async () => ({ ok: false, stage: 'page', kind: 'status' }), checkActionLimit: async () => ({ limited: false }) });
  const r3 = await call({ headers: ACT, query: { domain: 'example.com' } }, { scanPage: async () => { throw new Error('secret internal detail'); }, checkActionLimit: async () => ({ limited: false }) });
  t('a robots.txt that cannot be read is a plain 502, an unreadable homepage a plain 502, an unexpected error a plain 500 that leaks nothing', r.code === 502 && /robots\.txt/.test(r.body.error) && r2.code === 502 && /homepage/.test(r2.body.error) && r3.code === 500 && !/secret/.test(JSON.stringify(r3.body)));

  /* ---- limits ---- */
  const kv = memKv(); Limits._setKv(kv.fn);
  const now = Date.UTC(2026, 9, 22, 12);
  const seq = []; for (let i = 0; i < Limits.DOMAIN_PER_HOUR + 1; i++) seq.push((await Limits.checkActionLimit('busy.example', '198.51.100.1', now)).limited);
  const lim = await Limits.checkActionLimit('busy.example', '198.51.100.1', now);
  t('the same domain is allowed ' + Limits.DOMAIN_PER_HOUR + ' times an hour, then limited by domain with a Retry-After of at most an hour', seq.slice(0, Limits.DOMAIN_PER_HOUR).every((x) => !x) && seq[Limits.DOMAIN_PER_HOUR] === true && lim.limited && lim.scope === 'domain' && lim.retryAfter > 0 && lim.retryAfter <= 3600 && /at most 4 times an hour/.test(lim.message), JSON.stringify([seq, lim]));
  t('another domain from the same address is not held back by it', (await Limits.checkActionLimit('quiet.example', '198.51.100.1', now)).limited === false);
  t('no domain and no address is in a storage key: only hashes and the hour', kv.seen.every((k) => /^act:(d|i):[0-9a-f]{64}$|^act:g:\d+$/.test(k)) && kv.seen.every((k) => !/busy|quiet|198\.51/.test(k)));
  const kv2 = memKv(); Limits._setKv(kv2.fn);
  let ipHit = null; for (let i = 0; i <= Limits.IP_PER_HOUR + 1 && !ipHit; i++) { const x = await Limits.checkActionLimit('d' + i + '.example', '192.0.2.9', now); if (x.limited) ipHit = x; }
  t('one address is limited after ' + Limits.IP_PER_HOUR + ' scans an hour, whatever the domains', !!ipHit && ipHit.scope === 'ip');
  const kv3 = memKv(); Limits._setKv(kv3.fn);
  let gHit = null; for (let i = 0; i <= Limits.GLOBAL_PER_HOUR + 1 && !gHit; i++) { const x = await Limits.checkActionLimit('g' + i + '.example', '10.0.' + (i % 250) + '.' + Math.floor(i / 250), now); if (x.limited) gHit = x; }
  t('everyone together is limited after ' + Limits.GLOBAL_PER_HOUR + ' scans an hour', !!gHit && gHit.scope === 'global');
  Limits._setKv(async () => null);
  const open1 = await Limits.checkActionLimit('x.example', '1.1.1.1', now);
  Limits._setKv(async () => { throw new Error('down'); });
  const open2 = await Limits.checkActionLimit('x.example', '1.1.1.1', now);
  Limits._setKv(null);
  t('with storage unavailable the scan is allowed (a storage outage must not break a build)', open1.limited === false && open2.limited === false);
  r = await call({ headers: ACT, query: { domain: 'example.com' } }, { scanPage: async () => fakeScan(), checkActionLimit: async () => ({ limited: true, scope: 'domain', retryAfter: 1234, message: 'Rate limit reached for example.com' }) });
  t('a limited request is 429 with Retry-After and the limit scope, and nothing is scanned', r.code === 429 && r.headers['retry-after'] === '1234' && r.body.limit === 'domain');

  /* ---- wiring ---- */
  const vj = JSON.parse(read('vercel.json'));
  t('vercel.json rewrites /api/action-scan to /api/scan?client=action', (vj.rewrites || []).some((x) => x.source === '/api/action-scan' && x.destination === '/api/scan?client=action'));
  const scanSrc = read('api/scan.js');
  t('api/scan.js hands client=action to lib/action-scan.js before its own limiter, and the web flow is otherwise untouched', /client === 'action'\) return require\('\.\.\/lib\/action-scan\.js'\)\.handle/.test(scanSrc) && scanSrc.indexOf("client === 'action'") < scanSrc.indexOf('checkRateLimit(req)'));
  const fns = fs.readdirSync(path.join(ROOT, 'api')).filter((f) => /\.js$/.test(f) && f[0] !== '_');
  t('the Hobby plan\'s function count has not grown (11 non-underscore files in api/)', fns.length === 11, fns.length + ': ' + fns.join(', '));
  const viaScan = await new Promise((resolve) => { const res = { headers: {}, code: 200, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; resolve(res); } }; require('../api/scan.js')({ method: 'GET', headers: { 'user-agent': 'curl/8' }, query: { client: 'action', domain: 'example.com' }, url: '/api/scan?client=action&domain=example.com' }, res); });
  t('through api/scan.js a caller without the Action\'s User-Agent still gets the 400 pointer, and no web-scanner counter is used', viaScan.code === 400 && /GitHub Action/.test(viaScan.body.error));

  /* ---- where the Action is mentioned ---- */
  const siteFiles = fs.readdirSync(ROOT).filter((f) => /\.html$/.test(f)).concat(['llms.txt', 'sitemap.xml', 'lib/site-footer.js']);
  const mentions = siteFiles.filter((f) => /github action/i.test(read(f)));
  t('the site mentions the Action only in the terms, the privacy page and the integrations page: not in the navigation, the homepage, the footer, llms.txt or the sitemap', mentions.every((f) => ['terms.html', 'privacy.html', 'integrations.html'].indexOf(f) !== -1) && !/github action/i.test(read('index.html')) && !/<footer[\s\S]*?github action/i.test(read('terms.html')), mentions.join(', '));

  /* ---- the Action's files ---- */
  const yml = read('citehound-action/action.yml');
  t('action.yml: the name, the required domain input, min-score and fail-on-crawler-block, the outputs, node24, index.js, a branding icon and colour from GitHub\'s lists', /^name: 'Citehound AI readiness check'/m.test(yml) && /domain:\s+description:[^\n]+\n\s+required: true/.test(yml) && /min-score:/.test(yml) && /fail-on-crawler-block:\s+description:[^\n]+\n\s+required: false\n\s+default: 'false'/.test(yml) && /outputs:\s+score:/.test(yml) && /using: 'node24'/.test(yml) && /main: 'index.js'/.test(yml) && /icon: 'search'/.test(yml) && /color: '(white|black|yellow|blue|green|orange|red|purple|gray-dark)'/.test(yml));
  const readme = read('citehound-action/README.md');
  t('the README has the short workflow example, the inputs, what it checks, what the score means, and the limits it states are the ones in the code', /uses: andacuzel\/citehound-action@v1/.test(readme) && /on: workflow_dispatch\n/.test(readme) && /on: workflow_dispatch\n/.test(read('citehound-action/examples/citehound.yml')) && !/\b(cron|schedule|weekly|every week|recurring)\b/i.test(readme + read('citehound-action/examples/citehound.yml') + read('citehound-action/CHANGELOG.md') + read('citehound-action/action.yml')) && !/on: \[push\]|on: push/.test(readme + read('citehound-action/examples/citehound.yml')) && /scans the one domain you give it and reports the score for that page/.test(readme) && /Whole-site reports, history, alerts and citation samples are part of Citehound Pro: https:\/\/getcitehound\.com\/pricing/.test(readme) && /up to 4 scans per hour per domain/.test(readme) && /## Privacy/.test(readme) && /only the domain you configure is sent/i.test(readme) && /https:\/\/getcitehound\.com\/privacy/.test(readme) && /### v1\.0\.1|## v1\.0\.1|## \[?1\.0\.1/.test(read('citehound-action/CHANGELOG.md')) && /readiness score: crawler access and on-page signals\. It is not a measure of whether any assistant names a brand/.test(readme) && new RegExp('at most ' + Limits.DOMAIN_PER_HOUR + ' times an hour').test(readme) && new RegExp('at most ' + Limits.IP_PER_HOUR + ' times an hour').test(readme) && new RegExp(Limits.GLOBAL_PER_HOUR + ' scans an hour').test(readme) && /https:\/\/getcitehound\.com/.test(readme) && !/getcitehound\.com\/claude/.test(readme));
  t('the README and the Action promise nothing about citations, traffic, rankings or revenue and name no integration', !/\b(WordPress|Webflow|GitHub Marketplace listing|Shopify|Zapier|guarantee|rank(s|ing)?)\b/i.test(readme + read('citehound-action/index.js')));
  t('LICENSE is MIT', /^MIT License/.test(read('citehound-action/LICENSE')));
  const idx = read('citehound-action/index.js');
  t('the Action sends one request with the domain as the only parameter, the User-Agent Citehound-Action/1.0, no token and no other file or variable of the runner', (idx.match(/fetch\(/g) || []).length === 1 && /\/api\/action-scan\?domain=' \+ encodeURIComponent\(domain\)/.test(idx) && /Citehound-Action\/1\.0/.test(idx) && !/GITHUB_TOKEN|GITHUB_REPOSITORY|process\.env\.GITHUB_(?!OUTPUT|STEP_SUMMARY)/.test(idx));

  /* ---- the Action, run against a local copy of the endpoint ---- */
  let mode = 'ok', hits = 0, lastUrl = '', lastUa = '';
  const server = http.createServer((req, rs) => {
    hits++; lastUrl = req.url; lastUa = req.headers['user-agent'];
    const reqLike = { method: req.method, headers: req.headers, url: req.url, query: Object.fromEntries(new URL(req.url, 'http://x').searchParams) };
    const resLike = { setHeader: (k, v) => rs.setHeader(k, v), status(c) { rs.statusCode = c; return this; }, json(b) { rs.setHeader('Content-Type', 'application/json'); rs.end(JSON.stringify(b)); } };
    if (mode === 'limited') return Handler.handle(reqLike, resLike, { scanPage: async () => fakeScan(), checkActionLimit: async () => ({ limited: true, scope: 'domain', retryAfter: 600, message: 'Rate limit reached for example.com: the Action scans the same domain at most 4 times an hour.' }) });
    Handler.handle(reqLike, resLike, { scanPage: async () => fakeScan(), checkActionLimit: async () => ({ limited: false }), now: Date.UTC(2026, 9, 22, 12) });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  function runAction(inputs, api) {
    return new Promise((resolve) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-action-')), o = path.join(dir, 'output'), s = path.join(dir, 'summary');
      fs.writeFileSync(o, ''); fs.writeFileSync(s, '');
      const env = Object.assign({ PATH: process.env.PATH, CITEHOUND_API_BASE: api || base, GITHUB_OUTPUT: o, GITHUB_STEP_SUMMARY: s, GITHUB_TOKEN: 'must-not-be-sent', GITHUB_REPOSITORY: 'owner/repo' }, inputs);
      const p = spawn(process.execPath, [path.join(ROOT, 'citehound-action', 'index.js')], { env: env });
      let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
      p.on('close', (code) => resolve({ code: code, log: log, output: fs.readFileSync(o, 'utf8'), summary: fs.readFileSync(s, 'utf8') }));
    });
  }
  const expected = fakeScan().result.total;
  let a = await runAction({ INPUT_DOMAIN: 'https://www.Example.com/', 'INPUT_MIN-SCORE': '', 'INPUT_FAIL-ON-CRAWLER-BLOCK': 'false' });
  t('Action, no gates: exit 0, the outputs score, crawlers-blocked and failed-checks are written, the request is the one query with the cleaned domain and the Action\'s User-Agent', a.code === 0 && new RegExp('score=' + expected + '\\n').test(a.output) && /crawlers-blocked=2\n/.test(a.output) && /failed-checks=\d+\n/.test(a.output) && lastUrl === '/api/action-scan?domain=example.com' && /^Citehound-Action\/1\.0/.test(lastUa));
  t('Action: the job summary has the score, the pillar table, the failed-checks table with fixes, the crawler line and the readiness note, and no token', /Score: \d+ \/ 100/.test(a.summary) && /\| Pillar \| Score \|/.test(a.summary) && /\| Check \| Pillar \| Points \| Fix \|/.test(a.summary) && /Bytespider, CCBot/.test(a.summary) && /does not measure whether any assistant names a brand/.test(a.summary) && !/must-not-be-sent|owner\/repo/.test(a.summary + a.log));
  a = await runAction({ INPUT_DOMAIN: 'example.com', 'INPUT_MIN-SCORE': '100' });
  t('Action: a score under min-score fails the step (exit 1) with an error line, the summary still written', a.code === 1 && /::error::The score \d+ is below min-score 100/.test(a.log) && a.summary.length > 100);
  a = await runAction({ INPUT_DOMAIN: 'example.com', 'INPUT_MIN-SCORE': '1' });
  t('Action: a score over min-score passes', a.code === 0);
  a = await runAction({ INPUT_DOMAIN: 'example.com', 'INPUT_FAIL-ON-CRAWLER-BLOCK': 'true' });
  t('Action: fail-on-crawler-block with a fully blocked crawler fails and names it', a.code === 1 && /blocks these tracked AI crawlers completely: Bytespider, CCBot/.test(a.log));
  mode = 'limited';
  a = await runAction({ INPUT_DOMAIN: 'example.com' });
  const b = await runAction({ INPUT_DOMAIN: 'example.com', 'INPUT_MIN-SCORE': '50' });
  const b2 = await runAction({ INPUT_DOMAIN: 'example.com', 'INPUT_MIN-SCORE': '50', 'INPUT_FAIL-ON-CRAWLER-BLOCK': 'true' });
  const empty = (o) => ['score', 'crawlers-blocked', 'failed-checks'].every((k) => new RegExp('^' + k + '=\\n', 'm').test(o));
  t('Action: a rate limit (429) is a warning and exit 0, with no gate AND with min-score or fail-on-crawler-block set; the three outputs are empty strings and the job summary says the scan was skipped', a.code === 0 && b.code === 0 && b2.code === 0 && /::warning::Citehound rate limit reached, skipping this scan\. Try again later\./.test(a.log + b.log + b2.log) && /Retry after 600 seconds/.test(b.log) && empty(a.output) && empty(b.output) && empty(b2.output) && /rate limit reached, so this scan was skipped/.test(b.summary) && !/::error::/.test(b.log + b2.log));
  const c = await runAction({ INPUT_DOMAIN: 'example.com' }, 'http://127.0.0.1:9');
  const d = await runAction({ INPUT_DOMAIN: 'example.com', 'INPUT_MIN-SCORE': '50' }, 'http://127.0.0.1:9');
  t('Action: an unreachable server (not a rate limit) is a warning and exit 0 without a gate, a failure with one', c.code === 0 && /::warning::Could not reach Citehound/.test(c.log) && d.code === 1);
  const before = hits;
  const e = await runAction({ INPUT_DOMAIN: 'not a domain' });
  const f = await runAction({ INPUT_DOMAIN: 'example.com', 'INPUT_MIN-SCORE': '150' });
  t('Action: an invalid domain or a min-score outside 0 to 100 fails at once and makes no request', e.code === 1 && f.code === 1 && hits === before);
  server.close();

  out('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { out('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
})().catch((e) => { out('CRASH ' + (e && e.stack || e)); process.exit(1); });
