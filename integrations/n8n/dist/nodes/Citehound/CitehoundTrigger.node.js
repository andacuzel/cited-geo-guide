"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CitehoundTrigger = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const shared_1 = require("./shared");
const EVENT_TYPES = ['score_dropped', 'score_improved', 'crawler_blocked', 'crawler_unblocked', 'llms_txt_added', 'llms_txt_removed', 'check_failed', 'check_fixed', 'scan_failed'];
const options = EVENT_TYPES.map((v) => ({ name: v, value: v }));
class CitehoundTrigger {
    constructor() {
        this.description = {
            displayName: 'Citehound Trigger',
            name: 'citehoundTrigger',
            icon: 'file:citehound.svg',
            group: ['trigger'],
            version: 1,
            subtitle: 'on a monitoring event',
            description: 'Starts a workflow when something changes on a domain you watch (Pro, Fix and Beyond keys). A free key gets a message that monitoring is part of a paid plan.',
            defaults: { name: 'Citehound Trigger' },
            polling: true,
            inputs: [],
            outputs: [n8n_workflow_1.NodeConnectionTypes.Main],
            credentials: [{ name: 'citehoundApi', required: true }],
            properties: [
                { displayName: 'Event Types', name: 'eventTypes', type: 'multiOptions', default: ['score_dropped', 'crawler_blocked', 'llms_txt_removed'], options, description: 'Leave empty for all types' },
                { displayName: 'Domain', name: 'domain', type: 'string', default: '', placeholder: 'example.com', description: 'Leave empty for all watched domains' },
            ],
        };
    }
    async poll() {
        const state = this.getWorkflowStaticData('node');
        const core = await (0, shared_1.makeCore)(this);
        try {
            const r = (await core.pollEvents(state, {
                types: this.getNodeParameter('eventTypes', []),
                domain: this.getNodeParameter('domain', '') || undefined,
                firstRun: this.getMode() === 'manual' ? 'latest' : 'baseline',
            }));
            state.lastId = r.state.lastId;
            if (!r.events.length)
                return null;
            return [this.helpers.returnJsonArray(r.events)];
        }
        catch (error) {
            throw new n8n_workflow_1.NodeOperationError(this.getNode(), error.message);
        }
    }
}
exports.CitehoundTrigger = CitehoundTrigger;
