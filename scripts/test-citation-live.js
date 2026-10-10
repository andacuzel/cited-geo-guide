#!/usr/bin/env node
/* =====================================================================
   scripts/test-citation-live.js: a manual, real run of the Pro citation part on one or more sites.

     node scripts/test-citation-live.js                           the profile and the 21 questions for our own site and one German site
     node scripts/test-citation-live.js example.com example.de    your own choice of sites
     node scripts/test-citation-live.js --test --calls 3 example.com
                                                                  also ask the first 3 questions with the provider's web search
     node scripts/test-citation-live.js --knowledge --calls 3 example.com
                                                                  also ask the first 3 questions to the provider with no search

   NOT part of npm run gates (it uses the network, real models and real keys). It runs the same code a report runs (crawl, profile,
   questions, and with --test / --knowledge the live phases) against an in-memory store: nothing is written to Redis and no report is
   made. The questions part needs GEMINI_API_KEY (environment or the gitignored .env.local). --test and --knowledge need
   CITATION_TEST_PROVIDER=anthropic and ANTHROPIC_API_KEY; without them those parts are SKIPPED and the script says so. --calls N caps
   the live calls of the whole run (default 3, never more than 10): the same CITATION_DAILY_CAP the deployment uses. Keys are never
   printed. The sites' public pages go to Google's Gemini API to write the questions: on a key without billing, Google may use that
   content to improve its products (docs/citation-check.md), so run this only on public sites you are happy to send.
   The crawl obeys robots.txt and reads at most 25 pages a site, one a second.

   Cost estimate prices (read 10 Oct 2026, unverified for later dates): Gemini 3.5 Flash-Lite $0.30 per million input tokens and $2.50 per million
   output tokens; Claude Haiku 5.5 $0.10 / $0.50 per million tokens and $10 per 1,000 web searches (Anthropic's pricing page).
   ===================================================================== */

'use strict';

require('./env-local.js').load();
process.env.PRO_HASH_SECRET = process.env.PRO_HASH_SECRET || 'live-test-secret-0123456789abcdef';

const args = process.argv.slice(2);
const wantTest = args.indexOf('--test') !== -1, wantKnow = args.indexOf('--knowledge') !== -1;
const ci = args.indexOf('--calls');
const calls = Math.max(1, Math.min(10, ci === -1 ? 3 : parseInt(args[ci + 1], 10) || 3));
const sites = args.filter((a, i) => a[0] !== '-' && !(ci !== -1 && i === ci + 1));
if (!sites.length) sites.push('getcitehound.com', 'lexware.de');
const out = (s) => process.stdout.write(s + '\n');
if (!process.env.GEMINI_API_KEY) { out('GEMINI_API_KEY is not set (environment or .env.local). Nothing was done.'); process.exit(2); }

// The switches for this run only. Live parts are on only when asked for AND the provider key is present.
process.env.CITATION_QUESTIONS_ENABLED = '1';
process.env.CITATION_DAILY_CAP = String(calls);
process.env.CITATION_MONTHLY_QUERY_CAP = String(calls * 3);
const providerReady = !!(process.env.ANTHROPIC_API_KEY);
if ((wantTest || wantKnow) && providerReady) { process.env.CITATION_TEST_PROVIDER = process.env.CITATION_TEST_PROVIDER || 'anthropic'; if (wantTest) process.env.CITATION_TEST_ENABLED = '1'; if (wantKnow) process.env.CITATION_KNOWLEDGE_ENABLED = '1'; }
if ((wantTest || wantKnow) && !providerReady) out('SKIPPED: --test / --knowledge need ANTHROPIC_API_KEY (environment or .env.local) with CITATION_TEST_PROVIDER=anthropic. No live call was made. Only the questions part runs.');

const S = require('../lib/pro-store.js');
const Crawler = require('../lib/pro-crawler.js');
const Cit = require('../lib/pro-citation.js');
const LlmG = require('../lib/llm-gemini.js');
const Anth = require('../lib/citation-anthropic.js');
const Config = require('../lib/citation-config.js');

const G_IN = 0.30 / 1e6, G_OUT = 2.50 / 1e6, A_IN = 0.10 / 1e6, A_OUT = 0.50 / 1e6, A_SEARCH = 10 / 1000;

async function runSite(domain) {
  out('\n=== ' + domain + ' ===');
  const store = S.createStore(S.memoryAdapter());
  const gem = { calls: 0, input: 0, output: 0 }, ant = { calls: 0, input: 0, output: 0, searches: 0 };
  const flags = Config.flags(process.env);
  const llm = LlmG.makeJsonLlm({ apiKey: process.env.GEMINI_API_KEY, model: LlmG.modelName(process.env), onCall: (c) => { gem.calls++; gem.input += c.inputTokens || 0; gem.output += c.outputTokens || 0; } });
  let provider = null;
  if (flags.provider) {
    const real = Anth.anthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY, model: flags.model });
    provider = { name: real.name, model: real.model, ask: async (q, o) => { const r = await real.ask(q, o); ant.calls++; ant.input += r.usage.input; ant.output += r.usage.output; ant.searches += r.searches; return r; } };
  }
  const jobId = await store.createJob({ domain: domain, citation: true });
  await store.reserveDomainSlot(domain, 2);
  const deps = { env: process.env, citation: Object.assign({ llm: llm }, provider ? { provider: provider } : {}) };
  const started = Date.now();
  for (let i = 0; i < 200; i++) {
    const last = await Crawler.runStep(store, jobId, deps);
    if (['done', 'partial', 'failed'].indexOf(last.status) !== -1) break;
    if (last.busy) await new Promise((r) => setTimeout(r, 1000));
  }
  const job = await store.getJob(jobId);
  out('crawl: ' + job.status + ', ' + job.progress.done + ' pages read, ' + job.progress.blocked + ' blocked, ' + job.progress.failed + ' not read' + (job.reason ? ' (' + job.reason + ')' : '') + ', ' + Math.round((Date.now() - started) / 1000) + ' s');
  const c = job.citation;
  if (!c) { out('no citation record'); return { domain: domain, gem: gem, ant: ant, status: 'none' }; }
  out('citation: ' + c.status + (c.reason ? ' | ' + c.reason : '') + (c.kstatus ? ' | knowledge: ' + c.kstatus + (c.kreason ? ' ' + c.kreason : '') : ''));
  if (c.profile) out('profile: ' + JSON.stringify(c.profile));
  if (c.questions) {
    out('questions (' + c.questions.items.length + ', source ' + c.questions.source + ', ' + c.questions.items.filter((q) => q.brand).length + ' name the brand):');
    c.questions.items.forEach((q, i) => {
      const r = c.results[i], k = c.knowledge[i];
      const parts = [];
      if (r) parts.push(r.state === 'tested' ? 'search: cited ' + (r.cited ? 'yes' : 'no') + ', mentioned ' + (r.mentioned ? 'yes' : 'no') + (r.others.length ? ', others: ' + r.others.join(' ') : '') : 'search: not tested (' + r.reason + ')');
      if (k) parts.push(k.state === 'tested' ? 'knowledge: named ' + (k.named ? 'yes' : 'no') : 'knowledge: not tested (' + k.reason + ')');
      out('  ' + String(i + 1).padStart(2) + '. ' + q.text + (q.gloss ? '  [' + q.gloss + ']' : '') + (q.brand ? '  (names the brand)' : '') + (parts.length ? '\n      ' + parts.join(' | ') : ''));
    });
  }
  return { domain: domain, gem: gem, ant: ant, status: c.status, language: c.profile && c.profile.language, questions: c.questions ? c.questions.items.length : 0, brandQs: c.questions ? c.questions.items.filter((q) => q.brand).length : 0 };
}

(async function main() {
  const rows = [];
  for (const d of sites) rows.push(await runSite(d));
  out('\n=== totals ===');
  let gi = 0, go = 0, ai = 0, ao = 0, as = 0, ac = 0;
  rows.forEach((r) => { gi += r.gem.input; go += r.gem.output; ai += r.ant.input; ao += r.ant.output; as += r.ant.searches; ac += r.ant.calls; out(r.domain + ': language ' + (r.language || '-') + ', status ' + r.status + ', ' + r.questions + ' questions (' + r.brandQs + ' name the brand), ' + r.gem.calls + ' Gemini calls (' + r.gem.input + ' in, ' + r.gem.output + ' out tokens), ' + r.ant.calls + ' provider calls, ' + r.ant.searches + ' web searches'); });
  out('estimated cost: Gemini tokens $' + (gi * G_IN + go * G_OUT).toFixed(4) + (ac ? ', provider tokens $' + (ai * A_IN + ao * A_OUT).toFixed(4) + ', web searches $' + (as * A_SEARCH).toFixed(4) : '') + ' (list prices; a Gemini key without billing costs $0).');
}()).catch((e) => { process.stderr.write('The live run stopped: ' + (e && e.name) + ' ' + String(e && e.message || '').replace(/https?:\/\/\S+/g, '<url>') + '\n'); process.exit(1); });
