/* =====================================================================
   Job storage for the crawl engine — Vercel KV, same REST pipeline as
   _kv.js / _rateLimit.js. A job is one JSON blob per key, read-modify-
   written by crawl-step.js on every batch.

   Storage: domain, the discovered URL list, and per-page results only.
   Nothing about who requested the crawl is ever stored alongside it.

   90-day TTL, refreshed on every write so an actively-progressing job
   never expires mid-run.
   ===================================================================== */

const crypto = require('crypto');
const { kvPipeline } = require('./_kv');

var TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days
var KEY_PREFIX = 'crawl:';

function generateJobId() {
  return crypto.randomBytes(16).toString('hex');
}

async function createJob(record) {
  var key = KEY_PREFIX + record.id;
  var result = await kvPipeline([['SET', key, JSON.stringify(record), 'EX', String(TTL_SECONDS)]]);
  return !!result;
}

// Returns { ok: true, job } or { ok: false, error: 'storage-unavailable' | 'not-found' | 'corrupted' }.
async function getJob(id) {
  var key = KEY_PREFIX + id;
  var result = await kvPipeline([['GET', key]]);
  if (!result) return { ok: false, error: 'storage-unavailable' };
  var raw = result[0] && result[0].result;
  if (!raw) return { ok: false, error: 'not-found' };
  try {
    return { ok: true, job: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: 'corrupted' };
  }
}

async function saveJob(job) {
  var key = KEY_PREFIX + job.id;
  var result = await kvPipeline([['SET', key, JSON.stringify(job), 'EX', String(TTL_SECONDS)]]);
  return !!result;
}

module.exports = {
  TTL_SECONDS: TTL_SECONDS,
  generateJobId: generateJobId,
  createJob: createJob,
  getJob: getJob,
  saveJob: saveJob
};
