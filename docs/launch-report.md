# Launch lead-magnet: enable checklist

The report signup and the Pro founding list are built and dark. While `ENABLED` is `false` in
`lib/launch-config.js`: no page is generated, nothing links to one, nothing is in the sitemap or
`llms.txt`, and `/api/subscribe` answers `503 {"error":"not_enabled"}`.
`node scripts/check-launch-config.js` proves all of that, and runs with every other check.

What is where:

| File | Role |
|---|---|
| `lib/launch-config.js` | the switch and the six values still to decide |
| `scripts/generate-launch-pages.js` | writes `/<REPORT_SLUG>` and `/founding` (both noindex), only when enabled; `--preview` writes them with placeholders to `local/launch-preview/` for review |
| `api/subscribe.js` | validates a signup and forwards it to `SUBSCRIBE_WEBHOOK_URL` |
| `scripts/check-launch-config.js` | fails if `ENABLED` is true with a missing value, or if anything is reachable while it is false |
| `scripts/test-subscribe.js` | the endpoint against a mock provider |
| `docs/privacy-addendum.md` | the privacy text to publish together with the forms |
| `scripts/launch-report-stats.js` | the report's numbers, from the stored benchmark scans (writes under `local/launch-report/`, gitignored) |

## Decisions to make first

1. **Email provider.** It runs the list and the double opt-in, and is named in the privacy addendum.
2. **Edition name.** The report's title as the pages print it.
3. **Report slug.** The report page's path, for example `/state-of-ai-readiness-2026`: lowercase letters, digits, dashes.
4. **Founding cap.** The number of founding customers.
5. **End date.** The last day founding terms are offered, `YYYY-MM-DD`. The page shows it as plain text; there is no timer.
6. **Founding terms and Pro price.** Not on the page by design: the page promises they are emailed to the list before launch. Write them before launch day.
7. **Whether the pages are indexed.** They are noindex. A noindex page does not belong in `sitemap.xml`; if you want them found by search, remove `noindex` (the `robots` option in `generate-launch-pages.js`) and then add them to the sitemap. Linking them from the nav or footer is a separate choice.

## Enable

1. **Provider.** Create the list. Turn on double opt-in (a confirmation email that must be clicked). Create a webhook or automation that accepts a JSON POST with
   `{ email, site, role, form, consent, consentVersion, timestamp }`. `form` is `report` or `founding`: use it to put people on the right list or tag. Keep `consentVersion` and `timestamp` on the contact record as proof of consent. Check that every email carries an unsubscribe link.
2. **Vercel.** In Production, set `SUBSCRIBE_WEBHOOK_URL` to the provider's webhook URL. It is a secret: never commit it.
3. **Config.** Fill every value in `lib/launch-config.js`. Set `CONSENT_VERSION` to an identifier for the consent wording now in force, for example the date the privacy addendum is published. Leave `ENABLED` for last.
4. **Privacy.** Paste `docs/privacy-addendum.md` into `privacy.html`, with the provider's name. The policy and the forms go live in the same deploy.
5. **Flip.** Set `ENABLED = true`. Run:

   ```bash
   node scripts/check-launch-config.js
   node scripts/generate-launch-pages.js
   node scripts/generate-launch-pages.js --check
   node scripts/test-subscribe.js
   node scripts/check-pages.js
   ```

   The generator writes `<REPORT_SLUG>.html` and `founding.html` at the repository root. If you link the pages from the nav or footer, edit `lib/page-shell.js` and rerun the generators that use it (`node scripts/set-domain.js` lists them), then see the sitemap note above.
6. **Deploy and test with a real mailbox.** Submit the report form with an address you own. Confirm the double opt-in email arrives, click it, and confirm the contact appears in the provider with the right list, `consentVersion` and `timestamp`. Click the unsubscribe link in a later email. Repeat for the founding form. Submit once with the box unticked (the page should refuse) and once from a second tab quickly six times (the sixth within the hour should be refused with a calm message).
7. **Report.** Write the report from `local/launch-report/findings.md`. Rebuild the numbers with `node scripts/launch-report-stats.js` if the stored data changes.

## Switch off

Set `ENABLED = false`, delete `<REPORT_SLUG>.html` and `founding.html`, deploy. `/api/subscribe` goes back to `503 not_enabled` at once. The privacy addendum can stay.

## Cost

The endpoint is one function (the project uses 10 of the 12 allowed on Hobby), no storage and no paid dependency here. The provider's plan is its own cost: check its free allowance and set a spending cap there before enabling.
