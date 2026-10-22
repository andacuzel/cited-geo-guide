---
name: compare-with-competitor
description: Compare the AI readiness of two domains with Citehound and explain where they differ and what to change first. Use when the user wants to compare their site with a competitor or with another named site.
---

# Compare with a competitor

Compare two domains with the Citehound `compare_sites` tool and turn the differences into a short, ordered list of what the user's site could change.

## Steps

1. **Get both domains.** The user's own site first, the other site second. Pass bare domains such as `example.com`, with no `https://`, path or port. They must be different. Ask if one is missing.
2. **Run `compare_sites`** (a tool of the Citehound MCP server this plugin connects). It scans the two sites one after the other and can take up to a minute. If one site cannot be read, the tool says so: report that and show what it did return. Do not guess the missing score.
3. **Give both scores** exactly as returned, with the three pillar scores for each (Discoverability, Technical foundation, Content & trust).
4. **Go through the differences.** The tool lists the checks where the two sites differ. Group them: where the other site is ahead, where the user's site is ahead, and where they are level. For each check that matters, say in a sentence what it covers.
5. **Turn it into an order of work.** From the checks where the user's site is behind, list the changes with the biggest point gaps first. Say what to do and where it is done. Leave out checks where the user's site is level or ahead, except to say what it already does well.
6. **Say what the comparison is.** Both scores are readiness scores: crawler access and on-page signals from one page of each site. A higher score means more of those signals are in place. It does not mean any assistant prefers, recommends or cites that site, and the scan does not say how either site appears in assistants' answers. Say this once, plainly.
7. **Offer the next step.** To make the changes, offer the `fix-ai-crawler-access` skill. To score only the user's site in more detail, offer `scan-my-site`.

## Rules

- Quote numbers exactly as returned. Do not add scores or percentages of your own.
- Do not promise that closing the gap will change traffic, rankings, citations or revenue.
- Be fair to the other site: describe what a scan of its public pages shows, nothing about its business.
- Plain English, short sentences. No "official", "verified" or partner claims.
