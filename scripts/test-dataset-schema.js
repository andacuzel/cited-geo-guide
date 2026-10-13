#!/usr/bin/env node
/* =====================================================================
   scripts/test-dataset-schema.js: every Dataset JSON-LD block on the site is valid and says the same thing about its maker and its licence.

   Found by reading every tracked page (a block alone, or inside an @graph). Each must have: a name (110 characters at most, Google's limit), a description of 50 to
   5,000 characters, an absolute url equal to the page's canonical address, temporalCoverage as an ISO date or interval, variableMeasured, dateModified as an
   ISO date when present, a creator that is an Organization OBJECT (name Citehound, url https://getcitehound.com; a bare {"@id"} reference is what Search
   Console called an "invalid object type for creator"), and license https://creativecommons.org/licenses/by/4.0/. The page must also say it in one visible
   line: the aggregate figures on the page are CC BY 4.0, the gated PDF and the raw scan data are excluded. The State of AI Readiness page carries no
   Dataset block (an Article only), and the test says so rather than assuming.

     node scripts/test-dataset-schema.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const DL = require('../lib/dataset-license.js');
const site = require('../lib/site-config.js');
const ROOT = path.resolve(__dirname, '..');
let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

const pages = cp.execSync('git ls-files "*.html"', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean).filter((f) => !/^(app|r)\//.test(f));
const ISO = /^\d{4}-\d\d-\d\d$/;
const found = [];
pages.forEach((f) => {
  const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
  (html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []).forEach((b) => {
    let j; try { j = JSON.parse(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { t(f + ': its JSON-LD parses', false, e.message); return; }
    (Array.isArray(j['@graph']) ? j['@graph'] : [j]).forEach((x) => { if (x && x['@type'] === 'Dataset') found.push({ file: f, html: html, ld: x }); });
  });
});

t('the site has nine Dataset blocks: the benchmark index, the six category pages, the crawler access study and the llms.txt adoption study', found.length === 9 && found.map((x) => x.file).sort().join() === ['benchmarks/consumer-apps.html', 'benchmarks/crm.html', 'benchmarks/cybersecurity.html', 'benchmarks/devtools.html', 'benchmarks/dtc-brands.html', 'benchmarks/hospitality.html', 'benchmarks/index.html', 'research/crawler-access-2026.html', 'research/llms-txt-adoption-2026.html'].join(), found.map((x) => x.file).join());
const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').replace(/ ([.,])/g, '$1');

found.forEach(({ file, html, ld }) => {
  const canon = (/<link rel="canonical" href="([^"]+)"/.exec(html) || [])[1];
  const c = ld.creator;
  t(file + ': name, at most 110 characters', typeof ld.name === 'string' && ld.name.length > 10 && ld.name.length <= 110, String((ld.name || '').length));
  t(file + ': description of 50 to 5,000 characters', typeof ld.description === 'string' && ld.description.length >= 50 && ld.description.length <= 5000, String((ld.description || '').length));
  t(file + ': url is absolute and equals the canonical address', typeof ld.url === 'string' && /^https:\/\//.test(ld.url) && ld.url === canon, ld.url + ' vs ' + canon);
  t(file + ': temporalCoverage is an ISO date or interval', typeof ld.temporalCoverage === 'string' && ld.temporalCoverage.split('/').length <= 2 && ld.temporalCoverage.split('/').every((d) => ISO.test(d) && !isNaN(Date.parse(d))), ld.temporalCoverage);
  t(file + ': variableMeasured is present', ld.variableMeasured !== undefined && ld.variableMeasured !== null && ld.variableMeasured !== '' && (!Array.isArray(ld.variableMeasured) || ld.variableMeasured.length > 0));
  t(file + ': dateModified, when present, is an ISO date', ld.dateModified === undefined || (ISO.test(ld.dateModified) && !isNaN(Date.parse(ld.dateModified))));
  t(file + ': creator is an Organization object with name Citehound and url ' + site.baseUrl + ' (not a bare @id reference)', !!c && typeof c === 'object' && c['@type'] === 'Organization' && c.name === 'Citehound' && c.url === 'https://getcitehound.com' && c.url === site.baseUrl && c['@id'] === undefined, JSON.stringify(c));
  t(file + ': license is ' + DL.LICENSE_URL, ld.license === DL.LICENSE_URL, String(ld.license));
  const body = text(html);
  t(file + ': the page says in one visible line that the aggregate figures are CC BY 4.0 and the gated PDF and raw data are excluded, with a link to the licence', body.indexOf(DL.LINE_TEXT) !== -1 && html.indexOf('<a href="' + DL.LICENSE_URL + '">CC BY 4.0</a>') !== -1, '');
  t(file + ': that line appears once', body.split(DL.LINE_TEXT).length === 2);
});

// the other Organization on those pages (the site chrome's) is untouched
const ready = fs.readFileSync(path.join(ROOT, 'research', 'state-of-ai-readiness.html'), 'utf8');
t('the State of AI Readiness page has an Article block and no Dataset block, so it needs no licence field (and says no licence it cannot back)', /"@type": "Article"/.test(ready) && !/"@type": "Dataset"/.test(ready) && !/creativecommons/.test(ready));
t('the licence covers aggregate figures only: no page claims it for the PDF, and the PDF is not a public file', !pages.some((f) => /PDF[^.]{0,80}(CC BY|creativecommons)/i.test(text(fs.readFileSync(path.join(ROOT, f), 'utf8')))) && cp.execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => /\.pdf$/i.test(f)).length === 0);
t('the one place that writes the Dataset creator and licence for the generators is lib/dataset-license.js', /creator: datasetLicense\.creator\(\)/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'generate-benchmark-pages.js'), 'utf8')) && /creator: datasetLicense\.creator\(\), license: datasetLicense\.LICENSE_URL/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'generate-research-002.js'), 'utf8')));

out('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
