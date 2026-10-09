/* =====================================================================
   scripts/pro-fake-site.js: a pretend website for developing Citehound Pro.

   A fetch function with the same shape as lib/pro-fetch.js safeGet, backed by
   pages generated in memory: a robots.txt, a sitemap and N pages whose
   signals (title, canonical, JSON-LD, headings ...) vary the way a real site's
   do. Used by scripts/pro-dev-server.js and the screenshot run; no network.
   ===================================================================== */

'use strict';

function rng(seed) { let s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// opts: { domain, pages, seed, blocked: [paths], missing: [paths], noLlms, delayMs, sleep }
function makeFakeSite(opts) {
  const domain = opts.domain || 'demo-site.com';
  const origin = 'https://' + domain;
  const n = opts.pages || 30;
  const rand = rng(opts.seed || 7);
  const sections = ['blog', 'docs', 'products', 'company'];
  const paths = ['/', '/pricing', '/about', '/contact'];
  for (let i = 0; paths.length < n; i++) paths.push('/' + sections[i % sections.length] + '/' + ['getting-started', 'how-it-works', 'faq', 'changelog', 'guide', 'overview', 'security', 'integrations', 'case-study', 'release-notes'][Math.floor(i / sections.length) % 10] + (i >= 40 ? '-' + i : ''));
  const log = [];
  const files = {};
  files[origin + '/robots.txt'] = 'User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /cart/\n\nUser-agent: GPTBot\nDisallow: /private/\n\nSitemap: ' + origin + '/sitemap.xml\n';
  files[origin + '/sitemap.xml'] = '<?xml version="1.0" encoding="UTF-8"?><urlset>' + paths.map((p) => '<url><loc>' + origin + p + '</loc></url>').join('') + '</urlset>';
  if (!opts.noLlms) files[origin + '/llms.txt'] = null;
  paths.forEach((p, i) => {
    const r = rand();
    const has = (k) => rand() < k;
    const title = p === '/' ? domain.split('.')[0] + ': the home page of the demo site' : (has(0.9) ? 'Demo ' + p.replace(/[/-]/g, ' ').trim() + ' page for the demo site' : 'Demo');
    const desc = has(0.6) ? 'A description of ' + p + ' on the demo site that is long enough to pass the length rule of the scanner.' : '';
    let h = '<!DOCTYPE html><html' + (has(0.85) ? ' lang="en"' : '') + '><head><meta charset="utf-8"><title>' + title + '</title>';
    if (desc) h += '<meta name="description" content="' + desc + '">';
    if (has(0.5)) h += '<link rel="canonical" href="' + origin + p + '">';
    if (has(0.7)) h += '<meta property="og:title" content="x"><meta property="og:description" content="y">';
    if (p === '/' || has(0.15)) h += '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Demo"}</script>';
    if (p.indexOf('/blog/') === 0 && has(0.4)) h += '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"x"}</script>';
    h += '</head><body><h1>' + title + '</h1>' + (has(0.55) ? '<h2>First</h2><h2>Second</h2>' : '') + (has(0.35) ? '<a href="/about">About us</a>' : '') + (has(0.45) ? '<a href="/contact">Contact</a>' : '') + '<p>' + 'Text. '.repeat(20) + '</p></body></html>';
    files[origin + p] = h;
    void r;
  });
  const blocked = (opts.blocked || []).map((p) => origin + p);
  const missing = (opts.missing || []).map((p) => origin + p);
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  async function fetch(url, o) {
    log.push({ url: url, ua: o && o.ua });
    if (opts.delayMs) await sleep(opts.delayMs);
    if (blocked.indexOf(url) !== -1) return { ok: false, status: 403, text: 'Forbidden', headers: { server: 'cloudflare' }, finalUrl: url };
    if (missing.indexOf(url) !== -1) return { ok: false, status: 404, text: '', headers: {}, finalUrl: url };
    const body = files[url];
    if (body === undefined || body === null) return { ok: false, status: 404, text: '', headers: {}, finalUrl: url };
    return { ok: true, status: 200, text: body, contentType: /\.(xml)$/.test(url) ? 'application/xml' : (/\.txt$/.test(url) ? 'text/plain' : 'text/html'), headers: {}, finalUrl: url };
  }
  return { fetch: fetch, log: log, files: files, paths: paths, domain: domain, origin: origin };
}

module.exports = { makeFakeSite: makeFakeSite };
