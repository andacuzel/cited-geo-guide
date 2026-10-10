/* =====================================================================
   lib/pro-citation-section.js: the "Citation check (sample)" part of a Pro report, and its card in the summary.

   Built from a job's stored citation record (lib/pro-store.js getCitation). The section goes after the details and
   before "Estimated score if you apply these fixes" (lib/report-render.js renderPro takes it as opts.extraSection),
   the card sits in the summary. Neutral language only: one run, one assistant and model, one date; a sample, not a
   ranking and not a measure of overall AI visibility; the readiness score is separate. Where order carries no meaning
   (the questions, the cited domains) it is alphabetical. The profile the questions were based on is shown, so a
   wrong reading can be seen and the questions read with that in mind.
   ===================================================================== */

'use strict';

const Lang = require('./lang-detect.js');

const esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
const longDate = function (iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return ''; return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1]; };

const FRAME_WITH_CITATION = 'Citehound measures AI readiness: crawler access and on-page signals. The score does not measure whether or how often AI assistants mention a brand. The Citation check below is a separate, dated sample.';

function stats(c) {
  const items = (c.questions && c.questions.items) || [];
  const rows = items.map(function (q, i) { return { q: q, r: c.results[i] || null, i: i }; });
  const tested = rows.filter(function (x) { return x.r && x.r.state === 'tested'; });
  return { items: items, rows: rows, tested: tested, cited: tested.filter(function (x) { return x.r.cited; }).length, mentioned: tested.filter(function (x) { return x.r.mentioned; }).length };
}

// The small card in the summary. Counts side by side, no arrow, always labelled as a sample.
function card(c) {
  if (!c) return '';
  const s = stats(c);
  let inner;
  if (!s.tested.length) inner = '<p class="pr-citecard__text">Not tested. ' + esc(c.reason || 'The check could not run.') + (s.items.length ? ' The questions are listed below to copy.' : '') + '</p>';
  else inner = '<ul class="pr-citecard__nums"><li><strong data-fig="pr-cit-tested">' + s.tested.length + '</strong><span>questions tested</span></li><li><strong data-fig="pr-cit-cited">' + s.cited + '</strong><span>cited this site</span></li><li><strong data-fig="pr-cit-mentioned">' + s.mentioned + '</strong><span>mentioned it</span></li></ul>' +
    '<p class="pr-citecard__text">One run on one assistant, ' + esc(longDate(c.date)) + '. Not a ranking.</p>';
  return '<div class="pr-citecard"><p class="pr-citecard__tag"><span class="rp-chip">Sample</span> Citation check</p>' + inner + '<p class="pr-citecard__link"><a href="#pr-citation">See the citation check</a></p></div>\n';
}

function profileBlock(p) {
  if (!p) return '';
  const row = function (k, v) { return v ? '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>' : ''; };
  return '<h3 class="pr-h3">What the questions were based on</h3>\n<dl class="pr-coverage pr-citeprofile">' +
    row('Brand name', p.brandName) + row('Language of the questions', Lang.nameOf(p.language) + ' (' + p.language + ')') + row('Site type', String(p.siteType || '').replace(/_/g, ' ')) +
    row('Category', p.category) + row('Offering', p.offering) + row('Audience', p.audience) + row('Geography', p.geography) + '</dl>\n' +
    '<p class="pr-note">This is how Citehound read the site. If it is wrong, the questions below are about something else: copy them, change them and try them yourself.</p>\n';
}

function readThis(c, s) {
  return '<div class="pr-cite-how"><h3 class="pr-h3">How to read this</h3><ul class="pr-caveats">' +
    '<li>One run, on one assistant and model' + (c.model ? ' (' + esc(c.model) + ' with Google Search)' : '') + ', on ' + esc(longDate(c.date) || 'the date shown') + '. Answers change between runs, even for the same question.</li>' +
    '<li>This is a sample of ' + (s.items.length || 'a few') + ' questions. It is not a ranking and not a measure of overall AI visibility.</li>' +
    '<li>Cited means the site’s domain was among the sources the assistant showed. Mentioned means the brand name or the domain appears in the answer text. They can differ.</li>' +
    '<li>The readiness score is separate: it measures whether crawlers can reach and read your pages.</li>' +
    '<li>The questions were written by a language model from the pages it read, and checked by rules. They were not asked of any other assistant.</li></ul></div>\n';
}

function section(c) {
  if (!c) return null;
  const s = stats(c);
  let h = '<section class="pr-section" id="pr-citation" aria-labelledby="pr-citation-h">\n<h2 class="pr-h2" id="pr-citation-h">Citation check (sample)</h2>\n';
  if (!s.items.length) {
    h += '<p class="pr-note"><span class="rp-chip">Sample</span> Not tested. ' + esc(c.reason || 'The check could not run.') + '</p>\n';
    h += profileBlock(c.profile) + '</section>\n';
    return { id: 'pr-citation', name: 'Citation check (sample)', html: h };
  }
  const lang = c.profile && c.profile.language ? c.profile.language : 'en';
  h += '<p class="pr-text"><span class="rp-chip">Sample</span> ' + (s.tested.length ? 'We asked ' + s.tested.length + (s.tested.length === 1 ? ' question' : ' questions') + ' to an assistant that searches the web and recorded which sources it showed and what it named.' : 'The questions were written but could not be tested.') + '</p>\n';
  if (!s.tested.length || s.tested.length < s.items.length) h += '<p class="pr-note"><strong>Not tested.</strong> ' + esc(c.reason || 'Some questions were not tested.') + '</p>\n';
  h += profileBlock(c.profile);
  if (s.tested.length) {
    h += '<ul class="pr-citecard__nums pr-cite-sum"><li><strong>' + s.tested.length + '</strong><span>questions tested</span></li><li><strong>' + s.cited + '</strong><span>cited this site</span></li><li><strong>' + s.mentioned + '</strong><span>mentioned it</span></li></ul>\n';
  }
  h += '<h3 class="pr-h3" id="pr-cite-questions">Questions</h3>\n';
  h += '<div class="pr-controls" data-cit-controls hidden><label class="pr-field"><span class="pr-vh">Show</span><select class="field pr-input" data-cit-filter><option value="">All questions</option><option value="yes">Cited</option><option value="no">Not cited</option></select></label>' +
    '<button type="button" class="btn btn--ghost" data-cit-copy>Copy all questions</button><p class="pr-count" data-cit-count role="status" aria-live="polite"></p></div>\n';
  const order = function (a, b) { return a.q.text.localeCompare(b.q.text, lang); };
  const open = s.rows.filter(function (x) { return !x.q.brand; }).sort(order), brand = s.rows.filter(function (x) { return x.q.brand; }).sort(order);
  const rowHtml = function (x) {
    const r = x.r, t = r && r.state === 'tested';
    return '<tr role="row" class="pr-citerow" data-cited="' + (t ? (r.cited ? 'yes' : 'no') : 'untested') + '">' +
      '<th scope="row" role="rowheader" data-label="Question"><span lang="' + esc(lang) + '" data-cit-q>' + esc(x.q.text) + '</span>' + (x.q.gloss ? '<span class="pr-muted pr-citegloss">' + esc(x.q.gloss) + '</span>' : '') + '</th>' +
      '<td role="cell" data-label="Cited">' + (t ? '<span class="pr-state pr-state--' + (r.cited ? 'pass' : 'fail') + '">' + (r.cited ? 'Yes' : 'No') + '</span>' : '<span class="pr-muted">Not tested</span>') + '</td>' +
      '<td role="cell" data-label="Mentioned">' + (t ? '<span class="pr-state pr-state--' + (r.mentioned ? 'pass' : 'fail') + '">' + (r.mentioned ? 'Yes' : 'No') + '</span>' : '<span class="pr-muted">Not tested</span>') + '</td>' +
      '<td role="cell" data-label="Other cited domains">' + (t ? (r.others.length ? esc(r.others.join(', ')) : '<span class="pr-muted">None shown</span>') : '<span class="pr-muted">–</span>') + '</td></tr>\n';
  };
  const table = function (rows, cap) {
    return '<div class="pr-tablewrap"><table class="pr-table pr-table--cite" role="table"><caption class="pr-vh">' + esc(cap) + '</caption><thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Question</th><th scope="col" role="columnheader">Cited</th><th scope="col" role="columnheader">Mentioned</th><th scope="col" role="columnheader">Other cited domains</th></tr></thead><tbody role="rowgroup">\n' + rows.map(rowHtml).join('') + '</tbody></table></div>\n';
  };
  h += table(open, 'Questions that do not name the brand');
  if (brand.length) h += '<h3 class="pr-h3">Questions that name the brand</h3>\n' + table(brand, 'Questions that name the brand');
  h += '<p class="pr-empty" data-cit-empty hidden>No question matches.</p>\n';
  if (c.source && /vertical/.test(c.source)) h += '<p class="pr-note">Some questions come from Citehound’s own question set for this category (' + esc(c.source.replace(/^.*vertical:/, '')) + ').</p>\n';
  h += readThis(c, s) + '</section>\n';
  return { id: 'pr-citation', name: 'Citation check (sample)', html: h };
}

module.exports = { section: section, card: card, stats: stats, FRAME_WITH_CITATION: FRAME_WITH_CITATION };
