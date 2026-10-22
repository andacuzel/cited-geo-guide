# Citehound for Raycast

A Raycast extension with four commands: **Scan a Domain**, **Compare Two Domains**, **Generate robots.txt or llms.txt** (copies the file) and **Monitoring Events**.

The score is a readiness score: crawler access and on-page signals. It does not measure whether any assistant names a brand. Nothing here promises a change in traffic, rankings, citations or revenue.

> **Status: built and tested, not submitted.** It is not in the Raycast Store. It can be run from this folder in development mode, as the steps below say.

## Plans

<!-- PLANS:START -->
- **Free:** 10 requests an hour and 5 scans a day. The scan shows the score, the pillars, the crawlers and the first 3 findings; generated files are a preview; the schema generator gives the organization type. No compare, monitoring, fix list or export.
- **Pro:** 200 requests an hour. The full scan detail, compare, full generated files, every schema type, and monitoring (5 watched domains re-scanned about every 7 days, 365 days of history, events, alerts and webhooks).
- **Fix:** 400 requests an hour. Everything in Pro, plus the prioritized fix list with files to paste and the re-check.
- **Beyond:** 600 requests an hour. Everything in Fix, plus the export, 15 watched domains re-checked about every 2 days, and 730 days of history.

A key gets its plan from us. When a plan does not have something, the answer names the plans that do and links https://getcitehound.com/pricing. Applying changes where you give us access (Fix), and researched questions, edited pieces and the monthly re-measurement (Beyond), are done by hand and are not part of the API.
<!-- PLANS:END -->

Compare and Monitoring Events need a paid plan (Pro, Fix or Beyond). On a free key they show the API's message, which names the plans and links the pricing page.

## Try it (development mode)

1. Install Raycast and Node.js 18 or newer.
2. In this folder run `npm install` and `npm run dev`. The commands appear in Raycast.
3. Open a command; Raycast asks for the **API Key** preference once (a free key is sent by email at https://getcitehound.com/api).

## Tests

`npm test` runs the tests of the view code and the manifest, with no install and no key. The command files (`src/*.tsx`) are type-checked against `@raycast/api` with `tsc`; `ray lint` and the Store review are not run here.

## Licence

MIT. See `LICENSE`.
