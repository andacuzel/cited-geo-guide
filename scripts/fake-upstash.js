#!/usr/bin/env node
/* =====================================================================
   scripts/fake-upstash.js: a small stand-in for Upstash's REST API, for trying scripts/test-real-kv.js
   without credentials. It speaks the REST shape (POST a JSON array command, get {"result": ...}), honours
   the base64 response encoding the @upstash/redis client asks for, and implements only the commands the Pro
   store uses. It is NOT Redis: the real test is the one that matters, and this only proves the script
   itself runs and the client's encoding and decoding line up.

     node scripts/fake-upstash.js [port]     then, in another shell:
     UPSTASH_REDIS_REST_URL=http://127.0.0.1:<port> UPSTASH_REDIS_REST_TOKEN=x node scripts/test-real-kv.js
   ===================================================================== */

'use strict';

const http = require('http');

function create() {
  const data = new Map(); // key -> { type, v, exp }
  const now = () => Date.now();
  const live = (k) => { const e = data.get(k); if (!e) return null; if (e.exp !== null && e.exp <= now()) { data.delete(k); return null; } return e; };
  const ensure = (k, type) => { let e = live(k); if (!e) { e = { type, v: type === 'hash' ? new Map() : type === 'set' ? new Set() : null, exp: null }; data.set(k, e); } if (e.type !== type) throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value'); return e; };
  const int = (x) => { const n = parseInt(x, 10); if (!isFinite(n)) throw new Error('ERR value is not an integer or out of range'); return n; };

  function run(cmd) {
    const op = String(cmd[0]).toUpperCase();
    const a = cmd.slice(1).map(String);
    switch (op) {
      case 'SET': {
        let ex = null, nx = false;
        for (let i = 2; i < a.length; i++) { const f = a[i].toUpperCase(); if (f === 'EX') ex = int(a[++i]) * 1000; else if (f === 'PX') ex = int(a[++i]); else if (f === 'NX') nx = true; }
        if (nx && live(a[0])) return null;
        data.set(a[0], { type: 'str', v: a[1], exp: ex === null ? null : now() + ex });
        return 'OK';
      }
      case 'GET': { const e = live(a[0]); if (e && e.type !== 'str') throw new Error('WRONGTYPE'); return e ? e.v : null; }
      case 'DEL': return a.reduce((n, k) => n + (data.delete(k) ? 1 : 0), 0);
      case 'EXISTS': return a.reduce((n, k) => n + (live(k) ? 1 : 0), 0);
      case 'INCR': case 'DECR': { const e = ensure(a[0], 'str'); e.v = String(int(e.v || '0') + (op === 'INCR' ? 1 : -1)); return int(e.v); }
      case 'EXPIRE': { const e = live(a[0]); if (!e) return 0; e.exp = now() + int(a[1]) * 1000; return 1; }
      case 'TTL': { const e = live(a[0]); if (!e) return -2; return e.exp === null ? -1 : Math.max(0, Math.ceil((e.exp - now()) / 1000)); }
      case 'HSET': { const e = ensure(a[0], 'hash'); let n = 0; for (let i = 1; i < a.length; i += 2) { if (!e.v.has(a[i])) n++; e.v.set(a[i], a[i + 1]); } return n; }
      case 'HSETNX': { const e = ensure(a[0], 'hash'); if (e.v.has(a[1])) return 0; e.v.set(a[1], a[2]); return 1; }
      case 'HGET': { const e = live(a[0]); return e && e.type === 'hash' && e.v.has(a[1]) ? e.v.get(a[1]) : null; }
      case 'HGETALL': { const e = live(a[0]); const out = []; if (e && e.type === 'hash') e.v.forEach((v, f) => out.push(f, v)); return out; }
      case 'HDEL': { const e = live(a[0]); return e && e.type === 'hash' && e.v.delete(a[1]) ? 1 : 0; }
      case 'HINCRBY': { const e = ensure(a[0], 'hash'); const n = int(e.v.get(a[1]) || '0') + int(a[2]); e.v.set(a[1], String(n)); return n; }
      case 'SADD': { const e = ensure(a[0], 'set'); const had = e.v.has(a[1]); e.v.add(a[1]); return had ? 0 : 1; }
      case 'SREM': { const e = live(a[0]); return e && e.type === 'set' && e.v.delete(a[1]) ? 1 : 0; }
      case 'SCARD': { const e = live(a[0]); return e && e.type === 'set' ? e.v.size : 0; }
      case 'EVAL': {
        if (a[0].indexOf('redis.call("get", KEYS[1]) == ARGV[1]') === -1) throw new Error('ERR this stand-in runs only the compare-and-delete script');
        const e = live(a[2]); if (e && e.type === 'str' && e.v === a[3]) { data.delete(a[2]); return 1; } return 0;
      }
      default: throw new Error('ERR unknown command ' + op);
    }
  }

  const encode = (v) => (typeof v === 'string' ? Buffer.from(v).toString('base64') : Array.isArray(v) ? v.map(encode) : v);

  return http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const b64 = String(req.headers['upstash-encoding'] || '').toLowerCase() === 'base64';
      const reply = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return reply(400, { error: 'bad json' }); }
      const one = (c) => { try { const r = run(c); return { result: b64 ? encode(r) : r }; } catch (e) { return { error: e.message }; } };
      if (/\/(multi-exec|pipeline)/.test(req.url)) { const out = body.map(one); return reply(200, out); }
      const r = one(body); reply(r.error ? 400 : 200, r);
    });
  });
}

if (require.main === module) {
  const port = parseInt(process.argv[2], 10) || 4190;
  create().listen(port, '127.0.0.1', () => console.log('fake Upstash REST on http://127.0.0.1:' + port));
}
module.exports = { create: create };
