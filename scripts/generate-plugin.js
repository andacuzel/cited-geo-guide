#!/usr/bin/env node
/* =====================================================================
   scripts/generate-plugin.js

   Writes the files in plugin/ that quote the site's address, from
   site.config.json (via lib/site-config.js), so a domain change is one
   command:
     plugin/.claude-plugin/plugin.json   the manifest
     plugin/.mcp.json                    the MCP server the skills use
     plugin/README.md                    what is in the bundle and what is unconfirmed
   The three skills (plugin/skills/<name>/SKILL.md) are written by hand and carry
   no address. scripts/check-mcp-drift.js checks that every tool they name is
   in the registry.

     node scripts/generate-plugin.js            write the files
     node scripts/generate-plugin.js --check    exit 1 if any is out of date
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const site = require('../lib/site-config.js');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN = path.join(ROOT, 'plugin');

function manifest() {
  return {
    name: 'citehound',
    displayName: 'Citehound',
    version: '1.0.0',
    description: 'Audit a site for AI readiness, check a store for agentic-commerce readiness, and write citation-ready content, with the Citehound MCP server and three skills.',
    author: { name: 'Andaç Üzel', url: site.baseUrl + '/about' },
    homepage: site.baseUrl + '/mcp',
    keywords: ['ai-readiness', 'geo', 'aeo', 'robots-txt', 'llms-txt', 'structured-data', 'agentic-commerce'],
    documentationUrl: site.baseUrl + '/mcp',
    supportUrl: site.baseUrl + '/trust',
    privacyPolicyUrl: site.baseUrl + '/privacy',
    termsOfServiceUrl: site.baseUrl + '/terms'
  };
}

function mcpConfig() {
  return { mcpServers: { citehound: { type: 'http', url: site.baseUrl + '/api/mcp' } } };
}

function readme() {
  const url = site.baseUrl + '/api/mcp';
  return [
    '# Citehound plugin',
    '',
    'A Claude Code plugin that connects the Citehound MCP server and adds three skills.',
    '',
    '## What is in it',
    '',
    '- `.mcp.json`: the remote MCP server at `' + url + '`. No key, no account.',
    '- `skills/geo-audit`: audit a site for AI readiness and return an ordered plan.',
    '- `skills/agentic-commerce-readiness`: check a store for UCP, product schema and llms.txt authorship.',
    '- `skills/citation-ready-content`: brief or review content for citability with a vertical playbook. No scan.',
    '',
    'Every skill names the MCP tools it uses. They are read from the server\'s registry and checked by `scripts/check-mcp-drift.js`.',
    '',
    '## Try it',
    '',
    '```bash',
    'claude plugin validate ./plugin',
    'claude --plugin-dir ./plugin',
    '```',
    '',
    'Then ask: "Audit example.com for AI readiness."',
    '',
    '## What it measures',
    '',
    'Readiness: whether AI crawlers can reach and read a site, and whether its signals give a model a reason to trust it. It does not measure whether any assistant names a brand, and a high score does not guarantee a mention.',
    '',
    '## Unconfirmed',
    '',
    'The layout follows Anthropic\'s published plugin reference: a manifest at `.claude-plugin/plugin.json`, skills under `skills/<name>/SKILL.md`, and `.mcp.json` at the plugin root with an `http` server. What could not be confirmed from the documentation:',
    '',
    '- How a client other than Claude Code names the server\'s tools. Claude Code scopes plugin tools as `mcp__plugin_<plugin>_<server>__<tool>`. The skills use the bare tool names and say so.',
    '- The submission route for Anthropic\'s plugin directory and its review criteria. The manifest carries the listing fields (`documentationUrl`, `supportUrl`, `privacyPolicyUrl`, `termsOfServiceUrl`) but no `icon`, because the accepted image size is not stated.',
    '- A license. None is declared, because none has been chosen.',
    ''
  ].join('\n');
}

const FILES = {
  'plugin/.claude-plugin/plugin.json': () => JSON.stringify(manifest(), null, 2) + '\n',
  'plugin/.mcp.json': () => JSON.stringify(mcpConfig(), null, 2) + '\n',
  'plugin/README.md': readme
};

function main() {
  const check = process.argv.indexOf('--check') !== -1;
  let bad = 0;
  Object.keys(FILES).forEach((rel) => {
    const file = path.join(ROOT, rel);
    const text = FILES[rel]();
    if (check) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { console.error(rel + ' is out of date; run node scripts/generate-plugin.js'); bad++; }
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text, 'utf8');
      console.log(rel + ' written');
    }
  });
  if (check) {
    if (bad) process.exit(1);
    // The manifest and the MCP config parse, and the skills carry the fields the docs require.
    JSON.parse(fs.readFileSync(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'));
    JSON.parse(fs.readFileSync(path.join(PLUGIN, '.mcp.json'), 'utf8'));
    const skills = fs.readdirSync(path.join(PLUGIN, 'skills'));
    skills.forEach((d) => {
      const f = path.join(PLUGIN, 'skills', d, 'SKILL.md');
      const text = fs.readFileSync(f, 'utf8');
      const m = /^---\nname: ([a-z0-9-]+)\ndescription: ([\s\S]*?)\n---\n/.exec(text);
      if (!m) { console.error(f + ': frontmatter must open the file with name and description'); process.exit(1); }
      if (m[1] !== d) { console.error(f + ': name must equal the directory name'); process.exit(1); }
      if (m[2].length > 1536) { console.error(f + ': description is over 1,536 characters'); process.exit(1); }
      if (text.split('\n').length >= 120) { console.error(f + ': 120 lines or more'); process.exit(1); }
    });
    console.log('OK: plugin manifest and MCP config are current and parse; ' + skills.length + ' skills have valid frontmatter and stay under 120 lines');
  }
}

if (require.main === module) main();
module.exports = { manifest, mcpConfig };
