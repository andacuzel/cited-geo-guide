#!/usr/bin/env node
/* =====================================================================
   scripts/test-pro-fetch.js

   Tests lib/pro-fetch.js: which addresses count as public, what a person may
   type as a site, and the request itself (redirects checked by hand, body cap,
   timeout, compressed bodies, "the site said no"), against local servers. The
   guard is also exercised for real: localhost and numeric addresses must never
   connect.

     node scripts/test-pro-fetch.js
   ===================================================================== */

'use strict';

const http = require('http');
const zlib = require('zlib');
const dns = require('dns');
const F = require('../lib/pro-fetch.js');

let pass = 0; const fails = [];
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); console.log((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const UA = 'CitehoundBot/test';

(async function main() {
  /* ---- addresses ---- */
  const publicIps = ['93.184.216.34', '8.8.8.8', '1.1.1.1', '151.101.1.69', '2606:4700:4700::1111', '2a00:1450:4001:81b::200e', '::ffff:8.8.8.8'];
  const privateIps = ['127.0.0.1', '127.1.2.3', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '169.254.0.1', '0.0.0.0', '100.64.0.1', '100.127.255.254',
    '192.0.0.1', '192.0.2.5', '198.18.0.1', '198.51.100.7', '203.0.113.9', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:10.1.1.1', '64:ff9b::7f00:1', '2001:db8::1', '2001::1', '2002:7f00:0001::1', 'fec0::1', 'not an ip', ''];
  publicIps.forEach((ip) => t('public: ' + ip, F.isPublicAddress(ip) === true));
  privateIps.forEach((ip) => t('not public: ' + (ip || '(empty)'), F.isPublicAddress(ip) === false));

  /* ---- what a person may type ---- */
  const okInputs = [['example.com', 'example.com'], ['https://www.Example.com/about?x=1', 'example.com'], ['  http://example.co.uk/ ', 'example.co.uk'], ['sub.example.org', 'sub.example.org'], ['EXAMPLE.COM.', 'example.com'], ['bücher.de', 'xn--bcher-kva.de']];
  okInputs.forEach(([raw, want]) => { const r = F.parseSiteInput(raw); t('site input ok: ' + raw, r.ok && r.domain === want, JSON.stringify(r)); });
  const badInputs = ['', '   ', 'localhost', 'http://localhost/', '127.0.0.1', 'http://127.0.0.1/', 'https://[::1]/', 'http://169.254.169.254/latest', '10.0.0.1', 'example', 'foo.local', 'router.lan', 'x.internal', 'https://user:pw@example.com/', 'https://example.com:8443/', 'example.com:80',
    'javascript:alert(1)', 'file:///etc/passwd', 'ftp://example.com', 'data:text/html,hi', 'exa mple.com', 'example.com\nHost: evil.test', 'a'.repeat(400) + '.com', '.com', 'example..com', '-bad.example.com', 'http://0x7f.0.0.1/', 'http://2130706433/'];
  badInputs.forEach((raw) => { const r = F.parseSiteInput(raw); t('site input refused: ' + JSON.stringify(raw).slice(0, 50), r.ok === false, JSON.stringify(r)); });

  /* ---- the real guard: nothing local connects ---- */
  let r = await F.safeGet('http://localhost/', { ua: UA, timeoutMs: 3000 });
  t('safeGet refuses localhost', r.ok === false && r.kind === 'blocked_host', JSON.stringify(r));
  r = await F.safeGet('http://127.0.0.1/', { ua: UA, timeoutMs: 3000 });
  t('safeGet refuses a numeric address', r.ok === false && r.kind === 'blocked_host');
  r = await F.safeGet('http://[::1]/', { ua: UA, timeoutMs: 3000 });
  t('safeGet refuses a numeric IPv6 address', r.ok === false && r.kind === 'blocked_host');
  r = await F.safeGet('https://example.com:8443/', { ua: UA, timeoutMs: 3000 });
  t('safeGet refuses a custom port', r.ok === false && r.kind === 'bad_url');
  r = await F.safeGet('ftp://example.com/', { ua: UA, timeoutMs: 3000 });
  t('safeGet refuses another scheme', r.ok === false && r.kind === 'bad_url');
  r = await F.safeGet('https://user:pw@example.com/', { ua: UA, timeoutMs: 3000 });
  t('safeGet refuses credentials in the address', r.ok === false && r.kind === 'bad_url');
  t('checkHost refuses a numeric host', (await F.checkHost('10.0.0.1')).ok === false);
  t('checkHost refuses localhost', (await F.checkHost('localhost')).ok === false);
  let threw = false; try { await F.safeGet('https://example.com/', {}); } catch (e) { threw = true; }
  t('safeGet needs a user agent', threw);

  /* ---- a hostname that mixes public and private answers, or changes them ---- */
  {
    const real = dns.lookup;
    const answer = (list) => (host, opts, cb) => { if (typeof opts === 'function') { cb = opts; } cb(null, list); };
    const run = (list) => new Promise((resolve) => { dns.lookup = answer(list); F.guardedLookup('rebind.example', { all: true }, (err, a) => { dns.lookup = real; resolve({ err, a }); }); });
    let x = await run([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }]);
    t('a hostname with one private answer among public ones is refused', x.err && x.err.code === 'EBLOCKEDHOST');
    x = await run([{ address: '169.254.169.254', family: 4 }]);
    t('a hostname that resolves to the metadata address is refused', x.err && x.err.code === 'EBLOCKEDHOST');
    x = await run([{ address: '2606:4700:4700::1111', family: 6 }, { address: '1.1.1.1', family: 4 }]);
    t('a hostname with only public answers is allowed, and the checked answers are the ones used', !x.err && x.a.length === 2);
    x = await run([]);
    t('a hostname with no answers is refused', !!x.err);
  }

  /* ---- the request, against local servers ---- */
  const big = 'x'.repeat(200 * 1024);
  const servers = [];
  const server = http.createServer((req, res) => {
    const u = req.url;
    if (u === '/ok') { res.setHeader('Content-Type', 'text/html'); res.end('<html><title>Hello</title></html>'); }
    else if (u === '/ua') { res.end(String(req.headers['user-agent'])); }
    else if (u === '/gzip') { res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Content-Type', 'text/html'); res.end(zlib.gzipSync('<html>zipped</html>')); }
    else if (u === '/br') { res.setHeader('Content-Encoding', 'br'); res.end(zlib.brotliCompressSync('brotli body')); }
    else if (u === '/big') { res.end(big); }
    else if (u === '/bomb') { res.setHeader('Content-Encoding', 'gzip'); res.end(zlib.gzipSync(Buffer.alloc(20 * 1024 * 1024, 'a'))); }
    else if (u === '/slow') { setTimeout(() => res.end('late'), 3000); }
    else if (u === '/redir1') { res.writeHead(302, { Location: '/redir2' }); res.end(); }
    else if (u === '/redir2') { res.writeHead(301, { Location: '/ok' }); res.end(); }
    else if (u === '/loop') { res.writeHead(302, { Location: '/loop' }); res.end(); }
    else if (u === '/away') { res.writeHead(302, { Location: 'http://other.example/x' }); res.end(); }
    else if (u === '/to-file') { res.writeHead(302, { Location: 'file:///etc/passwd' }); res.end(); }
    else if (u === '/to-meta') { res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' }); res.end(); }
    else if (u === '/403') { res.writeHead(403, { Server: 'cloudflare' }); res.end('Forbidden'); }
    else if (u === '/429') { res.writeHead(429, { 'Retry-After': '30' }); res.end('slow down'); }
    else if (u === '/challenge') { res.setHeader('Content-Type', 'text/html'); res.end('<html><head><title>Just a moment...</title></head></html>'); }
    else if (u === '/cfm') { res.setHeader('cf-mitigated', 'challenge'); res.writeHead(200); res.end('x'); }
    else if (u === '/404') { res.writeHead(404); res.end('nope'); }
    else { res.writeHead(500); res.end('boom'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const base = 'http://127.0.0.1:' + server.address().port;
  const get = F.makeSafeGet({ lookup: (h, o, cb) => { if (typeof o === 'function') cb = o; (o && o.all) ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4); }, allowPort: true });

  r = await get(base + '/ok', { ua: UA });
  t('a plain page: ok, status, text, content type', r.ok && r.status === 200 && /Hello/.test(r.text) && /html/.test(r.contentType));
  r = await get(base + '/ua', { ua: 'CitehoundBot/1.1 (+https://example.test)' });
  t('the user agent we pass is the one sent', r.text === 'CitehoundBot/1.1 (+https://example.test)');
  r = await get(base + '/gzip', { ua: UA });
  t('a gzip body is inflated', r.ok && r.text === '<html>zipped</html>');
  r = await get(base + '/br', { ua: UA });
  t('a brotli body is inflated', r.ok && r.text === 'brotli body');
  r = await get(base + '/big', { ua: UA, maxBytes: 50000 });
  t('a large body is cut at the cap and marked truncated', r.ok && r.truncated === true && r.text.length === 50000);
  r = await get(base + '/bomb', { ua: UA, maxBytes: 100000 });
  t('a compressed body that inflates to megabytes is cut at the cap', r.truncated === true && r.text.length === 100000, JSON.stringify({ t: r.truncated, n: r.text && r.text.length, k: r.kind }));
  r = await get(base + '/slow', { ua: UA, timeoutMs: 400 });
  t('a slow site times out', r.ok === false && r.kind === 'timeout');
  r = await get(base + '/redir1', { ua: UA });
  t('two redirects are followed to the page', r.ok && /Hello/.test(r.text) && r.finalUrl === base + '/ok');
  r = await get(base + '/redir1', { ua: UA, maxRedirects: 1 });
  t('the redirect limit holds', r.ok === false && r.kind === 'redirect_loop');
  r = await get(base + '/loop', { ua: UA });
  t('a redirect loop ends', r.ok === false && r.kind === 'redirect_loop');
  r = await get(base + '/away', { ua: UA, allowHost: (h) => h === '127.0.0.1' });
  t('a redirect to another site is refused when the caller says so', r.ok === false && r.kind === 'redirect_away');
  r = await get(base + '/to-file', { ua: UA });
  t('a redirect to a file: address is refused', r.ok === false && r.kind === 'bad_url');
  const guardedGet = F.safeGet;
  r = await guardedGet(base + '/to-meta', { ua: UA });
  t('the production client refuses the local server before any redirect is followed', r.ok === false && r.kind === 'blocked_host' || r.kind === 'bad_url');
  r = await get(base + '/403', { ua: UA });
  t('403 is reported with its status and counted as blocked', r.ok === false && r.status === 403 && F.isBlockedResponse(r));
  r = await get(base + '/429', { ua: UA });
  t('429 is reported with Retry-After and is not "blocked"', r.status === 429 && r.headers['retry-after'] === '30' && F.isBlockedResponse(r) === false);
  r = await get(base + '/challenge', { ua: UA });
  t('a 200 challenge page is recognised as a block', r.ok === true && F.isBlockedResponse(r) === true);
  r = await get(base + '/cfm', { ua: UA });
  t('cf-mitigated: challenge is recognised as a block', F.isBlockedResponse(r) === true);
  r = await get(base + '/ok', { ua: UA });
  t('an ordinary page is not a block', F.isBlockedResponse(r) === false);
  r = await get(base + '/404', { ua: UA });
  t('404 is a plain failure, not a block', r.ok === false && r.status === 404 && F.isBlockedResponse(r) === false);
  r = await get(base + '/nothing-here-500', { ua: UA });
  t('500 is a plain failure', r.ok === false && r.status === 500 && F.isBlockedResponse(r) === false);
  servers.forEach((s) => s.close());

  /* ---- a closed port ---- */
  r = await get('http://127.0.0.1:1/', { ua: UA, timeoutMs: 2000 });
  t('a refused connection is reported as refused', r.ok === false && r.kind === 'refused', r.kind);

  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.error('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
}()).catch((e) => { console.error(e); process.exit(1); });
