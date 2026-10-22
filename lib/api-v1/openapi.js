/* =====================================================================
   lib/api-v1/openapi.js: the description of /v1, once. The OpenAPI 3.1 document (openapi.yaml) and the /api page are both written from ENDPOINTS and SCHEMAS here by
   scripts/generate-api-page.js, and scripts/test-api-v1.js checks that the router answers every path listed and that the document validates against the OpenAPI 3.1 schema.
   The admin endpoint (POST /v1/admin/plan) is not public and is not listed.
   ===================================================================== */

'use strict';

const site = require('../site-config.js');
const Limits = require('./limits.js');
const Data = require('./data.js');

const BASE = site.baseUrl + '/v1';
const DOMAIN = { type: 'string', description: 'A bare domain: letters, digits and hyphens, no scheme, path, port or credentials.', example: 'example.com', maxLength: 253 };
const ref = (n) => ({ $ref: '#/components/schemas/' + n });
const json = (schema, example) => ({ 'application/json': Object.assign({ schema: schema }, example ? { example: example } : {}) });
const err = (name) => ({ $ref: '#/components/responses/' + name });

const SCAN_EXAMPLE = {
  domain: 'example.com', scannedAt: '2026-10-22T12:00:00.000Z', score: 87,
  pillars: [{ id: 'discover', name: 'Discoverability', score: 27, max: 40 }, { id: 'tech', name: 'Technical foundation', score: 20, max: 20 }, { id: 'trust', name: 'Content & trust', score: 40, max: 40 }],
  failed: [{ label: 'AI crawler access (0/10 open)', pillar: 'Discoverability', points: 13, max: 26, fix: 'Review robots.txt rules for blocked AI crawlers' }],
  crawlers: [{ name: 'GPTBot', vendor: 'OpenAI', state: 'limited', rule: 'Disallow: /admin/ (+1 more) · bot-specific rule' }],
  crawlerSummary: { open: 0, limited: 10, blocked: 0 },
  benchmark: { overallAverage: 73, sitesScanned: 219, categories: 6, delta: 14, position: 'above the average' },
  note: Data.NOTE, method: Data.METHOD
};

const ENDPOINTS = [
  { id: 'createKey', method: 'post', path: '/keys', auth: false, tag: 'Keys', summary: 'Get a free API key by email',
    description: 'Sends a free key to the address. The key is in the email and nowhere else: never in this response. The answer is the same whether or not the address could be given a key. The key email is transactional only; set marketing_optin to true only if you want occasional product updates.',
    body: { required: true, schema: 'KeyRequest', example: { email: 'you@example.com', marketing_optin: false } },
    ok: { status: '202', description: 'Accepted. If the address can receive a key, it is on its way.', schema: 'Accepted', example: { status: 'accepted', message: 'If this address can receive a key, it is on its way. The key is sent by email only and is shown once.' } },
    errors: ['400', '413', '415', '429', '502', '503'],
    curl: 'curl -X POST ' + BASE + '/keys \\\n  -H "Content-Type: application/json" \\\n  -d \'{"email": "you@example.com"}\'' },
  { id: 'me', method: 'get', path: '/me', auth: true, tag: 'Account', summary: 'Your plan, limits and usage',
    description: 'The plan of the key (free or pro), its limits, how many requests it has made this hour and today (UTC), and the masked address it was sent to.',
    ok: { status: '200', description: 'The key\'s plan and usage.', schema: 'Me', example: { plan: 'free', status: 'active', email: 'y***@example.com', created_at: '2026-10-22T12:00:00.000Z', limits: { requests_per_hour: 20, requests_per_day: 100, scans_per_domain_per_hour: 4 }, usage: { this_hour: 1, today: 1 } } },
    errors: ['401', '403', '429', '503'], curl: 'curl ' + BASE + '/me \\\n  -H "Authorization: Bearer $CITEHOUND_KEY"' },
  { id: 'scan', method: 'get', path: '/scan', auth: true, tag: 'Scan', summary: 'Scan one domain for AI readiness',
    description: 'Scans the public robots.txt, llms.txt, sitemap declaration and homepage of the domain (one page, not the whole site) and scores it out of 100 across three pillars. Returns the failed checks with their fixes, the state of ten AI crawlers in robots.txt, and a comparison with our benchmark. The score measures readiness, not whether any assistant names a brand.',
    params: [{ name: 'domain', required: true, schema: DOMAIN }],
    ok: { status: '200', description: 'The scan.', schema: 'ScanResult', example: SCAN_EXAMPLE },
    errors: ['400', '401', '403', '429', '502', '503'], curl: 'curl "' + BASE + '/scan?domain=example.com" \\\n  -H "Authorization: Bearer $CITEHOUND_KEY"' },
  { id: 'compare', method: 'get', path: '/compare', auth: true, tag: 'Scan', summary: 'Compare two domains',
    description: 'Scans two different domains, one after the other, and returns both summaries and every check where they differ. Both domains count toward the per-domain limit.',
    params: [{ name: 'a', required: true, schema: DOMAIN }, { name: 'b', required: true, schema: Object.assign({}, DOMAIN, { example: 'example.org' }) }],
    ok: { status: '200', description: 'Both scans and the differences.', schema: 'CompareResult', example: { a: SCAN_EXAMPLE, b: Object.assign({}, SCAN_EXAMPLE, { domain: 'example.org', score: 77 }), differences: [{ check: 'Meta description', a: { passed: true, points: 5 }, b: { passed: false, points: 0 }, max: 5 }], note: Data.NOTE, method: Data.METHOD } },
    errors: ['400', '401', '403', '429', '502', '503'], curl: 'curl "' + BASE + '/compare?a=example.com&b=example.org" \\\n  -H "Authorization: Bearer $CITEHOUND_KEY"' },
  { id: 'crawlers', method: 'get', path: '/crawlers', auth: true, tag: 'Scan', summary: 'The state of ten AI crawlers in robots.txt',
    description: 'Reads robots.txt of the domain and reports, for each of ten AI crawlers, whether it is open, limited (an ordinary Disallow path applies to it) or blocked. This is a scan: it counts toward the per-domain limit.',
    params: [{ name: 'domain', required: true, schema: DOMAIN }],
    ok: { status: '200', description: 'The ten crawler states.', schema: 'CrawlersResult', example: { domain: 'example.com', scannedAt: '2026-10-22T12:00:00.000Z', crawlers: SCAN_EXAMPLE.crawlers, summary: SCAN_EXAMPLE.crawlerSummary, note: Data.NOTE } },
    errors: ['400', '401', '403', '429', '502', '503'], curl: 'curl "' + BASE + '/crawlers?domain=example.com" \\\n  -H "Authorization: Bearer $CITEHOUND_KEY"' },
  { id: 'generateLlmsTxt', method: 'get', path: '/generate/llms-txt', auth: true, tag: 'Generate', summary: 'Generate an llms.txt',
    description: 'Builds an llms.txt from a name, a one-sentence description and up to 20 pages. Pure text generation: nothing is fetched. Pass each page as "page=<url>|<description>", repeated, or use POST with JSON. llms.txt is an optional convention with no demonstrated effect on Google.',
    params: [{ name: 'name', required: true, schema: { type: 'string', maxLength: 120, example: 'Example Co' } }, { name: 'description', required: true, schema: { type: 'string', maxLength: 300, example: 'Project software for small design studios.' } },
      { name: 'page', required: false, schema: { type: 'array', items: { type: 'string' }, maxItems: 20, example: ['https://example.com/pricing|Plans and prices'] }, description: 'Repeat for each page, as "<url>|<description>".' }],
    ok: { status: '200', description: 'The file text.', schema: 'GeneratedFile', example: { type: 'llms.txt', content: '# Example Co\n\n> Project software for small design studios.\n\n## Pages\n- [Plans and prices](https://example.com/pricing)' } },
    errors: ['400', '401', '403', '429', '503'], curl: 'curl -G ' + BASE + '/generate/llms-txt \\\n  -H "Authorization: Bearer $CITEHOUND_KEY" \\\n  --data-urlencode "name=Example Co" \\\n  --data-urlencode "description=Project software for small design studios." \\\n  --data-urlencode "page=https://example.com/pricing|Plans and prices"' },
  { id: 'generateRobotsTxt', method: 'get', path: '/generate/robots-txt', auth: true, tag: 'Generate', summary: 'Generate an AI-crawler robots.txt',
    description: 'Builds a robots.txt that explicitly allows or blocks named crawlers from the ten Citehound tracks, with an optional Sitemap line. Pure text generation: nothing is fetched. Names are comma-separated in the query; POST accepts JSON arrays.',
    params: [{ name: 'allow', required: false, schema: { type: 'string', example: 'GPTBot,ClaudeBot' }, description: 'Comma-separated crawler names to allow.' }, { name: 'block', required: false, schema: { type: 'string', example: 'Bytespider' }, description: 'Comma-separated crawler names to block.' },
      { name: 'sitemap', required: false, schema: { type: 'string', format: 'uri', example: 'https://example.com/sitemap.xml' } }],
    ok: { status: '200', description: 'The file text.', schema: 'GeneratedFile', example: { type: 'robots.txt', content: 'User-agent: GPTBot\nAllow: /\n\nUser-agent: Bytespider\nDisallow: /\n\nSitemap: https://example.com/sitemap.xml', allow: ['GPTBot'], block: ['Bytespider'], sitemap: 'https://example.com/sitemap.xml' } },
    errors: ['400', '401', '403', '429', '503'], curl: 'curl -G ' + BASE + '/generate/robots-txt \\\n  -H "Authorization: Bearer $CITEHOUND_KEY" \\\n  --data-urlencode "allow=GPTBot,ClaudeBot" \\\n  --data-urlencode "block=Bytespider"' },
  { id: 'generateSchema', method: 'get', path: '/generate/schema', auth: true, tag: 'Generate', summary: 'Generate JSON-LD from a site\'s homepage',
    description: 'Reads the homepage of the domain for its real title, description and language and returns JSON-LD of the requested type. Fields the scan cannot know are left in square brackets. This reads the homepage: it counts toward the per-domain limit.',
    params: [{ name: 'domain', required: true, schema: DOMAIN }, { name: 'type', required: true, schema: { type: 'string', enum: Data.SCHEMA_TYPES, example: 'organization' } }],
    ok: { status: '200', description: 'The JSON-LD.', schema: 'SchemaResult', example: { domain: 'example.com', type: 'organization', json_ld: { '@context': 'https://schema.org', '@graph': [] }, note: 'Fields the scan cannot know are left in square brackets for you to fill in.' } },
    errors: ['400', '401', '403', '429', '502', '503'], curl: 'curl "' + BASE + '/generate/schema?domain=example.com&type=organization" \\\n  -H "Authorization: Bearer $CITEHOUND_KEY"' },
  { id: 'benchmark', method: 'get', path: '/benchmark', auth: true, tag: 'Benchmark', summary: 'Our archived benchmark data',
    description: 'Without "category": the six categories with their average score and the weighted overall average. With "category": the score spread, the per-crawler counts and the failure rate of each check for that category. This is our own archive of scans of well-known sites, from the date shown; it is not live.',
    params: [{ name: 'category', required: false, schema: { type: 'string', example: 'crm' }, description: 'One of the category ids from the overview.' }],
    ok: { status: '200', description: 'The overview or one category.', schema: 'Benchmark', example: { categories: [{ category: 'crm', label: 'CRM software', track: 'B2B SaaS', sitesScanned: 31, average: 78, scannedAt: '2026-07-29' }], overall: { totalSites: 219, totalCategories: 6, overallAverage: 73 }, note: 'Our own archived scans of well-known sites.' } },
    errors: ['401', '403', '404', '429', '503'], curl: 'curl "' + BASE + '/benchmark?category=crm" \\\n  -H "Authorization: Bearer $CITEHOUND_KEY"' }
];

const ERRORS = {
  '400': { name: 'BadRequest', description: 'The request is not valid: a missing or malformed parameter.', code: 'invalid_request' },
  '401': { name: 'Unauthorized', description: 'The key is missing or not valid. A WWW-Authenticate header says how to send it.', code: 'invalid_key' },
  '403': { name: 'Forbidden', description: 'The key has been revoked.', code: 'key_revoked' },
  '404': { name: 'NotFound', description: 'No such category or endpoint.', code: 'not_found' },
  '413': { name: 'TooLarge', description: 'The request body is larger than the limit.', code: 'too_large' },
  '415': { name: 'UnsupportedMediaType', description: 'Send JSON with Content-Type: application/json.', code: 'unsupported_media_type' },
  '429': { name: 'RateLimited', description: 'A limit was reached. The Retry-After header gives the seconds to wait; the body names the limit.', code: 'rate_limited' },
  '502': { name: 'BadGateway', description: 'The scan could not read the site (robots.txt or the homepage), or the key email could not be sent.', code: 'scan_failed' },
  '503': { name: 'NotConfigured', description: 'The API is not configured on this server, or its storage is unavailable.', code: 'not_configured' }
};

const str = (extra) => Object.assign({ type: 'string' }, extra || {});
const int = (extra) => Object.assign({ type: 'integer' }, extra || {});
const obj = (props, required, extra) => Object.assign({ type: 'object', properties: props, required: required || Object.keys(props), additionalProperties: false }, extra || {});
const SCHEMAS = {
  Error: obj({ error: str({ description: 'A short code.' }), message: str(), retry_after: int({ description: 'Seconds to wait (rate limits only).' }), limit_scope: str({ description: 'Which limit was reached (rate limits only).' }) }, ['error', 'message']),
  KeyRequest: obj({ email: str({ format: 'email', maxLength: 254 }), marketing_optin: { type: 'boolean', default: false, description: 'True only if you want occasional product updates. The key email never contains marketing.' } }, ['email']),
  Accepted: obj({ status: str({ enum: ['accepted'] }), message: str() }),
  Me: obj({ plan: str({ enum: ['free', 'pro'] }), status: str({ enum: ['active'] }), email: str({ description: 'The masked address.' }), created_at: str({ format: 'date-time' }),
    limits: obj({ requests_per_hour: int(), requests_per_day: int(), scans_per_domain_per_hour: int() }), usage: obj({ this_hour: int(), today: int() }) }),
  Pillar: obj({ id: str(), name: str(), score: int(), max: int() }),
  FailedCheck: obj({ label: str(), pillar: str(), points: int(), max: int(), fix: str() }),
  Crawler: obj({ name: str(), vendor: { type: ['string', 'null'] }, state: str({ enum: ['open', 'limited', 'blocked'] }), rule: { type: ['string', 'null'] } }),
  Benchmark_comparison: obj({ overallAverage: int(), sitesScanned: int(), categories: int(), delta: int(), position: str() }),
  ScanResult: obj({ domain: str(), scannedAt: str({ format: 'date-time' }), score: int({ minimum: 0, maximum: 100 }), pillars: { type: 'array', items: ref('Pillar') }, failed: { type: 'array', items: ref('FailedCheck') },
    crawlers: { type: 'array', items: ref('Crawler') }, crawlerSummary: obj({ open: int(), limited: int(), blocked: int() }), benchmark: { oneOf: [ref('Benchmark_comparison'), { type: 'null' }] }, note: str(), method: str({ format: 'uri' }) }),
  CompareResult: obj({ a: ref('ScanResult'), b: ref('ScanResult'), differences: { type: 'array', items: obj({ check: str(), a: obj({ passed: { type: 'boolean' }, points: int() }), b: obj({ passed: { type: 'boolean' }, points: int() }), max: int() }) }, note: str(), method: str({ format: 'uri' }) }),
  CrawlersResult: obj({ domain: str(), scannedAt: str({ format: 'date-time' }), crawlers: { type: 'array', items: ref('Crawler') }, summary: obj({ open: int(), limited: int(), blocked: int() }), note: str() }),
  GeneratedFile: { type: 'object', properties: { type: str({ enum: ['llms.txt', 'robots.txt'] }), content: str({ description: 'The file text, to paste at the site root.' }), allow: { type: 'array', items: str() }, block: { type: 'array', items: str() }, sitemap: { type: ['string', 'null'] }, pages: { type: 'array', items: obj({ url: str(), description: str() }) }, note: str() }, required: ['type', 'content'] },
  SchemaResult: obj({ domain: str(), type: str({ enum: Data.SCHEMA_TYPES }), json_ld: { type: 'object', description: 'A schema.org JSON-LD object.' }, note: str() }),
  Benchmark: { type: 'object', description: 'Without "category": categories and overall. With "category": the detail of one category.', properties: { categories: { type: 'array', items: { type: 'object' } }, overall: { type: ['object', 'null'] }, category: str(), label: str(), track: str(), sitesScanned: int(), couldNotBeReached: int(), scannedAt: str(), score: { type: 'object' }, crawlers: { type: ['object', 'null'] }, checkFailureRates: { type: ['object', 'null'] }, note: str(), method: str() } }
};

function operation(e) {
  const op = { operationId: e.id, tags: [e.tag], summary: e.summary, description: e.description };
  if (!e.auth) op.security = [];
  if (e.params) op.parameters = e.params.map((p) => Object.assign({ name: p.name, in: 'query', required: p.required, schema: p.schema }, p.description ? { description: p.description } : {}));
  if (e.body) op.requestBody = { required: true, content: json(ref(e.body.schema), e.body.example) };
  op.responses = {};
  op.responses[e.ok.status] = { description: e.ok.description, content: json(ref(e.ok.schema), e.ok.example) };
  e.errors.forEach((c) => { op.responses[c] = err(ERRORS[c].name); });
  return op;
}

function spec() {
  const paths = {};
  ENDPOINTS.forEach((e) => { paths[e.path] = paths[e.path] || {}; paths[e.path][e.method] = operation(e); });
  // generate/llms-txt and generate/robots-txt also take POST with the same fields as JSON.
  paths['/generate/llms-txt'].post = { operationId: 'generateLlmsTxtPost', tags: ['Generate'], summary: 'Generate an llms.txt (JSON body)', description: 'The same as the GET form, with the pages as a JSON array.',
    requestBody: { required: true, content: json({ type: 'object', properties: { name: str(), description: str(), pages: { type: 'array', items: obj({ url: str({ format: 'uri' }), description: str() }) } }, required: ['name', 'description'] }) },
    responses: { '200': { description: 'The file text.', content: json(ref('GeneratedFile')) }, '400': err('BadRequest'), '401': err('Unauthorized'), '403': err('Forbidden'), '415': err('UnsupportedMediaType'), '429': err('RateLimited'), '503': err('NotConfigured') } };
  paths['/generate/robots-txt'].post = { operationId: 'generateRobotsTxtPost', tags: ['Generate'], summary: 'Generate an AI-crawler robots.txt (JSON body)', description: 'The same as the GET form, with arrays.',
    requestBody: { required: true, content: json({ type: 'object', properties: { allow: { type: 'array', items: str() }, block: { type: 'array', items: str() }, sitemap: str({ format: 'uri' }) } }) },
    responses: { '200': { description: 'The file text.', content: json(ref('GeneratedFile')) }, '400': err('BadRequest'), '401': err('Unauthorized'), '403': err('Forbidden'), '415': err('UnsupportedMediaType'), '429': err('RateLimited'), '503': err('NotConfigured') } };
  const responses = {};
  Object.keys(ERRORS).forEach((c) => {
    const E = ERRORS[c];
    responses[E.name] = { description: E.description, content: json(ref('Error'), { error: E.code, message: E.description }) };
    if (c === '429') responses[E.name].headers = { 'Retry-After': { description: 'Seconds to wait before trying again.', schema: int() } };
    if (c === '401') responses[E.name].headers = { 'WWW-Authenticate': { description: 'How to send the key.', schema: str() } };
  });
  const L = Limits.PLAN_LIMITS;
  return {
    openapi: '3.1.0',
    info: {
      title: 'Citehound API', version: '1.0.0',
      summary: 'Scan a domain for AI readiness and generate llms.txt, robots.txt and schema.',
      description: 'Scans one page of a domain (its robots.txt, llms.txt, sitemap declaration and homepage) and scores it out of 100, and generates llms.txt, robots.txt and JSON-LD. The score measures readiness: crawler access and on-page signals. It does not measure whether any assistant names a brand.\n\nGet a free key by email at ' + site.baseUrl + '/api. Limits: a free key allows ' + L.free.hour + ' requests an hour and ' + L.free.day + ' a day; the same domain is scanned at most ' + Limits.DOMAIN_PER_HOUR + ' times an hour across all keys.',
      termsOfService: site.baseUrl + '/terms', contact: { name: 'Citehound', email: site.contactEmail, url: site.baseUrl }
    },
    servers: [{ url: BASE, description: 'Production' }],
    tags: [{ name: 'Keys' }, { name: 'Account' }, { name: 'Scan' }, { name: 'Generate' }, { name: 'Benchmark' }],
    security: [{ bearerAuth: [] }, { keyHeader: [] }],
    paths: paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'Authorization: Bearer <key>.' }, keyHeader: { type: 'apiKey', in: 'header', name: 'X-Citehound-Key', description: 'The same key in a header of its own.' } },
      schemas: SCHEMAS, responses: responses
    }
  };
}

module.exports = { ENDPOINTS, ERRORS, SCHEMAS, spec, BASE };
