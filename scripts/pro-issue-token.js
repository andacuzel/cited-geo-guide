#!/usr/bin/env node
/* =====================================================================
   scripts/pro-issue-token.js: issue a Citehound Pro order and print its start link.

     node scripts/pro-issue-token.js            one link
     node scripts/pro-issue-token.js --count 5  five links
     node scripts/pro-issue-token.js --memory   dry run against the in-memory store (the link works nowhere)

   The token is the only thing that lets a person start a report: one use, 30 days.
   It writes to the Redis named by KV_REST_API_URL / KV_REST_API_TOKEN (or the
   UPSTASH_REDIS_REST_ names), read from the environment or from the gitignored
   .env.local. There is no payment logic here.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

// .env.local (gitignored) fills in what the environment lacks. Values are never printed.
function loadEnvLocal() {
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(function (line) {
    const m = /^\s*(KV_REST_API_URL|KV_REST_API_TOKEN|UPSTASH_REDIS_REST_URL|UPSTASH_REDIS_REST_TOKEN)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

async function main() {
  const args = process.argv.slice(2);
  const memory = args.indexOf('--memory') !== -1;
  const ci = args.indexOf('--count');
  const count = ci !== -1 ? parseInt(args[ci + 1], 10) : 1;
  if (!(count >= 1 && count <= 50)) { console.error('--count must be a number from 1 to 50.'); process.exit(1); }

  loadEnvLocal();
  const S = require('../lib/pro-store.js');
  const orders = require('../lib/pro-orders.js');
  let store;
  if (memory) {
    store = S.createStore(S.memoryAdapter());
    console.error('Dry run: in-memory store. These links will not work anywhere.');
  } else {
    if (!S.hasRedisEnv()) {
      console.error('No Redis connection found. Set KV_REST_API_URL and KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST_ names) in the environment or in .env.local.\nUse --memory for a dry run.');
      process.exit(1);
    }
    store = S.createStore(S.adapterFromEnv());
  }
  for (let i = 0; i < count; i++) {
    const issued = await orders.issueOrder(store);
    console.log(issued.url);
    if (count === 1) console.error('Single use. Expires ' + issued.order.expiresAt.slice(0, 10) + ' if not used.');
  }
}

main().catch(function (e) { console.error(e && e.message ? e.message : e); process.exit(1); });
