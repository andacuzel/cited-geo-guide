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

  /* ---------------- Scan progress panel ----------------
     Stages mirror the real, sequential work lib/scanner.js performs
     for a single-page scan: robots.txt, llms.txt, sitemap declaration,
     the homepage fetch, then scoring. There's one HTTP round trip to
     /api/scan (no per-stage server signal), so stages 1-4 advance on
     a fixed minimum timer — an honest reflection of work already in
     flight, not a fabricated percentage. Only the last stage is gated
     on the real response: it never shows done before the scan has
     actually succeeded. */

  var STAGES = [
    { label: 'Reading robots.txt', context: 'This file tells AI crawlers what they’re allowed to access.' },
    { label: 'Checking llms.txt', context: 'An emerging standard some sites use to describe themselves to AI systems.' },
    { label: 'Looking for a sitemap', context: 'A sitemap lets crawlers discover every page on a site, not just the homepage.' },
    { label: 'Fetching the homepage', context: 'The homepage is parsed for structured data, headings and metadata.' },
    { label: 'Scoring 16 checks', context: 'Every check is weighted across three pillars: discoverability, technical foundation and trust.' }
  ];
  var STAGE_MIN_MS = 500;

  var progressSection = $('scanProgress');
  var progressStages = $('scanProgressStages');
  var progressError = $('scanProgressError');
  var progressDomain = $('scanProgressDomain');
  var progressList = $('scanProgressList');
  var progressBarFill = $('scanProgressBarFill');
  var progressContext = $('scanProgressContext');
  var progressErrorText = $('scanProgressErrorText');
  var progressRetryBtn = $('scanProgressRetry');

  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  function buildStageList() {
    if (!progressList) return;
    progressList.innerHTML = STAGES.map(function (s) {
      return '<li class="scan-progress__item is-pending">' +
        '<span class="scan-progress__marker" aria-hidden="true"></span>' +
        '<span class="scan-progress__label">' + esc(s.label) + '</span></li>';
    }).join('');
  }

  function setStageState(i, state) {
    if (!progressList) return;
    var item = progressList.children[i];
    if (!item) return;
    item.className = 'scan-progress__item is-' + state;
    var marker = item.querySelector('.scan-progress__marker');
    if (marker) marker.textContent = state === 'done' ? '✓' : '';
  }

  function updateProgressBar(doneCount) {
    if (!progressBarFill) return;
    progressBarFill.style.width = Math.round((doneCount / STAGES.length) * 100) + '%';
  }

  function showProgressPanel(domain) {
    if (!progressSection) return;
    buildStageList();
    if (progressDomain) progressDomain.textContent = domain;
    updateProgressBar(0);
    if (progressContext) progressContext.textContent = '';
    if (progressStages) progressStages.hidden = false;
    if (progressError) progressError.hidden = true;
    progressSection.hidden = false;
    report.hidden = true;
    setStatus('');
    progressSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showProgressError(message) {
    if (!progressSection) return;
    if (progressStages) progressStages.hidden = true;
    if (progressError) {
      progressError.hidden = false;
      if (progressErrorText) progressErrorText.textContent = message;
    }
  }

  function hideProgressPanel() {
    if (progressSection) progressSection.hidden = true;
  }

  // Runs the fetch and the staged reveal side by side. Stages before
  // the last complete on a fixed minimum timer; the last stage waits
  // on whichever finishes later — the timer or the real response —
  // and only marks itself done if that response actually succeeded.
  async function runStagedScan(fetchPromise) {
    for (var i = 0; i < STAGES.length; i++) {
      setStageState(i, 'active');
      if (progressContext) progressContext.textContent = STAGES[i].context;

      if (i < STAGES.length - 1) {
        await sleep(STAGE_MIN_MS);
        setStageState(i, 'done');
        updateProgressBar(i + 1);
      } else {
        var pair = await Promise.all([sleep(STAGE_MIN_MS), fetchPromise]);
        var outcome = pair[1];
        if (outcome.networkOk && outcome.res.ok && !outcome.data.error) {
          setStageState(i, 'done');
          updateProgressBar(STAGES.length);
        }
        return outcome;
      }
    }
  }

  function startFetch(domain) {
    return fetch('/api/scan?domain=' + encodeURIComponent(domain))
      .then(function (res) {
        return res.json()
          .catch(function () { return {}; })
          .then(function (data) { return { networkOk: true, res: res, data: data }; });
      })
      .catch(function (err) { return { networkOk: false, error: err }; });
  }

  /* ---------------- Scan flow ---------------- */

  async function runScan() {
    var domain = normalizeDomain(input.value);
    if (!domain) { setStatus('Enter a valid domain, e.g. example.com', true); return; }

    var isParamScan = pendingIsParamScan;
    pendingIsParamScan = false;

    scanBtn.disabled = true;
    showProgressPanel(domain);

    try {
      var fetchPromise = startFetch(domain);
      var outcome = await runStagedScan(fetchPromise);

      if (!outcome.networkOk) {
        showProgressError('Scan failed: ' + (outcome.error && outcome.error.message ? outcome.error.message : 'connection error'));
        return;
      }

      var res = outcome.res, data = outcome.data;

      if (res.status === 429) {
        showProgressError(data.error || 'You’ve hit the scan limit. Try again in a little while.');
        return;
      }
      if (!res.ok || data.error) {
        showProgressError('Scan failed: ' + (data.error || ('HTTP ' + res.status)));
        return;
      }

      hideProgressPanel();
      renderReport(data.domain, data.robotsOk, data.botResults, data.result, data.siteInfo, isParamScan);
      updateShareableUrl(data.domain);
    } catch (err) {
      showProgressError('Scan failed: ' + (err && err.message ? err.message : 'connection error'));
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
    } catch (e) { /* URL API unavailable — leave the address bar as-is */ }
  }

  // window.ANSWERABLE_BENCHMARKS is written by scripts/generate-benchmarks.js
  // alongside the homepage benchmark section — see index.html between the
  // BENCHMARKS:START/END markers. Returns HTML (a trusted string built from
  // numbers only), or null if the stats aren't available on this page.
  function benchmarkLine(score) {
    var stats = window.ANSWERABLE_BENCHMARKS;
    if (!stats || typeof stats.overallAverage !== 'number' || !stats.totalSites) return null;

    var link = ' <a href="/#benchmark-heading">See the benchmark</a>';
    var sitesPhrase = 'the average of the ' + stats.totalSites + ' sites we’ve scanned';
    var delta = score - stats.overallAverage;
    var points = Math.abs(delta);

    if (points < 2) {
      return 'That’s around ' + sitesPhrase + '.' + link;
    }
    var word = points === 1 ? 'point' : 'points';
    return 'That’s ' + points + ' ' + word + ' ' + (delta > 0 ? 'above' : 'below') + ' ' + sitesPhrase + '.' + link;
  }

  /* ---------------- Render ---------------- */

  var PILLARS = [
    { cat: 'discover', label: 'Discoverability' },
    { cat: 'tech', label: 'Technical' },
    { cat: 'trust', label: 'Content & trust' }
  ];

  function renderReport(domain, robotsOk, botResults, r, siteInfo, scannedFromParam) {
    lastScore = { domain: domain, total: r.total };

    $('scoreValue').textContent = r.total;
    $('scoreDomain').textContent = domain + ' · retrieved ' + new Date().toLocaleDateString('en-GB');

    var scannedNowEl = $('scoreScannedNow');
    if (scannedNowEl) {
      if (scannedFromParam) {
        scannedNowEl.textContent = 'Scanned just now — ' + new Date().toLocaleDateString('en-GB');
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
        benchmarkEl.innerHTML = line;
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
    var botHtml = '<div class="bot-console__label">' + esc(domain) + '/robots.txt — AI crawler policy</div>';
    if (!robotsOk) botHtml += '<div class="bot-console__note"># no robots.txt found → all crawlers have default access</div>';
    botHtml += '<div class="bot-grid">' + botResults.map(function (b) {
      var ruleLine = b.state !== 'open'
        ? '<span class="bot-card__rule">' + esc(b.rule) + ' · ' + esc(b.desc) + '</span>'
        : '';
      return '<div class="bot-card"><div class="bot-card__top"><span class="bot-card__name">' + esc(b.name) + '</span>' + chip[b.state] + '</div>' + ruleLine + '</div>';
    }).join('') + '</div>';
    if (botResults.some(function (b) { return b.state !== 'open'; })) {
      botHtml += '<div class="bot-console__link">Fix this: <a href="/tools/robots-txt">generate a corrected robots.txt</a></div>';
    }
    $('botConsole').innerHTML = botHtml;

    $('checksBody').innerHTML = PILLARS.map(function (p) {
      var rows = r.checks.filter(function (c) { return c.cat === p.cat; }).map(function (c) {
        var passed = c.ok || c.pts >= c.max * 0.8;
        return '<div class="check-row ' + (passed ? 'is-ok' : 'is-fail') + '">' +
          '<span class="check-row__mark">' + (passed ? '✓' : '✗') + '</span>' +
          '<span>' + esc(c.label) + '</span>' +
          '<span class="check-row__pts">' + c.pts + '/' + c.max + '</span></div>';
      }).join('');
      return '<div class="checks-group"><p class="kicker">' + esc(p.label) + '</p>' +
        '<div class="checks-group__grid">' + rows + '</div></div>';
    }).join('');

    var missed = r.checks
      .filter(function (c) { return c.pts < c.max; })
      .map(function (c) { return { advice: c.advice, why: c.why, gain: c.max - c.pts }; })
      .sort(function (a, b) { return b.gain - a.gain; });

    $('actionsList').innerHTML = missed.length === 0
      ? '<li class="action-item"><div class="action-item__top"><span class="action-item__label">Every check passed.</span></div>' +
        '<p class="action-item__why">Next frontier: whether your content actually gets cited inside AI answers — that’s what the playbooks below are for.</p></li>'
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
      var lines = ['# Generated by Answerable on ' + today + ' — allows the AI crawlers currently blocked or limited'];
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

    container.innerHTML =
      '<button type="button" class="fix-snippets__toggle" id="fixSnippetsToggle" aria-expanded="false" aria-controls="fixSnippetsBody">' +
        '<span>Copy-paste fixes (' + blocks.length + ')</span>' +
        '<svg class="fix-snippets__chevron" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</button>' +
      '<div class="fix-snippets__body" id="fixSnippetsBody" hidden>' +
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
        }).join('') +
      '</div>';

    container.hidden = false;
  }

  /* ---------------- Share ---------------- */

  function shareScore() {
    if (!lastScore) return;
    var shareUrl = CONFIG.shareUrl + '?scan=' + encodeURIComponent(lastScore.domain);
    var text = lastScore.domain + ' scored ' + lastScore.total + '/100 on AI readiness — ' + shareUrl;
    if (navigator.share) {
      navigator.share({ title: 'Answerable. — AI visibility score', text: text, url: shareUrl }).catch(function () {});
    } else {
      navigator.clipboard.writeText(text).then(function () {
        showToast('Score copied — paste it anywhere.');
      });
    }
  }

  /* ---------------- Wiring ---------------- */

  form.addEventListener('submit', function (e) { e.preventDefault(); runScan(); });
  retryBtn.addEventListener('click', function () { runScan(); });
  if (progressRetryBtn) progressRetryBtn.addEventListener('click', function () { runScan(); });
  $('shareBtn').addEventListener('click', shareScore);

  var fixSnippets = $('fixSnippets');
  if (fixSnippets) {
    fixSnippets.addEventListener('click', function (e) {
      var toggle = e.target.closest('.fix-snippets__toggle');
      if (toggle) {
        var body = $('fixSnippetsBody');
        var expanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!expanded));
        if (body) body.hidden = expanded;
        return;
      }
      var btn = e.target.closest('.fix-snippet__copy');
      if (!btn) return;
      var pre = btn.closest('.fix-snippet').querySelector('.fix-snippet__code');
      if (!pre) return;
      navigator.clipboard.writeText(pre.textContent).then(function () {
        showToast('Snippet copied — paste it into your <head>.');
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
