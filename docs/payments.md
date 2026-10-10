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

Polar's `order.refunded` event is "sent when an order is fully or partially refunded" (its OpenAPI schema, read 10 Oct 2026), and the order inside it says which:
status `refunded` is a full refund, `partially_refunded` a partial one. A `refund.created` / `refund.updated` event carries the refund's amount but not the
order's total, so it cannot tell the two apart.

| What arrives | Unused link | Used link (report already started) |
|---|---|---|
| `order.refunded`, status `refunded` (full) | **Cancelled**: the start page becomes the generic "not available" page, the welcome page stops handing it out. Counted as `payments_refunded`. | Nothing changes (the report stays its 90 days). The order is flagged `refund_after_use` for your review. |
| `order.refunded`, status `partially_refunded` | **Stays valid.** The order is flagged `partial_refund` for your review. | Flagged `partial_refund`. |
| `refund.created` / `refund.updated`, status `succeeded` | Stays valid and is flagged `refund_reported` for your review (the size is unknown). A full refund also sends `order.refunded`, which then cancels the link. | Flagged. |
| a refund with another status (pending, failed, canceled) | Ignored | Ignored |

So **subscribe the endpoint to `order.refunded` as well as the refund events**: without it a full refund is only flagged, not cancelled.

A flagged order shows in `node scripts/pro-admin.js list` as `CHECK: partial_refund` (or `refund_reported`, `refund_after_use`) and `health` counts it
(counter `payments_review`). You decide in the Polar dashboard what happened and, if the link should stop working after all, run
`node scripts/pro-admin.js revoke <prefix>`; then `node scripts/pro-admin.js clear-review <prefix>`.

### Chargebacks (manual)

Polar's schema has a `dispute` object on a refund and no `dispute.*` webhook, so how a chargeback reaches the webhook is **UNVERIFIED**. Do not rely on it. The process:

1. **Where you check:** the Polar dashboard (orders and the payouts or disputes view; the menu names are not in the pages I read, so look for "Disputes" or the order's
   status) and the notification emails Polar sends to the account address. Check weekly while Pro is on sale, and whenever a payout looks short.
2. **If an order is disputed:**
   - An **unused** link: `node scripts/pro-admin.js revoke <prefix>` (find the prefix with `list`; the Polar order has the buyer's email, the list does not show it, so match
     by date and label, or by the order's created time). The link then shows the generic "not available" page.
   - A **used** link: the report already exists and cannot be revoked by this script. To remove it sooner than 90 days see "Deleting a report" in `docs/pro.md`. Whether to remove it is
     your decision with the dispute outcome.
3. **What is automated:** if Polar does send a succeeded refund event for it, an unused link is flagged (partial) or cancelled (full); nothing else is automatic. Nothing in the code
   contests a dispute or contacts the buyer.

### /privacy wording for when payment goes live (drafted, not published)

Add to the "Pro reports" section of `privacy.html` in the same deploy that sets `PRO_CHECKOUT_URL`:

> Paying for Pro (once Pro can be bought): the payment is made on a checkout page run by Polar, which processes the payment and acts as the seller of record for it. Polar
> collects the details it needs to take payment, such as card details, billing address and tax details, and passes your name and email address to Citehound so we can give you
> your report link. Citehound never sees your card details. We keep your name and email address on the order record for the same period as the report, use them only to deliver
> the report link (on the page you land on after paying, and by email as a backup) and for support, and do not share them. Polar's own privacy notice applies to what Polar
> collects. A refund before you use your link cancels it.

**Verify before publishing:** that Polar is the merchant of record for your account (its docs say so; confirm in the dashboard), what its privacy notice says about the data it keeps,
and the retention of the buyer's name and email in the order record (90 days after use, 30 days unused; check that matches what you want to say). Add Polar to the list of providers
on the page.

### Questions to answer before `PRO_CHECKOUT_URL` is set (for you and a lawyer)

The terms and refund drafts are no longer in this repository (they are in your gitignored `local/legal-drafts/`). Their open decisions, in one list:

1. Price and currency; who the seller is (your legal name, address, registration number) and where Polar fits as merchant of record.
2. Refund policy before use (the draft says 30 days), after the report is made (none, 14 days, or when "plainly unusable"), and for partial refunds (the code keeps the link valid; do you refund part of a payment at all?).
3. Withdrawal rights for digital goods in the countries you sell to (some lose the right once the service starts; the buyer may need to agree to that at checkout).
4. How long an unused link lasts (the code: 30 days), how many times a failed scan gives the link back (3), and whether a lost link can be re-sent.
5. Whether the right to scan a site the buyer does not own needs a line in the terms (the buyer states they may ask for the scan).
6. Acceptable use, abuse and resale of reports; limitation of liability; governing law and courts; the data-protection contact.
7. What the terms say about citation questions: they are written, not tested. Add the live test only if you switch it on.
8. Tax: Polar handles it as merchant of record; confirm for your countries.
9. Whether to publish the terms and refund policy at their own addresses and link them from the checkout and `/pro` (nothing links to them now).

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
5. (doc for the event names) Subscribe the endpoint to: `order.paid`, `order.refunded`, `refund.created`, `refund.updated`. `order.refunded` is the one that cancels a link after a full refund. The others are acknowledged and ignored if you tick them.
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
`pro:checkout:<hash of checkout id>` (30 minutes), `pro:checkout-taken:<hash>` (1 day). Counters: `orders_paid`, `payments_refunded`, `payments_review`, `webhook_rejected`, `webhook_errors`, `start_link_emails`, `mail_failed`.
Privacy: the buyer's name and email sit on the order record only; update `/privacy` ("Pro reports") when payment goes live to say that Polar processes the payment and sends
us the buyer's name and email, and that the link is also emailed.
