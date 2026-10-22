# Citehound for Activepieces

An Activepieces piece: seven actions (Scan a Domain, Compare Two Domains, Generate llms.txt, Generate robots.txt, Generate Schema, Watch a Domain, Get the Fix List) and a polling trigger (**New Monitoring Event**) over the Citehound API.

The score is a readiness score: crawler access and on-page signals. It does not measure whether any assistant names a brand. Nothing here promises a change in traffic, rankings, citations or revenue.

> **Status: built and tested, not submitted.** It is not part of Activepieces' piece library and no pull request has been opened there.

## Plans

<!-- PLANS:START -->
- **Free:** 10 requests an hour and 5 scans a day. The scan shows the score, the pillars, the crawlers and the first 3 findings; generated files are a preview; the schema generator gives the organization type. No compare, monitoring, fix list or export.
- **Pro:** 200 requests an hour. The full scan detail, compare, full generated files, every schema type, and monitoring (5 watched domains re-scanned about every 7 days, 365 days of history, events, alerts and webhooks).
- **Fix:** 400 requests an hour. Everything in Pro, plus the prioritized fix list with files to paste and the re-check.
- **Beyond:** 600 requests an hour. Everything in Fix, plus the export, 15 watched domains re-checked about every 2 days, and 730 days of history.

A key gets its plan from us. When a plan does not have something, the answer names the plans that do and links https://getcitehound.com/pricing. Applying changes where you give us access (Fix), and researched questions, edited pieces and the monthly re-measurement (Beyond), are done by hand and are not part of the API.
<!-- PLANS:END -->

The trigger, Compare, Watch a Domain and Get the Fix List need a paid plan (Pro for the first three, Fix for the last). On a free key they stop with the API's message, which names the plans and links the pricing page.

## Build and test

`npm install` then `npm run build` compiles `src/` to `dist/` (TypeScript, strict, against the real `@activepieces/pieces-framework` types). `npm test` runs the tests, which need no install: they run the compiled piece against a mocked API. The piece has no runtime dependencies besides the Activepieces framework; `src/lib/citehound-core.js` is a copy of `integrations/shared/citehound-core.js` made by `scripts/sync-integrations.js` in the repository.

## Use it (after it is submitted and merged)

1. In Activepieces, add a step, search for **Citehound**.
2. Connect it with your API key (a free one is sent by email at https://getcitehound.com/api).

## Licence

MIT. See `LICENSE`.
