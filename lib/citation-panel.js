/* =====================================================================
   lib/citation-panel.js — the Citations tab of the report.

   Two jobs:
     fromSample(sample)   turns the published sample (content/citations/
                          sample-crm.json, one model, anonymised) into the
                          citation result schema, version 1
     panel(result, opts)  renders the tab: a real result in a per-model column
                          layout, or "No citation run for this site yet"

   The schema is documented in local/pro-notes.md. In short:
     { schemaVersion: 1, label, vertical, questionSetVersion,
       models: [ { key, provider, model, date, mode, tries } ],
       questions: [ { id, text, byModel: { <key>: { marks: ['named'|'absent'…], group } } } ],
       overall: { byModel: { <key>: { mentionRate, range: { min, max }, sweeps } } },
       namedInstead: { byModel: { <key>: [ { name, shareOfVoice, range } ] } } | null,
       sourceDomains: { byModel: { <key>: [ { domain, count } ] } } | null }   // grounded runs only

   Nothing here starts a run or calls a model. The panel only draws data it is
   given. In the demo and sample reports that data is the published CRM sample,
   labelled as belonging to a different brand.

   UMD, like the other report libraries.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./icons.js'));
  } else {
    root.ANSWERABLE_CITATION_PANEL = factory(root.ANSWERABLE_ICONS);
  }
}(typeof self !== 'undefined' ? self : this, function (ICONS) {
  'use strict';

  var SCHEMA_VERSION = 1;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  var MAILTO = 'mailto:andacuz@gmail.com?subject=Citation%20run%20request&body=Brand%3A%0D%0ADomain%3A%0D%0ACategory%3A%0D%0AThree%20competitors%3A%0D%0A';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fig(key, v) { return '<span data-fig="' + key + '">' + esc(v) + '</span>'; }
  function word(n) { return n >= 0 && n < WORDS.length ? WORDS[n] : String(n); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function longDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : String(iso || '');
  }
  function icon(name) { return ICONS ? ICONS.svg(name) : ''; }
  var isNamed = function (r) { return r === 'featured' || r === 'named'; };

  /* ---------------- the published sample -> schema v1 ---------------- */

  function fromSample(s) {
    var key = (s.provider || 'gemini') + ':' + s.model;
    var result = {
      schemaVersion: SCHEMA_VERSION,
      label: s.label,
      vertical: s.vertical,
      questionSetVersion: s.questionSetVersion || null,
      models: [{ key: key, provider: s.provider || 'gemini', model: s.model, date: s.date, mode: s.mode, tries: s.runsPerPrompt }],
      questions: s.prompts.map(function (p) {
        var by = {};
        by[key] = { marks: p.runs.map(function (r) { return isNamed(r) ? 'named' : 'absent'; }), group: p.group };
        return { id: p.id, text: p.question, byModel: by };
      }),
      overall: { byModel: {} },
      // The sample is anonymised: it names no competitor, and it was produced without web search.
      namedInstead: null,
      sourceDomains: null
    };
    result.overall.byModel[key] = { mentionRate: s.overall.mentionRate, range: s.overall.range, sweeps: s.overall.sweeps };
    return result;
  }

  // Returns a list of problems; empty when the result fits schema v1.
  function validate(r) {
    var p = [];
    if (!r || r.schemaVersion !== SCHEMA_VERSION) return ['schemaVersion must be ' + SCHEMA_VERSION];
    if (!Array.isArray(r.models) || !r.models.length) p.push('models must be a non-empty array');
    (r.models || []).forEach(function (m, i) {
      ['key', 'provider', 'model', 'date', 'mode'].forEach(function (k) { if (typeof m[k] !== 'string' || !m[k]) p.push('models[' + i + '].' + k + ' is required'); });
      if (m.mode !== 'grounded' && m.mode !== 'ungrounded') p.push('models[' + i + '].mode must be grounded or ungrounded');
      if (!(m.tries >= 1)) p.push('models[' + i + '].tries must be 1 or more');
    });
    if (!Array.isArray(r.questions) || !r.questions.length) p.push('questions must be a non-empty array');
    (r.questions || []).forEach(function (q, i) {
      (r.models || []).forEach(function (m) {
        var c = q.byModel && q.byModel[m.key];
        if (!c) { p.push('questions[' + i + '] has no marks for ' + m.key); return; }
        if (!Array.isArray(c.marks) || c.marks.length !== m.tries) p.push('questions[' + i + '] has ' + (c.marks && c.marks.length) + ' marks for ' + m.key + ', expected ' + m.tries);
        if (['always', 'unstable', 'never'].indexOf(c.group) === -1) p.push('questions[' + i + '] has an invalid group for ' + m.key);
      });
    });
    (r.models || []).forEach(function (m) {
      if (m.mode !== 'grounded' && r.sourceDomains && r.sourceDomains.byModel && r.sourceDomains.byModel[m.key]) p.push('source domains are only allowed for grounded runs (' + m.key + ')');
    });
    return p;
  }

  /* ---------------- figures, derived from the result ---------------- */

  function derive(r) {
    var first = r.models[0];
    var by = { never: [], unstable: [], always: [] };
    r.questions.forEach(function (q) { by[q.byModel[first.key].group].push(q); });
    var named = 0, total = 0;
    r.questions.forEach(function (q) { var m = q.byModel[first.key].marks; total += m.length; named += m.filter(function (x) { return x === 'named'; }).length; });
    return { first: first, by: by, never: by.never.length, unstable: by.unstable.length, always: by.always.length, questions: r.questions.length, namedAnswers: named, totalAnswers: total };
  }

  /* ---------------- markup ---------------- */

  function marks(list) {
    return '<span class="ct-marks">' + list.map(function (m, i) {
      var n = m === 'named';
      return '<span class="ct-mark ' + (n ? 'ct-mark--named' : 'ct-mark--absent') + '" role="img" aria-label="try ' + (i + 1) + ': ' + (n ? 'named' : 'not named') + '"></span>';
    }).join('') + '</span>';
  }

  function group(r, d, key, title, intro, open) {
    var list = d.by[key];
    var h = '<details class="ct-detail"' + (open ? ' open' : '') + ' data-group="' + key + '"><summary><span class="ct-detail__title">' + title + '</span><span class="ct-detail__count">' + fig('cit-' + key + '-count', list.length) + ' questions</span></summary>\n';
    h += '<p class="ct-detail__intro">' + intro + '</p>\n';
    h += '<div class="rp-cit-tablewrap"><table class="rp-cit-table"><caption class="rp-vh">' + esc(title) + ': one row per question, one column per model, each mark one try</caption>\n<thead><tr><th scope="col">Question</th>';
    r.models.forEach(function (m) { h += '<th scope="col" class="rp-cit-model"><span class="rp-cit-model__name">' + esc(m.model) + '</span><span class="rp-cit-model__meta">' + esc(m.provider) + ', ' + esc(longDate(m.date)) + ', ' + (m.mode === 'grounded' ? 'with web search' : 'no web search') + '</span></th>'; });
    h += '</tr></thead><tbody>\n';
    list.forEach(function (q) {
      h += '<tr class="rp-cit-row"><th scope="row" class="rp-cit-q">' + esc(q.text) + '</th>';
      r.models.forEach(function (m) { h += '<td>' + marks(q.byModel[m.key].marks) + '</td>'; });
      h += '</tr>\n';
    });
    h += '</tbody></table></div></details>\n';
    return h;
  }

  function ctaBlock() {
    return '<p class="rp-cit-cta"><a class="btn btn--gold" href="' + MAILTO.replace(/&/g, '&amp;') + '">Get early access</a> <span class="rp-note">A self-serve version is still to come. Today we run it for you.</span></p>\n';
  }

  // opts: { sample: true } marks the data as another brand's published sample.
  function panel(result, opts) {
    opts = opts || {};
    var h = '';
    if (!result) {
      h += '<div class="rp-cit rp-cit--empty">\n<p class="rp-exec__headline">No citation run for this site yet</p>\n';
      h += '<p class="rp-text">A citation run asks a model the buying questions your customers ask, ' + word(opts.tries || 5) + ' times each, and records when your name comes up and when it does not. It is a different measurement from the crawl above: this report shows whether your pages can be read, a run shows what a model says.</p>\n';
      h += '<p class="rp-text">A run uses a fixed set of questions for your category, each asked ' + word(opts.tries || 5) + ' times in a new conversation. Nothing on this page starts one.</p>\n';
      h += ctaBlock() + '</div>\n';
      return h;
    }
    var d = derive(result);
    var problems = validate(result);
    if (problems.length) return '<p class="rp-state rp-state--error">The citation result does not fit the schema: ' + esc(problems[0]) + '</p>';
    var m0 = d.first;
    h += '<div class="rp-cit" data-shot="citations">\n';
    if (opts.sample) {
      h += '<p class="rp-cit-label"><span class="rp-chip rp-chip--gain">Sample from a different brand</span> This is the published sample for ' + esc(result.label) + ', not a result for this site. It shows what a run looks like.</p>\n';
    }
    h += '<p class="rp-cit-lead">Real answers from ' + fig('cit-model', m0.model) + ' on ' + fig('cit-date', longDate(m0.date)) + ', ' + fig('cit-tries', word(m0.tries)) + ' tries per question, ' + (m0.mode === 'grounded' ? 'with web search' : 'without web search') + '. Each mark is one try: a filled mark means the brand was named, a hollow one means it was not.</p>\n';
    h += '<ul class="rp-kpis rp-kpis--three">\n';
    h += '<li class="rp-kpi"><span class="rp-kpi__num">' + fig('cit-never', d.never) + '</span><span class="rp-kpi__label">Never named<br /><small>questions where the brand was never named</small></span></li>\n';
    h += '<li class="rp-kpi"><span class="rp-kpi__num">' + fig('cit-unstable', d.unstable) + '</span><span class="rp-kpi__label">Named only sometimes<br /><small>questions where it appeared in some tries</small></span></li>\n';
    h += '<li class="rp-kpi"><span class="rp-kpi__num">' + fig('cit-always', d.always) + '</span><span class="rp-kpi__label">Named every time<br /><small>questions where it was named in every try</small></span></li>\n';
    h += '</ul>\n';
    h += '<p class="rp-note">Across all ' + fig('cit-total', d.totalAnswers) + ' answers the brand was named in ' + fig('cit-named', d.namedAnswers) + '. ' + fig('cit-questions', d.questions) + ' questions in all.</p>\n';
    h += '<div class="rp-cit-groups">\n';
    h += group(result, d, 'never', 'Never named', 'These are the gaps. In every try, the answer did not include the brand.', true);
    h += group(result, d, 'unstable', 'Named only sometimes', 'The same question gave a different answer from one try to the next.', false);
    h += group(result, d, 'always', 'Named every time', 'In every try, the answer included the brand.', false);
    h += '</div>\n';
    h += '<p class="rp-note">' + (result.namedInstead ? '' : 'Who is named instead is not part of the published sample: it is anonymised and names no competitor. A run for your brand lists them. ') + (result.sourceDomains ? '' : 'Source domains appear only for runs made with web search, and this one was made without it. ') + 'One model on one date. It is not a ranking, it says nothing about other assistants, and a name inside a dismissive aside counts as named, not as an endorsement.</p>\n';
    h += ctaBlock() + '</div>\n';
    return h;
  }

  return { SCHEMA_VERSION: SCHEMA_VERSION, fromSample: fromSample, validate: validate, derive: derive, panel: panel, longDate: longDate };
}));
