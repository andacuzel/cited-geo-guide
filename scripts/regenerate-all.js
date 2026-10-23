#!/usr/bin/env node
/* scripts/regenerate-all.js: runs every page generator, the footer and site-chrome writers, the share-image tags and the Pro crops, in the order that keeps `npm run gates` green after a template or style change.
   Stage new files first (git add -A): the footer check reads the list of tracked pages. Brand PNGs (generate-og.js, generate-brand-assets.js) need Playwright and are run by hand. */
'use strict';
const cp = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const steps = ['generate-api-page', 'generate-changelog', 'generate-claude-page', 'generate-integrations-page', 'generate-mcp-page', 'generate-pricing', 'generate-readiness', 'generate-refunds', 'generate-research-002', 'generate-service-pages', 'generate-tools-page', 'generate-trust', 'generate-watch-page', 'generate-pro', 'generate-citation', 'generate-playbooks-page', 'generate-benchmark-pages', 'generate-sample-report', 'generate-brand-page', 'site-footer', 'site-chrome', 'apply-og', 'capture-pro-shots', 'generate-pro'];
let bad = 0;
steps.forEach((s) => { const r = cp.spawnSync(process.execPath, [path.join(__dirname, s + '.js')], { cwd: ROOT, encoding: 'utf8' }); if (r.status !== 0) { bad++; console.log('FAIL ' + s + '\n' + (r.stdout + r.stderr).split('\n').slice(0, 4).join('\n')); } });
console.log(bad ? bad + ' step(s) failed' : 'regenerated ' + steps.length + ' steps');
process.exit(bad ? 1 : 0);
