# Changelog

## 0.1.1

- After a successful `scan` without a key, or with a Free key, the CLI prints one plain line on standard error: "Watch this domain weekly and get alerts: Pro. Ready-to-paste fixes: Fix. See https://getcitehound.com/pricing". Pro, Fix and Beyond keys see nothing. `--json` output and standard output are unchanged.
- `-q` / `--quiet` or `CITEHOUND_NO_HINTS=1` turns the line off.
- With a key whose output was not trimmed, the CLI reads the plan once with `GET /v1/me` to decide. If that call fails, no line is printed.

## 0.1.0

First version.

- `citehound scan <domain>`: score, pillars, AI crawler states, failed checks with fixes.
- `citehound compare <a> <b>`.
- `citehound crawlers [domain]`.
- `citehound generate llms-txt|robots-txt|schema <domain>`.
- `--json`, `--fail-under <score>`.
- Works without a key through the public endpoint; uses the API when `CITEHOUND_API_KEY` is set.
