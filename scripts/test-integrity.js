#!/usr/bin/env node
/* =====================================================================
   scripts/test-integrity.js: the integrity and vercel.json checks, tried on files that are wrong.

     - a scratch git repository with a good file, a cut-off .js, a broken .json and a file whose
       committed copy is shorter than the working copy: each must be reported
     - vercel.json: the truncated copy from the failed deploy (0678dbc) is rejected, a bad value is
       rejected, the real file is accepted

     node scripts/test-integrity.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; const fails = [];
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); console.log((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

function run(script, args, env) {
  const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'scripts', script)].concat(args || []), { env: Object.assign({}, process.env, env || {}), encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

(async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'integrity-'));
  const sh = (cmd) => cp.execSync(cmd, { cwd: dir, stdio: 'pipe' });
  sh('git init -q && git config user.email t@example.org && git config user.name t');
  fs.mkdirSync(path.join(dir, 'content', 'playbooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'good.js'), "module.exports = function () { return 1; };\n");
  fs.writeFileSync(path.join(dir, 'ok.json'), '{"a":1}');
  fs.writeFileSync(path.join(dir, 'content', 'playbooks', 'bare.js'), "name: 'x',\ncontent: 'y'\n");
  sh('git add -A && git commit -q -m base');
  let r = run('check-integrity.js', [], { INTEGRITY_ROOT: dir });
  t('a clean repository passes', r.code === 0 && /OK/.test(r.out), r.out);

  fs.writeFileSync(path.join(dir, 'cut.js'), "function f() {\n  return {\n");
  fs.writeFileSync(path.join(dir, 'bad.json'), '{"a":1,');
  sh('git add -A && git commit -q -m broken');
  r = run('check-integrity.js', [], { INTEGRITY_ROOT: dir });
  t('a cut-off .js is reported', r.code === 1 && /does not compile: cut\.js/.test(r.out), r.out);
  t('a broken .json is reported', /does not parse: bad\.json/.test(r.out), r.out);
  t('a good file and a playbook source are not reported', !/good\.js|bare\.js|ok\.json/.test(r.out), r.out);

  // The committed copy is shorter than the working copy (what the stale read did).
  fs.writeFileSync(path.join(dir, 'full.js'), "var a = 1;\nvar b = 2;\nvar c = 3;\n");
  sh('git add full.js');
  fs.writeFileSync(path.join(dir, 'full.js'), "var a = 1;\nvar b = 2;\n");
  sh('git add full.js && git commit -q -m short');
  fs.writeFileSync(path.join(dir, 'full.js'), "var a = 1;\nvar b = 2;\nvar c = 3;\n");
  r = run('check-integrity.js', [], { INTEGRITY_ROOT: dir });
  t('a committed file that differs from the working file is reported', /HEAD differs from the working file: full\.js/.test(r.out), r.out);
  r = run('check-integrity.js', ['--staged'], { INTEGRITY_ROOT: dir });
  t('--staged compares the index with the working tree', /index differs from the working file: full\.js/.test(r.out), r.out);
  fs.rmSync(dir, { recursive: true, force: true });

  // vercel.json
  const real = run('check-vercel-json.js', []);
  t('the real vercel.json is valid', real.code === 0 && /OK/.test(real.out), real.out);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-'));
  // The copy that failed the deploy ended in the middle of the last rewrite: the real file, cut there.
  const realText = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
  const cutText = realText.slice(0, realText.lastIndexOf('{ "source"') + 11);
  fs.writeFileSync(path.join(tmp, 'cut.json'), cutText);
  r = run('check-vercel-json.js', [path.join(tmp, 'cut.json')]);
  t('a vercel.json cut off mid-rewrite, as in the failed deploy (0678dbc), is rejected', r.code === 1 && /does not parse/.test(r.out), r.out);
  fs.writeFileSync(path.join(tmp, 'bad.json'), JSON.stringify({ functions: { 'api/x.js': { maxDuration: 'long' } }, rewrites: [{ source: '/a' }], bogus: true }));
  r = run('check-vercel-json.js', [path.join(tmp, 'bad.json')]);
  t('a wrong value, a missing destination and an unknown key are rejected', r.code === 1 && /maxDuration/.test(r.out) && /bogus/.test(r.out) && /destination/.test(r.out), r.out);
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.error('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
}()).catch((e) => { console.error(e); process.exit(1); });
