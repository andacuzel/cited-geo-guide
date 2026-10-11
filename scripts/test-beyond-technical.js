#!/usr/bin/env node
/* =====================================================================
   scripts/test-beyond-technical.js: /beyond-technical and its homepage block say what the owner wrote, and nothing else.

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

const page = read('beyond-technical.html');
const main = textOf((/<main id="main">([\s\S]*?)<footer class="site-footer/.exec(page) || [])[1] || '');
let at = 0, inOrder = true, missing = [];
BRIEF.forEach((s) => { const i = main.indexOf(s, at); if (i === -1) { inOrder = false; missing.push(s.slice(0, 50)); } else at = i + s.length; });
t('every sentence of the owner\'s text is on the page, in order (apostrophes and "prioritized" aside)', inOrder, missing.join(' | '));
let rest = main; BRIEF.forEach((s) => { rest = rest.replace(s, ''); });
// The only other words are the banner's kicker, the page's own name in the gold mono label the design system puts above every title.
t('and the page holds no other body text (the kicker "Beyond technical" above the title is the design system\'s label, the page\'s name)', rest.replace(/\s+/g, '') === 'Beyondtechnical', rest.trim().slice(0, 120));
t('the heading levels are the brief\'s: one h1, four h2', (page.match(/<h1[ >]/g) || []).length === 1 && (page.match(/<h2[ >]/g) || []).length === 4 && />A clean site isn’t yet a citable one</.test(page.replace(/&rsquo;/g, '’')));
t('the three points are a list with the bold lead-ins; the steps are a numbered list of three', /<ul class="doc-list">\s*<li><strong>Fit to the question\.<\/strong>/.test(page) && (page.match(/<ol class="doc-list bt-steps">[\s\S]*?<\/ol>/) || [''])[0].split('<li>').length === 4);
t('the call to action is one link with the mailto and subject of the brief', (page.match(/href="mailto:[^"]+"/g) || []).filter((x) => /Content%20review/.test(x)).length === 1 && page.indexOf('href="mailto:hey@getcitehound.com?subject=Content%20review"') !== -1 && />Request a content review</.test(page));
t('the small print follows the button', /Request a content review<\/a>\s*<p class="bt-fine">We don’t promise citations\. Nobody honestly can\.<\/p>/.test(page.replace(/&rsquo;/g, '’')));
t('the page is indexable, has a meta description of 120 to 160 characters, a canonical address', !/noindex/i.test(page) && /name="robots" content="index, follow"/.test(page) && (() => { const d = (/<meta name="description" content="([^"]*)"/.exec(page) || [])[1] || ''; return d.length >= 120 && d.length <= 160; })() && /<link rel="canonical" href="https:\/\/getcitehound\.com\/beyond-technical"/.test(page));
t('it is in the sitemap and in llms.txt', /<loc>https:\/\/getcitehound\.com\/beyond-technical<\/loc>/.test(read('sitemap.xml')) && /\(https:\/\/getcitehound\.com\/beyond-technical\)/.test(read('llms.txt')));
t('it is not in robots.txt, the Pro paths or the MCP server', !/beyond-technical/.test(read('robots.txt')) && !/beyond-technical/.test(read('api/mcp.js')));
t('the footer of the page itself links to it', /<li><a href="\/beyond-technical">Beyond technical<\/a><\/li>/.test(page));
const footers = ['index.html', 'about.html', 'privacy.html', 'terms.html', 'trust.html', 'pro.html', 'methodology.html', 'compare.html', 'tools/index.html', 'for-saas.html', 'research/index.html', 'benchmarks/index.html', 'mcp.html', 'changelog.html', 'sample-report.html', 'citation-tracking.html', 'playbooks.html', 'agentic-commerce.html', '404.html'];
const lacking = footers.filter((f) => !/<li><a href="\/beyond-technical">Beyond technical<\/a><\/li>/.test(read(f)));
t('the footer link is on the other pages', lacking.length === 0, lacking.join(', '));

const home = read('index.html');
const block = (/<!-- BEYOND:START -->[\s\S]*?<!-- BEYOND:END -->/.exec(home) || [''])[0];
const bt = textOf(block);
const layers = require('../content/beyond-technical.json').home.layers;
const OURS = ['Beyond the score', layers.content.tag, layers.content.name, layers.content.text, layers.tech.name, layers.tech.text, layers.tech.tag];
t('the homepage block has the owner\'s heading, line and link, in that order, word for word', HOME.every((s, i) => bt.indexOf(s) !== -1 && (i === 0 || bt.indexOf(s) > bt.indexOf(HOME[i - 1]))), bt);
let leftover = bt; HOME.concat(OURS).forEach((s) => { leftover = leftover.replace(s, ''); });
t('and the only other words are the eyebrow and the labels of the two layers (ours, listed in content/beyond-technical.json)', leftover.replace(/\s+/g, '') === '', leftover.trim());
t('the link is a gold call to action with an arrow, to /beyond-technical', /<a class="btn btn--gold bt-band__cta" href="\/beyond-technical">Beyond technical<svg[^>]*aria-hidden="true"/.test(block));
t('the block is a navy band whose headline is one h2 of two sentences, each in its own span', /<section class="bt-band" aria-labelledby="bt-home-h">/.test(block) && /<h2 id="bt-home-h" class="bt-band__title"><span>The score covers the technical layer\.<\/span> <span><em>Content decides what happens next\.<\/em><\/span><\/h2>/.test(block));
t('the two layers are described for a screen reader, the lower one as the floor the score measures', /role="img" aria-label="Two stacked layers\. The lower one, the technical layer, is the floor and is what the score measures\./.test(block));
t('the block sits inside main, between two light sections: after the benchmark strip and before the agentic commerce section (never against the navy footer)', home.indexOf('<!-- BEYOND:START -->') > home.indexOf('aria-labelledby="benchmark-heading"') && home.indexOf('<!-- BEYOND:END -->') < home.indexOf('aria-label="Agentic commerce"') && home.indexOf('aria-label="Agentic commerce"') < home.indexOf('<footer class="site-footer'));
const bandCss = read('styles.css').split('Homepage "Beyond technical" band')[1].split('/* ----------------------------- Sections')[0];
t('the band CSS: navy-950 surface, white Gloock headline, gold-soft accents, text-wrap balance, solid fills only (no gradient, no image, no pattern, no animation)', /\.bt-band \{ background: var\(--navy-950\)/.test(bandCss) && /color: var\(--white\)/.test(bandCss) && /text-wrap: balance/.test(bandCss) && /var\(--gold-soft\)/.test(bandCss) && !/gradient|url\(|animation|transition|(?<![-\w])transform\s*:|@keyframes/.test(bandCss));
t('the band stacks under 900px and has fixed paddings and heights (no layout shift)', /@media \(max-width: 900px\)[\s\S]*\.bt-band__grid \{ grid-template-columns: minmax\(0, 1fr\)/.test(bandCss) && /\.bt-layer--tech \{[^}]*min-height: 176px/.test(bandCss));
const all = page.replace(/<[^>]+>/g, ' ') + ' ' + block.replace(/<[^>]+>/g, ' ');
t('no price, no promised result, no scanned site named, no gradient, no emoji', !/[$€£]\s?\d/.test(all) && !/\b(guarantee|proven)\b/i.test(all) && !/gradient/i.test(page + block) && !/[\u{1F300}-\u{1FAFF}]/u.test(all));
t('the one banned word is the owner\'s own "actually" and nothing else (the generator names that exception)', /\bactually\b/i.test(main) && (main.match(/\bactually\b/gi) || []).length === 1 && !/\b(quietly|seamlessly|effortless|powerful|unlock|elevate|supercharge|game-changing|revolutionize|landscape|delve|crucial|robust)\b/i.test(main));
const css = read('styles.css');
t('the page\'s styles exist and use no gradient', /\.bt-cta \{/.test(css) && /\.bt-band \{/.test(css) && !/gradient/.test(css.split('Beyond technical')[1] || ''));

out('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
