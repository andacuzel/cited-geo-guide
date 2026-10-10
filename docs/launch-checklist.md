# Launch checklist (Monday 12 October 2026)

What must be true on launch day, who owns it, how to check it, and where it stands. Status is as of Sunday 11 October 2026, after commit `91aec18`
(gates 56 of 56, `npm run smoke` 64 of 64, `node scripts/e2e-live.js` 35 of 35, `npm run test:real-kv` 76 of 76, all run today).
"Me" means Claude Code; "You" means the owner. A status of "done" means a check passed today, not that nothing can change.

Run the whole automated set with: `npm run gates && npm run smoke`, then `node scripts/e2e-live.js` (sends two real emails to hey@getcitehound.com and removes its own data) and `node scripts/pro-admin.js health`.

## What is live on Monday

| # | Item | Owner | How to verify | Status |
|---|---|---|---|---|
| 1 | The free scan: homepage form, report, share link `/?scan=<domain>`, retry on failure | Me | Open `https://getcitehound.com/?scan=example.com`; `npm run smoke` covers the pages and the API | Done (screenshots in `local/shots/launch/01-*`) |
| 2 | `/pro` explains Pro without promising a result: citation questions, "not tested", "in preparation", waitlist form | Me | Read `/pro`; `scripts/test-site-fixes.js` fails on "citation check", "we run it for you" and the like | Done |
| 3 | Waitlist signup: valid address accepted, same answer for a known address, honeypot, 6 accepted signups an hour per network, success message replaces the form | Me | `/pro#waitlist`; `scripts/test-waitlist.js`; e2e does one real signup and removes it | Done |
| 4 | Confirmation email arrives, branded, with the removal link | You | Join with your own address, open the message in Gmail and on a phone, press the link | Not checked by a person. Mail sends (e2e), appearance checked in `local/shots/launch/04-*` |
| 5 | Mail authentication: DKIM, SPF and DMARC pass for `mail.getcitehound.com` | You | `node scripts/check-mail-dns.js`, then send yourself one message and read `Authentication-Results` in the headers | Records present and aligned. **DMARC has no `rua`**: nobody receives reports. See "Mail DNS" below |
| 6 | Pilot link opens the start form, runs a report, ends at `/r/<id>/` with summary, details, citation questions (if switched on), estimate, feedback | Me | `node scripts/pro-issue-token.js --count 1 --label "Launch check"`, open it, run it on a small site | Done in e2e (25 pages, 36 s); the citation section needs its flag, see #15 |
| 7 | "Email me this report" sends the link to the address on the order (3 times at most) | Me | e2e checks it; press the button on a finished pilot report | Done |
| 8 | Waitlist removal link: page with one button, button removes, a bad token is the generic 404 | Me | `/waitlist/remove/<token>`; `scripts/test-pro-security.js`, smoke | Done |
| 9 | Report feedback form stores one answer, no contact data | Me | e2e | Done |
| 10 | `/privacy` is accurate for what runs on Monday: waitlist, feedback, counters, reports, email, Resend, Upstash, and the Gemini API for citation questions (no web search, tier terms, billing condition) | You (read) / Me (wrote) | Read `/privacy` end to end; it must not mention Polar (payment is not live) or a test provider | Written today. **You read it and check the Google paragraph against your billing** |
| 11 | `/r/*` and `/pro/start/*` are `noindex`, no referrer, `no-store`, not in `robots.txt`, the sitemap, `llms.txt` or the MCP server | Me | Smoke checks all of it | Done |
| 12 | Only Pro endpoints that exist are reachable: JSON only, own origin, size caps; `/app/report` is a 404 | Me | `scripts/test-pro-security.js`; smoke | Done |
| 13 | MCP server: 13 read-only tools with annotations, headerless clients served, SDK clients work | Me | `scripts/test-mcp-sdk.js`; smoke | Done (official v1 and v2 clients) |
| 14 | Environment variables set as in `docs/env.md` | You | Vercel, Project Settings, Environment Variables; compare with `docs/env.md` | See "Environment" below |
| 15 | Citation questions: the Gemini key belongs to a billing-enabled Google Cloud project, then `GEMINI_API_KEY` and `CITATION_QUESTIONS_ENABLED=1` are set in production and redeployed | You | `docs/citation-check.md`, "Before you switch anything on"; then run one pilot report and read the section | **Not set.** Do this only after confirming billing. Without it reports simply have no citation section |
| 16 | Production data is what you expect: your self-test report, one unused link, one waitlist entry (yours) | You | `node scripts/pro-admin.js list` and `health`; remove tests with `purge --label "Self test"` (dry run first) and `waitlist-remove <your address>` (`docs/pilot.md`) | Untouched, as you asked |
| 17 | Someone can reach you: `hey@getcitehound.com` receives mail and you read it | You | Send a message to it from another account | Not checked by me |
| 18 | A way to see problems: `node scripts/pro-admin.js health` each morning | You | Run it; "Nothing needs attention" is the goal | Works; counters start from today |

## Deliberately not live

| Item | State | Switch that turns it on | What must happen first |
|---|---|---|---|
| Payment | Built, never tried with Polar. `POST /api/pro/webhook` answers 503 (no `PRO_WEBHOOK_SECRET`). Every Pro button goes to the waitlist (no `PRO_CHECKOUT_URL`). | `PRO_WEBHOOK_SECRET`, then `PRO_CHECKOUT_URL` | Polar sandbox test end to end (`docs/payments.md`), terms and refund text, the `/privacy` paragraph drafted there, then a small real purchase of your own |
| Live citation testing | Code and mock tests only. No provider key exists anywhere. | `CITATION_TEST_ENABLED=1` with `CITATION_TEST_PROVIDER` and the key | The verification list in `docs/citation-check.md`: terms question for counsel, a spend limit at the provider, a first real call, the `/privacy` paragraph, the site copy |
| Model knowledge check | Same | `CITATION_KNOWLEDGE_ENABLED=1` | Same |
| Gemini Google Search grounding | Removed. Google's terms do not allow what the check did. | none | Not planned |
| Paid-tier upgrade of Vercel | Needed when payment goes live (Hobby limits) | | Planned, not a launch blocker |

## Environment (production), checked by behaviour on 10 to 11 October

| Variable | Expected Monday | Seen |
|---|---|---|
| Upstash (`KV_REST_API_*` or `UPSTASH_REDIS_REST_*`) | set | Yes: reports and the waitlist work |
| `PRO_HASH_SECRET` | set | Yes: Pro endpoints answer |
| `RESEND_API_KEY`, `PRO_MAIL_FROM` | set | Yes: mail was sent by e2e |
| `GEMINI_API_KEY`, `CITATION_QUESTIONS_ENABLED` | set only after item 15 | Not set |
| `PRO_WEBHOOK_SECRET`, `PRO_CHECKOUT_URL`, `PRO_PRICE_TEXT` | not set | Not set (webhook answers 503) |
| `CITATION_TEST_*`, `CITATION_KNOWLEDGE_ENABLED`, `ANTHROPIC_API_KEY` | not set | Not set |
| `WAITLIST_EMAIL_DAILY_CAP`, `CITATION_*_CAP` | optional | Defaults |

## Mail DNS (what `scripts/check-mail-dns.js` found on 11 October)

- DKIM: a public key at `resend._domainkey.mail.getcitehound.com`. SPF: the return path `send.mail.getcitehound.com` is a CNAME to Resend's host, which carries the SPF record, and has an MX for bounces. Both align with `mail.getcitehound.com`.
- DMARC: none on `mail.getcitehound.com`; the root `getcitehound.com` has `p=reject` with `ruf=` only and **no `rua`**, and no `sp`, so `p=reject` also applies to the sending subdomain, with no reports.
- Recommendation (also printed by the script): keep the root at `p=reject` and add a record only for the sending subdomain, `_dmarc.mail.getcitehound.com` = `v=DMARC1; p=none; rua=mailto:hey@getcitehound.com`. That gives you reports for Resend mail without letting anyone spoof the root domain while you watch. After a few weeks of clean reports move the subdomain to `quarantine`, then `reject`. Lowering the root itself to `p=none` (your plan) also works but opens the root domain to spoofing for as long as it stays there. I changed no DNS.

## Morning of launch, in order

1. `npm run gates && npm run smoke` from a clean clone (not the iCloud folder).
2. `node scripts/pro-admin.js health` and `list`.
3. Join the waitlist with your own address from your phone; open the email; press the removal link; check `list`/`health` (a removal shows in the counters).
4. Issue one pilot link, run a report on a small site, press "Email me this report".
5. Read `/privacy` and `/pro` once as a visitor.
6. After the launch post goes out, run `health` after an hour and again in the evening.
