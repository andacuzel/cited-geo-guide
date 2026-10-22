# CLAUDE.md — Citehound

Project memory. Read automatically at the start of every Claude Code
session. Everything here is binding unless the user overrides it in the
current session.

---

## What this project is

**Citehound** — an end-to-end service for AI readiness: a free scanner,
Pro site reports, Fix (we make the technical changes) and Beyond (we write
the content). The scanner is where it starts: a user enters a domain; a
Vercel serverless function fetches that site's public robots.txt,
sitemap.xml and homepage, scores it out of 100 across three weighted
pillars, and returns a prioritized list of fixes.

Positioning (14 Oct 2026): "Scan, fix and write for the way AI answers."
The boilerplate sentence is `lib/about-line.js` (JSON-LD, llms.txt, README,
every email footer); the footer line is `TAGLINE` in `lib/site-footer.js`; the
share images carry it (`scripts/capture-og.js`, versioned `?v=2`). The free
scan gives the full diagnosis plus copy-paste fixes. The MCP server and the
free tools stay described as read-only measurement and generators; they never
claim to fix or write anything. Pro, Fix and Beyond are in early access.

Three audience tracks, one engine: B2B SaaS (`/for-saas`), consumer and
e-commerce brands (`/for-brands`), local and independent professionals
(`/for-professionals`).

**Honest framing, non-negotiable:** the free scanner and its score measure
AI *readiness* (crawler access and on-page signals), not confirmed presence
in AI answers. Pro's **citation questions** are predictions written for the site
("Not tested. Try these in your own assistants." unless the report has a
check); site copy says a report *can* include a check and promises no result.
The **citation check** is a separate thing: one dated sample, on one provider
and model with live web search, of whether the site is cited (or, for
Perplexity, among the sources returned) for a sample of those questions. It is never part of the score,
never a ranking, never "visibility", and always shows its model, date and
"sample". The model knowledge check (no search) is never called citation
tracking and has no "cited" column. Write "the scan" or "the score" (not "Citehound")
when saying what is not measured, and never write copy that claims more than a
sample. Precision here is a credibility asset.

## Architecture

```
/                     static frontend, no framework, no build step
  index.html          homepage: hero + scan form + report + fork
  styles.css          the entire design system (see below)
  app.js              playbook data (saasData) + card rendering + views
  scanner.js          calls /api/scan, renders the report
/api
  scan.js             Vercel serverless function — all scanning logic
vercel.json           function config (maxDuration 30)
```

Constraints that must not be broken:
- **Vanilla HTML/CSS/JS only.** No React, no build step, no bundler.
- **Zero marginal cost, with a spend cap.** This replaces the old "zero
  paid dependencies" rule; do not revert it on the grounds of that rule.
  Every feature must run inside a free monthly allowance, with a spending
  cap set at the provider, so that normal use costs nothing and a mistake
  cannot cost much. If a change would spend beyond an allowance or has no
  cap, stop and say so instead of implementing it.
  - **Local citation tracker** (`scripts/citation-check.js`): plain questions to Gemini, no web search; its old `--grounded` flag and code are deleted (Google's
    terms do not permit analysing grounded results: `docs/citation-check.md`, "Why grounding was retired"). Its runs stay on the free tier.
  - **Pro citation questions and check** (`lib/pro-citation.js`): Claude writes the questions (a fraction of a cent a report). The **check** costs real money and has
    no free allowance (measured 11 Oct 2026: about $0.125 a report on Claude, $0.17 with Perplexity), so it is OFF unless the owner switches it on, every paid call goes
    through `lib/citation-budget.js` (kill switch, per-report and daily and monthly dollar budgets, reserved before the call), and the provider must have its own spend
    limit set. If a change would spend without those guards, stop and say so.
  - **Vercel** moves from Hobby to a paid plan when payment goes live.
    That is planned, not a violation. Until then, keep within Hobby limits
    (12 functions, current count 11 non-underscore: `api/pro.js` holds every Pro action).
- **No secrets in the repo.** Environment variables only.
- **The launch lead-magnet is dark.** `lib/launch-config.js` has `ENABLED = false`: the report
  signup and the Pro founding page are not generated, nothing links to them, and `/api/subscribe`
  answers `503 not_enabled`. `scripts/check-launch-config.js` fails if anything is reachable while it
  is off, or if it is on with a value missing. Turn it on only with `docs/launch-report.md`, and
  publish `docs/privacy-addendum.md` in the same deploy. The founding page states no price, no
  invented scarcity and no timer: the cap and the end date are static text from the config. The
  report says "readiness", names no scanned site and makes no causal claim. Its numbers come from
  `scripts/launch-report-stats.js` (stored scans only, output in the gitignored `local/launch-report/`).
- **Private reports are encrypted pages under `/r/<24 hex>/`.** `scripts/encrypt-report.js` turns one
  self-contained report into an unlock page (AES-GCM, PBKDF2-SHA256); see `docs/private-reports.md`.
  The crawl data, the plain report and the access code stay in the gitignored `local/private/<slug>/`.
  The code, the plain report and the recipient never appear in a tracked file, a log or a commit
  message. The path is not in `robots.txt`, `sitemap.xml`, `llms.txt` or any nav, and `vercel.json`
  sends `X-Robots-Tag: noindex, nofollow, noarchive` for `/r/*`. The repository is public, so an
  encrypted page stays in git history for good.
- **Citehound Pro is built, without payment.** Single-use order links, a start form, a polite crawl of at most 25
  pages driven step by step from the browser, and a private report at `/r/<32 hex>/`, all in one function
  (`api/pro.js`, logic in `lib/pro-*.js`), stored in Redis (`@upstash/redis`, the only runtime dependency; `ajv` is a dev dependency for `npm run check:vercel`). Read
  `docs/pro.md` before touching it. Hard rules: the job record never holds contact data (the order does); the
  report layout is `renderPro` in `lib/report-render.js`, shared with `/sample-report`; the estimated score comes
  only from re-running `scoreAll()`; reports use no ranking words and no simulation block; every fetch goes through
  `lib/safe-fetch.js`; failed jobs that read no page give the link back (up to 3 times); Pro paths stay out of the sitemap, robots.txt, llms.txt, the MCP server and analytics; nothing
  logs a token, address, name or email. `/privacy` carries a "Pro reports" section (10 Oct 2026): change it and `docs/pro.md` together.
- **The Pro waitlist and pilot links.** Every Pro call to action goes to the waitlist form on `/pro` (`#waitlist`), and
  `pro-cta.js` sends it to `PRO_CHECKOUT_URL` instead when that env variable is set; the price spot says "Early access"
  unless `PRO_PRICE_TEXT` is set. No mailto link is a Pro call to action, and nothing may say Pro can be bought while it
  cannot. The waitlist (`lib/waitlist*.js`, 12 months, one confirmation mail per address per 30 days, daily cap, signed
  removal link) answers the same for a known and a new address. Pilot links (`scripts/pro-issue-token.js`, `docs/pilot.md`)
  run the same code as paid ones. `PRO_HASH_SECRET` is required: without it every Pro endpoint answers 503. `/privacy`
  covers the waitlist, feedback and the daily counters; change it together with `docs/pro.md`.
- **The Pro citation questions and check** (`lib/citation-config.js`, `lib/citation-providers.js`, `lib/citation-budget.js`, `docs/citation-check.md`, `docs/env.md`) are all OFF
  unless a flag is `1` and its key is present: `CITATION_QUESTIONS_ENABLED` + `CITATION_ANTHROPIC_ENABLED` + `ANTHROPIC_API_KEY` (Claude writes the profile and 18 + 3
  questions, grouped by topic, shown as "Predicted questions, generated from your site", "Not tested"), `CITATION_TEST_ENABLED` (a deterministic sample of 10 questions, one
  run each, on Claude with web search, and on Perplexity only with `CITATION_PERPLEXITY_ENABLED` + its key, which stays off: see the Perplexity analysis), and
  `CITATION_KNOWLEDGE_ENABLED` (no search, only "named"). One section per provider, titled with provider and model, only counts ("cited in 3 of 10"), never a percentage,
  a ranking, a merged score or a claim about other assistants. Perplexity says "returned", not "cited". Kill switch: `CITATION_KILL=1` or `pro-admin kill on` (Redis,
  no redeploy). Budgets: `CITATION_MAX_CALLS`, `CITATION_MAX_COST_USD`, `CITATION_DAILY_BUDGET_USD`, `CITATION_MONTHLY_BUDGET_USD`, reserved in micro-dollars before each call.
  Only a valid order link starts paid calls; labels starting `e2e` or `smoke` never do. The site's text is untrusted (delimiters, schema, validation; nothing a model
  returns is fetched); what a provider is sent is the question text and a locale tag only; no answer text is kept. A failure never fails the report. There is no Google
  Search grounding anywhere.
- **Pro payments are built, not switched on.** `lib/pro-payments.js` (Polar adapter, a Paddle stub that refuses everything) verifies the signed
  webhook (`POST /api/pro/webhook`, secret `PRO_WEBHOOK_SECRET`; without it 503), creates one paid order per provider order id through
  `createOrderFromPayment`, remembers `checkout id -> link` for 30 minutes, and `/pro/welcome` hands the start path over once. A refund before use
  cancels the link only on a FULL refund (`order.refunded` with status `refunded`); a partial or unsized refund keeps the link and flags the order
  (`pro-admin list`, `clear-review`); after use nothing changes. Replays and redeliveries do nothing. Read `docs/payments.md` (what is verified, what is not) before
  setting `PRO_CHECKOUT_URL`, and never before the webhook has been tested against Polar's sandbox. The legal pages (`terms.html`, `privacy.html`, `refunds.html`) are in the repository since 22 Oct 2026, at the owner's request, and have had no lawyer's review: the facts only the owner knows (entity, address, governing law, jurisdiction, billing details) are square-bracket blanks, and `scripts/test-legal-pages.js` lists them. `app/report.html` (the old internal
  dashboard) stays in the repository and is kept off the deployed site by `.vercelignore`.
- **One guard for every fetch of a domain someone typed.** `lib/safe-fetch.js` resolves the name inside the socket's
  own lookup, connects only to a public address it has checked, re-checks every redirect and caps time and size.
  `lib/scanner.js` `fetchText` goes through it, so the free scan, the llms.txt checker, site-info, the crawl, the MCP
  tools and Pro all share it. Do not add a `fetch(`, `http.request` or socket call for a user-supplied address anywhere
  else; `scripts/test-scan-ssrf.js` lists the files allowed to make any request of their own and fails on a new one.
- **Report summaries.** The executive summary of a crawl report is written
  from aggregated figures only (`lib/report-facts.js`), by rules or by a model
  that only rephrases them, and every model reply is validated against the
  facts (`lib/summary.js`). No page content, URL or domain goes to the model
  for the summary. (The Pro citation questions are separate: they send excerpts of the site's own public text
  to Gemini and receive the questions; `privacy.html` says so.) Keep both in step. Do not send anything else.
- **The State of AI Readiness report is a gated PDF kept in the database, never a file.** `/research/state-of-ai-readiness` (generated from
  `content/readiness.json` by `scripts/generate-readiness.js`) shows four dated findings and a form; the signed 30-day link in the email streams the PDF
  from Upstash (`lib/readiness*.js`, routes in `api/pro.js`). `*.pdf` is gitignored and tests fail on a tracked or deployed PDF; a figure on the page
  must match `local/launch-report/stats.json` (`scripts/test-readiness-figures.js`) and the July snapshot (219 scored of 278), never the 2 Oct rescan.
  Its list is separate from the Pro waitlist. Read `docs/readiness.md` before touching it. `/privacy` and `docs/readiness.md` change together.
- **Repository files are not part of the site.** `middleware.js` answers the ordinary 404 for `docs`, `scripts`, `lib` (except the few files a page loads),
  `content`, `config`, dotfiles, `CLAUDE.md` and the rest; `.vercelignore` drops what no function reads. A new browser-loaded file under a blocked
  directory goes in `OPEN_FILES`, or `scripts/test-static-exposure.js` fails. Do not put a body `<script>` ahead of the homepage content: it delayed
  the first paint by about 200 ms in Lighthouse.
- **llms.txt is "optional, low-cost, no demonstrated effect on Google", and we do not measure whether any system reads it.** No page, tool text or check
  text says it improves citations or search results (`scripts/test-site-fixes.js`). The check is still worth 4 of 100 points (owner's call).
- **Homepage notices.** The Pro waitlist bar (`wl-bar.js`, the `.wl-off` class set by the head script) and the report card (`report-card.js`) keep
  their state in sessionStorage inside try/catch, set no cookie and take no focus. `/fix` and `/beyond` are generated by `scripts/generate-service-pages.js` from
  `content/service-pages.json` (edit the JSON, never the page); `/beyond-technical` redirects to `/beyond` (vercel.json) and the old owner copy is gone from the site.
  Both pages carry the inline early-access form (`lib/request-dialog.js` `inline()`), a mockup is always labelled "Illustration. Not a real client.", and their
  first FAQ entry is the homepage answer word for word ("What do Fix and Beyond cost?", id `faq-cost`; the check compares them). Product lockups ("Citehound FREE/PRO/FIX/BEYOND") come from `lib/lockup.js`.
- **Homepage structure (13 Oct 2026).** Order: hero with the scan, the four-step ladder (Scan, Pro report, Fix, Beyond), proof (the AgaOne case study, then the
  benchmark strip), how the scan works, a research strip (three links), one developer row (MCP server, playbooks, generators), the FAQ, a closing call to
  action, the footer. The Pro band, the Beyond technical panel, the MCP band, the citation teaser and the agentic commerce strip are gone from the homepage;
  their generators still build their own pages and check the old blocks only where they stand (`generate-pro.js`). The
  citation scatter markup lives in `content/citation-scatter.fragment.txt` (source for `/citation-tracking`). Citation tracking is a feature line inside the Pro and
  Beyond cards, never a section. The no-guarantee sentence is gone from landing, pricing and FAQ copy (15 Oct 2026): it lives once, on `/terms`
  ("Citehound makes no guarantee about citations, traffic, rankings or revenue."), and `scripts/generate-pricing.js --check` fails on "guarantee" or "promise" on the homepage, /pricing, /pro, /fix and /beyond. The Fix and Beyond form (`request-form.js`, a dialog) posts to `/api/waitlist` with `interest` (pro, fix, beyond),
  optional `website` and `note`; only a Pro signup gets the confirmation mail. `scripts/export-waitlist.js` prints the three columns.
- **Homepage ladder motion (14 Oct 2026, owner's request).** The four ladder cards step up (their heights differ, bottoms aligned), Fix and Beyond are navy with a
  gold accent, and they are the one place on the site where a card lifts 4px on hover and fades in on scroll (`home-motion.js`, 80 ms apart, connectors draw in).
  The same file counts the benchmark average up and draws the AgaOne chart lines. All of it is skipped under `prefers-reduced-motion`; the figures are in the HTML.
  The Pro showcase slider is gone (14 Oct 2026): each service has its screenshot in the product tour, and the homepage has no sample-report crop or citation scatter
  (the scatter lives on `/citation-tracking`). The homepage MCP navy band is `.mcp-home`: never style the shared `.mcp-section`, which `/mcp` uses on a light page. No other card may lift or slide.
- **Project workspaces (Fix and Beyond).** Bearer-link pages `/w/<32 hex>` and the public demos `/demo/fix` and `/demo/beyond`, in the one Pro function (`lib/ws-*.js`, routes in
  `lib/ws-api.js`, `docs/workspaces.md`); the admin is `/admin/ws` and `scripts/ws-admin.js`. Hard rules: the admin is behind `ADMIN_TOKEN` and **every admin
  route is a 404 while it is unset or under 16 characters**; the token is compared in constant time, never logged, echoed or put in a cookie; a Fix item becomes
  "verified" only through a passing re-run of its check (`lib/ws-service.js` verify), never by hand; everything rendered is escaped and pasted text goes through
  `lib/ws-markdown.js`; a workspace holds no contact data; the demos are fictional (example-co.com, example-books.com), read-only, marked "Product demo · Sample data". In a Beyond workspace only the client's Approve sets "approved" (an admin cannot), published only follows approved, and a visitor has no other write button; the Monthly tab labels the citation check a pilot and invents no numbers. The robots.txt and
  llms.txt text comes from `lib/file-generators.js`, shared with the MCP tools: do not write a second builder. `node scripts/test-workspaces.js` is a gate.
- **The product tour and the /fix and /beyond hero pictures are real screenshots** of the live sample report and the two demos, in `assets/tour/` (WebP, with width and height),
  made by `scripts/capture-tour.js` (Playwright is not a dependency: see the script's header). Re-run it when one of those pages changes its layout, never to change
  the demo data. The tour's label is "Product demo · Sample data"; show only screens that exist, and no multi-engine visibility tiles or invented metrics.
- **Pro screenshots are generated.** The crops of the report on `/pro` and in
  the homepage Pro band (including the Citations section with the published CRM sample)
  come from the sample data and the real renderer (`renderPro`); rerun
  `scripts/capture-pro-shots.js` whenever the report layout changes, then
  `scripts/generate-pro.js`.
- **Two textures, two places.** The homepage Pro band carries one SVG-pattern field
  of page glyphs, partial and hard-edged, in a lighter navy zone (`--navy-900`),
  built from a `<pattern>` and never a gradient. The homepage "Beyond technical" panel (a contained
  light panel, the same width and radius as the gold commerce card) carries a dot grid at 10% ink, drawn
  the same way (an inline SVG `<pattern>`, 11 Oct 2026, owner's request). No other surface may use a
  texture, and no CSS gradient function appears anywhere in the stylesheet (`generate-pro.js --check`).
- **Never pair two scores with an arrow.** It reads as a score drop. The Pro band
  shows no scores; the page shows the homepage and whole-site scores side by side.
- **Never hardcode the host.** New code reads the address from `site.config.json`
  (through `lib/site-config.js`), so `scripts/set-domain.js` can move the site in one
  command. A literal old-host URL needs a rule in `config/domain-rules.json`.
- **Brand.** The product is **Citehound** (one word, capital C), formerly Cited and then
  Answerable. The wordmark is Gloock with no trailing dot, beside the sighthound-head mark in
  `assets/brand/`. "Hound" is an image, never a promise: copy never says the product hunts,
  tracks down or finds citations, and the hound image appears in one place only (a short line
  on `/about`). The old names appear only in `docs/`, this file, the `AnswerableBot`
  user-agent token in `lib/scanner.js` (kept for one version) and the old-host redirect in
  `vercel.json`. Site copy, content files and the frozen crawl data carry no old name.
  A page description is at most 160 characters.
- **Contact addresses.** `hey@getcitehound.com` is the one contact address: every page, every
  contact button and `mailto:` link, the structured data (Organization `email` and
  `contactPoint`), `security.txt`, the MCP `serverInfo` and every doc. It lives in
  `site.config.json` as `contactEmail`, and new code reads it from there. `andac@getcitehound.com`
  appears only as the contact button on `/about`. No other address appears anywhere, and
  addresses stay plain-text `mailto:` links (no obfuscation, so machines can read them).
- **Counts come from registries.** Tool, prompt, check, vertical and page counts are
  derived from their registry (`api/mcp.js` TOOLS and PROMPTS, the scanner's check
  list, `lib/playbooks.js`), never typed. Every new MCP tool is added to the registry,
  the harness, `mcp.html` (`scripts/generate-mcp-docs.js` fills the new ones) and
  `scripts/generate-mcp-submission.js`, which stops if a tool has no example.
- **Changelog entries come from real commits.** `content/changelog.json` lists only
  what a visitor or an MCP user can see, one plain factual sentence per entry, with
  the commit hashes as refs. `scripts/generate-changelog.js --check` fails on a ref
  that is not a commit or a date that is not the newest ref's date.
- **`mcp.html` is generated from the registry.** `scripts/generate-mcp-page.js` writes the
  whole page (tools, prompts, counts, the server URL from `site.config.json`); never edit it
  by hand. Every new tool or prompt needs an entry and a group in `content/mcp-copy.json`, or
  the generator stops. The excerpts come from `content/mcp-examples.json`, captured from the
  live server with `scripts/capture-mcp-examples.js`; recapture after the tools or the host
  change. `node scripts/generate-mcp-page.js --check` must pass.
- **`tools/index.html` is generated from `content/tools.json`.** A new tool page needs an
  entry there (benefit headline, give and get lines, chips, group, icon), or
  `node scripts/generate-tools-page.js --check` fails. A tool earns the chip "Runs in your
  browser" only if its scripts make no network request; the check reads the scripts. The
  generator also writes the "Next step" block between `<!-- NEXT:START -->` and
  `<!-- NEXT:END -->` on each tool page; edit the text in `content/tools.json`, never in the page.
- **Tool pages are generated between markers from `content/tools.json`.** Besides the Next
  step block, `scripts/generate-tools-page.js` writes TOOL-INTRO and TOOL-MORE (chips, "Try an
  example", how it works, why it matters, the FAQ rendered from the page's own FAQPage JSON-LD,
  "Use it from Claude"), the kicker, the H1 and the `data-toolx-*` hooks. A new tool page needs
  an entry there (`polish`, `how`, `why`, `claude`, `example`, `hooks`) and `tools/shared.js`
  loaded before its own script; edit the JSON-LD, never a hand-written FAQ. `tools/shared.js`
  and the page scripts must make no request the chips do not state. Run
  `node scripts/test-tools.js` and `node scripts/generate-tools-page.js --check`.
- `GEMINI_API_KEY` is the Google AI Studio key. Environment or the
  gitignored `.env.local` only; never logged, never in a URL.
- Node 18+ runtime; `fetch` is global, no node-fetch.
- The server identifies as a normal browser User-Agent. Do not revert
  to a bot UA — bot UAs get blocked by WAFs and the scan silently fails.
- `/api/scan` sets `Cache-Control: no-store`. Do not add CDN caching to
  the scan response; it served stale errors before.
- If robots.txt cannot be read, the scan returns an error. Never fall
  back to a guessed or partial score.

After any change to `api/scan.js` or the frontend JS, run
`node --check <file>` before committing.
When editing `index.html`, bump the `?v=` query on the `app.js`,
`scanner.js` and `styles.css` references — stale caches have broken
this project twice.

## Design system — "Confident Editorial"

Surface rhythm creates hierarchy. Never a single-background page.

| Token | Value | Role |
|---|---|---|
| `--bg` | #EEF1F5 | page background (cool light) |
| `--white` | #FFFFFF | panels: reports, cards |
| `--navy-950` | #0B1526 | emphasis plates and full-bleed bands |
| `--navy-900` | #10203B | nested block on navy |
| `--navy-800` | #17304F | icons, hover states |
| `--ink` | #14202E | primary text |
| `--ink-soft` | #4B5766 | secondary text |
| `--ink-faint` | #5F6B7A | metadata (4.5:1 or more on --bg and --white, since 14 Oct 2026) |
| `--line` | #D9DEE6 | borders |
| `--gold` | #C2922F | accent ink, primary CTA on key actions |
| `--gold-soft` | #E7C77C | gold on navy |
| `--gold-deep` | #85620F | gold text on light |
| `--ok` | #26704F (+ tint #E3F1EA) | pass states |
| `--risk` | #B04A3A (+ tint #F7E8E5) | fail states |

Type: **Gloock** (display, 400) for headlines, card names, big numbers ·
**Hanken Grotesk** (400–700) for body and UI · **Spline Sans Mono**
(400/500) for kickers, metadata, code, chips.

Rules: radius 10px (panels/cards) and 6px (buttons/inputs/chips) only.
One shadow token, panels and the answer-mock plate only. One transition:
150ms ease, on opacity/color/border only. Section headers are a short
uppercase mono kicker in gold plus a Gloock title.

The homepage header starts transparent-on-navy over the hero (white
wordmark, gold-soft nav links) and switches to the standard light
header, via a single scroll-triggered class swap, once the hero has
scrolled out of view. No JS means it stays navy — legible against the
hero and against the lighter sections below it. Every other page keeps
the light header always; don't extend the navy header treatment there.

The header is sticky, and scroll offsets come from its real height: `nav.js` keeps
`--header-h` on `<html>` equal to the pinned part (the whole header on wide screens, only
the logo row up to 700px, where the nav row scrolls away), and `html { scroll-padding-top }`
adds 16px to it. Never hand-tune an offset or add a `scroll-margin-top` for the header. A
share link (`/?scan=domain`) must work the same on every device, browser and in-app browser, so
nothing about it depends on scrolling. It opens at the top and the hero becomes the "Analyzing"
screen: the five stages tick one by one (each visible at least 700 ms, a stage done only when its
work is), a "Done" beat, then the hero fades out where it stands and the report takes its position
under the sticky header and fades in (the hero moves just below it), followed by the count-up. No
touch, scroll or key press interrupts it; a reader who has scrolled away gets a "See your score"
link. A failed scan shows its reason in the hero with a retry (rate limit, unreadable site, network,
a 25 s deadline); it is never blank. A form scan keeps the progress card and an eased scroll
(re-aimed every frame, stopped only by a clear scroll gesture) at a shorter pace. The pacing numbers
are the named constants in `PACING` in `scanner.js`; the real score is always in the DOM, every wait
pauses while the tab is hidden, and reduced motion or a back/forward visit skips the animation. The
reveal animates opacity only (the durations are `fadeMs`), the one place a transition runs longer than 150ms.

**Never:** gradients · numbered section headers (01/02/03) · hover
lift or scale · pill (999px) shapes · emoji in product surfaces ·
centered body text · cream or warm backgrounds · Inter, Fraunces,
IBM Plex, Space Grotesk, Sora, Manrope, DM Sans, Playfair, or
JetBrains Mono · more than one full-bleed navy band per page, apart from the footer (below) — except
the homepage, which has a navy hero field and no navy band mid-page since 13 Oct 2026 (the MCP and Pro bands were
retired). Every other page keeps the single-band rule. No fourth navy surface, and no new surface colour. **The footer** is the one
exception on every page: a full-bleed navy band (`--navy-950`) written by `lib/site-footer.js`
(`scripts/site-footer.js --check` is a gate: one footer everywhere, links only to pages that exist, none to
/changelog). The homepage "Beyond technical" block is a contained light panel, not a band, and the gold
commerce card never touches a coloured surface: 64px of light page on every side (48px on a phone).

**Gold:** `--gold` is a surface in two places only: the contained commerce
strip, and one full-bleed gold band, the citation teaser. The homepage no longer
carries the band (13 Oct 2026); it stays on `/citation-tracking`. Every word on the gold
band is solid `--navy-950`. Never translucent navy, `--gold-soft`,
`--gold-deep` or white on gold: reduced opacity on gold looks muddy,
most of all on mobile.

**One animation exception (the band left the homepage on 13 Oct 2026; `mcp-demo.js` is now unused, like `citation-matrix.js`):** the MCP band's conversation
types itself in once, on first view (`mcp-demo.js`), because it
demonstrates the product rather than decorating it. The content must
stay complete in the HTML, the replay must do nothing under
`prefers-reduced-motion`, and nothing else in that block animates. No
other section gets motion on this basis.

**The second and last exception:** the citation scatter. The "questions
everywhere" scene (`teaser-scene.js`, styles.css "Homepage teaser"): an
illustration, labelled as one, that loops for about 14s while it is on
screen and pauses when it is not. It runs, with the same
markup, classes and script, in the gold band on `/citation-tracking` (the homepage dropped its copy on 13 Oct 2026); there
is no second implementation of the loop. One `@keyframes` drives a registered
number (`--t`); cards, chips and the refresh icon derive their opacity or
rotation from it. Only opacity and transform change. No gradients, glow,
bounce, parallax or confetti. The static state is plain HTML, and nothing
animates under `prefers-reduced-motion`, without JavaScript, or without
`@property` support. There is no third exception. (The dot-matrix fill that
used to run on `/citation-tracking`, `citation-matrix.js`, is retired; the
file and its `.cm*` rules are unused.) The scatter shows no data. The data
on `/citation-tracking` comes from `content/citations/sample-crm.json` via
`scripts/generate-citation.js`, which writes the whole page; never type a
figure into it, and run `node scripts/generate-citation.js --check`.

## Gates and pushing

There are no "known failures". A red gate stops the push.

- `npm run gates` (`scripts/run-gates.js`) runs, in order: the integrity check (`npm run check:integrity`: every tracked `.js`
  compiles, every tracked `.json` parses, and every file at HEAD is byte-identical to the working tree), the `vercel.json`
  check against Vercel's schema (`npm run check:vercel`), every `generate-*.js --check`, `check-pages`, `check-mcp-drift`,
  `check-launch-config`, `check-research-index`, `site-chrome --check`, `capture-pro-shots --check`, and every `test-*.js`.
  Run it after committing (before committing, `node scripts/run-gates.js --precommit` compares the index instead of HEAD).
- Never trust a read right after a write on this machine (see the repository location note below). Stage with a check that
  two reads agree, and run the gates on the committed bytes.
- Push to `main` only with every gate green, never with force. Then run `npm run smoke` (`scripts/smoke-live.js`) **once, as the last step of
  a session** (not after every commit): it waits for the deployment of HEAD to be Ready and checks the live site (pages, MCP `tools/list`, the
  generic Pro 404s and their headers, the storage, nothing Pro in the sitemap, `robots.txt` or `llms.txt`). If a deploy fails or the smoke test
  fails, fix forward or revert with a normal revert commit at once. Lighthouse against production is also one final pass per session; use a
  local server for before/after comparisons.
- **Real email and live end-to-end runs only on request.** `node scripts/e2e-live.js`, and any test that sends a real email (Resend to
  `hey@getcitehound.com`), run ONLY when the owner explicitly asks for them in the prompt. Default verification is `npm run gates` plus the tests
  with the fake mail provider. A change that does not touch the mail flow never triggers an e2e run. Reason: the runs waste time, and the burst of
  automated traffic made Vercel answer 403 "Security Checkpoint" to this machine for about ten minutes (11 Oct 2026).
- `scripts/test-citation-live.js` makes real paid model calls: it is excluded from the gate glob, run it by hand only.
- `npm run test:real-kv` (`scripts/test-real-kv.js`) and `node scripts/e2e-live.js` need the Upstash credentials and write to the
  real database under a cleaned-up prefix or with cleaned-up keys. They are not in the gate list and run only when the owner asks
  (`e2e-live.js` also sends real email: see the rule above).

**Repository location.** This repository must not live inside iCloud Drive (`~/Desktop` and `~/Documents` can be synced). The
file provider returns stale or truncated reads right after a write, and that has corrupted commits: a truncated `vercel.json`
failed a production deploy, and a truncated `lib/pro-api.js` crashed the Pro function. Keep a clone outside any synced folder
(for example `~/dev/answerable`) and work there.

## Voice

Declarative editor voice. Short sentences. Numbers before adjectives.
Address the reader as a capable practitioner.

**Banned words:** quietly, actually, seamlessly, effortless, powerful,
unlock, elevate, supercharge, game-changing, revolutionize, landscape,
delve, crucial, robust.
**Banned construction:** "not just X, but Y".
Maximum one em dash per paragraph. US English. "Coming soon" is always
"In preparation".

Never invent statistics, testimonials, or client results. Where a number
is needed and unknown, leave a clearly bracketed placeholder.

## Playbook content rules

Playbook entries live in `saasData` (and equivalent objects for the other
two tracks) in `app.js`. Each entry is a JS object whose `content` is
concatenated single-quoted HTML strings.

Required structure, in order:
1. `<h3>The Strategic Shift</h3>` — two `<p>`, 140–190 words total.
   Paragraph 2 must contain a scanner bridge.
2. `<h3>Top 3 Actionable Strategies</h3>` — `<ul>` with exactly 3 `<li>`,
   55–85 words each, each opening `<strong>Imperative phrase.</strong>`
   At least one must name a scanner check by its exact report label.
3. `<div class="expert-tip expert-tip--aside">` — one `<p>`, bracketed
   placeholder, ends `<strong>This box is for your proprietary point of
   view.</strong>`
4. `<h3>Outdated SEO Pitfalls to Avoid</h3>` — `<ul class="pitfalls">`
   with exactly 4 `<li>`, 20–35 words each.
5. `<div class="expert-tip expert-tip--data">` — bracketed placeholder,
   ends `<strong>Replace with a sourced figure.</strong>`
6. `<h3>Expert Tip</h3>` + `<div class="expert-tip">` — bracketed
   placeholder, same closing sentence as (3). Always last.

**Scanner bridges** may only reference these exact report labels:
"AI crawler access", "Sitemap declared", "Canonical tag", "Structured
data (JSON-LD)", "Organization / WebSite schema", "Content schema
(Article, FAQ…)", "Author / about signals", "Contact signals", "Single H1
heading", "Subheading structure (H2)", "Meta description",
"robots.txt present", "Page title", "Open Graph tags".

**Escaping:** every apostrophe is `\u2019`, every em dash `\u2014`.
No raw apostrophes inside single-quoted strings. Emit literal HTML tags
inside the strings — do not convert them to plain text.

**Citation sources per track:**
- SaaS → G2, Capterra, TrustRadius, Gartner Peer Insights, PeerSpot,
  vendor docs, relevant subreddits, Stack Overflow, Hacker News.
- Brands → Trustpilot, marketplace listings, Reddit and UGC, shopping
  and comparison queries, Product/Review schema.
- Professionals → Google Business Profile, profession directories
  (Avvo, Zocdoc, Healthgrades, Houzz, The Knot), local press, client
  testimonials, LocalBusiness schema.

Never fill an expert-tip placeholder. Those are the owner's, by design.

## Working style

- Prefer many small commits over one large one. Each commit should leave
  the site deployable.
- Write conventional, plain commit messages describing the change.
- When a task is ambiguous, ask once, then proceed.
- When something would spend past a free allowance, break a constraint above, or make a
  claim the product cannot support, say so instead of doing it.

- **Text contrast is WCAG AA everywhere (14 Oct 2026).** Normal text 4.5:1, large text 3:1, on the real background it sits on. The tokens `--ink-faint`, `--gold-deep` and `--ok` were
  darkened to meet it on `--bg`, `--white` and their tints; `scripts/test-contrast-scope.js` checks the token ratios and that no band style leaks into a shared selector.
  Decorative `aria-hidden` watermarks (the page banner number and code) are exempt. A navy band's styles use their own class, never a class another page already uses.

- **Pricing (15 Oct 2026, owner's brief).** Early-access prices, USD: Scan free; Pro $39 a month or $390 a year (first month free for the first 10 early-access users); Fix from $299 (fixed
  quote after the scan, includes 3 months of Pro, 14 days of corrections); Beyond $490 a month, 3-month minimum, limited seats, includes Pro. They live in `content/pricing.json` and are written by
  `lib/pricing.js` into `/pricing`, the homepage section (between `PRICING:START` and `PRICING:END`), the hero price lines on /pro, /fix and /beyond and the ladder cards; edit the JSON, run
  `node scripts/generate-pricing.js` and the other generators; `generate-pricing.js --check` is a gate. "Early-access pricing. Payments open soon, reserve your spot." No checkout, no payment button,
  no crossed-out or "was" price: the four buttons are Scan free, Join the Pro waitlist, Request a Fix quote and Apply for Beyond (the waitlist link and the two request forms). Never write: automatic CMS
  connectors, "tracks all AI engines", ranking, share of voice, unlimited. **Engines:** the copy says "Claude (ChatGPT coming)" (`engines` in `content/pricing.json`) until `OPENAI_API_KEY` and
  `CITATION_OPENAI_ENABLED=1` are set in production; then change it and regenerate. Weekly re-scans and email alerts are named as part of Pro early access and are NOT built. The one paragraph that says what the
  scan measures and what Pro adds is `measure` in the same file (FAQ, /pricing, the waitlist mail, llms.txt); research pages keep their readiness-only wording.
- **The pricing page and the dollar sign (15 Oct 2026, second pass).** `/pricing` is written by `scripts/generate-pricing.js` from `content/pricing.json` (`page` holds the hero, the step finder, the screens, the comparison table, the
  timeline, the proof band, the three reasons and the offer): hero, "which step", the staircase (smaller lockups, an outcome and a "Best for" line on each card), screens in tabs (real screenshots from `assets/tour/`,
  `free-scan.webp` is a real scan of getcitehound.com made by `scripts/capture-tour.js`), a comparison table, four numbered steps, a navy proof band, three reasons, the offer, the FAQ and the closing call. The homepage
  pricing block sits just above the footer; the ladder cards under the intro keep their price lines. The "$" is always `<span class="cur">$</span>` (`lib/pricing.js` `cur()`): UI sans, half size, top of the numerals,
  real text; the display serif draws a bare "$" like an "S". No founder name or biography, no testimonial, rating, logo or countdown on the page; the proof numbers are the case study's and the sample report's own.
- **The /claude page (22 Oct 2026).** `claude.html` is written by `scripts/generate-claude-page.js` (never by hand): how to connect the remote MCP server to Claude, Claude Code, Cursor and VS Code, eight example prompts, the tools table, one short "what it does not do" paragraph and a four-question FAQ. The address, the tool names, the read-only marks and the count come from `api/mcp.js`; the one-line descriptions from `content/mcp-copy.json`. Setup steps appear only if the vendor's documentation states them (checked 22 Oct 2026; no Cursor menu path, no VS Code JSON). The copy buttons are `claude.js`. The page never recommends, ranks or promises, names no integration that does not exist, claims no directory listing before it is approved, and says "works with Claude" only descriptively; `--check` greps for those words and is a gate. The homepage MCP button, the footer, the sitemap and llms.txt point here.
- **The legal pages (22 Oct 2026).** `terms.html` and `privacy.html` are hand-written; `refunds.html` is written by `scripts/generate-refunds.js`. They describe the paid plans as sold (prices from `content/pricing.json`, Pro only as what exists today, weekly re-scans named as not yet part of it), refunds (14 days on the first Pro payment; the Fix, Beyond and cancellation lines are the owner's defaults to confirm) and the data flows found in the code (workspaces 400 and 90 days, reports and orders 90 days, the waitlist 12 months; Upstash, Resend, Anthropic, Vercel). The one outcome sentence, "Citehound makes no guarantee about citations, traffic, rankings or revenue.", is on `/terms` once and nowhere else. The pages have had no lawyer's review: the facts only the owner knows are square-bracket blanks, and `scripts/test-legal-pages.js` (a gate) checks the text against the code and the pricing file and lists the blanks.
- **The GitHub Action (23 Oct 2026).** `citehound-action/` is the source of an Action meant to live in its own public repository (`action.yml`, a dependency-free `index.js` on node24, README, MIT licence, an example workflow); it is in `.vercelignore` and not part of the site. It calls one endpoint, `GET /api/action-scan?domain=` (a rewrite to `api/scan.js` with `client=action`, so the function count stays 11), implemented in `lib/action-scan.js`: it answers only a User-Agent that starts with `Citehound-Action/`, runs the same `scanPage()` as everything else (no scoring of its own), returns a compact summary and has its own limits in `lib/action-limits.js` (the same domain 4 times an hour, one address 60, everyone 200; hashed keys, one-hour TTL, fails open). The web scanner's terms keep forbidding automated use of the web interface; the Action is the sanctioned automated route. `scripts/test-action-scan.js` is a gate and runs the Action against a local copy of the endpoint. The Action sends the domain and nothing else.

