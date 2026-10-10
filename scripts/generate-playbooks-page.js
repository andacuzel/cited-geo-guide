#!/usr/bin/env node
/* =====================================================================
   scripts/generate-playbooks-page.js

   Writes playbooks.html (served at /playbooks): one card per playbook,
   in three groups, each card linking straight to that playbook by hash
   (for-saas#crm, for-brands#ecommerce, for-professionals#realestate…).

   Nothing on the page is typed by hand:
     - which playbooks exist, and their names, come from lib/playbooks.js
     - the one-line descriptions and card codes come from the field lists
       in app.js (read, never modified), so a card here matches its card
       on the track page
     - icons come from lib/icons.js

   It also keeps the site chrome in step, idempotently:
     - the Playbooks dropdown in every page header becomes a plain link
       to /playbooks (desktop and mobile strip)
     - a Playbooks link in every footer
     - /playbooks in sitemap.xml

     node scripts/generate-playbooks-page.js           write everything
     node scripts/generate-playbooks-page.js --check   verify, write nothing
   ===================================================================== */

'use strict';

const siteChrome = require('./site-chrome.js');

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = require('../lib/site-config.js').baseUrl;
const CSS_VERSION = 61; // bump when styles.css changes
const PLAYBOOKS = require('../lib/playbooks.js');
const ICONS = require('../lib/icons.js');

const TRACKS = [
  { key: 'saasData', page: 'for-saas', fieldsVar: 'subFields', title: 'B2B SaaS', sub: 'Software companies competing for AI shortlists.' },
  { key: 'brandData', page: 'for-brands', fieldsVar: 'brandFields', title: 'Consumer & e-commerce brands', sub: 'Products people ask AI about before buying.' },
  { key: 'professionalData', page: 'for-professionals', fieldsVar: 'professionalFields', title: 'Local & independent professionals', sub: 'Practices and services people find through AI.' }
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------------------------------------------------------------------
   Card text from app.js
   --------------------------------------------------------------------- */

function unescapeJs(s) {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\'/g, '\'');
}

function fieldsFromApp() {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const out = {};
  TRACKS.forEach(function (t) {
    const start = src.indexOf('var ' + t.fieldsVar + ' = [');
    if (start === -1) throw new Error('app.js has no ' + t.fieldsVar);
    const end = src.indexOf('];', start);
    const block = src.slice(start, end);
    const re = /id:\s*'([^']+)',\s*name:\s*'((?:[^'\\]|\\.)*)',\s*code:\s*'([^']+)',\s*description:\s*'((?:[^'\\]|\\.)*)'/g;
    const list = [];
    let m;
    while ((m = re.exec(block)) !== null) list.push({ id: m[1], name: unescapeJs(m[2]), code: m[3], description: unescapeJs(m[4]) });
    out[t.key] = list;
  });
  return out;
}

function model() {
  const fields = fieldsFromApp();
  return TRACKS.map(function (t) {
    const data = PLAYBOOKS[t.key];
    const cards = fields[t.key].map(function (f) {
      if (!Object.prototype.hasOwnProperty.call(data, f.id)) throw new Error(t.page + ': app.js lists "' + f.id + '" but lib/playbooks.js has no such playbook');
      // The card name is the one on the track page's own card (app.js); a playbook's title can be longer or shorter.
      return { id: f.id, name: f.name, title: data[f.id].name, code: f.code, description: f.description, href: '/' + t.page + '#' + f.id };
    });
    Object.keys(data).forEach(function (id) {
      if (!cards.some((c) => c.id === id)) throw new Error(t.page + ': lib/playbooks.js has "' + id + '" but app.js lists no card for it');
    });
    return { track: t, cards: cards };
  });
}

/* ---------------------------------------------------------------------
   Site chrome shared by every page: nav, footer, sitemap
   --------------------------------------------------------------------- */

function htmlFiles() {
  const out = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      if (['node_modules', '.git', 'local', '.claude', 'asset', 'data', 'supabase'].indexOf(e.name) !== -1) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) out.push(path.relative(ROOT, p));
    });
  }(ROOT));
  return out.sort();
}

const DROPDOWN_RE = /([ \t]*)<div class="nav-dropdown">[\s\S]*?<\/div>\s*<\/div>\s*\n/;
const MOBILE_TRACKS_RE = /([ \t]*)<a href="\/for-saas" class="site-nav__link">B2B SaaS<\/a>\n[ \t]*<a href="\/for-brands" class="site-nav__link">Brands<\/a>\n[ \t]*<a href="\/for-professionals" class="site-nav__link">Professionals<\/a>\n/;
const NAV_LINK = '<a href="/playbooks" class="site-nav__link">Playbooks</a>';

function ensureChrome() {
  const changed = [];
  htmlFiles().forEach(function (rel) {
    const file = path.join(ROOT, rel);
    let s = fs.readFileSync(file, 'utf8');
    const before = s;
    if (DROPDOWN_RE.test(s)) s = s.replace(DROPDOWN_RE, function (m, ind) { return ind + NAV_LINK + '\n'; });
    if (MOBILE_TRACKS_RE.test(s)) s = s.replace(MOBILE_TRACKS_RE, function (m, ind) { return ind + NAV_LINK + '\n'; });
    if (s.indexOf('<a href="/playbooks" class="site-nav__link">Playbooks</a>\n          <a href="/methodology"') === -1 && !/footer-links[\s\S]*?href="\/playbooks"/.test(s)) {
      s = s.replace(/\n([ \t]*)<a href="\/methodology" class="site-nav__link">Methodology<\/a>/, function (m, ind) {
        return '\n' + ind + NAV_LINK + '\n' + ind + '<a href="/methodology" class="site-nav__link">Methodology</a>';
      });
    }
    if (s !== before) { fs.writeFileSync(file, s, 'utf8'); changed.push(rel); }
  });
  return changed;
}

function ensureSitemap() {
  const file = path.join(ROOT, 'sitemap.xml');
  let xml = fs.readFileSync(file, 'utf8');
  const loc = SITE + '/playbooks';
  if (xml.indexOf('<loc>' + loc + '</loc>') !== -1) return false;
  xml = xml.replace('</urlset>', '  <url>\n    <loc>' + loc + '</loc>\n  </url>\n</urlset>');
  fs.writeFileSync(file, xml, 'utf8');
  return true;
}

/* ---------------------------------------------------------------------
   The page
   --------------------------------------------------------------------- */

const TITLE = 'Citehound — GEO and AEO Playbooks for 14 Categories';
const DESCRIPTION = 'Fourteen GEO and AEO playbooks for B2B SaaS, consumer and e-commerce brands and local professionals. Pick your category and read the playbook for it.';
const BANNER_DESC = 'One playbook per category: what has changed in how buyers ask AI, three strategies to act on, and the outdated habits to drop.';

function shellParts() {
  // Head extras, header, footer and scripts are taken from about.html so this page cannot drift from it.
  const about = fs.readFileSync(path.join(ROOT, 'about.html'), 'utf8');
  const grab = (re, what) => { const m = about.match(re); if (!m) throw new Error('about.html: could not find ' + what); return m[0]; };
  return {
    favicon: grab(/<link rel="icon"[^>]*>/, 'favicon'),
    fonts: grab(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com" \/>[\s\S]*?rel="stylesheet" \/>/, 'font links'),
    header: grab(/<header class="site-header">[\s\S]*?<\/header>/, 'header'),
    footerNav: grab(/<nav class="site-nav footer-links"[\s\S]*?<\/nav>/, 'footer nav')
  };
}

function card(c, trackTitle) {
  return '            <a href="' + c.href + '" class="card">\n' +
    '              <div class="card__top">\n' +
    '                <span class="card__code">' + esc(c.code) + '</span>\n' +
    '                <span class="card__badge card__badge--live">Live</span>\n' +
    '              </div>\n' +
    '              <span class="card__icon">' + ICONS.svg(c.id) + '</span>\n' +
    '              <span class="pb-card__track">' + esc(trackTitle) + '</span>\n' +
    '              <span class="card__name">' + esc(c.name) + '</span>\n' +
    '              <span class="card__desc">' + esc(c.description) + '</span>\n' +
    '              <span class="card__cta">Read the playbook\n' +
    '                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>\n' +
    '              </span>\n' +
    '            </a>\n';
}

function build() {
  const groups = model();
  const shell = shellParts();
  const total = groups.reduce((n, g) => n + g.cards.length, 0);
  if (DESCRIPTION.length < 120 || DESCRIPTION.length > 160) throw new Error('description is ' + DESCRIPTION.length + ' characters, expected 120 to 160');

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'GEO and AEO playbooks',
    description: DESCRIPTION,
    url: SITE + '/playbooks',
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: total,
      itemListElement: []
    }
  };
  let pos = 0;
  groups.forEach(function (g) {
    g.cards.forEach(function (c) {
      pos++;
      ld.mainEntity.itemListElement.push({ '@type': 'ListItem', position: pos, name: c.name + ' playbook', url: SITE + c.href });
    });
  });

  const sections = groups.map(function (g, i) {
    return '      <section class="pb-group" aria-labelledby="pb-' + g.track.page + '">\n' +
      '        <div class="section__inner">\n' +
      '          <div class="pb-group__head">\n' +
      '            <h2 id="pb-' + g.track.page + '" class="pb-group__title"><a href="/' + g.track.page + '">' + esc(g.track.title) + '</a></h2>\n' +
      '            <p class="pb-group__sub">' + esc(g.track.sub) + ' ' + g.cards.length + ' playbooks.</p>\n' +
      '          </div>\n' +
      '          <div class="card-grid">\n' + g.cards.map(function (c) { return card(c, g.track.title); }).join('\n') + '          </div>\n' +
      '        </div>\n' +
      '      </section>\n';
  }).join('\n');

  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n\n' +
    '  <title>' + esc(TITLE) + '</title>\n' +
    '  <meta name="description" content="' + esc(DESCRIPTION) + '" />\n' +
    '  <meta name="keywords" content="GEO playbooks, AEO playbooks, AI visibility, answer engine optimization, generative engine optimization" />\n' +
    '  <meta name="author" content="Citehound" />\n  <meta name="robots" content="index, follow" />\n' +
    '  <link rel="canonical" href="' + SITE + '/playbooks" />\n\n' +
    '  <!-- Open Graph -->\n  <meta property="og:type" content="website" />\n' +
    '  <meta property="og:title" content="' + esc(TITLE) + '" />\n' +
    '  <meta property="og:description" content="' + esc(DESCRIPTION) + '" />\n' +
    '  <meta property="og:url" content="' + SITE + '/playbooks" />\n' +
    '  <meta property="og:image" content="' + SITE + '/assets/brand/og-default.png" />\n  <meta property="og:site_name" content="Citehound" />\n\n' +
    '  <!-- Twitter -->\n  <meta name="twitter:card" content="summary_large_image" />\n' +
    '  <meta name="twitter:title" content="' + esc(TITLE) + '" />\n' +
    '  <meta name="twitter:description" content="' + esc(DESCRIPTION) + '" />\n' +
    '  <meta name="twitter:image" content="' + SITE + '/assets/brand/og-default.png" />\n\n' +
    '  ' + shell.favicon + '\n\n  ' + shell.fonts + '\n\n' +
    '  <link rel="stylesheet" href="styles.css?v=' + CSS_VERSION + '" />\n\n' +
    '  <script type="application/ld+json">\n' + JSON.stringify(ld, null, 2).replace(/^/gm, '  ') + '\n  </script>\n' + siteChrome.schemaBlock().replace(/^/gm, '  ') + '\n</head>\n<body>\n\n' +
    '  <a class="skip-link" href="#main">Skip to content</a>\n\n  ' + shell.header + '\n\n' +
    '  <main id="main">\n\n' +
    '    <section aria-label="Page header">\n      <div class="section__inner">\n        <div class="page-banner">\n' +
    '          <div class="page-banner__body">\n            <p class="kicker kicker--on-navy">Playbooks</p>\n' +
    '            <h1 class="page-banner__title">Fourteen playbooks. One for your category.</h1>\n' +
    '            <p class="page-banner__desc">' + esc(BANNER_DESC) + '</p>\n          </div>\n' +
    '          <span class="page-banner__icon" aria-hidden="true">' + ICONS.svg('layers') + '</span>\n' +
    '        </div>\n      </div>\n    </section>\n\n' +
    '    <section class="pb-intro" aria-label="About the playbooks">\n      <div class="section__inner">\n' +
    '        <p class="pb-intro__text">A playbook is a short guide for one category. It explains what has changed in how buyers research with AI, gives three strategies to act on, lists the outdated habits to drop, and names the scan checks that apply. Each one can be saved as a PDF.</p>\n' +
    '        <p class="pb-intro__quiet">First step, if you have not done it: <a href="/">run the free scan</a>. The playbooks refer to its checks by name.</p>\n' +
    '      </div>\n    </section>\n\n' +
    '    <div class="verticals">\n' + sections + '    </div>\n\n' +
    '    <section aria-label="Scan reminder">\n      <div class="section__inner">\n        <div class="scan-bridge">\n' +
    '          <p class="scan-bridge__text">Not sure which playbook fits?</p>\n          <a href="/" class="btn btn--primary">Scan your site free</a>\n        </div>\n      </div>\n    </section>\n\n' +
    '    <footer class="site-footer" aria-label="Footer">\n      <div class="section__inner">\n        ' + shell.footerNav.replace(/\n/g, '\n        ') + '\n' +
    '        <p class="site-footer__coda">© 2026 Citehound. Built for teams navigating the shift from search to answers.</p>\n      </div>\n    </footer>\n\n' +
    '  </main>\n\n  <div class="toast" id="toast" role="status" aria-live="polite"></div>\n\n  <script src="nav.js?v=3"></script>\n</body>\n</html>\n';
}

/* ---------------------------------------------------------------------
   --check
   --------------------------------------------------------------------- */

function check() {
  const problems = [];
  const bad = (m) => problems.push(m);
  const groups = model();
  const html = fs.readFileSync(path.join(ROOT, 'playbooks.html'), 'utf8');

  // Page is current with the content.
  if (html !== build()) bad('playbooks.html is out of date with its sources; run the generator');

  // 14 links, each pointing at a playbook that exists on the right track page.
  const hrefs = (html.match(/<a href="\/for-[a-z]+#[a-z]+" class="card">/g) || []).map((t) => t.match(/href="([^"]+)"/)[1]);
  const total = groups.reduce((n, g) => n + g.cards.length, 0);
  if (hrefs.length !== 14 || total !== 14) bad('expected 14 playbook links, found ' + hrefs.length + ' (content has ' + total + ')');
  groups.forEach((g) => g.cards.forEach((c) => {
    if (hrefs.indexOf(c.href) === -1) bad('missing link ' + c.href);
    if (!Object.prototype.hasOwnProperty.call(PLAYBOOKS[g.track.key], c.id)) bad(c.href + ' has no playbook');
    const track = fs.readFileSync(path.join(ROOT, g.track.page + '.html'), 'utf8');
    if (track.indexOf('lib/playbooks.js') === -1 || track.indexOf('app.js') === -1) bad(g.track.page + ' does not load the playbook scripts');
  }));

  // Header and footer markup identical on every page that has one; footer link present.
  const heads = {};
  const tails = {};
  htmlFiles().forEach(function (rel) {
    const s = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const a = s.match(/<nav class="site-nav" aria-label="Site navigation">[\s\S]*?<\/nav>/);
    const b = s.match(/<nav class="mobile-nav"[\s\S]*?<\/nav>/);
    if (!a || !b) return;
    const k = (a[0] + b[0]).replace(/\s+/g, ' ');
    (heads[k] = heads[k] || []).push(rel);
    if (a[0].indexOf('nav-dropdown') !== -1) bad(rel + ': header still has the dropdown');
    const label = (nav) => (nav.match(/<a [^>]*>[^<]*<\/a>/g) || []).map((t) => t.replace(/<[^>]+>/g, '').trim());
    const dl = label(a[0]); const ml = label(b[0]);
    if (dl.join('|') !== ml.join('|').replace('B2B SaaS|Brands|Professionals|', '')) bad(rel + ': desktop and mobile nav labels differ: ' + dl.join(', ') + ' / ' + ml.join(', '));
    if (!/footer-links[\s\S]*?href="\/playbooks"/.test(s)) bad(rel + ': footer has no Playbooks link');
  });
  if (Object.keys(heads).length > 1) bad('header markup is not identical on every page (' + Object.keys(heads).length + ' variants)');

  const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  if (sm.indexOf('<loc>' + SITE + '/playbooks</loc>') === -1) bad('sitemap.xml has no /playbooks');

  // JSON-LD parses; one h1; description length.
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  try { JSON.parse(ld[1]); } catch (e) { bad('JSON-LD does not parse'); }
  if ((html.match(/<h1[\s>]/g) || []).length !== 1) bad('playbooks.html must have exactly one h1');
  const d = html.match(/<meta name="description" content="([^"]*)"/)[1].replace(/&amp;/g, '&');
  if (d.length < 120 || d.length > 160) bad('description is ' + d.length + ' characters');

  if (problems.length) {
    console.error('FAIL (' + problems.length + '):\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log('OK: 14 playbook links resolve to existing playbooks, header markup identical on ' + Object.keys(heads).map((k) => heads[k].length).join('+') + ' pages, footer link everywhere, sitemap, JSON-LD.');
}

function main() {
  if (process.argv.indexOf('--check') !== -1) return check();
  const changed = ensureChrome();
  fs.writeFileSync(path.join(ROOT, 'playbooks.html'), build(), 'utf8');
  const sm = ensureSitemap();
  console.log('playbooks.html written (14 cards).');
  console.log('Nav and footer updated in ' + changed.length + ' file(s)' + (changed.length ? ': ' + changed.join(', ') : '') + '.');
  console.log(sm ? 'Added /playbooks to sitemap.xml.' : 'sitemap.xml already lists /playbooks.');
}

if (require.main === module) main();

module.exports = { model: model, build: build };
