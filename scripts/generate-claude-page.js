#!/usr/bin/env node
/* =====================================================================
   scripts/generate-claude-page.js

   Writes claude.html (/claude): how to connect Citehound's remote MCP server to Claude (and Claude Code, Cursor, VS Code), what to ask, the tools, what it does not do,
   a short FAQ. It also keeps the sitemap and llms.txt entries. The address, the tool names and the read-only marks come from api/mcp.js (the registry), the one-line
   descriptions from content/mcp-copy.json, the contact address from site.config.json: nothing is typed twice. Edit this file, never the page.

   The setup steps were checked against the vendors' own documentation on 22 Oct 2026 (support.claude.com "Get started with custom connectors using remote MCP",
   code.claude.com/docs/en/mcp, cursor.com/docs/context/mcp, code.visualstudio.com/docs/copilot/customization/mcp-servers). A step the documentation did not state is not here:
   no Cursor menu path, no VS Code JSON.

   --check fails if the page is out of date, if a tool is not read-only or has no line, if the page makes a claim the brief forbids (a recommendation, a partner, an
   integration that does not exist, a guarantee), if it has no single H1, if a title or description is too long, if the JSON-LD does not parse, if an internal link points
   at a page that does not exist, or if the sitemap, llms.txt, the footer or the homepage button do not point here.

     node scripts/generate-claude-page.js            write the page and the sitemap and llms.txt entries
     node scripts/generate-claude-page.js --check    exit 1 on any mismatch
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const shell = require('../lib/page-shell.js');
const site = require('../lib/site-config.js');
const mcp = require('../api/mcp.js');
const copy = require('../content/mcp-copy.json');

const ROOT = path.resolve(__dirname, '..');
const CSS_VERSION = 103;
const esc = shell.esc;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const URL_MCP = site.baseUrl + '/api/mcp';
const N = mcp.TOOLS.length;

const TITLE = 'Citehound for Claude: connect the free MCP server';
const DESC = 'Connect Citehound to Claude as a custom connector. Scan a domain’s AI readiness and generate llms.txt and robots.txt. Free and read-only.';
const H1 = 'Ask Claude about your site’s AI readiness';

// Prompts a person could type, each tied to the tool that answers it.
const PROMPTS = [
  ['Scan example.com and tell me what to fix first.', 'scan_site'],
  ['Compare mysite.com with a competitor’s site. Where do they differ?', 'compare_sites'],
  ['Write an llms.txt for my business. We make project software for small design studios.', 'generate_llms_txt'],
  ['Write a robots.txt that allows ClaudeBot and GPTBot and blocks Bytespider, and name my sitemap.', 'generate_robots_txt'],
  ['Give me Organization JSON-LD for example.com.', 'generate_schema'],
  ['Show me the crawler access study and tell me what stands out.', 'get_research'],
  ['What is the average AI readiness score for CRM software, and which checks do most sites fail?', 'get_benchmark'],
  ['Which AI crawlers does Citehound track, and what does blocking each one mean?', 'list_ai_crawlers']
];

const FAQ = [
  ['Is it free?', 'Yes. All ' + N + ' tools are free, with no account and no key. The tools that scan a live site are limited per domain, so one site is not fetched over and over. Claude’s own plan decides how many custom connectors you can add: the Free plan allows one.'],
  ['Does it store anything?', 'Nothing about who you are. The server keeps short-lived counters keyed by a one-way hash of the scanned domain, which expire within an hour, to limit repeated fetches of one site.'],
  ['What data does it send?', 'Claude sends Citehound the arguments of each tool call, such as a domain or a category name. The three tools that scan a live site (scan_site, compare_sites and generate_schema) fetch that domain’s public robots.txt, llms.txt, sitemap and homepage. The other ' + (N - 3) + ' read Citehound’s own files and fetch nothing.'],
  ['Which clients work?', 'Claude on the web and desktop, Claude Code, Cursor and VS Code are covered above. Another client that supports remote MCP servers over HTTP can use the same address. In Claude, Team and Enterprise owners add a custom connector for the organization first, then members connect to it.']
];

const STEPS_CLAUDE = [
  'Open <strong>Customize</strong>, then <strong>Connectors</strong>.',
  'Click <strong>+ Add</strong>, then <strong>Add custom connector</strong>.',
  'Enter the name <strong>Citehound</strong> and paste the server address from above. Click <strong>Continue</strong>.',
  'If Claude shows an authentication setting, choose <strong>No sign in</strong>. Citehound needs none. Then click <strong>Add</strong>.',
  'In a chat, click the <strong>+</strong> button at the lower left, open <strong>Connectors</strong> and switch Citehound on for that conversation.'
];

function copyBox(id, label, value, btnText) {
  return '        <div class="cl-copy" data-copy-wrap>\n          <div class="mcp-url">\n            <label class="mcp-vh" for="' + id + '">' + esc(label) + '</label>\n            <input id="' + id + '" class="mcp-url__field" type="text" readonly value="' + esc(value) + '" spellcheck="false" />\n' +
    '            <button type="button" class="btn btn--gold cl-copybtn" data-copy-from="#' + id + '" data-copied="Copied" hidden>' + esc(btnText) + '</button>\n          </div>\n          <p class="cl-status" role="status" aria-live="polite"></p>\n        </div>\n';
}

function snippet(id, label, code) {
  return '            <div class="fix-snippet" data-copy-wrap>\n              <div class="fix-snippet__head">\n                <span class="fix-snippet__label">' + esc(label) + '</span>\n                <div class="fix-snippet__actions"><button type="button" class="btn btn--ghost-on-navy cl-copybtn" data-copy-from="#' + id + '" data-copied="Copied" hidden>Copy</button></div>\n              </div>\n' +
    '              <pre class="fix-snippet__code" id="' + id + '">' + esc(code) + '</pre>\n              <p class="cl-status cl-status--on-navy" role="status" aria-live="polite"></p>\n            </div>\n';
}

function head(kicker, id, title, sub) {
  return '        <div class="section-head">\n          <p class="kicker">' + esc(kicker) + '</p>\n          <h2 id="' + id + '" class="section-title">' + esc(title) + '</h2>\n' + (sub ? '          <p class="section-sub">' + sub + '</p>\n' : '') + '        </div>\n';
}

// The public-page rules keep the words "citation run" off every page but /mcp, so this one tool is described a little differently here.
const LINE_OVERRIDE = { get_citation_sample: 'See a real, anonymized sample of a citation check, with the spread shown.' };

function body() {
  const cursor = JSON.stringify({ mcpServers: { citehound: { url: URL_MCP } } }, null, 2);
  const toolRows = mcp.TOOLS.map((t) => {
    const line = LINE_OVERRIDE[t.name] || (copy.tools[t.name] || {}).line;
    return '            <tr><th scope="row" data-label="Tool"><code>' + esc(t.name) + '</code></th><td data-label="What it does">' + esc(line) + '</td><td data-label="Access">Read-only</td></tr>';
  }).join('\n');
  return '    <section aria-labelledby="hero-heading">\n      <div class="section__inner">\n        <div class="page-banner">\n          <div class="page-banner__body">\n            <p class="kicker kicker--on-navy">Claude connector</p>\n' +
    '            <h1 id="hero-heading" class="page-banner__title">' + esc(H1) + '</h1>\n' +
    '            <p class="page-banner__desc">Citehound’s connector lets Claude scan a domain’s robots.txt, llms.txt, sitemap and homepage, then generate the files that close the gaps. It is free and read-only, and it needs no account.</p>\n' +
    '          </div>\n        </div>\n      </div>\n    </section>\n\n' +

    '    <section class="cl-sec hp-light" id="connect" aria-labelledby="connect-heading">\n      <div class="section__inner">\n' + head('Connect it', 'connect-heading', 'Add the server address to Claude.', 'No key, no account. This is the address of the Citehound MCP server.') +
    copyBox('claudeUrl', 'Server address', URL_MCP, 'Copy address') +
    '        <h3 class="cl-h3">Claude on the web and desktop</h3>\n        <ol class="mcp-steps cl-steps">\n' + STEPS_CLAUDE.map((s) => '          <li>' + s + '</li>').join('\n') + '\n        </ol>\n' +
    '        <p class="cl-note">On Team and Enterprise plans an owner adds the connector first, under <strong>Organization settings</strong>, <strong>Connectors</strong>, <strong>Add</strong>, <strong>Custom</strong>, <strong>Web</strong>. Members then open <strong>Customize</strong>, <strong>Connectors</strong> and click <strong>Connect</strong>.</p>\n' +
    '        <div class="ac-faq cl-clients">\n          <details>\n            <summary>Claude Code</summary>\n            <p>Run this once in a terminal, then check the connection with <code>claude mcp list</code>, or type <code>/mcp</code> inside a session.</p>\n' +
    snippet('claudeCodeCmd', 'Terminal', 'claude mcp add --transport http citehound ' + URL_MCP) + '          </details>\n' +
    '          <details>\n            <summary>Cursor</summary>\n            <p>Add this to <code>.cursor/mcp.json</code> in a project, or to <code>~/.cursor/mcp.json</code> to use it in every project.</p>\n' + snippet('cursorJson', '.cursor/mcp.json', cursor) + '          </details>\n' +
    '          <details>\n            <summary>VS Code</summary>\n            <ol class="mcp-steps">\n              <li>Open the Command Palette and run <strong>MCP: Add Server</strong>.</li>\n              <li>Choose <strong>HTTP (HTTP or Server-Sent Events)</strong>.</li>\n              <li>Paste the server address from above, then enter a server ID, for example <code>citehound</code>.</li>\n            </ol>\n          </details>\n        </div>\n' +
    '      </div>\n    </section>\n\n' +

    '    <section class="cl-sec hp-light" id="ask" aria-labelledby="ask-heading">\n      <div class="section__inner">\n' + head('What you can ask', 'ask-heading', 'Eight things to type.') +
    '        <ul class="cl-prompts">\n' + PROMPTS.map((p) => '          <li class="cl-prompt"><p class="cl-prompt__text">“' + esc(p[0]) + '”</p><p class="cl-prompt__tool"><code>' + esc(p[1]) + '</code></p></li>').join('\n') + '\n        </ul>\n' +
    '      </div>\n    </section>\n\n' +

    '    <section class="cl-sec hp-light" id="tools" aria-labelledby="tools-heading">\n      <div class="section__inner">\n' + head('Tools', 'tools-heading', 'The ' + N + ' tools.', 'Every tool is read-only: it reads, calculates or writes text for you to use. None of them changes a site.') +
    '        <div class="cl-tablewrap">\n          <table class="cl-table">\n            <caption class="mcp-vh">The ' + N + ' tools of the Citehound MCP server</caption>\n            <thead><tr><th scope="col">Tool</th><th scope="col">What it does</th><th scope="col">Access</th></tr></thead>\n            <tbody>\n' + toolRows + '\n            </tbody>\n          </table>\n        </div>\n' +
    '      </div>\n    </section>\n\n' +

    '    <section class="cl-sec hp-light" id="limits" aria-labelledby="limits-heading">\n      <div class="section__inner">\n' + head('Limits', 'limits-heading', 'What it does not do.') +
    '        <p class="cl-limits">The connector measures readiness: whether crawlers can reach a site and whether its pages carry signals a model can read. It does not measure whether any assistant names a brand. It has no Pro or signed-in layer yet.</p>\n' +
    '      </div>\n    </section>\n\n' +

    '    <section class="home-faq hp-light" id="faq" aria-labelledby="faq-heading">\n      <div class="section__inner">\n' + head('Questions', 'faq-heading', 'Before you connect.') +
    '        <div class="ac-faq">\n' + FAQ.map((f) => '          <details>\n            <summary>' + esc(f[0]) + '</summary>\n            <p>' + esc(f[1]) + '</p>\n          </details>').join('\n') + '\n        </div>\n      </div>\n    </section>\n\n' +

    '    <section class="home-close hp-light" aria-labelledby="close-heading">\n      <div class="section__inner">\n        <div class="home-close__panel">\n          <div>\n            <h2 id="close-heading" class="home-close__title">Prefer to start in the browser?</h2>\n            <p class="home-close__text">The scan takes about 30 seconds and needs no email.</p>\n          </div>\n          <div class="home-close__actions">\n            <a class="btn btn--primary" href="/#scan">Run the free scan</a>\n            <a class="home-close__link" href="/sample-report">See the sample report</a>\n          </div>\n        </div>\n        <p class="cl-contact">Questions, or a client that will not connect: <a href="mailto:' + esc(site.contactEmail) + '">' + esc(site.contactEmail) + '</a></p>\n      </div>\n    </section>\n';
}

function build() {
  const ld = [
    { '@context': 'https://schema.org', '@type': 'WebPage', name: TITLE, description: DESC, url: site.baseUrl + '/claude', publisher: { '@id': site.baseUrl + '/#org' } },
    { '@context': 'https://schema.org', '@type': 'HowTo', name: 'Add the Citehound MCP server to Claude as a custom connector', description: 'Add the server address ' + URL_MCP + ' as a custom connector in Claude. No account or key is needed.',
      step: STEPS_CLAUDE.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, text: s.replace(/<[^>]+>/g, '') })) },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f[0], acceptedAnswer: { '@type': 'Answer', text: f[1] } })) }
  ];
  return shell.page({
    title: TITLE, description: DESC, path: '/claude', cssVersion: CSS_VERSION,
    headExtra: '  <script src="/claude.js?v=1" defer></script>\n', jsonld: ld, body: body()
  });
}

function ensureSitemap() {
  const file = path.join(ROOT, 'sitemap.xml'), xml = fs.readFileSync(file, 'utf8'), loc = site.baseUrl + '/claude';
  if (xml.indexOf('<loc>' + loc + '</loc>') !== -1) return false;
  fs.writeFileSync(file, xml.replace('</urlset>', '  <url>\n    <loc>' + loc + '</loc>\n  </url>\n</urlset>'), 'utf8');
  return true;
}

const LLMS_LINE = '- [Claude connector](' + site.baseUrl + '/claude): how to add the Citehound MCP server to Claude, Claude Code, Cursor and VS Code, with example prompts and the ' + N + ' read-only tools. Free, no account.\n';
function ensureLlms() {
  const file = path.join(ROOT, 'llms.txt'), t = fs.readFileSync(file, 'utf8');
  const re = /^- \[Claude connector\]\([^)]*\)[^\n]*\n/m;
  if (re.test(t)) { const n = t.replace(re, LLMS_LINE); if (n === t) return false; fs.writeFileSync(file, n, 'utf8'); return true; }
  const m = /^- \[MCP server\]\([^)]*\)[^\n]*\n/m.exec(t);
  if (!m) throw new Error('llms.txt has no MCP server line to put the Claude connector line after');
  fs.writeFileSync(file, t.replace(m[0], m[0] + LLMS_LINE), 'utf8');
  return true;
}

const visible = (html) => html.replace(/<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const FORBIDDEN = /\b(recommend(s|ed|ation|ations)?|cites|cited by|guarantee[sd]?|partners?|official(ly)?|WordPress|Webflow|GitHub|Shopify|Zapier|Wix|Squarespace|HubSpot|Slack|unlock|supercharge|seamless(ly)?|game-changing|revolutioni[sz]e|robust|crucial|delve|landscape|ranking|rankings|ranks)\b/i;

function pageExists(href) {
  const p = href.replace(/[?#].*$/, '');
  if (p === '' || p === '/') return true;
  if (/^\/(api|r|demo|w|admin)\b/.test(p)) return true;
  const rel = p.replace(/^\//, '').replace(/\/$/, '');
  return fs.existsSync(path.join(ROOT, rel + '.html')) || fs.existsSync(path.join(ROOT, rel, 'index.html')) || fs.existsSync(path.join(ROOT, rel));
}

function check() {
  const errors = [], bad = (m) => errors.push(m);
  const page = fs.existsSync(path.join(ROOT, 'claude.html')) ? read('claude.html') : '';
  if (page !== build()) bad('claude.html is out of date; run node scripts/generate-claude-page.js');
  if (TITLE.length > 60) bad('the title is ' + TITLE.length + ' characters, over 60');
  if (DESC.length > 155) bad('the description is ' + DESC.length + ' characters, over 155');
  if ((page.match(/<h1[ >]/g) || []).length !== 1) bad('needs exactly one h1');
  if (!/name="robots" content="index, follow"/.test(page) || !/<link rel="canonical" href="https:\/\/getcitehound\.com\/claude" \/>/.test(page)) bad('must be indexable with its canonical address');
  ['og:title', 'og:description', 'og:image'].forEach((p) => { if (!new RegExp('property="' + p + '" content="[^"]+"').test(page)) bad('missing ' + p); });
  ['twitter:title', 'twitter:description', 'twitter:image'].forEach((p) => { if (!new RegExp('name="' + p + '" content="[^"]+"').test(page)) bad('missing ' + p); });
  (page.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []).forEach((b) => { try { JSON.parse(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { bad('JSON-LD does not parse: ' + e.message); } });
  if (!/"@type": "HowTo"/.test(page)) bad('no HowTo JSON-LD');
  mcp.TOOLS.forEach((t) => {
    if (!(t.annotations && t.annotations.readOnlyHint === true && t.annotations.destructiveHint === false)) bad(t.name + ' is not marked read-only in api/mcp.js, so the page may not call it read-only');
    if (!((copy.tools[t.name] || {}).line)) bad(t.name + ' has no line in content/mcp-copy.json');
    if (page.indexOf('<code>' + t.name + '</code>') === -1) bad('the tools table has no ' + t.name);
  });
  PROMPTS.forEach((p) => { if (!mcp.TOOLS.some((t) => t.name === p[1])) bad('the prompt for ' + p[1] + ' names a tool that does not exist'); });
  const text = visible(page.replace(/<header class="site-header">[\s\S]*?<\/header>/, '').replace(/<footer[\s\S]*?<\/footer>/, ''));
  const hit = FORBIDDEN.exec(text);
  if (hit) bad('a word the brief forbids is on the page: "' + hit[0] + '"');
  if (/\bChatGPT\b|\bOpenAI\b/.test(text)) bad('the page names ChatGPT or OpenAI; it is about the Claude connector');
  if ((text.match(/—|&mdash;/g) || []).length > 2) bad('too many em dashes for the voice');
  if (page.indexOf('value="' + URL_MCP + '"') === -1) bad('the server address is not the registry\'s (' + URL_MCP + ')');
  if (page.indexOf('mailto:' + site.contactEmail) === -1) bad('no contact line');
  if (!/data-copy-from=/.test(page) || !/role="status" aria-live="polite"/.test(page)) bad('the copy buttons need their live region');
  (page.match(/href="(\/[^"]*)"/g) || []).forEach((m) => { const h = m.slice(6, -1); if (!pageExists(h)) bad('an internal link points at a page that does not exist: ' + h); });
  if (read('sitemap.xml').indexOf('<loc>' + site.baseUrl + '/claude</loc>') === -1) bad('sitemap.xml has no /claude');
  if (read('llms.txt').indexOf('(' + site.baseUrl + '/claude)') === -1) bad('llms.txt has no /claude');
  if (require('../lib/site-footer.js').hrefs().indexOf('/claude') === -1) bad('the footer has no /claude link');
  const home = read('index.html');
  if (!/<a href="\/claude" class="btn btn--gold">Connect the MCP server<\/a>/.test(home)) bad('the homepage "Connect the MCP server" button must link to /claude');
  return errors;
}

function main() {
  if (process.argv.indexOf('--check') !== -1) {
    const errors = check();
    if (errors.length) { errors.forEach((e) => console.error('FAIL: ' + e)); process.exit(1); }
    console.log('OK: /claude is current; the address and the ' + N + ' read-only tools come from the registry; no forbidden claim; one h1; JSON-LD parses; internal links resolve; in the sitemap, llms.txt, the footer and the homepage button');
    return;
  }
  fs.writeFileSync(path.join(ROOT, 'claude.html'), build(), 'utf8');
  console.log('written: claude.html' + (ensureSitemap() ? ', sitemap.xml entry' : '') + (ensureLlms() ? ', llms.txt entry' : ''));
}

if (require.main === module) main();
module.exports = { build: build, check: check };
