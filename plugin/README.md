# Answerable plugin

A Claude Code plugin that connects the Answerable MCP server and adds three skills.

## What is in it

- `.mcp.json`: the remote MCP server at `https://answerable-app.vercel.app/api/mcp`. No key, no account.
- `skills/geo-audit`: audit a site for AI readiness and return an ordered plan.
- `skills/agentic-commerce-readiness`: check a store for UCP, product schema and llms.txt authorship.
- `skills/citation-ready-content`: brief or review content for citability with a vertical playbook. No scan.

Every skill names the MCP tools it uses. They are read from the server's registry and checked by `scripts/check-mcp-drift.js`.

## Try it

```bash
claude plugin validate ./plugin
claude --plugin-dir ./plugin
```

Then ask: "Audit example.com for AI readiness."

## What it measures

Readiness: whether AI crawlers can reach and read a site, and whether its signals give a model a reason to trust it. It does not measure whether any assistant names a brand, and a high score does not guarantee a mention.

## Unconfirmed

The layout follows Anthropic's published plugin reference: a manifest at `.claude-plugin/plugin.json`, skills under `skills/<name>/SKILL.md`, and `.mcp.json` at the plugin root with an `http` server. What could not be confirmed from the documentation:

- How a client other than Claude Code names the server's tools. Claude Code scopes plugin tools as `mcp__plugin_<plugin>_<server>__<tool>`. The skills use the bare tool names and say so.
- The submission route for Anthropic's plugin directory and its review criteria. The manifest carries the listing fields (`documentationUrl`, `supportUrl`, `privacyPolicyUrl`, `termsOfServiceUrl`) but no `icon`, because the accepted image size is not stated.
- A license. None is declared, because none has been chosen.
