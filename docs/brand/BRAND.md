# Citehound brand guide

Version 23 Oct 2026. Machine-readable twin: `brand/brand.json`. Words follow `docs/integrations/RULES.md`; where this file and RULES.md differ, RULES.md wins.

## 1. Brand idea and positioning

Citehound is a free scanner that shows whether AI assistants can reach and read a website, and a paid ladder (Pro reports, Fix, Beyond) for the people who then want the work done. The score measures readiness: crawler access and on-page signals. It does not measure whether any assistant recommends, cites or names a brand, and no Citehound image, video or post may suggest that it does. The tone is that of an experienced practitioner: plain, specific, numbers before adjectives. The mark is a greyhound head, a sighthound: a quiet nod to looking, never a promise that the product "hunts" or "finds" anything.

Boilerplate (one sentence, `lib/about-line.js`): "Scan, fix and write for the way AI answers."

## 2. Logo

**The hound is the only brand mark.** Variant B of `docs/redesign/logo-options.png`: the original greyhound silhouette redrawn in the language of Bricolage Grotesque (rounded corners, a round-joined stroke for weight, a larger ear and eye so it reads at 16 px). Orange eye on the full-colour version.

Files (`assets/brand/`, SVG first; PNG exports in `assets/brand/png/`):
- mark: `logo-mark.svg` (full colour on light), `logo-mark-dark.svg` (on ink), `logo-mark-mono.svg` (one colour, `currentColor`, eye cut out), `logo-mark-white.svg`, `logo-mark-orange.svg` (flat orange fill, for large crops)
- horizontal lockup: `logo-lockup*.svg` (same four colourways); stacked: `logo-stacked*.svg`; wordmark alone: `logo-wordmark*.svg`
- badge (avatars, app icons): `logo-badge.svg` (white hound on ink), `logo-badge-light.svg`; the favicon is the badge
- the wordmark is outlines of Bricolage Grotesque 800 with tracking -0.04 em; do not retype it

Clear space: the height of the hound's ear (about a quarter of the mark's height) on every side. Minimum size: the mark 16 px, the horizontal lockup 96 px wide, the stacked lockup 64 px wide. Below 24 px use the badge, not the bare mark.

Do: ink or white on a plain flat ground; the full-colour mark on paper (#F4F4F0) or white; one-colour versions on photographs or busy grounds; the badge for square avatars.
Don't: add a door, arch or any second symbol next to the hound; recolour the eye or the body; outline, shadow, glow or gradient the mark; stretch, rotate or crop it; put the wordmark in another typeface; place the mark in a coloured box that is not ink, paper or white; use the old (pre-redesign) mark.

**The door rule.** The door (an arch with a door ajar) is not a brand mark and never appears next to the wordmark as a logo, in an avatar, a favicon, a share image headline position or a listing icon. It stays only as a functional UI or illustration icon where it carries meaning: the state of an AI crawler at the robots.txt door (open, limited, blocked) in the scan report and the home report preview, and explanatory illustrations of how crawler access works. Draw it in the hound's stroke language: round joins, a 1 unit stroke in its own colour, flat fills, status colours only (green open, amber limited, red blocked). Never use it decoratively.

## 3. Colour

| Name | Hex | Use |
|---|---|---|
| Ink | `#0E1B2C` | text, dark fields, the mark on light |
| Paper | `#F4F4F0` | page ground |
| White | `#FFFFFF` | panels, the mark on ink |
| Door orange | `#F05A28` | the one accent: flat fields, primary buttons (ink text on it, 5.1:1), the hound's eye |
| Orange on light | `#B23A10` | orange text on paper or white (5.4:1) |
| Orange on ink | `#FFAE92` | orange text on ink |
| Ink 2 | `#15263B`, `#1F3552` | nested dark blocks |
| Soft text | `#435064`, `#566376` | secondary text and metadata on light |
| Open / limited / blocked | `#1B7A4E` / `#E0A100` / `#B42318` | status only, never decoration |

Flat colour only: no gradients, one soft shadow token on panels. Text meets WCAG AA (4.5:1, 3:1 for large text). Orange is a field or a button, not a text colour on light grounds.

## 4. Type

- Display: Bricolage Grotesque, weights 700 to 800, tracking -0.03 to -0.045 em, line height 0.98 to 1.1. Headlines are two or three lines.
- Text: Hanken Grotesk 400 to 700, 17 px body, line height 1.6.
- Code and data: Spline Sans Mono, only for code, addresses and tables.
- All three are open-licence (SIL OFL) and self-hosted in `assets/fonts`. Do not use other typefaces, and no tiny uppercase letter-spaced labels.

## 5. Visual language

- UI-led: show the real product. The honest pictures are the scan report (score, three pillars, ten crawler doors, failed checks with fixes), the sample report at `/sample-report` (a real crawl of our own site, dated), the Fix and Beyond demos (`/demo/fix`, `/demo/beyond`, fictional data, labelled "Product demo · Sample data") and `llms.txt`, `robots.txt` and JSON-LD snippets being generated. No stock photos, no people, no invented dashboards.
- Every number on an image comes from a real source and carries its date (for example, a scan of getcitehound.com on 23 Oct 2026: 87 out of 100; 27/40, 20/20, 40/40). If there is no real number, show none.
- Grid: 8 px base; 1180 px content width on the web; generous space (sections 72 to 112 px apart). Cards: radius 14 to 24 px, buttons 12 px. Arch-topped cards are layout only.
- Iconography: the Lucide-style stroke icons already on the site (1.5 px, round caps) and the crawler doors. No emoji, no third-party logos.

## 6. Motion

From the design-motion-principles audit (marketing weighting: polish first, restraint for anything used often):
- Frequency first: nothing that is used many times a day animates (nav, forms, buttons beyond a 1 px press).
- Entrances once per view: 520 to 1100 ms, `cubic-bezier(0.22, 1, 0.36, 1)`, opacity plus a 12 to 40 px rise or a scale from zero for bars; stagger 60 ms. Feedback 150 to 220 ms.
- Only opacity and transform (plus one SVG stroke draw for the gauge). No bounce, parallax, glow, confetti or looping decoration.
- Reduced motion: every move sits inside `prefers-reduced-motion: no-preference`; reduced motion gets the final static state.
- In video: cuts and 300 to 500 ms eased moves; a score gauge draws once; crawler doors arrive in turn; no shaking, no whooshes.

## 7. Tone of voice

Natural practitioner voice: short declarative sentences, concrete nouns, numbers before adjectives, US English, "In preparation" instead of "coming soon".

Use: "The scan reads your robots.txt, sitemap and homepage." "Ten AI crawlers, three pillars, sixteen checks." "A readiness score." "Here is what stands in the way." "Free, no email."
Avoid: quietly, actually, seamlessly, effortless, powerful, unlock, elevate, supercharge, game-changing, revolutionize, landscape, delve, crucial, robust; "not just X, but Y"; hype, exclamation marks, urgency, scarcity.

Hard limits (RULES.md):
1. The score measures readiness. Never say or imply that an assistant recommends, cites, ranks or names a brand because of a score or a fix. The citation check, where it exists, is a dated sample with its model named.
2. No outcome promises about traffic, rankings, citations or revenue. The one disclaimer sentence lives only on `/terms`.
3. No invented numbers, testimonials, logos, ratings, user counts or faces of real people. The AgaOne quote appears only as on the case study page.
4. No "official", "verified" or "partner" (the one exception: "official" for our own GitHub Action). No third-party logos. Third-party names only descriptively ("works with Claude").
5. Only live integrations are described as available. Payments are "our payment provider"; no provider is named.
6. llms.txt is "optional, low-cost, no demonstrated effect on Google".

## 8. Video guidelines

- Aspect ratios: 16:9 (YouTube, site), 9:16 (Shorts, Reels, TikTok, stories), 1:1 (feed). Keep titles inside the middle 80 percent; in 9:16 keep text out of the top 250 and bottom 340 px of 1080x1920.
- Hook in the first 3 seconds: a real question or a real screen ("Can AI read your site? Scan it.") not a logo sting. The hound and wordmark appear in the last 2 seconds or as a small corner bug.
- Length: Shorts, Reels, TikTok 15 to 30 s; X and LinkedIn 20 to 45 s; YouTube explainer 60 to 120 s; product walkthrough up to 4 min.
- Captions always, burned in or uploaded, in the brand type, high contrast; the video must make sense muted.
- Sound: restraint. Quiet, unobtrusive music or none; no voice clones of real people; no sound effects that imply a result.
- Label AI-generated or synthetic content where the platform asks for it (YouTube's altered or synthetic content disclosure, TikTok's AI-generated label, Meta's AI info label). Real screen recordings of the product need no label; a generated scene does.
- Show real product moments only: a scan running, the report, the crawler matrix, a file generated. Never a made-up result.

## 9. AI video and image prompt kit

### Style block (paste at the start of any text-to-video or text-to-image prompt)

> Flat, clean product-UI aesthetic. Colours only: ink navy #0E1B2C, paper off-white #F4F4F0, white, one orange accent #F05A28; status colours green #1B7A4E, amber #E0A100, red #B42318 used only for status. Typography: heavy geometric grotesque headlines (Bricolage Grotesque style) and a clean humanist sans for text. Flat fills, rounded corners, no gradients, no glow, no 3D, no photographs, no people. Calm, precise, practitioner tone. Smooth eased motion, no shaking, no fast cuts.

### Negative constraints (always add)

> No invented numbers or scores on screen except the ones given in the prompt. No real company names, product names or logos. No fake testimonials, reviews, star ratings or user counts. No faces or likenesses of real people. No chatbot windows showing a brand being recommended or cited. No claims about traffic, rankings or revenue. No text other than the exact text given. Keep the colours and fonts above; do not add other brand colours.

### Ten scene prompts (real product moments)

1. **Scanning a domain.** "A white input field with the text yourdomain.com and an orange button Scan free on an ink background. The button is pressed; five short steps tick one by one (robots.txt, sitemap, llms.txt, homepage, score). Orange progress, calm."
2. **The score gauge.** "A flat white card on ink. A half-circle gauge in orange draws from the left to 87 percent over one second while the number 87 rises, with the text out of 100. Three thin bars below labelled Discoverability 27/40, Technical foundation 20/20, Content and trust 40/40."
3. **The crawler matrix.** "Ten small door icons in a row on a white card, each with a round-joined dark frame; the doors appear one after another. Each shows a state: one open (green), one with the door ajar (amber), one shut (red). Caption: Ten AI crawlers at the robots.txt door."
4. **An llms.txt being generated.** "A dark code panel, monospace text typing a short llms.txt: a title line, one sentence, then a list of three page links. A small caption below: llms.txt is optional. No numbers."
5. **A robots.txt fix.** "Split screen: left a robots.txt with one line highlighted in red, right the corrected file with the line in green. A small Copy button in orange. Text only from the files, no brand names."
6. **JSON-LD pasted into a page.** "A code panel with a short Organization JSON-LD block; a cursor selects it, copies, and a browser head element on the right receives it. Flat, ink and white."
7. **The fix list.** "A list of three failed checks on a white card, each with a one-line fix and a small points badge; a check mark turns each green in turn. Title: What to fix first."
8. **Compare two sites.** "Two input fields, yourdomain.com and otherdomain.com, then a side-by-side result with two gauges and only the differences listed. Use placeholder gauges without numbers."
9. **Ask Claude through the MCP server.** "A clean chat window with a user message Scan example.com and tell me what to fix first, a small tool-call chip citehound scan_site, then an answer card. Show no real brand logo; the assistant is a generic window."
10. **The hound sign-off.** "The white Citehound hound mark with an orange eye and the wordmark Citehound on ink, fading in over half a second, with the line Scan, fix and write for the way AI answers. Nothing else."

## 10. Twelve content series

Every claim below is on a Citehound page: the scan and methodology (`/methodology`), the benchmarks (`/benchmarks`), the research (`/research`), the sample report (`/sample-report`) or the tools. Check the page before you post and quote its date. Template for each: **X** (one post of up to 280 characters, one image) and **LinkedIn** (a short post: hook line, three short lines, the link).

1. **One check a week.** One of the 16 checks explained (what it reads, why it matters for readiness, how to fix). X: "Check of the week: [name]. It looks at [what]. Pass: [rule]. Fix: [one line]. Scan yours free: getcitehound.com" LinkedIn: the same in four lines plus a link to the playbook or tool.
2. **Ten doors.** One AI crawler per post and what a robots.txt rule does to it (the ten tracked ones are listed on the scan). X: "[Crawler] reads robots.txt like this: [rule] means [state]. Check your ten: getcitehound.com" Never say what any assistant then does with the site.
3. **Score anatomy.** The three pillars and their weights (Discoverability 40, Technical foundation 20, Content and trust 40). X: "The score is out of 100: 40 for discoverability, 20 for technical foundation, 40 for content and trust. It measures readiness, not rankings." LinkedIn: one pillar per post.
4. **The benchmark.** Category averages from the benchmark of 219 sites (average 73 out of 100; categories on `/benchmarks`). X: "We scanned [n] [category] sites. Average readiness score: [x]. Method and data: [link]." Quote the page's own date.
5. **Our own score, in public.** The sample report: our site scanned twice, before and after, nothing edited (`/sample-report`). X: "We scanned our own site, fixed what it found and scanned again. Both results are published as they came out." Numbers only as the page states them.
6. **llms.txt, honestly.** What `llms.txt` is, that it is optional and has no demonstrated effect on Google, and what our adoption study counted (`/research/llms-txt-adoption-2026`). X: "llms.txt is optional. We counted who has one: [figure from the study]. No demonstrated effect on Google."
7. **Crawler access study.** One finding per post from `/research/crawler-access-2026`, with its date and sample.
8. **Fix of the day.** A before and after of one real file (robots.txt, JSON-LD, llms.txt) from our own site or the sample report. Show the diff, no result claim.
9. **From the tools.** One free tool per post: the robots.txt generator, schema generator, llms.txt checker, compare. X: "Free tool: [name]. Paste [input], get [output]. Runs in your browser: [link]." Use "Runs in your browser" only for tools that carry that chip.
10. **Ask Claude.** One example prompt for the MCP server per post ("Scan example.com and tell me what to fix first"), with the real tool name. State that it is free and read-only.
11. **Method notes.** One line of the methodology per post (what a check reads, what it does not). Always include: the score measures readiness.
12. **Changelog.** One real shipped change per post from `/changelog`, one factual sentence, with the date.

## 11. The brand prompt (paste into any AI tool)

> You write and design for Citehound, a free scanner that shows whether AI assistants can reach and read a website, with paid Pro reports, Fix and Beyond services. Brand: the greyhound-head mark (the only logo), the wordmark Citehound in Bricolage Grotesque 800, ink navy #0E1B2C, paper #F4F4F0, white, one orange accent #F05A28; text in Hanken Grotesk; flat colour, rounded corners, no gradients, no photos, no people, no emoji. Show the real product (score gauge, three pillars, ten crawler states, fix lists, generated files) and only numbers that were given to you. Voice: an experienced practitioner, short declarative sentences, numbers before adjectives, US English. Hard limits: the score measures readiness, never claim an assistant recommends, cites or names a brand; no promises about traffic, rankings, citations or revenue; no invented numbers, testimonials, logos, ratings or user counts; no words official, verified or partner; never name third-party products except descriptively; llms.txt is optional with no demonstrated effect on Google. Do not use: quietly, actually, seamlessly, effortless, powerful, unlock, elevate, supercharge, game-changing, revolutionize, landscape, delve, crucial, robust. Label AI-generated video or images where the platform requires it. If a fact is missing, leave a bracketed placeholder instead of inventing one.

(Copy for pasting: `brand/brand-prompt.txt`.)

## 12. Files and scripts

`assets/brand/` logos, favicon, share images (public). `brand/social/`, `brand/listing-icons/` the packs (repository only). `scripts/brand/build_logo.py` (SVG logo set), `scripts/generate-brand-assets.js` (PNG set, icons, listing icons, social), `scripts/generate-og.js` (share images), `lib/og.js` (which page gets which image), `scripts/apply-og.js` (tags). `/brand` is the public press kit.
