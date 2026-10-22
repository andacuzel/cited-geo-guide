---
name: scan-my-site
description: Scan a domain with Citehound and explain its AI readiness score in plain language, with the fixes in priority order. Use when the user asks how ready a site is for AI crawlers and AI answers, wants a site scored, or asks what to fix first.
---

# Scan my site

Scan one domain with the Citehound `scan_site` tool, explain the result to someone who is not an SEO specialist, and list what to fix, most valuable first.

## Steps

1. **Get the domain.** Ask for it if the user has not given one. Pass a bare domain such as `example.com`: remove `https://`, any path and any port. The scan reads the domain's `robots.txt`, `llms.txt`, sitemap declaration and homepage. It is one page, not the whole site.
2. **Run `scan_site`** (a tool of the Citehound MCP server this plugin connects). If it returns an error, say what the error says, in plain words: a site that could not be read, or a limit that was reached. Do not invent a score and do not retry in a loop.
3. **Say what the score is.** Give the score out of 100 exactly as returned, then in one or two sentences: it is a readiness score. It shows whether AI crawlers can reach the site and whether its pages carry signals a model can read. It does not show whether any assistant names, recommends or cites the brand. Say this once, near the top, and do not repeat it in every paragraph.
4. **Explain the three pillars** in one line each, with their scores: Discoverability (can crawlers find and reach the site), Technical foundation (can machines parse the page), Content & trust (does the page show who is behind it and what it is about).
5. **Report crawler access.** Name how many of the tracked AI crawlers are open, limited or blocked. Name the blocked ones. A "limited" crawler can reach the site but has some paths disallowed. Do not call a block good or bad: say what it means and let the user decide.
6. **List the fixes in priority order**, highest point value first, as the tool lists them. For each one: what failed, why it matters in a sentence, what to do, and where it is done (for example "in your robots.txt" or "in the page's `<head>`"). Keep each to two or three sentences. If nothing failed, say so and stop there.
7. **Offer the next step.** For crawler, `robots.txt`, `llms.txt` or schema fixes, offer the `fix-ai-crawler-access` skill. To see where a competitor stands, offer `compare-with-competitor`.

## Rules

- Quote numbers exactly as returned. Do not round, estimate or add scores the tool did not give.
- Compare with the benchmark only if the tool returned a benchmark line, and say it is Citehound's own archive of scans.
- Promise nothing about traffic, rankings, citations or revenue. Do not say a fix will make an assistant mention the site.
- `llms.txt` is optional and has no demonstrated effect on Google. Say so if you mention it.
- Use plain English and short sentences. Do not call Citehound or its tools "official" or "verified" and do not name any partner.
