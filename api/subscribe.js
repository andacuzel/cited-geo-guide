/* =====================================================================
   /api/subscribe — signup for the launch lead-magnet (report and founding list).

   Dark until lib/launch-config.js has ENABLED = true AND the server-side
   environment variable SUBSCRIBE_WEBHOOK_URL is set. In either other state every
   request gets 503 {"error":"not_enabled"} and nothing else happens.

   It does one thing: validate a signup and hand it, server to server, to the
   email provider's webhook. The provider owns the list and the double opt-in; no
   mail is sent from here, and nothing is stored here.

   POST application/json only:
     { email, site?, role?, form: "report" | "founding", consent: true, company_fax? }
   company_fax is the honeypot: real visitors never see or fill it. A filled one gets
   the same 200 as a real signup and is dropped.

   Forwarded to SUBSCRIBE_WEBHOOK_URL as JSON:
     { email, site, role, form, consent: true, consentVersion, timestamp }
   consentVersion and timestamp come from the server, never from the browser.

   Privacy: the email address is never logged. The caller's IP is only ever a SHA-256
   hash inside the rate-limit counters (api/_rateLimit.js, own counters, 5 an hour and
   20 a day per address); fails open if KV is unavailable, like the scan endpoints.
   Only the site's own origin (apex and www) may post.
   ===================================================================== */

'use strict';

const site = require('../lib/site-config');
const launch = require('../lib/launch-config');
const { checkRateLimit } = require('./_rateLimit');

const FORMS = ['report', 'founding'];
const MAX = { email: 254, site: 200, role: 80 };
const WEBHOOK_TIMEOUT_MS = 6000;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

function allowedOrigins() {
  const u = new URL(site.baseUrl);
  const host = u.host.replace(/^www\./, '');
  return [u.protocol + '//' + host, u.protocol + '//www.' + host];
}

function header(req, name) {
  const v = req.headers && req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { return null; } }
  return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
}

// optional text field: absent or empty is fine; otherwise a short string without control characters
function optionalText(v, max) {
  if (v === undefined || v === null || v === '') return { ok: true, value: '' };
  if (typeof v !== 'string') return { ok: false };
  const t = v.trim();
  if (t.length > max || CONTROL.test(t)) return { ok: false };
  return { ok: true, value: t };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const webhook = process.env.SUBSCRIBE_WEBHOOK_URL;
  if (launch.ENABLED !== true || !webhook) {
    res.status(503).json({ error: 'not_enabled' });
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const origin = header(req, 'origin');
  if (!origin || allowedOrigins().indexOf(origin) === -1) {
    res.status(403).json({ error: 'forbidden_origin' });
    return;
  }

  if (!/^application\/json\b/i.test(String(header(req, 'content-type') || ''))) {
    res.status(415).json({ error: 'json_only' });
    return;
  }

  const body = readBody(req);
  if (!body) {
    res.status(400).json({ error: 'invalid_json' });
    return;
  }

  // Honeypot: look like a success, forward nothing.
  if (typeof body.company_fax === 'string' && body.company_fax !== '') {
    res.status(200).json({ ok: true });
    return;
  }

  const rl = await checkRateLimit(req, { prefix: 'sub', hourly: 5, daily: 20 });
  if (rl.limited) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    res.status(429).json({ error: 'rate_limited' });
    return;
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > MAX.email || CONTROL.test(email) || !EMAIL_RE.test(email) || email.indexOf('..') !== -1 || email.split('@')[0].length > 64) {
    res.status(400).json({ error: 'invalid_email' });
    return;
  }
  if (body.consent !== true) {
    res.status(400).json({ error: 'consent_required' });
    return;
  }
  if (FORMS.indexOf(body.form) === -1) {
    res.status(400).json({ error: 'invalid_form' });
    return;
  }
  const siteField = optionalText(body.site, MAX.site);
  const roleField = optionalText(body.role, MAX.role);
  if (!siteField.ok || !roleField.ok) {
    res.status(400).json({ error: 'invalid_field' });
    return;
  }

  const payload = {
    email: email,
    site: siteField.value,
    role: roleField.value,
    form: body.form,
    consent: true,
    consentVersion: launch.CONSENT_VERSION,
    timestamp: new Date().toISOString()
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const up = await fetch(webhook, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    clearTimeout(timer);
    if (!up.ok) {
      console.error('[subscribe] provider webhook answered ' + up.status);
      res.status(502).json({ error: 'upstream_failed' });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    clearTimeout(timer);
    console.error('[subscribe] provider webhook unreachable (' + (e && e.name ? e.name : 'error') + ')');
    res.status(502).json({ error: 'upstream_failed' });
  }
};
