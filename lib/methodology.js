/* =====================================================================
   lib/methodology.js

   What the get_methodology MCP tool says, read from the scanner's own check
   registry so it cannot drift from what runs. The registry is
   lib/scanner.js scoreAll(): called once with an empty site, it yields every
   check with its category, points, advice and reason. Weights are the sums of
   those points. Nothing here is typed twice.

   LIMITS is the one place the scan's limits are written for the tool. Every
   sentence in it must appear verbatim in methodology.html;
   scripts/check-mcp-drift.js asserts that.
   ===================================================================== */

'use strict';

const scanner = require('./scanner');

const PILLARS = [
  { cat: 'discover', name: 'Discoverability', note: 'Can AI crawlers reach the site at all. Access is the precondition for every other signal.' },
  { cat: 'tech', name: 'Technical foundation', note: 'Baseline machine-readability hygiene.' },
  { cat: 'trust', name: 'Content & trust', note: 'Whether the page tells a machine who the source is and whether its claims can be verified.' }
];

// What each check tests, in the scanner's own thresholds. The key set must equal the registry's labels:
// scripts/check-mcp-drift.js fails when a check is added or renamed without an entry here.
const TESTS = {
  'robots.txt present': 'Whether https://<domain>/robots.txt can be read. A real 404 counts as default-open access; a failed fetch stops the scan.',
  'llms.txt present': 'Whether https://<domain>/llms.txt exists and is a usable text file.',
  'Sitemap declared': 'Whether robots.txt has a Sitemap: line, or /sitemap.xml exists as a urlset or sitemapindex.',
  'AI crawler access': 'For each of the 10 tracked AI crawlers: open (no rule applies), limited (at least one Disallow rule applies, often an ordinary path) or blocked (the whole site is disallowed). Open earns full credit, limited half, blocked none, scaled to the 26 points.',
  'Canonical tag': 'Whether the homepage declares a rel=canonical link.',
  'html lang attribute': 'Whether the <html> element declares a language.',
  'Page title': 'Whether the <title> is 10 to 70 characters.',
  'Meta description': 'Whether the meta description is 50 to 170 characters.',
  'Open Graph tags': 'Whether the homepage has both og:title and og:description.',
  'Structured data (JSON-LD)': 'Whether the homepage carries any JSON-LD structured data.',
  'Single H1 heading': 'Whether the homepage has exactly one H1.',
  'Subheading structure (H2)': 'Whether the homepage has at least two H2 headings.',
  'Organization / WebSite schema': 'Whether JSON-LD declares an Organization, WebSite or LocalBusiness.',
  'Content schema (Article, FAQ…)': 'Whether JSON-LD declares an Article, FAQPage, HowTo, Product, BreadcrumbList or WebApplication.',
  'Author / about signals': 'Whether the page has an author meta tag or links to an about, team or company page.',
  'Contact signals': 'Whether the page links to a contact page or a mailto: address, or mentions contact in its text.'
};

// Each sentence appears verbatim in methodology.html.
const LIMITS = [
  'Answerable measures AI readiness: whether AI crawlers can access your content, and whether your on-page signals give a model a reason to trust and cite you.',
  'A perfect score does not guarantee an answer engine will cite you.',
  'A blocked crawler guarantees it cannot.',
  'The crawler-access check gives half credit for a bot that has any Disallow rule applying to it, including ordinary paths such as /admin/.',
  'The product page is the only page beyond the homepage that a scan reads.'
];

const stripBase = (label) => String(label).replace(/\s*\(\d+\s*\/\s*\d+\s+open\)\s*$/i, '').trim();

// The registry: scoreAll on an empty site gives every check once, in scan order.
function registry() {
  const empty = { canonical: false, lang: '', title: '', metaDesc: '', ogOk: false, schemaTypes: [], hasOrgSchema: false, hasContentSchema: false, h1Count: 0, h2Count: 0, authorSignal: false, contactSignal: false };
  const bots = scanner.BOTS.map((b) => ({ name: b.ua, state: 'blocked', rule: '' }));
  const scored = scanner.scoreAll(false, false, false, bots, empty);
  return scored.checks.map((c) => ({
    label: stripBase(c.label),
    cat: c.cat,
    max: c.max,
    advice: c.advice,
    why: c.why,
    tests: TESTS[stripBase(c.label)] || null
  }));
}

function pillarTotals(reg) {
  return PILLARS.map((p) => ({ cat: p.cat, name: p.name, note: p.note, points: reg.filter((c) => c.cat === p.cat).reduce((n, c) => n + c.max, 0) }));
}

function labels() { return registry().map((c) => c.label); }

function findCheck(query) {
  const q = stripBase(query || '').toLowerCase();
  if (!q) return null;
  return registry().filter((c) => c.label.toLowerCase() === q)[0] || null;
}

function overview() {
  const reg = registry();
  const pillars = pillarTotals(reg);
  const total = pillars.reduce((n, p) => n + p.points, 0);
  const lines = ['How the Answerable AI readiness score is built: ' + total + ' points across ' + pillars.length + ' pillars and ' + reg.length + ' checks. Every point value below is read from the scanner that runs.', ''];
  pillars.forEach((p) => {
    lines.push(p.name + ': ' + p.points + ' points. ' + p.note);
    reg.filter((c) => c.cat === p.cat).forEach((c) => {
      lines.push('  - ' + c.label + ' (' + c.max + ' pts): ' + (c.tests || c.advice) + ' Why it matters: ' + c.why);
    });
    lines.push('');
  });
  lines.push('Limits:');
  LIMITS.forEach((l) => lines.push('  - ' + l));
  lines.push('');
  lines.push('A store also gets a separate commerce sub-score, never added to the ' + total + '. Call get_methodology with a check label for one check in detail: ' + reg.map((c) => c.label).join('; ') + '.');
  return lines.join('\n');
}

function detail(check) {
  const reg = registry();
  const pillar = PILLARS.filter((p) => p.cat === check.cat)[0];
  const total = reg.filter((c) => c.cat === check.cat).reduce((n, c) => n + c.max, 0);
  return [
    check.label + ' (' + check.max + ' points, ' + pillar.name + ', which is ' + total + ' points in all)',
    '',
    'What it tests: ' + (check.tests || check.advice),
    'Why it matters: ' + check.why,
    'If it fails: ' + check.advice + '.',
    '',
    'Limits that apply to every check:',
    LIMITS.map((l) => '  - ' + l).join('\n')
  ].join('\n');
}

module.exports = { PILLARS, TESTS, LIMITS, registry, labels, findCheck, overview, detail, stripBase };
