#!/usr/bin/env node
/* =====================================================================
   scripts/check-integrity.js (npm run check:integrity)

   Three checks on the repository itself. They exist because a file read back
   short from the file provider was once committed cut off, and a truncated
   vercel.json failed a production deploy.

     1. every tracked .js compiles (the same parser as node --check)
     2. every tracked .json parses
     3. every file at HEAD is byte-identical to the working file (by git blob hash)

   Playbook sources in content/playbooks are bare objects read by scripts/ingest-playbooks.js, so they
   are compiled in the four shapes that loader accepts. Run it after committing and before pushing; with
   --staged it compares the index with the working tree instead of HEAD, for use before a commit.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const crypto = require('crypto');

const ROOT = process.env.INTEGRITY_ROOT ? path.resolve(process.env.INTEGRITY_ROOT) : path.resolve(__dirname, '..'); // INTEGRITY_ROOT: the tests point it at a scratch repository
const staged = process.argv.indexOf('--staged') !== -1;
const git = (args) => cp.execFileSync('git', args, { cwd: ROOT, maxBuffer: 1e8 }).toString();

const entries = (staged ? git(['ls-files', '-s']) : git(['ls-tree', '-r', 'HEAD'])).split('\n').filter(Boolean).map((l) => {
  const m = staged ? /^\d+ ([0-9a-f]+) \d\t(.*)$/.exec(l) : /^\d+ blob ([0-9a-f]+)\t(.*)$/.exec(l);
  return { sha: m[1], file: m[2] };
});

const blobSha = (buf) => crypto.createHash('sha1').update('blob ' + buf.length + '\0').update(buf).digest('hex');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// A read that two attempts agree on. A stale or short read does not repeat itself the same way twice.
function stable(file) {
  let prev = null;
  for (let i = 0; i < 8; i++) {
    const cur = fs.readFileSync(path.join(ROOT, file));
    if (prev && prev.length === cur.length && Buffer.compare(prev, cur) === 0) return cur;
    prev = cur;
    sleep(120);
  }
  return prev;
}

const problems = { syntax: [], json: [], blob: [] };

function compiles(src, file) {
  // middleware.js is an ES module (Vercel edge middleware): its import and export keywords are dropped for the syntax check.
  const body = src.replace(/^#!.*/, '').replace(/^import [^\n]*$/gm, '').replace(/^export default /gm, '').replace(/^export /gm, '');
  const wrap = (code) => '(function (exports, require, module, __filename, __dirname) {' + code + '\n})';
  if (/^content\/playbooks\/[^/]+\.js$/.test(file)) {
    const text = body.trim();
    const shapes = [text, 'module.exports = ({' + text + '});', 'module.exports = (' + text.replace(/,\s*$/, '') + ');', text.replace(/^export default /, 'module.exports = ')];
    return shapes.some((c) => { try { new vm.Script(wrap(c), { filename: file }); return true; } catch (e) { return false; } });
  }
  try { new vm.Script(wrap(body), { filename: file }); return true; } catch (e) { return e.message; }
}

let jsCount = 0, jsonCount = 0;
for (const { sha, file } of entries) {
  const buf = fs.readFileSync(path.join(ROOT, file));
  // 3. the blob. Fast path: the first read matches. Otherwise read until two reads agree, then judge.
  let data = buf;
  if (blobSha(buf) !== sha) {
    data = stable(file);
    if (blobSha(data) !== sha) problems.blob.push(file + ' (' + (staged ? 'index' : 'HEAD') + ' ' + sha.slice(0, 10) + ', working ' + blobSha(data).slice(0, 10) + ', ' + data.length + ' bytes)');
  }
  const text = data.toString('utf8');
  if (/\.js$/.test(file)) { jsCount++; const r = compiles(text, file); if (r !== true) problems.syntax.push(file + (typeof r === 'string' ? ': ' + r : '')); }
  if (/\.json$/.test(file)) { jsonCount++; try { JSON.parse(text); } catch (e) { problems.json.push(file + ': ' + e.message); } }
}

const total = problems.syntax.length + problems.json.length + problems.blob.length;
if (total) {
  console.error('FAIL (' + total + '):');
  problems.syntax.forEach((p) => console.error('  does not compile: ' + p));
  problems.json.forEach((p) => console.error('  does not parse: ' + p));
  problems.blob.forEach((p) => console.error('  ' + (staged ? 'index' : 'HEAD') + ' differs from the working file: ' + p));
  process.exit(1);
}
console.log('OK: ' + jsCount + ' .js files compile, ' + jsonCount + ' .json files parse, and all ' + entries.length + ' files at ' + (staged ? 'the index' : 'HEAD') + ' are byte-identical to the working tree');
