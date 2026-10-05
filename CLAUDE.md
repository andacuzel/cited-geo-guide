# CLAUDE.md — Answerable

Project memory. Read automatically at the start of every Claude Code
session. Everything here is binding unless the user overrides it in the
current session.

---

## What this project is

**Answerable** — a free AI-visibility scanner. A user enters a domain;
a Vercel serverless function fetches that site's public robots.txt,
sitemap.xml and homepage, scores it out of 100 across three weighted
pillars, and returns a prioritized list of fixes.

Positioning: the scanner that hands you the fix, not just the finding.
Free tier gives the full diagnosis plus copy-paste fixes. A one-time
purchase Pro tier (no subscription) gives personalized interpretation,
competitor comparison, and score history.

Three audience tracks, one engine: B2B SaaS (`/for-saas`), consumer and
e-commerce brands (`/for-brands`), local and independent professionals
(`/for-professionals`).

**Honest framing, non-negotiable:** this tool measures AI *readiness*
(crawler access and on-page signals), not confirmed presence in AI
answers. Never write copy that claims to measure what a model actually
says about a brand. Precision here is a credibility asset.

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
  - **Gemini citation tracking** (`scripts/citation-check.js`): needs a
    billing-enabled Google Cloud project, because Google Search grounding
    is not available on the free tier. Grounding is billed per search
    query beyond 5,000 free per month, shared across Gemini 3.x models
    (Google pricing page, checked 2 Oct 2026). It is therefore OFF unless
    `--grounded` is passed, the script keeps a local query ledger and
    stops at the free allowance, and a spend cap must stay set in Google
    Cloud. Ungrounded runs stay on the free tier.
  - **Vercel** moves from Hobby to a paid plan when payment goes live.
    That is planned, not a violation. Until then, keep within Hobby limits
    (12 functions, current count 9 non-underscore).
- **No secrets in the repo.** Environment variables only.
- **Report summaries.** The executive summary of a crawl report is written
  from aggregated figures only (`lib/report-facts.js`), by rules or by a model
  that only rephrases them, and every model reply is validated against the
  facts (`lib/summary.js`). No page content, URL or domain goes to the model.
  `privacy.html` says so; keep both in step. Do not send anything else.
- **Pro screenshots are generated.** The crops of the dashboard on `/pro` and in
  the homepage Pro band (including the Citations tab with the published CRM sample)
  come from the sample data and the real renderer; rerun
  `scripts/capture-pro-shots.js` whenever the dashboard changes, then
  `scripts/generate-pro.js`.
- **One texture, one place.** The homepage Pro band carries one SVG-pattern field
  of page glyphs, partial and hard-edged, in a lighter navy zone (`--navy-900`),
  built from a `<pattern>` and never a gradient. No other surface may use it, and
  no CSS gradient function appears anywhere in the stylesheet.
- **Never pair two scores with an arrow.** It reads as a score drop. The Pro band
  shows no scores; the page shows the homepage and whole-site scores side by side.
- **Never hardcode the host.** New code reads the address from `site.config.json`
  (through `lib/site-config.js`), so `scripts/set-domain.js` can move the site in one
  command. A literal old-host URL needs a rule in `config/domain-rules.json`.
- **Counts come from registries.** Tool, prompt, check, vertical and page counts are
  derived from their registry (`api/mcp.js` TOOLS and PROMPTS, the scanner's check
  list, `lib/playbooks.js`), never typed. Every new MCP tool is added to the registry,
  the harness, `mcp.html` (`scripts/generate-mcp-docs.js` fills the new ones) and
  `scripts/generate-mcp-submission.js`, which stops if a tool has no example.
- **Changelog entries come from real commits.** `content/changelog.json` lists only
  what a visitor or an MCP user can see, one plain factual sentence per entry, with
  the commit hashes as refs. `scripts/generate-changelog.js --check` fails on a ref
  that is not a commit or a date that is not the newest ref's date.
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
| `--ink-faint` | #87909C | metadata |
| `--line` | #D9DEE6 | borders |
| `--gold` | #C2922F | accent ink, primary CTA on key actions |
| `--gold-soft` | #E7C77C | gold on navy |
| `--gold-deep` | #97701F | gold text on light |
| `--ok` | #2E7D5B (+ tint #E3F1EA) | pass states |
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

**Never:** gradients · numbered section headers (01/02/03) · hover
lift or scale · pill (999px) shapes · emoji in product surfaces ·
centered body text · cream or warm backgrounds · Inter, Fraunces,
IBM Plex, Space Grotesk, Sora, Manrope, DM Sans, Playfair, or
JetBrains Mono · more than one full-bleed navy band per page — except
the homepage, which has a navy hero field plus two navy bands mid-page
(the MCP announcement, then Pro). Every other page keeps the
single-band rule. No fourth navy surface, and no new surface colour.

**Gold:** `--gold` is a surface in two places only: the contained commerce
strip, and one full-bleed gold band, the citation teaser. That band sits
directly after the capabilities block on the homepage and is reused,
markup and classes unchanged, once on `/citation-tracking`. Every word on the gold
band is solid `--navy-950`. Never translucent navy, `--gold-soft`,
`--gold-deep` or white on gold: reduced opacity on gold looks muddy,
most of all on mobile.

**One animation exception:** the MCP band's conversation on the
homepage types itself in once, on first view (`mcp-demo.js`), because it
demonstrates the product rather than decorating it. The content must
stay complete in the HTML, the replay must do nothing under
`prefers-reduced-motion`, and nothing else in that block animates. No
other section gets motion on this basis.

**The second and last exception:** the citation scatter. The "questions
everywhere" scene (`teaser-scene.js`, styles.css "Homepage teaser"): an
illustration, labelled as one, that loops for about 14s while it is on
screen and pauses when it is not. It runs on the homepage and, with the same
markup, classes and script, in the gold band on `/citation-tracking`; there
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
