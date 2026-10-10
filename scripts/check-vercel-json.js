#!/usr/bin/env node
/* =====================================================================
   scripts/check-vercel-json.js (npm run check:vercel)

   Validates vercel.json against Vercel's published schema, the same one the
   deploy uses, so "Invalid vercel.json file provided" is caught before a push.

     node scripts/check-vercel-json.js            validate; uses the live schema if it answers, else the saved copy
     node scripts/check-vercel-json.js --refresh  also save the live schema to config/vercel.schema.json
     node scripts/check-vercel-json.js <file>     validate another file (the tests use this)

   The live schema is https://openapi.vercel.sh/vercel.json (it says draft 4 but uses draft 6 and later keywords, so it is checked as draft 7 with its $schema line dropped).
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const ROOT = path.resolve(__dirname, '..');
const SAVED = path.join(ROOT, 'config', 'vercel.schema.json');
const LIVE = 'https://openapi.vercel.sh/vercel.json';

// Two reads a moment apart must agree (the file provider can serve a short copy right after a write).
function stableRead(file) {
  for (let i = 0; i < 10; i++) {
    const a = fs.readFileSync(file, 'utf8');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    const b = fs.readFileSync(file, 'utf8');
    if (a === b) return b;
  }
  throw new Error(file + ' does not read the same twice');
}

async function loadSchema(refresh) {
  let source = 'saved copy';
  let schema = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(function () { ctrl.abort(); }, 8000);
    const res = await fetch(LIVE, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      schema = await res.json();
      source = 'live schema';
      if (refresh) fs.writeFileSync(SAVED, JSON.stringify(schema), 'utf8');
    }
  } catch (e) { /* offline: the saved copy is used */ }
  if (!schema) schema = JSON.parse(fs.readFileSync(SAVED, 'utf8'));
  return { schema: schema, source: source };
}

function validate(text, schema) {
  let json;
  try { json = JSON.parse(text); } catch (e) { return { ok: false, errors: ['does not parse as JSON: ' + e.message] }; }
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  const copy = Object.assign({}, schema); delete copy.$schema;
  const ok = ajv.validate(copy, json);
  return { ok: !!ok, errors: (ajv.errors || []).map(function (e) { return (e.instancePath || '/') + ' ' + e.message + (e.params && e.params.additionalProperty ? ' (' + e.params.additionalProperty + ')' : ''); }) };
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.filter(function (a) { return a[0] !== '-'; })[0] || path.join(ROOT, 'vercel.json');
  const loaded = await loadSchema(args.indexOf('--refresh') !== -1);
  const r = validate(stableRead(file), loaded.schema);
  if (!r.ok) { console.error('FAIL: ' + path.relative(ROOT, file) + ' is not valid against the Vercel schema (' + loaded.source + '):\n  ' + r.errors.slice(0, 12).join('\n  ')); process.exit(1); }
  console.log('OK: ' + path.relative(ROOT, file) + ' is valid against the Vercel schema (' + loaded.source + ')');
}

if (require.main === module) main().catch(function (e) { console.error(e.message || e); process.exit(1); });
module.exports = { validate: validate, loadSchema: loadSchema, stableRead: stableRead };
