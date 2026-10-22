"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.citehound = void 0;
const pieces_framework_1 = require("@activepieces/pieces-framework");
const client_1 = require("./lib/client");
const actions_1 = require("./lib/actions");
const new_event_1 = require("./lib/triggers/new-event");
exports.citehound = (0, pieces_framework_1.createPiece)({
    displayName: 'Citehound',
    description: 'Scan a domain for AI readiness, compare sites, generate llms.txt, robots.txt and schema, and react to monitoring events. The score measures readiness. It does not measure whether any assistant names a brand.',
    auth: client_1.citehoundAuth,
    minimumSupportedRelease: '0.30.0',
    logoUrl: 'https://getcitehound.com/assets/brand/logo-mark.svg',
    authors: ['citehound'],
    actions: [actions_1.scanDomain, actions_1.compareDomains, actions_1.generateLlmsTxt, actions_1.generateRobotsTxt, actions_1.generateSchema, actions_1.watchDomain, actions_1.getFixList],
    triggers: [new_event_1.newEvent],
});
