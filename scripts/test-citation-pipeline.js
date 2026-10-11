#!/usr/bin/env node
/* =====================================================================
   scripts/test-citation-pipeline.js

   The Pro citation phases inside the crawl's own steps, and what the report shows, with mock providers (no network): questions only, the deterministic
   sample, Claude alone, Claude and Perplexity together (never more than three calls at once), the model knowledge check, resuming after a closed tab, a
   step retried or a step that died after paying, every failure (429, timeouts, refusal, empty, no search, a provider that is down), the budget (per
   report, daily, kill switch in env and in Redis), what a provider is sent, the report sections and their honest wording, and then the whole thing through
   the real Pro flow: pilot link, start, steps, report page, email button, including a report whose citation steps all fail.

     node scripts/test-citation-pipeline.js
   ===================================================================== */

'use strict';

process.env.PRO_HASH_SECRET = 'test-only-secret-0123456789abcdef';
const S = require('../lib/pro-store.js');
const Crawler = require('../lib/pro-crawler.js');
const Cit = require('../lib/pro-citation.js');
const Prompts = require('../lib/citation-prompts.js');
const Budget = require('../lib/citation-budget.js');
const Section = require('../lib/pro-citation-section.js');
const pageLib = require('../lib/pro-report-page.js');
const api = require('../lib/pro-api.js');
const Lang = require('../lib/lang-detect.js');
const { SITES, HOSTILE } = require('./fixtures/citation-fixtures.js');
const { ENV_Q, ENV_T, ENV_TP, ENV_K, mockLlm, mockAdapter, failResult, siteFetch, runJob } = require('./fixtures/citation-harness.js');

let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const logged = [];
['log', 'warn', 'error', 'info'].forEach((k) => { console[k] = function () { logged.push(Array.prototype.slice.call(arguments).join(' ')); }; });

const results = (c, p) => Object.values((c.results && c.results[p]) || {});
const testedN = (c, p) => results(c, p).filter((x) => x.state === 'tested').length;
const reasons = (c, p) => results(c, p).filter((x) => x.state === 'not_tested').map((x) => x.reason);
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ');
const withEnv = (base, extra) => Object.assign({}, base, extra || {});

(async function main() {
  /* ---- questions only: the default ---- */
  for (const k of ['tr', 'en', 'de']) {
    const site = SITES[k];
    const prov = { anthropic: mockAdapter('anthropic') };
    const r = await runJob(site, { env: ENV_Q, providers: prov });
    const c = r.job.citation;
    t('questions-only (' + k + '): the job ends done with status "questions", 21 questions (18 + 3) in ' + Lang.nameOf(k) + ', two writer calls, and not one provider call', r.job.status === 'done' && c.status === 'questions' && c.questions.items.length === 21 && c.questions.items.filter((q) => q.brand).length === 3 && Lang.base(c.profile.language) === k && prov.anthropic.calls.length === 0 && prov.anthropic.plain.length === 0 && r.llm.calls.length === 2 && c.calls === 2 && !c.modes.test && !c.sample, JSON.stringify([c.status, c.calls]));
    t('questions-only (' + k + '): every open question has one of the five topics', c.questions.items.filter((q) => !q.brand).every((q) => Prompts.KINDS.indexOf(q.kind) !== -1));
    const html = pageLib.render(r.job, {});
    const sec = Section.section(c).html;
    t('questions-only (' + k + '): the report says "Predicted questions, generated from your site", that they are not observed buyer prompts, "Not tested. Try these in your own assistants.", shows the profile and "Copy all questions"', />Citation questions<\/h2>/.test(html) && /Predicted questions, generated from your site/.test(html) && /not observed buyer prompts/.test(html) && /Not tested\. Try these in your own assistants\./.test(html) && /What the questions were based on/.test(html) && /data-cit-copy/.test(html));
    const groups = sec.match(/<details class="pr-qgroup"[\s\S]*?<\/details>/g) || [];
    t('questions-only (' + k + '): the questions are in groups (a details element each) with a count, a topic tag and a language tag on every row' + (k === 'en' ? '' : ', and the English gloss'), groups.length >= 5 && groups.every((g) => /pr-qgroup__count">\d+</.test(g)) && (sec.match(/data-cit-q>/g) || []).length === 21 && (sec.match(new RegExp('<span class="pr-tag" title="Language of the question">' + k.toUpperCase() + '</span>', 'g')) || []).length === 21 && (k === 'en' || (sec.match(/pr-citegloss/g) || []).length === 21), groups.length + '');
    t('questions-only (' + k + '): no provider section, no cited or brand-in-answer column, no count, no percentage, nothing about a check having run', !/pr-provider|Your site cited|Brand name in the answer|questions: your site|cited in|\d\s?%|What Claude|What Perplexity/.test(sec + Section.card(c)) && /have not been tested/.test(html) && !/separate, dated sample/.test(html));
    t('questions-only (' + k + '): the card says "Not tested" and counts predicted questions; the section sits before the estimate, which is last', /Not tested<\/span> Citation questions/.test(html) && /data-fig="pr-cit-questions">21</.test(html) && html.indexOf('id="pr-citation"') < html.indexOf('id="pr-estimate"') && html.indexOf('<section', html.indexOf('id="pr-estimate"') + 1) === -1);
  }
  {
    const r = await runJob(SITES.en, { env: ENV_Q });
    const bad = JSON.parse(JSON.stringify(r.job)); bad.citation.questions.items[0].text = '</textarea><script>alert(1)</script>?'; bad.citation.profile.offering = '<img src=x onerror=alert(1)>';
    const h = pageLib.render(bad, {});
    t('questions-only: hostile text in a question or the profile is escaped, in the list and in the plain-text box', h.indexOf('<script>alert(1)') === -1 && h.indexOf('<img src=x') === -1 && /&lt;img src=x/.test(h));
    const sec = Section.section(r.job.citation).html;
    t('questions-only: the plain-text box holds the 21 questions one per line, and a wrong reading can be reported to the one contact address', /<textarea[^>]*>([\s\S]*?)<\/textarea>/.exec(sec)[1].split('\n').length === 21 && new RegExp('mailto:' + require('../lib/site-config.js').contactEmail.replace('.', '\\.')).test(sec));
    const view = Cit.viewOf(r.job);
    t('questions-only: the job view tells the progress screen there is no check and no knowledge stage', view.test === false && view.knowledge === false);
    t('a job started with the citation part off goes straight from the pages to done, with no call at all', await (async () => { const o = await runJob(SITES.en, { citation: false, env: ENV_TP }); return o.job.status === 'done' && o.llm.calls.length === 0 && o.providers.anthropic.calls.length === 0 && o.job.citation === null; })());
  }

  /* ---- the question writer ---- */
  {
    const d = Cit.defaultsFrom(ENV_Q);
    t('writer: Claude writes the questions by default (structured output, no search), and the Gemini writer is used only with CITATION_QUESTIONS_PROVIDER=gemini and its key', d.llm.id === 'anthropic' && typeof d.llm.generate === 'function' && Cit.defaultsFrom({ CITATION_QUESTIONS_ENABLED: '1', CITATION_QUESTIONS_PROVIDER: 'gemini', GEMINI_API_KEY: 'g' }).llm.model.indexOf('gemini') === 0 && Cit.defaultsFrom(withEnv(ENV_Q, { GEMINI_API_KEY: 'g' })).llm.id === 'anthropic');
    const w = await runJob(SITES.en, { env: ENV_Q, llm: mockLlm(SITES.en, { cost: 0.0023 }) });
    t('writer: its real cost is recorded on the report and in the day\'s counters, per call', w.job.citation.spend === 4600 && Object.values(await w.adapter.hgetall(Budget.SPEND)).every((v) => v === '4600'), String(w.job.citation.spend));
    const kz = await runJob(SITES.en, { env: withEnv(ENV_Q, { CITATION_KILL: '1' }) });
    t('kill: with CITATION_KILL=1 the citation part makes no call, whatever the job was started with: "not tested", the reason says it was switched off, the report is still made', kz.job.status === 'done' && kz.job.citation.status === 'not_tested' && /switched off/.test(kz.job.citation.reason) && kz.llm.calls.length === 0);
    t('kill: Cit.enabled is false with CITATION_KILL=1, so a new report does not even start the part', !Cit.enabled(withEnv(ENV_Q, { CITATION_KILL: '1' })) && Cit.enabled(ENV_Q));
    const adapter = S.memoryAdapter(); const store = S.createStore(adapter);
    const id = await store.createJob({ domain: SITES.en.domain, citation: true }); await store.reserveDomainSlot(SITES.en.domain, 2);
    await Budget.setKill(store, true);
    const k2 = await runJob(SITES.en, { env: ENV_Q, store, adapter, jobId: id });
    t('kill: the Redis flag, set after the report was started, ends the citation part before any call: "not tested", the reason says it was switched off, the report is still made', k2.job.status === 'done' && k2.job.citation.status === 'not_tested' && /switched off/.test(k2.job.citation.reason) && k2.llm.calls.length === 0);
    const nb = await runJob(SITES.en, { env: withEnv(ENV_Q, { CITATION_DAILY_BUDGET_USD: '0' }) });
    t('budget: a daily budget of 0 stops the question writer before it is called; the report says why and is still made', nb.job.status === 'done' && nb.job.citation.status === 'not_tested' && /daily budget/.test(nb.job.citation.reason) && nb.llm.calls.length === 0 && !nb.job.citation.questions);
    const wf = await runJob(SITES.de, { env: ENV_Q, llm: mockLlm(SITES.de, { failWith: 'quota' }) });
    t('writer failure at the profile: no questions, "not tested" with the reason, the report is still made', wf.job.status === 'done' && wf.job.citation.status === 'not_tested' && /language model was not available/.test(wf.job.citation.reason) && !wf.job.citation.questions);
    const q2 = await runJob(SITES.de, { env: ENV_Q, llm: mockLlm(SITES.de, { failWith: 'timeout', failFrom: 1 }) });
    t('writer failure while writing the questions: not tested, the job is done', q2.job.status === 'done' && q2.job.citation.status === 'not_tested');
    const half = await runJob(SITES.en, { env: ENV_Q, llm: mockLlm(SITES.en, { perCall: (n, full) => (n === 2 ? { questions: full.questions.slice(0, 11), brandQuestions: full.brandQuestions } : (n === 3 ? { questions: full.questions.slice(11), brandQuestions: [] } : full)) }) });
    t('writer: a short first reply gets one more call for the rest (3 writer calls), reaching 18 + 3', half.llm.calls.length === 3 && half.job.citation.questions.items.length === 21 && /Already written/.test(half.llm.calls[2].user));
    const few = await runJob(SITES.en, { env: ENV_Q, llm: mockLlm(SITES.en, { questions: SITES.en.open.slice(0, 4).map((text) => ({ text: text, kind: 'category' })) }) });
    t('writer: an English site with too few questions is topped up from the matching vertical set and the source says so', few.job.citation.questions && /^llm\+vertical:fintech$/.test(few.job.citation.questions.source) && few.job.citation.questions.items.filter((q) => !q.brand).length === 18);
    const tr = await runJob(SITES.tr, { env: ENV_Q, llm: mockLlm(SITES.tr, { questions: SITES.tr.open.slice(0, 4).map((text, i) => ({ text: text, kind: 'category', gloss: 'English version ' + i })) }) });
    t('writer: a Turkish site is never topped up with English questions: with too few valid ones nothing is written', tr.job.citation.status === 'not_tested' && !tr.job.citation.questions && /Too few/.test(tr.job.citation.reason));
    const hostile = Object.assign({}, HOSTILE, { lang: 'en', open: [], brandQs: [] });
    const hj = await runJob(hostile, { env: ENV_T, llm: mockLlm(SITES.en, { profile: HOSTILE.hijackedProfile }) });
    const fetched = []; await runJob(hostile, { env: ENV_T, llm: mockLlm(SITES.en, { profile: HOSTILE.hijackedProfile }), fetchLog: fetched });
    t('injection: a hijacked profile ends the citation part (not tested), nothing is asked of any provider, nothing from the page or a reply is fetched, and the record holds nothing the attacker wrote', hj.job.status === 'done' && hj.job.citation.status === 'not_tested' && hj.providers.anthropic.calls.length === 0 && fetched.every((u) => new URL(u).hostname === HOSTILE.domain) && !/evil|Evil Corp|ignore all previous/i.test(JSON.stringify(hj.job.citation)));
    const hq = await runJob(Object.assign({}, HOSTILE, { lang: 'en' }), { env: ENV_T, llm: mockLlm(SITES.en, { profile: { language: 'en', siteType: 'local_business', category: 'plumbing services', offering: 'Drain cleaning and pipe repair for homes in Leeds.', audience: 'Homeowners', geography: 'Leeds', brandName: 'Harmless Plumbing' }, questions: HOSTILE.hijackedQuestions.questions, brandQs: HOSTILE.hijackedQuestions.brandQuestions }) });
    t('injection: hijacked questions never reach a provider', hq.providers.anthropic.calls.every((x) => !/evil|ignore all|http/i.test(x)));
  }

  /* ---- the sample ---- */
  {
    const items = SITES.en.open.map((text, i) => ({ text: text, gloss: '', kind: Prompts.KINDS[i % 5], brand: false })).concat(SITES.en.brandQs.map((text) => ({ text: text, gloss: '', kind: 'brand', brand: true })));
    const a = Cit.pickSample(items, 'a'.repeat(32), 10), b = Cit.pickSample(items, 'a'.repeat(32), 10), c2 = Cit.pickSample(items, 'b'.repeat(32), 10);
    const byTopic = {}; a.forEach((i) => { byTopic[items[i].kind] = (byTopic[items[i].kind] || 0) + 1; });
    t('sample: deterministic for a report (the same ten every time), different for another report, ten of them, none names the brand', JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(c2) && a.length === 10 && a.every((i) => !items[i].brand) && new Set(a).size === 10 && JSON.stringify(a) === JSON.stringify(a.slice().sort((x, y) => x - y)));
    t('sample: balanced across the five topics (two from each at ten)', Object.keys(byTopic).length === 5 && Object.values(byTopic).every((n) => n === 2), JSON.stringify(byTopic));
    t('sample: a smaller number takes fewer, and it never asks for more questions than exist', Cit.pickSample(items, 'a'.repeat(32), 4).length === 4 && Cit.pickSample(items.slice(0, 3), 'a'.repeat(32), 10).length === 3);
    const r = await runJob(SITES.en, { env: withEnv(ENV_T, { CITATION_QUESTION_SAMPLE: '4' }) });
    t('sample: CITATION_QUESTION_SAMPLE sets the size (4 questions, 4 calls)', r.providers.anthropic.calls.length === 4 && r.job.citation.sample.length === 4);
  }

  /* ---- Claude alone ---- */
  {
    const site = SITES.tr;
    const prov = { anthropic: mockAdapter('anthropic', null, { delay: 15 }) };
    const r = await runJob(site, { env: ENV_T, providers: prov });
    const c = r.job.citation;
    t('claude: the job ends done and "ok": ten questions, ten calls, every one tested, one run each', r.job.status === 'done' && c.status === 'ok' && prov.anthropic.calls.length === 10 && testedN(c, 'anthropic') === 10 && new Set(prov.anthropic.calls).size === 10 && c.pstat.anthropic.status === 'ok', JSON.stringify(c.pstat));
    t('claude: only the sample is asked, in the language of the site, and the arguments are exactly the question, a locale tag and the search flag: no domain, no name, no id', prov.anthropic.calls.every((q) => c.questions.items.some((x) => x.text === q && !x.brand)) && prov.anthropic.args.every((a) => Object.keys(a).sort().join() === 'locale,prompt,search' && a.locale === 'tr' && a.search === true));
    t('claude: no step runs more than two calls at once, and the steps go scan, profile, questions, cite (5 steps of two), done', prov.anthropic.maxActive <= 2 && r.views.map((v) => v.phase).filter((p) => p === 'cite').length >= 5 && r.views[r.views.length - 1].status === 'done', String(prov.anthropic.maxActive));
    t('claude: the real cost of each call is stored with its result, and the report\'s spend is their sum plus the writer\'s', results(c, 'anthropic').every((x) => x.micro === 12000) && c.spend === 120000 && c.calls === 12, JSON.stringify([c.spend, c.calls]));
    t('claude: the daily counters hold the real total, the per-provider counters the call count and the cost', Object.values(await r.adapter.hgetall(Budget.SPEND)).every((v) => v === '120000') && (await r.adapter.hgetall(Budget.STAT))['d:' + new Date().toISOString().slice(0, 10) + ':anthropic:calls'] === '10');
    t('claude: each result keeps the cited yes/no, the brand-in-text yes/no, the other domains with a link, the model and the date, and no answer text', results(c, 'anthropic').every((x) => x.cited === false && x.mentioned === false && x.others.join() === 'example-one.com,example-two.com' && x.links['example-one.com'] === 'https://example-one.com/b' && x.model === 'mock-claude' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && !('answer' in x)) && !/Several tools are popular/.test(JSON.stringify(c)));
    const again = await Crawler.runStep(r.store, r.id, r.deps);
    t('claude: stepping a finished job changes nothing and asks nothing', again.status === 'done' && prov.anthropic.calls.length === 10);
    const html = pageLib.render(r.job, {});
    t('claude: the report has one section titled "What Claude\'s web search cited", with the model and the date, "Your site cited" and "Brand name in the answer text" columns, other domains as links, "Run on", and the counts as "N of 10" only', /<h2[^>]*>What Claude’s web search cited<\/h2>/.test(html) && /model mock-claude/.test(html) && />Your site cited</.test(html) && />Brand name in the answer text</.test(html) && />Other domains</.test(html) && />Run on</.test(html) && /<a href="https:\/\/example-one\.com\/b" rel="noopener noreferrer nofollow" target="_blank">example-one\.com<\/a>/.test(html) && /<strong>0 of 10<\/strong>/.test(html) && !/\d\s?%/.test(Section.section(c).html) && (html.match(/class="pr-citerow"/g) || []).length === 10 && !/What Perplexity/.test(html));
    t('claude: the scope statement says one provider, one run per question, results vary, not ChatGPT, Gemini or any other assistant, not a ranking or share of voice; the brand column is a plain text match; the questions are predictions', /One provider \(Claude \(Anthropic\), model mock-claude\), one run per question/.test(html) && /Results vary between runs/.test(html) && /not a measure of ChatGPT, Gemini or any other assistant/.test(html) && /not a ranking or a share of voice/.test(html) && /plain text match/.test(html) && /predictions written from your site, not observed buyer prompts/.test(html));
    t('claude: the frame line names the dated sample from one provider; the card counts "for 0 of 10 questions" and is not merged with anything; no ranking words outside the questions', /separate, dated sample from one provider’s search/.test(html) && /Claude:<\/strong> cited for <span[^>]*>0<\/span> of <span[^>]*>10<\/span> questions/.test(html) && !/\b(better than|worse than|best|worst|leader|leading|outrank|winner|top|share of voice score|composite)\b/i.test(text(Section.section(c).html).replace(/share of voice/g, '').replace(new RegExp(c.questions.items.map((q) => q.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g'), ' ').replace(/Turkish|Küçük|en iyi/g, '')));
  }

  /* ---- Claude and Perplexity ---- */
  {
    const site = SITES.de;
    const shared = { n: 0, max: 0 };
    const wrap = (id, delay) => { const a = mockAdapter(id, async (q, n) => { shared.n++; shared.max = Math.max(shared.max, shared.n); await new Promise((r) => setTimeout(r, delay)); shared.n--; return { answerText: 'Answer mentioning Buchwerk and others.', citations: [{ url: 'https://' + (id === 'anthropic' ? 'a' : 'p') + '-source.example/x', domain: 'x', title: 't' }], usage: {}, costUsd: id === 'anthropic' ? 0.012 : 0.0045, providerLabel: a.label, modelId: a.model, citationKind: id === 'perplexity' ? 'returned' : 'cited', searches: 1 }; }); return a; };
    const prov = { anthropic: wrap('anthropic', 25), perplexity: wrap('perplexity', 25) };
    const adapter = S.memoryAdapter(); const store = S.createStore(adapter);
    const run = await runJob(site, { env: ENV_TP, providers: prov, store, adapter });
    const c = run.job.citation;
    t('two providers: both ran ten questions, every one tested, the job is "ok" with one result set per provider', run.job.status === 'done' && c.status === 'ok' && prov.anthropic.calls.length === 10 && prov.perplexity.calls.length === 10 && testedN(c, 'anthropic') === 10 && testedN(c, 'perplexity') === 10 && c.modes.providers.join() === 'anthropic,perplexity');
    t('two providers: never more than three calls at once (two Claude calls beside Perplexity\'s one-at-a-time lane)', shared.max <= 3 && shared.max >= 2, String(shared.max));
    t('two providers: the cost is Claude\'s $0.12 plus Perplexity\'s $0.045 for the sample, recorded per result and in the report\'s spend', c.spend === 120000 + 45000 && results(c, 'perplexity').every((x) => x.micro === 4500 && x.kind === 'returned') && results(c, 'anthropic').every((x) => x.kind === 'cited'), String(c.spend));
    const html = pageLib.render(run.job, {});
    const iA = html.indexOf('What Claude’s web search cited'), iP = html.indexOf('What Perplexity’s search returned'), iQ = html.indexOf('id="pr-cite-questions-h"');
    t('two providers: two separate sections in order (Claude, Perplexity), both before the questions, each titled with its provider; never merged: no combined count or score', iA > 0 && iP > iA && iQ > iP && /<strong>0 of 10<\/strong>/.test(html) && !/20 questions|of 20/.test(text(html)) && (html.match(/<section class="pr-section pr-provider"/g) || []).length === 2);
    t('two providers: Perplexity\'s columns say "returned", not "cited", and its scope says it does not mean the answer cited it', />Your site among the sources returned</.test(html) && /does not mean the answer cited it/.test(html) && /Perplexity:<\/strong> among the sources returned/.test(html));
    t('two providers: the card gives each provider\'s own count on its own line', /Claude:<\/strong>/.test(Section.card(c)) && /Perplexity:<\/strong>/.test(Section.card(c)));
    const sendOnly = prov.perplexity.args.every((a) => Object.keys(a).sort().join() === 'locale,prompt,search' && a.locale === 'de');
    t('two providers: Perplexity is sent the same minimum: the question, the locale tag and nothing else', sendOnly);
    // resume
    const prov2 = { anthropic: mockAdapter('anthropic'), perplexity: mockAdapter('perplexity') };
    const ad2 = S.memoryAdapter();
    const a = await runJob(site, { env: ENV_TP, providers: prov2, adapter: ad2, stopAfter: 6 });
    const mid = await a.store.getJob(a.id);
    t('resume: a closed tab part-way leaves the job unfinished with some answers stored', mid.status === 'running' && mid.citation.status === 'running' && Object.keys(mid.citation.results.anthropic || {}).length > 0 && Object.keys(mid.citation.results.anthropic || {}).length < 10, JSON.stringify([mid.status, Object.keys(mid.citation.results.anthropic || {}).length]));
    const prov3 = { anthropic: mockAdapter('anthropic'), perplexity: mockAdapter('perplexity') };
    const b = await runJob(site, { env: ENV_TP, providers: prov3, adapter: ad2, store: S.createStore(ad2), jobId: a.id, llm: mockLlm(site), clock: { t: Date.now() + 2e6 } });
    const allA = prov2.anthropic.calls.concat(prov3.anthropic.calls), allP = prov2.perplexity.calls.concat(prov3.perplexity.calls);
    t('resume: reopening the link finishes it: every question asked once per provider across both sessions, never twice, and the writer is not called again', b.job.status === 'done' && b.job.citation.status === 'ok' && allA.length === 10 && new Set(allA).size === 10 && allP.length === 10 && new Set(allP).size === 10 && a.llm.calls.length === 2 && b.llm.calls.length === 0);
  }

  /* ---- a step retried, a step that died after paying ---- */
  {
    const site = SITES.en;
    const adapter = S.memoryAdapter();
    const prov = { anthropic: mockAdapter('anthropic', null, { delay: 20 }) };
    const a = await runJob(site, { env: ENV_T, providers: prov, adapter, stopAfter: 4 });
    // two browsers step the same job at once: the per-job lock lets one through
    const store2 = S.createStore(adapter);
    const [x, y] = await Promise.all([Crawler.runStep(a.store, a.id, a.deps), Crawler.runStep(store2, a.id, a.deps)]);
    t('duplicate step: two steps at the same moment on one job: one does the work, the other is told it is busy, and nothing is asked twice', (x.busy ? 1 : 0) + (y.busy ? 1 : 0) === 1 && new Set(prov.anthropic.calls).size === prov.anthropic.calls.length, JSON.stringify([!!x.busy, !!y.busy]));
    const done = await runJob(site, { env: ENV_T, providers: prov, adapter, store: S.createStore(adapter), jobId: a.id, clock: { t: Date.now() + 3e6 } });
    t('duplicate step: after retries the report has exactly ten calls and ten results', prov.anthropic.calls.length === 10 && Object.keys(done.job.citation.results.anthropic).length === 10);
    // a step that died after the attempt was marked and the call paid, before the result was stored
    const ad3 = S.memoryAdapter(); const st3 = S.createStore(ad3);
    const p3 = { anthropic: mockAdapter('anthropic') };
    const s3 = await runJob(site, { env: ENV_T, providers: p3, adapter: ad3, store: st3, stopAfter: 5 });
    const cit = await st3.getCitation(s3.id);
    const victim = cit.sample.find((i) => !(cit.pending.anthropic || {})[i]);
    const marked = await st3.markAttempt(s3.id, 'anthropic', victim);
    const before = p3.anthropic.calls.length;
    const fin = await runJob(site, { env: ENV_T, providers: p3, adapter: ad3, store: st3, jobId: s3.id, clock: { t: Date.now() + 4e6 } });
    const rv = fin.job.citation.results.anthropic[victim];
    t('crash: an attempt marked but never stored is not paid twice: it is recorded "interrupted", the question is not asked again, and the other nine are each asked once', marked === true && victim !== undefined && rv.state === 'not_tested' && rv.reason === 'interrupted' && !p3.anthropic.calls.includes(fin.job.citation.questions.items[victim].text) && fin.job.citation.status === 'partial' && p3.anthropic.calls.length === 9 && new Set(p3.anthropic.calls).size === 9, JSON.stringify([marked, victim, rv && rv.reason, p3.anthropic.calls.length]));
    t('crash: a second attempt marker for the same question is refused (set once)', (await st3.markAttempt(s3.id, 'anthropic', victim)) === false);
    const ex = await runJob(site, { env: ENV_T, providers: { anthropic: mockAdapter('anthropic', async () => { throw new Error('boom'); }) } });
    t('a provider that throws instead of answering is a recorded failure (three in a row stop it), never fails the report, and is not asked again', ex.job.status === 'done' && ex.providers.anthropic.calls.length >= 3 && ex.providers.anthropic.calls.length <= 4 && reasons(ex.job.citation, 'anthropic').length === 10 && ex.job.citation.status === 'not_tested');
  }

  /* ---- failures ---- */
  {
    const site = SITES.en;
    const mkA = (fn) => mockAdapter('anthropic', async (p, n) => { const r = fn(p, n); if (r) return r; return { answerText: 'x', citations: [], usage: {}, costUsd: 0.012, providerLabel: 'Claude', modelId: 'mock-claude', searches: 1 }; });
    const pa = mkA((p, n) => (n >= 3 ? failResult('quota', 0) : null)), pp = mockAdapter('perplexity');
    const r1 = await runJob(site, { env: ENV_TP, providers: { anthropic: pa, perplexity: pp } });
    const c1 = r1.job.citation;
    t('429: a rate limit on Claude stops Claude for this report (no more calls once it says so), Perplexity carries on, the others say "not tested" with the reason, the job is done and "partial"', r1.job.status === 'done' && c1.status === 'partial' && testedN(c1, 'anthropic') === 2 && reasons(c1, 'anthropic').filter((x) => x === 'quota').length === 8 && testedN(c1, 'perplexity') === 10 && c1.pstat.anthropic.status === 'partial' && /rate limit/.test(c1.pstat.anthropic.reason) && pa.calls.length <= 4, JSON.stringify([pa.calls.length, testedN(c1, 'anthropic')]));
    const h1 = pageLib.render(r1.job, {});
    t('429: the report shows Claude\'s section as "Partial" with how many were tested and why, and Perplexity\'s in full', /<strong>Partial\.<\/strong> 2 of 10 questions were tested/.test(h1) && /rate limit was reached/.test(h1) && /What Perplexity’s search returned/.test(h1));
    for (const kind of ['timeout', 'refusal', 'empty', 'no_search', 'incomplete', 'provider']) {
      const p = mkA(() => failResult(kind, 0));
      const r = await runJob(site, { env: ENV_T, providers: { anthropic: p } });
      t('failure "' + kind + '": three in a row stop that provider (3 or 4 calls: two run at a time), the other questions are "not tested", the report is made and says "Citation check unavailable for Claude; the questions below are still yours to use."', r.job.status === 'done' && p.calls.length >= 3 && p.calls.length <= 4 && r.job.citation.status === 'not_tested' && reasons(r.job.citation, 'anthropic').length === 10 && /Citation check unavailable for Claude; the questions below are still yours to use\./.test(pageLib.render(r.job, {})) && r.job.citation.questions.items.length === 21, String(p.calls.length));
    }
    const one = mkA((p, n) => (n === 2 ? failResult('timeout', 0.001) : null));
    const r2 = await runJob(site, { env: ENV_T, providers: { anthropic: one } });
    t('one slow question is "not tested" and the next is still asked; the failed call\'s cost is still counted', one.calls.length === 10 && reasons(r2.job.citation, 'anthropic').join() === 'timeout' && r2.job.citation.status === 'partial' && r2.job.citation.spend === 9 * 12000 + 1000, String(r2.job.citation.spend));
    const down = await runJob(site, { env: ENV_TP, providers: { anthropic: mkA(() => failResult('provider', 0)), perplexity: mockAdapter('perplexity') } });
    const hd = pageLib.render(down.job, {});
    t('one provider down and the other fine: the report has a "unavailable" section for the first and a full one for the second, status "partial"', down.job.citation.status === 'partial' && /Citation check unavailable for Claude/.test(hd) && /What Perplexity’s search returned/.test(hd) && />Citation questions<\/h2>/.test(hd));
    const empty = await runJob(site, { env: ENV_T, providers: { anthropic: mockAdapter('anthropic', async () => ({ answerText: 'No sources found.', citations: [], usage: {}, costUsd: 0.012, modelId: 'mock-claude', searches: 1 })) } });
    t('an answer with no citations is a valid result: "No" and "None shown", counted as tested', empty.job.citation.status === 'ok' && /None shown/.test(pageLib.render(empty.job, {})));
  }

  /* ---- the budget, end to end ---- */
  {
    const site = SITES.en;
    const bd = await runJob(site, { env: withEnv(ENV_T, { CITATION_DAILY_BUDGET_USD: '0.1' }), providers: { anthropic: mockAdapter('anthropic') } });
    const c = bd.job.citation;
    t('daily budget: with $0.10 the reservations (30 cents each at worst) allow a few calls, then stop all of them: partial, the reason names the budget, the report is made', bd.job.status === 'done' && c.status === 'partial' && testedN(c, 'anthropic') >= 1 && testedN(c, 'anthropic') < 10 && reasons(c, 'anthropic').every((x) => x === 'daily_budget') && /daily budget/.test(c.reason), JSON.stringify([testedN(c, 'anthropic'), c.reason]));
    t('daily budget: the day\'s counter never passes the budget', parseInt(Object.entries(await bd.adapter.hgetall(Budget.SPEND)).filter(([k]) => /^d:/.test(k))[0][1], 10) <= 100000);
    const m2 = await runJob(site, { env: withEnv(ENV_T, { CITATION_MONTHLY_BUDGET_USD: '0' }) });
    t('monthly budget of 0: no paid call at all, "not tested", with the reason', m2.job.citation.status === 'not_tested' && /monthly budget/.test(m2.job.citation.reason) && m2.llm.calls.length === 0 && m2.providers.anthropic.calls.length === 0);
    const capCalls = await runJob(site, { env: withEnv(ENV_T, { CITATION_MAX_CALLS: '5' }) });
    t('per-report calls: CITATION_MAX_CALLS 5 allows the 2 writer calls and 3 questions, then stops: partial, "reached its limit of paid calls"', testedN(capCalls.job.citation, 'anthropic') === 3 && /limit of paid calls/.test(capCalls.job.citation.reason) && capCalls.job.status === 'done', JSON.stringify([testedN(capCalls.job.citation, 'anthropic'), capCalls.job.citation.reason]));
    const capCost = await runJob(site, { env: withEnv(ENV_T, { CITATION_MAX_COST_USD: '0.1' }), providers: { anthropic: mockAdapter('anthropic') } });
    t('per-report cost: a $0.10 cap stops the report\'s calls once the reservation would pass it', /cost limit/.test(capCost.job.citation.reason) && capCost.job.citation.spend <= 100000 + 12000, String(capCost.job.citation.spend));
    // the Redis kill flag flipped while the check runs
    const ad = S.memoryAdapter(); const st = S.createStore(ad);
    const pk = { anthropic: mockAdapter('anthropic') };
    const k1 = await runJob(site, { env: ENV_T, providers: pk, adapter: ad, store: st, stopAfter: 6 });
    const callsBefore = pk.anthropic.calls.length;
    await Budget.setKill(st, true);
    const k2 = await runJob(site, { env: ENV_T, providers: pk, adapter: ad, store: st, jobId: k1.id, clock: { t: Date.now() + 5e6 } });
    t('kill switch in Redis, flipped while the check runs: the very next call is refused, the rest are "not tested" (switched off), the job finishes done, no redeploy involved', callsBefore > 0 && callsBefore < 10 && pk.anthropic.calls.length === callsBefore && k2.job.status === 'done' && /switched off/.test(k2.job.citation.reason) && reasons(k2.job.citation, 'anthropic').every((x) => x === 'kill'), JSON.stringify([callsBefore, pk.anthropic.calls.length, k2.job.citation.reason]));
    const sum = await Budget.summary(st, ENV_T, Date.now());
    t('the spend summary counts the calls made per provider, today and this month', sum.rows.find((r) => r.provider === 'anthropic').dayCalls === callsBefore && sum.killed === true && sum.rows.find((r) => r.provider === 'anthropic').monthCalls === callsBefore);
  }

  /* ---- the model knowledge check ---- */
  {
    const site = SITES.en;
    const prov = { anthropic: mockAdapter('anthropic') };
    const r = await runJob(site, { env: ENV_K, providers: prov });
    const c = r.job.citation;
    t('knowledge-only: ten plain calls with no search, none with search, status "questions", kstatus ok', prov.anthropic.plain.length === 10 && prov.anthropic.calls.length === 0 && c.status === 'questions' && c.kstatus === 'ok' && Object.keys(c.knowledge).length === 10 && prov.anthropic.args.every((a) => a.search === false));
    t('knowledge-only: only "named", the model, the date and the cost are stored; no answer text', Object.values(c.knowledge).every((x) => JSON.stringify(Object.keys(x).sort()) === '["date","micro","model","named","state"]') && !/ExampleOne|several tools/i.test(JSON.stringify(c)));
    const html = pageLib.render(r.job, {});
    t('knowledge-only: the report shows "Model knowledge check (no live search)" with "Named in the answer", never a cited column or a provider section, and says it is not citation tracking', /Model knowledge check \(no live search\)/.test(html) && /Named in the answer/.test(html) && !/>Your site cited</.test(html) && !/pr-provider/.test(html) && /not citation tracking/.test(html) && /Not tested\. Try these in your own assistants\./.test(html));
    const k429 = await runJob(site, { env: ENV_K, providers: { anthropic: mockAdapter('anthropic', async (p, n) => (n === 3 ? failResult('quota', 0) : { answerText: 'x', citations: [], usage: {}, costUsd: 0.0005, modelId: 'mock-claude', searches: 0 })) } });
    t('knowledge-only: a 429 ends that check at once, the job still finishes, the questions stay', k429.job.status === 'done' && k429.job.citation.kstatus === 'partial' && k429.job.citation.questions.items.length === 21);
    const both = await runJob(site, { env: withEnv(ENV_T, { CITATION_KNOWLEDGE_ENABLED: '1' }), providers: { anthropic: mockAdapter('anthropic') } });
    const phases = both.views.map((v) => v.phase);
    t('test and knowledge together: the check first, then the knowledge check, then done; both sections in the report, the knowledge one with no cited column', phases.lastIndexOf('cite') < phases.indexOf('know') && both.job.citation.status === 'ok' && both.job.citation.kstatus === 'ok' && /What Claude’s web search cited/.test(pageLib.render(both.job, {})) && /Model knowledge check/.test(pageLib.render(both.job, {})));
  }

  /* ---- only valid order links start paid calls ---- */
  {
    const fs = require('fs'), path = require('path');
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const users = ['api/scan.js', 'lib/scanner.js', 'api/mcp.js', 'lib/waitlist-api.js', 'lib/waitlist.js', 'api/subscribe.js', 'api/site-info.js', 'api/llms-check.js', 'lib/pro-mail.js', 'lib/pro-orders.js'];
    t('the free scan, the MCP server, the waitlist, the site tools and the mail code do not even load the citation providers or the budget', users.every((f) => !/citation-providers|citation-budget|pro-citation/.test(read(f))));
    const bootstrap = ['scripts/smoke-live.js', 'scripts/e2e-live.js'].every((f) => !/citation-providers/.test(read(f)));
    t('smoke and e2e-live do not load the providers either', bootstrap);
  }

  /* ---- the whole Pro flow with mock providers: pilot link, start, steps, report, email ---- */
  {
    const site = Object.assign({}, SITES.en, { domain: 'ledgerlark.com' });
    let ipc = 0;
    const call = (fn, o, deps) => new Promise((resolve, reject) => {
      const headers = {}; const ip = '10.30.' + Math.floor(ipc / 250) + '.' + (ipc++ % 250);
      const req = { method: o.method || 'GET', url: '/', headers: Object.assign({ 'x-forwarded-for': ip, 'content-type': 'application/json' }, o.headers || {}), query: o.query || {}, body: o.body, socket: {} };
      const res = { statusCode: 200, setHeader: (k, v) => { headers[k.toLowerCase()] = v; }, end: (b) => { let json = null; try { json = JSON.parse(b); } catch (e) { /* html */ } resolve({ status: res.statusCode, headers, body: b, json }); } };
      Promise.resolve(fn(req, res, deps)).catch(reject);
    });
    const sent = [];
    const fakeResend = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200 }; };
    const flow = async (label, providers, env, o) => {
      o = o || {};
      const store = S.createStore(S.memoryAdapter());
      const clock = { t: 1e9 };
      const issued = await store.createOrder({ source: 'pilot', label: label, validDays: 7 });
      const crawl = { fetch: siteFetch(site), sleep: async () => {}, now: () => (clock.t += 1100), env: env, citation: { llm: mockLlm(site), providers: providers, sleep: async () => {} } };
      const deps = { store, env: env, checkHost: async () => ({ ok: true }), fetch: fakeResend, crawl: crawl };
      const started = await call(api.start, { method: 'POST', body: { token: issued.token, site: site.domain, name: 'Grace Hopper', email: 'grace@mail.example.org', consent: true } }, deps);
      let last = null; const stages = [];
      for (let i = 0; i < 90; i++) { last = (await call(api.step, { method: 'POST', query: { id: started.json.jobId }, body: {} }, deps)).json; stages.push(last.phase); if (['done', 'partial', 'failed'].indexOf(last.status) !== -1) break; }
      const page = await call(api.report, { query: { id: started.json.jobId } }, deps);
      const mail = await call(api.email, { method: 'POST', body: { id: started.json.jobId } }, deps);
      return { store, started, last, stages, page, mail, job: await store.getJob(started.json.jobId) };
    };
    const MAIL = { RESEND_API_KEY: 'rk_test', PRO_MAIL_FROM: 'Citehound <reports@mail.example.invalid>' };
    const prov = { anthropic: mockAdapter('anthropic'), perplexity: mockAdapter('perplexity') };
    const f = await flow('Launch check', prov, withEnv(ENV_TP, MAIL));
    t('flow: pilot link -> start -> steps -> report: the job finishes done, the report page is served with both provider sections, the questions and the estimate last, and the progress view said which stages to show', f.started.status === 200 && f.last.status === 'done' && f.last.citation.test === true && f.last.citation.providers.join() === 'anthropic,perplexity' && f.page.status === 200 && /What Claude’s web search cited/.test(f.page.body) && /What Perplexity’s search returned/.test(f.page.body) && f.page.body.indexOf('id="pr-estimate"') > f.page.body.indexOf('id="pr-cite-questions-h"') && f.stages.indexOf('cite') > f.stages.indexOf('questions'), JSON.stringify([f.started.status, f.last && f.last.status, f.page.status]));
    t('flow: the status view during the check has no contact data, no question text and no provider detail beyond the counts', !/@|Grace|Defterim|Ledgerlark|What accounting/.test(JSON.stringify(f.last)));
    t('flow: the email button works on this report: one message to the address on the order, with the report link and no citation results in its text', f.mail.status === 200 && sent.length === 1 && sent[0].to[0] === 'grace@mail.example.org' && !/cited|Claude|Perplexity/i.test(JSON.stringify(sent[0].text || '')), JSON.stringify([f.mail.status, sent.length]));
    const allDown = { anthropic: mockAdapter('anthropic', async () => failResult('provider', 0)), perplexity: mockAdapter('perplexity', async () => failResult('quota', 0)) };
    const f2 = await flow('Launch check 2', allDown, withEnv(ENV_TP, MAIL));
    t('flow: when every provider call fails the report is still delivered (done), shows the "unavailable" message for both, keeps the 21 questions, and the email button still works', f2.last.status === 'done' && f2.page.status === 200 && /Citation check unavailable for Claude/.test(f2.page.body) && /Citation check unavailable for Perplexity/.test(f2.page.body) && (f2.page.body.match(/data-cit-q>/g) || []).length === 21 && f2.mail.status === 200 && sent.length === 2);
    const none = { anthropic: mockAdapter('anthropic') };
    const f3 = await flow('e2e test', none, withEnv(ENV_TP, MAIL));
    t('flow: an order whose label starts with e2e or smoke never starts the citation part, even with every switch on: no writer call, no provider call', f3.last.status === 'done' && f3.job.citation === null && none.anthropic.calls.length === 0 && f3.last.citation === null);
    const f4 = await flow('Smoke check', { anthropic: mockAdapter('anthropic') }, withEnv(ENV_TP, MAIL));
    t('flow: the same for "smoke"', f4.job.citation === null);
    const f5 = await flow('Client A', { anthropic: mockAdapter('anthropic') }, withEnv(ENV_Q, MAIL));
    t('flow: with only the questions switch on, the same flow ends with the questions listed and no provider section', f5.job.citation.status === 'questions' && !/pr-provider/.test(f5.page.body) && /Predicted questions, generated from your site/.test(f5.page.body));
    const f6 = await flow('Client B', { anthropic: mockAdapter('anthropic') }, withEnv({}, MAIL));
    t('flow: with every switch off the report has no citation section, no card and the old frame line, and the job view says null', f6.job.citation === null && !/pr-citation|pr-citecard/.test(f6.page.body) && f6.last.citation === null);
  }

  /* ---- nothing a site wrote reaches a log ---- */
  {
    const joined = logged.join('\n');
    t('logs: no page text, question, profile, key, answer or address was logged', !/Defterim|Ledgerlark|Buchwerk|Evil Corp|ignore all previous|test-anthropic-key|test-perplexity-key|grace@|ExampleOne|Answer mentioning/i.test(joined), joined.slice(0, 200));
  }

  out('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
}()).catch((e) => { process.stderr.write('The test stopped: ' + (e && e.stack) + '\n'); process.exit(1); });
