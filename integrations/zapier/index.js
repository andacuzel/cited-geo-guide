/* =====================================================================
   Citehound for Zapier (Zapier Platform CLI app). One authentication (an API key), one trigger (new monitoring event) and the creates that wrap the Citehound API (/v1).
   Every call goes through citehound-core.js (a copy of integrations/shared/citehound-core.js), so errors, plan messages and domain checks are the same as everywhere else.
   The trigger and the monitoring creates need a Pro, Fix or Beyond key; on a free key they stop with the API's own message.
   ===================================================================== */
'use strict';

const { createCore, CitehoundError } = require('./citehound-core.js');
const { version } = require('./package.json');
const PLATFORM = '19.2.1';

// A fetch-like function made from z.request, so the shared client works inside Zapier.
function fetchLike(z) {
  return async (url, init) => {
    const r = await z.request({ url: url, method: init.method, headers: init.headers, body: init.body, skipThrowForStatus: true });
    const headers = r.headers || {};
    return { status: r.status, headers: { get: (k) => (typeof headers.get === 'function' ? headers.get(k) : headers[k.toLowerCase()]) || null }, text: async () => (typeof r.content === 'string' ? r.content : JSON.stringify(r.data === undefined ? r.content : r.data)) };
  };
}
const coreFor = (z, bundle) => createCore({ apiKey: bundle.authData.apiKey, fetch: fetchLike(z), platform: 'zapier', version: version });
// A CitehoundError becomes a Zapier error with the API's own plain message.
async function call(z, bundle, op, params) {
  try { return await coreFor(z, bundle).run(op, params); } catch (e) { if (e instanceof CitehoundError) throw new z.errors.Error(e.message, e.code, e.status); throw e; }
}

const domainField = { key: 'domain', label: 'Domain', type: 'string', required: true, helpText: 'A bare domain such as example.com. A URL is cleaned to its domain.' };

const authentication = {
  type: 'custom',
  fields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true, helpText: 'A key that starts with chk_. A free key is sent by email at https://getcitehound.com/api. Pro, Fix and Beyond keys add monitoring and more.' }],
  test: (z, bundle) => call(z, bundle, 'me', {}),
  connectionLabel: '{{plan}} plan key {{email}}',
};

const newEvent = {
  key: 'new_event',
  noun: 'Event',
  display: { label: 'New Monitoring Event', description: 'Triggers when something changes on a domain you watch: a score drop or rise, a crawler blocked or unblocked, llms.txt added or removed, a check failing or fixed, a scan that failed. Needs a Pro, Fix or Beyond key.' },
  operation: {
    type: 'polling',
    inputFields: [
      { key: 'domain', label: 'Domain', type: 'string', required: false, helpText: 'Leave empty for all watched domains.' },
      { key: 'type', label: 'Event Types', type: 'string', required: false, helpText: 'Comma-separated, for example score_dropped,crawler_blocked. Leave empty for all.' },
    ],
    // Newest first, each with a stable id: Zapier removes the ones it has seen.
    perform: async (z, bundle) => (await call(z, bundle, 'events', { domain: bundle.inputData.domain, type: bundle.inputData.type, limit: 50 })).events,
    sample: { id: 'evt_20261029060012_ab12cd34ef', type: 'score_dropped', domain: 'example.com', at: '2026-10-29T06:00:12.000Z', summary: 'Readiness score dropped from 87 to 79 (-8 points).', snapshot_id: 'snp_20261029060012', data: { from: 87, to: 79, delta: -8 } },
    outputFields: [{ key: 'id' }, { key: 'type' }, { key: 'domain' }, { key: 'at' }, { key: 'summary' }],
  },
};

const create = (key, label, description, inputFields, op, map, sample) => ({
  key: key, noun: label, display: { label: label, description: description },
  operation: { inputFields: inputFields, perform: (z, bundle) => call(z, bundle, op, map(bundle.inputData)), sample: sample },
});

const creates = {
  scan_domain: create('scan_domain', 'Scan a Domain', 'Scans a domain for AI readiness: the score, the pillars, the crawlers and the failed checks. A free key shows the first three findings.', [domainField], 'scan', (i) => ({ domain: i.domain }), { domain: 'example.com', score: 62, pillars: [], failed: [], crawlers: [], note: 'A readiness score: crawler access and on-page signals. It does not measure whether any assistant names a brand.' }),
  compare_domains: create('compare_domains', 'Compare Two Domains', 'Scans two domains and lists where they differ. Needs a Pro, Fix or Beyond key.', [{ key: 'a', label: 'First Domain', type: 'string', required: true }, { key: 'b', label: 'Second Domain', type: 'string', required: true }], 'compare', (i) => ({ a: i.a, b: i.b }), { a: {}, b: {}, differences: [] }),
  generate_llms_txt: create('generate_llms_txt', 'Generate llms.txt', 'Builds an llms.txt from a name, a description and key pages. A free key gets a preview.', [{ key: 'name', label: 'Site Name', required: true }, { key: 'description', label: 'Description', required: true }, { key: 'pages', label: 'Pages', required: false, helpText: 'One per line: https://example.com/pricing | Plans and prices' }], 'llmsTxt',
    (i) => ({ name: i.name, description: i.description, pages: String(i.pages || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const k = l.indexOf('|'); return { url: l.slice(0, k === -1 ? undefined : k).trim(), description: k === -1 ? '' : l.slice(k + 1).trim() }; }) }), { type: 'llms.txt', content: '# Example\n' }),
  generate_robots_txt: create('generate_robots_txt', 'Generate robots.txt', 'Builds a robots.txt that allows or blocks named AI crawlers. A free key gets a preview.', [{ key: 'allow', label: 'Allow', helpText: 'Comma-separated crawler names, for example GPTBot,ClaudeBot' }, { key: 'block', label: 'Block', helpText: 'Comma-separated crawler names' }, { key: 'sitemap', label: 'Sitemap URL' }], 'robotsTxt',
    (i) => ({ allow: String(i.allow || '').split(',').map((s) => s.trim()).filter(Boolean), block: String(i.block || '').split(',').map((s) => s.trim()).filter(Boolean), sitemap: i.sitemap }), { type: 'robots.txt', content: 'User-agent: GPTBot\nAllow: /\n' }),
  generate_schema: create('generate_schema', 'Generate Schema', 'Builds JSON-LD from a homepage. A free key can use the organization type.', [domainField, { key: 'type', label: 'Type', choices: ['organization', 'faqpage', 'article', 'product', 'localbusiness'], default: 'organization' }], 'schema', (i) => ({ domain: i.domain, type: i.type || 'organization' }), { type: 'organization', json_ld: {} }),
  watch_domain: create('watch_domain', 'Watch a Domain', 'Adds a domain to the watchlist. Needs a Pro, Fix or Beyond key.', [domainField, { key: 'alert_email', label: 'Alert Email', required: false, helpText: 'The address the key was sent to, to get alert emails.' }], 'watchAdd', (i) => ({ domain: i.domain, alert_email: i.alert_email }), { watch: { domain: 'example.com' } }),
  get_fix_list: create('get_fix_list', 'Get the Fix List', 'The prioritized fix list with the files to paste. Needs a Fix or Beyond key.', [domainField], 'fixes', (i) => ({ domain: i.domain }), { domain: 'example.com', items: [] }),
};

module.exports = {
  version: version,
  platformVersion: PLATFORM,
  authentication: authentication,
  beforeRequest: [],
  afterResponse: [],
  triggers: { [newEvent.key]: newEvent },
  searches: {},
  creates: creates,
  resources: {},
};
