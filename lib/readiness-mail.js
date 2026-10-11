/* =====================================================================
   lib/readiness-mail.js: the one email a report request gets: the signed download link for the State of AI Readiness PDF.

   Same look as the waitlist confirmation (lib/waitlist-mail.js): 600px, table-based, inline CSS, preheader, plain-text version, navy header with the
   hound mark, gold rule and button, cream panel, Georgia for display (no web font: a web font is a request to a third party). No tracking pixel,
   no open or click tracking, no redirect, no parameter on any link. The only image is the hound mark served from this site.

   The link carries a signed token that holds a record id and an expiry (lib/readiness.js), never an address. The "Remove my address" link and the
   List-Unsubscribe headers carry the signed removal token; a mail client's one-click unsubscribe POSTs to the same address.
   ===================================================================== */

'use strict';

const site = require('./site-config.js');
const R = require('./readiness.js');
const Mail = require('./pro-mail.js');
const content = require('../content/readiness.json');

const SUBJECT = 'Your copy of the State of AI Readiness report';
const PREHEADER = 'The PDF link works for 30 days. It covers ' + content.sample.scored + ' well-known sites, scanned ' + content.sample.scanWindow + '.';

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function downloadUrl(token) { return site.baseUrl + '/readiness/download/' + token; }
function removeUrl(token) { return site.baseUrl + '/readiness/remove/' + token; }
function dateOf(ms) { return new Date(ms).toISOString().slice(0, 10); }
function longDate(ms) { const d = new Date(ms); return d.getUTCDate() + ' ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }

// opts: { now, updates (the optional box was ticked) }
function compose(email, opts) {
  opts = opts || {};
  const now = opts.now === undefined ? Date.now() : opts.now;
  const id = R.idOf(email);
  const dl = downloadUrl(R.downloadToken(id, now));
  const until = longDate(now + R.LINK_SECONDS * 1000);
  const unsub = removeUrl(R.removeTokenForId(id));
  const lines = {
    what: 'State of AI Readiness, Launch Edition 2026. Eight pages. A benchmark of ' + content.sample.scored + ' well-known websites in six categories, scanned ' + content.sample.scanWindow + '.',
    link: 'The link works until ' + until + '. You can ask for a new one on the report page.',
    measure: content.honestFraming,
    why: 'You are getting this once because this address was entered on ' + site.host + ' with "Send me the report" ticked. We keep the address for 12 months, only so that you can ask for the report again, and then delete it.' + (opts.updates ? ' You also said yes to occasional Citehound updates.' : ''),
    remove: 'Remove my address now: '
  };

  const text = [
    SUBJECT, '',
    'Hello,', '',
    lines.what, '',
    'Download the PDF: ' + dl, '',
    lines.link, '',
    lines.measure, '',
    '--',
    lines.why,
    lines.remove + unsub,
    'Questions: ' + site.contactEmail,
    'Citehound'
  ].join('\n');

  const SANS = '-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif';
  const SERIF = 'Georgia,\'Times New Roman\',serif';
  const MONO = 'Menlo,Consolas,\'Courier New\',monospace';
  const p = (t, extra) => '<p style="margin:0 0 14px;font-family:' + SANS + ';font-size:16px;line-height:24px;color:#14202e;' + (extra || '') + '">' + t + '</p>';

  const html = '<!doctype html>\n<html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">' +
    '<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">' +
    '<title>' + esc(SUBJECT) + '</title></head>' +
    '<body style="margin:0;padding:0;background:#eef1f5;">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#eef1f5;font-size:1px;line-height:1px;">' + esc(PREHEADER) + '&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef1f5" style="background:#eef1f5;"><tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">' +
    '<tr><td bgcolor="#0b1526" style="background:#0b1526;padding:22px 28px;border-radius:10px 10px 0 0;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td width="44" valign="middle" style="padding-right:12px;"><img src="' + esc(site.baseUrl) + '/assets/email/hound-mark.png" width="44" height="44" alt="" style="display:block;border:0;width:44px;height:44px;"></td>' +
    '<td valign="middle" style="font-family:' + SERIF + ';font-size:26px;line-height:30px;color:#ffffff;">Citehound</td>' +
    '</tr></table></td></tr>' +
    '<tr><td bgcolor="#e7c77c" height="4" style="background:#e7c77c;height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>' +
    '<tr><td bgcolor="#fbf8ef" style="background:#fbf8ef;padding:32px 28px 28px;border:1px solid #dfe3ea;border-top:0;border-radius:0 0 10px 10px;">' +
    '<p style="margin:0 0 10px;font-family:' + MONO + ';font-size:12px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:#97701f;">Launch Edition 2026</p>' +
    '<h1 style="margin:0 0 16px;font-family:' + SERIF + ';font-weight:normal;font-size:30px;line-height:36px;color:#0b1526;">State of AI Readiness</h1>' +
    p('Hello,') + p(esc(lines.what)) +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px;"><tr><td bgcolor="#e7c77c" style="background:#e7c77c;border-radius:6px;"><a href="' + esc(dl) + '" style="display:inline-block;padding:13px 24px;font-family:' + SANS + ';font-size:16px;line-height:20px;font-weight:bold;color:#0b1526;text-decoration:none;border-radius:6px;">Download the PDF</a></td></tr></table>' +
    p(esc(lines.link), 'font-size:15px;line-height:22px;color:#4b5766;') +
    p(esc(lines.measure), 'font-size:15px;line-height:22px;color:#4b5766;margin:0;') +
    '</td></tr>' +
    '<tr><td style="padding:20px 28px 0;">' +
    '<p style="margin:0 0 8px;font-family:' + SANS + ';font-size:13px;line-height:20px;color:#4b5766;">' + esc(lines.why) + ' <a href="' + esc(unsub) + '" style="color:#4b5766;text-decoration:underline;">Remove my address</a>.</p>' +
    '<p style="margin:0;font-family:' + MONO + ';font-size:12px;line-height:18px;color:#87909c;">Citehound · <a href="mailto:' + esc(site.contactEmail) + '" style="color:#87909c;text-decoration:underline;">' + esc(site.contactEmail) + '</a></p>' +
    '</td></tr>' +
    '</table></td></tr></table></body></html>';

  return {
    subject: SUBJECT, text: text, html: html, preheader: PREHEADER, downloadUrl: dl, removeUrl: unsub, expiresOn: dateOf(now + R.LINK_SECONDS * 1000),
    headers: { 'List-Unsubscribe': '<' + unsub + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
  };
}

// Hands the message to Resend. Returns { ok } or { ok: false, reason }. deps: { env, fetch, now, n (which request of the day this is, so a second request is not mistaken for a retry) }.
async function send(email, opts, deps) {
  deps = deps || {};
  const env = deps.env || process.env;
  if (!Mail.configured(env)) return { ok: false, reason: 'not_configured' };
  const msg = compose(email, Object.assign({ now: deps.now }, opts || {}));
  const doFetch = deps.fetch || fetch;
  try {
    const res = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': 'readiness-' + R.idOf(email) + '-' + new Date().toISOString().slice(0, 10) + '-' + (deps.n || 1) },
      body: JSON.stringify({ from: env.PRO_MAIL_FROM, to: [R.normalizeEmail(email)], reply_to: site.contactEmail, subject: msg.subject, text: msg.text, html: msg.html, headers: msg.headers })
    });
    if (!res.ok) return { ok: false, reason: 'provider_error', status: res.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'provider_unreachable' };
  }
}

module.exports = { compose: compose, send: send, downloadUrl: downloadUrl, removeUrl: removeUrl, SUBJECT: SUBJECT, PREHEADER: PREHEADER };
