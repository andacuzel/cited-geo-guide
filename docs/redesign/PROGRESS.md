# Redesign progress

Started 23 Oct 2026. Rollback: `git revert` the redesign commits, or reset to the tag `pre-redesign` (commit 90d2f3d) with a normal revert; or use Vercel's instant rollback (Dashboard > Deployments > the last deployment before the redesign > "Promote to Production"). Never force-push.

Baseline (before): gates 84/84. Self-scan of getcitehound.com: see BASELINE below.

## Todo
- [x] 0 Audit, before screenshots (docs/redesign/before, reduced size; originals not kept), BRIEF.md
- [x] 1 Design system
- [x] 2 Homepage and /pricing
- [x] 3 Other public pages (inherit v4; page banners; tour screenshots re-captured from the live pages)
- [x] 4 Motion (CSS only; hero arc and doors, pricing arches, scroll reveals, press feedback, logo door)
- [ ] 5 Final QA, after screenshots

## In progress
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
