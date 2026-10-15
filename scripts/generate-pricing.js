#!/usr/bin/env node
/* =====================================================================
   scripts/generate-pricing.js

   Writes pricing.html (/pricing) and the pricing section of the homepage (between <!-- PRICING:START --> and <!-- PRICING:END --> in index.html) from
   content/pricing.json through lib/pricing.js, and keeps the sitemap and llms.txt entries. Edit the JSON, never the markup.

   --check fails if a page or the section is out of date, if a price line on a ladder card or on /pro, /fix or /beyond differs from the JSON, if the copy
   uses a word the brief bans (CMS connectors, "tracks all", ranking, share of voice, unlimited, a crossed-out price), names ChatGPT as a live engine
   while the JSON says it is coming, carries the no-guarantee sentence anywhere but /terms (exactly once there), or if a button is a checkout.

     node scripts/generate-pricing.js            write the page, the homepage section, the sitemap and llms.txt entries
     node scripts/generate-pricing.js --check    exit 1 on any mismatch
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const shell = require('../lib/page-shell.js');
const site = require('../lib/site-config.js');
const dialog = require('../lib/request-dialog.js');
const Pricing = require('../lib/pricing.js');

const ROOT = path.resolve(__dirname, '..');
const CSS_VERSION = 96;
const D = Pricing.DATA;
const esc = Pricing.esc;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const START = '<!-- PRICING:START -->', END = '<!-- PRICING:END -->';
const NO_GUARANTEE = 'Citehound makes no guarantee about citations, traffic, rankings or revenue.';

function head(kicker, id, title, sub) {
  return '        <div class="section-head">\n          <p class="kicker">' + esc(kicker) + '</p>\n          <h2 id="' + id + '" class="section-title">' + esc(title) + '</h2>\n' + (sub ? '          <p class="pr-sub">' + esc(sub) + '</p>\n' : '') + '        </div>\n';
}

// The homepage section: the staircase and a link to the page.
function homeSection() {
  return START + '\n      <section class="pricing hp-light" id="pricing" aria-labelledby="pricing-heading">\n        <div class="section__inner">\n' +
    head('Early-access pricing', 'pricing-heading', 'Pay for the step you need.', D.sub).replace(/^ {8}/gm, '        ') +
    Pricing.staircase('home') + '        <p class="pr-foot"><a class="pr-foot__link" href="/pricing">See the full pricing page</a></p>\n        </div>\n      </section>\n      ' + END;
}

function faq() {
  return '    <section class="home-faq hp-light" id="faq" aria-labelledby="faq-heading">\n      <div class="section__inner">\n' + head('Questions', 'faq-heading', 'About the prices.').replace(/^ {8}/gm, '        ') + '        <div class="ac-faq">\n' +
    Pricing.faq().map((f) => '          <details>\n            <summary>' + esc(f.q) + '</summary>\n            <p>' + esc(f.a) + '</p>\n          </details>').join('\n') + '\n        </div>\n      </div>\n    </section>\n';
}

function build() {
  const body =
    '    <section aria-labelledby="hero-heading">\n      <div class="section__inner">\n        <div class="page-banner pr-banner">\n          <div class="page-banner__body">\n' +
    '            <p class="kicker kicker--on-navy">Pricing</p>\n            <h1 id="hero-heading" class="page-banner__title">' + esc(D.h1) + '</h1>\n            <p class="page-banner__desc">' + esc(D.sub) + '</p>\n          </div>\n        </div>\n      </div>\n    </section>\n\n' +
    '    <section class="pricing hp-light" id="pricing" aria-labelledby="pricing-heading">\n      <div class="section__inner">\n' + head('Four steps', 'pricing-heading', 'Start with the scan. Go as far as you need.') + Pricing.staircase('page') + '      </div>\n    </section>\n\n' +
    '    <section class="pr-measure hp-light" aria-labelledby="measure-heading">\n      <div class="section__inner">\n        <div class="pr-measure__panel">\n          <h2 id="measure-heading" class="pr-measure__title">What each step measures</h2>\n          <p class="pr-measure__text">' + esc(Pricing.measure()) + '</p>\n        </div>\n      </div>\n    </section>\n\n' +
    faq() + '\n' +
    '    <section class="home-close hp-light" aria-labelledby="close-heading">\n      <div class="section__inner">\n        <div class="home-close__panel">\n          <div>\n            <h2 id="close-heading" class="home-close__title">' + esc(D.closeTitle) + '</h2>\n            <p class="home-close__text">' + esc(D.closeText) + '</p>\n          </div>\n          <div class="home-close__actions">\n            <a class="btn btn--primary" href="/#scan">Scan free</a>\n            <a class="home-close__link" href="/pro#waitlist" data-pro-cta data-label-checkout="Get Citehound Pro">Join the Pro waitlist</a>\n          </div>\n        </div>\n      </div>\n    </section>\n\n' +
    '    ' + dialog.html('    ') + '\n';
  const ld = [
    { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Citehound pricing', description: D.description, url: site.baseUrl + D.path, publisher: { '@id': site.baseUrl + '/#org' } },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: Pricing.faq().map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }
  ];
  return shell.page({
    title: D.title, description: D.description, path: D.path, cssVersion: CSS_VERSION,
    headExtra: '  <script src="/request-form.js?v=1" defer></script>\n  <script src="/pro-cta.js?v=1" defer></script>\n  <script src="/pricing.js?v=1" defer></script>\n', jsonld: ld, body: body
  });
}

function withHome(html) {
  const sec = homeSection();
  if (html.indexOf(START) !== -1) return html.replace(new RegExp(START + '[\\s\\S]*?' + END), () => sec);
  // First write: the section goes between the product tour and the proof band.
  const at = html.indexOf('      <!-- ---------- Proof: the AgaOne case study');
  if (at === -1) throw new Error('index.html has no proof band marker to place the pricing section before');
  return html.slice(0, at) + sec + '\n\n' + html.slice(at);
}

function ensureSitemap() {
  const file = path.join(ROOT, 'sitemap.xml'), xml = fs.readFileSync(file, 'utf8'), loc = site.baseUrl + D.path;
  if (xml.indexOf('<loc>' + loc + '</loc>') !== -1) return false;
  fs.writeFileSync(file, xml.replace('</urlset>', '  <url>\n    <loc>' + loc + '</loc>\n  </url>\n</urlset>'), 'utf8');
  return true;
}

const LLMS_LINE = () => '- [Pricing](' + site.baseUrl + '/pricing): early-access pricing, payments open soon. Scan: free, no sign-up. Pro: $39 a month or $390 a year (first month free for the first 10 early-access users). Fix: from $299, a fixed quote after your scan, includes 3 months of Pro. Beyond: $490 a month, 3-month minimum, limited seats, includes Pro.\n';
function ensureLlms() {
  const file = path.join(ROOT, 'llms.txt'), t = fs.readFileSync(file, 'utf8');
  const re = /^- \[Pricing\]\([^)]*\)[^\n]*\n/m;
  if (re.test(t)) { const n = t.replace(re, LLMS_LINE()); if (n === t) return false; fs.writeFileSync(file, n, 'utf8'); return true; }
  const anchor = '## About\n\n';
  if (t.indexOf(anchor) === -1) throw new Error('llms.txt has no About section');
  fs.writeFileSync(file, t.replace(anchor, anchor + LLMS_LINE()), 'utf8');
  return true;
}

const visible = (html) => html.replace(/<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/&middot;/g, '·').replace(/\s+/g, ' ');
const BANNED = /\b(quietly|actually|seamlessly|effortless(ly)?|powerful|unlock|elevate|supercharge|game-changing|revolutioni[sz]e|landscape|delve|crucial|robust|coming soon)\b/i;
const BRIEF_BANNED = /automatic(ally)? CMS|CMS connector|tracks all|share of voice|\bunlimited\b|\branking\b|\brankings?\b(?! or revenue)|\bwas \$|<s>|<del>|line-through/i;

function check() {
  const errors = [], bad = (m) => errors.push(m);
  const home = read('index.html');
  const page = fs.existsSync(path.join(ROOT, 'pricing.html')) ? read('pricing.html') : '';
  if (page !== build()) bad('pricing.html is out of date; run node scripts/generate-pricing.js');
  if (withHome(home) !== home) bad('the pricing section of index.html is out of date; run node scripts/generate-pricing.js');
  if (dialog.normalize(page) !== page) bad('the form in pricing.html differs from lib/request-dialog.js');
  if (!/name="robots" content="index, follow"/.test(page)) bad('pricing.html must be indexable');
  if ((page.match(/<h1[ >]/g) || []).length !== 1) bad('pricing.html needs exactly one h1');
  if (!/<link rel="canonical" href="https:\/\/getcitehound\.com\/pricing" \/>/.test(page)) bad('pricing.html has no canonical address');
  if (D.description.length > 160) bad('the pricing description is over 160 characters');
  if (read('sitemap.xml').indexOf('<loc>' + site.baseUrl + '/pricing</loc>') === -1) bad('sitemap.xml has no /pricing');
  if (read('llms.txt').indexOf('(' + site.baseUrl + '/pricing)') === -1) bad('llms.txt has no /pricing');
  if (!/<a href="\/pricing" class="site-nav__link">Pricing<\/a>/.test(home) || !/<a href="\/pricing" class="site-nav__link">Pricing<\/a>/.test(page)) bad('the Pricing link is missing from the header');
  const footer = require('../lib/site-footer.js');
  if (!footer.hrefs || footer.hrefs().indexOf('/pricing') === -1) bad('the footer has no /pricing link');

  // The same price on every surface.
  D.tiers.forEach((t) => {
    const card = (new RegExp('<li class="ladder-card ladder-card--' + t.key + '"[\\s\\S]*?</li>').exec(home) || [''])[0];
    if (card.indexOf('<p class="ladder-card__price">' + esc(t.line) + '</p>') === -1) bad('the ' + t.name + ' ladder card has no price line "' + t.line + '"');
    if (t.key !== 'scan') { const f = t.key + '.html'; if (read(f).indexOf('<p class="svc-price"') === -1 && t.key !== 'pro') bad(f + ' has no price line'); }
  });
  const pro = read('pro.html');
  if (pro.indexOf('<p class="pro-price"') === -1 || pro.indexOf(esc(Pricing.tier('pro').line)) === -1) bad('pro.html has no price line "' + Pricing.tier('pro').line + '"');
  ['fix', 'beyond'].forEach((k) => { if (read(k + '.html').indexOf(esc(Pricing.tier(k).line)) === -1) bad(k + '.html does not carry its price line "' + Pricing.tier(k).line + '"'); });

  // The words.
  const surfaces = { 'pricing.html': page, 'the homepage': home, 'pro.html': pro, 'fix.html': read('fix.html'), 'beyond.html': read('beyond.html') };
  Object.keys(surfaces).forEach((name) => {
    const text = visible(surfaces[name]).replace('Can ChatGPT find example.com?', ' ');
    if (BANNED.test(text)) bad(name + ': a banned word: ' + BANNED.exec(text)[0]);
    if (BRIEF_BANNED.test(text)) bad(name + ': ' + BRIEF_BANNED.exec(text)[0] + ' must not appear');
    if (/\b(guarantee[sd]?|promise[sd]?)\b/i.test(text)) bad(name + ': no guarantee or promise wording outside /terms (found "' + /\b(guarantee[sd]?|promise[sd]?)\b/i.exec(text)[0] + '")');
    const chat = (text.match(/ChatGPT(?! coming\))/g) || []).length;
    if (/coming/.test(D.engines) && chat) bad(name + ': names ChatGPT as live while content/pricing.json says "' + D.engines + '"');
    if (/checkout|buy now|add to cart|pay now|stripe|polar\.sh/i.test(text.replace(/data-label-checkout/g, ''))) bad(name + ': a payment button or checkout wording');
    if ((text.match(/—|&mdash;/g) || []).length > 0 && /<p[^>]*>[^<]*—[^<]*—/.test(surfaces[name])) bad(name + ': more than one em dash in a paragraph');
  });
  const terms = read('terms.html');
  if ((terms.match(new RegExp(NO_GUARANTEE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length !== 1) bad('terms.html must carry the sentence "' + NO_GUARANTEE + '" exactly once');
  if (/guarantee/i.test(visible(terms).replace(NO_GUARANTEE, '').replace(/we don.t guarantee it/i, ''))) bad('terms.html says "guarantee" outside the one sentence (and the as-is line)');
  // Buttons: only the four labels, and only the waitlist link, the request form or the scan.
  const labels = D.tiers.map((t) => t.cta.label).sort().join('|');
  if (labels !== 'Apply for Beyond|Join the Pro waitlist|Request a Fix quote|Scan free') bad('the four buttons must be: Scan free, Join the Pro waitlist, Request a Fix quote, Apply for Beyond');
  return errors;
}

function main() {
  if (process.argv.indexOf('--check') !== -1) {
    const errors = check();
    if (errors.length) { errors.forEach((e) => console.error('FAIL: ' + e)); process.exit(1); }
    console.log('OK: /pricing and the homepage section are current; one price on every page; the four buttons are the scan, the waitlist and the two request forms; no guarantee wording outside /terms; ChatGPT is not claimed');
    return;
  }
  fs.writeFileSync(path.join(ROOT, 'pricing.html'), build(), 'utf8');
  const idx = path.join(ROOT, 'index.html');
  fs.writeFileSync(idx, withHome(fs.readFileSync(idx, 'utf8')), 'utf8');
  console.log('written: pricing.html, the homepage pricing section' + (ensureSitemap() ? ', sitemap.xml entry' : '') + (ensureLlms() ? ', llms.txt entry' : ''));
}

if (require.main === module) main();
module.exports = { build: build, check: check, homeSection: homeSection, NO_GUARANTEE: NO_GUARANTEE };
