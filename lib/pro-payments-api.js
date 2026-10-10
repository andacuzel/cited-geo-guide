/* =====================================================================
   lib/pro-payments-api.js: the payment webhook and the welcome page's lookup. Mounted into lib/pro-api.js, so it is the same function
   (api/pro.js) with the same fail-closed secret check and storage handling.

     POST /api/pro/webhook     the provider's signed event. Raw body, signature checked first (lib/pro-payments.js). 202 when handled
                               or deliberately ignored, 403 for a bad signature, 503 until PRO_WEBHOOK_SECRET is set.
     GET  /pro/welcome         the page the provider's success URL lands on: "Payment received, preparing your report link".
     POST /api/pro/welcome     { checkout }: waiting, ready (the start path, once) or taken.
   ===================================================================== */

'use strict';

const Payments = require('./pro-payments.js');
const CHECKOUT_ID = /^[A-Za-z0-9_-]{8,100}$/;

function make(ctx) {
  const H = ctx.H;

  async function webhook(req, res, deps) {
    const raw = await H.readRaw(req, Payments.MAX_BODY);
    if (!raw.ok) return H.sendJson(res, raw.reason === 'too_large' ? 413 : 400, { error: 'bad_body' });
    const store = ctx.storeOf(deps);
    const r = await Payments.processEvent(store, raw.raw, req.headers || {}, { env: (deps && deps.env) || process.env, fetch: deps && deps.fetch, now: deps && deps.now, adapter: deps && deps.adapter });
    // A caller that keeps sending unsigned or badly signed events is slowed down; a verified event never reaches this branch.
    if (r.status === 403 && await ctx.limited(store, req, 'webhookbad')) return H.sendJson(res, 429, { error: 'rate_limited' }, { 'Retry-After': '3600' });
    return H.sendJson(res, r.status, r.body);
  }

  async function welcome(req, res, deps) {
    const store = ctx.storeOf(deps);
    if (await ctx.limited(store, req, 'welcome')) return H.sendJson(res, 429, { error: 'rate_limited', message: ctx.MSG.limited }, { 'Retry-After': '600' });
    const body = await H.readBody(req, 1024);
    const id = String((body.ok && body.json && (body.json.checkout || body.json.checkout_id)) || '').trim();
    if (!CHECKOUT_ID.test(id)) return H.sendJson(res, 200, { state: 'waiting' }); // the same answer as for an id that has no order yet
    const r = await Payments.collect(store, id);
    if (r.state === 'ready') return H.sendJson(res, 200, { state: 'ready', path: '/pro/start/' + r.token });
    return H.sendJson(res, 200, { state: r.state });
  }

  async function welcomepage(req, res, deps) {
    return H.sendHtml(res, 200, require('./pro-report-page.js').welcomePage());
  }

  return { webhook: ['POST', webhook], welcome: ['POST', welcome], welcomepage: ['GET', welcomepage] };
}

module.exports = { make: make, CHECKOUT_ID: CHECKOUT_ID };
