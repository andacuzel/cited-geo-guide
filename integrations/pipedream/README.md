# Citehound for Pipedream

Components for Pipedream: a source (**New Monitoring Event**) and five actions (Scan a Domain, Compare Two Domains, Generate llms.txt, robots.txt or Schema, Watch a Domain, Get the Fix List) over the Citehound API.

The score is a readiness score: crawler access and on-page signals. It does not measure whether any assistant names a brand. Nothing here promises a change in traffic, rankings, citations or revenue.

> **Status: built and tested, not submitted.** The components are not published to Pipedream's registry. They can be published to your own account with the Pipedream CLI, as the steps below say.

## Plans

<!-- PLANS:START -->
- **Free:** 10 requests an hour and 5 scans a day. The scan shows the score, the pillars, the crawlers and the first 3 findings; generated files are a preview; the schema generator gives the organization type. No compare, monitoring, fix list or export.
- **Pro:** 200 requests an hour. The full scan detail, compare, full generated files, every schema type, and monitoring (5 watched domains re-scanned about every 7 days, 365 days of history, events, alerts and webhooks).
- **Fix:** 400 requests an hour. Everything in Pro, plus the prioritized fix list with files to paste and the re-check.
- **Beyond:** 600 requests an hour. Everything in Fix, plus the export, 15 watched domains re-checked about every 2 days, and 730 days of history.

A key gets its plan from us. When a plan does not have something, the answer names the plans that do and links https://getcitehound.com/pricing. Applying changes where you give us access (Fix), and researched questions, edited pieces and the monthly re-measurement (Beyond), are done by hand and are not part of the API.
<!-- PLANS:END -->

The source, Compare, Watch a Domain and Get the Fix List need a paid plan (Pro for the first three, Fix for the last). On a free key they stop with the API's message, which names the plans and links the pricing page.

## Try it in your own Pipedream account

1. Install the Pipedream CLI (https://pipedream.com/docs/cli/install) and run `pd login`.
2. In this folder run `pd publish actions/scan-domain/scan-domain.mjs` (and the same for the other files you want).
3. In a workflow, add the action, connect the **Citehound** app and paste your API key (a free one is sent by email at https://getcitehound.com/api). The app is defined in `citehound.app.mjs` with the key as its `api_key` field.

## Test

`npm test` runs the tests against a mocked API, with no install and no key: they load every component, run each action with a fake `$`, and run the source's `deploy` and `run`.

## Licence

MIT. See `LICENSE`.
