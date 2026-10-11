#!/usr/bin/env node
/* =====================================================================
   scripts/test-site-footer.js: the one footer (lib/site-footer.js, the .sf-* rules in styles.css).

   What it holds (three columns, only pages that exist, the contact address from site.config.json, nothing about /changelog, no social icons), that its
   one line of positioning is made of words the site already says, how it looks (navy-950, white and gold-soft, the three type families, columns that
   stack at 900 and 560 px, a visible focus ring), and where it is: every deployed page, and the pages the Pro function writes. The page-by-page
   comparison itself is scripts/site-footer.js --check, also a gate.

     node scripts/test-site-footer.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const F = require('../lib/site-footer.js');
const site = require('../lib/site-config.js');
let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

const html = F.html('');
t('three columns, Product, Research and Company, each a labelled nav', F.COLUMNS.map((c) => c.title).join() === 'Product,Research,Company' && (html.match(/<nav class="sf-col" aria-labelledby="sf-/g) || []).length === 3);
t('the brief\'s links are there: scanner, Pro, MCP; State of AI Readiness, the llms.txt adoption study, Beyond technical; privacy and the contact address', ['/', '/pro', '/mcp', '/research/state-of-ai-readiness', '/research/llms-txt-adoption-2026', '/beyond-technical', '/privacy', 'mailto:' + site.contactEmail].every((h) => F.hrefs().indexOf(h) !== -1));
t('the contact address is the one in site.config.json, shown as the address', html.indexOf('<a href="mailto:' + site.contactEmail + '">' + site.contactEmail + '</a>') !== -1 && site.contactEmail === 'hey@getcitehound.com');
t('no link to /changelog, no social icon or account (there are none in the repository), no link to a page that does not exist', !/changelog/i.test(html) && !/twitter|x\.com|linkedin|github\.com|facebook|instagram|youtube|mastodon/i.test(html) && require('./site-footer.js').missingTargets().length === 0);
t('the bottom row is the copyright and nothing else', /<p class="sf-legal">© 2026 Citehound<\/p>/.test(html));
const llms = read('llms.txt') + read('about.html');
t('the line of positioning is two things the site already says: a scanner for AI readiness (llms.txt) and "the shift from search to answers" (the old footer, the About page)', /A scanner for AI readiness, built for teams navigating the shift from search to answers\./.test(html) && /scanner for AI readiness/i.test(llms) && /shift from search to answers/i.test(read('about.html') + read('index.html') + read('trust.html')));
t('the wordmark is the mark plus "Citehound" linking home, with a name for screen readers', /<a href="\/" class="sf-logo" aria-label="Citehound, back to homepage">/.test(html) && /<svg viewBox="13 8.5 52 52"/.test(html));
const css = read('styles.css');
const block = css.split('Site footer ---')[1].split('/* ----------------------------- Views')[0];
t('navy-950 surface, white text, gold-soft headings, the three families only', /\.site-footer--navy \{[^}]*background: var\(--navy-950\)/.test(block) && /\.sf-h \{[^}]*var\(--font-mono\)[^}]*var\(--gold-soft\)/.test(block) && /\.sf-logo__mark \{[^}]*var\(--font-display\)/.test(block) && /\.site-footer--navy \{[^}]*var\(--font-body\)/.test(block) && !/font-family:\s*['"]/.test(block));
t('no gradient, image, shadow or animation; the only transition is colour', !/gradient|url\(|box-shadow|animation|@keyframes|(?<![-\w])transform\s*:/.test(block) && (block.match(/transition:/g) || []).every(() => /transition: color var\(--t\)/.test(block)));
t('gold is used for headings and hover only (never as a surface)', !/background:\s*var\(--gold/.test(block));
t('columns stack: four across, two under 900px, one under 560px', /grid-template-columns: minmax\(0, 1\.5fr\) repeat\(3, minmax\(0, 1fr\)\)/.test(block) && /@media \(max-width: 900px\)[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/.test(block) && /@media \(max-width: 560px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/.test(block));
t('a visible keyboard focus ring on every link', /\.sf-list a:focus-visible[^}]*outline: 2px solid var\(--gold-soft\)/.test(block) && /\.sf-logo:focus-visible/.test(block));
t('long addresses cannot push the layout sideways', /overflow-wrap: anywhere/.test(block));
t('link targets are at least 24px tall (padding on the links)', /\.sf-list a \{[^}]*padding: 5px 0/.test(block));
// where it is
const pro = fs.readFileSync(path.join(ROOT, 'lib', 'pro-report-page.js'), 'utf8');
t('the pages the Pro function writes (report, progress, start, errors) carry it through the shared shell', /siteFooter\.html\(/.test(pro) && /require\('\.\/site-footer\.js'\)/.test(pro));
t('the Pro start page has the same footer instead of its own small one', /<footer class="site-footer site-footer--navy"/.test(read('app/pro-start.html')) && !/ps-foot/.test(read('app/pro-start.html').replace(/<style[\s\S]*?<\/style>/g, '')));
const pages = ['index.html', 'about.html', 'pro.html', 'privacy.html', 'terms.html', 'research/index.html', 'research/state-of-ai-readiness.html', 'research/llms-txt-adoption-2026.html', 'research/case-study-agaone.html', 'research/crawler-access-2026.html', 'beyond-technical.html', 'tools/index.html', 'benchmarks/crm.html', 'sample-report.html', '404.html', 'changelog.html'];
const flat = (x) => x.replace(/\s+/g, ' ');
t('the footer is the same on the pages the owner named and on the old research pages', pages.every((p) => flat(read(p)).indexOf(flat(F.html(''))) !== -1), pages.filter((p) => flat(read(p)).indexOf(flat(F.html(''))) === -1).join(', '));
t('printed pages leave it out', /\.site-footer[^{]*\{ display: none !important; \}|\.site-footer, \.skip-link/.test(css) || /\.rp-appbar, \.site-header, \.mobile-nav, \.site-footer/.test(css));
t('the encrypted private report is not touched (its bytes are the encrypted file)', !/site-footer/.test(read('r/e71cce11cde60ae54bf56203/index.html')));
t('the changelog page stays, is noindex, and is out of the footer, the sitemap and llms.txt', fs.existsSync(path.join(ROOT, 'changelog.html')) && /name="robots" content="noindex, follow"/.test(read('changelog.html')) && !/\/changelog</.test(read('sitemap.xml')) && !/\/changelog\b/.test(read('llms.txt')));

out('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
