/* =====================================================================
   lib/pro-api.js: the Citehound Pro endpoints, one function per action.

   Vercel's Hobby plan allows 12 functions and the site already uses 10, so every
   Pro action lives behind the single function api/pro.js, which dispatches on
   ?a=. vercel.json rewrites the readable paths onto it:

     /api/pro/start    POST   start a report from an order token
     /api/pro/order    GET    what a start link means right now (ready, started, unavailable)
     /api/pro/step     POST   do one unit of crawl work for a job
     /api/pro/status   GET    progress of a job
     /api/pro/email    POST   email the report link to the address on the order
     /pro/start/<token> GET   the start page; a link already used goes on to its own report (302)
     /r/<id>/          GET    the report page (HTML)

   Rules that hold for every action:
     - responses are no-store, noindex and no-referrer
     - callers are told apart only by a keyed hash of their address (lib/pro-http.js)
     - nothing that identifies a person is logged: not the token, the email, the name or the address
     - an unknown, expired or malformed token or id gets the same generic answer
   ===================================================================== */

'use strict';

const H = require('./pro-http.js');
const S = require('./pro-store.js');
const Fetch = require('./pro-fetch.js');
const Crawler = require('./pro-crawler.js');
const Mail = require('./pro-mail.js');
const fs = require('fs');
const path = require('path');

const HOUR = 3600;
const LIMITS = {
  start: { max: 10, window: HOUR },
  order: { max: 60, window: HOUR },
  step: { max: 900, window: HOUR },
  status: { max: 2400, window: HOUR },
  report: { max: 400, window: HOUR },
  email: { max: 10, window: HOUR }
};
const MAX_CONCURRENT_PER_DOMAIN = 2;
const MAX_EMAILS_PER_ORDER = 3;
const HEX32 = S.HEX32;

const MSG = {
  generic: 'This link is not available.',
  limited: 'Too many requests from your network. Try again in a little while.',
  storage: 'Report storage is not available right now. Try again in a few minutes.',
  site: 'Enter the address of a public website, such as example.com.',
  siteNotPublic: 'That address is not a public website, so it cannot be scanned.',
  siteNotFound: 'We could not find that site. Check the spelling and try again.',
  name: 'Enter your name.',
  email: 'Enter a valid email address.',
  consent: 'Tick the box to continue.',
  busy: 'Two reports for this site are already running. Try again in a few minutes.'
};

const EMAIL_RE = /^[^\s@<>"',;:()\[\]\\]{1,64}@[^\s@<>"',;:()\[\]\\]+\.[A-Za-z]{2,}$/;

function validName(v) { return typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 100 && !/[\u0000-\u001f\u007f]/.test(v); }
function validEmail(v) { return typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v.trim()) && v.indexOf('..') === -1 && !/^\.|\.@|@\./.test(v.trim()); }

// The single store for this process (or the one a test hands in).
function storeOf(deps) { return (deps && deps.store) || S.getStore(); }

async function limited(store, req, action) {
  const l = LIMITS[action];
  const n = await store.hit(action + ':' + H.callerKey(req), l.window);
  return n > l.max;
}

function viewOf(job) {
  return {
    status: job.status,
    phase: job.phase,
    domain: job.domain,
    progress: job.progress,
    reason: job.reason || null,
    expiresAt: job.expiresAt,
    reportPath: (job.status === 'done' || job.status === 'partial') ? '/r/' + job.id + '/' : null
  };
}

/* ---------------- start ---------------- */

async function start(req, res, deps) {
  const store = storeOf(deps);
  if (await limited(store, req, 'start')) return H.sendJson(res, 429, { error: 'rate_limited', message: MSG.limited }, { 'Retry-After': String(HOUR) });
  const body = await H.readBody(req, 4096);
  if (!body.ok || !body.json || typeof body.json !== 'object') return H.sendJson(res, 400, { error: 'bad_request', message: 'The request could not be read.' });
  const b = body.json;

  const token = typeof b.token === 'string' ? b.token.trim().toLowerCase() : '';
  const order = HEX32.test(token) ? await store.getOrder(token) : null;
  if (!order || order.status !== 'unused') {
    // A double submit: the same token's own first request has probably just won. Answer with that job.
    if (order && order.status === 'used' && order.jobId) return H.sendJson(res, 200, { jobId: order.jobId, reportPath: '/r/' + order.jobId + '/', duplicate: true });
    return H.sendJson(res, 404, { error: 'unavailable', message: MSG.generic });
  }

  // Check every field before anything is consumed, so a typo does not spend the link.
  const fields = {};
  const site = Fetch.parseSiteInput(b.site);
  if (!site.ok) fields.site = MSG.site;
  if (!validName(b.name)) fields.name = MSG.name;
  if (!validEmail(b.email)) fields.email = MSG.email;
  if (b.consent !== true) fields.consent = MSG.consent;
  if (!Object.keys(fields).length) {
    const checkHost = (deps && deps.checkHost) || Fetch.checkHost;
    let host = await checkHost(site.domain);
    if (!host.ok && host.kind === 'dns') host = await checkHost('www.' + site.domain);
    if (!host.ok) fields.site = host.kind === 'blocked_host' ? MSG.siteNotPublic : MSG.siteNotFound;
  }
  if (Object.keys(fields).length) return H.sendJson(res, 400, { error: 'invalid', fields: fields });

  const domain = site.domain;
  // The claim comes first: of several submits of one token (a double click), exactly one goes on, and the rest
  // wait for its job instead of competing for a domain slot.
  let claimed = false; let slot = false; let jobId = null;
  try {
    claimed = await store.claimOrder(token);
    if (!claimed) {
      // Lost the race. If the winner has finished, hand back its job (it is this token's own).
      for (let i = 0; i < 8; i++) {
        const again = await store.getOrder(token);
        if (again && again.status === 'used' && again.jobId) return H.sendJson(res, 200, { jobId: again.jobId, reportPath: '/r/' + again.jobId + '/', duplicate: true });
        await new Promise(function (r) { setTimeout(r, (deps && deps.pollMs) || 250); });
      }
      return H.sendJson(res, 409, { error: 'in_progress', message: 'This link is being used right now. Reload in a moment.' });
    }
    slot = await store.reserveDomainSlot(domain, MAX_CONCURRENT_PER_DOMAIN);
    if (!slot) {
      await store.releaseClaim(token);
      return H.sendJson(res, 429, { error: 'busy', message: MSG.busy }, { 'Retry-After': '300' });
    }
    jobId = await store.createJob({ domain: domain });
    await store.markOrderUsed(token, { jobId: jobId, contact: { name: b.name.trim(), email: b.email.trim() } });
    return H.sendJson(res, 200, { jobId: jobId, reportPath: '/r/' + jobId + '/' });
  } catch (e) {
    if (claimed && !jobId) await store.releaseClaim(token).catch(function () {});
    if (slot) await store.releaseDomainSlot(domain).catch(function () {});
    throw e;
  }
}

/* ---------------- order ---------------- */

async function order(req, res, deps) {
  const store = storeOf(deps);
  if (await limited(store, req, 'order')) return H.sendJson(res, 429, { error: 'rate_limited', message: MSG.limited }, { 'Retry-After': String(HOUR) });
  const token = String(H.queryOf(req).token || '').trim().toLowerCase();
  const o = HEX32.test(token) ? await store.getOrder(token) : null;
  if (o && o.status === 'unused') return H.sendJson(res, 200, { state: 'ready' });
  if (o && o.status === 'used' && o.jobId) return H.sendJson(res, 200, { state: 'started', reportPath: '/r/' + o.jobId + '/' });
  return H.sendJson(res, 404, { state: 'unavailable', message: MSG.generic });
}

/* ---------------- step and status ---------------- */

async function step(req, res, deps) {
  const store = storeOf(deps);
  if (await limited(store, req, 'step')) return H.sendJson(res, 429, { error: 'rate_limited', message: MSG.limited }, { 'Retry-After': '60' });
  let id = String(H.queryOf(req).id || '');
  if (!id) { const b = await H.readBody(req, 1024); if (b.ok && b.json && typeof b.json.id === 'string') id = b.json.id; }
  id = id.trim().toLowerCase();
  if (!HEX32.test(id)) return H.sendJson(res, 404, { error: 'unavailable', message: MSG.generic });
  const r = await Crawler.runStep(store, id, (deps && deps.crawl) || {});
  if (r.notFound) return H.sendJson(res, 404, { error: 'unavailable', message: MSG.generic });
  const job = await store.getJob(id);
  return H.sendJson(res, 200, Object.assign(viewOf(job), { busy: !!r.busy }));
}

async function status(req, res, deps) {
  const store = storeOf(deps);
  if (await limited(store, req, 'status')) return H.sendJson(res, 429, { error: 'rate_limited', message: MSG.limited }, { 'Retry-After': '60' });
  const id = String(H.queryOf(req).id || '').trim().toLowerCase();
  const job = HEX32.test(id) ? await store.getJob(id) : null;
  if (!job) return H.sendJson(res, 404, { error: 'unavailable', message: MSG.generic });
  return H.sendJson(res, 200, viewOf(job));
}

/* ---------------- email ---------------- */

async function email(req, res, deps) {
  const store = storeOf(deps);
  if (await limited(store, req, 'email')) return H.sendJson(res, 429, { error: 'rate_limited', message: MSG.limited }, { 'Retry-After': String(HOUR) });
  const env = (deps && deps.env) || process.env;
  if (!Mail.configured(env)) return H.sendJson(res, 503, { error: 'not_configured', message: 'Email delivery is not set up.' });
  // The job id is the only input read. Any address in the request is ignored: the recipient comes from the order.
  const body = await H.readBody(req, 1024);
  const id = String((body.ok && body.json && body.json.id) || H.queryOf(req).id || '').trim().toLowerCase();
  if (!HEX32.test(id)) return H.sendJson(res, 404, { error: 'unavailable', message: MSG.generic });
  const job = await store.getJob(id);
  if (!job) return H.sendJson(res, 404, { error: 'unavailable', message: MSG.generic });
  if (job.status !== 'done' && job.status !== 'partial') return H.sendJson(res, 409, { error: 'not_ready', message: 'The report is not finished yet.' });
  const ord = await store.orderForJob(id);
  if (!ord || !ord.contact) return H.sendJson(res, 404, { error: 'unavailable', message: MSG.generic });

  const n = await store.bumpEmailSends(ord.token);
  if (n > MAX_EMAILS_PER_ORDER) {
    await store.adapter.hincrby('pro:order:' + ord.token, 'emailSends', -1);
    return H.sendJson(res, 429, { error: 'email_limit', message: 'This report has already been emailed ' + MAX_EMAILS_PER_ORDER + ' times.', remaining: 0 });
  }
  const sent = await Mail.sendReportLink(ord, job, { env: env, fetch: deps && deps.fetch });
  if (!sent.ok) {
    await store.adapter.hincrby('pro:order:' + ord.token, 'emailSends', -1);
    return H.sendJson(res, 502, { error: 'send_failed', message: 'The email could not be sent. Try again in a few minutes.' });
  }
  return H.sendJson(res, 200, { ok: true, message: 'Sent to the address you gave us.', remaining: MAX_EMAILS_PER_ORDER - n });
}

/* ---------------- start page ---------------- */

// The form page, served by the function so a link that has already been used can be sent on to its own
// report at once, with or without JavaScript. An unknown, expired or malformed link gets one generic page.
async function startPage(req, res, deps) {
  const page = require('./pro-report-page.js');
  const store = storeOf(deps);
  if (await limited(store, req, 'order')) return H.sendHtml(res, 429, page.errorPage(MSG.limited, 429), { 'Retry-After': '60' });
  const token = String(H.queryOf(req).token || '').trim().toLowerCase();
  const o = HEX32.test(token) ? await store.getOrder(token) : null;
  if (o && o.status === 'used' && o.jobId) return H.sendRedirect(res, '/r/' + o.jobId + '/');
  if (!o || o.status !== 'unused') return H.sendHtml(res, 404, page.linkUnavailablePage());
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'pro-start.html'), 'utf8');
  return H.sendHtml(res, 200, html);
}

/* ---------------- report page ---------------- */

async function report(req, res, deps) {
  const page = require('./pro-report-page.js');
  const store = storeOf(deps);
  if (await limited(store, req, 'report')) return H.sendHtml(res, 429, page.errorPage(MSG.limited, 429), { 'Retry-After': '60' });
  const id = String(H.queryOf(req).id || '').trim().toLowerCase();
  const job = HEX32.test(id) ? await store.getJob(id) : null;
  if (!job) return H.sendHtml(res, 404, page.notFoundPage());
  const env = (deps && deps.env) || process.env;
  return H.sendHtml(res, 200, page.render(job, { emailEnabled: Mail.configured(env), maxEmails: MAX_EMAILS_PER_ORDER }));
}

/* ---------------- dispatch ---------------- */

const ROUTES = { startpage: ['GET', startPage], start: ['POST', start], order: ['GET', order], step: ['POST', step], status: ['GET', status], email: ['POST', email], report: ['GET', report] };

async function handle(req, res, deps) {
  const a = String(H.queryOf(req).a || '');
  const route = Object.prototype.hasOwnProperty.call(ROUTES, a) ? ROUTES[a] : null;
  if (!route) return H.sendJson(res, 404, { error: 'unavailable', message: MSG.generic });
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  if (method !== route[0]) return H.sendJson(res, 405, { error: 'method_not_allowed', m