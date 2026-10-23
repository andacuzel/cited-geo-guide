# Integration status

Read `RULES.md` first. A line below changes to "live" only when the thing really is, and the site wording changes with it (never before). Until then the site says **In preparation** and gives no install command (`scripts/generate-claude-page.js` and `scripts/test-cli.js` check that).

| Item | Folder | State on 23 Oct 2026 | What the site says |
|---|---|---|---|
| Claude plugin (MCP server + 3 skills) | `claude-plugin/`, marketplace file `.claude-plugin/marketplace.json` | **Live from our own GitHub marketplace** (`andacuzel/cited-geo-guide`). Installed and tried by the owner in the Claude desktop app on 23 Oct 2026; also installed in Claude Code, where `scan_site` ran through it. Not listed in Anthropic's plugin directory. | Available: `/integrations`, `/claude` (both install lines) |
| `citehound` command-line tool | `cli/` | **Published to npm as `citehound@0.1.0`** (https://www.npmjs.com/package/citehound), self-checked by the owner with `npm view`. | Available: `/integrations`, `/claude`, `/api` |
| n8n community node | `integrations/n8n/` | **Published to npm as `n8n-nodes-citehound@0.1.0`** (0.1.1 with the `next_step` line is in the repository, not yet published). Loaded in a real n8n 2.44.6 on 23 Oct 2026 (log: "Loaded all credentials and nodes from n8n-nodes-citehound": 1 credential, 2 nodes, `citehound` and `citehoundTrigger`); no key and no API call used. Not submitted to n8n for review (a community node). | Available on `/integrations`, as a community node |

## The CLI on npm (published 23 Oct 2026, version 0.1.0)

For a later version the owner does this (CLI changes need a new version: `npm version` and a publish, see CLAUDE.md):

1. `cd cli`, change the code, add a line to `CHANGELOG.md`, run `npm test` (all pass).
2. `npm version patch` (or `minor`), which raises the version in `package.json`. Commit and push.
3. `npm login` if needed, then `npm publish --access public`; check with `npm view citehound version`.
4. Optional, with provenance: add an npm automation token as the repository secret `NPM_TOKEN`, then `git tag cli-vX.Y.Z && git push origin cli-vX.Y.Z`; `.github/workflows/publish-cli.yml` publishes it. Do not publish the same version both ways.

The README on the npm page is the one inside the published version: it shows the changes made after 0.1.0 only after the next publish.

## Confirm the CLI against the live API with your key

In Terminal, without pasting the key anywhere else (the key stays in your shell):

```
read -s CITEHOUND_API_KEY && export CITEHOUND_API_KEY && npx citehound scan getcitehound.com --json | head -c 400
```

Paste the key when the cursor waits (nothing shows as you type), press Return. With a free key and a Free-plan limit you may see `"source": "public"` (the CLI falls back to the public output). With a paid key you should see JSON that starts with `"source": "api_key"` and a `"score"`. If it says the key was not accepted, the key is wrong or revoked; if it says a limit was reached, wait the seconds it names.

## Claude plugin

Live from our own marketplace. Claude desktop app: Plugins → Add → marketplace `andacuzel/cited-geo-guide` → install `citehound`. Claude Code: `/plugin marketplace add andacuzel/cited-geo-guide` and `/plugin install citehound@citehound`. Submitting it to Anthropic's plugin directory is a separate step the owner decides; do not claim a listing before the directory has approved it (RULES.md).

## Closed for 23 Oct 2026

**Live:** Claude connector, MCP Registry listing, GitHub Action, public API, npm CLI (`citehound`), n8n community node (`n8n-nodes-citehound`), Claude plugin (own marketplace).

**Deferred** (listed by name only under "In preparation" on `/integrations`, no link, no claim):

- Google Sheets: the code is ready; the owner's browser is too old to test the Apps Script menu.
- Looker Studio: the code is ready; same browser problem as Google Sheets.
- Zapier: a public listing needs a company; a private invite link is optional later.
- Pipedream: listing is review-based and takes days.
- Raycast: store submission is review-based and takes days.
- Activepieces: listing is review-based and takes days.
- Make: the app was never opened in Make's editor.
- Slack: needs an endpoint for Slack's requests, and no new serverless function may be added.
- Chrome extension: not built.
