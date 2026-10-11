#!/usr/bin/env node
/* =====================================================================
   scripts/test-static-exposure.js: the repository's own files must not be served as part of the site.

   middleware.js answers 404 for notes, scripts, source, config and dotfiles (isBlocked). This test loads that function and
   checks that (1) everything the brief names is blocked, (2) no page, stylesheet or script references a blocked file
   (so the block cannot break the site), (3) every blocked directory that a function reads is NOT in .vercelignore and
   every one that is in .vercelignore is read by no function, (4) no PDF or other report file is tracked anywhere that is
   served, and (5) the middleware still counts crawlers and lets normal pages through.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } }

const src = fs.readFileSync(path.join(ROOT, 'middleware.js'), 'utf8');
const m = {};
new Function('m', src.replace('export const config', 'const config').replace('export default async function', 'async function') + ';m.isBlocked=isBlocked;m.OPEN=OPEN_FILES;m.middleware=middleware;')(m);
const blocked = m.isBlocked;

// 1. what must be blocked
['/CLAUDE.md', '/README.md', '/docs/pro.md', '/docs/env.md', '/docs/launch-checklist.md', '/scripts/run-gates.js', '/scripts/e2e-live.js', '/vercel.json', '/package.json', '/package-lock.json',
  '/local/anything', '/local/launch-report/stats.json', '/.env', '/.env.local', '/.git/config', '/.git/HEAD', '/.vercelignore', '/.gitignore', '/lib/pro-api.js', '/lib/waitlist.js', '/lib/citation-providers.js',
  '/api/../lib/x.js', '/content/tools.json', '/config/domain-rules.json', '/site.config.json', '/middleware.js', '/supabase/schema.sql', '/plugin/README.md', '/domains/crm.txt', '/data/crm-raw.json', '/node_modules/@upstash/redis/package.json',
  '/DOCS/pro.md', '//docs/pro.md', '/docs%2Fpro.md', '/%2e%2egit/config', '/docs/', '/scripts', '/.claude/settings.json', '/asset/x.pdf'
].forEach((p) => ok(blocked(p), 'should be blocked: ' + p));

// what must stay open
['/', '/pro', '/privacy', '/methodology', '/research/state-of-ai-readiness', '/beyond-technical', '/sitemap.xml', '/robots.txt', '/llms.txt', '/styles.css', '/app.js', '/scanner.js', '/nav.js', '/app/pro-start.js',
  '/app/pro-progress.js', '/lib/playbooks.js', '/lib/schema.js', '/lib/report-pro-ui.js', '/lib/crawlers.js', '/assets/brand/mark.svg', '/.well-known/security.txt', '/r/abcdef/', '/tools/schema', '/data/benchmarks.json', '/data/crm-summary.json', '/api/pro/start'
].forEach((p) => ok(!blocked(p), 'should stay open: ' + p));

// 2. nothing the site loads is blocked: every src/href in a tracked page, and every quoted site path in the browser scripts
const tracked = cp.execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', maxBuffer: 1e8 }).split('\n').filter(Boolean);
const undeployed = fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && l[0] !== '#');
const pages = tracked.filter((f) => /\.html$/.test(f) && !/^(docs|local|scripts|plugin)\//.test(f) && undeployed.indexOf(f) === -1);
let refs = 0;
pages.forEach((f) => {
  const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const re = /(?:src|href|action)=["']([^"'#?]+)/g; let mm;
  while ((mm = re.exec(html))) {
    let u = mm[1]; if (/^(https?:|mailto:|tel:|data:|javascript:|\/\/)/i.test(u)) continue;
    if (u[0] !== '/') u = '/' + path.posix.normalize(path.posix.join(path.posix.dirname('/' + f), u)).replace(/^\//, '');
    refs++;
    ok(!blocked(u), f + ' references a blocked path: ' + u);
  }
});
ok(refs > 200, 'the reference scan looked at ' + refs + ' references');
// pages that the functions write (the report page, the start page, the removal pages)
tracked.filter((f) => /^(lib|api)\/.*\.js$/.test(f)).forEach((f) => {
  const js = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const re = /(?:src|href)=\\?["'](\/[^"'?#\s\\]+)/g; let mm;
  while ((mm = re.exec(js))) ok(!blocked(mm[1]), f + ' writes a reference to a blocked path: ' + mm[1]);
});
// browser scripts that fetch a site path
['app.js', 'scanner.js', 'nav.js', 'research.js', 'waitlist.js', 'pro-cta.js', 'compare.js', 'mcp-demo.js', 'teaser-scene.js', 'citation-matrix.js'].concat(tracked.filter((f) => /^(app|tools)\/[^/]+\.js$/.test(f))).forEach((f) => {
  if (!fs.existsSync(path.join(ROOT, f))) return;
  const js = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const re = /(?:fetch|import)\(\s*['"`](\/[^'"`?${]+)/g; let mm;
  while ((mm = re.exec(js))) ok(!blocked(mm[1]), f + ' fetches a blocked path: ' + mm[1]);
});

// 3. .vercelignore against what functions read
const ign = fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && l[0] !== '#');
const fnFiles = tracked.filter((f) => /^(api|lib)\/.*\.js$/.test(f)).concat(['scripts/site-chrome.js', 'scripts/generate-mcp-page.js']);
const fnSrc = fnFiles.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
ign.forEach((entry) => {
  const name = entry.replace(/\/$/, '');
  if (/^app\//.test(name)) return;
  const re = new RegExp('(require|readFileSync|readdirSync|join|resolve|existsSync)\\([^)]*[\'"/]' + name.replace(/[.]/g, '\\.') + '[/\'"]');
  ok(!re.test(fnSrc), '.vercelignore lists ' + entry + ' but a function reads it');
});
['docs/', 'CLAUDE.md', 'local/'].forEach((e) => ok(ign.indexOf(e) !== -1, '.vercelignore lists ' + e));
// vercel.json includeFiles must not name an ignored path
const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
JSON.stringify(vj.functions || {}).split(/[{},"]/).forEach((t) => { if (t) ign.forEach((e) => ok(t.indexOf(e) !== 0 || e.indexOf('app/') === 0, 'includeFiles names an ignored path: ' + t)); });

// 4. no report PDF anywhere in the repository (the State of AI Readiness PDF lives in the database, not in files)
const pdfs = tracked.filter((f) => /\.(pdf|docx?|pptx?|xlsx?|zip)$/i.test(f));
ok(pdfs.length === 0, 'tracked document files: ' + pdfs.join(', '));
const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
ok(/^\*\.pdf\s*$/m.test(gi), '.gitignore must list *.pdf so a report cannot be committed by accident');

// 5. the middleware lets a normal page through (undefined result) and answers a blocked one with a 404
(async function () {
  const realFetch = global.fetch;
  global.fetch = async (u) => ({ ok: true, text: async () => '<!doctype html><title>404</title>' });
  const open = await m.middleware({ url: 'https://example.test/pro', headers: { get: () => 'Mozilla/5.0' } }, {});
  ok(open === undefined, 'a normal page passes through');
  const closed = await m.middleware({ url: 'https://example.test/docs/pro.md', headers: { get: () => 'Mozilla/5.0' } }, {});
  ok(closed && closed.status === 404, 'a blocked path answers 404');
  ok(closed && /noindex/.test(closed.headers.get('x-robots-tag') || ''), 'the 404 is noindex');
  global.fetch = async () => { throw new Error('offline'); };
  const closed2 = await m.middleware({ url: 'https://example.test/CLAUDE.md', headers: { get: () => '' } }, {});
  ok(closed2 && closed2.status === 404, 'a blocked path answers 404 even if the 404 page cannot be fetched');
  global.fetch = realFetch;
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}());
