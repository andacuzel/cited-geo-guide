#!/usr/bin/env node
/* =====================================================================
   scripts/test-scan-ssrf.js

   Every public path that fetches a domain someone typed (the free scan, the llms.txt checker,
   site-info, the crawl, and the MCP tools scan_site, compare_sites and generate_schema) must go through
   lib/safe-fetch.js and never connect to a non-public address. The tests run with no network: the
   resolver is replaced, and every socket connection is recorded.

     - hostnames that resolve to loopback, private, link-local (the metadata address), carrier-grade NAT,
       IPv6 loopback and unique-local, IPv4-mapped IPv6 and a mix of public and private answers
     - DNS rebinding: a name whose second answer is private is looked up once per hop, so the connection can
       only go to the address that was checked
     - a redirect from an allowed address to an internal one
     - the MCP per-domain limit (6 an hour) still applies, and still comes before any fetch
     - an audit of every outbound request in api/ and lib/, so a new direct fetch fails this test

     node scripts/test-scan-ssrf.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const dns = require('dns');
const net = require('net');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; const fails = [];
const out = (s) => process.stdout.write(s + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

// Keep the scanner's own error logging out of the test output.
const realErr = console.error; console.error = () => {};

/* ---- a fake resolver and a socket recorder ---- */
const answers = {};            // hostname -> array of addresses, or a function (call number) -> array
const lookups = {};            // hostname -> number of lookups
const realLookup = dns.lookup;
dns.lookup = function (host, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  if (Object.prototype.hasOwnProperty.call(answers, host)) {
    lookups[host] = (lookups[host] || 0) + 1;
    const a = typeof answers[host] === 'function' ? answers[host](lookups[host]) : answers[host];
    const list = a.map((x) => ({ address: x, family: x.indexOf(':') !== -1 ? 6 : 4 }));
    return process.nextTick(() => (opts && opts.all ? cb(null, list) : cb(null, list[0].address, list[0].family)));
  }
  return realLookup.call(dns, host, opts, cb);
};
// A connection attempt is recorded when the socket's lookup succeeds (that address is where it will connect), or when it is
// given a numeric address directly. A lookup that fails, as the guard's does for a non-public answer, records nothing.
const connects = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function () {
  const a = arguments[0] && typeof arguments[0] === 'object' ? arguments[0] : {};
  if (a.host && net.isIP(a.host)) connects.push(a.host + ':' + a.port);
  else this.once('lookup', (err, addr) => { if (!err) connects.push(addr + ':' + a.port); });
  return realConnect.apply(this, arguments);
};
const privateConnects = () => connects.filter((c) => /^(127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1|fc|fd|::ffff:|0\.0\.0\.0)/i.test(c));

const scanner = require('../lib/scanner.js');
const safe = require('../lib/safe-fetch.js');
const mcp = require('../api/mcp.js');
const mcpLimits = require('../lib/mcp-limits.js');

function call(handler, req) {
  return new Promise((resolve, reject) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); }, end() { resolve({ status: this.statusCode, body: null }); } };
    Promise.resolve(handler(Object.assign({ method: 'GET', headers: { 'x-forwarded-for': '203.0.113.5' }, query: {}, url: '/' }, req), res)).catch(reject);
  });
}

(async function main() {
  /* ---- hostile resolutions, through the scanner's own fetch ---- */
  const hostile = {
    'loopback.test': ['127.0.0.1'], 'private10.test': ['10.1.2.3'], 'private172.test': ['172.20.0.9'], 'private192.test': ['192.168.0.10'],
    'metadata.test': ['169.254.169.254'], 'cgnat.test': ['100.64.0.7'], 'zero.test': ['0.0.0.0'],
    'v6loop.test': ['::1'], 'v6ula.test': ['fd00::1'], 'v6linklocal.test': ['fe80::1'], 'v6mapped.test': ['::ffff:127.0.0.1'], 'v6mappedmeta.test': ['::ffff:169.254.169.254'],
    'mixed.test': ['93.184.216.34', '10.0.0.5'], 'empty.test': []
  };
  Object.assign(answers, hostile);
  for (const host of Object.keys(hostile)) {
    for (const url of ['https://' + host + '/robots.txt', 'http://' + host + '/']) {
      const before = connects.length;
      const r = await scanner.fetchText(url, 3000, 'probe');
      t('fetchText refuses ' + url + ' and never connects', r.ok === false && connects.length === before && (r.kind === 'blocked' || r.kind === 'dns'), JSON.stringify(r) + ' connects ' + connects.slice(before).join());
    }
  }
  t('no socket was opened to a non-public address in all of the above', privateConnects().length === 0, privateConnects().join());

  // Names a person could type that point inward by DNS alone (these pass the domain format check).
  t('the format check lets hostnames like 127.0.0.1.nip.io through, so the fetch has to be the guard', !!scanner.normalizeDomain('127.0.0.1.nip.io') && !!scanner.normalizeDomain('localtest.me') && !!scanner.normalizeDomain('169.254.169.254.nip.io'));
  ['127.0.0.1', '[::1]', 'localhost', '2130706433', '0x7f.0.0.1', '10.0.0.1', '169.254.169.254', 'http://127.0.0.1/', 'user@127.0.0.1'].forEach((d) => t('normalizeDomain refuses ' + d, scanner.normalizeDomain(d) === null));

  /* ---- the whole scan, the page fetch, site info and the llms.txt checker ---- */
  answers['evil.test'] = ['169.254.169.254'];
  let before = connects.length;
  const scan = await scanner.scanPage('https://evil.test/', { commerce: true });
  t('scanPage on a name that resolves to the metadata address fails cleanly and connects to nothing', scan.ok === false && connects.length === before, JSON.stringify(scan).slice(0, 160));
  const info = await scanner.fetchSiteInfo('evil.test');
  t('fetchSiteInfo (generate_schema, /api/site-info) is refused', info.ok === false && connects.length === before);
  const ctx = await scanner.computeSiteContext('https://evil.test', { userAgent: scanner.CRAWLER_UA });
  t('computeSiteContext (the crawl) is refused', ctx.ok === false && connects.length === before);

  for (const [name, mod, req] of [
    ['/api/scan', '../api/scan.js', { query: { domain: 'evil.test' } }],
    ['/api/site-info', '../api/site-info.js', { query: { domain: 'evil.test' } }],
    ['/api/llms-check', '../api/llms-check.js', { query: { domain: 'evil.test' } }],
    ['/api/crawl-start', '../api/crawl-start.js', { query: { domain: 'evil.test' } }]
  ]) {
    const b4 = connects.length;
    let r; try { r = await call(require(mod), req); } catch (e) { r = { status: 'threw ' + e.message }; }
    t(name + ' with a name that resolves to the metadata address answers with an error and connects to nothing', connects.length === b4 && r.status >= 400, name + ' ' + r.status);
  }

  /* ---- the MCP tools ---- */
  mcpLimits._setKv(async () => null); // the limiter fails open without KV; the calls below are about the fetch
  for (const [tool, args] of [['scan_site', { domain: 'evil.test' }], ['generate_schema', { domain: 'evil.test', type: 'organization' }], ['compare_sites', { domain_a: 'evil.test', domain_b: 'loopback.test' }]]) {
    const b4 = connects.length;
    const r = await mcp.HANDLERS[tool](args, {});
    t('MCP ' + tool + ' on hostile names returns an error and connects to nothing', r.isError === true && connects.length === b4, r.text && r.text.slice(0, 120));
  }
  const cmp = await mcp.HANDLERS.compare_sites({ domain_a: 'evil.test', domain_b: 'v6loop.test' }, {});
  t('MCP compare_sites says neither site could be scanned', /Neither site could be scanned/.test(cmp.text));
  t('MCP tools never reveal an internal address in their messages', !/169\.254|127\.0\.0\.1|10\.0\.0\.5/.test(cmp.text), cmp.text);
  const bad = await mcp.HANDLERS.scan_site({ domain: '169.254.169.254' }, {});
  t('MCP scan_site refuses a numeric address before any limit or fetch', bad.isError === true && /Invalid/.test(bad.text));

  /* ---- the per-domain limit: 6 an hour, checked before any fetch ---- */
  {
    const store = {};
    mcpLimits._setKv(async (cmds) => cmds.map((c) => { const k = c[1]; if (c[0] === 'INCR') { store[k] = (store[k] || 0) + 1; return { result: store[k] }; } if (c[0] === 'TTL') return { result: 3000 }; return { result: 1 }; }));
    t('the per-domain limit is still 6 an hour', mcpLimits.DOMAIN_PER_HOUR === 6);
    const b4 = connects.length;
    const results = [];
    for (let i = 0; i < 8; i++) results.push(await mcp.HANDLERS.scan_site({ domain: 'limited-domain.test' }, {}));
    const limited = results.filter((r) => /limit|too many|try again/i.test(r.text) && !/Could not read/.test(r.text));
    t('the 7th and 8th live fetches of one domain in an hour are refused by the limit, not by the fetch', limited.length === 2 && results.slice(0, 6).every((r) => /Could not read|was not/.test(r.text)), results.map((r) => r.text.slice(0, 40)).join(' | '));
    t('the other tools share the same per-domain counter', (await mcp.HANDLERS.generate_schema({ domain: 'limited-domain.test', type: 'organization' }, {})).isError === true);
    void b4;
    mcpLimits._setKv(null);
  }

  /* ---- DNS rebinding: one lookup per hop, and the connection goes where the lookup said ---- */
  {
    answers['rebind.test'] = (n) => (n === 1 ? ['10.9.9.9'] : ['93.184.216.34']);
    lookups['rebind.test'] = 0;
    const b4 = connects.length;
    const r = await safe.safeGet('https://rebind.test/', { ua: 'x', timeoutMs: 500 });
    t('a name whose first answer is private is refused on that answer', r.ok === false && r.kind === 'blocked_host' && connects.length === b4);
    t('... and it was resolved exactly once for the request (a later, different answer cannot be used)', lookups['rebind.test'] === 1, String(lookups['rebind.test']));

    answers['rebind2.test'] = (n) => (n === 1 ? ['93.184.216.34'] : ['10.9.9.9']);
    lookups['rebind2.test'] = 0;
    const c0 = connects.length;
    await safe.safeGet('https://rebind2.test/', { ua: 'x', timeoutMs: 500 });
    const mine = connects.slice(c0);
    t('a name that is public on the first lookup is connected to at that address, from one lookup', lookups['rebind2.test'] === 1 && mine.length >= 1 && mine.every((c) => c.indexOf('93.184.216.34') === 0), lookups['rebind2.test'] + ' ' + mine.join());
  }

  /* ---- a redirect from an allowed address to an internal one ---- */
  {
    const hits = [];
    const server = http.createServer((req, res) => {
      hits.push(req.url);
      const dest = { '/to-meta': 'http://169.254.169.254/latest/meta-data/', '/to-private-name': 'http://internal.test/', '/to-loopback': 'http://127.0.0.1/', '/to-v6': 'http://[::1]/', '/to-decimal': 'http://2130706433/', '/to-localhost': 'http://localhost/' }[req.url];
      if (dest) { res.writeHead(302, { Location: dest }); res.end(); } else res.end('fine');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    answers['internal.test'] = ['10.0.0.5'];
    // The first hop is allowed for this test only (it stands for a public site); every later hop uses the real guard.
    const first = (host, opts, cb) => { if (typeof opts === 'function') { cb = opts; opts = {}; } if (host === 'first.test') { const l = [{ address: '127.0.0.1', family: 4 }]; return opts && opts.all ? cb(null, l) : cb(null, l[0].address, 4); } return safe.guardedLookup(host, opts, cb); };
    // The test server has a port, which the real client refuses: the test getter allows a port, nothing else.
    const getter = safe.makeSafeGet({ lookup: first, allowPort: true });
    for (const p of ['/to-meta', '/to-private-name', '/to-loopback', '/to-v6', '/to-decimal', '/to-localhost']) {
      const before = connects.length;
      const r = await getter('http://first.test:' + port + p, { ua: 'x', timeoutMs: 2000 });
      const made = connects.slice(before);
      t('a redirect to an internal address (' + p.slice(4) + ') is not followed: the only connection is the first hop', r.ok === false && /blocked_host|dns|bad_url/.test(r.kind) && made.length === 1, JSON.stringify({ k: r.kind, e: r.error }) + ' ' + made.join());
    }
    t('the redirecting server saw one request per hop that left it, and none came back', hits.length === 6 && hits.every((h) => h.indexOf('/to-') === 0), hits.join());
    server.close();
  }

  /* ---- audit: no direct outbound request outside the guard ---- */
  {
    // Every .js under api/ and lib/, tracked or not (a new file is audited before it is committed).
    const files = [];
    (function walk(rel) { fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }).forEach((e) => { const r = rel + '/' + e.name; if (e.isDirectory()) walk(r); else if (/\.js$/.test(e.name)) files.push(r); }); }('api'));
    (function walk(rel) { fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }).forEach((e) => { const r = rel + '/' + e.name; if (e.isDirectory()) walk(r); else if (/\.js$/.test(e.name)) files.push(r); }); }('lib'));
    const ALLOWED = {
      'api/_kv.js': 'the key-value store, a fixed address from the environment',
      'api/subscribe.js': 'the email-list webhook, a fixed address from the environment',
      'lib/citation/providers/anthropic.js': 'a model provider, a fixed address',
      'lib/citation/providers/gemini.js': 'a model provider, a fixed address',
      'lib/citation/providers/openai.js': 'a model provider, a fixed address',
      'lib/citation/providers/perplexity.js': 'a model provider, a fixed address',
      'lib/summary-gemini.js': 'a model provider, a fixed address',
      'lib/pro-mail.js': 'the mail provider, a fixed address',
      'lib/safe-fetch.js': 'the guard itself',
      'lib/report-pro-ui.js': 'browser code, same origin',
      'middleware.js': 'edge middleware, a fixed address'
    };
    const offenders = [];
    files.concat(['middleware.js']).forEach((f) => {
      if (!fs.existsSync(path.join(ROOT, f))) return;
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
      if (/\bfetch\(|https?\.request\(|https?\.get\(|net\.connect\(|net\.createConnection\(|tls\.connect\(|require\(['"](node-fetch|axios|got|undici)['"]\)/.test(src) && !ALLOWED[f]) offenders.push(f);
    });
    t('no file in api/ or lib/ makes a request of its own except the listed ones (fixed addresses)', offenders.length === 0, offenders.join(', '));
    const sc = fs.readFileSync(path.join(ROOT, 'lib', 'scanner.js'), 'utf8');
    t('lib/scanner.js fetches only through safe-fetch', /require\('\.\/safe-fetch\.js'\)/.test(sc) && !/\bfetch\(url/.test(sc.replace(/safeFetch\.safeGet\(/g, '')));
    const stale = Object.keys(ALLOWED).filter((f) => !fs.existsSync(path.join(ROOT, f)));
    t('the list of allowed files has no entry for a file that is gone', stale.length === 0, stale.join(', '));
    // The one allowed file that takes a user-supplied address: none. State it so a change is noticed.
    t('the mail provider address is a literal, not built from a request', /doFetch\('https:\/\/api\.resend\.com\/emails'/.test(fs.readFileSync(path.join(ROOT, 'lib', 'pro-mail.js'), 'utf8')));
  }

  dns.lookup = realLookup; net.Socket.prototype.connect = realConnect; console.error = realErr;
  out('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
  process.exit(0);
}()).catch((e) => { console.error = realErr; process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
