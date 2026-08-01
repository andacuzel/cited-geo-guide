/* =====================================================================
   /api/crawl-start — page discovery for the full-site crawl engine.

   Input: a domain. Fetches robots.txt (and respects it for every URL
   this endpoint returns), fetches the sitemap (following a
   sitemapindex one level deep), falls back to same-host homepage
   links if there's no usable sitemap, prioritises and caps the list
   at 50 URLs, and creates a job record in Vercel KV. Does not scan
   anything — that's api/crawl-step.js, called repeatedly by the
   client afterward.

   Usage: GET /api/crawl-start?domain=example.com
   Returns: { jobId, domain, pageCount }
   ===================================================================== */

const { checkRateLimit } = require('./_rateLimit');
const { generateJobId, createJob } = require('./_crawlStore');
const scanner = require('../lib/scanner');

var CRAWLER_UA = scanner.CRAWLER_UA;
var MAX_PAGES = 50;
var MAX_SUB_SITEMAPS = 20;
var MAX_CANDIDATE_URLS = 500;

function normalizeDomain(raw) {
  var d = (raw || '').trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)) return null;
  return d;
}

function decodeXmlEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function extractLocs(xml) {
  var out = [];
  var re = /<loc>([\s\S]*?)<\/loc>/gi;
  var m;
  while ((m = re.exec(xml)) !== null) out.push(decodeXmlEntities(m[1].trim()));
  return out;
}

var NON_CONTENT_RE = /\.(jpg|jpeg|png|gif|svg|webp|ico|css|js|json|xml|pdf|zip|mp4|mp3|wav|woff2?|ttf|eot|csv|txt)(\?|$)/i;
var SKIP_PATH_RE = /^\/(wp-admin|wp-json|wp-content|admin|cart|checkout|account|login|logout|signup|api|assets|static|cdn-cgi|_next|fonts|feed)(\/|$)/i;

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return null; }
}

function isContentUrl(url, host) {
  if (hostOf(url) !== host) return false;
  var parsed;
  try { parsed = new URL(url); } catch (e) { return false; }
  if (parsed.search) return false; // query strings are almost always filtered/duplicate views, not distinct content
  var path = parsed.pathname;
  if (NON_CONTENT_RE.test(path)) return false;
  if (SKIP_PATH_RE.test(path)) return false;
  return true;
}

// Follows a sitemapindex one level deep only — sub-sitemaps that are
// themselves indexes are not recursed into again.
async function discoverFromSitemap(sitemapUrls, userAgent) {
  var pageUrls = [];
  var subSitemapsFetched = 0;

  for (var i = 0; i < sitemapUrls.length && pageUrls.length < MAX_CANDIDATE_URLS; i++) {
    var res = await scanner.fetchText(sitemapUrls[i], 8000, 'sitemap', userAgent);
    if (!res.ok || !res.text) continue;

    if (/<sitemapindex/i.test(res.text)) {
      var subSitemaps = extractLocs(res.text);
      for (var j = 0; j < subSitemaps.length && subSitemapsFetched < MAX_SUB_SITEMAPS && pageUrls.length < MAX_CANDIDATE_URLS; j++) {
        var subRes = await scanner.fetchText(subSitemaps[j], 8000, 'sitemap', userAgent);
        subSitemapsFetched++;
        if (subRes.ok && subRes.text && /<urlset/i.test(subRes.text)) {
          pageUrls = pageUrls.concat(extractLocs(subRes.text));
        }
      }
    } else if (/<urlset/i.test(res.text)) {
      pageUrls = pageUrls.concat(extractLocs(res.text));
    }
  }
  return pageUrls;
}

async function discoverFromHomepageLinks(base, userAgent) {
  var res = await scanner.fetchText(base + '/', 12000, 'homepage', userAgent);
  if (!res.ok || !res.text) return [];
  var hrefRe = /<a\b[^>]*href=["']([^"']+)["']/gi;
  var out = [];
  var seen = {};
  var m;
  while ((m = hrefRe.exec(res.text)) !== null) {
    var abs;
    try { abs = new URL(m[1], base).toString().split('#')[0]; } catch (e) { continue; }
    if (seen[abs]) continue;
    seen[abs] = true;
    out.push(abs);
  }
  return out;
}

var PRIORITY_PATTERNS = [
  /^\/pricing\/?$/i,
  /^\/products\/[^/]+\/?$/i,
  /^\/product\/[^/]+\/?$/i,
  /^\/about\/?$/i,
  /^\/contact\/?$/i,
  /^\/docs(\/[^/]+)?\/?$/i,
  /^\/blog(\/[^/]+)?\/?$/i
];

// Homepage first, then priority-pattern matches, then an even spread
// across whatever remains (round-robin by first path segment, so the
// sample isn't 40 blog posts and nothing else), capped at MAX_PAGES.
function prioritizeAndCap(candidateUrls, homepageUrl, robots, host) {
  var seen = {};
  var filtered = [];
  candidateUrls.forEach(function (u) {
    var norm = u.split('#')[0];
    if (seen[norm]) return;
    seen[norm] = true;
    if (norm === homepageUrl) return; // handled separately, always first
    if (!isContentUrl(norm, host)) return;
    var path;
    try { path = new URL(norm).pathname; } catch (e) { return; }
    if (!scanner.isPathAllowed(path, CRAWLER_UA, robots)) return;
    filtered.push(norm);
  });

  var priority = [];
  var rest = [];
  filtered.forEach(function (u) {
    var path;
    try { path = new URL(u).pathname; } catch (e) { path = ''; }
    var isPriority = PRIORITY_PATTERNS.some(function (re) { return re.test(path); });
    (isPriority ? priority : rest).push(u);
  });

  var groups = {};
  var order = [];
  rest.forEach(function (u) {
    var path;
    try { path = new URL(u).pathname; } catch (e) { path = '/'; }
    var seg = path.split('/').filter(Boolean)[0] || '';
    if (!groups[seg]) { groups[seg] = []; order.push(seg); }
    groups[seg].push(u);
  });
  var spread = [];
  var idx = 0;
  while (spread.length < rest.length) {
    var addedAny = false;
    for (var k = 0; k < order.length; k++) {
      var g = groups[order[k]];
      if (idx < g.length) { spread.push(g[idx]); addedAny = true; }
    }
    idx++;
    if (!addedAny) break;
  }

  return [homepageUrl].concat(priority, spread).slice(0, MAX_PAGES);
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  var rl = await checkRateLimit(req);
  if (rl.limited) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    res.status(429).json({
      error: rl.scope === 'hour'
        ? 'You’ve hit the hourly scan limit. Try again in a little while.'
        : 'You’ve hit the daily scan limit. Try again tomorrow.',
      limit: rl.scope
    });
    return;
  }

  var rawDomain = (req.query && req.query.domain) || null;
  if (!rawDomain) {
    try {
      var u = new URL(req.url, 'http://localhost');
      rawDomain = u.searchParams.get('domain');
    } catch (e) { /* fall through */ }
  }
  var domain = normalizeDomain(rawDomain);
  if (!domain) {
    res.status(400).json({ error: 'Enter a valid domain, e.g. example.com' });
    return;
  }

  try {
    var base = 'https://' + domain;
    var host = domain.replace(/^www\./, '');

    var ctx = await scanner.computeSiteContext(base, { userAgent: CRAWLER_UA });
    if (!ctx.ok) {
      console.error('[crawl-start]', domain, 'robots.txt failed —', ctx.kind);
      res.status(502).json({ error: 'Couldn’t reach robots.txt, so a crawl wouldn’t be reliable. Please try again.' });
      return;
    }

    var homepageUrl = base + '/';
    if (!scanner.isPathAllowed('/', CRAWLER_UA, ctx.robots)) {
      res.status(422).json({ error: 'robots.txt disallows crawling this site for our user agent.' });
      return;
    }

    var candidates = [];
    if (ctx.sitemapOk && ctx.sitemapUrls.length > 0) {
      candidates = await discoverFromSitemap(ctx.sitemapUrls, CRAWLER_UA);
    }
    if (candidates.length === 0) {
      candidates = await discoverFromHomepageLinks(base, CRAWLER_UA);
    }

    var pageUrls = prioritizeAndCap(candidates, homepageUrl, ctx.robots, host);

    var jobId = generateJobId();
    var job = {
      id: jobId,
      domain: domain,
      status: 'pending',
      pages: pageUrls.map(function (url) { return { url: url, status: 'pending' }; }),
      pages_done: 0,
      created_at: new Date().toISOString(),
      siteContext: {
        robotsOk: ctx.robotsOk,
        llmsOk: ctx.llmsOk,
        sitemapOk: ctx.sitemapOk,
        botResults: ctx.botResults
      },
      summary: null
    };

    var stored = await createJob(job);
    if (!stored) {
      res.status(503).json({ error: 'Storage is temporarily unavailable. Please try again.' });
      return;
    }

    res.status(200).json({ jobId: jobId, domain: domain, pageCount: job.pages.length });
  } catch (err) {
    console.error('[crawl-start] unhandled error for', domain, '—', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Unexpected server error. Please try again.' });
  }
}

module.exports = handler;
