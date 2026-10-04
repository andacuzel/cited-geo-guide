#!/usr/bin/env node
/* =====================================================================
   scripts/make-sample-summary.js

   Writes the executive summary for content/pro/sample-report.json:
     node scripts/make-sample-summary.js            one model pass if GEMINI_API_KEY is
                                                    available (env or .env.local), validated;
                                                    otherwise the rules summary
     node scripts/make-sample-summary.js --rules    the rules summary, no request

   The summary is stored under executiveSummary with the model and the date.
   Each model request is announced on stdout (model and status only).
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const F = require('../lib/report-facts.js');
const S = require('../lib/summary.js');
const schema = require('../lib/schema.js');
const gemini = require('../lib/summary-gemini.js');

const ROOT = path.resolve(__dirname, '..');
const FILE = process.env.SAMPLE_FILE || path.join(ROOT, 'content/pro/sample-report.json');

(async () => {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  delete data.executiveSummary;
  data.benchmark = F.benchmarkFromData(path.join(ROOT, 'data'));
  const f = F.facts(data, { schema: schema });
  const useModel = process.argv.indexOf('--rules') === -1 && gemini.hasKey();
  let calls = 0;
  const ask = useModel ? gemini.makeAsk({ onCall: (i) => { calls++; console.log('model request ' + calls + ': ' + i.model + ' ' + (i.ok ? 'ok' : 'failed (' + (i.error || i.status) + ')')); } }) : null;
  const r = await S.summarize(f, { ask: ask, model: gemini.DEFAULT_MODEL, date: new Date().toISOString().slice(0, 10) });
  r.attempts.forEach((a) => { if (!a.ok) console.log('attempt ' + a.attempt + ' rejected: ' + a.errors.join(' | ')); });
  const stored = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  stored.executiveSummary = r.summary;
  fs.writeFileSync(FILE, JSON.stringify(stored, null, 1));
  console.log(useModel ? 'model requests made: ' + calls : 'no key found or --rules: no request made');
  console.log('stored: ' + r.summary.label + (r.fallbackReason ? ' (fell back: ' + r.fallbackReason + ')' : ''));
  console.log(JSON.stringify(r.summary, null, 1));
})().catch((e) => { console.error(e.message); process.exit(1); });
