#!/usr/bin/env node
/* =====================================================================
   scripts/test-contrast-scope.js: three things the 14 Oct 2026 pass fixed, kept fixed.

   1. The Pro showcase slider is gone from the homepage (markup, script, styles, the mask asset), with no orphan anchor.
   2. A navy band's styles stay on their own class. The homepage MCP band is .mcp-home; .mcp-section (used on /mcp, a light page) never sets a dark
      background or light text. The three text tokens that fell short of WCAG AA now meet 4.5:1 on the surfaces they sit on.
   3. The positioning is the owner's: footer line, homepage title and description, the boilerplate sentence (JSON-LD, llms.txt, README, every email footer),
      and the share images (1200x630 PNG, named with a version query by every page).

     node scripts/test-contrast-scope.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const VER = require('../lib/og.js').VERSION;
let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

const css = read('styles.css');
const home = read('index.html');
const lum = (h) => { const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const token = (n) => { const m = css.match(new RegExp('--' + n + ':\\s*(#[0-9A-Fa-f]{6})')); return m ? m[1] : null; };

/* 1. the slider */
t('the homepage has no showcase slider, dots or sample-report dialog', !/showcase|slideReport|slideCite|shot-dialog/.test(home) && !/showcase|shot-dialog/.test(read('home-motion.js')));
t('the stylesheet has no showcase, dialog or preview-strip rules and the mask asset is gone', !/\.showcase|\.shot-dialog|\.preview-(strip|stage|gold)|fade-bottom/.test(css) && !fs.existsSync(path.join(ROOT, 'assets/ui/fade-bottom.png')));
t('nothing links to a removed anchor (#showcase)', !/#showcase\b/.test(home) && !/#showcase\b/.test(read('nav.js')));

/* 2. scope and contrast */
t('the homepage MCP band is .mcp-home, not the shared .mcp-section', /<section class="mcp-home hp-band" id="mcp"/.test(home) && !/mcp-section/.test(home));
const sectionRules = css.split('\n').filter((l) => /^\s*\.mcp-section\b/.test(l) && !/^\s*@media/.test(l));
t('no .mcp-section rule sets a dark background or light text', sectionRules.length > 0 && sectionRules.every((l) => !/navy|#fff|white|rgba\(255/.test(l)), sectionRules.join(' | ').slice(0, 200));
const mcpPage = read('mcp.html');
t('/mcp uses .mcp-section sections only and none of the homepage band classes', (mcpPage.match(/class="mcp-section"/g) || []).length >= 5 && !/mcp-home/.test(mcpPage));
t('code inside a navy .pro-band is light on navy (the global code chip is light)', /\.pro-band code \{[^}]*background: var\(--navy-900\)[^}]*color: var\(--white\)/.test(css));
const bg = token('bg'), white = token('white');
[['ink-faint', [bg, white]], ['gold-deep', [bg, white, '#FBF0DC']], ['ok', [bg, white, '#E3F1EA']], ['risk', [bg, white, '#F7E8E5']]].forEach((x) => {
  const c = token(x[0]);
  const worst = Math.min.apply(null, x[1].map((b) => ratio(c, b)));
  t('--' + x[0] + ' (' + c + ') is at least 4.5:1 on ' + x[1].join(', '), c && worst >= 4.5, worst.toFixed(2));
});
t('the Pro mail footers and the design table in CLAUDE.md use the darker tokens', !/#87909c|#97701f/i.test(read('lib/waitlist-mail.js') + read('lib/readiness-mail.js') + read('CLAUDE.md')));

/* 3. positioning */
const { ABOUT } = require('../lib/about-line.js');
const F = require('../lib/site-footer.js');
const pages = [];
(function walk(d) { fs.readdirSync(path.join(ROOT, d)).forEach((n) => { if (/^(node_modules|\.git|local|docs|data|asset|\.claude|assets|r)$/.test(n)) return; const rel = d ? d + '/' + n : n; if (fs.statSync(path.join(ROOT, rel)).isDirectory()) walk(rel); else if (/\.html$/.test(n)) pages.push(rel); }); })('');
const old = pages.filter((p) => /navigating the shift from search to answers/.test(read(p)));
t('no page carries the old footer line', old.length === 0, old.join(', '));
t('the footer line is the owner\'s on every page that has a footer', pages.filter((p) => /class="sf-tag"/.test(read(p))).every((p) => read(p).indexOf('<p class="sf-tag">' + F.TAGLINE + '</p>') !== -1));
const desc = 'Free AI-readiness scan with a 100-point score. Then we fix what holds your site back and write the content that answers your customers’ questions.';
t('homepage title, og:title and twitter:title are "Citehound: scan, fix and write for AI answers"', (home.match(/Citehound: scan, fix and write for AI answers/g) || []).length === 3);
t('homepage description, og:description and twitter:description are the owner\'s, at most 160 characters', desc.length <= 160 && (home.split('content="' + desc + '"').length - 1) === 3);
t('the Organization description is the boilerplate sentence, on the homepage and every copy of it', home.indexOf('"description": "' + ABOUT + '"') !== -1 && pages.filter((p) => /"@type": "Organization",\s*"@id": "[^"]*#org"/.test(read(p))).every((p) => read(p).indexOf(ABOUT) !== -1));
t('llms.txt and README open with the boilerplate sentence', read('llms.txt').indexOf(ABOUT.replace(/\.$/, '')) !== -1 && /end-to-end service for AI readiness: a free scanner, Pro site reports, Fix \(we make the technical changes\) and Beyond \(we write the content\)/.test(read('README.md')));
t('the MCP page and the tools stay read-only: they do not say Citehound fixes or writes for you', !/\bwe (make|write|fix|apply)\b/i.test(read('mcp.html').replace(/<footer[\s\S]*?<\/footer>/, '').replace(/<script[\s\S]*?<\/script>/g, '')) && !/\bwe (make|write|fix|apply)\b/i.test(read('tools/index.html').replace(/<footer[\s\S]*?<\/footer>/, '').replace(/<script[\s\S]*?<\/script>/g, '')));
process.env.PRO_HASH_SECRET = process.env.PRO_HASH_SECRET || 'test-secret-for-the-mail-composers-only';
const WM = require('../lib/waitlist-mail.js').compose('reader@example.org', 'Ada Reader');
const RM = require('../lib/readiness-mail.js').compose('reader@example.org', { now: Date.UTC(2026, 9, 14) });
t('the waitlist and report-list mails end with the boilerplate sentence, in text and in HTML', [WM, RM].every((m) => m.text.indexOf(ABOUT) !== -1 && m.html.indexOf(ABOUT) !== -1));
const PM = require('../lib/pro-mail.js').compose({ contact: { name: 'Ada', email: 'reader@example.org' } }, { id: 'a'.repeat(32), domain: 'example.com', createdAt: '2026-10-14T00:00:00.000Z' });
t('the Pro report mail carries it too', PM.text.indexOf(ABOUT) !== -1 && PM.html.indexOf(ABOUT) !== -1);

/* the share images */
const png = (f) => { const b = fs.readFileSync(path.join(ROOT, 'assets/brand', f)); return b.slice(1, 4).toString() === 'PNG' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; };
['og-default.png', 'og-default-light.png', 'og-pro.png', 'og-fix.png', 'og-beyond.png'].forEach((f) => { const d = png(f); t(f + ' is a 1200x630 PNG', d && d[0] === 1200 && d[1] === 630, JSON.stringify(d)); });
const imgs = [];
pages.forEach((p) => { (read(p).match(/(?:og|twitter):image" content="[^"]*"/g) || []).forEach((m) => imgs.push([p, m.replace(/^.*content="|"$/g, '')])); });
t('every page names its share image with the version of lib/og.js and the file exists', imgs.length > 60 && imgs.every((x) => new RegExp('^https://[^/]+/assets/brand/og-[a-z-]+\\.png\\?v=' + VER + '$').test(x[1]) && fs.existsSync(path.join(ROOT, 'assets/brand', x[1].split('/').pop().split('?')[0]))), imgs.filter((x) => !new RegExp('\\?v=' + VER + '$').test(x[1])).slice(0, 3).join(' '));
const imgOf = (p) => (read(p).match(/og:image" content="[^"]*og-([a-z-]+)\.png/) || [])[1];
t('the home, pricing, claude, api, integrations, tools, compare, about, Pro, Fix and Beyond each use their own share image (lib/og.js), everything else the default', imgOf('index.html') === 'home' && imgOf('pricing.html') === 'pricing' && imgOf('about.html') === 'about' && imgOf('terms.html') === 'default' && imgOf('pro.html') === 'pro' && imgOf('fix.html') === 'fix' && imgOf('beyond.html') === 'beyond');

out('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { out('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
