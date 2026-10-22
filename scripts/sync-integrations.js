#!/usr/bin/env node
/* Copies integrations/shared/citehound-core.js into every integration folder that lists it in integrations/COPIES.json (each folder can then be published alone).
   node scripts/sync-integrations.js          write the copies
   node scripts/sync-integrations.js --check  exit 1 if a copy differs from the source */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'integrations/shared/citehound-core.js'), 'utf8');
const list = fs.existsSync(path.join(ROOT, 'integrations/COPIES.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'integrations/COPIES.json'), 'utf8')) : [];
const bad = [];
const Plans = require('../lib/plans.js');
const P = Plans.PLANS;
const block = () => [
  '<!-- PLANS:START -->',
  '- **Free:** ' + P.free.hour + ' requests an hour and ' + P.free.scansDay + ' scans a day. The scan shows the score, the pillars, the crawlers and the first 3 findings; generated files are a preview; the schema generator gives the organization type. No compare, monitoring, fix list or export.',
  '- **Pro:** ' + P.pro.hour + ' requests an hour. The full scan detail, compare, full generated files, every schema type, and monitoring (' + P.pro.watch + ' watched domains re-scanned about every ' + P.pro.intervalDays + ' days, ' + P.pro.retentionDays + ' days of history, events, alerts and webhooks).',
  '- **Fix:** ' + P.fix.hour + ' requests an hour. Everything in Pro, plus the prioritized fix list with files to paste and the re-check.',
  '- **Beyond:** ' + P.beyond.hour + ' requests an hour. Everything in Fix, plus the export, ' + P.beyond.watch + ' watched domains re-checked about every ' + P.beyond.intervalDays + ' days, and ' + P.beyond.retentionDays + ' days of history.',
  '',
  'A key gets its plan from us. When a plan does not have something, the answer names the plans that do and links ' + Plans.PRICING_URL + '. Applying changes where you give us access (Fix), and researched questions, edited pieces and the monthly re-measurement (Beyond), are done by hand and are not part of the API.',
  '<!-- PLANS:END -->'
].join('\n');
const readmes = fs.existsSync(path.join(ROOT, 'integrations')) ? fs.readdirSync(path.join(ROOT, 'integrations')).filter((n) => n !== 'shared' && fs.existsSync(path.join(ROOT, 'integrations', n, 'README.md'))).map((n) => 'integrations/' + n + '/README.md') : [];
readmes.forEach((r) => {
  const f = path.join(ROOT, r), t = fs.readFileSync(f, 'utf8'), re = /<!-- PLANS:START -->[\s\S]*?<!-- PLANS:END -->/;
  if (!re.test(t)) { bad.push(r + ' (no PLANS markers)'); return; }
  const n = t.replace(re, block());
  if (process.argv.indexOf('--check') !== -1) { if (n !== t) bad.push(r); } else if (n !== t) fs.writeFileSync(f, n, 'utf8');
});
list.forEach((dest) => {
  const f = path.join(ROOT, dest);
  if (process.argv.indexOf('--check') !== -1) { if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== src) bad.push(dest); }
  else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, src, 'utf8'); }
});
if (process.argv.indexOf('--check') !== -1) { if (bad.length) { bad.forEach((b) => console.error('FAIL: ' + b + ' is out of date; run node scripts/sync-integrations.js')); process.exit(1); } console.log('OK: ' + list.length + ' copies of citehound-core.js and ' + readmes.length + ' plan blocks match their sources'); }
else console.log('copied to ' + list.length + ' places');
