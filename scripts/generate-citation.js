#!/usr/bin/env node
/* =====================================================================
   scripts/generate-citation.js

   Reads content/citations/sample-crm.json and writes static HTML for the
   two citation-tracking surfaces, the way generate-benchmarks.js does:

     index.html            the block between
                             <!-- CITATION-BAND:START --> ... END
                           (created just before the scan-progress
                           section if the markers are missing)
     citation-tracking.html  every region between
                             <!-- CITATION-MATRIX:START --> ... END
                             <!-- CITATION-CTA:START --> ... END
                             <!-- CITATION-FAQ:START --> ... END   (visible FAQ)
                             <!-- CITATION-LD:START --> ... END    (FAQPage JSON-LD)
                           plus every inline figure written as
                             <!--c:key-->value<!--/c-->

   No figure on either surface is typed by hand. The script also checks
   the sample against itself (group labels, the overall rate and each
   sweep are recomputed from the per-run marks) and refuses to write if
   they disagree.

   The matrix is plain HTML. citation-matrix.js only replays the fill
   once on first view; without it the finished matrix is already there.

   Usage:
     node scripts/generate-citation.js
   ===================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SAMPLE = path.join(ROOT, 'content', 'citations', 'sample-crm.json');
const INDEX_HTML = path.join(ROOT, 'index.html');
const PAGE_HTML = path.join(ROOT, 'citation-tracking.html');

// The address on privacy.html and terms.html. scanner.js still carries a
// placeholder (you@example.com) for the "Talk to us" button.
const CONTACT_EMAIL = 'andacuz@gmail.com';

const GROUPS = [
  { key: 'always', label: 'Named in every run' },
  { key: 'unstable', label: 'Unstable' },
  { key: 'never', label: 'Never named' }
];
const STATE_NAME = { featured: 'named and featured', named: 'named', absent: 'not named' };
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const HOME_ROWS_PER_GROUP = 3;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
const pct = (x) => Math.round(x * 100) + '%';
const word = (n) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------------------------------------------------------------------
   Load, check, derive
   --------------------------------------------------------------------- */

function load() {
  if (!fs.existsSync(SAMPLE)) {
    throw new Error('content/citations/sample-crm.json not found. Nothing to render.');
  }
  return JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
}

function check(s) {
  const errors = [];
  ['label', 'model', 'date', 'mode', 'runsPerPrompt', 'promptCount', 'prompts', 'overall'].forEach(function (k) {
    if (s[k] == null) errors.push('missing field: ' + k);
  });
  if (errors.length) return errors;
  if (s.prompts.length !== s.promptCount) errors.push('promptCount ' + s.promptCount + ' but ' + s.prompts.length + ' prompts');

  const named = (r) => r !== 'absent';
  let namedRuns = 0;
  s.prompts.forEach(function (p) {
    if (p.runs.length !== s.runsPerPrompt) errors.push(p.id + ': ' + p.runs.length + ' runs, expected ' + s.runsPerPrompt);
    p.runs.forEach(function (r) { if (!STATE_NAME[r]) errors.push(p.id + ': unknown run state "' + r + '"'); });
    const k = p.runs.filter(named).length;
    const group = k === p.runs.length ? 'always' : k === 0 ? 'never' : 'unstable';
    if (group !== p.group) errors.push(p.id + ': group "' + p.group + '" but its runs say "' + group + '"');
    namedRuns += k;
  });

  const total = s.promptCount * s.runsPerPrompt;
  if (Math.abs(namedRuns / total - s.overall.mentionRate) > 0.0006) {
    errors.push('overall.mentionRate ' + s.overall.mentionRate + ' but the runs give ' + (namedRuns / total).toFixed(4));
  }
  const sweeps = [];
  for (let r = 0; r < s.runsPerPrompt; r++) {
    sweeps.push(s.prompts.filter(function (p) { return named(p.runs[r]); }).length / s.promptCount);
  }
  if (!s.overall.bySweep || s.overall.bySweep.length !== sweeps.length ||
      s.overall.bySweep.some(function (x, i) { return Math.abs(x - sweeps[i]) > 0.0006; })) {
    errors.push('overall.bySweep does not match the runs');
  }
  if (Math.abs(Math.min.apply(null, sweeps) - s.overall.range.min) > 0.0006 ||
      Math.abs(Math.max.apply(null, sweeps) - s.overall.range.max) > 0.0006) {
    errors.push('overall.range does not match the sweeps');
  }
  return errors;
}

function derive(s) {
  const by = { always: [], unstable: [], never: [] };
  s.prompts.forEach(function (p) { by[p.group].push(p); });
  const all = [].concat.apply([], s.prompts.map(function (p) { return p.runs; }));
  const d = new Date(s.date + 'T12:00:00Z');
  const modeSentence = s.mode === 'ungrounded'
    ? 'No web search was enabled for this run.'
    : 'Web search was enabled for this run.';
  const f = {
    label: s.label,
    labelCap: cap(s.label),
    model: s.model,
    mode: s.mode,
    modeSentence: modeSentence,
    dateLong: MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear(),
    monthYear: MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(),
    runs: String(s.runsPerPrompt),
    runsWord: word(s.runsPerPrompt),
    runsWordCap: cap(word(s.runsPerPrompt)),
    promptCount: String(s.promptCount),
    sweeps: String(s.runsPerPrompt),
    rate: pct(s.overall.mentionRate),
    rangeMin: pct(s.overall.range.min),
    rangeMax: pct(s.overall.range.max),
    alwaysCount: String(by.always.length),
    unstableCount: String(by.unstable.length),
    neverCount: String(by.never.length),
    featuredRuns: String(all.filter(function (r) { return r === 'featured'; }).length),
    namedOnlyRuns: String(all.filter(function (r) { return r === 'named'; }).length),
    namedRuns: String(all.filter(function (r) { return r !== 'absent'; }).length),
    totalRuns: String(all.length)
  };
  return { f: f, by: by };
}

/* ---------------------------------------------------------------------
   The matrix: one component, two sizes
   --------------------------------------------------------------------- */

function dot(state, n) {
  return '<span class="cm-dot cm-dot--' + state + '" role="img" aria-label="run ' + n + ': ' + STATE_NAME[state] + '"></span>';
}

function legendDot(state) {
  return '<span class="cm-dot cm-dot--' + state + '" aria-hidden="true"></span>';
}

// opts.id: unique id stem; opts.limit: rows per group to show (omit for all)
function renderMatrix(s, d, opts) {
  const id = opts.id;
  const limit = opts.limit || Infinity;
  let rowsShown = 0;
  const groupsHtml = GROUPS.map(function (g) {
    const rows = d.by[g.key];
    const slice = rows.slice(0, limit);
    rowsShown += slice.length;
    const rowsHtml = slice.map(function (p) {
      return (
        '            <li class="cm__row">\n' +
        '              <span class="cm__q">' + esc(p.question.replace(/'/g, '\u2019')) + '</span>\n' +
        '              <span class="cm__dots">' + p.runs.map(function (r, i) { return dot(r, i + 1); }).join('') + '</span>\n' +
        '            </li>'
      );
    }).join('\n');
    const more = rows.length - slice.length;
    return (
      '          <div class="cm__group">\n' +
      '            <h3 class="cm__heading"><span>' + esc(g.label) + '</span><span class="cm__count">' + rows.length + '</span></h3>\n' +
      '            <ol class="cm__rows">\n' + rowsHtml + '\n            </ol>\n' +
      (more > 0 ? '            <p class="cm__more">+' + more + ' more</p>\n' : '') +
      '          </div>'
    );
  }).join('\n');

  const title = 'Citation matrix: one model’s answers to ' + s.promptCount + ' buying questions, ' + s.runsPerPrompt + ' runs each';
  const desc = 'Each row is one question and each dot one run. ' +
    d.f.alwaysCount + ' questions named the brand in every run, ' + d.f.unstableCount + ' in some runs and not others, and ' +
    d.f.neverCount + ' in none. Overall the brand was named in ' + d.f.rate + ' of answers.' +
    (rowsShown < s.promptCount ? ' This view shows ' + rowsShown + ' of the ' + s.promptCount + ' questions.' : '');

  return (
    '        <figure class="cm ' + (opts.large ? 'cm--large' : '') + '" id="' + id + '" aria-labelledby="' + id + '-title" aria-describedby="' + id + '-desc">\n' +
    '          <p class="cm__sr" id="' + id + '-title">' + esc(title) + '</p>\n' +
    '          <p class="cm__sr" id="' + id + '-desc">' + esc(desc) + '</p>\n' +
    groupsHtml + '\n' +
    '          <div class="cm__legend">\n' +
    '            <span class="cm__key">' + legendDot('featured') + 'Named and featured</span>\n' +
    '            <span class="cm__key">' + legendDot('named') + 'Named, not featured</span>\n' +
    '            <span class="cm__key">' + legendDot('absent') + 'Not named</span>\n' +
    '          </div>\n' +
    '          <p class="cm__meta">' + esc(d.f.model) + ' · ' + esc(d.f.dateLong) + ' · ' + d.f.runs + ' runs per question</p>\n' +
    '        </figure>'
  );
}

/* ---------------------------------------------------------------------
   Calls to action
   --------------------------------------------------------------------- */

function mailto() {
  const subject = 'Citation run request';
  const body = 'Brand:\r\nDomain:\r\nCategory:\r\nThree competitors:\r\n';
  return 'mailto:' + CONTACT_EMAIL + '?subject=' + encodeURIComponent(subject) + '&amp;body=' + encodeURIComponent(body);
}

function ctaButton() {
  return '<a class="btn btn--primary" href="' + mailto() + '">Request a run for your brand</a>';
}

/* ---------------------------------------------------------------------
   Homepage block
   --------------------------------------------------------------------- */

const BAND_START = '<!-- CITATION-BAND:START -->';
const BAND_END = '<!-- CITATION-BAND:END -->';

function renderBand(s, d) {
  const f = d.f;
  const headline = 'Named in ' + f.rate + ' of answers. Invisible for ' + f.neverCount + ' of ' + f.promptCount + ' questions.';
  const lede = 'The free scan tells you whether AI systems can read your site. A citation run asks a model the questions your buyers ask, ' +
    f.runsWord + ' times each, and records whether you’re named.';
  const meta = 'Sample run · ' + f.label + ' · ' + f.model + ' · ' + f.promptCount + ' questions × ' + f.runs + ' runs · ' + f.monthYear;
  return (
    BAND_START + '\n' +
    '      <section class="citation-block" id="citation" aria-labelledby="citation-heading">\n' +
    '        <div class="section__inner">\n' +
    '          <div class="citation-panel">\n' +
    '            <div class="citation-panel__copy">\n' +
    '              <p class="kicker">Early access · Citation tracking</p>\n' +
    '              <h2 id="citation-heading" class="citation-panel__title">' + esc(headline) + '</h2>\n' +
    '              <p class="citation-panel__lede">' + esc(lede) + '</p>\n' +
    '              <p class="citation-panel__meta">' + esc(meta) + '</p>\n' +
    '              <div class="citation-panel__actions">\n' +
    '                ' + ctaButton() + '\n' +
    '                <a class="citation-panel__link" href="/citation-tracking">How it works</a>\n' +
    '              </div>\n' +
    '            </div>\n' +
    '            <div class="citation-panel__matrix">\n' +
    renderMatrix(s, d, { id: 'cm-home', limit: HOME_ROWS_PER_GROUP }) + '\n' +
    '            </div>\n' +
    '          </div>\n' +
    '        </div>\n' +
    '      </section>\n' +
    '      ' + BAND_END
  );
}

/* ---------------------------------------------------------------------
   FAQ: one source for the visible section and the JSON-LD
   --------------------------------------------------------------------- */

function faq(s, d) {
  const f = d.f;
  return [
    {
      q: 'What is citation tracking?',
      a: 'Citation tracking asks a language model the buying questions people ask in your category and records whether it names your brand. Each question is asked ' +
        f.runs + ' times, because the same question gives different answers. We report how often you are named, and how often you are featured rather than mentioned in passing.'
    },
    {
      q: 'Why ' + f.runsWord + ' runs?',
      a: 'The same question gives different answers. In the sample run, ' + f.unstableCount + ' of ' + f.promptCount +
        ' questions named the brand in some runs and not in others, and the overall rate ranged from ' + f.rangeMin + ' to ' + f.rangeMax +
        ' between sweeps. One run would have reported one of those numbers as the answer. ' + cap(f.runsWord) + ' runs show the spread. They do not make the rate exact.'
    },
    {
      q: 'Which models do you run?',
      a: 'Each run uses one named model, and its name and the date are recorded on every result. The sample on this page used ' + f.model + ' on ' + f.dateLong +
        '. Today we run Gemini models only. A result from one model says nothing about any other assistant, and we do not present one model as AI visibility in general.'
    },
    {
      q: 'How is this different from the free scan?',
      a: 'The free scan checks whether AI crawlers can reach your site and whether your pages carry the signals machines read. It measures readiness. A citation run asks a model buying questions and records whether it names you. It measures what one model said on one date. The scan is free and self-serve. A citation run is early access, delivered as a report we run for you.'
    }
  ];
}

function renderFaqHtml(items) {
  return (
    '        <div class="doc-section" id="faq">\n' +
    '          <h2 class="doc-section__heading">Common questions</h2>\n' +
    items.map(function (i) {
      return '          <h3 class="faq-q">' + esc(i.q) + '</h3>\n          <p>' + esc(i.a) + '</p>';
    }).join('\n') + '\n' +
    '        </div>'
  );
}

function renderFaqLd(items) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(function (i) {
      return { '@type': 'Question', name: i.q, acceptedAnswer: { '@type': 'Answer', text: i.a } };
    })
  };
  return '  <script type="application/ld+json">\n  ' + JSON.stringify(ld, null, 2).replace(/\n/g, '\n  ') + '\n  </script>';
}

/* ---------------------------------------------------------------------
   Splicing
   --------------------------------------------------------------------- */

function splice(html, name, block, required, indent) {
  const start = '<!-- ' + name + ':START -->';
  const end = '<!-- ' + name + ':END -->';
  const a = html.indexOf(start);
  const b = html.indexOf(end);
  if (a === -1 || b === -1 || b < a) {
    if (required) throw new Error('Markers for ' + name + ' are missing.');
    return null;
  }
  return html.slice(0, a) + start + '\n' + block + '\n' + (indent == null ? '        ' : indent) + end + html.slice(b + end.length);
}

function fillInline(html, values) {
  return html.replace(/<!--c:([A-Za-z]+)-->[\s\S]*?<!--\/c-->/g, function (m, key) {
    if (!(key in values)) throw new Error('Unknown inline figure key: ' + key);
    return '<!--c:' + key + '-->' + esc(values[key]) + '<!--/c-->';
  });
}

function main() {
  const sample = load();
  const errors = check(sample);
  if (errors.length) {
    console.error('content/citations/sample-crm.json is inconsistent:\n');
    errors.forEach(function (e) { console.error('  - ' + e); });
    process.exit(1);
  }
  const d = derive(sample);

  // Homepage band: replace between markers, or insert before scan-progress.
  let index = fs.readFileSync(INDEX_HTML, 'utf8');
  const band = renderBand(sample, d);
  const a = index.indexOf(BAND_START);
  const b = index.indexOf(BAND_END);
  if (a !== -1 && b !== -1 && b > a) {
    index = index.slice(0, a) + band + index.slice(b + BAND_END.length);
  } else {
    const anchor = '      <!-- ---------- Scan progress ---------- -->';
    if (index.indexOf(anchor) === -1) throw new Error('Could not find the scan-progress anchor in index.html.');
    index = index.replace(anchor, band + '\n\n' + anchor);
  }
  fs.writeFileSync(INDEX_HTML, index, 'utf8');

  // The page: matrix, CTA, FAQ regions and inline figures.
  if (!fs.existsSync(PAGE_HTML)) {
    console.log('Wrote the homepage block. citation-tracking.html does not exist yet, so the page was skipped.');
    return;
  }
  let page = fs.readFileSync(PAGE_HTML, 'utf8');
  const items = faq(sample, d);
  page = splice(page, 'CITATION-MATRIX', renderMatrix(sample, d, { id: 'cm-full', large: true }), true);
  page = splice(page, 'CITATION-CTA', '            ' + ctaButton(), true);
  page = splice(page, 'CITATION-FAQ', renderFaqHtml(items), true);
  page = splice(page, 'CITATION-LD', renderFaqLd(items), true, '  ');
  page = fillInline(page, d.f);
  fs.writeFileSync(PAGE_HTML, page, 'utf8');

  console.log('Rendered from content/citations/sample-crm.json:');
  console.log('  ' + d.f.rate + ' overall (' + d.f.rangeMin + ' to ' + d.f.rangeMax + ' across ' + d.f.sweeps + ' sweeps)');
  console.log('  ' + d.f.alwaysCount + ' always, ' + d.f.unstableCount + ' unstable, ' + d.f.neverCount + ' never, of ' + d.f.promptCount + ' questions');
  console.log('  ' + d.f.model + ', ' + d.f.dateLong + ', ' + d.f.mode);
}

main();
