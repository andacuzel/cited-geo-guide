"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Citehound = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const shared_1 = require("./shared");
// Every operation: its value, name, what it does, the plans that have it and the parameters it shows.
const OPS = [
    { value: 'scan', name: 'Scan a Domain', action: 'Scan a domain for AI readiness', plans: 'All plans. A free key shows the score and the first three findings.', show: ['domain'] },
    { value: 'compare', name: 'Compare Two Domains', action: 'Compare two domains', plans: 'Pro, Fix and Beyond.', show: ['domainA', 'domainB'] },
    { value: 'crawlers', name: 'Get Crawler Access', action: 'Get the state of ten AI crawlers in robots.txt', plans: 'All plans.', show: ['domain'] },
    { value: 'benchmark', name: 'Get Benchmark', action: 'Get the archived benchmark data', plans: 'All plans.', show: ['category'] },
    { value: 'generateSchema', name: 'Generate Schema', action: 'Generate JSON-LD from a homepage', plans: 'A free key: the organization type. Other types: Pro, Fix and Beyond.', show: ['domain', 'schemaType'] },
    { value: 'generateLlmsTxt', name: 'Generate llms.txt', action: 'Generate an llms.txt', plans: 'A free key gets a preview. The full file: Pro, Fix and Beyond.', show: ['siteName', 'siteDescription', 'pages'] },
    { value: 'generateRobotsTxt', name: 'Generate robots.txt', action: 'Generate a robots.txt for AI crawlers', plans: 'A free key gets a preview. The full file: Pro, Fix and Beyond.', show: ['allow', 'block', 'sitemap'] },
    { value: 'watchAdd', name: 'Watch a Domain', action: 'Add a domain to the watchlist', plans: 'Pro, Fix and Beyond.', show: ['domain', 'alertEmail'] },
    { value: 'watchList', name: 'List Watched Domains', action: 'List the watched domains', plans: 'Pro, Fix and Beyond.', show: [] },
    { value: 'watchRemove', name: 'Stop Watching a Domain', action: 'Remove a domain from the watchlist', plans: 'Pro, Fix and Beyond.', show: ['domain'] },
    { value: 'history', name: 'Get Score History', action: 'Get the stored scans of a watched domain', plans: 'Pro, Fix and Beyond.', show: ['domain', 'limit'] },
    { value: 'events', name: 'Get Events', action: 'Get what changed on the watched domains', plans: 'Pro, Fix and Beyond.', show: ['domainOptional', 'eventTypes', 'limit'] },
    { value: 'fixes', name: 'Get Fix List', action: 'Get the prioritized fix list with files to paste', plans: 'Fix and Beyond.', show: ['domain'] },
    { value: 'recheck', name: 'Re-Check After Fixes', action: 'Scan again and compare with the fix list', plans: 'Fix and Beyond.', show: ['domain'] },
    { value: 'exportData', name: 'Export History or Events', action: 'Export the stored history or events', plans: 'Beyond.', show: ['domain', 'exportType', 'exportFormat'] },
    { value: 'me', name: 'Get Plan and Limits', action: 'Get the plan, limits and usage of the key', plans: 'All plans.', show: [] },
];
const EVENT_TYPES = ['score_dropped', 'score_improved', 'crawler_blocked', 'crawler_unblocked', 'llms_txt_added', 'llms_txt_removed', 'check_failed', 'check_fixed', 'scan_failed'];
const opts = (list) => list.map((v) => ({ name: v, value: v }));
function param(show, p) {
    const ops = OPS.filter((o) => o.show.indexOf(show) !== -1).map((o) => o.value);
    return { ...p, displayOptions: { show: { operation: ops } } };
}
const properties = [
    {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'scan',
        options: OPS.map((o) => ({ name: o.name, value: o.value, description: o.plans, action: o.action })),
    },
    param('domain', { displayName: 'Domain', name: 'domain', type: 'string', default: '', required: true, placeholder: 'example.com', description: 'A bare domain. A URL is cleaned to its domain.' }),
    param('domainOptional', { displayName: 'Domain', name: 'domainOptional', type: 'string', default: '', placeholder: 'example.com', description: 'Leave empty for all watched domains' }),
    param('domainA', { displayName: 'First Domain', name: 'domainA', type: 'string', default: '', required: true, placeholder: 'mysite.com' }),
    param('domainB', { displayName: 'Second Domain', name: 'domainB', type: 'string', default: '', required: true, placeholder: 'theirsite.com' }),
    param('category', { displayName: 'Category', name: 'category', type: 'string', default: '', description: 'A category id from the overview. Leave empty for the overview.' }),
    param('schemaType', { displayName: 'Schema Type', name: 'schemaType', type: 'options', default: 'organization', options: opts(['organization', 'faqpage', 'article', 'product', 'localbusiness']) }),
    param('siteName', { displayName: 'Site Name', name: 'siteName', type: 'string', default: '', required: true }),
    param('siteDescription', { displayName: 'Description', name: 'siteDescription', type: 'string', default: '', required: true, description: 'One sentence about the site' }),
    param('pages', {
        displayName: 'Key Pages',
        name: 'pages',
        type: 'fixedCollection',
        typeOptions: { multipleValues: true },
        default: {},
        placeholder: 'Add Page',
        options: [{ displayName: 'Page', name: 'page', values: [{ displayName: 'URL', name: 'url', type: 'string', default: '' }, { displayName: 'Description', name: 'description', type: 'string', default: '' }] }],
    }),
    param('allow', { displayName: 'Allow', name: 'allow', type: 'string', default: '', placeholder: 'GPTBot,ClaudeBot', description: 'Comma-separated crawler names to allow' }),
    param('block', { displayName: 'Block', name: 'block', type: 'string', default: '', placeholder: 'Bytespider', description: 'Comma-separated crawler names to block' }),
    param('sitemap', { displayName: 'Sitemap URL', name: 'sitemap', type: 'string', default: '' }),
    param('alertEmail', { displayName: 'Alert Email', name: 'alertEmail', type: 'string', default: '', description: 'The address this key was sent to, to get alert emails. Optional.' }),
    param('limit', { displayName: 'Limit', name: 'limit', type: 'number', default: 20, typeOptions: { minValue: 1, maxValue: 100 } }),
    param('eventTypes', { displayName: 'Event Types', name: 'eventTypes', type: 'multiOptions', default: [], options: opts(EVENT_TYPES), description: 'Leave empty for all types' }),
    param('exportType', { displayName: 'Export', name: 'exportType', type: 'options', default: 'snapshots', options: opts(['snapshots', 'events']) }),
    param('exportFormat', { displayName: 'Format', name: 'exportFormat', type: 'options', default: 'json', options: opts(['json', 'csv']) }),
];
class Citehound {
    constructor() {
        this.description = {
            displayName: 'Citehound',
            name: 'citehound',
            icon: 'file:citehound.svg',
            group: ['transform'],
            version: 1,
            subtitle: '={{$parameter["operation"]}}',
            description: 'Scan a domain for AI readiness, compare sites, generate llms.txt, robots.txt and schema, and read monitoring events. The score measures readiness. It does not measure whether any assistant names a brand.',
            defaults: { name: 'Citehound' },
            inputs: [n8n_workflow_1.NodeConnectionTypes.Main],
            outputs: [n8n_workflow_1.NodeConnectionTypes.Main],
            credentials: [{ name: 'citehoundApi', required: true }],
            properties,
        };
    }
    async execute() {
        const items = this.getInputData();
        const out = [];
        const core = await (0, shared_1.makeCore)(this);
        for (let i = 0; i < items.length; i++) {
            try {
                const op = this.getNodeParameter('operation', i);
                const s = (name) => this.getNodeParameter(name, i, '');
                const list = (v) => v.split(',').map((x) => x.trim()).filter(Boolean);
                let params = {};
                let run = op;
                if (op === 'scan' || op === 'crawlers' || op === 'fixes' || op === 'watchRemove' || op === 'history')
                    params = { domain: s('domain') };
                if (op === 'history')
                    params.limit = this.getNodeParameter('limit', i, 20);
                if (op === 'recheck')
                    params = { domain: s('domain') };
                if (op === 'compare')
                    params = { a: s('domainA'), b: s('domainB') };
                if (op === 'benchmark')
                    params = { category: s('category') };
                if (op === 'generateSchema') {
                    run = 'schema';
                    params = { domain: s('domain'), type: s('schemaType') };
                }
                if (op === 'generateLlmsTxt') {
                    run = 'llmsTxt';
                    const pages = this.getNodeParameter('pages', i, {}).page || [];
                    params = { name: s('siteName'), description: s('siteDescription'), pages };
                }
                if (op === 'generateRobotsTxt') {
                    run = 'robotsTxt';
                    params = { allow: list(s('allow')), block: list(s('block')), sitemap: s('sitemap') };
                }
                if (op === 'watchAdd')
                    params = { domain: s('domain'), alert_email: s('alertEmail') };
                if (op === 'events')
                    params = { domain: s('domainOptional'), type: this.getNodeParameter('eventTypes', i, []).join(','), limit: this.getNodeParameter('limit', i, 20) };
                if (op === 'exportData')
                    params = { domain: s('domain'), type: s('exportType'), format: s('exportFormat') };
                const result = (await core.run(run, params));
                if (op === 'events' && Array.isArray(result.events))
                    for (const e of result.events)
                        out.push({ json: e, pairedItem: { item: i } });
                else
                    out.push({ json: result, pairedItem: { item: i } });
            }
            catch (error) {
                const message = error.message;
                if (this.continueOnFail())
                    out.push({ json: { error: message }, pairedItem: { item: i } });
                else
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), message, { itemIndex: i });
            }
        }
        return [out];
    }
}
exports.Citehound = Citehound;
