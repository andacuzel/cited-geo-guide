/* =====================================================================
   lib/pro-report-page.js: the page served at /r/<id>/ for a Pro report.

   Server-rendered HTML with the shared renderer (lib/report-render.js renderPro), the same one
   the public /sample-report uses. A job that is still running gets the progress screen instead
   (app/pro-progress.js), which carries on from wherever the crawl is. Nothing here reads a
   contact address; the page never says who ordered it.

   Every page is noindex and sends no referrer (headers in lib/pro-http.js and vercel.json).
   ===================================================================== */

'use strict';

const render = require('./report-render.js');
const schema = require('./schema.js');
const Estimate = require('./pro-estimate.js');
const { jobToReportData } = require('./pro-data.js');
const CitSection = require('./pro-citation-section.js');
const siteFooter = require('./site-footer.js');

const CSS_VERSION = 105;
const CAP = 25;

const esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

const FONTS = '<link rel="preload" href="/assets/fonts/bricolage-grotesque-wght-latin.woff2" as="font" type="font/woff2" crossorigin />\n  <link rel="preload" href="/assets/fonts/hanken-grotesk-normal-latin.woff2" as="font" type="font/woff2" crossorigin />\n  <link href="/fonts.css?v=2" rel="stylesheet" />';

function shell(title, bodyClass, body, scripts, opts) {
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    '  <title>' + esc(title) + '</title>\n  <meta name="robots" content="noindex, nofollow, noarchive" />\n  <meta name="referrer" content="no-referrer" />\n  <meta name="description" content="A private Citehound report. Reached only by its link." />\n' +
    '  <link rel="icon" href="/assets/brand/favicon.svg" type="image/svg+xml" />\n  ' + FONTS + '\n  <link rel="stylesheet" href="/styles.css?v=' + CSS_VERSION + '" />\n</head>\n' +
    '<body class="' + bodyClass + '">\n  <a class="skip-link" href="#main">Skip to content</a>\n' + body + (opts && opts.footer === false ? '' : '  ' + siteFooter.html('  ') + '\n') + (scripts || '') + '</body>\n</html>\n';
}

const LOGO = '<a class="logo rp-top__logo" href="/" aria-label="Citehound home"><span class="logo__icon" aria-hidden="true"><svg viewBox="13 8.5 52 52" focusable="false"><path fill="currentColor" fill-rule="evenodd" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" d="M61.52 31.19 Q62.00 30.00 60.80 29.55 L59.31 28.99 Q58.00 28.50 56.73 27.90 L41.27 20.60 Q40.00 20.00 38.75 19.37 L36.25 18.13 Q35.00 17.50 33.90 16.64 L30.04 13.61 Q28.00 12.00 25.67 13.16 L22.97 14.51 Q21.00 15.50 20.14 17.53 L19.19 19.76 L17.75 24.28 L16.69 29.07 L16.00 34.12 L15.69 39.45 L15.75 45.03 L16.19 50.88 L16.66 54.42 Q17.00 57.00 19.60 57.00 L30.35 57.00 Q32.00 57.00 31.60 55.40 L31.17 53.64 L31.00 50.56 L31.50 47.75 L32.67 45.22 L34.50 42.97 L35.90 41.87 Q37.00 41.00 37.78 39.84 L38.22 39.16 Q39.00 38.00 40.38 37.75 L56.62 34.75 Q58.00 34.50 59.16 33.72 L59.93 33.21 Q61.00 32.50 61.48 31.31Z M28.62 16.05 Q28.70 15.05 27.90 15.64 L14.55 25.51 Q13.75 26.10 14.73 25.88 L27.07 23.07 Q28.05 22.85 28.13 21.85Z"/><circle cx="41" cy="23.4" r="2.3" fill="#F05A28"/></svg></span><span class="logo__mark">Citehound</span></a>';
const BAR = '<header class="rp-top"><div class="rp-top__inner">' + LOGO + '<div class="rp-top__meta"><span class="rp-top__label">Pro</span></div></div></header>\n';

function card(inner) {
  return BAR + '<main id="main" class="ps"><div class="ps__inner"><section class="ps-card">' + inner + '</section></div></main>\n';
}

// Where the payment provider's success URL lands. It holds no token: the script asks the server, and is sent on once the payment is confirmed.
function welcomePage() {
  return shell('Citehound Pro: payment received', 'ps-body', card('<p class="ps-kicker">Citehound Pro</p><h1 class="ps-title" id="pwTitle" tabindex="-1">Payment received</h1>' +
    '<p class="ps-lead" id="pwStatus" role="status" aria-live="polite">Preparing your report link&hellip;</p><p class="ps-note" id="pwWait">This usually takes a few seconds. Keep this page open: it will take you to your link. We also email it to the address you paid with.</p>' +
    '<noscript><p class="ps-note">This page needs JavaScript. Without it, check your email: we send the report link there too, or write to <a href="mailto:hey@getcitehound.com">hey@getcitehound.com</a>.</p></noscript>'),
    '  <script src="/app/pro-welcome.js?v=1"></script>\n');
}

// The optional feedback form: one number from 1 to 5, free text up to 1000 characters, a honeypot. Live reports only.
function feedbackSection() {
  const radios = [1, 2, 3, 4, 5].map(function (n) { return '<label class="pr-feedback__opt"><input type="radio" name="rating" value="' + n + '" /><span>' + n + '</span></label>'; }).join('');
  return '<aside class="pr-feedback" id="pr-feedback" aria-labelledby="pr-feedback-h"><div class="pr-feedback__inner">\n' +
    '<h2 class="pr-feedback__title" id="pr-feedback-h">Was this report useful?</h2>\n' +
    '<p class="pr-feedback__lead">Optional, and it goes to the people who make Citehound. It is stored for 90 days with this report\u2019s number, never with your name or email. Please leave personal details out.</p>\n' +
    '<form id="fbForm" class="pr-feedback__form" novalidate>\n' +
    '<fieldset class="pr-feedback__rating"><legend>How useful? 1 is not at all, 5 is very</legend><div class="pr-feedback__opts">' + radios + '</div></fieldset>\n' +
    '<div class="ps-field"><label for="fbText" class="ps-label">Anything we should know? <span class="wl-opt">(optional)</span></label><textarea class="field ps-input pr-feedback__text" id="fbText" name="text" rows="4" maxlength="1000"></textarea><p class="ps-hint" id="fbCount" aria-live="off"></p></div>\n' +
    '<div class="wl-trap" aria-hidden="true"><label>Company fax <input type="text" name="company_fax" tabindex="-1" autocomplete="off" /></label></div>\n' +
    '<p class="ps-actions"><button type="submit" class="btn btn--ghost" id="fbSubmit">Send feedback</button></p>\n' +
    '</form>\n<p class="pr-feedback__status" id="fbStatus" role="status" aria-live="polite" tabindex="-1"></p>\n' +
    '</div></aside>\n';
}

function notFoundPage() {
  return shell('Citehound: report not available', 'ps-body', card('<p class="ps-kicker">Citehound Pro</p><h1 class="ps-title">This report is not available</h1><p class="ps-lead">The link may be wrong, or the report may no longer be kept. If you expected to find it here, write to <a href="mailto:hey@getcitehound.com">hey@getcitehound.com</a>.</p>'));
}

// The page for any start link that cannot be used. It says one thing for every reason.
function linkUnavailablePage() {
  return shell('Citehound Pro: this link is not available', 'ps-body', card('<p class="ps-kicker">Citehound Pro</p><h1 class="ps-title">This link is not available</h1><p class="ps-lead">If you were sent this link and expected it to work, write to <a href="mailto:hey@getcitehound.com">hey@getcitehound.com</a>.</p>'));
}

function errorPage(message) {
  return shell('Citehound Pro', 'ps-body', card('<p class="ps-kicker">Citehound Pro</p><h1 class="ps-title">Something went wrong</h1><p class="ps-lead">' + esc(message) + '</p>'));
}

// The report, or the progress screen, or the reason there is none.
function renderJob(job, opts) {
  opts = opts || {};
  if (job.status === 'queued' || job.status === 'running') {
    return shell('Citehound: making a report', 'ps-body', BAR + '<main id="main" class="ps"><div class="ps__inner"><section class="ps-card" data-pro-job="' + esc(job.id) + '"><p class="ps-lead">Loading&hellip;</p></section></div></main>\n' +
      '<noscript><p class="ps-card">This report is still being made. Open this page with JavaScript on to watch it, or come back in a few minutes.</p></noscript>\n',
      '  <script src="/app/pro-progress.js?v=7"></script>\n');
  }
  if (job.status === 'failed') {
    // A job that read no page gave its link back: say so, without naming the link (the page knows only the job).
    const back = job.linkRestored;
    return shell('Citehound: report not made', 'ps-body', card('<p class="ps-kicker">Citehound Pro</p><h1 class="ps-title">' + (back ? 'We couldn\u2019t scan this site' : 'We could not make this report') + '</h1>' +
      (back ? '<p class="ps-lead">We couldn\u2019t scan this site. Your link is still valid, try again or use a different site.</p><p class="ps-note">' + esc(job.reason || 'The crawl could not read the site.') + '</p><p class="ps-note">Open the link you were sent again to start over.</p>'
        : '<p class="ps-lead">' + esc(job.reason || 'The crawl could not read the site.') + '</p><p class="ps-note">Write to <a href="mailto:hey@getcitehound.com">hey@getcitehound.com</a> with this page\u2019s address and we will look into it.</p>')));
  }
  const data = jobToReportData(job);
  const estimate = Estimate.estimate(data);
  // The citation check, when this job ran one: a section before the estimate, a card in the summary, and a frame line that says so.
  const cit = job.citation ? { extraSection: CitSection.section(job.citation), summaryCardHtml: CitSection.card(job.citation), frameText: CitSection.frameText(job.citation) } : {};
  const body = render.renderPro(data, Object.assign({
    schema: schema, estimate: estimate, cap: CAP, label: 'Pro report', jobId: job.id, expires: job.expiresAt,
    actions: { copy: true, print: true, email: !!opts.emailEnabled },
    notice: job.status === 'partial' ? { title: 'This report covers part of the site.', text: (job.reason || '') + ' Everything below says what it covers.' } : null
  }, cit));
  return shell('Citehound report for ' + job.domain, 'pr-body', '<main id="main">\n' + body + feedbackSection() + '</main>\n<div class="toast" id="toast" role="status" aria-live="polite"></div>\n',
    '  <script src="/lib/report-pro-ui.js?v=3" defer></script>\n  <script src="/app/pro-feedback.js?v=1" defer></script>\n');
}

module.exports = { welcomePage: welcomePage, shell: shell, card: card, render: renderJob, notFoundPage: notFoundPage, linkUnavailablePage: linkUnavailablePage, errorPage: errorPage, CSS_VERSION: CSS_VERSION };
