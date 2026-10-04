/* =====================================================================
   lib/report-render.js — turns one crawl result into the report markup.

   Loaded two ways, like lib/playbooks.js and lib/schema.js (UMD, no build):
     - in Node by scripts/generate-sample-report.js, which writes the static
       /sample-report page
     - as a browser <script> by the dashboard (app/report.html), which sets
       window.ANSWERABLE_REPORT and renders a job fetched from
       /api/crawl-result, or the demo fixture
   Both call render(), so the sample and the dashboard cannot drift.

   Input: the object /api/crawl-result returns (see api/crawl-result.js):
     { domain, createdAt, status, pageCount, pagesDone, summary, siteContext, pages[] }
   Output: an HTML string, static and complete without JavaScript. The
   dashboard adds sorting on top; print uses the same markup.

   Every figure in the output carries data-fig="<key>" so a test can read the
   markup back and compare it with the source JSON.

   Four checks describe the whole site, not a page (robots.txt present,
   llms.txt present, Sitemap declared, AI crawler access). They read the same
   on every page, so they are listed once, not counted per page.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ANSWERABLE_REPORT = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SITE_LEVEL = /^(robots\.txt present|llms\.txt present|Sitemap declared|AI crawler access)/;
  var PILLARS = [
    { cat: 'discover', name: 'Discoverability', avgKey: 'averageDiscoverability' },
    { cat: 'tech', name: 'Technical foundation', avgKey: 'averageTechnical' },
    { cat: 'trust', name: 'Content & trust', avgKey: 'averageTrust' }
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // "AI crawler access (6/10 open)": the count is the same on every page.
  function cleanLabel(label) { return String(label).replace(/\s*\(\d+\s*\/\s*\d+\s+open\)\s*$/i, '').trim(); }
  function isSiteLevel(label) { return SITE_LEVEL.test(label); }
  function fig(key, value) { return '<span data-fig="' + key + '">' + esc(value) + '</span>'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function shortUrl(url, domain) {
    try {
      var u = new URL(url);
      var p = u.pathname + (u.search || '');
      return (u.hostname.replace(/^www\./, '') === String(domain).replace(/^www\./, '')) ? p : u.hostname + p;
    } catch (e) { return String(url); }
  }

  function longDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return String(iso || '');
    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return months[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
  }

  /* ---------------- derived figures ---------------- */

  // Everything the report states as a number, recomputed from the pages. The
  // summary the crawl engine stored is used where it has the figure; the
  // rest comes straight from the page results.
  function analyze(data) {
    var pages = data.pages || [];
    var ok = pages.filter(function (p) { return p.status === 'ok' && p.result; });
    var failed = pages.filter(function (p) { return p.status === 'failed'; });
    var pending = pages.filter(function (p) { return p.status === 'pending'; });
    var first = ok[0];

    var maxByCat = { discover: 0, tech: 0, trust: 0 };
    if (first) first.result.checks.forEach(function (c) { if (maxByCat[c.cat] !== undefined) maxByCat[c.cat] += c.max; });

    var pageRows = ok.map(function (p) {
      var fails = p.result.checks.filter(function (c) { return !c.ok && !isSiteLevel(c.label); });
      return { page: p, url: p.url, total: p.result.total, failed: fails, failedCount: fails.length };
    });
    pageRows.sort(function (a, b) { return a.total - b.total || b.failedCount - a.failedCount || (a.url < b.url ? -1 : 1); });

    var agg = {};
    var order = [];
    ok.forEach(function (p) {
      p.result.checks.forEach(function (c) {
        if (isSiteLevel(c.label)) return;
        var k = c.label;
        if (!agg[k]) { agg[k] = { label: k, cat: c.cat, max: c.max, failing: 0, passing: 0 }; order.push(k); }
        if (c.ok) agg[k].passing++; else agg[k].failing++;
      });
    });
    var checks = order.map(function (k) { return agg[k]; }).sort(function (a, b) { return b.failing - a.failing || (a.label < b.label ? -1 : 1); });

    // Site-level checks, read once from the first page that was fetched.
    var siteChecks = first ? first.result.checks.filter(function (c) { return isSiteLevel(c.label); }) : [];

    var s = data.summary || {};
    var avg = ok.length ? Math.round(ok.reduce(function (n, p) { return n + p.result.total; }, 0) / ok.length) : null;
    var home = ok.filter(function (p) { return p.url === (pages[0] && pages[0].url); })[0];
    var homeScore = home ? home.result.total : null;

    // Pass on the homepage, fail on most other pages.
    var others = home ? ok.filter(function (p) { return p !== home; }) : [];
    var hiddenGaps = [];
    if (home && others.length) {
      home.result.checks.forEach(function (hc) {
        if (!hc.ok || isSiteLevel(hc.label)) return;
        var n = 0;
        others.forEach(function (p) {
          var m = p.result.checks.filter(function (c) { return c.label === hc.label; })[0];
          if (m && !m.ok) n++;
        });
        if (n / others.length > 0.5) hiddenGaps.push({ label: hc.label, failing: n, of: others.length });
      });
      hiddenGaps.sort(function (a, b) { return b.failing - a.failing || (a.label < b.label ? -1 : 1); });
    }

    return {
      pages: pages, ok: ok, failed: failed, pending: pending, pageRows: pageRows, checks: checks, siteChecks: siteChecks,
      maxByCat: maxByCat, avg: avg, homeScore: homeScore,
      gap: (avg !== null && homeScore !== null) ? avg - homeScore : null,
      pillarAvg: {
        discover: s.averageDiscoverability, tech: s.averageTechnical, trust: s.averageTrust
      },
      hiddenGaps: hiddenGaps
    };
  }

  /* ---------------- markup ---------------- */

  function bar(value, max, cls) {
    var pct = max > 0 ? Math.max(0, Math.min(100, Math.round(value / max * 100))) : 0;
    return '<span class="rp-bar' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><span class="rp-bar__fill" style="width:' + pct + '%"></span></span>';
  }

  function gapSentence(a) {
    if (a.avg === null) return 'No page could be read, so there is no score.';
    if (a.homeScore === null) return 'The homepage could not be read, so it has no score to compare with. The ' + plural(a.ok.length, 'page', 'pages') + ' that could be read average ' + a.avg + '.';
    if (a.gap === 0) return 'The homepage scores ' + a.homeScore + ' and the average across ' + plural(a.ok.length, 'page', 'pages') + ' is also ' + a.avg + '.';
    var diff = Math.abs(a.gap);
    return 'The homepage scores ' + a.homeScore + '. The average across ' + plural(a.ok.length, 'page', 'pages') + ' is ' + a.avg + ', ' + plural(diff, 'point', 'points') + (a.gap < 0 ? ' lower' : ' higher') + '. A scan of the homepage alone would not show that.';
  }

  function summaryColumn(data, a) {
    var h = '<aside class="rp-summary" aria-label="Summary">\n';
    h += '  <p class="rp-kicker">Site-wide score</p>\n';
    h += '  <p class="rp-score"><span class="rp-score__num">' + fig('avg', a.avg === null ? '–' : a.avg) + '</span><span class="rp-score__of">/100</span></p>\n';
    h += '  <p class="rp-score__sub">average of ' + fig('pagesRead', a.ok.length) + ' pages read</p>\n';
    h += '  <dl class="rp-facts">\n';
    h += '    <div><dt>Homepage only</dt><dd>' + fig('homeScore', a.homeScore === null ? '–' : a.homeScore) + '</dd></div>\n';
    h += '    <div><dt>Gap</dt><dd>' + fig('gap', a.gap === null ? '–' : (a.gap > 0 ? '+' + a.gap : a.gap)) + '</dd></div>\n';
    h += '    <div><dt>Not fetched</dt><dd>' + fig('pagesFailed', a.failed.length) + '</dd></div>\n';
    h += '  </dl>\n';
    h += '  <p class="rp-gap">' + esc(gapSentence(a)) + '</p>\n';
    h += '  <p class="rp-kicker rp-kicker--spaced">Three pillars, site average</p>\n  <ul class="rp-pillars">\n';
    PILLARS.forEach(function (p) {
      var v = a.pillarAvg[p.cat];
      if (v === undefined || v === null) return;
      h += '    <li><span class="rp-pillars__name">' + esc(p.name) + '</span>' + bar(v, a.maxByCat[p.cat]) +
        '<span class="rp-pillars__val">' + fig('pillar-' + p.cat, v) + '/' + a.maxByCat[p.cat] + '</span></li>\n';
    });
    h += '  </ul>\n</aside>\n';
    return h;
  }

  function pagesTable(data, a) {
    var h = '<section class="rp-section" aria-labelledby="rp-pages-h">\n  <h2 id="rp-pages-h" class="rp-h2">Pages, worst first</h2>\n';
    var pageLevel = a.ok.length ? a.ok[0].result.checks.filter(function (c) { return !isSiteLevel(c.label); }).length : 0;
    h += '  <p class="rp-note">Failed checks counts the ' + pageLevel + ' checks that belong to a page. The ' + a.siteChecks.length + ' site-level checks are listed once, below.</p>\n';
    h += '  <div class="rp-tablewrap"><table class="rp-table" data-sortable>\n    <thead><tr><th scope="col" data-sort="text">Page</th><th scope="col" data-sort="num" class="rp-num">Score</th><th scope="col" data-sort="num" class="rp-num">Failed checks</th></tr></thead>\n    <tbody>\n';
    a.pageRows.forEach(function (r, i) {
      h += '      <tr><td data-v="' + esc(shortUrl(r.url, data.domain)) + '"><a href="#rp-page-' + i + '">' + esc(shortUrl(r.url, data.domain) || '/') + '</a></td>' +
        '<td class="rp-num" data-v="' + r.total + '" data-fig="page-score">' + r.total + '</td><td class="rp-num" data-v="' + r.failedCount + '" data-fig="page-failed">' + r.failedCount + '</td></tr>\n';
    });
    h += '    </tbody>\n  </table></div>\n</section>\n';
    return h;
  }

  function checksSection(a) {
    var h = '<section class="rp-section" aria-labelledby="rp-checks-h">\n  <h2 id="rp-checks-h" class="rp-h2">Checks that fail, by number of pages</h2>\n';
    var n = a.ok.length;
    var failing = a.checks.filter(function (c) { return c.failing > 0; });
    if (!failing.length) {
      h += '  <p class="rp-note">Every page-level check passes on every page read.</p>\n';
    } else {
      h += '  <ul class="rp-checklist">\n';
      failing.forEach(function (c) {
        h += '    <li><span class="rp-checklist__text"><strong>' + esc(c.label) + '</strong> fails on ' + fig('check-failing', c.failing) + ' of ' + fig('check-of', n) + ' pages</span>' + bar(c.failing, n, 'rp-bar--risk') + '</li>\n';
      });
      h += '  </ul>\n';
    }
    var passing = a.checks.filter(function (c) { return c.failing === 0; });
    if (passing.length) h += '  <p class="rp-note">Pass on every page read: ' + passing.map(function (c) { return esc(c.label); }).join(', ') + '.</p>\n';
    h += '</section>\n';
    return h;
  }

  function hiddenSection(a) {
    var h = '<section class="rp-section" aria-labelledby="rp-hidden-h">\n  <h2 id="rp-hidden-h" class="rp-h2">Pass on the homepage, fail on most other pages</h2>\n';
    if (a.homeScore === null) {
      h += '  <p class="rp-note">The homepage could not be read, so this comparison is not available.</p>\n';
    } else if (!a.hiddenGaps.length) {
      h += '  <p class="rp-note">No check passes on the homepage and fails on most other pages.</p>\n';
    } else {
      h += '  <p class="rp-note">A single-page scan reads the homepage only, so it cannot see these.</p>\n  <ul class="rp-checklist">\n';
      a.hiddenGaps.forEach(function (g) {
        h += '    <li><span class="rp-checklist__text"><strong>' + esc(g.label) + '</strong> passes on the homepage and fails on ' + fig('hidden-failing', g.failing) + ' of ' + fig('hidden-of', g.of) + ' other pages</span>' + bar(g.failing, g.of, 'rp-bar--risk') + '</li>\n';
      });
      h += '  </ul>\n';
    }
    h += '</section>\n';
    return h;
  }

  function siteSection(data, a) {
    var h = '<section class="rp-section" aria-labelledby="rp-site-h">\n  <h2 id="rp-site-h" class="rp-h2">Site-level checks</h2>\n  <p class="rp-note">These describe the whole site and read the same on every page.</p>\n  <ul class="rp-sitechecks">\n';
    a.siteChecks.forEach(function (c) {
      h += '    <li class="' + (c.ok ? 'is-pass' : 'is-fail') + '"><span class="rp-sitechecks__state">' + (c.ok ? 'Pass' : 'Fails') + '</span><span><strong>' + esc(cleanLabel(c.label)) + '</strong>' + (c.ok ? '' : ' <span class="rp-sitechecks__advice">' + esc(c.advice || '') + '</span>') + '</span></li>\n';
    });
    h += '  </ul>\n';
    var bots = (data.siteContext && data.siteContext.botResults) || [];
    var notOpen = bots.filter(function (b) { return b.state !== 'open'; });
    if (notOpen.length) {
      var lines = ['# Allows the AI crawlers that are limited or blocked today'];
      notOpen.forEach(function (b) { lines.push('User-agent: ' + b.name); lines.push('Allow: /'); lines.push(''); });
      lines.pop();
      h += '  <p class="rp-note">' + plural(notOpen.length, 'AI crawler has', 'AI crawlers have') + ' at least one Disallow rule that applies. That is often an ordinary path such as an admin area, not a block on the site. The scan gives it half credit.</p>\n';
      h += '  <details class="rp-snippet"><summary>Copy-paste fix: robots.txt</summary><pre class="rp-code">' + esc(lines.join('\n')) + '</pre></details>\n';
    }
    h += '</section>\n';
    return h;
  }

  function failedSection(data, a) {
    var h = '<section class="rp-section" aria-labelledby="rp-failed-h">\n  <h2 id="rp-failed-h" class="rp-h2">Pages that could not be fetched: ' + fig('failedCount', a.failed.length) + '</h2>\n';
    if (!a.failed.length) {
      h += '  <p class="rp-note">None. Every page in the crawl was fetched.</p>\n';
    } else {
      h += '  <ul class="rp-failedlist">\n';
      a.failed.forEach(function (p) { h += '    <li><code>' + esc(shortUrl(p.url, data.domain)) + '</code> <span class="rp-failedlist__why">' + esc(p.error || 'unreachable') + '</span></li>\n'; });
      h += '  </ul>\n';
    }
    if (a.pending.length) h += '  <p class="rp-note">' + plural(a.pending.length, 'page is', 'pages are') + ' still waiting to be read.</p>\n';
    h += '</section>\n';
    return h;
  }

  function detailSection(data, a, opts) {
    var schema = opts && opts.schema;
    var h = '<section class="rp-section" aria-labelledby="rp-detail-h">\n  <h2 id="rp-detail-h" class="rp-h2">Page detail</h2>\n  <p class="rp-note">Each page with its failed checks, what to do, and copy-paste fixes where Answerable can write one.</p>\n  <div class="rp-details">\n';
    a.pageRows.forEach(function (r, i) {
      var p = r.page;
      h += '    <details class="rp-page" id="rp-page-' + i + '"><summary><span class="rp-page__url">' + esc(shortUrl(r.url, data.domain) || '/') + '</span><span class="rp-page__meta">score ' + r.total + ', ' + plural(r.failedCount, 'failed check', 'failed checks') + '</span></summary>\n';
      if (!r.failed.length) {
        h += '      <p class="rp-note">No page-level check fails here.</p>\n';
      } else {
        h += '      <ul class="rp-fails">\n';
        r.failed.forEach(function (c) {
          h += '        <li><strong>' + esc(c.label) + '</strong> <span class="rp-fails__pts">' + c.pts + '/' + c.max + '</span><br /><span class="rp-fails__advice">' + esc(c.advice || '') + '</span>' + (c.why ? ' <span class="rp-fails__why">' + esc(c.why) + '</span>' : '') + '</li>\n';
        });
        h += '      </ul>\n';
        if (schema) {
          var labels = r.failed.map(function (c) { return c.label; });
          var info = p.siteInfo || {};
          if (labels.indexOf('Organization / WebSite schema') !== -1) {
            h += '      <details class="rp-snippet"><summary>Copy-paste fix: Organization and WebSite JSON-LD</summary><pre class="rp-code">' + esc(schema.toScriptTag(schema.buildFromSite('organization', data.domain, info))) + '</pre></details>\n';
          }
          if (labels.indexOf('Content schema (Article, FAQ…)') !== -1) {
            h += '      <details class="rp-snippet"><summary>Copy-paste fix: Article JSON-LD</summary><pre class="rp-code">' + esc(schema.toScriptTag(schema.buildFromSite('article', data.domain, info))) + '</pre></details>\n';
          }
        }
      }
      h += '    </details>\n';
    });
    h += '  </div>\n</section>\n';
    return h;
  }

  // The whole report: a summary column and the main panel.
  function render(data, opts) {
    opts = opts || {};
    var a = analyze(data);
    var h = '<div class="rp-report" data-domain="' + esc(data.domain) + '">\n';
    h += '<header class="rp-head"><p class="rp-kicker">AI readiness report, full site</p><h1 class="rp-title">' + esc(data.domain) + '</h1>' +
      '<p class="rp-meta">Crawled ' + esc(longDate(data.createdAt)) + '. ' + fig('pagesRead2', a.ok.length) + ' pages read' + (a.failed.length ? ', ' + a.failed.length + ' not fetched' : '') + '. One crawl, one date.</p></header>\n';
    h += '<div class="rp-layout">\n' + summaryColumn(data, a) + '<div class="rp-main">\n';
    if (!a.ok.length) {
      h += failedSection(data, a);
    } else {
      h += pagesTable(data, a) + checksSection(a) + hiddenSection(a) + siteSection(data, a) + failedSection(data, a) + detailSection(data, a, opts);
    }
    h += '</div>\n</div>\n</div>\n';
    return h;
  }

  return { render: render, analyze: analyze, isSiteLevel: isSiteLevel, cleanLabel: cleanLabel, longDate: longDate, shortUrl: shortUrl };
}));
