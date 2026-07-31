# Playbook content pipeline

Playbook content used to be written by hand directly into `app.js`.
This folder plus `scripts/ingest-playbooks.js` replace that: write a
playbook here, run the script, and it lands in `app.js` for you —
without touching the file by hand.

## Adding or updating a playbook

1. Create `content/playbooks/<id>.js`, where `<id>` is one of the
   fourteen vertical ids already defined in `app.js` (`subFields`,
   `brandFields`, `professionalFields`):

   - SaaS: `crm`, `martech`, `hrtech`, `fintech`, `cybersecurity`, `devtools`
   - Brands: `ecommerce`, `consumerapps`, `hospitality`, `marketplaces`
   - Professionals: `realestate`, `legal`, `health`, `localservices`

2. Export a single object shaped exactly like the existing `saasData`
   entries:

   ```js
   module.exports = {
     name: 'Your Vertical Name',
     content:
       '<h3>The Strategic Shift</h3>' +
       '<p>...</p>' +
       '<p>...</p>' +
       '<h3>Top 3 Actionable Strategies</h3>' +
       '<ul>' +
       '<li><strong>Imperative phrase.</strong> ...</li>' +
       '<li><strong>Imperative phrase.</strong> ...</li>' +
       '<li><strong>Imperative phrase.</strong> ...</li>' +
       '</ul>' +
       '<div class="expert-tip expert-tip--aside">' +
       '<p>[... <strong>This box is for your proprietary point of view.</strong>]</p>' +
       '</div>' +
       '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
       '<ul class="pitfalls">' +
       '<li>...</li><li>...</li><li>...</li><li>...</li>' +
       '</ul>' +
       '<div class="expert-tip expert-tip--data">' +
       '<p>[... <strong>Replace with a sourced figure.</strong>]</p>' +
       '</div>' +
       '<h3>Expert Tip</h3>' +
       '<div class="expert-tip">' +
       '<p>[... <strong>This box is for your proprietary point of view.</strong>]</p>' +
       '</div>'
   };
   ```

   See `../../CLAUDE.md` ("Playbook content rules") for the full spec —
   word counts, permitted scanner-check labels, banned words, and the
   escaping rules below. The script enforces all of it.

3. Run the script:

   ```bash
   node scripts/ingest-playbooks.js
   ```

   It validates every file in this folder and writes anything that
   passes into the matching data object in `app.js` (`saasData`,
   `brandData`, or `professionalData`). A vertical's card on the site
   flips from "In preparation" to "Live" automatically the moment its
   id appears in that object — no other wiring needed.

   Re-running the script is always safe: an existing id is replaced
   in place, never duplicated.

## What gets rejected, and why

The script reports a pass/fail line per file and exits non-zero if
anything failed, so a bad file can never silently corrupt `app.js`.
It checks:

- Section order and exact counts (2 paragraphs, 3 strategies, 4
  pitfalls, 3 expert-tip divs), and the word-count range for each.
- That every apostrophe is written as `’` and every em dash as
  `—` in the source — not a raw `'`/`\'`/`—` character. This is
  a source-level check, so it inspects the file's text directly, not
  the string value after it's loaded.
- That the four `<h3>` section headings are real HTML in the
  evaluated content, not plain text with the tags missing.
- That any quoted string that looks like a scanner-check reference
  (contains words like "schema", "crawler", "canonical", etc.)
  exactly matches one of the report labels listed in CLAUDE.md — this
  catches typos and invented check names.
- Banned words from CLAUDE.md, matched whole-word only (so
  "factually" doesn't trip the "actually" rule) — plus the banned
  "not just X, but Y" construction.

## Expert-tip placeholders

The three tip boxes in each playbook ship as bracketed placeholders —
`[...]` — for you to fill in by hand over time; nothing here ever
writes real opinions or figures into them. A placeholder is never
shown to a visitor: `app.js` hides any `.expert-tip` box (and its
"Expert Tip" heading, if that box has no filled sibling) whose text
still starts with `[`. Edit the bracketed text in a playbook's source
file whenever you're ready, run the script again, and the box appears
on its own.
