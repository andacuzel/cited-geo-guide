# Craft pass, art direction (18 Nov 2026)

A bounded finishing pass on the front end. Tag `pre-craft-pass` is the rollback point (main at a1818ee, the commit that was live).

## Method and what was refused

The `awwwards` skill (github.com/tponscr-debug/claude-skill-awwwards) was installed at project scope in `.claude/skills/awwwards` (untracked, not committed), and SKILL.md plus all seven reference files were read in full before use. It is used as inspiration, never as authority. Nothing in it asks to run commands, fetch remote code or send data. Its README suggests editing `~/.claude/CLAUDE.md`: not done.

Used: fluid type with `clamp()`, balanced headings and `text-wrap: pretty`, tabular figures for data, varied section rhythm, CSS scroll-driven reveals, a cross-document view transition, focus and press states, reduced-motion first.

Refused, and why (the repository rules win):
- GSAP, ScrollTrigger, Lenis, SplitType, Three.js, shaders, particles, post-processing: no library, no scroll hijacking, no WebGL (owner's rule; zero third-party code).
- Custom cursor, scroll-velocity effects, parallax: not used.
- Gradients (mesh, gradient text, animated gradient border): the brand is flat colour, no gradients anywhere.
- Hover lift (`translateY(-2px)`) on cards, glass cards, elastic or back easings, looping glows: BRAND.md section 6 forbids lift, bounce and glow.
- "Never pure white or black": the brand uses white for panels and ink for text, so kept as defined in BRAND.md.
- Dark-first, oklch palettes, new accent colours: the palette is fixed by BRAND.md.
- Uppercase letter-spaced labels: BRAND.md bans them.

## Direction

Same brand, finished better. Paper ground, ink fields, one orange accent, Bricolage Grotesque for display, Hanken Grotesk for text, Spline Sans Mono for code only. Two families for reading (display and text); mono stays for code, addresses and tables.

1. Type. Display headlines get a little more leading (the tight 0.96 to 1.0 let descenders touch the next line), balanced line breaks, one tracking value. Small data (scores, points, prices in tables) uses tabular figures. The free-scan report drops the mono it used for labels and meta (BRAND.md: mono for code only) and the crawler rule text gets readable contrast on navy.
2. Rhythm. The hero meets the first white band directly instead of leaving a stray strip of paper. A light section that follows a band gets more air before it; related sections (audiences, research) sit closer. Not every gap is 88 px any more.
3. Hierarchy. Cards that are links stop underlining every line: the title carries the link and underlines on hover. Page banners no longer touch the sticky header.
4. Motion. Only opacity and transform, only inside `prefers-reduced-motion: no-preference`, no replay button, nothing that cannot be ignored. Scroll reveals extend to the text of each plan, the pricing steps, the how-it-works steps and the tool steps. Page changes cross-fade and the new page rises 10 px. The animated step chips on the home agent panel keep their text colour fixed, so contrast never dips mid-animation.
5. Detail. Press, focus and hover states share one set of timings; link underlines share one offset and thickness. The robots.txt generator was missing its container wrapper and ran to the viewport edge: fixed. The home crawler row was a `<ul role="img">` (invalid): now a labelled image group.

## Not changed

Copy, headings' meaning, information architecture, colours, logo use, claims, schema, canonical tags, llms.txt, sitemap, CSP and security headers, claude-plugin/. No new functions, no new scripts for the page, no fonts added.

## Gates (measured before and after, local static server, Lighthouse mobile, median of 3)

Results are in `RESULTS.md` next to this file; screenshots at 375, 768 and 1440 px are in `before/` and `after/`. Screenshots are the static (reduced-motion) state, so scroll-revealed content is visible; the motion itself is reviewed in a live browser.
