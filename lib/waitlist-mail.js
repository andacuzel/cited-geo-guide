/* =====================================================================
   lib/waitlist-mail.js: the one confirmation email a waitlist signup gets.

   600px, table-based, inline CSS, with a preheader and a plain-text version, so it renders in Gmail, Apple Mail
   and Outlook. Brand: navy #0b1526 header band with the hound mark, gold #e7c77c rule and button, cream #fbf8ef
   panel, hairline #dfe3ea, Georgia for display (Gloock is not loaded: an email that fetches a web font is a request
   to a third party), a system sans for text and a monospace for labels.

   No tracking pixel, no open or click tracking, no redirect, no parameter on any link. The only image is the hound
   mark, served from this site (/assets/email/hound-mark.png). Every claim below is read from the code that makes
   it true (check count, pillar count, crawler count), or names a page that exists (scripts/test-waitlist.js checks).

   The "Remove me from the list" link and the List-Unsubscribe headers carry the signed removal token
   (lib/waitlist.js); a mail client's one-click unsubscribe POSTs to the same address.
   ===================================================================== */

'use strict';

const site = require('./site-config.js');
const Waitlist = require('./waitlist.js');
const Mail = require('./pro-mail.js');

const SUBJECT = 'You’re on the Citehound Pro waitlist';
const PREHEADER = 'Thanks for joining. While you wait, here is what you can use for free today.';

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// What the free version has, as numbers the code can vouch for.
function facts() {
  const methodology = require('./methodology.js');
  const scanner = require('./scanner.js');
  return { checks: methodology.registry().length, pillars: methodology.PILLARS.length, crawlers: scanner.BOTS.length };
}

function removeUrl(token) { return site.baseUrl + '/waitlist/remove/' + token; }

function items() {
  const f = facts();
  const u = (p) => site.baseUrl + p;
  return [
    { name: 'The free scanner', url: u('/'), text: 'A score out of 100 from ' + f.checks + ' checks across ' + f.pillars + ' pillars, with the access state of ' + f.crawlers + ' AI crawlers. No signup.' },
    { name: 'Copy-paste fixes and generators', url: u('/tools'), text: 'Every failed check comes with the fix. Generators write schema markup and a robots.txt file, and a checker reads your llms.txt.' },
    { name: 'The MCP server', url: u('/mcp'), text: 'Connect Citehound to an MCP-compatible assistant and run the scan and the generators from the conversation.' },
    { name: 'Research and benchmarks', url: u('/research'), text: 'Studies on crawler access and llms.txt adoption, and score benchmarks by category.', url2: u('/benchmarks') },
    { name: 'A sample report', url: u('/sample-report'), text: 'A real report on our own site, as recorded. This is what Pro will deliver for yours.' }
  ];
}

const MEASURE = 'The free score measures AI readiness: crawler access and on-page signals. It does not measure whether any assistant mentions you.';

function compose(email, name) {
  const token = Waitlist.tokenFor(email);
  const unsub = removeUrl(token);
  const home = site.baseUrl + '/';
  const list = items();
  const first = String(name || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().split(/\s+/)[0] || '';
  const hello = first ? 'Hello ' + first + ',' : 'Hello,';

  const text = [
    SUBJECT, '',
    hello, '',
    'Thanks for joining the Citehound Pro waitlist. We will write to you once, when Pro opens. We use this address for nothing else.', '',
    'While you wait, the free version is open and needs no signup. Here is what is in it:', '',
    list.map((i) => '* ' + i.name + ': ' + i.text + '\n  ' + i.url + (i.url2 ? '\n  ' + i.url2 : '')).join('\n'), '',
    MEASURE, '',
    'Open the free scanner: ' + home, '',
    '--',
    'You are getting this once because this address was entered on ' + site.host + '. Not you, or changed your mind? Remove me from the list: ' + unsub,
    'Questions: ' + site.contactEmail,
    'Citehound'
  ].join('\n');

  const SANS = '-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif';
  const SERIF = 'Georgia,\'Times New Roman\',serif';
  const MONO = 'Menlo,Consolas,\'Courier New\',monospace';
  const itemsHtml = list.map(function (i) {
    return '<tr><td style="padding:14px 0;border-top:1px solid #dfe3ea;">' +
      '<p style="margin:0 0 4px;font-family:' + SERIF + ';font-size:18px;line-height:24px;color:#0b1526;"><a href="' + esc(i.url) + '" style="color:#0b1526;text-decoration:underline;">' + esc(i.name) + '</a></p>' +
      '<p style="margin:0;font-family:' + SANS + ';font-size:15px;line-height:22px;color:#4b5766;">' + esc(i.text) + (i.url2 ? ' <a href="' + esc(i.url2) + '" style="color:#4b5766;text-decoration:underline;">See the benchmarks</a>.' : '') + '</p>' +
      '</td></tr>';
  }).join('');

  const html = '<!doctype html>\n<html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">' +
    '<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">' +
    '<title>' + esc(SUBJECT) + '</title></head>' +
    '<body style="margin:0;padding:0;background:#eef1f5;">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#eef1f5;font-size:1px;line-height:1px;">' + esc(PREHEADER) + '&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef1f5" style="background:#eef1f5;"><tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">' +
    // header band
    '<tr><td bgcolor="#0b1526" style="background:#0b1526;padding:22px 28px;border-radius:10px 10px 0 0;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td width="44" valign="middle" style="padding-right:12px;"><img src="' + esc(site.baseUrl) + '/assets/email/hound-mark.png" width="44" height="44" alt="" style="display:block;border:0;width:44px;height:44px;"></td>' +
    '<td valign="middle" style="font-family:' + SERIF + ';font-size:26px;line-height:30px;color:#ffffff;">Citehound</td>' +
    '</tr></table></td></tr>' +
    '<tr><td bgcolor="#e7c77c" height="4" style="background:#e7c77c;height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>' +
    // panel
    '<tr><td bgcolor="#fbf8ef" style="background:#fbf8ef;padding:32px 28px 28px;border:1px solid #dfe3ea;border-top:0;border-radius:0 0 10px 10px;">' +
    '<p style="margin:0 0 10px;font-family:' + MONO + ';font-size:12px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:#97701f;">Citehound Pro</p>' +
    '<h1 style="margin:0 0 16px;font-family:' + SERIF + ';font-weight:normal;font-size:30px;line-height:36px;color:#0b1526;">You’re on the waitlist.</h1>' +
    '<p style="margin:0 0 14px;font-family:' + SANS + ';font-size:16px;line-height:24px;color:#14202e;">' + esc(hello) + '</p>' +
    '<p style="margin:0 0 14px;font-family:' + SANS + ';font-size:16px;line-height:24px;color:#14202e;">Thanks for joining the Citehound Pro waitlist. We will write to you once, when Pro opens. We use this address for nothing else.</p>' +
    '<p style="margin:0 0 6px;font-family:' + SANS + ';font-size:16px;line-height:24px;color:#14202e;">While you wait, the free version is open and needs no signup. Here is what is in it:</p>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 18px;">' + itemsHtml + '<tr><td style="border-top:1px solid #dfe3ea;font-size:0;line-height:0;">&nbsp;</td></tr></table>' +
    '<p style="margin:0 0 22px;font-family:' + SANS + ';font-size:15px;line-height:22px;color:#4b5766;">' + esc(MEASURE) + '</p>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#e7c77c" style="background:#e7c77c;border-radius:6px;"><a href="' + esc(home) + '" style="display:inline-block;padding:13px 24px;font-family:' + SANS + ';font-size:16px;line-height:20px;font-weight:bold;color:#0b1526;text-decoration:none;border-radius:6px;">Open the free scanner</a></td></tr></table>' +
    '</td></tr>' +
    // footer
    '<tr><td style="padding:20px 28px 0;">' +
    '<p style="margin:0 0 8px;font-family:' + SANS + ';font-size:13px;line-height:20px;color:#4b5766;">You are getting this once because this address was entered on ' + esc(site.host) + '. Not you, or changed your mind? <a href="' + esc(unsub) + '" style="color:#4b5766;text-decoration:underline;">Remove me from the list</a>.</p>' +
    '<p style="margin:0;font-family:' + MONO + ';font-size:12px;line-height:18px;color:#87909c;">Citehound · <a href="mailto:' + esc(site.contactEmail) + '" style="color:#87909c;text-decoration:underline;">' + esc(site.contactEmail) + '</a></p>' +
    '</td></tr>' +
    '</table></td></tr></table></body></html>';

  return {
    subject: SUBJECT, text: text, html: html, preheader: PREHEADER, removeUrl: unsub,
    headers: { 'List-Unsubscribe': '<' + unsub + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
  };
}

// Hands the message to Resend. Returns { ok } or { ok: false, reason }. deps: { env, fetch } for tests.
async function send(email, name, id, deps) {
  deps = deps || {};
  const env = deps.env || process.env;
  if (!Mail.configured(env)) return { ok: false, reason: 'not_configured' };
  const msg = compose(email, name);
  const doFetch = deps.fetch || fetch;
  try {
    const res = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': 'waitlist-' + id + '-' + new Date().toISOString().slice(0, 10) },
      body: JSON.stringify({ from: env.PRO_MAIL_FROM, to: [email], reply_to: site.contactEmail, subject: msg.subject, text: msg.text, html: msg.html, headers: msg.headers })
    });
    if (!res.ok) return { ok: false, reason: 'provider_error', status: res.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'provider_unreachable' };
  }
}

module.exports = { compose: compose, send: send, items: items, facts: facts, removeUrl: removeUrl, SUBJECT: SUBJECT, PREHEADER: PREHEADER, MEASURE: MEASURE };
