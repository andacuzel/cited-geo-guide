#!/usr/bin/env node
/* =====================================================================
   scripts/test-real-kv.js (npm run test:real-kv)

   Runs the commands lib/pro-store.js depends on against a REAL Redis (Upstash), and the whole store and the
   start endpoint on top of it, then compares every answer with the in-memory adapter's, which is what the
   other tests trust. It needs UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or the KV_REST_API_ pair),
   from the environment or the gitignored .env.local, and exits 2 with a message when they are missing.

   Safety: every key lives under a prefix of its own (test-<run id>:), the keys written are recorded, and at
   the end exactly those are deleted and checked to be gone. Nothing outside the prefix is touched. Values are
   never printed.

     node scripts/test-real-kv.js
   ===================================================================== */

'use strict';

const crypto = require('crypto');
require('./env-local.js').load();
process.env.PRO_HASH_SECRET = process.env.PRO_HASH_SECRET || 'test-only-secret-0123456789abcdef';
const S = require('../lib/pro-store.js');

const out = (s) => process.stdout.write(s + '\n');
let pass = 0; const fails = [];
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!S.hasRedisEnv()) {
  out('No Upstash credentials found. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL and KV_REST_API_TOKEN) in the environment or .env.local.');
  out('(scripts/fake-upstash.js can stand in to try this script, but it proves nothing about the real server.)');
  process.exit(2);
}

const RUN = 'test-' + crypto.randomBytes(5).toString('hex') + ':';
const touched = new Set();
const rawAdapter = S.adapterFromEnv();
const real = S.withPrefix(rawAdapter, RUN, (k) => touched.add(k));
const memory = S.memoryAdapter();

// The same steps on both adapters; every answer must agree (TTLs within two seconds).
async function both(label, step) {
  const a = await step(real, 'r');
  const b = await step(memory, 'm');
  const norm = (x) => (typeof x === 'number' && x > 0 && x < 100000 && /ttl/i.test(label) ? 'ttl' : x);
  const same = JSON.stringify(norm(a)) === JSON.stringify(norm(b)) || (/ttl/i.test(label) && typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 2);
  t(label + ': real ' + JSON.stringify(a) + ', memory ' + JSON.stringify(b), same);
  return a;
}

(async function main() {
  out('Real Redis run ' + RUN.slice(0, -1) + ' (kind: ' + rawAdapter.kind + ')');

  /* ---- SET NX / EX ---- */
  await both('SET NX on a new key', (A) => A.set('k1', 'one', { nx: true, ex: 30 }));
  await both('SET NX on an existing key is refused', (A) => A.set('k1', 'two', { nx: true, ex: 30 }));
  await both('the refused SET NX left the value', (A) => A.get('k1'));
  await both('TTL after SET EX 30 (ttl)', (A) => A.ttl('k1'));
  await both('SET without NX overwrites', (A) => A.set('k1', 'three', {}));
  await both('GET of a missing key is null', (A) => A.get('missing'));
  await both('TTL of a key with no expiry is -1', async (A) => { await A.set('k2', 'x', {}); return A.ttl('k2'); });
  await both('TTL of a missing key is -2', (A) => A.ttl('missing'));
  await both('EXPIRE on a missing key is false', (A) => A.expire('missing', 10));
  await both('EXPIRE on a key is true', (A) => A.expire('k2', 40));
  await both('TTL after EXPIRE 40 (ttl)', (A) => A.ttl('k2'));
  await both('EXISTS', async (A) => [await A.exists('k2'), await A.exists('missing')]);
  // expiry really happens
  await real.set('short', 'x', { nx: true, ex: 1 }); await memory.set('short', 'x', { nx: true, ex: 1 });
  await sleep(1300);
  t('a key set with EX 1 is gone after 1.3 s on the real server', (await real.get('short')) === null);
  t('SET NX works again once it has expired', (await real.set('short', 'y', { nx: true, ex: 5 })) === true);

  /* ---- INCR / DECR ---- */
  await both('INCR creates at 1', (A) => A.incr('c1'));
  await both('INCR again gives 2', (A) => A.incr('c1'));
  await both('DECR gives 1', (A) => A.decr('c1'));
  await both('EXPIRE on a counter', (A) => A.expire('c1', 30));
  await both('INCR keeps the expiry (ttl)', async (A) => { await A.incr('c1'); return A.ttl('c1'); });
  const par = await Promise.all(Array.from({ length: 25 }, () => real.incr('cpar')));
  t('25 parallel INCRs return 25 distinct values 1..25', new Set(par).size === 25 && Math.max(...par) === 25 && Math.min(...par) === 1);

  /* ---- hashes ---- */
  await both('HSET several fields returns the number added', (A) => A.hset('h1', { a: '1', b: 'two', c: '3' }));
  await both('HSET an existing field and a new one returns 1', (A) => A.hset('h1', { a: '9', d: 'x' }));
  await both('HGETALL returns an object of strings', (A) => A.hgetall('h1'));
  await both('HGETALL of a missing key is null', (A) => A.hgetall('hmissing'));
  await both('HGET', async (A) => [await A.hget('h1', 'b'), await A.hget('h1', 'nope'), await A.hget('hmissing', 'a')]);
  await both('HSETNX first is true', (A) => A.hsetnx('h2', 'f', 'v'));
  await both('HSETNX second is false', (A) => A.hsetnx('h2', 'f', 'w'));
  await both('HSETNX left the first value', (A) => A.hget('h2', 'f'));
  await both('HINCRBY on a new field', (A) => A.hincrby('h3', 'n', 1));
  await both('HINCRBY by 5 then -2', async (A) => [await A.hincrby('h3', 'n', 5), await A.hincrby('h3', 'n', -2)]);
  await both('HINCRBY result reads back as a string', (A) => A.hget('h3', 'n'));
  await both('HDEL', async (A) => [await A.hdel('h1', 'a'), await A.hdel('h1', 'a')]);
  await both('a stored JSON string round-trips byte for byte', async (A) => { const j = JSON.stringify({ url: 'https://example.com/é?x=1&y="2"', n: [1, 2, { z: null }] }); await A.hset('h4', { '000': j }); return (await A.hget('h4', '000')) === j; });
  await both('HSET keeps the expiry set earlier (ttl)', async (A) => { await A.hset('h5', { a: '1' }); await A.expire('h5', 60); await A.hset('h5', { b: '2' }); return A.ttl('h5'); });
  const hn = await Promise.all(Array.from({ length: 20 }, () => real.hincrby('hpar', 'n', 1)));
  t('20 parallel HINCRBYs return 1..20 once each', new Set(hn).size === 20 && Math.max(...hn) === 20);
  const nx = await Promise.all(Array.from({ length: 20 }, (_, i) => real.hsetnx('hnx', 'only', 'p' + i)));
  t('20 parallel HSETNXs: exactly one wins', nx.filter(Boolean).length === 1);
  const snx = await Promise.all(Array.from({ length: 20 }, (_, i) => real.set('snx', 'p' + i, { nx: true, ex: 30 })));
  t('20 parallel SET NXs: exactly one wins', snx.filter(Boolean).length === 1);

  /* ---- sets ---- */
  await both('SADD new member', (A) => A.sadd('s1', 'a'));
  await both('SADD again is 0', (A) => A.sadd('s1', 'a'));
  await both('SCARD', async (A) => { await A.sadd('s1', 'b'); return A.scard('s1'); });
  await both('SREM', async (A) => [await A.srem('s1', 'a'), await A.srem('s1', 'a'), await A.scard('s1')]);

  /* ---- eval: compare and delete ---- */
  await both('delIfEqual with the wrong value does nothing', async (A) => { await A.set('l1', 'secret', {}); return [await A.delIfEqual('l1', 'wrong'), await A.get('l1')]; });
  await both('delIfEqual with the right value deletes', async (A) => [await A.delIfEqual('l1', 'secret'), await A.get('l1')]);
  await both('delIfEqual on a missing key is false', (A) => A.delIfEqual('l-missing', 'x'));
  const lockRace = await Promise.all(Array.from({ length: 10 }, (_, i) => real.set('lock', 'n' + i, { nx: true, ex: 20 })));
  const winner = lockRace.findIndex(Boolean);
  const losersTry = await Promise.all(Array.from({ length: 10 }, (_, i) => (i === winner ? Promise.resolve(false) : real.delIfEqual('lock', 'n' + i))));
  t('a lock is released only by its holder (9 wrong nonces fail, the holder succeeds)', losersTry.every((x) => x === false) && (await real.delIfEqual('lock', 'n' + winner)) === true);

  /* ---- the whole store on the real server ---- */
  const store = S.createStore(real);
  const order = await store.createOrder();
  t('store.createOrder on Redis: unused, 30-day TTL', order.status === 'unused' && (await real.ttl('pro:order:' + order.token)) > 29 * 86400 && (await real.ttl('pro:order:' + order.token)) <= 30 * 86400);
  const wins = (await Promise.all(Array.from({ length: 10 }, () => store.claimOrder(order.token)))).filter(Boolean).length;
  t('10 parallel claimOrder calls on one token: exactly one wins', wins === 1, String(wins));
  const jobId = await store.createJob({ domain: 'example.com' });
  await store.setPages(jobId, Array.from({ length: 25 }, (_, i) => 'https://example.com/p' + i));
  await Promise.all(Array.from({ length: 25 }, (_, i) => store.updatePage(jobId, i, i % 6 === 0 ? { url: 'https://example.com/p' + i, status: 'blocked', error: 'HTTP 403' } : { url: 'https://example.com/p' + i, status: 'ok', result: { total: 50 + i, checks: [] } })));
  const job = await store.getJob(jobId);
  const blocked = job.pages.filter((p) => p.status === 'blocked').length;
  t('25 parallel page updates lose nothing and the counters are exact', job.pages.length === 25 && job.pages.every((p) => p.status !== 'pending') && job.progress.blocked === blocked && job.progress.done === 25 - blocked && job.progress.settled === 25, JSON.stringify(job.progress));
  t('job TTL is 90 days after all those writes', (await real.ttl('pro:job:' + jobId)) > 89 * 86400);
  t('pages hash TTL is 90 days', (await real.ttl('pro:job:' + jobId + ':pages')) > 89 * 86400);
  const lock = await store.acquireLock(jobId);
  t('job lock on Redis: one holder, released by that holder', !!lock && (await store.acquireLock(jobId)) === null && (await store.releaseLock(jobId, lock)) === true && !!(await store.acquireLock(jobId)));
  t('domain slots on Redis: 2 of 6 parallel reservations succeed', (await Promise.all(Array.from({ length: 6 }, () => store.reserveDomainSlot('slots.test', 2)))).filter(Boolean).length === 2);
  const taken = await Promise.all(Array.from({ length: 5 }, () => store.takeSlot('req:test', 2)));
  t('the one-request-a-second slot on Redis: one of 5 parallel callers gets it', taken.filter(Boolean).length === 1);
  await sleep(2200);
  t('... and it is free again after its time', (await store.takeSlot('req:test', 2)) === true);
  await store.markOrderUsed(order.token, { jobId: jobId, contact: { name: 'Test Person', email: 'test@example.org' } });
  const used = await store.getOrder(order.token);
  t('markOrderUsed on Redis: used, 90-day TTL, contact kept, reverse key written', used.status === 'used' && used.contact.email === 'test@example.org' && (await real.ttl('pro:order:' + order.token)) > 89 * 86400 && (await store.orderForJob(jobId)).token === order.token);
  t('the job hashes hold no contact data (checked on the real server)', JSON.stringify([await real.hgetall('pro:job:' + jobId), await real.hgetall('pro:job:' + jobId + ':pages')]).indexOf('test@example.org') === -1);

  /* ---- the start endpoint on Redis: 10 parallel submits, one job ---- */
  const api = require('../lib/pro-api.js');
  const o2 = await store.createOrder();
  const call = (fn, o, deps) => new Promise((resolve, reject) => {
    const headers = {};
    const req = { method: o.method || 'GET', url: '/', headers: { 'x-forwarded-for': o.ip || '203.0.113.9' }, query: o.query || {}, body: o.body, socket: {} };
    const res = { statusCode: 200, setHeader: (k, v) => { headers[k.toLowerCase()] = v; }, end: (b) => { let json = null; try { json = JSON.parse(b); } catch (e) { /* html */ } resolve({ status: res.statusCode, headers, json, body: b }); } };
    Promise.resolve(fn(req, res, deps)).catch(reject);
  });
  const good = { token: o2.token, site: 'example.com', name: 'Test Person', email: 'test@example.org', consent: true };
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => call(api.start, { method: 'POST', body: good, ip: '198.51.100.' + (i + 1) }, { store, checkHost: async () => ({ ok: true }), pollMs: 100 })));
  const ids = new Set(rs.filter((r) => r.status === 200).map((r) => r.json.jobId));
  const jobKeys = Array.from(touched).filter((k) => /pro:job:[a-f0-9]{32}$/.test(k));
  t('10 parallel POSTs to start on one token over real Redis: exactly one new job', ids.size === 1 && jobKeys.length === 2, 'ids ' + ids.size + ', job hashes ' + jobKeys.length);
  t('... and every response that succeeded names that job', rs.filter((r) => r.status === 200).length >= 1 && rs.every((r) => r.status === 200 || r.status === 409 || r.status === 429));
  const orderAfter = await call(api.order, { method: 'POST', body: { token: o2.token } }, { store });
  t('the order lookup on Redis now points at that job and no other', orderAfter.json.reportPath === '/r/' + [...ids][0] + '/');

  /* ---- clean up exactly what this run wrote ---- */
  const keys = Array.from(touched);
  for (const k of keys) await rawAdapter.del(k);
  let left = 0; for (const k of keys) left += await rawAdapter.exists(k);
  t('cleanup: all ' + keys.length + ' keys written by this run are deleted and gone', left === 0, left + ' left');

  out('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
}()).catch(async (e) => {
  // Always try to clean up, then say what broke without printing any value.
  try { for (const k of touched) await rawAdapter.del(k); } catch (e2) { /* nothing more to do */ }
  process.stderr.write('The real-KV test stopped: ' + (e && e.name) + ' ' + (e && e.message ? String(e.message).replace(/https?:\/\/\S+/g, '<url>') : '') + '\n');
  process.exit(1);
});
