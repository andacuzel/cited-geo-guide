"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFixList = exports.watchDomain = exports.generateSchema = exports.generateRobotsTxt = exports.generateLlmsTxt = exports.compareDomains = exports.scanDomain = void 0;
const pieces_framework_1 = require("@activepieces/pieces-framework");
const client_1 = require("../client");
const domain = pieces_framework_1.Property.ShortText({ displayName: 'Domain', description: 'A bare domain such as example.com. A URL is cleaned to its domain.', required: true });
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
// fetchImpl is only set by the tests.
const go = (c, op, params) => (0, client_1.run)(c.auth, op, params, c.fetchImpl);
exports.scanDomain = (0, pieces_framework_1.createAction)({
    auth: client_1.citehoundAuth,
    name: 'scan_domain',
    displayName: 'Scan a Domain',
    description: 'Scans a domain for AI readiness: the score, the pillars, the crawlers and the failed checks. A free key shows the first three findings.',
    props: { domain },
    run: async (c) => go(c, 'scan', { domain: c.propsValue.domain }),
});
exports.compareDomains = (0, pieces_framework_1.createAction)({
    auth: client_1.citehoundAuth,
    name: 'compare_domains',
    displayName: 'Compare Two Domains',
    description: 'Scans two domains and lists where they differ. Needs a Pro, Fix or Beyond key.',
    props: { a: pieces_framework_1.Property.ShortText({ displayName: 'First Domain', required: true }), b: pieces_framework_1.Property.ShortText({ displayName: 'Second Domain', required: true }) },
    run: async (c) => go(c, 'compare', { a: c.propsValue.a, b: c.propsValue.b }),
});
exports.generateLlmsTxt = (0, pieces_framework_1.createAction)({
    auth: client_1.citehoundAuth,
    name: 'generate_llms_txt',
    displayName: 'Generate llms.txt',
    description: 'Builds an llms.txt from a name, a description and key pages. A free key gets a preview.',
    props: {
        name: pieces_framework_1.Property.ShortText({ displayName: 'Site Name', required: true }),
        description: pieces_framework_1.Property.ShortText({ displayName: 'Description', required: true }),
        pages: pieces_framework_1.Property.Array({ displayName: 'Key Pages', description: 'One per item: https://example.com/pricing | Plans and prices', required: false }),
    },
    run: async (c) => {
        const pages = (c.propsValue.pages || []).map((l) => { const i = l.indexOf('|'); return { url: l.slice(0, i === -1 ? undefined : i).trim(), description: i === -1 ? '' : l.slice(i + 1).trim() }; });
        return go(c, 'llmsTxt', { name: c.propsValue.name, description: c.propsValue.description, pages });
    },
});
exports.generateRobotsTxt = (0, pieces_framework_1.createAction)({
    auth: client_1.citehoundAuth,
    name: 'generate_robots_txt',
    displayName: 'Generate robots.txt',
    description: 'Builds a robots.txt that allows or blocks named AI crawlers. A free key gets a preview.',
    props: {
        allow: pieces_framework_1.Property.ShortText({ displayName: 'Allow', description: 'Comma-separated crawler names, for example GPTBot,ClaudeBot', required: false }),
        block: pieces_framework_1.Property.ShortText({ displayName: 'Block', description: 'Comma-separated crawler names', required: false }),
        sitemap: pieces_framework_1.Property.ShortText({ displayName: 'Sitemap URL', required: false }),
    },
    run: async (c) => go(c, 'robotsTxt', { allow: list(c.propsValue.allow), block: list(c.propsValue.block), sitemap: c.propsValue.sitemap }),
});
exports.generateSchema = (0, pieces_framework_1.createAction)({
    auth: client_1.citehoundAuth,
    name: 'generate_schema',
    displayName: 'Generate Schema',
    description: 'Builds JSON-LD from a homepage. A free key can use the organization type.',
    props: {
        domain,
        type: pieces_framework_1.Property.StaticDropdown({ displayName: 'Type', required: true, defaultValue: 'organization', options: { options: ['organization', 'faqpage', 'article', 'product', 'localbusiness'].map((v) => ({ label: v, value: v })) } }),
    },
    run: async (c) => go(c, 'schema', { domain: c.propsValue.domain, type: c.propsValue.type }),
});
exports.watchDomain = (0, pieces_framework_1.createAction)({
    auth: client_1.citehoundAuth,
    name: 'watch_domain',
    displayName: 'Watch a Domain',
    description: 'Adds a domain to the watchlist. Needs a Pro, Fix or Beyond key.',
    props: { domain, alertEmail: pieces_framework_1.Property.ShortText({ displayName: 'Alert Email', description: 'The address the key was sent to, to get alert emails.', required: false }) },
    run: async (c) => go(c, 'watchAdd', { domain: c.propsValue.domain, alert_email: c.propsValue.alertEmail }),
});
exports.getFixList = (0, pieces_framework_1.createAction)({
    auth: client_1.citehoundAuth,
    name: 'get_fix_list',
    displayName: 'Get the Fix List',
    description: 'The prioritized fix list with the files to paste. Needs a Fix or Beyond key.',
    props: { domain },
    run: async (c) => go(c, 'fixes', { domain: c.propsValue.domain }),
});
