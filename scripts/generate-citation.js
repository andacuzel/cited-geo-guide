#!/usr/bin/env node
/* =====================================================================
   scripts/generate-citation.js

   Writes citation-tracking.html (the /citation-tracking page) from
   content/citations/sample-crm.json, so no figure on the page is typed by
   hand. Every figure that comes from the sample is written as

     <!--c:key-->value<!--/c-->

   and `--check` recomputes each one from the sample and compares.

   The gold band reuses the homepage scatter exactly: its markup is copied
   from index.html (the .teaser__scene-wrap block) and the page loads the
   same teaser-scene.js and CSS classes. There is no second implementation
   of the loop. The static state is plain HTML, and without JavaScript,
   without @property support, or under reduced motion nothing moves.

     node scripts/generate-citation.js            write citation-tracking.html
     node scripts/generate-citation.js --check    verify the page against the
                                                  sample; write nothing
   ===================================================================== */

'use strict';

const siteChrome = require('./site-chrome.js');

const fs = require('fs');
const path = require('path');
const ICONS = require('../lib/icons.js');

const ROOT = path.resolve(__dirname, '..');
const SITE = require('../lib/site-config.js').baseUrl;
const SAMPLE = path.join(ROOT, 'content', 'citations', 'sample-crm.json');
const PAGE = path.join(ROOT, 'citation-tracking.html');
const CSS_VERSION = 66;
const CONTACT_EMAIL = 'hey@getcitehound.com'; // the address on privacy.html and terms.html
// Early access goes through the Pro waitlist on /pro; pro-cta.js sends the button to PRO_CHECKOUT_URL when that is set.
const WAITLIST = '/pro#waitlist';
const JOIN = '<a class="btn btn--gold" href="' + WAITLIST + '" data-pro-cta data-label-checkout="Get Citehound Pro">Join the Pro waitlist</a>';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const word = (n) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const c = (key, val) => '<!--c:' + key + '-->' + val + '<!--/c-->';

/* ---------------------------------------------------------------------
   Load the sample and derive every figure
   --------------------------------------------------------------------- */

function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error('sample date is not YYYY-MM-DD: ' + iso);
  return MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
}

// Everything the page shows that comes from the sample. `--check` calls this
// again, independently of the page text, and compares.
function derive(s) {
  const tries = s.runsPerPrompt;
  const named = (r) => r === 'featured' || r === 'named'; // the page says "named"; the finer split is not shown
  const groupOf = (p) => {
    const n = p.runs.filter(named).length;
    return n === tries ? 'always' : n === 0 ? 'never' : 'unstable';
  };
  s.prompts.forEach(function (p) {
    if (p.runs.length !== tries) throw new Error(p.id + ': ' + p.runs.length + ' runs, expected ' + tries);
    if (groupOf(p) !== p.group) throw new Error(p.id + ': group "' + p.group + '" disagrees with its runs');
  });
  if (s.promptCount !== s.prompts.length) throw new Error('promptCount disagrees with the prompts');
  const by = { never: [], unstable: [], always: [] };
  s.prompts.forEach((p) => by[p.group].push(p));
  const totalAnswers = s.prompts.length * tries;
  const namedAnswers = s.prompts.reduce((n, p) => n + p.runs.filter(named).length, 0);
  return {
    label: s.label,
    labelCap: cap(s.label),
    model: s.model,
    date: longDate(s.date),
    tries: tries,
    triesWord: word(tries),
    questions: s.prompts.length,
    never: by.never.length,
    unstable: by.unstable.length,
    always: by.always.length,
    namedAnswers: namedAnswers,
    totalAnswers: totalAnswers,
    by: by
  };
}

/* ---------------------------------------------------------------------
   Copy. One list drives both the visible FAQ and the FAQPage JSON-LD.
   --------------------------------------------------------------------- */

function faq(d) {
  return [
    ['What is citation tracking?',
      'Checking whether an AI model names your brand when people ask the questions your buyers ask. Citehound Pro does the first half today: it writes the citation questions for your site, in its own language, and you try them in your own assistants. Testing them for you is in preparation.'],
    ['Why ask every question ' + d.triesWord + ' times?',
      'Because the same question can get different answers. In the published sample, ' + d.unstable + ' of ' + d.questions + ' questions named the brand in some tries and not in others. One try can mislead you. ' + cap(d.triesWord) + ' show the pattern.'],
    ['What does named mean?',
      'Your brand name appears in the answer. In the published sample we also recorded whether it appears in a heading, a list label, a table or bold text, rather than only inside a sentence. A name inside a dismissive aside still counts as named. It is not an endorsement.'],
    ['Can I try the questions myself?',
      'Yes. Pro writes them for your site, and the question sets by category are also published on the Citehound MCP server, with a short protocol for running them yourself in any assistant.'],
    ['Does Citehound test the questions?',
      'Not yet. Live testing is in preparation. The published sample used ' + d.model + ' on ' + d.date + ', made by hand without web search. A result describes one model on one date and says nothing about any other assistant.'],
    ['Is it a ranking?',
      'No. It records whether a name appears, not where your brand sits against others. Answers shift with the wording of a question and over time, so a result is a picture of one day.'],
    ['How do I get early access?',
      'Join the Pro waitlist on the Pro page. Pro includes the citation questions. We email you once, when Pro opens.']
  ];
}

const card = (icon, title, text) =>
  '            <li class="ct-card">\n              <span class="ct-card__icon">' + ICONS.svg(icon) + '</span>\n' +
  '              <h3 class="ct-card__title">' + title + '</h3>\n              <p class="ct-card__text">' + text + '</p>\n            </li>\n';

const step = (icon, title, text) =>
  '          <li class="ct-step">\n            <span class="ct-step__icon">' + ICONS.svg(icon) + '</span>\n' +
  '            <h3 class="ct-step__title">' + title + '</h3>\n            <p class="ct-step__text">' + text + '</p>\n          </li>\n';

function marks(p) {
  return '<span class="ct-marks">' + p.runs.map(function (r, i) {
    const n = r === 'featured' || r === 'named';
    return '<span class="ct-mark ' + (n ? 'ct-mark--named' : 'ct-mark--absent') + '" role="img" aria-label="try ' + (i + 1) + ': ' + (n ? 'named' : 'not named') + '"></span>';
  }).join('') + '</span>';
}

function group(key, title, intro, list, open) {
  return '          <details class="ct-detail"' + (open ? ' open' : '') + ' data-group="' + key + '">\n' +
    '            <summary><span class="ct-detail__title">' + title + '</span><span class="ct-detail__count">' + c(key + 'Count', list.length) + ' questions</span></summary>\n' +
    '            <p class="ct-detail__intro">' + intro + '</p>\n            <ol class="ct-list">\n' +
    list.map((p) => '              <li class="ct-row"><span class="ct-row__q">' + esc(p.question) + '</span>' + marks(p) + '</li>').join('\n') + '\n' +
    '            </ol>\n          </details>\n';
}

function shellParts() {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const about = read('about.html');
  const grab = (src, re, what) => { const m = src.match(re); if (!m) throw new Error('could not find ' + what); return m[0]; };
  const index = read('index.html');
  const wrap = grab(index, /<div class="teaser__scene-wrap">[\s\S]*?<p class="teaser__caption">Illustration\. Not real data\.<\/p>\s*<\/div>/, 'the homepage scatter (teaser__scene-wrap) in index.html');
  return {
    favicon: grab(about, /<link rel="icon"[^>]*>/, 'favicon'),
    fonts: grab(about, /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com" \/>[\s\S]*?rel="stylesheet" \/>/, 'font links'),
    sceneSnippet: grab(index, /<script>if \(window\.IntersectionObserver && window\.CSS && CSS\.registerProperty[^<]*<\/script>/, 'the scene-anim head snippet'),
    header: grab(about, /<header class="site-header">[\s\S]*?<\/header>/, 'header'),
    footerNav: grab(about, /<nav class="site-nav footer-links"[\s\S]*?<\/nav>/, 'footer nav'),
    scene: wrap
  };
}

/* ---------------------------------------------------------------------
   The page
   --------------------------------------------------------------------- */

function build(sample) {
  const d = derive(sample);
  const shell = shellParts();
  const title = 'Citehound — Citation Tracking: Does a Model Name Your Brand?';
  const desc = 'Pro writes the citation questions your customers ask, in your site\u2019s own language, for you to try. Testing them for you is in preparation.';
  const ogDesc = 'Pro writes the citation questions your customers ask, in your site\u2019s own language, for you to try. Testing them for you is in preparation.';
  if (desc.length < 120 || desc.length > 160) throw new Error('description is ' + desc.length + ' characters');
  const questions = faq(d);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map((q) => ({ '@type': 'Question', name: q[0], acceptedAnswer: { '@type': 'Answer', text: q[1] } }))
  };
  const t = d.triesWord;

  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    '  ' + shell.sceneSnippet + '\n\n' +
    '  <title>' + esc(title) + '</title>\n' +
    '  <meta name="description" content="' + esc(desc) + '" />\n' +
    '  <meta name="keywords" content="citation tracking, AI citations, brand mentions in AI answers, GEO, AI visibility, buying-intent queries" />\n' +
    '  <meta name="author" content="Citehound" />\n  <meta name="robots" content="index, follow" />\n' +
    '  <link rel="canonical" href="' + SITE + '/citation-tracking" />\n\n' +
    '  <!-- Open Graph -->\n  <meta property="og:type" content="website" />\n' +
    '  <meta property="og:title" content="' + esc(title) + '" />\n  <meta property="og:description" content="' + esc(ogDesc) + '" />\n' +
    '  <meta property="og:url" content="' + SITE + '/citation-tracking" />\n  <meta property="og:image" content="' + SITE + '/assets/brand/og-default.png" />\n  <meta property="og:site_name" content="Citehound" />\n\n' +
    '  <!-- Twitter -->\n  <meta name="twitter:card" content="summary_large_image" />\n' +
    '  <meta name="twitter:title" content="' + esc(title) + '" />\n  <meta name="twitter:description" content="' + esc(ogDesc) + '" />\n' +
    '  <meta name="twitter:image" content="' + SITE + '/assets/brand/og-default.png" />\n\n' +
    '  ' + shell.favicon + '\n\n  ' + shell.fonts + '\n\n' +
    '  <link rel="stylesheet" href="styles.css?v=' + CSS_VERSION + '" />\n\n' +
    '  <script type="application/ld+json">\n' + JSON.stringify(ld, null, 2).replace(/^/gm, '  ') + '\n  </script>\n' + siteChrome.schemaBlock().replace(/^/gm, '  ') + '\n</head>\n<body>\n\n' +
    '  <a class="skip-link" href="#main">Skip to content</a>\n\n  ' + shell.header + '\n\n' +
    '  <main id="main">\n\n' +

    // 1. Banner
    '    <section aria-labelledby="hero-heading">\n      <div class="section__inner">\n        <div class="page-banner">\n          <div class="page-banner__body">\n' +
    '            <p class="kicker kicker--on-navy">Citation tracking</p>\n' +
    '            <h1 id="hero-heading" class="page-banner__title">Does AI name you when your buyers ask?</h1>\n' +
    '            <p class="page-banner__desc">Pro writes the citation questions your customers ask, in your site’s own language, for you to try in your own assistants. Testing them for you is in preparation.</p>\n' +
    '            ' + JOIN + '\n' +
    '            <p class="ct-banner__note">The figures on this page come from a published sample for a different brand, made by hand. Pro does not produce them today.</p>\n' +
    '          </div>\n          <span class="page-banner__icon" aria-hidden="true">' + ICONS.svg('chat') + '</span>\n        </div>\n      </div>\n    </section>\n\n' +

    // 2. Gold band: the homepage scatter, unchanged
    '    <section class="teaser" id="scatter" aria-labelledby="scatter-heading">\n      <div class="section__inner">\n        <div class="teaser__grid">\n          <div class="teaser__copy">\n' +
    '            <p class="teaser__kicker">The problem with one answer</p>\n' +
    '            <h2 id="scatter-heading" class="teaser__title">Same question, different answers.</h2>\n' +
    '            <p class="teaser__lede">Ask an AI the same question twice and you can get two different answers. One try tells you very little. ' + cap(t) + ' tries start to show you a pattern.</p>\n' +
    '          </div>\n            ' + shell.scene.replace(/\n/g, '\n  ') + '\n        </div>\n      </div>\n    </section>\n\n' +

    // 3. What you get
    '    <section class="ct-section" aria-labelledby="get-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">What you get</p>\n          <h2 id="get-heading" class="section-title">The questions today. The test, in preparation.</h2>\n        </div>\n        <ul class="ct-cards">\n' +
    card('chat', 'The questions your buyers ask', 'Today: 21 questions written for your site, in its own language, with English glosses. 18 do not name you and 3 do.') +
    card('repeat', cap(t) + ' tries each', 'In preparation: every question asked ' + t + ' times, each in a new conversation, because one answer can mislead.') +
    card('eyeoff', 'The questions where you’re never named', 'In preparation: the gaps, questions where your name does not come up in any try.') +
    card('people', 'Who is named instead', 'In preparation: the other brands that appear in the answers when yours does not.') +
    '        </ul>\n      </div>\n    </section>\n\n' +

    // 4. A real example
    '    <section class="ct-section" aria-labelledby="sample-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">A published sample</p>\n' +
    '          <h2 id="sample-heading" class="section-title">' + c('labelCap', d.labelCap) + ', ' + c('questions', d.questions) + ' questions, ' + c('triesWord', t) + ' tries each.</h2>\n' +
    '          <p class="section-sub">Real answers from ' + c('model', d.model) + ' on ' + c('date', d.date) + ', ' + c('triesWord', t) + ' tries per question, made by hand without web search. The brand is not named here, and neither are its competitors. This is not a result for your site, and Pro does not produce it today.</p>\n' +
    '        </div>\n' +
    '        <div class="ct-stats">\n' +
    '          <div class="ct-stat"><p class="ct-stat__num">' + c('never', d.never) + '</p><p class="ct-stat__label">questions where the brand was never named</p></div>\n' +
    '          <div class="ct-stat"><p class="ct-stat__num">' + c('unstable', d.unstable) + '</p><p class="ct-stat__label">questions where it appeared only sometimes</p></div>\n' +
    '          <div class="ct-stat"><p class="ct-stat__num">' + c('always', d.always) + '</p><p class="ct-stat__label">questions where it was named every time</p></div>\n' +
    '        </div>\n' +
    '        <div class="report-panel ct-example">\n' +
    '          <p class="ct-example__label">' + c('labelCap', d.labelCap) + ' · ' + c('model', d.model) + ' · ' + c('date', d.date) + ' · ' + c('triesWord', t) + ' tries per question</p>\n' +
    '          <p class="ct-legend"><span class="ct-mark ct-mark--named" aria-hidden="true"></span> Named <span class="ct-mark ct-mark--absent" aria-hidden="true"></span> Not named. Each row is one question, each mark one try. Across all ' + c('totalAnswers', d.totalAnswers) + ' answers the brand was named in ' + c('namedAnswers', d.namedAnswers) + '.</p>\n' +
    '          <details class="ct-all" open><summary class="ct-all__summary">All ' + c('questions', d.questions) + ' questions, ' + c('triesWord', t) + ' tries each</summary>\n' +
    group('never', 'Never named', 'These are the gaps. In every try, the answer did not include the brand.', d.by.never, true) +
    group('unstable', 'Named only sometimes', 'The same question gave a different answer from one try to the next.', d.by.unstable, false) +
    group('always', 'Named every time', 'In every try, the answer included the brand.', d.by.always, false) +
    '          </details>\n' +
    '        </div>\n      </div>\n    </section>\n\n' +

    // 5. How a run works
    '    <section class="ct-section" aria-labelledby="how-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">How a tested run works</p>\n          <h2 id="how-heading" class="section-title">Four steps. Pro does the first today.</h2>\n        </div>\n        <ol class="ct-steps">\n' +
    step('list', 'The questions', 'We use questions that do not name any brand in the category. A few mention an integration platform such as Slack or Google Workspace, because that is how buyers ask.') +
    step('repeat', 'Each asked ' + t + ' times', 'In preparation: every question goes to one model ' + t + ' times, each time with no memory of the others.') +
    step('search', 'Two things are recorded', 'In preparation: whether you are named, and whether you appear in a heading, list label, table or bold text.') +
    step('report', 'The report', 'Today: the questions. In preparation: the marks for every try, and who is named when you are not.') +
    '        </ol>\n      </div>\n    </section>\n\n' +

    // 6. What a run can't tell you
    '    <section class="ct-section" aria-labelledby="limits-heading">\n      <div class="section__inner">\n        <div class="report-panel ct-limits">\n          <p class="kicker">Read this before you act on it</p>\n          <h2 id="limits-heading" class="ct-limits__title">What a run can’t tell you.</h2>\n          <ul class="ct-limits__list">\n' +
    '            <li><strong>One model, one date.</strong> A result describes one model on the day it was run.</li>\n' +
    '            <li><strong>Answers shift.</strong> A reworded question, or the same question next month, can give a different result.</li>\n' +
    '            <li><strong>It is not a ranking.</strong> It records whether a name appears, not where your brand sits against others.</li>\n' +
    '            <li><strong>Nothing about other assistants.</strong> A result for one says nothing about the rest.</li>\n' +
    '            <li><strong>No traffic forecast.</strong> Being named is not a prediction of visits or sales.</li>\n' +
    '            <li><strong>Named is not an endorsement.</strong> A name inside a dismissive aside counts as named.</li>\n' +
    '          </ul>\n        </div>\n      </div>\n    </section>\n\n' +

    // 7. FAQ
    '    <section class="ct-section" aria-labelledby="faq-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">Questions</p>\n          <h2 id="faq-heading" class="section-title">Citation tracking, briefly.</h2>\n        </div>\n        <div class="ct-faq">\n' +
    questions.map((q) => '          <details>\n            <summary>' + esc(q[0]) + '</summary>\n            <p>' + esc(q[1]) + '</p>\n          </details>').join('\n') + '\n' +
    '        </div>\n      </div>\n    </section>\n\n' +

    // closing band
    '    <section class="pro-band" aria-labelledby="close-heading">\n      <div class="section__inner">\n        <p class="kicker kicker--on-navy">Early access</p>\n' +
    '        <h2 id="close-heading">Start with the questions your buyers ask.</h2>\n' +
    '        <p class="pro-band__lede">Pro writes the citation questions for your site. Join the waitlist and we will email you once, when it opens.</p>\n' +
    '        <div class="pro-band__cta">' + JOIN + '</div>\n' +
    '        <p class="ct-banner__note ct-banner__note--band">Testing the questions for you is in preparation.</p>\n' +
    '      </div>\n    </section>\n\n' +

    '    <footer class="site-footer" aria-label="Footer">\n      <div class="section__inner">\n        ' + shell.footerNav.replace(/\n/g, '\n        ') + '\n' +
    '        <p class="site-footer__coda">© 2026 Citehound. Built for teams navigating the shift from search to answers.</p>\n      </div>\n    </footer>\n\n' +
    '  </main>\n\n  <div class="toast" id="toast" role="status" aria-live="polite"></div>\n\n' +
    '  <script src="pro-cta.js?v=1" defer></script>\n  <script src="teaser-scene.js?v=1" onerror="document.documentElement.classList.remove(\'scene-anim\')"></script>\n  <script>if (window.matchMedia && matchMedia(\'(max-width: 640px)\').matches) { var a = document.querySelector(\'.ct-all\'); if (a) a.open = false; }</script>\n  <script src="nav.js?v=3"></script>\n</body>\n</html>\n';
}

/* ---------------------------------------------------------------------
   --check: every figure on the page equals the sample file
   --------------------------------------------------------------------- */

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'');

function check(sample) {
  const problems = [];
  const bad = (m) => problems.push(m);
  const html = fs.readFileSync(PAGE, 'utf8');
  const d = derive(sample);

  // 1. The page is exactly what the generator writes from the sample.
  if (html !== build(sample)) bad('citation-tracking.html is not what the generator writes from the sample; run the generator');

  // 2. Every <!--c:key--> figure equals the value recomputed from the sample.
  const expect = {
    labelCap: d.labelCap, model: d.model, date: d.date, triesWord: d.triesWord, questions: String(d.questions),
    never: String(d.never), unstable: String(d.unstable), always: String(d.always),
    neverCount: String(d.never), unstableCount: String(d.unstable), alwaysCount: String(d.always),
    namedAnswers: String(d.namedAnswers), totalAnswers: String(d.totalAnswers)
  };
  const seen = {};
  const re = /<!--c:([A-Za-z]+)-->([\s\S]*?)<!--\/c-->/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    seen[m[1]] = (seen[m[1]] || 0) + 1;
    if (!(m[1] in expect)) { bad('unknown figure ' + m[1]); continue; }
    if (decode(m[2]) !== expect[m[1]]) bad('figure ' + m[1] + ' is "' + m[2] + '", the sample gives "' + expect[m[1]] + '"');
  }
  Object.keys(expect).forEach(function (k) { if (!seen[k]) bad('figure ' + k + ' never appears on the page'); });

  // 3. The question list: every question, in its group, with its own marks.
  s2: {
    const rows = [];
    const dre = /<details class="ct-detail"[^>]*data-group="([a-z]+)">([\s\S]*?)<\/details>/g;
    let g;
    while ((g = dre.exec(html)) !== null) {
      const rre = /<li class="ct-row"><span class="ct-row__q">([\s\S]*?)<\/span><span class="ct-marks">([\s\S]*?)<\/span><\/li>/g;
      let r;
      while ((r = rre.exec(g[2])) !== null) {
        const dots = (r[2].match(/ct-mark--(named|absent)/g) || []).map((x) => x.slice(9));
        rows.push({ group: g[1], q: decode(r[1]), dots: dots });
      }
    }
    if (rows.length !== sample.prompts.length) bad('the page lists ' + rows.length + ' questions, the sample has ' + sample.prompts.length);
    sample.prompts.forEach(function (p) {
      const row = rows.filter((x) => x.q === p.question)[0];
      if (!row) { bad('question missing from the page: ' + p.question); return; }
      if (row.group !== p.group) bad('"' + p.question + '" is under ' + row.group + ', the sample says ' + p.group);
      const want = p.runs.map((x) => (x === 'absent' ? 'absent' : 'named'));
      if (row.dots.join() !== want.join()) bad('marks for "' + p.question + '" are ' + row.dots.join() + ', the sample says ' + want.join());
    });
    const open = (html.match(/<details class="ct-detail"( open)? data-group="([a-z]+)"/g) || []).filter((x) => /open/.test(x)).map((x) => x.match(/data-group="([a-z]+)"/)[1]);
    if (open.join() !== 'never') bad('only "Never named" should be open by default, found: ' + open.join());
  }

  // 4. Every count written as a number or a word next to tries/times is the sample's.
  const text = decode(html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  (text.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(tries|times)\b/gi) || []).forEach(function (x) {
    const n = x.split(/\s+/)[0].toLowerCase();
    if (n !== d.triesWord && n !== String(d.tries)) bad('"' + x + '" is not the sample\'s ' + d.tries + ' tries');
  });

  // 4b. Figures quoted inside the FAQ text (and its JSON-LD) are the sample's too.
  const fq = text.match(/In the published sample, (\d+) of (\d+) questions named the brand in some tries/);
  if (!fq || +fq[1] !== d.unstable || +fq[2] !== d.questions) bad('the FAQ states "' + (fq ? fq[0] : 'nothing') + '", the sample gives ' + d.unstable + ' of ' + d.questions);

  // 5. The scatter's static state is in the HTML and is the homepage's, byte for byte.
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scene = (index.match(/<div class="scene" id="citeScene"[\s\S]*?<p class="teaser__caption">Illustration\. Not real data\.<\/p>/) || [''])[0];
  const strip = (s) => s.replace(/\s+/g, ' ');
  if (!scene || strip(html).indexOf(strip(scene)) === -1) bad('the scatter markup differs from the homepage\'s');
  if ((html.match(/class="sq sq--\d/g) || []).length !== 8) bad('expected eight scatter cards in the static HTML');
  if (html.indexOf('src="teaser-scene.js') === -1) bad('teaser-scene.js is not loaded');

  if (problems.length) { console.error('FAIL (' + problems.length + '):\n  ' + problems.join('\n  ')); process.exit(1); }
  console.log('OK: every figure on the page equals the sample (' + d.never + ' never, ' + d.unstable + ' sometimes, ' + d.always + ' always, ' + d.namedAnswers + ' of ' + d.totalAnswers + ' answers named), ' + sample.prompts.length + ' questions with their marks, scatter identical to the homepage.');
}

function main() {
  const sample = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  if (process.argv.indexOf('--check') !== -1) return check(sample);
  fs.writeFileSync(PAGE, build(sample), 'utf8');
  const d = derive(sample);
  console.log('citation-tracking.html written from content/citations/sample-crm.json');
  console.log('  ' + d.never + ' never, ' + d.unstable + ' sometimes, ' + d.always + ' always, of ' + d.questions + ' questions; ' + d.namedAnswers + ' of ' + d.totalAnswers + ' answers named');
  console.log('  ' + d.model + ', ' + d.date + ', ' + d.tries + ' tries per question');
}

if (require.main === module) main();

module.exports = { build: build, derive: derive };
