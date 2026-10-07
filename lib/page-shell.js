/* =====================================================================
   lib/page-shell.js

   The chrome shared by the pages built by scripts (changelog, trust,
   research 002): head tags, site schema, header and footer. The header, fonts,
   favicon and footer nav are read from about.html, the same source the other
   generators use, so a nav change reaches every generated page. The address
   comes from lib/site-config.js.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const site = require('./site-config');
const siteChrome = require('../scripts/site-chrome.js');

const ROOT = path.resolve(__dirname, '..');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parts(depth) {
  const about = fs.readFileSync(path.join(ROOT, 'about.html'), 'utf8');
  const grab = (re, what) => { const m = about.match(re); if (!m) throw new Error('about.html: could not find ' + what); return m[0]; };
  const up = depth ? '../'.repeat(depth) : '';
  return {
    favicon: grab(/<link rel="icon"[^>]*>/, 'favicon'),
    fonts: grab(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com" \/>[\s\S]*?rel="stylesheet" \/>/, 'font links'),
    header: grab(/<header class="site-header">[\s\S]*?<\/header>/, 'header'),
    footerNav: grab(/<nav class="site-nav footer-links"[\s\S]*?<\/nav>/, 'footer nav'),
    up: up
  };
}

/* opts: { title, description, path ('/trust'), cssVersion, jsonld (array of objects), body (main inner html), depth, bodyScripts } */
function page(opts) {
  const sh = parts(opts.depth || 0);
  if (opts.description.length < 120 || opts.description.length > 160) throw new Error('description for ' + opts.path + ' is ' + opts.description.length + ' characters, expected 120 to 160');
  const url = site.baseUrl + opts.path;
  const ld = (opts.jsonld || []).map((o) => '  <script type="application/ld+json">\n' + JSON.stringify(o, null, 2).replace(/^/gm, '  ') + '\n  </script>\n').join('');
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n\n' +
    '  <title>' + esc(opts.title) + '</title>\n  <meta name="description" content="' + esc(opts.description) + '" />\n' +
    '  <meta name="author" content="' + esc(site.name) + '" />\n  <meta name="robots" content="index, follow" />\n  <link rel="canonical" href="' + url + '" />\n\n' +
    '  <meta property="og:type" content="website" />\n  <meta property="og:title" content="' + esc(opts.title) + '" />\n  <meta property="og:description" content="' + esc(opts.description) + '" />\n  <meta property="og:url" content="' + url + '" />\n  <meta property="og:image" content="' + site.baseUrl + '/assets/brand/og-default.png" />\n  <meta property="og:site_name" content="' + esc(site.name) + '" />\n' +
    '  <meta name="twitter:card" content="summary_large_image" />\n  <meta name="twitter:title" content="' + esc(opts.title) + '" />\n  <meta name="twitter:description" content="' + esc(opts.description) + '" />\n  <meta name="twitter:image" content="' + site.baseUrl + '/assets/brand/og-default.png" />\n\n' +
    '  ' + sh.favicon + '\n\n  ' + sh.fonts + '\n\n  <link rel="stylesheet" href="' + sh.up + 'styles.css?v=' + opts.cssVersion + '" />\n\n' +
    ld + siteChrome.schemaBlock().replace(/^/gm, '  ') + '\n</head>\n<body>\n\n' +
    '  <a class="skip-link" href="#main">Skip to content</a>\n\n  ' + sh.header + '\n\n' +
    '  <main id="main">\n' + opts.body.replace(/\n$/, '') + '\n\n' +
    '    <footer class="site-footer" aria-label="Footer">\n      <div class="section__inner">\n        ' + sh.footerNav.replace(/\n/g, '\n        ') + '\n' +
    '        <p class="site-footer__coda">© 2026 ' + esc(site.name) + '. Built for teams navigating the shift from search to answers.</p>\n      </div>\n    </footer>\n  </main>\n\n' +
    '  <div class="toast" id="toast" role="status" aria-live="polite"></div>\n\n  <script src="' + sh.up + 'nav.js?v=2"></script>\n</body>\n</html>\n';
}

// The inner-page navy banner used across the site.
function banner(o) {
  return '    <section aria-labelledby="hero-heading">\n      <div class="section__inner">\n        <div class="page-banner">\n          <div class="page-banner__body">\n' +
    '            <p class="kicker kicker--on-navy">' + esc(o.kicker) + '</p>\n' +
    '            <h1 id="hero-heading" class="page-banner__title">' + o.title + '</h1>\n' +
    '            <p class="page-banner__desc">' + o.desc + '</p>\n' +
    '          </div>\n' + (o.icon ? '          <span class="page-banner__icon" aria-hidden="true">' + o.icon + '</span>\n' : '') +
    '        </div>\n      </div>\n    </section>\n';
}

module.exports = { page, banner, esc, parts };
