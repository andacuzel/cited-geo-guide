/* =====================================================================
   lib/pro-stats.js: daily aggregate counters for Citehound Pro and the waitlist.

   One Redis hash per UTC day, pro:stats:<YYYY-MM-DD>, one numeric field per metric,
   kept 400 days. A counter is a number and nothing else: no address, no email, no
   token, no job id, no user agent and no per-person record is ever written here.
   Nothing runs in the browser. The numbers come from the server's own events
   (a signup, an order, a job ending), and scripts/pro-admin.js stats prints them.

   A failing counter never breaks the thing it counts: count() swallows storage
   errors. An unknown metric name is a programming error and throws, so a typo
   cannot silently count nothing.
   ===================================================================== */

'use strict';

const METRICS = [
  'waitlist_signups',   // a valid signup was accepted (a repeat of a known address counts too: it is a request, not a person)
  'waitlist_removed',   // a removal link was used
  'waitlist_emails',    // a confirmation email was handed to the mail provider
  'orders_pilot',       // an order link was issued with source pilot
  'orders_paid',        // an order link was issued with source paid
  'jobs_started',
  'jobs_done',
  'jobs_partial',
  'jobs_failed',
  'jobs_restored',      // a failed job gave its link back
  'report_emails',      // "email me this report" handed to the mail provider
  'feedback',           // a feedback form was stored
  'citation_runs',      // a citation check started (the profile phase)
  'citation_complete',  // every question was tested
  'citation_partial',   // some questions were tested, the rest not
  'citation_not_tested',// none was tested (no model, no quota, no usable profile)
  'citation_calls',     // grounded questions sent to the assistant
  'webhook_rejected',   // a payment webhook failed its signature or timestamp check
  'payments_refunded',  // a full refund cancelled a link nobody had used
  'payments_review',    // a partial refund, an unsized refund or a refund after use flagged an order for the owner
  'start_link_emails',  // the backup copy of a bought link was handed to the mail provider
  'mail_failed',        // the mail provider refused or could not be reached (a mail that is not set up is not counted)
  'webhook_errors'      // a verified payment event failed while being processed (the provider retries it)
];
const KEEP_SECONDS = 400 * 86400;

function dayOf(ms) { return new Date(ms === undefined ? Date.now() : ms).toISOString().slice(0, 10); }
function key(day) { return 'pro:stats:' + day; }

// store: a Pro store (has .adapter) or an adapter itself.
async function count(store, metric, n, now) {
  if (METRICS.indexOf(metric) === -1) throw new Error('unknown stats metric: ' + metric);
  const A = (store && store.adapter) || store;
  try {
    const k = key(dayOf(now));
    await A.hincrby(k, metric, n === undefined ? 1 : n);
    await A.expire(k, KEEP_SECONDS);
  } catch (e) { /* a counter must never break what it counts */ }
}

// The last `days` days, newest first: [{ day, counts: { metric: number } }].
async function read(store, days, now) {
  const A = (store && store.adapter) || store;
  const out = [];
  const t = now === undefined ? Date.now() : now;
  for (let i = 0; i < days; i++) {
    const day = dayOf(t - i * 86400000);
    const h = (await A.hgetall(key(day))) || {};
    const counts = {};
    METRICS.forEach(function (m) { counts[m] = parseInt(h[m] || '0', 10) || 0; });
    out.push({ day: day, counts: counts });
  }
  return out;
}

module.exports = { METRICS: METRICS, count: count, read: read, dayOf: dayOf, KEEP_SECONDS: KEEP_SECONDS };
