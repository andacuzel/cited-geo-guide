/* =====================================================================
   lib/report-facts.js — the facts behind a crawl report. No prose.

   One function, facts(data, opts), turns a crawl result (the object
   /api/crawl-result returns) into a plain facts object. The executive
   summary (lib/summary.js) and the dashboard both read it, so a sentence in
   the summary and a figure on screen come from the same number.

   UMD, like lib/report-render.js: Node (the summary pipeline, generators,
   tests) and the browser (the dashboard).

   Inference is labelled. likelyShared is an inference from how many pages
   fail a check; typicalEffort comes from a lookup table in this file and is
   a typical, not a measured, effort.

   Weights are not typed here. Every point value comes from the per-page
   results, which lib/scanner.js scored. The simulation below is checked
   against a real scoreAll() rescore in scripts/test-facts.js.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CITEHOUND_FACTS = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CRAWL_CAP = 50;          // MAX_PAGES in api/crawl-start.js
  var LIKELY_SHARED = 0.8;     // fails on at least this share of pages
  var SITE_LEVEL = /^(robots\.txt present|llms\.txt present|Sitemap declared|AI crawler access)/;

  // How hard a fix typically is. Typical, not measured: it depends on the site.
  var EFFORT = {
    'site-file': { label: 'a site file', weight: 1 },
    'one-link': { label: 'one link', weight: 1 },
    'one-template': { label: 'one template change', weight: 2 },
    'page-type-markup': { label: 'markup for each page type', weight: 3 },
    'page-copy': { label: 'copy on each page', weight: 4 }
  };
  var EFFORT_BY_CHECK = {
    'robots.txt present': 'site-file',
    'llms.txt present': 'site-file',
    'Sitemap declared': 'site-file',
    'AI crawler access': 'site-file',
    'Canonical tag': 'one-template',
    'html lang attribute': 'one-template',
    'Open Graph tags': 'one-template',
    'Organization / WebSite schema': 'one-template',
    'Page title': 'page-copy',
    'Meta description': 'page-copy',
    'Structured data (JSON-LD)': 'page-type-markup',
    'Content schema (Article, FAQ…)': 'page-type-markup',
    'Single H1 heading': 'page-type-markup',
    'Subheading structure (H2)': 'page-copy',
    'Author / about signals': 'one-link',
    'Contact signals': 'one-link'
  };

  function cleanLabel(label) { return String(label).replace(/\s*\(\d+\s*\/\s*\d+\s+open\)\s*$/i, '').trim(); }
  function isSiteLevel(label) { return SITE_LEVEL.test(label); }
  function round1(x) { return Math.round(x * 10) / 10; }
  function round2(x) { return Math.round(x * 100) / 100; }
  function mean(xs) { return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length : 0; }

  function pathOf(url) {
    try { var u = new URL(url); return u.pathname + (u.search || ''); } catch (e) { return String(url); }
  }
  function prefixOf(url) {
    var seg = pathOf(url).split('/').filter(Boolean)[0];
    return seg ? '/' + seg : '/';
  }

  /* data: a crawl result. opts: { schema: window.CITEHOUND_SCHEMA | require('./schema'), cap } */
  function facts(data, opts) {
    opts = opts || {};
    var cap = opts.cap || CRAWL_CAP;
    var pages = data.pages || [];
    var ok = pages.filter(function (p) { return p.status === 'ok' && p.result; });
    var failedPages = pages.filter(function (p) { return p.status === 'failed'; });
    var n = ok.length;
    var homeUrl = pages[0] && pages[0].url;
    var home = ok.filter(function (p) { return p.url === homeUrl; })[0] || null;

    var avg = n ? Math.round(mean(ok.map(function (p) { return p.result.total; }))) : null;
    var homeScore = home ? home.result.total : null;

    /* ---- per check ---- */
    var order = [];
    var byLabel = {};
    ok.forEach(function (p) {
      p.result.checks.forEach(function (c) {
        var key = cleanLabel(c.label);
        var e = byLabel[key];
        if (!e) {
          e = byLabel[key] = { label: key, cat: c.cat, max: c.max, siteLevel: isSiteLevel(c.label), failing: [], passing: 0, lostPoints: 0 };
          order.push(key);
        }
        if (c.ok) { e.passing++; } else { e.failing.push(p.url); e.lostPoints += (c.max - c.pts); }
      });
    });

    var homeChecks = {};
    if (home) home.result.checks.forEach(function (c) { homeChecks[cleanLabel(c.label)] = c.ok; });

    var checks = order.map(function (key) {
      var e = byLabel[key];
      var share = n ? e.failing.length / n : 0;
      var effortKey = EFFORT_BY_CHECK[key] || 'page-copy';
      return {
        label: e.label,
        cat: e.cat,
        max: e.max,
        siteLevel: e.siteLevel,
        failingPages: e.failing.length,
        failingShare: round2(share),
        passesOnHomepage: Object.prototype.hasOwnProperty.call(homeChecks, key) ? !!homeChecks[key] : null,
        // An inference from the share of pages that fail, not something we observed.
        likelyShared: !e.siteLevel && e.failing.length > 0 && share >= LIKELY_SHARED,
        // Site-wide average points gained if the check passed on every page that fails it.
        gainIfFixedEverywhere: n ? round1(e.lostPoints / n) : 0,
        effort: { key: effortKey, label: EFFORT[effortKey].label, weight: EFFORT[effortKey].weight, typical: true },
        pages: e.failing.slice()
      };
    }).sort(function (a, b) { return b.failingPages - a.failingPages || b.gainIfFixedEverywhere - a.gainIfFixedEverywhere || (a.label < b.label ? -1 : 1); });

    /* ---- clusters: shared first path segment and identical failing set ---- */
    var groups = {};
    var pageRows = ok.map(function (p) {
      var fails = p.result.checks.filter(function (c) { return !c.ok && !isSiteLevel(c.label); }).map(function (c) { return cleanLabel(c.label); }).sort();
      return { url: p.url, total: p.result.total, failing: fails, prefix: prefixOf(p.url) };
    });
    pageRows.forEach(function (r) {
      var key = r.prefix + '|' + r.failing.join(';');
      (groups[key] = groups[key] || { prefix: r.prefix, failing: r.failing, urls: [], scores: [] });
      groups[key].urls.push(r.url);
      groups[key].scores.push(r.total);
    });
    var clustersAll = Object.keys(groups).map(function (k) {
      var g = groups[k];
      return { prefix: g.prefix, pages: g.urls.length, avgScore: Math.round(mean(g.scores)), failing: g.failing, urls: g.urls };
    }).sort(function (a, b) { return b.pages - a.pages || a.avgScore - b.avgScore || (a.prefix < b.prefix ? -1 : 1); });

    /* ---- priorities: gain per unit of typical effort ---- */
    // AI crawler access is excluded when it is only half credit for ordinary Disallow rules
    // (no crawler fully blocked): that is not an action we would recommend by default.
    var anyBlocked = ((data.siteContext && data.siteContext.botResults) || []).some(function (b) { return b.state === 'block'; });
    var priorities = checks.filter(function (c) {
      if (c.failingPages === 0 || c.gainIfFixedEverywhere <= 0) return false;
      if (c.label === 'AI crawler access' && !anyBlocked) return false;
      return true;
    }).map(function (c) {
      return { check: c, score: c.gainIfFixedEverywhere / c.effort.weight };
    }).sort(function (a, b) { return b.score - a.score || b.check.failingPages - a.check.failingPages || (a.check.label < b.check.label ? -1 : 1); })
      .slice(0, 3).map(function (x, i) {
        var c = x.check;
        return { rank: i + 1, ref: 'check:' + c.label, label: c.label, failingPages: c.failingPages, of: n, gain: c.gainIfFixedEverywhere, effort: c.effort.label, effortKey: c.effort.key, likelyShared: c.likelyShared, passesOnHomepage: c.passesOnHomepage };
      });

    /* ---- fixes: each distinct snippet once, with the pages it applies to ---- */
    var fixes = [];
    var seen = {};
    function addFix(kind, label, code, url) {
      var key = kind + '\n' + code;
      if (!seen[key]) { seen[key] = { id: 'fix-' + (fixes.length + 1), kind: kind, label: label, code: code, pages: [] }; fixes.push(seen[key]); }
      if (seen[key].pages.indexOf(url) === -1) seen[key].pages.push(url);
    }
    var schema = opts.schema;
    var notOpen = ((data.siteContext && data.siteContext.botResults) || []).filter(function (b) { return b.state !== 'open'; });
    if (notOpen.length) {
      var lines = ['# Allows the AI crawlers that are limited or blocked today'];
      notOpen.forEach(function (b) { lines.push('User-agent: ' + b.name); lines.push('Allow: /'); lines.push(''); });
      lines.pop();
      ok.forEach(function (p) { addFix('robots', 'robots.txt', lines.join('\n'), p.url); });
    }
    if (schema) {
      ok.forEach(function (p) {
        var labels = p.result.checks.filter(function (c) { return !c.ok; }).map(function (c) { return cleanLabel(c.label); });
        var info = p.siteInfo || {};
        if (labels.indexOf('Organization / WebSite schema') !== -1) {
          // Organization is a site-wide entity: build it from the homepage's details so one block fits every page.
          var h = (home && home.siteInfo) || info;
          addFix('organization', 'Organization and WebSite JSON-LD', schema.toScriptTag(schema.buildFromSite('organization', data.domain, h)), p.url);
        }
        if (labels.indexOf('Content schema (Article, FAQ…)') !== -1) {
          addFix('article', 'Article JSON-LD', schema.toScriptTag(schema.buildFromSite('article', data.domain, info)), p.url);
        }
      });
    }

    var pillarMax = { discover: 0, tech: 0, trust: 0 };
    if (ok[0]) ok[0].result.checks.forEach(function (c) { if (pillarMax[c.cat] !== undefined) pillarMax[c.cat] += c.max; });
    var s = data.summary || {};
    var bm = data.benchmark || opts.benchmark || null;

    return {
      domain: data.domain,
      crawledAt: data.createdAt || null,
      coverage: {
        pagesRead: n,
        pagesFailed: failedPages.length,
        pagesInCrawl: pages.length,
        cap: cap,
        sitemapCandidates: data.discovery && typeof data.discovery.candidates === 'number' ? data.discovery.candidates : null,
        discoverySource: data.discovery ? data.discovery.source : null,
        // The crawl reads at most `cap` pages. Reaching the cap means more pages may exist.
        sampled: pages.length >= cap
      },
      verdict: {
        siteWide: avg,
        homepage: homeScore,
        gap: (avg !== null && homeScore !== null) ? avg - homeScore : null,
        pagesWithAFailure: pageRows.filter(function (r) { return r.failing.length > 0; }).length,
        benchmark: bm ? { average: bm.average, sites: bm.sites, categories: bm.categories } : null,
        vsBenchmark: (bm && avg !== null) ? avg - bm.average : null,
        // The benchmark scanned homepages, so the like-for-like comparison is homepage against that average.
        homepageVsBenchmark: (bm && homeScore !== null) ? homeScore - bm.average : null
      },
      pillars: {
        discover: { average: s.averageDiscoverability, max: pillarMax.discover },
        tech: { average: s.averageTechnical, max: pillarMax.tech },
        trust: { average: s.averageTrust, max: pillarMax.trust }
      },
      checks: checks,
      clusters: clustersAll.slice(0, 5),
      clustersAll: clustersAll,
      priorities: priorities,
      working: checks.filter(function (c) { return c.failingPages === 0 && !c.siteLevel; }).map(function (c) { return c.label; }),
      rules: { likelySharedPct: Math.round(LIKELY_SHARED * 100), crawlCap: cap },
      counts: {
        likelyShared: checks.filter(function (c) { return c.likelyShared; }).length,
        failingChecks: checks.filter(function (c) { return !c.siteLevel && c.failingPages > 0; }).length,
        passingEverywhere: checks.filter(function (c) { return !c.siteLevel && c.failingPages === 0; }).length
      },
      crawlers: {
        limited: ((data.siteContext && data.siteContext.botResults) || []).filter(function (b) { return b.state === 'partial'; }).length,
        blocked: ((data.siteContext && data.siteContext.botResults) || []).filter(function (b) { return b.state === 'block'; }).length
      },
      fixes: fixes
    };
  }

  // The average of every scanned site, from the benchmark summaries. Node only: build time, never typed.
  function benchmarkFromData(dir) {
    var fs = require('fs'); var path = require('path');
    var entries = JSON.parse(fs.readFileSync(path.join(dir, 'benchmarks.json'), 'utf8'));
    var total = 0, weighted = 0, cats = 0, dates = [];
    entries.forEach(function (e) {
      try {
        var s = JSON.parse(fs.readFileSync(path.join(dir, e.category + '-summary.json'), 'utf8'));
        if (s.scanned && s.score) { total += s.scanned; weighted += s.score.average * s.scanned; cats++; dates.push(s.scannedAt); }
      } catch (err) { /* a missing summary is left out */ }
    });
    dates.sort();
    return total ? { average: Math.round(weighted / total), sites: total, categories: cats, scannedFrom: dates[0], scannedTo: dates[dates.length - 1] } : null;
  }

  return { facts: facts, benchmarkFromData: benchmarkFromData, EFFORT: EFFORT, EFFORT_BY_CHECK: EFFORT_BY_CHECK, LIKELY_SHARED: LIKELY_SHARED, CRAWL_CAP: CRAWL_CAP, cleanLabel: cleanLabel, isSiteLevel: isSiteLevel };
}));
