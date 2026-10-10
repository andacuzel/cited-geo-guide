# The Pro citation questions (and the two optional live checks)

A Pro report can carry a **Citation questions** section. Citehound learns what a site is, writes 21 questions in the site's own
language (18 that do not name the brand, 3 that do, each non-English one with a short English gloss), and lists them with a "Copy all
questions" button and the label **"Not tested. Try these in your own assistants."** Nothing is asked of any assistant. There is no cited
or mentioned claim anywhere in that section.

Two further parts exist in code, each behind its own switch, **off by default and not enabled in production**:

| Switch | What it adds | Needs |
|---|---|---|
| `CITATION_QUESTIONS_ENABLED=1` | profile + question writing (the part above). No search, no analysis of any result. | `GEMINI_API_KEY` |
| `CITATION_TEST_ENABLED=1` | **Citation check (sample)**: the questions asked to a provider's assistant with its web search tool; per question cited yes/no, mentioned yes/no, up to 8 other cited domains (alphabetical, each with one link), model and date. | the questions switch, `CITATION_TEST_PROVIDER`, that provider's key |
| `CITATION_KNOWLEDGE_ENABLED=1` | **Model knowledge check (no live search)**: the same questions to the provider's plain chat API with no tool. Stored: only whether the brand or domain appears in the answer, the model and the date. Never shown as citation tracking, never a "cited" column. | same as testing |

`CITATION_TEST_PROVIDER` is `anthropic` today (the only adapter). The old `CITATION_ENABLED` variable is not read any more. **There is no
Gemini Google Search grounding anywhere in the Pro code**: the adapter was deleted, no `google_search` tool is sent, and a test fails if one
comes back (see "Why grounding was retired"). Env details: `docs/env.md`.

## How it runs

After the pages are read (and at least one was), the job goes through up to four more phases in the same browser-driven steps and under
the same per-job lock as the crawl, so it is resumable and idempotent (`lib/pro-citation.js`; switches in `lib/citation-config.js`, decided
once when the phases begin and stored on the job):

1. **profile**: the homepage and up to four key pages (about, services, pricing, product, from the crawl's own page list) are read again,
   one request a second, and Gemini describes the site as `{language, siteType, category, offering, audience, geography, brandName}`
   (`lib/site-profile.js`). Language comes from the page's `lang`, checked against a detector on the text (`lib/lang-detect.js`).
2. **questions**: 18 + 3 questions in the site's language (`lib/citation-prompts.js`). One model call per step, at most two. The 14 vertical
   sets in `content/prompts/` are style examples when the category matches one, and a fallback for English sites only. With only the
   questions switch on, the job ends here: status `questions`.
3. **cite** (testing switch): about three questions per step to the provider with web search (`lib/citation-check.js`,
   `lib/citation-anthropic.js`). Each result is stored before the next call.
4. **know** (knowledge switch): five questions per step to the provider with no tool. Only `named`, model and date are stored.

Progress stages: "Reading your site", "Understanding what you do", "Writing citation questions in <language>", then (only when those
switches are on) "Testing questions (n of 21)" and "Checking what the model knows (n of 21)", and "Building your report".

Questions mode needs no provider key besides Gemini. If `GEMINI_API_KEY` is missing the job simply has no citation section.

### Controls

| Control | Value |
|---|---|
| Calls per phase per job | 21 at most |
| Live calls per day, all jobs (test and knowledge together) | `CITATION_DAILY_CAP`, default 60 |
| Web searches per month | `CITATION_MONTHLY_QUERY_CAP`, default 300 (about $3 at $10 per 1,000) |
| Question-writing jobs per day | `CITATION_QUESTIONS_DAILY_CAP`, default 30 (each is 2 or 3 Gemini calls) |
| Pace | one call after another, 0.7 s apart, 40 s timeout for a search call, 25 s without |
| HTTP 429, a rate-limit answer, a quota error | stops that phase at once; every question not yet asked is "not tested"; never retried |
| An answer that never searched (testing) / a paused search turn | counts as a failed call |
| Three failed calls in a row | stops that phase the same way |
| Anything else going wrong | the phase ends "not tested"; the report is still made |

A provider-side spending limit is **not** replaced by these caps: set one in the provider's console before switching live testing on
(CLAUDE.md: zero marginal cost with a spend cap at the provider). Live testing costs money (see "Cost"); the questions part costs a fraction of a cent.

### What is untrusted, and how it is handled

The site's text. It goes to the model between delimiters with a random nonce (a forged delimiter inside the page is neutralized), with a
system instruction that says it is data, never instructions; the reply is forced to a JSON schema; every field is then validated (strings
only, length caps, no URLs, domains or e-mail addresses, no instruction-like wording, `siteType` from a fixed list, a brand name that must be
in the site's title, first heading, site name, description or domain). Questions are validated again (length, no URL or markup, no
instruction wording, the 18 must not contain the brand, the 3 must, duplicates and near-duplicates dropped, language checked, a gloss
required for non-English). A field that fails is dropped, never repaired by trusting the model more. Nothing a model returns is fetched or
run: a cited page's address is parsed for its host name and never requested. Input is capped at 12,000 characters (4,000 for the
homepage, 3,000 a page). `scripts/test-citation.js` has a hostile page and a model that falls for it.

The 18 + 3 count had a bug: the near-duplicate test counted the brand's own name and short question words, so "What is X?", "What does X
offer?" and "Who is X for?" looked like one question and our own site got 18 + 2. Brand words are now ignored in the comparison and a
question with fewer than three other words is only a duplicate when identical (regression test in `scripts/test-citation.js`). A real
run on getcitehound.com after the fix gave 18 + 3 (`node scripts/test-citation-live.js getcitehound.com`, 10 Oct 2026).

### What is stored (90 days, with the job)

The profile; the 21 questions; per question, with testing: `cited`, `mentioned`, up to 8 other cited domains with one https link each (no query
string), the number of searches, the model and the date. **No answer text is kept**, in either mode. With the knowledge check: per question
`named`, model, date. Nothing about the person who ordered the report.

### What goes to which provider

- **Google (Gemini API), questions mode:** excerpts of the site's public text (up to 12,000 characters) and nothing else; the reply is the
  profile and the questions. Measured on getcitehound.com: 2 calls, 2,264 input and 615 output tokens, about $0.002 at list price.
- **The testing provider (Anthropic), testing mode:** one generated question per request (no site text, no profile) plus a short instruction.
  **Knowledge mode:** the same, with no tool. The answers come back and are reduced to the flags above.

## Cost per report (list prices read 10 Oct 2026; estimates, not measurements)

| Part | Basis | Per report |
|---|---|---|
| Questions (Gemini 3.5 Flash-Lite, $0.30 / $2.50 per million tokens) | measured: 2,264 in + 615 out | about $0.002 |
| Testing, Anthropic Claude Haiku 5.5 ($0.10 / $0.50 per million tokens, prompts up to 100k) + web search at $10 per 1,000 searches | 21 questions, 1 to 3 searches each (cap 3), search results counted as input tokens (assumed up to 20,000 per question) | about $0.25 to $0.70, typically about $0.35 |
| Knowledge check, same model, no tool | about 300 tokens in, 500 out per question | about $0.01 |
| For comparison: OpenAI `gpt-5-mini` ($0.25 / $2.00) + $10 per 1,000 search calls | same assumptions | about $0.40 to $0.80 |
| For comparison: Perplexity `sonar`, low context ($1 / $1 per million + $5 per 1,000 requests) | one request per question | about $0.16 |

The token counts for search results are an assumption: the provider bills them at input rates and does not say how large they are. Measure
with a handful of calls (below) before trusting these figures. Prices: platform.claude.com/docs/en/about-claude/pricing,
developers.openai.com/api/docs/pricing, docs.perplexity.ai (pricing page); retrieved 10 Oct 2026.

## Terms: what each provider says (retrieved 10 Oct 2026; paraphrased)

I could not reproduce the providers' text here, so these are paraphrases with the place to read the original. **Nothing below is legal advice;
anything marked LAWYER is for you or counsel to settle before the feature is switched on.** Terms change: re-read before enabling.

### Google, Gemini API (used for the questions)

Source: ai.google.dev/gemini-api/terms (effective 23 March 2026, page updated 28 April 2026).

- **Unpaid services** (free tier, AI Studio): Google may use the content you submit and the responses to improve its products, and human
  reviewers may read, annotate and process input and output. The terms say not to submit sensitive, confidential or personal information.
- **Paid services**: the Gemini API counts as a paid service only when used through a Google Cloud project with an active billing account.
  Google does not use prompts or responses to improve its products; it logs them for a limited time to detect and prevent violations.
- **EEA, Switzerland, United Kingdom**: only paid services may be used when making an API client available to users there, and the paid
  data terms then apply to all services. **LAWYER / you verify:** Citehound's visitors include people in those regions, so the key must belong to
  a billing-enabled project before `CITATION_QUESTIONS_ENABLED` is set. I cannot see your Google Cloud project: check that billing is active on
  the project that owns `GEMINI_API_KEY` (Google Cloud console, Billing) and that the key's project is that one.
- What is sent in questions mode is public page text of the site the customer named, not personal data about the customer. Public pages can
  still contain personal data (a team page, a name): that is the customer's own site, but it is a point for counsel under the privacy page.
- **Grounding with Google Search** (not used any more), same page: use only in an app you own and operate; show grounded results with their Search
  Suggestions only to the end user who submitted the prompt; no caching, framing, syndicating, reselling, analysing, training on or learning from
  the results or suggestions; no click or link tracking; grounded text storable for up to two years only in limited cases; Google stores the prompt and
  output for 30 days. What the old check did (analyse results, store answers for 90 days, show a report link to others) falls on the wrong side of
  several of those lines. See "Why grounding was retired".

### Anthropic (recommended candidate for testing and the knowledge check)

Sources: platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool; anthropic.com/legal/commercial-terms (effective 17 June 2025);
platform.claude.com/docs/en/manage-claude/api-and-data-retention.

- **Analysing results:** the web search page sets no restriction on analysing results. The commercial terms (D.4) bar using the services to build a competing product,
  training competing models, reselling, and reverse engineering; a citation report about a customer's site is none of those.
- **Storing:** the customer owns Outputs and Anthropic assigns its rights in them (Section B); the terms and the web search page set no storage limit.
  Anthropic may not train on Customer Content (B). The web search tool is listed as eligible for zero data retention arrangements on the retention page.
- **Display / citations:** the web search page says that when API outputs are displayed directly to end users, citations to the original source must
  be included, and that if outputs are modified, reprocessed or combined with your own material before display, citations should be shown "as appropriate"
  after consulting your legal team. **LAWYER:** the report shows derived facts (cited yes/no, domains with a link, mentioned yes/no), not the
  answer text. I made the cited domains links to the cited page for that reason. Whether that satisfies the clause is your call.
- **Sharing with third parties:** products may be built on the services for the customer's own customers and end users (A.1), with a duty to
  tell users that factual assertions in outputs may be wrong (D.3). The report's "How to read this" says answers change and are a sample.
- **Commercial use:** allowed under the commercial terms; third-party web content in results stays the third party's (A.2, L.2). Search billing: $10 per 1,000 searches.
- **Not verified:** that `claude-haiku-5-5` accepts the web search tool (read `capabilities.server_tools.web_search.supported` in the Models API for the model you use);
  the exact live response shape; the spending-limit feature (Console, Limits). No `ANTHROPIC_API_KEY` was available, so **no live call was made**.

### OpenAI

Sources: developers.openai.com/api/docs/guides/tools-web-search; openai.com/policies/services-agreement (effective 1 January 2026); openai.com/policies/service-terms (updated 29 September 2026).

- **Analysing / storing:** the customer owns Output and OpenAI assigns its rights (Services Agreement 4.1); the customer is responsible for Output and for judging its accuracy (4.3);
  Output may not be unique (4.4). Restrictions (3.3) include using Output to build competing models (with a permitted exception) and extracting data from the services other than as the services permit. The service terms page has no web-search clause.
- **Display:** the web search guide says that when web results, or information from them, are shown to end users, inline citations must be clearly visible and clickable in the user interface.
  The guide does not mention storing results. **LAWYER:** same question as above for derived facts.
- **Customer Content:** OpenAI uses it only to provide the services, comply with law, enforce policies and prevent abuse, and does not use it to develop or improve the services without agreement (4.2).
- **Sharing / commercial use:** customers may make applications available to end users (2.2). Search: $10 per 1,000 calls (all models for the current tool), with search content tokens at model rates.
- OpenAI's pages return HTTP 403 to automated fetches; I read the agreement and the service terms in a browser. The Responses API shape (`web_search` tool, `include: ["web_search_call.action.sources"]`, `url_citation` annotations) is from the guide and not tested.

### Perplexity (Sonar API)

Sources: perplexity.ai/hub/legal/perplexity-api-terms-of-service (last updated 23 January 2026); perplexity.ai/hub/legal/aup (7/8 July 2025); docs.perplexity.ai pricing.

- **Output:** the customer owns Output and Perplexity disclaims and assigns any rights (2.3.1); Output may match internet content or other users' output (2.3.2); Perplexity may not train on Customer Content (2.3.3).
- **Display / sharing:** the right to use the services is to submit Input, receive Output **and display it solely within the customer's applications** (2.1(ii)); end users of the customer's application count as the customer for compliance (2.2). **LAWYER:** a shareable report link is inside Citehound, but confirm.
- **Restrictions:** the acceptable use policy (2.4) bars building competing or substitute products and requires following the policies of third-party model providers behind the service; Perplexity may end a customer application it finds competitive with Perplexity (2.5). A citation checker about AI search is not obviously competing, but it is the clause to ask about. The terms set no storage limit that I found.
- **Cost:** $1 / $1 per million tokens for `sonar` plus $5 to $12 per 1,000 requests depending on search context size (pricing page).
- **No plain-chat mode:** Sonar always searches, so it cannot do the knowledge check. Not tested live.

## Recommendation

**Anthropic, Claude Haiku 5.5, for both the live test and the knowledge check.** One vendor and one set of terms covers both modes (OpenAI would too; Perplexity cannot do the no-search check). Its terms
say plainly that the customer owns outputs, that Anthropic does not train on customer content, and that products may serve the customer's own end users, and its
only web-search display rule is the citation sentence above. The cost is about $0.35 a report for testing and a cent for the knowledge check. Perplexity is cheaper
(about $0.16) and always searches, which is a real methodological advantage, but it has the "competitive or substitute" clause and cannot do the knowledge check. OpenAI is similar in cost to
Anthropic and requires visible, clickable citations. **A caution about this recommendation:** Anthropic also makes the assistant that wrote this, which is a reason to read
the comparison above rather than take my word for it.

A methodological caveat that applies to any provider that decides for itself whether to search: Claude (and OpenAI with `tool_choice: auto`) may answer without searching. The adapter tells the model to
search, then counts a search-mode answer with zero searches as "not tested", so a "not cited" is never recorded for a question that was not searched.

**What to verify yourself, or with counsel, before enabling in production:**

1. Anthropic: that the account accepts the web search tool for `claude-haiku-5-5` (Models API field above), a spend limit is set in the Console, and the commercial terms you accepted are the ones read above.
2. Whether showing derived facts with linked domains satisfies the display and citation sentence (LAWYER). If not, the fix is to show the answer text with its citations, which means storing it.
3. Whether the report's shareable link makes the results "displayed to end users" beyond the customer (LAWYER).
4. The first real call: `ANTHROPIC_API_KEY=… node scripts/test-citation-live.js --test --calls 3 example.com` (never more than 10 calls, default 3), then read the output. The response shape is from the docs and unverified.
5. Re-read `/privacy` and add the provider (draft wording below) in the same deploy that switches testing on.
6. Page copy: live testing is described nowhere on the site (the site says "citation questions", and "In preparation" for testing). Update /pro, /citation-tracking, the start form and the mail text in the same deploy.

### Draft /privacy wording if testing or the knowledge check is switched on (not published)

> Citation testing (Pro, only when a report includes it): the citation questions Citehound wrote for the site are sent, one at a time, to Anthropic (Claude, with its web search
> tool, and without it for the model knowledge check). The requests contain the question and a short instruction. They contain no part of the site's text, no name, no email
> address and no contact detail. Anthropic returns an answer, and for the search check the pages it cited. Citehound keeps only whether the site was cited or named, the domains of the
> other cited pages with a link, the model name and the date, for 90 days with the report, and not the answer text. Anthropic's commercial terms say it does not train its models on this
> content. The results are a dated sample from one assistant, not a ranking.

## Before you switch anything on

**Questions mode (the only one meant for production):**

1. Confirm billing is active on the Google Cloud project that owns the key, and set a budget alert there. (Required for EEA/Swiss/UK users and for the paid data terms.)
2. In Vercel (production) set `GEMINI_API_KEY` and `CITATION_QUESTIONS_ENABLED=1`; redeploy.
3. Run `node scripts/test-citation-live.js example.com` once from your machine and read the output; start one real report with a pilot link and read the section.

**Live testing or the knowledge check (not yet):** the six items above, then `CITATION_TEST_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `CITATION_TEST_ENABLED=1` and/or `CITATION_KNOWLEDGE_ENABLED=1`.

## Why grounding was retired

The first version of this feature asked the questions through Gemini with the Google Search tool. Google's terms for grounded results do not permit what that design does
(analysis of the results, displaying them without Search Suggestions, a report link that others can open), the free tier cannot ground at all (HTTP 429), and the response shape was
never verified against a live response. The adapter is deleted. `scripts/test-citation.js` fails if `google_search`, `groundingMetadata`, a redirect resolver or a `geminiProvider` reappear in the Pro
citation code. The local tracker (`scripts/citation-check.js`) keeps a `--grounded` flag from before; it is refused unless `GOOGLE_GROUNDED_ANALYSIS_PERMISSION=confirmed` is also set, which is for
an owner who has Google's written permission. The published CRM sample was made without web search and is not affected.

## Live runs

- 10 Oct 2026, free-tier Gemini key, **before** the changes in this file: grounded calls answered 429 on both sites and the check stopped at once; questions were 18 + 2 on getcitehound.com (the duplicate bug) and 18 + 3 on lexware.de.
- 10 Oct 2026, **after**: `node scripts/test-citation-live.js getcitehound.com` (questions only): crawl 25 pages in 35 s, profile correct (English, saas), 18 + 3 questions, 2 Gemini calls, 2,264 input and 615 output tokens.
- No provider key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`) was present in `.env.local`, so no live testing or knowledge call has been made. The adapter is covered by mocks only.
