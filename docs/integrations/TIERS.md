# Tier matrix (what each plan gets)

Source of truth in code: `lib/plans.js`. Prices are in `content/pricing.json` and are not changed here.

Plans: **Free** (the scan, the free tools, a free API key), **Pro** ($39 a month), **Fix** (from $299, includes 3 months of Pro), **Beyond** ($490 a month, includes Pro). A key's plan is set by us (`POST /v1/admin/plan`; payments run in the background).

| | Free | Pro | Fix | Beyond |
|---|---|---|---|---|
| Web scan, free tools, keyless MCP server | full | full | full | full |
| API requests per hour / day | 10 / 40 | 200 / 2000 | 400 / 4000 | 600 / 6000 |
| API scans (fetching a site) per day | 5 | no extra cap | no extra cap | no extra cap |
| `/v1/scan` | score, pillars, crawlers, top 3 findings | full detail | full | full |
| `/v1/compare` | no | yes | yes | yes |
| `/v1/crawlers`, `/v1/benchmark` | yes | yes | yes | yes |
| llms.txt, robots.txt generators | preview | full | full | full |
| Schema generator | organization only | all types | all types | all types |
| Watchlist, history, events, webhooks, alerts | no | 5 domains, weekly, 365 days | 5 domains, weekly, 365 days | 15 domains, about every 2 days, 730 days |
| Prioritized fix list with ready-to-paste files, re-check after a fix (`/v1/fixes`) | no | no | yes | yes |
| History and events export (`/v1/export`) | no | no | no | yes |
| Done by hand, not by the API | | | Applying changes where we have access; 14 days of corrections | Researched questions, 4 edited pieces a month, monthly re-measurement |

Existing pricing-page facts this respects: the free scan reads one page with 16 checks, the crawler matrix and a fix for each failed check; Pro is a 25-page report, a weekly homepage re-scan with email alerts for up to 5 domains and a dated citation sample; Fix applies changes by hand where given access; Beyond is questions, edited pieces and a monthly re-measurement done by hand.
