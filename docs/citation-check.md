# The Pro citation questions and the citation check

A Pro report carries a **Citation questions** section: Claude reads the site, writes 21 predicted questions in the site's own language (18 that do not
name the brand, grouped by topic, and 3 that do, each non-English one with a short English gloss), and the report lists them as **"Predicted questions,
generated from your site"** with a "Copy all questions" button. They are predictions, never observed buyer prompts, and they say nothing about real search volume.

On top of that a report can carry a **citation check**: a deterministic sample of the questions (default 10), one run each, on Claude with its web search
tool and, if switched on, on Perplexity's search. Each provider gets its own section with the provider and the model in the title. A report with no check labels
its questions "Not tested. Try these in your own assistants."

Everything below is OFF until you switch it on. Nothing public says a result exists unless the report itself shows it.

## The switches (all off unless exactly `1` AND the key is there)

| Variable | Needs | What it turns on |
|---|---|---|
| `CITATION_QUESTIONS_ENABLED` | `ANTHROPIC_API_KEY` and `CITATION_ANTHROPIC_ENABLED` | the profile and the 21 questions, written by Claude without search. This alone gives the "Citation questions" section |
| `CITATION_ANTHROPIC_ENABLED` | `ANTHROPIC_API_KEY` | lets Claude be used at all (questions, check, knowledge check) |
| `CITATION_TEST_ENABLED` | the questions switch and at least one provider ready | the live check on every provider that is ready |
| `CITATION_OPENAI_ENABLED` | `OPENAI_API_KEY` | ChatGPT (OpenAI API, web search on) joins the check. Exact value `1`, off by default. Read "ChatGPT" below first |
| `CITATION_PERPLEXITY_ENABLED` | `PERPLEXITY_API_KEY` | Perplexity joins the check. **Leave it off** until you have read "Perplexity" below |
| `CITATION_KNOWLEDGE_ENABLED` | Claude ready | the model knowledge check (Claude, no search, same sample): only whether the brand or domain appears in the answer. Never citation tracking, never a "cited" column |
| `CITATION_KILL` | nothing | `1` stops every paid call at once (after a redeploy); the instant, no-redeploy switch is `node scripts/pro-admin.js kill on` |
| `CITATION_MODEL`, `CITATION_OPENAI_MODEL`, `CITATION_PERPLEXITY_MODEL` | | the models. Defaults `claude-haiku-5-5`, `gpt-4.1-mini` (not yet run live) and `perplexity/sonar` |
| `CITATION_<ENGINE>_MAX_CALLS`, `_MAX_COST_USD`, `_DAILY_BUDGET_USD` | | per-engine caps (`ENGINE` = `ANTHROPIC`, `OPENAI`, `PERPLEXITY`); unset, they equal the overall caps. One engine reaching its cap stops that engine only |
| `CITATION_QUESTION_SAMPLE` | | questions asked per provider, default 10, hard ceiling 18 |
| `CITATION_MAX_CALLS`, `CITATION_MAX_COST_USD` | | per report: paid calls (default 30, ceiling 60) and cost (default $0.50, ceiling $2); with all three engines on the defaults are 40 and $0.75 |
| `CITATION_DAILY_BUDGET_USD`, `CITATION_MONTHLY_BUDGET_USD` | | all reports together: default $2 a day and $4 a month, ceilings $50 and $200 |
| `CITATION_QUESTIONS_PROVIDER=gemini` | `GEMINI_API_KEY` | the **disabled fallback** question writer (Gemini, no search). Never selected by accident; no work is planned on it |

Removed and now ignored: `CITATION_ENABLED`, `CITATION_TEST_PROVIDER`, `CITATION_DAILY_CAP`, `CITATION_MONTHLY_QUERY_CAP`, `CITATION_QUESTIONS_DAILY_CAP` (replaced by the dollar budgets).
There is no Google Search grounding anywhere in the Pro code, and the local tracker's `--grounded` flag and code path are deleted (see "Why grounding was retired").
`docs/env.md` lists every variable with where to set it.

## How a report runs

After the crawl (and only if at least one page was read) the job goes through up to four more phases, driven by the same browser-made step calls and the same
per-job lock as the crawl: a closed tab pauses it, reopening the same link resumes it (`lib/pro-citation.js`).

1. **profile**: the homepage and up to four key pages are read again, one request a second, and Claude describes the site as `{language, siteType, category, offering, audience, geography, brandName}` (`lib/site-profile.js`).
2. **questions**: 18 + 3 questions, in the site's language, validated by rules (`lib/citation-prompts.js`).
3. **cite** (test switch): up to two Claude calls in parallel and, beside them, up to two Perplexity calls one after the other (Perplexity answers one request a second), per step; never more than three at once, so a step stays well under the function's 60 s.
4. **know** (knowledge switch): three plain Claude calls per step.

The sample is deterministic: from the 18 questions that do not name the brand, balanced round-robin across the five topics (two from each at ten), each topic ordered by a hash of the report id and the question. The same report always asks the same ten; brand-naming questions are never asked.

**Never paid twice.** A question's attempt is marked in Redis before its call (`HSETNX`, set once). If a step dies between the call and the stored result, the next step sees the marker without a result and records "interrupted": the call is not repeated.

**Guards before every paid call** (`lib/citation-budget.js`): the kill switch (env and a Redis flag), the per-report call and cost caps, the daily and monthly budgets. Costs are integer micro-dollars in Redis hashes moved with `HINCRBY` (atomic): the worst-case estimate is added first, any limit passed rolls it back and the call is not made, and after the call the estimate is replaced by the real cost (token usage and searches for Claude, the provider's own `usage.cost` for Perplexity). If Redis cannot be reached the answer is "no". Only aggregate counters are stored (per day and month, per provider: calls and micro-dollars); the per-report figures sit on that report's record.

**Failures** never fail a report: HTTP 429 gets one backoff and one retry (the wait is `Retry-After`, 1 to 8 s), then stops that provider for that report; timeouts are not retried (the call may have been charged); a refusal, an empty answer, a paused search turn, an answer that never searched, or three failures in a row stop that provider. A budget cap or the kill switch stops all providers. The report then shows what was tested ("Partial. 6 of 10 questions were tested. <reason>") or, for a provider with nothing: "Citation check unavailable for <provider>; the questions below are still yours to use."

**What is sent to a provider:** the question text, a generic locale tag (for example `tr`), and a short fixed instruction. Never the domain, a name, an address, a token, an order or report id. For the questions, Claude is sent excerpts of the site's own public page text (up to 12,000 characters). Keys are only ever in request headers.

**What is stored (90 days, with the report):** the profile, the 21 questions, the sample; per question and provider: cited yes/no, brand name in the answer text yes/no (a plain string match), up to 8 other domains with one https link each (no query string), the number of searches, the model, the date and the cost. **No answer text is kept.** Per report: the number of paid calls and the cost.

**Only valid Pro order links can start paid calls** (paid or pilot). The free scan, the MCP server, the waitlist, the site tools and the mail code do not load the providers at all (a test checks it). An order whose label starts with `e2e` or `smoke` never starts the citation part, even with every switch on, so `scripts/e2e-live.js` and the smoke test can never cost money.

## Verified on 11 October 2026

Live calls with the project's own keys (no secret printed) and the official pages.

**Anthropic**
- `GET https://api.anthropic.com/v1/models`: `claude-haiku-5-5` ("Claude Haiku 5.5", created 2026-10-07) is listed with `capabilities.server_tools.web_search.supported: true`; the older "claude-haiku-4-5-20251001" too. So the earlier report's id is right.
- A live call with tool `{type: "web_search_20250305", name: "web_search", max_uses: 2}` returned HTTP 200: web search **is enabled for this organization**. Shape (recorded in `scripts/fixtures/provider-shapes.js`): content blocks `thinking` (empty text, ignored), `server_tool_use` (the query), `web_search_tool_result` (the results seen), and `text` blocks carrying `citations` of type `web_search_result_location` with `url` and `title`; `usage.server_tool_use.web_search_requests` counts the searches. Haiku 5.5 emits thinking blocks by default; the output tokens include them.
- Structured output works with `output_config.format = {type: "json_schema", schema}` (checked live for the profile and the questions); it forbids `maxItems`, length bounds and `additionalProperties` other than `false`, so the adapter rewrites the schema.
- Sources: platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool (tool versions `web_search_20250305`, `web_search_20260209`, `web_search_20260318`; `max_uses`; `pause_turn`; **$10 per 1,000 searches**; ZDR-eligible; an org administrator can disable it in the Console, which makes a request that includes the tool fail with a 400); platform.claude.com/docs/en/build-with-claude/structured-outputs; platform.claude.com/docs/en/about-claude/pricing (Haiku 5.5: $0.10 in, $0.50 out per million tokens for prompts up to 100,000 tokens). Rate-limit headers on the reply: 1,000 requests, 500,000 input tokens a minute.

**Perplexity**
- `GET https://api.perplexity.ai/v1/models` lists `perplexity/sonar` ($0.25 in, $2.50 out per million tokens) beside models from Anthropic, OpenAI, Google and xAI.
- Perplexity's own page (docs.perplexity.ai/docs/sonar/quickstart) says Sonar Chat Completions support **ended on 27 September 2026** and moves to the Agent API. `POST /v1/sonar` with our key answers **401 invalid key**, so it is not used. `POST https://api.perplexity.ai/v1/agent` with `{"model": "perplexity/sonar", "input": ..., "tools": [{"type": "web_search"}]}` works (HTTP 200).
- Reply shape (recorded): an `output` array with a `search_results` item (`queries` and `results`, each with `id`, `title`, `url`, `snippet`, `date`) and a `message` item (`content[].output_text`); `usage.cost` has the real cost in USD (`total_cost`, `tool_calls_cost` $0.0025 per search). `annotations` came back empty and the text carried no `[web:N]` markers in the probes, so **the pages Perplexity returned are recorded, not pages it cited**. The report says "among the sources returned".
- Rate limit: replies carry `x-ratelimit-limit: 1` (one request a second); a 429 comes with `Retry-After` and is not billed (docs.perplexity.ai/docs/admin/rate-limits-usage-tiers, which describes this for its orchestrator API; the Agent API's own wording was not found, so this is read from the reply headers).

## Measured cost (real calls, 11 October 2026)

Two live runs on getcitehound.com (3 questions per provider) and one full pilot-token run (crawl, questions, 10 questions on each provider).

| Call | Tokens | Searches | Real cost |
|---|---|---|---|
| Claude, search, one question | about 14,400 to 15,200 in, 1,300 to 1,400 out | 1 | $0.0122 each (3 calls: $0.0365) |
| Perplexity `sonar`, one question | about 4,400 to 5,000 in, 240 to 400 out | 1 | $0.0043 to $0.0047 each (3 calls: $0.0136) |
| Claude writes the profile and the questions (3 calls) | 5,900 in, 3,400 out | 0 | $0.0023 |
| Claude knowledge check, one question | 110 to 120 in, 850 to 1,270 out | 0 | $0.0004 to $0.0007 each |

Per report with the defaults (10 questions): **Claude only about $0.125** ($0.0023 + 10 × $0.0122); **Claude and Perplexity about $0.17** (+ 10 × $0.0045); the knowledge check adds about $0.005. The report's own cost cap ($0.50) is about four times the Claude-only cost.
The reservation counters count a call at a worst-case estimate until it finishes (Claude $0.03, Perplexity $0.012), so the day and month budgets are conservative while calls are in flight.

## Terms (re-read 11 October 2026; paraphrased, with where to read the original)

Nothing here is legal advice. **LAWYER** marks what I cannot settle.

### Anthropic (Claude): enabled path

- **Commercial Terms** (anthropic.com/legal/commercial-terms, the page shows "Effective June 17, 2025" as current): the customer owns Outputs and Anthropic assigns whatever rights it has (B); Anthropic may not train models on Customer Content (B); the customer may use the Services to power products for its own customers and end users (A.1) and must tell users that factual claims in outputs may be wrong or out of date (D.3); no building a competing product or training competing models, no reselling, no reverse engineering (D.4); third-party features and content are the third party's, not Anthropic's responsibility (A.2); Anthropic may suspend access for violations of D.1, D.2 or D.4 or for risk (I.3). The report's scope text says results vary and are a sample, and I added that answers can be inaccurate or out of date (D.3).
- **Acceptable Use Policy** (anthropic.com/legal/aup; the page states an effective date of 12 November 2026, a date after today, so read it as published): no circumventing other platforms' guardrails or terms; no using outputs to train a model without authorization; no reselling or proxying access; agentic use is the customer's responsibility. **LAWYER:** one universal standard forbids manipulating the sources that search engines or AI systems draw their answers from. Citehound reports whether a site is readable and cited, and its fixes are standard technical changes (crawler access, structured data), which is not manipulation as I read it, but a product in the "improve how AI sees your site" category should have that clause read by counsel.
- **Web search tool page** (platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool): when API outputs are displayed directly to end users, citations to the original source must be included; if outputs are modified, reprocessed or combined with your own material before display, citations are to be shown as appropriate, after consulting your legal team. The report shows derived facts (cited yes/no, brand in text yes/no, other domains as links to the cited page), not the answer text, so each cited domain is a link to a page the answer cited. **LAWYER:** whether that satisfies the sentence.
- **Sharing:** the report link can be opened by anyone who has it, so the results can reach people beyond the buyer. The terms allow serving the customer's own users; nothing found limits sharing derived facts. **LAWYER**, because the web search page speaks of "end users".
- **Data:** the retention page lists web search as ZDR-eligible; retention periods are in the DPA, which I did not read.

### Perplexity: built, verified live, **left off**

- **API Terms of Service** (perplexity.ai/hub/legal/perplexity-api-terms-of-service, last updated 23 January 2026; names "Sonar by Perplexity and/or Agentic Research"): the customer owns Output and Perplexity assigns any rights (2.3.1); Perplexity may not train on Customer Content (2.3.3); the right to use the service is to submit Input, receive Output and **display it solely within the customer's applications** (2.1(ii)); end users of the customer's application count as the customer (2.2); Perplexity may end the licence for an application it judges competitive with Perplexity (2.5); third-party models carry their own terms (2.6).
- **Acceptable Use Policy** (perplexity.ai/hub/legal/aup, last updated 8 July 2025): bars making products or services that compete with, resemble or could substitute for the Services, probing or testing the services' vulnerabilities, and requires following the policies of the third-party models behind them.
- **Third-party models** (perplexity.ai/hub/legal/third-party-models, last updated 25 November 2025): says Sonar is based on Meta's Llama 3.1 70B, fine-tuned, so Meta's licence and use policy come with it.
- **Analysis for Citehound.** Display: the report page is inside Citehound and the results are derived facts, so 2.1(ii) is probably met, but a shareable link is the case to ask about. Competitor or substitute: a tool that reports whether a site appears in Perplexity's search is complementary to it, not a substitute, but "similar to" is broad and 2.5 gives Perplexity a termination right that needs no breach. The pages it returns are not marked as cited.
- **Recommendation: keep `CITATION_PERPLEXITY_ENABLED` unset.** The analysis is not clearly fine: the competitor and substitute wording, the Llama dependency, the "returned, not cited" semantics, and a one-request-a-second limit. If you want it, write to api@perplexity.ai first and ask whether a report that shows, per question, whether a customer's domain was among the search results returned, to that customer and anyone the customer shares the report link with, is within 2.1(ii) and not caught by the competitor clauses. If they say yes, keep their answer. **LAWYER** for the rest.

### Google (Gemini): only the disabled fallback

ai.google.dev/gemini-api/terms (effective 23 March 2026): unpaid use may be used by Google to improve its products; paid use (a Cloud project with active billing) is not, and only paid services may be used for users in the EEA, Switzerland and the UK. This matters only if you set `CITATION_QUESTIONS_PROVIDER=gemini`; then `/privacy` must be changed back to name Google.

### Draft /privacy wording if Perplexity is ever switched on (not published)

> Perplexity (Pro, only when a report includes it): the generated question text and a language tag (nothing else: no site text, no domain, no personal detail) are sent to Perplexity, which runs a web search and returns an answer and the pages it found. Citehound keeps, for the 90 days of the report, only whether the site&rsquo;s domain was among the pages Perplexity returned, whether the brand name appears in the answer, the other returned domains with a link, the model name and the date, and the cost of the call: not the answer text. Perplexity&rsquo;s API terms say it does not train its models on this content. The results are a dated sample from one provider, one run per question, not a ranking.

Publish it in the same deploy that sets `CITATION_PERPLEXITY_ENABLED`, and add Perplexity to the list in `docs/env.md` and on `/privacy`.

## Why grounding was retired

The first design asked the questions through Gemini with the Google Search tool. Google's terms for grounded results do not permit what it did (analysing results, showing them without Search Suggestions, a report link others can open), the free tier cannot ground at all, and the response shape was never verified. The adapter is gone, `scripts/test-citation.js` fails if `google_search`, `groundingMetadata` or a redirect resolver reappears, and the local tracker (`scripts/citation-check.js`) no longer has a `--grounded` flag or any code behind it: it asks plain questions only.

## Live runs

- 11 Oct 2026: `node scripts/test-citation-live.js getcitehound.com`: crawl 25 pages, profile and 18 + 3 questions by Claude, 3 writer calls, $0.0023.
- 11 Oct 2026: `node scripts/test-citation-live.js --test --knowledge --calls 3 getcitehound.com`: 3 questions on Claude (cited no, brand in text no, 4 to 8 other domains each), 3 on Perplexity (returned no, brand no, up to 8 domains), 3 knowledge calls (named no); total $0.054.
- 11 Oct 2026: one full pilot-token run on getcitehound.com through the real HTTP flow (issue link, start, 14 steps, report page): 114 s, 20 paid questions, status done, both provider sections present, 0 of 10 cited and 0 of 10 brand-in-text on both providers.

## Before you switch anything on

See `docs/launch-checklist.md` ("Citation check") for the order of the steps, the exact variable names, the redeploy and the way back.

## ChatGPT through the OpenAI API (added 15 Oct 2026, internal note: not on the site, not in /privacy)

**What it is.** A third engine beside Claude and Perplexity, behind `CITATION_OPENAI_ENABLED=1` and `OPENAI_API_KEY`, off by default. It asks the same sample of questions (10, one run each) with the Responses API
and its web search tool, and records the pages the answer cites. Reports label it "ChatGPT (OpenAI API, web search on)", with the model and the sample date, and every engine's section says "API results can
differ from what the consumer apps show". It is a dated sample, never a ranking or a share of voice. There is no Gemini engine and none is planned until Google's terms have been reviewed.

**The call** (read from developers.openai.com on 15 Oct 2026; **not run live**, because there was no OpenAI key to test with): `POST https://api.openai.com/v1/responses`, bearer key in the header only, body with `model`,
`instructions`, `input` (the question), `tools: [{"type": "web_search"}]`, `tool_choice: "required"`, `store: false`, `max_output_tokens: 2000`. The reply's `output` has `web_search_call` items and a `message` item whose
`content[].output_text` carries `annotations` of type `url_citation` (`url`, `title`, `start_index`, `end_index`): those URLs are the citations (kind "cited"). A failure, a timeout (35 s, not retried), a refusal, an empty or
incomplete answer or an answer that never searched is recorded as "not tested" with its reason; nothing is filled in. When an engine fails three times in a row, or a cap is reached, the report says "Citation check unavailable for
ChatGPT" and still shows the other engines. OpenAI's own page also lists `gpt-5.5` as the recommended model for web search; its price was not on the pricing page, so it is not the default, and an unlisted model is
priced like the dearest listed one so the guard overestimates.

**Perplexity, to be exact.** Perplexity's own page says Sonar Chat Completions support ends on 27 September 2026 and moves to the Agent API (re-read 15 Oct 2026). The adapter was already on that API with the `perplexity/sonar`
model, so "Sonar via API, web search on" is what the report says. Two live calls on 15 Oct 2026 worked (15 pages returned each, $0.0045 each). The terms analysis under "Perplexity: built, verified live, left off" below still stands.

**Caps.** Order of checks before every paid call: kill switch (env or Redis, covers all engines), overall per-report calls and cost, overall daily and monthly budgets, then the engine's own caps. An engine cap
stops that engine only. `node scripts/pro-admin.js spend` lists calls and cost per engine.

**Cost per report (an estimate, not a measurement for ChatGPT).** Prices from OpenAI's pricing page, 15 Oct 2026: gpt-4.1-mini $0.40 in and $1.60 out per million tokens, web search $10 per 1,000 calls plus search content
tokens at the model rate. Assuming about 8,000 tokens in, 400 out and one or two searches per question: about $0.014 to $0.024 a call, **$0.14 to $0.24 for ten questions**. With all three engines: Claude about $0.125
(measured), ChatGPT $0.14 to $0.24 (estimate), Perplexity about $0.045 (measured), the knowledge check about $0.005: **about $0.31 to $0.42 a report**. The reservation estimate for a ChatGPT call is $0.04.

**Before switching it on.** (1) Set a spending limit in the OpenAI dashboard. (2) Read OpenAI's current terms and usage policies for displaying outputs and for automated use (not reviewed here). (3) Run
`node scripts/test-citation-live.js` once, with at most two ChatGPT calls, to confirm the shape above. (4) Publish a /privacy paragraph for OpenAI in the same deploy, as for Perplexity: the question text and a language tag
go to OpenAI, nothing else. Draft: "ChatGPT (Pro, only when a report includes it): the generated question text and a language tag are sent to OpenAI's API, which runs a web search and returns an answer with the pages it cited.
Citehound keeps, for the 90 days of the report, which pages were cited and whether the brand or domain appears in the answer, not the answer text. OpenAI is asked not to store the request."

