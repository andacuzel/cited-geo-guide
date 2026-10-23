# Design brief: "The Doorway" (23 Oct 2026)

## Audience
Site owners, marketers and developers who want to know whether AI assistants can reach and read their site. They are capable practitioners and short of time. Most arrive with a domain in mind.

## The one promise of the homepage
"See how AI reads your site. Then fix it." The scan is free, needs no email and takes about 30 seconds. The headline, the scan input and the proof (a real report) are all in the first screen.

## Tone
An experienced practitioner talking plainly. Short sentences, numbers before adjectives. No outcome promises, no invented proof. The score measures readiness, not whether any assistant names a brand (docs/integrations/RULES.md).

## What "persuasive" means here
1. Clear value in five seconds: headline, one sentence, the scan input.
2. Proof is the product itself: a faithful report preview from a real scan of our own site (dated), the methodology, the real sample report and the demos.
3. A visible free-to-paid ladder: Scan (free), Pro, Fix, Beyond, with the real tier matrix and prices from `content/pricing.json` and `docs/integrations/TIERS.md`.
4. Persuasion comes from structure, scale and clarity, never from invented claims, logos, ratings or counts.

## Art direction
Direction chosen from the design-taste tool's three deals: **one motif**. The subject's own object is the doorway: robots.txt is the door each AI crawler stands at (open, limited, blocked). The arch (a doorway) runs the system:
- the new mark: an arch with a door ajar;
- the score gauge is an arch; each of the ten crawlers is a small door in its state;
- list markers, the "how it works" cards (arch-topped) and the closing field.

Idea sentence: on this page, **the robots.txt door** becomes **the one motif that draws the score, the crawler states and the steps**. Competitor test: another scanner could not use "ten doors" without it being ours only by habit; the live thing is the scan itself.

Colour: paper ground `#F4F4F0`, ink `#0E1B2C`, white panels, one door-orange accent `#F05A28` used as flat fields and primary buttons with ink text (5.1:1). Status colours (green, amber, red) are for status only. Orange text on light uses `#B23A10` (5.4:1).
Type: Bricolage Grotesque (display, 700 to 800, OFL, self-hosted), Hanken Grotesk (text), Spline Sans Mono (code and data only).
Rules: flat colour, no gradients, one shadow token, radius 8 to 24 and the arch, focus rings 3px orange, motion is opacity and transform only and respects `prefers-reduced-motion`.

## Constraints kept
No third-party requests; fonts self-hosted; CSP and security headers unchanged; zero cookies; no JavaScript framework or build step; every URL, canonical, heading, JSON-LD, sitemap, llms.txt, robots.txt, meta tag and the Vercel Web Analytics script stay.

## Skills used (third party, untrusted, read before use; copied into ~/.claude/skills, not into the repo)
- design-taste-frontend (taste-skill): used `draw.mjs` (local) to deal directions, its house rules and look loop as guidance. Skipped: `assets.mjs` (searches Openverse and museum APIs over the network) and the dealt picsum.photos stock photo URLs (no third-party images).
- ui-ux-pro-max: local search scripts only (no network). Used for accessibility and UX rule checks.
- design-motion-principles: documents only. Used for the motion pass, restraint weighting (marketing page: Jakub primary, Emil for forms and nav).
- awesome-claude-design: read the README for inspiration only; no DESIGN.md was fetched or copied (they are hosted on a third-party site) and no brand is imitated.
