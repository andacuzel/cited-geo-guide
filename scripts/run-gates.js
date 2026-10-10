#!/usr/bin/env node
/* =====================================================================
   scripts/run-gates.js (npm run gates): every gate that must pass before a push.

     node scripts/run-gates.js              all gates, in order; exit 1 if any fails
     node scripts/run-gates.js --precommit  the integrity check compares the index (use before committing)
     node scripts/run-gates.js --list       print the gates

   There are no known failures: a red gate stops the push. After the push, run
   node scripts/smoke-live.js (npm run smoke), which waits for the deploy and checks the live site.
   scripts/test-real-kv.js is not here: it needs the Upstash credentials and writes to the real database,
   so it is run by hand (see docs/pro.md).
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const precommit = process.argv.indexOf('--precommit') !== -1;
const scripts = fs.readdirSync(path.join(ROOT, 'scripts'));

const gates = [];
gates.push({ name: 'integrity: every .js compiles, every .json parses, ' + (precommit ? 'the index' : 'HEAD') + ' equals the working tree', args: ['scripts/check-integrity.js'].concat(precommit ? ['--staged'] : []) });
gates.push({ name: 'vercel.json is valid against the Vercel schema', args: ['scripts/check-vercel-json.js'] });
scripts.filter((f) => /^generate-.*\.js$/.test(f)).sort().forEach((f) => gates.push({ name: f + ' --check', args: ['scripts/' + f, '--check'] }));
['check-pages.js', 'check-mcp-drift.js', 'check-launch-config.js', 'check-research-index.js', 'check-secrets.js'].forEach((f) => gates.push({ name: f, args: ['scripts/' + f] }));
gates.push({ name: 'site-chrome.js --check', args: ['scripts/site-chrome.js', '--check'] });
gates.push({ name: 'capture-pro-shots.js --check', args: ['scripts/capture-pro-shots.js', '--check'] });
scripts.filter((f) => /^test-.*\.js$/.test(f) && f !== 'test-real-kv.js').sort().forEach((f) => gates.push({ name: f, args: ['scripts/' + f] }));

if (process.argv.indexOf('--list') !== -1) { gates.forEach((g, i) => console.log((i + 1) + '. ' + g.name)); process.exit(0); }

const failed = [];
gates.forEach((g, i) => {
  const started = Date.now();
  const r = cp.spawnSync(process.execPath, g.args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1e8 });
  const ok = r.status === 0;
  console.log((ok ? 'pass ' : 'FAIL ') + (i + 1) + '/' + gates.length + ' ' + g.name + ' (' + ((Date.now() - started) / 1000).toFixed(1) + ' s)');
  if (!ok) { failed.push(g.name); console.log(((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-8).map((l) => '     ' + l).join('\n')); }
});
console.log('\n' + (gates.length - failed.length) + ' of ' + gates.length + ' gates pass' + (failed.length ? '. Failed:\n  ' + failed.join('\n  ') : '.'));
process.exit(failed.length ? 1 : 0);
