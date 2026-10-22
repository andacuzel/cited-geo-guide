#!/usr/bin/env node
/* =====================================================================
   scripts/test-legal-pages.js

   The legal pages (22 Oct 2026) match what the site sells and what the code does:
   - the plans in /terms carry the prices, the 3-month minimum and the 14 days of content/pricing.json; weekly re-scans are named only as not yet part of Pro;
   - the outcome sentence "Citehound makes no guarantee about citations, traffic, rankings or revenue." is on /terms once and nowhere else; no other public page says "guarantee";
   - every page that says "refund" gives 14 days, and /refunds, the footer and /terms agree;
   - /privacy's retention numbers (workspaces 400 and 90 days, reports and orders 90 days, the waitlist 12 months) are the ones in the code, and it names only the processors the code uses;
   - the free scan stores no result: api/scan.js keeps only the hashed-address counters (lib/_rateLimit);
   - no claim of an integration that does not exist or of a certification.
   No bracket or TBA is left in the three pages (23 Oct 2026): the owner confirmed every blank.

     node scripts/test-legal-pages.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const visible = (html) => html.replace(/<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&rsquo;/g, '’').replace(/&amp;/g, '&').replace(/&mdash;/g, '—').replace(/\s+/g, ' ');
const main = (html) => visible(html.replace(/<header class="site-header">[\s\S]*?<\/header>/, '').replace(/<footer[\s\S]*?<\/footer>/, ''));

const SENTENCE = 'Citehound makes no guarantee about citations, traffic, rankings or revenue.';
const pricing = JSON.parse(read('content/pricing.json'));
const terms = main(read('terms.html')), refunds = main(read('refunds.html')), privacy = main(read('privacy.html'));

const pages = [];
(function walk(d) { fs.readdirSync(path.join(ROOT, d)).forEach((n) => { if (/^(node_modules|\.git|local|docs|data|asset|\.claude|assets|r|launch|brand)$/.test(n)) return; const rel = d ? d + '/' + n : n; if (fs.statSync(path.join(ROOT, rel)).isDirectory()) walk(rel); else if (/\.html$/.test(n)) pages.push(rel); }); })('');

/* the plans */
const tier = (k) => pricing.tiers.find((x) => x.key === k);
t('terms: Pro is $39 a month or $390 a year, as the pricing file says', tier('pro').priceMain === '$39' && tier('pro').priceAlt === '$390' && /Pro<\/strong> is \$39 a month or \$390 a year/.test(read('terms.html')));
t('terms: Fix starts at $299 with a fixed quote, 3 months of Pro and 14 days of small corrections', tier('fix').priceMain === 'From $299' && /Fix<\/strong> starts at \$299/.test(read('terms.html')) && /fixed quote/.test(terms) && /3 months of Pro/.test(terms) && /14 days after delivery we make small corrections/.test(terms));
t('terms: Beyond is $490 a month, 3-month minimum, limited seats, 4 edited pieces a month approved by the customer, Pro included', tier('beyond').priceMain === '$490' && /Beyond<\/strong> is \$490 a month, with a 3-month minimum and limited seats/.test(read('terms.html')) && /4 edited pieces a month that you approve before they are published/.test(terms) && /and Pro\./.test(terms));
t('terms: Pro is described as what exists (a report of up to 25 pages, a dated citation sample on Claude, monitoring through the API for up to 5 domains with a weekly homepage re-scan and email alerts); planned features are not part of Pro until live', /whole-site report of up to 25 pages/.test(terms) && /Claude \(ChatGPT is coming\)/.test(terms) && /monitoring through the API for up to 5 domains: a weekly re-scan of each domain.s homepage with email alerts/.test(terms) && /Features we describe as planned are not part of Pro until they are live/.test(terms) && require('../lib/api-v1/monitor.js').config({}).watchLimit === 5);
t('terms: no page-count limit is stated for Fix', !/Fix[^.]*\b\d+ pages\b/.test(terms));
t('terms: refunds, billing and cancellation, Fix and Beyond work, acceptable use, what a score means, reports and files, as-is and liability, governing law, changes, contact are all sections', ['Billing and cancellation', 'Refunds', 'Fix and Beyond work', 'Acceptable use', 'What a score means', 'Reports, files and links', 'Provided as-is, and our liability', 'Governing law', 'Changes to these terms', 'Contact'].every((h) => read('terms.html').indexOf('>' + h.replace(/&/g, '&amp;') + '<') !== -1));
t('terms: the delivered reports and files belong to the customer; the research and methodology stay ours', /belong to you/.test(terms) && /Our research, our methodology and the scanner itself stay ours/.test(terms));
t('terms: the customer approves before publishing and is responsible for what they approve; backups are the customer\'s', /nothing is published until you approve it/.test(terms) && /You are responsible for what you approve/.test(terms) && /Back up your site before we change it/.test(terms));
t('terms: early-access prices may change for new customers, existing customers keep the agreed price for the term', /Early-access prices may change for new customers/.test(terms) && /price you agreed stays the same for your current term/.test(terms));

/* the one sentence */
const holders = pages.concat(['llms.txt', 'content/pricing.json', 'content/service-pages.json']).filter((f) => read(f).indexOf(SENTENCE) !== -1);
t('the outcome sentence is on /terms and nowhere else', holders.join() === 'terms.html', holders.join(', '));
t('it is on /terms exactly once, inside "What a score means"', (read('terms.html').match(new RegExp(SENTENCE.replace(/[.]/g, '\\.'), 'g')) || []).length === 1 && /What a score means<\/h2>[\s\S]*?makes no guarantee[\s\S]*?<\/div>/.test(read('terms.html')));
const guarantee = pages.filter((f) => f !== 'terms.html' && /guarantee/i.test(main(read(f)).replace(/the free scan is not a guarantee/i, ''))).filter((f) => !/^(research\/|benchmarks\/|methodology|trust|mcp|tools\/|about|citation-tracking|agentic-commerce|for-|playbooks|changelog|compare|sample-report)/.test(f));
t('no landing, pricing, Pro, Fix, Beyond, refunds or privacy page says "guarantee"', guarantee.length === 0, guarantee.join(', '));
t('terms says "guarantee" only in that sentence', !/guarantee/i.test(terms.replace(SENTENCE, '')));

/* refunds */
const refundPages = pages.filter((f) => /refund/i.test(main(read(f))));
const wrongDays = refundPages.filter((f) => { const m = main(read(f)); return /refund[^.]{0,120}\b(\d+)[- ]days?\b/i.test(m) && !/refund[^.]{0,120}\b14[- ]days?\b/i.test(m); });
t('every page that mentions a refund and a number of days says 14', wrongDays.length === 0, wrongDays.join(', '));
t('the pages that mention refunds are only the pricing page, the refunds page, the terms and the privacy page', refundPages.every((f) => ['pricing.html', 'refunds.html', 'terms.html', 'privacy.html'].indexOf(f) !== -1), refundPages.join(', '));
t('refunds: 14 days from the first Pro payment, how to ask by email, back to the original payment method, Fix before work and after delivery, Beyond after the minimum with 30 days\' notice', /within 14 days of paying it/.test(refunds) && /hey@getcitehound\.com/.test(refunds) && /goes back to the payment method you used/.test(refunds) && /Before we start work, you can cancel a Fix project and get a full refund/.test(refunds) && /only if the scope we agreed in writing was not delivered/.test(refunds) && /after the 3-month minimum, with 30 days’ notice/.test(refunds));
t('the pricing FAQ and the refunds page agree (14 days, first Pro payment) and the FAQ points to the refunds page', /14-day refund on your first payment/.test(read('pricing.html')) && /refund terms are on the refunds page/.test(read('pricing.html')));
t('the footer links Refunds next to Terms', /<li><a href="\/terms">Terms<\/a><\/li>\s*<li><a href="\/refunds">Refunds<\/a><\/li>/.test(read('index.html')));

/* privacy against the code */
const num = (file, re) => { const m = re.exec(read(file)); return m ? parseInt(m[1], 10) : null; };
t('privacy: workspaces are kept 400 days after the last activity and 90 days after archiving, as lib/ws-store.js has it', num('lib/ws-store.js', /ACTIVE_TTL = (\d+) \* 86400/) === 400 && num('lib/ws-store.js', /ARCHIVED_TTL = (\d+) \* 86400/) === 90 && /kept for 400 days after its last activity/.test(privacy) && /deleted 90 days later/.test(privacy));
t('privacy: reports and orders are kept 90 days and an unused link 30 days, as lib/pro-store.js has it', num('lib/pro-store.js', /orderUnused: (\d+) \* DAY/) === 30 && num('lib/pro-store.js', /orderUsed: (\d+) \* DAY/) === 90 && num('lib/pro-store.js', /job: (\d+) \* DAY/) === 90 && /for 90 days/.test(privacy) && /expires after 30 days/.test(privacy));
t('privacy: the processors named are the ones the code uses: Upstash (storage), Resend (email), Anthropic (questions and check), Vercel, Google Fonts, Launch Llama, Google Gemini for the older summary; ChatGPT/OpenAI only as "not used today"', ['Upstash', 'Resend', 'Anthropic', 'Vercel', 'Google Fonts', 'Launch Llama', 'Gemini'].every((n) => privacy.indexOf(n) !== -1) && /Anthropic is the only model provider used today/.test(privacy) && !/OpenAI[^.]*\b(receives|is used for)\b/i.test(privacy));
t('privacy: Fix and Beyond workspaces hold no name and no email, are reached by a private link, and have no field for passwords or access keys (the code has none)', /It holds no name and no email address/.test(privacy) && /no field for passwords or access keys/.test(privacy) && !/password|credential/i.test(read('lib/ws-store.js').replace(/\/\*[\s\S]*?\*\//g, '')));
t('privacy: payments are "not open yet", the checkout is the provider\'s hosted page, and deletion is by email with the report or workspace link', /Payments are not open yet/.test(privacy) && /hosted checkout page/.test(privacy) && /Deleting your data/.test(read('privacy.html')) && /workspace link/.test(privacy));
t('privacy: the free scan stores no result: api/scan.js imports no store, and the rate limiter keeps only a hashed address and counters', !/pro-store|hset|upstash|redis/i.test(read('api/scan.js')) && /No raw IP is ever\s+stored/.test(read('api/_rateLimit.js')) && /keyed one-way hash of your IP address/.test(privacy));
t('privacy: the one cookie is the admin sign-in cookie (the code sets one for the admin only)', /sign-in cookie of our own admin page/.test(privacy) && /Set-Cookie|cookie/i.test(read('lib/ws-api.js')));

/* claims we must not make */
const legal = terms + ' ' + refunds + ' ' + privacy;
t('no integration that does not exist (the official GitHub Action does) and no certification is claimed', !/\b(WordPress|Webflow|GitHub(?! Action)|Shopify|Zapier|SOC ?2|ISO ?27001|HIPAA)\b/i.test(legal) && !/GDPR[- ]compliant|certified|compliant with/i.test(legal));
t('no promise of traffic, rankings, citations, revenue or results outside the one sentence', !/(will|to) (increase|improve|boost|raise) (your )?(traffic|rankings?|citations|revenue|visibility)/i.test(legal));


/* the interim operator, governing law and the API (23 Oct 2026) */
const KEYS = require('../lib/api-v1/keys.js'), LIM = require('../lib/api-v1/limits.js');
const OPERATOR = 'Citehound is run by Andaç Üzel, a sole proprietor based in Istanbul, Türkiye.';
t('terms, privacy and refunds name the operator (a sole proprietor in Istanbul, Türkiye, no street address) and say the page will be updated when a company is formed', [terms, privacy, refunds].every((x) => x.indexOf(OPERATOR) !== -1 && /when a company is formed/.test(x)) && !/\b(street|avenue|road|mah\.|sokak|cadde)\b/i.test(terms + privacy + refunds));
t('terms: governed by the laws of Türkiye, the courts of Istanbul decide', /governed by the laws of Türkiye, and the courts of Istanbul decide disputes about them/.test(terms));
t('terms: an API section with the real limits, the key, acceptable use and no second outcome sentence', />The API</.test(read('terms.html')) && new RegExp('A free key allows ' + LIM.PLAN_LIMITS.free.hour + ' requests an hour and ' + LIM.PLAN_LIMITS.free.day + ' a day, and the same domain is scanned at most ' + LIM.DOMAIN_PER_HOUR + ' times an hour').test(terms) && /Keep your key private/.test(terms) && /revoke a key that is abused/.test(terms) && (read('terms.html').match(/makes no guarantee/g) || []).length === 1);
const days = KEYS.REVOKED_TTL / 86400, months = KEYS.MARKETING_TTL / 86400 / 365 * 12;
t('privacy: an API keys section whose periods are the code\'s: revoked records 90 days, the marketing opt-in 12 months, counters two hours and two days', days === 90 && months === 12 && /API keys<\/h2>/.test(read('privacy.html')) && /expires 90 days later/.test(privacy) && /for 12 months, and use it only to send you product updates/.test(privacy) && /hourly counters expire within two hours and the daily ones within two days/.test(privacy) && /The box is off unless you tick it/.test(privacy));
t('privacy: the key is not stored readable, the address is kept readable only with the opt-in, and nothing is logged', /do not store the key, or your address, in readable form/.test(privacy) && /We do not log your key, your address or the requests you make/.test(privacy));
t('privacy: the API key appears in Third parties (Resend: four kinds of message; Upstash holds API key records) and in "what we don\'t collect"', /four kinds of message/.test(privacy) && /API key records/.test(privacy) && /ask for an API key/.test(privacy));
t('the API key store keeps what the privacy page says (a hash, a masked address, no readable key; the opt-in apart and expiring)', /maskedEmail/.test(read('lib/api-v1/keys.js')) && /expire\('api:mk:'/.test(read('lib/api-v1/keys.js')) && /emailHash: '', maskedEmail: ''/.test(read('lib/api-v1/keys.js')));

/* wording: no "monthly" next to the citation sample; no "nothing is stored" for the free scan */
const monthlyCite = pages.filter((f) => !/^(docs|content)\//.test(f) && /monthly (citation|sample|check)|citation (check|sample)[^.<]{0,40}monthly/i.test(read(f)));
t('no page calls the citation sample monthly; Beyond keeps its monthly re-measurement (done by hand) and no page says it is automated', monthlyCite.length === 0 && !/monthly (citation|sample)/i.test(read('content/pricing.json') + read('content/service-pages.json')) && /Monthly re-measurement/.test(read('pricing.html')) && /Monthly re-measurement/.test(read('index.html')) && /re-measure every month/.test(main(read('beyond.html'))) && !/automat[a-z]* [^.]{0,60}re-?measure|re-?measure[^.]{0,60}automat/i.test(main(read('beyond.html')) + main(read('pricing.html')) + main(read('index.html')) + main(read('terms.html'))), monthlyCite.join(', '));
const nothingStored = pages.filter((f) => !/^(mcp\.html|research\/|benchmarks\/|app\/)/.test(f) && /nothing is stored|nothing stored/i.test(main(read(f))));
t('no page about the free scan or the free tools says "nothing is stored"', nothingStored.length === 0, nothingStored.join(', '));
t('the free-scan line is "No email. Runs in your browser. Your scan result isn\'t saved." on the homepage, the 404 page and the agentic commerce page', ['index.html', '404.html', 'agentic-commerce.html'].every((f) => read(f).indexOf("No email. Runs in your browser. Your scan result isn't saved.") !== -1));


/* the confirmed terms (23 Oct 2026) */
t('terms: taxes at checkout, Fix paid in full on acceptance before work starts, liability limited to what you paid in the 12 months before the claim', /Prices are in US dollars\. Taxes, where they apply, are added at checkout\./.test(terms) && /Fix is paid in full when you accept the quote, before work starts\./.test(terms) && /limited to the amount you paid us in the 12 months before the claim\./.test(terms) && /Before we start work, you can cancel a Fix project and get a full refund/.test(refunds));
t('privacy: correspondence and quotes 24 months, invoice and billing records 5 years, the payment provider is never named', /for 24 months\./.test(privacy) && /invoice and billing records for 5 years/.test(privacy) && !/\b(Stripe|Paddle|Polar|PayPal|Lemon ?Squeezy|Gumroad|Adyen|Square|Mollie|iyzico)\b/i.test(terms + privacy + refunds) && /our payment provider/.test(privacy));
t('terms and privacy describe monitoring as the code does: 5 domains, about every 7 days, 365 days, 90 days of delivery log, 50 deliveries, alert limits, encrypted webhook secrets', (() => { const M = require('../lib/api-v1/monitor.js'), W = require('../lib/api-v1/webhooks.js'), c = M.config({}); return c.watchLimit === 5 && c.retentionDays === 365 && W.LOG_KEEP === 50 && M.ALERT_TYPES.length === 3 && /A scheduled job re-scans each watched domain about every 7 days/.test(terms) && /at most once a day for each domain/.test(terms) && /up to three times/.test(terms) && /up to 365 days/.test(privacy) && /last 50 deliveries/.test(privacy) && /for 90 days/.test(privacy) && /secret is stored encrypted/.test(privacy) && /at most one email a day for each domain/.test(privacy) && /stop watching your last domain or revoke the key/.test(privacy); })());
t('the outcome sentence is still on /terms exactly once', (read('terms.html').match(new RegExp(SENTENCE.replace(/[.]/g, '\\.'), 'g')) || []).length === 1);
t('pricing: weekly re-scan is worded as built (homepage, up to 5 domains, email alerts) and the "not running yet" line is gone', /Weekly homepage re-scan with email alerts for up to 5 domains/.test(read('pricing.html')) && /Weekly homepage re-scan with email alerts for up to 5 domains/.test(read('index.html')) && !/not running yet|part of Pro early access/.test(read('pricing.html') + read('index.html') + read('pro.html') + read('content/pricing.json')));

/* the owner's blanks */
const blanks = {};
[['terms.html', terms], ['privacy.html', privacy], ['refunds.html', refunds]].forEach((x) => { (x[1].match(/\[[A-Z][^\]]{2,200}\]/g) || []).forEach((b) => { (blanks[x[0]] = blanks[x[0]] || []).push(b); }); });
const known = /^$/;
t('every bracket in the legal pages is nothing: no placeholder of any kind is left (the entity, location, law, tax, billing, retention, liability and provider blanks are filled)', Object.keys(blanks).every((f) => blanks[f].every((b) => known.test(b))), JSON.stringify(blanks));
t('no [TO CONFIRM], TBA or TBD anywhere on a public page', !pages.some((f) => /\[TO CONFIRM|\bTBA\b|\bTBD\b/.test(read(f))), pages.filter((f) => /\[TO CONFIRM|\bTBA\b|\bTBD\b/.test(read(f))).join(', '));

out('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { out('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
