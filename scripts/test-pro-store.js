#!/usr/bin/env node
/* =====================================================================
   scripts/test-pro-store.js

   Unit tests for lib/pro-store.js with the in-memory adapter (a real Redis is
   not needed, and none is touched). Covers the order and job records, the TTLs,
   the atomic claim of a token, concurrent page updates, the per-job lock, the
   per-domain slots, and the rule that a production process without Redis
   refuses to start.

     node scripts/test-pro-store.js
   ===================================================================== */

'use strict';

const S = require('../lib/pro-store.js');

let pass = 0; const fails = [];
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); console.log((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

let clock = Date.UTC(2026, 9, 9, 12, 0, 0);
const DAY = 86400000;
function fresh() {
  const adapter = S.memoryAdapter({ now: () => clock });
  return { adapter, store: S.createStore(adapter, { now: () => clock }) };
}

(async function main() {
  /* ---- orders ---- */
  {
    const { adapter, store } = fresh();
    const o = await store.createOrder();
    t('order token is 128-bit hex', /^[a-f0-9]{32}$/.test(o.token));
    t('a new order is unused with a 30-day expiry', o.status === 'unused' && Date.parse(o.expiresAt) - clock === 30 * DAY);
    t('a new order has no job and no contact', o.jobId === null && o.contact === null && o.emailSends === 0);
    t('an unused order expires in the store after 30 days', (await adapter.ttl('pro:order:' + o.token)) === 30 * 86400);
    t('a malformed token is not found', (await store.getOrder('not-a-token')) === null && (await store.getOrder('../etc')) === null);
    t('an unknown token is not found', (await store.getOrder('a'.repeat(32))) === null);

    const jobId = await store.createJob({ domain: 'example.com' });
    await store.markOrderUsed(o.token, { jobId, contact: { name: 'Ada', email: 'ada@example.org' } });
    const used = await store.getOrder(o.token);
    t('a used order says used, with its job and contact', used.status === 'used' && used.jobId === jobId && used.contact.email === 'ada@example.org' && used.contact.name === 'Ada');
    t('a used order is kept 90 days', (await adapter.ttl('pro:order:' + o.token)) === 90 * 86400);
    t('the reverse key maps the job to the order and lives 90 days', (await adapter.get('pro:job-order:' + jobId)) === o.token && (await adapter.ttl('pro:job-order:' + jobId)) === 90 * 86400);
    const viaJob = await store.orderForJob(jobId);
    t('orderForJob returns the order with its contact', viaJob && viaJob.token === o.token && viaJob.contact.email === 'ada@example.org');
    t('orderForJob ignores a malformed id', (await store.orderForJob('x')) === null);
  }

  /* ---- an unused order past its date reads as expired ---- */
  {
    const { store } = fresh();
    const o = await store.createOrder();
    clock += 31 * DAY;
    const later = await store.getOrder(o.token);
    t('an unused order older than 30 days is gone or expired', later === null || later.status === 'expired');
    t('an expired order cannot be claimed', (await store.claimOrder(o.token)) === false);
    clock -= 31 * DAY;
  }

  /* ---- concurrent claim: exactly one winner ---- */
  {
    const { store } = fresh();
    const o = await store.createOrder();
    const results = await Promise.all(Array.from({ length: 40 }, () => store.claimOrder(o.token)));
    t('40 simultaneous claims on one token: exactly one wins', results.filter(Boolean).length === 1, results.filter(Boolean).length + ' winners');
    const jobId = await store.createJob({ domain: 'example.com' });
    await store.markOrderUsed(o.token, { jobId, contact: { name: 'A', email: 'a@example.org' } });
    t('a used token cannot be claimed again, even after the claim key expires', await (async () => { clock += 200 * 1000; const r = await store.claimOrder(o.token); clock -= 200 * 1000; return r === false; })());
    const o2 = await store.createOrder();
    t('a claim that is released can be taken again', (await store.claimOrder(o2.token)) === true && (await store.claimOrder(o2.token)) === false && (await store.releaseClaim(o2.token), (await store.claimOrder(o2.token)) === true));
    const o3 = await store.createOrder();
    await store.claimOrder(o3.token);
    clock += 121 * 1000;
    t('a claim abandoned by a crashed winner frees itself after 120 seconds', (await store.claimOrder(o3.token)) === true);
    clock -= 121 * 1000;
  }

  /* ---- jobs: no contact data, pages, counters ---- */
  {
    const { adapter, store } = fresh();
    const id = await store.createJob({ domain: 'example.com' });
    t('job id is 128-bit hex', /^[a-f0-9]{32}$/.test(id));
    let job = await store.getJob(id);
    t('a new job is queued with zero counters and a 90-day expiry', job.status === 'queued' && job.progress.total === 0 && job.progress.settled === 0 && Date.parse(job.expiresAt) - clock === 90 * DAY);
    t('a job record expires in the store after 90 days', (await adapter.ttl('pro:job:' + id)) === 90 * 86400);

    const urls = Array.from({ length: 25 }, (_, i) => 'https://example.com/p' + i);
    await store.setPages(id, urls);
    job = await store.getJob(id);
    t('pages are stored in order, all pending', job.pages.length === 25 && job.pages[0].url === urls[0] && job.pages[24].url === urls[24] && job.pages.every((p) => p.status === 'pending'));
    t('pageCount is the number of pages', job.progress.total === 25);

    // 25 concurrent updates of different pages: none lost, counters exact.
    await Promise.all(urls.map((u, i) => store.updatePage(id, i, i % 5 === 0 ? { url: u, status: 'failed', error: 'timeout' } : (i % 7 === 0 ? { url: u, status: 'blocked' } : { url: u, status: 'ok', result: { total: 50 + i } }))));
    job = await store.getJob(id);
    const by = (s) => job.pages.filter((p) => p.status === s).length;
    t('concurrent page updates lose nothing', job.pages.length === 25 && by('pending') === 0);
    t('counters equal the page statuses', job.progress.done === by('ok') && job.progress.failed === by('failed') && job.progress.blocked === by('blocked') && job.progress.settled === 25, JSON.stringify(job.progress));
    t('a page result survives the round trip', job.pages[1].status === 'ok' && job.pages[1].result.total === 51);
    let threw = false; try { await store.updatePage(id, 0, { url: 'x', status: 'weird' }); } catch (e) { threw = true; }
    t('an unknown page status is refused', threw);

    await store.setJob(id, { status: 'running', siteContext: { robotsOk: true, botResults: [{ name: 'GPTBot', state: 'open' }] }, discoverySource: 'sitemap', candidates: 31 });
    job = await store.getJob(id);
    t('job fields round-trip, objects as JSON', job.status === 'running' && job.siteContext.robotsOk === true && job.discovery.source === 'sitemap' && job.discovery.candidates === 31);
    t('a malformed id returns no job', (await store.getJob('zz')) === null);
    t('an unknown id returns no job', (await store.getJob('b'.repeat(32))) === null);
  }

  /* ---- the job record never carries contact data ---- */
  {
    const { adapter, store } = fresh();
    const o = await store.createOrder();
    await store.claimOrder(o.token);
    const jobId = await store.createJob({ domain: 'example.com' });
    await store.setPages(jobId, ['https://example.com/']);
    await store.setJob(jobId, { status: 'running' });
    await store.markOrderUsed(o.token, { jobId, contact: { name: 'Grace Hopper', email: 'grace@example.org' } });
    const dump = adapter._dump();
    const jobKeys = Object.keys(dump).filter((k) => k.indexOf('pro:job:') === 0);
    const text = JSON.stringify(jobKeys.map((k) => dump[k]));
    t('no job key holds the name or the email', jobKeys.length >= 2 && text.indexOf('grace@example.org') === -1 && text.indexOf('Grace') === -1 && text.indexOf('@') === -1);
    t('the contact lives only in the order hash', JSON.stringify(dump['pro:order:' + o.token]).indexOf('grace@example.org') !== -1);
    t('the reverse key holds only the token', dump['pro:job-order:' + jobId] === o.token);
  }

  /* ---- lock ---- */
  {
    const { store } = fresh();
    const id = await store.createJob({ domain: 'example.com' });
    const got = await Promise.all(Array.from({ length: 20 }, () => store.acquireLock(id)));
    t('20 simultaneous lock attempts: exactly one gets it', got.filter(Boolean).length === 1);
    const nonce = got.filter(Boolean)[0];
    t('a wrong nonce does not release the lock', (await store.releaseLock(id, 'f'.repeat(32))) === false && (await store.acquireLock(id)) === null);
    t('the holder releases it', (await store.releaseLock(id, nonce)) === true && !!(await store.acquireLock(id)));
    const id2 = await store.createJob({ domain: 'example.com' });
    await store.acquireLock(id2);
    clock += 61 * 1000;
    t('a lock left by a dead worker expires after 60 seconds', !!(await store.acquireLock(id2)));
    clock -= 61 * 1000;
  }

  /* ---- domain slots ---- */
  {
    const { store } = fresh();
    const r = await Promise.all([1, 2, 3, 4, 5].map(() => store.reserveDomainSlot('example.com', 2)));
    t('exactly 2 of 5 simultaneous jobs get a slot for one domain', r.filter(Boolean).length === 2, r.filter(Boolean).length + ' granted');
    t('a third is refused while two run', (await store.reserveDomainSlot('example.com', 2)) === false);
    await store.releaseDomainSlot('example.com');
    t('a released slot can be taken again', (await store.reserveDomainSlot('example.com', 2)) === true);
    t('another domain has its own slots', (await store.reserveDomainSlot('other.org', 2)) === true);
    await store.releaseDomainSlot('never.example'); await store.releaseDomainSlot('never.example');
    t('releasing more than was taken never goes negative', (await store.reserveDomainSlot('never.example', 1)) === true && (await store.reserveDomainSlot('never.example', 1)) === false);
    clock += 3 * 3600 * 1000;
    t('slots of dead jobs expire on their own', (await store.reserveDomainSlot('example.com', 2)) === true);
    clock -= 3 * 3600 * 1000;
  }

  /* ---- counters ---- */
  {
    const { store } = fresh();
    const counts = await Promise.all(Array.from({ length: 10 }, () => store.hit('start:abc', 3600)));
    t('rate counters count every hit once', Math.max(...counts) === 10 && new Set(counts).size === 10);
    const e = await (async () => { const o = await store.createOrder(); const n = await Promise.all([1, 2, 3, 4, 5].map(() => store.bumpEmailSends(o.token))); return n.sort().join(','); })();
    t('email sends are counted atomically', e === '1,2,3,4,5', e);
  }

  /* ---- the Redis adapter, against a stand-in that answers the way @upstash/redis does ---- */
  {
    const mem = S.memoryAdapter({ now: () => clock });
    const fake = {
      get: async (k) => mem.get(k),
      set: async (k, v, o) => ((await mem.set(k, v, { nx: o && o.nx, ex: o && o.ex })) ? 'OK' : null),
      del: async (k) => mem.del(k),
      eval: async (script, keys, args) => ((await mem.delIfEqual(keys[0], args[0])) ? 1 : 0),
      incr: async (k) => mem.incr(k), decr: async (k) => mem.decr(k),
      expire: async (k, s) => ((await mem.expire(k, s)) ? 1 : 0),
      ttl: async (k) => mem.ttl(k), exists: async (k) => mem.exists(k),
      hset: async (k, o) => mem.hset(k, o),
      hsetnx: async (k, f, v) => ((await mem.hsetnx(k, f, v)) ? 1 : 0),
      hget: async (k, f) => mem.hget(k, f), hgetall: async (k) => mem.hgetall(k),
      hdel: async (k, f) => mem.hdel(k, f), hincrby: async (k, f, n) => mem.hincrby(k, f, n),
      sadd: async (k, m) => mem.sadd(k, m), srem: async (k, m) => mem.srem(k, m), scard: async (k) => mem.scard(k)
    };
    const store = S.createStore(S.redisAdapter(fake), { now: () => clock });
    const o = await store.createOrder();
    const wins = (await Promise.all(Array.from({ length: 20 }, () => store.claimOrder(o.token)))).filter(Boolean).length;
    t('Redis adapter: 20 simultaneous claims, one winner', wins === 1);
    const id = await store.createJob({ domain: 'example.com' });
    await store.setPages(id, ['https://example.com/', 'https://example.com/a']);
    await Promise.all([store.updatePage(id, 0, { url: 'https://example.com/', status: 'ok', result: { total: 80 } }), store.updatePage(id, 1, { url: 'https://example.com/a', status: 'blocked' })]);
    const job = await store.getJob(id);
    t('Redis adapter: pages and counters round-trip', job.progress.done === 1 && job.progress.blocked === 1 && job.pages[0].result.total === 80);
    const lock = await store.acquireLock(id);
    t('Redis adapter: lock is exclusive and released by its holder', !!lock && (await store.acquireLock(id)) === null && (await store.releaseLock(id, lock)) === true);
    t('Redis adapter: domain slots', (await store.reserveDomainSlot('x.com', 1)) === true && (await store.reserveDomainSlot('x.com', 1)) === false);
  }

  /* ---- environment ---- */
  {
    const keep = Object.assign({}, process.env);
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'VERCEL', 'NODE_ENV'].forEach((k) => delete process.env[k]);
    t('hasRedisEnv is false with nothing set', S.hasRedisEnv() === false);
    t('outside production, no Redis gives the memory adapter', (() => { const w = console.warn; console.warn = () => {}; const a = S.adapterFromEnv(); console.warn = w; return a.kind === 'memory'; })());
    process.env.VERCEL = '1';
    let err = null; try { S.adapterFromEnv(); } catch (e) { err = e; }
    t('on Vercel without Redis it fails with a clear error', err && err.code === 'pro_store_not_configured' && /KV_REST_API_URL/.test(err.message));
    delete process.env.VERCEL; process.env.NODE_ENV = 'production';
    err = null; try { S.adapterFromEnv(); } catch (e) { err = e; }
    t('NODE_ENV=production without Redis fails too', !!err && err.name === 'ProConfigError');
    process.env.KV_REST_API_URL = 'https://example-1234.upstash.io'; process.env.KV_REST_API_TOKEN = 'test-token';
    t('the KV_ names count as a connection', S.hasRedisEnv() === true && S.adapterFromEnv().kind === 'redis');
    delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
    process.env.UPSTASH_REDIS_REST_URL = 'https://example-1234.upstash.io'; process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    t('the UPSTASH_ names count as a connection', S.hasRedisEnv() === true && S.adapterFromEnv().kind === 'redis');
    Object.keys(process.env).forEach((k) => { if (!(k in keep)) delete process.env[k]; });
    Object.assign(process.env, keep);
  }

  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.error('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
}()).catch((e) => { console.error(e); process.exit(1); });
