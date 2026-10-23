/* =====================================================================
   lib/og.js: which share image a page gets, and the meta tags that carry it. One source for scripts/generate-og.js (draws the images), lib/page-shell.js and the
   generators (write the tags) and scripts/apply-og.js (writes and checks them on the hand-written pages).
   Images are 1200x630 PNG in assets/brand/, named with ?v=VERSION: raise VERSION in this file when an image changes, then run the generators and scripts/apply-og.js.
   ===================================================================== */

'use strict';

const site = require('./site-config.js');

const VERSION = 4;
const W = 1200, H = 630;

// type -> { file, alt }. The alt text says what the picture shows; it holds no claim beyond the page's own text.
const TYPES = {
  default: { file: 'og-default.png', alt: 'Citehound: scan, fix and write for the way AI answers. The Citehound hound beside the wordmark.' },
  'default-light': { file: 'og-default-light.png', alt: 'Citehound: scan, fix and write for the way AI answers, on the light page colour.' },
  home: { file: 'og-home.png', alt: 'Citehound home page: see how AI reads your site, with a scan of getcitehound.com scoring 87 out of 100 and ten AI crawlers shown as doors.' },
  pricing: { file: 'og-pricing.png', alt: 'Citehound pricing: four steps from the free scan to Pro, Fix and Beyond.' },
  claude: { file: 'og-claude.png', alt: 'Citehound for Claude: the MCP server address, https://getcitehound.com/api/mcp, free and read-only.' },
  api: { file: 'og-api.png', alt: 'Citehound API: scan and generate from your own code, with a GET /v1/scan request.' },
  integrations: { file: 'og-integrations.png', alt: 'Where you can use Citehound: Claude, the command line, the API and n8n.' },
  tools: { file: 'og-tools.png', alt: 'Citehound free tools: robots.txt generator, schema generator, llms.txt checker and compare two sites.' },
  compare: { file: 'og-compare.png', alt: 'Compare two sites: two domain fields and a Compare button.' },
  about: { file: 'og-about.png', alt: 'About Citehound: Andaç Üzel, content strategist turned builder.' },
  pro: { file: 'og-pro.png', alt: 'Citehound Pro: the whole-site report, page by page.' },
  fix: { file: 'og-fix.png', alt: 'Citehound Fix: we make the technical changes.' },
  beyond: { file: 'og-beyond.png', alt: 'Citehound Beyond: we write the content.' }
};

// page path -> type (everything else is "default")
const PAGE_TYPE = { '/': 'home', '/pricing': 'pricing', '/claude': 'claude', '/api': 'api', '/integrations': 'integrations', '/tools': 'tools', '/tools/robots-txt': 'tools', '/tools/llms-txt-checker': 'tools', '/tools/schema-generator': 'tools', '/compare': 'compare', '/about': 'about', '/pro': 'pro', '/fix': 'fix', '/beyond': 'beyond' };

const typeOf = (pathname) => PAGE_TYPE[pathname] || 'default';
const info = (pathname) => { const t = TYPES[typeOf(pathname)]; return { type: typeOf(pathname), file: t.file, alt: t.alt, url: site.baseUrl + '/assets/brand/' + t.file + '?v=' + VERSION }; };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// the image tags (og:image .. twitter:image:alt), without og:title and friends
function block(pathname, indent) {
  const i = info(pathname), p = indent === undefined ? '  ' : indent;
  return [
    '<meta property="og:image" content="' + i.url + '" />',
    '<meta property="og:image:type" content="image/png" />',
    '<meta property="og:image:width" content="' + W + '" />',
    '<meta property="og:image:height" content="' + H + '" />',
    '<meta property="og:image:alt" content="' + esc(i.alt) + '" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    '<meta name="twitter:image" content="' + i.url + '" />',
    '<meta name="twitter:image:alt" content="' + esc(i.alt) + '" />'
  ].map((l) => p + l).join('\n');
}

// the icon tags the same script keeps: the .ico fallback, the touch icon and the manifest (the SVG favicon line stays where the page has it)
const ICONS = ['<link rel="icon" href="/favicon.ico" sizes="48x48" />', '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />', '<link rel="manifest" href="/site.webmanifest" />'];

const TAG = /^[ \t]*(?:<meta (?:property="og:image(?::[a-z]+)?"|name="twitter:(?:image(?::alt)?|card)")[^>]*>|<link rel="(?:apple-touch-icon|manifest)"[^>]*>|<link rel="icon" href="\/favicon\.ico"[^>]*>)\n/gm;

// remove every image/card/icon tag of a page and write the block once, right after og:url (or og:description)
function apply(html, pathname) {
  const clean = html.replace(TAG, '');
  const m = /^([ \t]*)<meta property="og:url"[^>]*>\n/m.exec(clean);
  if (!m) throw new Error('lib/og.js: no og:url line in the page for ' + pathname);
  const at = m.index + m[0].length;
  return clean.slice(0, at) + block(pathname, m[1]) + '\n' + ICONS.map((l) => m[1] + l).join('\n') + '\n' + clean.slice(at);
}

module.exports = { ICONS, VERSION, W, H, TYPES, PAGE_TYPE, typeOf, info, block, apply };
