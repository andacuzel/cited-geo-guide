/* =====================================================================
   lib/ws-fix.js: the logic of a Fix workspace, apart from storage and pages.

   Nothing here is new scanning or generating code. A scan is lib/scanner.js scanPage (through lib/safe-fetch.js, like every fetch of a domain); the
   Fix list comes from the failed checks and their metadata in lib/methodology.js; the Files come from lib/schema.js and lib/file-generators.js, the
   builders the MCP tools use. This file only connects them and keeps the rules:

     - a Fix item is one failed check; its key is the check's base label ("AI crawler access", not "AI crawler access (3/10 open)")
     - statuses: todo, in_progress, applied, verified. Only a re-run of the check can make an item verified (verify()); nobody can type it in
     - a rescan adds new failing checks as todo items and sends a verified item back to todo if its check fails again
     - the score of a scan is the scanner's own total; nothing is estimated
   ===================================================================== */

'use strict';

const methodology = require('./methodology.js');
const schemaLib = require('./schema.js');
const CRAWLERS = require('./crawlers.js');
const gen = require('./file-generators.js');

const STATUSES = ['todo', 'in_progress', 'applied', 'verified'];
const STATUS_LABEL = { todo: 'To do', in_progress: 'In progress', applied: 'Applied', verified: 'Verified' };
const PILLAR = { discover: 'Discoverability', tech: 'Technical foundation', trust: 'Content & trust' };
const FILE_OF = {
  'robots.txt present': 'robots', 'AI crawler access': 'robots', 'Sitemap declared': 'robots',
  'llms.txt present': 'llms',
  'Structured data (JSON-LD)': 'schema', 'Organization / WebSite schema': 'schema', 'Content schema (Article, FAQ…)': 'schema'
};

const keyOf = (label) => methodology.stripBase(String(label));

// The scanner's answer, kept small: what a workspace stores of a scan.
function summarize(scan, at) {
  const r = scan.result;
  return {
    at: at, total: r.total, discover: r.discover, tech: r.tech, trust: r.trust,
    checks: r.checks.map((c) => ({ key: keyOf(c.label), label: c.label, cat: c.cat, ok: !!c.ok, pts: c.pts, max: c.max })),
    siteInfo: scan.siteInfo ? { title: String(scan.siteInfo.title || '').slice(0, 200), metaDesc: String(scan.siteInfo.metaDesc || '').slice(0, 400), lang: String(scan.siteInfo.lang || '').slice(0, 20) } : null,
    sitemapUrl: (scan.sitemapUrls && scan.sitemapUrls[0]) || ''
  };
}

function itemOf(check) {
  const meta = methodology.findCheck(check.key) || methodology.findCheck(check.label) || {};
  return {
    key: check.key, label: check.key, cat: check.cat, max: check.max,
    advice: meta.advice || '', why: meta.why || '', file: FILE_OF[check.key] || '',
    status: 'todo', note: '', updatedAt: null, verifiedAt: null
  };
}

// The Fix list after a scan: new failing checks come in as todo, a verified item whose check fails again goes back to todo. Custom items (key starting "x-") are left alone.
function mergeItems(items, summary, now) {
  const out = items.map((i) => Object.assign({}, i));
  const byKey = {}; out.forEach((i) => { byKey[i.key] = i; });
  summary.checks.forEach((c) => {
    const have = byKey[c.key];
    if (c.ok) return;
    if (!have) { const n = itemOf(c); n.updatedAt = now; out.push(n); byKey[c.key] = n; return; }
    if (have.status === 'verified') { have.status = 'todo'; have.verifiedAt = null; have.updatedAt = now; have.regressed = true; }
  });
  return out;
}

// What a check says in the latest scan: true, false, or null when the item has no check (a custom item).
function passes(item, last) {
  if (!last) return null;
  const c = last.checks.filter((x) => x.key === item.key)[0];
  return c ? c.ok : null;
}

function overview(scans, last, items) {
  const first = scans[0] || null;
  const latest = scans[scans.length - 1] || null;
  const counts = { todo: 0, in_progress: 0, applied: 0, verified: 0 };
  items.forEach((i) => { if (counts[i.status] !== undefined) counts[i.status]++; });
  return {
    before: first ? { score: first.score, at: first.at } : null,
    now: latest ? { score: latest.score, at: latest.at } : null,
    delta: first && latest ? latest.score - first.score : null,
    checksTotal: last ? last.checks.length : 0,
    checksPassing: last ? last.checks.filter((c) => c.ok).length : 0,
    counts: counts, scans: scans.length
  };
}

// The three files, from the generators the MCP tools use. Brackets mark what only the owner of the site can fill in.
function files(meta, last) {
  const domain = meta.domain;
  const info = meta.siteInfo || (last && last.siteInfo) || {};
  const jsonld = schemaLib.toScriptTag(schemaLib.buildFromSite('organization', domain, info));
  const names = CRAWLERS.map((c) => c.ua);
  const sitemapUrl = meta.sitemapUrl || (last && last.sitemapUrl) || ('https://' + domain + '/sitemap.xml');
  const robots = gen.robotsTxt(CRAWLERS, names, [], sitemapUrl);
  const name = String(info.title || '').trim().slice(0, 60) || domain;
  const llms = gen.llmsTxt(name, String(info.metaDesc || '').trim() || '[One sentence on what the site is]', [{ url: 'https://' + domain + '/', description: 'Homepage' }]);
  return [
    { id: 'schema', name: 'Organization and WebSite schema', where: 'Paste inside the <head> of your homepage.', text: jsonld },
    { id: 'robots', name: 'robots.txt', where: 'Save at https://' + domain + '/robots.txt. It allows all ' + names.length + ' tracked AI crawlers; change any line to a block if you decide otherwise.', text: robots },
    { id: 'llms', name: 'llms.txt', where: 'Save at https://' + domain + '/llms.txt. Optional and low-cost; it has no demonstrated effect on Google. Add your key pages under "Pages".', text: llms }
  ];
}

// The sentence a person reads when a Verify says the check still fails.
function stillFailing(item) { return 'The check still fails. ' + (item.advice ? item.advice + '.' : ''); }

module.exports = {
  STATUSES: STATUSES, STATUS_LABEL: STATUS_LABEL, PILLAR: PILLAR, keyOf: keyOf, summarize: summarize, itemOf: itemOf, mergeItems: mergeItems,
  passes: passes, overview: overview, files: files, stillFailing: stillFailing
};
