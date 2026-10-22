import { createTrigger, TriggerStrategy, Property } from '@activepieces/pieces-framework';
import { citehoundAuth, core } from '../client';

const TYPES = ['score_dropped', 'score_improved', 'crawler_blocked', 'crawler_unblocked', 'llms_txt_added', 'llms_txt_removed', 'check_failed', 'check_fixed', 'scan_failed'];
const KEY = 'citehound_last_event_id';

type Ctx = { auth: unknown; propsValue: { domain?: string; types?: string[] }; store: { get: <T>(k: string) => Promise<T | null>; put: (k: string, v: unknown) => Promise<unknown> }; fetchImpl?: unknown };

async function poll(c: Ctx, firstRun: 'baseline' | 'latest') {
	const client = core(c.auth as string, c.fetchImpl);
	const last = await c.store.get<string>(KEY);
	try {
		const r = await client.pollEvents(last ? { lastId: last } : {}, { domain: c.propsValue.domain || undefined, types: c.propsValue.types || [], firstRun });
		if (r.state.lastId) await c.store.put(KEY, r.state.lastId);
		return r.events as unknown[];
	} catch (e) {
		throw new Error((e as Error).message);
	}
}

export const newEvent = createTrigger({
	auth: citehoundAuth,
	name: 'new_event',
	displayName: 'New Monitoring Event',
	description: 'Starts when something changes on a domain you watch: a score drop or rise, a crawler blocked or unblocked, llms.txt added or removed, a check failing or fixed, a scan that failed. Needs a Pro, Fix or Beyond key.',
	props: {
		domain: Property.ShortText({ displayName: 'Domain', description: 'Leave empty for all watched domains.', required: false }),
		types: Property.StaticMultiSelectDropdown({ displayName: 'Event Types', description: 'Leave empty for all types.', required: false, options: { options: TYPES.map((v) => ({ label: v, value: v })) } }),
	},
	sampleData: { id: 'evt_20261029060012_ab12cd34ef', type: 'score_dropped', domain: 'example.com', at: '2026-10-29T06:00:12.000Z', summary: 'Readiness score dropped from 87 to 79 (-8 points).', snapshot_id: 'snp_20261029060012', data: { from: 87, to: 79, delta: -8 } },
	type: TriggerStrategy.POLLING,
	// On enable: remember the newest event so that old ones are not sent as new.
	async onEnable(context) { await poll(context as unknown as Ctx, 'baseline'); },
	async onDisable() { /* nothing to undo: the mark stays in the store */ },
	async run(context) { return (await poll(context as unknown as Ctx, 'baseline')) as unknown[]; },
	async test(context) { return (await poll({ ...(context as unknown as Ctx), store: { get: async () => null, put: async () => undefined } }, 'latest')) as unknown[]; },
});
