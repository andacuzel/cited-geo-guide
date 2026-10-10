/* =====================================================================
   lib/waitlist-api.js: the waitlist, its removal link, the public Pro config, and the report feedback form.
   Mounted into lib/pro-api.js's routes, so it is the same function (api/pro.js) and the same rules: the
   fail-closed secret check, the storage error handling, hashed-address rate limits, no logging of anything personal.

     GET  /api/waitlist           the public Pro switch: { checkoutUrl, priceText } from PRO_CHECKOUT_URL / PRO_PRICE_TEXT
     POST /api/waitlist           join: { email, name?, consent: true, company_fax? (honeypot) }
     GET  /waitlist/remove/<t>    a page with one button (a mail scanner that opens links must not remove anyone)
     POST /waitlist/remove/<t>    removes the address the signed token names (also the mail client's one-click POST)
     POST /api/pro/feedback       { id, rating 1-5, text?, company_fax? } for a finished report

   A signup answers the same words for a new address, a known one, a throttled mail and a filled honeypot.
   ===================================================================== */

'use strict';

const Waitlist = require('./waitlist.js');
const WMail = require('./waitlist-mail.js');
const Stats = require('./pro-stats.js');
const site = require('./site-config.js');

const DAY = 86400;
const JOINED = 'You’re on the list. We will email you when Citehound Pro opens.';
const FEEDBACK_KEEP = 90 * DAY;

function allowedOrigin(req) {
  const o = (req.headers && req.headers.origin) || '';
  if (!o) return true;
  return o === site.baseUrl || o === 'https://www.' + site.host || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
}

// The public switch for the Pro buttons. Only an https address is accepted as a checkout address.
function publicConfig(env) {
  env = env || process.env;
  let checkoutUrl = null;
  try { const u = new URL(String(env.PRO_CHECKOUT_URL || '').trim()); if (u.protocol === 'https:') checkoutUrl = u.toString(); } catch (e) { /* not set, or not a URL */ }
  const price = String(env.PRO_PRICE_TEXT || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  return { checkoutUrl: checkoutUrl, priceText: price || null };
}

function make(ctx) {
  const H = ctx.H;
  const page = () => require('./pro-report-page.js');

  async function waitlist(req, res, deps) {
    const env = (deps && deps.env) || process.env;
    if (req.method === 'GET' || req.method === 'HEAD') {
      return H.sendJson(res, 200, publicConfig(env), { 'Cache-Control': 'public, max-age=300, s-maxage=300' });
    }
    if (req.method !== 'POST') return H.sendJson(res, 405, { error: 'method_not_allowed', message: 'Use POST.' }, { Allow: 'GET, POST' });
    if (!allowedOrigin(req)) return H.sendJson(res, 403, { error: 'forbidden', message: 'This form can only be used from ' + site.host + '.' });
    const store = ctx.storeOf(deps);
    if (await ctx.limited(store, req, 'waitlist')) return H.sendJson(res, 429, { error: 'rate_limited', message: ctx.MSG.limited }, { 'Retry-After': '3600' });
    const body = await H.readBody(req, 2048);
    if (!body.ok || !body.json || typeof body.json !== 'object' || Array.isArray(body.json)) return H.sendJson(res, 400, { error: 'bad_request', message: 'The form could not be read.' });
    const b = body.json;
    // The honeypot is a field people cannot see. A bot that fills it gets the same answer and nothing is stored.
    if (typeof b.company_fax === 'string' && b.company_fax.trim() !== '') return H.sendJson(res, 200, { ok: true, message: JOINED });
    const fields = {};
    if (!ctx.validEmail(b.email)) fields.email = 'Enter a valid email address.';
    if (b.consent !== true) fields.consent = 'Tick the box to join the list.';
    if (b.name !== undefined && b.name !== null && b.name !== '' && (typeof b.name !== 'string' || b.name.length > 80)) fields.name = 'Keep the name under 80 characters.';
    if (Object.keys(fields).length) return H.sendJson(res, 400, { error: 'invalid', fields: fields, message: 'Check the highlighted fields.' });
    // The strict limit counts accepted signups only (6 an hour per network).
    if (await ctx.limited(store, req, 'waitlistjoin')) return H.sendJson(res, 429, { error: 'rate_limited', message: ctx.MSG.limited }, { 'Retry-After': '3600' });

    const A = store.adapter;
    const email = String(b.email).trim();
    const name = typeof b.name === 'string' ? b.name : '';
    const joined = await Waitlist.join(A, { email: email, name: name });
    await Stats.count(store, 'waitlist_signups');
    // The confirmation mail. Any refusal (not configured, cap, cooldown, provider) leaves the signup standing.
    try {
      const slot = await Waitlist.reserveMail(A, joined.id, env);
      if (slot.ok) {
        const sent = await WMail.send(Waitlist.normalizeEmail(email), name, joined.id, { env: env, fetch: deps && deps.fetch });
        if (sent.ok) await Stats.count(store, 'waitlist_emails'); else { await slot.release(); if (sent.reason === 'provider_error' || sent.reason === 'provider_unreachable') await Stats.count(store, 'mail_failed'); }
      }
    } catch (e) { console.error('[waitlist] the confirmation mail step failed: ' + (e && e.name ? e.name : 'Error')); }
    return H.sendJson(res, 200, { ok: true, message: JOINED });
  }

  /* ---------- removal ---------- */

  const removePage = (token) => page().card(
    '<p class="ps-kicker">Citehound Pro waitlist</p><h1 class="ps-title">Remove me from the list</h1>' +
    '<p class="ps-lead">Press the button and your address is deleted from the Citehound Pro waitlist. We will not write to you about Pro.</p>' +
    '<form method="post" action="/waitlist/remove/' + token + '" class="ps-actions"><button type="submit" class="btn btn--primary">Remove me from the list</button></form>');

  async function waitremove(req, res, deps) {
    const store = ctx.storeOf(deps);
    if (await ctx.limited(store, req, 'waitremove')) return H.sendHtml(res, 429, page().errorPage(ctx.MSG.limited), { 'Retry-After': '60' });
    const token = String(H.queryOf(req).token || '').trim().toLowerCase();
    const id = Waitlist.idFromToken(token);
    const P = page();
    if (!id) return H.sendHtml(res, 404, P.shell('Citehound: link not valid', 'ps-body', P.card('<p class="ps-kicker">Citehound Pro waitlist</p><h1 class="ps-title">This link is not valid</h1><p class="ps-lead">If you want to be removed from the list, write to <a href="mailto:' + site.contactEmail + '">' + site.contactEmail + '</a>.</p>')));
    if (req.method === 'GET' || req.method === 'HEAD') return H.sendHtml(res, 200, P.shell('Citehound: remove me from the list', 'ps-body', removePage(token)));
    if (req.method !== 'POST') return H.sendJson(res, 405, { error: 'method_not_allowed', message: 'Use GET or POST.' }, { Allow: 'GET, POST' });
    const gone = await Waitlist.remove(store.adapter, token);
    if (gone) await Stats.count(store, 'waitlist_removed');
    return H.sendHtml(res, 200, P.shell('Citehound: removed', 'ps-body', P.card('<p class="ps-kicker">Citehound Pro waitlist</p><h1 class="ps-title">You have been removed</h1><p class="ps-lead">Your address is deleted from the Citehound Pro waitlist. We will not write to you about Pro.</p><p class="ps-note"><a href="/">Back to Citehound</a></p>')));
  }

  /* ---------- feedback on a finished report ---------- */

  async function feedback(req, res, deps) {
    const store = ctx.storeOf(deps);
    if (await ctx.limited(store, req, 'feedback')) return H.sendJson(res, 429, { error: 'rate_limited', message: ctx.MSG.limited }, { 'Retry-After': '3600' });
    const body = await H.readBody(req, 4096);
    if (!body.ok || !body.json || typeof body.json !== 'object' || Array.isArray(body.json)) return H.sendJson(res, 400, { error: 'bad_request', message: 'The form could not be read.' });
    const b = body.json;
    if (typeof b.company_fax === 'string' && b.company_fax.trim() !== '') return H.sendJson(res, 200, { ok: true, message: 'Thank you.' });
    const id = String(b.id || '').trim().toLowerCase();
    if (!ctx.HEX32.test(id)) return H.sendJson(res, 404, { error: 'unavailable', message: ctx.MSG.generic });
    const rating = typeof b.rating === 'number' ? b.rating : parseInt(b.rating, 10);
    if (!(rating >= 1 && rating <= 5) || Math.floor(rating) !== rating) return H.sendJson(res, 400, { error: 'invalid', fields: { rating: 'Choose a number from 1 to 5.' }, message: 'Choose a number from 1 to 5.' });
    let text = b.text === undefined || b.text === null ? '' : b.text;
    if (typeof text !== 'string') return H.sendJson(res, 400, { error: 'invalid', fields: { text: 'Write text only.' }, message: 'Write text only.' });
    text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim();
    if (text.length > 1000) return H.sendJson(res, 400, { error: 'invalid', fields: { text: 'Keep it under 1000 characters.' }, message: 'Keep it under 1000 characters.' });
    const job = await store.getJob(id);
    if (!job || (job.status !== 'done' && job.status !== 'partial')) return H.sendJson(res, 404, { error: 'unavailable', message: ctx.MSG.generic });
    const A = store.adapter;
    const key = 'pro:feedback:' + id;
    // One answer per report; a second submission gets the same thanks and changes nothing.
    if (await A.hsetnx(key, 'rating', String(rating))) {
      await A.hset(key, { text: text, createdAt: new Date().toISOString() });
      await A.expire(key, FEEDBACK_KEEP);
      await A.sadd('pro:feedback-index', id);
      await A.expire('pro:feedback-index', FEEDBACK_KEEP + 10 * DAY);
      await Stats.count(store, 'feedback');
    }
    return H.sendJson(res, 200, { ok: true, message: 'Thank you.' });
  }

  return { waitlist: ['*', waitlist], waitremove: ['*', waitremove], feedback: ['POST', feedback] };
}

module.exports = { make: make, publicConfig: publicConfig, JOINED: JOINED, FEEDBACK_KEEP: FEEDBACK_KEEP };
