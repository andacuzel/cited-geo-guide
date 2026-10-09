#!/usr/bin/env node
/* =====================================================================
   scripts/test-pro-report.js

   Renders the Pro layout (lib/report-render.js renderPro) from the frozen sample and
   from a Pro job, and checks the page: the three parts in order with the estimate
   last, a header row on every table, the exact note under the estimate, no simulation
   block, no ranking words, no banned words, alphabetical page order, every figure equal
   to a recomputation, valid ids, no contact data, and the email button only when asked.

     node scripts/test-pro-report.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const render = require('../lib/report-render.js');
const schema = require('../lib/schema.js');
const Estimate = require('../lib/pro-estimate.js');
const S = require('../lib/pro-store.js');
const page = require('../lib/pro-report-page.js');
const { jobToReportData } = require('../lib/pro-data.js');
const { standalone } = require('./build-standalone-report.js');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; const fails = [];
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); console.log((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'pro', 'sample-report.json'), 'utf8'));
const strip = (h) => h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const figs = (html, key) => { const re = new RegExp('data-fig="' + key + '">([^<]*)<', 'g'); const o = []; let m; while ((m = re.exec(html))) o.push(m[1]); return o; };

const RANKING = /\b(worst|best|top|weak(est)?|strong(est)?|rank(s|ed|ing)?|highest|lowest|leading|bottom|better|poor(est)?|superior)\b/i;
const BANNED = /\b(quietly|actually|seamlessly|effortless(ly)?|powerful|unlock|elevate|supercharge|game-changing|revolutioni[sz]e|landscape|delve|crucial|robust)\b/i;

function check(label, html, data, est) {
  const text = strip(html);
  const ids = []; html.replace(/\sid="([^"]+)"/g, (m, id) => { ids.push(id); return m; });
  const iSum = html.indexOf('id="pr-summary"'), iDet = html.indexOf('id="pr-details"'), iEst = html.indexOf('id="pr-estimate"');
  t(label + ': three parts in order, estimate last', iSum > 0 && iSum < iDet && iDet < iEst && html.indexOf('<section', iEst + 1) === -1);
  t(label + ': one h1 and it is the domain', (html.match(/<h1[\s>]/g) || []).length === 1 && html.indexOf('<h1 class="pr-title">' + data.domain + '</h1>') !== -1);
  t(label + ': the estimate heading is exact', html.indexOf('>Estimated score if you apply these fixes</h2>') !== -1);
  t(label + ': the readiness note under the estimate is exact', html.indexOf("Estimated from Citehound's scoring rules. It measures readiness, not how often assistants mention you.") !== -1);
  t(label + ': no simulation block, old or new wording', !/simulat|after fixes|projected|what if/i.test(text), (text.match(/simulat|after fixes|projected|what if/i) || [])[0]);
  t(label + ': no ranking words anywhere', !RANKING.test(text), (text.match(RANKING) || [])[0]);
  t(label + ': no banned words', !BANNED.test(text), (text.match(BANNED) || [])[0]);
  t(label + ': every table has a header row and a caption', (html.match(/<table/g) || []).length === (html.match(/<thead/g) || []).length && (html.match(/<table/g) || []).length === (html.match(/<caption/g) || []).length && (html.match(/<table/g) || []).length >= 3);
  t(label + ': every column header has scope', (html.match(/<th(?=[\s>])(?![^>]*scope=)[^>]*>/g) || []).length === 0);
  t(label + ': ids are unique', new Set(ids).size === ids.length, ids.filter((x, i) => ids.indexOf(x) !== i).join(','));
  t(label + ': every nav anchor has its target', (html.match(/<nav class="pr-nav"[\s\S]*?<\/nav>/) || [''])[0].match(/href="#([^"]+)"/g).every((h) => ids.indexOf(h.slice(7, -1)) !== -1));
  t(label + ': no paragraph has more than one em dash', !strip(html).split(/(?<=[.!?])\s/).some((s) => (s.match(/—/g) || []).length > 1) && !/—[^.]*—/.test(text));
  t(label + ': the framing says readiness and not mentions', /measures AI readiness/.test(text) && /does not measure whether or how often AI assistants mention a brand/.test(text));
  t(label + ': no external script or image', !/<script[^>]+src="https?:/.test(html) && !/<img\b/.test(html));

  // Pages: alphabetical by path by default, all of them present.
  const paths = []; html.replace(/<tr role="row" class="pr-row"[^>]*data-path="([^"]*)"/g, (m, p) => { paths.push(p.replace(/&amp;/g, '&')); return m; });
  t(label + ': the page table lists every page, alphabetically by address', paths.length === data.pages.length && paths.every((p, i) => i === 0 || paths[i - 1] <= p));

  // Figures equal a recomputation.
  const ok = data.pages.filter((p) => p.status === 'ok' && p.result);
  const avg = Math.round(ok.reduce((a, p) => a + p.result.total, 0) / ok.length);
  t(label + ': the score on the page is the rounded average of the page scores', figs(html, 'pr-score')[0] === String(avg));
  t(label + ': pages read equals the pages scored', figs(html, 'pr-pages-read')[0] === String(ok.length));
  t(label + ': coverage blocked and not-read match the data', figs(html, 'pr-cov-blocked')[0] === String(data.pages.filter((p) => p.status === 'blocked').length) && figs(html, 'pr-cov-failed')[0] === String(data.pages.filter((p) => ['failed', 'skipped', 'pending'].indexOf(p.status) !== -1).length));
  t(label + ': every page score on the page equals its stored score', figs(html, 'pr-page-score').join(',') === paths.map((p) => { const pg = data.pages.filter((x) => { try { const u = new URL(x.url); return (u.pathname + u.search) === p || (u.hostname + u.pathname) === p; } catch (e) { return false; } })[0]; return pg && pg.status === 'ok' ? String(pg.result.total) : null; }).filter((x) => x !== null).join(','));
  if (est.steps.length) {
    t(label + ': the estimate figures are the estimate module\'s, to the decimal', figs(html, 'pr-est-now')[0] === est.now.toFixed(1) && figs(html, 'pr-est-final')[0] === est.final.toFixed(1) && figs(html, 'pr-est-row-gain').join() === est.steps.map((s) => s.gain.toFixed(1)).join() && figs(html, 'pr-est-row-total').join() === est.steps.map((s) => s.total.toFixed(1)).join());
    const fixRows = (html.match(/<table class="pr-table pr-table--estimate"[\s\S]*?<\/table>/) || [''])[0];
    t(label + ': the estimate has one row per fix', (fixRows.match(/<tr role="row"><th scope="row"/g) || []).length === est.steps.length);
    t(label + ': rows run from the biggest gain to the smallest', est.steps.every((s, i) => i === 0 || s.gain <= est.steps[i - 1].gain));
  }
  t(label + ': the progress strip shows two numbers side by side, with no arrow', !/[→↑↗➜]|&rarr;|&uarr;/.test(html.slice(html.indexOf('pr-strip'), html.indexOf('pr-strip') + 1500)));
  t(label + ': every control has a name', (html.match(/<button[^>]*>\s*<\/button>/g) || []).length === 0 && (html.match(/<a [^>]*><\/a>/g) || []).length === 0);
}

const E = Estimate.estimate(sample);
const html = render.renderPro(sample, { schema, estimate: E, cap: 50, label: 'Sample report', actions: { copy: true, print: true } });
check('sample', html, sample, E);
t('sample: the email button is absent unless asked for', html.indexOf('data-action="email"') === -1 && html.indexOf('data-action="copy-link"') !== -1);
t('sample: print and copy are present', html.indexOf('data-action="print"') !== -1);

// A job built the way the crawler builds one, with a blocked page, a failed one and a skipped one.
(async () => {
  const store = S.createStore(S.memoryAdapter());
  const id = await store.createJob({ domain: 'demo-site.com' });
  const pages = sample.pages.slice(0, 12);
  await store.setPages(id, pages.map((p) => p.url));
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    let rec;
    if (i === 3) rec = { url: p.url, status: 'blocked', error: 'HTTP 403' };
    else if (i === 5) rec = { url: p.url, status: 'failed', error: 'HTTP 500' };
    else if (i === 11) rec = { url: p.url, status: 'skipped', error: 'Stopped' };
    else rec = { url: p.url, status: 'ok', result: p.result, siteInfo: p.siteInfo };
    await store.updatePage(id, i, rec);
  }
  await store.setJob(id, { status: 'partial', phase: 'done', finishedAt: '2026-10-09T10:00:00.000Z', reason: 'The site asked us to slow down (HTTP 429), so we stopped.', siteContext: sample.siteContext, discoverySource: 'sitemap', candidates: 40 });
  const job = await store.getJob(id);
  const data = jobToReportData(job);
  const est = Estimate.estimate(data);
  const out = page.render(job, { emailEnabled: false });
  check('pro job', out, data, est);
  t('pro job: noindex, no referrer and no analytics in the page', /<meta name="robots" content="noindex, nofollow, noarchive"/.test(out) && /<meta name="referrer" content="no-referrer"/.test(out) && !/gtag|analytics|plausible|segment|hotjar|pixel/i.test(out));
  t('pro job: a partial report says so, at the top', /This report covers part of the site\./.test(out) && out.indexOf('pr-notice') < out.indexOf('pr-nav'));
  t('pro job: blocked, failed and skipped pages are in the table with plain reasons', /Blocked by the site \(HTTP 403\)/.test(out) && /Not read: HTTP 500/.test(out) && /the crawl stopped before this page/.test(out));
  t('pro job: the email button is hidden when email is not configured', out.indexOf('data-action="email"') === -1);
  const on = page.render(job, { emailEnabled: true });
  t('pro job: the email button is present when it is', on.indexOf('data-action="email"') !== -1 && on.indexOf('data-job="' + id + '"') !== -1);
  t('pro job: no contact data in the page', !/@(?!getcitehound\.com)[a-z0-9.-]+\.[a-z]{2,}/i.test(strip(on)));
  t('pro job: the css and script are same-origin and versioned', /href="\/styles\.css\?v=\d+"/.test(out) && /src="\/lib\/report-pro-ui\.js\?v=\d+"/.test(out));
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  t('pro job: the stylesheet version matches the rest of the site', css.length > 0 && out.indexOf('styles.css?v=' + page.CSS_VERSION) !== -1 && fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').indexOf('styles.css?v=' + page.CSS_VERSION) !== -1);

  const running = await store.createJob({ domain: 'demo-site.com' });
  const prog = page.render(await store.getJob(running), {});
  t('a running job gets the progress screen, not an empty report', /data-pro-job="[a-f0-9]{32}"/.test(prog) && prog.indexOf('pr-report') === -1 && prog.indexOf('/app/pro-progress.js') !== -1);
  await store.setJob(running, { status: 'failed', reason: 'The site’s robots.txt asks CitehoundBot not to visit it.' });
  const failedPage = page.render(await store.getJob(running), {});
  t('a failed job says why', /We could not make this report/.test(failedPage) && /robots\.txt asks CitehoundBot/.test(failedPage));
  const nf = page.notFoundPage();
  t('the not-found page is generic', /This report is not available/.test(nf) && !/expire|90 days|invalid|unknown/i.test(strip(nf)) && /noindex/.test(nf));

  // The same layout as one self-contained file for scripts/encrypt-report.js.
  const alone = standalone(data, { label: 'Private report', fonts: '/* fonts */' });
  t('standalone: one file with the styles and the script inline and no external request', /<style>/.test(alone) && /<script>/.test(alone) && !/<link[^>]+href="https?:/.test(alone) && !/<script[^>]+src=/.test(alone) && !/<img\b/.test(alone));
  t('standalone: the same layout, estimate last, noindex', alone.indexOf('id="pr-estimate"') > alone.indexOf('id="pr-details"') && /noindex, nofollow, noarchive/.test(alone));
  check('standalone', alone, data, est);

  // Escaping: a hostile domain or path cannot add markup.
  const evil = JSON.parse(JSON.stringify(data));
  evil.domain = 'x"><script>alert(1)</script>.com';
  evil.pages[1].url = 'https://demo-site.com/<img src=x onerror=alert(1)>';
  const eh = render.renderPro(evil, { schema, estimate: est, cap: 25, actions: {} });
  t('hostile text is escaped', eh.indexOf('<script>alert(1)') === -1 && eh.indexOf('<img src=x') === -1);

  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.error('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
