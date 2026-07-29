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
- **Zero paid dependencies.** Vercel Hobby, free tiers only. If a change
  would incur cost, stop and say so instead of implementing it.
- **No secrets in the repo.** Environment variables only.
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

**Never:** gradients · numbered section headers (01/02/03) · hover
lift or scale · pill (999px) shapes · emoji in product surfaces ·
centered body text · cream or warm backgrounds · Inter, Fraunces,
IBM Plex, Space Grotesk, Sora, Manrope, DM Sans, Playfair, or
JetBrains Mono · more than one full-bleed navy band per page.

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
- When something would cost money, break a constraint above, or make a
  claim the product cannot support, say so instead of doing it.
