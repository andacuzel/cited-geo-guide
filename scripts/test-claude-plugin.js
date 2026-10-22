#!/usr/bin/env node
/* =====================================================================
   scripts/test-claude-plugin.js

   The Claude plugin in claude-plugin/ (with the marketplace file .claude-plugin/marketplace.json at the repository root, which makes it installable from this repository):
   - the manifest, the MCP file and the marketplace parse and agree (name, version, source, the MCP address from site.config.json);
   - the three skills exist, have a name equal to their folder and a description, and call only tools that the MCP registry (api/mcp.js) really has;
   - the words follow docs/integrations/RULES.md: no recommend, cite, rank, guarantee, boost, official, verified or partner outside a sentence that denies it, no outcome promise, and the
     readiness sentence is in the README and in the scan and compare skills; no logo or image;
   - the licence is MIT and the README has the install steps;
   - `claude plugin validate` passes when the Claude Code CLI is on this machine (it is looked for on the PATH and in the desktop app's folder; skipped, and said so, when it is not).
   The site says "In preparation" about the plugin until the owner publishes it (scripts/generate-claude-page.js checks that).

     node scripts/test-claude-plugin.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const site = require('../lib/site-config.js');
const mcp = require('../api/mcp.js');

let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

const plugin = JSON.parse(read('claude-plugin/.claude-plugin/plugin.json'));
const mcpFile = JSON.parse(read('claude-plugin/.mcp.json'));
const market = JSON.parse(read('.claude-plugin/marketplace.json'));
const SKILLS = ['scan-my-site', 'fix-ai-crawler-access', 'compare-with-competitor'];

t('the manifest names the plugin "citehound", has a semantic version, a description, MIT, the contact address and the repository', plugin.name === 'citehound' && /^\d+\.\d+\.\d+$/.test(plugin.version) && plugin.description.length > 40 && plugin.license === 'MIT' && plugin.author.email === site.contactEmail && /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(plugin.repository));
t('.mcp.json points at the site\'s MCP address and nothing else', Object.keys(mcpFile.mcpServers).join() === 'citehound' && mcpFile.mcpServers.citehound.type === 'http' && mcpFile.mcpServers.citehound.url === site.baseUrl + '/api/mcp' && !JSON.stringify(mcpFile).match(/key|token|secret|authorization/i));
t('the marketplace lists exactly this plugin from ./claude-plugin with the same name and version', market.plugins.length === 1 && market.plugins[0].name === plugin.name && market.plugins[0].source === './claude-plugin' && market.plugins[0].version === plugin.version && market.owner.email === site.contactEmail);
t('there are exactly three skills, the three asked for', fs.readdirSync(path.join(ROOT, 'claude-plugin/skills')).sort().join() === SKILLS.slice().sort().join());

const tools = mcp.TOOLS.map((x) => x.name);
const allText = [];
SKILLS.forEach((s) => {
  const src = read('claude-plugin/skills/' + s + '/SKILL.md');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(src);
  const name = fm && /^name: (.+)$/m.exec(fm[1]), desc = fm && /^description: (.+)$/m.exec(fm[1]);
  t(s + ': the front matter has name = folder and a description of 60 to 400 characters that says when to use it', !!name && name[1] === s && !!desc && desc[1].length >= 60 && desc[1].length <= 400 && /\bUse when\b/.test(desc[1]));
  const used = Array.from(new Set((src.match(/`([a-z_]+)`/g) || []).map((x) => x.slice(1, -1)).filter((x) => /_/.test(x) && !/-/.test(x))));
  const callable = used.filter((x) => /^(scan_site|compare_sites|generate_[a-z_]+|list_ai_crawlers|get_[a-z_]+)$/.test(x));
  t(s + ': every tool it names exists in the MCP registry (' + callable.join(', ') + ')', callable.length > 0 && callable.every((x) => tools.indexOf(x) !== -1), callable.filter((x) => tools.indexOf(x) === -1).join());
  t(s + ': it names no skill that does not exist', (src.match(/`(scan-my-site|fix-ai-crawler-access|compare-with-competitor|[a-z]+-[a-z-]+)`/g) || []).every((x) => SKILLS.indexOf(x.slice(1, -1)) !== -1 || !/^`(scan|fix|compare)-/.test(x)));
  allText.push(src);
});
t('the scan and compare skills use the tools they promise (scan_site; compare_sites)', /`scan_site`/.test(read('claude-plugin/skills/scan-my-site/SKILL.md')) && /`compare_sites`/.test(read('claude-plugin/skills/compare-with-competitor/SKILL.md')) && ['generate_robots_txt', 'generate_llms_txt', 'generate_schema', 'list_ai_crawlers'].every((x) => new RegExp('`' + x + '`').test(read('claude-plugin/skills/fix-ai-crawler-access/SKILL.md'))));
t('the readiness sentence is in the README and the scan and compare skills', /does not measure whether any assistant names a brand/.test(read('claude-plugin/README.md')) && /does not show whether any assistant names/.test(read('claude-plugin/skills/scan-my-site/SKILL.md')) && /does not mean any assistant prefers/.test(read('claude-plugin/skills/compare-with-competitor/SKILL.md')));
t('the fix skill asks before blocking and tells the user where each file goes (root, head), and says llms.txt has no demonstrated effect on Google', /Ask before blocking/.test(read('claude-plugin/skills/fix-ai-crawler-access/SKILL.md')) && /site root/.test(read('claude-plugin/skills/fix-ai-crawler-access/SKILL.md')) && /<head>/.test(read('claude-plugin/skills/fix-ai-crawler-access/SKILL.md')) && /no demonstrated effect on Google/.test(read('claude-plugin/skills/fix-ai-crawler-access/SKILL.md')));

const docs = allText.concat([read('claude-plugin/README.md'), read('claude-plugin/.claude-plugin/plugin.json'), read('.claude-plugin/marketplace.json')]).join('\n');
const NEG = /\b(not|never|nothing|no|nor|without|don't|doesn't)\b/i;
const positive = docs.replace(/cited-geo-guide/g, 'repository').split('\n').filter((l) => !NEG.test(l)).join('\n');   // the repository's name has "cited" in it
const hit = /\b(recommend\w*|cites?|cited|ranks?|ranking\w*|guarantee\w*|boost\w*|unlimited|official\w*|verified|partner\w*|certified)\b/i.exec(positive);
t('no recommend, cite, rank, guarantee, boost, official, verified or partner outside a sentence that denies it', !hit, hit && hit[0]);
t('no outcome promise (will increase, will improve, will get you, more traffic, more citations)', !/will (increase|improve|boost|raise|get you|make)|more (traffic|citations|revenue|visitors)|rank higher|show up in/i.test(positive));
t('no banned voice words (unlock, seamless, powerful, robust, crucial, delve, supercharge, game-changing, revolutionize, effortless, elevate, landscape)', !/\b(unlock|seamless(ly)?|powerful|robust|crucial|delve|supercharge|game-changing|revolutioni[sz]e|effortless|elevate|landscape|quietly|actually)\b/i.test(docs));
t('no third-party names used as a claim and no image or logo files in the plugin', !/\b(OpenAI|ChatGPT|Perplexity|Gemini|Zapier)\b/.test(positive.replace(/Anthropic/g, '')) && !fs.readdirSync(path.join(ROOT, 'claude-plugin')).some((f) => /\.(png|jpe?g|svg|gif|webp|ico)$/i.test(f)));
t('the licence is MIT', /^MIT License/.test(read('claude-plugin/LICENSE')) && /Permission is hereby granted/.test(read('claude-plugin/LICENSE')));
const R = read('claude-plugin/README.md');
t('the README has the install steps (add the marketplace, install, try it), the local test command and the status line', /\/plugin marketplace add andacuzel\/cited-geo-guide/.test(R) && /\/plugin install citehound@citehound/.test(R) && /\/citehound:scan-my-site/.test(R) && /--plugin-dir/.test(R) && /not listed in any plugin directory/.test(R));
t('the plugin is kept off the deployed site (.vercelignore)', /^claude-plugin\/$/m.test(read('.vercelignore')) && /^\.claude-plugin\/$/m.test(read('.vercelignore')));

// The Claude Code CLI, if this machine has it.
function findClaude() {
  const tries = ['claude'];
  try { const base = path.join(os.homedir(), 'Library/Application Support/Claude/claude-code'); fs.readdirSync(base).sort().reverse().forEach((v) => { const d = path.join(base, v); try { fs.readdirSync(d).forEach((h) => tries.push(path.join(d, h, 'claude.app/Contents/MacOS/claude'))); } catch (e) { /* skip */ } }); } catch (e) { /* none */ }
  for (const c of tries) { const r = cp.spawnSync(c, ['--version'], { encoding: 'utf8', timeout: 20000 }); if (r.status === 0 && /Claude Code/.test(r.stdout)) return c; }
  return null;
}
const claude = findClaude();
if (!claude) out('  skip claude plugin validate: the Claude Code CLI was not found on this machine (the JSON checks above still ran)');
else {
  const v = (p) => cp.spawnSync(claude, ['plugin', 'validate', p, '--strict'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  const a = v('claude-plugin'), b = v('.'), c = v('claude-plugin/skills');
  t('claude plugin validate --strict passes for the plugin, the marketplace and the skills', a.status === 0 && b.status === 0 && c.status === 0, (a.stdout + b.stdout + c.stdout).replace(/\s+/g, ' ').slice(0, 300));
}

out('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { fails.forEach((f) => out('FAIL: ' + f)); process.exit(1); }
