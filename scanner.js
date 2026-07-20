/* =====================================================================
   CITED SCAN — client-side AI visibility scanner
   No backend. Fetches public site data (robots.txt, sitemap, homepage)
   through CORS proxies and scores it in the browser.

   CONFIG: set your contact email below. The Pro card is display-only
   for now; gate paid output inside renderReport() when payments land.
   ===================================================================== */

(function () {
  'use strict';

  var CONFIG = {
    contactEmail: 'you@example.com', // ← replace before deploying
    shareUrl: 'https://andacuzel.github.io/cited-geo-guide/'
  };

  var BOTS = [
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

  var PROXIES = [
    function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); },
    function (u) { return 'https://corsproxy.io/?url=' + encodeURIComponent(u); },
    function (u) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u); }
  ];

  /* ---------------- DOM ---------------- */

  var form = document.getElementById('scanForm');
  if (!form) return;

  var input = document.getElementById('scanInput');
  var scanBtn = document.getElementById('scanBtn');
  var statusEl = document.getElementById('scanStatus');
  var retryBtn = document.getElementById('scanRetry');
  var report = document.getElementById('scanReport');
  var agencyLink = document.getElementById('agencyLink');

  if (agencyLink) agencyLink.href = 'mailto:' + CONFIG.contactEmail + '?subject=Cited%20%E2%80%94%20done-for-you%20AI%20visibility';

  var lastScore = null;

  /* ---------------- Helpers ---------------- */

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.classList.toggle('is-error', !!isError);
    retryBtn.classList.toggle('is-visible', !!isError);
  }

  function normalizeDomain(raw) {
    var d = (raw || '').trim().toLowerCase();
    d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)) return null;
    return d;
  }

  async function fetchViaProxy(url) {
    var lastErr;
    for (var pass = 0; pass < 2; pass++) {
      if (pass > 0) await sleep(1500);
      for (var i = 0; i < PROXIES.length; i++) {
        try {
          var ctrl = new AbortController();
          var t = setTimeout(function () { ctrl.abort(); }, 12000);
          var res = await fetch(PROXIES[i](url), { signal: ctrl.signal });
          clearTimeout(t);
          if (res.ok) {
            var text = await res.text();
            return { ok: true, text: text };
          }
          if (res.status === 404) return { ok: false, notFound: true };
          lastErr = new Error('HTTP ' + res.status);
        } catch (err) { lastErr = err; }
      }
    }
    throw lastErr || new Error('proxy unreachable');
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

  /* ---------------- Homepage signal parsing ---------------- */

  function parseSignals(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var q = function (sel) { return doc.querySelector(sel); };
    var qa = function (sel) { return Array.prototype.slice.call(doc.querySelectorAll(sel)); };

    var schemaTypes = [];
    qa('script[type="application/ld+json"]').forEach(function (s) {
      try {
        var collect = function (obj) {
          if (!obj) return;
          if (Array.isArray(obj)) return obj.forEach(collect);
          if (obj['@type']) [].concat(obj['@type']).forEach(function (t) { schemaTypes.push(String(t)); });
          if (obj['@graph']) collect(obj['@graph']);
        };
        collect(JSON.parse(s.textContent));
      } catch (e) {}
    });

    var links = qa('a[href]').map(function (a) { return (a.getAttribute('href') || '').toLowerCase(); });
    var bodyText = (doc.body ? doc.body.textContent : '').toLowerCase();

    return {
      title: q('title') ? q('title').textContent.trim() : '',
      metaDesc: (q('meta[name="description"]') ? q('meta[name="description"]').getAttribute('content') || '' : '').trim(),
      canonical: !!q('link[rel="canonical"]'),
      lang: !!doc.documentElement.getAttribute('lang'),
      ogOk: !!(q('meta[property="og:title"]') && q('meta[property="og:description"]')),
      schemaTypes: schemaTypes,
      hasOrgSchema: schemaTypes.some(function (t) { return /organization|website|localbusiness/i.test(t); }),
      hasContentSchema: schemaTypes.some(function (t) { return /article|faqpage|howto|product|breadcrumb|webapplication/i.test(t); }),
      h1Count: qa('h1').length,
      h2Count: qa('h2').length,
      authorSignal: !!(q('meta[name="author"]') || links.some(function (h) { return /about|team|company/.test(h); })),
      contactSignal: !!(links.some(function (h) { return /contact|mailto:/.test(h); }) || bodyText.indexOf('contact') !== -1)
    };
  }

  /* ---------------- Scoring (Discoverability 40 / Technical 20 / Trust 40) ---------------- */

  function scoreAll(robotsOk, sitemapOk, botResults, sig) {
    var checks = [];
    function add(cat, label, ok, max, advice, why) {
      checks.push({ cat: cat, label: label, ok: ok, pts: ok ? max : 0, max: max, advice: advice, why: why });
    }

    // Discoverability (40)
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

    // Technical foundation (20)
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

    // Content & trust (40)
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

  /* ---------------- Scan flow ---------------- */

  async function runScan() {
    var domain = normalizeDomain(input.value);
    if (!domain) { setStatus('Enter a valid domain, e.g. example.com', true); return; }

    scanBtn.disabled = true;
    report.hidden = true;
    var base = 'https://' + domain;

    try {
      setStatus('Reading robots.txt\u2026');
      var robotsOk = false;
      var robots = { groups: [], sitemaps: [] };
      try {
        var r = await fetchViaProxy(base + '/robots.txt');
        if (r.notFound) {
          robotsOk = false; // genuinely absent → default access is the true state
        } else if (r.ok && r.text.trim() && !/^\s*</.test(r.text)) {
          robots = parseRobots(r.text);
          robotsOk = true;
        } else {
          throw new Error('robots.txt content could not be verified');
        }
      } catch (e) {
        throw new Error('Couldn\u2019t reach robots.txt, so the score wouldn\u2019t be reliable. The scan was stopped \u2014 please try again.');
      }

      setStatus('Reading robots.txt\u2026 \u2713\nChecking sitemap\u2026');
      var sitemapOk = robots.sitemaps.length > 0;
      if (!sitemapOk) {
        try {
          var s = await fetchViaProxy(base + '/sitemap.xml');
          sitemapOk = !!(s.ok && /<(urlset|sitemapindex)/i.test(s.text));
        } catch (e) {}
      }

      setStatus('Reading robots.txt\u2026 \u2713\nChecking sitemap\u2026 \u2713\nScanning homepage signals\u2026');
      var page = await fetchViaProxy(base + '/');
      if (!page.ok || !page.text) throw new Error('The homepage could not be read. Please try again.');
      var sig = parseSignals(page.text);

      var botResults = BOTS.map(function (b) {
        var st = botStatus(b.ua, robots);
        return { name: b.ua, desc: b.desc, state: st.state, rule: st.rule };
      });

      var result = scoreAll(robotsOk, sitemapOk, botResults, sig);
      renderReport(domain, robotsOk, botResults, result);
      setStatus('');
    } catch (err) {
      setStatus('Scan failed: ' + (err && err.message ? err.message : 'connection error'), true);
    } finally {
      scanBtn.disabled = false;
    }
  }

  /* ---------------- Render ---------------- */

  function renderReport(domain, robotsOk, botResults, r) {
    lastScore = { domain: domain, total: r.total };

    document.getElementById('scoreValue').textContent = r.total;
    document.getElementById('scoreDomain').textContent = domain + ' \u00b7 retrieved ' + new Date().toLocaleDateString('en-GB');

    function bar(fillId, valId, val, max) {
      document.getElementById(fillId).style.width = Math.round((val / max) * 100) + '%';
      document.getElementById(valId).textContent = val + '/' + max;
    }
    bar('barDiscover', 'valDiscover', r.discover, 40);
    bar('barTech', 'valTech', r.tech, 20);
    bar('barTrust', 'valTrust', r.trust, 40);

    var chip = {
      open: '<span class="mark mark--open">\u25CF OPEN</span>',
      partial: '<span class="mark mark--partial">\u25D0 LIMITED</span>',
      block: '<span class="mark mark--block">\u25CB BLOCKED</span>'
    };
    var botHtml = '<div class="bot-console__label">' + esc(domain) + '/robots.txt \u2014 AI crawler policy</div>';
    if (!robotsOk) botHtml += '<div class="bot-console__note"># no robots.txt found \u2192 all crawlers have default access</div>';
    botResults.forEach(function (b) {
      botHtml += '<div class="bot-row"><span class="bot-row__name">' + esc(b.name) + '</span>' + chip[b.state] +
        '<span class="bot-row__rule">' + esc(b.rule) + ' \u00b7 ' + esc(b.desc) + '</span></div>';
    });
    document.getElementById('botConsole').innerHTML = botHtml;

    document.getElementById('checksBody').innerHTML = r.checks.map(function (c) {
      var passed = c.ok || c.pts >= c.max * 0.8;
      return '<div class="check-row ' + (passed ? 'is-ok' : 'is-fail') + '">' +
        '<span class="check-row__mark">' + (passed ? '\u2713' : '\u2717') + '</span>' +
        '<span>' + esc(c.label) + '</span>' +
        '<span class="check-row__pts">' + c.pts + '/' + c.max + '</span></div>';
    }).join('');

    var missed = r.checks
      .filter(function (c) { return c.pts < c.max; })
      .map(function (c) { return { advice: c.advice, why: c.why, gain: c.max - c.pts }; })
      .sort(function (a, b) { return b.gain - a.gain; });

    document.getElementById('actionsList').innerHTML = missed.length === 0
      ? '<li class="action-item"><div class="action-item__top"><span class="action-item__label">Every check passed.</span></div>' +
        '<p class="action-item__why">Next frontier: whether your content actually gets cited inside AI answers \u2014 that\u2019s what the playbooks below are for.</p></li>'
      : missed.map(function (c) {
          var level = c.gain >= 6 ? ['high', 'High impact'] : c.gain >= 3 ? ['mid', 'Medium impact'] : ['low', 'Low impact'];
          return '<li class="action-item action-item--' + level[0] + '"><div class="action-item__top">' +
            '<span class="action-item__label"><span class="action-item__tag">' + level[1] + '</span>' + esc(c.advice) + '</span>' +
            '<span class="action-item__gain">+' + c.gain + ' pts</span></div>' +
            '<p class="action-item__why">' + esc(c.why) + '</p></li>';
        }).join('');

    report.hidden = false;
    report.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------- Share ---------------- */

  function shareScore() {
    if (!lastScore) return;
    var text = lastScore.domain + ' scored ' + lastScore.total + '/100 on AI visibility. Scan yours free \u2014 no signup: ' + CONFIG.shareUrl;
    if (navigator.share) {
      navigator.share({ title: 'Cited. \u2014 AI visibility score', text: text, url: CONFIG.shareUrl }).catch(function () {});
    } else {
      navigator.clipboard.writeText(text).then(function () {
        var toast = document.getElementById('toast');
        if (toast) {
          toast.textContent = 'Score copied \u2014 paste it anywhere.';
          toast.classList.add('is-visible');
          setTimeout(function () { toast.classList.remove('is-visible'); }, 2600);
        }
      });
    }
  }

  /* ---------------- Wiring ---------------- */

  form.addEventListener('submit', function (e) { e.preventDefault(); runScan(); });
  retryBtn.addEventListener('click', function () { runScan(); });
  document.getElementById('shareBtn').addEventListener('click', shareScore);

}());
