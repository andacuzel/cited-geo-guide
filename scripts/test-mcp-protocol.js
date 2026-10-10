#!/usr/bin/env node
/* =====================================================================
   scripts/test-mcp-protocol.js: how api/mcp.js treats the protocol version header, OPTIONS and GET.

   Per the MCP transport specification (2025-11-25): with no MCP-Protocol-Version header and no other way to tell the version, assume
   2025-03-26; an invalid or unsupported version is 400; a server that offers no SSE stream answers GET with 405. The endpoint stays
   read-only and needs no credentials; tools/list still returns every tool, titled, with read-only annotations.

     node scripts/test-mcp-protocol.js
   ===================================================================== */

'use strict';

const handler = require('../api/mcp.js');
let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

function call(method, headers, body) {
  return new Promise((resolve, reject) => {
    const h = {}; let code = 200;
    const res = { setHeader: (k, v) => { h[k.toLowerCase()] = v; }, status(c) { code = c; return res; }, json(b) { resolve({ status: code, headers: h, json: b }); return res; }, end() { resolve({ status: code, headers: h, json: null }); return res; } };
    const lower = {}; Object.keys(headers || {}).forEach((k) => { lower[k.toLowerCase()] = headers[k]; });
    Promise.resolve(handler({ method: method, headers: lower, body: body }, res)).catch(reject);
  });
}
const rpc = (m, params, id) => ({ jsonrpc: '2.0', id: id === undefined ? 1 : id, method: m, params: params });

(async function main() {
  const noHeader = await call('POST', {}, rpc('tools/list'));
  const tools = noHeader.json && noHeader.json.result && noHeader.json.result.tools;
  t('no header, no version in the body: assumed 2025-03-26 and served (200)', noHeader.status === 200 && Array.isArray(tools), noHeader.status + ' ' + JSON.stringify(noHeader.json).slice(0, 120));
  t('... tools/list returns all 13 tools, each titled, read-only and non-destructive', tools.length === 13 && tools.every((x) => x.title && x.annotations && x.annotations.readOnlyHint === true && x.annotations.destructiveHint === false), String(tools && tools.length));
  const call2 = await call('POST', {}, rpc('tools/call', { name: 'get_methodology', arguments: {} }));
  t('... a tool call without the header works too', call2.status === 200 && call2.json.result && !call2.json.error);
  const explicit = await call('POST', { 'MCP-Protocol-Version': '2025-03-26' }, rpc('tools/list'));
  t('an explicit 2025-03-26 is served', explicit.status === 200 && explicit.json.result.tools.length === 13);
  for (const v of ['2025-06-18', '2025-11-25']) t('an explicit ' + v + ' is still served', (await call('POST', { 'MCP-Protocol-Version': v }, rpc('tools/list'))).status === 200);
  const bad = await call('POST', { 'MCP-Protocol-Version': '1999-01-01' }, rpc('tools/list'));
  t('an unsupported version is 400 with -32022 and the list of supported ones', bad.status === 400 && bad.json.error.code === -32022 && bad.json.error.data.supported.indexOf('2025-03-26') !== -1);
  const junk = await call('POST', { 'MCP-Protocol-Version': 'not a version' }, rpc('tools/list'));
  t('an invalid version string is 400', junk.status === 400);
  const metaOnly = await call('POST', {}, rpc('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } }));
  t('no header but a version declared in the body is a header mismatch (400, -32020)', metaOnly.status === 400 && metaOnly.json.error.code === -32020, JSON.stringify(metaOnly.json));
  const modern = await call('POST', { 'MCP-Protocol-Version': '2026-07-28' }, rpc('tools/list'));
  t('a 2026-07-28 request is still validated strictly (missing Mcp-Method and _meta is 400)', modern.status === 400);
  const init = await call('POST', {}, rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } }));
  t('initialize with 2025-03-26 negotiates 2025-03-26', init.status === 200 && init.json.result.protocolVersion === '2025-03-26', JSON.stringify(init.json && init.json.result && init.json.result.protocolVersion));
  const note = await call('POST', {}, { jsonrpc: '2.0', method: 'notifications/initialized' });
  t('a notification is 202 with no body', note.status === 202);
  const opt = await call('OPTIONS', { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST' });
  t('OPTIONS answers the preflight: 204, allowed methods and headers (including MCP-Protocol-Version), any origin', opt.status === 204 && opt.headers['access-control-allow-origin'] === '*' && /POST/.test(opt.headers['access-control-allow-methods']) && /MCP-Protocol-Version/i.test(opt.headers['access-control-allow-headers']) && /OPTIONS/.test(opt.headers.allow));
  const get = await call('GET', { Accept: 'text/event-stream' });
  t('GET answers 405 with Allow (no SSE stream is offered)', get.status === 405 && /POST/.test(get.headers.allow));
  const del = await call('DELETE', {});
  t('DELETE answers 405', del.status === 405);
  t('every POST response carries Access-Control-Allow-Origin and no-store', noHeader.headers['access-control-allow-origin'] === '*' && noHeader.headers['cache-control'] === 'no-store');
  const noAuth = await call('POST', {}, rpc('tools/list'));
  t('no credentials are asked for and no cookie is set', noAuth.status === 200 && !noAuth.headers['set-cookie'] && !noAuth.headers['www-authenticate']);
  // Batches belong to revision 2025-03-26 (its Transports page: the POST body may be an array of requests and/or notifications).
  const batch = await call('POST', {}, [rpc('tools/list', undefined, 1), rpc('ping', undefined, 2), { jsonrpc: '2.0', method: 'notifications/initialized' }]);
  t('a batch with no version header (read as 2025-03-26) is served: one answer per request, none for the notification', batch.status === 200 && Array.isArray(batch.json) && batch.json.length === 2 && batch.json[0].id === 1 && batch.json[0].result.tools.length === 13 && batch.json[1].id === 2, JSON.stringify(batch.json).slice(0, 160));
  const batch2 = await call('POST', { 'MCP-Protocol-Version': '2025-03-26' }, [rpc('tools/list', undefined, 7)]);
  t('a batch under an explicit 2025-03-26 is served', batch2.status === 200 && batch2.json[0].id === 7);
  const onlyNotes = await call('POST', {}, [{ jsonrpc: '2.0', method: 'notifications/initialized' }]);
  t('a batch of notifications only is 202 with no body', onlyNotes.status === 202 && onlyNotes.json === null);
  const newer = await call('POST', { 'MCP-Protocol-Version': '2025-06-18' }, [rpc('tools/list')]);
  t('a batch under 2025-06-18 or later is refused (400): those revisions allow one message per POST', newer.status === 400 && newer.json.error.code === -32600);
  t('an empty batch is 400', (await call('POST', {}, [])).status === 400);
  t('a batch over the limit is 400', (await call('POST', {}, Array.from({ length: 21 }, (_, i) => rpc('ping', undefined, i)))).status === 400);
  const mixed = await call('POST', {}, [rpc('tools/list', undefined, 1), 5, rpc('nope', undefined, 3)]);
  t('a bad element gets its own error entry and does not stop the others', mixed.status === 200 && mixed.json.length === 3 && mixed.json[1].error.code === -32600 && mixed.json[2].error.code === -32601);

  out('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
}()).catch((e) => { process.stderr.write('The test stopped: ' + (e && e.stack) + '\n'); process.exit(1); });
