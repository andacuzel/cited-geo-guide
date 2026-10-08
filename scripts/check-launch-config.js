#!/usr/bin/env node
/* =====================================================================
   scripts/check-launch-config.js

   Guards the launch lead-magnet (lib/launch-config.js).

   ENABLED true   every value must be set and well formed: EDITION_NAME, PROVIDER_NAME and
                  CONSENT_VERSION non-empty text; REPORT_SLUG lowercase letters, digits and dashes;
                  FOUNDING_CAP a whole number from 1 to 100000; END_DATE a real YYYY-MM-DD date that
                  is today or later. Anything else fails.
   ENABLED false  nothing may be reachable: no launch page exists, nothing in sitemap.xml, llms.txt,
                  any page or the shared header and footer links to one, and /api/subscribe answers
                  503 {"error":"not_enabled"}. The two docs must exist.

     node scripts/check-launch-config.js            same as --check
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const launch = require('../lib/launch-config.js');

const KEYS = ['ENABLED', 'EDITION_NAME', 'REPORT_SLUG', 'FOUNDING_CAP', 'END_DATE', 'PROVIDER_NAME', 'CONSENT_VERSION'];
const problems = [];
const bad = (m) => problems.push(m);
const read = (f) => (fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f), 'utf8') : '');

// shape
Object.keys(launch).forEach((k) => { if (KEYS.indexOf(k) === -1) bad('unknown key ' + k + ' in lib/launch-config.js'); });
KEYS.forEach((k) => { if (!(k in launch)) bad('missing key ' + k + ' in lib/launch-config.js'); });
if (typeof launch.ENABLED !== 'boolean') bad('ENABLED must be true or false');

const text = (v) => typeof v === 'string' && v.trim().length > 0;
if (launch.ENABLED === true) {
  const unset = KEYS.filter((k) => k !== 'ENABLED' && (launch[k] === null || launch[k] === undefined || launch[k] === ''));
  if (unset.length) bad('ENABLED is true but these values are not set: ' + unset.join(', '));
  if (launch.EDITION_NAME !== null && !text(launch.EDITION_NAME)) bad('EDITION_NAME must be non-empty text');
  if (launch.PROVIDER_NAME !== null && !text(launch.PROVIDER_NAME)) bad('PROVIDER_NAME must be non-empty text');
  if (launch.CONSENT_VERSION !== null && !text(launch.CONSENT_VERSION)) bad('CONSENT_VERSION must be non-empty text');
  if (launch.REPORT_SLUG !== null && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(launch.REPORT_SLUG))) bad('REPORT_SLUG must be lowercase letters, digits and single dashes');
  if (launch.REPORT_SLUG === 'founding' || launch.REPORT_SLUG === 'privacy' || launch.REPORT_SLUG === 'api') bad('REPORT_SLUG collides with an existing path');
  if (launch.FOUNDING_CAP !== null && !(Number.isInteger(launch.FOUNDING_CAP) && launch.FOUNDING_CAP >= 1 && launch.FOUNDING_CAP <= 100000)) bad('FOUNDING_CAP must be a whole number from 1 to 100000');
  if (launch.END_DATE !== null) {
    const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(String(launch.END_DATE));
    const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
    if (!d || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) bad('END_DATE must be a real date written YYYY-MM-DD');
    else if (d.getTime() < Date.parse(new Date().toISOString().slice(0, 10))) bad('END_DATE is in the past');
  }
}

// dark state
async function dark() {
  const roots = fs.readdirSync(ROOT).filter((n) => /\.html$/.test(n));
  const pages = roots.filter((n) => n === 'founding.html' || /data-form="(report|founding)"/.test(read(n)));
  if (pages.length) bad('ENABLED is false but launch page(s) exist: ' + pages.join(', '));

  const reach = [];
  ['sitemap.xml', 'llms.txt', 'robots.txt'].forEach((f) => { if (/\/founding\b|api\/subscribe/.test(read(f))) reach.push(f); });
  if (reach.length) bad('ENABLED is false but ' + reach.join(', ') + ' mention a launch page or /api/subscribe');
  const linked = [];
  const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (['node_modules', '.git', 'local', '.claude', 'asset', 'data', 'api', 'docs', 'supabase', 'plugin'].indexOf(e.name) === -1) walk(rel); return; }
    if (/\.(html|js)$/.test(e.name) && !/^(scripts[\\/]|lib[\\/]launch-config|api[\\/])/.test(rel) && !/generate-launch-pages|check-launch-config|test-subscribe/.test(rel)) {
      if (/href=["']\/?founding["']|href=["']\/?api\/subscribe/.test(read(rel))) linked.push(rel);
    }
  });
  walk('.');
  ['lib/page-shell.js', 'nav.js'].forEach((f) => { if (/\/founding\b/.test(read(f))) linked.push(f); });
  if (linked.length) bad('ENABLED is false but these link to a launch page: ' + linked.join(', '));

  // the endpoint
  const handler = require('../api/subscribe.js');
  const saved = process.env.SUBSCRIBE_WEBHOOK_URL;
  process.env.SUBSCRIBE_WEBHOOK_URL = 'http://127.0.0.1:1/never-called';
  const res = { code: 200, body: null, setHeader() {}, status(c) { res.code = c; return res; }, json(b) { res.body = b; return res; } };
  await handler({ method: 'POST', headers: { origin: require('../lib/site-config.js').baseUrl, 'content-type': 'application/json' }, body: { email: 'a@example.org', form: 'report', consent: true } }, res);
  if (saved === undefined) delete process.env.SUBSCRIBE_WEBHOOK_URL; else process.env.SUBSCRIBE_WEBHOOK_URL = saved;
  if (res.code !== 503 || !res.body || res.body.error !== 'not_enabled') bad('ENABLED is false but /api/subscribe did not answer 503 not_enabled (got ' + res.code + ')');

  ['docs/launch-report.md', 'docs/privacy-addendum.md'].forEach((f) => { if (!fs.existsSync(path.join(ROOT, f))) bad(f + ' is missing'); });
}

(async () => {
  if (launch.ENABLED !== true) await dark();
  if (problems.length) { console.error('FAIL (' + problems.length + '):\n  ' + problems.join('\n  ')); process.exit(1); }
  console.log(launch.ENABLED === true
    ? 'OK: launch config is complete and well formed (ENABLED true).'
    : 'OK: launch lead-magnet is dark: no page, no link, nothing in the sitemap or llms.txt, /api/subscribe answers 503 not_enabled.');
})();
