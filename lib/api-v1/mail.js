/* =====================================================================
   lib/api-v1/mail.js: the one email of the API: the key. Transactional only: it carries the key, how to use it, the limits and a revoke link, and nothing else (no
   marketing line, no tracking pixel, no tracked link). Sent through Resend's HTTP API with RESEND_API_KEY from PRO_MAIL_FROM, the same sender as the Pro mails.

   The key is in this message and nowhere else: not in the HTTP response of POST /v1/keys, not in a log. Nothing here logs an address or a key.
   ===================================================================== */

'use strict';

const site = require('../site-config.js');
const Limits = require('./limits.js');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const configured = (env) => { env = env || process.env; return !!(env.RESEND_API_KEY && env.PRO_MAIL_FROM); };

function compose(key, revokeUrl) {
  const f = Limits.PLAN_LIMITS.free, docs = site.baseUrl + '/api';
  const subject = 'Your Citehound API key';
  const text = [
    'You asked for a Citehound API key. Here it is:', '', key, '',
    'This is the only time it is shown. Keep it private and send it with every request:', '',
    '  Authorization: Bearer ' + key, '',
    'The API reference and examples: ' + docs,
    'A free key allows ' + f.hour + ' requests an hour and ' + f.day + ' a day. The same domain is scanned at most ' + Limits.DOMAIN_PER_HOUR + ' times an hour across all keys.', '',
    'You did not ask for this, or the key got out? Revoke it with one button here: ' + revokeUrl, '',
    'Questions: ' + site.contactEmail, 'Citehound'
  ].join('\n');
  const html = '<!doctype html><html><body style="margin:0;padding:24px;background:#EEF1F5;font-family:Arial,Helvetica,sans-serif;color:#14202E;">' +
    '<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #D9DEE6;border-radius:10px;padding:28px;">' +
    '<p style="margin:0 0 20px;font-size:20px;font-weight:700;color:#0B1526;">Citehound</p>' +
    '<p style="margin:0 0 14px;font-size:16px;line-height:1.5;">You asked for a Citehound API key. Here it is:</p>' +
    '<p style="margin:0 0 14px;padding:12px 14px;background:#EEF1F5;border-radius:6px;font-family:Menlo,Consolas,monospace;font-size:15px;word-break:break-all;">' + esc(key) + '</p>' +
    '<p style="margin:0 0 14px;font-size:15px;line-height:1.5;color:#4B5766;">This is the only time it is shown. Keep it private and send it with every request as <code>Authorization: Bearer</code> followed by the key.</p>' +
    '<p style="margin:0 0 14px;font-size:15px;line-height:1.5;color:#4B5766;">The API reference and examples: <a href="' + esc(docs) + '" style="color:#14202E;">' + esc(docs) + '</a>. A free key allows ' + f.hour + ' requests an hour and ' + f.day + ' a day. The same domain is scanned at most ' + Limits.DOMAIN_PER_HOUR + ' times an hour across all keys.</p>' +
    '<p style="margin:0 0 14px;font-size:15px;line-height:1.5;color:#4B5766;">You did not ask for this, or the key got out? <a href="' + esc(revokeUrl) + '" style="color:#14202E;">Revoke it with one button</a>.</p>' +
    '<p style="margin:0;font-size:14px;line-height:1.5;color:#4B5766;">Questions: <a href="mailto:' + esc(site.contactEmail) + '" style="color:#14202E;">' + esc(site.contactEmail) + '</a></p>' +
    '</div></body></html>';
  return { subject: subject, text: text, html: html };
}

// -> { ok: true } or { ok: false, reason }. deps.fetch is for tests.
async function send(to, msg, deps) {
  deps = deps || {};
  const env = deps.env || process.env;
  if (!configured(env)) return { ok: false, reason: 'not_configured' };
  try {
    const res = await (deps.fetch || fetch)('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.PRO_MAIL_FROM, to: [to], reply_to: site.contactEmail, subject: msg.subject, text: msg.text, html: msg.html })
    });
    return res.ok ? { ok: true } : { ok: false, reason: 'provider_error' };
  } catch (e) { return { ok: false, reason: 'provider_unreachable' }; }
}

module.exports = { compose, send, configured };
