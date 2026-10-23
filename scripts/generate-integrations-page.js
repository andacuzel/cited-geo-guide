#!/usr/bin/env node
/* =====================================================================
   scripts/generate-integrations-page.js

   Writes integrations.html (/integrations) from content/integrations.json, the one status file. Only items whose status is "live" are shown as available, with their description and, where
   there is one, a link. Items that are "ready-to-submit" or "planned" appear only by name in a section headed "In preparation" that says nothing is available yet: no link, no description,
   no install step, no logo. To make an item available, change its status to "live" (after it is published AND self-tested) and add its description; then run this script.
   The sitemap, the footer and /api point here; the footer comes from lib/site-footer.js.

   --check fails if the page is out of date, if a status is not one of the three, if a live item has no description, if an item that is not live has a link or a description, if the page makes a
   claim the brief forbids, if it has no single H1, if a title or description is too long, if the JSON-LD does not parse, if an internal link points at a page that does not exist, or if the
   sitemap, the footer or /api do not point here.

     node scripts/generate-integrations-page.js            write the page and the sitemap entry
     node scripts/generate-integrations-page.js --check    exit 1 on any mismatch
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const shell = require('../lib/page-shell.js');
const site = require('../lib/site-config.js');
const data = require('../content/integrations.json');

const ROOT = path.resolve(__dirname, '..');
const CSS_VERSION = 105;
const esc = shell.esc;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const TITLE = 'Citehound integrations: what is available';
const DESC = 'Ways to use Citehound now: the Claude connector and plugin, the MCP Registry listing, the GitHub Action, the public API, the command line and n8n.';
const H1 = 'Where you can use Citehound';

const live = data.items.filter((i) => i.status === 'live');
const waiting = data.items.filter((i) => i.status !== 'live');
const installs = (i) => [].concat(i.install || []);

function body() {
  const cards = live.map((i) => '          <li class="cl-prompt"><p class="cl-prompt__text">' + (i.url ? '<a href="' + esc(i.url) + '">' + esc(i.name) + '</a>' : esc(i.name)) + '</p><p class="cl-prompt__tool">' + esc(i.description) + '</p>' + installs(i).map((l) => '<p class="cl-prompt__tool"><code>' + esc(l) + '</code></p>').join('') + '</li>').join('\n');
  return '    <section aria-labelledby="hero-heading">\n      <div class="section__inner">\n        <div class="page-banner">\n          <div class="page-banner__body">\n            <p class="kicker kicker--on-navy">Integrations</p>\n' +
    '            <h1 id="hero-heading" class="page-banner__title">' + esc(H1) + '</h1>\n' +
    '            <p class="page-banner__desc">' + ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'][live.length] + ' ways to use Citehound are available now. They measure AI readiness: crawler access and on-page signals. The score does not measure whether any assistant names a brand.</p>\n' +
    '          </div>\n        </div>\n      </div>\n    </section>\n\n' +
    '    <section class="cl-sec hp-light" id="available" aria-labelledby="available-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">Available</p>\n          <h2 id="available-heading" class="section-title">Available now.</h2>\n        </div>\n' +
    '        <ul class="cl-prompts">\n' + cards + '\n        </ul>\n      </div>\n    </section>\n\n' +
    '    <section class="cl-sec hp-light" id="preparation" aria-labelledby="preparation-heading">\n      <div class="section__inner">\n        <div class="section-head">\n          <p class="kicker">In preparation</p>\n          <h2 id="preparation-heading" class="section-title">In preparation.</h2>\n          <p class="section-sub">Nothing in this list is available yet.</p>\n        </div>\n' +
    '        <p class="cl-limits">' + waiting.map((i) => esc(i.name)).join(', ') + '.</p>\n' +
    '        <p class="cl-contact">Questions: <a href="mailto:' + esc(site.contactEmail) + '">' + esc(site.contactEmail) + '</a></p>\n      </div>\n    </section>\n';
}

function build() {
  const ld = [{ '@context': 'https://schema.org', '@type': 'WebPage', name: TITLE, description: DESC, url: site.baseUrl + '/integrations', publisher: { '@id': site.baseUrl + '/#org' } }];
  return shell.page({ title: TITLE, description: DESC, path: '/integrations', cssVersion: CSS_VERSION, jsonld: ld, body: body() });
}

function ensureSitemap() {
  const file = path.join(ROOT, 'sitemap.xml'), xml = fs.readFileSync(file, 'utf8'), loc = site.baseUrl + '/integrations';
  if (xml.indexOf('<loc>' + loc + '</loc>') !== -1) return false;
  fs.writeFileSync(file, xml.replace('</urlset>', '  <url>\n    <loc>' + loc + '</loc>\n  </url>\n</urlset>'), 'utf8');
  return true;
}

const visible = (html) => html.replace(/<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const FORBIDDEN = /\b(recommend(s|ed|ation|ations)?|cites|cited by|guarantee[sd]?|partners?|verified|unlock|supercharge|seamless(ly)?|game-changing|revolutioni[sz]e|robust|crucial|delve|landscape|ranking|rankings|ranks|unlimited|certified)\b/i;

function pageExists(href) {
  const p = href.replace(/[?#].*$/, '');
  if (p === '' || p === '/') return true;
  const rel = p.replace(/^\//, '').replace(/\/$/, '');
  return fs.existsSync(path.join(ROOT, rel + '.html')) || fs.existsSync(path.join(ROOT, rel, 'index.html')) || fs.existsSync(path.join(ROOT, rel));
}

function check() {
  const errors = [], bad = (m) => errors.push(m);
  const page = fs.existsSync(path.join(ROOT, 'integrations.html')) ? read('integrations.html') : '';
  if (page !== build()) bad('integrations.html is out of date; run node scripts/generate-integrations-page.js');
  const ids = new Set();
  data.items.forEach((i) => {
    if (ids.has(i.id)) bad('duplicate id ' + i.id); ids.add(i.id);
    if (data.statuses.indexOf(i.status) === -1) bad(i.id + ' has the status "' + i.status + '"');
    if (i.status === 'live' && (!i.description || i.description.length < 40)) bad(i.id + ' is live and has no description');
    if (i.status !== 'live' && (i.url || i.description || i.install)) bad(i.id + ' is not live and must have no link and no description');
  });
  if (!live.length) bad('no live item');
  const text = visible(page.replace(/<header class="site-header">[\s\S]*?<\/header>/, '').replace(/<footer[\s\S]*?<\/footer>/, ''));
  const hit = FORBIDDEN.exec(text); if (hit) bad('a word the brief forbids is on the page: "' + hit[0] + '"');
  const official = (text.match(/\bofficial\w*/gi) || []);
  if (official.length > 1 || (official.length === 1 && !/The official Citehound GitHub Action/.test(text))) bad('"official" is only for the Citehound GitHub Action');
  waiting.forEach((i) => { if (page.indexOf('>' + esc(i.name) + '</a>') !== -1) bad(i.name + ' is not live but is linked'); });
  const prep = /id="preparation"[\s\S]*$/.exec(page);
  if (!prep || /<a href="(?!mailto)/.test(prep[0].replace(/<footer[\s\S]*$/, ''))) bad('the "In preparation" section must carry no link');
  if (/npx |npm install|\/plugin install|marketplace add|zapier push|pd publish|ray develop/i.test(prep ? prep[0] : '')) bad('the "In preparation" section must give no install step');
  data.items.forEach((i) => { if (i.install && i.status !== 'live') bad(i.id + ' has an install line but is not live'); installs(i).forEach((l) => { if (i.status === 'live' && page.indexOf(esc(l)) === -1) bad(i.id + ' install line is not on the page'); }); });
  if (TITLE.length > 60) bad('the title is over 60 characters');
  if (DESC.length < 120 || DESC.length > 160) bad('the description is ' + DESC.length + ' characters, not 120 to 160');
  if ((page.match(/<h1[ >]/g) || []).length !== 1) bad('needs exactly one h1');
  (page.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []).forEach((b) => { try { JSON.parse(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { bad('JSON-LD does not parse'); } });
  (page.match(/href="(\/[^"]*)"/g) || []).forEach((m) => { const h = m.slice(6, -1); if (!pageExists(h)) bad('an internal link points at a page that does not exist: ' + h); });
  if (!/does not measure whether any assistant names a brand/.test(text)) bad('the page must carry the readiness sentence');
  if (read('sitemap.xml').indexOf('<loc>' + site.baseUrl + '/integrations</loc>') === -1) bad('sitemap.xml has no /integrations');
  if (require('../lib/site-footer.js').hrefs().indexOf('/integrations') === -1) bad('the footer has no /integrations link');
  if (!/href="\/integrations"/.test(read('api.html'))) bad('/api does not link to /integrations');
  if (/href="\/integrations"[^>]*>[^<]*<\/a>/.test(read('index.html').replace(/<section class="ints [\s\S]*?<\/section>/, '').replace(/<footer[\s\S]*?<\/footer>/, '').replace(/<header[\s\S]*?<\/header>/, ''))) bad('the homepage carries no integrations link outside its text-only integrations section (the redesign of 23 Oct 2026 added that section)');
  return errors;
}

function main() {
  if (process.argv.indexOf('--check') !== -1) {
    const errors = check();
    if (errors.length) { errors.forEach((e) => console.error('FAIL: ' + e)); process.exit(1); }
    console.log('OK: /integrations is current; ' + live.length + ' live items shown as available, ' + waiting.length + ' only by name under "In preparation", with no link or install step; one h1; JSON-LD parses; in the sitemap, the footer and /api');
    return;
  }
  fs.writeFileSync(path.join(ROOT, 'integrations.html'), build(), 'utf8');
  console.log('written: integrations.html' + (ensureSitemap() ? ', sitemap.xml entry' : ''));
}

if (require.main === module) main();
module.exports = { build: build, check: check };
