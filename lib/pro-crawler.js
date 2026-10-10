/* =====================================================================
   lib/pro-crawler.js: the Citehound Pro crawl, one small step at a time.

   A Pro report is a polite crawl of at most 25 pages. It runs as a series of
   short steps, each a call to /api/pro?a=step made by the browser that is
   showing the progress screen, so no function has to stay alive for a whole
   crawl and nothing needs a queue.

     step 1  discovery   robots.txt, llms.txt, the sitemap (or the homepage links);
                         choose up to 25 pages; save the site-level facts
     step 2+ scanning    up to 5 pending pages per step, then finish when none remain

   Politeness, enforced here and not left to the caller:
     - honors robots.txt for CitehoundBot, for the homepage and for every page chosen
     - identifies as CitehoundBot, never as a browser
     - one request per second per domain, across steps and across jobs (a slot key that lives one second)
     - HTTP 429 stops the crawl at once (job "partial", the rest "skipped")
     - 401, 403, 406, 451 and bot-challenge pages are recorded as "blocked by the site", never
       retried or worked around; three blocked pages in a row stop the crawl
     - a lock per job, so repeated or parallel step calls never read a page twice

   Scoring is lib/scanner.js (parseSignals, scoreAll), untouched.
   ===================================================================== */

'use strict';

const scanner = require('./scanner.js');
const F = require('./safe-fetch.js');
const Stats = require('./pro-stats.js');

const CAP = 25;
const BATCH = 5;
const PAGE_TIMEOUT_MS = 9000;
const STEP_BUDGET_MS = 42000;       // stop starting pages after this; the function allows 60 s
const MAX_CONSECUTIVE_BLOCKS = 3;
const MAX_RESTORES = 3;            // a link can be given back this many times when a job read no page
const MAX_SUB_SITEMAPS = 4;
const MAX_CANDIDATES = 500;
const SITEMAP_MAX_BYTES = 1024 * 1024;
const PAGE_MAX_BYTES = 1536 * 1024;
const UA = scanner.CRAWLER_UA;

const REASONS = {
  rate_limited: 'The site asked us to slow down (HTTP 429), so we stopped instead of adding load. The report covers the pages read before that.',
  blocked: 'The site blocked our visits (HTTP 403 or a bot check). We do not work around that, so we stopped. The report covers the pages read before that.',
  robots_disallow: 'The site’s robots.txt asks CitehoundBot not to visit it. We honor that, so no report could be made.',
  not_found: 'We could not reach that site. Check the address and order a new link if it was a typo.',
  not_public: 'That address is not a public website, so it was not fetched.',
  robots_unreadable: 'We could not read robots.txt, so we did not crawl. A score built on a guess would not be worth reading.',
  nothing_read: 'None of the pages could be read.',
  all_blocked: 'The site blocked every page we asked for. We do not work around that.',
  many_missing: 'Many pages could not be read, so this report covers part of the site.'
};

function sleepReal(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ---------------- the polite fetcher ---------------- */

function makeGetter(store, domain, deps) {
  deps = deps || {};
  const fetchFn = deps.fetch || F.safeGet;
  const sleep = deps.sleep || sleepReal;
  const allowHost = F.sameSite(domain);

  // One request per second for this domain, across every step and every job: the slot is a key that lives one second.
  async function wait() {
    for (let i = 0; i < 60; i++) {
      if (await store.takeSlot('req:' + domain, 1)) return;
      await sleep(120);
    }
  }

  return async function get(url, o) {
    o = o || {};
    await wait();
    return fetchFn(url, { ua: UA, timeoutMs: o.timeoutMs || PAGE_TIMEOUT_MS, maxBytes: o.maxBytes || PAGE_MAX_BYTES, allowHost: allowHost, accept: o.accept });
  };
}

/* ---------------- discovery ---------------- */

function decodeXml(s) { return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\''); }
function locs(xml) { const out = []; const re = /<loc>([\s\S]*?)<\/loc>/gi; let m; while ((m = re.exec(xml)) !== null) out.push(decodeXml(m[1].trim())); return out; }

const NON_CONTENT = /\.(jpg|jpeg|png|gif|svg|webp|ico|css|js|json|xml|pdf|zip|mp4|mp3|wav|woff2?|ttf|eot|csv|txt)(\?|$)/i;
const SKIP_PATH = /^\/(wp-admin|wp-json|wp-content|admin|cart|checkout|account|login|logout|signup|api|assets|static|cdn-cgi|_next|fonts|feed)(\/|$)/i;
const PRIORITY = [/^\/pricing\/?$/i, /^\/products?\/[^/]+\/?$/i, /^\/about\/?$/i, /^\/contact\/?$/i, /^\/docs(\/[^/]+)?\/?$/i, /^\/blog(\/[^/]+)?\/?$/i];

function hostKey(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return null; } }

function isContentUrl(url, host) {
  if (hostKey(url) !== host) return false;
  let u; try { u = new URL(url); } catch (e) { return false; }
  if (u.search) return false; // query strings are almost always filtered or duplicate views
  return !NON_CONTENT.test(u.pathname) && !SKIP_PATH.test(u.pathname);
}

// Homepage first, then the pages a visitor is likely to look for, then an even spread across the sections of the site.
function chooseUrls(candidates, homepageUrl, robots, host, cap) {
  const seen = {}; const kept = [];
  candidates.forEach(function (u) {
    const n = u.split('#')[0];
    if (seen[n]) return; seen[n] = true;
    if (n === homepageUrl || !isContentUrl(n, host)) return;
    let p; try { p = new URL(n).pathname; } catch (e) { return; }
    if (!scanner.isPathAllowed(p, UA, robots)) return;
    kept.push(n);
  });
  const priority = []; const rest = [];
  kept.forEach(function (u) { const p = new URL(u).pathname; (PRIORITY.some(function (re) { return re.test(p); }) ? priority : rest).push(u); });
  const groups = {}; const order = [];
  rest.forEach(function (u) { const seg = new URL(u).pathname.split('/').filter(Boolean)[0] || ''; if (!groups[seg]) { groups[seg] = []; order.push(seg); } groups[seg].push(u); });
  const spread = []; let idx = 0;
  while (spread.length < rest.length) {
    let any = false;
    order.forEach(function (k) { if (idx < groups[k].length) { spread.push(groups[k][idx]); any = true; } });
    idx++;
    if (!any) break;
  }
  return [homepageUrl].concat(priority, spread).slice(0, cap);
}

function failure(code, extra) { return Object.assign({ ok: false, code: code, reason: REASONS[code] }, extra || {}); }

// Maps a non-ok first request to the reason the job fails with.
function whyUnreachable(r) {
  if (r.status === 429) return 'rate_limited';
  if (F.isBlockedResponse(r)) return 'blocked';
  if (r.kind === 'blocked_host') return 'not_public';
  if (!r.status && (r.kind === 'dns' || r.kind === 'refused' || r.kind === 'tls' || r.kind === 'timeout')) return 'not_found';
  return 'robots_unreadable';
}

async function discover(domain, get) {
  // robots.txt first. If the bare domain does not answer, try www once.
  let origin = 'https://' + domain;
  let robotsRes = await get(origin + '/robots.txt', { timeoutMs: 10000 });
  if (!robotsRes.status && (robotsRes.kind === 'dns' || robotsRes.kind === 'refused' || robotsRes.kind === 'tls' || robotsRes.kind === 'timeout')) {
    const alt = 'https://www.' + domain;
    const again = await get(alt + '/robots.txt', { timeoutMs: 10000 });
    if (again.status || again.ok) { origin = alt; robotsRes = again; }
  }
  if (robotsRes.finalUrl) { try { const fu = new URL(robotsRes.finalUrl); if (hostKey(fu.href) === domain) origin = fu.origin; } catch (e) { /* keep origin */ } }

  let robotsOk = false;
  let robots = { groups: [], sitemaps: [] };
  if (robotsRes.status === 404 || robotsRes.status === 410) robotsOk = false;
  else if (robotsRes.ok && robotsRes.text && robotsRes.text.trim() && !/^\s*</.test(robotsRes.text)) { robots = scanner.parseRobots(robotsRes.text); robotsOk = true; }
  else if (robotsRes.ok) robotsOk = false; // 200 with an empty or HTML body: the site has no robots.txt in effect
  else return failure(whyUnreachable(robotsRes), { stage: 'robots', status: robotsRes.status || null });

  const homepageUrl = origin + '/';
  if (!scanner.isPathAllowed('/', UA, robots)) return failure('robots_disallow', { stage: 'robots' });

  const llmsRes = await get(origin + '/llms.txt', { timeoutMs: 8000, maxBytes: scanner.LLMS_MAX_BYTES });
  if (llmsRes.status === 429) return failure('rate_limited', { stage: 'llms' });
  const llmsOk = scanner.isUsableTextFile(llmsRes);

  let sitemapOk = robots.sitemaps.length > 0;
  let sitemapUrls = robots.sitemaps.slice();
  let firstSitemapBody = null;
  if (!sitemapOk) {
    const smRes = await get(origin + '/sitemap.xml', { timeoutMs: 8000, maxBytes: SITEMAP_MAX_BYTES, accept: 'application/xml,text/xml,*/*;q=0.5' });
    if (smRes.status === 429) return failure('rate_limited', { stage: 'sitemap' });
    if (smRes.ok && /<(urlset|sitemapindex)/i.test(smRes.text)) { sitemapOk = true; sitemapUrls = [origin + '/sitemap.xml']; firstSitemapBody = smRes.text; }
  }

  const botResults = scanner.BOTS.map(function (b) { const st = scanner.botStatus(b.ua, robots); return { name: b.ua, desc: b.desc, state: st.state, rule: st.rule }; });

  // Pages: the sitemap first (an index one level deep), else the links on the homepage.
  let candidates = []; let source = 'homepage-links';
  if (sitemapOk) {
    let subs = 0;
    for (let i = 0; i < sitemapUrls.length && candidates.length < MAX_CANDIDATES; i++) {
      let text = (i === 0 && firstSitemapBody) ? firstSitemapBody : null;
      if (text === null) {
        const r = await get(sitemapUrls[i], { timeoutMs: 8000, maxBytes: SITEMAP_MAX_BYTES, accept: 'application/xml,text/xml,*/*;q=0.5' });
        if (r.status === 429) return failure('rate_limited', { stage: 'sitemap' });
        if (!r.ok || !r.text) continue;
        text = r.text;
      }
      if (/<sitemapindex/i.test(text)) {
        const children = locs(text);
        for (let j = 0; j < children.length && subs < MAX_SUB_SITEMAPS && candidates.length < MAX_CANDIDATES; j++) {
          if (hostKey(children[j]) !== domain) continue;
          subs++;
          const rr = await get(children[j], { timeoutMs: 8000, maxBytes: SITEMAP_MAX_BYTES, accept: 'application/xml,text/xml,*/*;q=0.5' });
          if (rr.status === 429) return failure('rate_limited', { stage: 'sitemap' });
          if (rr.ok && rr.text && /<urlset/i.test(rr.text)) candidates = candidates.concat(locs(rr.text));
        }
      } else if (/<urlset/i.test(text)) candidates = candidates.concat(locs(text));
    }
    if (candidates.length) source = 'sitemap';
  }
  if (!candidates.length) {
    const hp = await get(homepageUrl, { timeoutMs: 12000 });
    if (hp.status === 429) return failure('rate_limited', { stage: 'homepage' });
    if (F.isBlockedResponse(hp)) return failure('blocked', { stage: 'homepage' });
    if (hp.ok && hp.text) {
      const seen = {}; const re = /<a\b[^>]*href=["']([^"']+)["']/gi; let m;
      while ((m = re.exec(hp.text)) !== null) { let abs; try { abs = new URL(m[1], homepageUrl).toString().split('#')[0]; } catch (e) { continue; } if (!seen[abs]) { seen[abs] = true; candidates.push(abs); } }
    }
  }

  const urls = chooseUrls(candidates, homepageUrl, robots, domain, CAP);
  return {
    ok: true,
    origin: origin,
    urls: urls,
    discovery: { source: source, candidates: candidates.length },
    siteContext: { robotsOk: robotsOk, llmsOk: llmsOk, sitemapOk: sitemapOk, botResults: botResults, hasBlockedCrawler: botResults.some(function (b) { return b.state === 'block'; }) }
  };
}

/* ---------------- one page ---------------- */

function plainError(r) {
  if (r.status) return 'HTTP ' + r.status;
  return { timeout: 'The page did not answer in time', dns: 'The address did not resolve', refused: 'The connection was refused', tls: 'The security certificate was not accepted', blocked_host: 'Not a public address', redirect_away: 'It redirects to another site', redirect_loop: 'Too many redirects', bad_url: 'Not a fetchable address' }[r.kind] || 'The page could not be read';
}

// Reads and scores one page. Returns { page, stop } where stop is 'rate_limited' or null.
async function readPage(url, siteContext, get) {
  const r = await get(url);
  if (r.status === 429) return { page: { url: url, status: 'skipped', error: 'HTTP 429' }, stop: 'rate_limited' };
  if (F.isBlockedResponse(r)) return { page: { url: url, status: 'blocked', error: r.status ? 'HTTP ' + r.status : 'A bot check' }, stop: null };
  if (!r.ok || !r.text) return { page: { url: url, status: 'failed', error: plainError(r) }, stop: null };
  if (r.contentType && !/html|xml/i.test(r.contentType)) return { page: { url: url, status: 'failed', error: 'Not an HTML page' }, stop: null };
  const sig = scanner.parseSignals(r.text);
  const result = scanner.scoreAll(siteContext.robotsOk, siteContext.llmsOk, siteContext.sitemapOk, siteContext.botResults, sig);
  return { page: { url: url, status: 'ok', result: result, siteInfo: { title: sig.title.slice(0, 160), metaDesc: sig.metaDesc.slice(0, 300), lang: sig.lang } }, stop: null };
}

/* ---------------- finishing ---------------- */

function endState(job, stopReason) {
  const p = job.progress;
  if (stopReason) return { status: p.done > 0 ? 'partial' : 'failed', reason: REASONS[stopReason] };
  if (p.done === 0) return { status: 'failed', reason: p.blocked > 0 ? REASONS.all_blocked : REASONS.nothing_read };
  const total = p.total || (p.done + p.failed + p.blocked + p.skipped);
  if (p.skipped > 0 || (p.failed + p.blocked) * 2 >= total) return { status: 'partial', reason: REASONS.many_missing };
  return { status: 'done', reason: null };
}

// A failed job read no page. Its link goes back to the customer, up to MAX_RESTORES times per order, and the job
// is marked so the progress screen can say so. A partial job (at least one page read) keeps its link spent: it has a report.
async function giveLinkBack(store, job) {
  const reverse = await store.orderForJob(job.id);
  if (!reverse) return false;
  const restored = await store.restoreOrder(reverse.token, job.id, MAX_RESTORES);
  if (restored) { await store.setJob(job.id, { restored: '1' }); await Stats.count(store, 'jobs_restored'); }
  return restored;
}

async function finishJob(store, job, stopReason) {
  const fresh = await store.getJob(job.id);
  const end = endState(fresh, stopReason);
  await store.setJob(job.id, { status: end.status, phase: 'done', finishedAt: new Date().toISOString(), reason: end.reason || '' });
  await store.releaseDomainSlot(job.domain);
  await Stats.count(store, 'jobs_' + end.status);
  if (end.status === 'failed') await giveLinkBack(store, job);
  return end;
}

async function failJob(store, job, code, detail) {
  await store.setJob(job.id, { status: 'failed', phase: 'done', finishedAt: new Date().toISOString(), reason: REASONS[code] || REASONS.nothing_read });
  await store.releaseDomainSlot(job.domain);
  await Stats.count(store, 'jobs_failed');
  await giveLinkBack(store, job);
  return { status: 'failed', reason: REASONS[code] };
}

/* ---------------- one step ---------------- */

// Does one unit of work for a job: discovery, or up to BATCH pages. Safe to call repeatedly and in parallel.
// Returns { status, phase, progress, busy? }. deps: { fetch, sleep, now } for tests.
async function runStep(store, jobId, deps) {
  deps = deps || {};
  const now = deps.now || function () { return Date.now(); };
  const started = now();
  let job = await store.getJob(jobId);
  if (!job) return { notFound: true };
  const view = function (j) { return { status: j.status, phase: j.phase, progress: j.progress, reason: j.reason }; };
  if (job.status === 'done' || job.status === 'partial' || job.status === 'failed') return view(job);

  const lock = await store.acquireLock(jobId);
  if (!lock) return Object.assign(view(job), { busy: true });
  try {
    job = await store.getJob(jobId); // state may have moved while we waited for the lock
    if (!job || job.status === 'done' || job.status === 'partial' || job.status === 'failed') return job ? view(job) : { notFound: true };
    const get = makeGetter(store, job.domain, deps);

    if (job.phase === 'discover') {
      let found;
      try { found = await discover(job.domain, get); } catch (e) {
        console.error('[pro-crawler] discovery failed: ' + (e && e.name ? e.name : 'Error'));
        found = failure('robots_unreadable');
      }
      if (!found.ok) { await failJob(store, job, found.code); return view(await store.getJob(jobId)); }
      await store.setPages(jobId, found.urls);
      await store.setJob(jobId, { status: 'running', phase: 'scan', discoverySource: found.discovery.source, candidates: found.discovery.candidates, siteContext: found.siteContext });
      return view(await store.getJob(jobId));
    }

    // scanning
    const ctx = job.siteContext;
    const settledOrder = job.pages.filter(function (p) { return p.status !== 'pending'; });
    let trailingBlocked = 0;
    for (let i = settledOrder.length - 1; i >= 0 && settledOrder[i].status === 'blocked'; i--) trailingBlocked++;

    const pending = [];
    job.pages.forEach(function (p, i) { if (p.status === 'pending') pending.push(i); });
    let stop = null;
    let handled = 0;
    for (let k = 0; k < pending.length && handled < BATCH; k++) {
      if (now() - started > STEP_BUDGET_MS) break;
      const i = pending[k];
      const res = await readPage(job.pages[i].url, ctx, get);
      await store.updatePage(jobId, i, res.page);
      handled++;
      if (res.stop) { stop = res.stop; break; }
      trailingBlocked = res.page.status === 'blocked' ? trailingBlocked + 1 : 0;
      if (trailingBlocked >= MAX_CONSECUTIVE_BLOCKS) { stop = 'blocked'; break; }
    }
    if (stop) {
      // Nothing more is fetched: whatever is still pending is recorded as skipped.
      const rest = await store.getJob(jobId);
      for (let i = 0; i < rest.pages.length; i++) if (rest.pages[i].status === 'pending') await store.updatePage(jobId, i, { url: rest.pages[i].url, status: 'skipped', error: stop === 'rate_limited' ? 'Stopped: the site asked us to slow down' : 'Stopped: the site blocked our visits' });
      await finishJob(store, job, stop);
    } else {
      const after = await store.getJob(jobId);
      if (!after.pages.some(function (p) { return p.status === 'pending'; })) await finishJob(store, job, null);
    }
    return view(await store.getJob(jobId));
  } finally {
    await store.releaseLock(jobId, lock);
  }
}

module.exports = {
  runStep: runStep, discover: discover, chooseUrls: chooseUrls, readPage: readPage, endState: endState, makeGetter: makeGetter,
  REASONS: REASONS, MAX_RESTORES: MAX_RESTORES, CAP: CAP, BATCH: BATCH, UA: UA, MAX_CONSECUTIVE_BLOCKS: MAX_CONSECUTIVE_BLOCKS
};
