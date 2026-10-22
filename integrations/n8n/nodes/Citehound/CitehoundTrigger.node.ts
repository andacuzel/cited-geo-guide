import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type { IDataObject, INodeExecutionData, INodePropertyOptions, INodeType, INodeTypeDescription, IPollFunctions } from 'n8n-workflow';
import { makeCore } from './shared';

const EVENT_TYPES = ['score_dropped', 'score_improved', 'crawler_blocked', 'crawler_unblocked', 'llms_txt_added', 'llms_txt_removed', 'check_failed', 'check_fixed', 'scan_failed'];
const options: INodePropertyOptions[] = EVENT_TYPES.map((v) => ({ name: v, value: v }));

export class CitehoundTrigger implements INodeType {
	description: INodeTypeDescription = {
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
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'citehoundApi', required: true }],
		properties: [
			{ displayName: 'Event Types', name: 'eventTypes', type: 'multiOptions', default: ['score_dropped', 'crawler_blocked', 'llms_txt_removed'], options, description: 'Leave empty for all types' },
			{ displayName: 'Domain', name: 'domain', type: 'string', default: '', placeholder: 'example.com', description: 'Leave empty for all watched domains' },
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const state = this.getWorkflowStaticData('node') as { lastId?: string };
		const core = await makeCore(this);
		try {
			const r = (await core.pollEvents(state, {
				types: this.getNodeParameter('eventTypes', []) as string[],
				domain: (this.getNodeParameter('domain', '') as string) || undefined,
				firstRun: this.getMode() === 'manual' ? 'latest' : 'baseline',
			})) as { events: IDataObject[]; state: { lastId?: string } };
			state.lastId = r.state.lastId;
			if (!r.events.length) return null;
			return [this.helpers.returnJsonArray(r.events)];
		} catch (error) {
			throw new NodeOperationError(this.getNode(), (error as Error).message);
		}
	}
}
