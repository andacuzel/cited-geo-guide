#!/usr/bin/env node
/* =====================================================================
   scripts/ws-admin.js: manage project workspaces from the terminal (the same rules as the admin page, lib/ws-service.js).

     node scripts/ws-admin.js create <domain> [--type fix]   scan the site and make a Fix workspace; prints its client link path /w/<id>
     node scripts/ws-admin.js list                           every workspace: id, type, domain, status, score
     node scripts/ws-admin.js rescan <id>                    scan again, add to the history
     node scripts/ws-admin.js set-status <id> <item> <todo|in_progress|applied>   <item>: the check's name, or the start of it ("sitemap")
                                                             (verified is set only by a passing Verify, never by hand)
     node scripts/ws-admin.js set-pro <id> <pro report id|->  link the project's Pro report (- clears it)
     node scripts/ws-admin.js archive <id> | unarchive <id>
     node scripts/ws-admin.js seed-demo                      (re)write the fictional demo workspace (example-co.com) shown at /demo/fix

   Reads the Redis named in the environment or the gitignored .env.local. A workspace link is the client's whole access: print it for yourself, send it to
   the client only, and do not paste it anywhere public. Nothing is printed except what a command says it prints.
   ===================================================================== */

'use strict';

const WS = require('../lib/ws-store.js');
const Svc = require('../lib/ws-service.js');
const Fetch = require('../lib/safe-fetch.js');

const USAGE = 'Usage: node scripts/ws-admin.js create <domain> [--type fix] | list | rescan <id> | set-status <id> <item> <todo|in_progress|applied> | set-pro <id> <pro report id|-> | archive <id> | unarchive <id> | seed-demo';

async function run(A, argv, deps) {
  const [cmd, a1, a2, a3] = argv;
  const bad = (m) => ({ code: 1, lines: [m] });
  if (cmd === 'seed-demo') { await Svc.seedDemoFix(A); return { code: 0, lines: ['The demo workspace is written: /demo/fix'] }; }
  if (cmd === 'list') {
    const all = await WS.list(A);
    const lines = [];
    for (const m of all) { const last = await WS.getLast(A, m.id); lines.push([m.id, m.type, m.domain, m.status, last ? last.total + '/100' : '-'].join('  ')); }
    return { code: 0, lines: lines.length ? lines : ['No workspaces.'] };
  }
  if (cmd === 'create') {
    const type = argv.indexOf('--type') !== -1 ? argv[argv.indexOf('--type') + 1] : 'fix';
    if (type !== 'fix') return bad('Only --type fix exists so far.');
    const site = Fetch.parseSiteInput(a1);
    if (!site.ok) return bad('Give a public domain, such as example.com.');
    const host = await ((deps && deps.checkHost) || Fetch.checkHost)(site.domain);
    if (!host.ok) return bad('That address is not a public website that can be reached.');
    const r = await Svc.startFix(A, site.domain, deps || {});
    return r.ok ? { code: 0, lines: ['/w/' + r.id] } : bad('The site could not be scanned. Nothing was created.');
  }
  if (!a1 || !WS.HEX32.test(a1)) return bad(USAGE);
  if (cmd === 'rescan') { const r = await Svc.rescan(A, a1, deps || {}); return r.ok ? { code: 0, lines: ['Score ' + r.score + '/100'] } : bad('Could not rescan: ' + r.reason); }
  if (cmd === 'archive' || cmd === 'unarchive') { const r = await Svc.archive(A, a1, cmd === 'archive'); return r.ok ? { code: 0, lines: [cmd + 'd'] } : bad('Not found.'); }
  if (cmd === 'set-pro') { const r = await Svc.setPro(A, a1, a2 === '-' ? '' : a2); return r.ok ? { code: 0, lines: ['Saved.'] } : bad('Could not save: ' + r.reason); }
  if (cmd === 'set-status') {
    const items = await WS.getItems(A, a1);
    const q = String(a2 || '').toLowerCase();
    const hits = items.filter((i) => i.key.toLowerCase() === q || i.key.toLowerCase().indexOf(q) === 0);
    if (hits.length !== 1) return bad(hits.length ? 'That matches more than one item: ' + hits.map((i) => i.key).join('; ') : 'No item starts with that.');
    const r = await Svc.setItem(A, a1, hits[0].key, { status: a3 });
    return r.ok ? { code: 0, lines: [hits[0].key + ' is now ' + a3] } : bad(r.reason === 'verified_by_check_only' ? 'Verified is set only by a passing Verify on the client page or the admin page.' : 'Could not set it: ' + r.reason);
  }
  return bad(USAGE);
}

async function main() {
  require('./env-local.js').load();
  const S = require('../lib/pro-store.js');
  if (!S.hasRedisEnv()) { console.error('No Redis connection found. Put the Upstash variables in .env.local (see docs/pilot.md).'); process.exit(1); }
  const r = await run(S.adapterFromEnv(), process.argv.slice(2));
  r.lines.forEach((l) => (r.code ? console.error(l) : console.log(l)));
  process.exit(r.code);
}

module.exports = { run: run };
if (require.main === module) main().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
