"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.citehoundAuth = void 0;
exports.core = core;
exports.run = run;
const pieces_framework_1 = require("@activepieces/pieces-framework");
// The shared client (citehound-core.js, a copy of integrations/shared). Activepieces runs on Node, so its own fetch is used.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createCore } = require('./citehound-core.js');
exports.citehoundAuth = pieces_framework_1.PieceAuth.SecretText({
    displayName: 'API Key',
    description: 'A key that starts with chk_. A free key is sent by email at https://getcitehound.com/api. Pro, Fix and Beyond keys add monitoring and more.',
    required: true,
});
const keyOf = (a) => (typeof a === 'string' ? a : (a && a.secret_text) || '');
// The client for one key. fetchImpl is for tests.
function core(auth, fetchImpl) {
    return createCore({ apiKey: keyOf(auth), fetch: fetchImpl || globalThis.fetch, platform: 'activepieces', version: '0.1.0' });
}
// A Citehound error becomes a plain Error with the API's own message (it names the plans, never the key).
async function run(auth, op, params, fetchImpl) {
    try {
        return await core(auth, fetchImpl).run(op, params);
    }
    catch (e) {
        throw new Error(e.message);
    }
}
