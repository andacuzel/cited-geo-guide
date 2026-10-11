/* =====================================================================
   lib/site-footer.js: the one footer every public page carries.

   A navy band (--navy-950): the Citehound mark and wordmark, one line of positioning taken from the site's own copy, three columns of links
   (Product, Research, Company) and a bottom row with the copyright. Only pages that exist are linked; scripts/site-footer.js --check fails if a link
   points at a page that does not (or at one the owner took out of the footer), and if any page carries a different footer.

   The generators that write whole pages call html(); scripts/site-footer.js puts the same markup into the hand-written pages. The footer is
   never edited by hand on a page: edit COLUMNS here and run `node scripts/site-footer.js`.

   Not in the footer, on purpose: /changelog (noindex since 11 Oct 2026, the owner will decide), the Playbooks sub-pages and benchmark category pages
   (reachable from their index pages), the Pro report and start pages (private), and social icons (there are no accounts in the repository).
   ===================================================================== */

'use strict';

const site = require('./site-config.js');

const MARK = '<svg viewBox="13 8.5 52 52" focusable="false"><path fill="currentColor" fill-rule="evenodd" d="M62 30 L58 28.5 L40 20 L35 17.5 L28 12 L21 15.5 Q13 32 17 57 L32 57 Q28.5 46.5 37 41 L39 38 L58 34.5 L61 32.5 Z M27.5 16.5 L16 25 L27 22.5 Z M38.4 22.9 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0 Z"/></svg>';

// One sentence, made of two the site already says (llms.txt: "a free scanner for AI readiness"; the old footer line). "Free" is left out: the citation-tracking page must not say it.
const TAGLINE = 'A scanner for AI readiness, built for teams navigating the shift from search to answers.';

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

// The footer element, each line after the first prefixed with `indent` (the first line sits where the caller puts it).
function html(indent) {
  const L = [];
  L.push('<footer class="site-footer site-footer--navy" aria-label="Footer">');
  L.push('  <div class="section__inner">');
  L.push('    <div class="sf-grid">');
  L.push('      <div class="sf-brand">');
  L.push('        <a href="/" class="sf-logo" aria-label="Citehound, back to homepage"><span class="sf-logo__icon" aria-hidden="true">' + MARK + '</span><span class="sf-logo__mark">Citehound</span></a>');
  L.push('        <p class="sf-tag">' + esc(TAGLINE) + '</p>');
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
function normalize(page) {
  return page.replace(FOOTER_RE, (m, ind) => ind + html(ind));
}

// The addresses the footer links to, for the check.
function hrefs() { return COLUMNS.reduce((a, c) => a.concat(c.links.map((l) => l[0])), []); }

module.exports = { html: html, normalize: normalize, hrefs: hrefs, COLUMNS: COLUMNS, TAGLINE: TAGLINE, FOOTER_RE: FOOTER_RE };
