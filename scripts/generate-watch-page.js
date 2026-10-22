#!/usr/bin/env node
/* =====================================================================
   scripts/generate-watch-page.js

   Writes watch.html (/watch): a small page where the owner of a Pro API key pastes it, sees the plan, adds and removes watched domains and reads the recent events and the score
   history, through /v1/watchlist, /v1/events and /v1/history. It is static (no new function) and its script is watch.js. The key lives in the script's memory only. The page is in the sitemap and is
   linked from /api; it is not in the navigation or the footer. Edit this file, never the page.

   --check fails if the page is out of date, if it makes a claim the brief forbids, if it has no single H1, if a title or description is too long, if the JSON-LD does not parse, if an internal link points
   at a page that does not exist, if the sitemap or /api do not point here, if the footer does, or if watch.js stores the key anywhere (localStorage, sessionStorage, a cookie, IndexedDB, the URL),
   builds HTML from API data, or calls anything but this site's /v1 API.

     node scripts/generate-watch-page.js            write the page and the sitemap entry
     node scripts/generate-watch-page.js --check    exit 1 on any mismatch
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const shell = require('../lib/page-shell.js');
const site = require('../lib/site-config.js');
const Monitor = require('../lib/api-v1/monitor.js');

const ROOT = path.resolve(__dirname, '..');
const CSS_VERSION = 105;
const esc = shell.esc;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const MCFG = Monitor.config({});

const TITLE = 'Watch your domains: Citehound Pro monitoring';
const DESC = 'Paste a Pro API key to watch up to ' + MCFG.watchLimit + ' domains, see their score history and read what changed. The key stays in the page and is never saved.';
const H1 = 'Watch your domains';

function head(kicker, id, title, sub) {
  return '        <div class="section-head">\n          <p class="kicker">' + esc(kicker) + '</p>\n          <h2 id="' + id + '" class="section-title">' + esc(title) + '</h2>\n' + (sub ? '          <p class="section-sub">' + sub + '</p>\n' : '') + '        </div>\n';
}
function table(id, caption, cols, bodyId) {
  return '          <div class="cl-tablewrap" id="' + id + '" hidden>\n            <table class="cl-table cl-table--wrap">\n              <caption class="mcp-vh">' + esc(caption) + '</caption>\n              <thead><tr>' + cols.map((c) => '<th scope="col">' + esc(c) + '</th>').join('') + '</tr></thead>\n              <tbody id="' + bodyId + '"></tbody>\n            </table>\n          </div>\n';
}

function body() {
  return '    <section aria-labelledby="hero-heading">\n      <div class="section__inner">\n        <div class="page-banner">\n          <div class="page-banner__body">\n            <p class="kicker kicker--on-navy">Pro monitoring</p>\n' +
    '            <h1 id="hero-heading" class="page-banner__title">' + esc(H1) + '</h1>\n' +
    '            <p class="page-banner__desc">Add up to ' + MCFG.watchLimit + ' domains. Each is re-scanned about every 7 days, and you see the score history and what changed. This page uses your Pro API key and the same <a href="/api#monitoring">monitoring API</a> you can call yourself.</p>\n' +
    '          </div>\n        </div>\n      </div>\n    </section>\n\n' +

    '    <section class="cl-sec hp-light" id="connect" aria-labelledby="connect-heading">\n      <div class="section__inner">\n' + head('Your key', 'connect-heading', 'Paste your Pro key.', 'The key stays in this page&rsquo;s memory. It is not saved in the browser, and it goes only to this site&rsquo;s API. Reload the page and it is gone. Get a key on the <a href="/api#key">API page</a>.') +
    '        <form class="ps-form wl-form" id="wKeyForm" novalidate>\n          <div class="ps-field"><label for="wKey" class="ps-label">API key</label><input class="field ps-input" id="wKey" name="key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="64" aria-describedby="wKeyError" required /><p class="ps-error" id="wKeyError" hidden></p></div>\n' +
    '          <p class="ps-actions"><button type="submit" class="btn btn--gold ps-submit" id="wConnect">Connect</button></p>\n          <p class="wl-status" id="wKeyStatus" role="status" aria-live="polite" tabindex="-1"></p>\n        </form>\n' +
    '        <noscript><p class="ps-note">This page needs JavaScript. Without it, use the <a href="/api#monitoring">API</a> directly.</p></noscript>\n' +
    '      </div>\n    </section>\n\n' +

    '    <section class="cl-sec hp-light" id="wPanel" aria-labelledby="wPanelHead" hidden>\n      <div class="section__inner">\n' +
    '        <div class="section-head">\n          <p class="kicker">Connected</p>\n          <h2 id="wPanelHead" class="section-title" tabindex="-1">Your watchlist</h2>\n          <p class="section-sub" id="wPlan"></p>\n          <p><button type="button" class="btn btn--ghost" id="wForget">Forget this key</button></p>\n        </div>\n' +
    '        <div id="wFree" hidden>\n          <p class="cl-limits">Monitoring is part of the Pro plan, and this key is on the free plan. Pro keys are set up by us: write to <a href="mailto:' + esc(site.contactEmail) + '">' + esc(site.contactEmail) + '</a> to ask. The free key still works for scans and generators on the <a href="/api">API page</a>.</p>\n        </div>\n' +
    '        <div id="wPro" hidden>\n' +
    '          <h3 class="cl-h3">Add a domain</h3>\n          <p class="cl-note">The first scan runs when you add it and becomes the baseline. After that, a scheduled job re-scans the homepage, robots.txt and llms.txt when the domain is due. Give an alert address (the one this key was sent to) to get an email when the score drops, an AI crawler becomes blocked or llms.txt disappears.</p>\n' +
    '          <form class="ps-form wl-form" id="wAddForm" novalidate>\n            <div class="ps-field"><label for="wDomain" class="ps-label">Domain</label><input class="field ps-input" id="wDomain" name="domain" type="text" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" maxlength="253" placeholder="example.com" aria-describedby="wDomainError" required /><p class="ps-error" id="wDomainError" hidden></p></div>\n' +
    '            <div class="ps-field"><label for="wEmail" class="ps-label">Alert email <span class="wl-opt">(optional)</span></label><input class="field ps-input" id="wEmail" name="alert_email" type="email" inputmode="email" autocapitalize="off" autocomplete="off" maxlength="254" aria-describedby="wEmailError" /><p class="ps-error" id="wEmailError" hidden></p></div>\n' +
    '            <p class="ps-actions"><button type="submit" class="btn btn--gold ps-submit" id="wAdd">Watch this domain</button></p>\n            <p class="wl-status" id="wAddStatus" role="status" aria-live="polite" tabindex="-1"></p>\n          </form>\n' +
    '          <h3 class="cl-h3">Watched domains</h3>\n          <p class="cl-note" id="wUsed" role="status"></p>\n          <p class="cl-note" id="wListEmpty" hidden>No domains yet. Add one above.</p>\n' +
    table('wListWrap', 'Watched domains', ['Domain', 'Score', 'Last scan', 'Next scan after', 'Alerts', 'Actions'], 'wListBody') +
    '          <div id="wHistBox" hidden>\n            <h3 class="cl-h3" id="wHistTitle" tabindex="-1">Score history</h3>\n            <p class="cl-note" id="wHistStatus" role="status" aria-live="polite"></p>\n' +
    '            <div class="cl-tablewrap">\n              <table class="cl-table cl-table--wrap">\n                <caption class="mcp-vh">Stored scans of the domain, newest first</caption>\n                <thead><tr><th scope="col">Scanned</th><th scope="col">Score</th><th scope="col">Checks failing</th><th scope="col">Crawlers blocked</th><th scope="col">llms.txt</th></tr></thead>\n                <tbody id="wHistBody"></tbody>\n              </table>\n            </div>\n            <p><button type="button" class="btn btn--ghost" id="wHistClose">Close history</button></p>\n          </div>\n' +
    '          <h3 class="cl-h3">Recent events</h3>\n          <p class="cl-note" id="wEvStatus" role="status" aria-live="polite"></p>\n          <p class="cl-note" id="wEvEmpty">Nothing has changed yet. Events appear after the second scan of a domain.</p>\n' +
    table('wEvWrap', 'Recent events, newest first', ['When', 'Domain', 'Event', 'What changed'], 'wEvBody') +
    '          <p><button type="button" class="btn btn--ghost" id="wEvMore" hidden>Show older events</button></p>\n' +
    '        </div>\n      </div>\n    </section>\n\n' +

    '    <section class="home-faq hp-light" aria-labelledby="faq-heading">\n      <div class="section__inner">\n' + head('Good to know', 'faq-heading', 'What this page does.') +
    '        <div class="ac-faq">\n          <details>\n            <summary>Where does my key go?</summary>\n            <p>It is held in this page&rsquo;s memory and sent, as a Bearer token, to this site&rsquo;s <code>/v1</code> API with each request. It is not written to localStorage, sessionStorage, a cookie or the address bar. Closing or reloading the page forgets it, and so does the button &ldquo;Forget this key&rdquo;.</p>\n          </details>\n' +
    '          <details>\n            <summary>What does it scan?</summary>\n            <p>The homepage, robots.txt and llms.txt of each watched domain, not the whole site. The score is a readiness score: crawler access and on-page signals. It does not measure whether any assistant names a brand.</p>\n          </details>\n' +
    '          <details>\n            <summary>Do these requests count against my limits?</summary>\n            <p>Yes. Each action here is an API request, so it counts toward the hourly and daily limits of the key, and adding a domain counts as a scan of that domain.</p>\n          </details>\n        </div>\n        <p class="cl-contact">Questions: <a href="mailto:' + esc(site.contactEmail) + '">' + esc(site.contactEmail) + '</a></p>\n      </div>\n    </section>\n';
}

function build() {
  const ld = [{ '@context': 'https://schema.org', '@type': 'WebPage', name: TITLE, description: DESC, url: site.baseUrl + '/watch', publisher: { '@id': site.baseUrl + '/#org' } }];
  return shell.page({ title: TITLE, description: DESC, path: '/watch', cssVersion: CSS_VERSION, headExtra: '  <script src="/watch.js?v=1" defer></script>\n', jsonld: ld, body: body() });
}

function ensureSitemap() {
  const file = path.join(ROOT, 'sitemap.xml'), xml = fs.readFileSync(file, 'utf8'), loc = site.baseUrl + '/watch';
  if (xml.indexOf('<loc>' + loc + '</loc>') !== -1) return false;
  fs.writeFileSync(file, xml.replace('</urlset>', '  <url>\n    <loc>' + loc + '</loc>\n  </url>\n</urlset>'), 'utf8');
  return true;
}

const visible = (html) => html.replace(/<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const FORBIDDEN = /\b(recommend(s|ed|ation|ations)?|cites|cited by|guarantee[sd]?|partners?|official(ly)?|verified|WordPress|Webflow|GitHub|Shopify|Zapier|Wix|Squarespace|HubSpot|Slack|unlock|supercharge|seamless(ly)?|game-changing|revolutioni[sz]e|robust|crucial|delve|landscape|ranking|rankings|ranks|unlimited)\b/i;

function pageExists(href) {
  const p = href.replace(/[?#].*$/, '');
  if (p === '' || p === '/') return true;
  if (/^\/(api|v1|r|demo|w|admin|openapi\.yaml)\b/.test(p)) return true;
  const rel = p.replace(/^\//, '').replace(/\/$/, '');
  return fs.existsSync(path.join(ROOT, rel + '.html')) || fs.existsSync(path.join(ROOT, rel, 'index.html')) || fs.existsSync(path.join(ROOT, rel));
}

function check() {
  const errors = [], bad = (m) => errors.push(m);
  const page = fs.existsSync(path.join(ROOT, 'watch.html')) ? read('watch.html') : '';
  if (page !== build()) bad('watch.html is out of date; run node scripts/generate-watch-page.js');
  if (TITLE.length > 60) bad('the title is ' + TITLE.length + ' characters, over 60');
  if (DESC.length < 120 || DESC.length > 160) bad('the description is ' + DESC.length + ' characters, not 120 to 160');
  if ((page.match(/<h1[ >]/g) || []).length !== 1) bad('needs exactly one h1');
  if (!/<link rel="canonical" href="https:\/\/getcitehound\.com\/watch" \/>/.test(page)) bad('no canonical address');
  (page.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []).forEach((b) => { try { JSON.parse(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { bad('JSON-LD does not parse: ' + e.message); } });
  const text = visible(page.replace(/<header class="site-header">[\s\S]*?<\/header>/, '').replace(/<footer[\s\S]*?<\/footer>/, ''));
  const hit = FORBIDDEN.exec(text); if (hit) bad('a word the brief forbids is on the page: "' + hit[0] + '"');
  if (!/does not measure whether any assistant names a brand/.test(text)) bad('the page must say the score does not measure whether any assistant names a brand');
  if ((text.match(/—|&mdash;/g) || []).length > 2) bad('too many em dashes for the voice');
  (page.match(/href="(\/[^"]*)"/g) || []).forEach((m) => { const h = m.slice(6, -1); if (!pageExists(h)) bad('an internal link points at a page that does not exist: ' + h); });
  if (!/type="password"[^>]*autocomplete="off"/.test(page)) bad('the key field must be a password field with autocomplete off');
  ['aria-live="polite"'].forEach((x) => { if (page.indexOf(x) === -1) bad('missing ' + x); });
  if (read('sitemap.xml').indexOf('<loc>' + site.baseUrl + '/watch</loc>') === -1) bad('sitemap.xml has no /watch');
  if (!/href="\/watch"/.test(read('api.html'))) bad('/api does not link to /watch');
  if (require('../lib/site-footer.js').hrefs().indexOf('/watch') !== -1) bad('the footer must not link to /watch');
  if (/href="\/watch"/.test(page.match(/<header class="site-header">[\s\S]*?<\/header>/)[0])) bad('the navigation must not link to /watch');
  const js = read('watch.js').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  if (/localStorage|sessionStorage|indexedDB|document\.cookie|history\.(push|replace)State|location\.(hash|search|href)\s*=/.test(js)) bad('watch.js stores something or writes the address bar');
  if (/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(js)) bad('watch.js builds HTML or runs code from data');
  const urls = (js.match(/api\('(GET|POST|DELETE)', '([^']*)'/g) || []).map((x) => x.replace(/api\('[A-Z]+', '/, '').replace(/'$/, ''));
  if (!urls.length || urls.some((u) => !/^\/v1\//.test(u))) bad('watch.js must call only this site\'s /v1 API: ' + urls.join(', '));
  if (/fetch\(\s*['"]https?:/.test(js) || /XMLHttpRequest|WebSocket|sendBeacon/.test(js)) bad('watch.js must make no request to another site');
  if (!/credentials: 'omit'/.test(js) || !/referrerPolicy: 'no-referrer'/.test(js)) bad('watch.js must send no cookies and no referrer');
  return errors;
}

function main() {
  if (process.argv.indexOf('--check') !== -1) {
    const errors = check();
    if (errors.length) { errors.forEach((e) => console.error('FAIL: ' + e)); process.exit(1); }
    console.log('OK: /watch is current; one h1; no forbidden claim; the key is kept in memory only (no storage, no cookie, no address bar), data is shown as text, only /v1 is called; in the sitemap and linked from /api, not in the footer or the navigation');
    return;
  }
  fs.writeFileSync(path.join(ROOT, 'watch.html'), build(), 'utf8');
  console.log('written: watch.html' + (ensureSitemap() ? ', sitemap.xml entry' : ''));
}

if (require.main === module) main();
module.exports = { build: build, check: check };
