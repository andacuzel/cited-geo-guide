/* =====================================================================
   scripts/env-local.js: read named variables from the gitignored .env.local into process.env.

   Only the names listed in NAMES are read, existing environment values win, and nothing is ever printed:
   callers say whether a name is set, never what it holds.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const NAMES = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'RESEND_API_KEY', 'PRO_MAIL_FROM', 'PRO_HASH_SECRET'];

function load() {
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return [];
  const set = [];
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(function (line) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && NAMES.indexOf(m[1]) !== -1 && !process.env[m[1]]) { process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); set.push(m[1]); }
  });
  return set;
}

module.exports = { load: load, NAMES: NAMES };
