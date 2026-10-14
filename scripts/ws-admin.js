#!/usr/bin/env node
/* =====================================================================
   scripts/ws-admin.js: manage project workspaces from the terminal (the same rules as the admin page, lib/ws-service.js).

     node scripts/ws-admin.js create <domain> [--type fix|beyond]   scan the site and make a workspace; prints its client link path /w/<id>
     node scripts/ws-admin.js list                           every workspace: id, type, domain, status, score
     node scripts/ws-admin.js rescan <id>                    scan again, add to the history
     node scripts/ws-admin.js set-status <id> <item> <todo|in_progress|applied>   <item>: the check's name, or the start of it ("sitemap")
                                                             (verified is set only by a passing Verify, never by hand)
     node scripts/ws-admin.js set-pro <id> <pro report id|->  link the project's Pro report (- clears it)
     node scripts/ws-admin.js archive <id> | unarchive <id>
     node scripts/ws-admin.js seed-demo                      (re)write both fictional demo workspaces: /demo/fix (example-co.com) and /demo/beyond (example-books.com)

   Beyond workspaces:
     node scripts/ws-admin.js questions <id> import          the questions the linked Pro report's generator wrote (set-pro first)
     node scripts/ws-admin.js questions <id> seed <category> one of the 14 category sets (crm, legal, ...)
     node scripts/ws-admin.js questions <id> set <file>      a text file, one question per line
     node scripts/ws-admin.js gaps <id> <file.json>          [{ "question", "page", "note", "priority": "high|medium|low" }, ...]
     node scripts/ws-admin.js piece add <id> "<type>" "<title>" <file.md>    a new draft (types: New page, FAQ block, Comparison block, Rewrite, Brief)
     node scripts/ws-admin.js piece edit <id> <cid> <file.md>               new text (an approved or published piece goes back to review)
     node scripts/ws-admin.js piece status <id> <cid> <draft|in_review|published>   (approved is set only by the client; published only after approved)
     node scripts/ws-admin.js piece note <id> <cid> "<text>"                 a note the client sees under the piece
     node scripts/ws-admin.js comments <id>                  every piece with its status and comments: what the client answered
     node scripts/ws-admin.js month <id> <YYYY-MM> <named> <asked> [model]  one month's citation-check result (a pilot; enter it only when a run was made)

   Reads the Redis named in the environment or the gitignored .env.local. A workspace link is the client's whole access: print it for yourself, send it to
   the client only, and do not paste it anywhere public. Nothing is printed except what a command says it prints.
   ===================================================================== */

'use strict';

const WS = require('../lib/ws-store.js');
const Svc = require('../lib/ws-service.js');
const Fetch = require('../lib/safe-fetch.js');
const fs = require('fs');

const USAGE = 'Usage: node scripts/ws-admin.js create <domain> [--type fix|beyond] | list | questions <id> import|seed <category>|set <file> | gaps <id> <file> | piece add|edit|status|note ... | comments <id> | month <id> <YYYY-MM> <named> <asked> | rescan <id> | set-status <id> <item> <todo|in_progress|applied> | set-pro <id> <pro report id|-> | archive <id> | unarchive <id> | seed-demo';

async function run(A, argv, deps) {
  const [cmd, a1, a2, a3] = argv;
  const bad = (m) => ({ code: 1, lines: [m] });
  if (cmd === 'seed-demo') { await Svc.seedDemoFix(A); await Svc.seedDemoBeyond(A); return { code: 0, lines: ['The demo workspaces are written: /demo/fix and /demo/beyond'] }; }
  if (cmd === 'list') {
    const all = await WS.list(A);
    const lines = [];
    for (const m of all) {
      const last = await WS.getLast(A, m.id);
      let extra = '';
      if (m.type === 'beyond') { const c = require('../lib/ws-beyond.js').counts(await WS.listContent(A, m.id, false)); extra = c.in_review + ' in review, ' + c.approved + ' approved'; }
      lines.push([m.id, m.type, m.domain, m.status, last ? last.total + '/100' : '-', extra].join('  ').trim());
    }
    return { code: 0, lines: lines.length ? lines : ['No workspaces.'] };
  }
  if (cmd === 'create') {
    const type = argv.indexOf('--type') !== -1 ? argv[argv.indexOf('--type') + 1] : 'fix';
    if (type !== 'fix' && type !== 'beyond') return bad('The type is fix or beyond.');
    const site = Fetch.parseSiteInput(a1);
    if (!site.ok) return bad('Give a public domain, such as example.com.');
    const host = await ((deps && deps.checkHost) || Fetch.checkHost)(site.domain);
    if (!host.ok) return bad('That address is not a public website that can be reached.');
    const r = type === 'beyond' ? await Svc.startBeyond(A, site.domain, deps || {}) : await Svc.startFix(A, site.domain, deps || {});
    return r.ok ? { code: 0, lines: ['/w/' + r.id] } : bad('The site could not be scanned. Nothing was created.');
  }
  const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; } };
  const REASONS = { not_found: 'No such workspace or piece (or it is not a Beyond workspace).', no_pro_report: 'Link the Pro report first (set-pro).', no_questions: 'The linked Pro report has no questions yet.', vertical: 'Unknown category: ' + Svc.VERTICALS.join(', '), month: 'The month is like 2026-09.', counts: 'Asked is 1 to 99; named cannot be more than asked.', title: 'A title is needed.', type: 'Unknown type.', approved_by_client_only: 'Only the client\'s Approve sets approved.', publish_needs_approval: 'A piece is published only after the client approved it.', bad_status: 'Unknown status.', questions: 'No questions given.', gaps: 'The file must be a JSON array.', too_many: 'Too many.', comment: 'A note is needed.' };
  const res = (r, ok) => (r.ok ? { code: 0, lines: [ok] } : bad(REASONS[r.reason] || 'That did not work: ' + r.reason));
  if (cmd === 'comments') {
    const id = a1; const meta = WS.HEX32.test(id) ? await WS.getMeta(A, id) : null;
    if (!meta || meta.type !== 'beyond') return bad(REASONS.not_found);
    const lines = [];
    for (const p of await WS.listContent(A, id, true)) {
      lines.push(p.id + '  ' + p.status + '  ' + p.title);
      p.comments.forEach((c) => lines.push('    ' + c.at.slice(0, 10) + '  ' + c.by + '  ' + c.kind + (c.text ? ': ' + c.text : '')));
    }
    return { code: 0, lines: lines.length ? lines : ['No pieces.'] };
  }
  if (cmd === 'questions' && WS.HEX32.test(a1 || '')) {
    if (a2 === 'import') { const r = await Svc.importQuestions(require('../lib/pro-store.js').createStore(A), a1); return res(r, r.count + ' questions imported.'); }
    if (a2 === 'seed') { const r = await Svc.seedQuestions(A, a1, a3); return res(r, r.count + ' questions from the ' + a3 + ' set.'); }
    if (a2 === 'set') { const t = read(a3); if (t === null) return bad('Cannot read that file.'); const r = await Svc.setQuestions(A, a1, t.split('\n')); return res(r, r.count + ' questions saved.'); }
    return bad(USAGE);
  }
  if (cmd === 'gaps' && WS.HEX32.test(a1 || '')) {
    let rows; try { rows = JSON.parse(read(a2) || ''); } catch (e) { return bad(REASONS.gaps); }
    const r = await Svc.setGaps(A, a1, rows); return res(r, r.count + ' gaps saved.');
  }
  if (cmd === 'month' && WS.HEX32.test(a1 || '')) { const r = await Svc.setMonth(A, a1, { month: a2, named: a3, asked: argv[4], model: argv[5] }); return res(r, 'Saved.'); }
  if (cmd === 'piece') {
    const [, sub, id, x, y, z] = argv;
    if (!WS.HEX32.test(id || '')) return bad(USAGE);
    if (sub === 'add') { const t = read(z); if (t === null) return bad('Cannot read that file.'); const r = await Svc.addPiece(A, id, { type: x, title: y, body: t }); return res(r, r.cid + ' added as a draft.'); }
    if (sub === 'edit') { const t = read(y); if (t === null) return bad('Cannot read that file.'); const r = await Svc.editPiece(A, id, x, { body: t }); return res(r, r.reopened ? 'Saved. It was approved, so it is back in review.' : 'Saved.'); }
    if (sub === 'status') { const r = await Svc.setPieceStatus(A, id, x, y); return res(r, x + ' is now ' + y + '.'); }
    if (sub === 'note') { const r = await Svc.noteOnPiece(A, id, x, y); return res(r, 'Note added.'); }
    return bad(USAGE);
  }
  if (!a1 || !WS.HEX32.test(a1)) return bad(USAGE);
  if (cmd === 'rescan') { const r = await Svc.rescan(A, a1, deps || {}); return r.ok ? { code: 0, lines: ['Score ' + r.score + '/100'] } : bad('Could not rescan: ' + r.reason); }
  if (cmd === 'archive' || cmd === 'unarchive') { const r = await Svc.archive(A, a1, cmd === 'archive'); return r.ok ? { code: 0, lines: [cmd + 'd'] } : bad('Not found.'); }
  if (cmd === 'set-pro') { const r = await Svc.setPro(A, a1, a2 === '-' ? '' : a2); return r.ok ? { code: 0, lines: ['Saved.'] } : bad('Could not save: ' + r.reason); }
  if (cmd === 'set-status') {
    const mt = await WS.getMeta(A, a1);
    if (mt && mt.type !== 'fix') return bad('set-status is for Fix workspaces; a Beyond workspace has pieces (piece status).');
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
