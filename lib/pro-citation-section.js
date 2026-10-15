/* =====================================================================
   lib/pro-citation-section.js: the citation part of a Pro report, and its card in the summary.

   Built from a job's stored citation record (lib/pro-store.js getCitation). In this order:

     one section per provider that ran         "What Claude's web search cited" / "What ChatGPT's web search cited" / "What Perplexity's search returned", with the model and the date. Per
                                               question of the sample: whether the site's domain was among the cited (Claude) or returned (Perplexity)
                                               pages, whether the brand name appears in the answer text (a plain string match, labelled so), the other
                                               domains as links, and the date. Only counts ("cited in 3 of 10 questions"), no percentage and no composite
                                               score. Two providers are two sections, never merged. A provider that failed says "Citation check
                                               unavailable for <provider>; the questions below are still yours to use."
     "Citation questions"                      always: the predicted questions, generated from the site, grouped by topic (category, comparison,
                                               alternatives, pricing, how-to, and the ones that name the brand) with a count per group, a topic tag and a language
                                               tag on each row, the English gloss, "Copy all questions", and the profile they were based on. Never called
                                               observed buyer prompts. With no provider results the label is "Not tested. Try these in your own assistants."
     "Model knowledge check (no live search)"  only when that switch was on: whether the model's own answer, with no search tool, named the brand or domain.
                                               Never citation tracking, never a "cited" column.

   The section goes after the details and before "Estimated score if you apply these fixes" (lib/report-render.js renderPro takes it as opts.extraSection);
   the card sits in the summary. Neutral language only; where order carries no meaning the lists are alphabetical.
   ===================================================================== */

'use strict';

const Lang = require('./lang-detect.js');
const site = require('./site-config.js');

const esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
const longDate = function (iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return ''; return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1]; };

const FRAME_QUESTIONS = 'Citehound measures AI readiness: crawler access and on-page signals. The score does not measure whether or how often AI assistants mention a brand. The citation questions below are predictions written for you to try yourself; they have not been tested.';
const FRAME_TESTED = 'Citehound measures AI readiness: crawler access and on-page signals. The score does not measure whether or how often AI assistants mention a brand. The citation check below is a separate, dated sample from each provider’s search, one section per provider.';
const NOT_TESTED_LINE = 'Not tested. Try these in your own assistants.';
const PREDICTED_LINE = 'Predicted questions, generated from your site';
const PREDICTED_NOTE = 'A language model wrote these from the pages it read. They are predictions of what buyers might ask, not observed buyer prompts, and they say nothing about real search volume.';

const TOPICS = [['category', 'Category'], ['comparison', 'Comparison'], ['alternatives', 'Alternatives'], ['pricing', 'Pricing'], ['how-to', 'How-to']];

// How each provider's section is titled and what its two yes/no columns mean. Perplexity's reply lists the pages its search returned; it did not mark which
// ones the answer cited, so its column says "returned".
const PROVIDER_COPY = {
  anthropic: { title: 'What Claude’s web search cited', short: 'Claude', who: 'Claude (Anthropic API, web search on)', cited: 'Your site cited', verb: 'cited', how: 'Cited means the site’s domain was among the pages Claude’s web search tool cited in its answer.' },
  openai: { title: 'What ChatGPT’s web search cited', short: 'ChatGPT', who: 'ChatGPT (OpenAI API, web search on)', cited: 'Your site cited', verb: 'cited', how: 'Cited means the site’s domain was among the pages cited in the answer returned by the OpenAI API with its web search tool on.' },
  perplexity: { title: 'What Perplexity’s search returned', short: 'Perplexity', who: 'Perplexity (Sonar via API, web search on)', cited: 'Your site among the sources returned', verb: 'among the sources returned', how: 'Perplexity’s reply lists the pages its search returned. Among the sources returned means the site’s domain was one of them. It does not mean the answer cited it.' }
};

const flag = (c) => ({ test: !!(c.modes && c.modes.test), know: !!(c.modes && c.modes.knowledge) });
const providersOf = (c) => ((c.modes && c.modes.providers) || []).filter((p) => PROVIDER_COPY[p]);
const sampleOf = (c) => c.sample || [];
const items = (c) => (c.questions && c.questions.items) || [];

function rowsFor(c, p) {
  const its = items(c), res = (c.results && c.results[p]) || {};
  return sampleOf(c).map(function (i) { return { q: its[i], r: res[i] || null, i: i }; }).filter(function (x) { return x.q; });
}
function stat(c, p) {
  const rows = rowsFor(c, p), tested = rows.filter(function (x) { return x.r && x.r.state === 'tested'; });
  return { rows: rows, tested: tested, cited: tested.filter(function (x) { return x.r.cited; }).length, mentioned: tested.filter(function (x) { return x.r.mentioned; }).length, st: (c.pstat && c.pstat[p]) || null };
}
// The providers that produced at least one result.
const testedProviders = (c) => providersOf(c).filter((p) => stat(c, p).tested.length > 0);
const anyTested = (c) => flag(c).test && testedProviders(c).length > 0;
const knowledge = (c) => { const rows = sampleOf(c).map(function (i) { return { q: items(c)[i], k: (c.knowledge || {})[i] || null }; }).filter(function (x) { return x.q; }); return { rows: rows, known: rows.filter(function (x) { return x.k && x.k.state === 'tested'; }) }; };
const showsKnowledge = (c) => flag(c).know && knowledge(c).known.length > 0;

const whyNone = (c) => c.reason || (c.status === 'queued' ? 'The crawl ended before the questions could be written.' : '');
const langName = (c) => (c.profile && c.profile.language ? Lang.nameOf(c.profile.language) : '');
const langTag = (c) => (c.profile && c.profile.language ? String(c.profile.language).split('-')[0].toUpperCase() : '');

// The small card in the summary. Counts side by side per provider, never merged, no arrow.
function card(c) {
  if (!c) return '';
  const its = items(c);
  let tag, inner;
  if (anyTested(c)) {
    tag = '<span class="rp-chip">Sample</span> Citation check';
    inner = testedProviders(c).map(function (p) {
      const s = stat(c, p), pc = PROVIDER_COPY[p];
      return '<p class="pr-citecard__text"><strong>' + esc(pc.short) + ':</strong> ' + pc.verb + ' for <span data-fig="pr-cit-' + p + '-cited">' + s.cited + '</span> of <span data-fig="pr-cit-' + p + '-tested">' + s.tested.length + '</span> questions.</p>';
    }).join('') + providersOf(c).filter(function (p) { return testedProviders(c).indexOf(p) === -1; }).map(function (p) {
      return '<p class="pr-citecard__text"><strong>' + esc(PROVIDER_COPY[p].short) + ':</strong> unavailable for this report.</p>';
    }).join('') + '<p class="pr-citecard__text">One run each, ' + esc(longDate(testedProviders(c).map(function (p) { return stat(c, p).tested[0].r.date; })[0])) + '. Not a ranking.</p>';
  } else if (its.length) {
    tag = '<span class="rp-chip">Not tested</span> Citation questions';
    inner = '<ul class="pr-citecard__nums"><li><strong data-fig="pr-cit-questions">' + its.length + '</strong><span>predicted questions' + (langName(c) ? ' in ' + esc(langName(c)) : '') + '</span></li></ul><p class="pr-citecard__text">' + NOT_TESTED_LINE + '</p>';
  } else {
    tag = '<span class="rp-chip">Not tested</span> Citation questions';
    inner = '<p class="pr-citecard__text">No questions were written for this report. ' + esc(whyNone(c)) + '</p>';
  }
  if (showsKnowledge(c)) { const k = knowledge(c); inner += '<p class="pr-citecard__text">Model knowledge check (no live search): ' + k.known.filter(function (x) { return x.k.named; }).length + ' of ' + k.known.length + ' answers named the site.</p>'; }
  return '<div class="pr-citecard"><p class="pr-citecard__tag">' + tag + '</p>' + inner + '<p class="pr-citecard__link"><a href="#pr-citation">' + (anyTested(c) ? 'See the citation check' : 'See the questions') + '</a></p></div>\n';
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
    '<li>The questions were written by a language model from the pages it read, and checked by rules.</li>' +
    '<li>The readiness score is separate: it measures whether crawlers can reach and read your pages.</li></ul></div>\n';
}

// The questions as groups (a details element each: they collapse on a phone) plus the copy controls. The copy button is shown by report-pro-ui.js; without
// JavaScript the plain-text box inside the details element can be selected and copied.
function questionLists(c) {
  const lang = c.profile && c.profile.language ? c.profile.language : 'en';
  const its = items(c).map(function (q, i) { return { q: q, i: i }; });
  const order = function (a, b) { return a.q.text.localeCompare(b.q.text, lang); };
  const lt = langTag(c);
  const li = function (x) { return '<li><span lang="' + esc(lang) + '" data-cit-q>' + esc(x.q.text) + '</span><span class="pr-qtags"><span class="pr-tag" title="Language of the question">' + esc(lt) + '</span><span class="pr-tag">' + esc(x.q.brand ? 'names your brand' : x.q.kind) + '</span></span>' + (x.q.gloss ? '<span class="pr-muted pr-citegloss">' + esc(x.q.gloss) + '</span>' : '') + '</li>\n'; };
  const group = function (title, rows, open) { return rows.length ? '<details class="pr-qgroup"' + (open ? ' open' : '') + '><summary><span class="pr-qgroup__name">' + esc(title) + '</span> <span class="pr-qgroup__count">' + rows.length + '</span></summary><ol class="pr-qlist">\n' + rows.sort(order).map(li).join('') + '</ol></details>\n' : ''; };
  const all = TOPICS.map(function (t) { return its.filter(function (x) { return !x.q.brand && x.q.kind === t[0]; }).sort(order); }).reduce(function (a, b) { return a.concat(b); }, []).concat(its.filter(function (x) { return x.q.brand; }).sort(order)).map(function (x) { return x.q.text; }).join('\n');
  let h = '<h3 class="pr-h3" id="pr-cite-questions">Questions</h3>\n';
  h += '<div class="pr-controls" data-cit-controls hidden><button type="button" class="btn btn--ghost" data-cit-copy>Copy all questions</button><p class="pr-count" data-cit-count role="status" aria-live="polite"></p></div>\n';
  TOPICS.forEach(function (t) { h += group(t[1], its.filter(function (x) { return !x.q.brand && x.q.kind === t[0]; }), true); });
  const known = TOPICS.map(function (t) { return t[0]; });
  h += group('Other topics', its.filter(function (x) { return !x.q.brand && known.indexOf(x.q.kind) === -1; }), true);
  h += group('Questions that name your brand', its.filter(function (x) { return x.q.brand; }), true);
  h += '<details class="pr-qplain"><summary>Show all questions as plain text</summary><textarea class="field pr-qtext" readonly rows="' + Math.min(24, its.length + 1) + '" aria-label="All questions, one per line">' + esc(all) + '</textarea></details>\n';
  return h;
}

function scope(c, p) {
  const pc = PROVIDER_COPY[p];
  return '<div class="pr-cite-how"><h3 class="pr-h3">What this shows, and what it does not</h3><ul class="pr-caveats">' +
    '<li>One provider (' + esc(pc.who) + (stat(c, p).tested[0].r.model ? ', model ' + esc(stat(c, p).tested[0].r.model) : '') + '), one run per question, on ' + esc(longDate(stat(c, p).tested[0].r.date) || 'the date shown') + '. Results vary between runs, even for the same question, and an answer can be inaccurate or out of date.</li>' +
    '<li>It is not a measure of any assistant other than the one named, and it is not a ranking or a share of voice. API results can differ from what the consumer apps show.</li>' +
    '<li>' + esc(pc.how) + ' The brand name column is a plain text match of the brand name or the domain in the answer. The two can differ.</li>' +
    '<li>The questions are predictions written from your site, not observed buyer prompts. The readiness score is separate: it measures whether crawlers can reach and read your pages.</li></ul></div>\n';
}

function domainCell(r) {
  if (!r.others || !r.others.length) return '<span class="pr-muted">None shown</span>';
  return '<span class="pr-domains">' + r.others.map(function (d) {
    const u = r.links && r.links[d];
    return u && /^https:\/\//.test(u) ? '<a href="' + esc(u) + '" rel="noopener noreferrer nofollow" target="_blank">' + esc(d) + '</a>' : esc(d);
  }).join(', ') + '</span>';
}

function providerSection(c, p) {
  const pc = PROVIDER_COPY[p], s = stat(c, p);
  const lang = c.profile && c.profile.language ? c.profile.language : 'en', lt = langTag(c);
  const model = (s.tested[0] && s.tested[0].r.model) || (c.modes.models && c.modes.models[p]) || '';
  let h = '<section class="pr-section pr-provider" id="pr-cite-' + p + '" aria-labelledby="pr-cite-' + p + '-h">\n<h2 class="pr-h2" id="pr-cite-' + p + '-h">' + esc(pc.title) + '</h2>\n';
  if (!s.tested.length) {
    h += '<p class="pr-note"><span class="rp-chip">Not tested</span> <strong>Citation check unavailable for ' + esc(pc.short) + '; the questions below are still yours to use.</strong> ' + esc((s.st && s.st.reason) || c.reason || '') + '</p>\n</section>\n';
    return h;
  }
  h += '<p class="pr-text"><span class="rp-chip">Sample</span> ' + esc(pc.who) + (model ? ', model ' + esc(model) : '') + ', one run per question, ' + esc(longDate(s.tested[0].r.date)) + '.</p>\n';
  if (s.tested.length < s.rows.length) h += '<p class="pr-note"><strong>Partial.</strong> ' + s.tested.length + ' of ' + s.rows.length + ' questions were tested. ' + esc((s.st && s.st.reason) || c.reason || '') + '</p>\n';
  h += '<ul class="pr-citecard__nums pr-cite-sum"><li><strong>' + s.cited + ' of ' + s.tested.length + '</strong><span>questions: your site ' + esc(pc.verb) + '</span></li><li><strong>' + s.mentioned + ' of ' + s.tested.length + '</strong><span>questions: brand name in the answer text</span></li></ul>\n';
  const order = function (a, b) { return a.q.text.localeCompare(b.q.text, lang); };
  const rowHtml = function (x) {
    const r = x.r, t = r && r.state === 'tested';
    return '<tr role="row" class="pr-citerow"><th scope="row" role="rowheader" data-label="Question"><span lang="' + esc(lang) + '">' + esc(x.q.text) + '</span><span class="pr-qtags"><span class="pr-tag">' + esc(lt) + '</span><span class="pr-tag">' + esc(x.q.kind) + '</span></span>' + (x.q.gloss ? '<span class="pr-muted pr-citegloss">' + esc(x.q.gloss) + '</span>' : '') + '</th>' +
      '<td role="cell" data-label="' + esc(pc.cited) + '">' + (t ? '<span class="pr-state pr-state--' + (r.cited ? 'pass' : 'fail') + '">' + (r.cited ? 'Yes' : 'No') + '</span>' : '<span class="pr-muted">Not tested</span>') + '</td>' +
      '<td role="cell" data-label="Brand name in the answer text">' + (t ? '<span class="pr-state pr-state--' + (r.mentioned ? 'pass' : 'fail') + '">' + (r.mentioned ? 'Yes' : 'No') + '</span>' : '<span class="pr-muted">Not tested</span>') + '</td>' +
      '<td role="cell" data-label="Other domains">' + (t ? domainCell(r) : '<span class="pr-muted">–</span>') + '</td>' +
      '<td role="cell" data-label="Run on">' + (t ? esc(longDate(r.date)) : '<span class="pr-muted">–</span>') + '</td></tr>\n';
  };
  h += '<div class="pr-tablewrap"><table class="pr-table pr-table--cite" role="table"><caption class="pr-vh">' + esc(pc.title) + '</caption><thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Question</th><th scope="col" role="columnheader">' + esc(pc.cited) + '</th><th scope="col" role="columnheader">Brand name in the answer text</th><th scope="col" role="columnheader">Other domains</th><th scope="col" role="columnheader">Run on</th></tr></thead><tbody role="rowgroup">\n' + s.rows.slice().sort(order).map(rowHtml).join('') + '</tbody></table></div>\n';
  h += scope(c, p) + '</section>\n';
  return h;
}

function knowledgeBlock(c) {
  const lang = c.profile && c.profile.language ? c.profile.language : 'en';
  const k = knowledge(c), named = k.known.filter(function (x) { return x.k.named; }).length;
  const rows = k.rows.slice().sort(function (a, b) { return a.q.text.localeCompare(b.q.text, lang); });
  let h = '<h3 class="pr-h3" id="pr-knowledge">Model knowledge check (no live search)</h3>\n';
  h += '<p class="pr-text"><span class="rp-chip">Sample</span> We sent ' + k.rows.length + ' of the questions to ' + esc(c.kmodel || 'a language model') + ' without any web search and recorded whether its answer named the brand or the site. This shows what the model carries from training. It is not citation tracking and says nothing about what assistants cite today.</p>\n';
  if (k.known.length < k.rows.length) h += '<p class="pr-note"><strong>Not tested.</strong> ' + esc(c.kreason || 'Some questions were not tested.') + '</p>\n';
  h += '<ul class="pr-citecard__nums pr-cite-sum"><li><strong>' + named + '</strong><span>of ' + k.known.length + ' answers named the site</span></li></ul>\n';
  h += '<div class="pr-tablewrap"><table class="pr-table pr-table--cite" role="table"><caption class="pr-vh">Model knowledge check</caption><thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Question</th><th scope="col" role="columnheader">Named in the answer</th></tr></thead><tbody role="rowgroup">\n' +
    rows.map(function (x) {
      const t = x.k && x.k.state === 'tested';
      return '<tr role="row"><th scope="row" role="rowheader" data-label="Question"><span lang="' + esc(lang) + '">' + esc(x.q.text) + '</span></th><td role="cell" data-label="Named in the answer">' + (t ? '<span class="pr-state pr-state--' + (x.k.named ? 'pass' : 'fail') + '">' + (x.k.named ? 'Yes' : 'No') + '</span>' : '<span class="pr-muted">Not tested</span>') + '</td></tr>\n';
    }).join('') + '</tbody></table></div>\n';
  h += '<div class="pr-cite-how"><h3 class="pr-h3">How to read this</h3><ul class="pr-caveats"><li>One run on one model' + (c.kmodel ? ' (' + esc(c.kmodel) + ')' : '') + ', with no web access. Answers change between runs.</li><li>Named means the brand name or the domain appears in the answer text. It is not a citation.</li><li>It is not a ranking, and it is separate from the readiness score.</li></ul></div>\n';
  return h;
}

function section(c) {
  if (!c) return null;
  const its = items(c), tested = anyTested(c);
  const name = tested ? 'Citation check' : 'Citation questions';
  let h = '<span id="pr-citation"></span>\n';
  // The provider sections come first: the unavailable message says "the questions below".
  if (flag(c).test) providersOf(c).forEach(function (p) { h += providerSection(c, p); });
  h += '<section class="pr-section" aria-labelledby="pr-cite-questions-h">\n<h2 class="pr-h2" id="pr-cite-questions-h">Citation questions</h2>\n';
  if (!its.length) {
    h += '<p class="pr-note"><span class="rp-chip">Not tested</span> No citation questions were written for this report. ' + esc(whyNone(c)) + '</p>\n' + profileBlock(c.profile) + '</section>\n';
  } else {
    h += '<p class="pr-text"><span class="rp-chip">Predicted</span> <strong>' + PREDICTED_LINE + '.</strong> ' + PREDICTED_NOTE + '</p>\n';
    if (!tested) h += '<p class="pr-text"><strong>' + NOT_TESTED_LINE + '</strong></p>\n';
    h += profileBlock(c.profile) + questionLists(c);
    if (c.source && /vertical/.test(c.source)) h += '<p class="pr-note">Some questions come from Citehound’s own question set for this category (' + esc(c.source.replace(/^.*vertical:/, '')) + ').</p>\n';
    if (!tested) h += howToUse();
    if (flag(c).know) {
      if (showsKnowledge(c)) h += knowledgeBlock(c);
      else h += '<h3 class="pr-h3" id="pr-knowledge">Model knowledge check (no live search)</h3>\n<p class="pr-note"><span class="rp-chip">Not tested</span> ' + esc(c.kreason || 'The check could not run.') + '</p>\n';
    }
    h += '</section>\n';
  }
  return { id: 'pr-citation', name: name, html: h };
}

// The line under the score that says what the score is. With a live check in this report it also names the sample.
function frameText(c) { return c && anyTested(c) ? FRAME_TESTED : FRAME_QUESTIONS; }

module.exports = { section: section, card: card, frameText: frameText, FRAME_QUESTIONS: FRAME_QUESTIONS, FRAME_TESTED: FRAME_TESTED, NOT_TESTED_LINE: NOT_TESTED_LINE, PREDICTED_LINE: PREDICTED_LINE, PROVIDER_COPY: PROVIDER_COPY };
