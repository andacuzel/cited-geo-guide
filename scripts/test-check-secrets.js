#!/usr/bin/env node
/* =====================================================================
   scripts/test-check-secrets.js: the secret scanner finds what it should and stays quiet about placeholders, in a throwaway git repo.
   ===================================================================== */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secscan-'));
const git = (...a) => cp.execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
const scan = (...flags) => cp.spawnSync(process.execPath, [path.join(__dirname, 'check-secrets.js')].concat(flags), { env: Object.assign({}, process.env, { SECRET_SCAN_ROOT: dir }), encoding: 'utf8' });
const rnd = (n) => { let s = ''; const c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; while (s.length < n) s += c[Math.floor(Math.random() * c.length)]; return s; };

git('init', '-q'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 'x');
fs.writeFileSync(path.join(dir, 'ok.js'), "const k = process.env.GEMINI_API_KEY;\nconst SECRET = 'your-secret-here-your-secret-here';\nconst KEY = 'test-key-for-unit-tests-0123456789';\n");
git('add', '.'); git('commit', '-q', '-m', 'ok');
let r = scan();
t('a repository with only placeholders and env lookups is clean', r.status === 0, r.stdout);

const planted = { google: 'AIza' + rnd(35), anthropic: 'sk-ant-' + rnd(40), resend: 're_' + rnd(30), upstash: 'https://' + rnd(12).toLowerCase() + '.upstash.io', assign: 'MY_API_TOKEN = "' + rnd(40) + '"' };
fs.writeFileSync(path.join(dir, 'bad.js'), Object.values(planted).map((v) => 'x = "' + v.replace(/"/g, '') + '";').join('\n') + '\n' + planted.assign + '\n');
git('add', '.'); git('commit', '-q', '-m', 'bad');
r = scan();
t('planted keys, an Upstash URL and an env-like assignment are all found', r.status === 1 && /bad\.js:1 Google API key/.test(r.stdout) && /bad\.js:2 Anthropic key/.test(r.stdout) && /bad\.js:3 Resend key/.test(r.stdout) && /bad\.js:4 Upstash REST URL/.test(r.stdout) && /bad\.js:6 env-like assignment/.test(r.stdout), r.stdout);
t('the output names where, never the secret', Object.values(planted).every((v) => r.stdout.indexOf(v.replace(/^.*"?([A-Za-z0-9_-]{20,}).*$/, '$1')) === -1 && r.stdout.indexOf(v) === -1));

fs.unlinkSync(path.join(dir, 'bad.js')); git('add', '-A'); git('commit', '-q', '-m', 'remove');
t('after the file is removed the tree is clean', scan().status === 0);
r = scan('--history');
t('--history still finds a secret that was committed and removed', r.status === 1 && /history [0-9a-f]+ bad\.js Google API key/.test(r.stdout), r.stdout);
fs.rmSync(dir, { recursive: true, force: true });

out('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
