# cited-geo-guide

## Benchmark data

The homepage benchmark section (and the "average of N sites" line on
every scan report) is generated, not hand-written. To add a category:

1. Scan it: `node scripts/scan-category.js domains/<category>.txt <category>`
   — writes `data/<category>-raw.json` (per-domain results — gitignored,
   never published) and `data/<category>-summary.json` (aggregate stats
   only, no company names).
2. Add one entry to `data/benchmarks.json`: `category` (matches the
   summary filename), `label` (display name), `track` (`"B2B SaaS"` or
   `"Consumer & e-commerce"`), `note` (the unit word for the sample size,
   e.g. `"platforms"`).
3. Run `node scripts/generate-benchmarks.js` — rewrites the block in
   `index.html` between the `BENCHMARKS:START`/`BENCHMARKS:END` markers.
   Safe to re-run; it replaces the block in place.
4. Commit `data/benchmarks.json`, the new `data/<category>-summary.json`,
   and the regenerated `index.html`. Leave `-raw.json` uncommitted — it's
   gitignored on purpose.

No score or count is ever typed by hand into `benchmarks.json` or
`index.html` — both are read from the summary file at generation time,
so they can't drift apart. Two minutes, no HTML editing.
