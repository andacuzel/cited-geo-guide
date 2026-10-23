# citehound

Scan a domain for AI **readiness** from the command line: can AI crawlers reach the site, and do its pages carry signals a model can read. Compare two sites. Write an `llms.txt`, a `robots.txt` for AI crawlers, and JSON-LD.

The score is a readiness score: crawler access and on-page signals. It does not measure whether any assistant names a brand. Nothing here promises a change in traffic, rankings, citations or revenue.

- No dependencies. Node.js 18 or newer. MIT licence.
- No account and no key needed. A key is optional: see Plans below.

## Use it

```
npx citehound scan example.com
npx citehound compare mysite.com theirsite.com
npx citehound crawlers
npx citehound generate robots-txt example.com > robots.txt
```

### 1. Score a site and list what to fix

```
$ npx citehound scan example.com
example.com: 62/100  (AI readiness)

  Discoverability         20/40
  Technical foundation    12/20
  Content & trust         30/40

AI crawlers: 1 open, 0 limited, 1 blocked
  Blocked: GPTBot

To fix, most valuable first:
  1. AI crawler access (1/10 open): 13 of 26 points
     Review robots.txt rules for blocked AI crawlers
```

(The numbers above are an example. Your output shows the real scan.)

### 2. Fail a build when the score drops

```
npx citehound scan example.com --fail-under 70
```

The report is printed, and the command exits with code 1 if the score is below 70. In a GitHub Actions step or any CI, that fails the step. `--fail-under` also works with `compare` (it fails if either site is below the number).

### 3. Write the files

```
npx citehound generate robots-txt example.com --allow GPTBot,ClaudeBot --block Bytespider > robots.txt
npx citehound generate llms-txt example.com --description "Project software for small design studios." > llms.txt
npx citehound generate schema example.com --type organization > schema.json
```

The file goes to standard output, and a hint on where to put it goes to standard error, so redirecting gives you a clean file. Check the result before you publish it: anything the tool cannot know is left in `[square brackets]`. `llms.txt` is optional and has no demonstrated effect on Google.

## Commands

| Command | What it does |
|---|---|
| `citehound scan <domain>` | Scores one page of a domain (its robots.txt, llms.txt, sitemap declaration and homepage) out of 100, with the state of ten AI crawlers and the failed checks, most valuable first. |
| `citehound compare <a> <b>` | Scans two domains and shows where they differ. |
| `citehound crawlers [domain]` | Without a domain: the ten AI crawlers Citehound tracks and the default for each. With one: their state in that domain's robots.txt. |
| `citehound generate llms-txt <domain>` | An llms.txt. `--name`, `--description` and `--page "<url>\|<description>"` (repeatable) set its content; without them the name comes from the site's own title and the description is a bracketed placeholder for you to fill in. |
| `citehound generate robots-txt <domain>` | A robots.txt for the tracked crawlers. `--allow a,b` and `--block c,d` choose names (see `citehound crawlers`); without them the tracked list's own defaults are used. A `Sitemap:` line is added (`--sitemap <url>` changes it, `--no-sitemap` leaves it out). |
| `citehound generate schema <domain>` | JSON-LD built from the homepage's title and language. `--type` is `organization` (default), `faqpage`, `article`, `product` or `localbusiness`. |

Options for every command: `--json` prints JSON instead of text (the same shape as the Citehound API, plus `source`: `public` or `api_key`), `-q` and `--quiet` leave out the plan line described below, `-h` and `--help`, `-v` and `--version`.

## The plan line

After a successful `scan` without a key, or with a Free key, the CLI prints one line on standard error:

```
Watch this domain weekly and get alerts: Pro. Ready-to-paste fixes: Fix. See https://getcitehound.com/pricing
```

Pro, Fix and Beyond keys do not see it. It is not printed with `--json`, and it never goes to standard output, so a redirected scan stays clean. Turn it off with `--quiet` (or `-q`) or with `CITEHOUND_NO_HINTS=1`. With a key, the CLI reads the plan once from `GET /v1/me` to decide; if that call fails, nothing is printed.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Done. |
| 1 | A score was below `--fail-under`. |
| 2 | The command was not understood (a missing domain, an unknown option). |
| 3 | Citehound could not be reached or could not do it (no network, a limit, a site that could not be read). |

## Limits and a free key

Without a key the CLI uses the public endpoint of the Citehound MCP server, which is free and has public limits: the tools that scan a live site are limited per domain. When a limit is reached, the CLI says so and how long to wait.

For limits of your own, get a free key at https://getcitehound.com/api (it is sent to your email) and put it in the environment:

```
export CITEHOUND_API_KEY=chk_...
```

With a key the CLI uses the Citehound API (`/v1`). The key is read only from the environment. It is sent only to Citehound over https, and it is never printed, not even in an error message. `CITEHOUND_API_URL` can point the CLI at another address (for tests).

## Plans

- **No key:** the full output of the public endpoint, with public limits. This is what most people need.
- **A free API key:** API access with small limits (the plan table is on https://getcitehound.com/api). The CLI never gives you less than no key: where the Free plan has less than the public endpoint (the full scan detail, compare, the full generated files, the other schema types), the full result comes from the public endpoint, and the plan's message is printed on standard error. That costs one extra request to the public endpoint.
- **Pro, Fix and Beyond keys:** higher limits, the full scan detail, `compare`, full generated files and monitoring (through the API and https://getcitehound.com/watch); Fix and Beyond add the prioritized fix list and re-check, Beyond adds the export.

When a plan does not have something, the CLI prints the API's message, which names the plans that do, and exits with code 3. The table is on https://getcitehound.com/api.

## What it does not do

- It reads one page of a domain, not the whole site, and it changes nothing on any site.
- It does not measure whether any assistant names, recommends or cites a brand.
- It stores nothing and sends no analytics.

## Licence

MIT. See `LICENSE`. Changes are in `CHANGELOG.md`.
