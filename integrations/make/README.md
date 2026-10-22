# Citehound for Make

The files of a Make custom app: one connection (an API key) and ten modules: Scan a Domain, Compare Two Domains, Get Crawler Access, Generate llms.txt, Generate robots.txt, Generate Schema, Watch a Domain, List Watched Domains, Get the Fix List (all actions or searches) and a trigger, **Watch Monitoring Events**.

The score is a readiness score: crawler access and on-page signals. It does not measure whether any assistant names a brand. Nothing here promises a change in traffic, rankings, citations or revenue.

> **Status: built and checked against the API's operation table, not imported into Make and not submitted.** There is no Make account in this repository, so the files have not been opened in Make's Apps Editor. They are written in the layout of that editor (`.imljson`); if the editor reports a difference, it will say which file.

## Plans

<!-- PLANS:START -->
- **Free:** 10 requests an hour and 5 scans a day. The scan shows the score, the pillars, the crawlers and the first 3 findings; generated files are a preview; the schema generator gives the organization type. No compare, monitoring, fix list or export.
- **Pro:** 200 requests an hour. The full scan detail, compare, full generated files, every schema type, and monitoring (5 watched domains re-scanned about every 7 days, 365 days of history, events, alerts and webhooks).
- **Fix:** 400 requests an hour. Everything in Pro, plus the prioritized fix list with files to paste and the re-check.
- **Beyond:** 600 requests an hour. Everything in Fix, plus the export, 15 watched domains re-checked about every 2 days, and 730 days of history.

A key gets its plan from us. When a plan does not have something, the answer names the plans that do and links https://getcitehound.com/pricing. Applying changes where you give us access (Fix), and researched questions, edited pieces and the monthly re-measurement (Beyond), are done by hand and are not part of the API.
<!-- PLANS:END -->

Compare, Watch a Domain, List Watched Domains and the trigger need a paid plan (Pro, Fix or Beyond); Get the Fix List needs Fix or Beyond. On a free key they stop with the API's message, which names the plans and links the pricing page.

## Put it in your own Make account

1. In Make, open **Custom apps** (in the left menu or the profile menu) and create an app called **Citehound**.
2. Install the Make Apps Editor extension for Visual Studio Code, sign in to Make from it, and open this folder as the app's local copy. Or paste each file into the app's editor: `general/base.imljson` is the base, `connections/citehound/` the connection, and each folder in `modules/` is one module.
3. Create a connection with your API key (a free one is sent by email at https://getcitehound.com/api) and run a module.

## Files and checks

The files are generated from one table: `node scripts/generate-make-app.js` writes them and `--check` fails if one is out of date (it is a gate). `npm test`-style checks (`node --test integrations/make/test/*.test.js`) confirm that every module calls a path, method and field that the shared client knows, that the trigger de-duplicates by event id, and that no key is in any file.

## Licence

MIT. See `LICENSE`.
