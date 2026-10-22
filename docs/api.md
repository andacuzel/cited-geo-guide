# Citehound API v1

The public JSON API under `/v1`. One Vercel function (`api/v1/[...path].js`, the catch-all) holds an internal router (`lib/api-v1/index.js`). The function count is 12 of 12 on the Hobby plan: **do not add another function**; add routes to the router.

Read `docs/integrations/RULES.md` first. The description of the API is written once, in `lib/api-v1/openapi.js`; `scripts/generate-api-page.js` writes `/api` (the page) and `/openapi.yaml` from it, and `scripts/test-api-v1.js` checks that the router and the document agree.

## Files

| File | What it holds |
|---|---|
| `api/v1/[...path].js` | The function: hands the request to the router. |
| `lib/api-v1/index.js` | The router, authentication, every endpoint. |
| `lib/api-v1/keys.js` | Key creation, lookup (constant time), revoke, plan. Hashing with the pepper. |
| `lib/api-v1/limits.js` | Every limit and its counters (fixed windows that expire on their own). |
| `lib/api-v1/data.js` | Strict domain check, scan summary, benchmark, the file generators' input checks. |
| `lib/api-v1/mail.js` | The one email: the key. Transactional only. |
| `lib/api-v1/openapi.js` | The registry and the OpenAPI 3.1 document. |
| `scripts/generate-api-page.js` | Writes `api.html`, `openapi.yaml`, the sitemap and llms.txt lines. |
| `get-api-key.js` | The form on `/api`. |

Scoring is `lib/scanner.js` (`scanPage`), the summary is `lib/action-scan.js` (`summarize`), the generators are `lib/file-generators.js` and `lib/schema.js`. Nothing is scored twice, and every fetch of a typed domain goes through `lib/safe-fetch.js`.

## Defaults

| What | Value |
|---|---|
| Free key | 20 requests an hour, 100 a day (UTC) |
| Pro key | 200 requests an hour, 2000 a day (UTC) |
| One domain, all keys together | 4 scans an hour (scan, compare, crawlers and schema each count) |
| One network address | 120 authenticated requests an hour; 20 wrong keys an hour block it |
| Asking for keys | 5 an hour and 20 a day per network address; 3 an hour and 5 a day per email address (extra requests get the same 202 answer and no email) |
| Active keys per address | 3 |
| Scan deadline | 20 seconds |

## What is stored

- `api:k:<hash>`: the key record (hash, id, plan, status, created date, a hash of the address, the masked address). The key itself is never stored. When a key is revoked the address hash and the masked address are cleared and the record expires after 90 days (`REVOKED_TTL`), so a revoked key answers 403 for 90 days and 401 after.
- `api:id:<id>`, `api:em:<emailhash>`: the lookups for revoke and for the 3-key limit.
- `api:mk:<emailhash>`: the address, the date and the source, **only if marketing_optin was true**; it expires after 12 months (`MARKETING_TTL`).
- Monitoring (Pro keys only): `api:wl:<keyid>` the watchlist, `api:ae:<keyid>` the alert address (readable, only when the owner gave it; it must hash to the key's own address), `api:wd:all`, `api:wk:<domain>`, `api:ws:<domain>`, `api:hist:<domain>` and `api:ev:<domain>` (domains are public; snapshots and events expire after the retention period), `api:wh:<keyid>` the webhooks (the secret sealed), `api:wdl:<webhookid>` the delivery log (50 entries, 90 days), `api:wh:pend` the retries waiting, `api:am:` the once-a-day alert markers (a hash of the domain, 2 days), `api:lock:` short locks.
- Counters under `api:rl:`, `api:dom:`, `api:ip:`, `api:bad:` and `api:ck:`: hashed, with an expiry of at most two days.

## Giving a key the pro plan

There is no payment for it. After you agree a plan with someone, run this once from your own terminal (the token stays in your shell, never in the repository):

```bash
curl -X POST https://getcitehound.com/v1/admin/plan \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "person@example.com", "plan": "pro"}'
```

It sets the plan on every active key of that address. Use `"plan": "free"` to undo it. While `ADMIN_TOKEN` is unset or shorter than 16 characters the route is a 404.

## Monitoring (Pro keys)

`lib/api-v1/monitor.js` (watchlist, snapshots, the diff), `webhooks.js`, `alerts.js`, `monitor-routes.js` (routes and the scheduled job), `util.js`. All inside the one function. Tests: `scripts/test-api-monitoring.js`.

- **What a Pro key can do:** `POST|GET|DELETE /v1/watchlist`, `GET /v1/history`, `GET /v1/events`, `POST|GET /v1/webhooks`, `GET|DELETE /v1/webhooks/{id}`, `GET /v1/webhooks/{id}/deliveries`, `POST /v1/webhooks/{id}/test`. A free key gets `403 pro_required` on all of them.
- **Schedule:** a domain is scanned when it is added (the baseline, no events), then again when it is due, 7 days minus 12 hours after its last scan. A failed scan is retried the next day, three times, then weekly. A domain is scanned once for every key that watches it.
- **The scheduled job:** `GET /api/v1/cron/run`, called by Vercel Cron once a day (`17 5 * * *`, `vercel.json` `crons`). It takes the oldest due domains, at most `API_V1_CRON_BATCH` (6) per run, scans them in parallel, writes snapshots and events, sends alerts and webhooks, then retries the webhook deliveries that are due. It stops starting work after `API_V1_CRON_BUDGET_MS` (45 s; the function limit is 60 s). A lock keeps two runs from overlapping and a domain is locked while it is scanned. It answers only counts.
- **Events:** `score_dropped`, `score_improved` (a change of `API_V1_SCORE_DELTA` points or more, default 5), `crawler_blocked`, `crawler_unblocked`, `llms_txt_added`, `llms_txt_removed`, `check_failed`, `check_fixed`, `scan_failed`. The id is `evt_<UTC time>_<10 hex of a hash of domain, type, subject and snapshot>`: the same two snapshots always give the same ids, and ids sort in time order. Read them newest first with `since` (an id or a date), `domain`, `type`, `limit` (50, max 100) and `cursor`.
- **Alerts:** only `score_dropped`, `crawler_blocked` and `llms_txt_removed`, to the address given as `alert_email` when a domain is added. That address must hash to the key's own address, so nobody can point alerts at somebody else. One email per key and domain per UTC day. Every email has a one-click unsubscribe (signed link, also sent as `List-Unsubscribe` with `List-Unsubscribe-Post`).
- **Webhooks:** signed with `X-Citehound-Signature: v1=<HMAC-SHA-256 of "<timestamp>.<body>">`, with `X-Citehound-Timestamp`. Retries after 1 minute, 10 minutes and 1 hour (the job makes them, so on the daily job they are up to a day late). `API_V1_WEBHOOK_MAX_FAILS` (5) deliveries in a row that fail all their attempts disable the webhook. The secret is stored sealed (AES-256-GCM with a key derived from `API_KEY_PEPPER`): **changing the pepper makes every stored webhook secret unreadable** as well as every key. The POST goes through `lib/safe-fetch.js` (extended for POST: one request, no redirect, public addresses only, https and port 443 only).
- **Deleting:** removing the last watcher of a domain deletes its snapshots, events and schedule. Revoking a key deletes its watchlist, alert address, webhooks, delivery logs and pending retries. Snapshots and events expire after `API_V1_RETENTION_DAYS` (365).

The browser front end is `/watch` (`scripts/generate-watch-page.js` writes `watch.html`; `watch.js` is its script). It calls only `/v1/me`, `/v1/watchlist`, `/v1/events` and `/v1/history`, so its actions count toward the key's limits.

### What Vercel's plans allow (checked in the Vercel documentation on 22 Oct 2026)

| | Hobby | Pro |
|---|---|---|
| Cron jobs per project | 100 | 100 |
| Fastest schedule | once a day (a faster expression fails the deploy) | once a minute |
| Precision | within the hour (a job set for 05:17 runs between 05:00 and 05:59) | within the minute |
| Function duration | 300 s with Fluid Compute, which is on by default (this project keeps 60 s for the API) | up to 800 s |

A weekly job is allowed on Hobby, but one weekly run could not scan many domains inside the function limit, so the job runs **daily** and each domain is scanned only when it is due: the load is spread over the week. Capacity today: `API_V1_CRON_BATCH` domains a day, 6 by default, so about 42 domains a week; raise the batch (up to 20, about 140 a week) before changing the plan. Vercel does not retry a failed cron call, delivery is best effort and an invocation can occur twice: the job is built for that (locks, due times, ids that do not change). Cron jobs run on the production deployment only.

When the load outgrows that, the cheapest next step is **GitHub Actions** (free for a public repository): a scheduled workflow every hour that calls `GET https://getcitehound.com/api/v1/cron/run` with the `CRON_SECRET` as a Bearer token from a repository secret. Nothing in the code changes. Vercel Pro (cron every minute) is the other way, and comes with the paid plan anyway.

### What the owner must do for monitoring

1. In a terminal, run `openssl rand -hex 24`. Copy the result.
2. In the Vercel dashboard, open your project, then **Settings**, then **Environment Variables**. Add `CRON_SECRET`, paste the result, tick **Production** only, save.
3. Make sure `API_KEY_PEPPER`, `RESEND_API_KEY`, `PRO_MAIL_FROM` and `ADMIN_TOKEN` are set (see above).
4. Redeploy production. Vercel then lists the job under **Settings, Cron Jobs**.
5. Give a customer the Pro plan with the `curl` under "Giving a key the pro plan". There is no other way to get Pro on a key.
6. To test by hand without waiting for the cron, run in your terminal (the secret stays in your shell): `curl -H "Authorization: Bearer $CRON_SECRET" https://getcitehound.com/api/v1/cron/run`. The answer is a list of counts.
7. To change a limit, add the variable from `docs/env.md` and redeploy.

## What the owner must do before the API can issue keys

1. Open the Vercel dashboard, then your project, then **Settings**, then **Environment Variables**.
2. In a terminal, run `openssl rand -hex 32`. Copy the result.
3. Add a variable named `API_KEY_PEPPER`, paste the result as its value, tick **Production** only, and save. Do not tick Preview.
4. Check that `RESEND_API_KEY` and `PRO_MAIL_FROM` are already there (the Pro mails use them). Without them `POST /v1/keys` answers 503.
5. Redeploy the production deployment (Deployments, the three dots, Redeploy).
6. Test from your own terminal: `curl -X POST https://getcitehound.com/v1/keys -H "Content-Type: application/json" -d '{"email":"you@example.com"}'`. The answer says the key is on its way; the key arrives by email.
7. Never change `API_KEY_PEPPER` afterwards: every issued key would stop working.

## Not verified by tests

The test runs the router with an in-memory store, a fake scan and a fake mail provider. It does not prove: that Vercel routes `/v1/*` and `/api` as `vercel.json` says (check on the first deployment), that Resend delivers the key email, or the behaviour against real Redis. Run the steps above and the curl in step 6 once after deploying.
