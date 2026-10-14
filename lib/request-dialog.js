/* =====================================================================
   lib/request-dialog.js: the Fix / Beyond early-access form, as a <dialog>.

   One markup for every page that carries it: the homepage (index.html, between its main section and the toast), /fix and /beyond (written by
   scripts/generate-service-pages.js, which uses inline() instead). request-form.js drives both and posts to /api/waitlist with interest, website
   and note. scripts/generate-service-pages.js --check fails if a page carries a different copy.
   ===================================================================== */

'use strict';

const HTML =
  '<dialog class="req-dialog" id="reqDialog" aria-labelledby="reqTitle">\n' +
  '  <button type="button" class="req-close" id="reqClose" aria-label="Close the form">&times;</button>\n' +
  '  <p class="kicker" id="reqKicker">Early access</p>\n' +
  '  <h2 class="req-title" id="reqTitle">Request a Fix quote</h2>\n' +
  '  <p class="req-lede" id="reqLede">Leave your email and the site. We reply with a quote.</p>\n' +
  '  <form class="ps-form req-form" id="reqForm" novalidate>\n' +
  '    <fieldset class="req-which">\n' +
  '      <legend class="ps-label">I am asking about</legend>\n' +
  '      <label class="ps-check" for="reqFix"><input id="reqFix" name="interest" type="radio" value="fix" checked /><span>Fix: closing the technical gaps</span></label>\n' +
  '      <label class="ps-check" for="reqBeyond"><input id="reqBeyond" name="interest" type="radio" value="beyond" /><span>Beyond: content briefs and drafts</span></label>\n' +
  '    </fieldset>\n' +
  '    <div class="ps-field"><label for="reqEmail" class="ps-label">Email</label><input class="field ps-input" id="reqEmail" name="email" type="email" inputmode="email" autocapitalize="off" autocomplete="email" maxlength="254" aria-describedby="reqEmailError" required /><p class="ps-error" id="reqEmailError" hidden></p></div>\n' +
  '    <div class="ps-field"><label for="reqWebsite" class="ps-label">Website <span class="wl-opt">(optional)</span></label><input class="field ps-input" id="reqWebsite" name="website" type="text" inputmode="url" autocapitalize="off" autocomplete="url" spellcheck="false" maxlength="200" placeholder="yourdomain.com" /></div>\n' +
  '    <div class="ps-field"><label for="reqNote" class="ps-label">One line about what you need <span class="wl-opt">(optional)</span></label><input class="field ps-input" id="reqNote" name="note" type="text" maxlength="200" /></div>\n' +
  '    <div class="wl-trap" aria-hidden="true"><label>Company fax <input type="text" name="company_fax" tabindex="-1" autocomplete="off" /></label></div>\n' +
  '    <div class="ps-field ps-field--check"><label class="ps-check" for="reqConsent"><input id="reqConsent" name="consent" type="checkbox" aria-describedby="reqConsentError" required /><span>You may email me about this request</span></label><p class="ps-error" id="reqConsentError" hidden></p></div>\n' +
  '    <p class="ps-note">We keep your address and what you write here for up to 12 months and use them only to answer you. To have them deleted, write to <a href="mailto:hey@getcitehound.com">hey@getcitehound.com</a>. See the <a href="/privacy">privacy page</a>.</p>\n' +
  '    <p class="ps-actions"><button type="submit" class="btn btn--gold ps-submit" id="reqSubmit">Send</button></p>\n' +
  '    <p class="wl-status" id="reqStatus" role="status" aria-live="polite" tabindex="-1"></p>\n' +
  '  </form>\n' +
  '</dialog>';

// The dialog, each line after the first prefixed with `indent` (the first line sits where the caller puts it).
function html(indent) {
  const pad = indent || '';
  return HTML.split('\n').map((l, i) => (i === 0 ? l : pad + l)).join('\n');
}

const TEXT = {
  fix: { kicker: 'Early access · Fix', title: 'Request a Fix quote', lede: 'Leave your email and the site. We reply with a quote.' },
  beyond: { kicker: 'Early access · Beyond', title: 'Join Beyond early access', lede: 'Leave your email and the site. We write to you about early access.' }
};

// The same form, inline on a page (no dialog, no close button): /fix and /beyond. The page's own interest is the one checked. Same ids, so request-form.js drives it.
function inline(interest, indent) {
  const t = TEXT[interest];
  if (!t) throw new Error('unknown interest: ' + interest);
  const pad = indent || '';
  const a = HTML.indexOf('  <p class="kicker" id="reqKicker">');
  const b = HTML.indexOf('</dialog>');
  let inner = HTML.slice(a, b)
    .replace('>Early access</p>', '>' + t.kicker + '</p>')
    .replace('>Request a Fix quote</h2>', '>' + t.title + '</h2>')
    .replace('>Leave your email and the site. We reply with a quote.</p>', '>' + t.lede + '</p>')
    .replace('<h2 class="req-title" id="reqTitle">', '<h2 class="req-title" id="reqTitle">');
  if (interest === 'beyond') inner = inner.replace('value="fix" checked', 'value="fix"').replace('value="beyond" />', 'value="beyond" checked />');
  const lines = ('<div class="req-inline" id="request">\n' + inner.replace(/\n$/, '') + '\n</div>').split('\n');
  return lines.map((l, i) => (i === 0 ? l : pad + l)).join('\n');
}

const RE = /<dialog class="req-dialog"[\s\S]*?<\/dialog>/;

// The page with its dialog replaced by this one, in the indentation the old one had (or the page unchanged when it has none).
function normalize(page) {
  return page.replace(new RegExp('([ \\t]*)' + RE.source), (m, ind) => ind + html(ind));
}

module.exports = { inline: inline, html: html, normalize: normalize, HTML: HTML, RE: RE };
