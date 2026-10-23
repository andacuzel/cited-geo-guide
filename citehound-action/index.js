/* =====================================================================
   Citehound AI readiness check: the code of the GitHub Action.

   Plain JavaScript with no dependencies (Node 24's own fetch and fs), so there is nothing to build and nothing to commit but this file. It sends ONE request,
   GET https://getcitehound.com/api/action-scan?domain=<the domain you configured>, with the User-Agent "Citehound-Action/1.0". Nothing else leaves the runner: no
   repository name, no token, no file. It writes the outputs and a job summary through the files GitHub gives it ($GITHUB_OUTPUT, $GITHUB_STEP_SUMMARY).

   Exit: 0 when the scan ran and no gate failed; 1 when the score is under min-score or when fail-on-crawler-block is true and a tracked crawler is fully blocked. A rate limit
   (HTTP 429) never fails the step, gates or not: it says nothing about your site, so the Action warns, leaves the outputs empty and writes a note to the job summary (v1.0.1).
   When the scan cannot run for another reason (the site unreadable, no network), a step with a gate fails and a step without one only warns.
   ===================================================================== */

'use strict';

const fs = require('fs');

const API = (process.env.CITEHOUND_API_BASE || 'https://getcitehound.com').replace(/\/$/, '');   // the override is for the tests of this repository only
const UA = 'Citehound-Action/1.0 (+https://getcitehound.com)';
const input = (name) => String(process.env['INPUT_' + name.toUpperCase()] || '').trim();
const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function normalizeDomain(raw) {
  const d = String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d) ? d : null;
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, name + '=' + String(value).replace(/\r?\n/g, ' ') + '\n');
}
function summary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}

// One plain line about the plans, added to the job summary (the Action has no key, so it is always the free path). Turn it off with the input hints: 'false'.
const HINT = 'Watch this domain weekly and get alerts: Pro. Ready-to-paste fixes: Fix. See https://getcitehound.com/pricing';

function markdown(r, hints) {
  const lines = ['## Citehound AI readiness: ' + r.domain, '', '**Score: ' + r.score + ' / 100**', '',
    '| Pillar | Score |', '| --- | --- |'].concat(r.pillars.map((p) => '| ' + cell(p.name) + ' | ' + p.score + ' / ' + p.max + ' |'));
  lines.push('');
  if (r.failed.length) {
    lines.push('### Failed checks', '', '| Check | Pillar | Points | Fix |', '| --- | --- | --- | --- |');
    r.failed.forEach((f) => lines.push('| ' + cell(f.label) + ' | ' + cell(f.pillar) + ' | ' + f.points + ' / ' + f.max + ' | ' + cell(f.fix) + ' |'));
  } else lines.push('No check failed.');
  lines.push('', 'AI crawlers in robots.txt: ' + r.crawlers.open + ' open, ' + r.crawlers.limited + ' limited, ' + r.crawlers.blocked + ' blocked' + (r.crawlers.blockedNames.length ? ' (' + r.crawlers.blockedNames.join(', ') + ')' : '') + '.', '',
    '_' + r.note + ' Scanned ' + r.scannedAt.slice(0, 10) + '. Method: ' + r.method + '_');
  if (hints !== false) lines.push('', HINT);
  return lines.join('\n');
}

async function main() {
  const domain = normalizeDomain(input('domain'));
  const minRaw = input('min-score');
  const min = minRaw === '' ? null : Number(minRaw);
  const failOnBlock = input('fail-on-crawler-block').toLowerCase() === 'true';
  const hints = input('hints').toLowerCase() !== 'false';
  const gated = min !== null || failOnBlock;
  if (!domain) { console.log('::error::The domain input is not a valid domain, for example example.com.'); return 1; }
  if (min !== null && !(min >= 0 && min <= 100)) { console.log('::error::min-score must be a number from 0 to 100.'); return 1; }

  let res, body;
  try {
    res = await fetch(API + '/api/action-scan?domain=' + encodeURIComponent(domain), { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(40000) });
    body = await res.json().catch(() => null);
  } catch (e) {
    return unreachable('Could not reach Citehound (' + (e && e.name ? e.name : 'network error') + ').', gated);
  }
  if (res.status === 429) return rateLimited(res.headers.get('retry-after'));
  if (!res.ok || !body || typeof body.score !== 'number') {
    const why = body && body.error ? body.error : 'HTTP ' + res.status;
    return unreachable('The scan did not run: ' + why, gated);
  }

  setOutput('score', body.score);
  setOutput('crawlers-blocked', body.crawlers.blocked);
  setOutput('failed-checks', body.failed.length);
  summary(markdown(body, hints));
  console.log('Citehound: ' + domain + ' scores ' + body.score + ' / 100; ' + body.failed.length + ' failed checks; ' + body.crawlers.blocked + ' tracked crawlers blocked.');

  let code = 0;
  if (min !== null && body.score < min) { console.log('::error::The score ' + body.score + ' is below min-score ' + min + '.'); code = 1; }
  if (failOnBlock && body.crawlers.blocked > 0) { console.log('::error::robots.txt blocks these tracked AI crawlers completely: ' + body.crawlers.blockedNames.join(', ') + '.'); code = 1; }
  return code;
}

// A rate limit is not a finding about your site: skip, say so, fail nothing. The outputs exist and are empty, so a later step can tell the scan did not run.
function rateLimited(retryAfter) {
  setOutput('score', '');
  setOutput('crawlers-blocked', '');
  setOutput('failed-checks', '');
  console.log('::warning::Citehound rate limit reached, skipping this scan. Try again later.');
  if (retryAfter) console.log('Retry after ' + retryAfter + ' seconds.');
  summary('## Citehound AI readiness\n\nCitehound rate limit reached, so this scan was skipped. Nothing was checked and no gate was applied. Try again later.\n');
  return 0;
}

function unreachable(message, gated) {
  summary('## Citehound AI readiness\n\n' + message + '\n');
  if (gated) { console.log('::error::' + message + ' The check you asked for could not be made.'); return 1; }
  console.log('::warning::' + message);
  return 0;
}

if (require.main === module) main().then((code) => { process.exitCode = code; }, (e) => { console.log('::error::' + (e && e.message ? e.message : 'Unexpected error')); process.exitCode = 1; });
module.exports = { main, normalizeDomain, markdown, HINT };
