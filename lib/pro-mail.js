/* =====================================================================
   lib/pro-mail.js: the one email a Pro customer can ask for: their report link.

   Sent through Resend's HTTP API with RESEND_API_KEY, from the address in
   PRO_MAIL_FROM (a sender on a domain with SPF, DKIM and DMARC set up for it;
   docs/pro.md lists the records). If either variable is missing, configured()
   is false, the endpoint answers "not configured" and the report page hides
   its button. This module never uses the project's mailbox.

   The recipient is always the address stored in the order. send() takes the
   order, not an address, so there is no argument through which a request could
   choose where the message goes. Plain, branded, no images, no tracking pixel;
   switch Resend's open and click tracking off for the sending domain.
   ===================================================================== */

'use strict';

const site = require('./site-config.js');

function configured(env) {
  env = env || process.env;
  return !!(env.RESEND_API_KEY && env.PRO_MAIL_FROM);
}

function clean(s) { return String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100); }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return months[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
}

function reportUrl(jobId) { return site.baseUrl + '/r/' + jobId + '/'; }

// order: from the store (has the contact). job: from the store. Returns the message without sending it.
function compose(order, job) {
  const url = reportUrl(job.id);
  const expires = longDate(job.expiresAt);
  const name = clean(order.contact && order.contact.name);
  const hello = name ? 'Hello ' + name + ',' : 'Hello,';
  const subject = 'Your Citehound report for ' + job.domain;
  const lines = [
    hello,
    '',
    'Here is the link to your Citehound report for ' + job.domain + ':',
    '',
    url,
    '',
    'Anyone with this link can open the report. It stays available until ' + expires + ', 90 days after it was made.',
    '',
    'The report\u2019s score measures AI readiness: crawler access and on-page signals. It does not measure how often assistants mention a brand. A citation check, if your report has one, is a separate sample of AI answers, dated and limited to one assistant.',
    '',
    'Questions? Reply to this message or write to ' + site.contactEmail + '.',
    '',
    'Citehound'
  ];
  const text = lines.join('\n');
  const html = '<!doctype html><html><body style="margin:0;padding:24px;background:#EEF1F5;font-family:Arial,Helvetica,sans-serif;color:#14202E;">' +
    '<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #D9DEE6;border-radius:10px;padding:28px;">' +
    '<p style="margin:0 0 20px;font-size:20px;font-weight:700;color:#0B1526;">Citehound</p>' +
    '<p style="margin:0 0 14px;font-size:16px;line-height:1.5;">' + esc(hello) + '</p>' +
    '<p style="margin:0 0 20px;font-size:16px;line-height:1.5;">Here is the link to your Citehound report for <strong>' + esc(job.domain) + '</strong>.</p>' +
    '<p style="margin:0 0 24px;"><a href="' + esc(url) + '" style="display:inline-block;background:#0B1526;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:16px;padding:12px 20px;border-radius:6px;">View your report</a></p>' +
    '<p style="margin:0 0 6px;font-size:14px;line-height:1.5;color:#4B5766;">Or copy this address:</p>' +
    '<p style="margin:0 0 20px;font-size:14px;line-height:1.5;word-break:break-all;"><a href="' + esc(url) + '" style="color:#14202E;">' + esc(url) + '</a></p>' +
    '<p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#4B5766;">Anyone with this link can open the report. It stays available until ' + esc(expires) + ', 90 days after it was made.</p>' +
    '<p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#4B5766;">The report\u2019s score measures AI readiness: crawler access and on-page signals. It does not measure how often assistants mention a brand. A citation check, if your report has one, is a separate sample of AI answers, dated and limited to one assistant.</p>' +
    '<p style="margin:0;font-size:14px;line-height:1.5;color:#4B5766;">Questions? Reply to this message or write to <a href="mailto:' + esc(site.contactEmail) + '" style="color:#14202E;">' + esc(site.contactEmail) + '</a>.</p>' +
    '</div></body></html>';
  return { subject: subject, text: text, html: html };
}

// Sends the report link to the address stored in the order. deps.fetch is for tests.
async function sendReportLink(order, job, deps) {
  deps = deps || {};
  const env = deps.env || process.env;
  if (!configured(env)) return { ok: false, reason: 'not_configured' };
  if (!order || !order.contact || !order.contact.email) return { ok: false, reason: 'no_recipient' };
  const msg = compose(order, job);
  const doFetch = deps.fetch || fetch;
  try {
    const res = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.PRO_MAIL_FROM, to: [order.contact.email], reply_to: site.contactEmail, subject: msg.subject, text: msg.text, html: msg.html })
    });
    if (!res.ok) return { ok: false, reason: 'provider_error', status: res.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'provider_unreachable' };
  }
}

module.exports = { configured: configured, compose: compose, sendReportLink: sendReportLink, reportUrl: reportUrl };
