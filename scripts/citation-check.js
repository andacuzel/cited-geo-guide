#!/usr/bin/env node
/* =====================================================================
   scripts/citation-check.js: the command-line entry for citation tracking.
   The runner itself is lib/citation/runner.js (see its header, or --help, for
   the flags); providers live in lib/citation/providers/. Behaviour and the
   exported helpers are unchanged.
   ===================================================================== */
'use strict';

const runner = require('../lib/citation/runner.js');

if (require.main === module) {
  runner.main().catch((e) => { console.error('Error: ' + e.message); process.exit(1); });
}

module.exports = runner;
