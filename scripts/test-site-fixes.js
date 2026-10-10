#!/usr/bin/env node
/* =====================================================================
   scripts/test-site-fixes.js: the small fixes and the payment files that no larger test covers.

   /scan redirects with a 301; the About portrait exists and is a JPEG; no public page cites the October 2026 rescan (only the July
   snapshot); the welcome script is small and keeps nothing; the terms and refund drafts exist, are marked as drafts and are kept off the
   deployed site and out of every page, the sitemap and llms.txt; the payment docs exist and say what is unverified.

     node scripts/test-site-fixes.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

function htmlFiles(dir, acc) {
  fs.readdirSync(path.join(ROOT, dir)).forEach((n) => {
    if (/^(node_modules|\.git|local|docs|data|asset|\.claude|assets)$/.test(n)) return;
    const rel = dir ? dir + '/' + n : n;
    if (fs.statSync(path.join(ROOT, rel)).isDirectory()) htmlFiles(rel, acc); else if (/\.html$/.test(n)) acc.push(rel);
  });
  return acc;
}
const pages = htmlFiles('', []);

{
  const v = JSON.parse(read('vercel.json'));
  const r = (v.redirects || []).filter((x) => x.source === '/scan')[0];
  t('/scan redirects to / with a 301 (not a 308: statusCode, not permanent)', r && r.destination === '/' && r.statusCode === 301 && r.permanent === undefined);
  t('the old-host redirect is still there and still leaves /api/mcp alone', (v.redirects || []).some((x) => /api\/mcp/.test(x.source) && x.has && x.has[0].value === 'answerable-app.vercel.app'));
}
{
  const buf = fs.readFileSync(path.join(ROOT, 'assets', 'andac.jpg'));
  t('the About portrait exists, is a JPEG and is small', buf[0] === 0xff && buf[1] === 0xd8 && buf.length > 5000 && buf.length < 400000, buf.length + ' bytes');
  t('the About page points at it, in the picture and in the structured data', /src="\/assets\/andac\.jpg"/.test(read('about.html')) && /assets\/andac\.jpg/.test(read('about.html').split('application/ld+json')[1] || ''));
}
{
  const bad = pages.filter((f) => /October 2026 rescan|rescan of the same|rescan in October|2 October 2026/i.test(read(f)));
  t('no public page cites the October 2026 rescan or a 2 October 2026 run (only the July snapshot)', bad.length === 0, bad.join(', '));
  t('every benchmark page says its figures are one July 2026 snapshot', fs.readdirSync(path.join(ROOT, 'benchmarks')).filter((f) => f !== 'index.html' && /\.html$/.test(f)).every((f) => /one scan of these sites in July 2026/.test(read('benchmarks/' + f))));
  t('the research index and the crawler-access study say the same', !/rescan/i.test(read('content/research-index.json')) && /July 2026 snapshot/.test(read('research/crawler-access-2026.html')));
}
{
  const js = read('app/pro-welcome.js');
  t('the welcome script makes one request, to /api/pro/welcome, keeps nothing and only follows a start path', (js.match(/fetch\(/g) || []).length === 1 && /fetch\('\/api\/pro\/welcome'/.test(js) && !/localStorage|sessionStorage|indexedDB|document\.cookie|sendBeacon|gtag/.test(js) && /\^\\\/pro\\\/start\\\/\[a-f0-9\]\{32\}\$/.test(js));
  t('it takes the checkout id out of the address bar', /history\.replaceState/.test(js));
}
{
  const drafts = ['docs/terms-draft.md', 'docs/refund-draft.md'];
  t('the terms and refund drafts exist and say they are drafts, not legal advice, with decisions in brackets', drafts.every((f) => /DRAFT/.test(read(f)) && /not legal advice/.test(read(f)) && /\[[A-Z][^\]]{8,}/.test(read(f))));
  t('they are kept off the deployed site (.vercelignore)', drafts.every((f) => read('.vercelignore').split('\n').indexOf(f) !== -1));
  const linked = pages.concat(['sitemap.xml', 'llms.txt', 'robots.txt']).filter((f) => /terms-draft|refund-draft/.test(read(f)));
  t('no page, the sitemap, llms.txt or robots.txt mention them', linked.length === 0, linked.join(', '));
  const pay = read('docs/payments.md');
  t('docs/payments.md lists the settings and the dashboard steps and marks what is unverified', /PRO_WEBHOOK_SECRET/.test(pay) && /PRO_CHECKOUT_URL/.test(pay) && /PRO_PRICE_TEXT/.test(pay) && /Add Endpoint/.test(pay) && /checkout_id=\{CHECKOUT_ID\}/.test(pay) && (pay.match(/UNVERIFIED/g) || []).length >= 4);
}
{
  const c = read('docs/domain-day.md');
  t('docs/domain-day.md has a status section, states the move happened, and marks what it cannot know as unverified', /## Status on 11 October 2026/.test(c) && /getcitehound\.com/.test(c) && (c.match(/unverified/gi) || []).length >= 5);
}

out('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
