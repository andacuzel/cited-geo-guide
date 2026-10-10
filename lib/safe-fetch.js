/* =====================================================================
   lib/safe-fetch.js: the only way Citehound fetches a site it was told about by a stranger.

   The free scanner, the MCP tools (scan_site, compare_sites, generate_schema), the llms.txt checker, the
   site-info endpoint, the full-site crawl and Citehound Pro are all handed a domain by someone else and fetch
   it from our servers. lib/scanner.js fetchText goes through safeGet below, so they share one guard and there
   is no second copy. Every request follows three rules:

     1. Public addresses only. The hostname is resolved inside the socket's own
        lookup, every answer must be a public unicast address (no loopback,
        private, link-local, carrier-grade NAT, documentation, multicast or
        metadata ranges, IPv4 or IPv6), and the connection is made to exactly
        the address that was checked. A hostname that resolves to a private
        address, or that changes its answer between two lookups, never connects.
     2. Redirects are followed by hand, at most 4, each one checked again
        (scheme http or https, default port, no credentials, no IP literal) and
        each one allowed only if the caller's allowHost() says so (Pro stays on the site; the free scanner
        may follow a redirect to another public site, never to a non-public one).
     3. Bounded. A timeout per request, a cap on the body that is read, and
        compressed bodies are inflated under that same cap.

   The error "kind" is one of: blocked_host, dns, timeout, refused, tls, network,
   redirect_loop, redirect_away, bad_url.
   ===================================================================== */

'use strict';

const https = require('https');
const http = require('http');
const dns = require('dns');
const net = require('net');
const zlib = require('zlib');

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_BYTES = 1536 * 1024;
const MAX_REDIRECTS = 4;

/* ---------------- address classification ---------------- */

function v4Parts(ip) { return ip.split('.').map(function (n) { return parseInt(n, 10); }); }

function isPublicV4(ip) {
  const p = v4Parts(ip);
  if (p.length !== 4 || p.some(function (n) { return !(n >= 0 && n <= 255); })) return false;
  const a = p[0], b = p[1], c = p[2];
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;       // carrier-grade NAT
  if (a === 169 && b === 254) return false;                 // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) return false;        // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return false;        // documentation
  if (a === 192 && b === 88 && c === 99) return false;      // 6to4 relay
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;    // benchmarking
  if (a === 198 && b === 51 && c === 100) return false;     // documentation
  if (a === 203 && b === 0 && c === 113) return false;      // documentation
  if (a >= 224) return false;                               // multicast, reserved, broadcast
  return true;
}

// Sixteen bytes from an IPv6 text form (handles "::" and a trailing dotted IPv4).
function v6Bytes(ip) {
  let s = ip.toLowerCase().split('%')[0];
  let tail = [];
  const m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m) { const q = v4Parts(m[2]); s = m[1] + ((q[0] << 8) | q[1]).toString(16) + ':' + ((q[2] << 8) | q[3]).toString(16); }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups;
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = head.concat(new Array(fill).fill('0'), tail);
  } else groups = head;
  if (groups.length !== 8) return null;
  const out = [];
  for (let i = 0; i < 8; i++) {
    if (!/^[0-9a-f]{1,4}$/.test(groups[i])) return null;
    const v = parseInt(groups[i], 16);
    out.push(v >> 8, v & 255);
  }
  return out;
}

function isPublicV6(ip) {
  const b = v6Bytes(ip);
  if (!b) return false;
  const allZero = function (from, to) { for (let i = from; i < to; i++) if (b[i] !== 0) return false; return true; };
  const embedded = function (at) { return isPublicV4(b[at] + '.' + b[at + 1] + '.' + b[at + 2] + '.' + b[at + 3]); };
  if (allZero(0, 10) && b[10] === 255 && b[11] === 255) return embedded(12);   // ::ffff:a.b.c.d (IPv4-mapped)
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && allZero(4, 12)) return embedded(12); // 64:ff9b::/96 (NAT64)
  if (b[0] === 0x20 && b[1] === 0x02) return embedded(2);                        // 2002::/16 (6to4)
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return false; // 2001::/32 Teredo
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return false; // 2001:db8::/32 documentation
  return (b[0] & 0xe0) === 0x20;                                                  // global unicast 2000::/3 only
}

function isPublicAddress(address) {
  const f = net.isIP(address);
  if (f === 4) return isPublicV4(address);
  if (f === 6) return isPublicV6(address);
  return false;
}

/* ---------------- the guarded lookup ---------------- */

function guardedLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  dns.lookup(hostname, { all: true, verbatim: true }, function (err, addrs) {
    if (err) return cb(err);
    const bad = (addrs || []).filter(function (a) { return !isPublicAddress(a.address); });
    if (!addrs || !addrs.length || bad.length) {
      const e = new Error('Refusing to connect: ' + hostname + ' does not resolve only to public addresses.');
      e.code = 'EBLOCKEDHOST';
      return cb(e);
    }
    if (options && options.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

// For form validation: would a connection to this hostname be allowed right now?
function checkHost(hostname) {
  return new Promise(function (resolve) {
    if (net.isIP(hostname)) return resolve({ ok: false, kind: 'blocked_host' });
    guardedLookup(hostname, { all: true }, function (err) {
      if (!err) return resolve({ ok: true });
      resolve({ ok: false, kind: err.code === 'EBLOCKEDHOST' ? 'blocked_host' : 'dns' });
    });
  });
}

/* ---------------- what a person may type ---------------- */

const BAD_SUFFIX = /\.(local|localhost|internal|intranet|lan|home|corp|private|test|invalid|example|onion)$/;

// "example.com", "https://www.example.com/about" and "Example.COM/" all give example.com.
function parseSiteInput(raw) {
  let s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { ok: false, reason: 'empty' };
  if (s.length > 300 || /[\s\u0000-\u001f]/.test(s)) return { ok: false, reason: 'invalid' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s)) return { ok: false, reason: 'invalid' };
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (e) { return { ok: false, reason: 'invalid' }; }
  if (u.username || u.password || u.port) return { ok: false, reason: 'invalid' };
  let host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (!host || net.isIP(host) || host.charAt(0) === '[') return { ok: false, reason: 'invalid' };
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host) || host.length > 253) return { ok: false, reason: 'invalid' };
  if (!/^[a-z][a-z0-9-]+$/.test(host.split('.').pop()) || host.split('.').pop().length < 2) return { ok: false, reason: 'invalid' };
  if (host === 'localhost' || BAD_SUFFIX.test(host)) return { ok: false, reason: 'invalid' };
  return { ok: true, domain: host };
}

/* ---------------- one request ---------------- */

function sameSite(domain) {
  const d = String(domain).replace(/^www\./, '');
  return function (hostname) { return String(hostname).toLowerCase().replace(/^www\./, '') === d; };
}

function classifyError(err) {
  if (!err) return 'network';
  if (err.code === 'EBLOCKEDHOST') return 'blocked_host';
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN' || err.code === 'ENODATA') return 'dns';
  if (err.code === 'ECONNREFUSED') return 'refused';
  if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT' || err.name === 'TimeoutError') return 'timeout';
  if (/^(CERT_|ERR_TLS|DEPTH_ZERO|UNABLE_TO_VERIFY|SELF_SIGNED|EPROTO|ERR_SSL)/.test(err.code || '') || /certificate|tls|ssl/i.test(err.message || '')) return 'tls';
  return 'network';
}

function once(u, o, lookup) {
  return new Promise(function (resolve) {
    const lib = u.protocol === 'http:' ? http : https;
    let settled = false;
    const finish = function (r) { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
    const headers = Object.assign({
      'User-Agent': o.ua,
      'Accept': o.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br'
    }, o.headers || {});
    const req = lib.request({
      protocol: u.protocol, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method: 'GET',
      headers: headers, lookup: lookup, agent: false
    }, function (res) {
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      let stream = res;
      if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      const chunks = []; let total = 0; let truncated = false;
      const done = function () {
        const hdrs = {};
        Object.keys(res.headers).forEach(function (k) { hdrs[k.toLowerCase()] = Array.isArray(res.headers[k]) ? res.headers[k].join(', ') : String(res.headers[k]); });
        finish({ status: res.statusCode, headers: hdrs, body: Buffer.concat(chunks).toString('utf8'), bytes: total, truncated: truncated });
      };
      stream.on('data', function (c) {
        if (truncated) return;
        total += c.length;
        if (total > o.maxBytes) { chunks.push(c.subarray(0, c.length - (total - o.maxBytes))); total = o.maxBytes; truncated = true; req.destroy(); done(); return; }
        chunks.push(c);
      });
      stream.on('end', done);
      stream.on('error', function () { if (!truncated) finish({ error: { kind: 'network', message: 'The response could not be read.' } }); });
    });
    const timer = setTimeout(function () { req.destroy(); finish({ error: { kind: 'timeout', message: 'The site did not answer in time.' } }); }, o.timeoutMs);
    req.on('error', function (err) { finish({ error: { kind: classifyError(err), message: err.message } }); });
    req.end();
  });
}

// The factory exists so the tests can aim the same code at a local server (a test lookup that maps a made-up name
// to 127.0.0.1, and a port); production uses safeGet below, bound to guardedLookup and the default port rule.
// A numeric address is refused whatever the factory is given.
// opts: { ua (required), timeoutMs, maxBytes, maxRedirects, allowHost(hostname) -> bool, accept, headers }
function makeSafeGet(env) {
  const lookup = env.lookup;
  const allowPort = !!env.allowPort;
  return async function safeGet(url, opts) {
    opts = opts || {};
    if (!opts.ua) throw new Error('safeGet needs a user agent');
    const o = { ua: opts.ua, timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT_MS, maxBytes: opts.maxBytes || DEFAULT_MAX_BYTES, accept: opts.accept, headers: opts.headers };
    const limit = opts.maxRedirects === undefined ? MAX_REDIRECTS : opts.maxRedirects;
    let current = url;
    for (let hop = 0; hop <= limit; hop++) {
      let u;
      try { u = new URL(current); } catch (e) { return { ok: false, kind: 'bad_url', error: 'Not a valid address.' }; }
      if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || (u.port && !allowPort)) return { ok: false, kind: 'bad_url', error: 'Only plain http and https addresses on the default port are fetched.' };
      if (net.isIP(u.hostname) || u.hostname.charAt(0) === '[') return { ok: false, kind: 'blocked_host', error: 'Addresses given as numbers are not fetched.' };
      if (opts.allowHost && !opts.allowHost(u.hostname)) return { ok: false, kind: 'redirect_away', error: 'The address leads to another site.', finalUrl: current };
      const r = await once(u, o, lookup);
      if (r.error) return { ok: false, kind: r.error.kind, error: r.error.message, finalUrl: current };
      if ([301, 302, 303, 307, 308].indexOf(r.status) !== -1 && r.headers.location) {
        try { current = new URL(r.headers.location, current).toString(); } catch (e) { return { ok: false, kind: 'bad_url', error: 'The site sent an invalid redirect.', finalUrl: current }; }
        if (hop === limit) return { ok: false, kind: 'redirect_loop', error: 'Too many redirects.', finalUrl: current };
        continue;
      }
      const ct = r.headers['content-type'] || '';
      return { ok: r.status >= 200 && r.status < 300, status: r.status, text: r.body, contentType: ct, headers: r.headers, finalUrl: current, truncated: r.truncated, bytes: r.bytes };
    }
    return { ok: false, kind: 'redirect_loop', error: 'Too many redirects.', finalUrl: current };
  };
}

const safeGet = makeSafeGet({ lookup: guardedLookup, allowPort: false });

/* ---------------- "the site said no" ---------------- */

const BLOCK_STATUSES = [401, 403, 406, 451];
const CHALLENGE_TITLE = /<title[^>]*>\s*(just a moment\.\.\.|attention required!? \|? ?cloudflare|access denied|request blocked|pardon our interruption|are you a robot|checking your browser|security check|verify you are human|please verify)/i;

// True when a response is the site's defence against automated visits rather than its page.
function isBlockedResponse(r) {
  if (!r) return false;
  if (r.status && BLOCK_STATUSES.indexOf(r.status) !== -1) return true;
  const h = r.headers || {};
  if (String(h['cf-mitigated'] || '').toLowerCase() === 'challenge') return true;
  if (r.status === 503 && /cloudflare|sucuri|akamai|imperva|incapsula|datadome|perimeterx/i.test((h.server || '') + ' ' + (h['x-sucuri-id'] || ''))) return true;
  return !!(r.ok && r.text && CHALLENGE_TITLE.test(r.text.slice(0, 4000)));
}

module.exports = {
  safeGet: safeGet, makeSafeGet: makeSafeGet, checkHost: checkHost, parseSiteInput: parseSiteInput, sameSite: sameSite,
  isPublicAddress: isPublicAddress, isBlockedResponse: isBlockedResponse, guardedLookup: guardedLookup,
  MAX_REDIRECTS: MAX_REDIRECTS, DEFAULT_MAX_BYTES: DEFAULT_MAX_BYTES
};
