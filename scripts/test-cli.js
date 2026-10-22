#!/usr/bin/env node
/* =====================================================================
   scripts/test-cli.js

   The command-line tool in cli/ (npm package "citehound"):
   - its own tests (node:test, a mocked fetch, and the real program against a local server) all pass: `node --test cli/test/*.test.js`;
   - package.json is publish-ready: the name, a semantic version, a bin that exists and starts with a node shebang, "files" that leave out the tests, node 18 or newer, MIT, the repository
     with its directory, homepage and keywords, public access, NO dependencies of any kind and no install scripts;
   - `npm pack --dry-run` lists only the intended files (bin, src, README, CHANGELOG, LICENSE, package.json);
   - the source makes no request except to the Citehound address, reads the key only from CITEHOUND_API_KEY, never logs it, and prints no stack trace;
   - the README has three usage examples, the key section, the exit codes and the readiness sentence, and promises no outcome; the site does not say the CLI is live
     (it says "In preparation" until the owner publishes it: scripts/generate-claude-page.js checks that);
   - the publish workflow runs on a cli-v* tag only, with provenance, and checks the tag against the version.

     node scripts/test-cli.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

const pkg = JSON.parse(read('cli/package.json'));

// Its own tests.
const tests = fs.readdirSync(path.join(ROOT, 'cli/test')).filter((f) => /\.test\.js$/.test(f)).map((f) => 'test/' + f);
const run = cp.spawnSync(process.execPath, ['--test'].concat(tests), { cwd: path.join(ROOT, 'cli'), encoding: 'utf8', timeout: 120000 });
const summary = (run.stdout.match(/^ℹ (tests|pass|fail) (\d+)/gm) || []).join('; ');
t('the CLI tests pass (node:test: ' + summary + ')', run.status === 0 && /ℹ fail 0/.test(run.stdout) && /ℹ tests (\d+)/.test(run.stdout) && +/ℹ tests (\d+)/.exec(run.stdout)[1] >= 30, (run.stdout + run.stderr).split('\n').filter((l) => /✖|Error/.test(l)).slice(0, 4).join(' | '));

t('package.json: name citehound, a semantic version, MIT, node 18 or newer, public access', pkg.name === 'citehound' && /^\d+\.\d+\.\d+$/.test(pkg.version) && pkg.license === 'MIT' && pkg.engines.node === '>=18' && pkg.publishConfig.access === 'public' && !pkg.private);
t('package.json: a bin that exists, is executable and starts with a node shebang', pkg.bin.citehound === 'bin/citehound.js' && fs.existsSync(path.join(ROOT, 'cli/bin/citehound.js')) && (fs.statSync(path.join(ROOT, 'cli/bin/citehound.js')).mode & 0o111) !== 0 && read('cli/bin/citehound.js').split('\n')[0] === '#!/usr/bin/env node');
t('package.json: repository with its directory, homepage, bugs, keywords and a description', /github\.com\/[^/]+\/[^/]+\.git$/.test(pkg.repository.url) && pkg.repository.directory === 'cli' && /^https:\/\/getcitehound\.com/.test(pkg.homepage) && pkg.bugs.email === 'hey@getcitehound.com' && pkg.keywords.length >= 5 && pkg.description.length > 40);
t('package.json: no dependencies of any kind, and no install or publish scripts', !pkg.dependencies && !pkg.devDependencies && !pkg.optionalDependencies && !pkg.peerDependencies && !pkg.bundledDependencies && !Object.keys(pkg.scripts || {}).some((k) => /^(pre|post)?(install|publish|prepare|prepack)/.test(k)) && !fs.existsSync(path.join(ROOT, 'cli/package-lock.json')) && !fs.existsSync(path.join(ROOT, 'cli/node_modules')));
t('the files list is exactly bin, src, README, CHANGELOG and LICENSE', JSON.stringify(pkg.files) === JSON.stringify(['bin', 'src', 'README.md', 'CHANGELOG.md', 'LICENSE']));
const pk = cp.spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: path.join(ROOT, 'cli'), encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, { npm_config_loglevel: 'silent' }) });
let packed = []; try { packed = JSON.parse(pk.stdout)[0].files.map((f) => f.path).sort(); } catch (e) { /* reported below */ }
t('npm pack lists only the intended files (' + packed.length + ')', packed.length > 0 && packed.every((f) => /^(bin\/|src\/|README\.md$|CHANGELOG\.md$|LICENSE$|package\.json$)/.test(f)) && packed.indexOf('bin/citehound.js') !== -1 && packed.indexOf('package.json') !== -1 && !packed.some((f) => /test|fixture/.test(f)), pk.stderr.slice(0, 200) + packed.join());
t('the CHANGELOG has an entry for the version in package.json, and the LICENSE is MIT', new RegExp('^## ' + pkg.version.replace(/\./g, '\\.') + '$', 'm').test(read('cli/CHANGELOG.md')) && /^MIT License/.test(read('cli/LICENSE')));

// The source.
const src = fs.readdirSync(path.join(ROOT, 'cli/src')).map((f) => read('cli/src/' + f).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '')).join('\n') + read('cli/bin/citehound.js');
t('the source has no require of a package (only its own files and node:*) and no eval', !/require\((['"])(?!\.\.?\/|node:|fs|path|os|http|https)[^'"]+\1\)/.test(src) && !/\beval\(|new Function|child_process/.test(src));
t('the only address in the source is Citehound\'s (https://getcitehound.com), and the key is read from CITEHOUND_API_KEY only', (src.match(/https?:\/\/[a-z0-9.-]+/gi) || []).every((u) => /getcitehound\.com|example\.com|schema\.org/.test(u)) && /env\.CITEHOUND_API_KEY/.test(src) && !/readFile|writeFile|appendFile|localStorage|homedir/.test(src));
t('the key is never passed to a print or a log: output goes through redact(), console is not used, no stack is printed', !/console\.(log|error|warn|info|debug|trace)/.test(src) && !/\.stack\b/.test(src) && /redact\(e\.message\)/.test(src) && /process\.stderr\.write\('citehound: something went wrong/.test(src));
t('the CLI sends no analytics: its only requests are the API (GET /v1) and the public MCP endpoint (POST /api/mcp)', (src.match(/send\('(GET|POST)', [^,]+/g) || []).length === 2 && /base \+ '\/v1'/.test(src) && /base \+ '\/api\/mcp'/.test(src));

// The README.
const R = read('cli/README.md');
t('the README has the three usage examples, the key section, the exit codes and the readiness sentence', /### 1\. Score a site/.test(R) && /### 2\. Fail a build/.test(R) && /### 3\. Write the files/.test(R) && /CITEHOUND_API_KEY/.test(R) && /https:\/\/getcitehound\.com\/api/.test(R) && /## Exit codes/.test(R) && /does not measure whether any assistant names a brand/.test(R));
t('the README says it is not on npm yet (until the owner publishes it) and says no dependencies, Node 18, MIT', /not on npm yet/.test(R) && /No dependencies/.test(R) && /Node\.js 18/.test(R) && /MIT/.test(R));
const NEG = /\b(not|never|nothing|no|nor|without|does not|doesn't)\b/i;
const positive = R.split('\n').filter((l) => !NEG.test(l)).join('\n');
const hit = /\b(recommend\w*|cites?|cited|ranks?|ranking\w*|guarantee\w*|boost\w*|unlimited|official\w*|verified|partner\w*|visibility)\b/i.exec(positive);
t('the README uses no recommend, cite, rank, guarantee, boost, official, verified, partner or visibility outside a sentence that denies it, and promises no outcome', !hit && !/will (increase|improve|boost|raise|get you|make)|more (traffic|citations|revenue)/i.test(positive), hit && hit[0]);
t('the README and the help use none of the banned voice words', !/\b(unlock|seamless(ly)?|powerful|robust|crucial|delve|supercharge|game-changing|revolutioni[sz]e|effortless|elevate|landscape|quietly|actually)\b/i.test(R + read('cli/src/cli.js')));

// The workflow and the site.
const wf = read('.github/workflows/publish-cli.yml');
t('the publish workflow runs only on a cli-v* tag, with id-token write and --provenance, and checks the tag against the version', /tags:\s*\n\s*- 'cli-v\*'/.test(wf) && !/pull_request|branches:|schedule:|workflow_dispatch/.test(wf) && /id-token: write/.test(wf) && /npm publish --provenance --access public/.test(wf) && /does not match version/.test(wf) && /secrets\.NPM_TOKEN/.test(wf) && !/NPM_TOKEN: *[A-Za-z0-9]{10}/.test(wf));
t('the CLI is kept off the deployed site (.vercelignore)', /^cli\/$/m.test(read('.vercelignore')));
const claudePage = read('claude.html').replace(/<[^>]+>/g, ' ');
t('the site says "In preparation" about the CLI and the plugin and does not say they are live', /In preparation/.test(claudePage) && !/npx citehound|npm install|npm i -g|\/plugin install|marketplace add/i.test(read('claude.html') + read('llms.txt') + read('index.html') + read('api.html')));

out('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { fails.forEach((f) => out('FAIL: ' + f)); process.exit(1); }
