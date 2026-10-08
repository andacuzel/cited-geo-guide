# Privacy addendum: report and Pro list signups

Draft, ready to paste into `/privacy` when the forms go live. Do not publish it before the forms are enabled, and do not enable the forms before it is published. Fill the bracketed items. Have it read by whoever is responsible for privacy compliance before it goes live; it is a draft of plain statements, not legal advice.

---

## Report and Pro list signups

This section applies only if you sign up for the Citehound research report or the Pro list. Scanning a site needs no email address, and nothing here changes how scans work or what we do with them. Scan results are never linked to a signup.

**What we collect.** Your email address. If you choose to give them, the address of your website and your role. We also record which form you used, the time you signed up, whether you ticked the consent box, and the version of the consent wording shown to you ([CONSENT_VERSION]).

**Why.** To send you what you asked for: the research report, and, for the Pro list, the founding terms and the price before Pro opens. With your consent, we also send occasional research and product updates. We do not sell your details, share them for advertising, or use them to build profiles.

**Legal basis.** Your consent. You give it by ticking the box, and you confirm it by clicking the link in the confirmation email we send first. You can withdraw it at any time.

**Who handles it.** [PROVIDER_NAME] stores the list and sends the emails on our behalf. [PROVIDER_NAME] processes your details only to do that. [If the provider processes data outside your country or the EEA, say where and under which safeguard.] The signup pages set no cookies and load no analytics or tracking scripts.

**How long we keep it.** Until you unsubscribe or ask us to delete your details. After you unsubscribe we keep only your email address, on a suppression list, so that you are not added again. [Confirm this retention period before publishing.]

**Unsubscribing.** Every email has an unsubscribe link. You can also write to hey@getcitehound.com and we will remove you.

**Your rights.** You can ask us for a copy of your details, to correct them, to delete them, or to restrict how we use them, and you can withdraw your consent at any time. Write to hey@getcitehound.com. If you are in the EEA or the UK, you can also complain to your data protection authority.

**Contact.** hey@getcitehound.com.

---

## Placing it

- Add it as a section of `privacy.html`, with a visible "last updated" date, in the same deploy that sets `ENABLED = true`.
- Set `CONSENT_VERSION` in `lib/launch-config.js` to the date or label you use here. Change it whenever the consent sentence on either form, or this text, changes materially.
- `privacy.html` currently says nothing about email lists. Keep its other statements true: it must still say that scanning needs no email, and the report-summary rules in `CLAUDE.md` still apply.
