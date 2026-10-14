#!/usr/bin/env node
/* =====================================================================
   scripts/export-waitlist.js: print every signup list as CSV: the Pro / Fix / Beyond waitlist and the State of AI Readiness report list.

     node scripts/export-waitlist.js > waitlist.csv

   Columns: email, name, createdAt, consentVersion, interest (waitlist rows: pro, fix, beyond, comma-joined; blank for report rows), website, note,
   source (pro-waitlist or readiness-report: which list the row came from) and updates (report rows only: yes when the optional "Also send occasional
   Citehound updates" box was ticked). The same address on both lists is two rows. Oldest first. Reads the Redis named in the environment or the
   gitignored .env.local (scripts/env-local.js). The file you save holds personal data: keep it off the repository,
   and delete addresses from it when someone uses their removal link (the list itself is cleaned automatically).
   A cell that starts with = + - @ gets a leading apostrophe so a spreadsheet does not run it as a formula.
   Nothing is printed to the terminal except the CSV on stdout; messages go to stderr.
   ===================================================================== */

'use strict';

const COLUMNS = ['email', 'name', 'createdAt', 'consentVersion', 'interest', 'website', 'note', 'source', 'updates'];

function cell(v) {
  let s = String(v === undefined || v === null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows) {
  return [COLUMNS.join(',')].concat(rows.map((r) => COLUMNS.map((c) => cell(r[c])).join(','))).join('\n');
}

async function main() {
  require('./env-local.js').load();
  const S = require('../lib/pro-store.js');
  if (!S.hasRedisEnv()) { console.error('No Redis connection found. Put the Upstash variables in .env.local (see docs/pilot.md).'); process.exit(1); }
  const A = S.adapterFromEnv();
  const wl = (await require('../lib/waitlist.js').list(A)).map((r) => Object.assign({}, r, { source: 'pro-waitlist' }));
  const sr = (await require('../lib/readiness.js').list(A)).map((r) => ({ email: r.email, createdAt: r.createdAt, consentVersion: r.consentVersion, source: 'readiness-report', updates: r.updates ? 'yes' : 'no' }));
  const rows = wl.concat(sr).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  process.stdout.write(toCsv(rows) + '\n');
  console.error(rows.length + ' row(s): ' + wl.length + ' waitlist, ' + sr.length + ' report list.');
}

module.exports = { toCsv: toCsv };
if (require.main === module) main().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
