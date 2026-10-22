# Integration status

Read `RULES.md` first. A line below changes to "live" only when the thing really is, and the site wording changes with it (never before). Until then the site says **In preparation** and gives no install command (`scripts/generate-claude-page.js` and `scripts/test-cli.js` check that).

| Item | Folder | State on 23 Oct 2026 | What the site says |
|---|---|---|---|
| Claude plugin (MCP server + 3 skills) | `claude-plugin/`, marketplace file `.claude-plugin/marketplace.json` | Built and validated with `claude plugin validate --strict`. Installable from this repository once it is on `main`. Not listed in any plugin directory. | In preparation |
| `citehound` command-line tool | `cli/` | Built and tested. **Not published to npm.** The name `citehound` was free on npm on 23 Oct 2026. | In preparation |

## Publish the CLI to npm (the owner does this once)

Needs an npm account. Use a clone outside iCloud (see CLAUDE.md, "Repository location").

1. Make an account at https://www.npmjs.com/signup and switch on two-factor authentication in the account settings.
2. In Terminal, get a clean copy: `git clone https://github.com/andacuzel/cited-geo-guide.git ~/dev/citehound && cd ~/dev/citehound/cli`
3. Log in: `npm login`. A browser window opens; sign in there. Terminal then says "Logged in as <your name>".
4. Run the tests: `npm test`. You should see `ℹ pass 38` and `ℹ fail 0`.
5. Publish: `npm publish --access public`. npm asks for a one-time code from your authenticator app. You should see `+ citehound@0.1.0`.
6. Check it: `npm view citehound version` shows `0.1.0`, and `npx citehound --version` shows `0.1.0`.
7. Then tell the assistant "the CLI is published". It will remove the "not on npm yet" lines, change the site from "In preparation" to the install command, and update this file.

Optional, with provenance (a badge on npm that proves which commit built the package): add an npm "automation" token as a repository secret named `NPM_TOKEN` (GitHub, the repository, Settings, Secrets and variables, Actions, New repository secret), then run `git tag cli-v0.1.0 && git push origin cli-v0.1.0`. `.github/workflows/publish-cli.yml` publishes it with `--provenance`. Do not do both ways for the same version. npm refuses `--provenance` from a laptop, which is why `package.json` does not set it.

## Confirm the CLI against the live API with your key

In Terminal, without pasting the key anywhere else (the key stays in your shell):

```
read -s CITEHOUND_API_KEY && export CITEHOUND_API_KEY && npx citehound scan getcitehound.com --json | head -c 400
```

Paste the key when the cursor waits (nothing shows as you type), press Return. You should see JSON that starts with `"source": "api_key"` and a `"score"`. If it says the key was not accepted, the key is wrong or revoked; if it says a limit was reached, wait the seconds it names.

## Claude plugin

Nothing to publish for it to work: in Claude Code run `/plugin marketplace add andacuzel/cited-geo-guide` and `/plugin install citehound@citehound`. Submitting it to Anthropic's plugin directory is a separate step the owner decides; do not claim a listing before the directory has approved it (RULES.md).
