# Project workspaces (Fix now, Beyond next)

A workspace is a private project page for one customer and one domain, reached by a bearer link: `/w/<32 hex>`. Whoever holds the link can read it. There is
no login. It is built on what already exists: the free scan (`lib/scanner.js`, through `lib/safe-fetch.js`), the check metadata (`lib/methodology.js`),
the generators the MCP tools use (`lib/schema.js`, `lib/file-generators.js`) and the Pro report (`/r/<id>`), and it runs inside the one Pro function
(`api/pro.js`, so the Hobby plan's function count does not change).

## What a Fix workspace shows

- **Overview**: the score of the first scan and of the latest, the change, the last scan date, how many checks pass, and the Fix list by status. These are
  AI-readiness scores, not presence in AI answers; the page says so.
- **Fix list**: one item for each failed check. Status: to do, in progress, applied (set by us when the change is on the site), verified. **Verify** runs the
  check again and sets "verified" only if it passes; nobody can type that status. A rescan adds newly failing checks and sends a verified item back to
  to do if its check fails again.
- **Files**: schema, robots.txt, llms.txt, from the shared generators, with Copy buttons. Brackets mark what only the site owner can fill in.
- **History**: every scan in the workspace (first scan, rescans, Verify runs).
- **Citehound Pro report**, labelled "Included": links to the project's `/r/<id>` once its job exists (`set-pro`), otherwise says it appears when ready.

## Making and running one

```
node scripts/ws-admin.js create example.com        # scans first; prints /w/<id>. Send that link to the client only.
node scripts/ws-admin.js list
node scripts/ws-admin.js set-status <id> sitemap applied
node scripts/ws-admin.js set-pro <id> <pro report id>
node scripts/ws-admin.js rescan <id>
node scripts/ws-admin.js archive <id>
node scripts/ws-admin.js seed-demo                 # (re)writes the fictional demo at /demo/fix
```

The same actions are on the admin page, `/admin/ws`. It exists only when `ADMIN_TOKEN` is set in Vercel (16 characters or more); without it every
`/admin/*` workspace route is a 404 and nothing renders. Sign-in compares the token in constant time, allows 8 attempts per 15 minutes per network, and sets an
httpOnly, SameSite=Strict cookie that holds an expiry and a signature, never the token (8 hours). Everything is JSON, same-origin, behind the cookie.
The page's script puts server text into the page as text only.

## Rules that hold for every workspace page

- noindex, no referrer, no store, a `script-src 'self'` policy (headers in `vercel.json` and `lib/pro-http.js`); never in `robots.txt`, the sitemap, `llms.txt`
  or the MCP server. An unknown, malformed or demo id gives the same generic 404.
- Everything stored or typed is escaped on the way out. Pasted markdown goes through `lib/ws-markdown.js`, which escapes first, allows no raw HTML, no images
  and only http, https and mailto links. The page loads one script of our own and nothing from a third party except the site's fonts.
- Limits: 600 page views an hour per network; Verify 30 an hour per network, one at a time per workspace (20 seconds) and 40 a day per workspace; a
  Verify never runs on an archived or demo workspace.
- A workspace holds a domain, work items and notes. No contact data, no names, no emails. Nothing is logged: not the id, the domain or the token.

## Retention

| What | Kept |
|---|---|
| An active workspace (all its keys) | 400 days after its last write (every write renews it) |
| An archived workspace | 90 days after archiving, then it is deleted; it stays readable, read-only, until then |
| A workspace you want gone now | `WS.remove` from a script; otherwise archive it and wait |
| The demos (`demo-fix`, later `demo-beyond`) | No expiry; fictional; rewritten by `seed-demo` |
| The Verify lock and daily counter | 20 seconds and 2 days |

Redis keys: `ws:<id>`, `ws:<id>:items`, `:scans`, `:last`, `:vlock`, `:vn:<day>`, and the set `ws:index` (real workspaces only, so the admin can list them).
