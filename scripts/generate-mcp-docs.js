#!/usr/bin/env node
/* =====================================================================
   scripts/generate-mcp-docs.js

   Writes three regions of mcp.html from the MCP registry (api/mcp.js), so the
   page cannot drift from the server:
     MCP-DOCS-TOOLS     the tools added after the original ten: methodology,
                        research and the sample report, each with its
                        description, an example call and a trimmed real
                        response produced by running the handler
     MCP-DOCS-PROMPTS   every prompt: title, description, arguments, the tools
                        its text names, and an example prompts/get request
     MCP-DOCS-LIMITS    the rate limits (from lib/mcp-limits.js), the per-scan
                        deadline, the function time limit (from vercel.json)
   Counts elsewhere on the page come from lib/mcp-docs.js.

     node scripts/generate-mcp-docs.js           rewrite the regions
     node scripts/generate-mcp-docs.js --check   exit 1 if mcp.html is out of date
   ===================================================================== */

'use strict';

process.env.MCP_SCAN_DEADLINE_MS = process.env.MCP_SCAN_DEADLINE_MS || '';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const mcp = require('../api/mcp.js');
const limits = require('../lib/mcp-limits.js');
const prompts = require('../lib/mcp-prompts.js');
const site = require('../lib/site-config.js');

const FILE = path.join(ROOT, 'mcp.html');
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pre = (label, code) => '          <div class="fix-snippet">\n            <div class="fix-snippet__head"><span class="fix-snippet__label">' + label + '</span></div>\n            <pre class="fix-snippet__code">' + esc(code) + '</pre>\n          </div>\n';

// Tools documented in the generated region: the ones the hand-written section above does not cover.
const HAND_WRITTEN = ['scan_site', 'compare_sites', 'generate_schema', 'generate_robots_txt', 'generate_llms_txt', 'get_playbook', 'get_benchmark', 'list_ai_crawlers', 'get_citation_prompts', 'get_citation_sample'];
const EXAMPLES = {
  get_methodology: { args: { check: 'Page title' }, lines: 12 },
  get_research: { args: { slug: 'llms-txt-adoption-2026' }, lines: 14 },
  get_sample_report: { args: {}, lines: 16 }
};

function needsLine(tool) {
  const props = Object.keys((tool.inputSchema && tool.inputSchema.properties) || {});
  const req = (tool.inputSchema && tool.inputSchema.required) || [];
  if (!props.length) return 'nothing';
  return props.map((p) => '<code>' + p + '</code>' + (req.indexOf(p) === -1 ? ' (optional)' : '')).join(', ');
}

async function toolsRegion() {
  const extra = mcp.TOOLS.filter((t) => HAND_WRITTEN.indexOf(t.name) === -1);
  let h = '        <!-- MCP-DOCS-TOOLS:START -->\n        <div class="doc-section">\n          <h2 class="doc-section__heading">Methodology, research and the sample report</h2>\n\n';
  for (const t of extra) {
    const ex = EXAMPLES[t.name];
    h += '          <div class="results-content__body">\n            <h3 id="' + t.name + '">' + t.name + '</h3>\n            <p><strong>Fetches:</strong> ' + (t.annotations.openWorldHint ? 'the live domain' : 'nothing') + ' &middot; <strong>Needs:</strong> ' + needsLine(t) + '</p>\n            <p>' + esc(t.description) + '</p>\n          </div>\n';
    if (ex) {
      h += pre('Example call', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: t.name, arguments: ex.args } }, null, 2));
      const out = await mcp.HANDLERS[t.name](ex.args, { headers: {}, socket: {} });
      const lines = out.text.split('\n');
      const body = lines.slice(0, ex.lines).join('\n') + (lines.length > ex.lines ? '\n(trimmed: ' + (lines.length - ex.lines) + ' more lines in a real response)' : '');
      h += pre('Example response (trimmed)', body);
    }
    h += '\n';
  }
  h += '        </div>\n        <!-- MCP-DOCS-TOOLS:END -->';
  return h;
}

function promptsRegion() {
  const list = prompts.list();
  const n = WORDS[list.length] || String(list.length);
  const toolNames = mcp.TOOLS.map((t) => t.name);
  let h = '    <!-- MCP-DOCS-PROMPTS:START -->\n    <section class="verticals" aria-labelledby="prompts-heading">\n      <div class="section__inner">\n        <div class="doc-section">\n          <h2 id="prompts-heading" class="doc-section__heading"><!--c:promptCountCap-->' + cap(n) + '<!--/c--> prompts</h2>\n          <p>Prompts are workflows you start yourself, often as a slash command in the client. Each one asks the assistant to call the tools above in order and to say what the scan does not measure. Clients list them with <code>prompts/list</code> and fetch one with <code>prompts/get</code>, which needs the <code>Mcp-Name</code> header on <code>2026-07-28</code>.</p>\n\n';
  list.forEach((p) => {
    const sample = {};
    p.arguments.forEach((a) => { sample[a.name] = a.name === 'domain' ? 'example.com' : a.name === 'vertical' ? 'crm' : 'Acme'; });
    const text = prompts.get(p.name, sample).messages[0].content.text;
    const named = toolNames.filter((tn) => new RegExp('\\b' + tn + '\\b').test(text));
    h += '          <div class="results-content__body">\n            <h3 id="prompt-' + p.name + '">' + p.name + '</h3>\n            <p><strong>Needs:</strong> ' + p.arguments.map((a) => '<code>' + a.name + '</code>').join(', ') + ' &middot; <strong>Calls:</strong> ' + named.map((x) => '<code>' + x + '</code>').join(', ') + '</p>\n            <p>' + esc(p.description) + '</p>\n          </div>\n';
    h += pre('Example request', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'prompts/get', params: { name: p.name, arguments: sample } }, null, 2));
    h += '\n';
  });
  h += '        </div>\n      </div>\n    </section>\n    <!-- MCP-DOCS-PROMPTS:END -->';
  return h;
}

function limitsRegion() {
  let maxDuration = null;
  try { maxDuration = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).functions['api/mcp.js'].maxDuration; } catch (e) { /* leave unstated */ }
  const live = mcp.TOOLS.filter((t) => t.annotations.openWorldHint).map((t) => t.name);
  let h = '    <!-- MCP-DOCS-LIMITS:START -->\n    <section class="verticals" aria-labelledby="limits-heading">\n      <div class="section__inner">\n        <div class="doc-section">\n          <h2 id="limits-heading" class="doc-section__heading">Limits</h2>\n          <ul class="doc-list">\n';
  h += '            <li>The tools that scan a live site (' + live.map((x) => '<code>' + x + '</code>').join(', ') + ') are rate limited per domain: at most ' + limits.DOMAIN_PER_HOUR + ' fetches of the same domain an hour, and a global ceiling of ' + limits.GLOBAL_PER_HOUR + ' live fetches an hour across all callers. The limit is on the target, not on you, because every user of a hosted client shares an address. A limited call says how long to wait.</li>\n';
  h += '            <li><code>compare_sites</code> gives each scan its own deadline. If one site fails or times out, you still get the other site&rsquo;s result and a specific message for the one that failed.</li>\n';
  if (maxDuration) h += '            <li>The server function has a ' + maxDuration + '-second time limit, so there is no tool that runs a citation check.</li>\n';
  h += '            <li>Public data only: the scanner reads what a site publishes at its own address, and the content tools read this project&rsquo;s own files. Nothing here reads a private page or logs in anywhere.</li>\n';
  h += '            <li>A readiness score is not a measure of whether any assistant names a brand, and a high score does not guarantee a mention.</li>\n';
  h += '          </ul>\n        </div>\n      </div>\n    </section>\n    <!-- MCP-DOCS-LIMITS:END -->';
  return h;
}

function replaceRegion(html, name, text) {
  const re = new RegExp('[ \\t]*<!-- ' + name + ':START -->[\\s\\S]*?<!-- ' + name + ':END -->');
  if (!re.test(html)) throw new Error('mcp.html has no ' + name + ' markers');
  return html.replace(re, () => text);
}

(async function main() {
  const html = fs.readFileSync(FILE, 'utf8');
  let next = replaceRegion(html, 'MCP-DOCS-TOOLS', await toolsRegion());
  next = replaceRegion(next, 'MCP-DOCS-PROMPTS', promptsRegion());
  next = replaceRegion(next, 'MCP-DOCS-LIMITS', limitsRegion());
  if (process.argv.indexOf('--check') !== -1) {
    if (next !== html) { console.error('mcp.html generated regions are out of date; run node scripts/generate-mcp-docs.js'); process.exit(1); }
    console.log('OK: mcp.html generated regions match the registry (' + mcp.TOOLS.length + ' tools, ' + prompts.PROMPTS.length + ' prompts)');
    return;
  }
  if (next !== html) fs.writeFileSync(FILE, next, 'utf8');
  console.log('mcp.html regions written (' + mcp.TOOLS.length + ' tools, ' + prompts.PROMPTS.length + ' prompts)');
})();
