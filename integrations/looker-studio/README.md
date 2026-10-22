# Citehound for Looker Studio

A community connector (Google Apps Script) with three data sources: **Scan** (one row per domain), **History** (one row per stored scan of a watched domain) and **Events** (one row per monitoring event). Chart the readiness score over time, the crawlers blocked, or what changed.

The score is a readiness score: crawler access and on-page signals. It does not measure whether any assistant names a brand. Nothing here promises a change in traffic, rankings, citations or revenue.

> **Status: built and tested, not published.** It is not in the Looker Studio connector gallery and not submitted. It can be used by anyone you share it with, by link, as the steps below say.

## Plans

<!-- PLANS:START -->
- **Free:** 10 requests an hour and 5 scans a day. The scan shows the score, the pillars, the crawlers and the first 3 findings; generated files are a preview; the schema generator gives the organization type. No compare, monitoring, fix list or export.
- **Pro:** 200 requests an hour. The full scan detail, compare, full generated files, every schema type, and monitoring (5 watched domains re-scanned about every 7 days, 365 days of history, events, alerts and webhooks).
- **Fix:** 400 requests an hour. Everything in Pro, plus the prioritized fix list with files to paste and the re-check.
- **Beyond:** 600 requests an hour. Everything in Fix, plus the export, 15 watched domains re-checked about every 2 days, and 730 days of history.

A key gets its plan from us. When a plan does not have something, the answer names the plans that do and links https://getcitehound.com/pricing. Applying changes where you give us access (Fix), and researched questions, edited pieces and the monthly re-measurement (Beyond), are done by hand and are not part of the API.
<!-- PLANS:END -->

History and Events need a paid plan (Pro, Fix or Beyond) and a domain on the key's watchlist. Scan works on every plan (a free key shows the first three findings and may scan 5 sites a day). Answers are cached for 6 hours, so refreshing a dashboard does not scan a site again. On a free key History and Events show the API's message, which names the plans and links the pricing page.

## Install by link (the owner does this once)

1. Open https://script.google.com and choose **New project**. Name it **Citehound**.
2. Replace the content of `Code.gs` with the file `Code.gs` from this folder. In **Project Settings**, tick **Show "appsscript.json" manifest file in editor**, open `appsscript.json` and replace its content with the file from this folder.
3. Choose **Deploy**, then **New deployment**, type **Add-on** is not used: pick **Looker Studio** (a community connector) if offered, or choose **Deploy**, **Test deployments** and copy the **Deployment ID**.
4. Share the connector by link: `https://lookerstudio.google.com/datasources/create?connectorId=<Deployment ID>`. Opening it asks the person for their API key (a free one is sent by email at https://getcitehound.com/api), then for the data source and domains.

## Tests

`node --test test/*.test.js` runs `Code.gs` in a sandbox with stand-ins for Apps Script and Looker Studio, a mocked API and no key. It covers authentication, the configuration, the fields of each source, the rows, the cache, and the error messages (a plan gate, a limit, a wrong key, no domain). It is not run inside Looker Studio.

## Licence

MIT. See `LICENSE`.
