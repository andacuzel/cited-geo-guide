/* =====================================================================
   lib/api-v1/data.js: the data side of /v1: strict input checks, the scan summary, the benchmark files, the generators.

   Nothing here scores anything or fetches anything on its own. Scanning is lib/scanner.js (scanPage, fetchSiteInfo: both go through lib/safe-fetch.js), the summary of a
   scan is lib/action-scan.js summarize(), the text builders are lib/file-generators.js and lib/schema.js, the crawler list is lib/crawlers.js. The benchmark files are the
   ones the MCP server reads (data/benchmarks.json and data/<category>-summary.json).
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const scanner = require('../scanner.js');
const ActionScan = require('../action-scan.js');
const schemaLib = require('../schema.js');
const fileGenerators = require('../file-generators.js');
const CRAWLERS = require('../crawlers.js');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const NOTE = 'A readiness score: crawler access and on-page signals. It does not measure whether any assistant names a brand.';
const METHOD = 'https://getcitehound.com/methodology';

/* ---------- input ---------- */

// A bare hostname only: no scheme, path, port, credentials, query or spaces; labels of letters, digits and hyphens; an alphabetic top-level name; not a reserved or internal name.
// (The fetch guard re-checks every address a name resolves to; this is the first, cheap refusal.)
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const DOMAIN_RE = new RegExp('^' + LABEL + '(?:\\.' + LABEL + ')*\\.[a-z]{2,63}$');
const RESERVED_TLD = /\.(localhost|local|internal|lan|home|corp|test|invalid|onion|arpa|example)$/;
function validDomain(raw) {
  if (typeof raw !== 'string') return null;
  const d = raw.trim().toLowerCase().replace(/^www\./, '');
  if (!d || d.length > 253 || !DOMAIN_RE.test(d) || RESERVED_TLD.test(d) || d.indexOf('..') !== -1) return null;
  return d;
}

/* ---------- scan summary ---------- */

function benchmarkFiles() {
  const entries = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'benchmarks.json'), 'utf8'));
  return entries.map((e) => { let s = null; try { s = JSON.parse(fs.readFileSync(path.join(DATA_DIR, e.category + '-summary.json'), 'utf8')); } catch (x) { /* a category without data is left out */ } return { entry: e, summary: s }; })
    .filter((x) => x.summary && x.summary.score && x.summary.scanned);
}
function overall() {
  try {
    const rows = benchmarkFiles();
    const total = rows.reduce((n, r) => n + r.summary.scanned, 0);
    if (!total) return null;
    return { totalSites: total, totalCategories: rows.length, overallAverage: Math.round(rows.reduce((n, r) => n + r.summary.score.average * r.summary.scanned, 0) / total) };
  } catch (e) { return null; }
}
function comparison(score, o) {
  if (!o) return null;
  const delta = score - o.overallAverage;
  return { overallAverage: o.overallAverage, sitesScanned: o.totalSites, categories: o.totalCategories, delta: delta, position: Math.abs(delta) < 2 ? 'about the average' : (delta > 0 ? 'above the average' : 'below the average') };
}

// The full answer for one scanned domain: the Action's summary plus the ten crawler states and the benchmark comparison.
function scanSummary(domain, scan, now) {
  const base = ActionScan.summarize(domain, scan, now);
  const vendors = {}; CRAWLERS.forEach((c) => { vendors[c.ua] = c.vendor; });
  return {
    domain: domain, scannedAt: base.scannedAt, score: base.score, pillars: base.pillars, failed: base.failed,
    crawlers: (scan.botResults || []).map((b) => ({ name: b.name, vendor: vendors[b.name] || null, state: b.state === 'partial' ? 'limited' : b.state, rule: b.rule || null })),
    crawlerSummary: { open: base.crawlers.open, limited: base.crawlers.limited, blocked: base.crawlers.blocked },
    benchmark: comparison(base.score, overall()), note: NOTE, method: METHOD
  };
}

// Where two scans differ: every check whose pass or fail, or points, differ.
function differences(scanA, scanB) {
  const out = [];
  scanA.result.checks.forEach((ca) => {
    const cb = scanB.result.checks.filter((c) => c.label === ca.label)[0];
    if (cb && (cb.ok !== ca.ok || cb.pts !== ca.pts)) out.push({ check: ca.label, a: { passed: ca.ok, points: ca.pts }, b: { passed: cb.ok, points: cb.pts }, max: ca.max });
  });
  return out;
}

/* ---------- benchmark ---------- */

function categories() {
  return benchmarkFiles().map((r) => ({ category: r.entry.category, label: r.entry.label, track: r.entry.track, sitesScanned: r.summary.scanned, average: r.summary.score.average, scannedAt: r.summary.scannedAt }));
}
function categoryDetail(name) {
  const rows = benchmarkFiles(), row = rows.filter((r) => r.entry.category === name)[0];
  if (!row) return null;
  const s = row.summary;
  return { category: row.entry.category, label: row.entry.label, track: row.entry.track, sitesScanned: s.scanned, couldNotBeReached: s.failed || 0, scannedAt: s.scannedAt,
    score: s.score, crawlers: s.crawlers || null, checkFailureRates: s.checkFailureRates || null, note: 'Our own archived scans of well-known sites. ' + NOTE, method: METHOD };
}

/* ---------- generators ---------- */

const CRAWLER_NAMES = CRAWLERS.map((c) => c.ua);
const list = (v) => (Array.isArray(v) ? v : (typeof v === 'string' && v.trim() ? v.split(',') : [])).map((x) => String(x).trim()).filter(Boolean);
const httpsUrl = (u) => { try { const x = new URL(String(u).trim()); return x.protocol === 'https:' || x.protocol === 'http:' ? x.toString() : null; } catch (e) { return null; } };

// input: { allow, block, sitemap } -> { ok: true, content, allow, block } or { ok: false, message }
function robots(input) {
  const allow = list(input.allow), block = list(input.block), sitemap = input.sitemap === undefined || input.sitemap === null || input.sitemap === '' ? '' : httpsUrl(input.sitemap);
  if (sitemap === null) return { ok: false, message: '"sitemap" must be an absolute http or https URL.' };
  if (allow.length > 20 || block.length > 20) return { ok: false, message: 'At most 20 names in "allow" or "block".' };
  const unknown = allow.concat(block).filter((n) => CRAWLER_NAMES.indexOf(n) === -1);
  if (unknown.length) return { ok: false, message: 'Unknown crawler name(s): ' + unknown.join(', ') + '. Tracked crawlers: ' + CRAWLER_NAMES.join(', ') + '.' };
  const both = allow.filter((n) => block.indexOf(n) !== -1);
  if (both.length) return { ok: false, message: 'In both "allow" and "block": ' + both.join(', ') + '.' };
  if (!allow.length && !block.length && !sitemap) return { ok: false, message: 'Give at least one name in "allow" or "block", or a "sitemap".' };
  return { ok: true, allow: allow, block: block, sitemap: sitemap || null, content: fileGenerators.robotsTxt(CRAWLERS, allow, block, sitemap) };
}

// input: { name, description, pages: [{ url, description }] }. In a query string, "page" is repeated as "<url>|<description>".
function llms(input) {
  const name = typeof input.name === 'string' ? input.name.trim() : '', description = typeof input.description === 'string' ? input.description.trim() : '';
  if (!name || name.length > 120) return { ok: false, message: '"name" is required (up to 120 characters).' };
  if (!description || description.length > 300) return { ok: false, message: '"description" is required (up to 300 characters).' };
  let pages = input.pages;
  if (pages === undefined && input.page !== undefined) pages = list2(input.page).map((s) => { const i = s.indexOf('|'); return { url: i === -1 ? s : s.slice(0, i), description: i === -1 ? '' : s.slice(i + 1) }; });
  pages = Array.isArray(pages) ? pages : [];
  if (pages.length > 20) return { ok: false, message: 'At most 20 pages.' };
  const clean = [];
  for (let i = 0; i < pages.length; i++) {
    const u = pages[i] && httpsUrl(pages[i].url), d = pages[i] && typeof pages[i].description === 'string' ? pages[i].description.trim() : '';
    if (!u || !d || d.length > 200) return { ok: false, message: 'Page ' + (i + 1) + ' needs an absolute "url" and a "description" of up to 200 characters.' };
    clean.push({ url: u, description: d });
  }
  return { ok: true, pages: clean, content: fileGenerators.llmsTxt(name, description, clean) };
}
const list2 = (v) => (Array.isArray(v) ? v : [v]).map((x) => String(x)).slice(0, 21);

// -> { ok, jsonLd } using the same fetch of the homepage as the MCP tool (lib/scanner.js fetchSiteInfo)
async function schema(domain, type, deps) {
  if (Object.keys(schemaLib.TYPES).indexOf(type) === -1) return { ok: false, status: 400, message: '"type" must be one of: ' + Object.keys(schemaLib.TYPES).join(', ') + '.' };
  const info = await ((deps && deps.fetchSiteInfo) || scanner.fetchSiteInfo)(domain);
  if (!info.ok) return { ok: false, status: 502, message: 'Could not read the homepage at https://' + domain + '/ (' + (info.detail || 'unreachable') + ').' };
  return { ok: true, jsonLd: schemaLib.buildFromSite(type, domain, info.siteInfo), type: type };
}

module.exports = { validDomain, scanSummary, differences, overall, comparison, categories, categoryDetail, robots, llms, schema, CRAWLER_NAMES, SCHEMA_TYPES: Object.keys(schemaLib.TYPES), NOTE, METHOD };
