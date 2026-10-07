/* =====================================================================
   lib/mcp-content.js

   The content behind three MCP tools in api/mcp.js, read from this project's
   own files so nothing is copied and nothing can drift:
     get_sample_report   content/pro/sample-report.json, a crawl of our own site
     get_research        content/research-index.json (scripts/generate-research-index.js)
     get_playbook        with no argument, the list of verticals

   Files are loaded with static require() calls (so a deploy bundles them),
   each guarded: a missing or unreadable file becomes a specific message from
   the tool, never a crash of the server. _setSources lets the local harness
   replace a source with null to test that message.
   ===================================================================== */

'use strict';

const site = require('./site-config');
const factsLib = require('./report-facts');
const schemaLib = require('./schema');
const playbooks = require('./playbooks');

function safe(fn) { try { return fn(); } catch (e) { return null; } }

let sources = {
  sample: () => safe(() => require('../content/pro/sample-report.json')),
  research: () => safe(() => require('../content/research-index.json'))
};
function _setSources(over) { sources = Object.assign({}, sources, over); }

const longDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const signed = (n) => (n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '0');

/* ---------------- get_sample_report ---------------- */

function sampleReport() {
  const data = sources.sample();
  if (!data || !Array.isArray(data.pages) || !data.pages.length) {
    return { isError: true, text: 'The sample report is not available right now (its data file could not be read). It is also published at ' + site.baseUrl + '/sample-report.' };
  }
  let f;
  try { f = factsLib.facts(data, { schema: schemaLib }); } catch (e) {
    return { isError: true, text: 'The sample report data could not be read (' + (e && e.message ? e.message : 'unknown error') + '). It is also published at ' + site.baseUrl + '/sample-report.' };
  }
  const v = f.verdict, cov = f.coverage;
  const date = longDate(data.createdAt);
  const L = [];
  L.push('Sample report: a crawl of our own site, ' + data.domain + ', run on ' + date + '. It is not a customer’s report, and nothing in it was edited or improved.');
  L.push(cov.pagesRead + ' pages read' + (cov.pagesFailed ? ', ' + cov.pagesFailed + ' not fetched' : '') + ', from a crawl that reads up to ' + cov.cap + '.');
  L.push('');
  L.push('Whole-site score ' + v.siteWide + ' beside homepage score ' + v.homepage + ' (gap ' + signed(v.gap) + ' points). ' + v.pagesWithAFailure + ' of ' + cov.pagesRead + ' pages fail at least one page-level check.');
  if (v.benchmark) L.push('Benchmark: the average homepage score across ' + v.benchmark.sites + ' sites in ' + v.benchmark.categories + ' categories is ' + v.benchmark.average + '. The homepage score here is ' + Math.abs(v.homepageVsBenchmark) + ' points ' + (v.homepageVsBenchmark >= 0 ? 'above' : 'below') + ' it.');
  L.push('');
  L.push('Pillars, site average: Discoverability ' + f.pillars.discover.average + '/' + f.pillars.discover.max + ', Technical foundation ' + f.pillars.tech.average + '/' + f.pillars.tech.max + ', Content & trust ' + f.pillars.trust.average + '/' + f.pillars.trust.max + '.');
  const s = data.executiveSummary;
  if (s && Array.isArray(s.priorities)) {
    L.push('');
    L.push('Where to start' + (s.label ? ' (' + s.label + ')' : '') + ':');
    s.priorities.forEach((p, i) => L.push('  ' + (i + 1) + '. ' + p.title + ': ' + p.where + ', adds ' + p.gain_pts + ' points to the site-wide score, ' + p.effort + '.'));
    if (s.working) L.push('Already working: ' + s.working);
  }
  const failing = f.checks.filter((c) => !c.siteLevel && c.failingPages > 0).sort((a, b) => b.failingPages - a.failingPages);
  L.push('');
  L.push('Checks failing, by number of pages:');
  if (!failing.length) L.push('  none');
  failing.forEach((c) => L.push('  - ' + c.label + ': ' + c.failingPages + ' of ' + cov.pagesRead + ' pages'));
  const site2 = f.checks.filter((c) => c.siteLevel && c.failingPages > 0);
  if (site2.length) {
    L.push('Site-level checks that lose points (they read the same on every page): ' + site2.map((c) => c.label.replace(/\s*\(\d+\/\d+ open\)/, '')).join(', ') + '. Ordinary Disallow rules such as an admin path earn half credit on the crawler-access check.');
  }
  L.push('');
  L.push('This measures readiness, not whether any assistant names the site. Full report: ' + site.baseUrl + '/sample-report');
  return { isError: false, text: L.join('\n') };
}

/* ---------------- get_research ---------------- */

function researchIndex() { const j = sources.research(); return j && Array.isArray(j.entries) ? j : null; }

function research(slug) {
  const idx = researchIndex();
  if (!idx) return { isError: true, text: 'The research index is not available right now. Reports are listed at ' + site.baseUrl + '/research.' };
  const q = typeof slug === 'string' ? slug.trim() : '';
  if (!q) {
    const L = ['Citehound research: ' + idx.entries.length + ' published items. Call get_research with a slug for the key findings, the method limits and a ready citation.', ''];
    idx.entries.forEach((e) => L.push(e.slug + ' (' + e.kind + ', ' + e.dateLabel + '): ' + e.title + (/[?.!]$/.test(e.title) ? ' ' : '. ') + e.summary + ' ' + e.url));
    return { isError: false, text: L.join('\n') };
  }
  const e = idx.entries.filter((x) => x.slug === q)[0];
  if (!e) return { isError: true, text: 'Unknown research slug "' + q + '". Valid slugs: ' + idx.entries.map((x) => x.slug).join(', ') + '.' };
  const L = [e.title + ' (' + e.kind + ', ' + e.dateLabel + ')', e.url, '', e.summary, '', 'Key findings:'];
  e.findings.forEach((x, i) => L.push('  ' + (i + 1) + '. ' + x));
  L.push('', 'Method and limits:');
  e.limits.forEach((x) => L.push('  - ' + x));
  L.push('', 'How to cite: ' + e.cite);
  return { isError: false, text: L.join('\n') };
}

/* ---------------- get_playbook without an argument ---------------- */

function playbookList() {
  const L = ['Citehound has ' + (Object.keys(playbooks.saasData).length + Object.keys(playbooks.brandData).length + Object.keys(playbooks.professionalData).length) + ' vertical playbooks. Call get_playbook with a slug for the full text.', ''];
  [['B2B SaaS', playbooks.saasData], ['Consumer & e-commerce brands', playbooks.brandData], ['Local & independent professionals', playbooks.professionalData]].forEach((t) => {
    L.push(t[0] + ':');
    Object.keys(t[1]).forEach((k) => L.push('  ' + k + ' (' + t[1][k].name + ')'));
    L.push('');
  });
  return { isError: false, text: L.join('\n').replace(/\n+$/, '') };
}

module.exports = { sampleReport, research, playbookList, researchIndex, _setSources };
