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

const CSS_VERSION = 62;
const CAP = 25;

const esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com" />\n  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n  <link href="https://fonts.googleapis.com/css2?family=Gloock&family=Hanken+Grotesk:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Spline+Sans+Mono:wght@400;500&display=swap" rel="stylesheet" />';

function shell(title, bodyClass, body, scripts) {
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    '  <title>' + esc(title) + '</title>\n  <meta name="robots" content="noindex, nofollow, noarchive" />\n  <meta name="referrer" content="no-referrer" />\n  <meta name="description" content="A private Citehound report. Reached only by its link." />\n' +
    '  <link rel="icon" href="/assets/brand/favicon.svg" type="image/svg+xml" />\n  ' + FONTS + '\n  <link rel="stylesheet" href="/styles.css?v=' + CSS_VERSION + '" />\n</head>\n' +
    '<body class="' + bodyClass + '">\n  <a class="skip-link" href="#main">Skip to content</a>\n' + body + (scripts || '') + '</body>\n</html>\n';
}

const LOGO = '<a class="logo rp-top__logo" href="/" aria-label="Citehound home"><span class="logo__icon" aria-hidden="true"><svg viewBox="13 8.5 52 52" focusable="false"><path fill="currentColor" fill-rule="evenodd" d="M62 30 L58 28.5 L40 20 L35 17.5 L28 12 L21 15.5 Q13 32 17 57 L32 57 Q28.5 46.5 37 41 L39 38 L58 34.5 L61 32.5 Z M27.5 16.5 L16 25 L27 22.5 Z M38.4 22.9 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0 Z"/></svg></span><span class="logo__mark">Citehound</span></a>';
const BAR = '<header class="rp-top"><div class="rp-top__inner">' + LOGO + '<div class="rp-top__meta"><span class="rp-top__label">Pro</span></div></div></header>\n';

function card(inner) {
  return BAR + '<main id="main" class="ps"><div class="ps__inner"><section class="ps-card">' + inner + '</section></div></main>\n';
}

// The optional feedback form: one number from 1 to 5, free text up to 1000 characters, a honeypot. Live reports only.
function feedbackSection() {
  const radios = [1, 2, 3, 4, 5].map(function (n) { return '<label class="pr-feedback__opt"><input type="radio" name="rating" value="' + n + '" /><span>' + n + '</span></label>'; }).join('');
  return '<section class="pr-feedback" id="pr-feedback" aria-labelledby="pr-feedback-h"><div class="pr-feedback__inner">\n' +
    '<h2 class="pr-feedback__title" id="pr-feedback-h">Was this report useful?</h2>\n' +
    '<p class="pr-feedback__lead">Optional, and it goes to the people who make Citehound. It is stored for 90 days with this report\u2019s number, never with your name or email. Please leave personal details out.</p>\n' +
    '<form id="fbForm" class="pr-feedback__form" novalidate>\n' +
    '<fieldset class="pr-feedback__rating"><legend>How useful? 1 is not at all, 5 is very</legend><div class="pr-feedback__opts">' + radios + '</div></fieldset>\n' +
    '<div class="ps-field"><label for="fbText" class="ps-label">Anything we should know? <span class="wl-opt">(optional)</span></label><textarea class="field ps-input pr-feedback__text" id="fbText" name="text" rows="4" maxlength="1000"></textarea><p class="ps-hint" id="fbCount" aria-live="off"></p></div>\n' +
    '<div class="wl-trap" aria-hidden="true"><label>Company fax <input type="text" name="company_fax" tabindex="-1" autocomplete="off" /></label></div>\n' +
    '<p class="ps-actions"><button type="submit" class="btn btn--ghost" id="fbSubmit">Send feedback</button></p>\n' +
    '</form>\n<p class="pr-feedback__status" id="fbStatus" role="status" aria-live="polite" tabindex="-1"></p>\n' +
    '</div></section>\n';
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
      '  <script src="/app/pro-progress.js?v=3"></script>\n');
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
  const body = render.renderPro(data, {
    schema: schema, estimate: estimate, cap: CAP, label: 'Pro report', jobId: job.id, expires: job.expiresAt,
    actions: { copy: true, print: true, email: !!opts.emailEnabled },
    notice: job.status === 'partial' ? { title: 'This report covers part of the site.', text: (job.reason || '') + ' Everything below says what it covers.' } : null
  });
  return shell('Citehound report for ' + job.domain, 'pr-body', '<main id="main">\n' + body + feedbackSection() + '</main>\n<div class="toast" id="toast" role="status" aria-live="polite"></div>\n',
    '  <script src="/lib/report-pro-ui.js?v=1" defer></script>\n  <script src="/app/pro-feedback.js?v=1" defer></script>\n');
}

module.exports = { shell: shell, card: card, render: renderJob, notFoundPage: notFoundPage, linkUnavailablePage: linkUnavailablePage, errorPage: errorPage, CSS_VERSION: CSS_VERSION };
