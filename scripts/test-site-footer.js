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
t('no link to /changelog, no account other than X and LinkedIn, no link to a page that does not exist', !/changelog/i.test(html) && !/github\.com|facebook|instagram|youtube|mastodon/i.test(html) && require('./site-footer.js').missingTargets().length === 0);
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
const want = (p) => flat(F.html('', { badge: p === 'index.html' }));
t('the footer is the same on the pages the owner named and on the old research pages (the homepage\'s alone has the badge)', pages.every((p) => flat(read(p)).indexOf(want(p)) !== -1), pages.filter((p) => flat(read(p)).indexOf(want(p)) === -1).join(', '));
t('printed pages leave it out', /\.site-footer[^{]*\{ display: none !important; \}|\.site-footer, \.skip-link/.test(css) || /\.rp-appbar, \.site-header, \.mobile-nav, \.site-footer/.test(css));
t('the encrypted private report is not touched (its bytes are the encrypted file)', !/site-footer/.test(read('r/e71cce11cde60ae54bf56203/index.html')));
t('the changelog page stays, is noindex, and is out of the footer, the sitemap and llms.txt', fs.existsSync(path.join(ROOT, 'changelog.html')) && /name="robots" content="noindex, follow"/.test(read('changelog.html')) && !/\/changelog</.test(read('sitemap.xml')) && !/\/changelog\b/.test(read('llms.txt')));

/* ---- the social links, the Launch Llama badge, the schema ---- */
t('X: the one real address, in a new tab, with noopener noreferrer, an accessible name, and the platform\'s mark as inline SVG filled with currentColor (no font, no script, no request)', F.X_URL === 'https://x.com/getcitehound' && /<a href="https:\/\/x\.com\/getcitehound" target="_blank" rel="noopener noreferrer" aria-label="Citehound on X"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false"><path d="M18\.244 2\.25h3\.308/.test(html));
t('LinkedIn: the company page the owner gave, same attributes and the platform\'s mark as inline SVG filled with currentColor, after X', F.LINKEDIN_URL === 'https://www.linkedin.com/company/citehound/' && F.SOCIAL.map((x) => x.label).join() === 'Citehound on X,Citehound on LinkedIn' && /<a href="https:\/\/www\.linkedin\.com\/company\/citehound\/" target="_blank" rel="noopener noreferrer" aria-label="Citehound on LinkedIn"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false"><path d="M20\.447 20\.452/.test(html));
t('the social icons are 44px touch targets with a visible focus ring and a gap between them', /\.sf-social a \{[^}]*width: 44px; height: 44px/.test(block) && /\.sf-social a:focus-visible \{ outline: 2px solid var\(--gold-soft\)/.test(block) && /\.sf-social \{[^}]*gap: 8px/.test(block) && /\.sf-social a \{[^}]*color: rgba\(255, 255, 255, 0\.88\)/.test(block));
const LLAMA_EXACT = '<a href="https://tools.launchllama.co/products/citehound?utm_source=badge&utm_medium=referral" target="_blank" rel="noopener noreferrer"><img src="https://tools.launchllama.co/featured-badge.png?v=2" alt="Featured on Launch Llama Tools" width="200" height="52" loading="lazy" /></a>';
t('the Launch Llama badge is the owner\'s snippet with loading="lazy" added, width and height 200 by 52', F.LLAMA === LLAMA_EXACT);
t('the Launch Llama badge is the only badge: LaunchIgniter\'s was added and taken out again on 13 Oct 2026', F.BADGES.join() === LLAMA_EXACT && !/igniter/i.test(F.BADGES.join()) && !F.IGNITER);
const withBadge = pagesAll().filter((p) => read(p).indexOf('tools.launchllama.co') !== -1);
t('the badge is on the homepage and on no other page, no private or Pro page, no script, no stylesheet or JS file; nothing of LaunchIgniter is anywhere', withBadge.join() === 'index.html' && !/launchllama/i.test(html) && !/launchllama/i.test(pro) && !/launchllama/i.test(read('styles.css')) && pagesAll().every((p) => !/igniter/i.test(read(p))));
function pagesAll() { return require('child_process').execSync('git ls-files "*.html"', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean); }
t('the badge reserves its box through its width and height attributes (200 by 52) with height: auto in CSS, so it cannot move the page', /\.sf-badges img \{[^}]*max-width: 100%[^}]*height: auto/.test(block) && /width="200" height="52"/.test(F.LLAMA));
t('vercel.json sets no CSP or img-src, and no Referrer-Policy on the homepage; the no-referrer rules are on the private paths only (the badge request carries the browser\'s default, the origin only)', !/Content-Security-Policy|img-src/i.test(read('vercel.json')) && (JSON.parse(read('vercel.json')).headers || []).every((h) => !/^\/(\(\.\*\))?$/.test(h.source) && h.source !== '/(.*)'));
const priv = read('privacy.html').replace(/&rsquo;/g, '\u2019');
t('/privacy says the homepage footer loads a badge image from a third party, Launch Llama, which receives the IP address and browser details, and that no other page loads it', /the homepage footer loads a badge image from a third party, Launch Llama, which receives the visitor\u2019s IP address and browser details when it loads\. No other page loads it\./.test(priv) && !/LaunchIgniter/.test(priv));
// the Organization schema
const orgOf = (html) => { const out = []; (html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []).forEach((b) => { const j = JSON.parse(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); (Array.isArray(j['@graph']) ? j['@graph'] : [j]).forEach((x) => { if (x['@type'] === 'Organization') out.push(x); }); }); return out; };
const orgs = orgOf(read('index.html'));
t('the Organization schema on the homepage has sameAs equal to the footer\'s accounts (X and LinkedIn), as absolute https addresses, and still has its id, name, url, email and contact point', orgs.length === 1 && JSON.stringify(orgs[0].sameAs) === JSON.stringify(F.SOCIAL.map((x) => x.href)) && orgs[0]['@id'] === site.baseUrl + '/#org' && orgs[0].name === 'Citehound' && orgs[0].email === site.contactEmail && orgs[0].contactPoint && orgs[0].contactPoint.email === site.contactEmail && orgs[0].sameAs.every((u) => /^https:\/\/[^\s]+$/.test(u) && new URL(u).host));
const everyOrg = pagesAll().filter((p) => !/^(app|r)\//.test(p)).map((p) => [p, orgOf(read(p))]).filter((x) => x[1].length);
t('every page that carries the Organization carries the same one (the site chrome copies the homepage\'s)', everyOrg.length > 25 && everyOrg.every(([p, o]) => o.length === 1 && JSON.stringify(o[0]) === JSON.stringify(orgs[0])), everyOrg.filter(([p, o]) => JSON.stringify(o[0]) !== JSON.stringify(orgs[0])).map((x) => x[0]).join(', '));
t('/about lists the X and LinkedIn accounts beside its other contact buttons, opening in a new tab with noopener noreferrer', /Citehound on X<\/a>/.test(read('about.html')) && /<a href="https:\/\/www\.linkedin\.com\/company\/citehound\/" class="btn btn--ghost" target="_blank" rel="noopener noreferrer">Citehound on LinkedIn<\/a>/.test(read('about.html')));
t('llms.txt lists no contact links, so it has no social line to update', !/mailto:|linkedin|x\.com/i.test(read('llms.txt')));

out('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
