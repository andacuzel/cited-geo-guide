#!/usr/bin/env node
/* =====================================================================
   scripts/generate-pricing.js

   Writes pricing.html (/pricing: hero, which step, the staircase, the screens, the comparison, how it works, proof, why, the offer, the FAQ, the closing call) and the pricing
   section of the homepage (between <!-- PRICING:START --> and <!-- PRICING:END -->, just above the footer) from content/pricing.json through lib/pricing.js, and keeps the
   sitemap and llms.txt entries. Edit the JSON, never the markup.

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
const icons = require('../lib/icons.js');
const Plans = require('../lib/plans.js');

const ROOT = path.resolve(__dirname, '..');
const CSS_VERSION = 105;
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
    head('Early-access pricing', 'pricing-heading', 'Start free. Pay for the step you need.', D.sub).replace(/^ {8}/gm, '        ') +
    Pricing.staircase('home') + '        <p class="pr-foot"><a class="pr-foot__link" href="/pricing">See the full pricing page</a></p>\n        </div>\n      </section>\n      ' + END;
}

function faq() {
  return '    <section class="home-faq hp-light" id="faq" aria-labelledby="faq-heading">\n      <div class="section__inner">\n' + head('Questions', 'faq-heading', 'About the prices.').replace(/^ {8}/gm, '        ') + '        <div class="ac-faq">\n' +
    Pricing.faq().map((f) => '          <details>\n            <summary>' + esc(f.q) + '</summary>\n            <p>' + esc(f.a) + '</p>\n          </details>').join('\n') + '\n        </div>\n      </div>\n    </section>\n';
}

// The numbers in the trust strip come from where the site already gets them: the benchmark data, the check registry, the crawler list.
function facts() {
  // The benchmark generator writes the total into the homepage (window.CITEHOUND_BENCHMARKS); read it from there.
  const homepages = parseInt((/"totalSites":(\d+)/.exec(read('index.html')) || [0, 0])[1], 10);
  if (!homepages) throw new Error('index.html has no benchmark total (totalSites)');
  return { homepages: homepages, checks: require('../lib/methodology.js').registry().length, crawlers: require('../lib/scanner.js').BOTS.length };
}
const sect = (cls, id, inner) => '    <section class="' + cls + '"' + (id ? ' id="' + id + '"' : '') + (id ? ' aria-labelledby="' + id + '-heading"' : '') + '>\n      <div class="section__inner">\n' + inner + '      </div>\n    </section>\n\n';
const hd = (kicker, id, title) => head(kicker, id + '-heading', title).replace(/^ {8}/gm, '        ');

function hero(P) {
  const f = facts();
  const trust = P.trust.replace('{HOMEPAGES}', f.homepages).replace('{CHECKS}', f.checks).replace('{CRAWLERS}', f.crawlers).split(' · ');
  return '    <section class="pp-hero" aria-labelledby="hero-heading">\n      <div class="section__inner pp-hero__grid">\n        <div class="pp-hero__copy">\n        <p class="kicker">' + esc(P.heroEyebrow) + '</p>\n        <h1 id="hero-heading" class="pp-hero__title">' + esc(P.h1) + '</h1>\n' +
    '        <p class="pp-hero__sub">' + esc(P.sub) + '</p>\n' +
    '        <p class="pp-hero__actions"><a class="btn btn--primary" href="/#scan">' + esc(P.heroPrimary) + '</a><a class="btn btn--ghost" href="#steps">' + esc(P.heroSecondary) + '</a></p>\n        </div>\n' +
    '        <ol class="pp-hero__art" aria-hidden="true"><li class="pp-hero__arch pp-hero__arch--1">Scan</li><li class="pp-hero__arch pp-hero__arch--2">Pro</li><li class="pp-hero__arch pp-hero__arch--3">Fix</li><li class="pp-hero__arch pp-hero__arch--4">Beyond</li></ol>\n' +
    '        <ul class="pp-trust">' + trust.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>\n      </div>\n    </section>\n\n';
}

function which(P) {
  return sect('pp-which hp-light', 'which', hd(P.whichKicker, 'which', P.whichTitle) +
    '        <ul class="pp-which__list">\n' + P.which.map((w) => '          <li><a class="pp-which__row" href="#step-' + w.key + '"><span class="pp-which__say">' + esc(w.say) + '</span><span class="pp-which__go">' + esc(w.step) + '<span class="pp-which__arrow" aria-hidden="true">&rarr;</span></span></a></li>').join('\n') + '\n        </ul>\n');
}

function see(P) {
  const tabs = P.see.map((t, i) => '<button type="button" class="tour__tab' + (i === 0 ? ' is-active' : '') + '" role="tab" id="seeTab-' + t.key + '" aria-controls="see-' + t.key + '" aria-selected="' + (i === 0 ? 'true' : 'false') + '">' + esc(t.tab) + '</button>').join('');
  const panels = P.see.map((t, i) =>
    '              <div class="tour__panel' + (i === 0 ? ' is-active' : '') + '" id="see-' + t.key + '" role="tabpanel" aria-labelledby="seeTab-' + t.key + '">\n' +
    '                <div class="tour__view">\n' +
    '                  <figure class="bframe"><div class="bframe__bar" aria-hidden="true"><span class="bframe__dot"></span><span class="bframe__dot"></span><span class="bframe__dot"></span><span class="bframe__url">' + esc(t.url) + '</span></div>' +
    '<a class="bframe__link" href="' + esc(t.href) + '" aria-label="' + esc(t.link + ': ' + t.tab) + '"><img class="bframe__img" src="/assets/tour/' + t.img + '.webp" width="1800" height="1200" loading="lazy" decoding="async" alt="' + esc(t.alt) + '" /></a></figure>\n' +
    '                  <p class="tour__cap">' + esc(t.cap[0]) + '<span class="pp-cap2">' + esc(t.cap[1]) + '</span></p>\n' +
    '                </div>\n' +
    '                <p class="tour__meta"><span class="tour__label">' + esc(t.label).replace(' · ', ' &middot; ') + '</span><a class="tour__link" href="' + esc(t.href) + '">' + esc(t.link) + '</a></p>\n' +
    '              </div>').join('\n');
  return sect('tour hp-light pp-see', 'see', hd(P.seeKicker, 'see', P.seeTitle) +
    '        <div class="tour__box" id="seeBox">\n          <div class="tour__tabs" role="tablist" aria-label="Screens of each step">' + tabs + '</div>\n          <div class="tour__panels">\n' + panels + '\n          </div>\n        </div>\n');
}

function compare(P) {
  const yes = icons.svg('check', { cls: 'pp-yes' }) + '<span class="pr-vh">Included</span>';
  const no = '<span class="pp-no" aria-hidden="true">&ndash;</span><span class="pr-vh">Not included</span>';
  const rows = P.rows.map((r) => '            <tr><th scope="row">' + esc(Pricing.fill(r.label)) + (r.note ? ' <span class="pp-rownote">' + esc(r.note) + '</span>' : '') + '</th>' +
    (r.who ? r.who.map((w) => '<td class="pp-who">' + esc(w) + '</td>').join('') : r.has.map((h) => '<td>' + (h ? yes : no) + '</td>').join('')) + '</tr>').join('\n');
  return sect('pp-compare hp-light', 'compare', hd(P.compareKicker, 'compare', P.compareTitle) +
    '        <p class="pp-hint">Scroll sideways to see every step.</p>\n' +
    '        <div class="pp-tablewrap" role="region" aria-label="What each step includes" tabindex="0">\n          <table class="pp-table">\n            <caption class="pr-vh">What each step includes</caption>\n            <thead><tr><th scope="col">What you get</th>' + P.cols.map((c) => '<th scope="col">' + esc(c) + '</th>').join('') + '</tr></thead>\n            <tbody>\n' + rows + '\n            </tbody>\n          </table>\n        </div>\n');
}

// The API by plan, from the one source of the plan limits (lib/plans.js), the same facts as the table on /api.
function apiPlans() {
  const P = Plans.PLANS, yes = 'Yes', no = '-';
  const row = (label, f) => '            <tr><th scope="row">' + esc(label) + '</th>' + Plans.ORDER.map((n) => '<td>' + esc(f(P[n])) + '</td>').join('') + '</tr>';
  const rows = [
    row('Requests an hour, a day', (p) => p.hour + ', ' + p.day),
    row('Scan detail', (p) => (p.scanDetail === 'full' ? 'Full' : 'Score, pillars, crawlers, top 3 findings')),
    row('Compare two sites', (p) => (p.compare ? yes : no)),
    row('Generated llms.txt and robots.txt', (p) => (p.generators === 'full' ? 'Full file' : 'Preview')),
    row('Watched domains, history kept', (p) => (p.monitoring ? p.watch + ' domains, ' + p.retentionDays + ' days' : no)),
    row('Fix list and re-check', (p) => (p.fixes ? yes : no)),
    row('Export of history and events', (p) => (p.exportData ? yes : no))
  ].join('\n');
  return sect('pp-api hp-light', 'api-plans', hd('For developers', 'api-plans', 'The API and the integrations, by plan.') +
    '        <p class="section-sub">The free scan on the website, the free tools and the MCP server stay free and complete. These are the limits and features of an API key, which the command line and the n8n node use. <a href="/api#plans">The full table is on the API page.</a></p>\n' +
    '        <div class="pp-tablewrap" role="region" aria-label="What each plan gets from the API" tabindex="0">\n          <table class="pp-table">\n            <caption class="pr-vh">What each plan gets from the API</caption>\n            <thead><tr><th scope="col">Feature</th>' + Plans.ORDER.map((n) => '<th scope="col">' + esc(P[n].label) + '</th>').join('') + '</tr></thead>\n            <tbody>\n' + rows + '\n            </tbody>\n          </table>\n        </div>\n');
}

function how(P) {
  return sect('pp-how hp-light', 'how', hd(P.howKicker, 'how', P.howTitle) +
    '        <ol class="pp-how__list">\n' + P.how.map((h) => '          <li class="pp-how__step"><h3 class="pp-how__title">' + esc(h.title) + '</h3><p class="pp-how__text">' + esc(h.text) + '</p></li>').join('\n') + '\n        </ol>\n');
}

function proof(P) {
  const card = (c) => '          <li class="pp-proof__card"><h3 class="pp-proof__title">' + esc(c.title) + '</h3><p class="pp-proof__text">' + esc(c.text) + '</p>' + (c.note ? '<p class="pp-proof__note">' + esc(c.note) + '</p>' : '') +
    '<p class="pp-proof__links">' + (c.links ? c.links : [{ href: c.href, link: c.link }]).map((l) => '<a class="pp-proof__link" href="' + l.href + '">' + esc(l.link) + '</a>').join('') + '</p></li>';
  return '    <section class="pp-proof hp-band" aria-labelledby="proof-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker kicker--on-navy">' + esc(P.proofKicker) + '</p>\n          <h2 id="proof-heading" class="pp-proof__h">Proof you can open.</h2>\n        </div>\n        <ul class="pp-proof__grid">\n' + P.proof.map(card).join('\n') + '\n        </ul>\n      </div>\n    </section>\n\n';
}

function why(P) {
  return sect('pp-why hp-light', 'why', hd(P.whyKicker, 'why', P.whyTitle) +
    '        <ul class="pp-why__list">\n' + P.why.map((w) => '          <li class="pp-why__item"><h3 class="pp-why__title">' + esc(w.title) + '</h3><p class="pp-why__text">' + esc(w.text) + '</p></li>').join('\n') + '\n        </ul>\n');
}

function offer(P) {
  return '    <section class="pp-offer hp-light" aria-labelledby="offer-heading">\n      <div class="section__inner">\n        <div class="pp-offer__panel">\n          <div>\n            <p class="kicker">' + esc(P.offerTitle) + '</p>\n            <h2 id="offer-heading" class="pp-offer__text">' + esc(P.offer) + '</h2>\n          </div>\n          <p class="pp-offer__cta"><a class="btn btn--gold" href="/pro#waitlist" data-pro-cta data-label-checkout="Get Citehound Pro">' + esc(P.offerCta) + '</a></p>\n        </div>\n      </div>\n    </section>\n\n';
}

function build() {
  const P = D.page;
  const body = hero(P) + which(P) +
    '    <section class="pricing hp-light" id="steps" aria-labelledby="steps-heading">\n      <div class="section__inner">\n' + hd(P.stepsKicker, 'steps', P.stepsTitle) + Pricing.staircase('page') + '      </div>\n    </section>\n\n' +
    see(P) + compare(P) + apiPlans() + how(P) + proof(P) + why(P) + offer(P) + faq() + '\n' +
    '    <section class="home-close hp-light" aria-labelledby="close-heading">\n      <div class="section__inner">\n        <div class="home-close__panel">\n          <div>\n            <h2 id="close-heading" class="home-close__title">' + esc(D.closeTitle) + '</h2>\n            <p class="home-close__text">' + esc(D.closeText) + '</p>\n          </div>\n          <div class="home-close__actions">\n            <a class="btn btn--primary" href="/#scan">Scan free</a>\n            <a class="home-close__link" href="/pro#waitlist" data-pro-cta data-label-checkout="Get Citehound Pro">Join the Pro waitlist</a>\n          </div>\n        </div>\n      </div>\n    </section>\n\n' +
    '    ' + dialog.html('    ') + '\n';
  const ld = [
    { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Citehound pricing', description: D.description, url: site.baseUrl + D.path, publisher: { '@id': site.baseUrl + '/#org' } },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: Pricing.faq().map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }
  ];
  return shell.page({
    title: D.title, description: D.description, path: D.path, cssVersion: CSS_VERSION,
    headExtra: '  <script src="/request-form.js?v=1" defer></script>\n  <script src="/pro-cta.js?v=1" defer></script>\n  <script src="/pricing.js?v=2" defer></script>\n', jsonld: ld, body: body
  });
}

// The homepage section sits just above the footer: the block is taken out wherever it is and put back before the footer comment.
function withHome(html) {
  const sec = homeSection();
  const stripped = html.replace(new RegExp('[ \\t]*' + START + '[\\s\\S]*?' + END + '\\n\\n?'), '');
  const at = stripped.indexOf('      <!-- ---------- Site footer ---------- -->');
  if (at === -1) throw new Error('index.html has no footer marker to place the pricing section before');
  return stripped.slice(0, at) + '      ' + sec.replace(/^/, '').replace(START, START) + '\n\n' + stripped.slice(at);
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
  if (pro.indexOf('<p class="pro-price"') === -1 || pro.indexOf(Pricing.cur(esc(Pricing.tier('pro').line))) === -1) bad('pro.html has no price line "' + Pricing.tier('pro').line + '"');
  ['fix', 'beyond'].forEach((k) => { if (read(k + '.html').indexOf(Pricing.cur(esc(Pricing.tier(k).line))) === -1) bad(k + '.html does not carry its price line "' + Pricing.tier(k).line + '"'); });

  // The words.
  const surfaces = { 'pricing.html': page, 'the homepage': home, 'pro.html': pro, 'fix.html': read('fix.html'), 'beyond.html': read('beyond.html') };
  Object.keys(surfaces).forEach((name) => {
    const text = visible(surfaces[name]).replace('Can ChatGPT find example.com?', ' ');
    if (BANNED.test(text)) bad(name + ': a banned word: ' + BANNED.exec(text)[0]);
    if (BRIEF_BANNED.test(text)) bad(name + ': ' + BRIEF_BANNED.exec(text)[0] + ' must not appear');
    if (/\b(guarantee[sd]?|promise[sd]?)\b/i.test(text)) bad(name + ': no guarantee or promise wording outside /terms (found "' + /\b(guarantee[sd]?|promise[sd]?)\b/i.exec(text)[0] + '")');
    const chat = (text.match(/ChatGPT(?! coming\))/g) || []).length;
    if (/coming/.test(D.engines) && chat) bad(name + ': names ChatGPT as live while content/pricing.json says "' + D.engines + '"');
    if (/checkout|buy now|add to cart|stripe|polar\.sh/i.test(text.replace(/data-label-checkout/g, ''))) bad(name + ': a payment button or checkout wording');
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
