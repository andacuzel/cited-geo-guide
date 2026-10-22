# Legal additions for the API

Not applied. `/terms` and `/privacy` are untouched by the API branch. These are the exact sentences to add when the API goes live, and the privacy impact. Terms and privacy are the owner's call and change together with `docs/api.md`.

## For /privacy: a section "API keys"

> **API keys.** If you ask for a Citehound API key, we use your email address once, to send you the key. We store a one-way hash of the key, a one-way hash of your email address, the masked address (for example "j***@example.com", shown by the API's account endpoint), the plan and the dates the key was created and, if it applies, revoked. We do not store the key itself or your address in readable form. If you tick the box for product updates, we also store your address, the date you ticked it and the source, apart from the key, and use it only to send you product updates; each message has a link that removes you. The key email is transactional and carries no marketing. To limit abuse we count requests with one-way hashes of the key, of the domain you ask about and of your network address; these counters delete themselves within two days. We do not log your key, your address or the requests you make. You can revoke a key at any time with the link in the key email, or ask us to delete your records at hey@getcitehound.com.

## For /terms: a section "API"

> **API.** The Citehound API is for scanning websites you have a reason to look at and for generating files. A free key allows 20 requests an hour and 100 a day, and the same domain is scanned at most 4 times an hour across all keys; these limits can change, and the current ones are on the API page. Keep your key private: you are responsible for requests made with it. Do not use the API to probe private networks, to overload a site, to resell access, to work around a limit, or to publish a key. We may revoke a key that is abused, without notice. The API returns a readiness score: crawler access and on-page signals. It does not measure whether any assistant names a brand.

(The outcome disclaimer sentence stays only where it is on `/terms`. Do not repeat it in the API section.)

## Privacy impact

- **New personal data:** an email address, handled in two ways. By default only hashes and a masked form are kept. With the optional box, the readable address is kept in a separate record (`api:mk:`) until the person asks to be removed.
- **New processor use:** the key email goes through Resend, already a processor for the Pro mails and the waitlist.
- **New identifiers:** hashed network addresses and hashed domains in short-lived counters (two days at most). They cannot be reversed without the pepper.
- **No cookies, no analytics, no logs of requests** are added.
- The scanned domains are public sites; the API fetches their robots.txt, llms.txt, sitemap declaration and homepage through the same guarded fetch as the web scan and never sends the key or any address to them.
- Retention for the optional marketing record has no end date yet: decide one (the waitlist uses 12 months) before launch.

## Monitoring (Pro keys): additions when the feature goes live (22 Oct 2026, not applied)

Exact sentences for `/privacy` ("API keys" section) and `/terms` ("The API" section). `/terms` and `/privacy` are untouched on branch `api-v1-monitoring`.

> **Privacy, monitoring (Pro keys).** If a Pro key watches a domain, we store the domain with the key's id, a snapshot of each scan (the score, the pillar scores, the ids of the checks that failed, the state of ten AI crawlers, and whether llms.txt and structured data were present) and the changes between scans, for 365 days. If you give an address for alerts, we store it in readable form, with the date, only to send those alerts: at most one email a day for each domain, each with a one-click link that stops them for that domain. If you add a webhook, we store its https address, the event types you chose and a delivery log of the last 50 deliveries (time, event, status, no content) for 90 days; the secret that signs deliveries is stored encrypted. When you revoke a key, or when the last key watching a domain stops, all of this is deleted. Domains you watch are public sites; we scan them the same way as any scan.

> **Terms, monitoring (Pro keys).** Monitoring is part of the Pro plan: a watchlist of up to 5 domains, scheduled re-scans about every 7 days, events, alert emails and webhooks. Webhook deliveries are retried up to three times and a webhook that keeps failing is disabled. Only add webhooks that you control, and keep the secret private. Alerts and events report changes in a readiness score and in crawler access; they do not say whether any assistant names a brand.

Privacy impact: new readable data is the alert address (only when given, matched to the key, deleted with the key) and the webhook address (customer-chosen; it can contain a token in its path, so treat as sensitive); new processors: none (Resend already sends the key email; webhook receivers are chosen by the customer). Webhook calls come from Vercel's network, so a receiver sees Vercel IP addresses.
