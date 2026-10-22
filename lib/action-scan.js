/* =====================================================================
   lib/action-scan.js: the handler behind GET /api/action-scan?domain=example.com, the endpoint of the Citehound GitHub Action (vercel.json rewrites it to api/scan.js with
   client=action, so it adds no function to the Hobby plan's twelve).

   It is not the web scanner's interactive flow: it answers only a request whose User-Agent starts with "Citehound-Action/" (the Action sends it; a browser or a script that
   does not say what it is gets a 400 that points at the web scanner), it has its own limits (lib/action-limits.js) and it returns a compact JSON summary instead of the
   web page's whole result. The scanning itself is lib/scanner.js scanPage(), the same code the web scanner and the MCP server use; no scoring is written here.

   What goes in: the domain, nothing else. What comes back: the score out of 100, the three pillar scores, the failed checks with their fix, the AI crawler counts. Nothing is
   stored about the caller beyond the hashed counters of lib/action-limits.js, and the response is never cached.
   ===================================================================== */

'use strict';

const Methodology = require('./methodology.js');

const UA_PREFIX = 'Citehound-Action/';
const NOTE = 'A readiness score: crawler access and on-page signals. It does not measure whether any assistant names a brand.';

function normalizeDomain(raw) {
  let d = String(raw || '').trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d) ? d : null;
}

function clientIp(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// The compact answer, built from the scanner's result.
function summarize(domain, scan, now) {
  const r = scan.result;
  const pillars = Methodology.PILLARS.map((p) => {
    const checks = r.checks.filter((c) => c.cat === p.cat);
    return { id: p.cat, name: p.name, score: checks.reduce((n, c) => n + c.pts, 0), max: checks.reduce((n, c) => n + c.max, 0) };
  });
  const failed = r.checks.filter((c) => !c.ok).map((c) => {
    const pillar = Methodology.PILLARS.filter((p) => p.cat === c.cat)[0];
    return { label: c.label, pillar: pillar ? pillar.name : c.cat, points: c.pts, max: c.max, fix: c.advice };
  });
  const bots = scan.botResults || [];
  const names = (state) => bots.filter((b) => b.state === state).map((b) => b.name);
  return {
    domain: domain, score: r.total, pillars: pillars, failed: failed,
    crawlers: { open: names('open').length, limited: names('partial').length, blocked: names('blocked').length, blockedNames: names('blocked') },
    scannedAt: new Date(now || Date.now()).toISOString(), note: NOTE, method: 'https://getcitehound.com/methodology'
  };
}

// deps (tests): { scanPage, checkActionLimit, now }
async function handle(req, res, deps) {
  deps = deps || {};
  const scanPage = deps.scanPage || require('./scanner.js').scanPage;
  const limits = deps.checkActionLimit || require('./action-limits.js').checkActionLimit;
  res.setHeader('Cache-Control', 'no-store');
  const send = (code, body, headers) => { Object.keys(headers || {}).forEach((h) => res.setHeader(h, headers[h])); res.status(code).json(body); };

  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') return send(405, { error: 'Use GET.' }, { Allow: 'GET, HEAD' });
  const ua = String((req.headers && req.headers['user-agent']) || '');
  if (ua.indexOf(UA_PREFIX) !== 0) return send(400, { error: 'This endpoint is for the Citehound GitHub Action. To scan a site by hand, use the web scanner at https://getcitehound.com.' });

  let raw = req.query && req.query.domain;
  if (!raw) { try { raw = new URL(req.url, 'http://localhost').searchParams.get('domain'); } catch (e) { /* the validation below answers */ } }
  const domain = normalizeDomain(raw);
  if (!domain) return send(400, { error: 'Pass a valid domain, for example example.com.' });

  const rl = await limits(domain, clientIp(req), deps.now);
  if (rl.limited) return send(429, { error: rl.message, limit: rl.scope }, { 'Retry-After': String(rl.retryAfter) });

  try {
    const scan = await scanPage('https://' + domain + '/');
    if (!scan.ok) {
      if (scan.stage === 'robots') return send(502, { error: 'Could not read robots.txt, so the score would not be reliable.' });
      return send(502, { error: 'The homepage could not be read.' });
    }
    return send(200, summarize(domain, scan, deps.now));
  } catch (err) {
    console.error('[action-scan] unhandled error for', domain);
    return send(500, { error: 'Unexpected server error.' });
  }
}

module.exports = { handle, summarize, normalizeDomain, UA_PREFIX, NOTE };
