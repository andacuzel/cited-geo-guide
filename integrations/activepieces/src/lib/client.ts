import { PieceAuth } from '@activepieces/pieces-framework';

// The shared client (citehound-core.js, a copy of integrations/shared). Activepieces runs on Node, so its own fetch is used.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createCore } = require('./citehound-core.js');

export const citehoundAuth = PieceAuth.SecretText({
	displayName: 'API Key',
	description: 'A key that starts with chk_. A free key is sent by email at https://getcitehound.com/api. Pro, Fix and Beyond keys add monitoring and more.',
	required: true,
});

type AuthValue = string | { secret_text?: string } | undefined;
const keyOf = (a: AuthValue): string => (typeof a === 'string' ? a : (a && a.secret_text) || '');

// The client for one key. fetchImpl is for tests.
export function core(auth: AuthValue, fetchImpl?: unknown) {
	return createCore({ apiKey: keyOf(auth), fetch: fetchImpl || globalThis.fetch, platform: 'activepieces', version: '0.1.0' });
}

// A Citehound error becomes a plain Error with the API's own message (it names the plans, never the key).
export async function run(auth: AuthValue, op: string, params: Record<string, unknown>, fetchImpl?: unknown): Promise<unknown> {
	try {
		return await core(auth, fetchImpl).run(op, params);
	} catch (e) {
		throw new Error((e as Error).message);
	}
}
export type { AuthValue };
