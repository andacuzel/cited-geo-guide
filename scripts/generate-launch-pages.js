#!/usr/bin/env node
/* =====================================================================
   scripts/generate-launch-pages.js

   The two signup pages of the launch lead-magnet, written from
   lib/launch-config.js and lib/page-shell.js:

     /<REPORT_SLUG>   the gated research report: email in, report out
     /founding        the Pro waitlist: founding-customer terms, shown as static text

   Both are noindex and nothing links to them. While ENABLED is false this writes
   NOTHING, so no page is deployed or reachable; --check then fails if one exists.
   When ENABLED is true it writes <REPORT_SLUG>.html and founding.html at the repository
   root, and --check compares them with what the config gives.

     node scripts/generate-launch-pages.js            write the pages (only when ENABLED)
     node scripts/generate-launch-pages.js --check    disabled: no page exists; enabled: pages are current
     node scripts/generate-launch-pages.js --preview [dir]
                                                      write both pages with bracketed placeholders for
                                                      the undecided values, to dir (default local/launch-preview),
                                                      for review. Never into the repository root.

   The form posts JSON to /api/subscribe. No tracking, no analytics, no third-party script.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const shell = require('../lib/page-shell.js');
const launch = require('../lib/launch-config.js');

const ROOT = path.resolve(__dirname, '..');
const CSS_VERSION = 66;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function longDate(iso) {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(String(iso));
  if (!m) return String(iso);
  return MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
}

/* ---------- shared pieces ---------- */

const STYLE = '  <style>\n' +
  '    .launch-section { padding: 56px 0 0; }\n' +
  '    .launch-section:last-of-type { padding-bottom: 96px; }\n' +
  '    .launch-section .section-title { margin-bottom: 20px; }\n' +
  '    .launch-section p { max-width: 640px; color: var(--ink-soft); }\n' +
  '    .signup { max-width: 560px; margin-top: 8px; }\n' +
  '    .signup__row { margin-bottom: 18px; }\n' +
  '    .signup__label { display: block; margin-bottom: 6px; font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.04em; color: var(--ink); }\n' +
  '    .signup__label small { color: var(--ink-faint); font-size: 12px; letter-spacing: 0; }\n' +
  '    .signup .field { width: 100%; }\n' +
  '    .signup__hp { position: absolute; left: -10000px; top: auto; width: 1px; height: 1px; overflow: hidden; }\n' +
  '    .signup__consent { display: flex; gap: 12px; align-items: flex-start; margin: 22px 0; }\n' +
  '    .signup__consent input { flex: none; width: 20px; height: 20px; margin: 2px 0 0; accent-color: var(--navy-950); }\n' +
  '    .signup__consent label { font-size: 15px; line-height: 1.5; color: var(--ink-soft); }\n' +
  '    .signup__consent a { color: var(--gold-deep); text-decoration: underline; text-underline-offset: 2px; }\n' +
  '    .signup__msg { min-height: 24px; margin: 14px 0 0; font-size: 15px; color: var(--ink-soft); }\n' +
  '    .signup__msg.is-error { color: var(--risk); }\n' +
  '    .signup__done { padding: 22px 24px; background: var(--ok-tint, #E3F1EA); border: 1px solid var(--line); border-radius: var(--radius); color: var(--ink); max-width: 560px; }\n' +
  '    .signup__done h3 { margin: 0 0 6px; font-family: var(--font-display); font-weight: 400; font-size: 24px; color: var(--navy-950); }\n' +
  '    .signup__done p { margin: 0; }\n' +
  '    .signup__closed { padding: 22px 24px; background: var(--white); border: 1px solid var(--line); border-radius: var(--radius); max-width: 560px; }\n' +
  '    .launch-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 14px; }\n' +
  '    .launch-list li { padding-left: 18px; border-left: 3px solid var(--gold); }\n' +
  '    .launch-list strong { display: block; color: var(--navy-950); }\n' +
  '    .launch-terms { margin: 0; padding: 18px 22px; background: var(--white); border: 1px solid var(--line); border-radius: var(--radius); }\n' +
  '    .launch-terms dt { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-faint); }\n' +
  '    .launch-terms dd { margin: 2px 0 14px; font-family: var(--font-display); font-size: 26px; color: var(--navy-950); }\n' +
  '    .launch-terms dd:last-child { margin-bottom: 0; }\n' +
  '  </style>\n';

const ROLES = ['Founder or owner', 'Marketing or SEO', 'Product or engineering', 'Agency or consultant', 'Other'];

// The form. `form` is the value sent to /api/subscribe; `consent` is the one purpose-specific sentence.
function formHtml(form, consent, button) {
  const id = (n) => 'su-' + form + '-' + n;
  return '        <form class="signup" id="signupForm" data-form="' + form + '" novalidate>\n' +
    '          <div class="signup__row">\n' +
    '            <label class="signup__label" for="' + id('email') + '">Email <small>(required)</small></label>\n' +
    '            <input class="field" id="' + id('email') + '" name="email" type="email" autocomplete="email" maxlength="254" required />\n' +
    '          </div>\n' +
    '          <div class="signup__row">\n' +
    '            <label class="signup__label" for="' + id('site') + '">Your website <small>(optional)</small></label>\n' +
    '            <input class="field" id="' + id('site') + '" name="site" type="text" inputmode="url" autocomplete="url" maxlength="200" placeholder="example.com" />\n' +
    '          </div>\n' +
    '          <div class="signup__row">\n' +
    '            <label class="signup__label" for="' + id('role') + '">Your role <small>(optional)</small></label>\n' +
    '            <select class="field" id="' + id('role') + '" name="role">\n' +
    '              <option value="">Prefer not to say</option>\n' +
    ROLES.map((r) => '              <option>' + esc(r) + '</option>\n').join('') +
    '            </select>\n' +
    '          </div>\n' +
    '          <div class="signup__hp" aria-hidden="true">\n' +
    '            <label for="' + id('fax') + '">Leave this field empty</label>\n' +
    '            <input id="' + id('fax') + '" name="company_fax" type="text" tabindex="-1" autocomplete="off" />\n' +
    '          </div>\n' +
    '          <div class="signup__consent">\n' +
    '            <input id="' + id('consent') + '" name="consent" type="checkbox" required />\n' +
    '            <label for="' + id('consent') + '">' + consent + '</label>\n' +
    '          </div>\n' +
    '          <button type="submit" class="btn btn--gold" id="signupBtn">' + esc(button) + '</button>\n' +
    '          <p class="signup__msg" id="signupMsg" role="status" aria-live="polite"></p>\n' +
    '          <noscript><p class="signup__msg is-error">Signing up needs JavaScript. You can also write to ' + esc(require('../lib/site-config.js').contactEmail) + '.</p></noscript>\n' +
    '        </form>\n' + SCRIPT;
}

// One small script, no dependency, no request except the signup itself.
const SCRIPT = '        <script>\n' +
`        (function () {
          var form = document.getElementById('signupForm');
          if (!form) return;
          var msg = document.getElementById('signupMsg');
          var btn = document.getElementById('signupBtn');
          var kind = form.getAttribute('data-form');
          function say(text, isError) { msg.textContent = text; msg.className = 'signup__msg' + (isError ? ' is-error' : ''); }
          function field(name) { return form.elements[name]; }
          function done(title, text) {
            var box = document.createElement('div');
            box.className = 'signup__done';
            box.setAttribute('role', 'status');
            var h = document.createElement('h3'); h.textContent = title;
            var p = document.createElement('p'); p.textContent = text;
            box.appendChild(h); box.appendChild(p);
            form.parentNode.replaceChild(box, form);
            box.tabIndex = -1; box.focus();
          }
          function closed() {
            var box = document.createElement('div');
            box.className = 'signup__closed';
            box.setAttribute('role', 'status');
            var p = document.createElement('p'); p.textContent = 'Signups are not open yet. Please check back soon.';
            box.appendChild(p);
            form.parentNode.replaceChild(box, form);
          }
          form.addEventListener('submit', function (e) {
            e.preventDefault();
            var email = field('email').value.trim();
            if (!email || !field('email').checkValidity()) { say('Enter a valid email address.', true); field('email').focus(); return; }
            if (!field('consent').checked) { say('Tick the box to confirm you want these emails.', true); field('consent').focus(); return; }
            say('Sending…', false);
            btn.disabled = true;
            fetch('/api/subscribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: email, site: field('site').value.trim(), role: field('role').value, form: kind, consent: true, company_fax: field('company_fax').value })
            }).then(function (res) {
              return res.json().catch(function () { return {}; }).then(function (body) { return { status: res.status, body: body }; });
            }).then(function (r) {
              if (r.status === 200) { done('Check your inbox.', 'We sent a confirmation email. Click the link in it to finish signing up. If it does not arrive in a few minutes, look in your spam folder.'); return; }
              btn.disabled = false;
              if (r.status === 503) { closed(); return; }
              if (r.status === 429) { say('Too many attempts from this connection. Please try again in a little while.', true); return; }
              if (r.body && r.body.error === 'invalid_email') { say('That email address does not look right.', true); field('email').focus(); return; }
              if (r.body && r.body.error === 'consent_required') { say('Tick the box to confirm you want these emails.', true); return; }
              say('Something went wrong on our side. Please try again in a moment.', true);
            }).catch(function () {
              btn.disabled = false;
              say('We could not reach the server. Check your connection and try again.', true);
            });
          });
        }());
` + '        </script>\n';

function section(inner, label) {
  return '    <section class="launch-section" aria-labelledby="' + label + '">\n      <div class="section__inner">\n' + inner + '      </div>\n    </section>\n';
}

/* ---------- the two pages ---------- */

function reportPage(v) {
  const slug = v.REPORT_SLUG;
  const body =
    shell.banner({
      kicker: 'Research report · by email',
      title: esc(v.EDITION_NAME),
      desc: 'An aggregate analysis of how readable sites are to AI crawlers and answer engines. Free by email, with the sample size and scan dates stated on every figure.'
    }) + '\n' +
    section(
      '        <h2 id="inside-heading" class="section-title">What is inside</h2>\n' +
      '        <ul class="launch-list">\n' +
      '          <li><strong>Aggregate benchmark analysis.</strong> Scores across the sites we scanned, with the number of sites and the scan dates beside every figure.</li>\n' +
      '          <li><strong>Sector breakdown.</strong> How B2B and consumer categories differ, and where they do not.</li>\n' +
      '          <li><strong>The most common gaps.</strong> The checks that fail most often, and how often.</li>\n' +
      '          <li><strong>What typically adds the most points.</strong> What each fix is worth on our 100-point scale. Points are points on the scale, not a forecast of any result.</li>\n' +
      '        </ul>\n', 'inside-heading') + '\n' +
    section(
      '        <h2 id="read-heading" class="section-title">How to read it</h2>\n' +
      '        <p>The report is a snapshot. It states its sample size and the dates the sites were scanned, and it covers homepages only. The sites are a hand-picked list, not a random sample, so it describes the sites we scanned and no wider population. No individual site is named.</p>\n' +
      '        <p>Citehound measures readiness: whether AI crawlers can reach a site and whether its pages carry the signals machines read. It does not measure whether any assistant names a brand. The live <a href="/methodology">methodology</a> and the <a href="/benchmarks">benchmarks</a> stay free and public.</p>\n', 'read-heading') + '\n' +
    section(
      '        <h2 id="signup-heading" class="section-title">Get the report</h2>\n' +
      formHtml('report',
        'Send me the report, and occasional Citehound research updates. I will get a confirmation email first, and every email has an unsubscribe link. How we handle my data is in the <a href="/privacy">privacy policy</a>.',
        'Send me the report'), 'signup-heading');
  return shell.page({
    title: 'Citehound — ' + v.EDITION_NAME,
    description: 'Get the Citehound research report by email: an aggregate analysis of AI readiness across sectors, the most common gaps and what each fix is worth in points.',
    path: '/' + slug,
    cssVersion: CSS_VERSION,
    robots: 'noindex, nofollow',
    headExtra: STYLE,
    jsonld: [],
    body: body
  });
}

function foundingPage(v) {
  const cap = v.FOUNDING_CAP;
  const end = longDate(v.END_DATE);
  const body =
    shell.banner({
      kicker: 'Pro · founding customers',
      title: 'Be a founding customer of Citehound Pro.',
      desc: 'Pro is in preparation. Join the list to hear the founding terms and the price before it opens.'
    }) + '\n' +
    section(
      '        <h2 id="what-heading" class="section-title">What this is</h2>\n' +
      '        <p>Pro is the paid report: a whole-site crawl with interpretation written for your site, a comparison with the sites you name, and your score over time. It is in preparation. You can read a sample Pro report today on the <a href="/sample-report">sample report page</a>.</p>\n' +
      '        <p>The free scan, the methodology and the playbooks stay free and public.</p>\n', 'what-heading') + '\n' +
    section(
      '        <h2 id="terms-heading" class="section-title">Founding terms</h2>\n' +
      '        <dl class="launch-terms">\n' +
      '          <dt>Founding customers</dt>\n          <dd>The first ' + esc(cap) + '</dd>\n' +
      '          <dt>Open until</dt>\n          <dd>' + esc(end) + '</dd>\n' +
      '        </dl>\n' +
      '        <p>The founding terms and the price will be sent to everyone on this list before Pro opens, so you can decide with the details in hand. Joining the list costs nothing and is not a commitment to buy.</p>\n', 'terms-heading') + '\n' +
    section(
      '        <h2 id="signup-heading" class="section-title">Join the list</h2>\n' +
      formHtml('founding',
        'Email me the founding terms and the price before Pro opens, and occasional Citehound updates. I will get a confirmation email first, and every email has an unsubscribe link. How we handle my data is in the <a href="/privacy">privacy policy</a>.',
        'Join the Pro list'), 'signup-heading');
  return shell.page({
    title: 'Citehound Pro — founding customers',
    description: 'Join the Citehound Pro list. The first founding customers get the terms and the price by email before Pro opens. Joining is free and not a commitment.',
    path: '/founding',
    cssVersion: CSS_VERSION,
    robots: 'noindex, nofollow',
    headExtra: STYLE,
    jsonld: [],
    body: body
  });
}

const PREVIEW_VALUES = { EDITION_NAME: '[Edition name]', REPORT_SLUG: 'report', FOUNDING_CAP: '[cap]', END_DATE: '[end date]' };

function files(values) {
  const out = {};
  out[values.REPORT_SLUG + '.html'] = reportPage(values);
  out['founding.html'] = foundingPage(values);
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const preview = args.indexOf('--preview');
  if (preview !== -1) {
    const dir = path.resolve(ROOT, args[preview + 1] && args[preview + 1][0] !== '-' ? args[preview + 1] : 'local/launch-preview');
    if (dir === ROOT) { console.error('Refusing to write previews into the repository root.'); process.exit(1); }
    fs.mkdirSync(dir, { recursive: true });
    const f = files(Object.assign({}, PREVIEW_VALUES));
    Object.keys(f).forEach((n) => fs.writeFileSync(path.join(dir, n), f[n]));
    console.log('Preview written to ' + path.relative(ROOT, dir) + ': ' + Object.keys(f).join(', '));
    return;
  }

  const check = args.indexOf('--check') !== -1;
  if (launch.ENABLED !== true) {
    // Dark: no page may exist. The slug is not decided yet, so look for founding.html and for any root page that is noindex and posts to /api/subscribe.
    const present = fs.readdirSync(ROOT).filter((n) => /\.html$/.test(n)).filter((n) => n === 'founding.html' || /data-form="(report|founding)"/.test(fs.readFileSync(path.join(ROOT, n), 'utf8')));
    if (check) {
      if (present.length) { console.error('FAIL: ENABLED is false but launch page(s) exist: ' + present.join(', ')); process.exit(1); }
      console.log('OK: launch lead-magnet is dark (ENABLED false); no launch page exists.');
      return;
    }
    console.log('Launch lead-magnet is dark (ENABLED false): nothing written. Use --preview to review the pages.');
    return;
  }

  const missing = Object.keys(launch).filter((k) => k !== 'ENABLED' && (launch[k] === null || launch[k] === undefined || launch[k] === ''));
  if (missing.length) { console.error('ENABLED is true but these values are not set: ' + missing.join(', ')); process.exit(1); }
  const f = files(launch);
  if (check) {
    const bad = Object.keys(f).filter((n) => !fs.existsSync(path.join(ROOT, n)) || fs.readFileSync(path.join(ROOT, n), 'utf8') !== f[n]);
    if (bad.length) { console.error('FAIL: out of date or missing: ' + bad.join(', ') + '. Run node scripts/generate-launch-pages.js'); process.exit(1); }
    console.log('OK: launch pages match lib/launch-config.js (' + Object.keys(f).join(', ') + ').');
    return;
  }
  Object.keys(f).forEach((n) => fs.writeFileSync(path.join(ROOT, n), f[n]));
  console.log('Wrote ' + Object.keys(f).join(', ') + '.');
}

if (require.main === module) main();
module.exports = { files: files, reportPage: reportPage, foundingPage: foundingPage, longDate: longDate, PREVIEW_VALUES: PREVIEW_VALUES };
