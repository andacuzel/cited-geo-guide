#!/usr/bin/env node
/* =====================================================================
   scripts/test-mcp-sdk.js: the MCP endpoint against the OFFICIAL TypeScript SDK clients.

   Starts api/mcp.js on a local port and runs a client from each official package through `npx -p <package>`
   (nothing is added to package.json): the v1 line (@modelcontextprotocol/sdk, 2025 revisions) and the v2 line
   (@modelcontextprotocol/client, the 2026-07-28 revision, which also still speaks the older handshake).
   Each client connects, lists the tools and calls one. Scenarios:

     v1 default           initialize without the version header, later requests with it
     v1 no-header-later   the header is removed from every request after initialize (read as 2025-03-26)
     v2 default           the handshake era
     v2 no-header-later   same, header removed after initialize
     v2 modern            2026-07-28 pinned: server/discover, then per-request metadata and headers
     v2 modern-no-header  the version header removed from a modern request: the server must refuse it (400, -32020)

   It needs network access to the npm registry the first time (npx caches the packages). The package versions are pinned.
     node scripts/test-mcp-sdk.js
   ===================================================================== */

'use strict';

const http = require('http');
const path = require('path');
const cp = require('child_process');
const handler = require('../api/mcp.js');

const PKG = { v1: '@modelcontextprotocol/sdk@1.32.1', v2: '@modelcontextprotocol/client@2.3.1' };
let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body; try { body = raw ? JSON.parse(raw) : undefined; } catch (e) { body = raw; }
        req.body = body;
        res.status = (c) => { res.statusCode = c; return res; };
        res.json = (o) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); return res; };
        Promise.resolve(handler(req, res)).catch(() => { res.statusCode = 500; res.end(); });
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// Asynchronous on purpose: the server under test runs in this process, so a blocking spawn would starve it.
function run(which, url, scenario) {
  return new Promise((resolve) => {
    cp.execFile('npx', ['-y', '-p', PKG[which], '--', 'node', path.join(__dirname, 'fixtures', 'mcp-sdk-client.mjs'), which, url, scenario], { encoding: 'utf8', timeout: 180000 }, (err, stdout, stderr) => {
      const line = String(stdout || '').trim().split('\n').filter((l) => l[0] === '{').pop();
      try { resolve(JSON.parse(line)); } catch (e) { resolve({ ok: false, error: 'no result: ' + String(stderr || '').slice(-200) }); }
    });
  });
}

(async function main() {
  const srv = await serve();
  const url = 'http://127.0.0.1:' + srv.address().port + '/api/mcp';
  const laterHdr = (x) => x.requests.filter((q) => q.method !== 'initialize' && q.method !== 'server/discover' && q.http === 'POST');
  try {
    for (const which of ['v1', 'v2']) {
      const d = await run(which, url, 'default');
      t(which + ' default: connect, tools/list (13, all titled and read-only) and a tool call all work', d.ok && d.tools === 13 && d.annotated === 13 && d.callOk && d.serverName === 'citehound', JSON.stringify(d).slice(0, 300));
      const init = d.requests && d.requests.find((q) => q.method === 'initialize');
      t(which + ' default: the initialize request carries no version header and is accepted (200)', !!init && init.header === null && init.status === 200, JSON.stringify(init));
      t(which + ' default: every later request carries the negotiated version header and gets 200/202', d.requests && laterHdr(d).length >= 2 && laterHdr(d).every((q) => q.header && q.status < 300), JSON.stringify(d.requests && laterHdr(d)));
      const n = await run(which, url, 'no-header-later');
      t(which + ' without the header on later requests: still served (read as 2025-03-26)', n.ok && n.tools === 13 && n.callOk && laterHdr(n).every((q) => q.header === null && q.status < 300), JSON.stringify(n).slice(0, 300));
    }
    const m = await run('v2', url, 'modern');
    t('v2 modern (2026-07-28 pinned): server/discover, tools/list and a tool call work with header, Mcp-Method and _meta', m.ok && m.tools === 13 && m.callOk && m.requests.every((q) => q.header === '2026-07-28' && q.mcpMethod === q.method && q.status === 200), JSON.stringify(m).slice(0, 400));
    const mn = await run('v2', url, 'modern-no-header');
    t('v2 modern with the version header removed is refused (the spec requires the header on every 2026-07-28 request)', mn.ok === false && mn.requests.length >= 1 && mn.requests.every((q) => q.header === null && q.status === 400), JSON.stringify(mn).slice(0, 300));
  } finally { srv.close(); }
  out('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
}()).catch((e) => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
