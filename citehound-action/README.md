# Citehound AI readiness check

A GitHub Action that scans a domain for AI readiness and puts the result in the job summary. It reads the domain's public `robots.txt`, `llms.txt`, sitemap declaration and homepage, scores them out of 100 and lists the checks that failed with the fix for each. It is free and needs no account, no token and no secret.

```yaml
on: [push]
jobs:
  readiness:
    runs-on: ubuntu-latest
    steps:
      - uses: andacuzel/citehound-action@v1
        with: { domain: example.com, min-score: 70 }
```

## Inputs

| Input | Required | What it does |
| --- | --- | --- |
| `domain` | yes | The domain to scan, for example `example.com`. This is the only thing the Action sends. |
| `min-score` | no | Fail the step if the score is below this number (0 to 100). Empty means the score never fails the step. |
| `fail-on-crawler-block` | no | `true` fails the step if `robots.txt` blocks any of the tracked AI crawlers completely. Default `false`. |

## Outputs

`score` (0 to 100), `crawlers-blocked` (how many tracked AI crawlers `robots.txt` blocks completely) and `failed-checks` (how many checks failed). The job summary has a table of the three pillar scores and a table of the failed checks with their fixes.

## What it checks

The same 16 checks as the free scanner at https://getcitehound.com, in three pillars: Discoverability (can AI crawlers reach the site), Technical foundation, and Content and trust. It also reads, for each of 10 AI crawlers, whether `robots.txt` leaves it open, limits it or blocks it.

## What the score means

The score is a readiness score: crawler access and on-page signals. It is not a measure of whether any assistant names a brand.

## What it sends, and the limits

The Action makes one request to `https://getcitehound.com/api/action-scan` with the domain and the User-Agent `Citehound-Action/1.0`. It sends no repository name, no token and no file. Citehound then reads the public files of that domain; nothing behind a login is touched. Only scan domains you own or are authorized to check.

The endpoint is rate limited: the same domain at most 4 times an hour, one address at most 60 times an hour (CI machines share addresses) and 200 scans an hour across everyone. The counters are keyed by a one-way hash and expire within an hour. If the limit is reached or the scan cannot run, the step prints a warning and passes, unless you set `min-score` or `fail-on-crawler-block`: then it fails, because the check you asked for could not be made.

## Licence

MIT. Citehound: https://getcitehound.com
