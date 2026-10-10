# Payments: how a purchase becomes a report link

Nothing here is switched on until you set the variables in "Settings". Nothing was tested against Polar itself: the tests use events signed
in `scripts/test-payments.js`. Where a detail was read from Polar's documentation it says so; where it was not, it says **UNVERIFIED**.

## The flow

1. The buyer clicks a Pro button. With `PRO_CHECKOUT_URL` set, it goes to your **Polar checkout link** (`pro-cta.js`).
2. The buyer pays on Polar's hosted checkout. Polar redirects to your **success URL**, `https://getcitehound.com/pro/welcome?checkout_id={CHECKOUT_ID}`.
3. Polar calls `POST https://getcitehound.com/api/pro/webhook` with a signed `order.paid` event. `lib/pro-payments.js` verifies the signature,
   creates one order (source "paid", valid 30 days) for that Polar order id, keeps the buyer's name and email on the order (only to prefill the
   start form), remembers `checkout id -> link` for 30 minutes, and emails the same link through Resend if Resend is configured.
4. `/pro/welcome` asks the server every two seconds. When step 3 has happened, the server hands the start path over **once** and the page goes to
   `/pro/start/<token>`. Opened a second time, or after 30 minutes, it says the link was already shown and points to the email and to support.
5. On the start form the name and email are filled in (editable). The consent box stays unticked. From here it is the same flow as any link.

If the buyer closes the page early, the email has the link. If the webhook is late, the page keeps asking for about 90 seconds and then explains.

## Refunds

An `order.refunded` event with status `refunded`, or a `refund.created` / `refund.updated` event with status `succeeded`, cancels the link **if nobody
has used it yet**: its start page becomes the generic "not available" page and the welcome page stops handing it out. After the report has been
started nothing changes (the report stays for its 90 days). A `partially_refunded` order does not cancel the link; a succeeded refund event does, and
I could not tell a partial refund from a full one in those events, so a partial refund of an unused link cancels it. Chargebacks: Polar's schema has
a `dispute` object on a refund and no `dispute.*` webhook, so how a chargeback arrives is **UNVERIFIED**; if it comes as a succeeded refund it is handled.

## Settings (Vercel project, production)

| Variable | Value |
|---|---|
| `PRO_WEBHOOK_SECRET` | The `whsec_...` secret Polar shows for the webhook endpoint. At least 16 characters. Without it the endpoint answers 503 and creates nothing. |
| `PRO_CHECKOUT_URL` | The https address of the Polar checkout link. Setting it turns the Pro buttons into purchase buttons and hides the waitlist form. |
| `PRO_PRICE_TEXT` | Optional, for example `$49 one time`. Shown where "Early access" stands. |
| `PRO_PAYMENT_PROVIDER` | Optional, default `polar`. `paddle` is a stub that refuses everything. |
| `RESEND_API_KEY`, `PRO_MAIL_FROM` | Already set. Needed for the backup email. |

Do not set `PRO_CHECKOUT_URL` before the webhook works and you have bought something yourself.

## What you do in the Polar dashboard

Steps marked (doc) are from Polar's documentation, read 11 Oct 2026. Menu names beyond those are **UNVERIFIED**: Polar's pages did not give them.

1. (UNVERIFIED) Make an organization if you have none, and finish the payout and tax settings Polar asks for. Start in the **sandbox** (doc: Polar offers one for
   test purchases and refunds that trigger webhooks without cost); production needs its own product, link, endpoint and secret.
2. (UNVERIFIED menu) Create a **product**: one-time purchase (not a subscription), named for example "Citehound Pro report", with your price. Decide the price and the
   currency yourself.
3. (doc) Open the **Checkout Links** page, click **New Link**, choose the product. In **Success URL** put
   `https://getcitehound.com/pro/welcome?checkout_id={CHECKOUT_ID}` (doc: Polar replaces `{CHECKOUT_ID}` with the checkout session id). Save, copy the link's URL: that is `PRO_CHECKOUT_URL`.
4. (doc) In the organization settings click **Add Endpoint**. URL: `https://getcitehound.com/api/pro/webhook`. Format: leave on **Raw**. Secret: let Polar generate one (doc: secrets
   created on or after 8 Sep 2026 follow Standard Webhooks; older ones use Polar's HMAC, and the code accepts both). Copy the secret: that is `PRO_WEBHOOK_SECRET`.
5. (doc for the event names) Subscribe the endpoint to: `order.paid`, `order.refunded`, `refund.created`, `refund.updated`. The others are acknowledged and ignored if you tick them.
6. Put the two variables in Vercel, redeploy.
7. In the sandbox, make a test purchase with the checkout link. Expect: the welcome page redirects to a start form with your name and email filled in, and the email arrives.
   In Polar's delivery log for the endpoint the webhook should show 202. If it shows 403 the secret is wrong; 503 means `PRO_WEBHOOK_SECRET` is not set on the deployment.
8. Refund the sandbox order before using its link and check that the link then shows "This link is not available".
9. Repeat 2 to 6 in production with a real (small) purchase of your own.

## Things that are UNVERIFIED and worth one look the first time

- Whether Vercel hands the function the raw request body unchanged. The code reads the stream before touching `req.body` (which on Vercel parses lazily); if the first
  real event is rejected with 403 while the secret is right, this is the first suspect (the code then falls back to re-serializing a parsed body, which matches a compact sender only).
- The timestamp tolerance (5 minutes) is the usual library default, not a Polar figure.
- That Polar sends `billing_reason` "purchase" for a one-time order (the schema lists it as one value; the code ignores other reasons).
- How chargebacks reach the webhook (above).
- Polar's own terms, fees, tax handling (merchant of record) and payout rules: read them; nothing here depends on them.

## Where things live

`lib/pro-payments.js` (adapters, `processEvent`, `collect`), `lib/pro-payments-api.js` (the three routes), `app/pro-welcome.js`, `lib/pro-mail.js` `sendStartLink`,
`lib/pro-store.js` `setOrderBuyer` / `expireOrder`. Keys: `pro:wh:<hash of event id>` (7 days, replay guard), `pro:payment:<hash of order id>` (the order, 90 days),
`pro:checkout:<hash of checkout id>` (30 minutes), `pro:checkout-taken:<hash>` (1 day). Counters: `orders_paid`, `payments_refunded`, `webhook_rejected`, `start_link_emails`.
Privacy: the buyer's name and email sit on the order record only; update `/privacy` ("Pro reports") when payment goes live to say that Polar processes the payment and sends
us the buyer's name and email, and that the link is also emailed.
