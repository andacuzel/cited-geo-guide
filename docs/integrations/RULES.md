# Rules for every integration task

This file is the shared rule set for the API and for every integration built on it (Zapier, Make, n8n, Looker Studio, and anything later). Read it before you start. If a task asks for something that breaks a rule here, stop and say so.

## What we may say

- Never claim that any assistant recommends, cites or ranks a brand. The score measures readiness: whether crawlers can reach a site and whether its pages carry signals a model can read. It does not measure whether any assistant names a brand.
- No promise about traffic, rankings, citations or revenue, in any copy, example or error message.
- The one outcome disclaimer lives on `/terms` and nowhere else. Do not repeat it on a page, in the docs, in a README or in an email.
- Never claim an integration, a listing or a partnership that is not live and approved. A directory listing is "live" only after the directory has approved it.
- Third-party names (Zapier, Make, n8n, Looker Studio, Claude, ChatGPT) appear only descriptively ("works with ..."). No third-party logos on our site. Never use "official", "verified" or "partner" about anything but our own GitHub Action, and then only the word "official".
- Do not link to an integration that is not live.

## Secrets and data

- Never print, log or commit a secret, a token or an API key. Environment variables only.
- API keys are shown once, in the email that carries them. Only a keyed hash (HMAC-SHA-256 with a server-side pepper) is stored.
- Store as little as possible. Marketing consent is stored separately and used only when it is true.

## How the code is built

- The API reuses the existing scanner and generators (`lib/scanner.js`, `lib/file-generators.js`, `lib/schema.js`). No second copy of the scoring.
- Every fetch of a domain someone typed goes through `lib/safe-fetch.js`. No direct `fetch` of a user-supplied address.
- The project is at the edge of the Vercel Hobby plan's twelve functions. Do not add a function without checking the count and saying so.
- Update generators, not just generated HTML. Bump the stylesheet version consistently across every generated page.
- Plain practitioner English: short sentences, no buzzwords. Mobile layout at 390px with no horizontal scroll. Text contrast at WCAG AA.
- Gates must pass before a push (`npm run gates`).

## How we work

- Work on a branch. Never push to main. Never publish to any third-party marketplace or directory.
- For anything the owner must click or run, write beginner-level numbered steps.
- Report in Turkish, short, with what is unverified.
