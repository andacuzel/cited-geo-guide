#!/usr/bin/env node
/* =====================================================================
   scripts/check-pages.js

   Structural checks for the hand-built pages:

     node scripts/check-pages.js                 all configured pages
     node scripts/check-pages.js agentic-commerce

   Every page: exactly one h1, JSON-LD parses, duplicate ids, icon markers
   current (lib/icons.js), no gradients, no emoji, no banned words, and
   (where there is a FAQ) the <details> equal the FAQPage JSON-LD.
   agentic-commerce also: every element id scanner.js depends on is present.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const { fill } = require('./inline-icons.js');

const ROOT = path.resolve(__dirname, '..');
const BANNED = /\b(quietly|actually|seamlessly|effortless(ly)?|powerful|unlock|elevate|supercharge|game-changing|revolutioni[sz]e|landscape|delve|crucial|robust)\b/i;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{FE0F}]/u;

const PAGES = {
  'agentic-commerce': { file: 'agentic-commerce.html', faq: true, scannerIds: true },
  'citation-tracking': { file: 'citation-tracking.html', faq: true, noWords: /\b(recommended|featured|sweeps?|mention rate)\b/i, noTerms: /\b(free|price|pricing|waitlist|coming soon)\b|launch(es|ing|ed)? (date|in|on)/i },
  'sample-report': { file: 'sample-report.html', faq: false }
};

const decode = (s) => s.replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&nbsp;/g, ' ');
const textOf = (h) => decode(h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

function checkPage(name, cfg) {
  const problems = [];
  const bad = (m) => problems.push(name + ': ' + m);
  const file = path.join(ROOT, cfg.file);
  if (!fs.existsSync(file)) { bad('file is missing'); return problems; }
  const html = fs.readFileSync(file, 'utf8');

  if ((html.match(/<h1[\s>]/g) || []).length !== 1) bad('must have exactly one h1');

  const lds = html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || [];
  const parsed = [];
  lds.forEach(function (b) {
    try { parsed.push(JSON.parse(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''))); } catch (e) { bad('JSON-LD does not parse: ' + e.message); }
  });
  if (!parsed.length) bad('no JSON-LD');

  const ids = (html.match(/\sid="([^"]+)"/g) || []).map((s) => s.slice(5, -1));
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dup.length) bad('duplicate ids: ' + Array.from(new Set(dup)).join(', '));

  if (fill(html) !== html) bad('icon markers are stale; run node scripts/inline-icons.js ' + cfg.file);
  if (/<img\b|<use\b/i.test(html.replace(/<script[\s\S]*?<\/script>/gi, ''))) bad('icons must be inlined: <img> or <use> found');
  if (/gradient\s*\(/i.test(html)) bad('gradient found');
  const text = textOf(html);
  if (EMOJI.test(text)) bad('emoji found');
  const banned = text.match(BANNED);
  if (banned) bad('banned word: ' + banned[0]);
  if (cfg.noWords) { const m = text.match(cfg.noWords); if (m) bad('forbidden word in visible copy: ' + m[0]); }
  if (cfg.noTerms) { const m = text.match(cfg.noTerms); if (m) bad('forbidden term in visible copy: ' + m[0]); }
  text.split(/(?<=[.!?])\s+/).forEach(function () {});
  // one em dash per paragraph at most
  (html.match(/<p[\s>][\s\S]*?<\/p>/g) || []).forEach(function (p) {
    const t = textOf(p);
    if ((t.match(/—/g) || []).length > 1) bad('more than one em dash in a paragraph: ' + t.slice(0, 60));
  });

  if (cfg.faq) {
    const ld = parsed.filter((p) => p['@type'] === 'FAQPage')[0];
    if (!ld) bad('no FAQPage JSON-LD');
    else {
      const jq = ld.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]);
      const hq = (html.match(/<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/g) || []).map(function (d) {
        const m = d.match(/<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/);
        return [textOf(m[1]), textOf(m[2])];
      });
      if (JSON.stringify(jq) !== JSON.stringify(hq)) bad('FAQ <details> do not equal the FAQPage JSON-LD (' + hq.length + ' vs ' + jq.length + ')');
    }
  }

  if (cfg.scannerIds) {
    const scanner = fs.readFileSync(path.join(ROOT, 'scanner.js'), 'utf8');
    const used = Array.from(new Set((scanner.match(/\$\('([A-Za-z0-9_-]+)'\)/g) || []).map((s) => s.slice(3, -2))));
    // agencyLink and fixSnippetsBody are optional in scanner.js (guarded or created by it); toast is in the page shell.
    used.forEach(function (id) { if (ids.indexOf(id) === -1 && ['agencyLink', 'fixSnippetsBody'].indexOf(id) === -1) bad('scanner.js needs #' + id); });
    if (html.indexOf('src="scanner.js') === -1) bad('scanner.js is not loaded');
  }
  return problems;
}

function main() {
  const want = process.argv.slice(2);
  const names = want.length ? want : Object.keys(PAGES).filter((n) => fs.existsSync(path.join(ROOT, PAGES[n].file)));
  let problems = [];
  names.forEach(function (n) {
    if (!PAGES[n]) { problems.push('unknown page ' + n); return; }
    const p = checkPage(n, PAGES[n]);
    problems = problems.concat(p);
    console.log((p.length ? 'FAIL ' : 'ok   ') + n);
  });
  if (problems.length) { console.error('\n' + problems.join('\n')); process.exit(1); }
}

if (require.main === module) main();

module.exports = { checkPage: checkPage, PAGES: PAGES, textOf: textOf };
