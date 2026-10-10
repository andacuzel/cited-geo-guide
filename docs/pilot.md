# Running the Pro pilot

A pilot link is a real Pro order link with a note on it that says "pilot". The person who opens it uses exactly the
same start form, crawl, report, email button and feedback form that a paying customer will use later. The only
difference is that you issued the link yourself and nobody paid.

Everything below runs from the project folder in a terminal. It needs the Upstash values in `.env.local` (the file is
ignored by git, and the scripts never print what is in it).

## 1. Issue five links

```bash
node scripts/pro-issue-token.js --count 5 --label "Pilot round 1"
```

It prints five lines, one link each, and nothing else. Each link:

- opens one report, once. After someone starts a report the link takes them back to that report, never to a second one;
- works for 14 days if nobody uses it. Change that with `--expires-days 30` (1 to 90);
- carries your label (up to 60 characters) so you can tell the batch apart later. Use a nickname or a group, never an
  email address or a full name: the script refuses a label with an `@`.

Copy the lines into a text file or straight into your messages. Each link is a secret: whoever has it can use it.

## 2. What to send people

One link per person, in a message of your own. Say these things, in your words:

- This is an early version of Citehound Pro. The link makes one report for one site, so use a site you care about.
- It reads up to 25 pages, one request a second, and respects the site's robots.txt. It takes a few minutes.
- Keep the browser tab open while it works. If you close it, open the same link again and it carries on.
- The report measures AI readiness (whether crawlers can reach and read the pages). It does not say whether any
  assistant mentions the site.
- At the bottom of the report there is a short, optional feedback form (a number from 1 to 5 and a note).
- If the scan cannot read the site at all, the link is given back, so they can try again or use another site (up to
  three times). A report that read at least one page uses the link up.

Please do not promise a price, a launch date or a feature. None is decided.

## 3. See what is happening

```bash
node scripts/pro-admin.js list        # every link: first 8 characters, label, source, status, date, report status
node scripts/pro-admin.js stats       # daily totals for the last 7 days (add --days 30)
node scripts/pro-admin.js feedback    # what people wrote, newest first, with the average rating
node scripts/pro-admin.js health      # the last 24 hours at a glance (see "Health" below)
```

`list` shows `unused`, `used`, `expired` or `revoked` for each link, and for used links whether the report is
`done`, `partial` (it read some pages, not all), `failed`, or still `running`. It never shows a full link, a name or an
email address. `stats` shows numbers only: waitlist signups and removals, links issued (pilot and paid), reports
started, finished, partial, failed and restored, and messages sent. If a person never opens the link you will see it
as `unused`; if they started and left, the report shows `running` until they come back.

## 4. Revoke a link

Copy the first characters of the link from `list` (at least 6) and run:

```bash
node scripts/pro-admin.js revoke 1a2b3c4d
```

Anyone who opens a revoked link sees the same "This link is not available" page as for a link that never existed. You
can only revoke a link nobody has used. A report that already exists stays available until its own 90 days end; to
delete one sooner, see "Deleting a report" in `docs/pro.md`.

## 4b. Health, test clean-up and the review flag

```bash
node scripts/pro-admin.js health
```

`health` covers the last 24 hours: orders issued (pilot and paid), reports started and how they ended (done, partial,
failed, still running, with the reason of a failed one), links restored, webhook failures, email failures, waitlist
signups, and refunds. It ends with "Nothing needs attention" or "Needs a look". The daily counters are kept per UTC
day, so the counter lines read today plus yesterday. Numbers only: no token, address or name.

Remove test data you made yourself. The report from the first self test carries the label `Self test`. First look:

```bash
node scripts/pro-admin.js purge --label "Self test"
```

Without `--yes` that command only lists what it would remove (first 8 characters of each link, and the report), and
changes nothing. When the list is what you expect, run the same command with `--yes`:

```bash
node scripts/pro-admin.js purge --label "Self test" --yes
```

It removes every order whose label is exactly that text, the report each one made, its pages, citation record and feedback.
It does not touch other labels, the waitlist or the counters. To remove one waitlist entry (for example your own test
address) by address:

```bash
node scripts/pro-admin.js waitlist-remove you@example.com
node scripts/pro-admin.js waitlist-remove you@example.com --yes
```

The address is matched without regard to case or surrounding spaces and is never printed back. A person can also remove themselves from the link in the message
we sent.

When a payment is refunded in part, or a refund arrives that the program cannot size, the link stays valid and the order is
flagged: `list` shows `CHECK: partial_refund` (or `refund_reported`, or `refund_after_use`), and `health` counts it.
Look at the order in the Polar dashboard, decide, and clear it with `node scripts/pro-admin.js clear-review <prefix>`.
See "Refunds" in `docs/payments.md`.

## 5. The waitlist

People join on the Pro page, tick "Tell me when Citehound Pro opens", and get one confirmation email. To get the list:

```bash
node scripts/export-waitlist.js > waitlist.csv
```

The file has personal data. Keep it out of the repository (files named `waitlist*.csv` are ignored by git, but do not rename it), and do not
paste it into a chat. Entries delete themselves after 12 months, and each person can remove
themselves from the link in every message. A removed address disappears from the next export.

## 6. When Pro can be bought

Set `PRO_CHECKOUT_URL` (an https address) and, if you want one, `PRO_PRICE_TEXT` (for example `$49 one time`) in the
Vercel project's environment variables, then redeploy. The Pro buttons then go to the checkout address and say "Get
Citehound Pro", and the waitlist form is hidden. Without `PRO_CHECKOUT_URL` the buttons go to the waitlist form and the
price spot says "Early access". Do not set it before payment actually works.

## 7. Settings that matter

| Variable | Where | What it does |
|---|---|---|
| `PRO_HASH_SECRET` | Vercel | Required. Without it (or with under 16 characters) every Pro endpoint answers 503. Never change it casually: it also signs the waitlist removal links already sent, which stop working if it changes. |
| `RESEND_API_KEY`, `PRO_MAIL_FROM` | Vercel | Sending. Without them the waitlist still works but sends no confirmation, and the report page hides its email button. |
| `WAITLIST_EMAIL_DAILY_CAP` | Vercel | Most confirmation emails a day (default 200). The form is public, so this limit protects the sending domain. |
| `PRO_CHECKOUT_URL`, `PRO_PRICE_TEXT` | Vercel | Section 6. |

In the Resend dashboard, check that open tracking and click tracking are off for the sending domain. Resend's
documentation says they are off by default; the dashboard is where to confirm it.

## 8. If something looks wrong

- A person says the link "is not available": run `list`. If it shows `used`, they already started a report: send them
  the same link again, it redirects to their report. If it shows `expired` or `revoked`, issue another.
- A report is stuck at "running": the crawl is driven by the person's open tab. Ask them to open the link again.
- Nothing shows in `stats`: the counters only count what happens after this version was deployed.
