/* =====================================================================
   scripts/scan-category.js — batch-scan a list of domains through your
   own /api/scan endpoint and produce aggregate statistics.

   This is how you generate original research data nobody else has:
   "of 150 CRM sites scanned, 38% block at least one AI crawler."

   Usage:
     node scripts/scan-category.js domains/crm.txt crm

   Input:  a text file with one domain per line (# comments allowed)
   Output: data/<category>-raw.json   (every scan result)
           data/<category>-summary.json (aggregate stats)
           a printed summary you can paste into a playbook or a video

   Costs nothing: it calls your own Vercel function. Deliberately slow
   (2s between requests) to stay polite to the sites being scanned and
   well inside Vercel's free tier.
   ===================================================================== */

const fs = require('fs');
const path = require('path');

const API_BASE = process.env.ANSWERABLE_API || 'https://answerable-app.vercel.app';
const DELAY_MS = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scanOne(domain) {
  const url = `${API_BASE}/api/scan?domain=${encodeURIComponent(domain)}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || data.error) {
      return { domain, ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { domain, ok: true, data };
  } catch (err) {
    return { domain, ok: false, error: err.message };
  }
}

function summarize(results, category) {
  const good = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  if (good.length === 0) {
    return { category, scanned: 0, failed: failed.length };
  }

  const totals = good.map((r) => r.data.result.total);
  const avg = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  };

  // How many sites block or limit at least one AI crawler
  const blockingAny = good.filter((r) =>
    r.data.botResults.some((b) => b.state === 'block')
  ).length;
  const limitingAny = good.filter((r) =>
    r.data.botResults.some((b) => b.state !== 'open')
  ).length;

  // Per-bot blocking rates
  const perBot = {};
  good[0].data.botResults.forEach((b) => {
    perBot[b.name] = { blocked: 0, limited: 0, open: 0 };
  });
  good.forEach((r) => {
    r.data.botResults.forEach((b) => {
      if (!perBot[b.name]) perBot[b.name] = { blocked: 0, limited: 0, open: 0 };
      if (b.state === 'block') perBot[b.name].blocked++;
      else if (b.state === 'partial') perBot[b.name].limited++;
      else perBot[b.name].open++;
    });
  });

  // Failure rate per individual check
  const checkFails = {};
  good.forEach((r) => {
    r.data.result.checks.forEach((c) => {
      if (!checkFails[c.label]) checkFails[c.label] = { failed: 0, of: 0 };
      checkFails[c.label].of++;
      if (c.pts < c.max) checkFails[c.label].failed++;
    });
  });

  const pct = (n, of) => Math.round((n / of) * 100);

  return {
    category,
    scannedAt: new Date().toISOString().slice(0, 10),
    scanned: good.length,
    failed: failed.length,
    score: {
      average: avg(totals),
      median: median(totals),
      lowest: Math.min(...totals),
      highest: Math.max(...totals),
      averageDiscoverability: avg(good.map((r) => r.data.result.discover)),
      averageTechnical: avg(good.map((r) => r.data.result.tech)),
      averageTrust: avg(good.map((r) => r.data.result.trust))
    },
    crawlers: {
      blockingAtLeastOnePct: pct(blockingAny, good.length),
      notFullyOpenToAllPct: pct(limitingAny, good.length),
      perBot
    },
    checkFailureRates: Object.fromEntries(
      Object.entries(checkFails)
        .map(([label, v]) => [label, pct(v.failed, v.of)])
        .sort((a, b) => b[1] - a[1])
    )
  };
}

async function main() {
  const [listFile, category] = process.argv.slice(2);
  if (!listFile || !category) {
    console.error('Usage: node scripts/scan-category.js <domains.txt> <category>');
    process.exit(1);
  }

  const domains = fs
    .readFileSync(listFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  console.log(`Scanning ${domains.length} domains for "${category}"\n`);

  const results = [];
  for (let i = 0; i < domains.length; i++) {
    const d = domains[i];
    process.stdout.write(`[${i + 1}/${domains.length}] ${d} ... `);
    const r = await scanOne(d);
    console.log(r.ok ? `${r.data.result.total}/100` : `failed (${r.error})`);
    results.push(r);
    if (i < domains.length - 1) await sleep(DELAY_MS);
  }

  const outDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(
    path.join(outDir, `${category}-raw.json`),
    JSON.stringify(results, null, 2)
  );

  const summary = summarize(results, category);
  fs.writeFileSync(
    path.join(outDir, `${category}-summary.json`),
    JSON.stringify(summary, null, 2)
  );

  console.log('\n--- SUMMARY ---');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWritten to data/${category}-raw.json and data/${category}-summary.json`);
}

main();
