# Domain day

The checklist for the day the domain is bought. Do the steps in order. Replace `NEW` with the new origin, for example `https://example.com` (no trailing slash, no path), and `NEWHOST` with its host.

The site reads its address from `site.config.json`. `scripts/set-domain.js` changes it everywhere, using `config/domain-rules.json` to decide what to rewrite, what to leave as a record of the old host and what is protected scanner code. Tested on 5 October 2026 in a throwaway worktree with `https://example-domain.test`: every generator check, the page checks and `node --check` passed.

## 1. Add the domain in Vercel and set DNS

1. In the Vercel project, open Settings, then Domains, and add `NEWHOST`. Add the `www` form too if you want it, and pick which one redirects to the other.
2. At the registrar, add the DNS records Vercel shows for that domain. Use the exact values on that screen. For an apex domain Vercel asks for an A record, and for a subdomain a CNAME.
3. Wait until the Domains screen shows the domain as valid.

## 2. Wait for TLS

Vercel issues the certificate itself once DNS resolves. Confirm before touching any file:

```bash
curl -sI NEW | head -5
```

You want `HTTP/2 200` and no certificate error. If not, wait and repeat.

## 3. Dry run

```bash
node scripts/set-domain.js NEW
```

It prints how many occurrences of the old host fall in each class and changes nothing.

- `rewrite`: will change.
- `historical`: will not change. These are records of the old host: `content/pro/*.json`, the crops built from them, sentences about the crawl of our own site, the case study's citation line, the changelog.
- `protected`: `lib/scanner.js` and `scanner.js`, one URL literal each. They change only with `--include-protected`.
- `unclassified`: must be zero. If not, add a rule to `config/domain-rules.json` first. The run exits 2 while any remain.

## 4. Apply

```bash
node scripts/set-domain.js NEW --apply --include-protected
```

It rewrites the files, updates `site.config.json`, reruns every generator, then runs every `--check` and `node --check` on all JavaScript. It lists any old-host occurrence that remains, with its class. Exit 0 means every check passed.

Review `git diff --stat`. The protected files should differ by one line each, inside a URL.

## 5. Commit and push

```bash
git add -A
git commit -m "Move the site to NEW"
git push origin main
```

Open `NEW`, `NEW/pro`, `NEW/mcp`, `NEW/trust` and `NEW/sitemap.xml`. Check that `view-source:` on one page shows `NEW` in the canonical tag.

## 6. Keep the old vercel.app host redirecting

Add this to `vercel.json`, in its own commit, after step 5 is live and TLS works on the new host:

```json
"redirects": [
  {
    "source": "/((?!api/mcp).*)",
    "has": [{ "type": "host", "value": "answerable-app.vercel.app" }],
    "destination": "NEW/$1",
    "permanent": true
  }
]
```

The pattern leaves `/api/mcp` on the old host unredirected on purpose: many MCP clients do not follow a redirect on a POST, so anyone still connected to the old URL keeps working until you retire it. When you do retire it, remove the `(?!api/mcp)` part.

## 7. Re-add the Claude connector with the new URL

Claude Code:

```bash
claude mcp remove citehound
claude mcp add --transport http citehound NEW/api/mcp
```

If the connector was added before the rename to Citehound, it is registered under the old server name. Remove that one too, because tool prefixes follow the server name and the old connector will not find the renamed tools:

```bash
claude mcp remove answerable
```

Claude on the web and desktop: open the connector's settings, change the server URL to `NEW/api/mcp`, and reconnect. The plugin's `.mcp.json` already carries the new URL after step 4.

Confirm the new endpoint answers:

```bash
curl -s NEW/api/mcp -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -H 'MCP-Protocol-Version: 2026-07-28' -H 'Mcp-Method: tools/list' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}' | head -c 300
```

## 8. Search Console and Bing Webmaster

- Google Search Console: add `NEWHOST` as a Domain property and verify it with the DNS TXT record. Submit `NEW/sitemap.xml`. Google's Change of Address tool needs a verified old property, which a `vercel.app` host cannot give, so the 301 redirect from step 6 is the signal.
- Bing Webmaster Tools: import the site from Search Console, or add `NEW` and verify. Submit `NEW/sitemap.xml`.

## 9. IndexNow

IndexNow tells participating search engines, including Bing, that URLs changed. Google does not use it.

1. Generate a key: 8 to 128 characters, letters, digits and dashes.
2. Serve it: create `KEY.txt` at the site root containing only the key, and deploy it.
3. Submit the URLs:

```bash
curl -s -X POST https://api.indexnow.org/indexnow -H 'Content-Type: application/json' \
  -d '{"host":"NEWHOST","key":"KEY","keyLocation":"NEW/KEY.txt","urlList":["NEW/","NEW/pro","NEW/mcp","NEW/trust","NEW/changelog","NEW/research"]}'
```

## 10. Open Graph image

The images in `assets/brand/` (`og-default.png`, `og-default-light.png`, the logo SVGs and PNGs, `favicon.svg`, and the root `favicon.ico` and `apple-touch-icon.png`) carry the brand name but not the host, so a domain move needs no new image. Pages reference them as `/assets/brand/og-default.png` under the address in `site.config.json`, which `set-domain.js` already rewrites.

## 11. MCP directory submission

```bash
node scripts/generate-mcp-submission.js
```

`docs/mcp-submission.md` is regenerated from the registry with the new server URL, the privacy URL and the support address. Submit from that file. The plugin in `plugin/` is generated the same way (`node scripts/generate-plugin.js`).

## 12. Afterwards

- `curl -sI NEW/.well-known/security.txt` should return `content-type: text/plain`.
- `security.txt` expires on the date in its `Expires` line. Run `node scripts/generate-trust.js --renew` before then. `node scripts/generate-trust.js --check` fails 30 days early.
- The AgaOne case study keeps its citation line as published. The old URL redirects to the new one.
- Update the address wherever it lives outside this repository: social profiles, directory listings, the GitHub repository description.
