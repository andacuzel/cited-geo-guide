# Changelog

## v1.0.1 (2026-10-22)

- A rate limit (HTTP 429) no longer fails the step, even when `min-score` or `fail-on-crawler-block` is set. The Action warns ("Citehound rate limit reached, skipping this scan. Try again later."), leaves the outputs empty and writes a note to the job summary. A score below `min-score` or a blocked crawler still fails the step.
- The examples and the README run the Action by hand (`workflow_dispatch`) instead of on every push, and state the limit: up to 4 scans per hour per domain.
- The README describes the Action as a one-page check and says what belongs to Citehound Pro.
- The README has a Privacy section: only the domain you configure is sent.

## v1.0.0 (2026-10-22)

- First release: scans a domain for AI readiness, writes the score and the failed checks to the job summary, and can fail on `min-score` or a fully blocked AI crawler.
