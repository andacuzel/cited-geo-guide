/* =====================================================================
   /api/mcp — Citehound's MCP server.

   Exposes the scanner, the playbook/benchmark content and the citation
   tracking content as MCP tools (the registry, TOOLS below, is the one
   place that says how many), all read-only, over a single
   JSON-RPC-over-HTTP endpoint.

   SPEC TARGET & A DELIBERATE COMPATIBILITY CHOICE
   -------------------------------------------------------------------
   The current MCP specification is 2026-07-28 (finalized; superseded
   the 2025-11-25 revision). It removed the `initialize` handshake and
   protocol-level sessions entirely — every request now carries its own
   protocol version in `_meta`, and a new `server/discover` method
   replaces `initialize` for capability discovery.

   That revision finalized nine weeks before this file was written.
   Realistically, most MCP clients in actual use today (Claude Desktop,
   Claude Code, Cursor, and most third-party clients) were built against
   the older, stateful `initialize`-handshake model and have not all
   upgraded yet. A server that only speaks the brand-new stateless shape
   would be correct and unusable at the same time — which defeats the
   actual goal here ("so the scanner and playbooks can be used from
   Claude, Cursor and other MCP clients").

   So this implementation is deliberately a compatibility layer:
     - `initialize` is still implemented and answered correctly, purely
       for clients that send it first. A 2026-07-28 client that skips
       straight to tools/list never calls it, and nothing here requires
       it to have been called.
     - `server/discover` is also implemented, as the spec requires.
     - Every response is a single JSON object (Content-Type:
       application/json) — never an SSE stream. Nothing this server
       does needs mid-call progress or server-initiated input, so a
       stream was never necessary, in this revision or the last one.
     - Requests are classified per request by the version they declare
       (see classifyRequest). A request declaring 2026-07-28 is validated
       strictly: MCP-Protocol-Version, Mcp-Method and (for tools/call)
       Mcp-Name headers, plus _meta protocolVersion and
       clientCapabilities, must be present and agree, or it is rejected
       with the spec's 400 + -32020 / -32022 / -32602. A request
       declaring an older supported version (2025-06-18 and 2025-11-25
       clients send the header but no _meta) is served as before. A
       request declaring no version at all is rejected (-32020);
       2025-03-26 clients, which sent no header, are not served. ping
       is answered only on older-version requests.
     - Origin validation (the spec's DNS-rebinding protection) applies
       to locally-bound servers reachable from a browser tab on the
       same machine. This is a public, remote, stateless, read-only
       endpoint — there is no local socket to rebind to — so Origin is
       not enforced; the public-endpoint analogue of that protection is
       simply "every tool is read-only."

   RATE LIMITING
   -------------------------------------------------------------------
   The three tools that fetch a live, arbitrary third-party domain
   (scan_site, compare_sites, generate_schema) are limited per target domain
   and by a global hourly ceiling (lib/mcp-limits.js: 6 fetches of one domain
   an hour, 300 live fetches an hour in all, both configurable in that one
   file). It is not limited per caller IP: every user of an Anthropic-hosted
   client shares a few addresses, so a per-IP limit would throttle strangers
   for each other's calls. /api/scan keeps its own per-IP limiter. The tools
   that only read this project's own content (generate_robots_txt,
   generate_llms_txt, get_playbook, get_benchmark, get_methodology,
   get_research, get_sample_report, list_ai_crawlers, get_citation_prompts,
   get_citation_sample) are not limited: there is no third party to protect.
   compare_sites consumes one unit per domain. If the counter store is
   unavailable the limiter fails open.

   THERE IS NO TOOL THAT RUNS A LIVE CITATION CHECK, on purpose. One run
   is about 90 model calls at about five seconds each, far past this
   function's time limit, and it would spend a model quota that nothing
   stops strangers from draining. get_citation_prompts hands a person the
   questions and a protocol to run in their own assistant instead.

   No caller identity is stored anywhere; the counters are keyed by a hash of
   the scanned domain (or the current hour) and expire after an hour.
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const mcpLimits = require('../lib/mcp-limits');
const methodology = require('../lib/methodology');
const mcpContent = require('../lib/mcp-content');
const mcpPrompts = require('../lib/mcp-prompts');
const scanner = require('../lib/scanner');
const schemaLib = require('../lib/schema');
const playbooks = require('../lib/playbooks');
const CRAWLERS = require('../lib/crawlers');
const citation = require('../lib/citation-content');

const SUPPORTED_PROTOCOL_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18'];
const SERVER_INFO = { name: 'citehound', title: 'Citehound', version: '1.0.0' };
const SERVER_INSTRUCTIONS = 'Citehound scans a domain’s public robots.txt, llms.txt and homepage for AI-crawler access and on-page signals, and generates the fixes (schema, robots.txt, llms.txt). It also serves the scoring methodology, the research, a sample report of our own site, the vertical playbooks and the citation question sets, and three prompts for common workflows. Every tool is read-only and non-destructive. It measures readiness, not whether any assistant names a brand.';
const DATA_DIR = path.join(__dirname, '..', 'data');

/* ---------------- shared small helpers ---------------- */

var normalizeDomain = scanner.normalizeDomain;

// Limits a live fetch of one domain. Resolves to an error outcome, or null to go ahead.
async function liveLimit(domain) {
  var rl = await mcpLimits.checkLiveLimit(domain);
  return rl.limited ? { isError: true, text: rl.message } : null;
}

// One scan with its own deadline, so two sequential scans finish inside the function limit even if a site
// stalls. The scan itself cannot be cancelled, so it is simply abandoned when the deadline passes.
var SCAN_DEADLINE_MS = parseInt(process.env.MCP_SCAN_DEADLINE_MS, 10) || 20000;
function withDeadline(promise, ms) {
  var timer;
  var deadline = new Promise(function (resolve) {
    timer = setTimeout(function () { resolve({ ok: false, stage: 'deadline', kind: 'timed out after ' + Math.round(ms / 1000) + ' seconds' }); }, ms);
  });
  return Promise.race([promise, deadline]).then(function (r) { clearTimeout(timer); return r; }, function (e) { clearTimeout(timer); return { ok: false, stage: 'error', kind: (e && e.message) || 'scan error' }; });
}

function failureLine(domain, scanResult) {
  if (scanResult.stage === 'limit') return domain + ' was not scanned: ' + scanResult.kind;
  return domain + ' was not scanned: ' + scanFailureMessage(domain, scanResult);
}

function scanFailureMessage(domain, scanResult) {
  var detail = scanResult.kind || scanResult.error || 'unknown error';
  if (scanResult.stage === 'deadline') {
    return 'The scan of https://' + domain + '/ took too long (' + detail + '), so there is no reliable result. Try again, or scan the domain on its own.';
  }
  if (scanResult.stage === 'robots') {
    return 'Could not read https://' + domain + '/robots.txt (' + detail + '), so the score would not be reliable. Confirm the domain is correct and reachable, then try again.';
  }
  return 'Could not read the homepage at https://' + domain + '/ (' + detail + '). Confirm the domain is correct and reachable, then try again.';
}

// Minimal, purpose-built HTML -> plain text for playbook content. The
// source HTML is a closed, known set of tags (h3, p, ul/ol/li, strong,
// div) written by this project — this is not a general sanitizer.
function htmlToText(html) {
  return String(html)
    .replace(/<h3>([\s\S]*?)<\/h3>/g, '\n\n## $1\n')
    .replace(/<li>/g, '\n- ')
    .replace(/<\/li>/g, '')
    .replace(/<\/?(ul|ol)[^>]*>/g, '')
    .replace(/<\/?p>/g, '\n')
    .replace(/<\/?div[^>]*>/g, '\n')
    .replace(/<strong>([\s\S]*?)<\/strong>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'')
    .split('\n').map(function (l) { return l.replace(/[ \t]+$/, ''); }).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

var ALL_VERTICALS = Object.keys(playbooks.saasData)
  .concat(Object.keys(playbooks.brandData))
  .concat(Object.keys(playbooks.professionalData));

function findVertical(slug) {
  if (Object.prototype.hasOwnProperty.call(playbooks.saasData, slug)) {
    return { track: 'B2B SaaS', entry: playbooks.saasData[slug] };
  }
  if (Object.prototype.hasOwnProperty.call(playbooks.brandData, slug)) {
    return { track: 'Consumer & e-commerce brands', entry: playbooks.brandData[slug] };
  }
  if (Object.prototype.hasOwnProperty.call(playbooks.professionalData, slug)) {
    return { track: 'Local & independent professionals', entry: playbooks.professionalData[slug] };
  }
  return null;
}

/* ---------------- JSON-LD (generate_schema) ---------------- */
/* The builder lives in lib/schema.js, shared with the scan report and the
   standalone schema generator, so the three can never drift apart. */

var SCHEMA_TYPE_LABEL = {};
Object.keys(schemaLib.TYPES).forEach(function (k) { SCHEMA_TYPE_LABEL[k] = schemaLib.TYPES[k].outputLabel; });

/* ---------------- benchmark data (get_benchmark) ---------------- */

function loadBenchmarkEntries() {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'benchmarks.json'), 'utf8'));
}

function loadSummary(category) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, category + '-summary.json'), 'utf8'));
  } catch (e) {
    return null;
  }
}

// Same weighted-average logic as scripts/generate-benchmarks.js, so the
// "how this compares" line in scan_site matches what the homepage says.
function computeOverallBenchmark() {
  try {
    var entries = loadBenchmarkEntries();
    var totalSites = 0, weightedSum = 0, categories = 0;
    entries.forEach(function (e) {
      var summary = loadSummary(e.category);
      if (!summary || !summary.score || typeof summary.score.average !== 'number' || !summary.scanned) return;
      totalSites += summary.scanned;
      weightedSum += summary.score.average * summary.scanned;
      categories++;
    });
    if (totalSites === 0) return null;
    return { totalSites: totalSites, totalCategories: categories, overallAverage: Math.round(weightedSum / totalSites) };
  } catch (e) {
    return null;
  }
}

/* ---------------- scan_site / compare_sites formatting ---------------- */

function formatScanResult(domain, scanResult, overall) {
  var r = scanResult.result;
  var lines = [];
  lines.push('AI readiness scan — ' + domain);
  lines.push('');
  lines.push('Score: ' + r.total + '/100');
  lines.push('  Discoverability:      ' + r.discover + '/40');
  lines.push('  Technical foundation: ' + r.tech + '/20');
  lines.push('  Content & trust:      ' + r.trust + '/40');

  if (overall) {
    var delta = r.total - overall.overallAverage;
    var points = Math.abs(delta);
    var cmp = points < 2
      ? 'about the average of the ' + overall.totalSites + ' sites we’ve scanned (' + overall.overallAverage + '/100).'
      : points + ' point' + (points === 1 ? '' : 's') + ' ' + (delta > 0 ? 'above' : 'below') +
        ' the average of the ' + overall.totalSites + ' sites we’ve scanned (' + overall.overallAverage + '/100).';
    lines.push('');
    lines.push('That’s ' + cmp);
  }

  lines.push('');
  lines.push('AI crawler access (' + scanResult.botResults.length + ' tracked):');
  scanResult.botResults.forEach(function (b) {
    var state = b.state === 'open' ? 'Open' : b.state === 'partial' ? 'Limited' : 'Blocked';
    var line = '  ' + b.name + ' — ' + state;
    if (b.state !== 'open') line += ' (' + b.rule + ')';
    lines.push(line);
  });

  var failed = r.checks.filter(function (c) { return c.pts < c.max; })
    .slice()
    .sort(function (a, b) { return (b.max - b.pts) - (a.max - a.pts); });
  var passed = r.checks.filter(function (c) { return c.pts >= c.max; });

  lines.push('');
  if (failed.length > 0) {
    lines.push('Failed checks, highest point value first:');
    failed.forEach(function (c) {
      lines.push('  - ' + c.label + ' (' + c.pts + '/' + c.max + ' pts): ' + c.advice + ' — ' + c.why);
    });
  } else {
    lines.push('Every check passed.');
  }

  if (passed.length > 0) {
    lines.push('');
    lines.push('Passed: ' + passed.map(function (c) { return c.label; }).join(', ') + '.');
  }

  return lines.join('\n');
}

function formatCommerce(c) {
  if (!c) return '';
  var fired = c.signals.filter(function (s) { return s.fired === true; });
  var firedList = fired.map(function (s) { return s.label; }).join('; ');

  if (!c.detected) {
    if (fired.length === 0) return '';
    return '\nCommerce checks: not treated as a store (' + fired.length + ' of ' + c.signals.length + ' signals fired, ' + c.threshold + ' needed): ' + firedList + '.';
  }

  var lines = [''];
  lines.push('Agentic commerce readiness (scored separately, not part of the ' + 'score above)');
  lines.push('Treated as a store: ' + fired.length + ' of ' + c.signals.length + ' signals fired: ' + firedList + '.');
  lines.push('Sub-score: ' + c.subScore.earned + '/' + c.subScore.max + (c.subScore.complete ? '' : ' (product data was not assessed, so it is out of the total)'));

  if (c.ucp.state === 'valid') {
    lines.push('  UCP endpoint: found. Version ' + c.ucp.version + '; supports ' + c.ucp.supportedVersions.join(', ') + '; capabilities: ' + c.ucp.capabilities.join(', ') + '.');
  } else {
    lines.push('  UCP endpoint: not found at /.well-known/ucp. ' + c.ucp.detail);
  }

  var p = c.product;
  if (p.state === 'checked') {
    var present = ['name', 'price', 'availability', 'image'].filter(function (f) { return p.fields[f]; });
    var missing = ['name', 'price', 'availability', 'image'].filter(function (f) { return !p.fields[f]; });
    lines.push('  Structured product data: ' + p.present + '/4 on ' + p.url + ' (found via ' + p.source + ').');
    if (!p.found) lines.push('    No Product schema was found on that page.');
    else lines.push('    ' + p.schemaType + ' schema (' + p.schemaSource + '). Present: ' + (present.join(', ') || 'none') + (missing.length ? '. Missing: ' + missing.join(', ') : '') + '.');
  } else {
    lines.push('  Structured product data: not assessed. ' + p.detail + (p.url ? ' URL: ' + p.url : ''));
  }

  if (c.llms) {
    lines.push('  llms.txt authorship: ' + (c.llms.verdict || 'no file') + '. ' + c.llms.summary + (c.llms.caveat ? ' ' + c.llms.caveat : ''));
  }
  return lines.join('\n');
}

// The bot-access check's label embeds a live open-count (e.g. "AI
// crawler access (6/10 open)"), which differs between two domains even
// though it is "the same check" — strip that suffix for comparison.
function baseLabel(label) {
  return label.replace(/\s*\(\d+\/\d+ open\)\s*$/, '');
}

function formatCompareResult(a, scanA, b, scanB) {
  var ra = scanA.result, rb = scanB.result;
  var lines = [];
  lines.push('Comparing ' + a + ' and ' + b);
  lines.push('');
  lines.push(a + ': ' + ra.total + '/100 (Discoverability ' + ra.discover + '/40, Technical ' + ra.tech + '/20, Content & trust ' + ra.trust + '/40)');
  lines.push(b + ': ' + rb.total + '/100 (Discoverability ' + rb.discover + '/40, Technical ' + rb.tech + '/20, Content & trust ' + rb.trust + '/40)');
  lines.push('');

  var diffs = [];
  for (var i = 0; i < ra.checks.length && i < rb.checks.length; i++) {
    var ca = ra.checks[i], cb = rb.checks[i];
    if (ca.pts !== cb.pts) {
      diffs.push({ label: baseLabel(ca.label), a: ca.pts + '/' + ca.max, b: cb.pts + '/' + cb.max });
    }
  }

  if (diffs.length === 0) {
    lines.push('Every check scored the same on both sites.');
  } else {
    lines.push('Where they differ (' + diffs.length + ' of ' + ra.checks.length + ' checks):');
    diffs.forEach(function (d) {
      lines.push('  ' + d.label + ' — ' + a + ': ' + d.a + '   ' + b + ': ' + d.b);
    });
  }

  return lines.join('\n');
}

/* ---------------- tool definitions ---------------- */

var TOOLS = [
  {
    name: 'scan_site',
    title: 'Scan a site for AI readiness',
    description: 'Scans a domain’s public robots.txt, llms.txt, sitemap declaration and homepage, and scores it out of 100 across three pillars: discoverability (can AI crawlers reach it), technical foundation (can machines parse it), and content & trust (does it look like a credible source). Returns the score, the three pillar scores, access state for the 10 tracked AI crawlers, every failed check with its fix, and how the score compares to Citehound’s own benchmark data. If the site looks like a store (two or more of five signals), it also reports a separate agentic-commerce sub-score: whether a UCP merchant profile exists at /.well-known/ucp, whether one product page has Product schema with name, price, availability and image, and whether the llms.txt looks like a platform default. That sub-score is never part of the 100. Call this first for any domain. It fetches the live site (a store scan reads up to one extra product page), so avoid calling it in a tight loop for the same domain.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'A bare domain, e.g. "example.com". No scheme (https://) and no path — the scan always targets the domain root.' }
      },
      required: ['domain']
    },
    annotations: { title: 'Scan a site for AI readiness', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  {
    name: 'compare_sites',
    title: 'Compare two sites',
    description: 'Scans two domains — one after the other, not in parallel — and reports both scores plus every check where they differ. Useful for comparing your site against a named competitor.',
    inputSchema: {
      type: 'object',
      properties: {
        domain_a: { type: 'string', description: 'The first bare domain, e.g. "example.com".' },
        domain_b: { type: 'string', description: 'The second bare domain, e.g. "competitor.com". Must differ from domain_a.' }
      },
      required: ['domain_a', 'domain_b']
    },
    annotations: { title: 'Compare two sites', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  {
    name: 'generate_schema',
    title: 'Generate JSON-LD for a site',
    description: 'Fetches a domain’s homepage for its real title, meta description and declared language, then returns ready-to-paste JSON-LD structured data of the requested type. Fields the scan cannot know — a FAQ’s actual questions, a product’s real price — come back as clearly bracketed placeholders, never invented values.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'A bare domain, e.g. "example.com".' },
        type: {
          type: 'string',
          enum: Object.keys(schemaLib.TYPES),
          description: '"organization" returns Organization + WebSite schema as an @graph; the others (faqpage, article, product, localbusiness) each return one schema of that @type.'
        }
      },
      required: ['domain', 'type']
    },
    annotations: { title: 'Generate JSON-LD for a site', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  {
    name: 'generate_robots_txt',
    title: 'Generate an AI-crawler robots.txt',
    description: 'Builds a robots.txt file that explicitly allows or blocks named AI crawlers from Citehound’s tracked list of 10, plus an optional Sitemap line. Pure text generation — fetches nothing. Call list_ai_crawlers first if you need the exact tracked crawler names.',
    inputSchema: {
      type: 'object',
      properties: {
        allow: { type: 'array', items: { type: 'string' }, description: 'Crawler names to explicitly allow, e.g. ["GPTBot", "ClaudeBot"]. Must be names from the tracked list.' },
        block: { type: 'array', items: { type: 'string' }, description: 'Crawler names to explicitly block. Must be names from the tracked list, and must not overlap with "allow".' },
        sitemap_url: { type: 'string', description: 'Optional absolute sitemap URL to add as a Sitemap: line, e.g. "https://example.com/sitemap.xml".' }
      }
    },
    annotations: { title: 'Generate an AI-crawler robots.txt', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'generate_llms_txt',
    title: 'Generate an llms.txt file',
    description: 'Builds an llms.txt file — the emerging convention that gives AI systems a curated map of a site — from a name, a one-sentence description and a list of key pages. Pure text generation — fetches nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The site or product name for the llms.txt header.' },
        description: { type: 'string', description: 'A one-sentence summary of what the site is.' },
        key_pages: {
          type: 'array',
          description: 'Pages worth pointing an AI system to, most important first.',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'Absolute URL of the page.' },
              description: { type: 'string', description: 'One line describing what the page covers.' }
            },
            required: ['url', 'description']
          }
        }
      },
      required: ['name', 'description']
    },
    annotations: { title: 'Generate an llms.txt file', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'get_playbook',
    title: 'Get a vertical playbook',
    description: 'Returns the full GEO/AEO playbook for one of Citehound’s fourteen verticals, as plain readable text: the strategic shift, three actionable strategies, outdated pitfalls to avoid, and an expert-tip placeholder. Called with no argument it returns the list of the fourteen verticals with their track (B2B SaaS, consumer and e-commerce brands, local and independent professionals), so call it with no argument first when you do not know which vertical fits. Read from this project’s own content file, so it matches what a visitor to the site sees. Fetches nothing external. Use after scan_site to turn a failed check into the strategy that applies to the site’s category.',
    inputSchema: {
      type: 'object',
      properties: {
        vertical: {
          type: 'string',
          description: 'Optional. A vertical slug. B2B SaaS: crm, martech, hrtech, fintech, cybersecurity, devtools. Consumer brands: ecommerce, consumerapps, hospitality, marketplaces. Professionals: health, localservices, realestate, legal. Omit to list them all.'
        }
      }
    },
    annotations: { title: 'Get a vertical playbook', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'get_benchmark',
    title: 'Get category benchmark data',
    description: 'Returns Citehound’s own archived scan data for one category — average, median and range of scores, pillar breakdowns, per-crawler blocked, limited and open counts, and the most common failed checks, with sample size and scan date — or a ranked summary across every category when called with no argument. This is archived data, not a live scan, and fetches nothing external.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Optional. One of: crm, cybersecurity, devtools, dtc-brands, consumer-apps, hospitality. Omit to get every category.' }
      }
    },
    annotations: { title: 'Get category benchmark data', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'list_ai_crawlers',
    title: 'List tracked AI crawlers',
    description: 'Lists the 10 AI crawlers Citehound tracks: which company runs each, what allowing or blocking it means, and this project’s robots.txt generator’s default for it. Use before generate_robots_txt if you need the exact tracked names. Fetches nothing.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'List tracked AI crawlers', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'get_citation_prompts',
    title: 'Get citation questions for a vertical',
    description: 'Returns the set of buying-intent questions Citehound uses to test whether an AI assistant names a brand, for one vertical, plus a short protocol a person can run in their own assistant: ask each question in a separate conversation three to five times, note whether the brand is named and whether it appears in a heading, list label, table or bold text, and judge the spread rather than one answer. The questions don’t name any brand in the category being measured. A few mention an integration platform such as Slack or Google Workspace, because that is how buyers ask. Read-only: it reads a content file and queries no model. There is deliberately no tool that runs the check for you: a run is about 90 model calls at about five seconds each, far past this server’s time limit, and it would spend a quota anyone could drain. Question sets exist for: ' + citation.verticalsWithSets().join(', ') + '.' + (citation.verticalsWithSets().length < citation.verticals().length ? ' The other verticals are valid but have no questions yet and return a message saying so.' : '') + ' Use when the user asks how to check whether an assistant names their brand, or wants the questions for their category.',
    inputSchema: {
      type: 'object',
      properties: {
        vertical: {
          type: 'string',
          description: 'A vertical slug. Valid: ' + citation.verticals().join(', ') + '. Question sets exist for: ' + citation.verticalsWithSets().join(', ') + '.'
        }
      },
      required: ['vertical']
    },
    annotations: { title: 'Get citation questions for a vertical', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'get_citation_sample',
    title: 'Get the anonymised citation sample',
    description: 'Returns Citehound’s anonymised sample citation run as readable text: the model, the date, how many times each question was asked, the questions in three groups (named in every try, unstable, never named), the overall rate of being named with its range across sweeps, and a note on the limits. It is one model on one date, so it is not a ranking, says nothing about other assistants and is not a forecast of traffic. It names no brand in the category being measured, no domain and no competitor. Read-only: it reads a content file and queries no model. Use when the user wants to see what a citation result looks like, or asks how much the same question varies between tries.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Get the anonymised citation sample', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'get_methodology',
    title: 'Get the scoring methodology',
    description: 'Explains how the Citehound AI readiness score is built, read from the scanner’s own check registry so it matches what runs. With no argument it returns the three pillars with their weights (they add up to 100), every check with its category, points, what it tests and why it matters, and the limits of the scan: it measures readiness and not whether any assistant names a brand; it gives half credit for a crawler with any applicable Disallow rule, usually an ordinary path; and it reads the homepage only. With a check label it returns that one check in detail. An unknown label returns an error listing the valid labels. Read-only, fetches nothing external. Use when the user asks how a score is calculated, why a check carries the points it does, or what the scan cannot tell them.',
    inputSchema: {
      type: 'object',
      properties: {
        check: { type: 'string', description: 'Optional. A check label exactly as scan_site reports it, e.g. "Page title" or "AI crawler access". Case does not matter. Omit for the whole methodology.' }
      }
    },
    annotations: { title: 'Get the scoring methodology', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'get_research',
    title: 'Get Citehound research',
    description: 'Returns Citehound’s published research: with no argument, the list of reports (the llms.txt and crawler study, the AgaOne case study and the benchmark data) with title, date, one-line finding and URL; with a slug, the key findings, the method limits, the URL and a ready line for citing it. Findings are checked against the published pages and data files. Every study measures readiness inputs, not whether any assistant names a brand. Read-only, fetches nothing external. Use when the user wants evidence for a claim about AI crawler access or llms.txt, a statistic to cite, or the reports behind the benchmarks.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Optional. A report slug from the list this tool returns with no argument. Omit to list the reports.' }
      }
    },
    annotations: { title: 'Get Citehound research', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'get_sample_report',
    title: 'Get the sample full-site report',
    description: 'Returns the sample Pro report as readable text: a real crawl of Citehound’s own site on a stated date, nothing edited. It gives the whole-site score beside the homepage score, the pillar averages, the top priorities from the executive summary with the label saying what wrote it, the checks failing by number of pages, and the link to the full report. It shows what a full-site crawl adds to a one-page scan. It is our own site, not a customer’s, and it measures readiness, not whether any assistant names the site. Read-only, fetches nothing external. Use when the user asks what a full-site report looks like or what a crawl shows that a homepage scan cannot.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Get the sample full-site report', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }
];

/* ---------------- tool handlers ---------------- */
/* Each handler resolves to { isError: boolean, text: string }. Protocol-
   level errors (unknown method, unknown tool, malformed JSON-RPC) are
   reported via the JSON-RPC `error` field instead — see module.exports. */

var HANDLERS = {

  scan_site: async function (args, req) {
    var domain = normalizeDomain(args && args.domain);
    if (!domain) {
      return { isError: true, text: 'Invalid or missing "domain". Expected a bare hostname, e.g. "example.com" — no scheme, no path.' };
    }

    var limited = await liveLimit(domain);
    if (limited) return limited;

    var scanResult = await scanner.scanPage('https://' + domain + '/');
    if (!scanResult.ok) return { isError: true, text: scanFailureMessage(domain, scanResult) };

    return { isError: false, text: formatScanResult(domain, scanResult, computeOverallBenchmark()) + formatCommerce(scanResult.commerce) };
  },

  compare_sites: async function (args, req) {
    var a = normalizeDomain(args && args.domain_a);
    var b = normalizeDomain(args && args.domain_b);
    if (!a || !b) {
      return { isError: true, text: 'Both "domain_a" and "domain_b" are required, as bare hostnames, e.g. "example.com".' };
    }
    if (a === b) {
      return { isError: true, text: '"domain_a" and "domain_b" must be different domains — both normalized to "' + a + '".' };
    }

    var limA = await liveLimit(a);
    if (limA) return limA;
    var scanA = await withDeadline(scanner.scanPage('https://' + a + '/', { commerce: false }), SCAN_DEADLINE_MS);

    var scanB;
    var limB = await liveLimit(b);
    if (limB) scanB = { ok: false, stage: 'limit', kind: limB.text };
    else scanB = await withDeadline(scanner.scanPage('https://' + b + '/', { commerce: false }), SCAN_DEADLINE_MS);

    if (!scanA.ok && !scanB.ok) {
      return { isError: true, text: 'Neither site could be scanned.\n' + failureLine(a, scanA) + '\n' + failureLine(b, scanB) };
    }
    if (!scanA.ok || !scanB.ok) {
      // One result is better than none: return the site that worked and say exactly why the other did not.
      var goodDomain = scanA.ok ? a : b, good = scanA.ok ? scanA : scanB;
      var badDomain = scanA.ok ? b : a, bad = scanA.ok ? scanB : scanA;
      return { isError: false, text: 'Only ' + goodDomain + ' could be compared. ' + failureLine(badDomain, bad) + '\n\n' + formatScanResult(goodDomain, good, computeOverallBenchmark()) };
    }

    return { isError: false, text: formatCompareResult(a, scanA, b, scanB) };
  },

  generate_schema: async function (args, req) {
    var domain = normalizeDomain(args && args.domain);
    if (!domain) {
      return { isError: true, text: 'Invalid or missing "domain". Expected a bare hostname, e.g. "example.com".' };
    }
    var type = args && args.type;
    var validTypes = Object.keys(SCHEMA_TYPE_LABEL);
    if (validTypes.indexOf(type) === -1) {
      return { isError: true, text: '"type" must be one of: ' + validTypes.join(', ') + ' (got ' + JSON.stringify(type === undefined ? null : type) + ').' };
    }

    var limitedSchema = await liveLimit(domain);
    if (limitedSchema) return limitedSchema;

    var info = await scanner.fetchSiteInfo(domain);
    if (!info.ok) {
      return { isError: true, text: 'Could not read the homepage at https://' + domain + '/ (' + info.detail + '). Confirm the domain is correct and reachable, then try again.' };
    }
    var schema = schemaLib.buildFromSite(type, domain, info.siteInfo);

    var text = SCHEMA_TYPE_LABEL[type] + ' JSON-LD for ' + domain + ', ready to paste inside a <script type="application/ld+json"> tag in the page’s <head>:\n\n' +
      JSON.stringify(schema, null, 2);
    return { isError: false, text: text };
  },

  generate_robots_txt: async function (args) {
    var allow = Array.isArray(args && args.allow) ? args.allow : [];
    var block = Array.isArray(args && args.block) ? args.block : [];
    var sitemapUrl = args && typeof args.sitemap_url === 'string' ? args.sitemap_url.trim() : '';

    var knownNames = CRAWLERS.map(function (c) { return c.ua; });
    var unknown = allow.concat(block).filter(function (name) { return knownNames.indexOf(name) === -1; });
    if (unknown.length > 0) {
      return { isError: true, text: 'Unknown crawler name(s): ' + unknown.join(', ') + '. Tracked crawlers are: ' + knownNames.join(', ') + '.' };
    }
    var both = allow.filter(function (name) { return block.indexOf(name) !== -1; });
    if (both.length > 0) {
      return { isError: true, text: 'Crawler(s) listed in both "allow" and "block": ' + both.join(', ') + '. Each crawler can only be in one list.' };
    }
    if (allow.length === 0 && block.length === 0 && !sitemapUrl) {
      return { isError: true, text: 'Nothing to generate: provide at least one crawler in "allow" or "block", or a "sitemap_url".' };
    }

    var lines = [];
    CRAWLERS.forEach(function (c) {
      if (allow.indexOf(c.ua) !== -1) {
        lines.push('User-agent: ' + c.ua);
        lines.push('Allow: /');
        lines.push('');
      } else if (block.indexOf(c.ua) !== -1) {
        lines.push('User-agent: ' + c.ua);
        lines.push('Disallow: /');
        lines.push('');
      }
    });
    if (sitemapUrl) {
      lines.push('Sitemap: ' + sitemapUrl);
    } else if (lines[lines.length - 1] === '') {
      lines.pop();
    }

    return { isError: false, text: 'robots.txt — paste this at your site root (e.g. https://yoursite.com/robots.txt):\n\n' + lines.join('\n') };
  },

  generate_llms_txt: async function (args) {
    var name = args && typeof args.name === 'string' ? args.name.trim() : '';
    var description = args && typeof args.description === 'string' ? args.description.trim() : '';
    var keyPages = Array.isArray(args && args.key_pages) ? args.key_pages : [];

    if (!name) return { isError: true, text: '"name" is required — the site or product name for the llms.txt header.' };
    if (!description) return { isError: true, text: '"description" is required — a one-sentence summary of the site.' };

    var badIndexes = [];
    keyPages.forEach(function (p, i) {
      var okUrl = p && typeof p.url === 'string' && p.url.trim();
      var okDesc = p && typeof p.description === 'string' && p.description.trim();
      if (!okUrl || !okDesc) badIndexes.push(i);
    });
    if (badIndexes.length > 0) {
      return { isError: true, text: '"key_pages" entries at index ' + badIndexes.join(', ') + ' are missing a "url" or "description" — each entry needs both.' };
    }

    var lines = ['# ' + name, '', '> ' + description];
    if (keyPages.length > 0) {
      lines.push('');
      lines.push('## Pages');
      keyPages.forEach(function (p) {
        lines.push('- [' + p.description.trim() + '](' + p.url.trim() + ')');
      });
    }

    return { isError: false, text: 'llms.txt — paste this at your site root (e.g. https://yoursite.com/llms.txt):\n\n' + lines.join('\n') };
  },

  get_playbook: async function (args) {
    var vertical = args && typeof args.vertical === 'string' ? args.vertical.trim() : '';
    if (!vertical) return mcpContent.playbookList();
    var found = findVertical(vertical);
    if (!found) {
      return { isError: true, text: 'Unknown vertical "' + vertical + '". Valid verticals: ' + ALL_VERTICALS.join(', ') + '.' };
    }
    return { isError: false, text: found.entry.name + ' (' + found.track + ')\n\n' + htmlToText(found.entry.content) };
  },

  get_benchmark: async function (args) {
    var category = args && typeof args.category === 'string' && args.category.trim() ? args.category.trim() : null;

    var entries;
    try {
      entries = loadBenchmarkEntries();
    } catch (e) {
      return { isError: true, text: 'Benchmark data is unavailable right now.' };
    }
    var validCategories = entries.map(function (e) { return e.category; });

    if (!category) {
      var rows = [];
      entries.forEach(function (e) {
        var summary = loadSummary(e.category);
        if (summary && summary.score && summary.scanned) rows.push({ entry: e, summary: summary });
      });
      if (rows.length === 0) return { isError: true, text: 'Benchmark data is unavailable right now.' };

      rows.sort(function (x, y) { return y.summary.score.average - x.summary.score.average; });
      var totalSites = rows.reduce(function (s, row) { return s + row.summary.scanned; }, 0);
      var overallAvg = Math.round(rows.reduce(function (s, row) { return s + row.summary.score.average * row.summary.scanned; }, 0) / totalSites);

      var lines = ['AI readiness benchmarks across ' + rows.length + ' categories (' + totalSites + ' sites scanned, weighted average ' + overallAvg + '/100):', ''];
      rows.forEach(function (row) {
        lines.push('  ' + row.summary.score.average + '/100  ' + row.entry.label + '  (' + row.entry.track + ', ' + row.summary.scanned + ' ' + (row.entry.note || 'sites') + ', scanned ' + row.summary.scannedAt + ')');
      });
      lines.push('');
      lines.push('Call get_benchmark with a category for the full breakdown: ' + validCategories.join(', ') + '.');
      return { isError: false, text: lines.join('\n') };
    }

    if (validCategories.indexOf(category) === -1) {
      return { isError: true, text: 'Unknown category "' + category + '". Valid categories: ' + validCategories.join(', ') + '.' };
    }
    var entry = entries.filter(function (e) { return e.category === category; })[0];
    var summary = loadSummary(category);
    if (!summary) return { isError: true, text: 'No benchmark data available yet for "' + category + '".' };

    var s = summary.score;
    var out = [];
    out.push('AI readiness benchmark: ' + entry.label + ' (' + entry.track + ')');
    out.push('Scanned ' + summary.scanned + ' ' + (entry.note || 'sites') + ' as of ' + summary.scannedAt +
      (summary.failed ? (' (' + summary.failed + ' more could not be reached)') : '') + '.');
    out.push('');
    out.push('Score — average ' + s.average + '/100, median ' + s.median + ', range ' + s.lowest + '–' + s.highest + '.');
    out.push('  Discoverability:      ' + s.averageDiscoverability + '/40');
    out.push('  Technical foundation: ' + s.averageTechnical + '/20');
    out.push('  Content & trust:      ' + s.averageTrust + '/40');

    if (summary.crawlers) {
      out.push('');
      out.push('Crawler access: ' + summary.crawlers.blockingAtLeastOnePct + '% of sites block at least one AI crawler.');
      var perBot = summary.crawlers.perBot;
      if (perBot && Object.keys(perBot).length) {
        var names = Object.keys(perBot);
        var width = names.reduce(function (w, n) { return Math.max(w, n.length); }, 0);
        out.push('By crawler, in number of sites (' + summary.scanned + ' scanned):');
        names.forEach(function (n) {
          var b = perBot[n];
          out.push('  ' + n + new Array(width - n.length + 1).join(' ') + '  blocked ' + b.blocked + ', limited ' + b.limited + ', open ' + b.open);
        });
        out.push('Limited means a bot has at least one Disallow rule that applies to it, which is usually an ordinary path such as an admin area, not a block on the site.');
      }
    }

    if (summary.checkFailureRates) {
      // Crawler access is reported above and per crawler elsewhere. Older summaries
      // stored it here as "AI crawler access (N/10 open)" rows, which are not failure rates.
      var rates = Object.keys(summary.checkFailureRates)
        .filter(function (k) { return !/^AI crawler access/i.test(k); })
        .map(function (k) { return { label: k, pct: summary.checkFailureRates[k] }; });
      rates.sort(function (x, y) { return y.pct - x.pct; });
      out.push('');
      out.push('Failure rate by check:');
      rates.forEach(function (r) { out.push('  ' + r.pct + '%  ' + r.label); });
    }

    return { isError: false, text: out.join('\n') };
  },

  list_ai_crawlers: async function () {
    var lines = ['The ' + CRAWLERS.length + ' AI crawlers Citehound tracks:', ''];
    CRAWLERS.forEach(function (c) {
      lines.push(c.ua + ' (' + c.vendor + ')');
      lines.push('  ' + c.desc);
      lines.push('  This project’s robots.txt generator defaults it to: ' + (c.defaultAllow ? 'Allow' : 'Disallow') + '.');
      lines.push('');
    });
    return { isError: false, text: lines.join('\n').replace(/\n+$/, '') };
  },

  get_citation_prompts: async function (args) {
    return citation.promptsFor(args && args.vertical);
  },

  get_citation_sample: async function () {
    return citation.sampleText();
  },

  get_methodology: async function (args) {
    var check = args && typeof args.check === 'string' ? args.check.trim() : '';
    if (!check) return { isError: false, text: methodology.overview() };
    var found = methodology.findCheck(check);
    if (!found) return { isError: true, text: 'Unknown check "' + check + '". Valid check labels: ' + methodology.labels().join('; ') + '.' };
    return { isError: false, text: methodology.detail(found) };
  },

  get_research: async function (args) {
    return mcpContent.research(args && args.slug);
  },

  get_sample_report: async function () {
    return mcpContent.sampleReport();
  }

};

/* ---------------- JSON-RPC plumbing ---------------- */

var SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo';

// 2026-07-28: servers SHOULD identify themselves in every result's _meta.
function withServerInfo(result) {
  var meta = {};
  meta[SERVER_INFO_META_KEY] = SERVER_INFO;
  result._meta = meta;
  return result;
}

function rpcResult(id, result) { return { jsonrpc: '2.0', id: id, result: result }; }
function rpcError(id, code, message) { return { jsonrpc: '2.0', id: (id === undefined ? null : id), error: { code: code, message: message } }; }
function toolResult(outcome) {
  return withServerInfo({
    resultType: 'complete',
    isError: !!outcome.isError,
    content: [{ type: 'text', text: outcome.text }]
  });
}

/* ---------------- per-request validation (2026-07-28) ---------------- */

const MODERN_VERSIONS = ['2026-07-28'];
const LATEST_LEGACY_VERSION = '2025-11-25';
const META_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const META_CAPS_KEY = 'io.modelcontextprotocol/clientCapabilities';

function headerValue(req, name) {
  var v = req.headers && req.headers[name];
  if (Array.isArray(v)) v = v.join(', ');
  return typeof v === 'string' ? v.trim() : undefined;
}

// Mcp-Name may carry a =?base64?...?= sentinel for non-ASCII values.
function decodeMcpName(v) {
  var m = /^=\?base64\?(.*)\?=$/.exec(v);
  if (!m) return v;
  try { return Buffer.from(m[1], 'base64').toString('utf8'); } catch (e) { return v; }
}

function isPlainObject(x) { return x && typeof x === 'object' && !Array.isArray(x); }

// Decides which era a request belongs to and rejects it with the spec's
// error if it is malformed for that era. Returns { era } or { reject }.
//   modern  — declares 2026-07-28: header, _meta and mirrored headers are
//             all required and cross-checked.
//   legacy  — declares an older supported version: 2025-06-18 and
//             2025-11-25 clients send the MCP-Protocol-Version header but
//             no _meta. Served as before, no _meta required.
// A request declaring no version at all is rejected: every supported
// revision sends the header, and 2025-03-26 (which did not) is not served.
function classifyRequest(req, body) {
  var method = body.method;
  var params = isPlainObject(body.params) ? body.params : {};
  var meta = isPlainObject(params._meta) ? params._meta : null;

  var hdrVersion = headerValue(req, 'mcp-protocol-version');
  var metaVersion = meta && typeof meta[META_VERSION_KEY] === 'string' ? meta[META_VERSION_KEY] : undefined;

  function reject(status, code, message, data) { return { reject: { status: status, code: code, message: message, data: data } }; }

  if (hdrVersion === undefined) {
    return reject(400, -32020, 'Header mismatch: the MCP-Protocol-Version header is required on every request and was not sent' +
      (metaVersion !== undefined ? ' (the request body declares ' + metaVersion + ').' : '.'));
  }
  if (metaVersion !== undefined && metaVersion !== hdrVersion) {
    return reject(400, -32020, 'Header mismatch: MCP-Protocol-Version header value \'' + hdrVersion + '\' does not match _meta protocol version \'' + metaVersion + '\'.');
  }
  if (SUPPORTED_PROTOCOL_VERSIONS.indexOf(hdrVersion) === -1) {
    return reject(400, -32022, 'Unsupported protocol version', { supported: SUPPORTED_PROTOCOL_VERSIONS, requested: hdrVersion });
  }
  if (MODERN_VERSIONS.indexOf(hdrVersion) === -1) {
    return { era: 'legacy', version: hdrVersion };
  }

  // Modern from here on.
  if (!meta || metaVersion === undefined) {
    return reject(400, -32602, 'Invalid params: _meta["' + META_VERSION_KEY + '"] is required on every ' + hdrVersion + ' request.');
  }
  if (!isPlainObject(meta[META_CAPS_KEY])) {
    return reject(400, -32602, 'Invalid params: _meta["' + META_CAPS_KEY + '"] is required on every ' + hdrVersion + ' request (an object, {} if the client has none).');
  }
  var mcpMethod = headerValue(req, 'mcp-method');
  if (mcpMethod === undefined) {
    return reject(400, -32020, 'Header mismatch: the Mcp-Method header is required and was not sent.');
  }
  if (mcpMethod !== method) {
    return reject(400, -32020, 'Header mismatch: Mcp-Method header value \'' + mcpMethod + '\' does not match body value \'' + method + '\'.');
  }
  if (method === 'tools/call' || method === 'prompts/get') {
    var mcpName = headerValue(req, 'mcp-name');
    if (mcpName === undefined) {
      return reject(400, -32020, 'Header mismatch: the Mcp-Name header is required for ' + method + ' and was not sent.');
    }
    if (decodeMcpName(mcpName) !== params.name) {
      return reject(400, -32020, 'Header mismatch: Mcp-Name header value \'' + decodeMcpName(mcpName) + '\' does not match body value \'' + params.name + '\'.');
    }
  }
  return { era: 'modern', version: hdrVersion };
}

function rpcErrorFull(id, code, message, data) {
  var e = { jsonrpc: '2.0', id: (id === undefined ? null : id), error: { code: code, message: message } };
  if (data !== undefined) e.error.data = data;
  return e;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json(rpcError(null, -32601, 'Method not allowed. POST a JSON-RPC 2.0 request to this endpoint.'));
    return;
  }

  var body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json(rpcError(null, -32700, 'Parse error: request body must be a single JSON-RPC 2.0 object (batched arrays are not supported).'));
    return;
  }

  var hasId = Object.prototype.hasOwnProperty.call(body, 'id');
  var id = hasId ? body.id : null;
  var method = body.method;

  if (typeof method !== 'string' || !method) {
    res.status(400).json(rpcError(id, -32600, 'Invalid Request: "method" is required and must be a string.'));
    return;
  }

  // initialize and notifications are legacy-only shapes and are never
  // validated; everything else is classified by the version it declares.
  var era = 'legacy';
  if (method !== 'initialize' && method.indexOf('notifications/') !== 0) {
    var verdict = classifyRequest(req, body);
    if (verdict.reject) {
      res.status(verdict.reject.status).json(rpcErrorFull(id, verdict.reject.code, verdict.reject.message, verdict.reject.data));
      return;
    }
    era = verdict.era;
  }

  try {
    if (method === 'initialize') {
      // Legacy handshake, answered for clients that still send it.
      // Legacy negotiation: echo the client's version when we serve it,
      // otherwise offer the newest handshake-era version. 2026-07-28 has no
      // handshake, so it is never the answer to initialize.
      var requested = body.params && body.params.protocolVersion;
      var negotiated = (typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.indexOf(requested) !== -1 && MODERN_VERSIONS.indexOf(requested) === -1)
        ? requested : LATEST_LEGACY_VERSION;
      res.status(200).json(rpcResult(id, {
        protocolVersion: negotiated,
        capabilities: { tools: {}, prompts: {} },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS
      }));
      return;
    }

    if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
      // Notifications never get a JSON-RPC body back.
      res.status(hasId ? 200 : 202);
      if (hasId) res.json(rpcResult(id, {}));
      else res.end();
      return;
    }

    if (method === 'server/discover') {
      res.status(200).json(rpcResult(id, withServerInfo({
        resultType: 'complete',
        supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
        capabilities: { tools: {}, prompts: { listChanged: false } },
        instructions: SERVER_INSTRUCTIONS,
        ttlMs: 3600000,
        cacheScope: 'public'
      })));
      return;
    }

    if (method === 'ping' && era === 'legacy') {
      // ping was removed in 2026-07-28; still answered for older clients.
      res.status(200).json(rpcResult(id, { resultType: 'complete' }));
      return;
    }

    if (method === 'tools/list') {
      res.status(200).json(rpcResult(id, withServerInfo({
        resultType: 'complete',
        tools: TOOLS,
        ttlMs: 3600000,
        cacheScope: 'public'
      })));
      return;
    }

    if (method === 'prompts/list') {
      res.status(200).json(rpcResult(id, withServerInfo({
        resultType: 'complete',
        prompts: mcpPrompts.list(),
        ttlMs: 3600000,
        cacheScope: 'public'
      })));
      return;
    }

    if (method === 'prompts/get') {
      var pParams = (body.params && typeof body.params === 'object') ? body.params : {};
      if (typeof pParams.name !== 'string' || !pParams.name) {
        res.status(400).json(rpcError(id, -32602, 'Invalid params: "name" is required for prompts/get.'));
        return;
      }
      var got = mcpPrompts.get(pParams.name, pParams.arguments);
      if (!got.ok) {
        res.status(400).json(rpcError(id, -32602, got.message));
        return;
      }
      res.status(200).json(rpcResult(id, withServerInfo({ resultType: 'complete', description: got.description, messages: got.messages })));
      return;
    }

    if (method === 'tools/call') {
      var params = (body.params && typeof body.params === 'object') ? body.params : {};
      var toolName = params.name;
      var args = (params.arguments && typeof params.arguments === 'object') ? params.arguments : {};

      if (typeof toolName !== 'string' || !toolName) {
        res.status(400).json(rpcError(id, -32602, 'Invalid params: "name" is required for tools/call.'));
        return;
      }
      var handler = HANDLERS[toolName];
      if (!handler) {
        res.status(400).json(rpcError(id, -32602, 'Unknown tool: "' + toolName + '". Call tools/list for the available tools: ' +
          TOOLS.map(function (t) { return t.name; }).join(', ') + '.'));
        return;
      }

      var outcome = await handler(args, req);
      res.status(200).json(rpcResult(id, toolResult(outcome)));
      return;
    }

    res.status(404).json(rpcError(id, -32601, 'Method not found: "' + method + '". This server implements initialize, server/discover, tools/list, tools/call, prompts/list, prompts/get and ping.'));
  } catch (err) {
    console.error('[mcp] unhandled error for method', method, '—', err && err.stack ? err.stack : err);
    res.status(200).json(rpcResult(id, toolResult({ isError: true, text: 'Unexpected server error. Please try again.' })));
  }
};

// The registry, for lib/mcp-docs.js (which derives the tool count shown in mcp.html).
module.exports.TOOLS = TOOLS;
module.exports.HANDLERS = HANDLERS;
module.exports.PROMPTS = mcpPrompts.PROMPTS;
