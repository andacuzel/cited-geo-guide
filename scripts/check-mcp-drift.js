#!/usr/bin/env node
/* =====================================================================
   scripts/check-mcp-drift.js

   Fails when the things the MCP server says drift from the things it reads:
     1. every sentence in lib/methodology.js LIMITS appears verbatim in methodology.html
     2. the methodology's "what it tests" entries cover exactly the scanner's checks
     3. every tool name a prompt (or a plugin skill, once plugin/ exists) uses is in the registry
     4. mcp.html documents every tool and every prompt, with the counts derived from the registry
     5. the tools that fetch a live site are exactly the ones annotated open-world
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const mcp = require('../api/mcp.js');
const methodology = require('../lib/methodology.js');
const prompts = require('../lib/mcp-prompts.js');

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', mdash: '—', ndash: '–', hellip: '…' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (Object.prototype.hasOwnProperty.call(NAMED, e) ? NAMED[e] : m)));
const textOf = (html) => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ');

const errors = [];
const bad = (m) => errors.push(m);
const names = mcp.TOOLS.map((t) => t.name);

// 1
const meth = textOf(fs.readFileSync(path.join(ROOT, 'methodology.html'), 'utf8'));
methodology.LIMITS.forEach((l) => { if (meth.indexOf(l) === -1) bad('methodology.html does not contain this limit verbatim: "' + l + '"'); });

// 2
const reg = methodology.labels();
Object.keys(methodology.TESTS).forEach((k) => { if (reg.indexOf(k) === -1) bad('lib/methodology.js TESTS has "' + k + '", which is not a scanner check'); });
reg.forEach((l) => { if (!methodology.TESTS[l]) bad('the scanner has a check "' + l + '" with no entry in lib/methodology.js TESTS'); });

// 3
const toolRe = /\b(scan_site|compare_sites|generate_[a-z_]+|get_[a-z_]+|list_ai_crawlers)\b/g;
function toolsUsedIn(label, text) { (text.match(toolRe) || []).forEach((n) => { if (names.indexOf(n) === -1) bad(label + ' uses a tool that is not in the registry: ' + n); }); }
prompts.PROMPTS.forEach((p) => {
  const args = {};
  p.arguments.forEach((a) => { args[a.name] = a.name === 'domain' ? 'example.com' : a.name === 'vertical' ? 'crm' : 'Acme'; });
  toolsUsedIn('prompt ' + p.name, prompts.get(p.name, args).messages[0].content.text);
});
const skillsDir = path.join(ROOT, 'plugin', 'skills');
if (fs.existsSync(skillsDir)) {
  fs.readdirSync(skillsDir).forEach((d) => {
    const f = path.join(skillsDir, d, 'SKILL.md');
    if (fs.existsSync(f)) toolsUsedIn('skill ' + d, fs.readFileSync(f, 'utf8'));
  });
}

// 4
const page = fs.readFileSync(path.join(ROOT, 'mcp.html'), 'utf8');
names.forEach((n) => { if (page.indexOf('id="' + n + '"') === -1) bad('mcp.html does not document the tool ' + n); });
prompts.PROMPTS.forEach((p) => { if (page.indexOf('id="prompt-' + p.name + '"') === -1) bad('mcp.html does not document the prompt ' + p.name); });
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen'];
const marker = (key) => { const m = new RegExp('<!--c:' + key + '-->([\\s\\S]*?)<!--/c-->').exec(page); return m ? m[1] : null; };
if ((marker('toolCountLower') || '').toLowerCase() !== WORDS[names.length]) bad('mcp.html tool count is "' + marker('toolCountLower') + '", the registry has ' + names.length);
if ((marker('promptCountLower') || '').toLowerCase() !== WORDS[prompts.PROMPTS.length]) bad('mcp.html prompt count is "' + marker('promptCountLower') + '", the registry has ' + prompts.PROMPTS.length);
const meta = /<meta name="description" content="([^"]*)"/.exec(page);
if (!meta || meta[1].toLowerCase().indexOf(WORDS[names.length] + ' free, read-only tools') === -1) bad('the mcp.html meta description does not carry the registry tool count');
if (/"All (\w+) tools are free/.exec(page) && /"All (\w+) tools are free/.exec(page)[1].toLowerCase() !== WORDS[names.length]) bad('the mcp.html FAQ tool count is stale');

// 5
const live = mcp.TOOLS.filter((t) => t.annotations.openWorldHint).map((t) => t.name).sort();
const documented = (marker('liveToolNames') || '').split(',').map((x) => x.trim()).sort();
if (live.join() !== documented.join()) bad('mcp.html lists live-fetching tools ' + documented.join(', ') + '; the registry says ' + live.join(', '));

if (errors.length) { errors.forEach((m) => console.error('FAIL: ' + m)); process.exit(1); }
console.log('OK: methodology limits are verbatim in methodology.html; ' + reg.length + ' checks covered; prompts' + (fs.existsSync(skillsDir) ? ' and skills' : '') + ' name only registry tools; mcp.html documents ' + names.length + ' tools and ' + prompts.PROMPTS.length + ' prompts');
