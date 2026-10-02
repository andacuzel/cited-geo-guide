#!/usr/bin/env node
/* =====================================================================
   lib/mcp-docs.js

   Keeps the tool count in mcp.html tied to the registry in api/mcp.js
   (TOOLS), so it is never typed by hand.

     node lib/mcp-docs.js           rewrite the count words in mcp.html
     node lib/mcp-docs.js --check   exit 1 if mcp.html disagrees with the
                                    registry; writes nothing

   Where the count appears:
     - in element text, between inline markers
         <!--c:toolCountCap-->Ten<!--/c-->  and  <!--c:toolCountLower-->ten<!--/c-->
     - in the meta descriptions: "<word> free, read-only tools"
     - in the FAQ JSON-LD: "All <word> tools are free"
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

function toolCount() {
  return require('../api/mcp.js').TOOLS.length;
}

function sync(html, n) {
  const lower = word(n);
  const upper = cap(lower);
  const matchCase = (orig) => (/^[A-Z]/.test(orig) ? upper : lower);
  return html
    .replace(/<!--c:toolCountCap-->[\s\S]*?<!--\/c-->/g, '<!--c:toolCountCap-->' + upper + '<!--/c-->')
    .replace(/<!--c:toolCountLower-->[\s\S]*?<!--\/c-->/g, '<!--c:toolCountLower-->' + lower + '<!--/c-->')
    .replace(/\b([A-Za-z]+|\d+)( free, read-only tools)/g, (m, w, rest) => matchCase(w) + rest)
    .replace(/\bAll ([A-Za-z]+|\d+)( tools are free)/g, (m, w, rest) => 'All ' + lower + rest);
}

function main() {
  const file = path.join(__dirname, '..', 'mcp.html');
  const html = fs.readFileSync(file, 'utf8');
  const n = toolCount();
  const next = sync(html, n);
  if (process.argv.indexOf('--check') !== -1) {
    if (next !== html) {
      console.error('mcp.html does not match the registry: ' + n + ' tools. Run: node lib/mcp-docs.js');
      process.exit(1);
    }
    console.log('OK: mcp.html says ' + word(n) + ' tools, matching the registry (' + n + ').');
    return;
  }
  if (next !== html) fs.writeFileSync(file, next, 'utf8');
  console.log((next !== html ? 'Updated' : 'Already current:') + ' mcp.html, ' + n + ' tools (' + word(n) + ').');
}

if (require.main === module) main();

module.exports = { toolCount: toolCount, sync: sync, word: word };
