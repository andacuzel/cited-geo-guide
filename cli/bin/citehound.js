#!/usr/bin/env node
'use strict';

const { run } = require('../src/cli.js');

run(process.argv.slice(2), process.env, { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }).then(
  (code) => { process.exitCode = code; },
  () => { process.stderr.write('citehound: something went wrong that this version did not expect. Try again, or write to hey@getcitehound.com.\n'); process.exitCode = 3; }
);
