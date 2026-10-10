# Citehound Pro

Everything in the Pro report system except payment. A customer holds a single-use link, fills in one
form, watches a crawl, and gets a private report page. This document is the map: how it fits together,
what to set in Vercel, how to issue a link, how long things are kept, the wording `/privacy` needs on the
day this goes live, and what a payment webhook has to call.

Citehound measures AI readiness (crawler access and on-page signals). Nothing here measures whether or how
often an AI assistant mentions a brand, and no copy may say it does.

## Architecture

```
                         operator
                            | node scripts/pro-issue-token.js
                            v
   +---------------------------------------------------------------+
   |  Redis (Upstash, through Vercel KV or direct)                 |
   |                                                               |
   |  pro:order:<token>        hash   status, expiresAt, jobId,    |
   |                                  contactName, contactEmail,   |
   |                                  emailSends                   |
   |  pro:order-claim:<token>  string 120 s claim (SET NX)         |
   |  pro:job-order:<jobId>    string job -> token (email only)    |
   |  pro:job:<id>             hash   domain, status, phase,       |
   |                                  counters. NO contact data    |
   |  pro:job:<id>:pages       hash   one field per page           |
   |  pro:job:<id>:lock        string one worker per job (60 s)    |
   |  pro:slot:req:<domain>    string 1 request / second / domain  |
   |  pro:domain-active:<d>    counter at most 2 jobs per domain   |
   |  pro:rl:<action>:<hash>   counters keyed-hash rate limits     |
   +---------------------------------------------------------------+
        ^                 ^                    ^              ^
        |                 |                    |              |
  /pro/start/<token>   /api/pro/step      /r/<id>/       /api/pro/email
  (static page +       (browser calls     (HTML made     (job id only; the
   POST /api/pro/      it again and       on the server  address comes from
   start)              again)             by renderPro)  the order)
        \_______________ all of them are one function: api/pro.js ______/
```

Flow:

1. `scripts/pro-issue-token.js` writes an order and prints `https://<site>/pro/start/<token>`.
2. The customer opens it. `/pro/start/<token>` is served by the function (`app/pro-start.html` is bundled with `includeFiles` in `vercel.json`; if the file ever went missing the answer is a 503 page, never a redirect). The page asks `POST /api/pro/order` with the token in the body: ready (form), already started (sent on to that
   link's own report), or unavailable (one generic message for unknown, expired and malformed links).
3. `POST /api/pro/start` validates the form, refuses addresses that are not public websites, claims the token
   (exactly one caller wins), reserves one of two per-domain slots, creates the job and stores the contact in
   the order, never in the job.
4. The progress screen (`app/pro-progress.js`) calls `POST /api/pro/step` until the job is done. Step one
   discovers pages (robots.txt, llms.txt, sitemap or homepage links, at most 25). Later steps read and score up
   to 5 pages each, one request per second per domain.
5. A finished job shows a "View your report" button (a plain link to `/r/<id>/`; nothing redirects on its own).
6. `/r/<id>/` is server-rendered by `lib/report-render.js renderPro()`, the same renderer the public
   `/sample-report` uses. A job still running shows the progress screen and carries on from where it is.
7. "Email me this report" posts only the job id. The server finds the order through the reverse key and sends to
   the address stored there, never to one in the request.

The crawl is driven by the browser that is showing the progress screen. If that tab closes, the job waits where
it is, and opening the start link again or `/r/<id>/` resumes it. There is no queue and no cron (Hobby cron is
daily at best). See "Decisions" below.

**Closing the tab (known limitation).** While the progress screen says "Keep this tab open while we scan. If you close it, open
the same link again and it will continue.", that is exactly how it works: the crawl advances only while a browser tab
calls `/api/pro/step`. A closed tab pauses the job; the start link then redirects to `/r/<id>/`, which shows the progress
screen again and continues from the stored state (tested in `scripts/test-pro-api.js`). If the tab was closed in the middle
of a step, that step's lock lasts up to its TTL, and the new tab sees "busy" and waits for it. A job nobody reopens stays
unfinished until its 90-day record expires.

**No token in an address.** The token is in the path of `/pro/start/<token>` (that is the link), and every call after
the page loads carries it in a POST body. No page takes it in a query string. (`/app/pro-start` still exists as a static file, because the function reads it from disk; opened directly it has no token and shows the generic "not available" message.)
The path itself appears in Vercel's request log for that page; that is inherent to a link that carries a secret, so the
link is single-use and expires.

## Files

| Path | What it does |
|---|---|
| `lib/pro-store.js` | Redis (`@upstash/redis`) and in-memory adapters; orders, jobs, locks, slots, counters |
| `lib/safe-fetch.js` | The only way Pro touches a customer site: public addresses only, pinned lookup, manual redirects, caps |
| `lib/pro-crawler.js` | Discovery and the scan step; robots.txt, 1 request/s, 429 stops, 403 is "blocked by the site" |
| `lib/pro-estimate.js` | "Estimated score if you apply these fixes": re-runs `scoreAll()` with each fix applied |
| `lib/pro-api.js`, `api/pro.js` | The actions: start, order, step, status, email, report (one Vercel function) |
| `lib/pro-http.js` | no-store, noindex, no-referrer headers; keyed-hash caller ids; body reading |
| `lib/pro-mail.js` | The one email (Resend HTTP API) |
| `lib/pro-orders.js` | Issuing orders; `createOrderFromPayment()` is the marked payment hook (not wired) |
| `lib/pro-data.js`, `lib/pro-report-page.js` | A stored job as report data; the `/r/<id>/` page |
| `lib/report-render.js` (`renderPro`), `lib/report-pro-ui.js` | The report layout and its behaviour (sort, filter, copy, email, print) |
| `app/pro-start.html`, `app/pro-start.js`, `app/pro-progress.js` | The start form and the progress screen |
| `scripts/pro-issue-token.js` | Issue a link |
| `scripts/pro-dev-server.js`, `scripts/pro-fake-site.js` | Run the whole thing locally with no Redis and a pretend site |

Vercel Hobby allows 12 functions and the site had 10, so all Pro actions share `api/pro.js` (11 of 12).
`vercel.json` rewrites `/api/pro/<action>`, `/pro/start/<token>` and `/r/<32 hex>/` onto it.

## Environment variables

Set in the Vercel project (Production and Preview):

| Variable | Needed for | Notes |
|---|---|---|
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Everything | Or `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`. Create a Redis (Upstash, through the Vercel Marketplace) and connect it to the project. Without one, every Pro action answers 503 with a plain message and the log names the missing variables. There is no silent fallback to memory on Vercel. |
| `PRO_HASH_SECRET` | Rate limits, waitlist removal links | A random string of at least 16 characters. The caller id is `HMAC-SHA256(secret, address + UTC date)`; no address is ever stored or logged. **There is no fallback: if it is missing or shorter than 16 characters, every Pro endpoint answers 503 ("not available") and the log names the variable.** `npm run gates` tests that. |
| `RESEND_API_KEY`, `PRO_MAIL_FROM` | "Email me this report" | `PRO_MAIL_FROM` looks like `Citehound <reports@mail.getcitehound.com>`. If either is missing, the email endpoint answers "not configured" and the report page hides the button. |

For `scripts/pro-issue-token.js` on your own machine, the same `KV_*` pair in the gitignored `.env.local` works.

Spend: Upstash's free tier covers this at low volume (a report is a few hundred commands). Set a spend cap in
Upstash and in Resend before turning on payment. Resend's free tier is 3,000 emails a month.

## Issuing a link

```
node scripts/pro-issue-token.js            # one link
node scripts/pro-issue-token.js --count 5  # five
node scripts/pro-issue-token.js --memory   # dry run, the link works nowhere
```

A link is single use and unused links expire after 30 days. Send it to the customer yourself; nothing here sends
it. If a customer's crawl fails, the link is spent: write to them and issue a new one.

## Retention

| Record | Kept | Notes |
|---|---|---|
| Unused order | 30 days | then Redis deletes it |
| Order once used (contact, job id, send count) | 90 days from use | separate from the report |
| Job and its pages (the report) | 90 days from creation | holds no name, no email |
| Reverse key job to order | 90 days | read only by the email endpoint |
| Rate-limit counters | 1 to 24 hours | keyed hash, changes daily |
| Per-domain slot, request slot, locks | 1 second to 2 hours | |

Every record expires on its own through a Redis TTL. Nothing is exported, listed or searchable: a report needs its
128-bit id, an order needs its 128-bit token.

## Politeness

CitehoundBot only, never a browser user agent. robots.txt is read first and obeyed for every page, including a
rule aimed at CitehoundBot; a site that disallows `/` gets no crawl. At most 25 pages. One request per second per
domain across all jobs, at most two jobs per domain at once, and a hashed-address limit on start and step. HTTP 429
stops the crawl at once and the job ends "partial" with a plain reason. 401, 403, 406, 451 and bot-challenge pages
are reported as "blocked by the site" and never retried or worked around; three in a row stop the crawl.

Every request goes through `lib/safe-fetch.js`: the address is resolved inside the socket's own lookup and the
connection is made to exactly the address that was checked, so a name that resolves to a private address, or
changes its answer, never connects. Loopback, private, link-local (including the cloud metadata address),
carrier-grade NAT, documentation, multicast and IPv4-mapped/NAT64/6to4 forms are all refused. Redirects are
followed by hand, at most 4, each re-checked, and only within the same site.

## The report

Order: site summary (score, three pillars, findings in plain words, scan coverage), details (every check by
pillar, then the page table, then copy-paste fixes), and last, "Estimated score if you apply these fixes". There is
no simulation block. Every figure in the estimate comes from `scoreAll()` run again with the fix applied; the rows
run from the biggest gain to the smallest and their gains add up to the change in the total. Lists whose order
means nothing are alphabetical. The page table starts alphabetical and can be sorted.

## /privacy

`privacy.html` carries the "Pro reports" section below since 10 October 2026, and the three sentences it replaced ("no email
collection", "No personal data. No email addresses. No accounts", "Nothing about who started it is stored with it") are gone. The
page also names Upstash, Resend and Google Fonts as third parties and states that the pages load no analytics script and set no
cookies. Change the page and this text together. The wording as published:

> **Pro reports.** If you order a Citehound Pro report, we collect three things from you: your name, your email
> address and the address of the site you want scanned. We use them only to deliver your report and for support. If
> you press "Email me this report", we send the link to the address you gave us, and to no other.
>
> The crawl stores the site's domain, the list of pages it chose and each page's result, under a random 128-bit id,
> for 90 days. That record contains no name and no email address. Your name and email are kept in a separate order
> record, for 90 days from the day you start the report. A lookup from the report to its order exists only so the
> email button can find the address you gave us. Both records delete themselves when the 90 days end. An order link
> you never use expires after 30 days.
>
> We do not sell your details and we do not share them. They are stored with our database host (Upstash, through
> Vercel). When you press "Email me this report", your email address and the report link go to our email provider
> (Resend) to be delivered, and nothing else does. No page content, page address, domain or personal detail is sent
> to a model: a Pro report's summary is written by rules here.
>
> Anyone who has a report's link can open it, so treat the link like a password. We do not publish report links or
> list them anywhere, and report pages ask search engines not to index them. We keep a one-way hash of your network
> address with a request counter to limit abuse; it expires within a day and is not linked to the report.
>
> To have a report and its order record deleted before the 90 days end, write to hey@getcitehound.com with the
> report link.

Deletion on request is promised on the page, so there has to be a way to do it: delete the keys `pro:job:<id>`,
`pro:job:<id>:pages`, `pro:job-order:<id>` and the order hash named by the reverse key.

## Email: DNS records for the sender domain

Send from a subdomain that is not the one your mailbox uses (Purelymail keeps the root domain's mail records, and
this system must never send through that mailbox). Suggested sender: `reports@mail.getcitehound.com`. In Resend,
add the domain `mail.getcitehound.com`; Resend then shows the exact records to create. The shape is:

| Type | Name | Purpose |
|---|---|---|
| TXT | `resend._domainkey.mail` | DKIM public key (value copied from Resend) |
| MX | `send.mail` | Return-path for bounces, priority 10 (value copied from Resend) |
| TXT | `send.mail` | SPF for the return-path: `v=spf1 include:amazonses.com ~all` (Resend shows the current value) |
| TXT | `_dmarc.mail` | `v=DMARC1; p=none; rua=mailto:hey@getcitehound.com` to start; move to `p=quarantine` once reports look clean |

Alignment: the From domain is `mail.getcitehound.com`. DKIM signs as `mail.getcitehound.com` (aligned). The SPF
return-path is `send.mail.getcitehound.com`, a subdomain of the From domain (aligned under the default relaxed
mode). Either passing is enough for DMARC; both will. Do not change the root domain's SPF or DMARC for this. In the
Resend dashboard turn **off open tracking and click tracking** for the domain: the message has no pixel and the
report link must stay a plain link.

## Payment hookup

Nothing is wired. `lib/pro-orders.js` has one marked function, `createOrderFromPayment(store, { paymentRef })`.
A future webhook must:

1. Verify the provider's signature on the raw request body before reading anything. Reject unsigned and replayed
   requests.
2. Act only on the event that means "paid" (not "created" or "pending").
3. Call `createOrderFromPayment(store, { paymentRef })` with the provider's own checkout or event id. It is
   idempotent per `paymentRef`: a webhook delivered twice returns the same order.
4. Deliver the returned `url` to the buyer (the provider's success page, or a receipt email). Do not put it in a
   public page or a log.
5. Return 200 quickly. It must be a new route (a new rewrite onto `api/pro.js` if the function budget is tight, or a
   twelfth function), and it must not be listed in the sitemap, robots.txt, llms.txt or the MCP server.

Keep the provider's secret in the environment. Store no card data: nothing in this system should ever see it.

## Tests and gates

```
npm run gates                        everything below, plus every generator --check, integrity and vercel.json (see CLAUDE.md)
node scripts/test-pro-store.js       orders, jobs, TTLs, atomic claim, locks, slots, giving a link back (in-memory and a Redis stand-in)
node scripts/test-safe-fetch.js      public-address rules, site input, redirects, caps, "the site said no"
node scripts/test-scan-ssrf.js       every public path that fetches a typed domain: hostile names, rebinding, redirects, the MCP limit
node scripts/test-pro-crawler.js     politeness on a virtual clock, 25-page cap, 429, 403, parallel steps, failed jobs
node scripts/test-pro-estimate.js    the estimate equals real rescoring; rows add up
node scripts/test-pro-api.js         start, double submit, bad links, limits, email, report page, failed jobs, no private data in logs
node scripts/test-pro-report.js      layout order, tables, wording, figures, escaping
node scripts/test-pro-static.js      secrets, private data, listings, analytics, logs, headers, function count, bundled requires
node scripts/pro-dev-server.js --fast   the whole flow locally, no Redis, with a pretend site (--redis uses the store in the environment)
npm run test:real-kv                 the store and the start endpoint on a REAL Redis, under a prefix, cleaned up (needs credentials)
node scripts/e2e-live.js             one report end to end on the deployed site, cleaned up (needs credentials)
npm run smoke                        after a push: wait for the deploy, check the live site
```

`scripts/fake-upstash.js` stands in for Upstash's REST API so the two credentialed scripts can be tried without credentials. It proves
the scripts and the client's encoding line up and nothing about the real server. The first run of `test-real-kv.js` against a
stand-in found a real bug: with `automaticDeserialization: false` the client returns HGETALL as a flat list, which the adapter had
read as an object, so every order and job read on a real database would have come back empty. It is fixed and the unit-test stand-in
now answers the way the client does.

## Failed jobs

A job that ends with no page read (robots.txt forbids, the site blocks, a bot check or 429 before the first page, the site does not
resolve) is marked failed and its link goes back to unused: the job id is dropped from the order, the contact stays, the claim is
cleared, and the progress screen says "We couldn't scan this site. Your link is still valid, try again or use a different site." At
most 3 times per order; after that the link stays spent. A partial job (at least one page read) keeps its link spent and its report.

## Decisions for the owner

- **Crawl driver.** The browser drives the crawl. If a customer closes the tab, the job pauses until they reopen
  the link. A queue or cron would make it server-driven; both cost money or complexity on Hobby.
- **Dark theme.** The site has no dark theme, so the report is light only.
