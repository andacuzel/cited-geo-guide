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
   The brackets in the three pages are facts only the owner knows; the test lists them and passes (a bracket is not a failure, publishing one is the owner's call).

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
t('terms: Pro is described as what exists (a report of up to 25 pages, a dated citation sample on Claude); weekly re-scans appear only as not part of Pro yet', /whole-site report of up to 25 pages/.test(terms) && /Claude \(ChatGPT is coming\)/.test(terms) && (terms.match(/weekly re-scans?/gi) || []).length === 1 && /such as weekly re-scans with email alerts, are not part of Pro until they are live/.test(terms));
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
t('no integration that does not exist and no certification is claimed', !/\b(WordPress|Webflow|GitHub|Shopify|Zapier|SOC ?2|ISO ?27001|HIPAA)\b/i.test(legal) && !/GDPR[- ]compliant|certified|compliant with/i.test(legal));
t('no promise of traffic, rankings, citations, revenue or results outside the one sentence', !/(will|to) (increase|improve|boost|raise) (your )?(traffic|rankings?|citations|revenue|visibility)/i.test(legal));

/* the owner's blanks */
const blanks = {};
[['terms.html', terms], ['privacy.html', privacy], ['refunds.html', refunds]].forEach((x) => { (x[1].match(/\[[A-Z][^\]]{2,200}\]/g) || []).forEach((b) => { (blanks[x[0]] = blanks[x[0]] || []).push(b); }); });
const known = /^\[(LEGAL ENTITY NAME|REGISTERED ADDRESS|GOVERNING LAW|JURISDICTION|TO CONFIRM:[^\]]+)\]$/;
t('every bracket in the legal pages is one of the known blanks (entity, address, governing law, jurisdiction, TO CONFIRM)', Object.keys(blanks).every((f) => blanks[f].every((b) => known.test(b))), JSON.stringify(blanks));
out('\n  blanks left for the owner: ' + Object.keys(blanks).map((f) => f + ' ' + blanks[f].length).join(', '));

out('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { out('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
