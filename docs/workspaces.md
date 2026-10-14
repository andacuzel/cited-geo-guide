# Project workspaces (Fix and Beyond)

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

## What a Beyond workspace shows

- **Questions**: the market questions in the customer's words. Start from the questions the linked Pro report's generator wrote (`set-pro`, then import: no new model
  call, no cost) or from one of the 14 category sets, then edit by hand.
- **Gaps**: question, page (or "No page"), a note, a priority. Entered by an admin.
- **Content**: the pieces we write (new page, FAQ block, comparison block, rewrite; a brief is only an intermediate step). Each is draft, in review, approved or
  published, with its text (safe markdown) and a thread of comments. **The client** can Approve a piece that is in review, or Request changes with a comment
  (the piece goes back to draft); there are no other buttons for a visitor. **An admin** sets draft, in review or published. Approved is set only by the client's
  Approve, and published only follows approved; editing the text of an approved or published piece sends it back to review with a note, so what was approved is
  what was read. The admin sees the client's comments in the admin page (`get`) and with `ws-admin.js comments <id>`.
- **Monthly**: the AI-readiness score of each month's scan (`rescan` adds one) and, when a run was made, that month's citation-check result entered by hand
  (`month`). The tab always says the citation check is a pilot (a dated sample of one assistant's answers, one run each, never a ranking) and shows "Not run this
  month" otherwise. Nothing is estimated or invented, the demo included.
- **Citehound Pro report**, "Included", as in Fix.

Client writes (Approve, Request changes) are limited: 60 an hour per network, 60 a day per workspace, 30 comments per piece; never on a demo or archived workspace.
Keys: `ws:<id>:questions`, `:gaps`, `:months`, `:content` (set of ids), `:c:<cid>` (a hash per piece) and `:cm:<cid>` (a hash of comments per piece), so a client's
answer is one HSET of the status and one of a comment, never a rewrite of a whole record.

## Making and running one

```
node scripts/ws-admin.js create example.com        # scans first; prints /w/<id>. Send that link to the client only. --type beyond for Beyond
node scripts/ws-admin.js list
node scripts/ws-admin.js set-status <id> sitemap applied
node scripts/ws-admin.js set-pro <id> <pro report id>
node scripts/ws-admin.js rescan <id>
node scripts/ws-admin.js archive <id>
node scripts/ws-admin.js seed-demo                 # (re)writes both fictional demos: /demo/fix and /demo/beyond
# Beyond: questions <id> import | seed <category> | set <file>, gaps <id> <file.json>, piece add|edit|status|note ..., comments <id>, month <id> <YYYY-MM> <named> <asked>
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
- Limits: 600 page views an hour per network (the demos included); Verify 30 an hour per network, one at a time per workspace (20 seconds) and 40 a day per workspace; a
  Verify never runs on an archived or demo workspace.
- A workspace holds a domain, work items and notes. No contact data, no names, no emails. Nothing is logged: not the id, the domain or the token.

## Retention

| What | Kept |
|---|---|
| An active workspace (all its keys) | 400 days after its last write (every write renews it) |
| An archived workspace | 90 days after archiving, then it is deleted; it stays readable, read-only, until then |
| A workspace you want gone now | `WS.remove` from a script; otherwise archive it and wait |
| The demos (`demo-fix`, `demo-beyond`) | No expiry; fictional; rewritten by `seed-demo` |
| The Verify lock and daily counter | 20 seconds and 2 days |

Redis keys: `ws:<id>`, `ws:<id>:items`, `:scans`, `:last`, `:vlock`, `:vn:<day>`, and the set `ws:index` (real workspaces only, so the admin can list them).
