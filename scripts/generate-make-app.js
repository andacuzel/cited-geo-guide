#!/usr/bin/env node
/* =====================================================================
   scripts/generate-make-app.js

   Writes the files of the Make custom app (integrations/make/): the base, the connection (an API key) and one folder per module (api, parameters, interface), from the table below, which is
   the one place the module list lives. The paths and fields come from integrations/shared/citehound-core.js (OPS), so the app calls only what the shared client calls.
   The files follow the layout of Make's Apps Editor (.imljson). They are NOT imported into Make here (there is no Make account in this repository): the README says how the owner does it.

     node scripts/generate-make-app.js            write the files
     node scripts/generate-make-app.js --check    exit 1 if a file is out of date
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const { OPS } = require('../integrations/shared/citehound-core.js');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'integrations/make');

const domainP = { name: 'domain', type: 'text', label: 'Domain', required: true, help: 'A bare domain such as example.com.' };
const MODULES = [
  { id: 'scan-domain', op: 'scan', type: 'action', label: 'Scan a Domain', desc: 'Scans a domain for AI readiness: the score, the pillars, the crawlers and the failed checks. A free key shows the first three findings.', params: [domainP], qs: { domain: 'domain' }, iface: [{ name: 'domain', type: 'text' }, { name: 'score', type: 'number' }, { name: 'pillars', type: 'array' }, { name: 'failed', type: 'array' }, { name: 'crawlers', type: 'array' }, { name: 'note', type: 'text' }] },
  { id: 'compare-domains', op: 'compare', type: 'action', label: 'Compare Two Domains', desc: 'Scans two domains and lists where they differ. Needs a Pro, Fix or Beyond key.', params: [{ name: 'a', type: 'text', label: 'First Domain', required: true }, { name: 'b', type: 'text', label: 'Second Domain', required: true }], qs: { a: 'a', b: 'b' }, iface: [{ name: 'a', type: 'collection' }, { name: 'b', type: 'collection' }, { name: 'differences', type: 'array' }] },
  { id: 'get-crawler-access', op: 'crawlers', type: 'action', label: 'Get Crawler Access', desc: 'The state of ten AI crawlers in robots.txt.', params: [domainP], qs: { domain: 'domain' }, iface: [{ name: 'crawlers', type: 'array' }, { name: 'summary', type: 'collection' }] },
  { id: 'generate-llms-txt', op: 'llmsTxt', type: 'action', label: 'Generate llms.txt', desc: 'Builds an llms.txt from a name, a description and key pages. A free key gets a preview.', params: [{ name: 'name', type: 'text', label: 'Site Name', required: true }, { name: 'description', type: 'text', label: 'Description', required: true }, { name: 'pages', type: 'array', label: 'Key Pages', spec: [{ name: 'url', type: 'url', label: 'URL' }, { name: 'description', type: 'text', label: 'Description' }] }], body: { name: 'name', description: 'description', pages: 'pages' }, iface: [{ name: 'content', type: 'text' }, { name: 'preview', type: 'boolean' }] },
  { id: 'generate-robots-txt', op: 'robotsTxt', type: 'action', label: 'Generate robots.txt', desc: 'Builds a robots.txt that allows or blocks named AI crawlers. A free key gets a preview.', params: [{ name: 'allow', type: 'array', label: 'Allow', spec: { type: 'text', label: 'Crawler name' } }, { name: 'block', type: 'array', label: 'Block', spec: { type: 'text', label: 'Crawler name' } }, { name: 'sitemap', type: 'url', label: 'Sitemap URL' }], body: { allow: 'allow', block: 'block', sitemap: 'sitemap' }, iface: [{ name: 'content', type: 'text' }, { name: 'preview', type: 'boolean' }] },
  { id: 'generate-schema', op: 'schema', type: 'action', label: 'Generate Schema', desc: 'Builds JSON-LD from a homepage. A free key can use the organization type.', params: [domainP, { name: 'type', type: 'select', label: 'Type', required: true, default: 'organization', options: ['organization', 'faqpage', 'article', 'product', 'localbusiness'] }], qs: { domain: 'domain', type: 'type' }, iface: [{ name: 'json_ld', type: 'collection' }] },
  { id: 'watch-domain', op: 'watchAdd', type: 'action', label: 'Watch a Domain', desc: 'Adds a domain to the watchlist. Needs a Pro, Fix or Beyond key.', params: [domainP, { name: 'alert_email', type: 'email', label: 'Alert Email', help: 'The address the key was sent to, to get alert emails.' }], body: { domain: 'domain', alert_email: 'alert_email' }, iface: [{ name: 'watch', type: 'collection' }] },
  { id: 'list-watched-domains', op: 'watchList', type: 'search', label: 'List Watched Domains', desc: 'The watchlist with the last scan and score. Needs a Pro, Fix or Beyond key.', params: [], iterate: 'domains', iface: [{ name: 'domain', type: 'text' }, { name: 'last_score', type: 'number' }] },
  { id: 'get-fix-list', op: 'fixes', type: 'action', label: 'Get the Fix List', desc: 'The prioritized fix list with the files to paste. Needs a Fix or Beyond key.', params: [domainP], qs: { domain: 'domain' }, iface: [{ name: 'items', type: 'array' }, { name: 'score', type: 'number' }] },
  { id: 'watch-events', op: 'events', type: 'trigger', label: 'Watch Monitoring Events', desc: 'Triggers for each new monitoring event: a score drop or rise, a crawler blocked or unblocked, llms.txt added or removed, a check failing or fixed, a scan that failed. Needs a Pro, Fix or Beyond key.', params: [{ name: 'domain', type: 'text', label: 'Domain', help: 'Leave empty for all watched domains.' }, { name: 'type', type: 'text', label: 'Event Types', help: 'Comma-separated, for example score_dropped,crawler_blocked. Leave empty for all.' }], qs: { domain: 'domain', type: 'type' }, iterate: 'events', iface: [{ name: 'id', type: 'text' }, { name: 'type', type: 'text' }, { name: 'domain', type: 'text' }, { name: 'at', type: 'date' }, { name: 'summary', type: 'text' }] },
];

const j = (o) => JSON.stringify(o, null, 2) + '\n';
function files() {
  const f = {};
  f['general/base.imljson'] = j({ baseUrl: 'https://getcitehound.com/v1', headers: { Authorization: 'Bearer {{connection.apiKey}}', Accept: 'application/json' }, log: { sanitize: ['request.headers.authorization'] }, response: { error: { message: '[{{statusCode}}] {{body.message}}' } } });
  f['general/groups.json'] = j([{ name: 'Scan and compare', label: 'Scan and compare' }, { name: 'Generate', label: 'Generate' }, { name: 'Monitoring', label: 'Monitoring' }]);
  f['connections/citehound/parameters.imljson'] = j([{ name: 'apiKey', type: 'password', label: 'API Key', required: true, help: 'A key that starts with chk_. A free key is sent by email at https://getcitehound.com/api.' }]);
  f['connections/citehound/api.imljson'] = j({ url: '/me', method: 'GET', response: { valid: '{{statusCode === 200}}', error: { message: '[{{statusCode}}] {{body.message}}' } } });
  MODULES.forEach((m) => {
    const def = OPS[m.op], dir = 'modules/' + m.id + '/';
    const api = { url: def[1], method: def[0] };
    if (m.qs) api.qs = Object.fromEntries(Object.keys(m.qs).map((k) => [k, '{{parameters.' + m.qs[k] + '}}']));
    if (m.body) api.body = Object.fromEntries(Object.keys(m.body).map((k) => [k, '{{parameters.' + m.body[k] + '}}']));
    if (m.type === 'trigger') api.response = { iterate: '{{body.' + m.iterate + '}}', output: '{{item}}', trigger: { type: 'id', id: '{{item.id}}', order: 'desc' } };
    else if (m.iterate) api.response = { iterate: '{{body.' + m.iterate + '}}', output: '{{item}}' };
    else api.response = { output: '{{body}}' };
    f[dir + 'api.imljson'] = j(api);
    f[dir + 'parameters.imljson'] = j(m.params.map((p) => { const o = { name: p.name, type: p.type, label: p.label }; if (p.required) o.required = true; if (p.help) o.help = p.help; if (p.default) o.default = p.default; if (p.options) o.options = p.options.map((v) => ({ label: v, value: v })); if (p.spec) o.spec = p.spec; return o; }));
    f[dir + 'interface.imljson'] = j(m.iface);
  });
  f['makecomapp.json'] = j({ app: 'citehound', version: 1, description: 'Citehound for Make: scan a domain for AI readiness, compare sites, generate llms.txt, robots.txt and schema, and watch monitoring events.', connection: 'citehound', modules: MODULES.map((m) => ({ id: m.id, type: m.type, label: m.label, description: m.desc, group: m.type === 'trigger' || /watch|list/.test(m.id) ? 'Monitoring' : (/generate/.test(m.id) ? 'Generate' : 'Scan and compare') })) });
  return f;
}

function main() {
  const f = files(), bad = [];
  Object.keys(f).forEach((k) => {
    const p = path.join(OUT, k);
    if (process.argv.indexOf('--check') !== -1) { if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== f[k]) bad.push(k); }
    else { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f[k], 'utf8'); }
  });
  if (process.argv.indexOf('--check') !== -1) {
    // no stray file in the generated folders
    ['general', 'connections', 'modules'].forEach((d) => { (function walk(dir) { fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => { const full = path.join(dir, e.name); if (e.isDirectory()) walk(full); else if (!f[path.relative(OUT, full)]) bad.push('stray: ' + path.relative(OUT, full)); }); })(path.join(OUT, d)); });
    if (bad.length) { bad.forEach((b) => console.error('FAIL: ' + b + ' is out of date; run node scripts/generate-make-app.js')); process.exit(1); }
    console.log('OK: the Make app files are current (' + MODULES.length + ' modules, from the shared client\'s operation table)');
  } else console.log('written: ' + Object.keys(f).length + ' files in integrations/make/');
}
if (require.main === module) main();
module.exports = { MODULES, files };
