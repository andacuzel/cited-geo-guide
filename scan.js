/* =====================================================================
   /api/scan — server-side AI visibility scan.
   Runs on Vercel's Node runtime. Fetches robots.txt, sitemap.xml and
   the homepage directly (no CORS, no proxies) and returns the same
   score shape the frontend previously computed in-browser.

   Usage: GET /api/scan?domain=example.com
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

function normalizeDomain(raw) {
  var d = (raw || '').trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)) return null;
  return d;
}

async function fetchText(url, timeoutMs) {
  var ctrl = new AbortController();
  var t = setTimeout(function () { ctrl.abort(); }, timeoutMs || 8000);
  try {
    var res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'CitedScanBot/1.0 (+https://andacuzel.github.io/cited-geo-guide/)' },
      redirect: 'follow'
    });
    clearTimeout(t);
    if (res.status === 404) return { ok: false, notFound: true, status: 404 };
    if (!res.ok) return { ok: false, status: res.status };
    var text = await res.text();
    return { ok: true, text: text, status: res.status };
  } catch (err) {
    clearTimeout(t);
    return { ok: false, error: err.message || 'fetch failed' };
  }
}

/* ---------------- robots.txt parsing (identical logic to the old client version) ---------------- */

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

/* ---------------- Homepage signal parsing — regex-based (no DOM in Node) ---------------- */

function parseSignals(html) {
  var titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  var descMatch = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)
                || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i);
  var canonical = /<link[^>]+rel=["']canonical["']/i.test(html);
  var langMatch = html.match(/<html[^>]+lang=["']([^"']*)["']/i);
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
  var hrefRe = /<a\b[^>]*href=["']([^"']*)["']/gi;
  var m;
  while ((m = hrefRe.exec(html)) !== null) hrefs.push(m[1].toLowerCase());

  var bodyTextSample = html.replace(/<[^>]+>/g, ' ').toLowerCase();

  return {
    title: titleMatch ? titleMatch[1].trim() : '',
    metaDesc: descMatch ? descMatch[1].trim() : '',
    canonical: canonical,
    lang: !!(langMatch && langMatch[1]),
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

/* ---------------- Scoring (identical weights to the old client version) ---------------- */

function scoreAll(robotsOk, sitemapOk, botResults, sig) {
  var checks = [];
  function add(cat, label, ok, max, advice, why) {
    checks.push({ cat: cat, label: label, ok: ok, pts: ok ? max : 0, max: max, advice: advice, why: why });
  }

  add('discover', 'robots.txt present', robotsOk, 4,
    'Add a robots.txt file at your site root',
    'AI crawlers read your access policy from this file.');
  add('discover', 'Sitemap declared', sitemapOk, 6,
    'Declare a Sitemap: line in robots.txt',
    'Sitemaps let crawlers discover your content completely.');

  var openCount = 0;
  botResults.forEach(function (b) { openCount += b.state === 'open' ? 1 : (b.state === 'partial' ? 0.5 : 0); });
  var fullyOpen = botResults.filter(function (b) { return b.state === 'open'; }).length;
  var botPts = Math.round((openCount / BOTS.length) * 30);
  checks.push({
    cat: 'discover',
    label: 'AI crawler access (' + fullyOpen + '/' + BOTS.length + ' open)',
    ok: botPts >= 24, pts: botPts, max: 30,
    advice: 'Review robots.txt rules for blocked AI crawlers',
    why: 'Every blocked crawler removes you from that platform\u2019s answers.'
  });

  add('tech', 'Canonical tag', sig.canonical, 4,
    'Add rel=canonical to your homepage',
    'Tells machines the definitive URL and prevents duplicate-content ambiguity.');
  add('tech', 'html lang attribute', sig.lang, 3,
    'Declare a language, e.g. <html lang="en">',
    'Lets AI systems classify your content\u2019s language correctly.');
  add('tech', 'Page title', sig.title.length >= 10 && sig.title.length <= 70, 3,
    'Write a descriptive 10\u201370 character title',
    'Answer engines frequently use the title as your source label.');
  add('tech', 'Meta description', sig.metaDesc.length >= 50 && sig.metaDesc.length <= 170, 4,
    'Write a 50\u2013170 character meta description',
    'The machine-readable summary of your page.');
  add('tech', 'Open Graph tags', sig.ogOk, 3,
    'Add og:title and og:description',
    'Keeps previews and shared representations consistent.');
  add('tech', 'Structured data (JSON-LD)', sig.schemaTypes.length > 0, 3,
    'Add JSON-LD structured data',
    'Explicitly labels your content for machines.');

  add('trust', 'Single H1 heading', sig.h1Count === 1, 6,
    'Use exactly one H1 on the page',
    'Makes the page\u2019s main topic unambiguous.');
  add('trust', 'Subheading structure (H2)', sig.h2Count >= 2, 5,
    'Break content into H2 sections',
    'Sectioned content is far easier for AI systems to quote.');
  add('trust', 'Organization / WebSite schema', sig.hasOrgSchema, 8,
    'Add Organization schema',
    'Defines your brand as a verifiable entity \u2014 the base layer of trust.');
  add('trust', 'Content schema (Article, FAQ\u2026)', sig.hasContentSchema, 5,
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

/* ---------------- Handler ---------------- */

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  var domain = normalizeDomain(req.query.domain);
  if (!domain) {
    res.status(400).json({ error: 'Enter a valid domain, e.g. example.com' });
    return;
  }

  var base = 'https://' + domain;

  var robotsRes = await fetchText(base + '/robots.txt', 8000);
  var robotsOk = false;
  var robots = { groups: [], sitemaps: [] };

  if (robotsRes.notFound) {
    robotsOk = false; // genuinely absent → default access is the true state
  } else if (robotsRes.ok && robotsRes.text.trim() && !/^\s*</.test(robotsRes.text)) {
    robots = parseRobots(robotsRes.text);
    robotsOk = true;
  } else {
    res.status(502).json({ error: 'Couldn\u2019t reach robots.txt, so the score wouldn\u2019t be reliable. Please try again.' });
    return;
  }

  var sitemapOk = robots.sitemaps.length > 0;
  if (!sitemapOk) {
    var smRes = await fetchText(base + '/sitemap.xml', 6000);
    sitemapOk = !!(smRes.ok && /<(urlset|sitemapindex)/i.test(smRes.text));
  }

  var pageRes = await fetchText(base + '/', 8000);
  if (!pageRes.ok || !pageRes.text) {
    res.status(502).json({ error: 'The homepage could not be read. Please try again.' });
    return;
  }
  var sig = parseSignals(pageRes.text);

  var botResults = BOTS.map(function (b) {
    var st = botStatus(b.ua, robots);
    return { name: b.ua, desc: b.desc, state: st.state, rule: st.rule };
  });

  var result = scoreAll(robotsOk, sitemapOk, botResults, sig);

  res.status(200).json({
    domain: domain,
    robotsOk: robotsOk,
    botResults: botResults,
    result: result
  });
};
