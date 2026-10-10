/* =====================================================================
   lib/pro-http.js: small helpers shared by the Pro endpoints.

   - every Pro response says no-store, noindex and no referrer
   - callers are told apart by a keyed hash of their address and the date, never
     by the address: nothing here stores, logs or returns an IP
   - request bodies are read once, capped, and parsed as JSON
   ===================================================================== */

'use strict';

const crypto = require('crypto');

// PRO_HASH_SECRET keys every hash of an address (and, in lib/waitlist.js, the signed removal tokens). There is no
// fallback value: without a secret of at least 16 characters the Pro endpoints stop with a 503 instead of hashing
// with something anyone could read in the repository (docs/pro.md).
const MIN_SECRET = 16;
function secret(env) {
  const s = String(((env || process.env).PRO_HASH_SECRET) || '');
  if (s.length < MIN_SECRET) {
    const e = new Error('PRO_HASH_SECRET is not set, or is shorter than ' + MIN_SECRET + ' characters. Pro refuses to run without it.');
    e.code = 'pro_secret_missing';
    throw e;
  }
  return s;
}

function clientAddress(req) {
  const h = (req && req.headers) || {};
  const fwd = h['x-vercel-forwarded-for'] || h['x-forwarded-for'] || h['x-real-ip'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req && req.socket && req.socket.remoteAddress) || 'unknown';
}

// 32 hex characters that change every UTC day, so a counter key cannot be followed from one day to the next.
function callerKey(req, now) {
  const day = new Date(now || Date.now()).toISOString().slice(0, 10);
  return crypto.createHmac('sha256', secret()).update(clientAddress(req) + '|' + day).digest('hex').slice(0, 32);
}

function baseHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function sendJson(res, status, body, extra) {
  baseHeaders(res);
  if (extra) Object.keys(extra).forEach(function (k) { res.setHeader(k, extra[k]); });
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sendHtml(res, status, html, extra) {
  baseHeaders(res);
  if (extra) Object.keys(extra).forEach(function (k) { res.setHeader(k, extra[k]); });
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}

function sendRedirect(res, location) {
  baseHeaders(res);
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

function readBody(req, maxBytes) {
  maxBytes = maxBytes || 4096;
  return new Promise(function (resolve) {
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return resolve({ ok: true, json: req.body });
      const s = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
      if (s.length > maxBytes) return resolve({ ok: false, reason: 'too_large' });
      try { return resolve({ ok: true, json: s ? JSON.parse(s) : {} }); } catch (e) { return resolve({ ok: false, reason: 'bad_json' }); }
    }
    const chunks = []; let n = 0; let over = false;
    req.on('data', function (c) { n += c.length; if (n > maxBytes) { over = true; return; } chunks.push(c); });
    req.on('end', function () {
      if (over) return resolve({ ok: false, reason: 'too_large' });
      const s = Buffer.concat(chunks).toString('utf8');
      try { resolve({ ok: true, json: s ? JSON.parse(s) : {} }); } catch (e) { resolve({ ok: false, reason: 'bad_json' }); }
    });
    req.on('error', function () { resolve({ ok: false, reason: 'bad_json' }); });
  });
}

function queryOf(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try { const u = new URL(req.url, 'http://localhost'); const o = {}; u.searchParams.forEach(function (v, k) { o[k] = v; }); return o; } catch (e) { return {}; }
}

module.exports = { secret: secret, MIN_SECRET: MIN_SECRET, clientAddress: clientAddress, callerKey: callerKey, sendJson: sendJson, sendHtml: sendHtml, sendRedirect: sendRedirect, readBody: readBody, queryOf: queryOf, baseHeaders: baseHeaders };
