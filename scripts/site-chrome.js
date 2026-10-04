#!/usr/bin/env node
/* =====================================================================
   scripts/site-chrome.js: three things every public page should carry.

     1. Organization and WebSite JSON-LD, with the homepage's own @id values
        (read from index.html, never retyped), so the scan's
        "Organization / WebSite schema" check can pass on every page and all
        pages describe the same entity.
     2. A Contact link in the footer (a mailto: the privacy page already shows).
     3. Where a page has too few H2 headings, an existing text element promoted
        to an H2 with the same words. No wording changes.

   Generated pages (playbooks, citation tracking, sample report, benchmarks)
   take the block from their generators, which call schemaBlock() and footer
   below; this script applies it to hand-written pages and checks all of them.

     node scripts/site-chrome.js           apply to hand-written pages
     node scripts/site-chrome.js --check   verify every page; write nothing

   Not touched: the two research reports and the case study (protected), the
   homepage (it carries the entities itself) and app/ (unlisted, noindex).
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONTACT_HREF = 'mailto:andacuz@gmail.com';
const START = '<!-- SITE-SCHEMA:START -->';
const END = '<!-- SITE-SCHEMA:END -->';
const EXEMPT = ['index.html', 'research/case-study-agaone.html', 'research/llms-txt-adoption-2026.html', 'app/crawl.html', 'app/report.html'];
// Pages that fall short of two H2 headings and have a scan-bridge line that can be promoted.
const PROMOTE_BRIDGE = ['about.html', 'for-saas.html', 'for-brands.html', 'for-professionals.html', 'tools/schema-generator.html', 'tools/llms-txt-checker.html'];

function homepageEntities() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const blocks = html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || [];
  for (const b of blocks) {
    const j = JSON.parse(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''));
    const g = Array.isArray(j['@graph']) ? j['@graph'] : [];
    const org = g.filter((x) => x['@type'] === 'Organization')[0];
    const site = g.filter((x) => x['@type'] === 'WebSite')[0];
    if (org && site) return { org: org, site: site };
  }
  throw new Error('index.html has no Organization and WebSite JSON-LD to reuse');
}

function schemaBlock() {
  const e = homepageEntities();
  const ld = { '@context': 'https://schema.org', '@graph': [e.org, e.site] };
  return START + '\n<script type="application/ld+json">\n' + JSON.stringify(ld, null, 2) + '\n</script>\n' + END;
}

function indent(text, pad) { return text.replace(/^/gm, pad); }

// The footer nav's link, in the nav's own indentation.
function contactLine(indentation) {
  return indentation + '<a href="' + CONTACT_HREF + '" class="site-nav__link">Contact</a>';
}

function htmlFiles() {
  const out = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      if (['node_modules', '.git', 'local', '.claude', 'asset', 'data', 'supabase', 'content', 'lib', 'api', 'scripts'].indexOf(e.name) !== -1) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else if (e.name.endsWith('.html')) out.push(path.relative(ROOT, p));
    });
  }(ROOT));
  return out.sort();
}

function applyTo(rel) {
  const file = path.join(ROOT, rel);
  let s = fs.readFileSync(file, 'utf8');
  const before = s;
  const block = indent(schemaBlock(), '  ');
  if (s.indexOf(START) !== -1) s = s.replace(new RegExp('[ \\t]*' + START + '[\\s\\S]*?' + END), block);
  else s = s.replace(/\n<\/head>/, '\n' + block + '\n</head>');
  if (!/footer-links[\s\S]*?>Contact<\/a>/.test(s)) {
    s = s.replace(/(<nav class="site-nav footer-links"[^>]*>\n)([\s\S]*?)(\n[ \t]*<\/nav>)/, function (m, open, links, close) {
      const last = links.split('\n').pop();
      const pad = (/^[ \t]*/.exec(last) || [''])[0];
      return open + links + '\n' + contactLine(pad) + close;
    });
  }
  if (s !== before) fs.writeFileSync(file, s, 'utf8');
  return s !== before;
}

// Same words, one more H2: the page's own "scan" line becomes a heading.
function promoteBridge(rel) {
  const file = path.join(ROOT, rel);
  const s = fs.readFileSync(file, 'utf8');
  const re = /<p class="scan-bridge__text">([\s\S]*?)<\/p>/;
  if (!re.test(s)) return false;
  fs.writeFileSync(file, s.replace(re, '<h2 class="scan-bridge__text">$1</h2>'), 'utf8');
  return true;
}

function main() {
  const check = process.argv.indexOf('--check') !== -1;
  const files = htmlFiles().filter((f) => EXEMPT.indexOf(f) === -1);
  if (!check) {
    const changed = files.filter(applyTo);
    const promoted = PROMOTE_BRIDGE.filter(promoteBridge);
    console.log('Schema block and Contact link added or refreshed in ' + changed.length + ' page(s)' + (changed.length ? ': ' + changed.join(', ') : '') + '.');
    console.log('Scan line promoted to an H2 on ' + promoted.length + ' page(s)' + (promoted.length ? ': ' + promoted.join(', ') : '') + '.');
    return;
  }
  const scanner = require('../lib/scanner.js');
  const e = homepageEntities();
  const problems = [];
  files.forEach(function (rel) {
    const s = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const blocks = s.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || [];
    let ok = false;
    blocks.forEach(function (b) {
      let j;
      try { j = JSON.parse(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (err) { problems.push(rel + ': a JSON-LD block does not parse'); return; }
      const g = Array.isArray(j['@graph']) ? j['@graph'] : [j];
      if (g.some((x) => x['@type'] === 'Organization' && x['@id'] === e.org['@id']) && g.some((x) => x['@type'] === 'WebSite' && x['@id'] === e.site['@id'])) ok = true;
    });
    if (!ok) problems.push(rel + ': no Organization and WebSite JSON-LD with the homepage @id values');
    if (!/footer-links[\s\S]*?>Contact<\/a>/.test(s)) problems.push(rel + ': footer has no Contact link');
    const sig = scanner.parseSignals(s);
    if (!sig.hasOrgSchema) problems.push(rel + ': the scanner does not see Organization / WebSite schema');
    if (!sig.contactSignal) problems.push(rel + ': the scanner does not see a contact signal');
    if (PROMOTE_BRIDGE.indexOf(rel) !== -1 && sig.h2Count < 2) problems.push(rel + ': fewer than two H2 headings');
  });
  if (problems.length) { console.error('FAIL (' + problems.length + '):\n  ' + problems.join('\n  ')); process.exit(1); }
  console.log('OK: ' + files.length + ' pages carry Organization and WebSite JSON-LD (homepage @id values), a Contact link and, where promoted, a second H2; the scanner sees each.');
}

if (require.main === module) main();

module.exports = { schemaBlock: schemaBlock, contactLine: contactLine, CONTACT_HREF: CONTACT_HREF, START: START, END: END };
