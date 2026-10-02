/* =====================================================================
   /api/mcp — Answerable's MCP server.

   Exposes the scanner and the playbook/benchmark content as 8 MCP
   tools, all read-only, over a single JSON-RPC-over-HTTP endpoint.

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
     - The new `_meta`/`MCP-Protocol-Version`/`Mcp-Method` requirements
       are read when present but never enforced. Rejecting requests
       that lack headers most real clients don't send yet would break
       far more than it would protect, for a public, read-only,
       unauthenticated, tool-only server with no sessions, resources,
       prompts, sampling, elicitation or subscriptions to speak of.
     - Origin validation (the spec's DNS-rebinding protection) applies
       to locally-bound servers reachable from a browser tab on the
       same machine. This is a public, remote, stateless, read-only
       endpoint — there is no local socket to rebind to — so Origin is
       not enforced; the public-endpoint analogue of that protection is
       simply "every tool is read-only."

   RATE LIMITING
   -------------------------------------------------------------------
   The three tools that fetch a live, arbitrary third-party domain
   (scan_site, compare_sites, generate_schema) share the exact counter
   api/scan.js uses (api/_rateLimit.js — 20/hour, 100/day per caller).
   compare_sites consumes two units, one per constituent scan, since it
   performs two real fetches. The five tools that only read this
   project's own static content (generate_robots_txt, generate_llms_txt,
   get_playbook, get_benchmark, list_ai_crawlers) are not rate limited —
   there is no third party to protect from them.

   No caller identity is stored anywhere; api/_rateLimit.js keeps only a
   SHA-256 hash of the caller's IP behind a short TTL counter, same as
   the public scan endpoint.
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const { checkRateLimit } = require('./_rateLimit');
const scanner = require('../lib/scanner');
const playbooks = require('../lib/playbooks');
const CRAWLERS = require('../lib/crawlers');

const PROTOCOL_VERSION = '2026-07-28';
const SUPPORTED_PROTOCOL_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'];
const SERVER_INFO = { name: 'answerable', title: 'Answerable', version: '1.0.0' };
const SERVER_INSTRUCTIONS = 'Answerable scans a domain’s public robots.txt, llms.txt and homepage for AI-crawler access and on-page signals, and generates the fixes (schema, robots.txt, llms.txt). Every tool is read-only and non-destructive.';
const DATA_DIR = path.join(__dirname, '..', 'data');

/* ---------------- shared small helpers ---------------- */

function normalizeDomain(raw) {
  var d = (typeof raw === 'string' ? raw : '').trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)) return null;
  return d;
}

function rateLimitMessage(rl) {
  return rl.scope === 'hour'
    ? 'Rate limit reached: this server allows 20 scans per hour per caller. Try again in a little while.'
    : 'Rate limit reached: this server allows 100 scans per day per caller. Try again tomorrow.';
}

function scanFailureMessage(domain, scanResult) {
  var detail = scanResult.kind || scanResult.error || 'unknown error';
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

/* ---------------- JSON-LD builders (generate_schema) ---------------- */

var SCHEMA_TYPE_LABEL = {
  organization: 'Organization and WebSite',
  faqpage: 'FAQPage',
  article: 'Article',
  product: 'Product'
};

function buildSchema(type, domain, siteInfo) {
  var siteUrl = 'https://' + domain;
  var title = siteInfo.title || '';
  var metaDesc = siteInfo.metaDesc || '';
  var lang = siteInfo.lang || '';

  if (type === 'organization') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          name: '[Your company name]',
          url: siteUrl,
          description: metaDesc || '[A one-sentence description of your business]'
        },
        {
          '@type': 'WebSite',
          name: title || '[Your site name]',
          url: siteUrl,
          inLanguage: lang || '[e.g. en]'
        }
      ]
    };
  }

  if (type === 'article') {
    return {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: title || '[Your page title]',
      description: metaDesc || '[A one-sentence description of this page]',
      inLanguage: lang || '[e.g. en]',
      author: { '@type': 'Organization', name: '[Your company name]' },
      datePublished: '[YYYY-MM-DD]',
      url: siteUrl
    };
  }

  if (type === 'faqpage') {
    // Nothing about real FAQ content is knowable from a homepage scan.
    // Every field here is a placeholder on purpose.
    return {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: '[A real question your visitors actually ask]',
          acceptedAnswer: { '@type': 'Answer', text: '[The real answer, in plain text]' }
        },
        {
          '@type': 'Question',
          name: '[A second real question]',
          acceptedAnswer: { '@type': 'Answer', text: '[The real answer]' }
        }
      ]
    };
  }

  // product
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: title || '[Your product name]',
    description: metaDesc || '[A one-sentence product description]',
    url: siteUrl,
    brand: { '@type': 'Brand', name: '[Your brand name]' },
    offers: {
      '@type': 'Offer',
      price: '[e.g. 29.99]',
      priceCurrency: '[e.g. USD]',
      availability: '[e.g. https://schema.org/InStock]',
      url: siteUrl
    }
  };
}

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
    description: 'Scans a domain’s public robots.txt, llms.txt, sitemap declaration and homepage, and scores it out of 100 across three pillars: discoverability (can AI crawlers reach it), technical foundation (can machines parse it), and content & trust (does it look like a credible source). Returns the score, the three pillar scores, access state for the 10 tracked AI crawlers, every failed check with its fix, and how the score compares to Answerable’s own benchmark data. Call this first for any domain. It fetches the live site, so avoid calling it in a tight loop for the same domain.',
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
          enum: ['organization', 'faqpage', 'article', 'product'],
          description: '"organization" returns Organization + WebSite schema as an @graph; the others each return one schema of that @type.'
        }
      },
      required: ['domain', 'type']
    },
    annotations: { title: 'Generate JSON-LD for a site', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  {
    name: 'generate_robots_txt',
    title: 'Generate an AI-crawler robots.txt',
    description: 'Builds a robots.txt file that explicitly allows or blocks named AI crawlers from Answerable’s tracked list of 10, plus an optional Sitemap line. Pure text generation — fetches nothing. Call list_ai_crawlers first if you need the exact tracked crawler names.',
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
    description: 'Returns the full GEO/AEO playbook for one of Answerable’s fourteen verticals, as plain readable text: the strategic shift, three actionable strategies, outdated pitfalls to avoid, and an expert-tip placeholder. Read live from this project’s own content file, so it matches what a visitor to the site sees. Fetches nothing external.',
    inputSchema: {
      type: 'object',
      properties: {
        vertical: {
          type: 'string',
          description: 'A vertical slug. B2B SaaS: crm, martech, hrtech, fintech, cybersecurity, devtools. Consumer brands: ecommerce, consumerapps, hospitality, marketplaces. Professionals: health, localservices, realestate, legal.'
        }
      },
      required: ['vertical']
    },
    annotations: { title: 'Get a vertical playbook', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'get_benchmark',
    title: 'Get category benchmark data',
    description: 'Returns Answerable’s own archived scan data for one category — average, median and range of scores, pillar breakdowns, crawler-blocking rates and the most common failed checks, with sample size and scan date — or a ranked summary across every category when called with no argument. This is archived data, not a live scan, and fetches nothing external.',
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
    description: 'Lists the 10 AI crawlers Answerable tracks: which company runs each, what allowing or blocking it actually means, and this project’s robots.txt generator’s default for it. Use before generate_robots_txt if you need the exact tracked names. Fetches nothing.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'List tracked AI crawlers', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
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

    var rl = await checkRateLimit(req);
    if (rl.limited) return { isError: true, text: rateLimitMessage(rl) };

    var scanResult = await scanner.scanPage('https://' + domain + '/');
    if (!scanResult.ok) return { isError: true, text: scanFailureMessage(domain, scanResult) };

    return { isError: false, text: formatScanResult(domain, scanResult, computeOverallBenchmark()) };
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

    var rl1 = await checkRateLimit(req);
    if (rl1.limited) return { isError: true, text: rateLimitMessage(rl1) };
    var scanA = await scanner.scanPage('https://' + a + '/');
    if (!scanA.ok) return { isError: true, text: scanFailureMessage(a, scanA) };

    var rl2 = await checkRateLimit(req);
    if (rl2.limited) return { isError: true, text: rateLimitMessage(rl2) };
    var scanB = await scanner.scanPage('https://' + b + '/');
    if (!scanB.ok) return { isError: true, text: scanFailureMessage(b, scanB) };

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

    var rl = await checkRateLimit(req);
    if (rl.limited) return { isError: true, text: rateLimitMessage(rl) };

    var pageRes = await scanner.fetchText('https://' + domain + '/', 12000, 'page', scanner.DEFAULT_BROWSER_UA);
    if (!pageRes.ok || !pageRes.text) {
      return { isError: true, text: 'Could not read the homepage at https://' + domain + '/ (' + (pageRes.kind || pageRes.error || 'unknown error') + '). Confirm the domain is correct and reachable, then try again.' };
    }
    var sig = scanner.parseSignals(pageRes.text);
    var schema = buildSchema(type, domain, { title: sig.title, metaDesc: sig.metaDesc, lang: sig.lang });

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
    if (!vertical) {
      return { isError: true, text: '"vertical" is required. Valid verticals: ' + ALL_VERTICALS.join(', ') + '.' };
    }
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
      out.push('Crawler access: ' + summary.crawlers.blockingAtLeastOnePct + '% of sites block at least one AI crawler; ' +
        summary.crawlers.notFullyOpenToAllPct + '% are not fully open to all ten.');
    }

    if (summary.checkFailureRates) {
      var rates = Object.keys(summary.checkFailureRates).map(function (k) { return { label: k, pct: summary.checkFailureRates[k] }; });
      rates.sort(function (x, y) { return y.pct - x.pct; });
      out.push('');
      out.push('Failure rate by check:');
      rates.forEach(function (r) { out.push('  ' + r.pct + '%  ' + r.label); });
    }

    return { isError: false, text: out.join('\n') };
  },

  list_ai_crawlers: async function () {
    var lines = ['The ' + CRAWLERS.length + ' AI crawlers Answerable tracks:', ''];
    CRAWLERS.forEach(function (c) {
      lines.push(c.ua + ' (' + c.vendor + ')');
      lines.push('  ' + c.desc);
      lines.push('  This project’s robots.txt generator defaults it to: ' + (c.defaultAllow ? 'Allow' : 'Disallow') + '.');
      lines.push('');
    });
    return { isError: false, text: lines.join('\n').replace(/\n+$/, '') };
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

  try {
    if (method === 'initialize') {
      // Legacy handshake, answered for clients that still send it.
      res.status(200).json(rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
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
        capabilities: { tools: {} },
        instructions: SERVER_INSTRUCTIONS,
        ttlMs: 3600000,
        cacheScope: 'public'
      })));
      return;
    }

    if (method === 'ping') {
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
        res.status(404).json(rpcError(id, -32601, 'Method not found: no tool named "' + toolName + '". Call tools/list for the available tools: ' +
          TOOLS.map(function (t) { return t.name; }).join(', ') + '.'));
        return;
      }

      var outcome = await handler(args, req);
      res.status(200).json(rpcResult(id, toolResult(outcome)));
      return;
    }

    res.status(404).json(rpcError(id, -32601, 'Method not found: "' + method + '". This server implements initialize, server/discover, tools/list, tools/call and ping.'));
  } catch (err) {
    console.error('[mcp] unhandled error for method', method, '—', err && err.stack ? err.stack : err);
    res.status(200).json(rpcResult(id, toolResult({ isError: true, text: 'Unexpected server error. Please try again.' })));
  }
};
