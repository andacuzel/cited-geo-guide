// Run by scripts/test-mcp-sdk.js through `npx -p <official package>`; nothing here is a dependency of the project.
// usage: node mcp-sdk-client.mjs <v1|v2> <server url> <scenario>
// scenarios: default | no-header-later | modern | modern-no-header
// Prints one JSON object: { ok, error, serverName, tools, annotated, callOk, requests: [{ method, header, status, mcpMethod }] }.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , which, url, scenario] = process.argv;
// npx puts the installed package's bin directory on PATH; the package itself is next to it.
const binDir = process.env.PATH.split(path.delimiter).find((d) => /node_modules[\\/]\.bin$/.test(d) && fs.existsSync(path.join(d, '..', '@modelcontextprotocol')));
if (!binDir) { console.log(JSON.stringify({ ok: false, error: 'the official package was not found on PATH' })); process.exit(0); }
const mods = path.join(binDir, '..', '@modelcontextprotocol');
const load = (rel) => import(pathToFileURL(path.join(mods, rel)).href);

const requests = [];
const wrapFetch = (stripLater) => async (u, init) => {
  const headers = new Headers(init && init.headers);
  let method = '';
  try { method = JSON.parse(init.body).method || ''; } catch (e) { /* GET */ }
  if (stripLater && method && method !== 'initialize') headers.delete('mcp-protocol-version');
  const res = await fetch(u, Object.assign({}, init, { headers }));
  requests.push({ http: init.method, method: method || '-', header: headers.get('mcp-protocol-version') || null, mcpMethod: headers.get('mcp-method') || null, status: res.status });
  return res;
};

const strip = scenario === 'no-header-later' || scenario === 'modern-no-header';
let Client, Transport, clientOptions;
if (which === 'v1') {
  ({ Client } = await load('sdk/dist/esm/client/index.js'));
  ({ StreamableHTTPClientTransport: Transport } = await load('sdk/dist/esm/client/streamableHttp.js'));
} else {
  ({ Client, StreamableHTTPClientTransport: Transport } = await load('client/dist/index.mjs'));
  if (scenario === 'modern' || scenario === 'modern-no-header') clientOptions = { versionNegotiation: { mode: { pin: '2026-07-28' } } };
}

const result = { ok: false, error: null, requests };
try {
  const client = new Client({ name: 'citehound-conformance', version: '1.0.0' }, clientOptions);
  await client.connect(new Transport(new URL(url), { fetch: wrapFetch(strip) }));
  const sv = client.getServerVersion();
  result.serverName = sv && sv.name;
  const list = await client.listTools();
  result.tools = list.tools.length;
  result.annotated = list.tools.filter((t) => t.annotations && t.annotations.readOnlyHint === true && t.annotations.destructiveHint === false && t.title).length;
  const call = await client.callTool({ name: 'list_ai_crawlers', arguments: {} });
  result.callOk = !call.isError && !!(call.content && call.content[0] && /GPTBot/.test(call.content[0].text || ''));
  await client.close();
  result.ok = true;
} catch (e) {
  result.error = String((e && e.message) || e).replace(/https?:\/\/\S+/g, '<url>').slice(0, 300);
}
console.log(JSON.stringify(result));
