---
name: fix-ai-crawler-access
description: Generate a robots.txt that allows or blocks named AI crawlers, an llms.txt and JSON-LD structured data for a site with the Citehound tools, and say where each file goes. Use when the user wants to fix AI crawler access, write or change robots.txt rules for AI bots, create an llms.txt, or add structured data.
---

# Fix AI crawler access

Produce the files that close the gaps a Citehound scan found: `robots.txt` rules for the tracked AI crawlers, an `llms.txt`, and JSON-LD. Then say exactly where each one goes. The tools only write text for the user to use. They change nothing on the site.

## Steps

1. **Know the current state.** If the user has not scanned the site yet, run `scan_site` for the domain first and read which crawlers are open, limited or blocked and which checks failed. If the user only asked for a file, skip the scan.
2. **Get the exact crawler names.** Run `list_ai_crawlers`. Use only its names, spelled as returned.
3. **Ask before blocking anything.** Allowing or blocking a crawler is the site owner's decision. Explain in a line what each choice means (the tool's list describes each crawler), then ask which crawlers to allow and which to block. Never block one the user did not choose.
4. **Run `generate_robots_txt`** with `allow` and `block` lists, and `sitemap_url` if the site has a sitemap. Show the text in a code block.
5. **llms.txt (only if the user wants it).** Say first that `llms.txt` is optional, costs little, and has no demonstrated effect on Google. Citehound does not measure whether any system reads it. Run `generate_llms_txt` with the site name, a one-sentence description and the key pages, most important first. Ask the user for these, or use what the user's own pages say. Do not invent facts: put unknowns in square brackets for the user to fill in.
6. **Structured data (if asked or if the scan flagged it).** Run `generate_schema` with the domain and a type: `organization` (the default), `faqpage`, `article`, `product` or `localbusiness`. The tool leaves fields it cannot know in square brackets, such as a company's one-line description or a FAQ's real questions. Tell the user to fill those in before publishing and not to publish placeholder text.
7. **Say where each file goes.**
   - `robots.txt`: at the site root, so it opens at `https://<domain>/robots.txt`. If the site already has one, do not replace it blindly: compare, keep the existing `Disallow` rules for private paths, and add or edit only the AI crawler groups.
   - `llms.txt`: at the site root, `https://<domain>/llms.txt`, as plain text.
   - JSON-LD: inside a `<script type="application/ld+json">` tag in the `<head>` of the page it describes (the homepage for an Organization). A site builder or CMS often has a "custom code in head" setting for this.
8. **Check afterwards.** Once the user has published the files, offer to run `scan_site` again and compare the checks and crawler states with the first scan.

## Rules

- State what changes, never what will result. Do not promise more traffic, rankings, citations or revenue, and do not say assistants will start recommending the site.
- The score is a readiness score (crawler access and on-page signals). It does not show whether any assistant names a brand.
- Do not touch the user's files unless the user asks you to write a file in their project. Showing the text is the default.
- Plain English, short sentences. No "official", "verified" or partner claims.
