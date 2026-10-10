#!/usr/bin/env node
/* =====================================================================
   scripts/test-pro-crawler.js

   Runs lib/pro-crawler.js against a fake site on a virtual clock: no network, no
   waiting. Checks the politeness rules (robots.txt, user agent, one request per
   second, 429 stops, 403 is "blocked by the site", never retried), the 25-page
   cap, 5 pages per step, parallel steps reading each page once, and the end
   states of a job.

     node scripts/test-pro-crawler.js
   ===================================================================== */

'use strict';

const S = require('../lib/pro-store.js');
const C = require('../lib/pro-crawler.js');
const scanner = require('../lib/scanner.js');

let pass = 0; const fails = [];
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); console.log((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

function html(i) {
  const good = i % 3 === 0;
  return '<!DOCTYPE html><html lang="en"><head><title>Page number ' + i + ' of the example site</title>' +
    (good ? '<link rel="canonical" href="https://example.com/p' + i + '"><meta name="description" content="A description of page ' + i + ' that is long enough to pass the length rule of the scanner, about eighty characters.">' : '') +
    '<meta property="og:title" content="x"><meta property="og:description" content="y"></head><body><h1>Heading ' + i + '</h1>' + (i % 2 ? '<h2>One</h2><h2>Two</h2>' : '') + '<a href="/about">About</a></body></html>';
}

// A fake site. opts.sitemap: how many URLs; opts.noSitemap; opts.status: { path: status }.
function makeSite(opts) {
  opts = opts || {};
  const log = []; // { url, t, ua }
  const n = opts.pages || 40;
  const urls = ['https://example.com/'].concat(Array.from({ length: n }, (_, i) => 'https://example.com/section' + (i % 4) + '/page' + i));
  const files = {};
  files['https://example.com/robots.txt'] = opts.robots !== undefined ? opts.robots : ('User-agent: *\nAllow: /\nDisallow: /section3/\n' + (opts.noSitemap ? '' : 'Sitemap: https://example.com/sitemap.xml\n'));
  if (!opts.noSitemap) files['https://example.com/sitemap.xml'] = '<?xml version="1.0"?><urlset>' + urls.map((u) => '<url><loc>' + u + '</loc></url>').join('') + '</urlset>';
  files['https://example.com/llms.txt'] = opts.llms || null;
  urls.forEach((u, i) => { files[u] = html(i); });
  if (opts.noSitemap) files['https://example.com/'] = '<html lang="en"><head><title>Home page of the example site</title></head><body><h1>Home</h1>' + urls.slice(1, 12).map((u) => '<a href="' + u + '">p</a>').join('') + '</body></html>';
  let clock = 1000000;
  const sleep = async (ms) => { clock += ms; };
  const now = () => clock;
  const fetch = async (url, o) => {
    clock += 40;
    log.push({ url: url, t: clock, ua: o.ua });
    if (opts.dns) return { ok: false, kind: 'dns', error: 'ENOTFOUND' };
    const forced = opts.status && Object.keys(opts.status).filter((p) => url.endsWith(p))[0];
    if (forced) { const st = opts.status[forced]; return { ok: false, status: st, text: 'no', headers: st === 429 ? { 'retry-after': '60' } : { server: 'cloudflare' }, finalUrl: url }; }
    const body = files[url];
    if (body === undefined || body === null) return { ok: false, status: 404, text: '', headers: {}, finalUrl: url };
    return { ok: true, status: 200, text: body, contentType: url.endsWith('.xml') ? 'application/xml' : (url.endsWith('.txt') ? 'text/plain' : 'text/html'), headers: {}, finalUrl: url };
  };
  return { fetch, sleep, now, log, urls, files };
}

async function runAll(store, id, deps, maxSteps) {
  const steps = [];
  for (let i = 0; i < (maxSteps || 30); i++) {
    const r = await C.runStep(store, id, deps);
    steps.push(r);
    if (r.status === 'done' || r.status === 'partial' || r.status === 'failed') break;
  }
  return steps;
}
async function newJob(store, domain) { const id = await store.createJob({ domain: domain || 'example.com' }); await store.reserveDomainSlot(domain || 'example.com', 2); return id; }
const fresh = (site) => S.createStore(S.memoryAdapter({ now: site ? site.now : undefined }), { now: site ? site.now : undefined });

(async function main() {
  /* ---- a normal crawl ---- */
  {
    const site = makeSite({ pages: 40 }); const store = fresh(site);
    const id = await newJob(store);
    const steps = await runAll(store, id, site);
    const job = await store.getJob(id);
    t('a normal crawl ends done', job.status === 'done' && job.phase === 'done', job.status + ' ' + job.reason);
    t('the crawl is capped at 25 pages', job.pages.length === 25 && C.CAP === 25);
    t('the homepage is first', job.pages[0].url === 'https://example.com/');
    t('every chosen page was read and scored', job.pages.every((p) => p.status === 'ok' && p.result && typeof p.result.total === 'number'));
    t('the discovery source is the sitemap and it knows the candidate count', job.discovery.source === 'sitemap' && job.discovery.candidates === 41);
    t('robots.txt is honored: a disallowed section is never chosen or fetched', !job.pages.some((p) => /section3/.test(p.url)) && !site.log.some((l) => /section3/.test(l.url)));
    t('every request carries the CitehoundBot user agent', site.log.length > 0 && site.log.every((l) => l.ua === scanner.CRAWLER_UA && /^CitehoundBot/.test(l.ua)));
    t('no request names a different site', site.log.every((l) => /^https:\/\/example\.com\//.test(l.url)));
    const gaps = site.log.slice(1).map((l, i) => l.t - site.log[i].t);
    t('at least one second between any two requests', Math.min(...gaps) >= 1000, 'smallest gap ' + Math.min(...gaps) + ' ms');
    const scanSteps = steps.filter((s) => s.phase === 'scan' || s.phase === 'done').length;
    t('the first step is discovery only: no page is read in it', steps[0].phase === 'scan' && steps[0].progress.settled === 0 && steps[0].progress.total === 25);
    t('no step reads more than 5 pages', steps.every((s, i) => i === 0 || (s.progress.settled - (steps[i - 1].progress.settled)) <= 5));
    t('25 pages need 5 scanning steps after discovery', scanSteps >= 5 && steps.length === 6, 'steps ' + steps.length);
    t('the progress counters add up', job.progress.done === 25 && job.progress.settled === 25 && job.progress.total === 25);
    t('a finished job releases its domain slot', (await store.reserveDomainSlot('example.com', 1)) === true);
    // The score is the real scanner's.
    const p3 = job.pages[3];
    const ref = scanner.scoreAll(job.siteContext.robotsOk, job.siteContext.llmsOk, job.siteContext.sitemapOk, job.siteContext.botResults, scanner.parseSignals(site.files[p3.url]));
    t('a page score equals scanner.scoreAll on the same markup', JSON.stringify(ref) === JSON.stringify(p3.result));
    t('site-level facts are saved with the job', job.siteContext.robotsOk === true && job.siteContext.llmsOk === false && job.siteContext.sitemapOk === true && job.siteContext.botResults.length === scanner.BOTS.length);
    t('steps after the end change nothing', (await C.runStep(store, id, site)).status === 'done');
  }

  /* ---- 25 pages from a small site: fewer than the cap ---- */
  {
    const site = makeSite({ pages: 6 }); const store = fresh(site);
    const id = await newJob(store);
    await runAll(store, id, site);
    const job = await store.getJob(id);
    t('a small site is crawled whole', job.status === 'done' && job.pages.length <= 7 && job.pages.length >= 5, String(job.pages.length));
  }

  /* ---- no sitemap: homepage links ---- */
  {
    const site = makeSite({ pages: 30, noSitemap: true }); const store = fresh(site);
    const id = await newJob(store);
    await runAll(store, id, site);
    const job = await store.getJob(id);
    t('without a sitemap the homepage links are used', job.discovery.source === 'homepage-links' && job.pages.length >= 2 && job.status === 'done', job.discovery.source + ' ' + job.pages.length);
    t('Sitemap declared is false for that site', job.siteContext.sitemapOk === false);
  }

  /* ---- 429 stops the crawl ---- */
  {
    const site = makeSite({ pages: 40, status: { '/page9': 429, '/page10': 429 } }); const store = fresh(site);
    const id = await newJob(store);
    await runAll(store, id, site);
    const job = await store.getJob(id);
    const after429 = site.log.map((l) => l.url);
    const idx = after429.findIndex((u) => /page9$/.test(u) || /page10$/.test(u));
    t('a 429 ends the job as partial with a plain reason', job.status === 'partial' && /429/.test(job.reason) && /slow down/.test(job.reason), job.status + ' / ' + job.reason);
    t('after a 429 not one more request is made', idx !== -1 && after429.length === idx + 1, 'requests after: ' + (after429.length - idx - 1));
    t('pages not read are recorded as skipped, the rest keep their results', job.progress.skipped > 0 && job.progress.done > 0 && job.pages.every((p) => p.status === 'ok' || p.status === 'skipped'), JSON.stringify(job.progress));
    t('the counters add up to the page count', job.progress.settled === job.progress.total);
  }

  /* ---- 403 is "blocked by the site" ---- */
  {
    const site = makeSite({ pages: 40, status: { '/page2': 403, '/page5': 403 } }); const store = fresh(site);
    const id = await newJob(store);
    await runAll(store, id, site);
    const job = await store.getJob(id);
    const blocked = job.pages.filter((p) => p.status === 'blocked');
    t('403 pages are recorded as blocked, separately from failed', blocked.length >= 1 && job.progress.blocked === blocked.length && job.progress.failed === 0, JSON.stringify(job.progress));
    t('a blocked page is not asked for twice', new Set(site.log.map((l) => l.url)).size === site.log.length);
    t('a few blocked pages do not stop the crawl', job.progress.done >= 20 && (job.status === 'done'), job.status);
  }
  {
    const site = makeSite({ pages: 40, status: { '/page0': 403, '/page1': 403, '/page2': 403, '/page4': 403, '/page5': 403, '/page6': 403, '/page8': 403, '/page9': 403, '/page10': 403 } }); const store = fresh(site);
    const id = await newJob(store);
    await runAll(store, id, site);
    const job = await store.getJob(id);
    t('three blocked pages in a row stop the crawl politely', job.status === 'partial' || job.status === 'failed', job.status);
    t('the reason says the site blocked us', /blocked/.test(job.reason), job.reason);
    t('the crawl does not keep knocking after the stop', site.log.filter((l) => /page\d+$/.test(l.url)).length <= 12);
  }
  {
    const site = makeSite({ pages: 10, status: { '/robots.txt': 403 } }); const store = fresh(site);
    const id = await newJob(store);
    await runAll(store, id, site);
    const job = await store.getJob(id);
    t('a 403 on robots.txt fails the job with the "blocked" reason and reads nothing', job.status === 'failed' && /blocked/.test(job.reason) && site.log.length === 1, site.log.length + ' requests, ' + job.reason);
  }

  /* ---- parallel steps ---- */
  {
    const site = makeSite({ pages: 40 }); const store = fresh(site);
    const id = await newJob(store);
    await C.runStep(store, id, site); // discovery
    // 8 simultaneous callers, 6 rounds
    for (let round = 0; round < 6; round++) await Promise.all(Array.from({ length: 8 }, () => C.runStep(store, id, site)));
    const job = await store.getJob(id);
    const counts = {};
    site.log.forEach((l) => { counts[l.url] = (counts[l.url] || 0) + 1; });
    t('8 parallel step calls never read a page twice', Object.keys(counts).every((u) => counts[u] === 1), Object.keys(counts).filter((u) => counts[u] > 1).join(', '));
    t('the job still finishes', job.status === 'done' && job.progress.done === 25, job.status + ' ' + JSON.stringify(job.progress));
  }
  {
    const site = makeSite({ pages: 10 }); const store = fresh(site);
    const id = await newJob(store);
    const held = await store.acquireLock(id);
    const r = await C.runStep(store, id, site);
    t('while a worker holds the lock, another step returns busy and fetches nothing', r.busy === true && site.log.length === 0);
    await store.releaseLock(id, held);
  }

  /* ---- two jobs on one domain share the one-request-per-second budget (real clock) ---- */
  {
    const store = fresh(null);
    const times = [];
    const fetch = async (url) => { times.push(Date.now()); return { ok: true, status: 200, text: '', headers: {}, finalUrl: url }; };
    const g1 = C.makeGetter(store, 'example.com', { fetch });
    const g2 = C.makeGetter(store, 'example.com', { fetch });
    await Promise.all([1, 2, 3].map(async () => { await g1('https://example.com/a'); }).concat([1, 2, 3].map(async () => { await g2('https://example.com/b'); })));
    times.sort((x, y) => x - y);
    const gaps = times.slice(1).map((x, i) => x - times[i]);
    t('two getters for one domain (two jobs), six requests together: no two within ~a second', times.length === 6 && Math.min(...gaps) >= 900, 'gaps ' + gaps.join(', '));
  }

  /* ---- failures at the start ---- */
  {
    const site = makeSite({ pages: 10, robots: 'User-agent: *\nDisallow: /\n' }); const store = fresh(site);
    const id = await newJob(store);
    await runAll(store, id, site);
    const job = await store.getJob(id);
    t('robots.txt that disallows everything: no crawl, plain reason', job.status === 'failed' && /robots\.txt/.test(job.reason) && site.log.every((l) => /robots\.txt$/.test(l.url)), job.reason + ' ' + site.log.length);
  }
  {
    const site = makeSite({ pages: 10, robots: 'User-agent: CitehoundBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n' }); const store = fresh(site);
    const id = await newJob(store);
    await runAll(store, id, site);
    const job = await store.getJob(id);
    t('a rule aimed at CitehoundBot is obeyed even when other agents are allowed', job.status === 'failed' && /robots\.txt/.test(job.reason));
  }
  {
    const site = makeSite({ pages: 10, dns: true }); const store = fresh(site);
    const id = await newJob(store);
    await runAll(store, id, site);
    const job = await store.getJob(id);
    t('a site that does not resolve fails with a plain reason', job.status === 'failed' && /could not reach/.test(job.reason), job.reason);
  }
  {
    const site = makeSite({ pages: 10, status: { '/robots.txt': 500 } }); const store = fresh(site);
    const id = await newJob(store);
    await runAll(store, id, site);
    const job = await store.getJob(id);
    t('an unreadable robots.txt fails the job rather than guessing', job.status === 'failed' && /robots\.txt/.test(job.reason));
  }
  {
    const site = makeSite({ pages: 10, status: { '/robots.txt': 429 } }); const store = fresh(site);
    const id = await newJob(store);
    await runAll(store, id, site);
    const job = await store.getJob(id);
    t('429 on robots.txt stops at once', job.status === 'failed' && /429/.test(job.reason) && site.log.length === 1);
  }
  {
    const site = makeSite({ pages: 10, robots: '' }); const store = fresh(site);
    const id = await newJob(store);
    await runAll(store, id, site);
    const job = await store.getJob(id);
    t('an empty robots.txt means none in effect: the crawl runs and the check fails', job.status === 'done' && job.siteContext.robotsOk === false);
  }
  {
    const site = makeSite({ pages: 10 }); const store = fresh(site);
    delete site.files['https://example.com/robots.txt'];
    const id = await newJob(store);
    await runAll(store, id, site);
    const job = await store.getJob(id);
    t('a 404 robots.txt is a failed check, not a failed crawl', job.status === 'done' && job.siteContext.robotsOk === false);
  }

  /* ---- a job that read no page gives the link back; one that read a page does not ---- */
  async function orderedJob(store, token, domain) {
    const tok = token || (await store.createOrder()).token;
    await store.claimOrder(tok);
    const id = await store.createJob({ domain: domain || 'example.com' });
    await store.reserveDomainSlot(domain || 'example.com', 2);
    await store.markOrderUsed(tok, { jobId: id, contact: { name: 'Ada Lovelace', email: 'ada@example.org' } });
    return { id, token: tok };
  }
  {
    const cases = [
      ['robots.txt forbids the crawl', { pages: 10, robots: 'User-agent: *\nDisallow: /\n' }],
      ['the site answers 429 before the first page', { pages: 10, status: { '/': 429 } }],
      ['every page is blocked (403), the homepage first', { pages: 10, status: { '/': 403, '/page0': 403, '/page1': 403, '/page2': 403, '/page3': 403, '/page4': 403, '/page5': 403, '/page6': 403, '/page7': 403, '/page8': 403, '/page9': 403 } }],
      ['robots.txt answers 403', { pages: 10, status: { '/robots.txt': 403 } }],
      ['the site does not resolve', { pages: 10, dns: true }]
    ];
    for (const [label, opts] of cases) {
      const site = makeSite(opts); const store = fresh(site);
      const { id, token } = await orderedJob(store);
      await runAll(store, id, site);
      const job = await store.getJob(id); const ord = await store.getOrder(token);
      t('zero pages (' + label + '): the job failed, its link is back, the contact is kept', job.status === 'failed' && job.progress.done === 0 && job.linkRestored === true && ord.status === 'unused' && ord.jobId === null && ord.contact && ord.contact.email === 'ada@example.org' && ord.restores === 1, job.status + ' ' + JSON.stringify(ord));
      t('zero pages (' + label + '): the restored token can start a new job', (await store.claimOrder(token)) === true);
    }
    // At least one page read: no restore.
    {
      const site = makeSite({ pages: 40, status: { '/page9': 429, '/page10': 429 } }); const store = fresh(site);
      const { id, token } = await orderedJob(store);
      await runAll(store, id, site);
      const job = await store.getJob(id); const ord = await store.getOrder(token);
      t('a partial job (pages were read, then 429) keeps its link spent and points at its report', job.status === 'partial' && job.progress.done > 0 && !job.linkRestored && ord.status === 'used' && ord.jobId === id && ord.restores === 0);
    }
    {
      const site = makeSite({ pages: 10 }); const store = fresh(site);
      const { id, token } = await orderedJob(store);
      await runAll(store, id, site);
      const ord = await store.getOrder(token);
      t('a finished job keeps its link spent', (await store.getJob(id)).status === 'done' && ord.status === 'used' && ord.jobId === id && ord.restores === 0);
    }
    // Max 3 restores per order.
    {
      const site = makeSite({ pages: 10, robots: 'User-agent: *\nDisallow: /\n' }); const store = fresh(site);
      let token = null; const results = [];
      for (let i = 0; i < 5; i++) {
        const o = await orderedJob(store, token); token = o.token;
        await runAll(store, o.id, site);
        const ord = await store.getOrder(token);
        results.push(ord.status);
        if (ord.status === 'used') break;
      }
      const ord = await store.getOrder(token);
      t('after 3 restores the 4th failure keeps the link spent', results.join() === 'unused,unused,unused,used' && ord.restores === 3, results.join());
    }
    // A restored token never shows the failed job again.
    {
      const site = makeSite({ pages: 10, robots: 'User-agent: *\nDisallow: /\n' }); const store = fresh(site);
      const { id, token } = await orderedJob(store);
      await runAll(store, id, site);
      const dump = JSON.stringify(store.adapter._dump()['pro:order:' + token]);
      t('the restored order record holds no trace of the failed job id', dump.indexOf(id) === -1, dump);
    }
  }

  /* ---- a page that is not HTML or fails ---- */
  {
    const site = makeSite({ pages: 10, status: { '/page3': 500, '/page4': 404 } }); const store = fresh(site);
    const id = await newJob(store);
    await runAll(store, id, site);
    const job = await store.getJob(id);
    const f = job.pages.filter((p) => p.status === 'failed');
    t('a 500 or a 404 page is recorded as failed with its code', f.length >= 1 && f.every((p) => /^HTTP (500|404)$/.test(p.error)), JSON.stringify(f));
  }

  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.error('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
}()).catch((e) => { console.error(e); process.exit(1); });
