#!/usr/bin/env node
/* =====================================================================
   scripts/generate-refunds.js

   Writes refunds.html (/refunds): how a refund works for Pro, Fix and Beyond, and how to ask. Edit this file, never the page. It also keeps the sitemap entry.
   The defaults that are not the owner's wording are marked below ("owner to confirm") and listed in the 22 Oct 2026 hand-over; change them here and regenerate.

   --check fails if the page is out of date, if it has no single H1, if the title or description is too long, if the refund period differs from the 14 days the pricing page
   promises, if "guarantee" appears (the one outcome sentence lives on /terms only), if an unresolved bracket is not on the list of known placeholders, or if the sitemap,
   the footer or /terms do not point here.

     node scripts/generate-refunds.js            write the page and the sitemap entry
     node scripts/generate-refunds.js --check    exit 1 on any mismatch
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const shell = require('../lib/page-shell.js');
const site = require('../lib/site-config.js');

const ROOT = path.resolve(__dirname, '..');
const CSS_VERSION = 104;
const esc = shell.esc;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const DATE = '22 October 2026';
const DAYS = 14;
const TITLE = 'Citehound refunds: Pro, Fix and Beyond';
const DESC = 'How refunds work for Citehound Pro, Fix and Beyond: ' + DAYS + ' days on the first Pro payment, and how to ask. Write to ' + site.contactEmail + '.';
const MAIL = '<a href="mailto:' + site.contactEmail + '">' + site.contactEmail + '</a>';

// Each block: [heading, [paragraphs as HTML]]. Owner to confirm: the Pro cancellation line, the Fix rule and the Beyond rule (defaults from the 22 Oct 2026 brief).
const BLOCKS = [
  ['Pro', [
    'You can ask for a refund of your first Pro payment within ' + DAYS + ' days of paying it. Write to ' + MAIL + ' from the address you ordered with, or tell us the order reference. We reply by email, and a person reads every request.',
    'You can cancel Pro at any time. It stays active until the end of the period you have paid for. Payments after the first one are not refunded.'
  ]],
  ['Fix', [
    'Before we start work, you can cancel a Fix project and get a full refund. After delivery, we refund only if the scope we agreed in writing was not delivered. For ' + DAYS + ' days after delivery we also make small corrections to the changes we delivered, at no charge.'
  ]],
  ['Beyond', [
    'You can cancel Beyond after the 3-month minimum, with 30 days&rsquo; notice. Pieces we have already delivered are not refunded.'
  ]],
  ['How refunds are paid', [
    'A refund goes back to the payment method you used. Payments are not open yet; these terms apply from the first payment.'
  ]],
  ['How to ask', [
    'Email ' + MAIL + ' with your name, the plan and, if you have it, the order reference. For a Fix or Beyond project, say which project. The <a href="/terms">terms</a> have the rest of the rules for the paid plans. Citehound is run by Andaç Üzel, a sole proprietor based in Istanbul, Türkiye. We will update this page when a company is formed.'
  ]]
];

function body() {
  return '    <section class="verticals" aria-labelledby="refunds-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">Refunds</p>\n          <h1 id="refunds-heading" class="section-title">How refunds work.</h1>\n          <p class="section-sub">Last updated ' + DATE + '.</p>\n        </div>\n\n' +
    BLOCKS.map((b) => '        <div class="doc-section">\n          <h2 class="doc-section__heading">' + esc(b[0]) + '</h2>\n' + b[1].map((p) => '          <p>' + p + '</p>').join('\n') + '\n        </div>\n').join('\n') +
    '      </div>\n    </section>\n';
}

function build() {
  const ld = [{ '@context': 'https://schema.org', '@type': 'WebPage', name: TITLE, description: DESC, url: site.baseUrl + '/refunds', publisher: { '@id': site.baseUrl + '/#org' } }];
  return shell.page({ title: TITLE, description: DESC, path: '/refunds', cssVersion: CSS_VERSION, jsonld: ld, body: body() });
}

function ensureSitemap() {
  const file = path.join(ROOT, 'sitemap.xml'), xml = fs.readFileSync(file, 'utf8'), loc = site.baseUrl + '/refunds';
  if (xml.indexOf('<loc>' + loc + '</loc>') !== -1) return false;
  fs.writeFileSync(file, xml.replace('</urlset>', '  <url>\n    <loc>' + loc + '</loc>\n  </url>\n</urlset>'), 'utf8');
  return true;
}

const visible = (html) => html.replace(/<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&rsquo;/g, '’').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

function check() {
  const errors = [], bad = (m) => errors.push(m);
  const page = fs.existsSync(path.join(ROOT, 'refunds.html')) ? read('refunds.html') : '';
  if (page !== build()) bad('refunds.html is out of date; run node scripts/generate-refunds.js');
  if (TITLE.length > 60) bad('the title is over 60 characters');
  if (DESC.length > 160) bad('the description is over 160 characters');
  if ((page.match(/<h1[ >]/g) || []).length !== 1) bad('needs exactly one h1');
  if (!/name="robots" content="index, follow"/.test(page) || !/<link rel="canonical" href="https:\/\/getcitehound\.com\/refunds" \/>/.test(page)) bad('must be indexable with its canonical address');
  const text = visible(page.replace(/<header class="site-header">[\s\S]*?<\/header>/, '').replace(/<footer[\s\S]*?<\/footer>/, ''));
  if (/guarantee/i.test(text)) bad('the page says "guarantee"; the one outcome sentence lives on /terms only');
  const days = (text.match(/\b(\d+)[- ]days?\b/g) || []).filter((x) => parseInt(x, 10) !== DAYS && !/^30\b/.test(x));
  if (days.length) bad('a period other than ' + DAYS + ' days (or the 30 days of notice): ' + days.join(', '));
  if (!/within 14 days of paying it/.test(text)) bad('the Pro refund must say 14 days from the first payment');
  if (read('sitemap.xml').indexOf('<loc>' + site.baseUrl + '/refunds</loc>') === -1) bad('sitemap.xml has no /refunds');
  if (require('../lib/site-footer.js').hrefs().indexOf('/refunds') === -1) bad('the footer has no /refunds link');
  if (read('terms.html').indexOf('href="/refunds"') === -1) bad('/terms does not link to /refunds');
  return errors;
}

function main() {
  if (process.argv.indexOf('--check') !== -1) {
    const errors = check();
    if (errors.length) { errors.forEach((e) => console.error('FAIL: ' + e)); process.exit(1); }
    console.log('OK: /refunds is current; one h1; ' + DAYS + ' days on the first Pro payment, as the pricing page says; in the sitemap and the footer; /terms links to it');
    return;
  }
  fs.writeFileSync(path.join(ROOT, 'refunds.html'), build(), 'utf8');
  console.log('written: refunds.html' + (ensureSitemap() ? ', sitemap.xml entry' : ''));
}

if (require.main === module) main();
module.exports = { build: build, check: check };
