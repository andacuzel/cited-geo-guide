# Redesign progress

Started 23 Oct 2026. Rollback: `git revert` the redesign commits, or reset to the tag `pre-redesign` (commit 90d2f3d) with a normal revert; or use Vercel's instant rollback (Dashboard > Deployments > the last deployment before the redesign > "Promote to Production"). Never force-push.

Baseline (before): gates 84/84. Self-scan of getcitehound.com: see BASELINE below.

## Todo
- [x] 0 Audit, before screenshots (docs/redesign/before, reduced size; originals not kept), BRIEF.md
- [x] 1 Design system
- [x] 2 Homepage and /pricing
- [x] 3 Other public pages (inherit v4; page banners; tour screenshots re-captured from the live pages)
- [x] 4 Motion (CSS only; hero arc and doors, pricing arches, scroll reveals, press feedback, logo door)
- [x] 5 Final QA, after screenshots (docs/redesign/after)

## In progress
- Nothing. The redesign is deployed (last commit c82513f plus this file).

## Final QA (live, 23 Oct 2026)
- Gates 84/84.
- Headless browser over 40 public pages at 390, 768 and 1280 px against production: 0 CSP violations, 0 console errors, 0 horizontal overflow, 0 requests to another host. Real scan from the home page works under the CSP.
- Cookies: 0 (document.cookie empty, browser jar empty). Third-party requests: 0.
- Home page sanity (unthrottled, one run): desktop LCP 548 ms, mobile LCP 1096 ms, CLS 0, 21 to 22 requests.
- Self-scan of getcitehound.com after: 87/100 (27/40, 20/20, 40/40), the same as before.
- Not done: Lighthouse itself (not installed here); an axe-style contrast run (token ratios are checked by test-contrast-scope.js; the new combinations were checked by hand); the encrypted /r/ pages keep their old baked-in look.
- 3: other public pages inherit the system (page banners with the arch). Brand files regenerated (logo SVG/PNG, favicon, apple-touch-icon, share images v=3, with the wordmark as outlines of Bricolage Grotesque 800). Next: product-tour screenshots, motion pass, final QA.
- 1 + 2 (stage 1): tokens, Bricolage Grotesque, new mark, base components, homepage (hero report preview with ten doors, how it works as arches, audiences, integrations, orange closing field). Pricing page next.

## Done
- Stage 1 deployed (f10881d), stage 2 (d6ef70c, 3132b91): pricing hero, API-by-plan section on /pricing, banners, tablet nav.
- Safety: disk 4.0 GB free, 84/84 gates, tag pre-redesign pushed.

## Decisions
- Motion audit (design-motion-principles, marketing page weighting: Jakub primary, Emil for nav and forms): nothing animates that is used a hundred times a day; no hover lift or scale; all moves are 520 to 1100 ms entrances once per page view or scroll reveals; reduced motion gets the static page; scroll reveals use animation-timeline so nothing is hidden when unsupported. Checked in a browser that centred elements reach opacity 1.
- scripts/capture-og.js rewritten: no Google Fonts (local woff2 via file URLs), new palette and arch. The share images are versioned ?v=3 on every page (lib/page-shell.js too); test-contrast-scope expects v=3.
- Baseline self-scan of getcitehound.com: 87/100 (27/40, 20/20, 40/40), 10 crawlers all "Limited" (Disallow /admin/). Must not drop.
- Strategy: v3 token names kept and re-pointed (palette, fonts, radius); `styles.css` ends with a marked v4 block ("v4:START") that restyles components. The 96 tiny uppercase mono labels in the v3 rules were rewritten in place (sentence case, body font, 13px minimum).
- New mark (arch with a door ajar) replaces the sighthound mark inline on every public page and in lib/lockup.js, lib/site-footer.js, lib/report-render.js, lib/pro-report-page.js and scripts/encrypt-report.js. Encrypted /r/ pages made earlier keep their old baked-in mark (private, not touched).
- Display face changed from Gloock to Bricolage Grotesque (OFL). Gloock files stay in fonts.css only for old encrypted private reports.
- Homepage order changed: "How the scan works" now follows the hero. New sections: playbook audiences, integrations (live items only, text only; the GitHub Action is left out of the homepage because an earlier rule keeps it off the homepage).
- Hero preview uses real figures: the scan of getcitehound.com on 23 Oct 2026 (87; 27/40, 20/20, 40/40; ten crawlers limited by a Disallow rule, none blocked), dated on the card.
- Tests changed because they asserted old markup or CSS details: test-self-hosting (fonts: 29 faces, two preloads, v=2, Bricolage), test-site-footer (.sf-h font may be body), generate-pro --check (PRO tag colour check uses gold-soft), generate-integrations-page --check (the homepage may link /integrations from its integrations section).
- Screenshots in docs/redesign are downscaled (390 px full size, 768 and 1280 at half) to keep the repo small.

## Brand finalisation (task of 23 Oct 2026, after the redesign)
Status 23 Oct 2026: 1 to 6 done and gated (88/88); 7 QA and deploy next. Chosen logo: B (geometric, matched to Bricolage: it keeps the greyhound silhouette, reads at 16 px and sits on the wordmark's weight; C's badge is used only as the container for square avatars and the favicon). Todo (original list): 1 hound logo (3 variants, sheet at docs/redesign/logo-options.png), 2 logo set + replace everywhere (door leaves branding), 3 scripts/generate-og.js + og tags per page, 4 brand/social + brand/listing-icons, 5 docs/brand/BRAND.md + brand/brand.json, 6 /brand page, 7 QA and after screenshots.
Skill guidance on OG imagery: design-taste-frontend has none (a "tells" note only); ui-ux-pro-max says "include OpenGraph images for social sharing" (a Metadata rule, no sizes). Followed: one image per page type, 1200x630, real text only, alt text, absolute URLs.

Brand finalisation QA (live, 23 Oct 2026, commit 2176a71 plus this file): 88/88 gates; headless run over 41 public pages (incl. /brand) at 390, 768 and 1280 px: 0 CSP violations, 0 console errors, 0 overflow, 0 third-party requests; real scan under the CSP works; self-scan 87/100 (27/40, 20/20, 40/40), unchanged. All 13 og:image URLs, favicon.ico, favicon.svg, apple-touch-icon.png, site.webmanifest and /brand answer 200 with the right type; brand/ and docs/ are 404 on the site. After screenshots re-saved in docs/redesign/after. Not done: uploads (the owner does them: brand/social/README.md, brand/listing-icons/README.md); the Claude plugin icon was not touched; the n8n icon SVG is updated in the repository and ships with the next npm publish.

## Round 2 (24 Oct 2026, owner's feedback)
Rollback: tag `pre-round2` (commit 49702be); `git revert` the round 2 commits (one commit per experiment) or Vercel's instant rollback.
Baseline self-scan: 87/100 (27/40, 20/20, 40/40). Gates 88/88 before.
Todo: 1 home rebuild (remove orange "See how AI reads your site" block; story order; paid plans + Agentic Commerce presented) / 2 integrations hub (home + /integrations) / 3 OG overlap fix + check / 4 About photo / 5 sell pages (Pro, Fix, Beyond, Agentic Commerce, Pricing) / 6 animations autoplay only / 7 skills audit / 8 QA.
New strings (every new text, by step):
- [x] 3 OG overlap: scripts/brand/art.js now measures every text line against the artwork (14 px gap, 24 px edge margin) and fails the script; generate-og.js and the social templates use it. It caught og-api (headline touching the code box) and the 560 px headline limit now applies to every type. Images regenerated, tags at ?v=5. scripts/regenerate-all.js runs all generators in order.
- [x] 1+2 Home rebuild and integrations hub (commit "Round 2: home story..."). New order: hero (scan + report preview) / how the scan works / the plans (Pro, Fix, Beyond as stages with their real screens: a main screen and a second one layered over it, floating by themselves) / Agentic commerce (its own band with an auto-playing scan line over product cards; steps Find, Read, Compare, Buy light up) / case study / pricing (the generated block, moved up) / playbooks / research and benchmarks / integrations hub / FAQ with a "Run the free scan" button / footer. Removed: the orange closing block ("See how AI reads your site." and its CSS on the home), the old four-card ladder, the tabbed product tour (tabs were controls), the MCP band (the Claude connector is in the hub and links /claude), the old text-only integrations list.
  Decisions: the hub is CSS only (orbit turns, icons counter-rotate, pulses travel the spokes, the core ripples; nothing under reduced motion); it is aria-hidden and the list beside it is the accessible content. Icons are neutral line icons drawn in lib/hub.js, NO third-party logos: docs/integrations/RULES.md forbids them site-wide, which is stricter than the brand guidelines ("works with" use) the brief allowed. The GitHub Action is left out of the home hub (earlier rule: the Action is named only on /terms, /privacy and /integrations); /integrations shows all 7 live items. The hub block on the home is written by scripts/generate-integrations-page.js between HUB markers.
  Tests changed (they asserted old markup): generate-pricing --check (price lines now in the plan stages), generate-claude-page --check (the home links the Claude connector from the hub), test-contrast-scope (no .mcp-home band), generate-integrations-page --check (hub, no external icon).
  New strings: "Product names belong to their owners, and mentioning them implies no endorsement." Everything else on the home is existing copy (plan names, price lines, captions, "Can an AI agent find your product, read the price and buy it?", "Shopping agents read what your store publishes. Scan it the way an agent would.", "Scan your store", "Find/Read/Compare/Buy", "Illustration. Not real data.", "Run the free scan", "Use it where you already work.").
- [x] 4 About: the portrait (assets/andac.jpg, original kept, only on /about) is an ink and paper duotone with a warm tint and grain, in a frame with the hound's eye (an orange dot), sticky beside the text. No founder block or photo elsewhere.
- [x] 5 Sell pages, each with its own opening, colour and auto-playing picture (copy untouched; demo data labelled as before):
  Fix = dark workbench; the fix list turns from To do to Verified, the score ring moves 33 to 87 (the demo's own figures, "Product demo · Sample data"). Beyond = orange studio; pieces move across Draft, In review, Approved, Published ("Illustration. Not a real client."). Pro = white document; a crawl field of the real sample crawl (28 pages, each with its own score from content/pro/sample-report.json, homepage 87, whole site 83) lighting up page by page; the report's first screen follows. Agentic commerce = paper with an ink shelf; a cursor reads three product tiles while Find, Read, Compare, Buy light up. Pricing keeps its arch hero and the API-by-plan table; its closing call to action (and /claude's) is an ink panel instead of the orange field.
  Tests changed: generate-service-pages --check accepts the light "Includes Citehound PRO" badge (Beyond's hero is light).
  New strings: none on these pages beyond labels already on them ("Before 33" and "+54 points since the first scan" are the demo's own words).
- [x] 6 Animations play by themselves: nothing has a replay, pause or playback button. The hub, plan screens, fix list, content board, crawl field, shelf and arch rise are CSS keyframes (infinite or once per view) inside prefers-reduced-motion: no-preference; reduced motion gets the final static state. (The tabs that remain on /pricing choose between screenshots; they do not control an animation.)
- [x] 7 Skills audit: design-taste-frontend inspect.mjs on the home page (1440/768/390) gave 11 FAIL, 10 WARN. Fixed: monospace in the browser-frame URL bars, shadows at rest on the frames, "In stock" chip contrast (4.4:1 to 6+:1), blank gap above the integrations hero (a margin on .hp-band), text under 13 px on the animated panels where it is read; the section kickers (16 eyebrows) are hidden in section heads site-wide (heroes and banners keep theirs). Defended: three typefaces (display, text, code and data), the dashed spokes and rings of the hub (they are the picture), icon cards on the how-it-works row, three-line hero headline (it is a statement the owner approved), the sticky header covering headlines mid-scroll (the inspector's "covered text").
  design-motion-principles: Jakub weighting (marketing); entrances once, 520 to 1100 ms; looping panels are slow (7 to 15 s) and sit beside text, never over it; no hover lifts; page changes cross-fade with CSS view transitions (180 ms, the header keeps its own name so it does not flash).
- [x] 9 Also added: CSS view transitions between pages; the share-image overlap check; scripts/regenerate-all.js.
