'use strict';

// The real program (bin/citehound.js) against a small local server that stands in for Citehound: real fetch, real process, real exit codes.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { fx, KEY } = require('./helpers.js');

const BIN = path.join(__dirname, '..', 'bin', 'citehound.js');
const seen = [];
let server, base;

test.before(async () => {
  server = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, ua: req.headers['user-agent'] });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/mcp') { const tool = JSON.parse(b).params.name; const f = { scan_site: 'mcp-scan', list_ai_crawlers: 'mcp-crawlers' }[tool]; return res.end(f ? fx(f) : '{}'); }
      if (req.url.indexOf('/v1/scan') === 0) {
        if (req.headers.authorization !== 'Bearer ' + KEY) { res.statusCode = 401; return res.end(JSON.stringify({ error: 'invalid_key', message: 'That key is not valid.' })); }
        return res.end(JSON.stringify({ domain: 'example.com', score: 41, pillars: [], failed: [], crawlers: [], crawlerSummary: { open: 0, limited: 0, blocked: 0 }, benchmark: null, note: 'n' }));
      }
      if (req.url.indexOf('/v1/compare') === 0) { res.statusCode = 429; res.setHeader('Retry-After', '17'); return res.end('{}'); }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => server.close());

function cli(args, env) {
  return new Promise((resolve) => {
    const clean = Object.assign({}, process.env); delete clean.CITEHOUND_API_KEY; delete clean.CITEHOUND_API_URL;
    const p = spawn(process.execPath, [BIN].concat(args), { env: Object.assign(clean, { CITEHOUND_API_URL: base }, env || {}) });
    let out = '', err = ''; p.stdout.on('data', (c) => { out += c; }); p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => resolve({ code: code, out: out, err: err }));
  });
}

test('the program prints its version and its help', async () => {
  const v = await cli(['--version']), h = await cli(['--help']);
  assert.equal(v.code, 0); assert.match(v.out, /^\d+\.\d+\.\d+\n$/); assert.equal(h.code, 0); assert.match(h.out, /Usage/);
  assert.equal(require('node:fs').readFileSync(BIN, 'utf8').split('\n')[0], '#!/usr/bin/env node');
});
test('scan without a key through real HTTP: text, then --json, then --fail-under exit code 1', async () => {
  const t = await cli(['scan', 'getcitehound.com']); assert.equal(t.code, 0); assert.match(t.out, /87\/100/);
  const j = await cli(['scan', 'getcitehound.com', '--json']); assert.equal(JSON.parse(j.out).score, 87);
  const f = await cli(['scan', 'getcitehound.com', '--fail-under', '99']); assert.equal(f.code, 1);
  assert.ok(seen.filter((s) => s.url === '/api/mcp').every((s) => s.auth === null && /^citehound-cli\//.test(s.ua)));
});
test('scan with a key sends it as a Bearer token and never prints it; a wrong key is a friendly error', async () => {
  const ok = await cli(['scan', 'example.com'], { CITEHOUND_API_KEY: KEY });
  assert.equal(ok.code, 0); assert.match(ok.out, /41\/100/); assert.ok(!(ok.out + ok.err).includes(KEY)); assert.equal(seen.filter((s) => s.url.indexOf('/v1/scan') === 0).pop().auth, 'Bearer ' + KEY);
  const bad = await cli(['scan', 'example.com'], { CITEHOUND_API_KEY: 'chk_' + 'Z'.repeat(32) });
  assert.equal(bad.code, 3); assert.match(bad.err, /did not accept that API key/); assert.ok(!bad.err.includes('chk_ZZZ'));
});
test('a 429 from the server is explained, with the wait time', async () => {
  const r = await cli(['compare', 'a.com', 'b.com'], { CITEHOUND_API_KEY: KEY });
  assert.equal(r.code, 3); assert.match(r.err, /17 seconds/); assert.doesNotMatch(r.err, /at .*\.js:\d+/);
});
test('a server that is not there is a friendly error, not a stack trace', async () => {
  const r = await cli(['scan', 'example.com'], { CITEHOUND_API_URL: 'http://127.0.0.1:9' });
  assert.equal(r.code, 3); assert.match(r.err, /Could not reach 127\.0\.0\.1:9/); assert.doesNotMatch(r.err, /at .*\.js:\d+|node:internal/);
});
