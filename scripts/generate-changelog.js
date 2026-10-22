#!/usr/bin/env node
/* =====================================================================
   scripts/generate-changelog.js

   Writes changelog.html (served at /changelog) from content/changelog.json,
   newest first, with the inner-page banner and a link to the methodology
   changelog, where scoring changes are recorded.

   content/changelog.json is drafted from the git history of main: only changes
   a visitor or an MCP user can see (pages, tools, checks, research), related
   commits merged into one entry, one plain factual sentence each, with the
   commit hashes as refs. --check verifies that every ref is a real commit on
   the history of HEAD and that each entry's date equals the date of its newest
   ref.

     node scripts/generate-changelog.js           write the page (noindex, not in the sitemap)
     node scripts/generate-changelog.js --check   exit 1 on any mismatch
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const shell = require('../lib/page-shell.js');
const site = require('../lib/site-config.js');
const icons = require('../lib/icons.js');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'content', 'changelog.json');
const PAGE = path.join(ROOT, 'changelog.html');
const CSS_VERSION = 105;
const esc = shell.esc;

const git = (args) => cp.execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

function build(data) {
  const entries = data.entries.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const items = entries.map((e) => '          <li><span class="n">' + esc(e.date) + '</span><span>' + esc(e.text) + ' <span class="cl-refs">' + e.refs.map((r) => '<code>' + esc(r) + '</code>').join(' ') + '</span></span></li>').join('\n');
  const desc = 'Every visible change to the Citehound site, scanner and MCP server, newest first, with the commits behind it. Scoring changes are in the methodology.';
  const body = shell.banner({ kicker: 'Changelog', title: 'What changed, and when.', desc: 'Pages, tools, checks, research and MCP tools that a visitor can see, newest first. Each entry lists the commits behind it.', icon: icons.svg('clock', {}) }) +
    '\n    <section class="verticals" aria-labelledby="log-heading">\n      <div class="section__inner">\n        <div class="doc-section">\n          <h2 id="log-heading" class="doc-section__heading">' + entries.length + ' changes</h2>\n' +
    '          <p>Entries are drawn from the project\'s git history and cover only what a visitor or an MCP user can see. Changes to how the score is calculated are also recorded in the <a href="/methodology#changelog-heading">methodology changelog</a>.</p>\n        </div>\n' +
    '        <ol class="changelog-list cl-list">\n' + items + '\n        </ol>\n      </div>\n    </section>\n';
  return shell.page({
    title: 'Citehound — Changelog: What Changed on the Site',
    description: desc,
    path: '/changelog',
    robots: 'noindex, follow',   // 11 Oct 2026: kept at its address but out of search, the footer, the sitemap and llms.txt until the owner decides
    cssVersion: CSS_VERSION,
    jsonld: [{ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Citehound changelog', description: desc, url: site.baseUrl + '/changelog' }],
    body: body
  });
}

// The page is noindex and not in the sitemap (owner's decision, 11 Oct 2026); this takes an older entry out.
function removeFromSitemap() {
  const file = path.join(ROOT, 'sitemap.xml');
  const xml = fs.readFileSync(file, 'utf8');
  const next = xml.replace(/\n?  <url>\n    <loc>[^<]*\/changelog<\/loc>\n  <\/url>/, '');
  if (next === xml) return false;
  fs.writeFileSync(file, next, 'utf8');
  return true;
}

function verify(data) {
  const errors = [];
  data.entries.forEach((e, i) => {
    const where = 'entry ' + (i + 1) + ' ("' + e.text.slice(0, 40) + '...")';
    if (!e.refs || !e.refs.length) { errors.push(where + ' has no refs'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) errors.push(where + ': date is not YYYY-MM-DD');
    if (/\b(powerful|seamless|game-changing|revolutionary|robust|crucial|unlock|elevate|landscape|delve|effortless|supercharge|quietly|actually|coming soon)\b/i.test(e.text)) errors.push(where + ': banned word');
    if (/\b(recommended|best|amazing|great|exciting|improved|better)\b/i.test(e.text)) errors.push(where + ': an adjective or a claim; keep it factual');
    const dates = [];
    e.refs.forEach((r) => {
      try {
        git(['rev-parse', '--verify', r + '^{commit}']);
        git(['merge-base', '--is-ancestor', r, 'HEAD']);
        dates.push(git(['log', '-1', '--format=%ad', '--date=short', r]));
      } catch (err) { errors.push(where + ': ref ' + r + ' is not a commit on this history'); }
    });
    if (dates.length === e.refs.length && dates.slice().sort().pop() !== e.date) errors.push(where + ': date ' + e.date + ' is not the date of its newest ref (' + dates.slice().sort().pop() + ')');
  });
  return errors;
}

function main() {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const html = build(data);
  if (process.argv.indexOf('--check') !== -1) {
    const errors = verify(data);
    if (!fs.existsSync(PAGE) || fs.readFileSync(PAGE, 'utf8') !== html) errors.push('changelog.html is out of date; run node scripts/generate-changelog.js');
    if (fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').indexOf('/changelog</loc>') !== -1) errors.push('sitemap.xml must not list /changelog (the page is noindex)');
    if (!/name="robots" content="noindex, follow"/.test(html)) errors.push('changelog.html must be noindex');
    if ((html.match(/<h1[ >]/g) || []).length !== 1) errors.push('changelog.html needs exactly one h1');
    if (errors.length) { errors.forEach((m) => console.error('FAIL: ' + m)); process.exit(1); }
    console.log('OK: ' + data.entries.length + ' changelog entries; every ref is a commit on this history and every date is the date of its newest ref; changelog.html is current');
    return;
  }
  const errors = verify(data);
  if (errors.length) { errors.forEach((m) => console.error('FAIL: ' + m)); process.exit(1); }
  fs.writeFileSync(PAGE, html, 'utf8');
  console.log('changelog.html written; ' + (removeFromSitemap() ? 'removed from sitemap.xml' : 'not in sitemap.xml'));
}

if (require.main === module) main();
module.exports = { build, verify };
