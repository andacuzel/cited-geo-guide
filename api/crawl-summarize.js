/* =====================================================================
   /api/crawl-summarize — the executive summary of one finished crawl.

   Input: a job id. Builds the facts (lib/report-facts.js), writes the summary
   (lib/summary.js: a model rephrases the facts and every reply is validated;
   rules write it when there is no key, the API fails, or a reply fails
   validation twice), stores it on the job record and returns it.

   Usage: GET /api/crawl-summarize?id=<jobId>

   Stored once: if the job already has an executiveSummary it is returned as
   is and never overwritten, so one job costs at most one model pass (two
   requests when the first reply is rejected).

   What a model receives: aggregated figures and check names only. No page
   content, no URLs, no domain, nothing about the requester.
   ===================================================================== */

const path = require('path');
const { checkRateLimit } = require('./_rateLimit');
const { getJob, saveJob } = require('./_crawlStore');
const facts = require('../lib/report-facts');
const summary = require('../lib/summary');
const schema = require('../lib/schema');
const gemini = require('../lib/summary-gemini');

var ID_RE = /^[a-f0-9]{32}$/;

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Use GET with ?id=<job id>.' });
    return;
  }

  var id = (req.query && req.query.id) || null;
  if (!id) {
    try { id = new URL(req.url, 'http://localhost').searchParams.get('id'); } catch (e) { /* fall through */ }
  }
  if (!id || typeof id !== 'string' || !ID_RE.test(id)) {
    res.status(400).json({ error: 'Missing or invalid job id. A job id is 32 lowercase hex characters.' });
    return;
  }

  var rl = await checkRateLimit(req);
  if (rl.limited) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    res.status(429).json({
      error: rl.scope === 'hour' ? 'You’ve hit the hourly limit. Try again in a little while.' : 'You’ve hit the daily limit. Try again tomorrow.',
      limit: rl.scope
    });
    return;
  }

  var loaded = await getJob(id);
  if (!loaded.ok) {
    if (loaded.error === 'storage-unavailable') res.status(503).json({ error: 'Storage is temporarily unavailable. Please try again.' });
    else if (loaded.error === 'not-found') res.status(404).json({ error: 'No crawl with this id. Either it never existed or it has expired: crawl records are kept for 90 days.' });
    else res.status(500).json({ error: 'The crawl record could not be read.' });
    return;
  }

  var job = loaded.job;
  if (job.executiveSummary) {
    res.status(200).json({ summary: job.executiveSummary, stored: true });
    return;
  }
  if (job.status !== 'done') {
    res.status(409).json({ error: 'This crawl has not finished, so there is nothing to summarize yet.', pagesDone: job.pages_done, pageCount: job.pages.length });
    return;
  }

  try {
    var data = require('./crawl-result').jobToResult(job);
    try { data.benchmark = facts.benchmarkFromData(path.join(__dirname, '..', 'data')); } catch (e) { data.benchmark = null; }
    var f = facts.facts(data, { schema: schema });

    var model = process.env.SUMMARY_MODEL || gemini.DEFAULT_MODEL;
    var ask = gemini.hasKey({ noEnvFile: true }) ? gemini.makeAsk({ noEnvFile: true }) : null;
    var result = await summary.summarize(f, { ask: ask, model: model, date: new Date().toISOString().slice(0, 10) });

    // Another request may have stored one while the model was answering: keep the first.
    var again = await getJob(id);
    if (again.ok && again.job.executiveSummary) {
      res.status(200).json({ summary: again.job.executiveSummary, stored: true });
      return;
    }
    var fresh = again.ok ? again.job : job;
    fresh.executiveSummary = result.summary;
    var saved = await saveJob(fresh);
    res.status(200).json({ summary: result.summary, stored: !!saved, usedFallback: result.summary.source.kind === 'rules' });
  } catch (err) {
    console.error('[crawl-summarize] unhandled error for job', id, '-', err && err.message ? err.message : err);
    res.status(500).json({ error: 'The summary could not be written. Please try again.' });
  }
}

module.exports = handler;
