#!/usr/bin/env node
/* =====================================================================
   scripts/generate-readiness.js

   Writes research/state-of-ai-readiness.html (served at /research/state-of-ai-readiness): the public page for the gated State of AI Readiness
   report. Four headline findings with their scan dates, how it was measured, what it does not show, and the signup form that emails a signed link
   to the PDF. The page is indexable. The PDF is not on this site: it is in the database and is served only to a signed, expiring link
   (lib/readiness.js, lib/readiness-api.js).

   Every figure on the page comes from content/readiness.json, whose numbers are re-checked against the stored benchmark data by
   scripts/test-readiness-figures.js (and against the PDF's own text when it is run by hand). --check fails if the page is out of date, if a
   figure listed in the content file is missing from the page, or if the page makes a claim the report does not support.

     node scripts/generate-readiness.js            write the page and its sitemap entry
     node scripts/generate-readiness.js --check    exit 1 on any mismatch
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const shell = require('../lib/page-shell.js');
const site = require('../lib/site-config.js');
const icons = require('../lib/icons.js');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'research', 'state-of-ai-readiness.html');
const CSS_VERSION = 102;
const SCRIPT_VERSION = 1;
const PATHNAME = '/research/state-of-ai-readiness';
const content = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'readiness.json'), 'utf8'));
const esc = shell.esc;

const DESC = 'How ready are ' + content.sample.scored + ' well-known websites for AI crawlers? Four findings from a benchmark scanned ' + content.sample.scanWindow + ', and the eight-page report by email.';


// The cover of the PDF, next to the form on a wide screen and above it on a narrow one. Optimized copies live in assets/research/ (the original is not
// served): WebP at 480 and 960 pixels wide, PNG at 480 as the fallback. Explicit width and height, so the page does not move when it loads. Below the
// fold on every screen, so it is lazy-loaded.
const COVER = '        <figure class="sr-cover">\n          <picture>\n' +
  '            <source type="image/webp" srcset="/assets/research/state-of-ai-readiness-cover-480.webp 480w, /assets/research/state-of-ai-readiness-cover-960.webp 960w" sizes="(max-width: 700px) 190px, 300px" />\n' +
  '            <img src="/assets/research/state-of-ai-readiness-cover-480.png" width="480" height="686" alt="Cover of the report State of AI Readiness, Launch Edition 2026: a benchmark of 219 well-known websites in six categories, scanned 29 to 31 July 2026." loading="lazy" decoding="async" />\n' +
  '          </picture>\n        </figure>\n';

function build() {
  const s = content.sample;
  const findings = content.findings.map((f) =>
    '          <li class="sr-finding">\n            <p class="sr-finding__date">' + esc(f.date) + '</p>\n            <h3 class="sr-finding__headline">' + esc(f.headline) + '</h3>\n            <p class="sr-finding__body">' + esc(f.body) + '</p>\n          </li>').join('\n');
  const li = (arr) => arr.map((t) => '            <li>' + esc(t) + '</li>').join('\n');
  const body = shell.banner({
    kicker: 'Research · Launch Edition 2026',
    title: 'State of AI Readiness',
    desc: 'How ready are ' + s.scored + ' well-known websites for AI crawlers and assistants? A benchmark across ' + ['zero', 'one', 'two', 'three', 'four', 'five', 'six'][s.categories] + ' categories, scanned ' + s.scanWindow + '.',
    icon: icons.svg('report', {})
  }) +
  '\n    <section class="verticals sr-section" aria-labelledby="sr-findings-h">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">Findings</p>\n          <h2 id="sr-findings-h" class="section-title">Four findings.</h2>\n' +
  '          <p class="section-sub">From ' + esc(s.scored) + ' scored sites. Each figure is a count or an average of our own scan, on the dates shown. ' + esc(content.honestFraming) + '</p>\n        </div>\n' +
  '        <ol class="sr-findings">\n' + findings + '\n        </ol>\n      </div>\n    </section>\n' +
  '\n    <section class="verticals sr-section" aria-labelledby="sr-method-h">\n      <div class="section__inner">\n        <div class="sr-cols">\n' +
  '          <div>\n            <h2 id="sr-method-h" class="sr-h2">How we measured it</h2>\n            <ul class="sr-list">\n' + li(content.method) + '\n            </ul>\n          </div>\n' +
  '          <div>\n            <h2 class="sr-h2">What it does not show</h2>\n            <ul class="sr-list">\n' + li(content.limits) + '\n            </ul>\n          </div>\n' +
  '        </div>\n        <p class="ps-note sr-note">The scoring is public: <a href="/methodology">the methodology</a> lists all ' + esc(s.checks) + ' checks and their points.</p>\n      </div>\n    </section>\n' +
  '\n    <section class="verticals pro-waitlist sr-signup" id="get-the-report" aria-labelledby="sr-form-h">\n      <div class="section__inner">\n        <div class="sr-get">\n' + COVER +
  '        <div class="pro-waitlist__box">\n' +
  '          <p class="kicker">Free report</p>\n          <h2 id="sr-form-h" class="section-title">Get the full report by email.</h2>\n' +
  '          <p class="section-sub">Eight pages: the typical score, the six categories, where the points go, AI crawler access, signals by category, the sites we could not scan, and the limits. Free. We send a link to the PDF.</p>\n' +
  '          <p class="ps-note sr-unavailable" id="srUnavailable" role="status" hidden>The report is not available right now. Check back soon.</p>\n' +
  '          <form class="ps-form wl-form" id="srForm" novalidate>\n' +
  '            <div class="ps-field"><label for="srEmail" class="ps-label">Email</label><input class="field ps-input" id="srEmail" name="email" type="email" inputmode="email" autocapitalize="off" autocomplete="email" maxlength="254" aria-describedby="srEmailError" required /><p class="ps-error" id="srEmailError" hidden></p></div>\n' +
  '            <div class="wl-trap" aria-hidden="true"><label>Company fax <input type="text" name="company_fax" tabindex="-1" autocomplete="off" /></label></div>\n' +
  '            <div class="ps-field ps-field--check"><label class="ps-check" for="srSend"><input id="srSend" name="sendReport" type="checkbox" aria-describedby="srSendError" required /><span>Send me the report</span></label><p class="ps-error" id="srSendError" hidden></p></div>\n' +
  '            <div class="ps-field ps-field--check"><label class="ps-check" for="srUpdates"><input id="srUpdates" name="updates" type="checkbox" /><span>Also send occasional Citehound updates <span class="wl-opt">(optional)</span></span></label></div>\n' +
  '            <p class="ps-note">What we store: your address, the time you asked and whether you ticked the second box. We keep it for up to 12 months, to email you the report link and so that you can ask again, then delete it. The link in the email works for 30 days and contains no address. We send at most three report emails a day to one address. Every email has a link that deletes your address at once. The email carries no tracking pixel and no open or click tracking, and it is sent through Resend. The second box is separate and off unless you tick it. See the <a href="/privacy">privacy page</a>.</p>\n' +
  '            <p class="ps-actions"><button type="submit" class="btn btn--gold ps-submit" id="srSubmit">Email me the report</button></p>\n' +
  '            <p class="wl-status" id="srStatus" role="status" aria-live="polite" tabindex="-1"></p>\n          </form>\n' +
  '          <noscript><p class="ps-note">The form needs JavaScript. Without it, write to <a href="mailto:' + esc(site.contactEmail) + '">' + esc(site.contactEmail) + '</a> and ask for the report.</p></noscript>\n' +
  '        </div>\n        </div>\n        <p class="ps-note sr-note">Want your own site’s numbers instead? <a href="/">Run the free scan</a>. It applies the same ' + esc(s.checks) + ' checks to your homepage.</p>\n      </div>\n    </section>\n' +
  '\n    <script src="/report-signup.js?v=' + SCRIPT_VERSION + '" defer></script>\n';
  return shell.page({
    title: 'Citehound — State of AI Readiness: Launch Edition 2026',
    description: DESC,
    path: PATHNAME,
    depth: 1,
    cssVersion: CSS_VERSION,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'Article',
      '@id': site.baseUrl + PATHNAME + '#article',
      headline: content.title,
      description: DESC,
      author: { '@id': site.baseUrl + '/about#person' }, publisher: { '@id': site.baseUrl + '/#org' },
      datePublished: '2026-10-11', dateModified: '2026-10-11',
      url: site.baseUrl + PATHNAME, mainEntityOfPage: site.baseUrl + PATHNAME
    }],
    body: body
  });
}

function ensureSitemap() {
  const file = path.join(ROOT, 'sitemap.xml');
  const xml = fs.readFileSync(file, 'utf8');
  const loc = site.baseUrl + PATHNAME;
  if (xml.indexOf('<loc>' + loc + '</loc>') !== -1) return false;
  fs.writeFileSync(file, xml.replace('</urlset>', '  <url>\n    <loc>' + loc + '</loc>\n  </url>\n</urlset>'), 'utf8');
  return true;
}

function check() {
  const errors = [];
  const bad = (m) => errors.push(m);
  const page = fs.existsSync(PAGE) ? fs.readFileSync(PAGE, 'utf8') : '';
  if (page !== build()) bad('research/state-of-ai-readiness.html is out of date; run node scripts/generate-readiness.js');
  const text = page.replace(/<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
  content.figures.forEach((f) => { if (text.indexOf(f.shown) === -1) bad('the figure "' + f.label + '" (' + f.shown + ') is in content/readiness.json but not on the page'); });
  if ((page.match(/<h1[ >]/g) || []).length !== 1) bad('the page needs exactly one h1');
  if (!/name="robots" content="index, follow"/.test(page)) bad('the teaser page must be indexable');
  if (/\.pdf|href="[^"]*readiness\/download/i.test(page)) bad('the page must not link to a PDF or a download address');
  // The form: the two checkboxes as the brief words them, the second separate, optional and unchecked.
  if (!/<span>Send me the report<\/span>/.test(page) || !/id="srSend"[^>]*required/.test(page)) bad('the first checkbox must read "Send me the report" and be required');
  if (!/<span>Also send occasional Citehound updates <span class="wl-opt">\(optional\)<\/span><\/span>/.test(page) || /id="srUpdates"[^>]*(required|checked)/.test(page)) bad('the second checkbox must read "Also send occasional Citehound updates", be optional and unchecked');
  if (!/name="company_fax"/.test(page)) bad('the honeypot is missing');
  if (!/<img src="\/assets\/research\/state-of-ai-readiness-cover-480\.png" width="480" height="686" alt="Cover of the report State of AI Readiness/.test(page)) bad('the cover image needs its fallback, width, height and alt text');
  ['480.webp', '960.webp', '480.png'].forEach((f) => { if (!fs.existsSync(path.join(ROOT, 'assets', 'research', 'state-of-ai-readiness-cover-' + f))) bad('assets/research/state-of-ai-readiness-cover-' + f + ' is missing'); });
  // The honest-framing rule: no claim about citations, answers, rankings or causes.
  const claims = /\b(proven|prove[sd]?|guarantee[sd]?|will (?:improve|boost|increase|raise)|improves? (?:your )?(?:citations|visibility|ranking)|cited more|more citations|ranking[s]? (?:factor|signal))\b/i;
  if (claims.test(text)) bad('the page makes a claim the report does not support: ' + claims.exec(text)[0]);
  if (!/does not measure whether any assistant names or cites a site/.test(text)) bad('the page must say what the score does not measure');
  if (/\b(quietly|actually|seamlessly|effortless|powerful|unlock|elevate|supercharge|game-changing|revolutioni[sz]e|landscape|delve|crucial|robust|coming soon)\b/i.test(text)) bad('a banned word is on the page');
  if (fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').indexOf('<loc>' + site.baseUrl + PATHNAME + '</loc>') === -1) bad('sitemap.xml has no ' + PATHNAME);
  return errors;
}

function main() {
  if (process.argv.indexOf('--check') !== -1) {
    const errors = check();
    if (errors.length) { errors.forEach((e) => console.error('FAIL: ' + e)); process.exit(1); }
    console.log('OK: the State of AI Readiness page is current, indexable, in the sitemap, carries every listed figure and no claim beyond the report');
    return;
  }
  fs.writeFileSync(PAGE, build(), 'utf8');
  console.log('research/state-of-ai-readiness.html written; ' + (ensureSitemap() ? 'added to sitemap.xml' : 'already in sitemap.xml'));
}

if (require.main === module) main();
module.exports = { build: build, DESC: DESC };
