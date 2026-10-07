---
name: agentic-commerce-readiness
description: Use when the user runs an online store and asks whether shopping agents can read it, about the Universal Commerce Protocol or a UCP endpoint, Product schema, product data quality for AI, or whether their llms.txt was written by the brand or is a platform default. Scans the store with the Citehound tools, reads the commerce sub-score, and returns what to fix with a replacement llms.txt where needed. Not for sites that are not stores.
---

# Agentic commerce readiness

Check whether a store can be read by shopping agents. The commerce checks run only when the scan treats the site as a store, and they are scored separately from the 100-point readiness score. The tools below come from the Citehound MCP server; your client may show them with a prefix.

## Steps

1. Call `scan_site` with the store's domain.
2. Find the commerce section of the report. If it says the site is not treated as a store, stop. Say how many of the five store signals fired and which ones, and do not run the other steps.
3. Report the platform if one was detected, then each part of the sub-score:
   - UCP endpoint: whether a merchant profile exists at `/.well-known/ucp`, its version and its capabilities.
   - Product schema on the one product page the scan reads: which of name, price, availability and image are present, and the URL it checked.
   - llms.txt authorship: whether the file looks like a platform default, custom or unclear.
4. If product data is incomplete, call `generate_schema` with type `product`. Say which fields come from the store's catalog (price, availability, image) and leave them as placeholders.
5. If the llms.txt looks like a platform default, explain why that matters: a default file describes the platform, not the brand. Then call `generate_llms_txt` with the brand name, a one-sentence description and the key pages (collections, shipping and returns, about, contact). Tell the user to check every line against the real store before publishing.
6. If there is no UCP endpoint, say what the protocol is for in one sentence and that adding it depends on the platform. Do not invent steps for a platform you have not checked.
7. Call `get_playbook` with slug `ecommerce` and take the content advice that applies.

## What to return

- The sub-score as points earned out of points assessed, and what was not assessed and why.
- A fix list in order of points, each with the paste-ready output where the tools produce one.
- The replacement llms.txt, if it applies.

## Rules

- The commerce sub-score never counts toward the 100. Say so.
- The scan reads one product page only, and only where robots.txt allows it. A product page that could not be found or read is "not assessed", never a failure.
- Say plainly what this does not measure: whether any agent or assistant names or buys from the store. It measures readiness.
- Platform detection is a pattern match and misses some stores. If the scan said "not a store" for a store the user knows is one, say the detection can miss.
- Use "named" for a brand appearing in an answer. Do not forecast sales or traffic.
- Voice: short declarative sentences, numbers before adjectives, no hype, US English.
