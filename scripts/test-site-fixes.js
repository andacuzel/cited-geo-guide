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
  const bad = pages.filter((f) => /October 2026 rescan|rescan of the same|rescan in October|(?<!\d)2 October 2026/i.test(read(f)));
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
  // Draft legal documents are not kept in this public repository (they live in the owner's gitignored local/ folder).
  const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => e.name === 'node_modules' || e.name === '.git' || e.name === 'local' ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  const draftish = walk('.').filter((f) => /(^|[\\/])(terms|refund|privacy|legal|tos)[-_]?(draft|template)|draft[-_]?(terms|refund|legal)/i.test(f));
  t('no draft legal document is in the repository tree', draftish.length === 0, draftish.join(', '));
  let tracked = null; try { tracked = require('child_process').execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n'); } catch (e) { /* an export without git: the tree check above covers it */ }
  if (tracked) t('git tracks no draft legal document', tracked.filter((f) => /(terms|refund|legal|tos)[-_]?draft|draft[-_]?(terms|refund|legal)/i.test(f)).length === 0);
  const linked = pages.concat(['sitemap.xml', 'llms.txt', 'robots.txt']).filter((f) => /terms-draft|refund-draft/.test(read(f)));
  t('no page, the sitemap, llms.txt or robots.txt mention them', linked.length === 0, linked.join(', '));
  t('the old internal pages app/report.html and app/crawl.html are kept in the repository and kept off the deployed site (.vercelignore), and no page links to them', ['app/report.html', 'app/crawl.html'].every((f) => fs.existsSync(path.join(ROOT, f)) && read('.vercelignore').split('\n').indexOf(f) !== -1) && pages.filter((f) => !/^app\/(crawl|report)\.html$/.test(f) && /["'(]\/?app\/(report|crawl)(\.html)?[?"')]/.test(read(f))).length === 0);
  const pay = read('docs/payments.md');
  t('docs/payments.md lists the settings and the dashboard steps and marks what is unverified', /PRO_WEBHOOK_SECRET/.test(pay) && /PRO_CHECKOUT_URL/.test(pay) && /PRO_PRICE_TEXT/.test(pay) && /Add Endpoint/.test(pay) && /checkout_id=\{CHECKOUT_ID\}/.test(pay) && (pay.match(/UNVERIFIED/g) || []).length >= 4);
}
{
  // Until live testing is switched on, nothing public may promise or describe a citation result or a run Citehound does not make.
  const banned = /citation run|run for you\b|we run (it|the citation)|records when your name|self-serve version|asks a model the questions|and show you when your name/i;
  const files = pages.filter((f) => !/^(local|docs|node_modules)\//.test(f) && !/^(changelog|mcp)\.html$/.test(f)).concat(['llms.txt', 'lib/pro-mail.js', 'app/pro-start.js', 'app/pro-progress.js']);
  const hits = files.filter((f) => banned.test(read(f))).map((f) => f + ': ' + (banned.exec(read(f)) || [])[0]);
  t('public pages, llms.txt, the mail, the start form and the progress script never say "citation run" or "we run it for you", or promise a recorded result', hits.length === 0, hits.join('; '));
  t('/pro and /citation-tracking no longer say the check is "in preparation" (a report can include it)', ['pro.html', 'citation-tracking.html'].every((f) => !/in preparation/i.test(read(f))));
  const needs = ['pro.html', 'citation-tracking.html'].filter((f) => !/can also include a (dated )?citation check/i.test(read(f)) || (f === 'citation-tracking.html' && !/not a ranking|never a ranking/i.test(read(f))) || (f === 'pro.html' && !/dated sample/i.test(read(f))));
  t('/pro and /citation-tracking say a report can include a citation check as a dated sample (and /citation-tracking that it is not a ranking; /pro no longer uses the word)', needs.length === 0, needs.join(', '));
  t('/privacy describes Anthropic for the citation questions and the citation check: what is sent, that nothing personal goes, what is kept, no Gemini and no Perplexity (not switched on)', /Citation questions and citation check \(Pro/.test(read('privacy.html')) && /Anthropic/.test(read('privacy.html')) && /the question text and a language tag, nothing else/.test(read('privacy.html')) && /does not train its models/.test(read('privacy.html')) && !/Perplexity(?!Bot)/.test(read('privacy.html')) && !/Gemini with Google Search|Google&rsquo;s Gemini API, which returns/.test(read('privacy.html')));
}
{
  const c = read('docs/domain-day.md');
  t('docs/domain-day.md has a status section, states the move happened, and marks what it cannot know as unverified', /## Status on 11 October 2026/.test(c) && /getcitehound\.com/.test(c) && (c.match(/unverified/gi) || []).length >= 5);
}
{
  // The waitlist bar: homepage only, sessionStorage in try/catch, no cookie, links to /pro.
  const home = read('index.html');
  t('the homepage has the Pro waitlist bar: the words, a link to /pro, a close button', /id="wlBar"/.test(home) && /Citehound Pro is coming: join the waitlist/.test(home) && /href="\/pro#waitlist"/.test(home) && /class="wl-bar__close"[^>]*aria-label=/.test(home));
  const head = (/<script>if \(window\.IntersectionObserver[\s\S]*?<\/script>/.exec(home) || [''])[0];
  const wl = read('wl-bar.js');
  t('the bar keeps its dismissal in sessionStorage, inside try/catch, in a deferred file and the head script, and sets no cookie', /try \{ sessionStorage\.setItem/.test(wl) && /try \{ if \(sessionStorage\.getItem\('ch-wlbar'\) === '1'\)/.test(head) && !/cookie|localStorage|fetch|XMLHttpRequest|sendBeacon/.test(wl + head) && /wl-bar\.js\?v=\d+" defer/.test(home));
  t('no inline script sits in the body of the homepage ahead of the content (a body script held up the first paint by about 200 ms in Lighthouse)', home.split('<main')[0].split('<body>')[1].indexOf('<script') === -1);
  t('no other page carries the bar', pages.filter((f) => f !== 'index.html' && /wlBar|wl-bar/.test(read(f))).length === 0);
  const css = read('styles.css');
  t('the bar does not animate or use a gradient (reduced motion has nothing to switch off), and is hidden when printed', !/\.wl-bar[^{]*\{[^}]*(animation|transition|gradient)/.test(css) && /\.rp-noprint, \.wl-bar, \.rc-card \{ display: none !important; \}/.test(css));
}
{
  // llms.txt: optional, low-cost, no demonstrated effect on Google, and nothing about whether a system reads it. No claim that it helps citations.
  const claim = /curated map|tells AI systems what (?:the |a )?site|gives AI systems a|improve[sd]? (?:your )?(?:AI )?(?:citations|visibility|ranking)|(?:boost|increase)s? (?:your )?citations|llms\.txt[^.]{0,80}(?:helps|boosts|improves) (?:you|your|AI|models|rank|citation)/i;
  const deployed = pages.filter((f) => !/^(local|docs|node_modules|app\/(report|crawl))/.test(f)).concat(['llms.txt', 'scanner.js', 'lib/scanner.js', 'api/mcp.js', 'content/mcp-copy.json', 'content/mcp-examples.json', 'lib/methodology.js', 'lib/report-render.js']);
  const hits = deployed.filter((f) => claim.test(read(f).replace(/An emerging standard that gives AI systems a curated map of your content\./g, ''))).map((f) => f + ': ' + (claim.exec(read(f).replace(/An emerging standard that gives AI systems a curated map of your content\./g, '')) || [])[0]);
  t('no deployed page, tool text or check text claims that llms.txt helps AI citations or Google results', hits.length === 0, hits.join('; '));
  t('the scanner check says optional, low-cost, no demonstrated effect on Google', /Optional and low-cost to add\. No demonstrated effect on Google/.test(read('lib/scanner.js')));
  const rr = read('lib/report-render.js');
  t('a stored crawl that still carries the retired sentence is shown with the current one (the frozen sample data is not edited)', /RETIRED_WHY/.test(rr) && /curated map/.test(read('content/pro/sample-report.json')));
  const sampleRaw = read('sample-report.html');
  t('the sample report page shows the current llms.txt sentence, not the retired one', !/curated map/.test(sampleRaw));
}

{
  // Bing Webmaster Tools site verification: the homepage's head carries the owner's meta tag, once, and no other page does (the root is what Bing verifies).
  const home = read('index.html');
  t('the homepage head has the Bing Webmaster Tools verification tag, once, exactly as given', (home.match(/<meta name="msvalidate\.01" content="121B0BA2689999A90CF65824DFBD7F38" \/>/g) || []).length === 1 && home.indexOf('msvalidate.01') < home.indexOf('</head>'));
  t('no other page carries it', pages.filter((f) => f !== 'index.html' && /msvalidate/.test(read(f))).length === 0);
}

out('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
