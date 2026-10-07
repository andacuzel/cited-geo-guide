/* =====================================================================
   lib/mcp-prompts.js

   The MCP prompts registry: three user-invoked workflows. Each prompt's text
   names the tools to call, in order, and carries the honest-framing rule:
   Citehound measures readiness (can crawlers reach and read a site), not
   whether any assistant names a brand.

   The registry is the one place that says how many prompts there are.
   mcp.html and docs/mcp-submission.md derive their counts from it.
   ===================================================================== */

'use strict';

const scanner = require('./scanner');
const citation = require('./citation-content');

const FRAMING = 'Say plainly what this does not measure: it is a readiness score from the homepage, not a measure of whether any assistant names the brand, and a high score does not guarantee a mention. When a brand appears in an answer, say it was "named", never anything stronger. Do not forecast traffic.';

const PROMPTS = [
  {
    name: 'geo_audit',
    title: 'Audit a site for AI readiness',
    description: 'Scans a domain, compares it with its category benchmark, reads the matching playbook, generates the fixes and returns an ordered plan, then says what the scan does not measure.',
    arguments: [{ name: 'domain', description: 'A bare domain, e.g. "example.com". No scheme and no path.', required: true }],
    build: function (a) {
      return [
        'Audit ' + a.domain + ' for AI readiness and give me an ordered plan. Work through these steps with the Citehound tools:',
        '',
        '1. Call scan_site with domain "' + a.domain + '". Note the score, the three pillar scores, the state of each tracked AI crawler and every failed check.',
        '2. Call get_benchmark with no argument, then with the category that best matches the site, and say how the score compares with that category’s average. If no category fits, compare with the overall average and say so.',
        '3. Call get_playbook with no argument to list the verticals, choose the one that matches the site, and call get_playbook with its slug. Pull out the strategies that apply to the failed checks.',
        '4. For each failed check, produce the fix: generate_schema for schema checks (organization, faqpage, article, product or localbusiness), generate_robots_txt for crawler access (call list_ai_crawlers for the exact crawler names), generate_llms_txt if llms.txt is missing. Leave bracketed placeholders as they are; do not invent facts.',
        '5. Return the plan ordered by points at stake, highest first. One block per item: the check, the points at stake, the fix and where it goes.',
        '6. If the user asks why a check is scored the way it is, call get_methodology.',
        '',
        FRAMING
      ].join('\n');
    }
  },
  {
    name: 'commerce_readiness',
    title: 'Check a store for agentic-commerce readiness',
    description: 'Scans a store, reads the commerce sub-score (UCP endpoint, product schema, llms.txt authorship) and returns what to fix, with a replacement llms.txt if the file is a platform default.',
    arguments: [{ name: 'domain', description: 'A bare domain of an online store, e.g. "shop.example.com".', required: true }],
    build: function (a) {
      return [
        'Check ' + a.domain + ' for agentic-commerce readiness. Use the Citehound tools:',
        '',
        '1. Call scan_site with domain "' + a.domain + '". If the report says the site is not treated as a store, stop and say so: the commerce checks run only for stores.',
        '2. From the commerce section, report the sub-score and each part: whether a UCP merchant profile exists at /.well-known/ucp (and its version and capabilities), which of name, price, availability and image the checked product page declares, and whether the llms.txt looks like a platform default.',
        '3. If the product data is incomplete, call generate_schema with type "product" and explain which fields come from the store’s catalog. Leave placeholders in brackets.',
        '4. If the llms.txt looks like a platform default, call generate_llms_txt with the store’s name, a one-sentence description and its key pages, and say the brand should check every line.',
        '5. Call get_playbook with slug "ecommerce" and use it for the content advice.',
        '6. Return the fixes in order, highest value first.',
        '',
        FRAMING + ' The commerce sub-score is scored separately and never counts toward the 100.'
      ].join('\n');
    }
  },
  {
    name: 'citation_questions',
    title: 'Get the questions to test whether an assistant names a brand',
    description: 'Returns the buying-intent question set for a vertical and the protocol for running it yourself in any assistant, five tries per question, and what to record.',
    arguments: [
      { name: 'vertical', description: 'A vertical slug, e.g. "crm". Valid: ' + citation.verticals().join(', ') + '.', required: true },
      { name: 'brand', description: 'The brand name to look for in the answers.', required: true }
    ],
    build: function (a) {
      return [
        'Help me test whether an assistant names ' + a.brand + ' for the ' + a.vertical + ' category. There is no tool that runs the check for you; you give me the questions and the protocol, and I run them myself.',
        '',
        '1. Call get_citation_prompts with vertical "' + a.vertical + '" and show me the questions and the protocol it returns.',
        '2. Call get_citation_sample so I can see what a finished result looks like, and note that it belongs to a different brand.',
        '3. Tell me how to record each try: whether "' + a.brand + '" is named, and whether it appears in a heading, a list label, a table or bold text. Ask me to run every question three to five times, each in a new conversation, and to judge the spread rather than one answer.',
        '4. When I report my results, group the questions: named every time, named only sometimes, never named. The never-named group is where to work.',
        '',
        'Say plainly that a result describes one assistant on one date, is not a ranking and is not a forecast of traffic. When a brand appears in an answer, say it was "named", never anything stronger.'
      ].join('\n');
    }
  }
];

function list() {
  return PROMPTS.map(function (p) { return { name: p.name, title: p.title, description: p.description, arguments: p.arguments }; });
}

/* Resolves to { ok: true, description, messages } or { ok: false, message } (a -32602 for the caller). */
function get(name, args) {
  const p = PROMPTS.filter(function (x) { return x.name === name; })[0];
  if (!p) return { ok: false, message: 'Unknown prompt "' + name + '". Available prompts: ' + PROMPTS.map(function (x) { return x.name; }).join(', ') + '.' };
  args = args && typeof args === 'object' ? args : {};
  const missing = p.arguments.filter(function (x) { return x.required && !(typeof args[x.name] === 'string' && args[x.name].trim()); }).map(function (x) { return x.name; });
  if (missing.length) return { ok: false, message: 'Missing required argument' + (missing.length === 1 ? '' : 's') + ' for prompt "' + name + '": ' + missing.join(', ') + '.' };
  const clean = {};
  p.arguments.forEach(function (x) { clean[x.name] = String(args[x.name]).trim(); });
  if (clean.domain !== undefined) {
    const d = scanner.normalizeDomain(clean.domain);
    if (!d) return { ok: false, message: 'Invalid "domain" for prompt "' + name + '": expected a bare hostname such as "example.com".' };
    clean.domain = d;
  }
  if (clean.vertical !== undefined && citation.verticals().indexOf(clean.vertical) === -1) {
    return { ok: false, message: 'Unknown "vertical" "' + clean.vertical + '". Valid verticals: ' + citation.verticals().join(', ') + '.' };
  }
  return { ok: true, description: p.title, messages: [{ role: 'user', content: { type: 'text', text: p.build(clean) } }] };
}

module.exports = { PROMPTS, list, get };
