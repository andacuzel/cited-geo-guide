#!/usr/bin/env node
/* scripts/test-brand.js: the brand finish (23 Oct 2026): the hound is the only mark, the door is not in a branding role, the icon and manifest links are on every page, the share-image tags are complete, the guide and the packs are in step. */
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const og = require('../lib/og.js');
let pass = 0; const fails = [];
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); console.log((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

const DOOR = 'M19 58V32a20 20 0 0 1 40 0v26Z';
const pages = cp.execSync('git ls-files "*.html"', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => f && !/^(r|app)\//.test(f) && f !== '404.html');
const brandSvgs = fs.readdirSync(path.join(ROOT, 'assets/brand')).filter((f) => /\.svg$/.test(f));

// logo set
const mark = read('assets/brand/logo-mark.svg'), hd = /d="(M[^"]+)"/.exec(mark)[1];
t('the SVG logo set is the hound: no file holds the old door or the old sighthound path', brandSvgs.every((f) => read('assets/brand/' + f).indexOf(DOOR) === -1 && read('assets/brand/' + f).indexOf('M62 30 L58') === -1), brandSvgs.join());
t('every mark, lockup, stacked lockup and the badge carry the same hound path; the favicon is the badge', ['logo-mark-dark', 'logo-mark-mono', 'logo-mark-white', 'logo-mark-orange', 'logo-lockup', 'logo-lockup-dark', 'logo-lockup-mono', 'logo-lockup-white', 'logo-stacked', 'logo-stacked-dark', 'logo-badge', 'logo-badge-light'].every((n) => read('assets/brand/' + n + '.svg').indexOf(hd) !== -1) && read('assets/brand/favicon.svg') === read('assets/brand/logo-badge.svg'));
t('the colourways exist: full colour, dark, one colour, white, for the mark, the lockup and the stacked lockup', ['logo-mark', 'logo-lockup', 'logo-stacked'].every((n) => ['', '-dark', '-mono', '-white'].every((s) => fs.existsSync(path.join(ROOT, 'assets/brand/' + n + s + '.svg')))));
t('the wordmark is outlines, not text, so no file needs a font', brandSvgs.every((f) => !/<text\b|font-family/.test(read('assets/brand/' + f))));
t('the old door is on no page, generator or script as a mark (it survives only as the crawler-state icon)', pages.every((f) => read(f).indexOf(DOOR) === -1) && ['lib/lockup.js', 'lib/site-footer.js', 'lib/report-render.js', 'lib/pro-report-page.js'].every((f) => read(f).indexOf(DOOR) === -1));
t('every header, footer and lockup mark is the hound (the inline path equals the logo file)', pages.filter((f) => /class="logo__icon"/.test(read(f))).every((f) => read(f).indexOf(hd) !== -1));
t('the page banner decoration is the orange hound file, not a door', /\.page-banner::after \{[^}]*logo-mark-orange\.svg/.test(read('styles.css')) && !/\.page-banner::before \{[^}]*clip-path/.test(read('styles.css')));
t('the door is drawn in the hound\'s stroke language (round joins) in the crawler-state icons', /\.door__frame \{[^}]*stroke-linejoin: round/.test(read('styles.css')));
t('the legacy logo PNGs are 512 square and 1200 wide', (() => { const d = (f) => { const b = fs.readFileSync(path.join(ROOT, f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; }; return d('assets/brand/logo-mark.png').join() === '512,512' && d('assets/brand/logo-lockup.png')[0] === 1200; })());

// icons and manifest
const ico = fs.readFileSync(path.join(ROOT, 'favicon.ico'));
t('favicon.ico is an ICO with 16, 32 and 48 px images; the touch icon is 180x180; the manifest names 192 and 512 icons that exist', ico.readUInt16LE(2) === 1 && ico.readUInt16LE(4) === 3 && (() => { const b = fs.readFileSync(path.join(ROOT, 'apple-touch-icon.png')); return b.readUInt32BE(16) === 180 && b.readUInt32BE(20) === 180; })() && (() => { const m = JSON.parse(read('site.webmanifest')); return m.name === 'Citehound' && m.icons.length === 2 && m.icons.every((i) => fs.existsSync(path.join(ROOT, i.src.slice(1)))); })());
const withOg = pages.filter((f) => /<meta property="og:url"/.test(read(f)));
t('every public page links the SVG favicon, the .ico, the touch icon and the manifest', withOg.length > 40 && withOg.every((f) => { const h = read(f); return /<link rel="icon" href="\/assets\/brand\/favicon\.svg"/.test(h) && /<link rel="icon" href="\/favicon\.ico"/.test(h) && /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"/.test(h) && /<link rel="manifest" href="\/site\.webmanifest"/.test(h); }));
t('every public page has og:image (absolute https, 1200x630, png, alt), twitter:card summary_large_image, twitter:image and its alt', withOg.every((f) => { const h = read(f); return /<meta property="og:image" content="https:\/\/getcitehound\.com\/assets\/brand\/og-[a-z-]+\.png\?v=\d+"/.test(h) && /og:image:width" content="1200"/.test(h) && /og:image:height" content="630"/.test(h) && /og:image:type" content="image\/png"/.test(h) && /og:image:alt" content="[^"]{20,}"/.test(h) && /twitter:card" content="summary_large_image"/.test(h) && /twitter:image" content="https:\/\/getcitehound\.com/.test(h) && /twitter:image:alt" content="[^"]{20,}"/.test(h); }));
t('each page type has its own image file and a distinct alt text (lib/og.js)', Object.keys(og.TYPES).every((k) => fs.existsSync(path.join(ROOT, 'assets/brand', og.TYPES[k].file))) && new Set(Object.keys(og.TYPES).map((k) => og.TYPES[k].alt)).size === Object.keys(og.TYPES).length && ['default', 'home', 'pricing', 'claude', 'api', 'integrations', 'tools', 'compare', 'about'].every((k) => og.TYPES[k]));

// the guide and the packs
const guide = read('docs/brand/BRAND.md'), json = JSON.parse(read('brand/brand.json'));
t('the guide has every section the brief lists, the door rule, ten scene prompts and twelve series', ['Brand idea and positioning', 'Logo', 'Colour', 'Type', 'Visual language', 'Motion', 'Tone of voice', 'Video guidelines', 'AI video and image prompt kit', 'Twelve content series', 'The brand prompt'].every((h) => guide.indexOf(h) !== -1) && /The door rule/.test(guide) && (guide.match(/^\d+\. \*\*[^*]+\*\* "/gm) || []).length === 10 && (guide.match(/^(1[0-2]|[1-9])\. \*\*[^*]+\*\*\s/gm) || []).length >= 12);
t('the guide states the hard limits: readiness not recommendation, no outcome promises, no invented numbers or testimonials, no official/verified/partner, no third-party logos', ['recommends, cites, ranks or names a brand', 'No outcome promises', 'No invented numbers', 'No "official", "verified" or "partner"', 'No third-party logos'].every((x) => guide.indexOf(x) !== -1 || guide.indexOf(x.replace('No ', 'no ')) !== -1));
t('brand.json is complete and its colours equal the stylesheet tokens', ['logo', 'color', 'type', 'spacing', 'radius', 'motion', 'voice', 'video'].every((k) => json[k]) && (() => { const css = read('styles.css'); const m = (n) => new RegExp(n + ':\\s*(#[0-9A-Fa-f]{6})').exec(css)[1].toUpperCase(); return m('--navy-950') === json.color.ink && m('--bg') === json.color.paper && m('--gold') === json.color.orange && m('--ok') === json.color.statusOpen && m('--risk') === json.color.statusBlocked; })());
t('brand/brand-prompt.txt is the one-page prompt of the guide and carries the hard limits', read('brand/brand-prompt.txt').indexOf('measures readiness') !== -1 && guide.indexOf(read('brand/brand-prompt.txt').trim()) !== -1);
const list = (d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => /\.png$/.test(f));
t('the READMEs of the social pack and the listing icons name every file', list('brand/social').every((f) => read('brand/social/README.md').indexOf(f) !== -1 || read('brand/social/README.md').indexOf(f.replace(/-\d+x\d+/, '').replace('.png', '')) !== -1) && list('brand/listing-icons').every((f) => read('brand/listing-icons/README.md').indexOf(f.replace(/-(512|1024)\.png$/, '')) !== -1) && /help\.x\.com/.test(read('brand/social/README.md')) && /docs\.github\.com/.test(read('brand/social/README.md')));
t('the social pack has the files the brief lists at the sizes of the platforms', ['x-profile-400x400', 'x-header-1500x500', 'linkedin-logo-300x300', 'linkedin-cover-1128x191', 'youtube-icon-800x800', 'youtube-banner-2560x1440', 'github-org-avatar-500x500', 'github-social-preview-1280x640', 'producthunt-logo-240x240', 'producthunt-gallery-1270x760', 'post-square-1080x1080', 'story-vertical-1080x1920', 'video-thumbnail-1280x720'].every((n) => fs.existsSync(path.join(ROOT, 'brand/social', n + '.png'))) && fs.existsSync(path.join(ROOT, 'brand/listing-icons/citehound-icon-512.png')) && fs.existsSync(path.join(ROOT, 'brand/listing-icons/citehound-icon-1024.png')));
t('the pack and the guide are kept off the deployed site (.vercelignore, anchored) and the middleware blocks brand/ files but not the /brand page', /^\/brand\/$/m.test(read('.vercelignore')) && /BLOCKED_SUBTREES = \['brand'\]/.test(read('middleware.js')) && !/^brand\/$/m.test(read('.vercelignore')));
t('the plugin folder was not touched by the brand work (its icon is still its own file)', fs.existsSync(path.join(ROOT, 'claude-plugin/.claude-plugin/icon.png')));
console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
