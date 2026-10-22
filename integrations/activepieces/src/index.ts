import { createPiece } from '@activepieces/pieces-framework';
import { citehoundAuth } from './lib/client';
import { compareDomains, generateLlmsTxt, generateRobotsTxt, generateSchema, getFixList, scanDomain, watchDomain } from './lib/actions';
import { newEvent } from './lib/triggers/new-event';

export const citehound = createPiece({
	displayName: 'Citehound',
	description: 'Scan a domain for AI readiness, compare sites, generate llms.txt, robots.txt and schema, and react to monitoring events. The score measures readiness. It does not measure whether any assistant names a brand.',
	auth: citehoundAuth,
	minimumSupportedRelease: '0.30.0',
	logoUrl: 'https://getcitehound.com/assets/brand/logo-mark.svg',
	authors: ['citehound'],
	actions: [scanDomain, compareDomains, generateLlmsTxt, generateRobotsTxt, generateSchema, watchDomain, getFixList],
	triggers: [newEvent],
});
