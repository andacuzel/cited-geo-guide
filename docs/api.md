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

- `api:k:<hash>`: the key record (hash, id, plan, status, created date, a hash of the address, the masked address). The key itself is never stored.
- `api:id:<id>`, `api:em:<emailhash>`: the lookups for revoke and for the 3-key limit.
- `api:mk:<emailhash>`: the address, the date and the source, **only if marketing_optin was true**.
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
