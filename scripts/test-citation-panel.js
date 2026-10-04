#!/usr/bin/env node
/* =====================================================================
   scripts/test-citation-panel.js: the Citations tab renders both states, and
   every figure in it equals the sample file.
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CP = require('../lib/citation-panel.js');
const R = require('../lib/report-render.js');
const F = require('../lib/report-facts.js');
const schema = require('../lib/schema.js');

let pass = 0; const fails = [];
const t = (n, ok, x) => { if (ok) pass++; else fails.push(n + (x ? ' :: ' + x : '')); console.log((ok ? '  ok  ' : '  FAIL ') + n + (ok ? '' : '  ' + (x || ''))); };
const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/citations/sample-crm.json'), 'utf8'));
const figs = (html, k) => { const re = new RegExp('data-fig="' + k + '">([^<]*)<', 'g'); const o = []; let m; while ((m = re.exec(html)) !== null) o.push(m[1]); return o; };
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

const result = CP.fromSample(sample);
const html = CP.panel(result, { sample: true });
console.log('the schema');
t('the sample converts to schema v1 and validates', CP.validate(result).length === 0, CP.validate(result).join('; '));
t('no source domains for an ungrounded run, and no competitors (the sample is anonymised)', result.sourceDomains === null && result.namedInstead === null && result.models[0].mode === 'ungrounded');
const bad = (mut) => { const r = JSON.parse(JSON.stringify(result)); mut(r); return CP.validate(r); };
t('rejects source domains on an ungrounded run', bad((r) => { r.sourceDomains = { byModel: { [r.models[0].key]: [{ domain: 'g2.com', count: 3 }] } }; }).some((p) => /grounded/.test(p)));
t('rejects the wrong number of marks', bad((r) => { r.questions[0].byModel[r.models[0].key].marks.pop(); }).some((p) => /marks/.test(p)));
t('rejects a missing model column and a wrong schema version', bad((r) => { r.questions[0].byModel = {}; }).length > 0 && bad((r) => { r.schemaVersion = 2; }).length > 0);

console.log('the tab with a result (sample, labelled as another brand)');
const named = (runs) => runs.filter((x) => x !== 'absent').length;
const g = (k) => sample.prompts.filter((p) => p.group === k).length;
t('the three large figures equal the sample', figs(html, 'cit-never')[0] === String(g('never')) && figs(html, 'cit-unstable')[0] === String(g('unstable')) && figs(html, 'cit-always')[0] === String(g('always')));
t('answers named and answers in all equal the sample', figs(html, 'cit-named')[0] === String(sample.prompts.reduce((n, p) => n + named(p.runs), 0)) && figs(html, 'cit-total')[0] === String(sample.prompts.length * sample.runsPerPrompt) && figs(html, 'cit-questions')[0] === String(sample.prompts.length));
t('model, date and tries equal the sample', figs(html, 'cit-model')[0] === sample.model && figs(html, 'cit-date')[0] === 'October 2, 2026' && figs(html, 'cit-tries')[0] === 'five');
t('labelled "Sample from a different brand", with the brand described and not named', /Sample from a different brand/.test(html) && html.indexOf(sample.label) !== -1);
const groups = (html.match(/<details class="ct-detail"[^>]*data-group="[a-z]+"/g) || []);
t('three groups, and only "Never named" is open by default', groups.length === 3 && groups.filter((x) => / open /.test(x)).length === 1 && /ct-detail" open data-group="never"/.test(html));
const rows = (html.match(/<tr class="rp-cit-row">[\s\S]*?<\/tr>/g) || []);
t('every question appears once with its own marks, in the group the sample gives', rows.length === sample.prompts.length && sample.prompts.every((p) => {
  const row = rows.filter((r) => decode(r.match(/<th scope="row" class="rp-cit-q">([\s\S]*?)<\/th>/)[1]) === p.question)[0];
  if (!row) return false;
  const marks = (row.match(/ct-mark--(named|absent)/g) || []).map((x) => x.slice(9));
  const inGroup = html.split(/<details class="ct-detail"/).filter((s) => s.indexOf(row.slice(0, 80)) !== -1)[0];
  return marks.join() === p.runs.map((x) => (x === 'absent' ? 'absent' : 'named')).join() && new RegExp('data-group="' + p.group + '"').test(inGroup);
}));
t('one model means one column (plus the question column)', (html.match(/<th scope="col"/g) || []).length === 3 * 2 && (html.match(/class="rp-cit-model"/g) || []).length === 3);
t('the header names the model, provider, date and that web search was off', /gemini-3\.5-flash-lite<\/span><span class="rp-cit-model__meta">gemini, October 2, 2026, no web search/.test(html));
t('real table semantics: caption, scope headers', (html.match(/<caption/g) || []).length === 3 && /<th scope="row" class="rp-cit-q">/.test(html));
t('says who is named instead and sources are absent and why', /not part of the published sample/.test(html) && /only for runs made with web search/.test(html));
t('keeps the honest limits and the early-access CTA', /One model on one date/.test(html) && /not as an endorsement/.test(html) && /Get early access/.test(html) && /self-serve version is still to come/.test(html));
t('never says recommended, featured, sweeps or mention rate', !/\b(recommended|featured|sweeps?|mention rate)\b/i.test(html.replace(/<[^>]+>/g, ' ')));
t('a two-model result gets two columns', (() => { const r = JSON.parse(JSON.stringify(result)); const k = 'openai:gpt-x'; r.models.push({ key: k, provider: 'openai', model: 'gpt-x', date: '2026-10-02', mode: 'ungrounded', tries: 5 }); r.questions.forEach((q) => { q.byModel[k] = JSON.parse(JSON.stringify(q.byModel[r.models[0].key])); }); const h = CP.panel(r, { sample: true }); return CP.validate(r).length === 0 && (h.match(/class="rp-cit-model"/g) || []).length === 6; })());

console.log('the tab with no run');
const empty = CP.panel(null, {});
t('says there is no citation run for this site yet and what a run asks', /No citation run for this site yet/.test(empty) && /five times each/.test(empty) && /Get early access/.test(empty) && /Nothing on this page starts one/.test(empty));
t('the empty state shows no data and no figure', !/data-fig/.test(empty) && !/rp-mark|ct-mark/.test(empty));

console.log('inside the whole report');
const crawl = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/pro/demo-fixture.json'), 'utf8'));
crawl.benchmark = F.benchmarkFromData(path.join(ROOT, 'data'));
const withRun = R.render(crawl, { schema: schema, label: 'Demo data', citation: { result: result, sample: true } });
const without = R.render(crawl, { schema: schema });
const panelOf = (h) => h.slice(h.indexOf('id="rp-citations"'));
t('both states sit inside the Citations section, in the static HTML', /id="rp-citations"/.test(withRun) && /Sample from a different brand/.test(panelOf(withRun)) && /No citation run for this site yet/.test(panelOf(without)));
t('the dashboard starts nothing: no request or endpoint is referenced by the panel', !/fetch\(|XMLHttpRequest|\/api\//.test(fs.readFileSync(path.join(ROOT, 'lib/citation-panel.js'), 'utf8')));

console.log('\n' + pass + ' passed' + (fails.length ? ', ' + fails.length + ' failed' : ''));
if (fails.length) { console.error('\n' + fails.join('\n')); process.exit(1); }
