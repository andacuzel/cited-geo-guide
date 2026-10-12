/* =====================================================================
   lib/site-footer.js: the one footer every public page carries.

   A navy band (--navy-950): the Citehound mark and wordmark, one line of positioning taken from the site's own copy, three columns of links
   (Product, Research, Company) and a bottom row with the copyright. Only pages that exist are linked; scripts/site-footer.js --check fails if a link
   points at a page that does not (or at one the owner took out of the footer), and if any page carries a different footer.

   The generators that write whole pages call html(); scripts/site-footer.js puts the same markup into the hand-written pages. The footer is
   never edited by hand on a page: edit COLUMNS here and run `node scripts/site-footer.js`.

   Not in the footer, on purpose: /changelog (noindex since 11 Oct 2026, the owner will decide), the Playbooks sub-pages and benchmark category pages
   (reachable from their index pages), and the Pro report and start pages' own links (private). The social icons (X now, LinkedIn when its address is
   real) are in every footer; the Launch Llama badge only in the homepage's (scripts/site-footer.js passes badge for index.html).
   ===================================================================== */

'use strict';

const site = require('./site-config.js');

const MARK = '<svg viewBox="13 8.5 52 52" focusable="false"><path fill="currentColor" fill-rule="evenodd" d="M62 30 L58 28.5 L40 20 L35 17.5 L28 12 L21 15.5 Q13 32 17 57 L32 57 Q28.5 46.5 37 41 L39 38 L58 34.5 L61 32.5 Z M27.5 16.5 L16 25 L27 22.5 Z M38.4 22.9 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0 Z"/></svg>';

// One sentence, made of two the site already says (llms.txt: "a free scanner for AI readiness"; the old footer line). "Free" is left out: the citation-tracking page must not say it.
const TAGLINE = 'A scanner for AI readiness, built for teams navigating the shift from search to answers.';

// The accounts (X and the LinkedIn company page, as given by the owner on 12 Oct 2026). A link whose address is not a real one is left out, never shown
// as a placeholder. The marks are the platforms' own simple glyphs on a
// 24x24 grid (as published in the Simple Icons set, CC0), filled with currentColor, no font, no request, no script.
const X_URL = 'https://x.com/getcitehound';
const LINKEDIN_URL = 'https://www.linkedin.com/company/citehound/';
const X_MARK = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
const LINKEDIN_MARK = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>';
const SOCIAL = [
  { label: 'Citehound on X', href: X_URL, mark: X_MARK },
  { label: 'Citehound on LinkedIn', href: LINKEDIN_URL, mark: LINKEDIN_MARK }
].filter((x) => x.href && /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/\S+$/i.test(x.href));

// Launch Llama's badge, exactly as the directory gave it (the homepage footer only). Explicit width and height, lazy-loaded: no layout shift.
const BADGE = '<a href="https://tools.launchllama.co/products/citehound?utm_source=badge&utm_medium=referral" target="_blank" rel="noopener noreferrer"><img src="https://tools.launchllama.co/featured-badge.png?v=2" alt="Featured on Launch Llama Tools" width="200" height="52" loading="lazy" /></a>';

const COLUMNS = [
  { id: 'product', title: 'Product', links: [
    ['/', 'Scanner'],
    ['/compare', 'Compare two sites'],
    ['/tools', 'Tools'],
    ['/playbooks', 'Playbooks'],
    ['/pro', 'Citehound Pro'],
    ['/sample-report', 'Sample Pro report'],
    ['/mcp', 'MCP server'],
    ['/agentic-commerce', 'Agentic commerce'],
    ['/citation-tracking', 'Citation tracking']
  ] },
  { id: 'research', title: 'Research', links: [
    ['/research/state-of-ai-readiness', 'State of AI Readiness'],
    ['/research/llms-txt-adoption-2026', 'llms.txt adoption study'],
    ['/research/crawler-access-2026', 'Crawler access study'],
    ['/research/case-study-agaone', 'Case study'],
    ['/benchmarks', 'Benchmarks'],
    ['/methodology', 'Methodology'],
    ['/beyond-technical', 'Beyond technical']
  ] },
  { id: 'company', title: 'Company', links: [
    ['/about', 'About'],
    ['/trust', 'Trust'],
    ['/privacy', 'Privacy'],
    ['/terms', 'Terms'],
    ['mailto:' + site.contactEmail, site.contactEmail]
  ] }
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The footer element, each line after the first prefixed with `indent` (the first line sits where the caller puts it). opts.badge: add the Launch Llama
// badge (the homepage only).
function html(indent, opts) {
  opts = opts || {};
  const L = [];
  L.push('<footer class="site-footer site-footer--navy" aria-label="Footer">');
  L.push('  <div class="section__inner">');
  L.push('    <div class="sf-grid">');
  L.push('      <div class="sf-brand">');
  L.push('        <a href="/" class="sf-logo" aria-label="Citehound, back to homepage"><span class="sf-logo__icon" aria-hidden="true">' + MARK + '</span><span class="sf-logo__mark">Citehound</span></a>');
  L.push('        <p class="sf-tag">' + esc(TAGLINE) + '</p>');
  if (SOCIAL.length) {
    L.push('        <ul class="sf-social" aria-label="Citehound on social media">');
    SOCIAL.forEach((x) => L.push('          <li><a href="' + esc(x.href) + '" target="_blank" rel="noopener noreferrer" aria-label="' + esc(x.label) + '">' + x.mark + '</a></li>'));
    L.push('        </ul>');
  }
  if (opts.badge) L.push('        <p class="sf-badge">' + BADGE + '</p>');
  L.push('      </div>');
  COLUMNS.forEach((c) => {
    L.push('      <nav class="sf-col" aria-labelledby="sf-' + c.id + '">');
    L.push('        <p class="sf-h" id="sf-' + c.id + '">' + esc(c.title) + '</p>');
    L.push('        <ul class="sf-list">');
    c.links.forEach((l) => L.push('          <li><a href="' + esc(l[0]) + '">' + esc(l[1]) + '</a></li>'));
    L.push('        </ul>');
    L.push('      </nav>');
  });
  L.push('    </div>');
  L.push('    <p class="sf-legal">\u00A9 2026 ' + esc(site.name) + '</p>');
  L.push('  </div>');
  L.push('</footer>');
  const pad = indent || '';
  return L.map((l, i) => (i === 0 ? l : pad + l)).join('\n');
}

const FOOTER_RE = /([ \t]*)<footer class="site-footer[ "][\s\S]*?<\/footer>/;

// The page with its footer replaced by the canonical one, in the indentation the old footer had.
function normalize(page, opts) {
  return page.replace(FOOTER_RE, (m, ind) => ind + html(ind, opts));
}

// The addresses the footer links to, for the check.
function hrefs() { return COLUMNS.reduce((a, c) => a.concat(c.links.map((l) => l[0])), []); }

module.exports = { SOCIAL: SOCIAL, X_URL: X_URL, LINKEDIN_URL: LINKEDIN_URL, BADGE: BADGE, html: html, normalize: normalize, hrefs: hrefs, COLUMNS: COLUMNS, TAGLINE: TAGLINE, FOOTER_RE: FOOTER_RE };
