#!/usr/bin/env node
/* =====================================================================
   scripts/export-waitlist.js: print the Citehound Pro waitlist as CSV.

     node scripts/export-waitlist.js > waitlist.csv

   Columns: email, name, createdAt, consentVersion. Oldest first. Reads the Redis named in the environment or the
   gitignored .env.local (scripts/env-local.js). The file you save holds personal data: keep it off the repository,
   and delete addresses from it when someone uses their removal link (the list itself is cleaned automatically).
   A cell that starts with = + - @ gets a leading apostrophe so a spreadsheet does not run it as a formula.
   Nothing is printed to the terminal except the CSV on stdout; messages go to stderr.
   ===================================================================== */

'use strict';

const COLUMNS = ['email', 'name', 'createdAt', 'consentVersion'];

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
  const rows = await require('../lib/waitlist.js').list(S.adapterFromEnv());
  process.stdout.write(toCsv(rows) + '\n');
  console.error(rows.length + ' address(es).');
}

module.exports = { toCsv: toCsv };
if (require.main === module) main().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
