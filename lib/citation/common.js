/* =====================================================================
   lib/citation/common.js: small pieces shared by the citation runner and its
   providers: sleep, log, the Stop error (a failure that must end the job, not
   be retried) and the Retry-After parser.
   ===================================================================== */
'use strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

function parseRetryDelay(body, headers) {
  const details = (body && body.error && body.error.details) || [];
  let ms = null;
  let quotaId = null;
  for (const d of details) {
    if (d.retryDelay) {
      const m = /^([\d.]+)s$/.exec(d.retryDelay);
      if (m) ms = Math.ceil(parseFloat(m[1]) * 1000);
    }
    for (const v of d.violations || []) quotaId = quotaId || v.quotaId || v.quotaMetric || null;
  }
  const ra = headers && headers.get && headers.get('retry-after');
  if (ms === null && ra && /^\d+$/.test(ra)) ms = parseInt(ra, 10) * 1000;
  const msg = (body && body.error && body.error.message) || '';
  const perDay = /PerDay/i.test(String(quotaId)) || /per day|daily/i.test(msg);
  return { ms, quotaId, perDay };
}

class Stop extends Error {
  constructor(msg) { super(msg); this.stop = true; }
}


// Raised by a provider that is asked to run without its key. No request has been made.
class NotConfigured extends Error {
  constructor(provider, envVar) {
    super(provider + ' is not configured: ' + envVar + ' is not set.');
    this.notConfigured = true;
    this.provider = provider;
  }
}

module.exports = { sleep, log, Stop, NotConfigured, parseRetryDelay };
