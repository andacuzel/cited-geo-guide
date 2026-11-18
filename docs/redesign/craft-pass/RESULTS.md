# Craft pass, results (18 Nov 2026)

Rollback tag: `pre-craft-pass` (main at a1818ee, which is what was live). Direction and what was refused: `DIRECTION.md`.

## What changed

All of it is one marked block at the end of `styles.css` ("Craft pass", stylesheet version 105 to 106 on every page and generator), plus three markup fixes:

- Type: display headlines 0.96 to 1.0 leading raised to 1.05 (descenders touched the next line), one tracking value, `text-wrap: balance` on headings and `pretty` on paragraphs, tabular figures for scores, points and table cells.
- Rhythm: the hero meets the first white band (a 88 px strip of paper between them is gone), more air before a light section that follows a band and before the pricing block, less between related sections, banners no longer touch the sticky header, chips and generator on tool pages spaced.
- Hierarchy: research cards underline the title on hover, not every line; the comparison table has a readable header row and a hover row; the sample report breaks clearly before the full-site report; integration commands are blocks; the footer's 14-link Product list runs in two columns at 901 px and wider.
- Free-scan report: mono labels and meta moved to the text face (BRAND.md: mono is for code), figures aligned, crawler rule text raised from about 4:1 to about 10:1 on navy, larger fix-card labels.
- Motion (opacity and transform only, inside `prefers-reduced-motion: no-preference`, no replay, nothing to pause): scroll reveals now also cover each plan's text, the pricing steps, the how-it-works steps and the tool steps; pages cross-fade and the new page rises 10 px (the header keeps its own name); the FAQ plus turns into a cross; the arrow on the pricing outcome rows steps forward on hover; the animated agent steps on the home page keep one text colour.
- Markup: `index.html` crawler row was `<ul role="img">` with `<li>` (invalid, two Lighthouse failures), now a labelled `<div role="img">` with `<span>` doors; `tools/robots-txt.html` lacked its `.section__inner` opening tag, so the generator ran to the viewport edge.

## Gate 1: the Citehound scan of getcitehound.com

The repository's own scanner code (`lib/scanner.js`: `parseRobots`, `botStatus`, `parseSignals`, `scoreAll`) run on the local files before and after, and on the live site for reference:

| | Score | Discoverability | Technical | Content and trust | Checks changed |
|---|---|---|---|---|---|
| Live (a1818ee) | 87 | 27/40 | 20/20 | 40/40 | |
| Before (tag) | 87 | 27/40 | 20/20 | 40/40 | |
| After (branch) | 87 | 27/40 | 20/20 | 40/40 | 0 of 16 |

Production is scanned again after the deploy with the real `/api/scan` (see the end of this file).

## Gate 2: Lighthouse mobile, local static server, median of 5 interleaved runs

| Page | Performance before to after | Accessibility | Best practices | SEO | LCP ms | CLS |
|---|---|---|---|---|---|---|
| Home | 94 to 95 | **92 to 100** | 96 to 96 | 100 | 2743 to 2580 | 0 to 0 |
| /pricing | 97 to 97 | 100 to 100 | 96 | 100 | 2305 to 2293 | 0 to 0 |
| /integrations | 98 to 98 | 100 to 100 | 96 | 100 | 2112 to 2111 | 0 to 0 |
| /research/crawler-access-2026 | 97 to 97 | 100 to 100 | 96 | 100 | 2416 to 2424 | 0 to 0 |
| /tools/robots-txt | 97 to 97 | 100 to 100 | 96 | 100 | 2434 to 2425 | 0.0037 to 0.0021 |

The home page was below the 95 floor before (92): `aria-allowed-role` and `listitem` on the crawler row, and `color-contrast` where the animated agent step blended white text into orange mid-animation. Both fixed.

Transfer weight per page (gzip, as Lighthouse measures it): CSS 65.3 KB to 67.5 KB (+3.4%), JavaScript unchanged (home 55.2 KB, others 2.0 to 8.8 KB). Home CSS plus JS 120.5 KB to 122.7 KB (+1.8%), the other pages +2.2 KB each; the budget was +15%. Requests per page unchanged. Single runs vary by one point (for example research 97 or 98 on either build), which is why five runs were used.

## Gate 3: network audit on the preview

Headless Chromium over 21 page loads, including a real scan flow: 283 requests on both builds, 0 to any other host, 0 cookies in the browser jar, `document.cookie` empty, 0 console errors or page errors. The scan API was forwarded by the preview server, so the browser only ever talked to its own origin.

## Gate 4: tests, links, screenshots

- `npm run gates`: 88 of 88 (precommit mode, before the commit).
- Internal links and assets: 39 sitemap pages, 88 unique internal targets, 0 broken (same on the old build).
- Horizontal overflow and page errors: 39 pages at 375, 768 and 1440 px, none.
- Scroll reveals: every revealed element reaches full opacity when scrolled to the centre, on 10 pages at 1440 and 375 px.
- Screenshots (static, reduced-motion state so scroll-revealed content shows; downscaled: 375 px full, 768 at half, 1440 at half): `before/` and `after/`, six pages (home, pricing, integrations, research, tool, fix).
- Post-deploy smoke test: see below.

## Gate 5: own critical review against BRAND.md

Looked at before and after at 375, 768 and 1440 for home, pricing, integrations, a research page, a tool page, /fix, the sample report, the footer and the scan states. Defects found and fixed: the tool generator running to the viewport edge, the stray paper strip under the hero, descenders touching on display lines, the sample report's missing break, mono used for report labels, a crawler rule text at about 4:1 on navy, the footer's unbalanced Product column, integration commands breaking as chips. Colours, radii (14 and 12 px), flat fills, one shadow token, the hound as the only mark: unchanged.

## Found, not changed (copy and content, for the owner)

- Free-scan report shows two lines for one fact: "retrieved 18/11/2026" and "Scanned just now, 18/11/2026".
- Pro cards and the comparison table list "Weekly homepage re-scan with email alerts for up to 5 domains" as included; CLAUDE.md says weekly re-scans and email alerts are NOT built. If that is still true, the line breaks "only live things shown as available".
- The footer carries a third-party badge image (Launch Llama) while RULES.md says no third-party logos site-wide.
- Several pages still use mono for non-code text (research dates, tool chips, "robots.txt updated" status, the benchmark strip labels); BRAND.md says mono is for code, addresses and tables.
- The AgaOne chart on the home page draws two labels on top of each other (+42 and +34), inside the generated SVG.
- CLAUDE.md still describes the pre-redesign system (Gloock, navy and gold, `?v=105`); BRAND.md and RULES.md describe the current one. RULES.md says never push to main, while this task asked for a merge to main.
- The footer's Launch Llama badge, the home "Weekly" claim and the repeated meta line are copy or content calls, so they were left alone.
