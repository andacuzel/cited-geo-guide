#!/usr/bin/env node
/* =====================================================================
   scripts/check-secrets.js: look for secrets in the repository. It never prints a secret, only where a pattern matched.

     node scripts/check-secrets.js             every tracked file, as it is in the working tree (this is the gate)
     node scripts/check-secrets.js --history   also every line ever added in any commit (git log --all -p)

   Two kinds of check:
     1. known token shapes (Google, Anthropic, OpenAI, Perplexity, Resend, Polar, GitHub, Stripe, AWS, Slack, JWTs, private key
        blocks, Upstash REST URLs) and env-like assignments (NAME_KEY / _TOKEN / _SECRET / _PASSWORD = a long literal);
     2. every value in the gitignored .env.local (16 characters or more) looked up as a literal, when that file exists.

   A match is a finding unless the matched text is plainly a placeholder or test value (see PLACEHOLDER) or the line carries
   "secret-scan: ok". Exit 1 on any finding.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = process.env.SECRET_SCAN_ROOT ? path.resolve(process.env.SECRET_SCAN_ROOT) : path.resolve(__dirname, '..'); // the override is for scripts/test-check-secrets.js
const history = process.argv.indexOf('--history') !== -1;

const SHAPES = [
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI key', /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ['Perplexity key', /pplx-[A-Za-z0-9]{24,}/],
  ['Resend key', /\bre_[A-Za-z0-9]{16,}_?[A-Za-z0-9]*/],
  ['Polar token', /polar_(?:oat|pat|whs)_[A-Za-z0-9]{16,}/],
  ['webhook signing secret', /\bwhsec_[A-Za-z0-9+/=]{16,}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/],
  ['Stripe key', /\b[sr]k_live_[A-Za-z0-9]{16,}/],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{20,}/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}/],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY/],
  ['Upstash REST URL', /https:\/\/[a-z0-9-]+\.upstash\.io/],
  ['Upstash/Vercel token shape', /\bA[A-Za-z0-9]{3}[A-Za-z0-9_-]{30,}={1,2}(?![A-Za-z0-9])/],
  ['env-like assignment', /\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)\b["']?\s*[=:]\s*["']?([A-Za-z0-9+/_=-]{24,})["']?/]
];
// Text that is plainly not a secret: placeholders, names of variables, obvious test values. The last two names are a test
// secret in scripts/test-waitlist.js and the public salt string the rate limiter used before PRO_HASH_SECRET was required.
const PLACEHOLDER = /^(?:x{4,}|\.{3}|<.*>|your[-_]|example|test|fake|dummy|sample|changeme|placeholder|process\.|env\.|ENV|secret-?for|a{16,}|0{16,}|1{16,})|^[A-Z0-9_]+$|[Ff]ake|[Tt]est|[Ee]xample|[Dd]ummy|placeholder|not-a-real|local-only|for-tests|unit-test|xxxx|\$\{|different-secret|citehound-pro-rate-limit/;

const envValues = [];
try {
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/).forEach((l) => {
    const m = /^\s*[A-Z0-9_]+\s*=\s*(.*)\s*$/.exec(l);
    if (!m) return;
    const v = m[1].replace(/^["']|["']$/g, '');
    if (v.length >= 16 && !/^https?:\/\/(localhost|127\.)/.test(v)) envValues.push(v);
  });
} catch (e) { /* no .env.local on this machine: only the shapes are checked */ }

function scanLine(line) {
  const hits = [];
  if (/secret-scan: ok/.test(line)) return hits;
  for (const [name, re] of SHAPES) {
    const m = re.exec(line);
    if (!m) continue;
    const v = m[1] || m[0];
    if (name === 'Upstash REST URL' || name === 'env-like assignment' || name === 'Upstash/Vercel token shape' || name === 'JWT' || name === 'OpenAI key' || name === 'Resend key') { if (PLACEHOLDER.test(v) || PLACEHOLDER.test(m[0])) continue; }
    else if (/fake|example|test|xxxx|your/i.test(v)) continue;
    hits.push(name);
  }
  for (const v of envValues) if (line.indexOf(v) !== -1) hits.push('a value from .env.local');
  return hits;
}

const findings = [];
function scanText(where, text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 4000) continue; // minified data, not a secret line; the shapes above are short
    for (const h of scanLine(lines[i])) findings.push(where + ':' + (i + 1) + ' ' + h);
  }
}

// 1. the working tree, tracked files only
const tracked = cp.execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1e8 }).split('\0').filter(Boolean);
let files = 0;
for (const f of tracked) {
  if (/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|pdf|zip|mp4|frag)$/i.test(f) && !/\.frag$/.test(f)) continue;
  let buf; try { buf = fs.readFileSync(path.join(ROOT, f)); } catch (e) { continue; }
  if (buf.indexOf(0) !== -1) continue;
  files++;
  scanText(f, buf.toString('utf8'));
}

// 2. history: every added line in every commit
let commits = 0;
if (history) {
  const p = cp.spawnSync('git', ['log', '--all', '-p', '--no-color', '--unified=0', '--format=@@COMMIT %h'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1e9 });
  let commit = '?', file = '?'; const seen = new Set();
  String(p.stdout).split('\n').forEach((line) => {
    if (line.startsWith('@@COMMIT ')) { commit = line.slice(9); commits++; return; }
    if (line.startsWith('+++ b/')) { file = line.slice(6); return; }
    if (line[0] !== '+' || line.startsWith('+++') || line.length > 4000) return;
    for (const h of scanLine(line.slice(1))) { const k = commit + ' ' + file + ' ' + h; if (!seen.has(k)) { seen.add(k); findings.push('history ' + commit + ' ' + file + ' ' + h); } }
  });
}

process.stdout.write('Scanned ' + files + ' tracked files' + (history ? ' and the added lines of ' + commits + ' commits' : '') + '; ' + envValues.length + ' local secret value(s) looked up as literals.\n');
if (findings.length) {
  process.stdout.write(findings.length + ' possible secret(s). Nothing is printed except where:\n  ' + findings.slice(0, 60).join('\n  ') + '\n');
  process.exit(1);
}
process.stdout.write('No secrets found.\n');
