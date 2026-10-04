/* =====================================================================
   lib/report-render.js — turns one crawl result into the report markup.

   Loaded two ways, like lib/playbooks.js and lib/schema.js (UMD, no build):
     - in Node by scripts/generate-sample-report.js, which writes the static
       /sample-report page
     - as a browser <script> by the dashboard (app/report.html), which sets
       window.ANSWERABLE_REPORT and renders a job fetched from
       /api/crawl-result, or the demo fixture
   Both call render(), so the sample and the dashboard cannot drift.

   The output is the whole report as static HTML: every section is present
   and readable with no JavaScript, in a fixed order, because the sample page
   is public and crawlers read it. lib/report-ui.js adds the tabs, the
   master-detail page list, filters, collapsing and copy buttons on top, and
   print shows every section in order.

   Sections (tabs): Summary, Pages, Checks, Fixes, Citations.

   Every figure carries data-fig="<key>" so a test can read the markup back
   and compare it with the source JSON. Four checks describe the whole site,
   not a page (robots.txt present, llms.txt present, Sitemap declared, AI
   crawler access): they read the same on every page and are shown once.
   ===================================================================== */
(function (root, factory) {
  var dep = function (name, file) { return typeof module === 'object' && module.exports ? require(file) : root[name]; };
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(dep('ANSWERABLE_ICONS', './icons.js'), dep('ANSWERABLE_FACTS', './report-facts.js'), dep('ANSWERABLE_SUMMARY', './summary.js'), dep('ANSWERABLE_CITATION_PANEL', './citation-panel.js'));
  } else {
    root.ANSWERABLE_REPORT = factory(root.ANSWERABLE_ICONS, root.ANSWERABLE_FACTS, root.ANSWERABLE_SUMMARY, root.ANSWERABLE_CITATION_PANEL);
  }
}(typeof self !== 'undefined' ? self : this, function (ICONS, FACTS, SUMMARY, CITATION) {
  'use strict';

  var SITE_LEVEL = /^(robots\.txt present|llms\.txt present|Sitemap declared|AI crawler access)/;
  var PILLARS = [
    { cat: 'discover', name: 'Discoverability' },
    { cat: 'tech', name: 'Technical foundation' },
    { cat: 'trust', name: 'Content & trust' }
  ];
  var TABS = [
    { id: 'summary', name: 'Summary', icon: 'report' },
    { id: 'pages', name: 'Pages', icon: 'document' },
    { id: 'checks', name: 'Checks', icon: 'check' },
    { id: 'fixes', name: 'Fixes', icon: 'wrench' },
    { id: 'citations', name: 'Citations', icon: 'chat' }
  ];
  var SHORT = {
    'Canonical tag': 'Canonical', 'html lang attribute': 'Language', 'Page title': 'Title', 'Meta description': 'Description',
    'Open Graph tags': 'Open Graph', 'Structured data (JSON-LD)': 'JSON-LD', 'Single H1 heading': 'H1', 'Subheading structure (H2)': 'H2',
    'Organization / WebSite schema': 'Org schema', 'Content schema (Article, FAQ…)': 'Content schema', 'Author / about signals': 'About', 'Contact signals': 'Contact'
  };
  var COLLAPSE_OVER = 12;   // matrix groups with more rows than this start collapsed (JavaScript)
  var LIST_SHOWN = 10;      // the page list shows the worst ten until "Show all"

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function cleanLabel(label) { return String(label).replace(/\s*\(\d+\s*\/\s*\d+\s+open\)\s*$/i, '').trim(); }
  function isSiteLevel(label) { return SITE_LEVEL.test(label); }
  function fig(key, value) { return '<span data-fig="' + key + '">' + esc(value) + '</span>'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function icon(name, cls) { return ICONS ? ICONS.svg(name, { cls: cls }) : ''; }
  function pct(x) { return Math.round(x * 100) + '%'; }

  function pathOf(url, domain) {
    try {
      var u = new URL(url);
      var p = u.pathname + (u.search || '');
      return (u.hostname.replace(/^www\./, '') === String(domain).replace(/^www\./, '')) ? p : u.hostname + p;
    } catch (e) { return String(url); }
  }
  var shortUrl = pathOf;

  // Middle ellipsis on whole path segments: "/benchmarks/…/consumer-apps". The full path goes in a title.
  function midTruncate(path, max) {
    max = max || 34;
    if (path.length <= max) return path;
    var segs = path.split('/').filter(Boolean);
    if (segs.length <= 2) return path.slice(0, max - 1) + '…';
    var out = '/' + segs[0] + '/…/' + segs[segs.length - 1];
    if (out.length > max) {
      var last = segs[segs.length - 1];
      var room = max - ('/' + segs[0] + '/…/').length - 1;
      out = '/' + segs[0] + '/…/' + (room > 3 ? '…' + last.slice(-room) : last.slice(-3));
    }
    return out;
  }

  function longDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return String(iso || '');
    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return months[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
  }

  /* ---------------- derived figures (page order and per-page rows) ---------------- */

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

    var siteChecks = first ? first.result.checks.filter(function (c) { return isSiteLevel(c.label); }) : [];
    var s = data.summary || {};
    var avg = ok.length ? Math.round(ok.reduce(function (n, p) { return n + p.result.total; }, 0) / ok.length) : null;
    var home = ok.filter(function (p) { return p.url === (pages[0] && pages[0].url); })[0];
    var homeScore = home ? home.result.total : null;
    return {
      pages: pages, ok: ok, failed: failed, pending: pending, pageRows: pageRows, siteChecks: siteChecks, maxByCat: maxByCat,
      avg: avg, homeScore: homeScore, gap: (avg !== null && homeScore !== null) ? avg - homeScore : null,
      pillarAvg: { discover: s.averageDiscoverability, tech: s.averageTechnical, trust: s.averageTrust }
    };
  }

  /* ---------------- shared bits ---------------- */

  function bar(value, max, cls) {
    var p = max > 0 ? Math.max(0, Math.min(100, Math.round(value / max * 100))) : 0;
    return '<span class="rp-bar' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><span class="rp-bar__fill" style="width:' + p + '%"></span></span>';
  }

  // The navy bar: wordmark, domain, crawl date, a label where it applies, Print.
  function topBar(info) {
    info = info || {};
    return '<header class="rp-top"><div class="rp-top__inner">' +
      '<a class="logo rp-top__logo" href="/" aria-label="Answerable. home"><span class="logo__mark">Answerable<span class="logo__dot">.</span></span></a>' +
      '<div class="rp-top__meta">' +
      (info.domain ? '<span class="rp-top__domain">' + esc(info.domain) + '</span>' : '') +
      (info.date ? '<span class="rp-top__date">Crawled ' + esc(longDate(info.date)) + '</span>' : '') +
      (info.label ? '<span class="rp-top__label">' + esc(info.label) + '</span>' : '') +
      '</div>' +
      (info.print === false ? '' : '<button type="button" class="rp-top__print" data-action="print" hidden>' + icon('printer') + 'Print or save as PDF</button>') +
      '</div></header>\n';
  }

  /* ---------------- SUMMARY ---------------- */

  function summaryPanel(data, a, f, summary) {
    var h = '<section class="rp-panel" id="rp-summary" data-tab="summary" aria-labelledby="rp-summary-h">\n';
    h += '<h2 id="rp-summary-h" class="rp-h2 rp-h2--panel">' + icon('report') + 'Summary</h2>\n';

    // Executive summary card first.
    h += '<article class="rp-exec" aria-labelledby="rp-exec-h"><p class="rp-kicker" id="rp-exec-h">Executive summary</p>\n';
    h += '<p class="rp-exec__headline">' + esc(summary.headline) + '</p>\n';
    h += '<p class="rp-exec__text">' + esc(summary.situation) + '</p>\n';
    h += '<p class="rp-exec__label" data-fig="summary-label">' + esc(summary.label) + '</p>\n</article>\n';

    // Four KPI tiles.
    h += '<ul class="rp-kpis">\n';
    h += '<li class="rp-kpi"><span class="rp-kpi__num">' + fig('avg', a.avg === null ? '–' : a.avg) + '</span><span class="rp-kpi__label">Site-wide score<br /><small>average of ' + fig('pagesRead', a.ok.length) + ' pages, out of 100</small></span></li>\n';
    h += '<li class="rp-kpi"><span class="rp-kpi__num">' + fig('homeScore', a.homeScore === null ? '–' : a.homeScore) + '</span><span class="rp-kpi__label">Homepage score<br /><small>what a single-page scan reports</small></span></li>\n';
    h += '<li class="rp-kpi"><span class="rp-kpi__num">' + fig('gap', a.gap === null ? '–' : (a.gap > 0 ? '+' + a.gap : String(a.gap))) + '</span><span class="rp-kpi__label">Gap<br /><small>site-wide minus homepage, in points</small></span></li>\n';
    h += '<li class="rp-kpi"><span class="rp-kpi__num">' + fig('kpi-failing', f.verdict.pagesWithAFailure) + '</span><span class="rp-kpi__label">Pages with a failure<br /><small>of ' + a.ok.length + ' read, at least one page-level check</small></span></li>\n';
    h += '</ul>\n';
    h += '<p class="rp-note rp-notrow">' + fig('pagesFailed', a.failed.length) + (a.failed.length === 1 ? ' page' : ' pages') + ' could not be fetched. The three pillars, site average: ' +
      PILLARS.map(function (p) { var v = a.pillarAvg[p.cat]; return v === undefined || v === null ? '' : esc(p.name) + ' ' + fig('pillar-' + p.cat, v) + '/' + a.maxByCat[p.cat]; }).filter(Boolean).join(', ') + '.</p>\n';

    // Top three priorities.
    h += '<h3 class="rp-h3">Where to start</h3>\n';
    if (!summary.priorities.length) {
      h += '<p class="rp-note">No check is worth a priority: nothing fails, or only the half credit for ordinary crawler rules.</p>\n';
    } else {
      h += '<ol class="rp-priorities">\n';
      summary.priorities.forEach(function (p, i) {
        h += '<li class="rp-priority"><h4 class="rp-priority__title">' + esc(p.title) + '</h4>' +
          '<p class="rp-priority__why">' + esc(p.why) + '</p>' +
          '<p class="rp-priority__where">' + esc(p.where) + '</p>' +
          '<p class="rp-chips"><span class="rp-chip rp-chip--gain">+' + fig('priority-gain', p.gain_pts) + ' points</span><span class="rp-chip">' + esc(p.effort) + '</span></p></li>\n';
      });
      h += '</ol>\n';
    }

    h += '<h3 class="rp-h3">What already works</h3>\n<p class="rp-text">' + esc(summary.working) + '</p>\n';
    if (summary.caveats && summary.caveats.length) {
      h += '<h3 class="rp-h3">Caveats</h3>\n<ul class="rp-caveats">' + summary.caveats.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>\n';
    }
    h += heatMatrix(data, a, f);
    h += '</section>\n';
    return h;
  }

  function heatMatrix(data, a, f) {
    var cols = a.ok[0] ? a.ok[0].result.checks.filter(function (c) { return !isSiteLevel(c.label); }).map(function (c) { return { label: cleanLabel(c.label), full: c }; }) : [];
    var index = {};
    a.pageRows.forEach(function (r, i) { index[r.url] = i; });
    var byUrl = {};
    a.ok.forEach(function (p) { byUrl[p.url] = p; });
    var shared = {};
    f.checks.forEach(function (c) { shared[c.label] = c; });

    var h = '<h3 class="rp-h3" id="rp-matrix-h">Which pages fail which checks</h3>\n';
    h += '<p class="rp-note">One row per page, grouped by section and by the exact set of checks failing. A filled square is a failing check, a hollow one is a pass. A column filled all the way down is likely a shared template: that is an inference from how many pages fail, not something we observed.</p>\n';
    h += '<div class="rp-matrixwrap"><table class="rp-matrix" aria-labelledby="rp-matrix-h">\n<thead><tr><th scope="col" class="rp-matrix__corner">Page</th>';
    cols.forEach(function (c) {
      var sc = shared[c.label];
      var all = sc && sc.failingPages === a.ok.length && a.ok.length > 0;
      h += '<th scope="col" class="rp-colhead' + (all ? ' rp-colhead--all' : '') + '"><span class="rp-colhead__text" title="' + esc(c.label) + '">' + esc(SHORT[c.label] || c.label) + '</span></th>';
    });
    h += '</tr></thead>\n';
    f.clustersAll.forEach(function (g, gi) {
      h += '<tbody class="rp-cluster" data-rows="' + g.urls.length + '"><tr class="rp-cluster__head"><th scope="rowgroup" colspan="' + (cols.length + 1) + '"><button type="button" class="rp-cluster__toggle" data-toggle-cluster hidden aria-expanded="true">' + icon('arrow') + '</button><span class="rp-cluster__name">' + esc(g.prefix) + '</span><span class="rp-cluster__meta">' + plural(g.pages, 'page', 'pages') + ', average ' + g.avgScore + (g.failing.length ? '' : ', no failing checks') + '</span></th></tr>\n';
      g.urls.slice().sort().forEach(function (u) {
        var p = byUrl[u];
        var i = index[u];
        var path = pathOf(u, data.domain) || '/';
        h += '<tr class="rp-matrix__row"><th scope="row"><a href="#rp-item-' + i + '" data-page="' + i + '" title="' + esc(path) + '">' + esc(midTruncate(path, 30)) + '</a></th>';
        cols.forEach(function (c) {
          var chk = p.result.checks.filter(function (x) { return cleanLabel(x.label) === c.label; })[0];
          var fails = chk && !chk.ok;
          var sc = shared[c.label];
          var colAll = sc && sc.failingPages === a.ok.length;
          h += '<td class="' + (colAll ? 'rp-cell-col--all' : '') + '"><span class="rp-cell ' + (fails ? 'rp-cell--fail' : 'rp-cell--pass') + '" data-cell="' + (fails ? 'fail' : 'pass') + '"><span class="rp-vh">' + (fails ? 'fails' : 'passes') + '</span></span></td>';
        });
        h += '</tr>\n';
      });
      h += '</tbody>\n';
    });
    h += '<tfoot><tr><th scope="row">Pages failing</th>';
    cols.forEach(function (c) {
      var sc = shared[c.label];
      var n = sc ? sc.failingPages : 0;
      h += '<td class="rp-colfoot' + (n === a.ok.length && n > 0 ? ' rp-colfoot--all' : '') + '">' + fig('matrix-col-failing', n) + '<span class="rp-colfoot__of">/' + a.ok.length + '</span></td>';
    });
    h += '</tr></tfoot></table></div>\n';
    return h;
  }

  /* ---------------- PAGES ---------------- */

  function detailBlock(r, f, data) {
    var p = r.page;
    var h = '<div class="rp-detail"><p class="rp-detail__top"><span class="rp-detail__score"><strong>' + r.total + '</strong><span>/100</span></span>' +
      '<a class="rp-detail__open" href="' + esc(r.url) + '" target="_blank" rel="noopener">Open this page' + icon('external') + '</a></p>\n';
    if (!r.failed.length) {
      h += '<p class="rp-note">No page-level check fails here.</p>\n';
    } else {
      h += '<ul class="rp-fails">\n';
      r.failed.forEach(function (c) {
        h += '<li><strong>' + esc(c.label) + '</strong> <span class="rp-fails__pts">' + c.pts + '/' + c.max + '</span><br /><span class="rp-fails__advice">' + esc(c.advice || '') + '</span>' + (c.why ? ' <span class="rp-fails__why">' + esc(c.why) + '</span>' : '') + '</li>\n';
      });
      h += '</ul>\n';
    }
    var mine = f.fixes.filter(function (x) { return x.pages.indexOf(r.url) !== -1 && x.kind !== 'robots'; });
    mine.forEach(function (x) {
      h += '<details class="rp-snippet"><summary>Copy-paste fix: ' + esc(x.label) + '</summary><pre class="rp-code">' + esc(x.code) + '</pre></details>\n';
    });
    h += '</div>';
    return h;
  }

  function pagesPanel(data, a, f) {
    var sections = {};
    a.pageRows.forEach(function (r) { var seg = (pathOf(r.url, data.domain).split('/').filter(Boolean)[0]); sections[seg ? '/' + seg : '/'] = true; });
    var checkLabels = f.checks.filter(function (c) { return !c.siteLevel && c.failingPages > 0; }).map(function (c) { return c.label; });

    var h = '<section class="rp-panel" id="rp-pages" data-tab="pages" aria-labelledby="rp-pages-h">\n';
    h += '<h2 id="rp-pages-h" class="rp-h2 rp-h2--panel">' + icon('document') + 'Pages</h2>\n';
    h += '<p class="rp-note">Worst first. Failed checks counts the ' + (a.ok[0] ? a.ok[0].result.checks.filter(function (c) { return !isSiteLevel(c.label); }).length : 0) + ' checks that belong to a page. The ' + a.siteChecks.length + ' site-level checks are on the Checks tab.</p>\n';

    // Controls (the script unhides them; without it the full list is simply there).
    h += '<div class="rp-controls" hidden>' +
      '<label class="rp-field rp-field--search"><span class="rp-vh">Search pages</span>' + icon('search') + '<input type="search" class="rp-input" data-filter="q" placeholder="Search pages" autocomplete="off" /></label>' +
      '<div class="rp-chiprow" role="group" aria-label="Filter pages">' +
      '<button type="button" class="rp-filterchip is-on" data-filter-all aria-pressed="true">All</button>' +
      '<label class="rp-select"><span class="rp-vh">Failing a chosen check</span><select data-filter="check"><option value="">Failing a check…</option>' + checkLabels.map(function (l) { return '<option value="' + esc(l) + '">' + esc(l) + '</option>'; }).join('') + '</select></label>' +
      '<label class="rp-select"><span class="rp-vh">Section</span><select data-filter="section"><option value="">Section…</option>' + Object.keys(sections).sort().map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('') + '</select></label>' +
      '</div>' +
      '<label class="rp-select rp-select--sort"><span class="rp-vh">Sort</span><select data-filter="sort"><option value="score">Sort: score, lowest first</option><option value="failed">Sort: most failed checks</option><option value="path">Sort: path</option></select></label>' +
      '</div>\n';

    h += '<div class="rp-pages"><ul class="rp-list" data-shown="' + LIST_SHOWN + '">\n';
    a.pageRows.forEach(function (r, i) {
      var path = pathOf(r.url, data.domain) || '/';
      var seg = path.split('/').filter(Boolean)[0];
      h += '<li class="rp-item' + (i >= LIST_SHOWN ? ' rp-more' : '') + '" id="rp-item-' + i + '" data-index="' + i + '" data-path="' + esc(path) + '" data-score="' + r.total + '" data-failed="' + r.failedCount + '" data-section="' + esc(seg ? '/' + seg : '/') + '" data-checks="' + esc(r.failed.map(function (c) { return c.label; }).join('|')) + '">' +
        '<a class="rp-item__row" href="#rp-item-' + i + '"><span class="rp-item__path" title="' + esc(path) + '">' + esc(midTruncate(path, 34)) + '</span>' +
        '<span class="rp-item__score" data-fig="page-score">' + r.total + '</span><span class="rp-item__failed"><span data-fig="page-failed">' + r.failedCount + '</span> failed</span></a>\n' +
        detailBlock(r, f, data) + '\n</li>\n';
    });
    h += '</ul>\n<div class="rp-pane" data-pane hidden aria-live="polite"><p class="rp-note">Select a page to see its failed checks.</p></div></div>\n';
    h += '<p class="rp-more-wrap" hidden><button type="button" class="rp-showall" data-show-all>Show all ' + a.pageRows.length + '</button></p>\n';
    h += '<p class="rp-empty" data-empty hidden>No page matches.</p>\n';

    h += '<h3 class="rp-h3" id="rp-failed-h">Pages that could not be fetched: ' + fig('failedCount', a.failed.length) + '</h3>\n';
    if (!a.failed.length) {
      h += '<p class="rp-note">None. Every page in the crawl was fetched.</p>\n';
    } else {
      h += '<ul class="rp-failedlist">\n';
      a.failed.forEach(function (p) { h += '<li><code>' + esc(pathOf(p.url, data.domain)) + '</code> <span class="rp-failedlist__why">' + esc(p.error || 'unreachable') + '</span></li>\n'; });
      h += '</ul>\n';
    }
    if (a.pending.length) h += '<p class="rp-note">' + plural(a.pending.length, 'page is', 'pages are') + ' still waiting to be read.</p>\n';
    h += '</section>\n';
    return h;
  }

  /* ---------------- CHECKS ---------------- */

  function checksPanel(data, a, f) {
    var n = a.ok.length;
    var linkTo = {};
    a.pageRows.forEach(function (r, i) { linkTo[r.url] = i; });
    var whyOf = {};
    a.ok.forEach(function (p) { p.result.checks.forEach(function (c) { var k = cleanLabel(c.label); if (!whyOf[k]) whyOf[k] = c; }); });

    var h = '<section class="rp-panel" id="rp-checks" data-tab="checks" aria-labelledby="rp-checks-h">\n';
    h += '<h2 id="rp-checks-h" class="rp-h2 rp-h2--panel">' + icon('check') + 'Checks</h2>\n';

    // Pass on the homepage, fail on most other pages: the finding a single-page scan cannot produce.
    var home = a.ok.filter(function (p) { return p.url === (a.pages[0] && a.pages[0].url); })[0];
    var hidden = [];
    if (home && n > 1) {
      f.checks.forEach(function (c) {
        if (c.siteLevel || c.passesOnHomepage !== true) return;
        var others = n - 1;
        var failOthers = c.failingPages; // it passes on the homepage, so every failing page is another page
        if (failOthers / others > 0.5) hidden.push({ label: c.label, failing: failOthers, of: others });
      });
      hidden.sort(function (x, y) { return y.failing - x.failing || (x.label < y.label ? -1 : 1); });
    }
    h += '<h3 class="rp-h3">Pass on the homepage, fail on most other pages</h3>\n';
    if (a.homeScore === null) h += '<p class="rp-note">The homepage could not be read, so this comparison is not available.</p>\n';
    else if (!hidden.length) h += '<p class="rp-note">No check passes on the homepage and fails on most other pages.</p>\n';
    else {
      h += '<p class="rp-note">A single-page scan reads the homepage only, so it cannot see these.</p><ul class="rp-checklist">\n';
      hidden.forEach(function (g) {
        h += '<li><span class="rp-checklist__text"><strong>' + esc(g.label) + '</strong> passes on the homepage and fails on ' + fig('hidden-failing', g.failing) + ' of ' + fig('hidden-of', g.of) + ' other pages</span>' + bar(g.failing, g.of) + '</li>\n';
      });
      h += '</ul>\n';
    }

    h += '<h3 class="rp-h3">Checks that fail, by number of pages</h3>\n';
    var failing = f.checks.filter(function (c) { return !c.siteLevel && c.failingPages > 0; });
    if (!failing.length) h += '<p class="rp-note">Every page-level check passes on every page read.</p>\n';
    failing.forEach(function (c) {
      var w = whyOf[c.label] || {};
      var shown = c.pages.slice(0, 5), rest = c.pages.slice(5);
      var link = function (u) { return '<li><a href="#rp-item-' + linkTo[u] + '" data-page="' + linkTo[u] + '" title="' + esc(pathOf(u, data.domain)) + '">' + esc(midTruncate(pathOf(u, data.domain) || '/', 40)) + '</a></li>'; };
      h += '<details class="rp-check" data-check="' + esc(c.label) + '"><summary><span class="rp-check__name">' + esc(c.label) + '</span><span class="rp-check__count"><span data-fig="check-failing">' + c.failingPages + '</span> of <span data-fig="check-of">' + n + '</span> pages</span>' + bar(c.failingPages, n) + '</summary>\n';
      h += '<div class="rp-check__body"><p class="rp-check__why"><strong>Why it matters.</strong> ' + esc(w.why || '') + ' ' + esc(w.advice || '') + '.</p>\n';
      h += '<p class="rp-chips"><span class="rp-chip rp-chip--gain">+<span data-fig="check-gain">' + c.gainIfFixedEverywhere + '</span> points if fixed everywhere</span><span class="rp-chip">typically ' + esc(c.effort.label) + '</span>' + (c.passesOnHomepage ? '<span class="rp-chip">passes on the homepage</span>' : '') + '</p>\n';
      if (c.likelyShared) h += '<p class="rp-inference">This check fails on ' + pct(c.failingShare) + ' of pages. That is likely a shared template. It is an inference from how many pages fail, not something we observed.</p>\n';
      h += '<p class="rp-check__pages"><strong>Pages affected</strong></p><ul class="rp-pagelist">' + shown.map(link).join('') + '</ul>\n';
      if (rest.length) h += '<details class="rp-subdetails"><summary>Show all ' + c.failingPages + '</summary><ul class="rp-pagelist">' + rest.map(link).join('') + '</ul></details>\n';
      h += '</div></details>\n';
    });
    var passing = f.checks.filter(function (c) { return !c.siteLevel && c.failingPages === 0; });
    if (passing.length) h += '<p class="rp-note">Pass on every page read: ' + passing.map(function (c) { return esc(c.label); }).join(', ') + '.</p>\n';

    // Site-level checks, once.
    h += '<h3 class="rp-h3">Site-level checks</h3>\n<p class="rp-note">These describe the whole site and read the same on every page.</p>\n<ul class="rp-sitechecks">\n';
    a.siteChecks.forEach(function (c) {
      h += '<li class="' + (c.ok ? 'is-pass' : 'is-fail') + '"><span class="rp-sitechecks__state">' + (c.ok ? 'Pass' : 'Fails') + '</span><span><strong>' + esc(cleanLabel(c.label)) + '</strong>' + (c.ok ? '' : ' <span class="rp-sitechecks__advice">' + esc(c.advice || '') + '</span>') + '</span></li>\n';
    });
    h += '</ul>\n';
    if (f.crawlers.limited || f.crawlers.blocked) {
      h += '<p class="rp-note">' + plural(f.crawlers.limited + f.crawlers.blocked, 'AI crawler has', 'AI crawlers have') + ' at least one Disallow rule that applies. That is often an ordinary path such as an admin area, not a block on the site. The scan gives it half credit.</p>\n';
    }
    h += '</section>\n';
    return h;
  }

  /* ---------------- FIXES ---------------- */

  function fixesPanel(data, a, f) {
    var linkTo = {};
    a.pageRows.forEach(function (r, i) { linkTo[r.url] = i; });
    var h = '<section class="rp-panel" id="rp-fixes" data-tab="fixes" aria-labelledby="rp-fixes-h">\n';
    h += '<h2 id="rp-fixes-h" class="rp-h2 rp-h2--panel">' + icon('wrench') + 'Fixes</h2>\n';
    if (!f.fixes.length) {
      h += '<p class="rp-note">No copy-paste fix applies. Answerable writes JSON-LD for the Organization and Article checks, and a robots.txt block when a crawler is limited or blocked.</p>\n';
    } else {
      h += '<p class="rp-note">Each distinct snippet appears once, with the pages it applies to. The JSON-LD uses placeholders where a fact is unknown. Fill them in; do not publish a placeholder.</p>\n';
      f.fixes.forEach(function (x) {
        h += '<article class="rp-fix" id="rp-fix-' + x.id.replace(/^fix-/, '') + '"><div class="rp-fix__head"><h3 class="rp-fix__title">' + esc(x.label) + '</h3>' +
          '<p class="rp-fix__applies">Applies to <strong data-fig="fix-pages">' + x.pages.length + '</strong> ' + (x.pages.length === 1 ? 'page' : 'pages') + '</p>' +
          '<button type="button" class="rp-copy" data-copy hidden>' + icon('copy') + '<span>Copy</span></button></div>\n';
        h += '<pre class="rp-code">' + esc(x.code) + '</pre>\n';
        h += '<details class="rp-subdetails"><summary>Pages this applies to</summary><ul class="rp-pagelist">' + x.pages.map(function (u) { return '<li><a href="#rp-item-' + linkTo[u] + '" data-page="' + linkTo[u] + '" title="' + esc(pathOf(u, data.domain)) + '">' + esc(midTruncate(pathOf(u, data.domain) || '/', 40)) + '</a></li>'; }).join('') + '</ul></details></article>\n';
      });
    }
    h += '</section>\n';
    return h;
  }

  /* ---------------- CITATIONS ---------------- */

  function citationsPanel(data, opts) {
    var h = '<section class="rp-panel" id="rp-citations" data-tab="citations" aria-labelledby="rp-citations-h">\n';
    h += '<h2 id="rp-citations-h" class="rp-h2 rp-h2--panel">' + icon('chat') + 'Citations</h2>\n';
    // opts.citation: { result, sample } with a schema v1 citation result; absent means no run yet.
    h += CITATION.panel(opts.citation ? opts.citation.result : null, { sample: !!(opts.citation && opts.citation.sample) });
    h += '</section>\n';
    return h;
  }

  /* ---------------- the whole report ---------------- */

  // opts: { schema, facts, label ('Demo data' | 'Sample report'), citationsHtml, bar (false to omit) }
  function render(data, opts) {
    opts = opts || {};
    var a = analyze(data);
    var f = opts.facts || FACTS.facts(data, { schema: opts.schema });
    var summary = data.executiveSummary;
    if (!summary) {
      summary = SUMMARY.deterministic(f);
      summary.source = { kind: 'rules' };
      summary.label = SUMMARY.labelFor(summary.source);
    }
    var h = '<div class="rp-report" data-domain="' + esc(data.domain) + '">\n';
    if (opts.bar !== false) h += topBar({ domain: data.domain, date: data.createdAt, label: opts.label });
    h += '<div class="rp-body">\n' + (opts.bannerHtml || '');
    h += '<div class="rp-head"><p class="rp-kicker">AI readiness report, full site</p><h1 class="rp-title">' + esc(data.domain) + '</h1><p class="rp-meta">Crawled ' + esc(longDate(data.createdAt)) + '. ' + fig('pagesRead2', a.ok.length) + ' pages read' + (a.failed.length ? ', ' + a.failed.length + ' not fetched' : '') + '. One crawl, one date.</p></div>\n';
    h += '<nav class="rp-toc" aria-label="Report sections"><ul>' + TABS.map(function (t) { return '<li><a href="#rp-' + t.id + '" data-tab-link="' + t.id + '">' + icon(t.icon) + esc(t.name) + '</a></li>'; }).join('') + '</ul></nav>\n';
    if (!a.ok.length) {
      h += '<section class="rp-panel" id="rp-summary" data-tab="summary"><h2 class="rp-h2">Summary</h2><p class="rp-state">No page could be read, so there is no report. ' + plural(a.failed.length, 'page', 'pages') + ' could not be fetched.</p></section>\n';
    } else {
      h += summaryPanel(data, a, f, summary) + pagesPanel(data, a, f) + checksPanel(data, a, f) + fixesPanel(data, a, f) + citationsPanel(data, opts);
    }
    h += '</div>\n</div>\n';
    return h;
  }

  return { render: render, topBar: topBar, analyze: analyze, isSiteLevel: isSiteLevel, cleanLabel: cleanLabel, longDate: longDate, shortUrl: shortUrl, midTruncate: midTruncate, TABS: TABS, SHORT: SHORT, COLLAPSE_OVER: COLLAPSE_OVER, LIST_SHOWN: LIST_SHOWN };
}));
