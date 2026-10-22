/* =====================================================================
   lib/api-v1/alerts.js: the alert email of monitoring (Pro keys). Transactional: it says what changed on a domain you watch, links the docs and carries a one-click unsubscribe for that domain.

   Who gets it: a key that has an alert address (api:ae:<keyid>, given with POST /v1/watchlist and checked against the key's own address hash) and whose entry for the domain has alerts on.
   Which events: score_dropped, crawler_blocked and llms_txt_removed. At most one email per key and domain per UTC day (api:am:<keyid>:<hash of the domain>:<day>, expires in two days): the events of a run are
   put in one message and a later run the same day sends nothing.
   Unsubscribe: /v1/watchlist/unsubscribe/<keyid>/<domain>/<signature>, signed with the pepper; GET shows one button, POST turns alerts off for that domain (also what a mail client's one-click
   List-Unsubscribe does). Mail goes through lib/api-v1/mail.js (Resend); nothing here logs an address.
   ===================================================================== */

'use strict';

const crypto = require('crypto');
const site = require('../site-config.js');
const Monitor = require('./monitor.js');
const Mail = require('./mail.js');
const Keys = require('./keys.js');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The once-a-day marker holds a short hash of the domain, not the domain.
const capKey = (keyid, domain, day) => 'api:am:' + keyid + ':' + crypto.createHash('sha256').update(domain).digest('hex').slice(0, 12) + ':' + day;
const unsubSig = (p, keyid, domain) => crypto.createHmac('sha256', p).update('unsub|' + keyid + '|' + domain).digest('hex').slice(0, 32);
const unsubUrl = (p, keyid, domain) => site.baseUrl + '/v1/watchlist/unsubscribe/' + keyid + '/' + domain + '/' + unsubSig(p, keyid, domain);
const unsubValid = (p, keyid, domain, sig) => /^[0-9a-f]{20}$/.test(keyid) && /^[0-9a-f]{32}$/.test(sig) && Keys.safeEq(unsubSig(p, keyid, domain), sig);

function compose(domain, evs, url) {
  const lines = evs.map((e) => '- ' + e.summary);
  const subject = 'Citehound: a change on ' + domain;
  const text = ['Citehound re-scanned ' + domain + ', which is on your watchlist, and found:', ''].concat(lines, ['', 'The score is a readiness score: crawler access and on-page signals. It does not measure whether any assistant names a brand.',
    'History and events: ' + site.baseUrl + '/api', '', 'You get at most one of these a day for this domain. Stop them for this domain with one click: ' + url, '', 'Questions: ' + site.contactEmail, 'Citehound']).join('\n');
  const html = '<!doctype html><html><body style="margin:0;padding:24px;background:#EEF1F5;font-family:Arial,Helvetica,sans-serif;color:#14202E;"><div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #D9DEE6;border-radius:10px;padding:28px;">' +
    '<p style="margin:0 0 20px;font-size:20px;font-weight:700;color:#0B1526;">Citehound</p>' +
    '<p style="margin:0 0 14px;font-size:16px;line-height:1.5;">Citehound re-scanned <strong>' + esc(domain) + '</strong>, which is on your watchlist, and found:</p>' +
    '<ul style="margin:0 0 14px;padding-left:20px;font-size:15px;line-height:1.6;">' + evs.map((e) => '<li>' + esc(e.summary) + '</li>').join('') + '</ul>' +
    '<p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#4B5766;">The score is a readiness score: crawler access and on-page signals. It does not measure whether any assistant names a brand.</p>' +
    '<p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#4B5766;">You get at most one of these a day for this domain. <a href="' + esc(url) + '" style="color:#14202E;">Stop them for this domain</a>.</p>' +
    '<p style="margin:0;font-size:14px;line-height:1.5;color:#4B5766;">Questions: <a href="mailto:' + esc(site.contactEmail) + '" style="color:#14202E;">' + esc(site.contactEmail) + '</a></p></div></body></html>';
  return { subject: subject, text: text, html: html, headers: { 'List-Unsubscribe': '<' + url + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
}

// Sends the alerts for the events of one scan. -> the number of emails sent.
async function send(ctx, domain, evs) {
  const relevant = evs.filter((e) => Monitor.ALERT_TYPES.indexOf(e.type) !== -1);
  if (!relevant.length || !Mail.configured(ctx.deps.env)) return 0;
  const day = new Date(ctx.clock()).toISOString().slice(0, 10); let sent = 0;
  for (const keyid of await Monitor.validWatchers(ctx.A, domain)) {
    const entry = (await Monitor.entries(ctx.A, keyid))[domain];
    const ae = await ctx.A.hgetall(Monitor.keys.ae(keyid));
    if (!entry || entry.alerts === false || !ae || !ae.email) continue;
    if (!(await ctx.A.set(capKey(keyid, domain, day), '1', { nx: true, ex: 2 * 86400 }))) continue;
    const r = await Mail.send(ae.email, compose(domain, relevant, unsubUrl(ctx.p, keyid, domain)), { env: ctx.deps.env, fetch: ctx.deps.fetch });
    if (r.ok) sent++; else await ctx.A.del(capKey(keyid, domain, day));
  }
  return sent;
}

module.exports = { capKey, compose, send, unsubUrl, unsubSig, unsubValid };
