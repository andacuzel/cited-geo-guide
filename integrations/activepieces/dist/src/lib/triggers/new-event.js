"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.newEvent = void 0;
const pieces_framework_1 = require("@activepieces/pieces-framework");
const client_1 = require("../client");
const TYPES = ['score_dropped', 'score_improved', 'crawler_blocked', 'crawler_unblocked', 'llms_txt_added', 'llms_txt_removed', 'check_failed', 'check_fixed', 'scan_failed'];
const KEY = 'citehound_last_event_id';
async function poll(c, firstRun) {
    const client = (0, client_1.core)(c.auth, c.fetchImpl);
    const last = await c.store.get(KEY);
    try {
        const r = await client.pollEvents(last ? { lastId: last } : {}, { domain: c.propsValue.domain || undefined, types: c.propsValue.types || [], firstRun });
        if (r.state.lastId)
            await c.store.put(KEY, r.state.lastId);
        return r.events;
    }
    catch (e) {
        throw new Error(e.message);
    }
}
exports.newEvent = (0, pieces_framework_1.createTrigger)({
    auth: client_1.citehoundAuth,
    name: 'new_event',
    displayName: 'New Monitoring Event',
    description: 'Starts when something changes on a domain you watch: a score drop or rise, a crawler blocked or unblocked, llms.txt added or removed, a check failing or fixed, a scan that failed. Needs a Pro, Fix or Beyond key.',
    props: {
        domain: pieces_framework_1.Property.ShortText({ displayName: 'Domain', description: 'Leave empty for all watched domains.', required: false }),
        types: pieces_framework_1.Property.StaticMultiSelectDropdown({ displayName: 'Event Types', description: 'Leave empty for all types.', required: false, options: { options: TYPES.map((v) => ({ label: v, value: v })) } }),
    },
    sampleData: { id: 'evt_20261029060012_ab12cd34ef', type: 'score_dropped', domain: 'example.com', at: '2026-10-29T06:00:12.000Z', summary: 'Readiness score dropped from 87 to 79 (-8 points).', snapshot_id: 'snp_20261029060012', data: { from: 87, to: 79, delta: -8 } },
    type: pieces_framework_1.TriggerStrategy.POLLING,
    // On enable: remember the newest event so that old ones are not sent as new.
    async onEnable(context) { await poll(context, 'baseline'); },
    async onDisable() { },
    async run(context) { return (await poll(context, 'baseline')); },
    async test(context) { return (await poll({ ...context, store: { get: async () => null, put: async () => undefined } }, 'latest')); },
});
