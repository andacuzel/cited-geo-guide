# Citehound for Claude

A Claude Code plugin that connects the Citehound MCP server and adds three guided skills. It measures AI **readiness**: whether AI crawlers can reach a site and whether its pages carry signals a model can read. It does not measure whether any assistant names a brand.

It is read-only. It scans public pages and writes text (robots.txt, llms.txt, JSON-LD) for you to use. It changes nothing on a site and needs no account or key.

## What you get

| Skill | Ask for it with | What it does |
|---|---|---|
| `scan-my-site` | `/citehound:scan-my-site example.com` | Scans a domain, explains the score in plain language and lists the fixes, most valuable first. |
| `fix-ai-crawler-access` | `/citehound:fix-ai-crawler-access example.com` | Writes a robots.txt for the AI crawlers you choose, an llms.txt and JSON-LD, and says where each file goes. |
| `compare-with-competitor` | `/citehound:compare-with-competitor mysite.com theirsite.com` | Scans two domains and lists the checks where they differ, with an order of work. |

The skills call the tools of the Citehound MCP server at `https://getcitehound.com/api/mcp` (13 read-only tools, set up by this plugin's `.mcp.json`). You can also just ask in plain words, for example "How ready is example.com for AI crawlers?"

## Install

You need Claude Code. In a Claude Code session:

1. Add the marketplace from this repository:
   ```
   /plugin marketplace add andacuzel/cited-geo-guide
   ```
2. Install the plugin:
   ```
   /plugin install citehound@citehound
   ```
3. Reload plugins if Claude asks you to, then try:
   ```
   /citehound:scan-my-site example.com
   ```

To try it from a local copy without installing, run `claude --plugin-dir ./claude-plugin` from the repository root.

If you only want the tools and not the skills, add the server on its own: `claude mcp add --transport http citehound https://getcitehound.com/api/mcp`. Setup for other clients is on https://getcitehound.com/claude.

## Limits

- A scan reads one page of a domain (its robots.txt, llms.txt, sitemap declaration and homepage), not the whole site.
- The tools that scan a live site are limited per domain, so one site is not fetched over and over.
- `llms.txt` is optional and has no demonstrated effect on Google.
- Nothing here promises a change in traffic, rankings, citations or revenue.

## Status

This plugin is in this repository. It is not listed in any plugin directory.

## Licence

MIT. See `LICENSE`.
