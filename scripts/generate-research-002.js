#!/usr/bin/env node
/* =====================================================================
   scripts/generate-research-002.js

   Writes research/crawler-access-2026.html (Research 002) from data/*-summary.json.
   No new scans: every figure is computed from the six category summaries
   already published on the benchmark pages. Same template as the llms.txt
   report (research/llms-txt-adoption-2026.html): banner, stat band, key findings
   plate, figures, methodology and limits, how to cite. B2B is --navy-800 and
   consumer is --gold, as in the other reports.

   The key findings are templates filled with computed values. They state what
   the counts are and make no editorial claim.

     node scripts/generate-research-002.js           write the page, the research index entry, the sitemap entry
     node scripts/generate-research-002.js --check   recompute every figure and fail on a mismatch
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const shell = require('../lib/page-shell.js');
const site = require('../lib/site-config.js');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'research', 'crawler-access-2026.html');
const INDEX = path.join(ROOT, 'research', 'index.html');
const SLUG = 'crawler-access-2026';
const PUBLISHED = '2026-10-05';
const CSS_VERSION = 61;
const esc = shell.esc;
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };
const pct = (n, d) => Math.round(n / d * 100);
// A count that rounds to 0% is written "under 1%" so it is not read as none.
const pctText = (n, d) => (n > 0 && pct(n, d) === 0 ? 'under 1%' : pct(n, d) + '%');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

/* ---------------- the numbers ---------------- */

function compute() {
  const cats = read('data/benchmarks.json').map((e) => ({ e: e, s: read('data/' + e.category + '-summary.json') }));
  const bots = Object.keys(cats[0].s.crawlers.perBot);
  const N = cats.reduce((n, c) => n + c.s.scanned, 0);
  const failed = cats.reduce((n, c) => n + (c.s.failed || 0), 0);
  const perBot = bots.map((b) => {
    const t = { name: b, blocked: 0, limited: 0, open: 0 };
    cats.forEach((c) => { const x = c.s.crawlers.perBot[b]; t.blocked += x.blocked; t.limited += x.limited; t.open += x.open; });
    return t;
  });
  const byCategory = cats.map((c) => ({ label: c.e.label, track: c.e.track.indexOf('B2B') === 0 ? 'b2b' : 'consumer', scanned: c.s.scanned, failed: c.s.failed || 0, blockingPct: c.s.crawlers.blockingAtLeastOnePct, date: c.s.scannedAt }));
  const pairs = N * bots.length;
  const sum = (k) => perBot.reduce((n, b) => n + b[k], 0);
  const dates = cats.map((c) => c.s.scannedAt).sort();
  return { N: N, failed: failed, categories: cats.length, bots: bots, perBot: perBot, byCategory: byCategory, pairs: pairs, blocked: sum('blocked'), limited: sum('limited'), open: sum('open'), first: dates[0], last: dates[dates.length - 1],
    b2bN: byCategory.filter((c) => c.track === 'b2b').reduce((n, c) => n + c.scanned, 0), conN: byCategory.filter((c) => c.track === 'consumer').reduce((n, c) => n + c.scanned, 0) };
}

const join = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

function findings(D) {
  const byBlocked = D.perBot.slice().sort((a, b) => b.blocked - a.blocked || (a.name < b.name ? -1 : 1));
  const top = byBlocked.filter((b) => b.blocked === byBlocked[0].blocked);
  const low = byBlocked.filter((b) => b.blocked === byBlocked[byBlocked.length - 1].blocked);
  const bc = D.byCategory.slice().sort((a, b) => b.blockingPct - a.blockingPct);
  const hi = bc[0], lo = bc[bc.length - 1];
  return [
    'Across ' + D.categories + ' categories, the share of homepages that block at least one tracked AI crawler runs from ' + lo.blockingPct + '% (' + join(bc.filter((c) => c.blockingPct === lo.blockingPct).map((c) => c.label)) + ') to ' + hi.blockingPct + '% (' + join(bc.filter((c) => c.blockingPct === hi.blockingPct).map((c) => c.label)) + ').',
    join(top.map((b) => b.name)) + (top.length > 1 ? ' are the most-blocked crawlers, each' : ' is the most-blocked crawler,') + ' on ' + top[0].blocked + ' of ' + D.N + ' homepages (' + pctText(top[0].blocked, D.N) + '). ' + join(low.map((b) => b.name)) + (low.length > 1 ? ' are the least-blocked, each' : ' is the least-blocked,') + ' on ' + low[0].blocked + ' (' + pctText(low[0].blocked, D.N) + ').',
    'Of the ' + D.pairs + ' crawler-and-homepage pairs, ' + pct(D.blocked, D.pairs) + '% are blocked, ' + pct(D.limited, D.pairs) + '% are limited by an applicable Disallow rule and ' + pct(D.open, D.pairs) + '% are open.'
  ];
}

/* ---------------- figures (SVG, the existing chart classes) ---------------- */

const note2 = (H, a, b) => '<text x="10" y="' + (H - 26) + '" class="chart-label chart-label--faint" font-size="12">' + esc(a) + '</text>\n<text x="10" y="' + (H - 11) + '" class="chart-label chart-label--faint" font-size="12">' + esc(b) + '</text>\n';

function fig1(D) {
  const rows = D.perBot.slice().sort((a, b) => b.blocked - a.blocked || (a.name < b.name ? -1 : 1));
  const H = 34 + rows.length * 30 + 50;
  const maxPct = Math.max.apply(null, rows.map((r) => pct(r.blocked, D.N)).concat([1]));
  const scale = 230 / Math.max(maxPct, 10);
  let s = '<svg viewBox="0 0 420 ' + H + '" role="img" aria-labelledby="fig1-title fig1-desc" xmlns="http://www.w3.org/2000/svg">\n<title id="fig1-title">Share of homepages blocking each tracked AI crawler</title>\n<desc id="fig1-desc">' +
    esc(rows.map((r) => r.name + ' ' + pctText(r.blocked, D.N) + ' (' + r.blocked + ' of ' + D.N + ')').join('. ') + '.') + '</desc>\n';
  rows.forEach((r, i) => {
    const y = 20 + i * 30, p = pct(r.blocked, D.N), w = Math.max(1, +(p * scale).toFixed(1));
    s += '<text x="10" y="' + (y + 11) + '" class="chart-label" font-size="13">' + esc(r.name) + '</text>\n<rect class="chart-track" x="130" y="' + y + '" width="230" height="14" rx="3"/>\n<rect class="r2-bar--all" x="130" y="' + y + '" width="' + w + '" height="14" rx="3"/>\n<text x="' + (130 + w + 6) + '" y="' + (y + 11) + '" class="chart-value" font-size="13">' + (p === 0 && r.blocked > 0 ? '<1%' : p + '%') + '</text>\n';
  });
  s += note2(H, 'Filled = homepages whose robots.txt disallows the', 'whole site for that crawler. n=' + D.N + '.') + '</svg>';
  return s;
}

function fig2(D) {
  const rows = D.byCategory.slice().sort((a, b) => b.blockingPct - a.blockingPct || (a.label < b.label ? -1 : 1));
  const H = 50 + rows.length * 30 + 54;
  let s = '<svg viewBox="0 0 420 ' + H + '" role="img" aria-labelledby="fig2-title fig2-desc" xmlns="http://www.w3.org/2000/svg">\n<title id="fig2-title">Share of homepages blocking at least one tracked AI crawler, by category</title>\n<desc id="fig2-desc">' +
    esc(rows.map((r) => r.label + ' ' + r.blockingPct + '% of ' + r.scanned + ' homepages').join('. ') + '.') + '</desc>\n' +
    '<rect x="10" y="2" width="8" height="8" class="chart-bar--b2b"/>\n<text x="22" y="10" class="chart-label" font-size="13">B2B SaaS</text>\n<rect x="110" y="2" width="8" height="8" class="chart-bar--dtc"/>\n<text x="122" y="10" class="chart-label" font-size="13">Consumer</text>\n';
  const top = Math.max.apply(null, rows.map((q) => q.blockingPct).concat([10]));
  rows.forEach((r, i) => {
    const y = 32 + i * 30, w = Math.max(1, +(r.blockingPct * 140 / top).toFixed(1));
    s += '<text x="10" y="' + (y + 11) + '" class="chart-label" font-size="13">' + esc(r.label) + ' \u00B7 n=' + r.scanned + '</text>\n<rect class="chart-track" x="228" y="' + y + '" width="140" height="14" rx="3"/>\n<rect class="' + (r.track === 'b2b' ? 'chart-bar--b2b' : 'chart-bar--dtc') + '" x="228" y="' + y + '" width="' + w + '" height="14" rx="3"/>\n<text x="' + (228 + w + 6) + '" y="' + (y + 11) + '" class="chart-value" font-size="13">' + r.blockingPct + '%</text>\n';
  });
  s += note2(H, 'Filled = share of homepages blocking at least one', 'of the ' + D.bots.length + ' tracked crawlers.') + '</svg>';
  return s;
}

function fig3(D) {
  const rows = D.perBot.slice().sort((a, b) => b.blocked - a.blocked || b.limited - a.limited || (a.name < b.name ? -1 : 1));
  const H = 40 + rows.length * 44 + 62;
  let s = '<svg viewBox="0 0 420 ' + H + '" role="img" aria-labelledby="fig3-title fig3-desc" xmlns="http://www.w3.org/2000/svg">\n<title id="fig3-title">Blocked, limited and open, for each tracked AI crawler</title>\n<desc id="fig3-desc">' +
    esc(rows.map((r) => r.name + ': blocked ' + r.blocked + ', limited ' + r.limited + ', open ' + r.open + ' of ' + D.N).join('. ') + '.') + '</desc>\n' +
    '<rect x="10" y="2" width="8" height="8" class="r2-bar--blocked"/>\n<text x="22" y="10" class="chart-label" font-size="13">Blocked</text>\n<rect x="100" y="2" width="8" height="8" class="r2-bar--limited"/>\n<text x="112" y="10" class="chart-label" font-size="13">Limited</text>\n<rect x="190" y="2" width="8" height="8" class="chart-track"/>\n<text x="202" y="10" class="chart-label" font-size="13">Open</text>\n';
  rows.forEach((r, i) => {
    const y = 30 + i * 44, x0 = 130, W = 270;
    const wb = +(r.blocked / D.N * W).toFixed(1), wl = +(r.limited / D.N * W).toFixed(1);
    s += '<text x="10" y="' + (y + 11) + '" class="chart-label" font-size="13">' + esc(r.name) + '</text>\n<rect class="chart-track" x="' + x0 + '" y="' + y + '" width="' + W + '" height="14" rx="3"/>\n';
    s += '<rect class="r2-bar--limited" x="' + (x0 + wb).toFixed(1) + '" y="' + y + '" width="' + wl + '" height="14"/>\n';
    if (r.blocked) s += '<rect class="r2-bar--blocked" x="' + x0 + '" y="' + y + '" width="' + Math.max(wb, 1.5) + '" height="14" rx="3"/>\n';
    s += '<text x="' + x0 + '" y="' + (y + 30) + '" class="chart-label chart-label--faint" font-size="12">blocked ' + r.blocked + ' · limited ' + r.limited + ' · open ' + r.open + '</text>\n';
  });
  s += note2(H, 'Bars are shares of the ' + D.N + ' homepages.', 'Limited means an applicable Disallow rule.') + '</svg>';
  return s;
}

function figure(num, svg, caption, source) {
  return '          <figure class="report-figure">\n            <p class="report-figure__label">Fig. ' + num + '</p>\n            <div class="report-figure__visual">\n' + svg.replace(/^/gm, '              ') + '\n            </div>\n            <figcaption class="report-figure__caption">' + caption + '</figcaption>\n            <p class="report-figure__source">' + source + '</p>\n          </figure>';
}

/* ---------------- the page ---------------- */

function build(D) {
  const nWord = WORDS[D.categories] || String(D.categories);
  const title = 'Which AI crawlers do sites block? ' + D.N + ' homepages, ' + nWord + ' categories.';
  const F = findings(D);
  const dateLabel = longDate(PUBLISHED);
  const url = site.baseUrl + '/research/' + SLUG;
  const scanWindow = MONTHS[+D.first.slice(5, 7) - 1].slice(0, 3) + ' ' + D.first.slice(0, 4);
  const src = 'Source: Citehound scans, ' + longDate(D.first) + ' to ' + longDate(D.last) + ', n=' + D.N;
  const desc = 'We read the robots.txt of ' + D.N + ' homepages in ' + nWord + ' categories. Few block an AI crawler outright; many apply a Disallow rule that is usually an ordinary path.';
  const cite = 'Andaç Üzel, “' + title.replace(/\.$/, '') + ',” Citehound Research, ' + dateLabel + '. ' + url;
  const topBlocked = D.perBot.slice().sort((a, b) => b.blocked - a.blocked)[0];
  const tops = D.perBot.filter((b) => b.blocked === topBlocked.blocked);
  const rescan = 'The October 2026 rescan of the same six lists moved category averages by one point or less (see the methodology changelog).';

  const body = shell.banner({ kicker: 'Research', title: esc(title), desc: 'The share of homepages that block each tracked AI crawler, by category, and how many only limit it with a Disallow rule. Computed from the benchmark scans, no new scans.' })
    .replace('        </div>\n      </div>\n    </section>\n', '          <span class="page-banner__num" aria-hidden="true">002</span>\n        </div>\n      </div>\n    </section>\n') +
    '\n    <section aria-label="Report metadata">\n      <div class="section__inner">\n        <div class="report-byline">\n          <a href="/about">Andaç Üzel</a>\n          <span>Published ' + dateLabel + '</span>\n          <span>Last updated ' + dateLabel + '</span>\n        </div>\n\n' +
    '        <div class="hero__figures report-stats" aria-label="Report scope">\n          <div class="hero__figure"><b>' + D.N + '</b><span>homepages scanned</span></div>\n          <div class="hero__figure"><b>' + D.categories + '</b><span>categories</span></div>\n          <div class="hero__figure"><b>' + D.bots.length + '</b><span>AI crawlers</span></div>\n          <div class="hero__figure"><b>' + scanWindow + '</b><span>scan window</span></div>\n        </div>\n      </div>\n    </section>\n\n' +
    '    <section aria-label="Key findings">\n      <div class="section__inner">\n        <div class="report-findings">\n          <p class="report-findings__label">Key findings</p>\n          <ol>\n' + F.map((f, i) => '            <li><span class="report-findings__num">' + (i + 1) + '</span><p>' + esc(f) + '</p></li>').join('\n') + '\n          </ol>\n        </div>\n      </div>\n    </section>\n\n' +
    '    <section aria-labelledby="section-01-heading">\n      <div class="section__inner">\n        <div class="report-section">\n          <p class="report-section__num">01</p>\n          <h2 id="section-01-heading" class="report-section__heading">Which crawlers are blocked</h2>\n' +
    '          <p>We read the robots.txt of every homepage that completed a scan and checked it against each of ' + D.bots.length + ' tracked AI crawlers. A crawler counts as blocked when the file disallows the whole site for it.</p>\n' +
    '          <p>' + esc(join(tops.map((b) => b.name))) + (tops.length > 1 ? ' are blocked most often, each' : ' is blocked most often,') + ' on ' + topBlocked.blocked + ' of ' + D.N + ' homepages (' + pctText(topBlocked.blocked, D.N) + ').</p>\n' +
    figure(1, fig1(D), 'Blocked share by crawler, across all ' + D.categories + ' categories. Each bar is a count of homepages out of ' + D.N + '.', src) + '\n        </div>\n      </div>\n    </section>\n\n' +
    '    <section aria-labelledby="section-02-heading">\n      <div class="section__inner">\n        <div class="report-section">\n          <p class="report-section__num">02</p>\n          <h2 id="section-02-heading" class="report-section__heading">Blocking by category</h2>\n' +
    '          <p>The categories differ in how many of their homepages block at least one tracked crawler. B2B categories are navy and consumer categories are gold.</p>\n' +
    figure(2, fig2(D), 'Share of each category’s homepages that block at least one of the ' + D.bots.length + ' tracked crawlers.', src) + '\n        </div>\n      </div>\n    </section>\n\n' +
    '    <section aria-labelledby="section-03-heading">\n      <div class="section__inner">\n        <div class="report-section">\n          <p class="report-section__num">03</p>\n          <h2 id="section-03-heading" class="report-section__heading">Blocked, limited and open</h2>\n' +
    '          <p>Most pairs of crawler and homepage are neither blocked nor fully open. They are limited: at least one Disallow rule applies to that crawler. That is usually an ordinary path such as an admin area or a search page, not a block on the site.</p>\n' +
    '          <p>' + D.limited + ' of the ' + D.pairs + ' pairs are limited, ' + D.blocked + ' are blocked and ' + D.open + ' are open.</p>\n' +
    figure(3, fig3(D), 'Blocked, limited and open for each tracked crawler. “Limited” means an applicable Disallow rule, usually an ordinary path, not a block.', src) + '\n        </div>\n      </div>\n    </section>\n\n' +
    '    <section aria-labelledby="methodology-heading">\n      <div class="section__inner">\n        <div class="report-methodology">\n          <h2 id="methodology-heading">Methodology and limitations</h2>\n\n' +
    '          <h3>What we scanned</h3>\n          <p>' + D.N + ' homepages completed a scan in ' + nWord + ' categories: ' + D.b2bN + ' B2B and ' + D.conN + ' consumer. ' + D.failed + ' more could not be reached and are excluded from every figure.</p>\n\n' +
    '          <h3>What we pulled</h3>\n          <p>For each homepage, its robots.txt, retrieved live on its category’s scan date: ' + join(D.byCategory.map((c) => c.label + ' ' + longDate(c.date))) + '.</p>\n\n' +
    '          <h3>What this measures</h3>\n          <p>What a site’s robots.txt says to each tracked AI crawler. It does not measure whether a crawler obeys the file, or whether any assistant names a brand in a live answer.</p>\n\n' +
    '          <div class="report-limits">\n            <p class="r2-limits__label">What this doesn’t tell you</p>\n            <ul>\n' +
    '              <li>Anything beyond homepages. Each site was read once, at its homepage.</li>\n' +
    '              <li>How common blocking is across the web. The sites are hand-picked well-known names in each category, not a random sample.</li>\n' +
    '              <li>How the sites look today. Each category has one scan date. ' + esc(rescan) + '</li>\n' +
    '              <li>Anything about the ' + D.failed + ' sites that could not be reached, which are counted here and left out.</li>\n' +
    '              <li>Whether a limited result is harmful. It means an applicable Disallow rule, usually an ordinary path, and is not a block.</li>\n' +
    '            </ul>\n          </div>\n        </div>\n      </div>\n    </section>\n\n' +
    '    <section aria-labelledby="cite-heading">\n      <div class="section__inner">\n        <div class="report-cite">\n          <p id="cite-heading" class="report-cite__label">How to cite this</p>\n          <p class="report-cite__line" id="citeLine">' + esc(cite) + '</p>\n          <div class="report-cite__row">\n            <button type="button" class="btn btn--ghost" id="citeCopyBtn">\n              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="9" rx="1.5"/><path d="M3.5 10.5v-6a1.5 1.5 0 011.5-1.5h6"/></svg>\n              Copy citation\n            </button>\n          </div>\n        </div>\n      </div>\n    </section>\n\n' +
    '    <section aria-label="Closing">\n      <div class="section__inner">\n        <div class="report-closing">\n          <p>If you want to see what your own robots.txt says to each of these crawlers, run the free scan.</p>\n          <a href="/" class="btn btn--primary">Scan your site free</a>\n        </div>\n      </div>\n    </section>\n';

  const ld = [{
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Article', '@id': url + '#article', headline: title.replace(/\.$/, ''), description: desc, author: { '@id': site.baseUrl + '/about#person' }, publisher: { '@id': site.baseUrl + '/#org' }, datePublished: PUBLISHED, dateModified: PUBLISHED, url: url, mainEntityOfPage: url },
      { '@type': 'Dataset', name: 'Citehound AI crawler access, ' + D.N + ' homepages in ' + nWord + ' categories, July 2026', description: 'For each of ' + D.N + ' homepages, whether robots.txt blocks, limits or leaves open each of ' + D.bots.length + ' tracked AI crawlers, grouped by category.', temporalCoverage: D.first + '/' + D.last, creator: { '@id': site.baseUrl + '/#org' }, variableMeasured: 'robots.txt access state (blocked, limited, open) for ' + D.bots.length + ' AI crawlers', url: url }
    ]
  }];
  return shell.page({ title: 'Citehound — ' + title.replace(/\.$/, ''), description: desc, path: '/research/' + SLUG, cssVersion: CSS_VERSION, jsonld: ld, depth: 1, body: body }).replace('<script src="../nav.js?v=3"></script>', '<script src="../nav.js?v=3"></script>\n  <script src="../research.js?v=1"></script>').replace('<meta property="og:type" content="website" />', '<meta property="og:type" content="article" />');
}

function indexEntry() {
  const D = compute();
  const F = findings(D);
  const nWord = WORDS[D.categories] || String(D.categories);
  const title = 'Which AI crawlers do sites block? ' + D.N + ' homepages, ' + nWord + ' categories';
  return {
    slug: SLUG, kind: 'research', title: title, date: PUBLISHED, dateLabel: longDate(PUBLISHED), url: site.baseUrl + '/research/' + SLUG,
    summary: 'We read the robots.txt of ' + D.N + ' homepages in ' + nWord + ' categories. Few block an AI crawler outright; many apply a Disallow rule that is usually an ordinary path.',
    findings: F,
    limits: ['Homepages only, from hand-picked well-known sites, not a random sample.', 'One scan date per category. The October 2026 rescan moved category averages by one point or less.', D.failed + ' sites that could not be reached are excluded and counted.', 'A limited result means an applicable Disallow rule, usually an ordinary path, and is not a block.'],
    cite: 'Andaç Üzel, “' + title + ',” Citehound Research, ' + longDate(PUBLISHED) + '. ' + site.baseUrl + '/research/' + SLUG,
    sources: ['research/' + SLUG + '.html', 'data/']
  };
}

const ITEM_RE = /\s*<a href="\/research\/crawler-access-2026" class="research-index-item">[\s\S]*?<\/a>/;
function indexItem(D) {
  const nWord = WORDS[D.categories] || String(D.categories);
  return '          <a href="/research/' + SLUG + '" class="research-index-item">\n            <p class="research-index-item__meta">Research &middot; 002 &middot; ' + longDate(PUBLISHED) + '</p>\n            <p class="research-index-item__title">Which AI crawlers do sites block? ' + D.N + ' homepages, ' + nWord + ' categories.</p>\n            <p class="research-index-item__summary">' + esc(indexEntry().summary) + '</p>\n          </a>\n';
}
function updateIndex(html, D) {
  let s = html.replace(ITEM_RE, '');
  s = s.replace('<div class="research-index-list">\n', '<div class="research-index-list">\n' + indexItem(D));
  // JSON-LD list: this report first, the others after it in their order.
  const mine = site.baseUrl + '/research/' + SLUG;
  const others = [];
  (s.match(/\{ "@type": "ListItem", "position": \d+, "name": "[^"]*", "url": "[^"]*" \}/g) || []).forEach((x) => { const j = JSON.parse(x); if (j.url !== mine) others.push({ name: j.name, url: j.url }); });
  const all = [{ name: 'Which AI crawlers do sites block?', url: mine }].concat(others);
  const lines = all.map((x, i) => '        { "@type": "ListItem", "position": ' + (i + 1) + ', "name": ' + JSON.stringify(x.name) + ', "url": ' + JSON.stringify(x.url) + ' }');
  s = s.replace(/"itemListElement": \[[\s\S]*?\n      \]/, () => '"itemListElement": [\n' + lines.join(',\n') + '\n      ]');
  return s;
}

function ensureSitemap() {
  const file = path.join(ROOT, 'sitemap.xml');
  const xml = fs.readFileSync(file, 'utf8');
  const loc = site.baseUrl + '/research/' + SLUG;
  if (xml.indexOf('<loc>' + loc + '</loc>') !== -1) return false;
  fs.writeFileSync(file, xml.replace('</urlset>', '  <url>\n    <loc>' + loc + '</loc>\n  </url>\n</urlset>'), 'utf8');
  return true;
}

/* ---------------- check: recompute every figure separately ---------------- */

function check() {
  const errors = [];
  const bad = (m) => errors.push(m);
  const D = compute();
  const page = fs.existsSync(PAGE) ? fs.readFileSync(PAGE, 'utf8') : '';
  if (page !== build(D)) bad('research/' + SLUG + '.html is out of date; run node scripts/generate-research-002.js');

  // A separate path: read every summary on disk, sum by hand, compare with what the page states.
  const files = fs.readdirSync(path.join(ROOT, 'data')).filter((f) => /-summary\.json$/.test(f));
  const sums = files.map((f) => read('data/' + f));
  const N = sums.reduce((n, s) => n + s.scanned, 0);
  const failed = sums.reduce((n, s) => n + (s.failed || 0), 0);
  if (D.N !== N || D.failed !== failed) bad('totals: page says ' + D.N + '/' + D.failed + ', files say ' + N + '/' + failed);
  const bots = Object.keys(sums[0].crawlers.perBot);
  sums.forEach((s, i) => bots.forEach((b) => { const x = s.crawlers.perBot[b]; if (x.blocked + x.limited + x.open !== s.scanned) bad(files[i] + ' ' + b + ': blocked + limited + open is ' + (x.blocked + x.limited + x.open) + ', scanned is ' + s.scanned); }));
  const text = page.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  bots.forEach((b) => {
    const t = sums.reduce((n, s) => n + s.crawlers.perBot[b].blocked, 0);
    const shown = t > 0 && Math.round(t / N * 100) === 0 ? 'under 1%' : Math.round(t / N * 100) + '%';
    if (page.indexOf(b + ' ' + shown + ' (' + t + ' of ' + N + ')') === -1) bad('Fig. 1: ' + b + ' should read ' + shown + ' (' + t + ' of ' + N + ') in its description');
    const l = sums.reduce((n, s) => n + s.crawlers.perBot[b].limited, 0), o = sums.reduce((n, s) => n + s.crawlers.perBot[b].open, 0);
    if (page.indexOf(b + ': blocked ' + t + ', limited ' + l + ', open ' + o + ' of ' + N) === -1) bad('Fig. 3: ' + b + ' counts do not match the data');
  });
  sums.forEach((s, i) => { const label = esc(read('data/benchmarks.json').filter((e) => e.category === files[i].replace('-summary.json', ''))[0].label); if (page.indexOf(label + ' ' + s.crawlers.blockingAtLeastOnePct + '% of ' + s.scanned + ' homepages') === -1) bad('Fig. 2: ' + label + ' should read ' + s.crawlers.blockingAtLeastOnePct + '% of ' + s.scanned); });
  const pairs = N * bots.length, blocked = sums.reduce((n, s) => n + bots.reduce((m, b) => m + s.crawlers.perBot[b].blocked, 0), 0), limited = sums.reduce((n, s) => n + bots.reduce((m, b) => m + s.crawlers.perBot[b].limited, 0), 0), open = pairs - blocked - limited;
  if (text.indexOf('Of the ' + pairs + ' crawler-and-homepage pairs, ' + Math.round(blocked / pairs * 100) + '% are blocked, ' + Math.round(limited / pairs * 100) + '% are limited by an applicable Disallow rule and ' + Math.round(open / pairs * 100) + '% are open.') === -1) bad('key finding 3 does not match the data');
  if (text.indexOf(limited + ' of the ' + pairs + ' pairs are limited, ' + blocked + ' are blocked and ' + open + ' are open.') === -1) bad('section 03 counts do not match the data');
  ['Which AI crawlers do sites block? ' + N + ' homepages, six categories.'].forEach((t) => { if (page.indexOf(t) === -1) bad('the title is not "' + t + '"'); });

  // Page rules
  if ((page.match(/<h1[ >]/g) || []).length !== 1) bad('needs exactly one h1');
  const ldBlocks = (page.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []).map((b) => { try { return JSON.parse(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { bad('a JSON-LD block does not parse'); return {}; } });
  const types = [].concat.apply([], ldBlocks.map((b) => (b['@graph'] || [b]).map((x) => x['@type'])));
  if (types.indexOf('Article') === -1 || types.indexOf('Dataset') === -1) bad('Article and Dataset JSON-LD are both required');
  if (/\b(quietly|actually|seamlessly|effortless|powerful|unlock|elevate|supercharge|game-changing|revolutionize|landscape|delve|crucial|robust|recommended|coming soon)\b/i.test(text)) bad('a banned word');
  if (/gradient\(/i.test(page)) bad('a gradient');
  if (!/class="chart-bar--b2b"/.test(page) || !/class="chart-bar--dtc"/.test(page)) bad('B2B (navy-800) and consumer (gold) bars are required in Fig. 2');
  const meta = /<meta name="description" content="([^"]*)"/.exec(page);
  if (!meta || meta[1].length < 120 || meta[1].length > 160) bad('meta description length ' + (meta ? meta[1].length : 'missing'));
  const idx = fs.readFileSync(INDEX, 'utf8');
  if (idx !== updateIndex(idx, D)) bad('research/index.html does not list this report; run node scripts/generate-research-002.js');
  if (fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').indexOf('<loc>' + site.baseUrl + '/research/' + SLUG + '</loc>') === -1) bad('sitemap.xml has no entry');
  const ri = path.join(ROOT, 'content', 'research-index.json');
  if (!fs.existsSync(ri) || JSON.parse(fs.readFileSync(ri, 'utf8')).entries.filter((e) => e.slug === SLUG).length !== 1) bad('content/research-index.json has no entry; run node scripts/generate-research-index.js');
  return errors;
}

function main() {
  if (process.argv.indexOf('--check') !== -1) {
    const errors = check();
    if (errors.length) { errors.forEach((e) => console.error('FAIL: ' + e)); process.exit(1); }
    console.log('OK: research/' + SLUG + '.html matches data/*-summary.json; every figure recomputed; Article and Dataset JSON-LD parse; one h1');
    return;
  }
  const D = compute();
  fs.writeFileSync(PAGE, build(D), 'utf8');
  const idx = fs.readFileSync(INDEX, 'utf8');
  const next = updateIndex(idx, D);
  if (next !== idx) fs.writeFileSync(INDEX, next, 'utf8');
  console.log('research/' + SLUG + '.html written; research/index.html ' + (next !== idx ? 'updated' : 'already lists it') + '; ' + (ensureSitemap() ? 'added to sitemap.xml' : 'already in sitemap.xml'));
}

if (require.main === module) main();
module.exports = { indexEntry, compute, build };
