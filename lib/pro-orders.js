/* =====================================================================
   lib/pro-orders.js: how a Pro order comes into being.

   An order is a single-use token (128 bits, hex) that lets one person start one
   report. Today an operator issues it by hand with scripts/pro-issue-token.js.
   Payment is out of scope: createOrderFromPayment() below is the one marked
   place a payment provider's webhook will call, and nothing calls it yet.
   docs/pro.md, "Payment hookup", says exactly what the webhook must do first.
   ===================================================================== */

'use strict';

const crypto = require('crypto');
const site = require('./site-config.js');

// The link a customer opens to start their report.
function startUrl(token) { return site.baseUrl + '/pro/start/' + token; }

async function issueOrder(store) {
  const order = await store.createOrder();
  return { order: order, url: startUrl(order.token) };
}

/* ---------------------------------------------------------------------
   PAYMENT HOOK. NOT WIRED TO ANY PROVIDER.

   A future webhook handler calls this after it has verified the provider's
   signature and confirmed the payment succeeded. It is idempotent per payment:
   the same paymentRef (the provider's own checkout or event id) always returns
   the same order, so a webhook that is delivered twice does not sell two
   reports. It returns the start link; sending that link to the buyer (a receipt
   email, or the provider's success page) is the webhook's job.

   Do not call this from any route that is reachable without a verified
   provider signature.
   --------------------------------------------------------------------- */
async function createOrderFromPayment(store, payment) {
  if (!payment || typeof payment.paymentRef !== 'string' || payment.paymentRef.length < 8) throw new Error('createOrderFromPayment needs the provider\'s payment reference');
  const key = 'pro:payment:' + crypto.createHash('sha256').update(payment.paymentRef).digest('hex');
  const existing = await store.adapter.get(key);
  if (existing) {
    const order = await store.getOrder(existing);
    if (order) return { order: order, url: startUrl(order.token), duplicate: true };
  }
  const issued = await issueOrder(store);
  const stored = await store.adapter.set(key, issued.order.token, { nx: true, ex: 90 * 86400 });
  if (!stored) {
    // A concurrent delivery of the same webhook won the race: hand back its order.
    const winner = await store.adapter.get(key);
    const order = winner && await store.getOrder(winner);
    if (order) return { order: order, url: startUrl(order.token), duplicate: true };
  }
  return { order: issued.order, url: issued.url, duplicate: false };
}

module.exports = { startUrl: startUrl, issueOrder: issueOrder, createOrderFromPayment: createOrderFromPayment };
