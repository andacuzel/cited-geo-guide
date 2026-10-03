#!/usr/bin/env node
/* =====================================================================
   scripts/inline-icons.js

   Fills the icon markers in hand-written pages from lib/icons.js, so the
   drawings live in one place and are inlined (never <img> or an external
   <use>). A marker pair looks like

     <!--icon:cart--><svg …></svg><!--/icon-->

   and may carry a class:  <!--icon:cart class="ac-step__icon"-->…<!--/icon-->

   Running it rewrites whatever sits between each pair, so it is idempotent.

     node scripts/inline-icons.js file.html [more.html …]    rewrite
     node scripts/inline-icons.js --check file.html […]      exit 1 if any
                                                             marker is stale
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const ICONS = require('../lib/icons.js');

const MARKER = /<!--icon:([a-z0-9]+)(?: class="([^"]*)")?-->[\s\S]*?<!--\/icon-->/g;

function fill(html) {
  return html.replace(MARKER, function (m, name, cls) {
    return '<!--icon:' + name + (cls ? ' class="' + cls + '"' : '') + '-->' + ICONS.svg(name, { cls: cls }) + '<!--/icon-->';
  });
}

function main() {
  const args = process.argv.slice(2);
  const check = args.indexOf('--check') !== -1;
  const files = args.filter((a) => a !== '--check');
  if (!files.length) { console.error('Usage: node scripts/inline-icons.js [--check] file.html […]'); process.exit(2); }
  let stale = 0;
  files.forEach(function (f) {
    const file = path.resolve(f);
    const html = fs.readFileSync(file, 'utf8');
    const next = fill(html);
    const n = (html.match(MARKER) || []).length;
    if (next !== html) {
      if (check) { stale++; console.error(f + ': icon markers are stale'); } else fs.writeFileSync(file, next, 'utf8');
    }
    if (!check) console.log(f + ': ' + n + ' icon(s) inlined');
    else if (next === html) console.log(f + ': ' + n + ' icon(s) current');
  });
  if (stale) process.exit(1);
}

if (require.main === module) main();

module.exports = { fill: fill };
