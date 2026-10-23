#!/usr/bin/env node
/* =====================================================================
   scripts/test-self-hosting.js

   Nothing a visitor's browser loads comes from another host (24 Oct 2026), and the one counter is cookieless:
   - the typefaces are served from this site (fonts.css and assets/fonts/*.woff2: all 13 files exist and are WOFF2, every @font-face points at one, the three preloaded files exist), and no page,
     generator or report template still names fonts.googleapis.com or fonts.gstatic.com (two scripts that make images for the owner, not pages, are the exception);
   - the Launch Llama badge image is in the repository (assets/launchllama-featured-badge.png) and the homepage footer points at it; its link to the listing stays a link;
   - every public page loads exactly one script from the outside world's point of view: Vercel Web Analytics at /_vercel/insights/script.js (the same origin), once per page, and no
     private page (the Pro start and report templates, the report generator) loads it; no Speed Insights, no Google Analytics or tag manager, no ad pixel, no analytics cookie;
   - no page requests a resource (script, stylesheet, image, iframe, font, preload) from a host other than getcitehound.com; links (<a href>) to other sites are links only, and the
     YouTube embeds on /about stay inside an HTML comment.

     node scripts/test-self-hosting.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

// r/ holds the owner's encrypted private reports (unlock pages), not site pages.
const pages = cp.execSync('git ls-files "*.html"', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean).filter((f) => !/^r\//.test(f));
const publicPages = pages.filter((f) => !/^app\//.test(f));
const fontPages = pages.filter((f) => f !== 'app/crawl.html');   // the old internal crawl page is not deployed (.vercelignore) and loads no typeface
const stripComments = (h) => h.replace(/<!--[\s\S]*?-->/g, '');
const TAG = '<script defer src="/_vercel/insights/script.js"></script>';

/* fonts */
const css = read('fonts.css');
const faces = (css.match(/@font-face/g) || []).length, urls = (css.match(/url\(([^)]+)\)/g) || []).map((u) => u.slice(4, -1));
t('fonts.css: 27 @font-face rules, every url is a local file under /assets/fonts/ that exists and is a WOFF2 file, font-display swap', faces === 27 && urls.length === 27 && urls.every((u) => /^\/assets\/fonts\/[a-z0-9-]+\.woff2$/.test(u) && fs.existsSync(path.join(ROOT, u)) && fs.readFileSync(path.join(ROOT, u)).slice(0, 4).toString() === 'wOF2') && (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/font-display: swap/g) || []).length === 27 && !/https?:/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));
t('the three families of the design system are there: Gloock 400, Hanken Grotesk 400 to 700 and italic, Spline Sans Mono 400 and 500', /font-family: 'Gloock'/.test(css) && /font-family: 'Hanken Grotesk'/.test(css) && /font-family: 'Spline Sans Mono'/.test(css) && /font-style: italic/.test(css) && (css.match(/font-weight: 400 700|font-weight: 4\d\d 7\d\d|font-weight: 400;/g) || []).length > 0);
const stillGoogle = cp.execSync('git grep -l "fonts\\.googleapis\\|fonts\\.gstatic" || true', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean).filter((f) => !/^scripts\/(capture-og|make-launch-assets|test-self-hosting)\.js$/.test(f));
t('no page, generator or template names Google Fonts', stillGoogle.length === 0, stillGoogle.join(', '));
const preloads = Array.from(new Set(publicPages.concat(['app/pro-start.html', 'app/report.html']).map((f) => (read(f).match(/<link rel="preload" href="([^"]+)" as="font"/g) || []).join('|')))).filter(Boolean);
t('every page preloads the same three local font files (crossorigin), which exist', preloads.length === 1 && (preloads[0].match(/href="\/assets\/fonts\/[a-z0-9-]+\.woff2"/g) || []).length === 3 && preloads[0].split('|').every((l) => fs.existsSync(path.join(ROOT, /href="([^"]+)"/.exec(l)[1]))) && fontPages.every((f) => /<link rel="preload" href="\/assets\/fonts\/[^"]+" as="font" type="font\/woff2" crossorigin \/>/.test(read(f))));
t('every page links fonts.css (same origin)', fontPages.every((f) => read(f).indexOf('<link href="/fonts.css?v=1" rel="stylesheet" />') !== -1) && /FONTS = [^;]*fonts\.css/.test(read('lib/pro-report-page.js')));

t('the PDF export library of the playbook pages (html2pdf 0.10.1) is served from this site, byte-identical to the file the pages used to load from a CDN (same SRI hash), with no cdnjs reference left', fs.existsSync(path.join(ROOT, 'assets/vendor/html2pdf.bundle.min.js')) && 'sha512-' + require('crypto').createHash('sha512').update(fs.readFileSync(path.join(ROOT, 'assets/vendor/html2pdf.bundle.min.js'))).digest('base64') === 'sha512-GsLlZN/3F2ErC5ifS5QtgpiJtWd43JWSuIgh7mbzZ8zBps+dvLusV+eNQATqgA/HdeKFVgA5v3S/cIrLF7QnIg==' && ['for-brands.html', 'for-professionals.html', 'for-saas.html'].every((f) => read(f).indexOf('<script src="/assets/vendor/html2pdf.bundle.min.js"></script>') !== -1) && !/cdnjs/.test(pages.map((f) => read(f)).join('')));

/* the badge */
const home = read('index.html');
t('the badge image is a local file and the homepage footer uses it; the link to the listing is still a link', fs.existsSync(path.join(ROOT, 'assets/launchllama-featured-badge.png')) && fs.readFileSync(path.join(ROOT, 'assets/launchllama-featured-badge.png')).slice(1, 4).toString() === 'PNG' && /<img src="\/assets\/launchllama-featured-badge\.png"[^>]*alt="Featured on Launch Llama Tools"/.test(home) && /<a href="https:\/\/tools\.launchllama\.co\/products\/citehound\?utm_source=badge&utm_medium=referral" target="_blank" rel="noopener noreferrer"><img src="\/assets\//.test(home) && !/src="https:\/\/tools\.launchllama\.co/.test(home));

/* analytics */
t('every public page has the Vercel Web Analytics script exactly once, in the head', publicPages.every((f) => { const h = read(f), n = h.split(TAG).length - 1; return n === 1 && h.indexOf(TAG) < h.indexOf('</head>'); }), publicPages.filter((f) => read(f).split(TAG).length - 1 !== 1).join(', '));
t('no private page loads it (the Pro start and report templates, the Pro report generator)', !/insights/.test(read('app/pro-start.html') + read('app/report.html') + read('lib/pro-report-page.js')));
const all = pages.map((f) => read(f)).join('\n') + read('lib/report-render.js') + read('lib/pro-report-page.js');
t('no Speed Insights, Google Analytics, tag manager, ad pixel or other tracker anywhere', !/speed-insights|googletagmanager|google-analytics|gtag\(|fbq\(|hotjar|clarity\.ms|mixpanel|posthog|plausible|segment\.com|doubleclick|adsbygoogle|_ga\b/i.test(all));
t('the analytics script is the only script in the head that is not one of our own files', publicPages.every((f) => (stripComments(read(f)).match(/<script[^>]* src="([^"]+)"/g) || []).every((m) => { const s = /src="([^"]+)"/.exec(m)[1]; return /^\/_vercel\/insights\/script\.js$/.test(s) || /^(\.\.\/|\/)?[a-zA-Z0-9_./-]+\.js(\?v=\d+)?$/.test(s); })));

/* no resource from another host */
const external = [];
pages.forEach((f) => {
  const h = stripComments(read(f)).replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
  (h.match(/<(script|img|iframe|source|video|audio|embed|object)\b[^>]*\s(src|data)="https?:\/\/[^"]+"/gi) || []).forEach((m) => { const u = /"(https?:\/\/[^"]+)"/.exec(m)[1]; if (!/^https:\/\/getcitehound\.com/.test(u)) external.push(f + ': ' + u); });
  (h.match(/<link\b[^>]*\shref="https?:\/\/[^"]+"[^>]*>/gi) || []).forEach((m) => { const u = /href="(https?:\/\/[^"]+)"/.exec(m)[1]; if (!/rel="(canonical|alternate|me|author)"/.test(m) && !/^https:\/\/getcitehound\.com/.test(u)) external.push(f + ': ' + u); });
  (h.match(/url\(["']?https?:\/\/[^)]+\)|@import[^;]*https?:\/\/[^;]+/gi) || []).forEach((u) => external.push(f + ': ' + u));
});
t('no page loads a script, stylesheet, font, image, frame or embed from a host other than getcitehound.com', external.length === 0, external.slice(0, 4).join(' | '));
const css2 = read('styles.css');
t('styles.css and the site scripts request nothing from another host', !/url\(["']?https?:\/\/(?!getcitehound\.com)/.test(css2) && !/@import/.test(css2) && ['app.js', 'scanner.js', 'nav.js', 'report-card.js', 'wl-bar.js', 'home-motion.js', 'pricing.js', 'compare.js', 'claude.js', 'watch.js', 'get-api-key.js'].every((f) => !/fetch\(\s*['"]https?:\/\/(?!getcitehound\.com)/.test(read(f))));
const about = read('about.html');
t('the YouTube embeds on /about are inside an HTML comment (nothing loads), and its YouTube link is a plain link', (about.match(/youtube\.com\/embed/g) || []).length > 0 && stripComments(about).indexOf('youtube.com/embed') === -1);

/* cookies */
const js = ['app.js', 'scanner.js', 'nav.js', 'report-card.js', 'wl-bar.js', 'home-motion.js', 'pricing.js', 'compare.js', 'claude.js', 'watch.js', 'get-api-key.js', 'waitlist.js', 'request-form.js', 'report-signup.js', 'pro-cta.js', 'research.js'].map((f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')).join('\n');
t('no site script reads or writes a cookie or uses localStorage (the two homepage notices use sessionStorage for the visit only)', !/document\.cookie|localStorage|indexedDB/.test(js) && (js.match(/sessionStorage/g) || []).length > 0);
t('/privacy says it: Vercel Web Analytics, no cookies, no Google Fonts', /Vercel Web Analytics/.test(read('privacy.html')) && !/Google Fonts/.test(read('privacy.html')));

out('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { fails.forEach((f) => out('FAIL: ' + f)); process.exit(1); }
