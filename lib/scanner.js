/* =====================================================================
   lib/scanner.js — shared AI-visibility scanning logic.

   Extracted from api/scan.js so the same fetch/parse/score code can
   back both the single-page free scan and the multi-page crawl engine
   (api/crawl-start.js, api/crawl-step.js), without either one having
   its own copy to drift out of sync.

   The primary export is scanPage(url, opts): fetches one page and
   returns its score and checks. Called with no siteContext, it is
   fully self-contained — it fetches robots.txt and llms.txt itself,
   exactly like the original single-page /api/scan flow (same parallel
   fetch order, same error branching). Called with a precomputed
   siteContext (from computeSiteContext, below), it skips that and
   only fetches the one page — the fast path the crawl engine uses so
   it isn't re-fetching robots.txt for every page on a site.
   ===================================================================== */

const BOTS = [
  { ua: 'GPTBot',          desc: 'OpenAI training' },
  { ua: 'ChatGPT-User',    desc: 'ChatGPT live browsing' },
  { ua: 'OAI-SearchBot',   desc: 'ChatGPT search index' },
  { ua: 'ClaudeBot',       desc: 'Anthropic crawler' },
  { ua: 'anthropic-ai',    desc: 'Anthropic (legacy UA)' },
  { ua: 'PerplexityBot',   desc: 'Perplexity index' },
  { ua: 'Perplexity-User', desc: 'Perplexity live access' },
  { ua: 'Google-Extended', desc: 'Gemini training access' },
  { ua: 'CCBot',           desc: 'Common Crawl' },
  { ua: 'Bytespider',      desc: 'ByteDance crawler' }
];

// The free single-page scan identifies as a normal browser — bot UAs
// get blocked by WAFs and the scan silently fails. Do not change this
// default; see CLAUDE.md. The crawl engine passes its own honest UA
// explicitly instead of relying on this default.
var DEFAULT_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// The crawl engine fetches many pages from the same site in one run —
// real crawling behavior, not a one-off check — so it identifies
// honestly instead of spoofing a browser. We publish research about
// crawler etiquette; ours has to be defensible on the same terms.
var CRAWLER_UA = 'CitehoundBot/1.1 (formerly AnswerableBot; +https://getcitehound.com/methodology)';

// Reads at most maxBytes of a response body. Used where the file is
// arbitrary third-party content that could be enormous (llms.txt).
async function readCapped(res, maxBytes) {
  var reader = res.body.getReader();
  var chunks = [];
  var total = 0;
  var truncated = false;
  while (true) {
    var r = await reader.read();
    if (r.done) break;
    total += r.value.length;
    if (total > maxBytes) {
      chunks.push(r.value.subarray(0, r.value.length - (total - maxBytes)));
      total = maxBytes;
      truncated = true;
      try { await reader.cancel(); } catch (e) { /* already closing */ }
      break;
    }
    chunks.push(r.value);
  }
  return {
    text: Buffer.concat(chunks.map(function (c) { return Buffer.from(c); })).toString('utf8'),
    bytes: total,
    truncated: truncated
  };
}

// opts.maxBytes (optional) caps how much of the body is read; without it
// the body is read whole, exactly as before. The extra fields on the
// result (contentType, finalUrl, headers, truncated, bytes) are
// additive: existing callers ignore them.
async function fetchText(url, timeoutMs, label, userAgent, opts) {
  var ctrl = new AbortController();
  var t = setTimeout(function () { ctrl.abort(); }, timeoutMs || 8000);
  try {
    var res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': userAgent || DEFAULT_BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      redirect: 'follow'
    });
    clearTimeout(t);
    if (res.status === 404) return { ok: false, notFound: true, status: 404 };
    if (!res.ok) {
      console.error('[scanner] non-2xx from', label, url, '→ status', res.status);
      return { ok: false, status: res.status };
    }
    var headers = {};
    res.headers.forEach(function (v, k) { headers[k.toLowerCase()] = v; });
    var meta = {
      contentType: res.headers.get('content-type') || '',
      finalUrl: res.url || url,
      headers: headers
    };
    if (opts && opts.maxBytes) {
      var t2 = setTimeout(function () { ctrl.abort(); }, timeoutMs || 8000);
      try {
        var capped = await readCapped(res, opts.maxBytes);
        return { ok: true, text: capped.text, status: res.status, bytes: capped.bytes, truncated: capped.truncated,
                 contentType: meta.contentType, finalUrl: meta.finalUrl, headers: meta.headers };
      } finally { clearTimeout(t2); }
    }
    var text = await res.text();
    return { ok: true, text: text, status: res.status,
             contentType: meta.contentType, finalUrl: meta.finalUrl, headers: meta.headers };
  } catch (err) {
    clearTimeout(t);
    var kind = err.name === 'AbortError' ? 'timeout'
      : (err.cause && err.cause.code === 'ENOTFOUND') ? 'dns'
      : (err.cause && err.cause.code === 'ECONNREFUSED') ? 'refused'
      : 'network';
    console.error('[scanner] fetch failed for', label, url, '→', kind, '—', err.message);
    return { ok: false, error: err.message || 'fetch failed', kind: kind };
  }
}

// The one rule for "this URL really serves a text file": a 2xx, not
// empty, and not an HTML page (sites often answer a missing file with
// their homepage). The scan's "llms.txt present" check and the llms.txt
// checker tool both use it, so they can never disagree.
function isUsableTextFile(res) {
  return !!(res && res.ok && res.text && res.text.trim() && !/^\s*</.test(res.text));
}

function normalizeDomain(raw) {
  var d = (typeof raw === 'string' ? raw : '').trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)) return null;
  return d;
}

/* ---------------- robots.txt parsing ---------------- */

function parseRobots(text) {
  var groups = [];
  var sitemaps = [];
  var current = null;
  var lastWasAgent = false;

  text.split(/\r?\n/).forEach(function (rawLine) {
    var line = rawLine.replace(/#.*$/, '').trim();
    if (!line) return;
    var m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) return;
    var key = m[1].toLowerCase();
    var val = m[2].trim();
    if (key === 'sitemap') { if (val) sitemaps.push(val); return; }
    if (key === 'user-agent') {
      if (!lastWasAgent || !current) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(val.toLowerCase());
      lastWasAgent = true;
      return;
    }
    lastWasAgent = false;
    if ((key === 'allow' || key === 'disallow') && current) {
      current.rules.push({ type: key, path: val, line: rawLine.trim() });
    }
  });
  return { groups: groups, sitemaps: sitemaps };
}

// Coarse per-bot access check used for scoring: is this AI crawler
// generally blocked at the root? (Not a full path evaluation — that's
// isPathAllowed, below, used by the crawl engine for its own
// compliance.)
function botStatus(bot, robots) {
  var name = bot.toLowerCase();
  var group = null, inherited = false;

  for (var i = 0; i < robots.groups.length; i++) {
    var g = robots.groups[i];
    var hit = g.agents.some(function (a) {
      return a !== '*' && (name === a || name.indexOf(a) !== -1 || a.indexOf(name) !== -1);
    });
    if (hit) { group = g; break; }
  }
  if (!group) {
    group = robots.groups.find(function (g) { return g.agents.indexOf('*') !== -1; }) || null;
    inherited = true;
  }
  if (!group) return { state: 'open', rule: 'no rule — default access' };

  var dis = group.rules.filter(function (r) { return r.type === 'disallow' && r.path; });
  var allowRoot = group.rules.some(function (r) { return r.type === 'allow' && (r.path === '/' || r.path === ''); });
  var blockRoot = dis.find(function (r) { return r.path === '/'; });
  var src = inherited ? 'via User-agent: *' : 'bot-specific rule';

  if (blockRoot && !allowRoot) return { state: 'block', rule: blockRoot.line + ' · ' + src };
  if (dis.length > 0) {
    return { state: 'partial', rule: dis[0].line + (dis.length > 1 ? ' (+' + (dis.length - 1) + ' more)' : '') + ' · ' + src };
  }
  return { state: 'open', rule: 'no blocks · ' + src };
}

// Full path-level robots.txt evaluation — used by the crawl engine to
// decide whether it may fetch a given URL at all. Standard "longest
// matching rule wins" algorithm, with '*' wildcards and a trailing
// '$' end-anchor supported (the common extensions beyond the base
// spec that real robots.txt files rely on).
function robotsPatternToRegex(pattern) {
  var endAnchor = pattern.charAt(pattern.length - 1) === '$';
  var body = endAnchor ? pattern.slice(0, -1) : pattern;
  var escaped = body.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + (endAnchor ? '$' : ''));
}

function matchGroup(userAgent, robots) {
  var name = userAgent.toLowerCase();
  var group = robots.groups.find(function (g) {
    return g.agents.some(function (a) { return a !== '*' && (name.indexOf(a) !== -1 || a.indexOf(name) !== -1); });
  });
  if (!group) group = robots.groups.find(function (g) { return g.agents.indexOf('*') !== -1; }) || null;
  return group;
}

function isPathAllowed(path, userAgent, robots) {
  var group = matchGroup(userAgent, robots);
  if (!group) return true;
  var best = null;
  group.rules.forEach(function (r) {
    if (!r.path) return; // "Disallow:" with an empty value means allow-all — ignore it as a rule
    var re;
    try { re = robotsPatternToRegex(r.path); } catch (e) { return; }
    if (re.test(path) && (!best || r.path.length > best.path.length)) best = r;
  });
  if (!best) return true;
  return best.type === 'allow';
}

/* ---------------- Page signal parsing — regex-based (no DOM in Node) ---------------- */

// Title and meta-description are regex-extracted straight out of raw
// HTML, which leaves literal entities (&amp;, &#x27;, &#124;…) in place.
// Decoded here, at the source, so every consumer — the score (which
// measures these strings' length), the public scan report's copy-paste
// JSON-LD, and the MCP server's generate_schema — sees the same clean
// text instead of three places each guessing whether to decode.
var NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  mdash: '—', ndash: '–', hellip: '…'
};

function decodeEntities(str) {
  return String(str).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, function (m, ent) {
    if (ent.charAt(0) === '#') {
      var isHex = ent.charAt(1) === 'x' || ent.charAt(1) === 'X';
      var code = isHex ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return isNaN(code) ? m : String.fromCodePoint(code);
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, ent) ? NAMED_ENTITIES[ent] : m;
  });
}

// The captured value of a match made with (?:"(...)"|'(...)'): group 1 or 2.
function firstOf(m) {
  return m[1] !== undefined ? m[1] : m[2];
}

function parseSignals(html) {
  var titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  // Attribute values are matched one quote style at a time: content="..." may
  // contain ' and content='...' may contain ". (A single ["'] ... [^"']* ... ["']
  // pattern ends the value at the first quote character of either kind.)
  var descMatch = html.match(/<meta[^>]+name=["']description["'][^>]*content=(?:"([^"]*)"|'([^']*)')/i)
                || html.match(/<meta[^>]+content=(?:"([^"]*)"|'([^']*)')[^>]*name=["']description["']/i);
  var canonical = /<link[^>]+rel=["']canonical["']/i.test(html);
  var langMatch = html.match(/<html[^>]+lang=(?:"([^"]*)"|'([^']*)')/i);
  var ogTitle = /<meta[^>]+property=["']og:title["']/i.test(html);
  var ogDesc = /<meta[^>]+property=["']og:description["']/i.test(html);

  var schemaTypes = [];
  var ldMatches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  ldMatches.forEach(function (block) {
    var inner = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>\s*$/i, '');
    try {
      var data = JSON.parse(inner);
      var collect = function (obj) {
        if (!obj) return;
        if (Array.isArray(obj)) { obj.forEach(collect); return; }
        if (obj['@type']) [].concat(obj['@type']).forEach(function (t) { schemaTypes.push(String(t)); });
        if (obj['@graph']) collect(obj['@graph']);
      };
      collect(data);
    } catch (e) { /* malformed JSON-LD block, skip */ }
  });

  var h1Count = (html.match(/<h1[\s>]/gi) || []).length;
  var h2Count = (html.match(/<h2[\s>]/gi) || []).length;

  var hrefs = [];
  var hrefRe = /<a\b[^>]*href=(?:"([^"]*)"|'([^']*)')/gi;
  var m;
  while ((m = hrefRe.exec(html)) !== null) hrefs.push(firstOf(m).toLowerCase());

  var bodyTextSample = html.replace(/<[^>]+>/g, ' ').toLowerCase();

  return {
    title: titleMatch ? decodeEntities(titleMatch[1].trim()) : '',
    metaDesc: descMatch ? decodeEntities(firstOf(descMatch).trim()) : '',
    canonical: canonical,
    lang: langMatch ? firstOf(langMatch).trim() : '',
    ogOk: ogTitle && ogDesc,
    schemaTypes: schemaTypes,
    hasOrgSchema: schemaTypes.some(function (t) { return /organization|website|localbusiness/i.test(t); }),
    hasContentSchema: schemaTypes.some(function (t) { return /article|faqpage|howto|product|breadcrumb|webapplication/i.test(t); }),
    h1Count: h1Count,
    h2Count: h2Count,
    authorSignal: /<meta[^>]+name=["']author["']/i.test(html) || hrefs.some(function (h) { return /about|team|company/.test(h); }),
    contactSignal: hrefs.some(function (h) { return /contact|mailto:/.test(h); }) || bodyTextSample.indexOf('contact') !== -1
  };
}

/* ---------------- Scoring ---------------- */

function scoreAll(robotsOk, llmsOk, sitemapOk, botResults, sig) {
  var checks = [];
  function add(cat, label, ok, max, advice, why) {
    checks.push({ cat: cat, label: label, ok: ok, pts: ok ? max : 0, max: max, advice: advice, why: why });
  }

  add('discover', 'robots.txt present', robotsOk, 4,
    'Add a robots.txt file at your site root',
    'AI crawlers read your access policy from this file.');
  add('discover', 'llms.txt present', llmsOk, 4,
    'Add an llms.txt file at your site root',
    'An emerging standard that gives AI systems a curated map of your content.');
  add('discover', 'Sitemap declared', sitemapOk, 6,
    'Declare a Sitemap: line in robots.txt',
    'Sitemaps let crawlers discover your content completely.');

  var openCount = 0;
  botResults.forEach(function (b) { openCount += b.state === 'open' ? 1 : (b.state === 'partial' ? 0.5 : 0); });
  var fullyOpen = botResults.filter(function (b) { return b.state === 'open'; }).length;
  var botPts = Math.round((openCount / BOTS.length) * 26);
  checks.push({
    cat: 'discover',
    label: 'AI crawler access (' + fullyOpen + '/' + BOTS.length + ' open)',
    ok: botPts >= 21, pts: botPts, max: 26,
    advice: 'Review robots.txt rules for blocked AI crawlers',
    why: 'Every blocked crawler removes you from that platform’s answers.'
  });

  add('tech', 'Canonical tag', sig.canonical, 4,
    'Add rel=canonical to your homepage',
    'Tells machines the definitive URL and prevents duplicate-content ambiguity.');
  add('tech', 'html lang attribute', !!sig.lang, 3,
    'Declare a language, e.g. <html lang="en">',
    'Lets AI systems classify your content’s language correctly.');
  add('tech', 'Page title', sig.title.length >= 10 && sig.title.length <= 70, 3,
    'Write a descriptive 10–70 character title',
    'Answer engines frequently use the title as your source label.');
  add('tech', 'Meta description', sig.metaDesc.length >= 50 && sig.metaDesc.length <= 170, 4,
    'Write a 50–170 character meta description',
    'The machine-readable summary of your page.');
  add('tech', 'Open Graph tags', sig.ogOk, 3,
    'Add og:title and og:description',
    'Keeps previews and shared representations consistent.');
  add('tech', 'Structured data (JSON-LD)', sig.schemaTypes.length > 0, 3,
    'Add JSON-LD structured data',
    'Explicitly labels your content for machines.');

  add('trust', 'Single H1 heading', sig.h1Count === 1, 6,
    'Use exactly one H1 on the page',
    'Makes the page’s main topic unambiguous.');
  add('trust', 'Subheading structure (H2)', sig.h2Count >= 2, 5,
    'Break content into H2 sections',
    'Sectioned content is far easier for AI systems to quote.');
  add('trust', 'Organization / WebSite schema', sig.hasOrgSchema, 8,
    'Add Organization schema',
    'Defines your brand as a verifiable entity — the base layer of trust.');
  add('trust', 'Content schema (Article, FAQ…)', sig.hasContentSchema, 5,
    'Add Article or FAQPage schema',
    'Declares content type and raises citation likelihood.');
  add('trust', 'Author / about signals', sig.authorSignal, 8,
    'Add an about page and author information',
    'AI systems weigh source credibility through ownership signals.');
  add('trust', 'Contact signals', sig.contactSignal, 8,
    'Add a contact page or email link',
    'Reachability is a baseline trust marker.');

  function sum(cat) {
    return checks.filter(function (c) { return c.cat === cat; })
      .reduce(function (a, c) { return a + c.pts; }, 0);
  }
  return {
    checks: checks,
    discover: sum('discover'),
    tech: sum('tech'),
    trust: sum('trust'),
    total: sum('discover') + sum('tech') + sum('trust')
  };
}

/* ---------------- Site-level context (robots/llms/sitemap/bot access) ---------------- */

// Fetches and evaluates robots.txt, llms.txt and sitemap declaration
// for one origin. This is the part of a scan that's the same for every
// page on a site, so the crawl engine computes it once (in
// crawl-start) and hands it to scanPage for every subsequent page
// instead of re-fetching it per page.
async function computeSiteContext(origin, opts) {
  opts = opts || {};
  var userAgent = opts.userAgent || DEFAULT_BROWSER_UA;

  var robotsRes = await fetchText(origin + '/robots.txt', 12000, 'robots.txt', userAgent);
  var robotsOk = false;
  var robots = { groups: [], sitemaps: [] };

  if (robotsRes.notFound) {
    robotsOk = false;
  } else if (robotsRes.ok && robotsRes.text.trim() && !/^\s*</.test(robotsRes.text)) {
    robots = parseRobots(robotsRes.text);
    robotsOk = true;
  } else {
    return { ok: false, error: robotsRes.error || ('HTTP ' + robotsRes.status), kind: robotsRes.kind || ('http-' + robotsRes.status) };
  }

  var llmsRes = await fetchText(origin + '/llms.txt', 8000, 'llms.txt', userAgent);
  var llmsOk = isUsableTextFile(llmsRes);

  var sitemapOk = robots.sitemaps.length > 0;
  var sitemapUrls = robots.sitemaps.slice();
  if (!sitemapOk) {
    var smRes = await fetchText(origin + '/sitemap.xml', 8000, 'sitemap.xml', userAgent);
    if (smRes.ok && /<(urlset|sitemapindex)/i.test(smRes.text)) {
      sitemapOk = true;
      sitemapUrls = [origin + '/sitemap.xml'];
    }
  }

  var botResults = BOTS.map(function (b) {
    var st = botStatus(b.ua, robots);
    return { name: b.ua, desc: b.desc, state: st.state, rule: st.rule };
  });

  return {
    ok: true,
    robotsOk: robotsOk,
    llmsOk: llmsOk,
    sitemapOk: sitemapOk,
    sitemapUrls: sitemapUrls,
    robots: robots,
    botResults: botResults
  };
}

/* ---------------- Agentic commerce checks ---------------- */

var LLMS_MAX_BYTES = 512 * 1024;
var SITEMAP_MAX_BYTES = 1024 * 1024;
var PRODUCT_PAGE_MAX_BYTES = 1536 * 1024;
var UCP_MAX_BYTES = 256 * 1024;
var PRODUCT_FETCH_DELAY_MS = 1500;
// Elapsed time since the scan began after which the optional extra
// fetches are skipped, so a slow site cannot push the scan past the
// function's time limit. Skipped checks are reported as not assessed.
var COMMERCE_BUDGET_MS = 17000;

function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

// Runs after the main score is computed and never touches it. It is the
// only place a scan reaches beyond the homepage, and it is bounded:
// at most the sitemap (when not already read), one product sitemap, and
// ONE product page, fetched last, after a pause, with the honest crawler
// user agent and only if robots.txt allows that path for it. Every
// failure is a state in the result, never an error.
async function runCommerce(c) {
  var commerce = require('./commerce');
  var llms = require('./llms'); // required here: llms.js itself requires this file
  var withinBudget = function () { return Date.now() - c.started < COMMERCE_BUDGET_MS; };

  var ucp = commerce.analyzeUcp(c.ucpRes);
  var base = { schemaTypes: c.sig.schemaTypes, html: c.pageRes.text, headers: c.pageRes.headers || {}, ucp: ucp };
  var signals = commerce.detect(Object.assign({ sitemap: null }, base));

  // No signal so far means the sitemap cannot lift it to the threshold,
  // so it is not fetched. Non-store sites cost nothing extra.
  if (commerce.countFired(signals) === 0) {
    return { detected: false, threshold: commerce.THRESHOLD, signals: signals, ucp: ucp };
  }

  var smText = null;
  if (c.smRes) {
    smText = c.smRes.ok ? c.smRes.text : null;
  } else if (c.robots.sitemaps[0] && !/\.gz(\?|$)/i.test(c.robots.sitemaps[0]) && withinBudget()) {
    var declared = await fetchText(c.robots.sitemaps[0], 6000, 'sitemap', c.userAgent, { maxBytes: SITEMAP_MAX_BYTES });
    smText = declared.ok ? declared.text : null;
  }
  var smInfo = smText ? commerce.analyzeSitemap(smText, c.origin) : null;
  signals = commerce.detect(Object.assign({ sitemap: smInfo || { fired: false } }, base));

  if (commerce.countFired(signals) < commerce.THRESHOLD) {
    return { detected: false, threshold: commerce.THRESHOLD, signals: signals, ucp: ucp };
  }

  // Locate one product page: the sitemap first (following one product
  // child sitemap if it is an index), then a link on the homepage.
  var productUrl = null, source = null;
  if (smInfo && smInfo.kind === 'urlset' && smInfo.firstProductUrl) {
    productUrl = smInfo.firstProductUrl; source = 'sitemap';
  } else if (smInfo && smInfo.kind === 'index' && smInfo.productChild && withinBudget()) {
    var childRes = await fetchText(smInfo.productChild, 6000, 'product sitemap', c.userAgent, { maxBytes: SITEMAP_MAX_BYTES });
    if (childRes.ok) {
      var childInfo = commerce.analyzeSitemap(childRes.text, c.origin);
      if (childInfo.firstProductUrl) { productUrl = childInfo.firstProductUrl; source = 'sitemap'; }
    }
  }
  if (!productUrl) {
    var link = commerce.firstProductLink(c.pageRes.text, c.origin + '/');
    if (link) { productUrl = link; source = 'homepage link'; }
  }

  // Normalised through the URL parser so what is fetched and what is shown
  // to the user is a clean, encoded URL.
  if (productUrl) {
    try { productUrl = new URL(productUrl).href; } catch (e) { productUrl = null; }
  }

  var product;
  if (!productUrl) {
    product = { state: 'not-located', detail: 'No product URL was found in the sitemap or in the homepage links, so product data was not assessed.' };
  } else {
    var target = new URL(productUrl);
    var path = target.pathname + target.search;
    if (!isPathAllowed(path, CRAWLER_UA, c.robots)) {
      product = { state: 'robots-disallowed', url: productUrl, source: source,
        detail: 'robots.txt disallows ' + path + ' for CitehoundBot, so the page was not fetched.' };
    } else if (!withinBudget()) {
      product = { state: 'skipped', url: productUrl, source: source, detail: 'The scan ran out of time before the product page could be read.' };
    } else {
      await sleep(PRODUCT_FETCH_DELAY_MS);
      var pRes = await fetchText(productUrl, 8000, 'product page', CRAWLER_UA, { maxBytes: PRODUCT_PAGE_MAX_BYTES });
      if (!pRes.ok || !pRes.text) {
        product = { state: 'unreadable', url: productUrl, source: source,
          detail: pRes.status ? 'The product page answered HTTP ' + pRes.status + '.' : 'The product page could not be fetched (' + (pRes.kind || 'network error') + ').' };
      } else {
        var a = commerce.analyzeProductPage(pRes.text);
        if (pRes.truncated && !a.found) {
          // Only the first part of an oversized page was read. Schema that
          // is not in that part may still exist, so this is not a failure.
          product = { state: 'unreadable', url: productUrl, source: source,
            detail: 'The product page is larger than the ' + Math.round(PRODUCT_PAGE_MAX_BYTES / 1024 / 1024 * 10) / 10 + ' MB read, and no Product schema appeared in that part, so product data was not assessed.' };
        } else {
          product = { state: 'checked', url: productUrl, source: source, found: a.found,
            schemaSource: a.source, schemaType: a.type, fields: a.fields, present: a.present };
        }
      }
    }
  }

  var built = commerce.buildChecks(ucp, product);

  var host = new URL(c.origin).hostname.replace(/^www\./, '');
  var la = llms.analyze(c.llmsRes, host);
  var llmsSummary = {
    state: la.state,
    verdict: la.authorship ? la.authorship.verdict : null,
    platform: la.authorship ? la.authorship.platform : null,
    summary: la.authorship ? la.authorship.summary : la.message,
    caveat: la.authorship ? la.authorship.caveat : null
  };

  return {
    detected: true,
    threshold: commerce.THRESHOLD,
    signals: signals,
    ucp: ucp,
    product: product,
    checks: built.checks,
    subScore: built.subScore,
    llms: llmsSummary
  };
}

/* ---------------- Primary export: scan one page ---------------- */

async function scanPage(url, opts) {
  opts = opts || {};
  var started = Date.now();
  var userAgent = opts.userAgent || DEFAULT_BROWSER_UA;
  var origin;
  try { origin = new URL(url).origin; } catch (e) {
    return { ok: false, url: url, error: 'Invalid URL', stage: 'url' };
  }

  if (opts.siteContext) {
    var ctx = opts.siteContext;
    var pageRes = await fetchText(url, opts.timeoutMs || 12000, 'page', userAgent);
    if (!pageRes.ok || !pageRes.text) {
      return { ok: false, url: url, error: pageRes.error || ('HTTP ' + pageRes.status), kind: pageRes.kind, stage: 'page' };
    }
    var sig2 = parseSignals(pageRes.text);
    var result2 = scoreAll(ctx.robotsOk, ctx.llmsOk, ctx.sitemapOk, ctx.botResults, sig2);
    return {
      ok: true,
      url: url,
      robotsOk: ctx.robotsOk,
      botResults: ctx.botResults,
      result: result2,
      siteInfo: { title: sig2.title, metaDesc: sig2.metaDesc, lang: sig2.lang }
    };
  }

  // Self-contained path (used by /api/scan): fetch robots.txt, llms.txt
  // and the page itself in parallel — identical order and branching to
  // the original single-page scan, just relocated here.
  var commerceOn = opts.commerce !== false;
  var robotsPromise = fetchText(origin + '/robots.txt', 12000, 'robots.txt', userAgent);
  var pagePromise = fetchText(url, 12000, 'page', userAgent);
  var llmsPromise = fetchText(origin + '/llms.txt', 8000, 'llms.txt', userAgent, { maxBytes: LLMS_MAX_BYTES });
  // Same parallel batch as the other root files. A failed fetch is just
  // an absent endpoint, never a scan failure.
  var ucpPromise = commerceOn ? fetchText(origin + '/.well-known/ucp', 8000, 'ucp', userAgent, { maxBytes: UCP_MAX_BYTES }) : null;

  var robotsRes = await robotsPromise;
  var robotsOk = false;
  var robots = { groups: [], sitemaps: [] };

  if (robotsRes.notFound) {
    robotsOk = false;
  } else if (robotsRes.ok && robotsRes.text.trim() && !/^\s*</.test(robotsRes.text)) {
    robots = parseRobots(robotsRes.text);
    robotsOk = true;
  } else {
    await pagePromise.catch(function () {});
    await llmsPromise.catch(function () {});
    if (ucpPromise) await ucpPromise.catch(function () {});
    return { ok: false, url: url, error: robotsRes.error || ('HTTP ' + robotsRes.status), kind: robotsRes.kind || ('http-' + robotsRes.status), stage: 'robots' };
  }

  var llmsRes = await llmsPromise;
  var llmsOk = isUsableTextFile(llmsRes);

  var sitemapOk = robots.sitemaps.length > 0;
  var smRes = null;
  if (!sitemapOk) {
    smRes = await fetchText(origin + '/sitemap.xml', 8000, 'sitemap.xml', userAgent, { maxBytes: SITEMAP_MAX_BYTES });
    sitemapOk = !!(smRes.ok && /<(urlset|sitemapindex)/i.test(smRes.text));
  }

  var pageRes = await pagePromise;
  if (!pageRes.ok || !pageRes.text) {
    return { ok: false, url: url, error: pageRes.error || ('HTTP ' + pageRes.status), kind: pageRes.kind, stage: 'page' };
  }
  var sig = parseSignals(pageRes.text);

  var botResults = BOTS.map(function (b) {
    var st = botStatus(b.ua, robots);
    return { name: b.ua, desc: b.desc, state: st.state, rule: st.rule };
  });

  var result = scoreAll(robotsOk, llmsOk, sitemapOk, botResults, sig);

  var out = {
    ok: true,
    url: url,
    robotsOk: robotsOk,
    botResults: botResults,
    result: result,
    siteInfo: { title: sig.title, metaDesc: sig.metaDesc, lang: sig.lang }
  };

  if (commerceOn) {
    var ucpRes = await ucpPromise;
    try {
      out.commerce = await runCommerce({
        origin: origin, started: started, userAgent: userAgent, robots: robots,
        sig: sig, pageRes: pageRes, ucpRes: ucpRes, llmsRes: llmsRes, smRes: smRes
      });
    } catch (err) {
      // The commerce checks are optional extras: whatever goes wrong in
      // them must never fail the scan or change its score.
      console.error('[scanner] commerce checks failed for', origin, '-', err && err.stack ? err.stack : err);
    }
  }
  return out;
}

// Homepage title, meta description and language for a domain, without the
// full scan (which also needs robots.txt). Shared by /api/site-info and
// the MCP generate_schema tool.
async function fetchSiteInfo(domain) {
  var pageRes = await fetchText('https://' + domain + '/', 12000, 'page', DEFAULT_BROWSER_UA);
  if (!pageRes.ok || !pageRes.text) {
    return {
      ok: false,
      status: pageRes.status,
      kind: pageRes.kind,
      detail: pageRes.kind || pageRes.error || (pageRes.status ? 'HTTP ' + pageRes.status : 'unknown error')
    };
  }
  var sig = parseSignals(pageRes.text);
  return { ok: true, siteInfo: { title: sig.title, metaDesc: sig.metaDesc, lang: sig.lang } };
}

module.exports = {
  BOTS: BOTS,
  DEFAULT_BROWSER_UA: DEFAULT_BROWSER_UA,
  CRAWLER_UA: CRAWLER_UA,
  fetchText: fetchText,
  isUsableTextFile: isUsableTextFile,
  normalizeDomain: normalizeDomain,
  fetchSiteInfo: fetchSiteInfo,
  parseRobots: parseRobots,
  botStatus: botStatus,
  isPathAllowed: isPathAllowed,
  parseSignals: parseSignals,
  scoreAll: scoreAll,
  computeSiteContext: computeSiteContext,
  scanPage: scanPage,
  LLMS_MAX_BYTES: LLMS_MAX_BYTES
};
