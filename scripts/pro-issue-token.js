#!/usr/bin/env node
/* =====================================================================
   scripts/pro-issue-token.js: issue Citehound Pro order links.

     node scripts/pro-issue-token.js                              one pilot link, valid 14 days
     node scripts/pro-issue-token.js --count 5 --label "Agency friends"
     node scripts/pro-issue-token.js --expires-days 30 --source paid
     node scripts/pro-issue-token.js --memory                     dry run against the in-memory store (the links work nowhere)

   Options
     --count N          how many links, 1 to 50 (default 1)
     --label "<text>"   a short note for yourself, up to 60 characters, shown by pro-admin.js list. Not contact data:
                        use a nickname or a group, never a full name or an email address.
     --expires-days D   how long an unused link works, 1 to 90 (default 14)
     --source S         pilot (default) or paid. The only difference is this note on the order and which counter it
                        adds to: a pilot order runs through exactly the same code as a paid one.

   Output: one https://<site>/pro/start/<token> link per line on stdout, and nothing else. Errors go to stderr.
   It writes to the Redis named by KV_REST_API_URL / KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST_ names), read from the
   environment or from the gitignored .env.local. There is no payment logic here.
   ===================================================================== */

'use strict';

function parse(argv) {
  const o = { count: 1, label: '', expiresDays: 14, source: 'pilot', memory: false };
  const errors = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--memory') o.memory = true;
    else if (a === '--count') o.count = parseInt(next(), 10);
    else if (a === '--label') o.label = String(next() || '');
    else if (a === '--expires-days') o.expiresDays = parseInt(next(), 10);
    else if (a === '--source') o.source = String(next());
    else errors.push('Unknown option ' + a);
  }
  if (!(o.count >= 1 && o.count <= 50)) errors.push('--count must be a number from 1 to 50.');
  if (!(o.expiresDays >= 1 && o.expiresDays <= 90)) errors.push('--expires-days must be a number from 1 to 90.');
  if (o.source !== 'pilot' && o.source !== 'paid') errors.push('--source must be pilot or paid.');
  if (o.label.length > 60) errors.push('--label is at most 60 characters.');
  if (/@/.test(o.label)) errors.push('--label is a note for yourself, not contact data: leave email addresses out.');
  return { options: o, errors: errors };
}

// Issues the links and returns them (one per order). Used by main() and by the tests.
async function issue(store, o) {
  const orders = require('../lib/pro-orders.js');
  const urls = [];
  for (let i = 0; i < o.count; i++) urls.push((await orders.issueOrder(store, { source: o.source, label: o.label, validDays: o.expiresDays })).url);
  return urls;
}

async function main() {
  const parsed = parse(process.argv.slice(2));
  if (parsed.errors.length) { parsed.errors.forEach((e) => console.error(e)); process.exit(1); }
  const o = parsed.options;
  require('./env-local.js').load();
  const S = require('../lib/pro-store.js');
  let store;
  if (o.memory) {
    store = S.createStore(S.memoryAdapter());
    console.error('Dry run: in-memory store. These links will not work anywhere.');
  } else {
    if (!S.hasRedisEnv()) {
      console.error('No Redis connection found. Set KV_REST_API_URL and KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST_ names) in the environment or in .env.local.\nUse --memory for a dry run.');
      process.exit(1);
    }
    store = S.createStore(S.adapterFromEnv());
  }
  (await issue(store, o)).forEach((u) => console.log(u));
}

module.exports = { parse: parse, issue: issue };
if (require.main === module) main().catch(function (e) { console.error(e && e.message ? e.message : e); process.exit(1); });
