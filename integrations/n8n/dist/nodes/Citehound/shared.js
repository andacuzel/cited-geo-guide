"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeCore = makeCore;
// The shared client (citehound-core.js, copied from integrations/shared). It needs a fetch-like function: this one is made from n8n's own HTTP helper.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createCore } = require('./citehound-core.js');
async function makeCore(ctx) {
    const credentials = await ctx.getCredentials('citehoundApi');
    const fetchLike = async (url, init) => {
        const res = (await ctx.helpers.httpRequest({
            method: init.method,
            url,
            headers: init.headers,
            body: init.body,
            json: false,
            returnFullResponse: true,
            ignoreHttpStatusErrors: true,
        }));
        const text = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
        const headers = res.headers || {};
        return { status: res.statusCode, headers: { get: (k) => { var _a; return (_a = headers[k.toLowerCase()]) !== null && _a !== void 0 ? _a : null; } }, text: async () => text };
    };
    return createCore({ apiKey: String(credentials.apiKey || ''), fetch: fetchLike, platform: 'n8n', version: '0.1.0' });
}
