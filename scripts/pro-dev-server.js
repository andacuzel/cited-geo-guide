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
const citation = args.indexOf('--citation') !== -1;  // citation questions on, and two seeded reports that show them
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
if (citation) Object.assign(env, { GEMINI_API_KEY: 'dev-only', CITATION_QUESTIONS_ENABLED: '1' });
const deps = {
  store: store,
  env: env,
  checkHost: async () => ({ ok: true }),
  crawl: { fetch: (url, o) => site.fetch(url, o), sleep: fast ? async () => {} : undefined },
  fetch: async (url, init) => { const body = JSON.parse(init.body); mailbox.push({ at: new Date().toISOString(), to: body.to, subject: body.subject, text: body.text }); console.log('[mail] would send "' + body.subject + '"'); return { ok: true, status: 200 }; },
  pollMs: 50
};
if (citation) {
  const F = require('./fixtures/citation-fixtures.js').SITES;
  deps.citation = { llm: { model: 'dev-model', json: async (req) => (req.schema.properties.siteType ? F.en.profile : { questions: F.en.open.map((text) => ({ text, kind: 'discovery' })), brandQuestions: F.en.brandQs.map((text) => ({ text })) }) }, sleep: async () => {} };
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
  // One finished report from the frozen sample, so the report page can be looked at straight away.
  const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'pro', 'sample-report.json'), 'utf8'));
  const ord = await store.createOrder();
  const jobId = await store.createJob({ domain: sample.domain });
  await store.setPages(jobId, sample.pages.map((p) => p.url));
  for (let i = 0; i < sample.pages.length; i++) { const p = sample.pages[i]; await store.updatePage(jobId, i, p.status === 'ok' ? { url: p.url, status: 'ok', result: p.result, siteInfo: p.siteInfo } : { url: p.url, status: 'failed', error: p.error || 'HTTP 500' }); }
  await store.setJob(jobId, { status: 'done', phase: 'done', finishedAt: new Date().toISOString(), siteContext: sample.siteContext, discoverySource: sample.discovery && sample.discovery.source, candidates: sample.discovery && sample.discovery.candidates });
  await store.markOrderUsed(ord.token, { jobId: jobId, contact: { name: 'Dev Person', email: 'dev.person@example.invalid' } });
  if (citation) {
    // Two more finished reports, with citation records written straight into the store.
    const F = require('./fixtures/citation-fixtures.js').SITES;
    const seed = async (site, modes, withResults) => {
      const id = await store.createJob({ domain: sample.domain, citation: true });
      await store.setPages(id, sample.pages.map((p) => p.url));
      for (let i = 0; i < sample.pages.length; i++) { const p = sample.pages[i]; await store.updatePage(id, i, p.status === 'ok' ? { url: p.url, status: 'ok', result: p.result, siteInfo: p.siteInfo } : { url: p.url, status: 'failed', error: p.error || 'HTTP 500' }); }
      await store.setJob(id, { status: 'done', phase: 'done', finishedAt: new Date().toISOString(), siteContext: sample.siteContext, discoverySource: sample.discovery && sample.discovery.source, candidates: sample.discovery && sample.discovery.candidates });
      const items = site.open.map((text, i) => ({ text, gloss: site.lang === 'en' ? '' : 'English version of question ' + (i + 1), kind: 'discovery', brand: false })).concat(site.brandQs.map((text, i) => ({ text, gloss: site.lang === 'en' ? '' : 'English version of brand question ' + (i + 1), kind: 'brand', brand: true })));
      await store.setCitation(id, { status: withResults ? 'ok' : 'questions', stage: 'done', reason: '', profile: site.profile, questions: { source: 'llm', items }, source: 'llm', model: 'claude-haiku-5-5', date: '2026-10-10', modes: modes, kmodel: 'claude-haiku-5-5', kdate: '2026-10-10', kstatus: modes.knowledge ? 'ok' : '' });
      if (withResults) for (let i = 0; i < items.length; i++) {
        await store.setCitationResult(id, i, { state: 'tested', cited: i % 5 === 0, mentioned: i % 3 === 0, others: ['alpha.example', 'beta.example', 'gamma.example'].slice(0, i % 4), links: { 'alpha.example': 'https://alpha.example/guide', 'beta.example': 'https://beta.example/' }, queries: 2, model: 'claude-haiku-5-5', date: '2026-10-10' });
        if (modes.knowledge) await store.setKnowledgeResult(id, i, { state: 'tested', named: i % 4 === 0, model: 'claude-haiku-5-5', date: '2026-10-10' });
      }
      const o = await store.createOrder();
      await store.markOrderUsed(o.token, { jobId: id, contact: { name: 'Dev Person', email: 'dev.person@example.invalid' } });
      return id;
    };
    const q = await seed(F.tr, { test: false, knowledge: false, provider: null, model: null }, false);
    const full = await seed(F.en, { test: true, knowledge: true, provider: 'anthropic', model: 'claude-haiku-5-5' }, true);
    console.log('  questions only (Turkish): /r/' + q + '/');
    console.log('  testing + knowledge check (made-up results): /r/' + full + '/');
  }
  server.listen(port, () => {
    console.log('Citehound Pro dev server on http://localhost:' + port + (fast ? ' (fast crawl)' : ''));
    console.log('  finished report: /r/' + jobId + '/');
  });
  process.on('SIGINT', () => process.exit(0));
}());
