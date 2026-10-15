/* =====================================================================
   lib/pricing.js: the early-access prices (content/pricing.json) as markup, in one place.

   The pricing staircase is written twice from here: into the homepage (between PRICING markers in index.html) and into /pricing, by
   scripts/generate-pricing.js. The short price lines on the ladder cards and on /pro, /fix and /beyond are checked against the same file.
   Edit the JSON, never the markup.

   Rules the copy follows: the prices are the owner's (8 Oct 2026 brief: Scan free; Pro $39 a month or $390 a year; Fix from $299; Beyond $490 a month,
   3-month minimum, limited seats); "Early-access pricing. Payments open soon, reserve your spot."; no crossed-out or "was" price, no checkout (every button
   is the waitlist link or the request form); no promise of a result. ENGINES is "Claude (ChatGPT coming)" until OPENAI is enabled in production: then change
   it in content/pricing.json and run the generators. Weekly re-scans and alerts are named as part of Pro early access; nothing here runs them.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const lockup = require('./lockup.js');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'pricing.json'), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fill = (s) => String(s).replace('{ENGINES}', DATA.engines).replace('{MEASURE}', String(DATA.measure).replace('{ENGINES}', DATA.engines));
// The dollar sign in its own span, set in the UI sans (the display serif draws it like an S): real text, a little smaller, at the top of the numerals.
const cur = (text) => String(text).replace(/\$/g, '<span class="cur">$</span>');
const tier = (key) => DATA.tiers.find((t) => t.key === key);

function button(t, where) {
  const k = t.cta.kind, label = esc(t.cta.label);
  if (k === 'scan') return where === 'home' ? '<button type="button" class="btn btn--primary" data-ladder-scan>' + label + '</button>' : '<a class="btn btn--primary" href="/#scan">' + label + '</a>';
  if (k === 'pro') return '<a class="btn btn--gold" href="/pro#waitlist" data-pro-cta data-label-checkout="Get Citehound Pro">' + label + '</a>';
  return '<button type="button" class="btn btn--ghost" data-request="' + k + '">' + label + '</button>';
}

function price(t) {
  const pre = /^From /.test(t.priceMain);
  const main = (pre ? '<span class="pr-price__pre">From</span>' : '') + '<span class="pr-price__main">' + cur(esc(t.priceMain.replace(/^From /, ''))) + '</span>' + (t.priceUnit ? '<span class="pr-price__unit">' + esc(t.priceUnit) + '</span>' : '');
  if (!t.priceAlt) return '<p class="pr-price">' + main + '</p>\n';
  // Pro: monthly and annual. Without script both show; pricing.js adds the toggle and shows one.
  return '<p class="pr-price pr-price--alt is-on" data-period-view="m">' + main + '</p>\n' +
    '            <p class="pr-price pr-price--alt is-on" data-period-view="y"><span class="pr-price__or">or</span><span class="pr-price__main">' + cur(esc(t.priceAlt)) + '</span><span class="pr-price__unit">' + esc(t.priceAltUnit) + '</span></p>\n';
}

function step(t, i, where) {
  const toggle = t.priceAlt ? '            <div class="pr-toggle" role="group" aria-label="Pro billing period" hidden><button type="button" class="pr-toggle__btn" data-period="m" aria-pressed="true">Monthly</button><button type="button" class="pr-toggle__btn" data-period="y" aria-pressed="false">Annual</button></div>\n' : '';
  const chips = (t.pill ? '<span class="pr-chip">' + esc(t.pill) + '</span>' : '') + (t.tag ? '<span class="pr-chip pr-chip--seats">' + esc(t.tag) + '</span>' : '');
  return '          <li class="pr-step pr-step--' + t.key + '" id="step-' + t.key + '" style="--rise:' + i + '">\n' +
    '            <div class="pr-step__head"><h3 class="pr-step__name">' + lockup.html(t.tier, 'light') + '</h3>' + (chips ? '<p class="pr-step__chips">' + chips + '</p>' : '') + '</div>\n' +
    toggle + '            ' + price(t) +
    '            <p class="pr-note">' + esc(t.priceNote) + '</p>\n' +
    '            <p class="pr-outcome">' + esc(t.outcome) + '</p>\n' +
    '            <p class="pr-best"><span class="pr-best__label">Best for</span> ' + esc(t.bestFor) + '</p>\n' +
    '            <ul class="pr-points">\n' + t.points.map((p) => '              <li>' + esc(fill(p)) + '</li>').join('\n') + '\n            </ul>\n' +
    '            <p class="pr-cta">' + button(t, where) + '</p>\n' +
    '          </li>';
}

// The staircase: four steps, each one a little higher than the one before. where: 'home' (the scan button is the page's own) or 'page'.
function staircase(where) {
  return '        <ul class="pr-stairs" data-pricing>\n' + DATA.tiers.map((t, i) => step(t, i, where)).join('\n') + '\n        </ul>\n';
}

const faqItems = () => DATA.faq.map((f) => ({ q: f.q, a: fill(f.a) }));

module.exports = { cur: cur, DATA: DATA, tier: tier, fill: fill, staircase: staircase, faq: faqItems, measure: () => fill('{MEASURE}'), ENGINES: DATA.engines, esc: esc };
