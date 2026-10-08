#!/usr/bin/env node
/* =====================================================================
   scripts/set-domain.js <newBaseUrl> [--apply] [--include-protected]

   Moves the site to a new address in one command. It reads the current address
   from site.config.json, finds every occurrence of the old host in the
   repository (git-tracked and untracked, not ignored), and classifies each one
   with config/domain-rules.json:

     rewrite     canonical and share tags, JSON-LD @id and url, sitemap.xml, the
                 robots.txt Sitemap line, security.txt Canonical, llms.txt, the
                 connection snippets in mcp.html, script defaults, and the plugin,
                 submission and research index files (generated from the config)
     historical  never changed: content/pro/*.json, crops built from them,
                 sentences about a crawl of the old host, data/, the case study's
                 citation line, changelog entries
     protected   api/scan.js, lib/scanner.js, scanner.js, app.js: changed only with
                 --include-protected, and only inside URL literals
     unclassified  matches no rule: reported, never changed, and the run exits 2

   Without --apply it is a dry run: it prints the plan and changes nothing.
   With --apply it rewrites the files, updates site.config.json, reruns every
   generator, then runs every --check, node --check on all JS, and lists any
   remaining occurrence of the old host with its class.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'domain-rules.json'), 'utf8'));

const args = process.argv.slice(2);
const flag = (f) => args.indexOf(f) !== -1;
const APPLY = flag('--apply');
const PROTECTED_OK = flag('--include-protected');
const target = args.filter((a) => a.indexOf('--') !== 0)[0];

function die(msg) { console.error(msg); process.exit(1); }

if (!target) die('Usage: node scripts/set-domain.js <newBaseUrl> [--apply] [--include-protected]');
let newBase;
try {
  const u = new URL(target);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('scheme');
  if (u.pathname !== '/' || u.search || u.hash) throw new Error('path');
  newBase = u.origin;
} catch (e) { die('The new base URL must be a bare origin such as https://example.com (no path, query or fragment). Got: ' + target); }
const newHost = newBase.replace(/^https?:\/\//, '');

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const oldBase = String(config.baseUrl).replace(/\/+$/, '');
const oldHost = config.host || oldBase.replace(/^https?:\/\//, '');
if (oldBase === newBase) die('site.config.json already says ' + newBase + '. Nothing to do.');
const hostRe = new RegExp(oldHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

/* ---------- which files ---------- */

function listFiles() {
  let names = [];
  try {
    names = cp.execSync('git ls-files -co --exclude-standard', { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString().split('\n').filter(Boolean);
  } catch (e) {
    (function walk(dir) {
      fs.readdirSync(dir, { withFileTypes: true }).forEach((en) => {
        if (['node_modules', '.git'].indexOf(en.name) !== -1) return;
        const p = path.join(dir, en.name);
        if (en.isDirectory()) walk(p); else names.push(path.relative(ROOT, p));
      });
    }(ROOT));
  }
  return names.filter((n) => RULES.skipDirs.indexOf(n.split('/')[0]) === -1 && RULES.textExtensions.indexOf(path.extname(n)) !== -1 && fs.existsSync(path.join(ROOT, n)) && n !== 'config/domain-rules.json');
}

/* ---------- classification ---------- */

const fileRules = RULES.fileRules.map((r) => ({ re: new RegExp(r.match), cls: r.class, note: r.note }));
const lineRules = RULES.lineRules.map((r) => ({ files: new RegExp(r.files), pattern: new RegExp(r.pattern), cls: r.class, note: r.note }));

function classify(file, line) {
  for (const r of fileRules) if (r.re.test(file)) return { cls: r.cls, note: r.note };
  for (const r of lineRules) if (r.files.test(file) && r.pattern.test(line)) return { cls: r.cls, note: r.note };
  return { cls: 'unclassified', note: 'no rule matches' };
}

function scan() {
  const found = [];
  listFiles().forEach((file) => {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (!hostRe.test(text)) { hostRe.lastIndex = 0; return; }
    hostRe.lastIndex = 0;
    text.split('\n').forEach((line, i) => {
      if (!line.match(hostRe)) return;
      hostRe.lastIndex = 0;
      const c = classify(file, line);
      found.push({ file: file, line: i + 1, text: line, cls: c.cls, note: c.note, count: (line.match(hostRe) || []).length });
    });
  });
  return found;
}

function summarize(found, title) {
  const by = {};
  found.forEach((o) => { (by[o.cls] = by[o.cls] || {})[o.file] = ((by[o.cls] || {})[o.file] || 0) + o.count; });
  console.log(title);
  ['rewrite', 'historical', 'protected', 'unclassified'].forEach((c) => {
    const files = by[c] || {};
    const n = Object.keys(files).reduce((s, f) => s + files[f], 0);
    console.log('  ' + c + ': ' + n + ' occurrence(s) in ' + Object.keys(files).length + ' file(s)');
    if (c !== 'rewrite' || !APPLY) Object.keys(files).sort().forEach((f) => { if (c === 'rewrite' && Object.keys(files).length > 12) return; console.log('      ' + f + ' (' + files[f] + ')'); });
  });
  if (!APPLY && by.rewrite && Object.keys(by.rewrite).length > 12) console.log('      (' + Object.keys(by.rewrite).length + ' rewrite files; pass --apply to change them)');
  return by;
}

/* ---------- apply ---------- */

function rewriteLine(line, cls) {
  const urlRe = new RegExp('https?://' + oldHost.replace(/\./g, '\\.'), 'g');
  if (cls === 'protected') return line.replace(urlRe, newBase);               // URL literals only
  return line.replace(new RegExp(oldBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), newBase).replace(hostRe, newHost);
}

function run(cmd, cwd) {
  const r = cp.spawnSync('node', cmd.split(' '), { cwd: cwd || ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-2).join(' ').slice(0, 220) };
}

const GENERATORS = [
  'scripts/generate-benchmark-pages.js', 'scripts/generate-citation.js', 'scripts/generate-playbooks-page.js', 'scripts/generate-sample-report.js', 'scripts/generate-pro.js',
  'scripts/generate-research-index.js', 'scripts/generate-research-002.js', 'scripts/generate-changelog.js', 'scripts/generate-trust.js', 'scripts/generate-plugin.js',
  'scripts/generate-mcp-submission.js', 'scripts/generate-mcp-docs.js', 'lib/mcp-docs.js', 'scripts/site-chrome.js', 'scripts/add-footer-links.js', 'scripts/generate-launch-pages.js'
];
const CHECKS = [
  'scripts/generate-benchmark-pages.js --check', 'scripts/generate-citation.js --check', 'scripts/generate-playbooks-page.js --check', 'scripts/generate-sample-report.js --check', 'scripts/generate-pro.js --check',
  'scripts/generate-research-index.js --check', 'scripts/check-research-index.js', 'scripts/generate-research-002.js --check', 'scripts/generate-changelog.js --check', 'scripts/generate-trust.js --check',
  'scripts/generate-plugin.js --check', 'scripts/generate-mcp-submission.js --check', 'scripts/generate-mcp-docs.js --check', 'lib/mcp-docs.js --check', 'scripts/check-mcp-drift.js',
  'scripts/check-launch-config.js', 'scripts/generate-launch-pages.js --check',
  'scripts/site-chrome.js --check', 'scripts/add-footer-links.js --check', 'scripts/check-pages.js'
];

function main() {
  console.log((APPLY ? 'APPLY' : 'DRY RUN') + ': ' + oldBase + ' -> ' + newBase + (PROTECTED_OK ? ' (including protected files)' : ''));
  const before = scan();
  const by = summarize(before, 'Occurrences of ' + oldHost + ':');
  if (!APPLY) {
    console.log('\nNothing was changed. Run with --apply' + (by.protected ? ' --include-protected' : '') + ' to apply.');
    if (by.unclassified) { console.log('Unclassified occurrences need a rule in config/domain-rules.json first:'); before.filter((o) => o.cls === 'unclassified').forEach((o) => console.log('  ' + o.file + ':' + o.line + ': ' + o.text.trim().slice(0, 120))); process.exit(2); }
    return;
  }

  // 1. rewrite the classified lines
  const touched = {};
  before.forEach((o) => { if (o.cls === 'rewrite' || (o.cls === 'protected' && PROTECTED_OK)) (touched[o.file] = touched[o.file] || []).push(o); });
  Object.keys(touched).forEach((file) => {
    const p = path.join(ROOT, file);
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    touched[file].forEach((o) => { lines[o.line - 1] = rewriteLine(lines[o.line - 1], o.cls); });
    fs.writeFileSync(p, lines.join('\n'), 'utf8');
  });
  // 2. site.config.json (the source for every generator)
  const cfgPath = path.join(ROOT, 'site.config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.baseUrl = newBase; cfg.host = newHost;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  console.log('\nRewrote ' + Object.keys(touched).length + ' file(s) and site.config.json.');

  // 3. regenerate everything that is generated, then check everything
  const failures = [];
  GENERATORS.forEach((g) => { const r = run(g); if (!r.ok) failures.push('generate ' + g + ': ' + r.out); });
  CHECKS.forEach((c) => { const r = run(c); console.log((r.ok ? '  ok    ' : '  FAIL  ') + c); if (!r.ok) failures.push('check ' + c + ': ' + r.out); });
  let jsBad = 0;
  cp.execSync('git ls-files "*.js"', { cwd: ROOT }).toString().split('\n').filter(Boolean).filter((f) => fs.existsSync(path.join(ROOT, f))).forEach((f) => {
    // content/playbooks/*.js are bare-entry source files read by the ingest loader, not modules
    if (/^content\/playbooks\//.test(f)) return;
    const r = cp.spawnSync('node', ['--check', f], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) { jsBad++; failures.push('node --check ' + f); }
  });
  console.log('  ' + (jsBad ? 'FAIL' : 'ok') + '    node --check on every JS file');

  // 4. what is left
  const after = scan();
  summarize(after, '\nOld host still present after the change:');
  const unclassified = after.filter((o) => o.cls === 'unclassified');
  unclassified.forEach((o) => console.log('  unclassified: ' + o.file + ':' + o.line + ': ' + o.text.trim().slice(0, 120)));
  const stillRewrite = after.filter((o) => o.cls === 'rewrite');
  if (stillRewrite.length) failures.push(stillRewrite.length + ' occurrence(s) classed rewrite are still present: ' + stillRewrite.slice(0, 3).map((o) => o.file + ':' + o.line).join(', '));
  if (!PROTECTED_OK && after.some((o) => o.cls === 'protected')) console.log('  protected files were left alone (pass --include-protected to change their URL literals)');
  if (failures.length) { console.error('\n' + failures.length + ' problem(s):\n  ' + failures.join('\n  ')); process.exit(1); }
  if (unclassified.length) process.exit(2);
  console.log('\nDone. Review with git diff, then commit.');
}

main();
