#!/usr/bin/env node
/* =====================================================================
   scripts/test-citation-live.js: a manual, REAL run of the Pro citation part on one or more sites. It spends real money.

     node scripts/test-citation-live.js getcitehound.com                          the profile and the 21 questions only (about a cent)
     node scripts/test-citation-live.js --test --calls 3 getcitehound.com         also ask 3 of the questions on every provider that has a key
     node scripts/test-citation-live.js --test --calls 3 --providers perplexity getcitehound.com
     node scripts/test-citation-live.js --test --calls 3 --knowledge getcitehound.com     and the no-search knowledge check, same 3 questions

   NOT part of npm run gates. It runs the same code a report runs (crawl, profile, questions, the live phases) against an in-memory store: nothing is
   written to Redis and no report is made. Keys come from the environment or the gitignored .env.local (ANTHROPIC_API_KEY, PERPLEXITY_API_KEY) and are
   never printed. --calls N is the number of questions asked per provider (default 3, never more than 10). The per-report cost cap is also set, to
   CITATION_MAX_COST_USD or 0.30 for the run. After each run it prints, per provider call, the tokens, the searches and the cost the provider reported
   or the cost computed from its price, and the cost per report extrapolated to the default 10 questions. The crawl obeys robots.txt and reads at most
   25 pages a site, one a second; only the domain, the questions and a locale tag reach a provider.
   ===================================================================== */

'use strict';

require('./env-local.js').load();
process.env.PRO_HASH_SECRET = process.env.PRO_HASH_SECRET || 'live-test-secret-0123456789abcdef';

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i === -1 ? d : args[i + 1]; };
const wantTest = args.indexOf('--test') !== -1, wantKnow = args.indexOf('--knowledge') !== -1;
const calls = Math.max(1, Math.min(10, parseInt(val('--calls', '3'), 10) || 3));
const only = (val('--providers', '') || '').split(',').filter(Boolean);
const flagIdx = new Set(['--calls', '--providers']);
const sites = args.filter((a, i) => a[0] !== '-' && !flagIdx.has(args[i - 1]));
if (!sites.length) sites.push('getcitehound.com');
const out = (s) => process.stdout.write(s + '\n');

const Config = require('../lib/citation-config.js');
if (!process.env.ANTHROPIC_API_KEY) { out('ANTHROPIC_API_KEY is not set (environment or .env.local). The questions are written by Claude, so nothing was done.'); process.exit(2); }

// The switches for this run only.
process.env.CITATION_QUESTIONS_ENABLED = '1';
process.env.CITATION_ANTHROPIC_ENABLED = '1';
process.env.CITATION_QUESTION_SAMPLE = String(calls);
process.env.CITATION_MAX_CALLS = String(6 + calls * 3);
process.env.CITATION_MAX_COST_USD = process.env.CITATION_MAX_COST_USD || '0.30';
if (wantTest) {
  process.env.CITATION_TEST_ENABLED = '1';
  if (process.env.PERPLEXITY_API_KEY && (!only.length || only.indexOf('perplexity') !== -1)) process.env.CITATION_PERPLEXITY_ENABLED = '1';
  if (only.length && only.indexOf('anthropic') === -1) { out('Note: --providers leaves out anthropic, but Claude still writes the questions (without search).'); process.env.CITATION_ANTHROPIC_ENABLED = '1'; }
}
if (wantKnow) process.env.CITATION_KNOWLEDGE_ENABLED = '1';
if (wantTest && !process.env.PERPLEXITY_API_KEY) out('Perplexity: SKIPPED (no PERPLEXITY_API_KEY).');
if (wantTest && process.env.CITATION_PERPLEXITY_ENABLED !== '1' && process.env.PERPLEXITY_API_KEY) out('Perplexity: left out by --providers.');

const S = require('../lib/pro-store.js');
const Crawler = require('../lib/pro-crawler.js');
const Providers = require('../lib/citation-providers.js');
const Budget = require('../lib/citation-budget.js');

async function runSite(domain) {
  out('\n=== ' + domain + ' ===');
  const store = S.createStore(S.memoryAdapter());
  const flags = Config.flags(process.env);
  const log = [];
  const wrap = (a, label) => ({ id: a.id, label: a.label, model: a.model, generate: a.generate && (async function (req) { const r = await a.generate(req); log.push({ who: label + ' (questions, no search)', usage: r.usage, searches: 0, usd: r.costUsd }); return r; }), json: a.json && a.json.bind(a),
    runPrompt: async function (o) { const r = await a.runPrompt(o); log.push({ who: label + (o.search === false ? ' (no search)' : ' (search)'), usage: r.usage, searches: r.searches, usd: r.costUsd, error: r.error && r.error.kind }); return r; } });
  const providers = {};
  flags.providers.forEach((id) => { providers[id] = wrap(Providers.make(id, process.env), id); });
  const writer = wrap(Providers.make('anthropic', process.env), 'anthropic');
  const jobId = await store.createJob({ domain: domain, citation: true });
  await store.reserveDomainSlot(domain, 2);
  const deps = { env: process.env, citation: { llm: writer, providers: providers } };
  const started = Date.now();
  for (let i = 0; i < 300; i++) {
    const last = await Crawler.runStep(store, jobId, deps);
    if (['done', 'partial', 'failed'].indexOf(last.status) !== -1) break;
    if (last.busy) await new Promise((r) => setTimeout(r, 1000));
  }
  const job = await store.getJob(jobId);
  out('crawl: ' + job.status + ', ' + job.progress.done + ' pages read, ' + job.progress.blocked + ' blocked, ' + job.progress.failed + ' not read' + (job.reason ? ' (' + job.reason + ')' : '') + ', ' + Math.round((Date.now() - started) / 1000) + ' s');
  const c = job.citation;
  if (!c) { out('no citation record'); return { domain: domain, log: log }; }
  out('citation: ' + c.status + (c.reason ? ' | ' + c.reason : '') + (c.kstatus ? ' | knowledge: ' + c.kstatus + (c.kreason ? ' ' + c.kreason : '') : ''));
  if (c.profile) out('profile: ' + JSON.stringify(c.profile));
  if (c.questions) {
    const its = c.questions.items;
    const per = {}; its.forEach((q) => { const k = q.brand ? 'brand' : q.kind; per[k] = (per[k] || 0) + 1; });
    out('questions (' + its.length + ', source ' + c.questions.source + '): ' + Object.keys(per).map((k) => k + ' ' + per[k]).join(', '));
    its.forEach((q, i) => {
      const parts = [];
      Object.keys(c.results).forEach((p) => { const r = c.results[p][i]; if (r) parts.push(p + ': ' + (r.state === 'tested' ? (r.kind === 'returned' ? 'returned ' : 'cited ') + (r.cited ? 'yes' : 'no') + ', brand in text ' + (r.mentioned ? 'yes' : 'no') + (r.others.length ? ', others: ' + r.others.join(' ') : '') + ' [$' + (r.micro / 1e6).toFixed(4) + ']' : 'not tested (' + r.reason + ')')); });
      const k = c.knowledge[i]; if (k) parts.push('knowledge: ' + (k.state === 'tested' ? 'named ' + (k.named ? 'yes' : 'no') : 'not tested (' + k.reason + ')'));
      out('  ' + String(i + 1).padStart(2) + '. [' + (q.brand ? 'brand' : q.kind) + '] ' + q.text + (q.gloss ? '  {' + q.gloss + '}' : '') + (parts.length ? '\n      ' + parts.join(' | ') : ''));
    });
  }
  out('spend recorded on the report: $' + (c.spend / 1e6).toFixed(4) + ' in ' + c.calls + ' paid calls');
  return { domain: domain, log: log, record: c };
}

(async function main() {
  const all = [];
  for (const d of sites) all.push(await runSite(d));
  out('\n=== every paid call ===');
  let total = 0; const by = {};
  all.forEach((r) => r.log.forEach((l) => {
    total += l.usd || 0; (by[l.who] = by[l.who] || { n: 0, usd: 0, searches: 0, inT: 0, outT: 0 }); const b = by[l.who]; b.n++; b.usd += l.usd || 0; b.searches += l.searches || 0; b.inT += (l.usage && (l.usage.input_tokens || 0)) || 0; b.outT += (l.usage && (l.usage.output_tokens || 0)) || 0;
    out('  ' + l.who + ': ' + ((l.usage && (l.usage.input_tokens || 0)) || 0) + ' in, ' + ((l.usage && (l.usage.output_tokens || 0)) || 0) + ' out tokens, ' + (l.searches || 0) + ' searches, $' + (l.usd || 0).toFixed(5) + (l.error ? ', error ' + l.error : ''));
  }));
  out('\nTOTAL real cost of this run: $' + total.toFixed(4));
  Object.keys(by).forEach((k) => { const b = by[k]; if (/search\)/.test(k)) out('  ' + k + ': average $' + (b.usd / b.n).toFixed(5) + ' a question, so 10 questions cost about $' + (b.usd / b.n * 10).toFixed(3)); });
  void Budget;
}()).catch((e) => { process.stderr.write('The live run stopped: ' + (e && e.name) + ' ' + String(e && e.message || '').replace(/https?:\/\/\S+/g, '<url>') + '\n'); process.exit(1); });
