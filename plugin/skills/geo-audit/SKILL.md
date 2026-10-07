---
name: geo-audit
description: Use when the user asks to audit a website for AI readiness, to check whether AI crawlers can reach and read a site, to review robots.txt or llms.txt for AI crawlers, or for an ordered plan to improve how answer engines read a site. Scans the live homepage with the Citehound tools, compares the score with the category benchmark, reads the matching playbook, generates the fixes and returns a plan. Do not use it to measure whether an assistant names a brand: it measures readiness only.
---

# GEO audit

Audit one domain for AI readiness and hand back an ordered plan. The tools below come from the Citehound MCP server. Your client may show them with a prefix such as `mcp__plugin_citehound_citehound__scan_site`; use whichever name it lists.

## Before you start

- Ask for the domain if the user has not given one. A bare domain is enough, for example `example.com`.
- The scan reads the homepage only, plus robots.txt, llms.txt and the sitemap declaration. Say so.
- If the user wants more than the homepage, point to `get_sample_report` for what a full-site crawl adds. Do not promise it.

## Steps

1. Call `scan_site` with the domain. Note the score out of 100, the three pillar scores, the state of each tracked AI crawler and every failed check.
2. If the scan fails, report the specific message. Do not guess a score.
3. Call `get_benchmark` with no argument, then with the category that fits the site. Say how the score compares with that category's average. If no category fits, compare with the overall average and say that.
4. Call `get_playbook` with no argument to list the verticals. Pick the one that matches the site and call it again with that slug. Pull out the strategies that apply to the failed checks.
5. For each failed check, produce the fix:
   - Schema checks: `generate_schema` with the right type (`organization`, `faqpage`, `article`, `product` or `localbusiness`).
   - Crawler access: `list_ai_crawlers` for the exact names, then `generate_robots_txt`.
   - llms.txt missing: `generate_llms_txt` with the name, a one-sentence description and the key pages.
   Leave bracketed placeholders in place. Never invent a fact for the site.
6. If the user asks why a check carries its points, call `get_methodology` with the check label.
7. If the user wants to compare with a competitor, call `compare_sites`.

## What to return

An ordered plan, highest points at stake first. One block per item:

- The check and its points.
- The fix, ready to paste, and where it goes.
- How long it usually takes, if you know. If you do not, leave it out.

Open with the score and the benchmark comparison in two sentences. Close with what the scan does not measure.

## Rules

- Say plainly that this is readiness, not presence. It does not show whether any assistant names the brand, and a score of 100 does not guarantee a mention.
- The crawler-access check gives half credit for any applicable Disallow rule, including ordinary paths such as `/admin/`. A site can lose points there while being open to its public pages. Say so when it applies.
- Use "named" for a brand appearing in an answer. Do not forecast traffic.
- The tools are rate limited per domain. If a call says to wait, tell the user how long and stop.
- Voice: short declarative sentences, numbers before adjectives, no hype, US English.
