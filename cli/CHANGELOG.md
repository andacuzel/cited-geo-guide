# Changelog

## 0.1.0

First version.

- `citehound scan <domain>`: score, pillars, AI crawler states, failed checks with fixes.
- `citehound compare <a> <b>`.
- `citehound crawlers [domain]`.
- `citehound generate llms-txt|robots-txt|schema <domain>`.
- `--json`, `--fail-under <score>`.
- Works without a key through the public endpoint; uses the API when `CITEHOUND_API_KEY` is set.
