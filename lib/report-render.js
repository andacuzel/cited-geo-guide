/* =====================================================================
   lib/report-render.js — turns one crawl result into the report markup.

   Loaded two ways, like lib/playbooks.js and lib/schema.js (UMD, no build):
     - in Node by scripts/generate-sample-report.js, which writes the static
       /sample-report page
     - as a browser <script> by the dashboard (app/report.html), which sets
       window.CITEHOUND_REPORT and renders a job fetched from
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
  // The requires are written out, not computed: Vercel packages only the files it can see named in a require.
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./icons.js'), require('./report-facts.js'), require('./summary.js'), require('./citation-panel.js'));
  } else {
    root.CITEHOUND_REPORT = factory(root.CITEHOUND_ICONS, root.CITEHOUND_FACTS, root.CITEHOUND_SUMMARY, root.CITEHOUND_CITATION_PANEL);
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
      '<a class="logo rp-top__logo" href="/" aria-label="Citehound home"><span class="logo__icon" aria-hidden="true"><svg viewBox="13 8.5 52 52" focusable="false"><path fill="currentColor" fill-rule="evenodd" d="M62 30 L58 28.5 L40 20 L35 17.5 L28 12 L21 15.5 Q13 32 17 57 L32 57 Q28.5 46.5 37 41 L39 38 L58 34.5 L61 32.5 Z M27.5 16.5 L16 25 L27 22.5 Z M38.4 22.9 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0 Z"/></svg></span><span class="logo__mark">Citehound</span></a>' +
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

    // Executive summary card first. data-shot marks regions that scripts/capture-pro-shots.js crops.
    h += '<div data-shot="summary">\n';
    h += '<article class="rp-exec" aria-labelledby="rp-exec-h"><p class="rp-kicker" id="rp-exec-h">Executive summary</p>\n';
    h += '<p class="rp-exec__headline">' + esc(summary.headline) + '</p>\n';
    h += '<p class="rp-exec__text">' + esc(summary.situation) + '</p>\n';
    h += '<p class="rp-exec__label" data-fig="summary-label">' + esc(summary.label) + '</p>\n</article>\n';

    // Four KPI tiles.
    h += '<ul class="rp-kpis">\n';
    h += '<li class="rp-kpi" data-kpi="avg"><span class="rp-kpi__num">' + fig('avg', a.avg === null ? '–' : a.avg) + '</span><span class="rp-kpi__label">Site-wide score<br /><small>average of ' + fig('pagesRead', a.ok.length) + ' pages, out of 100</small></span></li>\n';
    h += '<li class="rp-kpi" data-kpi="home"><span class="rp-kpi__num">' + fig('homeScore', a.homeScore === null ? '–' : a.homeScore) + '</span><span class="rp-kpi__label">Homepage score<br /><small>what a single-page scan reports</small></span></li>\n';
    h += '<li class="rp-kpi" data-kpi="gap"><span class="rp-kpi__num">' + fig('gap', a.gap === null ? '–' : (a.gap > 0 ? '+' + a.gap : String(a.gap))) + '</span><span class="rp-kpi__label">Gap<br /><small>site-wide minus homepage, in points</small></span></li>\n';
    h += '<li class="rp-kpi" data-kpi="failing"><span class="rp-kpi__num">' + fig('kpi-failing', f.verdict.pagesWithAFailure) + '</span><span class="rp-kpi__label">Pages with a failure<br /><small>of ' + a.ok.length + ' read, at least one page-level check</small></span></li>\n';
    h += '</ul>\n</div>\n';
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
    h += '<div class="rp-matrixwrap" data-shot="matrix"><table class="rp-matrix" aria-labelledby="rp-matrix-h">\n<thead><tr><th scope="col" class="rp-matrix__corner">Page</th>';
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

    h += '<div class="rp-pages" data-shot="pages"><ul class="rp-list" data-shown="' + LIST_SHOWN + '">\n';
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
      h += '<p class="rp-note">No copy-paste fix applies. Citehound writes JSON-LD for the Organization and Article checks, and a robots.txt block when a crawler is limited or blocked.</p>\n';
    } else {
      h += '<p class="rp-note">Each distinct snippet appears once, with the pages it applies to. The JSON-LD uses placeholders where a fact is unknown. Fill them in; do not publish a placeholder.</p>\n<div data-shot="fixes">\n';
      f.fixes.forEach(function (x) {
        h += '<article class="rp-fix" id="rp-fix-' + x.id.replace(/^fix-/, '') + '"><div class="rp-fix__head"><h3 class="rp-fix__title">' + esc(x.label) + '</h3>' +
          '<p class="rp-fix__applies">Applies to <strong data-fig="fix-pages">' + x.pages.length + '</strong> ' + (x.pages.length === 1 ? 'page' : 'pages') + '</p>' +
          '<button type="button" class="rp-copy" data-copy hidden>' + icon('copy') + '<span>Copy</span></button></div>\n';
        h += '<pre class="rp-code">' + esc(x.code) + '</pre>\n';
        h += '<details class="rp-subdetails"><summary>Pages this applies to</summary><ul class="rp-pagelist">' + x.pages.map(function (u) { return '<li><a href="#rp-item-' + linkTo[u] + '" data-page="' + linkTo[u] + '" title="' + esc(pathOf(u, data.domain)) + '">' + esc(midTruncate(pathOf(u, data.domain) || '/', 40)) + '</a></li>'; }).join('') + '</ul></details></article>\n';
      });
      h += '</div>\n';
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

  /* =====================================================================
     THE PRO LAYOUT (renderPro)

     One page, three parts in a fixed order, shared by the Pro report (/r/<id>/) and the public
     sample (/sample-report), so the two cannot drift:
       1. Site summary    the score, the three pillars, the main findings in plain words, scan coverage
       2. Details         per-pillar breakdown of every check, then the per-page table
       3. Estimated score the last section: one row per fix, every figure from re-running the scoring

     Words: no ranking words anywhere (scripts/test-pro-report.js greps the output for them). Lists
     whose order carries no meaning are alphabetical; the page table starts alphabetical and can be
     sorted. The estimate is ordered by points gained, which is its meaning.

     The markup is complete without JavaScript: anchors work, the tables are plain tables, every
     <details> can be opened. lib/report-pro-ui.js adds sorting, filtering, copy, email and print.
     ===================================================================== */

  var PRO_PILLARS = [
    { cat: 'discover', name: 'Discoverability', what: 'Whether AI crawlers may read the site and can find its pages.' },
    { cat: 'tech', name: 'Technical foundation', what: 'The tags and markup that tell a machine what each page is.' },
    { cat: 'trust', name: 'Content and trust', what: 'Headings, structured data and signals about who stands behind the site.' }
  ];
  var PRO_NAV = [
    { id: 'pr-summary', name: 'Summary' },
    { id: 'pr-pillars', name: 'Pillars' },
    { id: 'pr-pages', name: 'Pages' },
    { id: 'pr-estimate', name: 'Estimated score' }
  ];
  var SIGNED = function (n) { return n > 0 ? '+' + n : String(n); };
  function oneDecimal(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function byLabel(a, b) { var x = a.label.toLowerCase(), y = b.label.toLowerCase(); return x < y ? -1 : (x > y ? 1 : 0); }
  function pageStatusText(p) {
    if (p.status === 'blocked') return 'Blocked by the site' + (p.error ? ' (' + p.error + ')' : '');
    if (p.status === 'failed') return 'Not read' + (p.error ? ': ' + p.error : '');
    if (p.status === 'skipped') return 'Not read: the crawl stopped before this page';
    return 'Waiting to be read';
  }

  function analyzePro(data) {
    var pages = data.pages || [];
    var ok = pages.filter(function (p) { return p.status === 'ok' && p.result; });
    var count = function (s) { return pages.filter(function (p) { return p.status === s; }).length; };
    var mean = function (xs) { return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length : 0; };
    var first = ok[0];
    var max = { discover: 0, tech: 0, trust: 0 };
    if (first) first.result.checks.forEach(function (c) { if (max[c.cat] !== undefined) max[c.cat] += c.max; });
    var home = ok.filter(function (p) { return p.url === (pages[0] && pages[0].url); })[0] || null;
    var avg = ok.length ? Math.round(mean(ok.map(function (p) { return p.result.total; }))) : null;
    return {
      pages: pages, ok: ok, blocked: count('blocked'), failed: count('failed'), skipped: count('skipped'), pending: count('pending'),
      avg: avg, home: home ? home.result.total : null, max: max,
      pillar: {
        discover: ok.length ? Math.round(mean(ok.map(function (p) { return p.result.discover; }))) : null,
        tech: ok.length ? Math.round(mean(ok.map(function (p) { return p.result.tech; }))) : null,
        trust: ok.length ? Math.round(mean(ok.map(function (p) { return p.result.trust; }))) : null
      },
      siteChecks: first ? first.result.checks.filter(function (c) { return isSiteLevel(c.label); }) : []
    };
  }

  function proTop(opts) {
    return '<header class="pr-top"><div class="pr-top__inner">' +
      '<a class="logo rp-top__logo" href="' + esc(opts.homeHref || '/') + '" aria-label="Citehound home"><span class="logo__icon" aria-hidden="true"><svg viewBox="13 8.5 52 52" focusable="false"><path fill="currentColor" fill-rule="evenodd" d="M62 30 L58 28.5 L40 20 L35 17.5 L28 12 L21 15.5 Q13 32 17 57 L32 57 Q28.5 46.5 37 41 L39 38 L58 34.5 L61 32.5 Z M27.5 16.5 L16 25 L27 22.5 Z M38.4 22.9 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0 Z"/></svg></span><span class="logo__mark">Citehound</span></a>' +
      '<span class="pr-top__label">' + esc(opts.label || 'Pro report') + '</span></div></header>\n';
  }

  /* ----- 1. summary ----- */

  function proSummary(data, A, f, summary, opts) {
    var h = '<section class="pr-section" id="pr-summary" aria-labelledby="pr-summary-h">\n<h2 class="pr-h2" id="pr-summary-h">Site summary</h2>\n';
    h += '<div class="pr-summary" data-shot="summary">\n';

    // The score and the three pillars.
    h += '<div class="pr-score" data-shot="score"><p class="pr-score__label">Site-wide score</p>' +
      '<p class="pr-score__value"><span class="pr-score__num">' + fig('pr-score', A.avg === null ? '–' : A.avg) + '</span><span class="pr-score__of">/ 100</span></p>' +
      '<p class="pr-score__sub">Average of ' + fig('pr-pages-read', A.ok.length) + (A.ok.length === 1 ? ' page' : ' pages') + ' read' +
      (A.home !== null ? '. Homepage ' + fig('pr-home', A.home) + '.' : '. The homepage could not be read.') + '</p>' +
      '<ul class="pr-pillars" aria-label="Score by pillar">' + PRO_PILLARS.map(function (p) {
        var v = A.pillar[p.cat];
        return '<li class="pr-pillar"><span class="pr-pillar__name">' + esc(p.name) + '</span><span class="pr-pillar__val">' + (v === null ? '–' : fig('pr-pillar-' + p.cat, v)) + ' / ' + A.max[p.cat] + '</span>' + (v === null ? '' : bar(v, A.max[p.cat])) + '</li>';
      }).join('') + '</ul></div>\n';

    // The main findings, in words.
    h += '<div class="pr-findings">\n';
    h += '<p class="pr-lede">' + esc(summary.headline) + '</p>\n';
    h += '<p class="pr-text">' + esc(summary.situation) + '</p>\n';
    // Who wrote the summary is always said, as the product has always done.
    h += '<p class="pr-sumlabel" data-fig="pr-summary-label">' + esc(summary.label || SUMMARY.labelFor({ kind: 'rules' })) + '</p>\n';
    var failing = f.checks.filter(function (c) { return !c.siteLevel && c.failingPages > 0; }).sort(byLabel);
    var siteFail = A.siteChecks.filter(function (c) { return !c.ok; }).map(function (c) { return { label: cleanLabel(c.label), advice: c.advice }; }).sort(byLabel);
    h += '<h3 class="pr-h3">What we found</h3>\n';
    if (!failing.length && !siteFail.length) {
      h += '<p class="pr-text">Every check passes on every page read.</p>\n';
    } else {
      h += '<ul class="pr-found">\n';
      siteFail.forEach(function (c) {
        if (c.label === 'AI crawler access' && f.crawlers.blocked === 0 && f.crawlers.limited > 0) {
          // Half credit for ordinary Disallow rules is not a block, and the report does not call it one.
          h += '<li><strong>AI crawler access</strong> earns half credit. ' + plural(f.crawlers.limited, 'AI crawler has', 'AI crawlers have') + ' a Disallow rule that applies, often an ordinary path such as an admin area. No crawler is blocked from the site.</li>\n';
        } else {
          h += '<li><strong>' + esc(c.label) + '</strong> fails for the whole site. ' + esc(c.advice || '') + '.</li>\n';
        }
      });
      failing.forEach(function (c) {
        h += '<li><strong>' + esc(c.label) + '</strong> fails on <span data-fig="pr-found-failing">' + c.failingPages + '</span> of ' + A.ok.length + ' pages' + (c.passesOnHomepage ? ' and passes on the homepage' : '') + '.' +
          (c.likelyShared ? ' That is likely a shared template, an inference from how many pages fail.' : '') + '</li>\n';
      });
      h += '</ul>\n';
    }
    h += '<h3 class="pr-h3">What already works</h3>\n<p class="pr-text">' + esc(summary.working) + '</p>\n';
    h += '</div>\n</div>\n';
    if (opts.summaryCardHtml) h += opts.summaryCardHtml;

    // Coverage.
    var read = A.ok.length;
    h += '<h3 class="pr-h3" id="pr-coverage-h">Scan coverage</h3>\n';
    h += '<dl class="pr-coverage" aria-labelledby="pr-coverage-h">' +
      '<div><dt>Pages read and scored</dt><dd>' + fig('pr-cov-read', read) + '</dd></div>' +
      '<div><dt>Blocked by the site</dt><dd>' + fig('pr-cov-blocked', A.blocked) + '</dd></div>' +
      '<div><dt>Not read</dt><dd>' + fig('pr-cov-failed', A.failed + A.skipped + A.pending) + '</dd></div>' +
      '<div><dt>Pages found</dt><dd>' + (f.coverage.sitemapCandidates !== null ? fig('pr-cov-found', f.coverage.sitemapCandidates) : '–') + '</dd></div>' +
      '</dl>\n';
    var cov = [];
    cov.push(f.coverage.discoverySource === 'sitemap' ? 'Pages were chosen from the site’s sitemap.' : 'Pages were chosen from the links on the homepage.');
    if (f.coverage.sitemapCandidates !== null && f.coverage.sitemapCandidates > A.pages.length) cov.push('Discovery found ' + f.coverage.sitemapCandidates + ' addresses and the crawl reads at most ' + f.coverage.cap + ' pages, so this report covers part of the site.');
    else if (f.coverage.sampled) cov.push('The crawl reads at most ' + f.coverage.cap + ' pages, so the site may have more than this report covers.');
    if (A.blocked) cov.push('Pages marked blocked answered our visit with a refusal or a bot check. We do not work around that.');
    h += '<p class="pr-note">' + esc(cov.join(' ')) + '</p>\n';
    h += '<ul class="pr-caveats">' + (summary.caveats || []).map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>\n';
    h += '</section>\n';
    return h;
  }

  /* ----- 2. details ----- */

  function proPillars(data, A, f) {
    var byCat = {};
    f.checks.forEach(function (c) { (byCat[c.cat] = byCat[c.cat] || []).push(c); });
    var advice = {};
    A.ok.forEach(function (p) { p.result.checks.forEach(function (c) { var k = cleanLabel(c.label); if (!advice[k]) advice[k] = c; }); });
    var h = '<h3 class="pr-h3 pr-h3--part" id="pr-pillars">Score by pillar</h3>\n<p class="pr-note">Each pillar is a group of checks. Within a pillar the checks are listed alphabetically.</p>\n';
    PRO_PILLARS.forEach(function (p) {
      var rows = (byCat[p.cat] || []).slice().sort(byLabel);
      var v = A.pillar[p.cat];
      h += '<section class="pr-pillarblock" data-pillar="' + p.cat + '" aria-labelledby="pr-pb-' + p.cat + '">\n';
      h += '<div class="pr-pillarblock__head"><h4 class="pr-h4" id="pr-pb-' + p.cat + '">' + esc(p.name) + '</h4><p class="pr-pillarblock__score"><strong>' + (v === null ? '–' : v) + '</strong> / ' + A.max[p.cat] + '</p></div>\n';
      h += '<p class="pr-note">' + esc(p.what) + '</p>\n';
      h += '<div class="pr-tablewrap"><table class="pr-table pr-table--checks" role="table"><caption class="pr-vh">' + esc(p.name) + ': every check</caption>' +
        '<thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Check</th><th scope="col" role="columnheader">Result</th><th scope="col" role="columnheader" class="pr-num">Points</th><th scope="col" role="columnheader">What to change</th></tr></thead><tbody role="rowgroup">\n';
      rows.forEach(function (c) {
        var a = advice[c.label] || {};
        var result, pass, partial = false;
        if (c.siteLevel) {
          var sc = A.siteChecks.filter(function (x) { return cleanLabel(x.label) === c.label; })[0];
          pass = !!(sc && sc.ok);
          partial = !pass && !!sc && sc.pts > 0 && sc.pts < sc.max;
          result = pass ? 'Passes (whole site)' : (partial ? 'Partial credit, ' + sc.pts + ' of ' + sc.max + ' points (whole site)' : 'Fails (whole site)');
        } else {
          pass = c.failingPages === 0;
          result = pass ? 'Passes on all ' + A.ok.length + ' pages' : 'Fails on <span data-fig="pr-check-failing">' + c.failingPages + '</span> of ' + A.ok.length + ' pages';
        }
        h += '<tr role="row" class="' + (pass ? 'is-pass' : 'is-fail') + '"><th scope="row" role="rowheader" data-label="Check">' + esc(c.label) + '</th>' +
          '<td role="cell" data-label="Result"><span class="pr-state pr-state--' + (pass ? 'pass' : (partial ? 'partial' : 'fail')) + '">' + (pass ? 'Pass' : (partial ? 'Partial' : 'Fail')) + '</span> ' + result + (c.siteLevel || pass ? '' : bar(c.failingPages, A.ok.length, 'rp-bar--risk')) + '</td>' +
          '<td role="cell" class="pr-num" data-label="Points">' + c.max + '</td>' +
          '<td role="cell" data-label="What to change">' + (pass ? '<span class="pr-muted">Nothing to change.</span>' : esc(a.advice || '') + (a.why ? '<br /><span class="pr-muted">' + esc(a.why) + '</span>' : '')) + '</td></tr>\n';
      });
      h += '</tbody></table></div>\n</section>\n';
    });
    return h;
  }

  function proPages(data, A, f) {
    var rows = A.pages.map(function (p) {
      var path = pathOf(p.url, data.domain) || '/';
      if (p.status === 'ok' && p.result) {
        var fails = p.result.checks.filter(function (c) { return !c.ok && !isSiteLevel(c.label); });
        return { p: p, path: path, kind: 'ok', score: p.result.total, failed: fails.length, fails: fails };
      }
      return { p: p, path: path, kind: p.status, score: null, failed: null, fails: [] };
    });
    rows.sort(function (a, b) { return a.path < b.path ? -1 : (a.path > b.path ? 1 : 0); });
    var checkLabels = f.checks.filter(function (c) { return !c.siteLevel && c.failingPages > 0; }).map(function (c) { return c.label; }).sort();

    var h = '<h3 class="pr-h3 pr-h3--part" id="pr-pages">Pages</h3>\n';
    h += '<p class="pr-note">Every page the crawl chose, in alphabetical order of its address. Sort by a column with its heading.</p>\n';
    h += '<div class="pr-controls" data-pr-controls hidden>' +
      '<label class="pr-field pr-field--search"><span class="pr-vh">Search pages</span><input type="search" class="field pr-input" data-pr-q placeholder="Search pages" autocomplete="off" /></label>' +
      '<label class="pr-field"><span class="pr-vh">Show</span><select class="field pr-input" data-pr-status><option value="">All pages</option><option value="ok">Read and scored</option><option value="fail">With a failed check</option><option value="blocked">Blocked by the site</option><option value="unread">Not read</option></select></label>' +
      '<label class="pr-field"><span class="pr-vh">Failing a chosen check</span><select class="field pr-input" data-pr-check><option value="">Any check</option>' + checkLabels.map(function (l) { return '<option value="' + esc(l) + '">' + esc(l) + '</option>'; }).join('') + '</select></label>' +
      '<p class="pr-count" data-pr-count role="status" aria-live="polite"></p></div>\n';
    h += '<div class="pr-tablewrap" data-shot="pages"><table class="pr-table pr-table--pages" role="table" data-pr-table><caption class="pr-vh">Pages in this crawl</caption>' +
      '<thead role="rowgroup"><tr role="row">' +
      '<th scope="col" role="columnheader" aria-sort="ascending" data-sort="path">Page</th>' +
      '<th scope="col" role="columnheader" class="pr-num" data-sort="score">Score</th>' +
      '<th scope="col" role="columnheader" class="pr-num" data-sort="failed">Failed checks</th>' +
      '<th scope="col" role="columnheader">What failed</th></tr></thead><tbody role="rowgroup">\n';
    rows.forEach(function (r, i) {
      var det;
      if (r.kind === 'ok') {
        det = r.fails.length ? '<details class="pr-det"><summary>' + plural(r.fails.length, 'failed check', 'failed checks') + '</summary><ul class="pr-fails">' + r.fails.slice().sort(function (a, b) { return cleanLabel(a.label) < cleanLabel(b.label) ? -1 : 1; }).map(function (c) { return '<li><strong>' + esc(cleanLabel(c.label)) + '</strong> <span class="pr-muted">' + c.pts + '/' + c.max + '</span><br />' + esc(c.advice || '') + '</li>'; }).join('') + '</ul></details>' : '<span class="pr-muted">No page-level check fails.</span>';
      } else det = '<span class="pr-muted">' + esc(pageStatusText(r.p)) + '</span>';
      h += '<tr role="row" class="pr-row" id="pr-page-' + i + '" data-path="' + esc(r.path) + '" data-score="' + (r.score === null ? '' : r.score) + '" data-failed="' + (r.failed === null ? '' : r.failed) + '" data-kind="' + r.kind + '" data-checks="' + esc(r.fails.map(function (c) { return cleanLabel(c.label); }).join('|')) + '">' +
        '<th scope="row" role="rowheader" data-label="Page"><a href="' + esc(r.p.url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(r.p.url) + '">' + esc(midTruncate(r.path, 48)) + '</a></th>' +
        '<td role="cell" class="pr-num" data-label="Score">' + (r.score === null ? '–' : '<span data-fig="pr-page-score">' + r.score + '</span>') + '</td>' +
        '<td role="cell" class="pr-num" data-label="Failed checks">' + (r.failed === null ? '–' : '<span data-fig="pr-page-failed">' + r.failed + '</span>') + '</td>' +
        '<td role="cell" data-label="What failed">' + det + '</td></tr>\n';
    });
    h += '</tbody></table></div>\n<p class="pr-empty" data-pr-empty hidden>No page matches.</p>\n';
    return h;
  }

  function proFixes(data, A, f) {
    if (!f.fixes.length) return '';
    var h = '<h3 class="pr-h3 pr-h3--part" id="pr-snippets">Copy-paste fixes</h3>\n<p class="pr-note">Each distinct snippet appears once, with the number of pages it applies to. The JSON-LD uses placeholders where a fact is unknown: fill them in, and do not publish a placeholder.</p>\n';
    f.fixes.forEach(function (x) {
      h += '<details class="pr-snippet"><summary><span class="pr-snippet__name">' + esc(x.label) + '</span><span class="pr-muted">applies to ' + x.pages.length + (x.pages.length === 1 ? ' page' : ' pages') + '</span></summary>' +
        '<div class="pr-snippet__body"><button type="button" class="btn btn--ghost pr-copy" data-copy hidden>Copy</button><pre class="rp-code">' + esc(x.code) + '</pre></div></details>\n';
    });
    return h;
  }

  function proDetails(data, A, f, opts) {
    var h = '<section class="pr-section" id="pr-details" aria-labelledby="pr-details-h">\n<h2 class="pr-h2" id="pr-details-h">Details</h2>\n';
    h += proPillars(data, A, f) + proPages(data, A, f) + proFixes(data, A, f);
    if (opts.citation) h += '<h3 class="pr-h3 pr-h3--part" id="pr-citations">Citations</h3>\n' + CITATION.panel(opts.citation.result, { sample: !!opts.citation.sample });
    // Extra parts of the details, in the order given: { id, title, html }. The estimate stays the last section.
    (opts.detailsExtra || []).forEach(function (x) { h += '<h3 class="pr-h3 pr-h3--part" id="' + esc(x.id) + '">' + esc(x.title) + '</h3>\n' + x.html + '\n'; });
    h += '</section>\n';
    return h;
  }

  /* ----- 3. estimated score (last) ----- */

  function proEstimate(data, A, f, est) {
    var h = '<section class="pr-section" id="pr-estimate" aria-labelledby="pr-estimate-h">\n<h2 class="pr-h2" id="pr-estimate-h">Estimated score if you apply these fixes</h2>\n';
    if (!est || est.now === null) {
      h += '<p class="pr-text">No page could be read, so there is nothing to estimate.</p>\n</section>\n';
      return h;
    }
    if (!est.steps.length) {
      h += '<p class="pr-text">No change to the pages or the site files would raise the score: every check that can be fixed already passes.</p>\n';
      h += '<p class="pr-note">Estimated from Citehound\'s scoring rules. It measures readiness, not how often assistants mention you.</p>\n</section>\n';
      return h;
    }
    var now = est.now, fin = est.final;
    h += '<p class="pr-text">One row per fix. Each figure comes from scoring the same pages again with that fix applied, in the order shown: the largest gain first, then the next largest once the earlier fixes are in.</p>\n';
    // The strip: current, and what the fixes would add. Two plain numbers side by side, no arrow.
    h += '<div data-shot="estimate">\n<div class="pr-strip" role="group" aria-label="Current and estimated score">' +
      '<div class="pr-strip__nums"><p class="pr-strip__num"><span class="pr-strip__label">Now</span><strong data-fig="pr-est-now">' + oneDecimal(now) + '</strong></p>' +
      '<p class="pr-strip__num pr-strip__num--est"><span class="pr-strip__label">Estimated</span><strong data-fig="pr-est-final">' + oneDecimal(fin) + '</strong></p>' +
      '<p class="pr-strip__num"><span class="pr-strip__label">Points added</span><strong data-fig="pr-est-gain">' + SIGNED(Math.round((fin - now) * 10) / 10) + '</strong></p></div>' +
      '<div class="pr-strip__track" aria-hidden="true"><span class="pr-strip__now" style="width:' + Math.max(0, Math.min(100, now)) + '%"></span><span class="pr-strip__add" style="left:' + Math.max(0, Math.min(100, now)) + '%;width:' + Math.max(0, Math.min(100 - now, fin - now)) + '%"></span></div>' +
      '<p class="pr-strip__scale" aria-hidden="true"><span>0</span><span>100</span></p></div>\n';

    var adviceOf = {}, whyOf = {};
    A.ok.forEach(function (p) { p.result.checks.forEach(function (c) { var k = cleanLabel(c.label); if (!adviceOf[k]) { adviceOf[k] = c.advice; whyOf[k] = c.why; } }); });
    var structuredFails = f.checks.some(function (c) { return c.label === 'Structured data (JSON-LD)' && c.failingPages > 0; });
    h += '<div class="pr-tablewrap"><table class="pr-table pr-table--estimate" role="table"><caption class="pr-vh">Fixes, ordered by points gained</caption>' +
      '<thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">What to change</th><th scope="col" role="columnheader">Why it matters</th><th scope="col" role="columnheader" class="pr-num">Pages</th><th scope="col" role="columnheader" class="pr-num">Points gained</th><th scope="col" role="columnheader" class="pr-num">Resulting total</th></tr></thead><tbody role="rowgroup">\n';
    est.steps.forEach(function (s) {
      var what = (adviceOf[s.check] || s.check);
      var extra = (s.check === 'Organization / WebSite schema' || s.check === 'Content schema (Article, FAQ…)') && structuredFails ? ' Markup of this kind is JSON-LD, so it also satisfies the Structured data (JSON-LD) check on the same pages.' : '';
      h += '<tr role="row"><th scope="row" role="rowheader" data-label="What to change"><span class="pr-fixname">' + esc(what) + '</span><span class="pr-muted pr-fixcheck">' + esc(s.check) + '</span></th>' +
        '<td role="cell" data-label="Why it matters">' + esc(whyOf[s.check] || '') + esc(extra) + '</td>' +
        '<td role="cell" class="pr-num" data-label="Pages">' + (s.scope === 'site' ? 'Whole site' : s.pages) + '</td>' +
        '<td role="cell" class="pr-num pr-gain" data-label="Points gained"><span>+<span data-fig="pr-est-row-gain">' + oneDecimal(s.gain) + '</span></span></td>' +
        '<td role="cell" class="pr-num" data-label="Resulting total"><span data-fig="pr-est-row-total">' + oneDecimal(s.total) + '</span></td></tr>\n';
    });
    h += '</tbody></table></div>\n</div>\n';
    var notes = ['Estimated from Citehound\'s scoring rules. It measures readiness, not how often assistants mention you.'];
    var cc = f.checks.filter(function (c) { return c.label === 'AI crawler access' && c.failingPages > 0; })[0];
    if (cc && f.crawlers.blocked === 0) notes.push('Not included: the half credit on AI crawler access that ordinary Disallow rules cause. Those rules are often a normal admin path, so we do not suggest changing them.');
    h += '<p class="pr-note pr-note--first">' + esc(notes[0]) + '</p>\n';
    if (notes[1]) h += '<p class="pr-note">' + esc(notes[1]) + '</p>\n';
    h += '<p class="pr-note">Totals are shown to one decimal. The score in the site summary is the same average rounded to a whole number.</p>\n';
    h += '</section>\n';
    return h;
  }

  /* ----- the page ----- */

  // opts: { schema, estimate (from lib/pro-estimate.js), cap (default 50), label, bannerHtml, notice, expires (ISO date), jobId, detailsExtra, bar,
  //         actions: { copy, email, print }, citation: { result, sample }, homeHref }
  function renderPro(data, opts) {
    opts = opts || {};
    var A = analyzePro(data);
    var f = FACTS.facts(data, { schema: opts.schema, cap: opts.cap });
    var summary = data.executiveSummary;
    if (!summary) summary = SUMMARY.deterministic(f);
    var actions = opts.actions || {};
    var h = '<div class="pr-report rp-report-pro" data-domain="' + esc(data.domain) + '"' + (opts.jobId ? ' data-job="' + esc(opts.jobId) + '"' : '') + '>\n';
    if (opts.bar !== false) h += proTop(opts);
    h += '<div class="pr-wrap">\n' + (opts.bannerHtml || '');
    h += '<div class="pr-head"><p class="pr-kicker">AI readiness report, full site</p><h1 class="pr-title">' + esc(data.domain) + '</h1>' +
      '<p class="pr-meta">Crawled ' + esc(longDate(data.createdAt)) + '. ' + fig('pr-meta-read', A.ok.length) + ' pages read' + (A.blocked ? ', ' + A.blocked + ' blocked by the site' : '') + (A.failed + A.skipped ? ', ' + (A.failed + A.skipped) + ' not read' : '') + '.' + (opts.expires ? ' Kept until ' + esc(longDate(opts.expires)) + '.' : '') + '</p>' +
      '<p class="pr-frame">' + (opts.frameText ? esc(opts.frameText) : 'Citehound measures AI readiness: crawler access and on-page signals. It does not measure whether or how often AI assistants mention a brand.') + '</p>' +
      '<div class="pr-actions" data-pr-actions>' +
      (actions.copy ? '<button type="button" class="btn btn--ghost pr-btn" data-action="copy-link" hidden>Copy link</button>' : '') +
      (actions.email ? '<button type="button" class="btn btn--ghost pr-btn" data-action="email" hidden>Email me this report</button>' : '') +
      (actions.print ? '<button type="button" class="btn btn--ghost pr-btn" data-action="print" hidden>Print or save as PDF</button>' : '') +
      '<p class="pr-status" data-pr-status-msg role="status" aria-live="polite"></p></div></div>\n';
    if (opts.notice) h += '<div class="pr-notice" role="note"><strong>' + esc(opts.notice.title) + '</strong> ' + esc(opts.notice.text) + '</div>\n';
    // An extra section (the live Pro citation check) sits before the estimate, which stays last.
    var nav = PRO_NAV.slice();
    if (opts.extraSection) nav.splice(nav.length - 1, 0, { id: opts.extraSection.id, name: opts.extraSection.name });
    h += '<nav class="pr-nav" aria-label="Report sections"><ul>' + nav.map(function (n) { return '<li><a href="#' + n.id + '">' + esc(n.name) + '</a></li>'; }).join('') + '</ul></nav>\n';
    if (!A.ok.length) {
      h += '<section class="pr-section" id="pr-summary"><h2 class="pr-h2">Site summary</h2><p class="pr-text">No page could be read, so there is no report. ' + plural(A.failed + A.blocked + A.skipped, 'page', 'pages') + ' could not be read.</p></section>\n';
    } else {
      h += proSummary(data, A, f, summary, opts) + proDetails(data, A, f, opts) + (opts.extraSection ? opts.extraSection.html : '') + proEstimate(data, A, f, opts.estimate);
    }
    h += '</div>\n</div>\n';
    return h;
  }

  return { render: render, renderPro: renderPro, analyzePro: analyzePro, proTop: proTop, PRO_NAV: PRO_NAV, topBar: topBar, analyze: analyze, isSiteLevel: isSiteLevel, cleanLabel: cleanLabel, longDate: longDate, shortUrl: shortUrl, midTruncate: midTruncate, TABS: TABS, SHORT: SHORT, COLLAPSE_OVER: COLLAPSE_OVER, LIST_SHOWN: LIST_SHOWN };
}));
