#!/usr/bin/env node
/* =====================================================================
   scripts/test-beyond-technical.js: /beyond (formerly /beyond-technical, which redirects) and its homepage block say what the owner wrote, and nothing else.

   The copy below is the owner's text from the brief of 11 October 2026, with straight apostrophes. The page is allowed to differ from it in only
   two ways, both checked here: typographic apostrophes (the site's style) and the US spelling "prioritized" (CLAUDE.md: US English). Every sentence of it
   must be on the page, in order, and the page must hold no other body text. Also: one mailto call to action with the subject, the small print,
   an indexable page in the sitemap, llms.txt and the footer, the homepage block between its markers with the three lines, and no claim, price or
   promise that was not in the text.

     node scripts/test-beyond-technical.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

const BRIEF = [
  "A clean site isn't yet a citable one",
  "The Citehound score tells you whether AI systems can reach your site and read it. It does not tell you whether any of your pages deserves to be picked when someone asks a question. That part is editorial, and a scanner can't do it for you.",
  "What the score can't see",
  "An assistant answering a buyer's question isn't weighing your site against a topic. It is looking for the page, or the part of a page, that answers that specific question well enough to use. Three things follow from that.",
  "Fit to the question. A broad guide and a short, precise answer are judged differently. Which questions your market actually asks, and which of your pages could answer them, is rarely what a content calendar assumes.",
  "Answers you can lift. If the useful part is buried under background, it is harder to use. An FAQ block is the cosmetic version of this fix. The real one is how each page is written.",
  "Reasons to be referenced. Original data, documented methods and honest limits give other people something to cite. What others say about you away from your own domain matters too, and no scanner sees it.",
  "What we know, and what we don't",
  "Nobody outside the AI labs can show you exactly why an assistant cites one page over another. Studies find patterns, and patterns are not causes: popular sites tend to be cited more, and they also tend to have more of everything else. So we treat each content recommendation as a hypothesis. We say how much evidence stands behind it, and we measure before and after with the same set of questions.",
  "Why we don't publish the full method",
  "We could write another ultimate guide. We'd rather not. Content work only pays off when it is matched to your market, your pages and your questions, and that is a conversation, not a checklist. The technical side, Citehound shows you for free. The content side we do with you.",
  "How a content review works",
  "We write the question set for your market, in your customers' language, starting from your site.",
  "We read your pages against those questions: what each page can answer, what it can't, what's missing.",
  "You get a prioritized editorial brief. If you want it measured, we run the same questions before and after and report what changed, including when nothing did.",
  "Request a content review",
  "We don't promise citations. Nobody honestly can."
];
const HOME = ["The score covers the technical layer. Content decides what happens next.", "Being readable by AI is the floor. Being worth citing is an editorial question.", "Beyond technical"];

const norm = (s) => s.replace(/&rsquo;|&#8217;|’/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const textOf = (html) => norm(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' '));

const page = read('beyond.html');
const main = textOf(((/<main id="main">([\s\S]*?)<footer class="site-footer/.exec(page) || [])[1] || '').replace(/<dialog[\s\S]*?<\/dialog>/, ' '));
let at = 0, inOrder = true, missing = [];
BRIEF.forEach((s) => { const i = main.indexOf(s, at); if (i === -1) { inOrder = false; missing.push(s.slice(0, 50)); } else at = i + s.length; });
t('every sentence of the owner\'s text is on the page, in order (apostrophes and "prioritized" aside)', inOrder, missing.join(' | '));
let rest = main; BRIEF.forEach((s) => { rest = rest.replace(s, ''); });
// The only other words are the banner's kicker, the page's own name in the gold mono label the design system puts above every title, and the link to the homepage FAQ answer (the request form is a dialog, not body text).
t('and the page holds no other body text (the kicker "Citehound Beyond" above the title is the design system\'s label, the page\'s name; the lead line from the ladder copy comes first; the FAQ link and the link back to the ladder follow the small print)', rest.replace(/\s+/g, '') === ('CitehoundBeyond' + require('../content/beyond-technical.json').lead.replace(/\u2019/g, "'") + 'Ifnobodycanpromiseacitation,whypay?Backtothefoursteps').replace(/\s+/g, ''), rest.trim().slice(0, 160));
t('the heading levels are the brief\'s: one h1, four h2', (page.replace(/<dialog[\s\S]*?<\/dialog>/, '').match(/<h1[ >]/g) || []).length === 1 && (page.replace(/<dialog[\s\S]*?<\/dialog>/, '').match(/<h2[ >]/g) || []).length === 4 && />A clean site isn’t yet a citable one</.test(page.replace(/&rsquo;/g, '’')));
t('the three points are a list with the bold lead-ins; the steps are a numbered list of three', /<ul class="doc-list">\s*<li><strong>Fit to the question\.<\/strong>/.test(page) && (page.match(/<ol class="doc-list bt-steps">[\s\S]*?<\/ol>/) || [''])[0].split('<li>').length === 4);
t('the call to action is one button that opens the request form for Beyond (the old mailto link is gone)', (page.match(/<button type="button" class="btn btn--gold" data-request="beyond">Request a content review<\/button>/g) || []).length === 1 && !/href="mailto:[^"]*Content%20review/.test(page) && /id="reqDialog"/.test(page));
t('the small print follows the button', /Request a content review<\/button>\s*<p class="bt-fine">We don’t promise citations\. Nobody honestly can\.<\/p>/.test(page.replace(/&rsquo;/g, '’')));
t('the page is indexable, has a meta description of 120 to 160 characters, a canonical address', !/noindex/i.test(page) && /name="robots" content="index, follow"/.test(page) && (() => { const d = (/<meta name="description" content="([^"]*)"/.exec(page) || [])[1] || ''; return d.length >= 120 && d.length <= 160; })() && /<link rel="canonical" href="https:\/\/getcitehound\.com\/beyond"/.test(page));
t('it is in the sitemap and in llms.txt, and the old address is in neither', /<loc>https:\/\/getcitehound\.com\/beyond<\/loc>/.test(read('sitemap.xml')) && /\(https:\/\/getcitehound\.com\/beyond\)/.test(read('llms.txt')) && !/beyond-technical/.test(read('sitemap.xml')) && !/beyond-technical/.test(read('llms.txt')));
t('it is not in robots.txt, the Pro paths or the MCP server, and the old address redirects to it', !/beyond/.test(read('robots.txt')) && !/beyond/.test(read('api/mcp.js')) && /"source": "\/beyond-technical", "destination": "\/beyond", "statusCode": 301/.test(read('vercel.json')));
t('the footer of the page itself links to it', /<li><a href="\/beyond">Beyond<\/a><\/li>/.test(page));
const footers = ['index.html', 'about.html', 'privacy.html', 'terms.html', 'trust.html', 'pro.html', 'methodology.html', 'compare.html', 'tools/index.html', 'for-saas.html', 'research/index.html', 'benchmarks/index.html', 'mcp.html', 'changelog.html', 'sample-report.html', 'citation-tracking.html', 'playbooks.html', 'agentic-commerce.html', '404.html'];
const lacking = footers.filter((f) => !/<li><a href="\/beyond">Beyond<\/a><\/li>/.test(read(f)));
t('the footer link is on the other pages', lacking.length === 0, lacking.join(', '));

const home = read('index.html');
const block = (/<!-- BEYOND:START -->[\s\S]*?<!-- BEYOND:END -->/.exec(home) || [''])[0];
const bt = textOf(block);
const layers = require('../content/beyond-technical.json').home.layers;
const OURS = ['Beyond the score', layers.content.tag, layers.content.name, layers.content.text, layers.tech.name, layers.tech.text, layers.tech.tag];
// The homepage panel was retired on 13 Oct 2026 (the ladder's Beyond card replaced it). Where a block still stands, the checks below apply to it.
const tHome = block ? t : function () {};
t('the homepage has no Beyond technical panel and no promise line; its Beyond card is in the ladder', block !== '' || (/<li class="ladder-card ladder-card--beyond">[\s\S]*?href="\/beyond">See Beyond</.test(home) && !/Nobody honestly can/.test(home)));
tHome('the homepage block has the owner\'s heading, line and link, in that order, word for word', HOME.every((s, i) => bt.indexOf(s) !== -1 && (i === 0 || bt.indexOf(s) > bt.indexOf(HOME[i - 1]))), bt);
let leftover = bt; HOME.concat(OURS).forEach((s) => { leftover = leftover.replace(s, ''); });
tHome('and the only other words are the eyebrow and the labels of the two layers (ours, listed in content/beyond-technical.json)', leftover.replace(/\s+/g, '') === '', leftover.trim());
tHome('the link is a gold call to action with an arrow, to /beyond-technical', /<a class="btn btn--gold bt-panel__cta" href="\/beyond-technical">Beyond technical<svg[^>]*aria-hidden="true"/.test(block));
tHome('the block is a contained light panel whose headline is one h2 of two sentences, each in its own span', /<section class="bt-sec" aria-labelledby="bt-home-h">/.test(block) && /<div class="bt-panel">/.test(block) && /<h2 id="bt-home-h" class="bt-panel__title"><span>The score covers the technical layer\.<\/span> <span><em>Content decides what happens next\.<\/em><\/span><\/h2>/.test(block));
tHome('the two layers are described for a screen reader, the lower one as the floor the score measures', /role="img" aria-label="Two stacked layers\. The lower one, the technical layer, is the floor and is what the score measures\./.test(block));
tHome('the block sits inside main on the light page: after the benchmark strip, before the gold commerce card, which comes before the footer', home.indexOf('<!-- BEYOND:START -->') > home.indexOf('aria-labelledby="benchmark-heading"') && home.indexOf('<!-- BEYOND:END -->') < home.indexOf('class="home-tail" aria-label="Agentic commerce"') && home.indexOf('class="home-tail"') < home.indexOf('<footer class="site-footer'));
const panelCss = read('styles.css').split('Homepage "Beyond technical" panel')[1].split('/* ----------------------------- Sections')[0];
tHome('the panel is contained like the commerce card: same radius and the same side alignment (inside section__inner), white with a hairline border, not full-bleed', /\.bt-panel \{[^}]*background: var\(--white\)[^}]*border: 1px solid var\(--line\)[^}]*border-radius: var\(--radius\)/.test(panelCss) && /\.commerce-strip \{[^}]*border-radius: var\(--radius\)/.test(read('styles.css')) && /<div class="section__inner">\s*<div class="bt-panel">/.test(block) && !/navy-950\)[^;]*;[^}]*\.bt-sec/.test(panelCss) && !/\.bt-sec \{[^}]*background/.test(panelCss));
tHome('the texture is an inline SVG pattern of hard-edged dots at low opacity (no gradient function, no image file), aria-hidden, behind the text', /<svg class="bt-panel__dots"[^>]*aria-hidden="true"[\s\S]*?<pattern id="btDots"[\s\S]*?<circle[^>]*r="1\.1"/.test(block) && /\.bt-panel__dots \{[^}]*opacity: 0\.1;[^}]*pointer-events: none/.test(panelCss) && !/gradient|url\(/.test(panelCss));
tHome('headline navy Gloock with the second sentence in gold-deep; the eyebrow is the mono kicker; the call to action is the gold button', /\.bt-panel__title \{[^}]*var\(--font-display\)[^}]*var\(--navy-950\)[^}]*text-wrap: balance/.test(panelCss) && /\.bt-panel__title em \{[^}]*var\(--gold-deep\)/.test(panelCss) && /<p class="kicker">Beyond the score<\/p>/.test(block) && /class="btn btn--gold bt-panel__cta"/.test(block));
tHome('the left column is one top-aligned group (the row aligns to the start, no vertical centring, no dead gap)', /\.bt-panel__grid \{[^}]*align-items: start/.test(panelCss) && !/align-items: center/.test(panelCss));
tHome('the layers keep their overlap and are recoloured for the light panel: white content card with a gold border above a navy technical card', /\.bt-layer--tech \{[^}]*margin-top: -28px[^}]*background: var\(--navy-950\)/.test(panelCss) && /\.bt-layer--content \{[^}]*background: var\(--white\)[^}]*border: 1px solid var\(--gold\)/.test(panelCss));
tHome('the panel stacks under 900px and has fixed paddings and heights (no layout shift); no JavaScript is involved', /@media \(max-width: 900px\)[\s\S]*\.bt-panel__grid \{ grid-template-columns: minmax\(0, 1fr\)/.test(panelCss) && /\.bt-layer--tech \{[^}]*min-height: 176px/.test(panelCss) && !/<script/.test(block));
tHome('equal 64px rhythm: above the panel (the strip\'s 48px plus 16px), below it, and under the commerce card; 48px on a phone; the commerce card itself is unchanged', /\.bt-sec \{ padding: 16px 0 64px; \}/.test(panelCss) && /\.home-tail \{ padding-bottom: 64px; \}/.test(panelCss) && /\.benchmark-strip \{ padding: 40px 0 48px;/.test(read('styles.css')) && /@media \(max-width: 700px\) \{\s*\.bt-sec \{ padding: 0 0 48px; \}\s*\.home-tail \{ padding-bottom: 48px; \}/.test(panelCss) && /\.commerce-strip \{\s*background: var\(--gold\);\s*border-radius: var\(--radius\);\s*padding: 44px 48px;/.test(read('styles.css')));
const all = page.replace(/<[^>]+>/g, ' ') + ' ' + block.replace(/<[^>]+>/g, ' ');
t('no price, no promised result, no scanned site named, no gradient, no emoji', !/[$€£]\s?\d/.test(all) && !/\b(guarantee|proven)\b/i.test(all) && !/gradient/i.test(page + block) && !/[\u{1F300}-\u{1FAFF}]/u.test(all));
t('the one banned word is the owner\'s own "actually" and nothing else (the generator names that exception)', /\bactually\b/i.test(main) && (main.match(/\bactually\b/gi) || []).length === 1 && !/\b(quietly|seamlessly|effortless|powerful|unlock|elevate|supercharge|game-changing|revolutionize|landscape|delve|crucial|robust)\b/i.test(main));
const css = read('styles.css');
t('the page\'s styles exist and use no gradient', /\.bt-cta \{/.test(css) && /\.bt-panel \{/.test(css) && !/gradient/.test(css.split('Beyond technical')[1] || ''));

out('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
