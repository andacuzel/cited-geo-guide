#!/usr/bin/env node
/* =====================================================================
   scripts/generate-mcp-page.js

   Writes mcp.html, the marketing page for the MCP server, from the registry
   (api/mcp.js TOOLS and PROMPTS), so nothing on it can drift:

     - tool and prompt counts, the live and content splits, the limits
     - one card per tool and per prompt, grouped by content/mcp-copy.json
     - the server URL, from site.config.json plus the MCP path
     - the excerpts, from content/mcp-examples.json (scripts/capture-mcp-examples.js)

   It stops if a registry tool or prompt has no copy entry or group, so a new
   tool cannot ship unclassified. The page chrome comes from lib/page-shell.js.

     node scripts/generate-mcp-page.js           write mcp.html
     node scripts/generate-mcp-page.js --check   exit 1 if mcp.html is out of date or breaks a rule
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const mcp = require('../api/mcp.js');
const mcpPrompts = require('../lib/mcp-prompts.js');
const limits = require('../lib/mcp-limits.js');
const site = require('../lib/site-config.js');
const icons = require('../lib/icons.js');
const shell = require('../lib/page-shell.js');

const FILE = path.join(ROOT, 'mcp.html');
const MCP_PATH = '/api/mcp';
const CSS_VERSION = 49;
const PROTOCOL_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18'];
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const word = (n) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso) => { const p = String(iso).slice(0, 10).split('-').map(Number); return MONTHS[p[1] - 1] + ' ' + p[2] + ', ' + p[0]; };
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const icon = (name, cls) => icons.svg(name, cls ? { cls: cls } : {});

const URL_FULL = site.baseUrl + MCP_PATH;

/* ---------- data ---------- */

function load() {
  const copy = readJson('content/mcp-copy.json');
  const ex = readJson('content/mcp-examples.json');
  const tools = mcp.TOOLS;
  const prompts = mcp.PROMPTS;
  const live = tools.filter((t) => t.annotations && t.annotations.openWorldHint).map((t) => t.name);
  const problems = [];
  tools.forEach((t) => {
    const c = copy.tools[t.name];
    if (!c || !c.line) problems.push('content/mcp-copy.json has no entry for the tool ' + t.name);
    else if (!copy.groups.some((g) => g.name === c.group)) problems.push('the tool ' + t.name + ' has no valid group in content/mcp-copy.json');
  });
  prompts.forEach((p) => { if (!copy.prompts[p.name] || !copy.prompts[p.name].line) problems.push('content/mcp-copy.json has no entry for the prompt ' + p.name); });
  Object.keys(copy.tools).forEach((n) => { if (!tools.some((t) => t.name === n)) problems.push('content/mcp-copy.json lists ' + n + ', which is not in the registry'); });
  Object.keys(copy.prompts).forEach((n) => { if (!prompts.some((p) => p.name === n)) problems.push('content/mcp-copy.json lists the prompt ' + n + ', which is not in the registry'); });
  copy.asks.forEach((a) => { if (!tools.some((t) => t.name === a.tool)) problems.push('the ask "' + a.text + '" names ' + a.tool + ', which is not in the registry'); });
  const byId = {};
  ex.examples.forEach((e) => { byId[e.id] = e; });
  if (problems.length) { problems.forEach((m) => console.error('FAIL: ' + m)); process.exit(1); }
  const sample = readJson('content/citations/sample-crm.json');
  return { copy, ex, byId, tools, prompts, live, sample };
}

function promptTools(p, tools) {
  const sample = {};
  p.arguments.forEach((a) => { sample[a.name] = a.name === 'domain' ? 'example.com' : a.name === 'vertical' ? 'crm' : 'Acme'; });
  const text = mcpPrompts.get(p.name, sample).messages[0].content.text;
  return tools.map((t) => t.name).filter((n) => new RegExp('\\b' + n + '\\b').test(text));
}

// Which captured example belongs on which tool card.
const TOOL_EXAMPLE = { scan_site: 'scan-self', get_methodology: 'methodology', get_benchmark: 'benchmark-crm', get_citation_sample: 'citation-sample', generate_schema: 'schema-self' };
const BANNER_EXAMPLE = 'scan-example';
const BANNER_LINES = 9;

/* ---------- pieces ---------- */

function bannerExcerpt(e) {
  const lines = e.lines.filter((l) => l.trim() !== '').slice(0, BANNER_LINES);
  return lines.map((l) => '<span class="mcp-excerpt__line' + (/^\s/.test(l) ? ' mcp-excerpt__line--in' : '') + '">' + esc(l.trim()) + '</span>').join('\n              ');
}

function banner(d) {
  const e = d.byId[BANNER_EXAMPLE];
  const check = icon('check', 'mcp-call__icon');
  return '    <section aria-labelledby="hero-heading">\n      <div class="section__inner">\n        <div class="page-banner mcp-banner">\n' +
    '          <div class="page-banner__body mcp-banner__body">\n' +
    '            <p class="kicker kicker--on-navy">MCP server</p>\n' +
    '            <h1 id="hero-heading" class="page-banner__title">Use Answerable from inside Claude.</h1>\n' +
    '            <p class="page-banner__desc">Scan a site, get the fix, read the playbook and the research, without leaving the conversation. Free, no signup.</p>\n' +
    '            <div class="mcp-banner__actions">\n              <a href="#connect" class="btn btn--gold">Connect it</a>\n              <a href="#tools" class="btn btn--ghost-on-navy">See what it can do</a>\n            </div>\n          </div>\n' +
    '          <div class="mcp-banner__side">\n' +
    '            <figure class="mcp-chat" aria-label="Example: a question, the tool it runs and the real output">\n              <div class="mcp-chat__head">Example</div>\n              <div class="mcp-chat__body">\n' +
    '                <div class="mcp-msg mcp-msg--user">\n                  <span class="mcp-msg__who">You ask</span>\n                  <p class="mcp-msg__text">' + esc(e.prompt) + '</p>\n                </div>\n' +
    '                <div class="mcp-call">\n                  ' + check.replace('<svg ', '<svg width="13" height="13" ') + '\n                  <span><span class="mcp-call__server">answerable</span> · <span class="mcp-call__tool">' + esc(e.tool) + '</span></span>\n                  <span class="mcp-call__arg">' + esc(e.arguments.domain || '') + '</span>\n                </div>\n' +
    '                <div class="mcp-msg mcp-msg--assistant">\n                  <span class="mcp-msg__who">Answerable returns</span>\n                  <div class="mcp-msg__text mcp-excerpt" data-example="' + e.id + '">\n              ' + bannerExcerpt(e) + '\n                  </div>\n                </div>\n' +
    '              </div>\n            </figure>\n            <p class="mcp-banner__caption">Real output from the tool, ' + longDate(d.ex.capturedAt) + '. Excerpt.</p>\n          </div>\n' +
    '        </div>\n      </div>\n    </section>\n';
}

function asks(d) {
  const cards = d.copy.asks.map((a) => '          <div class="card card--static mcp-ask">\n            <p class="mcp-ask__text">“' + esc(a.text) + '”</p>\n            <p class="mcp-ask__run">' + icon('arrow', 'mcp-ask__arrow') + '<span class="mcp-chip">' + esc(a.tool) + '</span></p>\n          </div>').join('\n');
  return '    <section class="mcp-section" aria-labelledby="ask-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">Ask</p>\n          <h2 id="ask-heading" class="section-title">Ask in plain language.</h2>\n        </div>\n        <div class="mcp-asks">\n' + cards + '\n        </div>\n      </div>\n    </section>\n';
}

function inputsTable(tool) {
  const props = (tool.inputSchema && tool.inputSchema.properties) || {};
  const req = (tool.inputSchema && tool.inputSchema.required) || [];
  const names = Object.keys(props);
  if (!names.length) return '<p class="mcp-more__none">No inputs.</p>';
  return '<div class="mcp-scroll"><table class="mcp-table">\n<caption class="mcp-vh">Inputs for ' + esc(tool.name) + '</caption>\n<thead><tr><th scope="col">Input</th><th scope="col">What it takes</th></tr></thead>\n<tbody>\n' +
    names.map((n) => '<tr><th scope="row"><span class="mcp-in">' + esc(n) + '</span><span class="mcp-req">' + (req.indexOf(n) === -1 ? 'optional' : 'required') + '</span></th><td>' + esc(props[n].description || '') + '</td></tr>').join('\n') +
    '\n</tbody></table></div>';
}

function toolCard(d, tool) {
  const c = d.copy.tools[tool.name];
  const ex = d.byId[TOOL_EXAMPLE[tool.name]];
  let more = '            <p class="mcp-more__label">Inputs</p>\n            ' + inputsTable(tool) + '\n';
  if (ex) {
    more += '            <p class="mcp-more__label">Example</p>\n            <p class="mcp-more__prompt">You ask: “' + esc(ex.prompt) + '”</p>\n' +
      '            <div class="fix-snippet">\n              <div class="fix-snippet__head"><span class="fix-snippet__label">Real output, first ' + ex.lines.length + ' of ' + ex.totalLines + ' lines</span></div>\n' +
      '              <pre class="fix-snippet__code" data-example="' + ex.id + '">' + esc(ex.lines.join('\n')) + '</pre>\n            </div>\n' +
      '            <p class="mcp-more__note">Captured ' + longDate(d.ex.capturedAt) + '.</p>\n';
  }
  return '          <article class="card card--static mcp-tool" id="' + tool.name + '">\n            <h4 class="mcp-tool__name">' + tool.name + '</h4>\n            <p class="card__desc mcp-tool__line">' + esc(c.line) + '</p>\n' +
    '            <details class="mcp-more">\n              <summary>Inputs and example</summary>\n              <div class="mcp-more__body">\n' + more.replace(/^ {12}/gm, '                ') + '              </div>\n            </details>\n          </article>';
}

function toolsSection(d) {
  const groups = d.copy.groups.map((g) => {
    const list = d.tools.filter((t) => d.copy.tools[t.name].group === g.name);
    if (!list.length) return '';
    return '        <div class="mcp-group">\n          <div class="mcp-group__head">\n            <span class="mcp-group__icon">' + icon(g.icon) + '</span>\n            <div>\n              <h3 class="mcp-group__title">' + esc(g.name) + '</h3>\n              <p class="mcp-group__blurb">' + esc(g.blurb) + '</p>\n            </div>\n          </div>\n          <div class="mcp-tools">\n' + list.map((t) => toolCard(d, t)).join('\n') + '\n          </div>\n        </div>\n';
  }).join('');
  return '    <section class="mcp-section" id="tools" aria-labelledby="tools-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">Tools</p>\n          <h2 id="tools-heading" class="section-title">What’s inside.</h2>\n' +
    '          <p class="section-sub">The server has <!--c:toolCountLower-->' + word(d.tools.length) + '<!--/c--> tools in ' + word(d.copy.groups.length) + ' groups. Every one is read-only.</p>\n        </div>\n' + groups + '      </div>\n    </section>\n';
}

function workflows(d) {
  const cards = d.prompts.map((p) => {
    const named = promptTools(p, d.tools);
    return '          <article class="card card--static mcp-tool mcp-flow" id="prompt-' + p.name + '">\n            <h3 class="mcp-tool__name">' + p.name + '</h3>\n            <p class="card__desc mcp-tool__line">' + esc(d.copy.prompts[p.name].line) + '</p>\n            <p class="mcp-flow__calls"><span class="mcp-flow__label">Calls</span>' + named.map((n) => '<span class="mcp-chip">' + n + '</span>').join('') + '</p>\n          </article>';
  }).join('\n');
  return '    <section class="mcp-section" aria-labelledby="flows-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">Prompts</p>\n          <h2 id="flows-heading" class="section-title">Ready-made workflows.</h2>\n' +
    '          <p class="section-sub">The server has <!--c:promptCountLower-->' + word(d.prompts.length) + '<!--/c--> prompts that run several tools in order. Clients list them next to the tools, often as slash commands.</p>\n        </div>\n        <div class="mcp-tools mcp-tools--three">\n' + cards + '\n        </div>\n      </div>\n    </section>\n';
}

function connect() {
  const copyIcon = icon('copy');
  const snippet = (label, code) => '            <div class="fix-snippet">\n              <div class="fix-snippet__head">\n                <span class="fix-snippet__label">' + esc(label) + '</span>\n                <div class="fix-snippet__actions"><button type="button" class="btn btn--ghost-on-navy fix-snippet__copy" hidden>' + copyIcon.replace('<svg ', '<svg width="13" height="13" ') + ' Copy</button></div>\n              </div>\n              <pre class="fix-snippet__code">' + esc(code) + '</pre>\n            </div>\n';
  const cursor = JSON.stringify({ mcpServers: { answerable: { url: URL_FULL } } }, null, 2);
  const det = (title, inner) => '          <details>\n            <summary>' + title + '</summary>\n' + inner + '          </details>\n';
  const clients =
    det('Claude', '            <ol class="mcp-steps">\n              <li>Open Claude and go to Customize, then Connectors.</li>\n              <li>Choose Add, then Add custom connector.</li>\n              <li>Name it Answerable and paste the server address from above.</li>\n              <li>Save it. No authentication is needed.</li>\n              <li>Ask: “Scan example.com and tell me what to fix first.”</li>\n            </ol>\n            <p>Custom connectors depend on your plan. Your client’s help has the current steps.</p>\n') +
    det('Claude Code', '            <ol class="mcp-steps">\n              <li>Run this once, from any directory.</li>\n              <li>Start a session and ask for a scan.</li>\n            </ol>\n' + snippet('Terminal', 'claude mcp add --transport http answerable ' + URL_FULL)) +
    det('Cursor', '            <ol class="mcp-steps">\n              <li>Open <code>.cursor/mcp.json</code> in your project, or <code>~/.cursor/mcp.json</code> for every project.</li>\n              <li>Add this block.</li>\n              <li>Restart Cursor, or reload its MCP connections.</li>\n            </ol>\n' + snippet('.cursor/mcp.json', cursor)) +
    det('Other clients', '            <p>Any client that speaks Streamable HTTP can use the same address. By hand, send <code>MCP-Protocol-Version: ' + PROTOCOL_VERSIONS[0] + '</code> and <code>Mcp-Method</code> on every request, <code>Mcp-Name</code> on <code>tools/call</code> and <code>prompts/get</code>, and the protocol version and client capabilities in <code>_meta</code>; ' + PROTOCOL_VERSIONS.slice(1).map((v) => '<code>' + v + '</code>').join(' and ') + ' are also accepted.</p>\n');
  return '    <section class="mcp-section" id="connect" aria-labelledby="connect-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">Connect</p>\n          <h2 id="connect-heading" class="section-title">Connect it in a minute.</h2>\n          <p class="section-sub">Add this address to your client. No key, no account.</p>\n        </div>\n' +
    '        <div class="mcp-url">\n          <label class="mcp-vh" for="mcp-url">Server address</label>\n          <input id="mcp-url" class="mcp-url__field" type="text" readonly value="' + esc(URL_FULL) + '" spellcheck="false" />\n          <button type="button" class="btn btn--gold mcp-url__copy" hidden>Copy</button>\n        </div>\n' +
    '        <div class="ac-faq mcp-clients">\n' + clients + '        </div>\n      </div>\n    </section>\n';
}

function expect(d) {
  const perHour = limits.DOMAIN_PER_HOUR;
  const questions = d.sample.promptCount;
  const tries = d.sample.runsPerPrompt;
  const li = (lead, text) => '            <li><strong>' + lead + '</strong> ' + text + '</li>';
  const items = [
    li('Read-only.', 'Every tool reads. None writes to your site, sends a message or changes an account.'),
    li('No signup.', 'No key, no account, no login.'),
    li('Nothing stored about you.', 'The server keeps counters for an hour, keyed by the scanned domain. They hold no IP address, client name or account.'),
    li('Live scans are limited.', '<!--c:liveCountCap-->' + cap(word(d.live.length)) + '<!--/c--> tools (<!--c:liveToolNames-->' + d.live.join(', ') + '<!--/c-->) fetch the domain you name, at most ' + word(perHour) + ' times per domain per hour. The other <!--c:contentCountLower-->' + word(d.tools.length - d.live.length) + '<!--/c--> work from our own files.'),
    li('Readiness, not presence.', 'A score says whether AI crawlers can reach a site and whether its signals give a model reason to trust it. It does not say whether an assistant names you.'),
    li('No live citation tool.', 'A citation run is about ' + (questions * tries) + ' model calls, ' + questions + ' questions asked ' + word(tries) + ' times each, and would exceed the function’s time limit. The question sets are free to try in your own assistant.')
  ];
  return '    <section class="mcp-section" aria-labelledby="expect-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">Limits</p>\n          <h2 id="expect-heading" class="section-title">What to expect.</h2>\n        </div>\n        <div class="mcp-expect">\n          <ul class="mcp-expect__list">\n' + items.join('\n') + '\n          </ul>\n          <p class="mcp-expect__links">Read the <a href="/privacy">privacy policy</a> and the <a href="/methodology">methodology</a>.</p>\n        </div>\n      </div>\n    </section>\n';
}

function faqEntries(d) {
  const n = d.tools.length;
  const liveN = d.live.length;
  return [
    ['What is MCP?', 'MCP, the Model Context Protocol, is an open standard that lets an AI assistant call outside tools directly instead of a person copying results between a website and a chat. Connect Answerable’s server and the assistant can run a scan, build a fix or read a playbook inside the conversation.'],
    ['Do I need an account?', 'No. There is no signup, no API key and no login. Add the server address to your client and ask.'],
    ['Is it free?', 'All ' + word(n) + ' tools are free, and so are the ' + word(d.prompts.length) + ' prompts. The ' + word(liveN) + ' tools that scan a live site are limited per domain, so one site is not fetched over and over, and there is a ceiling across all callers.'],
    ['What data does it fetch and keep?', 'The ' + word(liveN) + ' tools that scan a live site (' + d.live.join(', ') + ') fetch a domain’s public robots.txt, llms.txt, sitemap and homepage, and for a store one product page where robots.txt allows it. The other ' + word(n - liveN) + ' read our own files and fetch nothing. Nothing about who you are is stored. The server keeps counters keyed by a one-way hash of the scanned domain, which expire within an hour, to limit repeated fetches of one site.'],
    ['Which clients work?', 'Any MCP client that supports servers over HTTP. Setup for Claude, Claude Code and Cursor is above. Custom connectors depend on your plan, so check your client’s help for the current steps.'],
    ['Does it tell me whether AI names my brand?', 'No. The scan measures readiness: whether crawlers can reach your site and whether its signals give a model reason to trust it. It cannot observe what an assistant says, and a high score does not guarantee a mention. Two tools, get_citation_prompts and get_citation_sample, give you the questions and a real sample, so you can run the check yourself in your own assistant.']
  ];
}

function faq(d) {
  const items = faqEntries(d).map((q) => '          <details>\n            <summary>' + esc(q[0]) + '</summary>\n            <p>' + esc(q[1]) + '</p>\n          </details>').join('\n');
  return '    <section class="ac-section" aria-labelledby="faq-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">Questions</p>\n          <h2 id="faq-heading" class="section-title">The MCP server, briefly.</h2>\n        </div>\n        <div class="ac-faq">\n' + items + '\n        </div>\n      </div>\n    </section>\n';
}

function closing() {
  return '    <section aria-label="Scan reminder">\n      <div class="section__inner">\n        <div class="scan-bridge">\n          <h2 class="scan-bridge__text">Prefer the browser?</h2>\n          <a href="/" class="btn btn--primary">Scan your site free</a>\n        </div>\n      </div>\n    </section>\n';
}

const SCRIPT = '  <script>\n    (function () {\n      \'use strict\';\n      function toast(msg) {\n        var t = document.getElementById(\'toast\');\n        if (!t) return;\n        t.textContent = msg;\n        t.classList.add(\'is-visible\');\n        setTimeout(function () { t.classList.remove(\'is-visible\'); }, 2600);\n      }\n      function copy(text) {\n        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast(\'Copied.\'); });\n      }\n      var urlBtn = document.querySelector(\'.mcp-url__copy\');\n      var field = document.getElementById(\'mcp-url\');\n      if (urlBtn && field && navigator.clipboard) {\n        urlBtn.hidden = false;\n        urlBtn.addEventListener(\'click\', function () { copy(field.value); });\n      }\n      document.querySelectorAll(\'.fix-snippet__copy\').forEach(function (btn) {\n        if (!navigator.clipboard) return;\n        btn.hidden = false;\n        btn.addEventListener(\'click\', function () { copy(btn.closest(\'.fix-snippet\').querySelector(\'.fix-snippet__code\').textContent); });\n      });\n    }());\n  </script>\n';

/* ---------- page ---------- */

function meta(d) {
  const title = 'Answerable. — MCP Server for Claude, Cursor and Other AI Tools';
  const description = 'Use Answerable from inside Claude, Cursor or any MCP client: scan a site, get the fix, read the playbooks. ' + cap(word(d.tools.length)) + ' free, read-only tools, nothing stored.';
  return { title, description };
}

function jsonld(d) {
  return [{
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: 'Answerable MCP Server',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Any',
        description: 'An MCP server exposing Answerable’s AI-visibility scanner, fix generators and vertical playbooks as tools for Claude, Cursor and other MCP clients.',
        url: site.baseUrl + '/mcp',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }
      },
      {
        '@type': 'FAQPage',
        mainEntity: faqEntries(d).map((q) => ({ '@type': 'Question', name: q[0], acceptedAnswer: { '@type': 'Answer', text: q[1] } }))
      }
    ]
  }];
}

function build() {
  const d = load();
  const m = meta(d);
  const body = banner(d) + '\n' + asks(d) + '\n' + toolsSection(d) + '\n' + workflows(d) + '\n' + connect() + '\n' + expect(d) + '\n' + faq(d) + '\n' + closing();
  let html = shell.page({ title: m.title, description: m.description, path: '/mcp', cssVersion: CSS_VERSION, jsonld: jsonld(d), body: body });
  html = html.replace('  <meta name="author"', '  <meta name="keywords" content="MCP server, Model Context Protocol, Claude MCP, Cursor MCP, AI visibility API, GEO tools, AEO tools" />\n  <meta name="author"');
  html = html.replace('  <script src="nav.js?v=2"></script>', SCRIPT + '  <script src="nav.js?v=2"></script>');
  return html;
}

/* ---------- checks (run against the file on disk, by separate code paths) ---------- */

function decode(s) {
  return s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&rsquo;/g, '’').replace(/&amp;/g, '&');
}
const numbers = (s) => (s.match(/\d+(?:\.\d+)?/g) || []);

function verify(html, d) {
  const bad = [];
  const fail = (m) => bad.push(m);
  const noScripts = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const body = noScripts.slice(noScripts.indexOf('<body'));

  // counts equal the registry
  const marker = (k) => { const m = new RegExp('<!--c:' + k + '-->([\\s\\S]*?)<!--/c-->').exec(html); return m ? m[1] : null; };
  const expectMarker = { toolCountLower: word(d.tools.length), promptCountLower: word(d.prompts.length), liveCountCap: cap(word(d.live.length)), contentCountLower: word(d.tools.length - d.live.length), liveToolNames: d.live.join(', ') };
  Object.keys(expectMarker).forEach((k) => { if (marker(k) !== expectMarker[k]) fail('count marker ' + k + ' is "' + marker(k) + '", the registry gives "' + expectMarker[k] + '"'); });
  const desc = /<meta name="description" content="([^"]*)"/.exec(html);
  if (!desc || desc[1].length < 120 || desc[1].length > 165) fail('meta description is ' + (desc ? desc[1].length : 'missing') + ' characters, expected 120 to 165');
  if (desc && desc[1].toLowerCase().indexOf(word(d.tools.length) + ' free, read-only tools') === -1) fail('meta description does not carry the registry tool count');
  const cards = (html.match(/<article class="card card--static mcp-tool"/g) || []).length;
  const flows = (html.match(/<article class="card card--static mcp-tool mcp-flow"/g) || []).length;
  if (cards !== d.tools.length) fail(cards + ' tool cards, the registry has ' + d.tools.length);
  if (flows !== d.prompts.length) fail(flows + ' prompt cards, the registry has ' + d.prompts.length);
  d.tools.forEach((t) => { if (html.indexOf('id="' + t.name + '"') === -1) fail('the tool ' + t.name + ' is not on the page'); });
  d.prompts.forEach((p) => { if (html.indexOf('id="prompt-' + p.name + '"') === -1) fail('the prompt ' + p.name + ' is not on the page'); });

  // protocol versions match the server
  const src = fs.readFileSync(path.join(ROOT, 'api', 'mcp.js'), 'utf8');
  const sv = /SUPPORTED_PROTOCOL_VERSIONS = \[([^\]]*)\]/.exec(src);
  if (!sv || sv[1].replace(/['\s]/g, '') !== PROTOCOL_VERSIONS.join(',')) fail('the protocol versions on the page differ from SUPPORTED_PROTOCOL_VERSIONS in api/mcp.js');

  // excerpts equal content/mcp-examples.json
  const seen = {};
  const re = /data-example="([^"]+)"[^>]*>([\s\S]*?)<\/(?:pre|div)>/g;
  let m;
  while ((m = re.exec(html))) {
    const e = d.byId[m[1]];
    if (!e) { fail('an excerpt names the example ' + m[1] + ', which is not in content/mcp-examples.json'); continue; }
    seen[m[1]] = true;
    const shown = decode(m[2]).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l !== '');
    const want = e.lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l !== '');
    const wantSet = want.slice(0, shown.length);
    if (shown.length === 0 || shown.join('\n') !== wantSet.join('\n')) fail('the excerpt ' + m[1] + ' on the page differs from content/mcp-examples.json');
    if (numbers(shown.join(' ')).join() !== numbers(wantSet.join(' ')).join()) fail('a figure in the excerpt ' + m[1] + ' differs from content/mcp-examples.json');
  }
  if (!seen[BANNER_EXAMPLE]) fail('the banner excerpt is missing');
  Object.keys(TOOL_EXAMPLE).forEach((t) => { if (!seen[TOOL_EXAMPLE[t]]) fail('the example for ' + t + ' is missing'); });
  const cap1 = new RegExp('Real output from the tool, ' + longDate(d.ex.capturedAt).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\. Excerpt\\.');
  if (!cap1.test(html)) fail('the banner caption does not carry the capture date');

  // nothing that looks like code outside <details>
  const outside = body.replace(/<details[\s\S]*?<\/details>/g, '');
  if (/<pre\b|<code\b/.test(outside)) fail('a <pre> or <code> block is visible outside a <details>');
  if (/<details[^>]*\bopen\b/.test(html)) fail('a <details> is open by default');

  // the URL
  const chip = /<input id="mcp-url"[^>]*value="([^"]*)"/.exec(html);
  if (!chip || chip[1] !== site.baseUrl + MCP_PATH) fail('the URL chip is not site.config.json baseUrl plus ' + MCP_PATH);
  if (!fs.existsSync(path.join(ROOT, 'api', 'mcp.js'))) fail('api/mcp.js does not exist for ' + MCP_PATH);
  (html.match(/https?:\/\/[^\s"'<]*\/api\/mcp\b/g) || []).forEach((u) => { if (u !== URL_FULL) fail('a server URL differs from the configured one: ' + u); });

  // headings
  const h1 = body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g) || [];
  if (h1.length !== 1) fail('the page has ' + h1.length + ' h1 elements');
  else if (/\d/.test(decode(h1[0]))) fail('the h1 contains a digit');

  // JSON-LD matches the visible FAQ
  const lds = (html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || []).map((s) => { try { return JSON.parse(s.replace(/<\/?script[^>]*>/g, '')); } catch (e) { fail('a JSON-LD block does not parse'); return null; } }).filter(Boolean);
  const graph = [].concat.apply([], lds.map((o) => o['@graph'] || [o]));
  const types = graph.map((n) => n['@type']);
  ['SoftwareApplication', 'FAQPage', 'Organization', 'WebSite'].forEach((t) => { if (types.indexOf(t) === -1) fail('JSON-LD has no ' + t); });
  const ld = graph.filter((n) => n['@type'] === 'FAQPage')[0];
  const visible = [];
  const dre = /<details>\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/g;
  const faqHtml = (/<div class="ac-faq">([\s\S]*?)<\/section>/.exec(html) || [])[1] || '';
  while ((m = dre.exec(faqHtml))) visible.push([decode(m[1]), decode(m[2])]);
  if (ld) {
    const q = ld.mainEntity.map((x) => [x.name, x.acceptedAnswer.text]);
    if (JSON.stringify(q) !== JSON.stringify(visible)) fail('the FAQPage JSON-LD does not match the visible FAQ');
    if (q.length !== 6) fail('the FAQ has ' + q.length + ' questions, expected 6');
  }

  // grep rules
  const text = decode(body.replace(/<svg[\s\S]*?<\/svg>/g, ''));
  if (/gradient\(/i.test(html)) fail('a gradient appears');
  if (/\p{Extended_Pictographic}/u.test(html.replace(/[©®™]/g, ''))) fail('an emoji appears');
  if (/\$\s?\d|\bper month\b|\bpricing\b|\/mo\b|\bfree trial\b/i.test(text)) fail('a price appears');
  if (/\b(listed (in|on)|verified by|approved by|certified|certification|official directory|in the (claude|anthropic|cursor)[a-z ]* directory|marketplace)\b/i.test(text)) fail('a directory-status or certification claim appears');
  if (/\b(quietly|actually|seamlessly|effortless|powerful|unlock|elevate|supercharge|game-changing|revolutionize|landscape|delve|crucial|robust|recommended|coming soon)\b/i.test(text)) fail('a banned word appears');
  if (/not just [^.]*, but /i.test(text)) fail('the banned construction "not just X, but Y" appears');
  (body.match(/<(p|li|summary)\b[^>]*>[\s\S]*?<\/\1>/g) || []).forEach((p) => { if ((decode(p).match(/—/g) || []).length > 1) fail('more than one em dash in: ' + decode(p).slice(0, 60)); });
  return bad;
}

function main() {
  const check = process.argv.indexOf('--check') !== -1;
  const html = build();
  const d = load();
  if (check) {
    const onDisk = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '';
    const bad = verify(onDisk, d);
    if (onDisk !== html) bad.unshift('mcp.html is out of date; run node scripts/generate-mcp-page.js');
    if (bad.length) { bad.forEach((m) => console.error('FAIL: ' + m)); process.exit(1); }
    console.log('OK: mcp.html matches the registry (' + d.tools.length + ' tools, ' + d.prompts.length + ' prompts), every tool and prompt has copy and a group, excerpts equal content/mcp-examples.json');
    return;
  }
  const bad = verify(html, d);
  if (bad.length) { bad.forEach((m) => console.error('FAIL: ' + m)); process.exit(1); }
  fs.writeFileSync(FILE, html, 'utf8');
  console.log('mcp.html written (' + d.tools.length + ' tools, ' + d.prompts.length + ' prompts)');
}

if (require.main === module) main();
module.exports = { build: build, verify: verify };
