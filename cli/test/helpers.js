'use strict';

const fs = require('fs');
const path = require('path');
const { run } = require('../src/cli.js');

const fx = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name + '.json'), 'utf8');
const KEY = 'chk_' + 'A1b2C3d4'.repeat(4);

const reply = (status, body, headers) => ({ status: status, ok: status >= 200 && status < 300, headers: { get: (k) => (headers || {})[String(k).toLowerCase()] || null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

// A fake fetch. handler(url, init, bodyJson) returns a reply(...) or throws.
function mockFetch(handler) {
  const calls = [];
  const f = async (url, init) => {
    init = init || {};
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch (e) { /* not JSON */ }
    const call = { url: String(url), method: init.method, headers: init.headers || {}, body: body };
    calls.push(call);
    return handler(call.url, init, body);
  };
  f.calls = calls;
  return f;
}

// Serves the recorded answers of the public MCP endpoint, by tool name.
const mcp = (extra) => (url, init, body) => {
  if (!/\/api\/mcp$/.test(url)) return reply(404, 'not found');
  const tool = body && body.params && body.params.name;
  const map = Object.assign({ scan_site: 'mcp-scan', compare_sites: 'mcp-compare', list_ai_crawlers: 'mcp-crawlers', generate_schema: 'mcp-schema', generate_robots_txt: 'mcp-robots', generate_llms_txt: 'mcp-llms' }, extra || {});
  return map[tool] ? reply(200, fx(map[tool])) : reply(200, { jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'Unknown tool' }] } });
};

async function runCli(args, env, fetchImpl) {
  let out = '', err = '';
  const code = await run(args, env || {}, { out: (s) => { out += s; }, err: (s) => { err += s; } }, fetchImpl);
  return { code: code, out: out, err: err };
}

const mcpError = (text) => reply(200, { jsonrpc: '2.0', id: 1, result: { resultType: 'complete', isError: true, content: [{ type: 'text', text: text }] } });

module.exports = { fx, KEY, reply, mockFetch, mcp, runCli, mcpError };
