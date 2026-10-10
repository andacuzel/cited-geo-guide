#!/usr/bin/env node
/* =====================================================================
   scripts/test-citation-live.js: a manual, real run of the Pro citation check on one or more sites.

     node scripts/test-citation-live.js                         our own site and one German site (the defaults)
     node scripts/test-citation-live.js example.com example.de  your own choice
     node scripts/test-citation-live.js --no-search example.com skip the searched questions (only profile and questions)

   NOT part of npm run gates (it uses the network, a real model and the real keys). It runs the same code a report runs
   (crawl, profile, questions, searched questions) against an in-memory store, so nothing is written to Redis and no
   report is made. It needs GEMINI_API_KEY (environment or the gitignored .env.local); CITATION_ENABLED is set for the run.
   It prints what the model understood, the questions, the answers' cited / mentioned flags, the calls made, the tokens used
   and an estimated cost at Google's published prices (checked 10 Oct 2026: Gemini 3.5 Flash-Lite $0.30 per million input
   tokens and $2.50 per million output; Search grounding 5,000 free queries a month shared by Gemini 3 and newer, then $14 per
   thousand). The key is never printed. The crawl obeys robots.txt and reads at most 25 pages a site, one a second.
   ===================================================================== */

'use strict';

require('./env-local.js').load();
process.env.PRO_HASH_SECRET = process.env.PRO_HASH_SECRET || 'live-test-secret-0123456789abcdef';
process.env.CITATION_ENABLED = '1';

const S = require('../lib/pro-store.js');
const Crawler = require('../lib/pro-crawler.js');
const Cit = require('../lib/pro-citation.js');
const LlmG = require('../lib/llm-gemini.js');
const Check = require('../lib/citation-check.js');
const F = require('../lib/safe-fetch.js');
const scanner = require('../lib/scanner.js');

const args = process.argv.slice(2);
const noSearch = args.indexOf('--no-search') !== -1;
const sites = args.filter((a) => a[0] !== '-');
if (!sites.length) sites.push('getcitehound.com', 'lexware.de');
const out = (s) => process.stdout.write(s + '\n');
if (!process.env.GEMINI_API_KEY) { out('GEMINI_API_KEY is not set (environment or .env.local). Nothing was done.'); process.exit(2); }

const PRICE_IN = 0.30 / 1e6, PRICE_OUT = 2.50 / 1e6, PRICE_SEARCH = 14 / 1000;

async function runSite(domain) {
  out('\n=== ' + domain + ' ===');
  const store = S.createStore(S.memoryAdapter());
  const tokens = { calls: 0, input: 0, output: 0 };
  const model = LlmG.modelName(process.env);
  const llm = LlmG.makeJsonLlm({ apiKey: process.env.GEMINI_API_KEY, model: model, onCall: (c) => { tokens.calls++; tokens.input += c.inputTokens || 0; tokens.output += c.outputTokens || 0; } });
  let searched = 0, queries = 0;
  const real = Check.geminiProvider({ apiKey: process.env.GEMINI_API_KEY, model: model });
  const provider = { name: real.name, model: model, ask: async (q) => { if (noSearch) throw new Check.CheckError('quota', 'search skipped (--no-search)'); searched++; const r = await real.ask(q); queries += r.queries.length; return r; } };
  const jobId = await store.createJob({ domain: domain, citation: true });
  await store.reserveDomainSlot(domain, 2);
  const deps = { env: process.env, citation: { llm: llm, provider: provider, resolve: Check.makeResolver(F.safeGet, scanner.CRAWLER_UA) } };
  const started = Date.now();
  let last = null;
  for (let i = 0; i < 200; i++) {
    last = await Crawler.runStep(store, jobId, deps);
    if (['done', 'partial', 'failed'].indexOf(last.status) !== -1) break;
    if (last.busy) await new Promise((r) => setTimeout(r, 1000));
  }
  const job = await store.getJob(jobId);
  out('crawl: ' + job.status + ', ' + job.progress.done + ' pages read, ' + job.progress.blocked + ' blocked, ' + job.progress.failed + ' not read' + (job.reason ? ' (' + job.reason + ')' : '') + ', ' + Math.round((Date.now() - started) / 1000) + ' s');
  const c = job.citation;
  if (!c) { out('no citation record'); return { domain: domain, tokens: tokens, searched: 0, queries: 0, status: 'none' }; }
  out('citation: ' + c.status + (c.reason ? ' | ' + c.reason : ''));
  if (c.profile) out('profile: ' + JSON.stringify(c.profile));
  if (c.questions) {
    out('questions (' + c.questions.items.length + ', source ' + c.questions.source + '):');
    c.questions.items.forEach((q, i) => {
      const r = c.results[i];
      const state = r ? (r.state === 'tested' ? 'cited ' + (r.cited ? 'yes' : 'no') + ', mentioned ' + (r.mentioned ? 'yes' : 'no') + (r.others.length ? ', others: ' + r.others.join(' ') : '') : 'not tested (' + r.reason + ')') : '-';
      out('  ' + String(i + 1).padStart(2) + '. ' + q.text + (q.gloss ? '  [' + q.gloss + ']' : '') + (q.brand ? '  (names the brand)' : '') + '\n      ' + state);
    });
  }
  return { domain: domain, tokens: tokens, searched: searched, queries: queries, status: c.status, language: c.profile && c.profile.language, tested: c ? Object.values(c.results).filter((x) => x.state === 'tested').length : 0, questions: c.questions ? c.questions.items.length : 0 };
}

(async function main() {
  const rows = [];
  for (const d of sites) rows.push(await runSite(d));
  out('\n=== totals ===');
  let tin = 0, tout = 0, searched = 0, queries = 0;
  rows.forEach((r) => { tin += r.tokens.input; tout += r.tokens.output; searched += r.searched; queries += r.queries; out(r.domain + ': language ' + (r.language || '-') + ', status ' + r.status + ', ' + r.tested + ' of ' + r.questions + ' tested, ' + r.tokens.calls + ' model calls (' + r.tokens.input + ' in, ' + r.tokens.output + ' out tokens), ' + r.searched + ' searched calls, ' + r.queries + ' search queries'); });
  out('estimated cost at paid prices if billing were on: tokens $' + (tin * PRICE_IN + tout * PRICE_OUT).toFixed(4) + ', search $' + (queries * PRICE_SEARCH).toFixed(4) + ' (and $0 for search while under 5,000 queries a month). On a free-tier key the cost is $0, and search is refused (HTTP 429).');
}()).catch((e) => { process.stderr.write('The live run stopped: ' + (e && e.name) + ' ' + String(e && e.message || '').replace(/https?:\/\/\S+/g, '<url>') + '\n'); process.exit(1); });
