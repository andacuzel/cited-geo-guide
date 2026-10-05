#!/usr/bin/env node
/* =====================================================================
   scripts/generate-mcp-docs.js

   Retired. mcp.html used to be a hand-written page with three regions this
   script generated. The page is now written whole by
   scripts/generate-mcp-page.js, which reads the same registry. This file is
   kept so an old command still works: it runs that script with the same flags.

     node scripts/generate-mcp-docs.js           same as generate-mcp-page.js
     node scripts/generate-mcp-docs.js --check   same as generate-mcp-page.js --check
   ===================================================================== */

'use strict';

const r = require('child_process').spawnSync(process.execPath, [require('path').join(__dirname, 'generate-mcp-page.js')].concat(process.argv.slice(2)), { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
