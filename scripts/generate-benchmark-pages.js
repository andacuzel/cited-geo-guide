#!/usr/bin/env node
/* =====================================================================
   scripts/generate-benchmark-pages.js

   Turns the category scan data into static pages. Everything comes from
   files that already exist:

     data/benchmarks.json          which categories, their labels and tracks
     data/<category>-summary.json  the numbers (scripts/scan-category.js)

   and writes

     benchmarks/<category>.html    one page per category
     benchmarks/index.html         every category, ranked by average score

   Static HTML with inline SVG figures generated from the numbers. Nothing
   is rendered client-side. Re-running rewrites the files in place.

   It also (idempotently) adds a Benchmarks link to the footer of every
   existing page except the research reports, and the new URLs to
   sitemap.xml.

   Usage:
     node scripts/generate-benchmark-pages.js           generate
     node scripts/generate-benchmark-pages.js --check   verify the written
                                                        pages against the
                                                        data, no writing

   Choices worth knowing:
   - "AI crawler access" never appears in the most-failed ranking. Five
     summaries store it as dynamic labels such as "(6/10 open)", each at
     100 or 0, which says nothing about how many sites failed; the sixth
     stores a static rate that is the same "not fully open" quantity this
     project does not quote as a finding. Crawler access is shown per
     crawler instead (blocked, limited, open).
   - Colour: --navy-800 for B2B SaaS, --gold for consumer and e-commerce,
     as in the research reports.
   ===================================================================== */

const fs = require('fs');
const siteChrome = require('./site-chrome.js');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'benchmarks');
const SITE = require('../lib/site-config.js').baseUrl;
const CSS_VERSION = 58; // bump when styles.css changes

const TRACKS = {
  'B2B SaaS': { bar: 'chart-bar--b2b', fill: 'bm-fill--b2b', marker: 'var(--navy-800)', onBar: 'chart-seg-text--light' },
  'Consumer & e-commerce': { bar: 'chart-bar--dtc', fill: 'bm-fill--dtc', marker: 'var(--gold-deep)', onBar: 'chart-seg-text--dark' }
};
const PILLARS = [
  { key: 'averageDiscoverability', name: 'Discoverability', max: 40 },
  { key: 'averageTechnical', name: 'Technical foundation', max: 20 },
  { key: 'averageTrust', name: 'Content & trust', max: 40 }
];
const TOP_CHECKS = 8;
const SKIP_FOOTER = [];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* ---------------------------------------------------------------------
   Helpers
   --------------------------------------------------------------------- */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
const r1 = (x) => Math.round(x * 10) / 10;
const plural = (n, one, many) => (n === 1 ? one : many);

function parseDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) throw new Error('Bad scan date "' + iso + '"');
  return { y: +m[1], m: +m[2] - 1, d: +m[3] };
}
const dateShort = (iso) => { const p = parseDate(iso); return MONTHS[p.m] + ' ' + p.d + ', ' + p.y; };
const dateLong = (iso) => { const p = parseDate(iso); return MONTHS_LONG[p.m] + ' ' + p.d + ', ' + p.y; };
const monthYear = (iso) => { const p = parseDate(iso); return MONTHS_LONG[p.m] + ' ' + p.y; };
function dateWindow(isos) {
  const s = isos.slice().sort();
  const a = parseDate(s[0]);
  const b = parseDate(s[s.length - 1]);
  if (s[0] === s[s.length - 1]) return dateShort(s[0]);
  if (a.y === b.y && a.m === b.m) return MONTHS[a.m] + ' ' + a.d + '–' + b.d + ', ' + a.y;
  return dateShort(s[0]) + ' – ' + dateShort(s[s.length - 1]);
}

/* ---------------------------------------------------------------------
   Data
   --------------------------------------------------------------------- */

function loadAll() {
  const entries = JSON.parse(fs.readFileSync(path.join(DATA, 'benchmarks.json'), 'utf8'));
  const errors = [];
  const cats = [];
  entries.forEach(function (e) {
    if (!e.category || !e.label || !TRACKS[e.track]) { errors.push('Bad entry in benchmarks.json: ' + JSON.stringify(e)); return; }
    const f = path.join(DATA, e.category + '-summary.json');
    if (!fs.existsSync(f)) { errors.push(e.category + ': no summary file'); return; }
    const s = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!s.score || typeof s.score.average !== 'number' || !s.scanned || !s.scannedAt || !s.crawlers || !s.crawlers.perBot || !s.checkFailureRates) {
      errors.push(e.category + ': summary is missing fields'); return;
    }
    cats.push(derive(e, s));
  });
  if (errors.length) throw new Error(errors.join('\n'));
  const total = cats.reduce((n, c) => n + c.scanned, 0);
  const overall = Math.round(cats.reduce((n, c) => n + c.avg * c.scanned, 0) / total);
  return { cats: cats, total: total, overall: overall };
}

function derive(e, s) {
  const pillars = PILLARS.map(function (p) {
    const v = s.score[p.key];
    if (typeof v !== 'number') throw new Error(e.category + ': no ' + p.key);
    return { name: p.name, max: p.max, value: v, pct: Math.round((v / p.max) * 100) };
  });
  // Ranked as stored (descending, stable). AI crawler access is left out: see the header.
  const checks = Object.entries(s.checkFailureRates)
    .filter(function (kv) { return !/^AI crawler access/i.test(kv[0]); })
    .map(function (kv) { return { label: kv[0], pct: kv[1] }; });
  const bots = Object.entries(s.crawlers.perBot).map(function (kv) {
    return { name: kv[0], blocked: kv[1].blocked, limited: kv[1].limited, open: kv[1].open };
  });
  bots.forEach(function (b) {
    if (b.blocked + b.limited + b.open !== s.scanned) throw new Error(e.category + ': ' + b.name + ' counts do not add up to ' + s.scanned);
  });
  return {
    slug: e.category, label: e.label, track: e.track, note: e.note || 'sites',
    scanned: s.scanned, failed: s.failed || 0, date: s.scannedAt,
    avg: s.score.average, median: s.score.median, low: s.score.lowest, high: s.score.highest,
    pillars: pillars, checks: checks, bots: bots
  };
}

/* ---------------------------------------------------------------------
   Figures. Every value is also written as a data-* attribute so --check
   can compare the generated HTML with the summary files.
   --------------------------------------------------------------------- */

function fig1(c) {
  const t = TRACKS[c.track];
  const X0 = 20, W = 380;
  const x = (v) => r1(X0 + (v / 100) * W);
  const barX = x(c.low), barW = r1(x(c.high) - x(c.low));
  const desc = c.label + ' sites range from ' + c.low + ' to ' + c.high + ' out of 100, averaging ' + c.avg + ', across ' + c.scanned + ' sites.';
  const ticks = [0, 25, 50, 75, 100];
  return (
    '<svg viewBox="0 0 420 160" role="img" aria-labelledby="fig1-title fig1-desc" xmlns="http://www.w3.org/2000/svg">\n' +
    '  <title id="fig1-title">Score range for ' + esc(c.label) + '</title>\n' +
    '  <desc id="fig1-desc">' + esc(desc) + '</desc>\n' +
    '  <text x="20" y="16" class="chart-label" font-size="15">' + esc(c.label) + ' · ' + c.scanned + ' ' + esc(c.note) + '</text>\n' +
    '  <text x="' + x(c.avg) + '" y="40" class="chart-value" font-size="14" text-anchor="middle" data-fig="range" data-kind="average" data-value="' + c.avg + '">' + c.avg + '</text>\n' +
    '  <rect class="' + t.bar + '" x="' + barX + '" y="48" width="' + barW + '" height="14" rx="7" opacity="0.4" data-fig="range" data-kind="span" data-low="' + c.low + '" data-high="' + c.high + '"/>\n' +
    '  <line x1="' + x(c.avg) + '" y1="44" x2="' + x(c.avg) + '" y2="66" stroke="' + t.marker + '" stroke-width="2.5"/>\n' +
    '  <text x="' + barX + '" y="84" class="chart-value" font-size="14" text-anchor="start" data-fig="range" data-kind="low" data-value="' + c.low + '">' + c.low + '</text>\n' +
    '  <text x="' + r1(barX + barW) + '" y="84" class="chart-value" font-size="14" text-anchor="end" data-fig="range" data-kind="high" data-value="' + c.high + '">' + c.high + '</text>\n' +
    '  <line class="chart-axis" x1="20" y1="108" x2="400" y2="108"/>\n' +
    ticks.map(function (v) { return '  <line class="chart-axis" x1="' + x(v) + '" y1="104" x2="' + x(v) + '" y2="112"/>'; }).join('\n') + '\n' +
    ticks.map(function (v) { return '  <text x="' + x(v) + '" y="128" class="chart-label chart-label--faint" font-size="13" text-anchor="middle">' + v + '</text>'; }).join('\n') + '\n' +
    '  <text x="210" y="152" class="chart-label chart-label--faint" font-size="13" text-anchor="middle">AI visibility score (0–100)</text>\n' +
    '</svg>'
  );
}

function fig2(c) {
  const t = TRACKS[c.track];
  const W = 340;
  const desc = c.pillars.map(function (p) { return p.name + ', maximum ' + p.max + ' points: ' + p.value + '.'; }).join(' ');
  const rows = c.pillars.map(function (p, i) {
    const y = 14 + i * 48;
    const fill = r1((p.value / p.max) * W);
    return (
      '  <text x="10" y="' + y + '" class="chart-label" font-size="14.5">' + esc(p.name) + ' · max ' + p.max + '</text>\n' +
      '  <rect class="chart-track" x="10" y="' + (y + 8) + '" width="' + W + '" height="14" rx="3"/>\n' +
      '  <rect class="' + t.bar + '" x="10" y="' + (y + 8) + '" width="' + fill + '" height="14" rx="3" data-fig="pillar" data-name="' + esc(p.name) + '" data-value="' + p.value + '" data-max="' + p.max + '"/>\n' +
      '  <text x="' + r1(10 + fill + 6) + '" y="' + (y + 19) + '" class="chart-value" font-size="13">' + p.value + '/' + p.max + '</text>'
    );
  }).join('\n');
  return (
    '<svg viewBox="0 0 420 180" role="img" aria-labelledby="fig2-title fig2-desc" xmlns="http://www.w3.org/2000/svg">\n' +
    '  <title id="fig2-title">Pillar averages against their maximums</title>\n' +
    '  <desc id="fig2-desc">' + esc('Average score per pillar for ' + c.label + '. ' + desc) + '</desc>\n' +
    rows + '\n' +
    '  <text x="10" y="170" class="chart-label chart-label--faint" font-size="12.5">Filled = points earned. Unfilled = gap to maximum.</text>\n' +
    '</svg>'
  );
}

function topChecks(c) { return c.checks.slice(0, TOP_CHECKS); }

function fig3(c) {
  const t = TRACKS[c.track];
  const list = topChecks(c);
  const W = 340;
  const desc = list.map(function (k) { return k.label + ': ' + k.pct + '%'; }).join('; ') + '.';
  const rows = list.map(function (k, i) {
    const y = 14 + i * 38;
    const fill = r1((k.pct / 100) * W);
    return (
      '  <text x="10" y="' + y + '" class="chart-label" font-size="13.5">' + esc(k.label) + '</text>\n' +
      '  <rect class="chart-track" x="10" y="' + (y + 8) + '" width="' + W + '" height="14" rx="3"/>\n' +
      '  <rect class="' + t.bar + '" x="10" y="' + (y + 8) + '" width="' + fill + '" height="14" rx="3" data-fig="check" data-label="' + esc(k.label) + '" data-value="' + k.pct + '"/>\n' +
      '  <text x="' + r1(10 + fill + 6) + '" y="' + (y + 19) + '" class="chart-value" font-size="13">' + k.pct + '%</text>'
    );
  }).join('\n');
  const H = 14 + list.length * 38 + 6;
  return (
    '<svg viewBox="0 0 420 ' + H + '" role="img" aria-labelledby="fig3-title fig3-desc" xmlns="http://www.w3.org/2000/svg">\n' +
    '  <title id="fig3-title">The ' + list.length + ' most-failed checks for ' + esc(c.label) + '</title>\n' +
    '  <desc id="fig3-desc">' + esc('Share of sites that did not earn full points, most-failed first. ' + desc) + '</desc>\n' +
    rows + '\n</svg>'
  );
}

function fig4(c) {
  const t = TRACKS[c.track];
  const X = 130, W = 200;
  const rows = c.bots.map(function (b, i) {
    const y = 14 + i * 28;
    let cx = X;
    const seg = function (state, n, cls) {
      const w = r1((n / c.scanned) * W);
      const out = '  <rect class="' + cls + '" x="' + r1(cx) + '" y="' + (y - 1) + '" width="' + w + '" height="16" data-fig="crawler" data-bot="' + esc(b.name) + '" data-state="' + state + '" data-value="' + n + '"/>\n' +
        (w >= 20 ? '  <text x="' + r1(cx + w / 2) + '" y="' + (y + 11) + '" class="chart-seg-text ' + (state === 'open' ? t.onBar : state === 'limited' ? 'chart-seg-text--dark' : 'chart-seg-text--light') + '" text-anchor="middle">' + n + '</text>\n' : '');
      cx += w;
      return out;
    };
    return (
      '  <text x="10" y="' + (y + 11) + '" class="chart-label" font-size="12.5">' + esc(b.name) + '</text>\n' +
      seg('open', b.open, t.bar) + seg('limited', b.limited, 'chart-bar--limited') + seg('blocked', b.blocked, 'chart-bar--blocked') +
      '  <text x="340" y="' + (y + 11) + '" class="chart-label chart-label--faint" font-size="12.5">' + b.blocked + ' blocked</text>'
    );
  }).join('\n');
  const ly = 14 + c.bots.length * 28 + 8;
  const H = ly + 26;
  const desc = c.bots.map(function (b) { return b.name + ': ' + b.open + ' open, ' + b.limited + ' limited, ' + b.blocked + ' blocked'; }).join('; ') + '.';
  return (
    '<svg viewBox="0 0 420 ' + H + '" role="img" aria-labelledby="fig4-title fig4-desc" xmlns="http://www.w3.org/2000/svg">\n' +
    '  <title id="fig4-title">Access by AI crawler across ' + c.scanned + ' sites</title>\n' +
    '  <desc id="fig4-desc">' + esc('Number of ' + c.label + ' sites where each crawler is open, limited or blocked. ' + desc) + '</desc>\n' +
    rows + '\n' +
    '  <rect class="' + t.bar + '" x="10" y="' + ly + '" width="10" height="10"/>\n' +
    '  <text x="26" y="' + (ly + 9) + '" class="chart-label chart-label--faint" font-size="12.5">Open</text>\n' +
    '  <rect class="chart-bar--limited" x="76" y="' + ly + '" width="10" height="10"/>\n' +
    '  <text x="92" y="' + (ly + 9) + '" class="chart-label chart-label--faint" font-size="12.5">Limited</text>\n' +
    '  <rect class="chart-bar--blocked" x="156" y="' + ly + '" width="10" height="10"/>\n' +
    '  <text x="172" y="' + (ly + 9) + '" class="chart-label chart-label--faint" font-size="12.5">Blocked</text>\n' +
    '</svg>'
  );
}

/* ---------------------------------------------------------------------
   Sentences: plain templates over the numbers, no editorialising
   --------------------------------------------------------------------- */

function findings(c, overall) {
  const diff = c.avg - overall;
  const s1 = 'The average score in the ' + c.label + ' category is ' + c.avg + '/100, ' +
    (diff === 0 ? 'the same as the all-category average of ' + overall + '.'
      : Math.abs(diff) + ' ' + plural(Math.abs(diff), 'point', 'points') + ' ' + (diff > 0 ? 'above' : 'below') + ' the all-category average of ' + overall + '.');

  const hi = Math.max.apply(null, c.pillars.map((p) => p.pct));
  const lo = Math.min.apply(null, c.pillars.map((p) => p.pct));
  const strong = c.pillars.filter((p) => p.pct === hi);
  const weak = c.pillars.filter((p) => p.pct === lo);
  const name = (list) => list.map((p) => p.name).join(' and ');
  const val = (p) => p.value + '/' + p.max;
  const s2 = hi === lo
    ? 'In the ' + c.label + ' category the three pillars average the same share of their maximums, ' + hi + '%.'
    : 'Of the three pillars, ' + name(strong) + ' ' + (strong.length > 1 ? 'are' : 'is') + ' the strongest in the ' + c.label + ' category at ' +
      val(strong[0]) + ' (' + hi + '% of the maximum), and ' + name(weak) + ' ' + (weak.length > 1 ? 'are' : 'is') + ' the weakest at ' + val(weak[0]) + ' (' + lo + '%).';

  const top = c.checks[0].pct;
  const tied = c.checks.filter((k) => k.pct === top);
  const s3 = tied.length === 1
    ? 'In the ' + c.label + ' category, ' + tied[0].label + ' is the most-failed check: ' + top + '% of sites did not earn full points on it.'
    : 'In the ' + c.label + ' category, the most-failed checks are ' + tied.map((k) => k.label).join(' and ') + ', each at ' + top + '%: that share of sites did not earn full points on them.';
  return [s1, s2, s3];
}

function tieNote(c) {
  const list = c.checks;
  if (list.length > TOP_CHECKS && list[TOP_CHECKS].pct === list[TOP_CHECKS - 1].pct) {
    return ' Checks tied at ' + list[TOP_CHECKS - 1].pct + '% are listed in scan order, so a tied check may fall just outside the eight.';
  }
  return '';
}

/* ---------------------------------------------------------------------
   Page shell, taken from an existing page so the header never drifts
   --------------------------------------------------------------------- */

function shell() {
  const src = fs.readFileSync(path.join(ROOT, 'citation-tracking.html'), 'utf8');
  const header = (/ {2}<header class="site-header">[\s\S]*?<\/header>/.exec(src) || [])[0];
  const icon = (/ {2}<link rel="icon"[^\n]*/.exec(src) || [])[0];
  const fonts = (/ {2}<link rel="preconnect"[\s\S]*?rel="stylesheet" \/>/.exec(src) || [])[0];
  if (!header || !icon || !fonts) throw new Error('Could not read the page shell from citation-tracking.html');
  return { header: header, icon: icon, fonts: fonts };
}

function head(title, desc, url, ld) {
  const sh = shell();
  return (
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n\n' +
    '  <title>' + esc(title) + '</title>\n' +
    '  <meta name="description" content="' + esc(desc) + '" />\n' +
    '  <meta name="author" content="Citehound" />\n  <meta name="robots" content="index, follow" />\n' +
    '  <link rel="canonical" href="' + url + '" />\n\n' +
    '  <!-- Open Graph -->\n  <meta property="og:type" content="website" />\n' +
    '  <meta property="og:title" content="' + esc(title) + '" />\n' +
    '  <meta property="og:description" content="' + esc(desc) + '" />\n' +
    '  <meta property="og:url" content="' + url + '" />\n' +
    '  <meta property="og:image" content="' + SITE + '/assets/brand/og-default.png" />\n  <meta property="og:site_name" content="Citehound" />\n\n' +
    '  <!-- Twitter -->\n  <meta name="twitter:card" content="summary_large_image" />\n' +
    '  <meta name="twitter:title" content="' + esc(title) + '" />\n' +
    '  <meta name="twitter:description" content="' + esc(desc) + '" />\n' +
    '  <meta name="twitter:image" content="' + SITE + '/assets/brand/og-default.png" />\n\n' +
    sh.icon + '\n\n' + sh.fonts + '\n\n' +
    '  <link rel="stylesheet" href="../styles.css?v=' + CSS_VERSION + '" />\n\n' +
    '  <script type="application/ld+json">\n  ' + JSON.stringify(ld, null, 2).replace(/\n/g, '\n  ') + '\n  </script>\n' +
    siteChrome.schemaBlock().replace(/^/gm, '  ') + '\n' +
    '</head>\n<body>\n  <a class="skip-link" href="#main">Skip to content</a>\n\n' +
    sh.header + '\n\n  <main id="main">\n'
  );
}

function footer(scripts) {
  return (
    '\n    <footer class="site-footer" aria-label="Footer">\n' +
    '      <div class="section__inner">\n' +
    '        <nav class="site-nav footer-links" aria-label="More">\n' +
    '          <a href="/playbooks" class="site-nav__link">Playbooks</a>\n' +
    '          <a href="/methodology" class="site-nav__link">Methodology</a>\n' +
    '          <a href="/benchmarks" class="site-nav__link">Benchmarks</a>\n' +
    '          <a href="/citation-tracking" class="site-nav__link">Citation tracking</a>\n' +
    '          <a href="/trust" class="site-nav__link">Trust</a>\n' +
    '          <a href="/changelog" class="site-nav__link">Changelog</a>\n' +
    '          <a href="/privacy" class="site-nav__link">Privacy</a>\n' +
    '          <a href="/terms" class="site-nav__link">Terms</a>\n' +
    siteChrome.contactLine('          ') + '\n' +
    '        </nav>\n' +
    '        <p class="site-footer__coda">© 2026 Citehound. Built for teams navigating the shift from search to answers.</p>\n' +
    '      </div>\n    </footer>\n\n  </main>\n\n' +
    '  <div class="toast" id="toast" role="status" aria-live="polite"></div>\n\n' +
    '  <script src="../nav.js?v=3"></script>\n' + (scripts || '') +
    '</body>\n</html>\n'
  );
}

function statBand(items) {
  return (
    '    <section aria-label="Scope">\n      <div class="section__inner">\n' +
    '        <div class="hero__figures report-stats" aria-label="Benchmark scope">\n' +
    items.map(function (i) { return '          <div class="hero__figure"><b data-stat="' + esc(i.key) + '">' + esc(i.value) + '</b><span>' + esc(i.label) + '</span></div>'; }).join('\n') + '\n' +
    '        </div>\n      </div>\n    </section>\n'
  );
}

function banner(kicker, title, desc) {
  return (
    '    <section aria-labelledby="report-heading">\n      <div class="section__inner">\n        <div class="page-banner">\n          <div class="page-banner__body">\n' +
    '            <p class="kicker kicker--on-navy">' + esc(kicker) + '</p>\n' +
    '            <h1 id="report-heading" class="page-banner__title">' + esc(title) + '</h1>\n' +
    '            <p class="page-banner__desc">' + esc(desc) + '</p>\n' +
    '          </div>\n        </div>\n      </div>\n    </section>\n'
  );
}

function figureSection(id, heading, lead, label, svg, caption, source) {
  return (
    '    <section aria-labelledby="' + id + '-heading">\n      <div class="section__inner">\n        <div class="report-section">\n' +
    '          <h2 id="' + id + '-heading" class="report-section__heading">' + esc(heading) + '</h2>\n' +
    '          <p>' + esc(lead) + '</p>\n' +
    '          <figure class="report-figure">\n            <p class="report-figure__label">' + esc(label) + '</p>\n' +
    '            <p class="report-figure__hint" aria-hidden="true">Scroll sideways to see the whole figure.</p>\n' +
    '            <div class="report-figure__visual report-figure__visual--scroll" role="group" aria-label="' + esc(label) + ', scrolls sideways on narrow screens" tabindex="0">\n' + svg.replace(/^/gm, '              ') + '\n            </div>\n' +
    '            <figcaption class="report-figure__caption">' + esc(caption) + '</figcaption>\n' +
    '            <p class="report-figure__source">' + esc(source) + '</p>\n          </figure>\n        </div>\n      </div>\n    </section>\n'
  );
}

/* ---------------------------------------------------------------------
   Category page
   --------------------------------------------------------------------- */

function categoryPage(c, overall) {
  const url = SITE + '/benchmarks/' + c.slug;
  const source = 'Source: Citehound scan, ' + dateLong(c.date) + ', ' + c.scanned + ' ' + c.note;
  const title = 'Citehound — ' + c.label + ': AI Readiness Benchmark';
  const desc = c.label + ': ' + c.scanned + ' ' + c.note + ' scanned on ' + dateLong(c.date) + ', average AI readiness score ' + c.avg + '/100 (range ' + c.low + ' to ' + c.high +
    '). Pillars, top failed checks and crawler access.';
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'Citehound AI readiness scan: ' + c.label + ', ' + monthYear(c.date),
    description: 'Scan results for ' + c.scanned + ' ' + c.label + ' domains (' + c.note + '), scored out of 100 across discoverability, technical foundation and content and trust. Homepages only, each scanned once on ' + dateLong(c.date) + '.',
    temporalCoverage: c.date,
    creator: { '@type': 'Organization', name: 'Citehound', url: SITE + '/' },
    variableMeasured: [
      { '@type': 'PropertyValue', name: 'Domains scanned', value: c.scanned },
      { '@type': 'PropertyValue', name: 'Average score (out of 100)', value: c.avg }
    ],
    isAccessibleForFree: true,
    url: url
  };
  const f = findings(c, overall);
  const worst = topChecks(c);
  const cite = 'Citehound, “AI readiness benchmark: ' + c.label + ',” ' + dateLong(c.date) + '. ' + url;

  let h = head(title, desc, url, ld);
  h += banner('Benchmarks · ' + c.track, c.label + ': AI readiness benchmark',
    c.scanned + ' ' + c.note + ' scanned on ' + dateLong(c.date) + '. The average score is ' + c.avg + ' out of 100. Homepages only, from a hand-picked list.');
  h += statBand([
    { key: 'scanned', value: String(c.scanned), label: 'sites scanned' },
    { key: 'average', value: String(c.avg), label: 'average score' },
    { key: 'range', value: c.low + '–' + c.high, label: 'score range' },
    { key: 'date', value: dateShort(c.date), label: 'scan date' }
  ]);
  h += '    <section aria-label="Key findings">\n      <div class="section__inner">\n        <div class="report-findings">\n          <p class="report-findings__label">Key findings</p>\n          <ol>\n' +
    f.map(function (s, i) { return '            <li><span class="report-findings__num">' + (i + 1) + '</span><p data-finding="' + (i + 1) + '">' + esc(s) + '</p></li>'; }).join('\n') +
    '\n          </ol>\n        </div>\n      </div>\n    </section>\n';

  h += figureSection('range', 'Where the scores fall',
    'The lowest score is ' + c.low + ', the highest is ' + c.high + ' and the average is ' + c.avg + ', out of 100.', 'Fig. 1', fig1(c),
    'The bar spans the lowest to the highest score in the category. The marker is the average.', source);
  h += figureSection('pillars', 'The three pillars',
    'Each score is built from three pillars worth 40, 20 and 40 points. These are the category averages.', 'Fig. 2', fig2(c),
    'Filled is the average points earned; the track is the maximum for that pillar.', source);
  h += figureSection('checks', 'The checks sites miss most',
    'Share of sites that did not earn full points, for the ' + worst.length + ' most-failed checks.', 'Fig. 3', fig3(c),
    'Ranked from most to least failed. A site fails a check by earning less than its full points, which includes partial credit. AI crawler access is shown by crawler in the next figure instead.' + tieNote(c), source);
  h += figureSection('crawlers', 'Which AI crawlers can get in',
    'Counts of sites, for each of ' + c.bots.length + ' AI crawlers, where it is open, limited or blocked.', 'Fig. 4', fig4(c),
    'Open: no rule keeps the crawler out. Limited: at least one Disallow rule applies to the crawler, mostly an ordinary path such as /wp-admin/, and the rest of the site is open to it. Limited is not a block, although the scan gives it half credit. Blocked: the whole site is disallowed.', source);

  h += (
    '    <section aria-labelledby="methodology-heading">\n      <div class="section__inner">\n        <div class="report-methodology">\n' +
    '          <h2 id="methodology-heading">Method and limits</h2>\n\n' +
    '          <h3>What we scanned</h3>\n' +
    '          <p>' + c.scanned + ' ' + esc(c.note) + ' in this category completed a scan on ' + dateLong(c.date) + '. ' + c.failed + ' more on the list could not be reached or timed out. They are excluded from every figure on this page.</p>\n\n' +
    '          <h3>What we pulled</h3>\n' +
    '          <p>For each site: robots.txt, sitemap.xml, llms.txt and the homepage, retrieved live. Homepages only. Inner pages were not scanned, and each site was scanned once.</p>\n\n' +
    '          <h3>What we scored</h3>\n' +
    '          <p>One score out of 100 per site, split across three pillars: ' + c.pillars.map(function (p) { return esc(p.name.toLowerCase()) + ' (' + p.max + ')'; }).join(', ') + '. The checks and their point values are on the <a href="/methodology">methodology page</a>.</p>\n\n' +
    '          <h3>How the sites were chosen</h3>\n' +
    '          <p>The lists are hand-picked, well-known sites in the category. They are not a random sample, so these figures describe the sites we scanned, not the category as a whole.</p>\n\n' +
    '          <h3>Repeat scans</h3>\n' +
    '          <p>In one October 2026 rescan of the same lists, category averages moved by one point or less. Individual sites moved more: about a third changed by 3 to 15 points.</p>\n\n' +
    '          <h3>What this measures</h3>\n' +
    '          <p>Whether AI systems can reach a site, and whether its homepage carries the signals machines read. It does not measure whether any assistant names a brand in an answer. Model responses vary by prompt, session and training data, and no scan of public files can predict them.</p>\n\n' +
    '          <div class="report-limits">\n' +
    '            <p style="font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--risk); margin-bottom: 12px;">What this doesn’t tell you</p>\n' +
    '            <ul>\n' +
    '              <li>Anything about pages other than the homepage.</li>\n' +
    '              <li>Why the unreachable sites could not be scanned, or how they would have scored.</li>\n' +
    '              <li>Whether any of these signals relates to being named in an AI answer. This page measures inputs, not outcomes.</li>\n' +
    '            </ul>\n          </div>\n        </div>\n      </div>\n    </section>\n\n' +
    '    <section aria-labelledby="cite-heading">\n      <div class="section__inner">\n        <div class="report-cite">\n' +
    '          <p id="cite-heading" class="report-cite__label">How to cite this</p>\n' +
    '          <p class="report-cite__line" id="citeLine">' + esc(cite) + '</p>\n' +
    '          <p class="report-cite__url">Canonical URL: <a href="' + url + '">' + url + '</a></p>\n' +
    '          <div class="report-cite__row" id="citeRow" hidden>\n' +
    '            <button type="button" class="btn btn--ghost" id="citeCopyBtn">\n' +
    '              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="9" rx="1.5"/><path d="M3.5 10.5v-6a1.5 1.5 0 011.5-1.5h6"/></svg>\n' +
    '              Copy citation\n            </button>\n          </div>\n        </div>\n      </div>\n    </section>\n\n' +
    '    <section aria-label="Closing">\n      <div class="section__inner">\n        <div class="report-closing">\n' +
    '          <p>To see where your own site lands against these numbers, run the free scan. <a href="/benchmarks">All benchmarks</a>.</p>\n' +
    '          <a href="/" class="btn btn--primary">Scan your site free</a>\n        </div>\n      </div>\n    </section>\n'
  );
  h += footer('  <script>document.getElementById(\'citeRow\').hidden = false;</script>\n  <script src="../research.js?v=1"></script>\n');
  return h;
}

/* ---------------------------------------------------------------------
   Index page
   --------------------------------------------------------------------- */

function indexPage(all) {
  const ranked = all.cats.slice().sort((a, b) => b.avg - a.avg || b.scanned - a.scanned);
  const url = SITE + '/benchmarks';
  const win = dateWindow(all.cats.map((c) => c.date));
  const first = all.cats.map((c) => c.date).sort()[0];
  const last = all.cats.map((c) => c.date).sort().slice(-1)[0];
  const title = 'Citehound — AI Readiness Benchmarks by Category';
  const desc = all.total + ' well-known sites across ' + all.cats.length + ' categories, scanned in ' + monthYear(last) + '. Average AI readiness score ' + all.overall + '/100. Pillars, failed checks and crawler access.';
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'Citehound AI readiness scans by category, ' + monthYear(last),
    description: 'Scan results for ' + all.total + ' domains across ' + all.cats.length + ' categories, from homepages only, each scanned once between ' + first + ' and ' + last + '.',
    temporalCoverage: first + '/' + last,
    creator: { '@type': 'Organization', name: 'Citehound', url: SITE + '/' },
    variableMeasured: [{ '@type': 'PropertyValue', name: 'Domains scanned', value: all.total }],
    isAccessibleForFree: true,
    url: url
  };
  const rows = ranked.map(function (c) {
    const t = TRACKS[c.track];
    return (
      '            <li class="bm-row" data-category="' + esc(c.slug) + '" data-average="' + c.avg + '" data-scanned="' + c.scanned + '" data-date="' + esc(c.date) + '">\n' +
      '              <div class="bm-row__name"><a href="/benchmarks/' + esc(c.slug) + '">' + esc(c.label) + '</a><span class="bm-row__track">' + esc(c.track) + '</span></div>\n' +
      '              <div class="bm-row__bar" aria-hidden="true"><span class="bm-row__fill ' + t.fill + '" style="width:' + Math.max(0, Math.min(100, c.avg)) + '%"></span></div>\n' +
      '              <div class="bm-row__score"><b>' + c.avg + '</b><small>/100</small></div>\n' +
      '              <p class="bm-row__meta">' + c.scanned + ' ' + esc(c.note) + ' · ' + esc(dateShort(c.date)) + '</p>\n' +
      '            </li>'
    );
  }).join('\n');

  let h = head(title, desc, url, ld);
  h += banner('Benchmarks', 'AI readiness by category',
    'We scanned ' + all.total + ' well-known sites across ' + all.cats.length + ' categories. The average score is ' + all.overall + ' out of 100. Pick a category to see where its sites fall.');
  h += statBand([
    { key: 'scanned', value: String(all.total), label: 'sites scanned' },
    { key: 'categories', value: String(all.cats.length), label: 'categories' },
    { key: 'average', value: String(all.overall), label: 'average score' },
    { key: 'window', value: win, label: 'scan window' }
  ]);
  h += (
    '    <section aria-labelledby="ranked-heading">\n      <div class="section__inner">\n        <div class="report-section">\n' +
    '          <h2 id="ranked-heading" class="report-section__heading">Categories, ranked by average score</h2>\n' +
    '          <p>Average score out of 100 for each category, highest first. Each name opens that category’s page.</p>\n' +
    '          <div class="report-figure">\n' +
    '            <div class="bm-legend" aria-label="Colour key">\n' +
    '              <span class="bm-legend__item"><span class="bm-legend__swatch bm-fill--b2b"></span>B2B SaaS</span>\n' +
    '              <span class="bm-legend__item"><span class="bm-legend__swatch bm-fill--dtc"></span>Consumer &amp; e-commerce</span>\n' +
    '            </div>\n' +
    '            <ol class="bm-list">\n' + rows + '\n            </ol>\n' +
    '            <p class="report-figure__source">Source: Citehound scans, ' + esc(win) + ', ' + all.total + ' sites</p>\n' +
    '          </div>\n' +
    '          <p>The lists are hand-picked, well-known sites, not a random sample. Each site was scanned once, homepages only, and sites that could not be reached are excluded from every figure. The scores measure readiness for AI systems, not whether any assistant names a brand. See the <a href="/methodology">methodology</a>.</p>\n' +
    '        </div>\n      </div>\n    </section>\n\n' +
    '    <section aria-label="Closing">\n      <div class="section__inner">\n        <div class="report-closing">\n' +
    '          <p>To see where your own site lands against these categories, run the free scan.</p>\n' +
    '          <a href="/" class="btn btn--primary">Scan your site free</a>\n        </div>\n      </div>\n    </section>\n'
  );
  h += footer('');
  return h;
}

/* ---------------------------------------------------------------------
   Footer links and sitemap
   --------------------------------------------------------------------- */

function htmlFiles() {
  const out = [];
  const add = (dir) => fs.readdirSync(path.join(ROOT, dir)).forEach(function (f) { if (f.endsWith('.html')) out.push(path.posix.join(dir, f)); });
  fs.readdirSync(ROOT).forEach(function (f) { if (f.endsWith('.html')) out.push(f); });
  ['tools', 'research'].forEach(function (d) { if (fs.existsSync(path.join(ROOT, d))) add(d); });
  return out;
}

function ensureFooterLinks() {
  const changed = [];
  htmlFiles().forEach(function (rel) {
    if (SKIP_FOOTER.indexOf(rel) !== -1) return;
    const file = path.join(ROOT, rel);
    const src = fs.readFileSync(file, 'utf8');
    if (src.indexOf('href="/benchmarks"') !== -1) return;
    const re = /\n([ \t]*)<a href="\/methodology" class="site-nav__link">Methodology<\/a>/;
    if (!re.test(src)) return;
    fs.writeFileSync(file, src.replace(re, function (m, ind) {
      return m + '\n' + ind + '<a href="/benchmarks" class="site-nav__link">Benchmarks</a>';
    }), 'utf8');
    changed.push(rel);
  });
  return changed;
}

function ensureSitemap(all) {
  const file = path.join(ROOT, 'sitemap.xml');
  let xml = fs.readFileSync(file, 'utf8');
  const wanted = [SITE + '/benchmarks'].concat(all.cats.map((c) => SITE + '/benchmarks/' + c.slug));
  const added = [];
  wanted.forEach(function (loc) {
    if (xml.indexOf('<loc>' + loc + '</loc>') !== -1) return;
    xml = xml.replace('</urlset>', '  <url>\n    <loc>' + loc + '</loc>\n  </url>\n</urlset>');
    added.push(loc);
  });
  if (added.length) fs.writeFileSync(file, xml, 'utf8');
  return added;
}

/* ---------------------------------------------------------------------
   --check: parse what was written and compare it with the data
   --------------------------------------------------------------------- */

function check(all) {
  const problems = [];
  const bad = (m) => problems.push(m);
  const attr = (tag, name) => { const m = new RegExp(name + '="([^"]*)"').exec(tag); return m ? m[1] : null; };
  const tags = (html, fig) => html.match(new RegExp('<(?:rect|text|line)[^>]*data-fig="' + fig + '"[^>]*>', 'g')) || [];
  const unesc = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const near = (a, b) => Math.abs(a - b) < 0.11;
  const domains = new Set();
  const dir = path.join(ROOT, 'domains');
  if (fs.existsSync(dir)) fs.readdirSync(dir).forEach(function (f) {
    fs.readFileSync(path.join(dir, f), 'utf8').split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l && l[0] !== '#' && l.indexOf('.') > 0).forEach((d) => domains.add(d));
  });
  let compared = 0;
  const eq = (what, got, want) => { compared++; if (String(got) !== String(want)) bad(what + ': page has ' + got + ', data has ' + want); };

  all.cats.forEach(function (c) {
    const file = path.join(OUT, c.slug + '.html');
    if (!fs.existsSync(file)) { bad(c.slug + ': page missing'); return; }
    const html = fs.readFileSync(file, 'utf8');
    const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ');
    const tag = (n) => c.slug + ' ' + n;

    // stat band
    const stat = (k) => { const m = new RegExp('data-stat="' + k + '">([^<]*)<').exec(html); return m ? unesc(m[1]) : null; };
    eq(tag('stat scanned'), stat('scanned'), c.scanned);
    eq(tag('stat average'), stat('average'), c.avg);
    eq(tag('stat range'), stat('range'), c.low + '–' + c.high);
    eq(tag('stat date'), stat('date'), dateShort(c.date));

    // fig 1
    tags(html, 'range').forEach(function (t) {
      const k = attr(t, 'data-kind');
      if (k === 'average') eq(tag('fig1 average'), attr(t, 'data-value'), c.avg);
      if (k === 'low') eq(tag('fig1 low'), attr(t, 'data-value'), c.low);
      if (k === 'high') eq(tag('fig1 high'), attr(t, 'data-value'), c.high);
      if (k === 'span') {
        eq(tag('fig1 span low'), attr(t, 'data-low'), c.low);
        eq(tag('fig1 span high'), attr(t, 'data-high'), c.high);
        compared++;
        if (!near(+attr(t, 'x'), 20 + (c.low / 100) * 380) || !near(+attr(t, 'width'), ((c.high - c.low) / 100) * 380)) bad(tag('fig1 bar geometry does not match low/high'));
      }
    });
    // fig 2
    const pTags = tags(html, 'pillar');
    eq(tag('fig2 pillars drawn'), pTags.length, c.pillars.length);
    pTags.forEach(function (t) {
      const p = c.pillars.find((q) => q.name === unesc(attr(t, 'data-name')));
      if (!p) { bad(tag('fig2 unknown pillar ' + attr(t, 'data-name'))); return; }
      eq(tag('fig2 ' + p.name), attr(t, 'data-value'), p.value);
      eq(tag('fig2 ' + p.name + ' max'), attr(t, 'data-max'), p.max);
      compared++; if (!near(+attr(t, 'width'), (p.value / p.max) * 340)) bad(tag('fig2 ' + p.name + ' bar width'));
    });
    // fig 3
    const cTags = tags(html, 'check');
    const want = c.checks.slice(0, TOP_CHECKS);
    eq(tag('fig3 checks drawn'), cTags.length, want.length);
    cTags.forEach(function (t, i) {
      eq(tag('fig3 row ' + (i + 1) + ' label'), unesc(attr(t, 'data-label')), want[i] && want[i].label);
      eq(tag('fig3 row ' + (i + 1) + ' value'), attr(t, 'data-value'), want[i] && want[i].pct);
      compared++; if (want[i] && !near(+attr(t, 'width'), (want[i].pct / 100) * 340)) bad(tag('fig3 row ' + (i + 1) + ' bar width'));
      if (/^AI crawler access/i.test(unesc(attr(t, 'data-label')))) bad(tag('fig3 includes an AI crawler access row'));
    });
    // fig 4
    const bTags = tags(html, 'crawler');
    eq(tag('fig4 segments drawn'), bTags.length, c.bots.length * 3);
    bTags.forEach(function (t) {
      const b = c.bots.find((q) => q.name === unesc(attr(t, 'data-bot')));
      if (!b) { bad(tag('fig4 unknown crawler')); return; }
      const st = attr(t, 'data-state');
      eq(tag('fig4 ' + b.name + ' ' + st), attr(t, 'data-value'), b[st === 'open' ? 'open' : st === 'limited' ? 'limited' : 'blocked']);
      compared++; if (!near(+attr(t, 'width'), (b[st] / c.scanned) * 200)) bad(tag('fig4 ' + b.name + ' ' + st + ' width'));
    });
    // findings: regenerate the sentences and compare with what is on the page
    const fs3 = findings(c, all.overall);
    fs3.forEach(function (s, i) {
      const m = new RegExp('data-finding="' + (i + 1) + '">([^<]*)<').exec(html);
      eq(tag('finding ' + (i + 1)), m ? unesc(m[1]) : null, s);
    });
    // JSON-LD
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    let j = null;
    try { j = JSON.parse(ld[1]); } catch (e) { bad(tag('JSON-LD does not parse')); }
    if (j) {
      eq(tag('ld type'), j['@type'], 'Dataset');
      eq(tag('ld temporalCoverage'), j.temporalCoverage, c.date);
      eq(tag('ld domains'), j.variableMeasured[0].value, c.scanned);
      eq(tag('ld average'), j.variableMeasured[1].value, c.avg);
    }
    if (html.indexOf('<link rel="canonical" href="' + SITE + '/benchmarks/' + c.slug + '"') === -1) bad(tag('canonical missing or wrong'));
    // rules: no overstated "limited", no site names, no client rendering, no numbered section labels
    if (/not fully open|notFullyOpen/i.test(text)) bad(tag('mentions "not fully open"'));
    domains.forEach(function (d) { if (text.toLowerCase().indexOf(d) !== -1) bad(tag('names a site: ' + d)); });
    if (/report-section__num/.test(html)) bad(tag('numbered section label'));
    if (/<script(?![^>]*(?:src=|type="application\/ld\+json"))/.test(html.replace(/<script>document\.getElementById\('citeRow'\)\.hidden = false;<\/script>/, ''))) bad(tag('unexpected inline script'));
  });

  // index
  const ifile = path.join(OUT, 'index.html');
  if (!fs.existsSync(ifile)) bad('index: page missing');
  else {
    const html = fs.readFileSync(ifile, 'utf8');
    const rows = html.match(/<li class="bm-row"[^>]*>/g) || [];
    const ranked = all.cats.slice().sort((a, b) => b.avg - a.avg || b.scanned - a.scanned);
    eq('index rows', rows.length, ranked.length);
    rows.forEach(function (r, i) {
      const c = ranked[i]; if (!c) return;
      eq('index row ' + (i + 1) + ' category', attr(r, 'data-category'), c.slug);
      eq('index ' + c.slug + ' average', attr(r, 'data-average'), c.avg);
      eq('index ' + c.slug + ' scanned', attr(r, 'data-scanned'), c.scanned);
      eq('index ' + c.slug + ' date', attr(r, 'data-date'), c.date);
    });
    const stat = (k) => { const m = new RegExp('data-stat="' + k + '">([^<]*)<').exec(html); return m ? unesc(m[1]) : null; };
    eq('index total', stat('scanned'), all.total);
    eq('index overall average', stat('average'), all.overall);
    eq('index categories', stat('categories'), all.cats.length);
  }
  return { problems: problems, compared: compared };
}

/* ---------------------------------------------------------------------
   Main
   --------------------------------------------------------------------- */

function main() {
  const all = loadAll();
  if (process.argv.indexOf('--check') !== -1) {
    const r = check(all);
    if (r.problems.length) {
      console.error('Benchmark pages do not match the data (' + r.problems.length + ' problems):');
      r.problems.forEach((p) => console.error('  - ' + p));
      process.exit(1);
    }
    console.log('OK: ' + r.compared + ' values on ' + (all.cats.length + 1) + ' pages match data/*-summary.json.');
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });
  all.cats.forEach(function (c) {
    fs.writeFileSync(path.join(OUT, c.slug + '.html'), categoryPage(c, all.overall), 'utf8');
    console.log('  benchmarks/' + c.slug + '.html  (' + c.avg + '/100, ' + c.scanned + ' sites)');
  });
  fs.writeFileSync(path.join(OUT, 'index.html'), indexPage(all), 'utf8');
  console.log('  benchmarks/index.html  (' + all.total + ' sites, average ' + all.overall + '/100)');
  const foot = ensureFooterLinks();
  if (foot.length) console.log('Footer link added to: ' + foot.join(', '));
  const sm = ensureSitemap(all);
  if (sm.length) console.log('Sitemap entries added: ' + sm.length);
}

main();
