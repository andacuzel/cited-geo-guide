#!/usr/bin/env node
/* =====================================================================
   scripts/generate-trust.js

   Writes trust.html (served at /trust) and .well-known/security.txt.

   The page is rows of icon, headline, one sentence and a link, each pointing at
   the evidence: who runs the site, what the scan measures and what it does not,
   our own results, what we store, where the data comes from, the MCP server,
   the changelog and how to report a security issue. No logos, badges,
   compliance or certification claims. Figures in the sentences are derived
   (data-fig) and --check recomputes them from the raw files.

   security.txt follows RFC 9116: Contact, Expires, Preferred-Languages,
   Canonical. Expires is written once, one year after the day the file is first
   generated, and kept until --renew. --check fails when it is within 30 days or
   past. The host serves .txt files as text/plain.

     node scripts/generate-trust.js            write the page, security.txt and the sitemap entry
     node scripts/generate-trust.js --renew    also move Expires to one year from today
     node scripts/generate-trust.js --check    exit 1 on any mismatch
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const shell = require('../lib/page-shell.js');
const site = require('../lib/site-config.js');
const icons = require('../lib/icons.js');
const methodology = require('../lib/methodology.js');
const factsLib = require('../lib/report-facts.js');
const schemaLib = require('../lib/schema.js');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'trust.html');
const SEC = path.join(ROOT, '.well-known', 'security.txt');
const CSS_VERSION = 66;
const esc = shell.esc;
const fig = (k, v) => '<span data-fig="tr-' + k + '">' + esc(v) + '</span>';
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

function figures() {
  const sample = read('content/pro/sample-report.json');
  const beforeFile = path.join(ROOT, 'content', 'pro', 'sample-before.json');
  const bm = sample.benchmark || factsLib.benchmarkFromData(path.join(ROOT, 'data'));
  const after = factsLib.facts(Object.assign({}, sample, { benchmark: bm }), { schema: schemaLib }).verdict.siteWide;
  const before = fs.existsSync(beforeFile) ? factsLib.facts(Object.assign({}, read('content/pro/sample-before.json'), { benchmark: bm }), { schema: schemaLib }).verdict.siteWide : null;
  const cats = read('data/benchmarks.json').map((c) => read('data/' + c.category + '-summary.json'));
  const mcp = require('../api/mcp.js');
  return {
    after: after, before: before,
    pages: sample.pages.filter((p) => p.status === 'ok').length,
    sites: cats.reduce((n, s) => n + s.scanned, 0), categories: cats.length,
    tools: mcp.TOOLS.length, prompts: mcp.PROMPTS.length,
    changes: read('content/changelog.json').entries.length
  };
}

function rows(F) {
  const ic = (n) => icons.svg(n, { cls: 'tr-icon__svg' });
  const R = [
    ['people', 'Who runs it.', 'Citehound is built and run by Andaç Üzel. The About page has the background.', '/about', 'About'],
    ['search', 'What the scan measures, and what it does not.', methodology.LIMITS[0] + ' ' + methodology.LIMITS[1], '/methodology', 'Read the methodology'],
    ['report', 'Our own results.', 'A crawl of our own site, ' + fig('pages', F.pages) + ' pages, nothing edited' + (F.before !== null ? ', and the crawl before we fixed what it found: the whole-site score went from ' + fig('before', F.before) + ' to ' + fig('after', F.after) + '.' : ': the whole-site score is ' + fig('after', F.after) + '.'), '/sample-report', 'See the sample report'],
    ['eyeoff', 'What we store.', 'No accounts, no email list and no scan history. The privacy page lists the few things we do keep and for how long.', '/privacy', 'Read the privacy policy'],
    ['layers', 'Where the data comes from.', 'Benchmarks are our own scans of ' + fig('sites', F.sites) + ' homepages in ' + fig('categories', F.categories) + ' categories, on stated dates. Each research report publishes its method and its limits.', '/benchmarks', 'See the benchmarks'],
    ['plug', 'The MCP server.', fig('tools', F.tools) + ' read-only tools and ' + fig('prompts', F.prompts) + ' prompts, no key and no account. The documentation says what the server keeps and what it limits.', '/mcp', 'Read the MCP documentation'],
    ['clock', 'What changed, and when.', fig('changes', F.changes) + ' changes a visitor or an MCP user can see, newest first, with the commits behind each.', '/changelog', 'Read the changelog'],
    ['cybersecurity', 'Report a security issue.', 'Email <a href="mailto:' + esc(site.contactEmail) + '">' + esc(site.contactEmail) + '</a>. The security.txt file lists the contact, the languages we read and when the file expires.', '/.well-known/security.txt', 'Open security.txt']
  ];
  return R.map((r) => '        <li class="tr-row">\n          <span class="tr-icon">' + ic(r[0]) + '</span>\n          <div>\n            <h2 class="tr-title">' + esc(r[1]) + '</h2>\n            <p class="tr-text">' + r[2] + '</p>\n            <p class="tr-link"><a href="' + r[3] + '">' + esc(r[4]) + '</a></p>\n          </div>\n        </li>').join('\n');
}

function build(F) {
  const desc = 'Who runs Citehound, what the scan measures and what it does not, our own results, what we store, where the data comes from, and how to report a security issue.';
  const body = shell.banner({ kicker: 'Trust', title: 'What you can check.', desc: 'Who runs Citehound, what the scan measures, what we store and how to report a problem. Each row links to the evidence.', icon: icons.svg('cybersecurity', {}) }) +
    '\n    <section class="verticals" aria-labelledby="trust-heading">\n      <div class="section__inner">\n        <h2 id="trust-heading" class="tr-heading">The evidence, in eight places.</h2>\n        <ul class="tr-rows">\n' + rows(F) + '\n        </ul>\n      </div>\n    </section>\n';
  return shell.page({
    title: 'Citehound — Trust: What You Can Check',
    description: desc,
    path: '/trust',
    cssVersion: CSS_VERSION,
    jsonld: [{ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Citehound trust', description: desc, url: site.baseUrl + '/trust' }],
    body: body
  });
}

function securityTxt(expires) {
  return ['Contact: mailto:' + site.contactEmail, 'Expires: ' + expires, 'Preferred-Languages: en, tr', 'Canonical: ' + site.baseUrl + '/.well-known/security.txt', ''].join('\n');
}
function oneYearFromToday() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate())).toISOString().replace(/\.\d+Z$/, '.000Z');
}
function currentExpires() {
  try { const m = /^Expires: (.+)$/m.exec(fs.readFileSync(SEC, 'utf8')); return m ? m[1].trim() : null; } catch (e) { return null; }
}

function ensureSitemap() {
  const file = path.join(ROOT, 'sitemap.xml');
  const xml = fs.readFileSync(file, 'utf8');
  const loc = site.baseUrl + '/trust';
  if (xml.indexOf('<loc>' + loc + '</loc>') !== -1) return false;
  fs.writeFileSync(file, xml.replace('</urlset>', '  <url>\n    <loc>' + loc + '</loc>\n  </url>\n</urlset>'), 'utf8');
  return true;
}

// Separate recomputation of the figures shown, from the raw files.
function independent() {
  const total = (p) => p.result.checks.reduce((n, c) => n + c.pts, 0);
  const score = (d) => { const ok = d.pages.filter((p) => p.status === 'ok' && p.result); return Math.round(ok.reduce((n, p) => n + total(p), 0) / ok.length); };
  const sample = read('content/pro/sample-report.json');
  const beforeFile = path.join(ROOT, 'content', 'pro', 'sample-before.json');
  const mcpSrc = fs.readFileSync(path.join(ROOT, 'api', 'mcp.js'), 'utf8');
  const cats = fs.readdirSync(path.join(ROOT, 'data')).filter((f) => /-summary\.json$/.test(f)).map((f) => read('data/' + f));
  return {
    after: score(sample), before: fs.existsSync(beforeFile) ? score(read('content/pro/sample-before.json')) : null,
    pages: sample.pages.filter((p) => p.status === 'ok' && p.result).length,
    sites: cats.reduce((n, s) => n + s.scanned, 0), categories: cats.length,
    tools: (mcpSrc.match(/^    name: '[a-z_]+',\n    title:/gm) || []).length,
    prompts: (fs.readFileSync(path.join(ROOT, 'lib', 'mcp-prompts.js'), 'utf8').match(/^    name: '[a-z_]+',\n    title:/gm) || []).length,
    changes: read('content/changelog.json').entries.length
  };
}

function check() {
  const errors = [];
  const bad = (m) => errors.push(m);
  const F = figures();
  const page = fs.existsSync(PAGE) ? fs.readFileSync(PAGE, 'utf8') : '';
  if (page !== build(F)) bad('trust.html is out of date; run node scripts/generate-trust.js');
  const want = independent();
  const re = /data-fig="tr-([a-z]+)">([^<]*)</g;
  let m, seen = 0;
  while ((m = re.exec(page))) { seen++; if (!(m[1] in want)) bad('figure ' + m[1] + ' has no recomputation'); else if (String(want[m[1]]) !== m[2]) bad(m[1] + ' reads ' + m[2] + ', the source gives ' + want[m[1]]); }
  if (!seen) bad('trust.html shows no figures');
  if ((page.match(/<h1[ >]/g) || []).length !== 1) bad('trust.html needs exactly one h1');
  const text = page.replace(/<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');
  if (/\b(certified|certification|compliant|compliance|SOC ?2|ISO ?27001|GDPR[- ]compliant|HIPAA|guarantee[sd]? security|badge)\b/i.test(text.replace(/does not guarantee an answer engine will cite you/, ''))) bad('trust.html makes a compliance or certification claim');
  if (/\b(recommended|quietly|actually|seamlessly|effortless|powerful|unlock|elevate|supercharge|game-changing|revolutionize|landscape|delve|crucial|robust|coming soon)\b/i.test(text)) bad('trust.html has a banned word');
  if (!/<ul class="tr-rows">(\s*<li class="tr-row">[\s\S]*?<\/li>){8}\s*<\/ul>/.test(page)) bad('trust.html should have eight rows');
  // security.txt, RFC 9116
  if (!fs.existsSync(SEC)) bad('.well-known/security.txt is missing');
  else {
    const t = fs.readFileSync(SEC, 'utf8');
    if (!/^Contact: mailto:\S+@\S+$/m.test(t)) bad('security.txt: Contact must be a mailto: address');
    const exp = /^Expires: (.+)$/m.exec(t);
    if (!exp || isNaN(Date.parse(exp[1]))) bad('security.txt: Expires missing or not a date');
    else if (Date.parse(exp[1]) - Date.now() < 30 * 86400000) bad('security.txt expires within 30 days or has expired; run node scripts/generate-trust.js --renew');
    else if (Date.parse(exp[1]) - Date.now() > 366 * 86400000) bad('security.txt: Expires is more than a year away (RFC 9116 recommends under a year)');
    if (!/^Preferred-Languages: en, tr$/m.test(t)) bad('security.txt: Preferred-Languages must be "en, tr"');
    if (!t.includes('Canonical: ' + site.baseUrl + '/.well-known/security.txt')) bad('security.txt: Canonical does not match the site URL');
    if (!t.includes('Contact: mailto:' + site.contactEmail)) bad('security.txt: Contact does not match site.config contactEmail');
    if (t.indexOf('\r') !== -1) bad('security.txt has carriage returns');
  }
  if (fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').indexOf('<loc>' + site.baseUrl + '/trust</loc>') === -1) bad('sitemap.xml has no /trust');
  return errors;
}

function main() {
  if (process.argv.indexOf('--check') !== -1) {
    const errors = check();
    if (errors.length) { errors.forEach((e) => console.error('FAIL: ' + e)); process.exit(1); }
    console.log('OK: trust.html is current, every figure recomputed from the raw files, eight rows, no compliance claims; security.txt is valid RFC 9116');
    return;
  }
  fs.writeFileSync(PAGE, build(figures()), 'utf8');
  const expires = process.argv.indexOf('--renew') !== -1 || !currentExpires() ? oneYearFromToday() : currentExpires();
  fs.mkdirSync(path.dirname(SEC), { recursive: true });
  fs.writeFileSync(SEC, securityTxt(expires), 'utf8');
  console.log('trust.html and .well-known/security.txt (Expires ' + expires + ') written; ' + (ensureSitemap() ? 'added to sitemap.xml' : 'already in sitemap.xml'));
}

if (require.main === module) main();
module.exports = { build, securityTxt };
