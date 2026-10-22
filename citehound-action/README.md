# Citehound AI readiness check

A GitHub Action that checks one page: it scans the one domain you give it and reports the score for that page. It reads the domain's public `robots.txt`, `llms.txt`, sitemap declaration and homepage, scores them out of 100 and writes the score and the checks that failed, with the fix for each, to the job summary. It is free and needs no account, no token and no secret. Whole-site reports, history, alerts and citation samples are part of Citehound Pro: https://getcitehound.com/pricing

```yaml
on: workflow_dispatch
jobs:
  readiness:
    runs-on: ubuntu-latest
    steps:
      - uses: andacuzel/citehound-action@v1
        with: { domain: example.com, min-score: 70 }
```

The Action is limited to up to 4 scans per hour per domain.

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

The endpoint is rate limited: the same domain at most 4 times an hour, one address at most 60 times an hour (CI machines share addresses) and 200 scans an hour across everyone. The counters are keyed by a one-way hash and expire within an hour. If the limit is reached (HTTP 429), the step prints a warning, leaves the three outputs empty, writes a note to the job summary and passes, even if you set `min-score` or `fail-on-crawler-block`: a rate limit says nothing about your site. The step fails only when the scan ran and found a problem (the score is below `min-score`, or `fail-on-crawler-block` is `true` and a tracked crawler is blocked completely). If the scan cannot run for another reason, such as an unreadable site or no network, a step with `min-score` or `fail-on-crawler-block` fails and a step without them only warns.

## Privacy

Only the domain you configure is sent to getcitehound.com. The Action sends no repository name, no token and no file. How Citehound handles data: https://getcitehound.com/privacy

## Licence

MIT. Citehound: https://getcitehound.com
