#!/usr/bin/env node
/* =====================================================================
   scripts/generate-pro.js

   Writes pro.html and the homepage Pro band (index.html, between
   <!-- PRO-BAND:START --> and <!-- PRO-BAND:END -->) from:
     content/pro/sample-report.json         a real crawl of our own site, frozen
     content/citations/sample-crm.json      the published citation sample, a different brand
     research/case-study-agaone.html        the case study's own figures
     assets/pro/*.frag                      crops of the dashboard (scripts/capture-pro-shots.js)
   Every figure is derived, none is typed: the page cap comes from
   api/crawl-start.js. Each figure carries data-fig="pro-..." so --check can
   read it back and compare it with a separate recomputation from the raw files.

     node scripts/generate-pro.js            write pro.html and the band
     node scripts/generate-pro.js --check    exit 1 on any mismatch
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const render = require('../lib/report-render.js');
const schema = require('../lib/schema.js');
const factsLib = require('../lib/report-facts.js');
const citationPanel = require('../lib/citation-panel.js');
const icons = require('../lib/icons.js');
const siteChrome = require('./site-chrome.js');
const capture = require('./capture-pro-shots.js');

const ROOT = path.resolve(__dirname, '..');
const SITE = require('../lib/site-config.js').baseUrl;
const DATA = path.join(ROOT, 'content', 'pro', 'sample-report.json');
const CITATION = path.join(ROOT, 'content', 'citations', 'sample-crm.json');
const CASE = path.join(ROOT, 'research', 'case-study-agaone.html');
const PAGE = path.join(ROOT, 'pro.html');
const INDEX = path.join(ROOT, 'index.html');
const CSS_VERSION = 59;
const START = '<!-- PRO-BAND:START -->';
const END = '<!-- PRO-BAND:END -->';
const WORDS = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten' };
const SELF_SERVE = 'A self-serve version is still to come.';
const CITATION_MAIL = 'mailto:hey@getcitehound.com?subject=Citation%20run%20request&amp;body=Brand%3A%0D%0ADomain%3A%0D%0ACategory%3A%0D%0AThree%20competitors%3A%0D%0A';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const icon = (name) => icons.svg(name, { cls: 'pro-icon' });
const signed = (n) => (n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '0');
const fig = (key, value) => '<span data-fig="pro-' + key + '">' + esc(value) + '</span>';
const textOf = (html) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const indent = (html, pad) => html.replace(/\n/g, '\n' + pad);

/* ---------- the figures, all derived ---------- */

// The crawl engine's page cap (MAX_PAGES in api/crawl-start.js), which lib/report-facts.js must agree with.
function crawlCap() {
  const src = fs.readFileSync(path.join(ROOT, 'api', 'crawl-start.js'), 'utf8');
  const m = /^var MAX_PAGES = (\d+);/m.exec(src);
  if (!m) throw new Error('api/crawl-start.js: MAX_PAGES not found');
  const cap = parseInt(m[1], 10);
  if (cap !== factsLib.CRAWL_CAP) throw new Error('MAX_PAGES (' + cap + ') and CRAWL_CAP in lib/report-facts.js (' + factsLib.CRAWL_CAP + ') disagree');
  return cap;
}

// The case study's headline gain and the two sites' scores, read from the page itself.
function caseFigures() {
  const html = fs.readFileSync(CASE, 'utf8');
  const take = (re, what) => { const m = re.exec(html); if (!m) throw new Error('case study: ' + what + ' not found'); return m; };
  const gain = take(/<b>\+(\d+)<\/b><span>avg\. point gain/, 'the average gain')[1];
  const before = take(/Site one scored (\d+)\. Site two scored (\d+)\./, 'the first scores');
  const after = take(/One site reached (\d+) out of 100[^.]*\. The other reached (\d+)\./, 'the final scores');
  return { gain: +gain, before1: +before[1], before2: +before[2], after1: +after[1], after2: +after[2] };
}

function figures() {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const sample = JSON.parse(fs.readFileSync(CITATION, 'utf8'));
  const bm = data.benchmark || factsLib.benchmarkFromData(path.join(ROOT, 'data'));
  const f = factsLib.facts(Object.assign({}, data, { benchmark: bm }), { schema: schema });
  const a = render.analyze(data);
  const home = a.pageRows.filter((r) => r.url === data.pages[0].url)[0];
  const hiddenChecks = f.checks.filter((c) => !c.siteLevel && c.passesOnHomepage === true && c.failingPages > 0).map((c) => c.label);
  const others = a.pageRows.filter((r) => r !== home);

  const cit = citationPanel.fromSample(sample);
  const m0 = cit.models[0];
  const qs = cit.questions;
  const marks = (q) => q.byModel[m0.key].marks;
  const named = qs.reduce((n, q) => n + marks(q).filter((x) => x === 'named').length, 0);
  const total = qs.length * m0.tries;
  const perTry = [];
  for (let i = 0; i < m0.tries; i++) perTry.push(Math.round(qs.filter((q) => marks(q)[i] === 'named').length / qs.length * 100));
  const group = (g) => qs.filter((q) => q.byModel[m0.key].group === g).length;

  return {
    data: data,
    cap: crawlCap(),
    domain: data.domain,
    date: render.longDate(data.createdAt),
    homepage: f.verdict.homepage,
    site: f.verdict.siteWide,
    gap: f.verdict.gap,
    pagesRead: f.coverage.pagesRead,
    pagesWithAFailure: f.verdict.pagesWithAFailure,
    hidden: hiddenChecks.length,
    failingOthers: others.filter((r) => r.failed.some((c) => hiddenChecks.indexOf(render.cleanLabel(c.label)) !== -1)).length,
    others: others.length,
    failingChecks: f.counts.failingChecks,
    columns: f.checks.filter((c) => !c.siteLevel).length,
    allDown: f.checks.filter((c) => !c.siteLevel && c.failingPages === f.coverage.pagesRead && c.failingPages > 0).length,
    worstPath: new URL(a.pageRows[0].url).pathname,
    worstScore: a.pageRows[0].total,
    fixFirst: f.fixes.filter((x) => x.kind !== 'robots').sort((x, y) => y.pages.length - x.pages.length)[0] || null,
    summary: data.executiveSummary || null,
    cit: {
      model: m0.model, date: render.longDate(m0.date), tries: m0.tries, triesWord: WORDS[m0.tries] || String(m0.tries),
      questions: qs.length, named: named, total: total,
      pct: Math.round(named / total * 100), never: group('never'), unstable: group('unstable'), always: group('always'),
      min: Math.min.apply(null, perTry), max: Math.max.apply(null, perTry)
    },
    case: caseFigures()
  };
}

/* ---------- the crops, inside the frame ---------- */

function cropHtml(name) {
  const file = path.join(ROOT, 'assets', 'pro', name + '.frag');
  if (!fs.existsSync(file)) throw new Error('assets/pro/' + name + '.frag is missing; run node scripts/capture-pro-shots.js');
  return fs.readFileSync(file, 'utf8').replace(/\n+$/, '');
}

function alts(F) {
  const s = F.summary, c = F.cit;
  return {
    summary: 'Sample dashboard summary for our own site, ' + F.domain + '. Headline: ' + (s ? s.headline : 'readiness report') + '. ' + (s ? s.situation + ' ' : '') + (s ? 'Label under it: ' + s.label + '. ' : '') +
      'Four figures: site-wide score ' + F.site + ', homepage score ' + F.homepage + ', gap ' + signed(F.gap) + ', and ' + F.pagesWithAFailure + ' pages with a failure.',
    gap: 'Three figures from the sample dashboard for our own site: site-wide score ' + F.site + ', homepage score ' + F.homepage + ' and the gap between them, ' + signed(F.gap) + ' points.',
    matrix: 'Heat matrix from the sample crawl of our own site. One row per page, one column per check, a filled square where a page fails a check and a hollow one where it passes. ' + F.failingChecks + ' of the ' + F.columns + ' page-level checks fail on at least one page.',
    pages: 'Pages explorer from the sample crawl. The list shows pages worst first, starting with ' + F.worstPath + ' at ' + F.worstScore + ' out of 100. The pane beside it shows the checks that page fails and an open copy-paste fix.',
    fixes: 'Fixes tab from the sample crawl. Each distinct snippet appears once with the number of pages it applies to and a Copy button.' + (F.fixFirst ? ' The first is ' + F.fixFirst.label + ', applying to ' + F.fixFirst.pages.length + ' pages.' : ''),
    print: 'The top bar of the sample dashboard: the domain ' + F.domain + ', the crawl date ' + F.date + ' and a Print or save as PDF button.',
    citations: 'Citations tab of the dashboard, filled with the published sample for a CRM brand, not a result for our site. ' + c.model + ', ' + c.date + ', ' + c.triesWord + ' tries per question. Three figures: ' + c.never + ' questions never named, ' + c.unstable + ' named only sometimes, ' + c.always + ' named every time. Below them, the questions that never named the brand, each with ' + c.triesWord + ' marks, one per try.',
    'band-explorer': 'The sample dashboard for our own site, ' + F.domain + ': the navy top bar, the five tabs Summary, Pages, Checks, Fixes and Citations with Pages selected, the pages list worst first starting with ' + F.worstPath + ' at ' + F.worstScore + ' out of 100, and the detail pane with that page\'s failed checks and an open copy-paste fix.',
    tries: 'The same citation sample with the group named only sometimes open. Each of the ' + c.unstable + ' questions shows ' + c.triesWord + ' marks, one per try, and the marks differ from try to try.'
  };
}

const CITATION_CROPS = ['citations', 'tries'];
const CAPS = {
  summary: 'The executive summary and four figures.',
  gap: 'The site-wide score, the homepage score and the gap.',
  matrix: 'Which pages fail which checks.',
  pages: 'Pages, worst first, and the page selected.',
  fixes: 'Two of the fixes.',
  print: 'The top bar, with the print button.',
  'band-explorer': 'From the worst page to its fix.'
};

function frame(name, F, extra, opts) {
  opts = opts || {};
  const cap = opts.caption || (CITATION_CROPS.indexOf(name) !== -1
    ? 'Sample from a different brand \u00B7 ' + fig('cit-model', F.cit.model) + ' \u00B7 ' + fig('cit-date', F.cit.date) + ' \u00B7 ' + F.cit.triesWord + ' tries per question'
    : 'Sample: our own site, ' + fig('date', F.date) + '. ' + esc(CAPS[name]));
  const crop = opts.plain ? cropHtml(name).replace(/ data-fig="[^"]*"/g, '') : cropHtml(name);
  return '<figure class="pro-shot pro-shot--' + name + (extra ? ' ' + extra : '') + '">\n' +
    '<div role="img" aria-label="' + esc(alts(F)[name]) + '"><div class="pro-shot__view" inert>\n' + crop + '\n</div></div>\n' +
    '<figcaption class="pro-shot__cap">' + cap + '</figcaption>\n</figure>';
}

/* ---------- the homepage band ---------- */

// The texture: a field of page glyphs over the whole band, two layers that are children of the full-bleed
// band element (nothing inside the 1180px container caps their width). Glyph 44x56, pitch 64x80, alternate
// rows half a pitch over, drawn by an inline SVG <pattern> in userSpaceOnUse units.
//   - the faint layer covers the band: outlines only, at LEFT_FIELD_OPACITY, no fills;
//   - the zone (--navy-900, full intensity) runs from the right column's left edge to the band's right edge.
// Both patterns are anchored to the band's right edge (x="100%"), so glyph columns line up across the zone's
// hard edge and the highlights, which live in the zone only, are positioned as offsets from the right edge
// (dx, a whole number of pitches plus the glyph's phase), from the top edge (y) or from the bottom edge (dy).
// Nothing is random and nothing is measured from the left.
const GW = 44, GH = 56, PX = 64, PY = 80;
// Outline opacity of the left field. 0.12 keeps every text colour in the left column at 4.5:1 or better
// (3:1 for the headline) against the brightest pixel the field can put behind it, and the outline at 1.4:1
// against --navy-950, so it is visible. --check asserts both.
const LEFT_FIELD_OPACITY = 0.12;
// [dx or x offset from the right edge, y, kind]; kind: corner (gold square on the glyph), gold (solid gold, navy lines), navy (filled --navy-800)
// Even rows (y = 12 + 160n) sit at dx = -54 - 64k, odd rows (y = 92 + 160n) at dx = -22 - 64k.
const TOP_KINDS = ['corner', 'navy', 'corner', 'gold', 'corner', 'navy', 'corner', 'corner'];
const HL_WIDE_TOP = TOP_KINDS.map((k, i) => [-54 - 64 * i, 12, k]);                       // the top row, above the crop at any width
const HL_WIDE_SIDE = [[-22, 92, 'corner'], [-86, 92, 'corner'], [-54, 172, 'navy'], [-118, 172, 'corner'], [-22, 252, 'gold'], [-86, 252, 'corner'],
  [-54, 332, 'corner'], [-118, 332, 'corner'], [-22, 412, 'navy'], [-86, 412, 'corner']];  // right of the crop
const HL_WIDE_BOTTOM = [[-22, -100, 'navy'], [-86, -100, 'gold'], [-150, -100, 'navy']];  // dy from the bottom: a row peeking out below the crop
const HL_STACK_BOTTOM = ['corner', 'gold', 'corner', 'navy', 'corner', 'navy', 'corner', 'corner', 'gold', 'corner'].map((k, i) => [-22 - 64 * i, -76, k]);
const HL_STACK_SIDE = [[-22, 252, 'corner'], [-54, 332, 'navy'], [-22, 412, 'corner']];
const HL_STRIP_TOP = ['corner', 'navy', 'corner', 'gold', 'corner', 'navy'].map((k, i) => [-54 - 64 * i, 12, k]);

function glyph(x, y) {
  return '<rect class="pro-band-glyph" x="' + (x + 0.75) + '" y="' + (y + 0.75) + '" width="' + (GW - 1.5) + '" height="' + (GH - 1.5) + '" rx="3"/>' +
    '<rect class="pro-band-glyph-ink" x="' + (x + 7) + '" y="' + (y + 9) + '" width="18" height="4" rx="1"/>' +
    '<rect class="pro-band-glyph-ink" x="' + (x + 7) + '" y="' + (y + 21) + '" width="30" height="3" rx="1"/>' +
    '<rect class="pro-band-glyph-ink" x="' + (x + 7) + '" y="' + (y + 29) + '" width="22" height="3" rx="1"/>';
}
function highlight(c) {
  const x = c[0], y = c[1];
  if (c[2] === 'corner') return '<rect class="pro-band-hl-corner" x="' + (x + 31) + '" y="' + (y + 1.5) + '" width="12" height="12"/>';
  if (c[2] === 'gold') return '<rect class="pro-band-hl-gold" x="' + x + '" y="' + y + '" width="' + GW + '" height="' + GH + '" rx="3"/>' +
    '<rect class="pro-band-hl-ink" x="' + (x + 7) + '" y="' + (y + 9) + '" width="18" height="4" rx="1"/><rect class="pro-band-hl-ink" x="' + (x + 7) + '" y="' + (y + 21) + '" width="30" height="3" rx="1"/><rect class="pro-band-hl-ink" x="' + (x + 7) + '" y="' + (y + 29) + '" width="22" height="3" rx="1"/>';
  return '<rect class="pro-band-hl-navy" x="' + x + '" y="' + y + '" width="' + GW + '" height="' + GH + '" rx="3"/>' + glyph(x, y);
}
const anchored = (originY, list) => '<svg x="100%" y="' + originY + '" width="1" height="1" overflow="visible">' + list.map(highlight).join('') + '</svg>';
const hlGroup = (name, top, bottom) => '<g class="pro-band-hl pro-band-hl--' + name + '">' + anchored('0', top) + (bottom.length ? anchored('100%', bottom) : '') + '</g>';

function texture() {
  const attrs = ' aria-hidden="true" focusable="false"';
  const faintGlyph = (x, y) => '<rect class="pro-band-faint-glyph" stroke-opacity="' + LEFT_FIELD_OPACITY + '" x="' + (x + 0.75) + '" y="' + (y + 0.75) + '" width="' + (GW - 1.5) + '" height="' + (GH - 1.5) + '" rx="3"/>';
  const tile = (id, inner) => '<defs><pattern id="' + id + '" x="100%" y="0" width="' + PX + '" height="' + 2 * PY + '" patternUnits="userSpaceOnUse">' + inner + '</pattern></defs><rect width="100%" height="100%" fill="url(#' + id + ')"/>';
  return '<svg class="pro-band-faint" width="100%" height="100%"' + attrs + '>' + tile('pro-band-faint', faintGlyph(10, 12) + faintGlyph(42, 12 + PY) + faintGlyph(-22, 12 + PY)) + '</svg>\n' +
    '<div class="pro-band-surface" aria-hidden="true"><svg width="100%" height="100%"' + attrs + '>' + tile('pro-band-field', glyph(10, 12) + glyph(42, 12 + PY) + glyph(-22, 12 + PY)) +
    hlGroup('wide', HL_WIDE_TOP.concat(HL_WIDE_SIDE), HL_WIDE_BOTTOM) + hlGroup('stack', HL_STACK_SIDE, HL_STACK_BOTTOM) + hlGroup('strip', HL_STRIP_TOP, []) + '</svg></div>';
}

function band(F) {
  // One idea, one visual, one action, no score and no stat: the page tells the rest.
  const point = (ic, label) => '<li>' + icons.svg(ic, { cls: 'pro-band-list__icon' }) + '<span>' + label + '</span></li>';
  const caption = 'Sample: our own site, ' + esc(F.date) + '. From the worst page to its fix.';
  return START + '\n' +
    '      <section class="pro-mkt pro-band-hero" id="pro" aria-labelledby="pro-heading">\n' +
    '        ' + indent(texture(), '        ') + '\n' +
    '        <div class="section__inner">\n' +
    '          <div class="pro-mkt__grid">\n' +
    '            <div class="pro-mkt__text">\n' +
    '              <p class="pro-band-tag">PRO</p>\n' +
    '              <h2 id="pro-heading">Everything the free scan can\'t see.</h2>\n' +
    '              <p class="pro-mkt__lede">Pro reads beyond your homepage, then asks a model the questions your buyers ask and records when your name comes up.</p>\n' +
    '              <ul class="pro-band-list">' + point('layers', 'Beyond the homepage') + point('question', 'Your buyers\' questions') + point('report', 'A report to hand over') + '</ul>\n' +
    '              <p class="pro-mkt__actions"><a href="/pro" class="btn btn--gold">See what Pro includes</a></p>\n' +
    '              <p class="pro-mkt__price">One-time purchase. No subscription.</p>\n' +
    '            </div>\n' +
    '            <div class="pro-band-stage">\n' +
    '              ' + indent(frame('band-explorer', F, 'pro-shot--desktop', { caption: caption, plain: true }), '              ') + '\n' +
    '            </div>\n' +
    '          </div>\n' +
    '        </div>\n' +
    '      </section>\n      ' + END;
}

function indexHtml(current, F) {
  const b = band(F);
  if (current.indexOf(START) !== -1) return current.replace(new RegExp(START + '[\\s\\S]*?' + END), () => b);
  const open = current.indexOf('<section class="pro-band" id="pro"');
  if (open === -1) throw new Error('index.html: no Pro band to replace');
  const close = current.indexOf('</section>', open) + '</section>'.length;
  return current.slice(0, open) + b + current.slice(close);
}

/* ---------- the page ---------- */

function faq(F) {
  const c = F.cit;
  return [
    { q: 'What do I get with Citehound Pro?',
      html: 'A crawl of up to ' + F.cap + ' pages of your site and a report built from it: an executive summary, the whole-site score beside the homepage score, a heat matrix of which pages fail which checks, a page-by-page explorer, every fix once with the pages it applies to, and a printable version. It also includes a citation run on your brand, which we run for you and add to the report: the questions your buyers ask, each asked ' + c.triesWord + ' times, and the pattern of when your name comes up.' },
    { q: 'How is this different from the free scan?',
      html: 'The free scan reads one page: the full 16-check report, the crawler matrix, copy-paste fixes and every playbook. Pro reads up to ' + F.cap + ' pages and shows what the homepage hides, then adds a citation run on your brand, which we run for you. Comparing two sites is free at <a href="/compare">/compare</a>, and the citation question sets are free to try in your own assistant through the <a href="/mcp">Citehound MCP server</a>.' },
    { q: 'What is the sample report?',
      html: 'A real crawl of our own site, ' + esc(F.domain) + ', run on ' + esc(F.date) + ': ' + F.pagesRead + ' pages. Nothing in it was edited or improved, and our own pages still fail some checks. The report says which. Its Citations tab shows the published citation sample, which belongs to a different brand. <a href="/sample-report">Open it.</a>' },
    { q: 'Does it measure whether AI names me?',
      html: 'Two parts, two questions. The <a href="/sample-report">crawl</a> measures readiness: whether crawlers can reach and read your pages. The <a href="/citation-tracking">citation run</a> records whether a model names your brand when it is asked the questions your buyers ask. A readiness score of 100 doesn\'t guarantee a mention.' },
    { q: 'Which models does the citation run use?',
      html: 'One today. Every report names the model and the date it was run, and results are shown per model. A result describes one model on one date and says nothing about any other assistant.' },
    { q: 'Is the citation run self-serve?',
      html: 'No. We run it for you and add it to your report. ' + SELF_SERVE },
    { q: 'Is it really a one-time payment?',
      html: 'Yes. Citehound Pro is a single one-time purchase. There is no subscription and no recurring billing.' },
    { q: 'Do I need an account?',
      html: 'No. There is no account or login. Your report is generated and delivered right after payment.' }
  ];
}

function shellParts() {
  const about = fs.readFileSync(path.join(ROOT, 'about.html'), 'utf8');
  const grab = (re, what) => { const m = about.match(re); if (!m) throw new Error('about.html: could not find ' + what); return m[0]; };
  return {
    favicon: grab(/<link rel="icon"[^>]*>/, 'favicon'),
    fonts: grab(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com" \/>[\s\S]*?rel="stylesheet" \/>/, 'font links'),
    header: grab(/<header class="site-header">[\s\S]*?<\/header>/, 'header'),
    footerNav: grab(/<nav class="site-nav footer-links"[\s\S]*?<\/nav>/, 'footer nav')
  };
}

function build() {
  const F = figures();
  const c = F.cit;
  const k = F.case;
  const shell = shellParts();
  const title = 'Citehound — Pro: Can AI read you? Does it name you?';
  const desc = 'Pro crawls up to ' + F.cap + ' pages to show what your homepage hides, then asks a model the questions your buyers ask and records when your name comes up.';
  if (desc.length < 120 || desc.length > 160) throw new Error('description is ' + desc.length + ' characters');
  const questions = faq(F);
  const ld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: questions.map((q) => ({ '@type': 'Question', name: q.q, acceptedAnswer: { '@type': 'Answer', text: textOf(q.html) } })) };

  const gapText = 'Pages other than the homepage fail checks the homepage passes: ' + fig('hidden', F.hidden) + ' checks, failing on ' + fig('failing-others', F.failingOthers) + ' of the ' + fig('others', F.others) + ' other pages.';

  const li = (text) => '<li>' + icon('check') + '<span>' + text + '</span></li>';
  const freeItems = ['One page, scanned on demand', 'All 16 checks, with their point values', 'The AI crawler matrix, 10 crawlers deep', 'Copy-paste fixes for schema and robots.txt', '<a href="/compare">Comparing two sites</a>', 'Every <a href="/playbooks">playbook</a>', 'All the <a href="/tools">tools</a>', 'The citation question sets, to try in your own assistant through the <a href="/mcp">MCP server</a>'].map(li).join('\n            ');
  const proItems = ['Up to ' + fig('cap2', F.cap) + ' pages in one crawl', 'The whole-site score beside the homepage score', 'Pages ranked, worst first', 'The checks that pass on the homepage and fail elsewhere', 'Every fix once, with the pages it applies to', 'A printable report', 'A citation run on your brand, which we run for you and add to the report'].map(li).join('\n            ');

  const step = (ic, name, text) => '          <li class="pro-step">\n            <span class="pro-row__icon">' + icon(ic) + '</span>\n            <h3 class="pro-step__title">' + name + '</h3>\n            <p class="pro-step__text">' + text + '</p>\n          </li>';

  const card = (ic, title, text, thumb) => '          <li class="pro-card">\n            <span class="pro-row__icon">' + icon(ic) + '</span>\n            <h3 class="pro-card__title">' + title + '</h3>\n            <p class="pro-card__text">' + text + '</p>\n' + (thumb ? '            ' + indent(thumb, '            ') + '\n' : '') + '          </li>';

  const body = '  <main id="main">\n\n' +
    '    <!-- ---------- Banner ---------- -->\n' +
    '    <section aria-labelledby="pro-heading">\n      <div class="section__inner">\n        <div class="page-banner pro-banner">\n          <div class="page-banner__body">\n' +
    '            <p class="kicker kicker--on-navy">Pro</p>\n' +
    '            <h1 id="pro-heading" class="page-banner__title">Can AI read you? Does it name you?</h1>\n' +
    '            <p class="page-banner__desc">Pro crawls up to ' + fig('cap', F.cap) + ' pages to show what your homepage hides, then asks a model the questions your buyers ask and records when your name comes up.</p>\n' +
    '            <div class="pro-actions"><a href="/sample-report" class="btn btn--gold">See a real report. No signup.</a><a href="' + CITATION_MAIL + '" class="btn btn--ghost-on-navy">Get early access</a></div>\n' +
    '          </div>\n' +
    '          ' + indent(frame('summary', F, 'pro-shot--hero'), '          ') + '\n' +
    '        </div>\n      </div>\n    </section>\n\n' +
    '    <!-- ---------- Two questions, one report ---------- -->\n' +
    '    <section class="verticals" aria-labelledby="two-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">What Pro answers</p>\n          <h2 id="two-heading" class="section-title">Two questions. One report.</h2>\n        </div>\n' +
    '        <div class="pro-panels">\n' +
    '          <div class="pro-panel">\n            <p class="kicker">Can AI read you?</p>\n            <h3 class="pro-panel__title">Your homepage isn\'t your site.</h3>\n' +
    '            <div class="pro-gap">\n              <div class="pro-gap__fig"><span class="pro-gap__label">Homepage</span><span class="pro-gap__num">' + fig('homepage', F.homepage) + '</span></div>\n              <div class="pro-gap__fig"><span class="pro-gap__label">Whole site</span><span class="pro-gap__num">' + fig('site', F.site) + '</span></div>\n            </div>\n' +
    '            <p class="pro-panel__cap">A real crawl of ' + esc(F.domain) + ', ' + fig('date', F.date) + '. Nothing edited.</p>\n' +
    '            <p class="pro-panel__text">' + gapText + '</p>\n' +
    '            ' + indent(frame('matrix', F, 'pro-shot--desktop'), '            ') + '\n' +
    '          </div>\n' +
    '          <div class="pro-panel">\n            <p class="kicker">Does it name you?</p>\n' +
    '            <p class="pro-named"><span class="pro-named__big">Named in ' + fig('cit-pct', c.pct) + '% of answers.</span><span class="pro-named__sub">Never named for ' + fig('cit-never', c.never) + ' of ' + fig('cit-questions', c.questions) + ' questions.</span></p>\n' +
    '            <p class="pro-panel__cap">' + fig('cit-model', c.model) + ', ' + fig('cit-date', c.date) + ', ' + c.triesWord + ' tries per question, a different brand.</p>\n' +
    '            <p class="pro-panel__text">The same question can get a different answer each time, so a run asks every question ' + c.triesWord + ' times and shows the pattern.</p>\n' +
    '            ' + indent(frame('citations', F, ''), '            ') + '\n' +
    '            <p class="pro-panel__link"><a href="/citation-tracking">How a run works</a></p>\n          </div>\n' +
    '        </div>\n' +
    '        <p class="pro-between">Reading isn\'t being named. Pro shows you both.</p>\n' +
    '      </div>\n    </section>\n\n' +
    '    <!-- ---------- How a report comes together ---------- -->\n' +
    '    <section class="verticals" aria-labelledby="steps-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">How it works</p>\n          <h2 id="steps-heading" class="section-title">How a Pro report comes together</h2>\n        </div>\n        <ol class="pro-steps">\n' +
    step('search', 'Crawl', 'Up to ' + fig('cap3', F.cap) + ' pages, spaced politely, robots.txt respected.') + '\n' +
    step('chat', 'Ask', 'The questions your buyers ask for your category, each ' + c.triesWord + ' times. The report names the one model used and the date.') + '\n' +
    step('report', 'Hand over', 'One report with the summary, the fixes and the citation results, printable as a PDF. We run the citation questions for you.') + '\n' +
    '        </ol>\n      </div>\n    </section>\n\n' +
    '    <!-- ---------- Also inside ---------- -->\n' +
    '    <section class="verticals" aria-labelledby="get-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">Also inside</p>\n          <h2 id="get-heading" class="section-title">The rest of the report.</h2>\n        </div>\n        <ul class="pro-cards">\n' +
    card('report', 'Start with the answer.', 'The report opens with the site-wide score beside the homepage score, then the top three checks to fix first and the points each adds. A short summary leads, labeled with what wrote it.') + '\n' +
    card('document', 'From the worst page to its fix in two clicks.', 'Pages are listed worst first. Select one to see the checks it fails, then open its copy-paste fix.', frame('pages', F, 'pro-shot--thumb pro-shot--desktop')) + '\n' +
    card('wrench', 'Every fix once, with the pages it applies to.', 'Identical snippets appear once, with the pages they apply to and a Copy button.', frame('fixes', F, 'pro-shot--thumb pro-shot--desktop')) + '\n' +
    card('printer', 'Hand it to your developer.', 'Print or save as PDF opens every section and drops the controls, so the printout is the whole report.') + '\n' +
    '        </ul>\n      </div>\n    </section>\n\n' +
    '    <!-- ---------- Proof ---------- -->\n' +
    '    <section aria-label="Case study">\n      <div class="section__inner">\n        <div class="pro-proof">\n          <p class="kicker">Case study</p>\n' +
    '          <p class="pro-proof__line"><span class="pro-proof__big">+' + k.gain + ' points</span> on average for two sites: ' + fig('case-before1', k.before1) + ' to ' + fig('case-after1', k.after1) + ' and ' + fig('case-before2', k.before2) + ' to ' + fig('case-after2', k.after2) + '.</p>\n' +
    '          <p class="pro-proof__text">Scan, fix what ranks first, scan again. The case study shows the loop, and what the ' + k.after1 + ' means. <a href="/research/case-study-agaone">Read the AgaOne case study</a></p>\n' +
    '        </div>\n      </div>\n    </section>\n\n' +
    '    <!-- ---------- Free versus Pro ---------- -->\n' +
    '    <section class="verticals" aria-labelledby="vs-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">Free vs. Pro</p>\n          <h2 id="vs-heading" class="section-title">Free reads a page. Pro reads the site and asks the model.</h2>\n          <p class="section-sub">Nothing below is a trial or a teaser. It stays free whether or not you ever buy Pro.</p>\n        </div>\n' +
    '        <div class="pro-cols">\n' +
    '          <div class="pro-col">\n            <p class="kicker">Free</p>\n            <h3 class="pro-col__title">Always free</h3>\n            <ul class="pro-list">\n            ' + freeItems + '\n            </ul>\n          </div>\n' +
    '          <div class="pro-col">\n            <p class="kicker">Pro</p>\n            <h3 class="pro-col__title">The whole site, and the model</h3>\n            <ul class="pro-list">\n            ' + proItems + '\n            </ul>\n            <p class="pro-col__note">The citation run is one we run for you. ' + SELF_SERVE + '</p>\n            <p class="pro-col__foot pro-col__foot--note">One payment. Full Pro report for your domain. <a href="#" class="btn btn--ghost">In preparation</a></p>\n          </div>\n' +
    '        </div>\n      </div>\n    </section>\n\n' +
    '    <!-- ---------- Closing band ---------- -->\n' +
    '    <section class="pro-band" aria-labelledby="close-heading">\n      <div class="section__inner">\n        <p class="kicker kicker--on-navy">Pro</p>\n        <h2 id="close-heading">Can AI read you? Does it name you?</h2>\n        <p class="pro-band__lede">Read a real report first: one crawl of our own site, ' + fig('pages', F.pagesRead) + ' pages, unedited, with a citation sample from a different brand. No signup.</p>\n' +
    '        <div class="pro-actions pro-actions--band"><a href="/sample-report" class="btn btn--gold">See a real report. No signup.</a><a href="' + CITATION_MAIL + '" class="btn btn--ghost-on-navy">Get early access</a></div>\n      </div>\n    </section>\n\n' +
    '    <!-- ---------- FAQ ---------- -->\n' +
    '    <section class="verticals pro-faq" aria-labelledby="faq-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">Questions</p>\n          <h2 id="faq-heading" class="section-title">Pro, briefly.</h2>\n        </div>\n        <div class="ct-faq">\n' +
    questions.map((q) => '          <details>\n            <summary>' + esc(q.q) + '</summary>\n            <p>' + q.html + '</p>\n          </details>').join('\n') + '\n        </div>\n      </div>\n    </section>\n\n';

  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n\n' +
    '  <title>' + esc(title) + '</title>\n  <meta name="description" content="' + esc(desc) + '" />\n' +
    '  <meta name="keywords" content="Citehound Pro, AI readiness report, citation tracking, full-site crawl, GEO, AEO" />\n  <meta name="author" content="Citehound" />\n  <meta name="robots" content="index, follow" />\n  <link rel="canonical" href="' + SITE + '/pro" />\n\n' +
    '  <!-- Open Graph -->\n  <meta property="og:type" content="website" />\n  <meta property="og:title" content="' + esc(title) + '" />\n  <meta property="og:description" content="' + esc(desc) + '" />\n  <meta property="og:url" content="' + SITE + '/pro" />\n  <meta property="og:image" content="' + SITE + '/assets/brand/og-default.png" />\n  <meta property="og:site_name" content="Citehound" />\n\n' +
    '  <!-- Twitter -->\n  <meta name="twitter:card" content="summary_large_image" />\n  <meta name="twitter:title" content="' + esc(title) + '" />\n  <meta name="twitter:description" content="' + esc(desc) + '" />\n  <meta name="twitter:image" content="' + SITE + '/assets/brand/og-default.png" />\n\n' +
    '  ' + shell.favicon + '\n\n  ' + shell.fonts + '\n\n  <link rel="stylesheet" href="styles.css?v=' + CSS_VERSION + '" />\n\n' +
    '  <script type="application/ld+json">\n' + JSON.stringify(ld, null, 2).replace(/^/gm, '  ') + '\n  </script>\n' + siteChrome.schemaBlock().replace(/^/gm, '  ') + '\n</head>\n<body>\n\n' +
    '  <a class="skip-link" href="#main">Skip to content</a>\n\n  ' + shell.header + '\n\n' + body +
    '    <footer class="site-footer" aria-label="Footer">\n      <div class="section__inner">\n        ' + shell.footerNav.replace(/\n/g, '\n        ') + '\n' +
    '        <p class="site-footer__coda">© 2026 Citehound. Built for teams navigating the shift from search to answers.</p>\n      </div>\n    </footer>\n\n  </main>\n\n' +
    '  <div class="toast" id="toast" role="status" aria-live="polite"></div>\n\n  <script src="nav.js?v=3"></script>\n</body>\n</html>\n';
}

/* ---------- --check: read every figure back and recompute it from the raw files ---------- */

function independent() {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const sample = JSON.parse(fs.readFileSync(CITATION, 'utf8'));
  const ok = data.pages.filter((p) => p.status === 'ok' && p.result);
  const total = (p) => p.result.checks.reduce((n, c) => n + c.pts, 0);
  const siteLevel = (l) => /^(robots\.txt present|llms\.txt present|Sitemap declared|AI crawler access)/.test(l);
  const clean = (l) => l.replace(/\s*\(\d+\s*\/\s*\d+\s+open\)\s*$/i, '');
  const home = ok.filter((p) => p.url === data.pages[0].url)[0];
  const labels = home.result.checks.filter((c) => !siteLevel(c.label)).map((c) => clean(c.label));
  const failsOn = (p, l) => p.result.checks.some((c) => clean(c.label) === l && !c.ok);
  const hidden = labels.filter((l) => !failsOn(home, l) && ok.some((p) => p !== home && failsOn(p, l)));
  const cap = parseInt(/MAX_PAGES = (\d+)/.exec(fs.readFileSync(path.join(ROOT, 'api', 'crawl-start.js'), 'utf8'))[1], 10);
  const longDate = (iso) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

  const prompts = sample.prompts;
  const isNamed = (r) => r !== 'absent';
  const named = prompts.reduce((n, p) => n + p.runs.filter(isNamed).length, 0);
  const tries = sample.runsPerPrompt;
  const perTry = [];
  for (let i = 0; i < tries; i++) perTry.push(Math.round(prompts.filter((p) => isNamed(p.runs[i])).length / prompts.length * 100));
  const caseText = fs.readFileSync(CASE, 'utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const num = (re) => { const m = re.exec(caseText); return m ? +m[1] : NaN; };

  return {
    cap: cap, cap2: cap, cap3: cap,
    homepage: total(home),
    site: Math.round(ok.reduce((n, p) => n + total(p), 0) / ok.length),
    hidden: hidden.length,
    'failing-others': ok.filter((p) => p !== home && hidden.some((l) => failsOn(p, l))).length,
    others: ok.length - 1,
    'failing-checks': labels.filter((l) => ok.some((p) => failsOn(p, l))).length,
    columns: labels.length,
    'all-down': labels.filter((l) => ok.every((p) => failsOn(p, l))).length,
    pages: ok.length,
    date: longDate(data.createdAt),
    'cit-model': sample.model,
    'cit-date': longDate(sample.date),
    'cit-pct': Math.round(named / (prompts.length * tries) * 100),
    'cit-never': prompts.filter((p) => p.runs.every((r) => !isNamed(r))).length,
    'cit-unstable': prompts.filter((p) => p.runs.some(isNamed) && !p.runs.every(isNamed)).length,
    'cit-questions': prompts.length,
    'cit-min': Math.min.apply(null, perTry),
    'cit-max': Math.max.apply(null, perTry),
    'case-before1': num(/Site one scored (\d+)\./),
    'case-before2': num(/Site two scored (\d+)\./),
    'case-after1': num(/One site reached (\d+) out of 100/),
    'case-after2': num(/The other reached (\d+)\./),
    caseGain: num(/\+(\d+) avg\. point gain/),
    tries: tries
  };
}

function readFigs(html) {
  const out = {};
  const re = /data-fig="pro-([a-z0-9-]+)">([^<]*)</g;
  let m;
  while ((m = re.exec(html))) (out[m[1]] = out[m[1]] || []).push(m[2].replace(/&amp;/g, '&'));
  return out;
}

const BANNED = ['quietly', 'actually', 'seamlessly', 'effortless', 'powerful', 'unlock', 'elevate', 'supercharge', 'game-changing', 'revolutionize', 'landscape', 'delve', 'crucial', 'robust', 'recommended', 'recommend', 'coming soon'];

function check() {
  const errors = [];
  const bad = (msg) => errors.push(msg);
  const F = figures();
  const want = independent();
  const page = fs.existsSync(PAGE) ? fs.readFileSync(PAGE, 'utf8') : '';
  const index = fs.readFileSync(INDEX, 'utf8');

  if (page !== build()) bad('pro.html is out of date; run node scripts/generate-pro.js');
  if (indexHtml(index, F) !== index) bad('the Pro band in index.html is out of date; run node scripts/generate-pro.js');
  const bandHtml = (index.match(new RegExp(START + '[\\s\\S]*?' + END)) || [''])[0];
  if (!bandHtml) bad('index.html has no PRO-BAND markers');

  // Figures on both surfaces equal the recomputation from the raw files.
  [['pro.html', page], ['the homepage band', bandHtml]].forEach(function (s) {
    const got = readFigs(s[1]);
    const keys = Object.keys(got);
    if (!keys.length && s[0] === 'pro.html') bad(s[0] + ' shows no figures');
    keys.forEach(function (k) {
      if (!(k in want)) { bad(s[0] + ': figure "' + k + '" has no recomputation'); return; }
      got[k].forEach(function (v) { if (String(v) !== String(want[k])) bad(s[0] + ': ' + k + ' reads ' + v + ', the source gives ' + want[k]); });
    });
  });
  // The band is a hook: one idea, one crop, one action, no score and no stat.
  const interactive = (bandHtml.match(/<(a|button)\b/g) || []).length;
  if (interactive !== 1) bad('the band has ' + interactive + ' links or buttons, it must have exactly one');
  if (!/<a href="\/pro" class="btn btn--gold">See what Pro includes<\/a>/.test(bandHtml)) bad('the band\'s one action is not the gold "See what Pro includes" button to /pro');
  if (/data-fig=/.test(bandHtml)) bad('the band carries a data-fig attribute; it shows no figure');
  const bandTexts = [['tag', /<p class="pro-band-tag">([^<]*)<\/p>/], ['headline', /<h2[^>]*>([^<]*)<\/h2>/], ['sentence', /<p class="pro-mkt__lede">([^<]*)<\/p>/]].map((x) => [x[0], (x[1].exec(bandHtml) || [0, ''])[1]]);
  ((/<ul class="pro-band-list">([\s\S]*?)<\/ul>/.exec(bandHtml) || [0, ''])[1].match(/<li>[\s\S]*?<\/li>/g) || []).forEach((li) => bandTexts.push(['label', textOf(li.replace(/<svg[\s\S]*?<\/svg>/, ''))]));
  if (bandTexts.length !== 6) bad('the band should have a tag, a headline, a sentence and three labels');
  bandTexts.forEach((t) => { if (!t[1] || /\d/.test(t[1])) bad('the band ' + t[0] + ' is empty or contains a digit: "' + t[1] + '"'); });
  if (bandHtml.indexOf('<p class="pro-band-tag">PRO</p>') === -1) bad('the band tag is not "PRO"');
  if (bandHtml.indexOf('Everything the free scan can\'t see.') === -1 || bandHtml.indexOf('Pro reads beyond your homepage, then asks a model the questions your buyers ask and records when your name comes up.') === -1) bad('the band headline or sentence changed');
  if ((bandHtml.match(/<figure class="pro-shot/g) || []).length !== 1 || bandHtml.indexOf('pro-shot--band-explorer') === -1) bad('the band must carry exactly one crop, the dashboard explorer');
  const crop = (bandHtml.match(/<div class="pro-shot__view"[\s\S]*?<\/figure>/) || [''])[0];
  ['Summary', 'Pages', 'Checks', 'Fixes', 'Citations'].forEach((t) => { if (crop.indexOf('</svg>' + t + '</span>') === -1) bad('the band crop does not show the ' + t + ' tab'); });
  if ((crop.match(/aria-selected="true"/g) || []).length !== 1 || crop.indexOf('aria-selected="true"><svg') === -1 || !/aria-selected="true">(<svg[^>]*>[\s\S]*?<\/svg>)Pages<\/span>/.test(crop)) bad('the band crop must show Pages as the selected tab');
  if (bandHtml.indexOf('<figcaption class="pro-shot__cap">Sample: our own site, ' + want.date + '. From the worst page to its fix.</figcaption>') === -1) bad('the band crop caption is wrong');
  if (!/<ul class="pro-band-list">(<li><svg[^>]*>[\s\S]*?<\/svg><span>[^<]+<\/span><\/li>){3}<\/ul>/.test(bandHtml)) bad('the band needs a <ul> of three icon-and-label items');
  // The texture: two band-level layers, each an aria-hidden inline SVG with a <pattern>; no gradient function anywhere.
  if (!/<section class="pro-mkt pro-band-hero"[^>]*>\s*<svg class="pro-band-faint"[^>]*aria-hidden="true"[\s\S]*?<pattern [\s\S]*?<\/svg>\s*<div class="pro-band-surface" aria-hidden="true"><svg[^>]*aria-hidden="true"[\s\S]*?<pattern /.test(bandHtml)) bad('the band needs the faint field and the zone as band-level aria-hidden SVGs with a <pattern>, before the content container');
  const faint = (bandHtml.match(/<svg class="pro-band-faint"[\s\S]*?<\/svg>/) || [''])[0];
  if (/pro-band-hl|pro-band-glyph-ink|pro-band-hl-gold|pro-band-hl-navy/.test(faint)) bad('the left field must be outlines only, with no gold or navy fills');
  if (!(faint.match(/class="pro-band-faint-glyph" stroke-opacity="[0-9.]+"/g) || []).length || (faint.match(/stroke-opacity="([0-9.]+)"/g) || []).some((x) => parseFloat(x.replace(/[^0-9.]/g, '')) !== LEFT_FIELD_OPACITY)) bad('the left field does not use LEFT_FIELD_OPACITY');
  const zone = (bandHtml.match(/<div class="pro-band-surface"[\s\S]*?<\/svg><\/div>/) || [''])[0];
  if (/pro-band-hl/.test(bandHtml.replace(zone, ''))) bad('highlighted glyphs appear outside the right zone');
  const wide = (zone.match(/<g class="pro-band-hl pro-band-hl--wide">[\s\S]*?<\/g>/) || [''])[0];
  const n = (cls) => (wide.match(new RegExp('class="' + cls + '"', 'g')) || []).length;
  if (n('pro-band-hl-corner') !== 12 || n('pro-band-hl-gold') !== 3 || n('pro-band-hl-navy') !== 6) bad('the wide field needs 12 corner glyphs, 3 gold glyphs and 6 navy glyphs; it has ' + n('pro-band-hl-corner') + ', ' + n('pro-band-hl-gold') + ', ' + n('pro-band-hl-navy'));
  if ((wide.match(/<svg x="100%" y="(0|100%)"/g) || []).length !== 2) bad('the highlights must be anchored to the right edge, the top edge and the bottom edge');
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  if (/gradient\s*\(/i.test(css)) bad('styles.css contains a gradient function');
  // Outline contrast: --white at the stylesheet's opacity, composited over --navy-900, against --navy-900.
  const hex = (name) => { const m = new RegExp('--' + name + ':\\s*#([0-9a-fA-F]{6})').exec(css); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
  const lum = (c) => { const l = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
  const opacity = (cls, prop) => { const m = new RegExp('\\.' + cls + '\\s*\\{[^}]*' + prop + ':\\s*([0-9.]+)').exec(css); return m ? parseFloat(m[1]) : NaN; };
  const white = hex('white'), navy = hex('navy-900');
  if (!white || !navy) bad('cannot read --white or --navy-900 from the stylesheet');
  else [['pro-band-glyph', 'stroke-opacity'], ['pro-band-glyph-ink', 'fill-opacity']].forEach((o) => {
    const a = opacity(o[0], o[1]);
    const comp = white.map((v, i) => v * a + navy[i] * (1 - a));
    const l1 = lum(comp), l2 = lum(navy);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    if (!(ratio >= 3)) bad('.' + o[0] + ' contrast against --navy-900 is ' + ratio.toFixed(2) + ':1, it must be at least 3:1');
  });
  // Legibility of the left column against the brightest pixel the left field can put behind it.
  const navy950 = hex('navy-950'), gold = hex('gold'), goldSoft = hex('gold-soft');
  const mix = (fg, a, bg) => fg.map((v, i) => v * a + bg[i] * (1 - a));
  const ratioOf = (c1, c2) => { const x = lum(c1), y = lum(c2); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const alphaOf = (sel) => { const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*color:\\s*rgba\\(255,\\s*255,\\s*255,\\s*([0-9.]+)\\)').exec(css); return m ? parseFloat(m[1]) : NaN; };
  if (!navy950 || !gold || !goldSoft || !white) bad('cannot read the colour tokens for the legibility check');
  else {
    const brightest = mix(white, LEFT_FIELD_OPACITY, navy950);
    const outline = ratioOf(brightest, navy950);
    if (LEFT_FIELD_OPACITY > 0 && outline < 1.3) bad('the left field outline is ' + outline.toFixed(2) + ':1 against --navy-950; it must be at least 1.3:1 to be visible');
    [['headline', white, 3, '.pro-mkt h2', 'var(--white)'], ['sentence', mix(white, alphaOf('.pro-mkt__lede'), navy950), 4.5, '.pro-mkt__lede'], ['list labels', mix(white, alphaOf('.pro-band-list li'), navy950), 4.5, '.pro-band-list li'], ['price line', goldSoft, 4.5, '.pro-mkt__price'], ['PRO tag', gold, 4.5, '.pro-band-tag'], ['list icons', gold, 3, '.pro-band-list__icon']].forEach((t) => {
      if (t[1].some(isNaN)) { bad('cannot read the colour of ' + t[0]); return; }
      const r = ratioOf(t[1], brightest);
      if (r < t[2]) bad(t[0] + ' has ' + r.toFixed(2) + ':1 against the brightest left-field pixel; it must be at least ' + t[2] + ':1 (lower LEFT_FIELD_OPACITY)');
    });
  }
  if (/<pattern\b/.test(page) || /<pattern\b/.test(index.replace(bandHtml, ''))) bad('the grid texture appears outside the Pro band');
  ['cap', 'homepage', 'site', 'hidden', 'failing-others', 'others', 'cit-pct', 'cit-never', 'cit-questions', 'cit-model', 'cit-date', 'date', 'case-before1', 'case-before2', 'case-after1', 'case-after2'].forEach((k) => { if (!readFigs(page)[k]) bad('pro.html does not show ' + k); });
  if (F.cit.tries !== want.tries) bad('tries: ' + F.cit.tries + ' against ' + want.tries);
  if (F.case.gain !== want.caseGain) bad('case study gain: ' + F.case.gain + ' against ' + want.caseGain);
  // Each case-study figure on the page appears in the case study file.
  const caseHtml = fs.readFileSync(CASE, 'utf8');
  [['+' + F.case.gain, 'the gain'], ['scored ' + F.case.before1, 'the first score'], ['scored ' + F.case.before2, 'the second score'], ['reached ' + F.case.after1, 'the first final score'], ['reached ' + F.case.after2, 'the second final score']].forEach((p) => { if (caseHtml.indexOf(p[0]) === -1) bad('the case study file has no "' + p[0] + '" (' + p[1] + ')'); });
  if (page.indexOf('+' + F.case.gain + ' points</span> on average for two sites') === -1) bad('the proof strip does not carry the average gain');

  // The crops are current, and the summary label is shown exactly as the product shows it.
  const made = capture.crops(F.data);
  capture.NAMES.forEach((n) => { if (cropHtml(n).replace(/\n$/, '') !== made[n].replace(/\n+$/, '')) bad('assets/pro/' + n + '.frag is out of date; run node scripts/capture-pro-shots.js'); });
  if (F.data.executiveSummary && F.data.executiveSummary.source && F.data.executiveSummary.source.kind === 'model' && cropHtml('summary').indexOf(esc(F.data.executiveSummary.label)) === -1) bad('the summary crop does not carry the summary label');

  // The structured data parses and matches the visible FAQ.
  const ldBlocks = (page.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []).map((b) => JSON.parse(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')));
  const ldFaq = ldBlocks.filter((j) => j['@type'] === 'FAQPage')[0];
  const shown = (page.match(/<details>\s*<summary>[\s\S]*?<\/details>/g) || []).map((d) => ({ q: textOf(/<summary>([\s\S]*?)<\/summary>/.exec(d)[1]), a: textOf(/<p>([\s\S]*?)<\/p>/.exec(d)[1]) }));
  if (!ldFaq) bad('no FAQPage JSON-LD');
  else {
    if (ldFaq.mainEntity.length !== shown.length) bad('FAQ: ' + ldFaq.mainEntity.length + ' in JSON-LD, ' + shown.length + ' shown');
    ldFaq.mainEntity.forEach(function (q, i) { if (!shown[i] || shown[i].q !== q.name || shown[i].a !== q.acceptedAnswer.text) bad('FAQ ' + (i + 1) + ' differs between the JSON-LD and the page'); });
  }
  [['Is it really a one-time payment?', 'Yes. Citehound Pro is a single one-time purchase. There is no subscription and no recurring billing.'], ['Do I need an account?', 'No. There is no account or login. Your report is generated and delivered right after payment.']].forEach((k) => { if (!shown.some((s) => s.q === k[0] && s.a === k[1])) bad('the existing answer "' + k[0] + '" changed'); });
  ['One payment. Full Pro report for your domain.', 'In preparation'].forEach((t) => { if (page.indexOf(t) === -1) bad('the existing statement "' + t + '" is missing'); });
  if (bandHtml.indexOf('One-time purchase. No subscription.') === -1) bad('the band lost its price-model line');

  // Page and band rules.
  const alt = (h) => (h.match(/aria-label="[^"]*"/g) || []).join(' ');
  [['pro.html', page], ['the band', bandHtml]].forEach(function (s) {
    const name = s[0];
    if (/gradient\(/i.test(s[1])) bad(name + ': a gradient');
    if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s[1])) bad(name + ': an emoji');
    const visible = textOf(s[1].replace(/<script[\s\S]*?<\/script>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '')) + ' ' + alt(s[1]);
    BANNED.forEach((w) => { if (new RegExp('\\b' + w + '\\b', 'i').test(visible)) bad(name + ': banned word "' + w + '"'); });
    if (/[$€£]\s?\d|\bprice\b|\bpricing\b|\bper (month|year|report)\b|\bUSD\b|\bEUR\b/i.test(visible)) bad(name + ': a price');
    if (/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|unlimited)\s+(citation\s+)?(runs|crawls)\b/i.test(visible)) bad(name + ': a count of runs or crawls');
    if (/\blaunch(ed|es|ing)?\b|\bavailable (from|on|in|starting)\b|\bwill be available\b|\bin (Q[1-4]|20\d\d)\b/i.test(visible)) bad(name + ': a launch or availability date');
    const rest = visible.replace(new RegExp(SELF_SERVE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '').replace('Is the citation run self-serve?', '');
    if (/self-serve/i.test(rest)) bad(name + ': "self-serve" outside the sentence that says it is still to come');
    if (/\b(chatgpt|openai|perplexity|copilot|claude|anthropic|grok|bard)\b/i.test(visible) || /gemini/i.test(visible.replace(/gemini-3\.5-flash-lite/g, ''))) bad(name + ': names a consumer AI product');
    if (name === 'pro.html' && !/\bwe run\b[^.]*\bfor you\b/i.test(visible)) bad(name + ': does not say that we run the citation questions for you');
    if (/\baccount\b|\blog ?in\b|\bsign ?in\b/i.test(visible.replace('Do I need an account?', '').replace('No. There is no account or login.', ''))) bad(name + ': mentions an account or login');
  });
  if ((page.match(/<h1[\s>]/g) || []).length !== 1) bad('pro.html needs exactly one h1');
  const meta = /<meta name="description" content="([^"]*)"/.exec(page);
  if (!meta || meta[1].length < 120 || meta[1].length > 160) bad('meta description length ' + (meta ? meta[1].length : 'missing'));
  if (page.indexOf('<link rel="canonical" href="' + SITE + '/pro" />') === -1) bad('canonical changed');
  ['og:title', 'og:description'].forEach((p) => { if (!new RegExp('property="' + p + '" content="[^"]+"').test(page)) bad('missing ' + p); });
  ['twitter:title', 'twitter:description'].forEach((p) => { if (!new RegExp('name="' + p + '" content="[^"]+"').test(page)) bad('missing ' + p); });
  (page.match(/<img\b[^>]*>/g) || []).concat(bandHtml.match(/<img\b[^>]*>/g) || []).forEach((t) => { if (!/ alt="/.test(t) || !/ width="/.test(t) || !/ height="/.test(t)) bad('an <img> lacks alt, width or height: ' + t.slice(0, 60)); });
  (page.match(/<figure class="pro-shot[\s\S]*?<\/figure>/g) || []).concat(bandHtml.match(/<figure class="pro-shot[\s\S]*?<\/figure>/g) || []).forEach((f) => {
    if (!/role="img" aria-label="[^"]{40,}"/.test(f)) bad('a crop has no alt text');
    const cap = textOf(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/.exec(f)[1]);
    const site = new RegExp('^Sample: our own site, ' + want.date.replace(/\s/g, '\\s') + '\\.').test(cap);
    const cit = cap === 'Sample from a different brand · ' + want['cit-model'] + ' · ' + want['cit-date'] + ' · ' + WORDS[want.tries] + ' tries per question';
    if (!site && !cit) bad('a crop caption is not one of the two labels: ' + cap);
  });
  [['pro.html', page], ['the band', bandHtml]].forEach(function (s2) {
    const names = (s2[1].match(/<figure class="pro-shot pro-shot--([a-z]+)/g) || []).map((x) => x.replace(/.*--/, ''));
    names.forEach((n, i) => { if (names.indexOf(n) !== i) bad(s2[0] + ': the "' + n + '" crop appears more than once'); });
    const ids = (s2[1].match(/ id="[^"]+"/g) || []);
    ids.forEach((x, i) => { if (ids.indexOf(x) !== i) bad(s2[0] + ': repeated' + x); });
  });
  if (page.indexOf('A real crawl of ' + F.domain + ', <span data-fig="pro-date">' + want.date + '</span>. Nothing edited.') === -1) bad('the gap caption does not carry the crawl and its date');
  return errors;
}

function main() {
  if (process.argv.indexOf('--check') !== -1) {
    const errors = check();
    if (errors.length) { errors.forEach((e) => console.error('FAIL: ' + e)); process.exit(1); }
    console.log('OK: pro.html and the homepage band match their sources; every figure recomputed from the raw files');
    return;
  }
  fs.writeFileSync(PAGE, build(), 'utf8');
  fs.writeFileSync(INDEX, indexHtml(fs.readFileSync(INDEX, 'utf8'), figures()), 'utf8');
  console.log('pro.html written; Pro band in index.html written');
}

if (require.main === module) main();
module.exports = { build, band, figures, check };
