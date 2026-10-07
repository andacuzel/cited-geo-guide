#!/usr/bin/env node
/* =====================================================================
   scripts/capture-mcp-examples.js

   Calls the live MCP endpoint (base URL from site.config.json) with the
   headers the current spec requires and stores the first lines of each
   output in content/mcp-examples.json. mcp.html shows these excerpts and
   scripts/generate-mcp-page.js --check compares every figure on the page
   with this file.

   Six calls, no others: scan_site for our own host, get_methodology,
   get_benchmark for crm, get_citation_sample, generate_schema for our own
   host, and one scan_site on example.com. No third-party site is requested
   beyond that one, and no model is called.

     node scripts/capture-mcp-examples.js            capture and write
     node scripts/capture-mcp-examples.js --dry      capture, print, write nothing
     node scripts/capture-mcp-examples.js --local    re-capture only the three content tools (get_methodology,
                                                     get_benchmark, get_citation_sample) from the code in this
                                                     checkout, with no request at all, and date just those. Used
                                                     after a rename or a content change, before the new code is
                                                     deployed. The scans and the schema example are kept as captured.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const site = require('../lib/site-config.js');

const OUT = path.join(__dirname, '..', 'content', 'mcp-examples.json');
const ENDPOINT = site.baseUrl + '/api/mcp';
const LINES = 12;
const VERSION = '2026-07-28';
const META = { 'io.modelcontextprotocol/protocolVersion': VERSION, 'io.modelcontextprotocol/clientCapabilities': {} };

const CALLS = [
  { id: 'scan-self', tool: 'scan_site', args: { domain: site.host }, prompt: 'Scan ' + site.host + ' and tell me what to fix first' },
  { id: 'methodology', tool: 'get_methodology', args: {}, prompt: 'How is the Citehound score built?' },
  { id: 'benchmark-crm', tool: 'get_benchmark', args: { category: 'crm' }, prompt: 'How do CRM sites score on AI readiness?' },
  { id: 'citation-sample', tool: 'get_citation_sample', args: {}, prompt: 'Show me a sample citation result' },
  { id: 'schema-self', tool: 'generate_schema', args: { domain: site.host, type: 'organization' }, prompt: 'Write Organization JSON-LD for ' + site.host },
  { id: 'scan-example', tool: 'scan_site', args: { domain: 'example.com' }, prompt: 'Scan example.com and tell me what to fix first' }
];

async function call(c) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'MCP-Protocol-Version': VERSION, 'Mcp-Method': 'tools/call', 'Mcp-Name': c.tool },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: c.tool, arguments: c.args, _meta: META } })
  });
  const body = await res.json();
  if (res.status !== 200 || !body.result || body.result.isError) throw new Error(c.id + ': ' + res.status + ' ' + JSON.stringify(body).slice(0, 300));
  const text = body.result.content[0].text;
  const all = text.split('\n');
  return { id: c.id, tool: c.tool, arguments: c.args, prompt: c.prompt, lines: all.slice(0, LINES), totalLines: all.length };
}

const LOCAL_IDS = ['methodology', 'benchmark-crm', 'citation-sample'];

async function callLocal(c) {
  const mcp = require('../api/mcp.js');
  const out = await mcp.HANDLERS[c.tool](c.args, { headers: {}, socket: {} });
  const all = out.text.split('\n');
  return { id: c.id, tool: c.tool, arguments: c.args, prompt: c.prompt, lines: all.slice(0, LINES), totalLines: all.length, capturedAt: new Date().toISOString().slice(0, 10) };
}

(async function main() {
  const date = new Date().toISOString().slice(0, 10);
  if (process.argv.indexOf('--local') !== -1) {
    const doc = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    for (const c of CALLS.filter((x) => LOCAL_IDS.indexOf(x.id) !== -1)) {
      const e = await callLocal(c);
      doc.examples = doc.examples.map((x) => (x.id === e.id ? e : x));
      console.log('re-captured ' + e.id + ' locally (' + e.totalLines + ' lines)');
    }
    fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n', 'utf8');
    return;
  }
  const examples = [];
  for (const c of CALLS) {
    const e = await call(c);
    examples.push(e);
    console.log('captured ' + e.id + ' (' + e.totalLines + ' lines, kept ' + e.lines.length + ')');
  }
  const doc = { capturedAt: date, endpoint: ENDPOINT, protocolVersion: VERSION, examples: examples };
  if (process.argv.indexOf('--dry') !== -1) { console.log(JSON.stringify(doc, null, 2)); return; }
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  console.log('written ' + path.relative(process.cwd(), OUT));
})().catch((e) => { console.error(e.message); process.exit(1); });
