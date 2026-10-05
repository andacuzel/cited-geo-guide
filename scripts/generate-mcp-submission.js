#!/usr/bin/env node
/* =====================================================================
   scripts/generate-mcp-submission.js

   Writes docs/mcp-submission.md, the text for an MCP directory submission,
   from the tool and prompt registry in api/mcp.js, lib/mcp-limits.js,
   vercel.json, site.config.json and the privacy page, so none of it can
   drift. Every tool in the registry needs an entry in EXAMPLES below: the
   generator stops if one is missing, so a new tool cannot ship undocumented.

     node scripts/generate-mcp-submission.js           write the file
     node scripts/generate-mcp-submission.js --check   exit 1 if it is out of date
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const mcp = require('../api/mcp.js');
const prompts = require('../lib/mcp-prompts.js');
const limits = require('../lib/mcp-limits.js');
const site = require('../lib/site-config.js');

const OUT = path.join(ROOT, 'docs', 'mcp-submission.md');
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen'];

// Example prompts per tool, with the behaviour to expect. One entry per registry tool.
const EXAMPLES = {
  scan_site: [['Scan example.com for AI readiness.', 'Returns the score out of 100, the three pillar scores, the state of the ten tracked crawlers and every failed check with its fix. Stores also get a separate commerce sub-score.']],
  compare_sites: [['Compare example.com with example.org.', 'Scans both one after the other and lists every check where they differ. If one site fails or times out, returns the other with a specific message.']],
  generate_schema: [['Write Organization JSON-LD for example.com.', 'Reads the homepage title, description and language and returns paste-ready JSON-LD with bracketed placeholders for facts it cannot know.']],
  generate_robots_txt: [['Write a robots.txt that allows GPTBot and ClaudeBot and blocks Bytespider.', 'Returns a robots.txt using only the tracked crawler names. Fetches nothing.']],
  generate_llms_txt: [['Write an llms.txt for a bakery called Crumb with its menu and contact pages.', 'Returns an llms.txt built from the name, description and pages given. Fetches nothing.']],
  get_playbook: [['Which playbooks do you have?', 'Called with no argument, lists the fourteen verticals with their track.'], ['Show me the CRM playbook.', 'Returns the strategic shift, three strategies and the pitfalls for that vertical.']],
  get_benchmark: [['How does a CRM company score on average?', 'Returns the archived average, median, range, pillar breakdown and crawler counts for the category, with sample size and scan date.']],
  list_ai_crawlers: [['Which AI crawlers can I control in robots.txt?', 'Lists the ten tracked crawlers with the company, what allowing or blocking means and the generator default.']],
  get_citation_prompts: [['Give me the questions to test whether an assistant names my CRM brand.', 'Returns the question set for the vertical and the protocol to run it yourself in any assistant.']],
  get_citation_sample: [['What does a citation result look like?', 'Returns the anonymised sample run: groups, rate with its range, and its limits. It belongs to a different brand.']],
  get_methodology: [['How is the score calculated?', 'Returns the three pillars with weights, every check and the limits of the scan.'], ['Why does the Page title check matter?', 'Returns that one check: what it tests, why it matters and the fix.']],
  get_research: [['What does your research say about llms.txt?', 'Returns the findings, method limits, URL and a citation line for the report.']],
  get_sample_report: [['What does a full-site report show?', 'Returns the sample crawl of our own site: whole-site beside homepage score, priorities, failing checks and the link.']]
};

function paramsOf(tool) {
  const props = (tool.inputSchema && tool.inputSchema.properties) || {};
  const req = (tool.inputSchema && tool.inputSchema.required) || [];
  const names = Object.keys(props);
  if (!names.length) return '_none_';
  return names.map((n) => '`' + n + '`' + (req.indexOf(n) === -1 ? ' (optional)' : ' (required)') + ': ' + (props[n].description || '').replace(/\n/g, ' ')).join('<br>');
}

async function discover() {
  return new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(o) { resolve(o); }, end() { resolve(null); } };
    mcp({ method: 'POST', headers: { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'server/discover' }, socket: {}, body: { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } } } }, res);
  });
}

async function build() {
  const missing = mcp.TOOLS.filter((t) => !EXAMPLES[t.name]).map((t) => t.name);
  if (missing.length) throw new Error('scripts/generate-mcp-submission.js has no EXAMPLES entry for: ' + missing.join(', '));
  Object.keys(EXAMPLES).forEach((n) => { if (!mcp.TOOLS.some((t) => t.name === n)) throw new Error('EXAMPLES has "' + n + '", which is not in the registry'); });
  const disc = await discover();
  const versions = disc.result.supportedVersions;
  let maxDuration = null;
  try { maxDuration = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).functions['api/mcp.js'].maxDuration; } catch (e) { /* unstated */ }
  const live = mcp.TOOLS.filter((t) => t.annotations.openWorldHint).map((t) => t.name);
  const nT = mcp.TOOLS.length, nP = prompts.PROMPTS.length;
  const url = site.baseUrl + '/api/mcp';
  const L = [];
  L.push('# Answerable MCP server: directory submission', '');
  L.push('Generated by `scripts/generate-mcp-submission.js` from the tool registry. Do not edit by hand.', '');
  L.push('## Listing', '');
  L.push('| Field | Value |', '| --- | --- |');
  L.push('| Name | Answerable |');
  L.push('| One line | Scan a site for AI readiness, generate the fixes, and read the playbooks, research and methodology behind the score. |');
  L.push('| Server URL | `' + url + '` |');
  L.push('| Transport | Streamable HTTP, one JSON response per request |');
  L.push('| Protocol versions | ' + versions.map((v) => '`' + v + '`').join(', ') + ' |');
  L.push('| Authentication | None. No key, no account. |');
  L.push('| Privacy policy | ' + site.baseUrl + '/privacy |');
  L.push('| Documentation | ' + site.baseUrl + '/mcp |');
  L.push('| Support | ' + site.contactEmail + ' |');
  L.push('| Tools | ' + nT + ' (' + WORDS[nT] + '), all read-only and non-destructive |');
  L.push('| Prompts | ' + nP + ' (' + WORDS[nP] + ') |', '');
  L.push('## Long description', '');
  L.push('Answerable measures AI readiness: whether AI crawlers can reach and read a website, and whether its signals give a model a reason to trust it. This server lets an assistant scan a domain, compare two sites, generate the fixes (JSON-LD, robots.txt, llms.txt), and read the vertical playbooks, the benchmark data, the published research, the scoring methodology and a sample full-site report. It also serves the citation question sets, so a person can test in their own assistant whether a brand is named. It does not measure whether any assistant names a brand, and a high score does not guarantee a mention.', '');
  L.push('## Tools', '');
  mcp.TOOLS.forEach((t) => {
    L.push('### `' + t.name + '`', '');
    L.push('**' + t.title + '.** ' + t.description, '');
    L.push('- Parameters: ' + paramsOf(t));
    L.push('- Annotations: readOnlyHint ' + t.annotations.readOnlyHint + ', destructiveHint ' + t.annotations.destructiveHint + ', idempotentHint ' + t.annotations.idempotentHint + ', openWorldHint ' + t.annotations.openWorldHint + (t.annotations.openWorldHint ? ' (fetches the live site you name)' : ' (reads this project\'s own files)'));
    L.push('- Example prompts:');
    EXAMPLES[t.name].forEach((e) => L.push('  - "' + e[0] + '" Expected: ' + e[1]));
    L.push('');
  });
  L.push('## Prompts', '');
  prompts.PROMPTS.forEach((p) => {
    L.push('### `' + p.name + '`', '');
    L.push('**' + p.title + '.** ' + p.description, '');
    L.push('- Arguments: ' + p.arguments.map((a) => '`' + a.name + '` (' + (a.required ? 'required' : 'optional') + '): ' + a.description).join('<br>'));
    L.push('');
  });
  L.push('## Limits', '');
  L.push('- Live-fetching tools (' + live.map((x) => '`' + x + '`').join(', ') + ') are rate limited per target domain: at most ' + limits.DOMAIN_PER_HOUR + ' fetches of one domain an hour, and a global ceiling of ' + limits.GLOBAL_PER_HOUR + ' live fetches an hour across all callers. A limited call says how long to wait. The limiter fails open if its store is unavailable.');
  if (maxDuration) L.push('- Function time limit: ' + maxDuration + ' seconds (`vercel.json`). `compare_sites` gives each scan its own deadline and returns the other site\'s result if one fails or times out.');
  L.push('- Public data only. The scanner reads what a site publishes at its own address. The content tools read this project\'s own files. Nothing reads a private page or signs in anywhere.');
  L.push('- The scan reads the homepage, robots.txt, llms.txt and the sitemap declaration. A store scan may also read one product page, only where robots.txt allows it.', '');
  L.push('## Data handling', '');
  L.push('- No accounts and no caller identity are stored. There is no API key.');
  L.push('- Scan results are not stored. The fetched content is used only to build the response.');
  L.push('- The server keeps short-lived counters keyed by a one-way hash of the scanned domain, and one counter for the current hour across all callers. They expire within an hour and hold no IP address, client name or account.');
  L.push('- This matches the privacy policy at ' + site.baseUrl + '/privacy and the Privacy section of ' + site.baseUrl + '/mcp.', '');
  L.push('## Known limitations', '');
  L.push('- It measures readiness, not presence: it cannot say whether any assistant names a brand today.');
  L.push('- The crawler-access check gives half credit for a crawler with any applicable Disallow rule, including ordinary paths such as /admin/.');
  L.push('- There is no tool that runs a citation check. A run is about 90 model calls, far past the function time limit. The citation tools hand over the questions and a protocol to run yourself.');
  L.push('- Store detection is a pattern match and misses some stores. Its platform markers were checked against live stores for Shopify and Salesforce Commerce Cloud only.');
  L.push('- The endpoint does not validate the `Origin` header. It is public, stateless and read-only, with no local socket to rebind.');
  L.push('- Requests without an `MCP-Protocol-Version` header are rejected, so clients for the 2025-03-26 revision are not served.', '');
  return L.join('\n');
}

function claimsHold() {
  const errors = [];
  const privacy = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (privacy.indexOf('The MCP server keeps short-lived counters keyed by the scanned domain, kept for an hour') === -1) errors.push('privacy.html does not state the MCP domain counters that the data-handling section describes');
  const meth = fs.readFileSync(path.join(ROOT, 'methodology.html'), 'utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  ['We checked Shopify and Salesforce Commerce Cloud against live stores.', 'The crawler-access check gives half credit'].forEach((s) => { if (meth.indexOf(s) === -1) errors.push('methodology.html no longer says: ' + s); });
  return errors;
}

(async function main() {
  const text = (await build()) + '\n';
  const check = process.argv.indexOf('--check') !== -1;
  const errors = claimsHold();
  if (check) {
    if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== text) errors.push('docs/mcp-submission.md is out of date; run node scripts/generate-mcp-submission.js');
    const listed = (fs.readFileSync(OUT, 'utf8').match(/^### `([a-z_]+)`$/gm) || []).map((x) => x.replace(/[^a-z_]/g, '').replace(/^/, ''));
    const names = mcp.TOOLS.map((t) => t.name).concat(prompts.PROMPTS.map((p) => p.name));
    names.forEach((n) => { if (listed.indexOf(n) === -1) errors.push('the submission does not list ' + n); });
    if (errors.length) { errors.forEach((e) => console.error('FAIL: ' + e)); process.exit(1); }
    console.log('OK: docs/mcp-submission.md lists exactly the registry (' + mcp.TOOLS.length + ' tools, ' + prompts.PROMPTS.length + ' prompts) and its claims match privacy.html and methodology.html');
    return;
  }
  if (errors.length) { errors.forEach((e) => console.error('FAIL: ' + e)); process.exit(1); }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text, 'utf8');
  console.log('docs/mcp-submission.md written');
})();
