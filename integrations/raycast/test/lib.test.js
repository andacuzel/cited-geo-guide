'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const md = require('../src/lib/markdown.js');

const ROOT = path.join(__dirname, '..');
const SCAN = { domain: 'example.com', score: 62, note: md.NOTE, pillars: [{ name: 'Discoverability', score: 20, max: 40 }, { name: 'Content & trust', score: 30, max: 40 }], crawlerSummary: { open: 1, limited: 0, blocked: 1 }, crawlers: [{ name: 'GPTBot', state: 'blocked' }, { name: 'ClaudeBot', state: 'open' }],
  failed: [{ label: 'llms.txt present', points: 0, max: 4, fix: 'Add an llms.txt at the site root' }] };

test('the scan view: score, pillars, crawlers, the blocked ones, the fixes in order and the readiness sentence', () => {
  const m = md.scanMarkdown(SCAN);
  assert.match(m, /^# example\.com: 62\/100/); assert.match(m, /\| Discoverability \| 20\/40 \|/); assert.match(m, /1 open, 0 limited, 1 blocked/); assert.match(m, /Blocked: GPTBot/); assert.match(m, /1\. \*\*llms\.txt present\*\* \(0 of 4 points\): Add an llms\.txt/); assert.match(m, /does not measure whether any assistant names a brand/);
  assert.match(md.scanMarkdown(Object.assign({}, SCAN, { failed: [] })), /No failed checks/);
});
test('a free key\'s scan says how many findings are hidden and which plans have them', () => {
  const m = md.scanMarkdown(Object.assign({}, SCAN, { truncated: true, hidden_findings: 5, upgrade: { message: 'The full scan detail is available on Pro, Fix and Beyond. See the plans at https://getcitehound.com/pricing.' } }));
  assert.match(m, /5 more findings are not shown\. The full scan detail is available on Pro, Fix and Beyond/);
});
test('the compare view: both scores and the checks that differ', () => {
  const m = md.compareMarkdown({ a: { domain: 'a.com', score: 80 }, b: { domain: 'b.com', score: 55 }, differences: [{ check: 'Meta description', a: { points: 4 }, b: { points: 0 }, max: 4 }] });
  assert.match(m, /^# a\.com 80\/100 and b\.com 55\/100/); assert.match(m, /\| Meta description \| 4\/4 \| 0\/4 \|/); assert.match(md.compareMarkdown({ a: { domain: 'a.com', score: 1 }, b: { domain: 'b.com', score: 1 }, differences: [] }), /No check differs/);
});
test('a generated file: the text for the clipboard, and a note only for a preview', () => {
  assert.deepEqual(md.fileResult({ content: 'User-agent: GPTBot\nAllow: /\n\n' }), { text: 'User-agent: GPTBot\nAllow: /\n', note: null });
  const p = md.fileResult({ content: 'x', preview: true, upgrade: { message: 'The full generated file is available on Pro, Fix and Beyond.' } });
  assert.match(p.note, /^Preview \(the first lines\)\. The full generated file is available on Pro/);
  assert.equal(md.eventTitle({ domain: 'a.com', type: 'score_dropped' }), 'a.com: score dropped');
});
test('the manifest: four commands that have a source file, a required password preference for the key, MIT, an icon that exists, macOS', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.commands.map((c) => c.name), ['scan-domain', 'compare-domains', 'generate-file', 'monitoring-events']);
  pkg.commands.forEach((c) => { assert.ok(fs.existsSync(path.join(ROOT, 'src', c.name + '.tsx')), c.name); assert.ok(c.title && c.description && c.mode, c.name); });
  const pref = pkg.preferences.find((p) => p.name === 'apiKey'); assert.equal(pref.type, 'password'); assert.equal(pref.required, true);
  assert.equal(pkg.license, 'MIT'); assert.ok(fs.existsSync(path.join(ROOT, 'assets', pkg.icon))); assert.deepEqual(pkg.platforms, ['macOS']);
  assert.match(pkg.commands.find((c) => c.name === 'compare-domains').description, /Pro, Fix and Beyond/);
});
test('the commands read the key only from the preference and call only the shared client', () => {
  const src = ['client.ts', '../scan-domain.tsx', '../compare-domains.tsx', '../generate-file.tsx', '../monitoring-events.tsx'].map((f) => fs.readFileSync(path.join(ROOT, 'src/lib', f), 'utf8')).join('\n');
  assert.match(src, /getPreferenceValues/); assert.doesNotMatch(src, /fetch\(|LocalStorage|process\.env|console\./); assert.doesNotMatch(src, /chk_[A-Za-z0-9_-]{20,}/);
  assert.equal(fs.readFileSync(path.join(ROOT, 'src/lib/citehound-core.js'), 'utf8').includes('integrations/shared/citehound-core.js'), true);
});
test('the plain-language errors reach the screen: the commands show the error message of the client', () => {
  ['scan-domain', 'compare-domains', 'monitoring-events'].forEach((n) => assert.match(fs.readFileSync(path.join(ROOT, 'src', n + '.tsx'), 'utf8'), /catch\(\(e: Error\)/));
});
