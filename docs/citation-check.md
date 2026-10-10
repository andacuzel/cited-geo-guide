# The Pro citation check

A Pro report can include a **Citation check (sample)**: Citehound learns what a site is, writes questions in the site's own
language, asks them to an AI assistant that uses live web search, and shows which answers cited or mentioned the site. It is
one run, on one assistant and model, on one date. It is not part of the readiness score, not a ranking and not a measure of
overall AI visibility, and the report says so in those words.

**It is OFF.** It runs only when the deployment has `GEMINI_API_KEY` **and** `CITATION_ENABLED=1`. As of 10 Oct 2026 the Vercel
production project has neither (the project's variables are the Pro mail and storage ones), so no report runs it. Read
"Before you switch it on" first.

## How it runs

After the pages are read (and at least one was), the job goes through three more phases in the same browser-driven steps and
under the same per-job lock as the crawl, so it is resumable and idempotent (`lib/pro-citation.js`):

1. **profile**: the homepage and up to four key pages (about, services, pricing, product, taken from the crawl's own page list) are
   read again, one request a second, and a model describes the site as `{language, siteType, category, offering, audience,
   geography, brandName}` (`lib/site-profile.js`). Language comes from the page's `lang`, checked against a detector on the text
   (`lib/lang-detect.js`); a wrong attribute is overruled by clear text.
2. **questions**: 18 questions that do not name the brand and 3 that do, all in the site's language, each non-English one with a
   short English gloss (`lib/citation-prompts.js`). One model call per step, at most two. The 14 vertical sets in `content/prompts/`
   are style examples when the category matches one, and a fallback for English sites only. The source is recorded
   (`llm`, `llm+vertical:<name>`, `vertical:<name>`).
3. **cite**: about three questions per step go to Gemini with Google Search (`lib/citation-check.js`). Each answer is stored before the
   next call.

Progress stages on the screen: "Reading your site", "Understanding what you do", "Writing citation questions in <language>",
"Testing questions (n of 21)", "Building your report".

## Controls

| Control | Value |
|---|---|
| Questions and calls per job | 21 at most (`MAX_CALLS`) |
| Calls per day, all jobs | `CITATION_DAILY_CAP`, default 60 |
| Search queries per month | `CITATION_MONTHLY_QUERY_CAP`, default 4000 (Google's free allowance is 5,000) |
| Pace | calls one after another, 0.7 s apart, 16 s timeout each |
| HTTP 429 or a quota error | stops at once; every question not yet asked is "not tested"; never retried |
| Three failed calls in a row | stops the same way |
| Anything else going wrong | the check ends "not tested"; the report is still made |

If questions were written but could not be tested, the report lists them to copy, marked "not tested".

## What is untrusted, and how it is handled

The site's text. It goes to the model between delimiters with a random nonce (a forged delimiter inside the page is neutralized),
with a system instruction that says it is data, never instructions; the reply is forced to a JSON schema; every field is then
validated (strings only, length caps, no URLs, domains or e-mail addresses, no instruction-like wording, `siteType` from a fixed
list, a brand name that must be in the site's title, first heading, site name, description or domain). Questions are validated again
(length, no URL or markup, no instruction wording, the 18 must not contain the brand, duplicates and near-duplicates dropped, the
language checked, a gloss required for non-English). A field that fails is dropped, never repaired by trusting the model more.
Nothing a model returns is fetched or run. Input is capped at 12,000 characters (4,000 for the homepage, 3,000 a page).
`scripts/test-citation.js` has a hostile page and a model that falls for it.

## What goes to Google

Excerpts of the site's public text and the questions. Nothing about the person who ordered the report: no name, no email. The
report's job record holds the profile, the questions and, per question, a truncated answer (700 characters), `cited`, `mentioned`
and up to 8 other cited domains, with the model name and the date, for 90 days.

## Facts checked against Google's documentation (10 Oct 2026)

- Models: `gemini-3.5-flash-lite` (stable) and `gemini-3.8-flash` (stable) are listed with grounding support
  (ai.google.dev/gemini-api/docs/models and /google-search). The default here is `gemini-3.5-flash-lite`; `CITATION_MODEL` overrides it.
- Structured output on `generateContent`: **checked live** with the project's key: `generationConfig.responseMimeType` plus
  `responseJsonSchema` and a `systemInstruction` returned schema-shaped JSON. (Google's structured-output page describes the Interactions API;
  `generateContent` is not marked deprecated.)
- Grounding response fields: the API reference (ai.google.dev/api/generate-content) documents `groundingMetadata.groundingChunks[].web.uri`
  and `.title`, `webSearchQueries`, `groundingSupports` and `searchEntryPoint`. It does not say whether `uri` is a direct address or a
  redirect, so both are handled: a redirect host's chunk takes its domain from the title when that is a host name, else the redirect's
  `Location` is read with `lib/safe-fetch.js` (no redirects followed) and only its host is kept.
- **Not verified by a real grounded call:** the project's key is on the free tier, and a grounded request answers HTTP 429
  `RESOURCE_EXHAUSTED`. So the grounded response shape above comes from the reference, not from a live response. The first real grounded
  run, after billing is on, must be checked by hand (`node scripts/test-citation-live.js`).
- Prices: Gemini 3.5 Flash-Lite $0.30 per million input tokens and $2.50 per million output (paid tier). Search grounding on Gemini 3 and
  newer: 5,000 search queries a month free (shared across those models), then $14 per 1,000; "you will be charged for each individual search
  query performed", and one request can run several. Pricing page "last updated 2026-10-09".

## Terms (read these before you switch it on)

From Google's Gemini API additional terms (ai.google.dev/gemini-api/terms, effective 23 March 2026, updated 28 April 2026; read through a
page summary, not by a lawyer, so check the text itself):

1. **Unpaid services**: Google may use submitted content to improve its products, and human reviewers may read, annotate and process input and
   output (disconnected from the account and key). "Do not submit sensitive, confidential, or personal information." **Paid services**: Google does
   not use prompts or responses to improve its products (it keeps them for a limited time to detect policy violations and meet legal duties).
   The pricing page agrees: free tier "content used to improve products: Yes", paid "No".
   **So: if the key is on the free tier, submitted site text can be used to improve Google products. Enabling billing is a launch blocker for
   paid use.** The free tier also cannot ground at all.
2. **Grounding with Google Search has its own terms.** As read: use it only in an application you own and operate; show grounded results only
   with their Search Suggestions, and only to the end user who submitted the prompt; do not modify or intersperse other content with the
   results; do not "cache, frame, syndicate, resell, analyze, train on, or learn from" grounded results or Search Suggestions; no click tracking;
   grounded text may be stored for up to two years only in limited cases.
   **Our design does several things those terms appear to forbid or restrict:** it analyses grounded results (cited yes or no, other domains), it
   does not display Search Suggestions (`searchEntryPoint` is not stored), it stores answer text for 90 days, and a report link can be shared
   with people other than the one who submitted the questions. This is why the check is off by default and why it is not a launch feature yet.

Ways forward, for you to decide: (a) ask Google for written permission or confirm the reading with counsel; (b) change what is stored and shown
so it fits the terms (for instance show Search Suggestions with each answer, keep the report private to the buyer, drop the analysis); (c) switch
the provider behind `lib/citation-check.js` to an assistant whose terms allow this use (the adapter is one object with `ask(question)`); (d) run
the questions without search (cheap, free-tier capable, but then it is not a test of what a search-using assistant cites).

## Before you switch it on

1. Settle the terms question above.
2. Enable billing for the Google AI project the key belongs to and set a spend cap in Google Cloud. Without billing, search answers 429.
3. In Vercel set `GEMINI_API_KEY` (production only), `CITATION_ENABLED=1`, and, if you want, `CITATION_DAILY_CAP`, `CITATION_MONTHLY_QUERY_CAP`,
   `CITATION_MODEL`. Redeploy.
4. Run `node scripts/test-citation-live.js example.com` once and read the output.

## Live run, 10 Oct 2026 (free-tier key)

`node scripts/test-citation-live.js` on getcitehound.com (English) and lexware.de (German): the crawl, profile and question writing worked
(profile correct, 18 + 2 questions in English; 18 + 3 in German with English glosses, language `de-DE` from the page). The first searched call on
each site answered 429, the check stopped at once (1 searched call each) and marked the rest "not tested". Two sites used 5 model calls,
5,578 input and 2,645 output tokens, about $0.008 at paid prices ($0 on the free tier). Search cost: none incurred.
