#!/usr/bin/env node
/* =====================================================================
   scripts/test-summary.js

   Tests lib/summary.js and lib/summary-gemini.js with mocks only. No request
   is made to any model.

     node scripts/test-summary.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const S = require('../lib/summary.js');
const F = require('../lib/report-facts.js');
const schema = require('../lib/schema.js');
const gemini = require('../lib/summary-gemini.js');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; const fails = [];
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); console.log((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const bm = F.benchmarkFromData(path.join(ROOT, 'data'));
const load = (n) => { const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/pro/' + n + '.json'), 'utf8')); d.benchmark = bm; return d; };
const sample = load('sample-report'), demo = load('demo-fixture');
const f = F.facts(sample, { schema: schema });
const clone = (o) => JSON.parse(JSON.stringify(o));
const good = () => { const d = S.deterministic(f); d.headline = 'The site scores ' + f.verdict.siteWide + ' out of 100 and the homepage ' + f.verdict.homepage + '.'; return d; };
const stripMeta = (s) => { const c = clone(s); delete c.source; delete c.label; return c; };

(async () => {
  console.log('deterministic summary');
  [['sample', sample], ['demo', demo]].forEach(([n, d]) => { const ff = F.facts(d, { schema: schema }); const s = S.deterministic(ff); const v = S.validate(s, ff); t(n + ': stands alone and passes the validator', v.ok, v.errors.join('; ')); t(n + ': at most 3 priorities, each with gain and effort', s.priorities.length <= 3 && s.priorities.every((p) => typeof p.gain_pts === 'number' && /^Typically/.test(p.effort))); });
  const det = S.deterministic(f);
  t('it states readiness, not presence, in the caveats', det.caveats.some((c) => /readiness/.test(c) && /does not show/.test(c)));
  t('it never says a pattern is a shared template unless likelyShared', det.priorities.every((p) => !/shared template/.test(p.why) || f.priorities.filter((x) => x.ref === p.fact_ref)[0].likelyShared));

  console.log('validator rejects planted problems');
  const plant = (name, mutate, expect) => { const s = good(); mutate(s); const v = S.validate(s, f); t('rejects ' + name, !v.ok && (!expect || v.errors.some((e) => expect.test(e))), v.errors.join(' | ')); };
  t('the unmodified good reply passes', S.validate(good(), f).ok, S.validate(good(), f).errors.join('; '));
  plant('an invented number', (s) => { s.situation += ' We found 41 broken links.'; }, /number 41/);
  plant('an invented percentage', (s) => { s.working = 'Pages pass 93% of checks. All good.'; }, /number 93/);
  plant('a banned word', (s) => { s.headline = 'A robust ' + s.headline; }, /robust/);
  plant('"recommended"', (s) => { s.working = 'This is the recommended fix.'; }, /recommended/);
  plant('a ChatGPT mention', (s) => { s.situation += ' ChatGPT may read it differently.'; }, /AI product/);
  plant('a Claude mention', (s) => { s.caveats[0] = 'Claude was not asked.'; }, /AI product/);
  plant('the word citation', (s) => { s.working = 'No citation problems.'; }, /citation/);
  plant('a claim about being named in AI answers', (s) => { s.situation += ' The site is named in AI answers often.'; }, /claim about AI answers/);
  plant('an over-length headline', (s) => { s.headline = new Array(40).join('word ') + '.'; }, /over 30 words/);
  plant('a one-sentence situation', (s) => { s.situation = 'Just one sentence here.'; }, /2 or 3 sentences/);
  plant('too many priorities', (s) => { s.priorities = s.priorities.concat(clone(s.priorities)); }, /more than 3/);
  plant('a wrong gain', (s) => { s.priorities[0].gain_pts = 9.9; }, /differs from the fact/);
  plant('an unknown fact_ref', (s) => { s.priorities[0].fact_ref = 'check:Invented'; }, /not one of the facts/);
  plant('a shared-template claim where likelyShared is false', (s) => { const p = s.priorities.filter((x) => !f.priorities.filter((y) => y.ref === x.fact_ref)[0].likelyShared)[0]; p.why += ' It is a shared template.'; }, /shared template/);
  plant('a shared-template claim stated as fact', (s) => { s.priorities[1].why = 'This is a shared template problem.'; }, /without "likely"/);
  plant('no readiness caveat', (s) => { s.caveats = ['The crawl read 27 pages.']; }, /readiness/);
  plant('the site-wide score compared with the homepage benchmark', (s) => { s.situation = 'The site-wide score of ' + f.verdict.siteWide + ' sits below the benchmark average of ' + f.verdict.benchmark.average + '. Pages vary.'; }, /compares the site-wide score/);
  t('the model never receives vsBenchmark', !JSON.stringify(S.modelFacts(f)).includes('vsBenchmark') && JSON.stringify(S.modelFacts(f)).includes('homepageVsBenchmark'));
  plant('a number written as a word', (s) => { s.working = 'Forty pages pass. Fine.'; }, /as a word/);
  plant('a "where" with no page count', (s) => { s.priorities[0].where = 'one link'; }, /how many pages/);
  plant('an effort that is not "typically"', (s) => { s.priorities[0].effort = 'One link'; }, /typically/);
  plant('a missing key', (s) => { delete s.caveats; }, /missing key/);
  plant('an unexpected key', (s) => { s.extra = 1; }, /unexpected key/);
  plant('two em dashes in one field', (s) => { s.working = 'Pass — here — there.'; }, /em dash/);
  t('rejects a non-object', !S.validate('nope', f).ok && !S.validate([1], f).ok);
  t('accepts 100 and a percentage equal to a fact (80)', S.validate(Object.assign(good(), { working: 'Checks that fail on at least 80% of pages are scored out of 100. Fine.' }), f).ok);

  console.log('summarize: model, retry, fallback');
  const prompts = [];
  const askOk = async (p) => { prompts.push(p); return JSON.stringify(stripMeta(good())); };
  let r = await S.summarize(f, { ask: askOk, model: 'gemini-3.5-flash-lite', date: '2026-10-04' });
  t('a valid reply is used and labelled with the model and date', r.summary.source.kind === 'model' && /^Summary written by gemini-3\.5-flash-lite \(2026-10-04\) from the figures below and checked against them$/.test(r.summary.label) && r.attempts.length === 1);
  t('the prompt sends no URL, domain or snippet', !/https?:\/\//.test(prompts[0]) && prompts[0].indexOf(sample.domain) === -1 && prompts[0].indexOf('application/ld+json') === -1 && prompts[0].indexOf('User-agent') === -1);
  t('the prompt carries the rules (only figures from the facts, readiness, banned words)', /only figures that appear in the facts/i.test(prompts[0]) && /readiness/i.test(prompts[0]) && /robust/.test(prompts[0]) && /likelyShared/.test(prompts[0]));

  const seq = (replies) => { let i = 0; const seen = []; return { ask: async (p) => { seen.push(p); const x = replies[Math.min(i++, replies.length - 1)]; if (x instanceof Error) throw x; return x; }, seen }; };
  let m = seq(['{ not json', JSON.stringify(stripMeta(good()))]);
  r = await S.summarize(f, { ask: m.ask, model: 'm', date: '2026-10-04' });
  t('malformed JSON then a valid reply: retried once, the error is appended, the model summary is used', r.summary.source.kind === 'model' && r.attempts.length === 2 && !r.attempts[0].ok && /not valid JSON/.test(m.seen[1]) && !/rejected/.test(m.seen[0]));
  const bad = stripMeta(good()); bad.working = 'A robust setup. Fine.';
  m = seq([JSON.stringify(bad), JSON.stringify(bad)]);
  r = await S.summarize(f, { ask: m.ask, model: 'm', date: '2026-10-04' });
  t('two invalid replies: falls back to the rules summary', r.summary.source.kind === 'rules' && r.attempts.length === 2 && m.seen.length === 2 && S.validate(r.summary, f).ok);
  m = seq([new Error('HTTP 500'), new Error('HTTP 500')]);
  r = await S.summarize(f, { ask: m.ask, model: 'm', date: '2026-10-04' });
  t('the API failing twice: falls back to the rules summary', r.summary.source.kind === 'rules' && m.seen.length === 2 && r.summary.headline === S.deterministic(f).headline);
  m = seq([new Error('HTTP 429'), JSON.stringify(stripMeta(good()))]);
  r = await S.summarize(f, { ask: m.ask, model: 'm', date: '2026-10-04' });
  t('one API failure then a valid reply: the model summary is used', r.summary.source.kind === 'model');
  r = await S.summarize(f, {});
  t('no model configured: the rules summary, with no request', r.summary.source.kind === 'rules' && r.fallbackReason === 'no model configured');
  const outcomes = [await S.summarize(f, { ask: askOk, model: 'x', date: '2026-10-04' }), await S.summarize(f, {}), await S.summarize(f, { ask: seq([new Error('x'), new Error('x')]).ask })];
  t('the label is always present and is one of the two sentences', outcomes.every((o) => /^Summary written by (rules from the figures below|.+ \(.+\) from the figures below and checked against them)$/.test(o.summary.label)));
  t('both labels read exactly as specified', S.labelFor({ kind: 'rules' }) === 'Summary written by rules from the figures below' && /^Summary written by .+ from the figures below and checked against them$/.test(S.labelFor({ kind: 'model', model: 'M', date: 'D' })));

  console.log('the Gemini adapter');
  const realFetch = global.fetch; let calls = 0; global.fetch = async () => { calls++; throw new Error('network call'); };
  const saved = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
  let threw = false; try { await gemini.makeAsk({ noEnvFile: true })('x', {}); } catch (e) { threw = /not set/.test(e.message); }
  t('without a key it throws before making any request', threw && calls === 0);
  process.env.GEMINI_API_KEY = 'test-key'; let seen;
  global.fetch = async (url, init) => { seen = { url: url, init: init }; return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }) }; };
  const infos = []; const text = await gemini.makeAsk({ onCall: (i) => infos.push(i) })('hello', { model: 'gemini-3.5-flash-lite' });
  t('with a key it posts to the model endpoint, key in a header, low temperature, JSON reply', text === '{"a":1}' && /gemini-3\.5-flash-lite:generateContent$/.test(seen.url) && seen.init.headers['x-goog-api-key'] === 'test-key' && seen.url.indexOf('test-key') === -1 && JSON.parse(seen.init.body).generationConfig.temperature <= 0.3 && JSON.parse(seen.init.body).generationConfig.responseMimeType === 'application/json');
  t('the call log has the model and status, never the key or the prompt', infos.length === 1 && infos[0].ok && !JSON.stringify(infos).includes('test-key') && !JSON.stringify(infos).includes('hello'));
  global.fetch = realFetch; if (saved) process.env.GEMINI_API_KEY = saved; else delete process.env.GEMINI_API_KEY;

  console.log('\n' + pass + ' passed' + (fails.length ? ', ' + fails.length + ' failed' : ''));
  if (fails.length) { console.error('\n' + fails.join('\n')); process.exit(1); }
})();
