/* =====================================================================
   lib/citation-budget.js: the guards every paid call of the Pro citation check goes through.

   Before a paid call: reserve(). It checks, in this order, the kill switch (CITATION_KILL=1, or the Redis flag that
   `node scripts/pro-admin.js kill on` sets: so a stop needs no redeploy), the per-report call count (CITATION_MAX_CALLS), the per-report cost
   (CITATION_MAX_COST_USD), the day's budget (CITATION_DAILY_BUDGET_USD) and the month's (CITATION_MONTHLY_BUDGET_USD). Costs are integer
   micro-dollars held in Redis hashes and moved with HINCRBY, which is atomic: the estimate is added first, and if any limit would be passed
   every step is rolled back and the call is not made. After the call: reconcile() replaces the estimate with the real cost (token usage and the
   number of searches for Claude, the cost the provider reports for Perplexity). A call that was reserved but not made is release()d.
   If Redis cannot be reached the answer is "no": the check fails closed and the report goes on without it.

   What is stored is aggregate only: per day and per month, per provider, the number of calls and the micro-dollars spent. Nothing about
   a person, a report or a site. The per-report numbers live in that report's own citation record.
   ===================================================================== */

'use strict';

const Config = require('./citation-config.js');

const SPEND = 'pro:cit:spend';
const STAT = 'pro:cit:stat';
const KILL = 'pro:cit:kill';
const KEEP = 400 * 86400;

const dayOf = (ms) => new Date(ms === undefined ? Date.now() : ms).toISOString().slice(0, 10);
const citKey = (id) => 'pro:job:' + id + ':cit';
const micro = (usd) => Math.round(usd * 1e6);

// The worst a single call can cost, used for the reservation (a real call is far cheaper). Claude: two searches at $0.01 plus tokens. Perplexity: a
// few searches at $0.0025 plus tokens. Question writing and the knowledge check are token-only.
const ESTIMATE = { anthropic: 30000, perplexity: 12000, generate: 12000, knowledge: 4000 };

async function killed(store, env) {
  if ((env || process.env).CITATION_KILL === '1') return true;
  try { return (await store.adapter.get(KILL)) === '1'; } catch (e) { return true; }
}

// -> { ok: true, g } or { ok: false, reason }. reason: kill, report_calls, report_cost, daily_budget, monthly_budget, budget_unavailable.
async function reserve(store, jobId, o) {
  const env = o.env || process.env, A = store.adapter, L = Config.limits(env);
  if (await killed(store, env)) return { ok: false, reason: 'kill' };
  const est = Math.max(1, Math.round(o.estMicro)), day = 'd:' + dayOf(o.now), month = 'm:' + dayOf(o.now).slice(0, 7);
  const done = [];
  const undo = async () => { for (const [key, field, n] of done.reverse()) await A.hincrby(key, field, -n).catch(function () {}); };
  try {
    const step = async (key, field, n, limit, reason) => {
      const v = await A.hincrby(key, field, n);
      done.push([key, field, n]);
      if (limit !== null && v > limit) { await undo(); return reason; }
      return null;
    };
    let why = await step(citKey(jobId), 'calls', 1, L.maxCalls, 'report_calls');
    if (!why) why = await step(citKey(jobId), 'spend', est, micro(L.maxCostUsd), 'report_cost');
    if (!why) why = await step(SPEND, day, est, micro(L.dailyUsd), 'daily_budget');
    if (!why) why = await step(SPEND, month, est, micro(L.monthlyUsd), 'monthly_budget');
    if (why) return { ok: false, reason: why };
    await A.expire(SPEND, KEEP).catch(function () {});
    return { ok: true, g: { jobId: jobId, est: est, day: day, month: month, provider: o.provider || 'other' } };
  } catch (e) {
    await undo();
    return { ok: false, reason: 'budget_unavailable' };
  }
}

// Replaces the reservation with the real cost and counts the call per provider.
async function reconcile(store, g, actualMicro) {
  const A = store.adapter, actual = Math.max(0, Math.round(actualMicro || 0)), delta = actual - g.est;
  try {
    if (delta !== 0) {
      await A.hincrby(citKey(g.jobId), 'spend', delta);
      await A.hincrby(SPEND, g.day, delta);
      await A.hincrby(SPEND, g.month, delta);
    }
    await A.hincrby(STAT, g.day + ':' + g.provider + ':calls', 1);
    await A.hincrby(STAT, g.day + ':' + g.provider + ':micro', actual);
    await A.hincrby(STAT, g.month + ':' + g.provider + ':calls', 1);
    await A.hincrby(STAT, g.month + ':' + g.provider + ':micro', actual);
    await A.expire(STAT, KEEP);
  } catch (e) { /* the counters must never break a report; the reservation stands, which errs on the safe side */ }
}

// The call was reserved but never made.
async function release(store, g) {
  const A = store.adapter;
  try {
    await A.hincrby(citKey(g.jobId), 'calls', -1);
    await A.hincrby(citKey(g.jobId), 'spend', -g.est);
    await A.hincrby(SPEND, g.day, -g.est);
    await A.hincrby(SPEND, g.month, -g.est);
  } catch (e) { /* see reconcile */ }
}

async function setKill(store, on) {
  if (on) await store.adapter.set(KILL, '1'); else await store.adapter.del(KILL);
}

// Aggregates for scripts/pro-admin.js spend: today and this month, per provider, with the budgets.
async function summary(store, env, now) {
  const A = store.adapter, L = Config.limits(env), d = dayOf(now), m = d.slice(0, 7);
  const h = (await A.hgetall(STAT)) || {}, sp = (await A.hgetall(SPEND)) || {};
  const get = (k) => parseInt(h[k] || '0', 10) || 0;
  const rows = Config.ORDER.concat(['generate', 'knowledge']).map((p) => ({ provider: p, dayCalls: get('d:' + d + ':' + p + ':calls'), dayMicro: get('d:' + d + ':' + p + ':micro'), monthCalls: get('m:' + m + ':' + p + ':calls'), monthMicro: get('m:' + m + ':' + p + ':micro') }));
  return { day: d, month: m, rows: rows, reservedDayMicro: parseInt(sp['d:' + d] || '0', 10) || 0, reservedMonthMicro: parseInt(sp['m:' + m] || '0', 10) || 0, dailyBudgetMicro: micro(L.dailyUsd), monthlyBudgetMicro: micro(L.monthlyUsd), killed: await killed(store, env) };
}

module.exports = { reserve: reserve, reconcile: reconcile, release: release, killed: killed, setKill: setKill, summary: summary, ESTIMATE: ESTIMATE, KILL: KILL, SPEND: SPEND, STAT: STAT, micro: micro };
