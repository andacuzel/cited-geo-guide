/* =====================================================================
   lib/plans.js: the tier matrix, once. Free, Pro, Fix and Beyond, and what each gets from the API (and from everything that uses an API key: the CLI with a key, /watch, the connectors).
   docs/integrations/TIERS.md is the same table in words; scripts/test-api-v1.js and scripts/test-plans.js keep the two apart from drifting.

   The web scan, the free browser tools and the keyless MCP server are not gated by this file: the pricing pages promise the free scan its full report, and the MCP listing says all tools are free
   (docs/integrations/PROGRESS.md, "Decisions"). Prices live in content/pricing.json and are not repeated here.
   ===================================================================== */

'use strict';

const PRICING_URL = 'https://getcitehound.com/pricing';
const ORDER = ['free', 'pro', 'fix', 'beyond'];

// scanDetail: 'top3' (score, pillars, crawlers, the first three findings) or 'full'. generators: 'preview' or 'full'. schemaTypes: a list or 'all'.
// scansDay: scans (requests that fetch a site) a day, or null for no extra cap. watch/webhooks/retentionDays/intervalDays: monitoring (0 and null where the plan has none).
const PLANS = {
  free:   { label: 'Free',   hour: 10,  day: 40,   scansDay: 5,    scanDetail: 'top3', compare: false, generators: 'preview', schemaTypes: ['organization'], monitoring: false, fixes: false, exportData: false, watch: 0,  webhooks: 0, retentionDays: 0,   intervalDays: null },
  pro:    { label: 'Pro',    hour: 200, day: 2000, scansDay: null, scanDetail: 'full', compare: true,  generators: 'full',    schemaTypes: 'all',            monitoring: true,  fixes: false, exportData: false, watch: 5,  webhooks: 3, retentionDays: 365, intervalDays: 7 },
  fix:    { label: 'Fix',    hour: 400, day: 4000, scansDay: null, scanDetail: 'full', compare: true,  generators: 'full',    schemaTypes: 'all',            monitoring: true,  fixes: true,  exportData: false, watch: 5,  webhooks: 3, retentionDays: 365, intervalDays: 7 },
  beyond: { label: 'Beyond', hour: 600, day: 6000, scansDay: null, scanDetail: 'full', compare: true,  generators: 'full',    schemaTypes: 'all',            monitoring: true,  fixes: true,  exportData: true,  watch: 15, webhooks: 5, retentionDays: 730, intervalDays: 2 }
};

const NAMES = Object.keys(PLANS);
const planOf = (name) => PLANS[name] || PLANS.free;
const rank = (name) => Math.max(0, ORDER.indexOf(name));
const best = (names) => (names || []).slice().sort((a, b) => rank(b) - rank(a))[0] || 'free';

// The lowest plan that has a feature (a boolean feature, or the 'full' value of scanDetail/generators).
const LOWEST = { compare: 'pro', monitoring: 'pro', fixes: 'fix', exportData: 'beyond', scanDetail: 'pro', generators: 'pro', schemaTypes: 'pro' };
const FEATURE_TEXT = {
  compare: 'Comparing two sites through the API', monitoring: 'Monitoring (watchlist, history, events, alerts and webhooks)', fixes: 'The prioritized fix list with ready-to-paste files and the re-check',
  exportData: 'The history and events export', scanDetail: 'The full scan detail', generators: 'The full generated file', schemaTypes: 'Every schema type'
};
const planList = (min) => ORDER.slice(ORDER.indexOf(min)).map((p) => PLANS[p].label).join(', ').replace(/, ([^,]*)$/, ' and $1');

// The body of a plan gate (HTTP 402): plain, with the way up, and never a threat.
function gateBody(feature, plan) {
  const need = LOWEST[feature] || 'pro';
  return { error: 'plan_required', required_plan: need, plan: plan, message: FEATURE_TEXT[feature] + ' is available on ' + planList(need) + '. This key is on the ' + planOf(plan).label + ' plan. See the plans at ' + PRICING_URL + '.', plans_url: PRICING_URL };
}
// What a trimmed answer carries so the reader knows more exists.
const upgrade = (feature, plan) => ({ message: FEATURE_TEXT[feature] + ' is available on ' + planList(LOWEST[feature] || 'pro') + '. See the plans at ' + PRICING_URL + '.', required_plan: LOWEST[feature] || 'pro', plans_url: PRICING_URL });

const allowsSchema = (plan, type) => { const t = planOf(plan).schemaTypes; return t === 'all' || t.indexOf(type) !== -1; };

module.exports = { PRICING_URL, ORDER, PLANS, NAMES, planOf, rank, best, gateBody, upgrade, allowsSchema, planList };
