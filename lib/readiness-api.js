/* =====================================================================
   lib/readiness-api.js: the State of AI Readiness report: signup, signed download, removal. Mounted into lib/pro-api.js's routes, so it is the
   same function (api/pro.js) and the same rules: the fail-closed secret check, the storage error handling, hashed-address rate limits, no logging of
   anything personal. Its list is separate from the Pro waitlist (lib/readiness.js).

     GET  /api/readiness              { available }: whether a PDF is stored and the report is switched on (the form hides itself when not)
     POST /api/readiness              { email, sendReport: true, updates?: boolean, company_fax? (honeypot) }
     GET  /readiness/download/<t>     the PDF, for a signed, unexpired token whose record still exists (noindex, no referrer, no store)
     GET  /readiness/remove/<t>       a page with one button (a mail scanner that opens links must not remove anyone)
     POST /readiness/remove/<t>       removes the address the signed token names (also the mail client's one-click POST)

   A signup answers the same words for a new address, a known one, a throttled mail and a filled honeypot. The PDF is read from the
   database only, never from a file.
   ===================================================================== */

'use strict';

const R = require('./readiness.js');
const RMail = require('./readiness-mail.js');
const Stats = require('./pro-stats.js');
const site = require('./site-config.js');
const content = require('../content/readiness.json');

const SENT = 'Thank you. If the address can receive mail, the report is on its way. It can take a few minutes, and it may land in spam.';
const TEASER = '/research/state-of-ai-readiness';

function make(ctx) {
  const H = ctx.H;
  const page = () => require('./pro-report-page.js');
  const card = (kicker, title, lead, extra) => page().card('<p class="ps-kicker">' + kicker + '</p><h1 class="ps-title">' + title + '</h1><p class="ps-lead">' + lead + '</p>' + (extra || ''));

  async function signup(req, res, deps) {
    const env = (deps && deps.env) || process.env;
    const store = ctx.storeOf(deps);
    const A = store.adapter;
    if (req.method === 'GET' || req.method === 'HEAD') {
      return H.sendJson(res, 200, { available: await R.available(A) }, { 'Cache-Control': 'public, max-age=60, s-maxage=60' });
    }
    if (req.method !== 'POST') return H.sendJson(res, 405, { error: 'method_not_allowed', message: 'Use GET or POST.' }, { Allow: 'GET, POST' });
    if (!ctx.originOk(req)) return H.sendJson(res, 403, { error: 'forbidden', message: 'This form can only be used from ' + site.host + '.' });
    if (await ctx.limited(store, req, 'readiness')) return H.sendJson(res, 429, { error: 'rate_limited', message: ctx.MSG.limited }, { 'Retry-After': '3600' });
    const body = await H.readBody(req, 2048);
    if (!body.ok || !body.json || typeof body.json !== 'object' || Array.isArray(body.json)) return H.sendJson(res, 400, { error: 'bad_request', message: 'The form could not be read.' });
    const b = body.json;
    // A bot that fills the hidden field gets the same answer and nothing is stored.
    if (typeof b.company_fax === 'string' && b.company_fax.trim() !== '') return H.sendJson(res, 200, { ok: true, message: SENT });
    const fields = {};
    if (!ctx.validEmail(b.email)) fields.email = 'Enter a valid email address.';
    if (b.sendReport !== true) fields.sendReport = 'Tick the box to get the report.';
    if (b.updates !== undefined && b.updates !== null && typeof b.updates !== 'boolean') fields.updates = 'Tick or leave the box empty.';
    if (Object.keys(fields).length) return H.sendJson(res, 400, { error: 'invalid', fields: fields, message: 'Check the highlighted fields.' });
    // Nothing to send, or the owner switched the report off: say so, store nothing.
    if (!(await R.available(A))) return H.sendJson(res, 503, { error: 'unavailable', message: 'The report is not available right now. Try again later.' }, { 'Retry-After': '3600' });
    // The strict limit counts accepted signups only (6 an hour per network).
    if (await ctx.limited(store, req, 'readinessjoin')) return H.sendJson(res, 429, { error: 'rate_limited', message: ctx.MSG.limited }, { 'Retry-After': '3600' });

    const email = R.normalizeEmail(b.email);
    const updates = b.updates === true;
    const joined = await R.join(A, { email: email, updates: updates }, deps && deps.now);
    await Stats.count(store, 'readiness_signups', 1, deps && deps.now);
    if (updates && joined.isNew) await Stats.count(store, 'readiness_updates_optin', 1, deps && deps.now);
    // The email. Any refusal (not configured, a limit, the provider) leaves the signup standing and the answer unchanged.
    try {
      const slot = await R.reserveMail(A, joined.id, env, deps && deps.now);
      if (slot.ok) {
        const sent = await RMail.send(email, { updates: updates }, { env: env, fetch: deps && deps.fetch, now: deps && deps.now, sleep: deps && deps.sleep, n: slot.n });
        if (sent.ok) await Stats.count(store, 'readiness_emails', 1, deps && deps.now);
        else { await slot.release(); if (sent.reason === 'provider_error' || sent.reason === 'provider_unreachable') await Stats.count(store, 'mail_failed', 1, deps && deps.now); }
      } else if (slot.reason === 'cap' || slot.reason === 'address_limit') await Stats.count(store, 'readiness_throttled', 1, deps && deps.now);
    } catch (e) { console.error('[readiness] the report email step failed: ' + (e && e.name ? e.name : 'Error')); }
    return H.sendJson(res, 200, { ok: true, message: SENT });
  }

  /* ---------- the download ---------- */

  async function download(req, res, deps) {
    const store = ctx.storeOf(deps);
    const P = page();
    if (await ctx.limited(store, req, 'readinessdl')) return H.sendHtml(res, 429, P.errorPage(ctx.MSG.limited, 429), { 'Retry-After': '60' });
    const A = store.adapter;
    const t = R.readDownloadToken(String(H.queryOf(req).token || ''), deps && deps.now);
    const back = '<p class="ps-note"><a href="' + TEASER + '">Ask for a new link</a></p>';
    if (!t) return H.sendHtml(res, 404, P.shell('Citehound: link not valid', 'ps-body', card('State of AI Readiness', 'This link is not valid', 'The link may be wrong, or the address behind it may have been removed. You can ask for the report again.', back)));
    if (t.expired) return H.sendHtml(res, 410, P.shell('Citehound: link expired', 'ps-body', card('State of AI Readiness', 'This link has expired', 'Download links work for 30 days. You can ask for a new one.', back)));
    // A removed address revokes its links.
    if (!(await R.exists(A, t.id))) return H.sendHtml(res, 404, P.shell('Citehound: link not valid', 'ps-body', card('State of AI Readiness', 'This link is not valid', 'The link may be wrong, or the address behind it may have been removed. You can ask for the report again.', back)));
    if (await R.isOff(A)) return H.sendHtml(res, 503, P.shell('Citehound: report not available', 'ps-body', card('State of AI Readiness', 'The report is not available right now', 'Try again later.', back)), { 'Retry-After': '3600' });
    const pdf = await R.getPdf(A);
    if (!pdf) return H.sendHtml(res, 503, P.shell('Citehound: report not available', 'ps-body', card('State of AI Readiness', 'The report is not available right now', 'Try again later.', back)), { 'Retry-After': '3600' });
    await Stats.count(store, 'readiness_downloads', 1, deps && deps.now);
    if (req.method === 'HEAD') { H.baseHeaders(res); res.statusCode = 200; res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Length', String(pdf.buffer.length)); return res.end(); }
    return H.sendFile(res, 200, pdf.buffer, 'application/pdf', content.downloadName);
  }

  /* ---------- removal ---------- */

  const removePage = (token) => page().card(
    '<p class="ps-kicker">State of AI Readiness</p><h1 class="ps-title">Remove my address</h1>' +
    '<p class="ps-lead">Press the button and your address is deleted from the report list, together with your choice about updates. Download links sent to it stop working. We will not write to you again.</p>' +
    '<form method="post" action="/readiness/remove/' + token + '" class="ps-actions"><button type="submit" class="btn btn--primary">Remove my address</button></form>');

  async function readinessremove(req, res, deps) {
    const store = ctx.storeOf(deps);
    if (await ctx.limited(store, req, 'readinessremove')) return H.sendHtml(res, 429, page().errorPage(ctx.MSG.limited, 429), { 'Retry-After': '60' });
    const token = String(H.queryOf(req).token || '').trim().toLowerCase();
    const id = R.idFromRemoveToken(token);
    const P = page();
    if (!id) return H.sendHtml(res, 404, P.shell('Citehound: link not valid', 'ps-body', P.card('<p class="ps-kicker">State of AI Readiness</p><h1 class="ps-title">This link is not valid</h1><p class="ps-lead">If you want your address removed, write to <a href="mailto:' + site.contactEmail + '">' + site.contactEmail + '</a>.</p>')));
    if (req.method === 'GET' || req.method === 'HEAD') return H.sendHtml(res, 200, P.shell('Citehound: remove my address', 'ps-body', removePage(token)));
    if (req.method !== 'POST') return H.sendJson(res, 405, { error: 'method_not_allowed', message: 'Use GET or POST.' }, { Allow: 'GET, POST' });
    const gone = await R.remove(store.adapter, token);
    if (gone) await Stats.count(store, 'readiness_removed', 1, deps && deps.now);
    return H.sendHtml(res, 200, P.shell('Citehound: removed', 'ps-body', P.card('<p class="ps-kicker">State of AI Readiness</p><h1 class="ps-title">Your address has been removed</h1><p class="ps-lead">It is deleted from the report list, together with your choice about updates. Links sent to it no longer work. We will not write to you again.</p><p class="ps-note"><a href="/">Back to Citehound</a></p>')));
  }

  return { readiness: ['*', signup], readinessget: ['GET', download], readinessremove: ['*', readinessremove] };
}

module.exports = { make: make, SENT: SENT, TEASER: TEASER };
