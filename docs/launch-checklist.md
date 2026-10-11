# Launch checklist (Monday 12 October 2026)

What must be true on launch day, who owns it, how to check it, and where it stands. Status is as of Sunday 11 October 2026, after commit `af6647a` (gates 64 of 64, `npm run smoke` 154 of 154, `node scripts/e2e-live.js` 44 of 44, `npm run test:real-kv` 82 of 82, all run today; run smoke and e2e once each, not in loops: see "Vercel checkpoint" in `docs/readiness.md`).
"Me" means Claude Code; "You" means the owner. A status of "done" means a check passed today, not that nothing can change.

Run the automated set with: `npm run gates`, then `npm run smoke` once after the last push, and `node scripts/pro-admin.js health`. `node scripts/e2e-live.js` (sends real emails to hey@getcitehound.com and removes its own data) runs only when the owner asks for it, never as a routine step (`CLAUDE.md`, "Gates and pushing").

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
| 15 | Citation questions (and the check): the three steps in "Switching the citation check on" below, in order, each followed by a redeploy and a look | You | `node scripts/pro-admin.js spend` and `health` after the first real report; read the report's citation sections | Built and live-verified (Claude and Perplexity real calls, one full pilot run) but **not switched on**: no citation variable is set in Vercel |
| 16 | Production data is what you expect: your self-test report, one unused link, one waitlist entry (yours) | You | `node scripts/pro-admin.js list` and `health`; remove tests with `purge --label "Self test"` (dry run first) and `waitlist-remove <your address>` (`docs/pilot.md`) | Untouched, as you asked |
| 17 | Someone can reach you: `hey@getcitehound.com` receives mail and you read it | You | Send a message to it from another account | Not checked by me |
| 18 | A way to see problems: `node scripts/pro-admin.js health` each morning | You | Run it; "Nothing needs attention" is the goal | Works; counters start from today |
| 19 | Homepage waitlist bar: "Citehound Pro is coming: join the waitlist", links to `/pro#waitlist`, dismissible for the session (no cookie), no body script | Me | Open `/` in a new private window; close it; reload (gone for the session) | Done (390 and 1280 px checked in a browser; Lighthouse numbers in the build report) |
| 20 | State of AI Readiness: `/research/state-of-ai-readiness` (four dated findings, form), the PDF in the database, the signed email link, removal | Me / You | `node scripts/pro-admin.js readiness-info`; join the form once with your own address, open the email, press "Download the PDF", then "Remove my address" (`docs/readiness.md`) | Built, deployed, PDF uploaded and hash-checked (`ee5438d5…`). The signed links **were not pressed by me**: they are signed with a secret that exists only in Vercel. One real email went to `hey@getcitehound.com` during `e2e-live.js`: press the link in it |
| 21 | Homepage report card (bottom right, bar on mobile, 40% scroll or 15 s, once per session, never on `/pro`, `/privacy`, `/r/*`, `/pro/*`) | Me | Open `/` in a private window and scroll; press Escape | Done (behaviour test in the gates, checked in a browser) |
| 22 | `/beyond-technical`, and the homepage "Beyond technical" band (navy, eyebrow "Beyond the score", the owner's headline split at the sentence, two stacked layers, gold button), from your text | Me / You | Read it once as a visitor. It uses your words; the only changes are typographic apostrophes and US "prioritized". **It still contains the banned word "actually"** (your sentence "Which questions your market actually asks"): delete that word in `content/beyond-technical.json` and in the exception at the top of `scripts/generate-beyond-technical.js` if you want it to follow the voice rule | Done |
| 23 | Repository files (`/CLAUDE.md`, `/docs/*`, `/scripts/*`, `/lib/*`, `/vercel.json`, `/.env`, `/.git/*`, `/local/*`, `/package.json`) answer the ordinary 404 | Me | `npm run smoke` checks 25 of them live, and that the files a page loads are still served | Done (was open before 11 Oct for `/CLAUDE.md`, `/docs/*.md`, `/scripts/*`, `/lib/*`) |
| 24 | No page or tool text says llms.txt improves AI citations or Google results ("optional, low-cost; no demonstrated effect on Google") | Me / You | `node scripts/test-site-fixes.js`. **The check is still worth 4 of 100 points: your decision** (`lib/scanner.js`, check "llms.txt present") | Done, weight untouched |
| 25 | One navy footer on every page (Product, Research, Company; mark and one line; no changelog, no social icons); the report cover image next to the form on `/research/state-of-ai-readiness` | Me | `node scripts/site-footer.js --check` (a gate) and `npm run smoke` | Done. `lib/site-footer.js` is the one place to edit the footer, then `node scripts/site-footer.js` |
| 26 | `/changelog` stays at its address, `noindex`, out of the footer, the sitemap and `llms.txt` (the Trust page still has a row that links to it) | You | Decide whether it stays; `scripts/generate-changelog.js` | Done as asked |

## Deliberately not live

| Item | State | Switch that turns it on | What must happen first |
|---|---|---|---|
| Payment | Built, never tried with Polar. `POST /api/pro/webhook` answers 503 (no `PRO_WEBHOOK_SECRET`). Every Pro button goes to the waitlist (no `PRO_CHECKOUT_URL`). | `PRO_WEBHOOK_SECRET`, then `PRO_CHECKOUT_URL` | Polar sandbox test end to end (`docs/payments.md`), terms and refund text, the `/privacy` paragraph drafted there, then a small real purchase of your own |
| Citation check (Claude) | Built, verified live (11 Oct), switched off. Perplexity is built and verified too, and stays off by recommendation | `CITATION_TEST_ENABLED=1` (after the questions steps) | The checklist below, `docs/citation-check.md` (counsel items, Anthropic spend limit) |
| Model knowledge check | Built, off | `CITATION_KNOWLEDGE_ENABLED=1` | Same |
| Gemini Google Search grounding | Removed. Google's terms do not allow what the check did. | none | Not planned |
| Paid-tier upgrade of Vercel | Needed when payment goes live (Hobby limits) | | Planned, not a launch blocker |

## Environment (production), checked by behaviour on 10 to 11 October

| Variable | Expected Monday | Seen |
|---|---|---|
| Upstash (`KV_REST_API_*` or `UPSTASH_REDIS_REST_*`) | set | Yes: reports and the waitlist work |
| `PRO_HASH_SECRET` | set | Yes: Pro endpoints answer |
| `RESEND_API_KEY`, `PRO_MAIL_FROM` | set | Yes: mail was sent by e2e |
| `ANTHROPIC_API_KEY`, `CITATION_ANTHROPIC_ENABLED`, `CITATION_QUESTIONS_ENABLED` | set in step 1 below | Not set |
| `PRO_WEBHOOK_SECRET`, `PRO_CHECKOUT_URL`, `PRO_PRICE_TEXT` | not set | Not set (webhook answers 503) |
| `CITATION_TEST_ENABLED` | set in step 2 below | Not set |
| `PERPLEXITY_API_KEY`, `CITATION_PERPLEXITY_ENABLED`, `CITATION_KNOWLEDGE_ENABLED`, `CITATION_KILL` | not set | Not set |
| `WAITLIST_EMAIL_DAILY_CAP`, `CITATION_*_BUDGET_USD`, `CITATION_MAX_*`, `CITATION_QUESTION_SAMPLE` | optional | Defaults ($2 a day, $4 a month, $0.50 and 30 calls a report, 10 questions) |

## Mail DNS (what `scripts/check-mail-dns.js` found on 11 October)

- DKIM: a public key at `resend._domainkey.mail.getcitehound.com`. SPF: the return path `send.mail.getcitehound.com` is a CNAME to Resend's host, which carries the SPF record, and has an MX for bounces. Both align with `mail.getcitehound.com`.
- DMARC: none on `mail.getcitehound.com`; the root `getcitehound.com` has `p=reject` with `ruf=` only and **no `rua`**, and no `sp`, so `p=reject` also applies to the sending subdomain, with no reports.
- Recommendation (also printed by the script): keep the root at `p=reject` and add a record only for the sending subdomain, `_dmarc.mail.getcitehound.com` = `v=DMARC1; p=none; rua=mailto:hey@getcitehound.com`. That gives you reports for Resend mail without letting anyone spoof the root domain while you watch. After a few weeks of clean reports move the subdomain to `quarantine`, then `reject`. Lowering the root itself to `p=none` (your plan) also works but opens the root domain to spoofing for as long as it stays there. I changed no DNS.

## Switching the citation check on (when you decide to)

Prerequisites, once: in the Anthropic Console set a spend limit for the workspace the key belongs to and keep the prepaid credit topped up (the key in `.env.local` has about $5); read the **LAWYER** items in `docs/citation-check.md`; read `/privacy` (it already describes Anthropic).

Costs, measured on 11 October: about **$0.125 a report** with Claude alone (10 questions), about $0.17 with Perplexity too. The built-in budgets ($2 a day, $4 a month, $0.50 a report) stop it before that can run away.

**Step 1: the questions only** (about $0.002 a report). In Vercel: Project, Settings, Environment Variables, "Add New", **Production only**, in this order:
1. `ANTHROPIC_API_KEY` = the key, with "Sensitive" ticked
2. `CITATION_ANTHROPIC_ENABLED` = `1`
3. `CITATION_QUESTIONS_ENABLED` = `1`

Then **redeploy** (variables apply only to a new deployment): Deployments, the latest production deployment, the three dots, "Redeploy". Check: issue a pilot link (`node scripts/pro-issue-token.js --count 1 --label "Citation check 1"`), run a report, open it: it has "Citation questions" (grouped, "Not tested") and no provider section. Then `node scripts/pro-admin.js spend`: a few calls under "questions".

**Step 2: the check on Claude** (about $0.125 a report). Add `CITATION_TEST_ENABLED` = `1` (Production), redeploy, run one pilot report: it has the section "What Claude's web search cited" with ten rows. `spend` now shows the cost.

**Step 3, optional and not recommended yet:** `PERPLEXITY_API_KEY` (Sensitive) and `CITATION_PERPLEXITY_ENABLED` = `1`, plus the Perplexity paragraph for `/privacy` from `docs/citation-check.md`, in one deploy, only after the written answer from Perplexity described there.

**The way back, from fastest:**
1. `node scripts/pro-admin.js kill on`: no redeploy; the next paid call is refused; reports in progress finish without it. Needs the Upstash keys in `.env.local`. Undo with `kill off`.
2. Vercel: add `CITATION_KILL` = `1` and redeploy (stops everything, also new reports' questions).
3. Remove `CITATION_TEST_ENABLED` and redeploy (back to questions only), or remove `CITATION_QUESTIONS_ENABLED` and redeploy (back to no citation section).

Watch the money with `node scripts/pro-admin.js spend` (today, this month, per provider) and `health`.

## Morning of launch, in order

1. `npm run gates && npm run smoke` from a clean clone (not the iCloud folder).
2. `node scripts/pro-admin.js health` and `list`.
3. Join the waitlist with your own address from your phone; open the email; press the removal link; check `list`/`health` (a removal shows in the counters).
4. Issue one pilot link, run a report on a small site, press "Email me this report".
5. Read `/privacy` and `/pro` once as a visitor. Open `/research/state-of-ai-readiness`, ask for the report with your own address, press the link in the email and check the PDF opens; then press "Remove my address".
6. After the launch post goes out, run `health` after an hour and again in the evening.
