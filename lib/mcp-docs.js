#!/usr/bin/env node
/* =====================================================================
   lib/mcp-docs.js

   Keeps the tool count tied to the registry in api/mcp.js (TOOLS), so it
   is never typed by hand: in mcp.html, in the homepage's MCP band and in
   the tools index card.

     node lib/mcp-docs.js           rewrite the counts
     node lib/mcp-docs.js --check   exit 1 if any page disagrees with the
                                    registry; writes nothing

   Where the count appears:
     - in element text, between inline markers
         <!--c:toolCountCap-->Ten<!--/c-->  and  <!--c:toolCountLower-->ten<!--/c-->
     - in the meta descriptions: "<word> free, read-only tools"
     - in the FAQ JSON-LD: "All <word> tools are free"
   In index.html ("<n> tools \u00b7") and tools/index.html ("<Word> free
   tools, nothing stored") the same idea applies to one phrase each.
   Only those exact phrasings are touched. Other counts on the page, such
   as "the three tools that scan a live site", are different numbers and
   are left alone.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const word = (n) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function registry() {
  const m = require('../api/mcp.js');
  const live = m.TOOLS.filter((t) => t.annotations && t.annotations.openWorldHint).map((t) => t.name);
  return { tools: m.TOOLS.length, prompts: m.PROMPTS.length, live: live, content: m.TOOLS.length - live.length };
}
function toolCount() { return registry().tools; }

function sync(html, n) {
  const lower = word(n);
  const upper = cap(lower);
  const matchCase = (orig) => (/^[A-Z]/.test(orig) ? upper : lower);
  const r = registry();
  return html
    .replace(/<!--c:promptCountLower-->[\s\S]*?<!--\/c-->/g, '<!--c:promptCountLower-->' + word(r.prompts) + '<!--/c-->')
    .replace(/<!--c:promptCountCap-->[\s\S]*?<!--\/c-->/g, '<!--c:promptCountCap-->' + cap(word(r.prompts)) + '<!--/c-->')
    .replace(/<!--c:liveCountCap-->[\s\S]*?<!--\/c-->/g, '<!--c:liveCountCap-->' + cap(word(r.live.length)) + '<!--/c-->')
    .replace(/<!--c:contentCountLower-->[\s\S]*?<!--\/c-->/g, '<!--c:contentCountLower-->' + word(r.content) + '<!--/c-->')
    .replace(/<!--c:liveToolNames-->[\s\S]*?<!--\/c-->/g, '<!--c:liveToolNames-->' + r.live.join(', ') + '<!--/c-->')
    .replace(/<!--c:toolCountCap-->[\s\S]*?<!--\/c-->/g, '<!--c:toolCountCap-->' + upper + '<!--/c-->')
    .replace(/<!--c:toolCountLower-->[\s\S]*?<!--\/c-->/g, '<!--c:toolCountLower-->' + lower + '<!--/c-->')
    .replace(/\b([A-Za-z]+|\d+)( free, read-only tools)/g, (m, w, rest) => matchCase(w) + rest)
    .replace(/\bAll ([A-Za-z]+|\d+)( tools are free)/g, (m, w, rest) => 'All ' + lower + rest);
}

// Other pages that quote the count, one exact phrase each.
function syncOther(rel, html, n) {
  const lower = word(n);
  const upper = cap(lower);
  if (rel === 'index.html') return html.replace(/(mcp-band__facts">)\d+( tools \u00b7)/, (m, a, b) => a + n + b);
  if (rel === 'llms.txt') return html.replace(/\b([A-Za-z]+|\d+)( free, read-only tools)/, (m, w, rest) => lower + rest);
  if (rel === 'tools/index.html') return html.replace(/\b([A-Za-z]+|\d+)( free tools, nothing stored)/, (m, w, rest) => (/^[A-Z]/.test(w) ? upper : lower) + rest);
  return html;
}

function main() {
  const root = path.join(__dirname, '..');
  const n = toolCount();
  const check = process.argv.indexOf('--check') !== -1;
  const files = ['mcp.html', 'index.html', 'tools/index.html', 'llms.txt'];
  const stale = [];
  files.forEach(function (rel) {
    const file = path.join(root, rel);
    const html = fs.readFileSync(file, 'utf8');
    const next = rel === 'mcp.html' ? sync(html, n) : syncOther(rel, html, n);
    if (next === html) return;
    stale.push(rel);
    if (!check) fs.writeFileSync(file, next, 'utf8');
  });
  if (check) {
    if (stale.length) {
      console.error('Out of step with the registry (' + n + ' tools): ' + stale.join(', ') + '. Run: node lib/mcp-docs.js');
      process.exit(1);
    }
    console.log('OK: ' + files.join(', ') + ' match the registry (' + n + ' tools).');
    return;
  }
  console.log((stale.length ? 'Updated ' + stale.join(', ') : 'Already current') + '. Registry: ' + n + ' tools (' + word(n) + ').');
}

if (require.main === module) main();

module.exports = { toolCount: toolCount, sync: sync, word: word };
