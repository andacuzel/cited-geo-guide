# Rename: Answerable to Citehound

The product was named Cited, then Answerable, and is now **Citehound**, from 7 October 2026. The method, the checks, the weights and every published figure are unchanged.

## What changed

- The brand in every page, script, generator, playbook, report template, tool and document. Titles use "Citehound — Page"; the wordmark has no trailing dot.
- The identity: a sighthound-head mark and a Gloock wordmark, in `assets/brand/` (SVG and PNG, light and dark), plus `favicon.ico` and `apple-touch-icon.png` at the root. Pages point at `/assets/brand/favicon.svg` and `/assets/brand/og-default.png`. The old `assets/og-image.*` files are gone.
- The MCP server: `serverInfo.name` is `citehound`, the title `Citehound`. The tools and prompts are unchanged. The Claude Code plugin is named `citehound`.
- JavaScript globals `ANSWERABLE_*` are now `CITEHOUND_*`. The scan-category script reads `CITEHOUND_API` instead of `ANSWERABLE_API`. Playbook PDFs download as `citehound-geo-aeo-playbook-<vertical>.pdf`. The browser stores nothing, so there are no storage keys to migrate.
- The methodology changelog has a dated line for the rename. The site changelog keeps its older entry "Rebranded the site from Cited to Answerable" as written, and a new entry records this change.

## What did not change

- The address. Every URL still reads from `site.config.json` (`lib/site-config.js`), whose value is the current Vercel host. The move to the new domain is `scripts/set-domain.js`, in `docs/domain-day.md`.
- The GitHub repository name (`cited-geo-guide`) and the Vercel project name.
- Published numbers, dates and scan results: `data/`, the research reports' figures, `content/pro/*.json` (a frozen crawl of the site when it was named Answerable, so it still contains that name in crawled titles), and `content/prompts/`.
- The captured MCP outputs for the scans and the schema example in `content/mcp-examples.json`. They are real live output, dated, and carry only the host. The three content-tool examples were re-captured from this checkout without any request (`node scripts/capture-mcp-examples.js --local`). After deploying, run `node scripts/capture-mcp-examples.js` to re-capture everything from the live server.
- The AgaOne case study's facts, figures, dates and quotes. The product name is updated everywhere in it. Inside the one quotation that names the product, the name appears in square brackets.

## User agent

The crawl engine and the store product-page check identify as:

```
CitehoundBot/1.1 (formerly AnswerableBot; +<site>/methodology)
```

A site may have a robots.txt group keyed to `AnswerableBot`. The scanner matches a group when its agent name appears anywhere in the user-agent string, so that group still applies to this version through the "formerly AnswerableBot" token. Drop the old token in the next version, and say so in the methodology changelog first, so that sites with old rules have notice.

## Connectors

Tool prefixes follow the server name, so a client connected under the old name must remove it and add Citehound again:

```bash
claude mcp remove answerable
claude mcp add --transport http citehound <site>/api/mcp
```

Claude on the web and desktop: delete the old connector and add a custom connector named Citehound with the same server address. No compatibility endpoint exists for the old name.

## For the owner to do

- Buy the domain, then follow `docs/domain-day.md` (the checklist matches the new name: `set-domain.js`, the connector commands and the image notes were updated).
- Re-add the connector in Claude and update directory submission copy from `docs/mcp-submission.md`, which has a "Name change" section.
- Optionally rename the GitHub repository and the Vercel project, with redirects.
- Create Search Console, Bing Webmaster Tools and IndexNow properties for the new domain.
- Rotate the Gemini key and set billing when the name is final. Unchanged and deferred.
