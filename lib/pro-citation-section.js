/* =====================================================================
   lib/pro-citation-section.js: the citation part of a Pro report, and its card in the summary.

   Built from a job's stored citation record (lib/pro-store.js getCitation). Three shapes, chosen by what the job was started with
   (c.modes) and what happened:

     citation questions     (the default; CITATION_QUESTIONS_ENABLED only) the profile the questions were based on, the 21 questions in
                            the site's own language with English glosses, a "Copy all questions" button, and the label
                            "Not tested. Try these in your own assistants." No cited or mentioned claim of any kind, no column for one.
     Citation check (sample)  only when live testing was on for the job and at least one question was tested: cited / mentioned / other
                            cited domains per question, with the "How to read this" block.
     Model knowledge check (no live search)  only when that switch was on: whether the model's own answer, given no search tool, named
                            the brand or domain. Never described as citation tracking, never a "cited" column.

   The section goes after the details and before "Estimated score if you apply these fixes" (lib/report-render.js renderPro takes it as
   opts.extraSection); the card sits in the summary. Neutral language only. Where order carries no meaning the lists are alphabetical.
   ===================================================================== */

'use strict';

const Lang = require('./lang-detect.js');
const site = require('./site-config.js');

const esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
const longDate = function (iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return ''; return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1]; };

const FRAME_QUESTIONS = 'Citehound measures AI readiness: crawler access and on-page signals. The score does not measure whether or how often AI assistants mention a brand. The citation questions below are written for you to try yourself; they have not been tested.';
const FRAME_TESTED = 'Citehound measures AI readiness: crawler access and on-page signals. The score does not measure whether or how often AI assistants mention a brand. The Citation check below is a separate, dated sample.';
const NOT_TESTED_LINE = 'Not tested. Try these in your own assistants.';

const flag = (c) => ({ test: !!(c.modes && c.modes.test), know: !!(c.modes && c.modes.knowledge) });

function stats(c) {
  const items = (c.questions && c.questions.items) || [];
  const rows = items.map(function (q, i) { return { q: q, r: c.results[i] || null, k: (c.knowledge && c.knowledge[i]) || null, i: i }; });
  const tested = rows.filter(function (x) { return x.r && x.r.state === 'tested'; });
  const known = rows.filter(function (x) { return x.k && x.k.state === 'tested'; });
  return { items: items, rows: rows, tested: tested, cited: tested.filter(function (x) { return x.r.cited; }).length, mentioned: tested.filter(function (x) { return x.r.mentioned; }).length, known: known, named: known.filter(function (x) { return x.k.named; }).length };
}

// Live testing is shown only when it was on for this job AND something was tested. Otherwise the report shows the questions, untested.
const showsTest = (c, s) => flag(c).test && s.tested.length > 0;
const showsKnowledge = (c, s) => flag(c).know && s.known.length > 0;

// Why there are no questions: the stored reason, or (for a job whose crawl ended before the citation part began) a plain statement.
const whyNone = (c) => c.reason || (c.status === 'queued' ? 'The crawl ended before the questions could be written.' : '');

function langName(c) { return c.profile && c.profile.language ? Lang.nameOf(c.profile.language) : ''; }

// The small card in the summary. Counts side by side, no arrow, always labelled.
function card(c) {
  if (!c) return '';
  const s = stats(c);
  let tag, inner;
  if (showsTest(c, s)) {
    tag = '<span class="rp-chip">Sample</span> Citation check';
    inner = '<ul class="pr-citecard__nums"><li><strong data-fig="pr-cit-tested">' + s.tested.length + '</strong><span>questions tested</span></li><li><strong data-fig="pr-cit-cited">' + s.cited + '</strong><span>cited this site</span></li><li><strong data-fig="pr-cit-mentioned">' + s.mentioned + '</strong><span>mentioned it</span></li></ul>' +
      '<p class="pr-citecard__text">One run on one assistant, ' + esc(longDate(c.date)) + '. Not a ranking.</p>';
  } else if (s.items.length) {
    tag = '<span class="rp-chip">Not tested</span> Citation questions';
    inner = '<ul class="pr-citecard__nums"><li><strong data-fig="pr-cit-questions">' + s.items.length + '</strong><span>citation questions' + (langName(c) ? ' in ' + esc(langName(c)) : '') + '</span></li></ul>' +
      '<p class="pr-citecard__text">' + NOT_TESTED_LINE + '</p>';
  } else {
    tag = '<span class="rp-chip">Not tested</span> Citation questions';
    inner = '<p class="pr-citecard__text">No questions were written for this report. ' + esc(whyNone(c)) + '</p>';
  }
  if (showsKnowledge(c, s)) inner += '<p class="pr-citecard__text">Model knowledge check (no live search): ' + s.named + ' of ' + s.known.length + ' answers named the site.</p>';
  return '<div class="pr-citecard"><p class="pr-citecard__tag">' + tag + '</p>' + inner + '<p class="pr-citecard__link"><a href="#pr-citation">' + (showsTest(c, s) ? 'See the citation check' : 'See the questions') + '</a></p></div>\n';
}

function profileBlock(p) {
  if (!p) return '';
  const row = function (k, v) { return v ? '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>' : ''; };
  return '<h3 class="pr-h3">What the questions were based on</h3>\n<dl class="pr-coverage pr-citeprofile">' +
    row('Brand name', p.brandName) + row('Language of the questions', Lang.nameOf(p.language) + ' (' + p.language + ')') + row('Site type', String(p.siteType || '').replace(/_/g, ' ')) +
    row('Category', p.category) + row('Offering', p.offering) + row('Audience', p.audience) + row('Geography', p.geography) + '</dl>\n' +
    '<p class="pr-note">This is how Citehound read the site. If a line is wrong, the questions are about something else: change the questions before you use them. You can also write to <a href="mailto:' + esc(site.contactEmail) + '">' + esc(site.contactEmail) + '</a> with what the site is, so the reading can be improved.</p>\n';
}

function howToUse() {
  return '<div class="pr-cite-how"><h3 class="pr-h3">How to use these questions</h3><ul class="pr-caveats">' +
    '<li>Open a new conversation in each assistant you care about and ask one question per conversation.</li>' +
    '<li>Ask each question three to five times. Answers change between runs, even for the same question.</li>' +
    '<li>Note whether your brand or site is named and where, and judge the spread rather than a single answer.</li>' +
    '<li>The questions were written by a language model from the pages it read, and checked by rules. They have not been asked of any assistant.</li>' +
    '<li>The readiness score is separate: it measures whether crawlers can reach and read your pages.</li></ul></div>\n';
}

// The questions as two plain lists plus the copy controls. The copy button is shown by report-pro-ui.js; without JavaScript the
// plain-text box inside the details element can be selected and copied.
function questionLists(c, s) {
  const lang = c.profile && c.profile.language ? c.profile.language : 'en';
  const order = function (a, b) { return a.q.text.localeCompare(b.q.text, lang); };
  const open = s.rows.filter(function (x) { return !x.q.brand; }).sort(order), brand = s.rows.filter(function (x) { return x.q.brand; }).sort(order);
  const li = function (x) { return '<li><span lang="' + esc(lang) + '" data-cit-q>' + esc(x.q.text) + '</span>' + (x.q.gloss ? '<span class="pr-muted pr-citegloss">' + esc(x.q.gloss) + '</span>' : '') + '</li>\n'; };
  const all = open.concat(brand).map(function (x) { return x.q.text; }).join('\n');
  let h = '<h3 class="pr-h3" id="pr-cite-questions">Questions</h3>\n';
  h += '<div class="pr-controls" data-cit-controls hidden><button type="button" class="btn btn--ghost" data-cit-copy>Copy all questions</button><p class="pr-count" data-cit-count role="status" aria-live="polite"></p></div>\n';
  h += '<p class="pr-text"><strong>' + open.length + ' questions that do not name your brand</strong></p>\n<ol class="pr-qlist">\n' + open.map(li).join('') + '</ol>\n';
  if (brand.length) h += '<p class="pr-text"><strong>' + brand.length + ' questions that name your brand</strong></p>\n<ol class="pr-qlist">\n' + brand.map(li).join('') + '</ol>\n';
  h += '<details class="pr-qplain"><summary>Show all questions as plain text</summary><textarea class="field pr-qtext" readonly rows="' + Math.min(24, s.items.length + 1) + '" aria-label="All questions, one per line">' + esc(all) + '</textarea></details>\n';
  return h;
}

function readThis(c, s) {
  return '<div class="pr-cite-how"><h3 class="pr-h3">How to read this</h3><ul class="pr-caveats">' +
    '<li>One run, on one assistant and model' + (c.model ? ' (' + esc(c.model) + ' with web search)' : '') + ', on ' + esc(longDate(c.date) || 'the date shown') + '. Answers change between runs, even for the same question.</li>' +
    '<li>This is a sample of ' + (s.items.length || 'a few') + ' questions. It is not a ranking and not a measure of overall AI visibility.</li>' +
    '<li>Cited means the site’s domain was among the pages the assistant cited. Mentioned means the brand name or the domain appears in the answer text. They can differ.</li>' +
    '<li>The readiness score is separate: it measures whether crawlers can reach and read your pages.</li>' +
    '<li>The questions were written by a language model from the pages it read, and checked by rules.</li></ul></div>\n';
}

function domainCell(r) {
  if (!r.others.length) return '<span class="pr-muted">None shown</span>';
  return r.others.map(function (d) {
    const u = r.links && r.links[d];
    return u && /^https:\/\//.test(u) ? '<a href="' + esc(u) + '" rel="noopener noreferrer nofollow" target="_blank">' + esc(d) + '</a>' : esc(d);
  }).join(', ');
}

function testTable(c, s) {
  const lang = c.profile && c.profile.language ? c.profile.language : 'en';
  const order = function (a, b) { return a.q.text.localeCompare(b.q.text, lang); };
  const open = s.rows.filter(function (x) { return !x.q.brand; }).sort(order), brand = s.rows.filter(function (x) { return x.q.brand; }).sort(order);
  const rowHtml = function (x) {
    const r = x.r, t = r && r.state === 'tested';
    return '<tr role="row" class="pr-citerow" data-cited="' + (t ? (r.cited ? 'yes' : 'no') : 'untested') + '">' +
      '<th scope="row" role="rowheader" data-label="Question"><span lang="' + esc(lang) + '" data-cit-q>' + esc(x.q.text) + '</span>' + (x.q.gloss ? '<span class="pr-muted pr-citegloss">' + esc(x.q.gloss) + '</span>' : '') + '</th>' +
      '<td role="cell" data-label="Cited">' + (t ? '<span class="pr-state pr-state--' + (r.cited ? 'pass' : 'fail') + '">' + (r.cited ? 'Yes' : 'No') + '</span>' : '<span class="pr-muted">Not tested</span>') + '</td>' +
      '<td role="cell" data-label="Mentioned">' + (t ? '<span class="pr-state pr-state--' + (r.mentioned ? 'pass' : 'fail') + '">' + (r.mentioned ? 'Yes' : 'No') + '</span>' : '<span class="pr-muted">Not tested</span>') + '</td>' +
      '<td role="cell" data-label="Other cited domains">' + (t ? domainCell(r) : '<span class="pr-muted">–</span>') + '</td></tr>\n';
  };
  const table = function (rows, cap) {
    return '<div class="pr-tablewrap"><table class="pr-table pr-table--cite" role="table"><caption class="pr-vh">' + esc(cap) + '</caption><thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Question</th><th scope="col" role="columnheader">Cited</th><th scope="col" role="columnheader">Mentioned</th><th scope="col" role="columnheader">Other cited domains</th></tr></thead><tbody role="rowgroup">\n' + rows.map(rowHtml).join('') + '</tbody></table></div>\n';
  };
  let h = '<h3 class="pr-h3" id="pr-cite-questions">Questions</h3>\n';
  h += '<div class="pr-controls" data-cit-controls hidden><label class="pr-field"><span class="pr-vh">Show</span><select class="field pr-input" data-cit-filter><option value="">All questions</option><option value="yes">Cited</option><option value="no">Not cited</option></select></label>' +
    '<button type="button" class="btn btn--ghost" data-cit-copy>Copy all questions</button><p class="pr-count" data-cit-count role="status" aria-live="polite"></p></div>\n';
  h += table(open, 'Questions that do not name the brand');
  if (brand.length) h += '<h3 class="pr-h3">Questions that name the brand</h3>\n' + table(brand, 'Questions that name the brand');
  h += '<p class="pr-empty" data-cit-empty hidden>No question matches.</p>\n';
  return h;
}

function knowledgeBlock(c, s) {
  const lang = c.profile && c.profile.language ? c.profile.language : 'en';
  const rows = s.rows.slice().sort(function (a, b) { return a.q.text.localeCompare(b.q.text, lang); });
  let h = '<h3 class="pr-h3" id="pr-knowledge">Model knowledge check (no live search)</h3>\n';
  h += '<p class="pr-text"><span class="rp-chip">Sample</span> We sent the same questions to ' + esc(c.kmodel || 'a language model') + ' without any web search and recorded whether its answer named the brand or the site. This shows what the model carries from training. It is not citation tracking and says nothing about what assistants cite today.</p>\n';
  if (s.known.length < s.items.length) h += '<p class="pr-note"><strong>Not tested.</strong> ' + esc(c.kreason || 'Some questions were not tested.') + '</p>\n';
  h += '<ul class="pr-citecard__nums pr-cite-sum"><li><strong>' + s.named + '</strong><span>of ' + s.known.length + ' answers named the site</span></li></ul>\n';
  h += '<div class="pr-tablewrap"><table class="pr-table pr-table--cite" role="table"><caption class="pr-vh">Model knowledge check</caption><thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Question</th><th scope="col" role="columnheader">Named in the answer</th></tr></thead><tbody role="rowgroup">\n' +
    rows.map(function (x) {
      const k = x.k, t = k && k.state === 'tested';
      return '<tr role="row"><th scope="row" role="rowheader" data-label="Question"><span lang="' + esc(lang) + '">' + esc(x.q.text) + '</span>' + (x.q.gloss ? '<span class="pr-muted pr-citegloss">' + esc(x.q.gloss) + '</span>' : '') + '</th><td role="cell" data-label="Named in the answer">' +
        (t ? '<span class="pr-state pr-state--' + (k.named ? 'pass' : 'fail') + '">' + (k.named ? 'Yes' : 'No') + '</span>' : '<span class="pr-muted">Not tested</span>') + '</td></tr>\n';
    }).join('') + '</tbody></table></div>\n';
  h += '<div class="pr-cite-how"><h3 class="pr-h3">How to read this</h3><ul class="pr-caveats">' +
    '<li>One run on one model' + (c.kmodel ? ' (' + esc(c.kmodel) + ')' : '') + ', on ' + esc(longDate(c.kdate) || 'the date shown') + ', with no web access. Answers change between runs.</li>' +
    '<li>Named means the brand name or the domain appears in the answer text. It is not a citation, and the model may name a brand it does not know well, or not name one it does.</li>' +
    '<li>It is not a ranking, and it is separate from the readiness score.</li></ul></div>\n';
  return h;
}

function section(c) {
  if (!c) return null;
  const s = stats(c);
  const tested = showsTest(c, s);
  const name = tested ? 'Citation check (sample)' : 'Citation questions';
  let h = '<section class="pr-section" id="pr-citation" aria-labelledby="pr-citation-h">\n<h2 class="pr-h2" id="pr-citation-h">' + name + '</h2>\n';
  if (!s.items.length) {
    h += '<p class="pr-note"><span class="rp-chip">Not tested</span> No citation questions were written for this report. ' + esc(whyNone(c)) + '</p>\n';
    h += profileBlock(c.profile) + '</section>\n';
    return { id: 'pr-citation', name: name, html: h };
  }
  if (tested) {
    h += '<p class="pr-text"><span class="rp-chip">Sample</span> We asked ' + s.tested.length + (s.tested.length === 1 ? ' question' : ' questions') + ' to an assistant that searches the web and recorded which pages it cited and what it named.</p>\n';
    if (s.tested.length < s.items.length) h += '<p class="pr-note"><strong>Not tested.</strong> ' + esc(c.reason || 'Some questions were not tested.') + '</p>\n';
    h += profileBlock(c.profile);
    h += '<ul class="pr-citecard__nums pr-cite-sum"><li><strong>' + s.tested.length + '</strong><span>questions tested</span></li><li><strong>' + s.cited + '</strong><span>cited this site</span></li><li><strong>' + s.mentioned + '</strong><span>mentioned it</span></li></ul>\n';
    h += testTable(c, s);
  } else {
    h += '<p class="pr-text"><span class="rp-chip">Not tested</span> <strong>' + NOT_TESTED_LINE + '</strong></p>\n';
    if (flag(c).test && c.reason) h += '<p class="pr-note">' + esc(c.reason) + '</p>\n';
    h += profileBlock(c.profile) + questionLists(c, s);
  }
  if (c.source && /vertical/.test(c.source)) h += '<p class="pr-note">Some questions come from Citehound’s own question set for this category (' + esc(c.source.replace(/^.*vertical:/, '')) + ').</p>\n';
  h += tested ? readThis(c, s) : howToUse();
  if (flag(c).know) {
    if (showsKnowledge(c, s)) h += knowledgeBlock(c, s);
    else h += '<h3 class="pr-h3" id="pr-knowledge">Model knowledge check (no live search)</h3>\n<p class="pr-note"><span class="rp-chip">Not tested</span> ' + esc(c.kreason || 'The check could not run.') + '</p>\n';
  }
  h += '</section>\n';
  return { id: 'pr-citation', name: name, html: h };
}

// The line under the score that says what the score is. With live testing in this report it also names the sample.
function frameText(c) { return c && showsTest(c, stats(c)) ? FRAME_TESTED : FRAME_QUESTIONS; }

module.exports = { section: section, card: card, stats: stats, frameText: frameText, FRAME_QUESTIONS: FRAME_QUESTIONS, FRAME_TESTED: FRAME_TESTED, NOT_TESTED_LINE: NOT_TESTED_LINE };
