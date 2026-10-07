---
name: citation-ready-content
description: Use when the user wants to write, brief or review content so that it is easier for AI answer engines to quote and name, for example a page, an article, an FAQ or a product description for a given industry. Uses the Citehound playbook for the user's vertical to brief or review the content. No scan is needed. Not a promise of being named: it improves how citable the content is, not whether any assistant names the brand.
---

# Citation-ready content

Brief or review content for citability using the playbook for the user's vertical. This needs no scan and fetches no site. The tools below come from the Citehound MCP server; your client may show them with a prefix.

## Steps

1. Find the vertical. Ask what the business does if it is not clear. Call `get_playbook` with no argument to list the fourteen verticals, and pick the closest. If none fits, say so and use the nearest one.
2. Call `get_playbook` with that slug. Read the strategic shift, the three strategies and the pitfalls to avoid.
3. Choose the mode:
   - Brief: the user has not written the content yet. Produce an outline with a working title, one H1, H2 sections that each answer one question, the facts that must be stated plainly (who, what, where, how much, how to contact), and the structured data to add (use `generate_schema` for the type, with placeholders).
   - Review: the user pasted content. Check it against the playbook and the points below. Quote the lines that need work and say what to change.
4. If the user wants the questions buyers ask in their category, call `get_citation_prompts` with the vertical. Use the questions to decide which sections the content must answer. They do not name brands.
5. If the user asks what the playbook's advice rests on, call `get_research`.

## What good looks like

- One H1 that names the topic. At least two H2 sections, each opening with a direct answer in the first sentence.
- Specific facts, stated once and in plain words: names, numbers, places, dates. Where a fact is unknown, leave a bracketed placeholder. Never invent one.
- An about page and author information the content can point to, and a contact route.
- The citation sources the playbook lists for this vertical, such as review sites or directories, treated as places the brand needs a presence, not as content to write.

## Rules

- Say plainly that this makes content easier to quote. It does not make any assistant name the brand, and no one can promise it.
- Do not fill the playbook's expert-tip placeholders. They are the owner's point of view.
- Use "named" for a brand appearing in an answer. Do not forecast traffic or rankings.
- Do not invent statistics, testimonials or client results.
- Voice: short declarative sentences, numbers before adjectives, no hype, US English.
