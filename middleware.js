/* =====================================================================
   Edge Middleware: (1) keeps the repository's own files off the public site, (2) AI crawler visit counting.

   (1) Vercel serves every file in the project root as a static file, and a static file wins over a vercel.json rewrite.
   The repository is public on GitHub, but its notes, scripts, source and config are not part of the site, so a
   request for one of them gets the same 404 page as any address that does not exist (an outsider cannot tell a
   hidden file from a missing one). The list is in BLOCKED_DIRS / BLOCKED_FILES below. The few files a page loads
   itself are named in OPEN_FILES; scripts/test-static-exposure.js fails if a page references a blocked file or if
   a required one is not blocked. Things nothing in a function reads are also in .vercelignore.

   (2) Runs on (almost) every request. If the User-Agent matches one of the
   ten AI crawlers /api/scan already tracks, plus Googlebot as a
   baseline for comparison, increments two aggregate counters in
   Vercel KV: a per-crawler-per-day total, and a combined path-
   frequency count. Nothing else is recorded, and nothing about
   requests that don't match a known crawler UA is touched at all —
   no IPs, no cookies, no per-visitor anything.

   Runs on the Edge runtime, so this can't require() the Node-only
   api/_kv.js helper — it keeps its own small copy of the same
   fetch-to-KV pipeline call.

   Fails silently: any missing config, timeout or KV error just means
   the counters don't increment. The request always continues to the
   actual page either way — logging must never be able to break the
   site. The increment itself runs via waitUntil so it can never add
   latency to the response.
   ===================================================================== */

export const config = {
  matcher: ['/((?!api/).*)']
};


/* ---------- repository files that are not part of the site ---------- */

var BLOCKED_DIRS = ['docs', 'scripts', 'local', 'config', 'domains', 'supabase', 'plugin', 'content', 'data', 'lib', 'node_modules', 'asset'];
var BLOCKED_FILES = ['claude.md', 'readme.md', 'package.json', 'package-lock.json', 'vercel.json', 'site.config.json', 'middleware.js'];
// The only files under a blocked directory that the site serves on purpose.
var OPEN_FILES = [
  'lib/playbooks.js', 'lib/schema.js', 'lib/report-pro-ui.js', 'lib/crawlers.js',
  'data/benchmarks.json', 'data/crm-summary.json', 'data/cybersecurity-summary.json', 'data/devtools-summary.json',
  'data/dtc-brands-summary.json', 'data/consumer-apps-summary.json', 'data/hospitality-summary.json'
];

function isBlocked(rawPath) {
  var p = String(rawPath || '');
  try { p = decodeURIComponent(p); } catch (e) { return true; }
  p = p.toLowerCase().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '').replace(/\/$/, '');
  if (p === '') return false;
  var parts = p.split('/');
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === '..') return true;
    if (parts[i][0] === '.' && !(i === 0 && parts[0] === '.well-known')) return true;   // .git, .env, .claude, .vercelignore ...
  }
  if (BLOCKED_FILES.indexOf(p) !== -1) return true;
  if (OPEN_FILES.indexOf(p) !== -1) return false;
  for (var j = 0; j < BLOCKED_DIRS.length; j++) {
    if (p === BLOCKED_DIRS[j] || p.indexOf(BLOCKED_DIRS[j] + '/') === 0) return true;
  }
  return false;
}

// The same 404 page as an address that does not exist (404.html is served as a static file and is not blocked).
async function notFound(request) {
  var headers = { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Cache-Control': 'public, max-age=0, must-revalidate' };
  try {
    var r = await fetch(new URL('/404.html', request.url));
    if (r.ok) return new Response(await r.text(), { status: 404, headers: headers });
  } catch (e) { /* fall through to the plain page */ }
  return new Response('<!doctype html><title>Not found</title><p>Not found.</p>', { status: 404, headers: headers });
}

var CRAWLERS = [
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'anthropic-ai',
  'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'CCBot', 'Bytespider',
  'Googlebot'
];

function matchCrawler(ua) {
  for (var i = 0; i < CRAWLERS.length; i++) {
    if (ua.indexOf(CRAWLERS[i]) !== -1) return CRAWLERS[i];
  }
  return null;
}

async function kvPipeline(commands) {
  var url = process.env.KV_REST_API_URL;
  var token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    var res = await fetch(url + '/pipeline', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(commands)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function logCrawlerVisit(name, path) {
  try {
    var date = new Date().toISOString().slice(0, 10);
    await kvPipeline([
      ['INCR', 'crawler:count:' + name + ':' + date],
      ['HINCRBY', 'crawler:paths:_all', path, 1]
    ]);
  } catch (e) { /* never throw — logging must not break the site */ }
}

export default async function middleware(request, context) {
  try {
    if (isBlocked(new URL(request.url).pathname)) return await notFound(request);
  } catch (e) { /* a parsing problem must not break the site */ }
  try {
    var ua = request.headers.get('user-agent') || '';
    var name = matchCrawler(ua);
    if (name) {
      var path = new URL(request.url).pathname;
      var task = logCrawlerVisit(name, path);
      if (context && typeof context.waitUntil === 'function') {
        context.waitUntil(task);
      }
    }
  } catch (e) { /* never break the request */ }
}
