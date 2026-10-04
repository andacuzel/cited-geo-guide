#!/usr/bin/env node
/* =====================================================================
   scripts/test-crawl-summarize.js — api/crawl-summarize.js against a mock KV
   and a mock Gemini server. No real request is made.
   ===================================================================== */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const store = new Map(); const kvLog = []; let forceCount = null;
const kv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => {
  const out = JSON.parse(b).map((c) => { kvLog.push(c); const [op, key, ...rest] = c;
    if (op === 'GET') { const e = store.get(key); return { result: e ? e.val : null }; }
    if (op === 'SET') { store.set(key, { val: rest[0] }); return { result: 'OK' }; }
    if (op === 'INCR') { if (forceCount) return { result: forceCount }; const e = store.get(key) || { val: '0' }; e.val = String(+e.val + 1); store.set(key, e); return { result: +e.val }; }
    return { result: 1 }; });
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out)); }); });
let geminiMode = 'ok', geminiCalls = 0, geminiReply = '';
const gem = http.createServer((req, res) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { geminiCalls++;
  if (geminiMode === 'fail') { res.statusCode = 500; res.end('{}'); return; }
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: geminiReply }] } }] })); }); });
const mockRes = () => { const r = { code: 200, headers: {}, body: null, setHeader(k, v) { r.headers[k.toLowerCase()] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const call = async (h, query, method) => { const r = mockRes(); await h({ method: method || 'GET', query, url: '/api/crawl-summarize', headers: { 'x-forwarded-for': '198.51.100.9' }, socket: {} }, r); return r; };
let pass = 0, fail = 0; const t = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? '  ok  ' : '  FAIL ') + n + (ok ? '' : '  ' + (x || ''))); };

kv.listen(0, () => gem.listen(0, async () => {
  process.env.KV_REST_API_URL = 'http://127.0.0.1:' + kv.address().port; process.env.KV_REST_API_TOKEN = 't';
  process.env.GEMINI_API_BASE = 'http://127.0.0.1:' + gem.address().port;
  delete process.env.GEMINI_API_KEY;
  const handler = require(ROOT + '/api/crawl-summarize.js');
  const { createJob, generateJobId } = require(ROOT + '/api/_crawlStore.js');
  const F = require(ROOT + '/lib/report-facts.js'), S = require(ROOT + '/lib/summary.js'), schema = require(ROOT + '/lib/schema.js');
  const sample = JSON.parse(fs.readFileSync(ROOT + '/content/pro/sample-report.json', 'utf8'));
  const jobFrom = (over) => ({ id: generateJobId(), domain: sample.domain, status: 'done', pages: sample.pages, pages_done: sample.pages.length, created_at: sample.createdAt, siteContext: sample.siteContext, summary: sample.summary, ...over });
  const getStored = (id) => JSON.parse(store.get('crawl:' + id).val);

  console.log('no key: the rules summary, stored once');
  let job = jobFrom(); await createJob(job);
  let r = await call(handler, { id: job.id });
  t('200 with a rules summary and its label', r.code === 200 && r.body.summary.source.kind === 'rules' && r.body.summary.label === 'Summary written by rules from the figures below' && r.body.usedFallback === true, JSON.stringify(r.body).slice(0, 150));
  t('it is stored on the job record', getStored(job.id).executiveSummary.headline === r.body.summary.headline);
  t('no request reached the model', geminiCalls === 0);
  const first = JSON.stringify(r.body.summary);
  r = await call(handler, { id: job.id });
  t('a second request returns the stored summary unchanged', r.code === 200 && r.body.stored === true && JSON.stringify(r.body.summary) === first);

  console.log('with a key: the model rephrases, the reply is validated');
  process.env.GEMINI_API_KEY = 'test-key';
  const f = F.facts(require(ROOT + '/api/crawl-result.js').jobToResult(jobFrom()), { schema });
  f.verdict.benchmark = null;
  job = jobFrom(); await createJob(job);
  const data = require(ROOT + '/api/crawl-result.js').jobToResult(job); data.benchmark = F.benchmarkFromData(ROOT + '/data');
  const ff = F.facts(data, { schema });
  const good = S.deterministic(ff); good.headline = 'The site scores ' + ff.verdict.siteWide + ' out of 100.'; geminiReply = JSON.stringify(good); geminiMode = 'ok';
  r = await call(handler, { id: job.id });
  t('a valid reply is stored with the model name and its date', r.code === 200 && r.body.summary.source.kind === 'model' && /^\d{4}-\d{2}-\d{2}$/.test(r.body.summary.source.date) && /checked against them$/.test(r.body.summary.label) && geminiCalls === 1, JSON.stringify(r.body.summary.source) + ' calls ' + geminiCalls);
  const callsBefore = geminiCalls;
  r = await call(handler, { id: job.id });
  t('a stored summary is never overwritten and costs no further request', r.body.stored === true && geminiCalls === callsBefore);

  console.log('failures fall back');
  job = jobFrom(); await createJob(job); geminiMode = 'fail'; geminiCalls = 0;
  r = await call(handler, { id: job.id });
  t('the API failing twice falls back to the rules summary (2 requests)', r.code === 200 && r.body.summary.source.kind === 'rules' && geminiCalls === 2, 'calls ' + geminiCalls);
  job = jobFrom(); await createJob(job); geminiMode = 'ok'; geminiReply = '{ nope'; geminiCalls = 0;
  r = await call(handler, { id: job.id });
  t('malformed replies twice fall back to the rules summary', r.body.summary.source.kind === 'rules' && geminiCalls === 2);
  job = jobFrom(); await createJob(job); geminiReply = JSON.stringify(Object.assign({}, good, { working: 'A robust setup. Fine.' })); geminiCalls = 0;
  r = await call(handler, { id: job.id });
  t('a reply with a banned word twice falls back to the rules summary', r.body.summary.source.kind === 'rules');

  console.log('already summarized, unfinished, bad requests');
  job = jobFrom({ executiveSummary: { headline: 'kept', source: { kind: 'rules' } } }); await createJob(job); geminiCalls = 0;
  r = await call(handler, { id: job.id });
  t('an existing summary is returned as is, with no model request', r.body.summary.headline === 'kept' && geminiCalls === 0);
  job = jobFrom({ status: 'running' }); await createJob(job);
  r = await call(handler, { id: job.id }); t('an unfinished crawl is a 409', r.code === 409 && /not finished/.test(r.body.error));
  r = await call(handler, { id: 'f'.repeat(32) }); t('an unknown id is a 404', r.code === 404 && /never existed or it has expired/.test(r.body.error));
  r = await call(handler, { id: 'zz' }); t('a malformed id is a 400', r.code === 400);
  r = await call(handler, {}); t('a missing id is a 400', r.code === 400);
  r = await call(handler, { id: job.id }, 'POST'); t('POST is a 405', r.code === 405);
  forceCount = 21; r = await call(handler, { id: job.id }); forceCount = null; t('rate limited like the other endpoints (429 with Retry-After)', r.code === 429 && !!r.headers['retry-after']);
  const blob = JSON.stringify(kvLog); t('no raw IP reaches storage', blob.indexOf('198.51.100.9') === -1);
  delete process.env.KV_REST_API_URL; r = await call(handler, { id: job.id }); t('storage unavailable is a 503', r.code === 503);

  console.log('\n' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '')); kv.close(); gem.close(); process.exit(fail ? 1 : 0);
}));
