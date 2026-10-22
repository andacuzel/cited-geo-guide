# Integration build: progress

Started 22 Oct 2026, 23:30 Istanbul. Target: about 12:00 Istanbul on 23 Oct 2026. Read `RULES.md` first. States: todo / in progress / done / blocked-needs-owner.
Resume rule: continue from the first line that is not "done". Never redo a done line.

## Decisions (recorded, not asked)

- **Where the matrix applies.** The pricing pages say the free scan gives the full 16-check report, the crawler matrix and a fix for each failed check, comparing two sites is free at /compare, and all 13 MCP tools are free with no key (the directory listing and /claude say so). So the **web scan, the free tools and the keyless MCP server keep their full output** (trimming them would make live claims false); the anonymous MCP keeps its existing per-domain and per-address limits. The matrix below applies to **API v1 keys** (which the pricing page does not describe), and to everything that uses a key (CLI with a key, /watch, the connectors).
- **Gate status code.** A plan gate answers `402` with `{"error": "plan_required", "required_plan", "plan", "message", "plans_url"}` (monitoring used `403 pro_required` before: changed, tests and docs with it). 429 messages for a free key name the plan limit and the upgrade link.
- **Free caps.** 10 requests an hour, 40 a day, and 5 scans a day per key (a scan = a request that fetches a site: scan, compare, crawlers, schema). Pro keeps 200/2000. Fix 400/4000. Beyond 600/6000.
- **Free output.** `/v1/scan`: score, pillars, crawler summary and the top 3 findings (`truncated: true`, the rest on Pro). Generators: llms.txt and robots.txt as a preview (the first lines, `preview: true`); schema: the organization type only. No compare, no watchlist, history, events or webhooks.
- **Beyond.** 15 watched domains, re-checked about every 2 days (the Hobby cron runs once a day), 730 days of history, CSV/JSON export. Monthly re-measurement stays manual and is described as manual.
- **GitHub Action.** Unchanged: it is keyless, one page, with its own limits.
- **Submissions.** Nothing is submitted anywhere. Integrations are built and tested locally with mocks.

## Checklist

- [x] Phase 0: TIERS.md (done)
- [x] Phase 1: plans module, API gates, limits, admin grant, fixes/recheck/export endpoints, tests (done: scripts/test-plans.js, 46 checks)
- [x] Phase 1: /api, openapi.yaml, /watch, CLI and plugin messages, plan comparison on /api (done)
- [x] Phase 1: deploy and verify (done: 81e211f live; /v1/fixes, /export, /compare answer 401 without a key; MCP 13 tools; action endpoint 200)
- [x] Phase 2.1: n8n community node (done: integrations/n8n, TypeScript compiled strict against the real n8n-workflow 2.16 types, 11 tests, ready-to-submit, NOT published)
- [ ] Phase 2.2: Make, Zapier, Pipedream, Activepieces, Raycast
- [ ] Phase 2.3: Looker Studio connector, Google Sheets
- [ ] Phase 2.4: Slack slash command, Chrome extension (only with budget)
- [ ] Phase 3: /integrations page (generated from JSON), footer and /api links
- [ ] Phase 4: deploy and verify
- [ ] Final report

## Log

- 23 Oct 00:xx Istanbul: Phase 1 built and tested locally (plans.js, 402 gates, free caps 10/40 and 5 scans a day, fixes, recheck, export, Beyond 15 domains and 2-day re-checks, /api plan table, openapi, /watch, CLI 38 tests, terms.html free caps updated). Bug found and fixed on the way: the JSON-LD flag of a snapshot was always false.
- 23 Oct: shared client integrations/shared/citehound-core.js (10 tests), scripts/sync-integrations.js (copies + README plan blocks), scripts/test-integrations.js (generic gate for every integrations/<name>/).
- 23 Oct: Zapier CLI app (integrations/zapier, 6 tests; the app definition validates with zapier-platform-schema 19.2.1 after the CLI's function conversion, run in a scratch dir) and Pipedream components (integrations/pipedream, 8 tests) built, not submitted.
- 23 Oct: Activepieces piece (integrations/activepieces, TypeScript strict against the real pieces-framework 0.32 types, 6 tests with a stub of the builders) built, not submitted.
