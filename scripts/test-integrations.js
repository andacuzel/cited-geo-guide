#!/usr/bin/env node
/* =====================================================================
   scripts/test-integrations.js

   Every integration under integrations/<name>/ (n8n, Make, Zapier, ... as they are built), against docs/integrations/RULES.md:
   - the shared client is copied unchanged into each folder that uses it, and every README carries the plan block generated from lib/plans.js (scripts/sync-integrations.js --check);
   - the tests of the shared client and of each integration pass (node --test, mocked API: no key, no network);
   - each README says its status ("built and tested, not published" until the owner submits it), has the four plan lines, the readiness sentence, and promises no outcome;
   - the words follow RULES.md (no recommend, cite, rank, guarantee, boost, official, verified, partner outside a sentence that denies it), no third-party logo files, no banned voice words;
   - no real-looking key or secret in any file, no runtime dependency (Zapier's platform package is the one allowed, by design), nothing makes a request but to getcitehound.com;
   - the folder is kept off the deployed site (.vercelignore).

     node scripts/test-integrations.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

const dirs = fs.readdirSync(path.join(ROOT, 'integrations'), { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'shared').map((e) => e.name).sort();
const walk = (d, acc) => { fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).forEach((e) => { if (e.name === 'node_modules' || e.name === '.git') return; const r = d + '/' + e.name; if (e.isDirectory()) walk(r, acc); else acc.push(r); }); return acc; };

const sync = cp.spawnSync(process.execPath, ['scripts/sync-integrations.js', '--check'], { cwd: ROOT, encoding: 'utf8' });
t('the shared client is copied unchanged and every README has the current plan block', sync.status === 0, (sync.stderr + sync.stdout).trim().slice(0, 300));
t('the integrations folder is kept off the deployed site (.vercelignore)', /^integrations\/$/m.test(read('.vercelignore')));

const runTests = (dir) => { const files = fs.existsSync(path.join(ROOT, dir, 'test')) ? fs.readdirSync(path.join(ROOT, dir, 'test')).filter((f) => /\.test\.js$/.test(f)).map((f) => 'test/' + f) : []; if (!files.length) return { files: 0 }; const r = cp.spawnSync(process.execPath, ['--test'].concat(files), { cwd: path.join(ROOT, dir), encoding: 'utf8', timeout: 180000 }); return { files: files.length, ok: r.status === 0 && /ℹ fail 0/.test(r.stdout), n: +((/ℹ tests (\d+)/.exec(r.stdout) || [])[1] || 0), msg: (r.stdout + r.stderr).split('\n').filter((l) => /✖|Error/.test(l)).slice(0, 3).join(' | ') }; };
const shared = runTests('integrations/shared');
t('the shared client tests pass (' + shared.n + ' tests)', shared.ok && shared.n >= 8, shared.msg);

const NEG = /\b(not|never|nothing|no|nor|without|does not|doesn't|don't|unless)\b/i;
const BAD = /\b(recommend\w*|cites?|cited|ranks?|ranking\w*|guarantee\w*|boost\w*|unlimited|official\w*|verified|partner\w*|visibility)\b/i;
const VOICE = /\b(unlock|seamless(ly)?|powerful|robust|crucial|delve|supercharge|game-changing|revolutioni[sz]e|effortless|elevate|landscape|quietly|actually)\b/i;

dirs.forEach((d) => {
  const base = 'integrations/' + d, files = walk(base, []).filter((f) => !/\/dist\/|\/node_modules\//.test(f));
  const R = fs.existsSync(path.join(ROOT, base, 'README.md')) ? read(base + '/README.md') : '';
  t(d + ': a README with its status (built and tested, not published) and the readiness sentence', /^> \*\*Status: [^*]*\*\*/m.test(R) && /not (published|submitted|on npm)/i.test(R) && /does not measure whether any assistant names a brand/.test(R));
  t(d + ': the README has the four plan lines (Free, Pro, Fix, Beyond) from the matrix', /<!-- PLANS:START -->[\s\S]*\*\*Free:\*\*[\s\S]*\*\*Pro:\*\*[\s\S]*\*\*Fix:\*\*[\s\S]*\*\*Beyond:\*\*[\s\S]*<!-- PLANS:END -->/.test(R));
  const positive = R.split('\n').filter((l) => !NEG.test(l)).join('\n').replace(/cited-geo-guide/g, 'repository');
  const hit = BAD.exec(positive);
  t(d + ': README words: no recommend, cite, rank, guarantee, boost, official, verified or partner outside a denial, no outcome promise, no banned voice word', !hit && !/will (increase|improve|boost|raise|get you|make)|more (traffic|citations|revenue)/i.test(positive) && !VOICE.test(R), hit && hit[0]);
  const texts = files.filter((f) => /\.(js|ts|json|md|gs|html)$/.test(f)).map((f) => ({ f: f, s: read(f) }));
  t(d + ': no real-looking key or secret in any file', !texts.some((x) => /chk_[A-Za-z0-9_-]{32}\b/.test(x.s) || /(api[_-]?key|secret|token)["']?\s*[:=]\s*["'][A-Za-z0-9_\-]{24,}["']/i.test(x.s)), texts.filter((x) => /chk_[A-Za-z0-9_-]{32}\b/.test(x.s)).map((x) => x.f).join());
  t(d + ': no image or logo file except Citehound\'s own mark', files.filter((f) => /\.(png|jpe?g|gif|webp|ico|svg)$/i.test(f)).every((f) => /citehound\.svg$|icon\.(png|svg)$/.test(f)));
  const pkgPath = base + '/package.json';
  if (fs.existsSync(path.join(ROOT, pkgPath))) {
    const pkg = JSON.parse(read(pkgPath));
    const deps = Object.keys(pkg.dependencies || {});
    t(d + ': no runtime dependency' + (d === 'zapier' ? ' except the Zapier platform package' : '') + ', license MIT, repository with its directory', deps.every((x) => d === 'zapier' && x === 'zapier-platform-core') && pkg.license === 'MIT' && pkg.repository && pkg.repository.directory === base, JSON.stringify(deps));
  }
  const reqs = texts.filter((x) => /\.(js|ts|gs)$/.test(x.f) && !/\/test\//.test(x.f) && !/citehound-core\.js$/.test(x.f)).map((x) => x.s.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '')).join('\n');
  t(d + ': the only address in its code is getcitehound.com', (reqs.match(/https?:\/\/[a-z0-9.-]+/gi) || []).every((u) => /getcitehound\.com|schema\.org|www\.w3\.org|127\.0\.0\.1|localhost/.test(u)), (reqs.match(/https?:\/\/[a-z0-9.-]+/gi) || []).filter((u) => !/getcitehound\.com|schema\.org|www\.w3\.org|127\.0\.0\.1|localhost/.test(u)).join());
  const r = runTests(base);
  t(d + ': its own tests pass' + (r.files ? ' (' + r.n + ' tests)' : ''), r.files > 0 && r.ok && r.n >= 5, r.msg || 'no tests');
});

const prog = read('docs/integrations/PROGRESS.md');
t('PROGRESS.md and TIERS.md exist; every integration folder is in PROGRESS.md', fs.existsSync(path.join(ROOT, 'docs/integrations/TIERS.md')) && dirs.every((d) => new RegExp(d, 'i').test(prog)), dirs.filter((d) => !new RegExp(d, 'i').test(prog)).join());

out('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { fails.forEach((f) => out('FAIL: ' + f)); process.exit(1); }
