import { getPreferenceValues } from '@raycast/api';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createCore } = require('./citehound-core.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const md = require('./markdown.js');

export const markdown = md as {
	scanMarkdown: (s: unknown) => string;
	compareMarkdown: (c: unknown) => string;
	fileResult: (r: unknown) => { text: string; note: string | null };
	eventTitle: (e: { domain: string; type: string }) => string;
};

export function client() {
	const { apiKey } = getPreferenceValues<{ apiKey: string }>();
	return createCore({ apiKey, fetch: globalThis.fetch, platform: 'raycast', version: '0.1.0' }) as { run: (op: string, params: Record<string, unknown>) => Promise<any> };
}
