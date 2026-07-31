/* =====================================================================
   Edge Middleware — AI crawler visit counting.

   Runs on (almost) every request. If the User-Agent matches one of the
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

export default function middleware(request, context) {
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
