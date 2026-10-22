import type { IExecuteFunctions, IPollFunctions } from 'n8n-workflow';

// The shared client (citehound-core.js, copied from integrations/shared). It needs a fetch-like function: this one is made from n8n's own HTTP helper.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createCore } = require('./citehound-core.js');

type Ctx = IExecuteFunctions | IPollFunctions;

export async function makeCore(ctx: Ctx) {
	const credentials = await ctx.getCredentials('citehoundApi');
	const fetchLike = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
		const res = (await ctx.helpers.httpRequest({
			method: init.method as 'GET' | 'POST' | 'DELETE',
			url,
			headers: init.headers,
			body: init.body,
			json: false,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		})) as { body: unknown; headers: Record<string, string>; statusCode: number };
		const text = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
		const headers = res.headers || {};
		return { status: res.statusCode, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, text: async () => text };
	};
	return createCore({ apiKey: String(credentials.apiKey || ''), fetch: fetchLike, platform: 'n8n', version: '0.1.0' });
}
