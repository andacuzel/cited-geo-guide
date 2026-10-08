# Private reports

A private report is one self-contained HTML file, encrypted into a single unlock page. The
page is published at an unguessable path and opens only with an access code. This document
describes the tool. It holds no code and no report data.

## What it does

`scripts/encrypt-report.js` takes a self-contained HTML file (CSS, scripts, fonts and images
inlined, no external request) and writes one unlock page:

- The report is gzip-compressed, then encrypted with AES-256-GCM.
- The key comes from the access code with PBKDF2-SHA256, 1,000,000 iterations by default (the tool refuses
  fewer than 600,000), a random 16-byte salt and a random 12-byte IV for every file.
- The unlock page asks for the code, decrypts in the browser with WebCrypto, then replaces its
  own document with the report. It makes no request of any kind.
- The page title is "Private report". It names no site and no recipient. It carries
  `noindex, nofollow, noarchive`, no analytics and no external resource.

## Commands

```
node scripts/encrypt-report.js --generate-code <file>
node scripts/encrypt-report.js <in.html> <out.html> --code-file <file>
node scripts/encrypt-report.js --check <out.html> --code-file <file>
node scripts/test-encrypt-report.js
```

`--generate-code` writes a new code to a file with mode 600 and never prints it. The code is 20
characters of Crockford base32 (100 bits), shown in groups of four. It can be read aloud:
case, spaces and dashes are ignored, and O reads as 0, I and L as 1. The code is never taken
from a command-line argument, so it stays out of shell history. `REPORT_ACCESS_CODE` in the
environment works as well.

Keep the code file and the plain report in a gitignored folder (`local/private/<slug>/`). The
code is never written to a tracked file, a log, a commit message or a document.

## Publishing

1. Make the path: 24 random hex characters, for example from `crypto.randomBytes(12)`.
2. Write the unlock page to `r/<path>/index.html`.
3. `vercel.json` sends `X-Robots-Tag: noindex, nofollow, noarchive` and
   `Referrer-Policy: no-referrer` for everything under `/r/`.
4. Do not list the path in `robots.txt`, `sitemap.xml`, `llms.txt`, a nav or any page.
   `scripts/site-chrome.js` skips the top-level `r/` folder.
5. After the deploy, fetch the live URL: expect 200, the noindex header, and only the unlock
   screen. Decrypt the live payload with the local code to confirm the real report renders.

## Limits to know

- The encrypted file is in git history for good. If the repository is public, anyone can copy
  it and try codes offline. A 100-bit code with a million PBKDF2 iterations makes that
  impractical, but a code that leaks makes the report readable by whoever also has the page.
  Deleting the page later does not remove it from history.
- There is no lockout and no per-person access. Anyone with the page and the code can read the
  report. Share the code over a different channel from the link.
- Opening needs a current browser with WebCrypto and `DecompressionStream`.
- Nothing here hides that a page exists at the path. It hides what the page says.
