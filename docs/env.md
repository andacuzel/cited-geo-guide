# Environment variables

Every variable the project reads, what it does, where it is set, whether it is required, and what happens when it is missing. Secrets
live only in Vercel (Project Settings, Environment Variables) and, for scripts on your own machine, in the gitignored `.env.local`. None
is ever in the repository, a log or a URL (`node scripts/check-secrets.js --history` checks the repository and its history).

**Where:** *Production* = the Vercel production environment. *Preview* = Vercel preview deployments (set only what a preview needs; none of the
keys below should be set there unless you test with them). *Local* = `.env.local` (`scripts/env-local.js` reads only a fixed list of names from it).
"Verified" in the last column means it was seen to work on the live site on 10 Oct 2026 through its behaviour (I cannot read the Vercel dashboard).

## Storage and Pro core

| Variable | What it does | Set in | Required | If missing | Status |
|---|---|---|---|---|---|
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) | The Redis (Upstash) that holds orders, jobs, the waitlist, feedback, counters and rate limits | Production (connected through the Vercel Marketplace), Local for `pro-admin`, `pro-issue-token`, `e2e-live`, `test-real-kv` | Yes for anything Pro | Every Pro action answers 503 with a plain message and the log names the variables. There is no silent fallback to memory on Vercel. | Verified |
| `PRO_HASH_SECRET` | HMAC secret for rate-limit caller ids and waitlist ids and removal links. 16 characters or more. | Production only (never Local: it would let a local script forge removal links) | Yes | Every Pro endpoint answers 503 ("not available"); the log names the variable. No fallback. | Verified |
| `WAITLIST_EMAIL_DAILY_CAP` | Most waitlist confirmation emails a day | Production | No | 200 | Default |

## Email (Resend)

| Variable | What it does | Set in | Required | If missing | Status |
|---|---|---|---|---|---|
| `RESEND_API_KEY` | Sends the waitlist confirmation, "Email me this report", and the backup copy of a bought link | Production (Local only to run `e2e-live` against a real send: it reads the deployed behaviour, not this key) | For email | Waitlist and Pro work without it; no confirmation is sent; the report page hides the email button; `/api/pro/email` answers 503 "not configured" | Verified |
| `PRO_MAIL_FROM` | The From address, `Citehound <reports@mail.getcitehound.com>` style | Production | With the key | Same as above | Verified |

Resend open and click tracking should be off for the sending domain (their docs say the default is off; confirm in the dashboard).

## Payments (not live)

| Variable | What it does | Set in | Required | If missing | Status |
|---|---|---|---|---|---|
| `PRO_WEBHOOK_SECRET` | Verifies Polar's signed webhook (`POST /api/pro/webhook`). 16 characters or more. | Production | Before payment goes live | The webhook answers 503 and creates nothing | Not set (by design) |
| `PRO_PAYMENT_PROVIDER` | Which adapter handles the webhook: `polar` (default) or `paddle` (a stub that refuses everything) | Production | No | `polar` | Default |
| `PRO_CHECKOUT_URL` | An https checkout link. When set, every Pro button goes there and the waitlist form is hidden. | Production | Only when Pro can be bought | The buttons go to the waitlist form | Not set (by design). **Do not set before the webhook is tested against Polar's sandbox.** |
| `PRO_PRICE_TEXT` | Replaces "Early access" where a price can show | Production | No | "Early access" | Not set |

## Citation questions and the citation check

All off unless set to exactly `1` and the key is present. Details, costs and terms: `docs/citation-check.md`. Order of switching on: `docs/launch-checklist.md`.

| Variable | What it does | Set in | Required | If missing | Status |
|---|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | Claude: writes the questions (no search), runs the check with its web search tool, the knowledge check. Set as a **secret** (sensitive) in Vercel. | Production; Local for `test-citation-live` | For anything citation | Nothing citation runs; reports have no citation section | **Not set in Vercel yet** (it is in `.env.local`) |
| `CITATION_ANTHROPIC_ENABLED` | Lets Claude be used at all | Production | With the key | Off | Off |
| `CITATION_QUESTIONS_ENABLED` | The profile and the 21 predicted questions | Production | To get the questions | Off | Off |
| `CITATION_TEST_ENABLED` | The live check on every provider that is ready | Production | To get the check | Off: questions only | Off |
| `PERPLEXITY_API_KEY` | Perplexity's key (secret) | Production, only if you decide to use it | For Perplexity | Perplexity cannot run | Not set in Vercel (in `.env.local`) |
| `CITATION_PERPLEXITY_ENABLED` | Perplexity joins the check. **Leave unset**: `docs/citation-check.md`, "Perplexity" | Production, later | No | Off | Off, by recommendation |
| `CITATION_KNOWLEDGE_ENABLED` | The model knowledge check (Claude, no search) | Production, later | No | Off | Off |
| `CITATION_KILL` | `1` stops every paid call (needs a redeploy). The instant switch is `node scripts/pro-admin.js kill on` | Production | No | Not killed | Unset |
| `CITATION_MODEL`, `CITATION_PERPLEXITY_MODEL` | The models | Production | No | `claude-haiku-5-5`, `perplexity/sonar` (both verified 11 Oct 2026) | Defaults |
| `CITATION_QUESTION_SAMPLE` | Questions asked per provider | Production | No | 10 (ceiling 18) | Default |
| `CITATION_MAX_CALLS`, `CITATION_MAX_COST_USD` | Per report: paid calls and cost | Production | No | 30 (ceiling 60) and $0.50 (ceiling $2) | Defaults |
| `CITATION_DAILY_BUDGET_USD`, `CITATION_MONTHLY_BUDGET_USD` | All reports together | Production | No | $2 a day, $4 a month (ceilings $50, $200) | Defaults |
| `CITATION_QUESTIONS_PROVIDER` | `gemini` selects the disabled fallback writer (needs `GEMINI_API_KEY`) | Never | No | Claude writes | Unset |
| `GEMINI_API_KEY` | Only the disabled question-writer fallback and the older crawl-summary endpoint | Production (summary) | No | The summary is written by rules | Not needed for citation |
| `ANTHROPIC_API_BASE`, `PERPLEXITY_API_BASE`, `GEMINI_API_BASE` | Point an adapter at a mock (tests only) | Never in production | No | The real APIs | Unset |

Removed and ignored now: `CITATION_ENABLED`, `CITATION_TEST_PROVIDER`, `CITATION_DAILY_CAP`, `CITATION_MONTHLY_QUERY_CAP`, `CITATION_QUESTIONS_DAILY_CAP`, `CITATION_TEST_MODEL`
(migration: `CITATION_ENABLED` and `CITATION_TEST_*` were never set in production; the two caps became the dollar budgets; `CITATION_TEST_PROVIDER=anthropic` is now `CITATION_ANTHROPIC_ENABLED=1`).

The local tracker (`scripts/citation-check.js`, `lib/citation/`) reads `GEMINI_API_KEY` for its plain runs and, for its other providers, `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`, `ANTHROPIC_MODEL`, `OPENAI_MODEL`, `PERPLEXITY_MODEL` and the matching `*_API_BASE`. Local only. It has no web search and no `--grounded` flag.

## Other site features

| Variable | What it does | Set in | Required | If missing | Status |
|---|---|---|---|---|---|
| `SUMMARY_MODEL` | Gemini model for the older crawl executive summary (`/api/crawl-summarize`, which uses `GEMINI_API_KEY`) | Production | No | Built-in default; with no `GEMINI_API_KEY` the summary is written by rules | Default |
| `MCP_LIMIT_PER_DOMAIN`, `MCP_LIMIT_GLOBAL` | MCP `scan_site` rate limits per domain and overall, per hour | Production | No | 6 and 300 | Default |
| `MCP_SCAN_DEADLINE_MS` | Time budget of an MCP scan | Production | No | The built-in value | Default |
| `SUBSCRIBE_WEBHOOK_URL` | Where the dark launch lead-magnet form would forward signups | Production, only if the launch config is ever turned on | No | `/api/subscribe` answers 503 `not_enabled` (it is dark anyway: `lib/launch-config.js`) | Unset |
| `REPORT_ACCESS_CODE` | Access code read by `scripts/encrypt-report.js` | Local only | No | The script asks for `--code-file` | Unset |
| `CITEHOUND_API` | Base URL for `scripts/scan-category.js` | Local | No | The site's own address from `site.config.json` | Unset |
| `VERCEL`, `NODE_ENV` | Set by the platform. Used to refuse the in-memory store on Vercel. | Platform | | | |
| `VERCEL_OIDC_TOKEN` | Written into `.env.local` by `vercel env pull`. Not read by the code. | Local | | | |
| `INTEGRITY_ROOT`, `SECRET_SCAN_ROOT`, `PRO_TEST_VERBOSE`, `SAMPLE_FILE` | Test and script switches | Local/CI only | | | |

## The address of the site

Never a variable and never typed into code: `site.config.json` holds the host and the contact address, and `scripts/set-domain.js` moves the site
in one command.

## What to check after changing any of these

`npm run gates` (also covers a missing-secret test), then `npm run smoke`. After changing a Vercel variable you must redeploy for it to take effect.
