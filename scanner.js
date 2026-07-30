/* =====================================================================
   ANSWERABLE SCAN — frontend
   All scanning logic now lives server-side in /api/scan.js (Vercel).
   This file only calls the API and renders the result. No proxies,
   no CORS workarounds.
   ===================================================================== */

(function () {
  'use strict';

  var CONFIG = {
    contactEmail: 'you@example.com', // ← replace before deploying
    shareUrl: 'https://answerable-app.vercel.app/' // ← update if you move to a custom domain
  };

  var $ = function (id) { return document.getElementById(id); };

  var form = $('scanForm');
  if (!form) return;

  var input = $('scanInput');
  var scanBtn = $('scanBtn');
  var statusEl = $('scanStatus');
  var retryBtn = $('scanRetry');
  var report = $('scanReport');
  var agencyLink = $('agencyLink');

  if (agencyLink) agencyLink.href = 'mailto:' + CONFIG.contactEmail + '?subject=Answerable%20%E2%80%94%20done-for-you%20AI%20visibility';

  var lastScore = null;
  var pendingIsParamScan = false;

  /* Hand-maintained to match the averages shown in the homepage
     benchmark strip (index.html) — update both together. */
  var BENCHMARKS = [
    { label: 'B2B SaaS', avg: 78 },
    { label: 'Consumer brands', avg: 71 }
  ];

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function showToast(message) {
    var toast = $('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    setTimeout(function () { toast.classList.remove('is-visible'); }, 2600);
  }

  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.classList.toggle('is-error', !!isError);
    retryBtn.classList.toggle('is-visible', !!isError);
  }

  function normalizeDomain(raw) {
    var d = (raw || '').trim().toLowerCase();
    d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)) return null;
    return d;
  }

  /* ---------------- Scan flow ---------------- */

  async function runScan() {
    var domain = normalizeDomain(input.value);
    if (!domain) { setStatus('Enter a valid domain, e.g. example.com', true); return; }

    var isParamScan = pendingIsParamScan;
    pendingIsParamScan = false;

    scanBtn.disabled = true;
    report.hidden = true;

    try {
      setStatus('Scanning\u2026');
      var res = await fetch('/api/scan?domain=' + encodeURIComponent(domain));
      var data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || ('Scan failed (HTTP ' + res.status + ')'));
      }

      renderReport(data.domain, data.robotsOk, data.botResults, data.result, data.siteInfo, isParamScan);
      updateShareableUrl(data.domain);
      setStatus('');
    } catch (err) {
      setStatus('Scan failed: ' + (err && err.message ? err.message : 'connection error'), true);
    } finally {
      scanBtn.disabled = false;
    }
  }

  /* ---------------- Shareable URL ---------------- */

  function updateShareableUrl(domain) {
    try {
      var url = new URL(window.location.href);
      url.searchParams.set('scan', domain);
      history.replaceState(null, '', url.toString());
    } catch (e) { /* URL API unavailable \u2014 leave the address bar as-is */ }
  }

  function benchmarkLine(score) {
    var closest = BENCHMARKS[0];
    var closestDiff = Math.abs(score - closest.avg);
    BENCHMARKS.forEach(function (b) {
      var diff = Math.abs(score - b.avg);
      if (diff < closestDiff) { closest = b; closestDiff = diff; }
    });
    var delta = score - closest.avg;
    if (delta === 0) return 'That\u2019s right at the ' + closest.label + ' average.';
    var points = Math.abs(delta);
    var word = points === 1 ? 'point' : 'points';
    return 'That\u2019s ' + points + ' ' + word + ' ' + (delta > 0 ? 'above' : 'below') + ' the ' + closest.label + ' average.';
  }

  /* ---------------- Render ---------------- */

  function renderReport(domain, robotsOk, botResults, r, siteInfo, scannedFromParam) {
    lastScore = { domain: domain, total: r.total };

    $('scoreValue').textContent = r.total;
    $('scoreDomain').textContent = domain + ' \u00b7 retrieved ' + new Date().toLocaleDateString('en-GB');

    var scannedNowEl = $('scoreScannedNow');
    if (scannedNowEl) {
      if (scannedFromParam) {
        scannedNowEl.textContent = 'Scanned just now \u2014 ' + new Date().toLocaleDateString('en-GB');
        scannedNowEl.hidden = false;
      } else {
        scannedNowEl.hidden = true;
        scannedNowEl.textContent = '';
      }
    }

    var benchmarkEl = $('scoreBenchmark');
    if (benchmarkEl) {
      var line = benchmarkLine(r.total);
      if (line) {
        benchmarkEl.textContent = line;
        benchmarkEl.hidden = false;
      } else {
        benchmarkEl.hidden = true;
        benchmarkEl.textContent = '';
      }
    }

    function bar(fillId, valId, val, max) {
      $(fillId).style.width = Math.round((val / max) * 100) + '%';
      $(valId).textContent = val + '/' + max;
    }
    bar('barDiscover', 'valDiscover', r.discover, 40);
    bar('barTech', 'valTech', r.tech, 20);
    bar('barTrust', 'valTrust', r.trust, 40);

    var chip = {
      open: '<span class="bot-chip bot-chip--open">Open</span>',
      partial: '<span class="bot-chip bot-chip--partial">Limited</span>',
      block: '<span class="bot-chip bot-chip--block">Blocked</span>'
    };
    var botHtml = '<div class="bot-console__label">' + esc(domain) + '/robots.txt \u2014 AI crawler policy</div>';
    if (!robotsOk) botHtml += '<div class="bot-console__note"># no robots.txt found \u2192 all crawlers have default access</div>';
    botResults.forEach(function (b) {
      botHtml += '<div class="bot-row"><span class="bot-row__name">' + esc(b.name) + '</span>' + chip[b.state] +
        '<span class="bot-row__rule">' + esc(b.rule) + ' \u00b7 ' + esc(b.desc) + '</span></div>';
    });
    if (botResults.some(function (b) { return b.state !== 'open'; })) {
      botHtml += '<div class="bot-console__link">Fix this: <a href="/tools/robots-txt">generate a corrected robots.txt</a></div>';
    }
    $('botConsole').innerHTML = botHtml;

    $('checksBody').innerHTML = r.checks.map(function (c) {
      var passed = c.ok || c.pts >= c.max * 0.8;
      return '<div class="check-row ' + (passed ? 'is-ok' : 'is-fail') + '">' +
        '<span class="check-row__mark">' + (passed ? '\u2713' : '\u2717') + '</span>' +
        '<span>' + esc(c.label) + '</span>' +
        '<span class="check-row__pts">' + c.pts + '/' + c.max + '</span></div>';
    }).join('');

    var missed = r.checks
      .filter(function (c) { return c.pts < c.max; })
      .map(function (c) { return { advice: c.advice, why: c.why, gain: c.max - c.pts }; })
      .sort(function (a, b) { return b.gain - a.gain; });

    $('actionsList').innerHTML = missed.length === 0
      ? '<li class="action-item"><div class="action-item__top"><span class="action-item__label">Every check passed.</span></div>' +
        '<p class="action-item__why">Next frontier: whether your content actually gets cited inside AI answers \u2014 that\u2019s what the playbooks below are for.</p></li>'
      : missed.map(function (c) {
          var level = c.gain >= 6 ? ['high', 'High impact'] : c.gain >= 3 ? ['mid', 'Medium impact'] : ['low', 'Low impact'];
          return '<li class="action-item action-item--' + level[0] + '"><div class="action-item__top">' +
            '<span class="action-item__label"><span class="action-item__tag">' + level[1] + '</span>' + esc(c.advice) + '</span>' +
            '<span class="action-item__gain">+' + c.gain + ' pts</span></div>' +
            '<p class="action-item__why">' + esc(c.why) + '</p></li>';
        }).join('');

    renderFixSnippets(domain, r.checks, botResults, siteInfo || {});
    renderProOutput(domain, r);

    report.hidden = false;
    report.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------- Pro output (not yet implemented) ----------------
     Called after every successful scan with the same domain and result
     object used to render the free report. Will eventually check for
     a Pro entitlement (e.g. a purchase token) and, if present, render
     the category benchmark comparison, named competitor comparison and
     prioritized fix order into the report. Intentionally a no-op until
     that entitlement check and its markup exist — kept as a single
     call site so wiring up the gate later doesn't require touching
     runScan() or renderReport() again. */
  function renderProOutput(domain, r) {
    // no-op — Pro gating not implemented yet
  }

  /* ---------------- Copy-paste fixes ---------------- */

  function renderFixSnippets(domain, checks, botResults, siteInfo) {
    var container = $('fixSnippets');
    if (!container) return;

    var siteUrl = 'https://' + domain;
    var title = siteInfo.title || '';
    var metaDesc = siteInfo.metaDesc || '';
    var lang = siteInfo.lang || '';

    var blocks = [];

    var blockedBots = (botResults || []).filter(function (b) { return b.state !== 'open'; });
    if (blockedBots.length > 0) {
      var today = new Date().toISOString().slice(0, 10);
      var lines = ['# Generated by Answerable on ' + today + ' \u2014 allows the AI crawlers currently blocked or limited'];
      blockedBots.forEach(function (b) {
        lines.push('User-agent: ' + b.name);
        lines.push('Allow: /');
        lines.push('');
      });
      lines.pop();
      blocks.push({ label: 'AI crawler access', code: lines.join('\n') });
    }

    var orgCheck = checks.filter(function (c) { return c.label === 'Organization / WebSite schema'; })[0];
    if (orgCheck && !orgCheck.ok) {
      var orgLd = {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Organization',
            name: '[Your company name]',
            url: siteUrl,
            description: metaDesc || '[A one-sentence description of your business]'
          },
          {
            '@type': 'WebSite',
            name: title || '[Your site name]',
            url: siteUrl,
            inLanguage: lang || '[e.g. en]'
          }
        ]
      };
      blocks.push({
        label: orgCheck.label,
        code: '<script type="application/ld+json">\n' + JSON.stringify(orgLd, null, 2) + '\n<\/script>'
      });
    }

    var contentCheck = checks.filter(function (c) { return c.label === 'Content schema (Article, FAQ…)'; })[0];
    if (contentCheck && !contentCheck.ok) {
      var articleLd = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: title || '[Your page title]',
        description: metaDesc || '[A one-sentence description of this page]',
        inLanguage: lang || '[e.g. en]',
        author: { '@type': 'Organization', name: '[Your company name]' },
        datePublished: '[YYYY-MM-DD]',
        url: siteUrl
      };
      blocks.push({
        label: contentCheck.label,
        code: '<script type="application/ld+json">\n' + JSON.stringify(articleLd, null, 2) + '\n<\/script>'
      });
    }

    if (blocks.length === 0) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }

    container.innerHTML = '<h3 class="fix-snippets__title">Copy-paste fixes</h3>' +
      blocks.map(function (b, i) {
        return '<div class="fix-snippet">' +
          '<div class="fix-snippet__head">' +
            '<span class="fix-snippet__label">' + esc(b.label) + '</span>' +
            '<button type="button" class="btn btn--ghost-on-navy fix-snippet__copy" data-index="' + i + '">' +
              '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="9" rx="1.5"/><path d="M3.5 10.5v-6a1.5 1.5 0 011.5-1.5h6"/></svg>' +
              'Copy' +
            '</button>' +
          '</div>' +
          '<pre class="fix-snippet__code">' + esc(b.code) + '</pre>' +
        '</div>';
      }).join('');

    container.hidden = false;
  }

  /* ---------------- Share ---------------- */

  function shareScore() {
    if (!lastScore) return;
    var shareUrl = CONFIG.shareUrl + '?scan=' + encodeURIComponent(lastScore.domain);
    var text = lastScore.domain + ' scored ' + lastScore.total + '/100 on AI readiness \u2014 ' + shareUrl;
    if (navigator.share) {
      navigator.share({ title: 'Answerable. \u2014 AI visibility score', text: text, url: shareUrl }).catch(function () {});
    } else {
      navigator.clipboard.writeText(text).then(function () {
        showToast('Score copied \u2014 paste it anywhere.');
      });
    }
  }

  /* ---------------- Wiring ---------------- */

  form.addEventListener('submit', function (e) { e.preventDefault(); runScan(); });
  retryBtn.addEventListener('click', function () { runScan(); });
  $('shareBtn').addEventListener('click', shareScore);

  var fixSnippets = $('fixSnippets');
  if (fixSnippets) {
    fixSnippets.addEventListener('click', function (e) {
      var btn = e.target.closest('.fix-snippet__copy');
      if (!btn) return;
      var pre = btn.closest('.fix-snippet').querySelector('.fix-snippet__code');
      if (!pre) return;
      navigator.clipboard.writeText(pre.textContent).then(function () {
        showToast('Snippet copied \u2014 paste it into your <head>.');
      });
    });
  }

  /* ---------------- URL-driven scan (?scan=domain) ---------------- */

  (function initFromUrl() {
    var raw = new URLSearchParams(window.location.search).get('scan');
    if (!raw) return;
    var domain = normalizeDomain(raw);
    if (!domain) return;
    input.value = domain;
    pendingIsParamScan = true;
    runScan();
  }());

}());
