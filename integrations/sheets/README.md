# Citehound for Google Sheets

A script for a Google Sheet: a **Citehound** menu that scans the domains in column A and fills in the score, the three pillar scores, the crawler counts, the first fix and the scan date next to each one.

The score is a readiness score: crawler access and on-page signals. It does not measure whether any assistant names a brand. Nothing here promises a change in traffic, rankings, citations or revenue.

> **Status: built and tested, not published.** It is not in the Google Workspace Marketplace. It is a set of files to paste into a sheet's own script editor, as the steps below say.

## Plans

<!-- PLANS:START -->
- **Free:** 10 requests an hour and 5 scans a day. The scan shows the score, the pillars, the crawlers and the first 3 findings; generated files are a preview; the schema generator gives the organization type. No compare, monitoring, fix list or export.
- **Pro:** 200 requests an hour. The full scan detail, compare, full generated files, every schema type, and monitoring (5 watched domains re-scanned about every 7 days, 365 days of history, events, alerts and webhooks).
- **Fix:** 400 requests an hour. Everything in Pro, plus the prioritized fix list with files to paste and the re-check.
- **Beyond:** 600 requests an hour. Everything in Fix, plus the export, 15 watched domains re-checked about every 2 days, and 730 days of history.

A key gets its plan from us. When a plan does not have something, the answer names the plans that do and links https://getcitehound.com/pricing. Applying changes where you give us access (Fix), and researched questions, edited pieces and the monthly re-measurement (Beyond), are done by hand and are not part of the API.
<!-- PLANS:END -->

The script reads your plan from the API before each run. On a free key it scans at most 5 sites a run (the free daily cap) and says which rows are waiting; it stops at the first limit or plan message and writes that message in the Status column. At most 25 domains are scanned in one run on any plan.

## Set it up

1. Make a new Google Sheet. Put `Domain` in A1 and one domain in each row of column A from A2 down.
2. Choose **Extensions**, then **Apps Script**. Replace the content of `Code.gs` with the file `Code.gs` from this folder.
3. Click the gear (**Project Settings**), tick **Show "appsscript.json" manifest file in editor**, go back to the editor and replace the content of `appsscript.json` with the file from this folder. Save.
4. Reload the sheet. A **Citehound** menu appears. Choose **Citehound**, then **Set API key**, and paste your key (a free one is sent by email at https://getcitehound.com/api). Google asks you once to allow the script.
5. Choose **Citehound**, then **Scan the domains in column A**.

The key is kept in your Google account's script properties for this script. It is not written to a cell or a note.

## Tests

`node --test test/*.test.js` runs `Code.gs` in a sandbox with stand-ins for Apps Script and a mocked API, with no key. It is not run inside Google Sheets.

## Licence

MIT. See `LICENSE`.
