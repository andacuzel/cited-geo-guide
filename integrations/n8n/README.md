# n8n-nodes-citehound

n8n community nodes for Citehound: scan a domain for AI **readiness**, compare sites, generate `llms.txt`, `robots.txt` and schema, read monitoring events, and start a workflow when something changes on a domain you watch.

The score is a readiness score: crawler access and on-page signals. It does not measure whether any assistant names a brand. Nothing here promises a change in traffic, rankings, citations or revenue.

> **Status: built and tested, not published.** It is not on npm and not submitted to n8n. Until it is published, the steps under "Install" do not work yet.

## Nodes

- **Citehound** (an action node): Scan a Domain, Compare Two Domains, Get Crawler Access, Get Benchmark, Generate Schema, Generate llms.txt, Generate robots.txt, Watch a Domain, List Watched Domains, Stop Watching a Domain, Get Score History, Get Events, Get Fix List, Re-Check After Fixes, Export History or Events, Get Plan and Limits.
- **Citehound Trigger** (a polling trigger): starts a workflow for each new monitoring event (score dropped, crawler blocked, llms.txt removed and the other types). It remembers the newest event it has seen, so an event starts a workflow once. Its first run does not send old events; a manual test run shows the latest few.

## Install (after it is published)

1. In n8n, open **Settings**, then **Community Nodes**, then **Install**.
2. Type `n8n-nodes-citehound` and confirm.
3. Add a **Citehound API** credential and paste your key. A free key is sent by email at https://getcitehound.com/api.

## What each plan gets

<!-- PLANS:START -->
- **Free:** 10 requests an hour and 5 scans a day. The scan shows the score, the pillars, the crawlers and the first 3 findings; generated files are a preview; the schema generator gives the organization type. No compare, monitoring, fix list or export.
- **Pro:** 200 requests an hour. The full scan detail, compare, full generated files, every schema type, and monitoring (5 watched domains re-scanned about every 7 days, 365 days of history, events, alerts and webhooks).
- **Fix:** 400 requests an hour. Everything in Pro, plus the prioritized fix list with files to paste and the re-check.
- **Beyond:** 600 requests an hour. Everything in Fix, plus the export, 15 watched domains re-checked about every 2 days, and 730 days of history.

A key gets its plan from us. When a plan does not have something, the answer names the plans that do and links https://getcitehound.com/pricing. Applying changes where you give us access (Fix), and researched questions, edited pieces and the monthly re-measurement (Beyond), are done by hand and are not part of the API.
<!-- PLANS:END -->

The trigger and the monitoring operations need Pro, Fix or Beyond. On a free key they stop with a message that names the plans and links the pricing page.

## Build and test

`npm install` then `npm run build` compiles `nodes/` and `credentials/` to `dist/` (TypeScript, strict, against the real `n8n-workflow` types). `npm test` runs the tests, which need no install: they run the compiled nodes against a mocked API. The nodes have no runtime dependencies; `citehound-core.js` is a copy of `integrations/shared/citehound-core.js` made by `scripts/sync-integrations.js` in the repository.

## Licence

MIT. See `LICENSE`.
