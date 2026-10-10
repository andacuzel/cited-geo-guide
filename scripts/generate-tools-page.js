#!/usr/bin/env node
/* =====================================================================
   scripts/generate-tools-page.js

   Writes tools/index.html from content/tools.json, and the generated blocks on
   each tool page:
     compare.html            the "Next step" block between NEXT:START and NEXT:END
     the other tool pages    TOOL-INTRO (chips and "Try an example", after the banner)
                             and TOOL-MORE (how it works, why it matters, the FAQ from
                             the page's own FAQPage JSON-LD, the Next step block and
                             "Use it from Claude"), plus the kicker, the H1 and the
                             data-toolx hooks that tools/shared.js reads.
   Nothing else on those pages is touched. compare.html is never rewritten beyond
   its Next step block.

   The chips come from the inventory, not from the file: a tool earns
   "Runs in your browser" only if none of its scripts makes a network request,
   and --check reads the scripts to find out. The scan finding wording in the
   "From finding to fix" rows is compared with the scanner's own registry.

     node scripts/generate-tools-page.js           write the page and the Next step blocks
     node scripts/generate-tools-page.js --check   exit 1 if anything is out of date or breaks a rule
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const icons = require('../lib/icons.js');
const shell = require('../lib/page-shell.js');
const site = require('../lib/site-config.js');
const methodology = require('../lib/methodology.js');
const mcp = require('../api/mcp.js');

const CSS_VERSION = 63;
const NEXT_START = '<!-- NEXT:START -->';
const NEXT_END = '<!-- NEXT:END -->';
const PAGE = path.join(ROOT, 'tools', 'index.html');
const esc = shell.esc;
const icon = (name, cls) => icons.svg(name, cls ? { cls: cls } : {});
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CHIPS_ALL = ['No signup', 'Free'];
const CHIP_BROWSER = 'Runs in your browser';
const NETWORK = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|\/api\/|WebSocket|EventSource/;

/* ---------- pieces ---------- */

function banner(d) {
  const order = d.groups.map((g) => d.tools.filter((t) => t.group === g.name)).reduce((a, b) => a.concat(b), []);
  const tiles = order.map((t) => '            <span class="tools-tile">' + icon(t.icon) + '</span>').join('\n');
  return '    <section aria-labelledby="hero-heading">\n      <div class="section__inner">\n        <div class="page-banner tools-banner">\n          <div class="page-banner__body tools-banner__body">\n' +
    '            <p class="kicker kicker--on-navy">Free tools</p>\n            <h1 id="hero-heading" class="page-banner__title">Free tools that fix what AI can’t read.</h1>\n' +
    '            <p class="page-banner__desc">Check a file, generate the fix, compare two sites. No signup.</p>\n' +
    '            <div class="tools-banner__actions">\n              <a href="/#scan" class="btn btn--gold">Scan your site</a>\n              <a href="/mcp" class="tools-banner__link">Use them from Claude</a>\n            </div>\n          </div>\n' +
    '          <div class="tools-tiles" aria-hidden="true">\n' + tiles + '\n          </div>\n        </div>\n      </div>\n    </section>\n';
}

function flow(d) {
  const by = {};
  d.tools.forEach((t) => { by[t.slug] = t; });
  const rows = d.flow.map((r) => {
    const t = by[r.tool];
    return '          <li><a class="card tools-flow__row" href="' + t.url + '">\n            <span class="tools-flow__finding"><span class="tools-flow__label">' + esc(r.label) + '</span><span class="tools-flow__text">' + esc(r.text) + '</span></span>\n            <span class="tools-flow__arrow">' + icon('arrow') + '</span>\n            <span class="tools-flow__tool"><span class="tools-flow__ticon">' + icon(t.icon) + '</span>' + esc(t.name) + '</span>\n          </a></li>';
  }).join('\n');
  return '    <section class="tools-section" aria-labelledby="flow-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">Scan to tool</p>\n          <h2 id="flow-heading" class="section-title">From finding to fix.</h2>\n          <p class="section-sub">Each row is a finding as the scan report words it, and the tool that resolves it.</p>\n        </div>\n        <ul class="tools-flow">\n' + rows + '\n        </ul>\n      </div>\n    </section>\n';
}

const chipTone = (tone) => 'tools-pv__chip tools-pv__chip--' + tone;
function preview(t) {
  const p = t.preview;
  let inner = '';
  if (p.kind === 'field') {
    inner = '<div class="tools-pv__field"><span class="tools-pv__input">' + esc(p.placeholder) + '</span><span class="tools-pv__btn">' + esc(p.button) + '</span></div>\n' +
      '          <div class="tools-pv__chips">' + p.chips.map((c) => '<span class="' + chipTone(c[1]) + '">' + esc(c[0]) + '</span>').join('') + '</div>';
  } else if (p.kind === 'crawlers') {
    inner = p.rows.map((r) => '<div class="tools-pv__row"><span class="tools-pv__name">' + esc(r[0]) + '</span><span class="' + chipTone(r[1][1]) + '">' + esc(r[1][0]) + '</span></div>').join('\n          ');
  } else if (p.kind === 'fields') {
    inner = p.rows.map((r) => '<div class="tools-pv__frow"><span class="tools-pv__flabel">' + esc(r[0]) + '</span><span class="tools-pv__bar tools-pv__bar--' + r[1] + '"></span></div>').join('\n          ') +
      '\n          <div class="tools-pv__chips">' + p.types.map((x, i) => '<span class="tools-pv__type' + (i === 0 ? ' tools-pv__type--on' : '') + '">' + esc(x) + '</span>').join('') + '</div>';
  } else if (p.kind === 'columns') {
    inner = '<div class="tools-pv__cols tools-pv__cols--head"><span></span>' + p.heads.map((h) => '<span class="tools-pv__colhead">' + esc(h) + '</span>').join('') + '</div>\n          ' +
      p.rows.map((r) => '<div class="tools-pv__cols"><span class="tools-pv__name">' + esc(r[0]) + '</span><span class="' + chipTone(r[1][1]) + '">' + esc(r[1][0]) + '</span><span class="' + chipTone(r[2][1]) + '">' + esc(r[2][0]) + '</span></div>').join('\n          ');
  }
  return '        <div class="tools-pv" aria-hidden="true">\n          ' + inner + '\n        </div>\n';
}

function card(t) {
  const btn = t.kind === 'scan' ? 'btn btn--gold' : 'btn btn--primary';
  return '        <article class="card card--static tools-card" id="' + t.slug + '">\n' + preview(t) +
    '          <div class="tools-card__top"><span class="tools-card__icon">' + icon(t.icon) + '</span><span class="tools-card__name">' + esc(t.name) + '</span></div>\n' +
    '          <h3 class="tools-card__headline">' + esc(t.headline) + '</h3>\n          <p class="tools-card__desc">' + esc(t.description) + '</p>\n' +
    '          <dl class="tools-io">\n            <div><dt>You give it</dt><dd>' + esc(t.give) + '</dd></div>\n            <div><dt>You get</dt><dd>' + esc(t.get) + '</dd></div>\n          </dl>\n' +
    '          <ul class="tools-chips">' + t.chips.map((c) => '<li class="tools-chip">' + esc(c) + '</li>').join('') + '</ul>\n' +
    '          <a href="' + t.url + '" class="' + btn + ' tools-card__btn">' + esc(t.button) + '</a>\n        </article>\n';
}

function groups(d) {
  return d.groups.map((g) => {
    const list = d.tools.filter((t) => t.group === g.name);
    if (!list.length) return '';
    const id = 'group-' + g.name.toLowerCase().replace(/[^a-z]+/g, '-');
    return '    <section class="tools-section" id="' + id + '" aria-labelledby="' + id + '-heading">\n      <div class="section__inner">\n        <div class="tools-group__head">\n          <span class="tools-group__icon">' + icon(g.icon) + '</span>\n          <div>\n            <h2 id="' + id + '-heading" class="tools-group__title">' + esc(g.name) + '.</h2>\n            <p class="tools-group__blurb">' + esc(g.blurb) + '</p>\n          </div>\n        </div>\n        <p class="tools-group__caption">Previews are illustrations.</p>\n        <div class="tools-grid">\n' + list.map(card).join('') + '        </div>\n      </div>\n    </section>\n';
  }).join('\n');
}

function mcpCard(d) {
  return '    <section class="tools-section" aria-labelledby="claude-heading">\n      <div class="section__inner">\n        <div class="card card--static tools-claude">\n          <span class="tools-claude__icon">' + icon('plug') + '</span>\n          <div class="tools-claude__body">\n            <h2 id="claude-heading" class="tools-claude__title">Use them from Claude</h2>\n            <p class="tools-claude__text">' + esc(d.mcpCard.line) + '</p>\n          </div>\n          <a href="/mcp" class="btn btn--ghost tools-claude__btn">' + esc(d.mcpCard.button) + '</a>\n        </div>\n      </div>\n    </section>\n';
}

function faqEntries() {
  return [
    ['Are the tools free?', 'Yes. Every tool on this page is free and works without an account.'],
    ['Do I need an account?', 'No. There are no accounts and no email collection. Open a tool and use it.'],
    ['What do the tools store?', 'Nothing about what you enter. The robots.txt generator runs in your browser and sends nothing. The llms.txt checker, the schema generator and the comparison send the domain you type to our server, which reads public files from that domain and returns the result without keeping it. To enforce a rate limit, the server keeps a one-way hash of your IP address with a request counter, which expires within a day. The privacy policy has the detail.'],
    ['How are they different from the free scan?', 'The scan reads a site and scores it, so it finds what is missing. The tools act on one finding at a time: check a file, generate the fix, compare two sites. Scan first, then open the tool that fits the finding.'],
    ['Do the tools say whether AI names my brand?', 'No. They measure readiness: whether crawlers can reach a site and whether its files and markup give a model something to read. None of them can show whether an assistant names you in an answer.']
  ];
}

function faq() {
  const items = faqEntries().map((q, i) => '          <details>\n            <summary>' + esc(q[0]) + '</summary>\n            <p>' + esc(q[1]).replace('The privacy policy has the detail.', 'The <a href="/privacy">privacy policy</a> has the detail.') + '</p>\n          </details>').join('\n');
  return '    <section class="ac-section" aria-labelledby="faq-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">Questions</p>\n          <h2 id="faq-heading" class="section-title">The tools, briefly.</h2>\n        </div>\n        <div class="ac-faq">\n' + items + '\n        </div>\n      </div>\n    </section>\n';
}

function closing() {
  return '    <section aria-label="Scan reminder">\n      <div class="section__inner">\n        <div class="scan-bridge">\n          <h2 class="scan-bridge__text">Not sure which tool you need? Scan your site first.</h2>\n          <a href="/#scan" class="btn btn--primary">Scan your site free</a>\n        </div>\n      </div>\n    </section>\n';
}

function meta() {
  return {
    title: 'Citehound — Free AI Readiness Tools',
    description: 'Free tools for AI readiness: check your llms.txt, generate a robots.txt or JSON-LD, and compare two sites. No signup, no email, no accounts.'
  };
}

function jsonld(d) {
  const items = d.tools.map((t) => ({ name: t.name, url: t.url })).concat([{ name: 'MCP Server', url: '/mcp' }]);
  return [{
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Free AI Readiness Tools',
    description: 'Free tools for AI readiness: check an llms.txt, generate a robots.txt or JSON-LD, compare two sites.',
    url: site.baseUrl + '/tools',
    mainEntity: { '@type': 'ItemList', itemListElement: items.map((x, i) => ({ '@type': 'ListItem', position: i + 1, name: x.name, url: site.baseUrl + x.url.replace('/#scan', '/') })) }
  }, {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqEntries().map((q) => ({ '@type': 'Question', name: q[0], acceptedAnswer: { '@type': 'Answer', text: q[1] } }))
  }];
}

function build(d) {
  const m = meta();
  const body = banner(d) + '\n' + flow(d) + '\n' + groups(d) + '\n' + mcpCard(d) + '\n' + faq() + '\n' + closing();
  return shell.page({ title: m.title, description: m.description, path: '/tools', cssVersion: CSS_VERSION, jsonld: jsonld(d), body: body, depth: 1 });
}

/* ---------- Next step blocks ---------- */

function nextBlock(d, slug) {
  const n = d.next[slug];
  let text = esc(n.text);
  Object.keys(n.links).forEach((k) => { text = text.replace('{' + k + '}', '<a href="' + n.links[k][0] + '">' + esc(n.links[k][1]) + '</a>'); });
  return '    ' + NEXT_START + '\n    <section class="tools-next" aria-labelledby="next-heading">\n      <div class="section__inner">\n        <div class="tools-next__panel">\n          <h2 id="next-heading" class="tools-next__title">Next step</h2>\n          <p class="tools-next__text">' + text + '</p>\n        </div>\n      </div>\n    </section>\n    ' + NEXT_END + '\n';
}

// Where the block goes when the page has none yet.
const ANCHOR = { compare: '    <footer class="site-footer"', default: '    <section aria-label="Scan reminder">' };

function withNext(d, t, html) {
  const block = nextBlock(d, t.slug);
  const re = new RegExp('[ \\t]*' + NEXT_START + '[\\s\\S]*?' + NEXT_END + '\\n');
  if (re.test(html)) return html.replace(re, () => block);
  const anchor = ANCHOR[t.slug] || ANCHOR.default;
  const i = html.indexOf(anchor);
  if (i === -1) throw new Error(t.file + ': no place for the Next step block');
  return html.slice(0, i) + block + '\n' + html.slice(i);
}

/* ---------- checks, each from the files, not from the content ---------- */

const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const norm = (s) => s.replace(/\s+/g, ' ').trim();

function resolves(href) {
  if (/^(mailto:|https?:|#)/.test(href)) return true;
  const p = href.split('#')[0].split('?')[0];
  if (p === '' || p === '/') return fs.existsSync(path.join(ROOT, 'index.html'));
  const rel = p.replace(/^\//, '');
  return [rel, rel + '.html', path.join(rel, 'index.html')].some((c) => fs.existsSync(path.join(ROOT, c)) && fs.statSync(path.join(ROOT, c)).isFile());
}

function inventory(d) {
  const bad = [];
  const listed = {};
  d.tools.forEach((t) => { listed[t.file] = true; if (!fs.existsSync(path.join(ROOT, t.file))) bad.push('the listed page ' + t.file + ' does not exist'); });
  const found = fs.readdirSync(path.join(ROOT, 'tools')).filter((f) => /\.html$/.test(f) && f !== 'index.html').map((f) => 'tools/' + f).concat(['compare.html']);
  found.forEach((f) => { if (!listed[f]) bad.push(f + ' is not listed in content/tools.json'); });
  d.tools.forEach((t) => {
    const net = t.inventory.scripts.some((s) => NETWORK.test(read(s)));
    const hasChip = t.chips.indexOf(CHIP_BROWSER) !== -1;
    if (hasChip && net) bad.push(t.slug + ' has the chip "' + CHIP_BROWSER + '" but its scripts make a network request');
    if (!hasChip && !net) bad.push(t.slug + ' makes no network request, so it should carry the chip "' + CHIP_BROWSER + '"');
    if ((t.inventory.network.length > 0) !== net) bad.push(t.slug + ': the inventory’s network list disagrees with its scripts');
    CHIPS_ALL.forEach((c) => { if (t.chips.indexOf(c) === -1) bad.push(t.slug + ' lacks the chip "' + c + '"'); });
    t.chips.forEach((c) => { if (CHIPS_ALL.concat([CHIP_BROWSER]).indexOf(c) === -1) bad.push(t.slug + ' has an unknown chip "' + c + '"'); });
    if (t.slug !== 'scan') {
      const page = read(t.file);
      t.inventory.scripts.forEach((s) => { if (!fs.existsSync(path.join(ROOT, s))) bad.push(t.slug + ' lists a script that does not exist: ' + s); });
      if (!/<h1\b/.test(page)) bad.push(t.file + ' has no h1');
    }
  });
  if (NETWORK.test(read('nav.js'))) bad.push('nav.js makes a network request; the chips would not cover it');
  return bad;
}

function verify(html, d) {
  const bad = inventory(d);
  const fail = (m) => bad.push(m);
  const noScripts = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const body = noScripts.slice(noScripts.indexOf('<body'));
  const text = decode(body.replace(/<svg[\s\S]*?<\/svg>/g, ''));
  let m;

  // headings
  const h1 = body.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g) || [];
  if (h1.length !== 1) fail('tools/index.html has ' + h1.length + ' h1 elements');
  else if (/\d/.test(decode(h1[0]))) fail('the h1 contains a digit');
  d.tools.forEach((t) => { if (/\d/.test(t.headline)) fail('the headline of ' + t.slug + ' contains a digit'); });
  const desc = /<meta name="description" content="([^"]*)"/.exec(html);
  if (!desc || desc[1].length < 120 || desc[1].length > 160) fail('meta description is ' + (desc ? desc[1].length : 'missing') + ' characters, expected 120 to 160');

  // cards, one per tool, in the page
  d.tools.forEach((t) => { if (html.indexOf('id="' + t.slug + '"') === -1) fail(t.slug + ' has no card on the page'); });
  if ((html.match(/<article class="card card--static tools-card"/g) || []).length !== d.tools.length) fail('the number of cards differs from content/tools.json');
  (html.match(/<div class="tools-pv"[^>]*>[\s\S]*?<\/div>\n/g) || []).forEach((p) => { if (!/aria-hidden="true"/.test(p)) fail('a preview is not aria-hidden'); });
  const previews = html.split('<div class="tools-pv" aria-hidden="true">').length - 1;
  if (previews !== d.tools.length) fail(previews + ' previews, expected ' + d.tools.length);
  html.split('<div class="tools-pv" aria-hidden="true">').slice(1).forEach((chunk) => { const pv = chunk.slice(0, chunk.indexOf('tools-card__top')); if (/\d/.test(decode(pv))) fail('a preview contains a digit'); });
  if ((html.match(/Previews are illustrations\./g) || []).length !== d.groups.length) fail('every group needs the caption "Previews are illustrations."');
  if (/<details[^>]*\bopen\b/.test(html)) fail('a <details> is open by default');

  // the scan wording of the rows equals the scanner's registry
  const reg = methodology.registry();
  d.flow.forEach((r) => {
    if (!d.tools.some((t) => t.slug === r.tool)) fail('a row points at the unknown tool ' + r.tool);
    if (r.advice) {
      const c = reg.filter((x) => x.label === r.label)[0];
      if (!c) fail('"' + r.label + '" is not a check in the scanner');
      else if (c.advice !== r.text) fail('the row for "' + r.label + '" says "' + r.text + '"; the scanner says "' + c.advice + '"');
    }
  });
  if (d.flow.length !== 4) fail('expected four finding rows');

  // JSON-LD
  const lds = (html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || []).map((s) => { try { return JSON.parse(s.replace(/<\/?script[^>]*>/g, '')); } catch (e) { fail('a JSON-LD block does not parse'); return null; } }).filter(Boolean);
  const nodes = [].concat.apply([], lds.map((o) => o['@graph'] || [o]));
  const types = nodes.map((n) => n['@type']);
  ['CollectionPage', 'FAQPage', 'Organization', 'WebSite'].forEach((t) => { if (types.indexOf(t) === -1) fail('JSON-LD has no ' + t); });
  const coll = nodes.filter((n) => n['@type'] === 'CollectionPage')[0];
  if (coll) {
    const list = coll.mainEntity && coll.mainEntity.itemListElement;
    if (!list || list.length !== d.tools.length + 1) fail('the ItemList does not match the tools on the page');
  }
  const ld = nodes.filter((n) => n['@type'] === 'FAQPage')[0];
  const visible = [];
  const re = /<details>\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/g;
  while ((m = re.exec(html))) visible.push([decode(m[1]), decode(m[2])]);
  if (ld && JSON.stringify(ld.mainEntity.map((x) => [x.name, x.acceptedAnswer.text])) !== JSON.stringify(visible)) fail('the FAQPage JSON-LD does not match the visible FAQ');
  if (visible.length !== 5) fail('the FAQ has ' + visible.length + ' questions, expected 5');

  // grep rules
  if (/gradient\(/i.test(html)) fail('a gradient appears');
  if (/\p{Extended_Pictographic}/u.test(html.replace(/[©®™]/g, ''))) fail('an emoji appears');
  if (/\$\s?\d|\bper month\b|\bpricing\b|\/mo\b|\bfree trial\b|\bpremium\b/i.test(text)) fail('a price appears');
  if (/\b(listed (in|on)|verified by|approved by|certified|certification|official directory|marketplace|trusted by|testimonials?|customers|users love)\b/i.test(text)) fail('a directory, certification, trust or testimonial claim appears');
  if (/\b\d[\d,]*\s+(scans|sites|users|people|domains|brands|visits)\b/i.test(text)) fail('a usage counter appears');
  if (/\b(quietly|actually|seamlessly|effortless|powerful|unlock|elevate|supercharge|game-changing|revolutionize|landscape|delve|crucial|robust|recommended|coming soon)\b/i.test(text)) fail('a banned word appears');
  if (/not just [^.]*, but /i.test(text)) fail('the banned construction "not just X, but Y" appears');
  (body.match(/<(p|li|summary)\b[^>]*>[\s\S]*?<\/\1>/g) || []).forEach((p) => { if ((decode(p).match(/—/g) || []).length > 1) fail('more than one em dash in: ' + decode(p).slice(0, 60)); });

  // links
  const hrefs = [];
  const all = [html].concat(d.tools.filter((t) => t.slug !== 'scan').map((t) => nextRegion(read(t.file)) || ''));
  all.forEach((h) => { const r = /<a [^>]*href="([^"]*)"/g; let x; while ((x = r.exec(h.replace(/<script[\s\S]*?<\/script>/g, '')))) hrefs.push(x[1]); });
  hrefs.forEach((h) => { if (!resolves(h)) fail('a link does not resolve: ' + h); });
  if (/\s(class="[^"]*btn[^"]*"[^>]*style="[^"]*underline)/.test(html)) fail('a button is underlined');

  // chrome identical to about.html
  const about = read('about.html');
  const chrome = (h, re) => norm((h.match(re) || [''])[0]);
  const H = /<header class="site-header">[\s\S]*?<\/header>/, F = /<footer class="site-footer"[\s\S]*?<\/footer>/;
  if (chrome(html, H) !== chrome(about, H)) fail('the header differs from about.html');
  if (chrome(html, F) !== chrome(about, F)) fail('the footer differs from about.html');
  return bad;
}

function nextRegion(html) {
  const m = new RegExp(NEXT_START + '[\\s\\S]*?' + NEXT_END).exec(html);
  return m ? m[0] : null;
}


/* ---------- tool pages: kicker, H1, hooks, TOOL-INTRO, TOOL-MORE ---------- */

const regionRe = (name) => new RegExp('[ \\t]*<!-- ' + name + ':START -->[\\s\\S]*?<!-- ' + name + ':END -->\\n');
const subst = (v) => String(v).replace('{host}', site.host).replace('{base}', site.baseUrl);
const polished = (d) => d.tools.filter((t) => t.polish);

function introBlock(t) {
  const chips = '<ul class="tools-chips toolx-chips">' + t.chips.map((c) => '<li class="tools-chip">' + esc(c) + '</li>').join('') + '</ul>';
  const live = t.liveStatus ? '\n        <p class="toolx-live" data-toolx-live role="status" aria-live="polite"></p>' : '';
  const ex = t.example ? '\n          <button type="button" class="btn btn--ghost toolx-example" data-toolx-example="' + esc(subst(t.example.value)) + '" data-toolx-target="' + esc(t.example.target) + '">Try an example</button>' : '';
  return '    <!-- TOOL-INTRO:START -->\n    <section class="toolx-intro" aria-label="About this tool">\n      <div class="section__inner">\n        <div class="toolx-intro__row">\n          ' + chips + ex + '\n        </div>' + live + '\n      </div>\n    </section>\n    <!-- TOOL-INTRO:END -->\n';
}

function claudeLine(t) {
  const names = [];
  const text = esc(t.claude).replace(/\{([a-z_]+)\}/g, (m, n) => { names.push(n); return '<code>' + n + '</code>'; });
  names.forEach((n) => { if (!mcp.TOOLS.some((x) => x.name === n)) throw new Error(t.slug + ': ' + n + ' is not an MCP tool'); });
  return '<p class="toolx-claude__text"><strong>Use it from Claude.</strong> ' + text + ' <a href="/mcp">See the MCP server</a>.</p>';
}

function whyLine(t) {
  if (!t.why || !resolves(t.why.href)) return '';
  const reg = methodology.registry();
  const total = reg.reduce((n, c) => n + c.max, 0);
  const c = t.why.check ? reg.filter((x) => x.label === t.why.check)[0] : null;
  if (t.why.check && !c) throw new Error(t.slug + ': "' + t.why.check + '" is not a check in the scanner');
  const pillar = c ? methodology.PILLARS.filter((p) => p.cat === c.cat)[0].name : '';
  const text = esc(t.why.text).replace('{max}', c ? c.max : '').replace('{total}', total).replace('{pillar}', esc(pillar)).replace('{link}', '<a href="' + t.why.href + '">' + esc(t.why.link) + '</a>');
  return '<p class="toolx-why"><strong>Why it matters.</strong> ' + text + '</p>';
}

function pageFaq(html) {
  const blocks = html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || [];
  for (const b of blocks) {
    const o = JSON.parse(b.replace(/<\/?script[^>]*>/g, ''));
    const nodes = o['@graph'] || [o];
    const f = nodes.filter((n) => n['@type'] === 'FAQPage')[0];
    if (f) return f.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]);
  }
  return [];
}

function moreBlock(d, t, html) {
  const icons3 = ['list', 'wrench', 'document'];
  const steps = [['You give it', t.how.give], ['It does', t.how.does], ['You get', t.how.get]].map((s, i) =>
    '          <li class="card card--static toolx-step"><span class="toolx-step__icon">' + icon(icons3[i]) + '</span><p class="toolx-step__label">' + s[0] + '</p><p class="toolx-step__text">' + esc(s[1]) + '</p></li>').join('\n');
  const faqItems = pageFaq(html).map((q) => '          <details>\n            <summary>' + esc(q[0]) + '</summary>\n            <p>' + esc(q[1]) + '</p>\n          </details>').join('\n');
  const why = whyLine(t);
  return '    <!-- TOOL-MORE:START -->\n    <section class="toolx-section" aria-labelledby="toolx-how-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">How it works</p>\n          <h2 id="toolx-how-heading" class="section-title">Three steps.</h2>\n        </div>\n        <ol class="toolx-steps">\n' + steps + '\n        </ol>\n' + (why ? '        ' + why + '\n' : '') + '      </div>\n    </section>\n\n' +
    '    <section class="ac-section" aria-labelledby="toolx-faq-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">Questions</p>\n          <h2 id="toolx-faq-heading" class="section-title">Common questions.</h2>\n        </div>\n        <div class="ac-faq">\n' + faqItems + '\n        </div>\n      </div>\n    </section>\n\n' +
    nextBlock(d, t.slug) + '\n' +
    '    <section class="toolx-section" aria-label="Use it from Claude">\n      <div class="section__inner">\n        <div class="toolx-claude">\n          ' + claudeLine(t) + '\n        </div>\n      </div>\n    </section>\n    <!-- TOOL-MORE:END -->\n';
}

function ensureAttrs(html, h) {
  const i = html.indexOf(h.find);
  if (i === -1) throw new Error('hook anchor not found: ' + h.find);
  const end = html.indexOf('>', i);
  const tag = html.slice(i, end);
  if (tag.indexOf(h.attrs.split(' ')[0]) !== -1) return html;
  return html.slice(0, i + h.find.length) + ' ' + h.attrs + html.slice(i + h.find.length);
}

function applyPolish(d, t, html) {
  // the old hand-written FAQ, now generated from the page's JSON-LD
  html = html.replace(/\n\n        <div class="doc-section" style="margin-top: \d+px;">\n          <h2 class="doc-section__heading">Common questions<\/h2>[\s\S]*?\n        <\/div>(?=\n      <\/div>\n    <\/section>)/, '');
  // kicker and H1
  html = html.replace(/<p class="kicker kicker--on-navy">[^<]*<\/p>/, '<p class="kicker kicker--on-navy">Free tool · ' + esc(t.group) + '</p>');
  html = html.replace(/<h1 class="page-banner__title">[^<]*<\/h1>/, '<h1 class="page-banner__title">' + esc(t.headline) + '</h1>');
  // hooks and the shared script
  t.hooks.forEach((h) => { html = ensureAttrs(html, h); });
  if (html.indexOf('<script src="shared.js') === -1) {
    const m = new RegExp('( *)<script src="' + t.script.replace('.', '\\.') + '[^"]*"></script>').exec(html);
    if (!m) throw new Error(t.file + ': no page script tag');
    html = html.slice(0, m.index) + m[1] + '<script src="shared.js?v=1"></script>\n' + html.slice(m.index);
  }
  // TOOL-INTRO, after the banner
  const intro = introBlock(t);
  if (regionRe('TOOL-INTRO').test(html)) html = html.replace(regionRe('TOOL-INTRO'), () => intro);
  else {
    const b = html.indexOf('<!-- ---------- Page banner ---------- -->');
    const close = '    </section>\n';
    const at = html.indexOf(close, b) + close.length;
    html = html.slice(0, at) + '\n' + intro + html.slice(at);
  }
  // TOOL-MORE takes the place of the old Next step block
  const more = moreBlock(d, t, html);
  if (regionRe('TOOL-MORE').test(html)) {
    html = html.replace(regionRe('NEXT'), (m) => m); // a stray copy outside the block is caught by --check
    html = html.replace(regionRe('TOOL-MORE'), () => more);
  } else if (regionRe('NEXT').test(html)) {
    html = html.replace(regionRe('NEXT'), () => more);
  } else {
    const anchor = '    <section aria-label="Scan reminder">';
    const i = html.indexOf(anchor);
    if (i === -1) throw new Error(t.file + ': no place for the more block');
    html = html.slice(0, i) + more + '\n' + html.slice(i);
  }
  return html;
}

function checkPolished(d) {
  const bad = [];
  polished(d).forEach((t) => {
    const page = read(t.file);
    const f = (m) => bad.push(t.file + ': ' + m);
    if (page !== applyPolish(d, t, page)) f('the generated blocks, kicker, H1 or hooks are out of date');
    ['TOOL-INTRO', 'TOOL-MORE', 'NEXT'].forEach((n) => {
      const c = page.split('<!-- ' + n + ':START -->').length - 1;
      if (c !== 1) f(n + ' markers appear ' + c + ' times, expected once');
    });
    const more = (regionRe('TOOL-MORE').exec(page) || [''])[0];
    if (more.indexOf('<!-- NEXT:START -->') === -1) f('the Next step block is not inside TOOL-MORE');
    // visible FAQ equals the FAQPage JSON-LD
    const ld = pageFaq(page);
    const vis = [];
    const re = /<details>\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/g;
    let m;
    while ((m = re.exec(page))) vis.push([decode(m[1]), decode(m[2])]);
    if (JSON.stringify(ld) !== JSON.stringify(vis)) f('the visible FAQ does not equal the FAQPage JSON-LD');
    if (!ld.length) f('no FAQPage JSON-LD');
    // headings
    const h1 = page.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g) || [];
    if (h1.length !== 1) f('has ' + h1.length + ' h1 elements');
    else if (/\d/.test(decode(h1[0]))) f('the h1 contains a digit');
    if (decode(h1[0] || '') !== t.headline) f('the h1 is not the benefit headline');
    if (page.indexOf('<p class="kicker kicker--on-navy">Free tool · ' + t.group + '</p>') === -1) f('the kicker is not the group');
    // chips equal the inventory (the check in inventory() reads the scripts); here: the page shows exactly t.chips
    const chipRow = (/<ul class="tools-chips toolx-chips">([\s\S]*?)<\/ul>/.exec(page) || [])[1] || '';
    const shown = (chipRow.match(/<li class="tools-chip">([^<]*)<\/li>/g) || []).map((x) => decode(x));
    if (JSON.stringify(shown) !== JSON.stringify(t.chips)) f('the chips differ from content/tools.json');
    // hooks, script order, example target
    t.hooks.forEach((h) => { const i = page.indexOf(h.find); if (i === -1 || page.slice(i, page.indexOf('>', i)).indexOf(h.attrs.split(' ')[0]) === -1) f('hook missing: ' + h.attrs); });
    const si = page.indexOf('<script src="shared.js'), pi = page.indexOf('<script src="' + t.script);
    if (si === -1 || pi === -1 || si > pi) f('shared.js must load before ' + t.script);
    if (t.example && page.indexOf('id="' + t.example.target.slice(1) + '"') === -1) f('the example target ' + t.example.target + ' is not on the page');
    // generated text: no gradient, emoji, price, directory claim, banned word
    const gen = decode((regionRe('TOOL-INTRO').exec(page) || [''])[0] + more + (/<h1[\s\S]*?<\/h1>/.exec(page) || [''])[0]);
    if (/gradient\(/i.test(page)) f('a gradient appears');
    if (/\p{Extended_Pictographic}/u.test(page.replace(/[©®™]/g, ''))) f('an emoji appears');
    if (/\$\s?\d|\bper month\b|\/mo\b|\bfree trial\b|\bpremium\b|\b(costs?|only) \d/i.test(gen)) f('a price appears');
    if (/\b(listed (in|on)|verified by|approved by|certified|certification|official directory|marketplace|trusted by|testimonials?|customers)\b/i.test(gen)) f('a directory, certification or testimonial claim appears');
    if (/\b(quietly|actually|seamlessly|effortless|powerful|unlock|elevate|supercharge|game-changing|revolutionize|landscape|delve|crucial|robust|recommended|coming soon)\b/i.test(gen)) f('a banned word appears');
    // JSON-LD parses, links resolve, chrome identical
    (page.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []).forEach((b) => { try { JSON.parse(b.replace(/<\/?script[^>]*>/g, '')); } catch (e) { f('a JSON-LD block does not parse'); } });
    const r = /<a [^>]*href="([^"]*)"/g;
    while ((m = r.exec(page.replace(/<script[\s\S]*?<\/script>/g, '')))) if (!resolves(m[1])) f('a link does not resolve: ' + m[1]);
    const about = read('about.html');
    const chrome = (h, re2) => norm((h.match(re2) || [''])[0]);
    const H = /<header class="site-header">[\s\S]*?<\/header>/, F = /<footer class="site-footer"[\s\S]*?<\/footer>/;
    if (chrome(page, H) !== chrome(about, H)) f('the header differs from about.html');
    if (chrome(page, F) !== chrome(about, F)) f('the footer differs from about.html');
    // syntax of the page's scripts
    [t.file.replace(/[^/]*$/, '') + t.script, 'tools/shared.js'].forEach((js) => {
      const r2 = require('child_process').spawnSync(process.execPath, ['--check', path.join(ROOT, js)]);
      if (r2.status !== 0) f('node --check fails for ' + js);
    });
  });
  return bad;
}

function checkNext(d) {
  const bad = [];
  d.tools.filter((t) => t.slug !== 'scan' && !t.polish).forEach((t) => {
    const page = read(t.file);
    const starts = page.split(NEXT_START).length - 1;
    const ends = page.split(NEXT_END).length - 1;
    if (starts !== 1 || ends !== 1) { bad.push(t.file + ' needs exactly one Next step block'); return; }
    if (page !== withNext(d, t, page)) bad.push(t.file + ': the Next step block is out of date');
    if ((page.match(/id="next-heading"/g) || []).length !== 1) bad.push(t.file + ' has a duplicate next-heading id');
  });
  return bad;
}

function main() {
  const d = readJson('content/tools.json');
  const html = build(d);
  const check = process.argv.indexOf('--check') !== -1;
  if (check) {
    const onDisk = fs.existsSync(PAGE) ? fs.readFileSync(PAGE, 'utf8') : '';
    const bad = verify(onDisk, d).concat(checkNext(d), checkPolished(d));
    if (onDisk !== html) bad.unshift('tools/index.html is out of date; run node scripts/generate-tools-page.js');
    if (bad.length) { bad.forEach((x) => console.error('FAIL: ' + x)); process.exit(1); }
    console.log('OK: tools/index.html matches content/tools.json (' + d.tools.length + ' tools); every page is listed, chips match the inventory, Next step blocks are current');
    return;
  }
  d.tools.filter((t) => t.slug !== 'scan').forEach((t) => {
    const file = path.join(ROOT, t.file);
    const cur = fs.readFileSync(file, 'utf8');
    const next = t.polish ? applyPolish(d, t, cur) : withNext(d, t, cur);
    if (next !== cur) fs.writeFileSync(file, next, 'utf8');
  });
  const bad = verify(html, d).concat(checkNext(d), checkPolished(d));
  if (bad.length) { bad.forEach((x) => console.error('FAIL: ' + x)); process.exit(1); }
  fs.writeFileSync(PAGE, html, 'utf8');
  console.log('tools/index.html written; ' + polished(d).length + ' tool pages polished, ' + (d.tools.length - 1 - polished(d).length) + ' with only a Next step block');
}

if (require.main === module) main();
module.exports = { build: build, verify: verify };
