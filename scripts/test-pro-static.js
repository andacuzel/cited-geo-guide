#!/usr/bin/env node
/* =====================================================================
   scripts/test-pro-static.js: static checks on the Citehound Pro files.

     - no secret-looking value, and no environment value, in any tracked Pro file
     - nothing from local/private/ (folder names, the names inside) in any tracked file
     - the Pro paths are not in sitemap.xml, robots.txt, llms.txt or the MCP registry
     - no analytics or tracking script on a Pro page
     - the job record in lib/pro-store.js has no contact field
     - no log line in the Pro code names a token, an address, a name or an email
     - every Pro route in vercel.json sends noindex and no referrer
     - the function count stays inside the Hobby plan

     node scripts/test-pro-static.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; const fails = [];
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); console.log((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));

const PRO_FILES = ['lib/pro-store.js', 'lib/safe-fetch.js', 'lib/pro-crawler.js', 'lib/pro-estimate.js', 'lib/pro-api.js', 'lib/pro-http.js', 'lib/pro-mail.js', 'lib/pro-orders.js', 'lib/pro-data.js', 'lib/pro-report-page.js', 'lib/report-pro-ui.js',
  'api/pro.js', 'app/pro-start.html', 'app/pro-start.js', 'app/pro-progress.js', 'scripts/pro-issue-token.js', 'scripts/pro-dev-server.js', 'scripts/pro-fake-site.js', 'docs/pro.md'].filter(exists);

const tracked = cp.execFileSync('git', ['ls-files'], { cwd: ROOT }).toString().split('\n').filter(Boolean);
const trackedText = tracked.filter((f) => /\.(js|json|html|md|txt|xml|css)$/.test(f) && !/^package-lock/.test(f));

// ---- secrets ----
const SECRET = [/re_[A-Za-z0-9]{20,}/, /AIza[0-9A-Za-z_-]{30,}/, /sk-[A-Za-z0-9]{20,}/, /Bearer\s+[A-Za-z0-9._-]{24,}/, /AKIA[0-9A-Z]{16}/, /https:\/\/[a-z0-9-]+\.upstash\.io/i, /[A-Za-z0-9]{40,}==?/];
PRO_FILES.concat(['vercel.json']).forEach((f) => {
  const s = read(f);
  const hit = SECRET.map((re) => (s.match(re) || [])[0]).filter(Boolean)[0];
  t('no secret-looking value in ' + f, !hit, hit);
});
t('Pro code reads keys from the environment only', /process\.env\.RESEND_API_KEY|env\.RESEND_API_KEY/.test(read('lib/pro-mail.js')) && !/RESEND_API_KEY\s*=\s*['"]/.test(read('lib/pro-mail.js')));
t('.env files are ignored by git', /^\.env$/m.test(read('.gitignore')) && /^\.env\.local$/m.test(read('.gitignore')));

// ---- local/private ----
{
  const names = exists('local/private') ? fs.readdirSync(path.join(ROOT, 'local', 'private')).filter((n) => !n.startsWith('.')) : [];
  const leaks = [];
  names.forEach((n) => { trackedText.forEach((f) => { if (new RegExp('\\b' + n.replace(/[-]/g, '[- ]?') + '\\b', 'i').test(fs.readFileSync(path.join(ROOT, f), 'utf8'))) leaks.push(n + ' in ' + f); }); });
  t('no private folder name appears in a tracked file (' + names.length + ' folders checked)', leaks.length === 0, leaks.slice(0, 3).join('; '));
  // A line from a private file must not appear in any tracked file.
  const lines = new Set();
  names.forEach((n) => { const dir = path.join(ROOT, 'local', 'private', n); (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((x) => /\.(json|md|txt)$/.test(x) && !/ACCESS/i.test(x)).forEach((x) => { try { fs.readFileSync(path.join(dir, x), 'utf8').split('\n').forEach((l) => { l = l.trim(); if (l.length >= 60 && l.length <= 300) lines.add(l); }); } catch (e) { /* unreadable */ } }); });
  const hits = [];
  if (lines.size) { const all = trackedText.filter((f) => !/^content\/|^data\//.test(f)).map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n'); lines.forEach((l) => { if (all.indexOf(l) !== -1) hits.push(l.slice(0, 40)); }); }
  t('no long line from a private file appears in a tracked file (' + lines.size + ' lines checked)', hits.length === 0, hits.slice(0, 2).join(' | '));
}

// ---- not listed anywhere ----
const PRO_PATH = /\/pro\/start|\/api\/pro|\/r\/[a-f0-9]{16}|pro-start|\/app\/pro/;
['sitemap.xml', 'robots.txt', 'llms.txt'].forEach((f) => t(f + ' does not list a Pro path', !PRO_PATH.test(read(f))));
{
  const mcp = ['api/mcp.js', 'lib/mcp-content.js', 'lib/mcp-docs.js', 'lib/mcp-prompts.js', 'content/mcp-copy.json'].filter(exists).map(read).join('\n');
  t('the MCP server and its docs do not mention the Pro endpoints', !PRO_PATH.test(mcp));
  const nav = ['index.html', 'about.html', 'pro.html', 'privacy.html', 'sitemap.xml'].map(read).join('\n');
  t('no public page links a start link or a report', !/\/pro\/start\/|href="\/r\/[a-f0-9]{16}|\/api\/pro/.test(nav));
}

// ---- no analytics ----
['app/pro-start.html', 'lib/pro-report-page.js', 'lib/report-pro-ui.js', 'app/pro-progress.js', 'app/pro-start.js'].forEach((f) => t('no analytics or tracking code in ' + f, !/gtag|googletagmanager|plausible|segment\.|hotjar|fbq\(|_vercel\/insights|vercel\/analytics|mixpanel|posthog|sendBeacon/i.test(read(f))));
t('the report page makes no request except the email button\'s', (read('lib/report-pro-ui.js').match(/fetch\(/g) || []).length === 1 && /\/api\/pro\/email/.test(read('lib/report-pro-ui.js')));
t('nothing is kept in the browser by the Pro pages', !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(['app/pro-start.js', 'app/pro-progress.js', 'lib/report-pro-ui.js'].map(read).join('')));

// ---- the waitlist, the Pro switch and the pilot ----
{
  const publicPages = ['index.html', 'pro.html', 'citation-tracking.html', 'sample-report.html', 'about.html', 'privacy.html', 'mcp.html', 'llms.txt', 'api/mcp.js', 'content/mcp-copy.json', 'lib/citation-panel.js', 'scripts/generate-pro.js', 'scripts/generate-citation.js'].filter(exists);
  t('no Pro call to action is a mailto (no "Citation run request" link anywhere public)', publicPages.every((f) => !/Citation(%20| )run(%20| )request/i.test(read(f))) && ['index.html', 'pro.html', 'citation-tracking.html', 'sample-report.html'].every((f) => !/mailto:[^"']*[?&](subject|body)=/.test(read(f))));
  const ctaPages = ['index.html', 'pro.html', 'citation-tracking.html', 'sample-report.html'];
  t('every data-pro-cta link points at the waitlist form (#waitlist or /pro#waitlist) and carries its checkout label', ctaPages.every((f) => { const m = read(f).match(/<a [^>]*data-pro-cta[^>]*>/g) || []; return m.length >= 1 && m.every((a) => /href="(\/pro)?#waitlist"/.test(a) && /data-label-checkout="Get Citehound Pro"/.test(a)); }));
  t('every page with a Pro button or price loads pro-cta.js', ctaPages.every((f) => /<script src="(\/)?pro-cta\.js\?v=\d+"/.test(read(f))));
  const pro = read('pro.html');
  t('pro.html: the waitlist form has an email field, an optional name, a honeypot, and an UNCHECKED consent box with the agreed wording', /id="wlEmail"[^>]*type="email"|type="email"[^>]*id="wlEmail"/.test(pro) && /id="wlName"/.test(pro) && /name="company_fax"/.test(pro) && /<input id="wlConsent" name="consent" type="checkbox"(?![^>]*checked)[^>]*>/.test(pro) && /Tell me when Citehound Pro opens/.test(pro));
  t('pro.html: it shows "Early access" where a price can go, and loads the form and switch scripts', /data-pro-price>Early access</.test(pro) && /waitlist\.js\?v=\d+/.test(pro) && /pro-cta\.js\?v=\d+/.test(pro));
  const wl = read('waitlist.js'), cta = read('pro-cta.js'), fb = read('app/pro-feedback.js');
  t('waitlist.js makes one request, to /api/waitlist, and keeps nothing in the browser', (wl.match(/fetch\(/g) || []).length === 1 && /fetch\('\/api\/waitlist'/.test(wl) && !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(wl));
  t('pro-cta.js makes one GET, to /api/waitlist, sends nothing and keeps nothing', (cta.match(/fetch\(/g) || []).length === 1 && /fetch\('\/api\/waitlist', \{ headers/.test(cta) && !/method:|body:/.test(cta) && !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(cta));
  t('pro-feedback.js makes one request, to /api/pro/feedback, and keeps nothing in the browser', (fb.match(/fetch\(/g) || []).length === 1 && /fetch\('\/api\/pro\/feedback'/.test(fb) && !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(fb));
  ['waitlist.js', 'pro-cta.js', 'app/pro-feedback.js', 'lib/waitlist-mail.js'].forEach((f) => t('no analytics or tracking code in ' + f, !/gtag|googletagmanager|plausible|segment\.|hotjar|fbq\(|_vercel\/insights|vercel\/analytics|mixpanel|posthog|sendBeacon/i.test(read(f))));
  t('the waitlist never reaches the sitemap, robots.txt, llms.txt or the MCP server by its removal path', !/waitlist\/remove|api\/waitlist/.test(['sitemap.xml', 'robots.txt', 'llms.txt', 'api/mcp.js', 'lib/mcp-content.js'].filter(exists).map(read).join('\n')));
  t('the public sample report has no feedback form (only a live report has one)', !/id="fbForm"/.test(read('sample-report.html')));
  t('privacy.html describes the waitlist: what is stored, 12 months, the removal link and Resend', /The Pro waitlist/.test(read('privacy.html')) && /12 months/.test(read('privacy.html')) && /Remove me from the list/.test(read('privacy.html')) && /Resend delivers two kinds of message/.test(read('privacy.html')));
  t('the Pro CSS version is the same everywhere it is written', (() => { const v = require('../lib/pro-report-page.js').CSS_VERSION; return ['index.html', 'pro.html', 'privacy.html', 'sample-report.html', 'app/pro-start.html'].every((f) => read(f).indexOf('styles.css?v=' + v) !== -1); })());
}

// ---- the job record ----
{
  const s = read('lib/pro-store.js');
  const body = s.slice(s.indexOf('async function createJob'), s.indexOf('async function setJob'));
  t('createJob writes no contact field', !/contact|email|name:|mail/i.test(body.replace(/domain: fields\.domain/, '')), body.match(/contact|email|mail/i));
  const setJob = read('lib/pro-api.js');
  t('the API never passes contact data into a job', !/setJob\([^)]*(email|contact|name)/i.test(setJob) && !/createJob\(\{[^}]*(email|contact)/i.test(setJob));
}

// ---- logging ----
{
  const bad = [];
  PRO_FILES.filter((f) => /^(lib|api)\/.*\.js$/.test(f)).forEach((f) => {
    read(f).split('\n').forEach((line, i) => {
      if (/console\.(log|error|warn|info)\(/.test(line) && /token|email|contact|name\b|req\.|headers|body|address|ip\b|b\.|ord\.|order\b/i.test(line.replace(/\[pro[^\]]*\]/g, '').replace(/e\.name/g, '').replace(/ProConfigError/g, ''))) bad.push(f + ':' + (i + 1) + ' ' + line.trim().slice(0, 90));
    });
  });
  t('no log line in the Pro code names a token, address, name, email or request', bad.length === 0, bad.join(' | '));
}

// ---- routes and headers ----
{
  const v = JSON.parse(read('vercel.json'));
  const need = (src) => { const h = (v.headers || []).filter((x) => x.source === src)[0]; return h && h.headers.some((x) => x.key === 'X-Robots-Tag' && /noindex/.test(x.value)) && h.headers.some((x) => x.key === 'Referrer-Policy' && x.value === 'no-referrer'); };
  ['/r/(.*)', '/pro/start/(.*)', '/waitlist/(.*)', '/app/pro-start(.*)', '/api/pro(.*)'].forEach((src) => t('vercel.json: ' + src + ' sends noindex and no referrer', !!need(src)));
  t('vercel.json: the single Pro function has a duration inside the plan', v.functions['api/pro.js'] && v.functions['api/pro.js'].maxDuration <= 60);
  t('vercel.json: the report, the start page and the API are rewritten', ['/pro/start/:token', '/api/pro/:action(start|order|step|status|email|feedback)', '/api/waitlist', '/waitlist/remove/:token', '/r/:id([0-9a-f]{32})'].every((src) => v.rewrites.some((r) => r.source === src)));
  t('vercel.json: the function bundles the start page file (includeFiles), so it is never missing at runtime', v.functions['api/pro.js'].includeFiles === 'app/pro-start.html');
  const tokenInAddress = /pro-start\?t=|searchParams\.get\('t'\)|[?&]token=/;
  t('no Pro page or script takes a token in a query string (no ?t=, no ?token=) and the function never redirects to one', ['lib/pro-api.js', 'app/pro-start.js', 'app/pro-progress.js', 'lib/report-pro-ui.js', 'lib/pro-report-page.js', 'app/pro-start.html'].every((f) => !tokenInAddress.test(read(f).replace(/\/api\/pro\?a=startpage&token=:token/g, ''))));
  const fns = fs.readdirSync(path.join(ROOT, 'api')).filter((f) => /\.js$/.test(f) && !f.startsWith('_'));
  t('the function count stays within the Hobby plan (' + fns.length + ' of 12)', fns.length <= 12, fns.join(','));
  ['/pro/start/x', '/r/x'].forEach(() => 0);
}
// ---- everything api/pro.js needs is named in a literal require, so Vercel packages it ----
{
  const seen = new Set(); const bad = []; const missing = [];
  (function walk(file) {
    if (seen.has(file)) return; seen.add(file);
    const src = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
    const re = /\brequire\(([^)]*)\)/g; let m;
    while ((m = re.exec(src))) {
      const arg = m[1].trim();
      if (!/^'[^']+'$|^"[^"]+"$/.test(arg)) { bad.push(file + ': require(' + arg + ')'); continue; }
      const name = arg.slice(1, -1);
      if (name[0] !== '.') continue; // a package or a built-in
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), name));
      const target = [base, base + '.js', base + '/index.js'].filter((c) => exists(c) && fs.statSync(path.join(ROOT, c)).isFile())[0];
      if (!target) missing.push(file + ' -> ' + name); else walk(target);
    }
  }('api/pro.js'));
  t('every require reachable from api/pro.js is a literal string (' + seen.size + ' files), so the bundler can see it', bad.length === 0, bad.join('; '));
  t('every file it requires exists', missing.length === 0, missing.join('; '));
  t('the report renderer and its four libraries are among them', ['lib/report-render.js', 'lib/icons.js', 'lib/report-facts.js', 'lib/summary.js', 'lib/citation-panel.js', 'lib/schema.js', 'lib/scanner.js', 'lib/pro-estimate.js'].every((f) => seen.has(f)), Array.from(seen).join(','));
}

// ---- pages ----
{
  const s = read('app/pro-start.html');
  t('the start page is noindex and sends no referrer', /name="robots" content="noindex, nofollow, noarchive"/.test(s) && /name="referrer" content="no-referrer"/.test(s));
  t('the start page loads only same-origin scripts', !/<script[^>]+src="https?:/.test(s));
  t('the start form asks for exactly the five things, nothing else', ['psSite', 'psName', 'psEmail', 'psConsent'].every((id) => s.indexOf('id="' + id + '"') !== -1) && (s.match(/<input /g) || []).length === 4);
  t('the consent line is the agreed wording', s.indexOf('Used only to deliver your report and for support') !== -1);
  t('the CSS version on the start page matches the report page', s.indexOf('styles.css?v=' + require('../lib/pro-report-page.js').CSS_VERSION) !== -1);
}

console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { console.error('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
