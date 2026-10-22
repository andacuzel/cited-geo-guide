import { createAction, Property } from '@activepieces/pieces-framework';
import { citehoundAuth, run } from '../client';

const domain = Property.ShortText({ displayName: 'Domain', description: 'A bare domain such as example.com. A URL is cleaned to its domain.', required: true });
const list = (v: unknown) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

type Ctx = { auth: unknown; propsValue: Record<string, unknown>; fetchImpl?: unknown };
// fetchImpl is only set by the tests.
const go = (c: Ctx, op: string, params: Record<string, unknown>) => run(c.auth as string, op, params, c.fetchImpl);

export const scanDomain = createAction({
	auth: citehoundAuth,
	name: 'scan_domain',
	displayName: 'Scan a Domain',
	description: 'Scans a domain for AI readiness: the score, the pillars, the crawlers and the failed checks. A free key shows the first three findings.',
	props: { domain },
	run: async (c) => go(c as unknown as Ctx, 'scan', { domain: c.propsValue.domain }),
});

export const compareDomains = createAction({
	auth: citehoundAuth,
	name: 'compare_domains',
	displayName: 'Compare Two Domains',
	description: 'Scans two domains and lists where they differ. Needs a Pro, Fix or Beyond key.',
	props: { a: Property.ShortText({ displayName: 'First Domain', required: true }), b: Property.ShortText({ displayName: 'Second Domain', required: true }) },
	run: async (c) => go(c as unknown as Ctx, 'compare', { a: c.propsValue.a, b: c.propsValue.b }),
});

export const generateLlmsTxt = createAction({
	auth: citehoundAuth,
	name: 'generate_llms_txt',
	displayName: 'Generate llms.txt',
	description: 'Builds an llms.txt from a name, a description and key pages. A free key gets a preview.',
	props: {
		name: Property.ShortText({ displayName: 'Site Name', required: true }),
		description: Property.ShortText({ displayName: 'Description', required: true }),
		pages: Property.Array({ displayName: 'Key Pages', description: 'One per item: https://example.com/pricing | Plans and prices', required: false }),
	},
	run: async (c) => {
		const pages = ((c.propsValue.pages as string[]) || []).map((l) => { const i = l.indexOf('|'); return { url: l.slice(0, i === -1 ? undefined : i).trim(), description: i === -1 ? '' : l.slice(i + 1).trim() }; });
		return go(c as unknown as Ctx, 'llmsTxt', { name: c.propsValue.name, description: c.propsValue.description, pages });
	},
});

export const generateRobotsTxt = createAction({
	auth: citehoundAuth,
	name: 'generate_robots_txt',
	displayName: 'Generate robots.txt',
	description: 'Builds a robots.txt that allows or blocks named AI crawlers. A free key gets a preview.',
	props: {
		allow: Property.ShortText({ displayName: 'Allow', description: 'Comma-separated crawler names, for example GPTBot,ClaudeBot', required: false }),
		block: Property.ShortText({ displayName: 'Block', description: 'Comma-separated crawler names', required: false }),
		sitemap: Property.ShortText({ displayName: 'Sitemap URL', required: false }),
	},
	run: async (c) => go(c as unknown as Ctx, 'robotsTxt', { allow: list(c.propsValue.allow), block: list(c.propsValue.block), sitemap: c.propsValue.sitemap }),
});

export const generateSchema = createAction({
	auth: citehoundAuth,
	name: 'generate_schema',
	displayName: 'Generate Schema',
	description: 'Builds JSON-LD from a homepage. A free key can use the organization type.',
	props: {
		domain,
		type: Property.StaticDropdown({ displayName: 'Type', required: true, defaultValue: 'organization', options: { options: ['organization', 'faqpage', 'article', 'product', 'localbusiness'].map((v) => ({ label: v, value: v })) } }),
	},
	run: async (c) => go(c as unknown as Ctx, 'schema', { domain: c.propsValue.domain, type: c.propsValue.type }),
});

export const watchDomain = createAction({
	auth: citehoundAuth,
	name: 'watch_domain',
	displayName: 'Watch a Domain',
	description: 'Adds a domain to the watchlist. Needs a Pro, Fix or Beyond key.',
	props: { domain, alertEmail: Property.ShortText({ displayName: 'Alert Email', description: 'The address the key was sent to, to get alert emails.', required: false }) },
	run: async (c) => go(c as unknown as Ctx, 'watchAdd', { domain: c.propsValue.domain, alert_email: c.propsValue.alertEmail }),
});

export const getFixList = createAction({
	auth: citehoundAuth,
	name: 'get_fix_list',
	displayName: 'Get the Fix List',
	description: 'The prioritized fix list with the files to paste. Needs a Fix or Beyond key.',
	props: { domain },
	run: async (c) => go(c as unknown as Ctx, 'fixes', { domain: c.propsValue.domain }),
});
