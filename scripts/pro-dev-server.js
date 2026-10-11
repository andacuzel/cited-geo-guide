#!/usr/bin/env node
/* =====================================================================
   scripts/pro-dev-server.js: run Citehound Pro locally, no Redis, no network.

     node scripts/pro-dev-server.js [--port 4180] [--fast] [--redis] [--no-mail]

   Serves the static site, applies the rewrites and headers from vercel.json, and
   runs api/pro.js's logic (lib/pro-api.js) against the in-memory store with a pretend
   site to crawl (scripts/pro-fake-site.js). On start it prints a few ready
   start links and one finished report. --fast removes the one-second wait between
   requests so a crawl takes seconds (the wait itself is tested in scripts/test-pro-crawler.js).
   Development only: it skips the public-address check on purpose, and "sends" email to
   the console and to GET /__mail.
   --citation also turns the citation questions on for new reports (a pretend writer, so the profile will be refused: the progress screen
   shows its stages) and seeds three more finished reports: questions only (Turkish), a check on Claude and Perplexity with made-up results, and a check
   where Perplexity failed.
   --readiness stores a stand-in PDF so /research/state-of-ai-readiness can send its (pretend) email; read it at /__mail.
   --real crawls the real site the form names (no pretend site, the public-address check is ON) and, with the keys in .env.local, runs the real
   citation phases: Claude writes the questions, and the check runs on every provider that has a key (Perplexity too, for this run only). It spends
   real money, capped by CITATION_MAX_COST_USD (0.30 here) and the daily and monthly budgets. Nothing is stored outside this process's memory.
   ===================================================================== */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
process.env.PRO_HASH_SECRET = process.env.PRO_HASH_SECRET || 'dev-server-only-secret-0123456789';
const S = require('../lib/pro-store.js');
const api = require('../lib/pro-api.js');
const { makeFakeSite } = require('./pro-fake-site.js');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const port = parseInt((args[args.indexOf('--port') + 1]) || '4180', 10);
const fast = args.indexOf('--fast') !== -1;
const useRedis = args.indexOf('--redis') !== -1;   // the store named by UPSTASH_REDIS_REST_* / KV_REST_API_* instead of memory
const citation = args.indexOf('--citation') !== -1;  // citation questions on, and three seeded reports that show them
const real = args.indexOf('--real') !== -1;
const readiness = args.indexOf('--readiness') !== -1;  // a stand-in State of AI Readiness PDF in the store, so the report form and download links work
const noMail = args.indexOf('--no-mail') !== -1;   // leave the mail variables unset, as in production today

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.woff2': 'font/woff2' };

/* ---- vercel.json: rewrites and headers ---- */
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
function compile(source) {
  const names = [];
  const esc = (x) => x.split('(.*)').map((part) => part.replace(/[.+?^${}|[\]\\]/g, '\\$&')).join('.*');
  let out = ''; let last = 0; let m;
  const param = /:([A-Za-z]+)(\((?:[^()]|\([^()]*\))*\))?/g;
  while ((m = param.exec(source)) !== null) {
    out += esc(source.slice(last, m.index));
    names.push(m[1]);
    out += '(' + (m[2] ? m[2].slice(1, -1) : '[^/]+') + ')';
    last = m.index + m[0].length;
  }
  out += esc(source.slice(last));
  return { re: new RegExp('^' + out + '$'), names: names };
}
const rewrites = (config.rewrites || []).filter((r) => !r.has).map((r) => Object.assign({ c: compile(r.source) }, r));
const headerRules = (config.headers || []).map((h) => Object.assign({ c: compile(h.source) }, h));

/* ---- the pretend world ---- */
const store = useRedis ? S.getStore() : S.createStore(S.memoryAdapter());
if (fast) store.takeSlot = async () => true;
const site = makeFakeSite({ domain: 'demo-site.com', pages: 30, seed: 11, blocked: ['/products/faq'], missing: ['/docs/changelog'], sleep: async () => {} });
const mailbox = [];
const env = noMail ? Object.assign({}, process.env) : Object.assign({}, process.env, { RESEND_API_KEY: 'dev-key', PRO_MAIL_FROM: 'Citehound <reports@dev.invalid>' });
if (citation) Object.assign(env, { ANTHROPIC_API_KEY: 'dev-only', CITATION_ANTHROPIC_ENABLED: '1', CITATION_QUESTIONS_ENABLED: '1' });
if (real) {
  require('./env-local.js').load();
  Object.assign(env, process.env, { CITATION_QUESTIONS_ENABLED: '1', CITATION_ANTHROPIC_ENABLED: '1', CITATION_TEST_ENABLED: '1', CITATION_MAX_COST_USD: process.env.CITATION_MAX_COST_USD || '0.30', CITATION_DAILY_BUDGET_USD: process.env.CITATION_DAILY_BUDGET_USD || '0.60', CITATION_MONTHLY_BUDGET_USD: process.env.CITATION_MONTHLY_BUDGET_USD || '0.60' });
  if (env.PERPLEXITY_API_KEY) env.CITATION_PERPLEXITY_ENABLED = '1';
  if (!env.ANTHROPIC_API_KEY) { console.error('--real needs ANTHROPIC_API_KEY (environment or .env.local).'); process.exit(2); }
}
const deps = {
  store: store,
  env: env,
  checkHost: real ? undefined : async () => ({ ok: true }),
  crawl: real ? { env: env } : { fetch: (url, o) => site.fetch(url, o), sleep: fast ? async () => {} : undefined },
  fetch: async (url, init) => { const body = JSON.parse(init.body); mailbox.push({ at: new Date().toISOString(), to: body.to, subject: body.subject, text: body.text }); console.log('[mail] would send "' + body.subject + '"'); return { ok: true, status: 200 }; },
  pollMs: 50
};
if (citation && !real) {
  const F = require('./fixtures/citation-fixtures.js').SITES;
  deps.citation = { llm: { model: 'dev-model', json: async (req) => (req.schema.properties.siteType ? F.en.profile : { questions: F.en.open.map((text) => ({ text, kind: 'category' })), brandQuestions: F.en.brandQs.map((text) => ({ text })) }) }, providers: {}, sleep: async () => {} };
}

function shim(req, res, query) {
  req.query = query;
  res.status = (c) => { res.statusCode = c; return res; };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(u.pathname);
  const query = {}; u.searchParams.forEach((v, k) => { query[k] = v; });

  if (pathname === '/__mail') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(mailbox)); return; }
  if (pathname === '/__orders' && req.method === 'POST') {
    const o = await store.createOrder(); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ token: o.token, path: '/pro/start/' + o.token })); return;
  }

  let target = pathname;
  let q = query;
  for (const r of rewrites) {
    const m = r.c.re.exec(pathname);
    if (m) {
      const dest = new URL(r.destination.replace(/:([A-Za-z]+)/g, (x, n) => { const i = r.c.names.indexOf(n); return i === -1 ? x : encodeURIComponent(m[i + 1]); }), 'http://localhost');
      target = dest.pathname; q = Object.assign({}, query); dest.searchParams.forEach((v, k) => { q[k] = v; });
      break;
    }
  }
  headerRules.forEach((h) => { if (h.c.re.test(pathname)) h.headers.forEach((x) => res.setHeader(x.key, x.value)); });

  if (target === '/api/pro') {
    shim(req, res, q);
    try { await api.handle(req, res, deps); } catch (e) { console.error(e); res.statusCode = 500; res.end('error'); }
    return;
  }
  let file = path.join(ROOT, target);
  if (!file.startsWith(ROOT)) { res.statusCode = 403; res.end(); return; }
  const tryFiles = [file, file + '.html', path.join(file, 'index.html')];
  const found = tryFiles.find((f) => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } });
  if (!found) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); res.end('Not found: ' + pathname); return; }
  res.setHeader('Content-Type', MIME[path.extname(found)] || 'application/octet-stream');
  fs.createReadStream(found).pipe(res);
});

(async function () {
  if (readiness) { const R = require('../lib/readiness.js'); const F = require('./fixtures/readiness-fixtures.js'); await R.putPdf(store.adapter, F.fakePdf(), F.NAME); console.log('  readiness: a stand-in PDF is stored; open /research/state-of-ai-readiness'); }
  // One finished report from the frozen sample, so the report page can be looked at straight away.
  const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'pro', 'sample-report.json'), 'utf8'));
  const ord = await store.createOrder();
  const jobId = await store.createJob({ domain: sample.domain });
  await store.setPages(jobId, sample.pages.map((p) => p.url));
  for (let i = 0; i < sample.pages.length; i++) { const p = sample.pages[i]; await store.updatePage(jobId, i, p.status === 'ok' ? { url: p.url, status: 'ok', result: p.result, siteInfo: p.siteInfo } : { url: p.url, status: 'failed', error: p.error || 'HTTP 500' }); }
  await store.setJob(jobId, { status: 'done', phase: 'done', finishedAt: new Date().toISOString(), siteContext: sample.siteContext, discoverySource: sample.discovery && sample.discovery.source, candidates: sample.discovery && sample.discovery.candidates });
  await store.markOrderUsed(ord.token, { jobId: jobId, contact: { name: 'Dev Person', email: 'dev.person@example.invalid' } });
  if (citation && !real) {
    // Three more finished reports, with citation records written straight into the store.
    const F = require('./fixtures/citation-fixtures.js').SITES;
    const Prompts = require('../lib/citation-prompts.js');
    const Cit = require('../lib/pro-citation.js');
    const reason = 'The provider could not be reached, so the remaining questions were not tested.';
    const seed = async (site, modes, perProvider) => {
      const id = await store.createJob({ domain: sample.domain, citation: true });
      await store.setPages(id, sample.pages.map((p) => p.url));
      for (let i = 0; i < sample.pages.length; i++) { const p = sample.pages[i]; await store.updatePage(id, i, p.status === 'ok' ? { url: p.url, status: 'ok', result: p.result, siteInfo: p.siteInfo } : { url: p.url, status: 'failed', error: p.error || 'HTTP 500' }); }
      await store.setJob(id, { status: 'done', phase: 'done', finishedAt: new Date().toISOString(), siteContext: sample.siteContext, discoverySource: sample.discovery && sample.discovery.source, candidates: sample.discovery && sample.discovery.candidates });
      const items = site.open.map((text, i) => ({ text, gloss: site.lang === 'en' ? '' : 'English version of question ' + (i + 1), kind: Prompts.KINDS[i % 5], brand: false })).concat(site.brandQs.map((text, i) => ({ text, gloss: site.lang === 'en' ? '' : 'English version of brand question ' + (i + 1), kind: 'brand', brand: true })));
      const idx = Cit.pickSample(items, id, 10);
      const allOk = perProvider && Object.keys(perProvider).every((p) => perProvider[p] === 'ok');
      const set = { status: perProvider ? (allOk ? 'ok' : 'partial') : 'questions', stage: 'done', reason: perProvider && !allOk ? reason : '', profile: site.profile, questions: { source: 'llm', items }, source: 'llm', model: 'claude-haiku-5-5', date: '2026-10-11', modes: modes };
      if (perProvider) { set.sample = idx; set.pstat = {}; Object.keys(perProvider).forEach((p) => { const ok = perProvider[p] === 'ok'; set.pstat[p] = { status: ok ? 'ok' : 'not_tested', tested: ok ? 10 : 0, of: 10, reason: ok ? '' : reason, stop: ok ? null : 'provider' }; }); }
      await store.setCitation(id, set);
      if (perProvider) for (const p of Object.keys(perProvider)) for (let k = 0; k < idx.length; k++) await store.setCitationResult(id, p, idx[k], perProvider[p] === 'ok' ? { state: 'tested', cited: k % 4 === 0, mentioned: k % 3 === 0, others: ['alpha.example', 'beta.example', 'gamma.example'].slice(0, k % 4), links: { 'alpha.example': 'https://alpha.example/guide', 'beta.example': 'https://beta.example/' }, queries: 1, kind: p === 'perplexity' ? 'returned' : 'cited', model: p === 'perplexity' ? 'perplexity/sonar' : 'claude-haiku-5-5', date: '2026-10-11', micro: 5000 } : { state: 'not_tested', reason: 'provider' });
      const o = await store.createOrder();
      await store.markOrderUsed(o.token, { jobId: id, contact: { name: 'Dev Person', email: 'dev.person@example.invalid' } });
      return id;
    };
    const m = { test: true, knowledge: false, generator: 'anthropic', providers: ['anthropic', 'perplexity'], models: { anthropic: 'claude-haiku-5-5', perplexity: 'perplexity/sonar' }, sample: 10 };
    const q = await seed(F.tr, { test: false, knowledge: false, generator: 'anthropic', providers: ['anthropic'], models: {}, sample: 10 }, null);
    const both = await seed(F.en, m, { anthropic: 'ok', perplexity: 'ok' });
    const down = await seed(F.en, m, { anthropic: 'ok', perplexity: 'down' });
    console.log('  questions only (Turkish): /r/' + q + '/');
    console.log('  check on Claude and Perplexity (made-up results): /r/' + both + '/');
    console.log('  check where Perplexity failed: /r/' + down + '/');
  }
  server.listen(port, () => {
    console.log('Citehound Pro dev server on http://localhost:' + port + (fast ? ' (fast crawl)' : ''));
    console.log('  finished report: /r/' + jobId + '/');
  });
  process.on('SIGINT', () => process.exit(0));
}());
