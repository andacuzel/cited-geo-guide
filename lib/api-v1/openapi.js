/* =====================================================================
   lib/api-v1/openapi.js: the description of /v1, once. The OpenAPI 3.1 document (openapi.yaml) and the /api page are both written from ENDPOINTS and SCHEMAS here by
   scripts/generate-api-page.js, and scripts/test-api-v1.js checks that the router answers every path listed and that the document validates against the OpenAPI 3.1 schema.
   The admin endpoint (POST /v1/admin/plan), the scheduled job (/v1/cron/run) and the unsubscribe page of an alert email are not public API and are not listed.
   ===================================================================== */

'use strict';

const site = require('../site-config.js');
const Limits = require('./limits.js');
const Data = require('./data.js');
const Monitor = require('./monitor.js');
const Plans = require('../plans.js');

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
    ok: { status: '200', description: 'The key\'s plan and usage.', schema: 'Me', example: { plan: 'free', status: 'active', email: 'y***@example.com', created_at: '2026-10-22T12:00:00.000Z', limits: { requests_per_hour: Plans.PLANS.free.hour, requests_per_day: Plans.PLANS.free.day, scans_per_day: Plans.PLANS.free.scansDay, scans_per_domain_per_hour: 4 }, usage: { this_hour: 1, today: 1 }, features: { scan_detail: 'top3', compare: false, generators: 'preview', schema_types: ['organization'], monitoring: false, fixes: false, export: false } } },
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
    errors: ['400', '401', '403', '429', '502', '503', '402'], curl: 'curl "' + BASE + '/compare?a=example.com&b=example.org" \\\n  -H "Authorization: Bearer $CITEHOUND_KEY"' },
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
    errors: ['400', '401', '403', '429', '502', '503', '402'], curl: 'curl "' + BASE + '/generate/schema?domain=example.com&type=organization" \\\n  -H "Authorization: Bearer $CITEHOUND_KEY"' },
  { id: 'benchmark', method: 'get', path: '/benchmark', auth: true, tag: 'Benchmark', summary: 'Our archived benchmark data',
    description: 'Without "category": the six categories with their average score and the weighted overall average. With "category": the score spread, the per-crawler counts and the failure rate of each check for that category. This is our own archive of scans of well-known sites, from the date shown; it is not live.',
    params: [{ name: 'category', required: false, schema: { type: 'string', example: 'crm' }, description: 'One of the category ids from the overview.' }],
    ok: { status: '200', description: 'The overview or one category.', schema: 'Benchmark', example: { categories: [{ category: 'crm', label: 'CRM software', track: 'B2B SaaS', sitesScanned: 31, average: 78, scannedAt: '2026-07-29' }], overall: { totalSites: 219, totalCategories: 6, overallAverage: 73 }, note: 'Our own archived scans of well-known sites.' } },
    errors: ['401', '403', '404', '429', '503'], curl: 'curl "' + BASE + '/benchmark?category=crm" \\\n  -H "Authorization: Bearer $CITEHOUND_KEY"' },
  // ---- monitoring: Pro keys only ----
  { id: 'watchlistAdd', method: 'post', path: '/watchlist', auth: true, plan: 'pro', tag: 'Monitoring', summary: 'Watch a domain',
    description: 'Adds a domain to the key\'s watchlist (up to ' + Monitor.config({}).watchLimit + ' per Pro key). The first scan runs now and becomes the baseline; after that the domain is re-scanned about every 7 days by a scheduled job, and each scan is compared with the one before. The scan counts toward the per-domain limit. To get alert emails, send "alert_email" with the address this key was sent to; alerts can be switched off per domain with "alerts": false.',
    body: { required: true, schema: 'WatchRequest', example: { domain: 'example.com', alert_email: 'you@example.com' } },
    ok: { status: '201', description: 'The domain is watched. 200 if it already was (only the alert settings change).', schema: 'WatchAdded', example: { watch: { domain: 'example.com', added_at: '2026-10-22T12:00:00.000Z', alerts: true, last_scan_at: '2026-10-22T12:00:00.000Z', next_scan_after: '2026-10-29T00:00:00.000Z', status: 'ok', last_score: 87 }, baseline: { snapshot_id: 'snp_20261022120000', score: 87, scanned_at: '2026-10-22T12:00:00.000Z' }, alert_email: true, next_scan_after: '2026-10-29T00:00:00.000Z' } },
    errors: ['400', '401', '403', '409', '415', '429', '502', '503', '402'], curl: 'curl -X POST ' + BASE + '/watchlist \\\n  -H "Authorization: Bearer $CITEHOUND_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"domain": "example.com", "alert_email": "you@example.com"}\'' },
  { id: 'watchlistList', method: 'get', path: '/watchlist', auth: true, plan: 'pro', tag: 'Monitoring', summary: 'List the watched domains',
    description: 'The key\'s watchlist with the time of the last scan, the earliest time of the next one, the last score and whether alerts are on.',
    ok: { status: '200', description: 'The watchlist.', schema: 'WatchList', example: { domains: [{ domain: 'example.com', added_at: '2026-10-22T12:00:00.000Z', alerts: true, last_scan_at: '2026-10-22T12:00:00.000Z', next_scan_after: '2026-10-29T00:00:00.000Z', status: 'ok', last_score: 87 }], limit: 5, used: 1, alert_email: true } },
    errors: ['401', '403', '429', '503', '402'], curl: 'curl ' + BASE + '/watchlist \\\n  -H "Authorization: Bearer $CITEHOUND_KEY"' },
  { id: 'watchlistRemove', method: 'delete', path: '/watchlist', auth: true, plan: 'pro', tag: 'Monitoring', summary: 'Stop watching a domain',
    description: 'Removes a domain from the key\'s watchlist. When no key watches the domain any more, its snapshots and events are deleted.',
    params: [{ name: 'domain', required: true, schema: DOMAIN }],
    ok: { status: '200', description: 'Removed.', schema: 'Removed', example: { removed: true, domain: 'example.com' } },
    errors: ['400', '401', '403', '404', '429', '503', '402'], curl: 'curl -X DELETE "' + BASE + '/watchlist?domain=example.com" \\\n  -H "Authorization: Bearer $CITEHOUND_KEY"' },
  { id: 'history', method: 'get', path: '/history', auth: true, plan: 'pro', tag: 'Monitoring', summary: 'The stored scans of a watched domain',
    description: 'The snapshots of one watched domain, newest first: the score, the pillar scores, the ids of the failed checks, the state of each crawler, and whether llms.txt and JSON-LD were present. Snapshots are kept ' + Monitor.config({}).retentionDays + ' days.',
    params: [{ name: 'domain', required: true, schema: DOMAIN }, { name: 'since', required: false, schema: { type: 'string', example: '2026-10-01' }, description: 'Only snapshots after this date.' }, { name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 120, default: 52 } }],
    ok: { status: '200', description: 'The snapshots.', schema: 'HistoryResult', example: { domain: 'example.com', retention_days: 365, snapshots: [{ id: 'snp_20261022120000', at: '2026-10-22T12:00:00.000Z', domain: 'example.com', score: 87, pillars: [{ id: 'discover', score: 27, max: 40 }], failed: ['ai-crawler-access'], check_names: { 'ai-crawler-access': 'AI crawler access' }, crawlers: { GPTBot: 'open' }, llms_txt: true, schema: true }] } },
    errors: ['400', '401', '403', '404', '429', '503', '402'], curl: 'curl "' + BASE + '/history?domain=example.com" \\\n  -H "Authorization: Bearer $CITEHOUND_KEY"' },
  { id: 'events', method: 'get', path: '/events', auth: true, plan: 'pro', tag: 'Monitoring', summary: 'What changed, newest first',
    description: 'Events from the differences between two scans of the watched domains: ' + Monitor.EVENT_TYPES.join(', ') + '. Ids are stable and sort in time order, so a polling client can pass the newest id it has as "since" and take only what is new. To read further back, pass "next_cursor" as "cursor". "score_dropped" and "score_improved" fire at a change of ' + Monitor.config({}).scoreDelta + ' points or more. Events are kept ' + Monitor.config({}).retentionDays + ' days.',
    params: [{ name: 'since', required: false, schema: { type: 'string', example: 'evt_20261022120000_ab12cd34ef' }, description: 'An event id (only newer events) or a date.' }, { name: 'domain', required: false, schema: DOMAIN }, { name: 'type', required: false, schema: { type: 'string', example: 'score_dropped,crawler_blocked' }, description: 'A comma-separated list of event types.' },
      { name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } }, { name: 'cursor', required: false, schema: { type: 'string' }, description: 'The next_cursor of a previous answer.' }],
    ok: { status: '200', description: 'The events.', schema: 'EventsResult', example: { events: [{ id: 'evt_20261029060012_ab12cd34ef', type: 'score_dropped', domain: 'example.com', at: '2026-10-29T06:00:12.000Z', summary: 'Readiness score dropped from 87 to 79 (-8 points).', snapshot_id: 'snp_20261029060012', data: { from: 87, to: 79, delta: -8 } }], has_more: false, next_cursor: null } },
    errors: ['400', '401', '403', '404', '429', '503', '402'], curl: 'curl "' + BASE + '/events?type=score_dropped,crawler_blocked&limit=20" \\\n  -H "Authorization: Bearer $CITEHOUND_KEY"' },
  { id: 'fixes', method: 'get', path: '/fixes', auth: true, plan: 'fix', tag: 'Fix', summary: 'The prioritized fix list, with files to paste',
    description: 'Scans the domain and returns what to change, highest points at stake first. Each finding has the plain fix and, where one applies, the file or snippet to paste (robots.txt, llms.txt, JSON-LD, head tags), built from the site\'s own title, description and language; anything the scan cannot know is left in square brackets. The list is remembered for 90 days so that POST /v1/fixes/recheck can show what changed.',
    params: [{ name: 'domain', required: true, schema: DOMAIN }],
    ok: { status: '200', description: 'The fix list.', schema: 'FixList', example: { domain: 'example.com', scannedAt: '2026-10-22T12:00:00.000Z', score: 62, items: [{ priority: 1, id: 'llms-txt-present', label: 'llms.txt present', pillar: 'Discoverability', points_at_stake: 4, fix: 'Add an llms.txt at the site root', files: [{ where: 'https://example.com/llms.txt', kind: 'llms.txt', content: '# Example Co\n\n> [One sentence describing the site.]' }] }], note: Data.NOTE } },
    errors: ['400', '401', '402', '403', '429', '502', '503'], curl: 'curl "' + BASE + '/fixes?domain=example.com" \\\n  -H "Authorization: Bearer $CITEHOUND_KEY"' },
  { id: 'fixesRecheck', method: 'post', path: '/fixes/recheck', auth: true, plan: 'fix', tag: 'Fix', summary: 'Re-scan after you made the changes',
    description: 'Scans the domain again and compares it with the fix list made by GET /v1/fixes: which findings are now fixed, which still fail, and which are new, with the score before and after. Needs a fix list first (404 no_fix_list otherwise).',
    body: { required: true, schema: 'RecheckRequest', example: { domain: 'example.com' } },
    ok: { status: '200', description: 'The comparison.', schema: 'RecheckResult', example: { domain: 'example.com', checked_at: '2026-10-23T12:00:00.000Z', score_before: 62, score_after: 70, fixed: ['llms-txt-present'], still_failing: ['meta-description'], new_failures: [], note: Data.NOTE } },
    errors: ['400', '401', '402', '403', '404', '415', '429', '502', '503'], curl: 'curl -X POST ' + BASE + '/fixes/recheck \\\n  -H "Authorization: Bearer $CITEHOUND_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"domain": "example.com"}\'' },
  { id: 'export', method: 'get', path: '/export', auth: true, plan: 'beyond', tag: 'Monitoring', summary: 'Export the history or the events of a watched domain',
    description: 'The stored snapshots (type=snapshots) or events (type=events) of a watched domain, as JSON or CSV (format=csv), as far back as the plan keeps them (' + Plans.PLANS.beyond.retentionDays + ' days on Beyond).',
    params: [{ name: 'domain', required: true, schema: DOMAIN }, { name: 'type', required: false, schema: { type: 'string', enum: ['snapshots', 'events'], default: 'snapshots' } }, { name: 'format', required: false, schema: { type: 'string', enum: ['json', 'csv'], default: 'json' } }],
    ok: { status: '200', description: 'The rows (JSON), or a CSV file.', schema: 'ExportResult', example: { domain: 'example.com', type: 'snapshots', exported_at: '2026-10-22T12:00:00.000Z', retention_days: 730, count: 0, rows: [] } },
    errors: ['400', '401', '402', '403', '404', '429', '503'], curl: 'curl "' + BASE + '/export?domain=example.com&type=events&format=csv" \\\n  -H "Authorization: Bearer $CITEHOUND_KEY" -o events.csv' },
  { id: 'webhookCreate', method: 'post', path: '/webhooks', auth: true, plan: 'pro', tag: 'Webhooks', summary: 'Create a webhook',
    description: 'Registers an https address that receives the events you choose as signed JSON (see "Webhooks" below for the headers and how to verify them). Up to ' + Monitor.config({}).webhookLimit + ' per key. Leave "secret" out and one is generated and shown once; if you send one, it is never shown again. The address must be https on the default port and a public host.',
    body: { required: true, schema: 'WebhookRequest', example: { url: 'https://example.com/hooks/citehound', events: ['score_dropped', 'crawler_blocked'] } },
    ok: { status: '201', description: 'Created.', schema: 'WebhookCreated', example: { webhook: { id: 'whk_0123456789abcdef', url: 'https://example.com/hooks/citehound', events: ['score_dropped', 'crawler_blocked'], enabled: true, consecutive_failures: 0, created_at: '2026-10-22T12:00:00.000Z', disabled_at: null, disabled_reason: null }, secret: 'whsec_…', secret_note: 'This is the only time the secret is shown. Store it now: it signs every delivery.' } },
    errors: ['400', '401', '403', '409', '415', '429', '503', '402'], curl: 'curl -X POST ' + BASE + '/webhooks \\\n  -H "Authorization: Bearer $CITEHOUND_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"url": "https://example.com/hooks/citehound", "events": ["score_dropped", "crawler_blocked"]}\'' },
  { id: 'webhookList', method: 'get', path: '/webhooks', auth: true, plan: 'pro', tag: 'Webhooks', summary: 'List webhooks',
    description: 'The key\'s webhooks with their event types, whether they are enabled and how many deliveries in a row have failed. A webhook is disabled after ' + Monitor.config({}).maxFails + ' deliveries in a row failed all their attempts. The secret is never returned.',
    ok: { status: '200', description: 'The webhooks.', schema: 'WebhookList', example: { webhooks: [{ id: 'whk_0123456789abcdef', url: 'https://example.com/hooks/citehound', events: ['score_dropped'], enabled: true, consecutive_failures: 0, created_at: '2026-10-22T12:00:00.000Z', disabled_at: null, disabled_reason: null }], limit: 3 } },
    errors: ['401', '403', '429', '503', '402'], curl: 'curl ' + BASE + '/webhooks \\\n  -H "Authorization: Bearer $CITEHOUND_KEY"' },
  { id: 'webhookGet', method: 'get', path: '/webhooks/{id}', auth: true, plan: 'pro', tag: 'Webhooks', summary: 'Get one webhook',
    description: 'One webhook, without its secret.', params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'whk_0123456789abcdef' } }],
    ok: { status: '200', description: 'The webhook.', schema: 'WebhookOne', example: { webhook: { id: 'whk_0123456789abcdef', url: 'https://example.com/hooks/citehound', events: ['score_dropped'], enabled: true, consecutive_failures: 0, created_at: '2026-10-22T12:00:00.000Z', disabled_at: null, disabled_reason: null } } },
    errors: ['401', '403', '404', '429', '503', '402'], curl: 'curl ' + BASE + '/webhooks/whk_0123456789abcdef \\\n  -H "Authorization: Bearer $CITEHOUND_KEY"' },
  { id: 'webhookDelete', method: 'delete', path: '/webhooks/{id}', auth: true, plan: 'pro', tag: 'Webhooks', summary: 'Delete a webhook',
    description: 'Deletes the webhook, its delivery log and any retries still waiting. To use an address again after it was disabled, delete the webhook and create it again.', params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'whk_0123456789abcdef' } }],
    ok: { status: '200', description: 'Deleted.', schema: 'Removed', example: { removed: true, id: 'whk_0123456789abcdef' } },
    errors: ['401', '403', '404', '429', '503', '402'], curl: 'curl -X DELETE ' + BASE + '/webhooks/whk_0123456789abcdef \\\n  -H "Authorization: Bearer $CITEHOUND_KEY"' },
  { id: 'webhookDeliveries', method: 'get', path: '/webhooks/{id}/deliveries', auth: true, plan: 'pro', tag: 'Webhooks', summary: 'The delivery log of a webhook',
    description: 'The last 50 deliveries, newest first: the event, the status (pending, delivered or failed), the number of attempts, the HTTP status and a short error code, and when the next retry is due. Retries are made after 1 minute, 10 minutes and 1 hour, at the next run of the scheduled job.',
    params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'whk_0123456789abcdef' } }],
    ok: { status: '200', description: 'The deliveries.', schema: 'DeliveryList', example: { webhook_id: 'whk_0123456789abcdef', deliveries: [{ id: 'dlv_20261029060013_9f8e7d6c', event_id: 'evt_20261029060012_ab12cd34ef', event_type: 'score_dropped', status: 'delivered', attempt: 1, next_at: null, http_status: 200, error: null, created_at: '2026-10-29T06:00:13.000Z', delivered_at: '2026-10-29T06:00:13.000Z', test: false }] } },
    errors: ['401', '403', '404', '429', '503', '402'], curl: 'curl ' + BASE + '/webhooks/whk_0123456789abcdef/deliveries \\\n  -H "Authorization: Bearer $CITEHOUND_KEY"' },
  { id: 'webhookTest', method: 'post', path: '/webhooks/{id}/test', auth: true, plan: 'pro', tag: 'Webhooks', summary: 'Send a test event',
    description: 'Sends one signed test event (type "test") to the webhook now, makes one attempt and returns the result. It is logged as a test and does not count toward the failure limit.',
    params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'whk_0123456789abcdef' } }],
    ok: { status: '200', description: 'The delivery, delivered or failed.', schema: 'TestResult', example: { delivery: { id: 'dlv_20261022120005_1a2b3c4d', event_id: 'evt_test_20261022120005_ab12cd', event_type: 'test', status: 'delivered', attempt: 1, next_at: null, http_status: 200, error: null, created_at: '2026-10-22T12:00:05.000Z', delivered_at: '2026-10-22T12:00:05.000Z', test: true } } },
    errors: ['401', '403', '404', '429', '503', '402'], curl: 'curl -X POST ' + BASE + '/webhooks/whk_0123456789abcdef/test \\\n  -H "Authorization: Bearer $CITEHOUND_KEY"' }
];

const ERRORS = {
  '400': { name: 'BadRequest', description: 'The request is not valid: a missing or malformed parameter.', code: 'invalid_request' },
  '401': { name: 'Unauthorized', description: 'The key is missing or not valid. A WWW-Authenticate header says how to send it.', code: 'invalid_key' },
  '402': { name: 'PlanRequired', description: 'The endpoint, or the full output, is part of a higher plan than the key\'s. The body names the plan that has it (required_plan) and links the plans.', code: 'plan_required' },
  '403': { name: 'Forbidden', description: 'The key has been revoked.', code: 'key_revoked' },
  '404': { name: 'NotFound', description: 'No such category or endpoint.', code: 'not_found' },
  '409': { name: 'Conflict', description: 'A limit of the Pro plan was reached (watchlist_full, webhook_limit) or the item already exists (webhook_exists).', code: 'watchlist_full' },
  '413': { name: 'TooLarge', description: 'The request body is larger than the limit.', code: 'too_large' },
  '415': { name: 'UnsupportedMediaType', description: 'Send JSON with Content-Type: application/json.', code: 'unsupported_media_type' },
  '429': { name: 'RateLimited', description: 'A limit was reached (the key\'s requests, a free key\'s scans a day, one domain, or one network address). The Retry-After header gives the seconds to wait; the body names the limit.', code: 'rate_limited' },
  '502': { name: 'BadGateway', description: 'The scan could not read the site (robots.txt or the homepage), or the key email could not be sent.', code: 'scan_failed' },
  '503': { name: 'NotConfigured', description: 'The API is not configured on this server, or its storage is unavailable.', code: 'not_configured' }
};

const str = (extra) => Object.assign({ type: 'string' }, extra || {});
const int = (extra) => Object.assign({ type: 'integer' }, extra || {});
const obj = (props, required, extra) => Object.assign({ type: 'object', properties: props, required: required || Object.keys(props), additionalProperties: false }, extra || {});
const bool = (extra) => Object.assign({ type: 'boolean' }, extra || {});
const SCHEMAS = {
  Upgrade: obj({ message: str(), required_plan: str({ enum: ['pro', 'fix', 'beyond'] }), plans_url: str({ format: 'uri' }) }),
  Error: obj({ error: str({ description: 'A short code.' }), message: str(), retry_after: int({ description: 'Seconds to wait (rate limits only).' }), limit_scope: str({ description: 'Which limit was reached (rate limits only).' }), required_plan: str({ enum: ['pro', 'fix', 'beyond'], description: 'The lowest plan with the feature (plan_required only).' }), plan: str({ description: 'The plan of the key (plan_required only).' }), plans_url: str({ format: 'uri' }) }, ['error', 'message']),
  KeyRequest: obj({ email: str({ format: 'email', maxLength: 254 }), marketing_optin: { type: 'boolean', default: false, description: 'True only if you want occasional product updates. The key email never contains marketing.' } }, ['email']),
  Accepted: obj({ status: str({ enum: ['accepted'] }), message: str() }),
  Me: obj({ plan: str({ enum: ['free', 'pro'] }), status: str({ enum: ['active'] }), email: str({ description: 'The masked address.' }), created_at: str({ format: 'date-time' }),
    limits: obj({ requests_per_hour: int(), requests_per_day: int(), scans_per_domain_per_hour: int(), scans_per_day: { type: ['integer', 'null'], description: 'Free keys only; null means no extra cap.' } }), usage: obj({ this_hour: int(), today: int() }),
    features: obj({ scan_detail: str({ enum: ['top3', 'full'] }), compare: bool(), generators: str({ enum: ['preview', 'full'] }), schema_types: { oneOf: [str({ enum: ['all'] }), { type: 'array', items: str() }] }, monitoring: bool(), fixes: bool(), export: bool() }) }),
  Pillar: obj({ id: str(), name: str(), score: int(), max: int() }),
  FailedCheck: obj({ label: str(), pillar: str(), points: int(), max: int(), fix: str() }),
  Crawler: obj({ name: str(), vendor: { type: ['string', 'null'] }, state: str({ enum: ['open', 'limited', 'blocked'] }), rule: { type: ['string', 'null'] } }),
  Benchmark_comparison: obj({ overallAverage: int(), sitesScanned: int(), categories: int(), delta: int(), position: str() }),
  ScanResult: obj({ domain: str(), scannedAt: str({ format: 'date-time' }), score: int({ minimum: 0, maximum: 100 }), pillars: { type: 'array', items: ref('Pillar') }, failed: { type: 'array', items: ref('FailedCheck') },
    crawlers: { type: 'array', items: ref('Crawler') }, crawlerSummary: obj({ open: int(), limited: int(), blocked: int() }), benchmark: { oneOf: [ref('Benchmark_comparison'), { type: 'null' }] }, note: str(), method: str({ format: 'uri' }),
    truncated: bool({ description: 'Free keys only: more findings exist than are shown.' }), hidden_findings: int({ description: 'Free keys only: how many findings are not shown.' }), upgrade: ref('Upgrade') }, ['domain', 'scannedAt', 'score', 'pillars', 'failed', 'crawlers', 'crawlerSummary', 'benchmark', 'note', 'method']),
  CompareResult: obj({ a: ref('ScanResult'), b: ref('ScanResult'), differences: { type: 'array', items: obj({ check: str(), a: obj({ passed: { type: 'boolean' }, points: int() }), b: obj({ passed: { type: 'boolean' }, points: int() }), max: int() }) }, note: str(), method: str({ format: 'uri' }) }),
  CrawlersResult: obj({ domain: str(), scannedAt: str({ format: 'date-time' }), crawlers: { type: 'array', items: ref('Crawler') }, summary: obj({ open: int(), limited: int(), blocked: int() }), note: str() }),
  GeneratedFile: { type: 'object', properties: { type: str({ enum: ['llms.txt', 'robots.txt'] }), content: str({ description: 'The file text, to paste at the site root. A free key gets its first lines (preview true).' }), preview: bool(), truncated: bool(), total_lines: int(), upgrade: ref('Upgrade'), allow: { type: 'array', items: str() }, block: { type: 'array', items: str() }, sitemap: { type: ['string', 'null'] }, pages: { type: 'array', items: obj({ url: str(), description: str() }) }, note: str() }, required: ['type', 'content'] },
  SchemaResult: obj({ domain: str(), type: str({ enum: Data.SCHEMA_TYPES }), json_ld: { type: 'object', description: 'A schema.org JSON-LD object.' }, note: str() }),
  WatchRequest: obj({ domain: str(DOMAIN), alert_email: str({ format: 'email', description: 'The address this key was sent to. Alerts go here. Optional.' }), alerts: bool({ description: 'Set false to stop alert emails for this domain. Default true.' }) }, ['domain']),
  WatchEntry: obj({ domain: str(), added_at: str({ format: 'date-time' }), alerts: bool(), last_scan_at: { type: ['string', 'null'], format: 'date-time' }, next_scan_after: { type: ['string', 'null'], format: 'date-time' }, status: { type: ['string', 'null'], enum: ['ok', 'failed', null] }, last_score: { type: ['integer', 'null'] } }),
  WatchAdded: obj({ watch: ref('WatchEntry'), baseline: obj({ snapshot_id: str(), score: int(), scanned_at: str({ format: 'date-time' }) }), alert_email: bool({ description: 'Whether this key has an alert address.' }), next_scan_after: { type: ['string', 'null'], format: 'date-time' } }, ['watch']),
  WatchList: obj({ domains: { type: 'array', items: ref('WatchEntry') }, limit: int(), used: int(), alert_email: bool() }),
  Removed: obj({ removed: bool(), domain: str(), id: str() }, ['removed']),
  Snapshot: obj({ id: str(), at: str({ format: 'date-time' }), domain: str(), score: int(), pillars: { type: 'array', items: obj({ id: str(), score: int(), max: int() }) }, failed: { type: 'array', items: str(), description: 'Ids of the failed checks.' }, check_names: { type: 'object', additionalProperties: str() }, crawlers: { type: 'object', additionalProperties: str({ enum: ['open', 'limited', 'blocked'] }) }, llms_txt: bool(), schema: bool({ description: 'JSON-LD present.' }) }),
  HistoryResult: obj({ domain: str(), retention_days: int(), snapshots: { type: 'array', items: ref('Snapshot') } }),
  Event: obj({ id: str({ description: 'Stable. Sorts in time order.' }), type: str({ enum: Monitor.EVENT_TYPES }), domain: str(), at: str({ format: 'date-time' }), summary: str(), snapshot_id: { type: ['string', 'null'] }, data: { type: 'object' } }),
  EventsResult: obj({ events: { type: 'array', items: ref('Event') }, has_more: bool(), next_cursor: { type: ['string', 'null'] } }),
  WebhookRequest: obj({ url: str({ format: 'uri', maxLength: 500, description: 'https, default port, public host.' }), events: { type: 'array', items: str({ enum: Monitor.EVENT_TYPES }), maxItems: 20, description: 'Default: all event types.' }, secret: str({ minLength: 16, maxLength: 128, description: 'Optional. Generated and shown once if left out.' }) }, ['url']),
  Webhook: obj({ id: str(), url: str(), events: { type: 'array', items: str() }, enabled: bool(), consecutive_failures: int(), created_at: str({ format: 'date-time' }), disabled_at: { type: ['string', 'null'] }, disabled_reason: { type: ['string', 'null'] } }),
  WebhookCreated: obj({ webhook: ref('Webhook'), secret: str({ description: 'Only when it was generated, and only here.' }), secret_note: str() }, ['webhook']),
  WebhookOne: obj({ webhook: ref('Webhook') }),
  WebhookList: obj({ webhooks: { type: 'array', items: ref('Webhook') }, limit: int() }),
  Delivery: obj({ id: str(), event_id: str(), event_type: str(), status: str({ enum: ['pending', 'delivered', 'failed'] }), attempt: int(), next_at: { type: ['string', 'null'] }, http_status: { type: ['integer', 'null'] }, error: { type: ['string', 'null'] }, created_at: str({ format: 'date-time' }), delivered_at: { type: ['string', 'null'] }, test: bool() }),
  DeliveryList: obj({ webhook_id: str(), deliveries: { type: 'array', items: ref('Delivery') } }),
  TestResult: obj({ delivery: ref('Delivery') }),
  FixFile: obj({ where: str(), kind: str({ enum: ['robots.txt', 'llms.txt', 'json-ld', 'html'] }), content: str() }),
  FixItem: obj({ priority: int(), id: str(), label: str(), pillar: { type: ['string', 'null'] }, points_at_stake: int(), fix: str(), files: { type: 'array', items: ref('FixFile') } }),
  FixList: obj({ domain: str(), scannedAt: str({ format: 'date-time' }), score: int(), items: { type: 'array', items: ref('FixItem') }, note: str() }),
  RecheckRequest: obj({ domain: str(DOMAIN) }),
  RecheckResult: obj({ domain: str(), checked_at: str({ format: 'date-time' }), score_before: int(), score_after: int(), fixed: { type: 'array', items: str() }, still_failing: { type: 'array', items: str() }, new_failures: { type: 'array', items: str() }, note: str() }),
  ExportResult: obj({ domain: str(), type: str({ enum: ['snapshots', 'events'] }), exported_at: str({ format: 'date-time' }), retention_days: int(), count: int(), rows: { type: 'array', items: { type: 'object' } } }),
  Benchmark: { type: 'object', description: 'Without "category": categories and overall. With "category": the detail of one category.', properties: { categories: { type: 'array', items: { type: 'object' } }, overall: { type: ['object', 'null'] }, category: str(), label: str(), track: str(), sitesScanned: int(), couldNotBeReached: int(), scannedAt: str(), score: { type: 'object' }, crawlers: { type: ['object', 'null'] }, checkFailureRates: { type: ['object', 'null'] }, note: str(), method: str() } }
};

function operation(e) {
  const lab = e.plan ? Plans.PLANS[e.plan].label : null;
  const op = { operationId: e.id, tags: [e.tag], summary: (lab ? lab + ': ' : '') + e.summary, description: (e.plan ? 'Available on ' + Plans.planList(e.plan) + '. ' : '') + e.description };
  if (e.plan) op['x-plan'] = e.plan;
  if (!e.auth) op.security = [];
  if (e.params) op.parameters = e.params.map((p) => Object.assign({ name: p.name, in: p.in || 'query', required: p.in === 'path' ? true : p.required, schema: p.schema }, p.description ? { description: p.description } : {}));
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
      description: 'Scans one page of a domain (its robots.txt, llms.txt, sitemap declaration and homepage) and scores it out of 100, and generates llms.txt, robots.txt and JSON-LD. Pro keys can also watch domains: weekly re-scans, events and signed webhooks. The score measures readiness: crawler access and on-page signals. It does not measure whether any assistant names a brand.\n\nGet a free key by email at ' + site.baseUrl + '/api. Limits: a free key allows ' + L.free.hour + ' requests an hour and ' + L.free.day + ' a day; the same domain is scanned at most ' + Limits.DOMAIN_PER_HOUR + ' times an hour across all keys.',
      termsOfService: site.baseUrl + '/terms', contact: { name: 'Citehound', email: site.contactEmail, url: site.baseUrl }
    },
    servers: [{ url: BASE, description: 'Production' }],
    tags: [{ name: 'Keys' }, { name: 'Account' }, { name: 'Scan' }, { name: 'Generate' }, { name: 'Benchmark' }, { name: 'Monitoring', description: 'Pro, Fix and Beyond.' }, { name: 'Webhooks', description: 'Pro, Fix and Beyond.' }, { name: 'Fix', description: 'Fix and Beyond.' }],
    security: [{ bearerAuth: [] }, { keyHeader: [] }],
    paths: paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'Authorization: Bearer <key>.' }, keyHeader: { type: 'apiKey', in: 'header', name: 'X-Citehound-Key', description: 'The same key in a header of its own.' } },
      schemas: SCHEMAS, responses: responses
    }
  };
}

module.exports = { ENDPOINTS, ERRORS, SCHEMAS, spec, BASE };
