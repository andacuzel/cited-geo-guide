/* =====================================================================
   CITEHOUND SCAN — frontend
   All scanning logic now lives server-side in /api/scan.js (Vercel).
   This file only calls the API and renders the result. No proxies,
   no CORS workarounds.
   ===================================================================== */

(function () {
  'use strict';

  var CONFIG = {
    contactEmail: 'hey@getcitehound.com', // ← replace before deploying
    shareUrl: 'https://getcitehound.com/' // ← update if you move to a custom domain
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

  if (agencyLink) agencyLink.href = 'mailto:' + CONFIG.contactEmail + '?subject=Citehound%20%E2%80%94%20done-for-you%20AI%20visibility';

  var lastScore = null;
  var pendingIsParamScan = false;

  /* ---------------- Pacing and motion ----------------
     Everything that sets how long the scan feels lives in this one block.
       share  a share-link arrival: the hero becomes the "Analyzing" screen
       form   a scan started from the form: no takeover, the progress card on the page
     stageMs   the least time each stage stays on screen; a stage turns done only when that time has
               passed AND its work has finished, so stages tick in order
     doneMs    the "Done" beat, held before anything moves
     scrollMs  the eased scroll to the result
     countMs   the score counting up once the result is in view
     prefers-reduced-motion keeps the stages (250 ms each) and then jumps to the result: no scroll
     animation, no count-up, no pulse. */
  var PACING = {
    share: { stageMs: 700, doneMs: 700, scrollMs: 1100, countMs: 1200, takeover: true },
    form: { stageMs: 450, doneMs: 400, scrollMs: 800, countMs: 900, takeover: false }
  };
  var REDUCED = { stageMs: 250, doneMs: 150, scrollMs: 0, countMs: 0 };
  var STILL_WORKING_MS = 12000;     // after this long a calm "still working" line appears
  var BAR_START_MS = 300, BAR_STAGGER_MS = 250, BAR_FILL_MS = 500, REVEAL_MS = 450; // the result, once it is in view

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function profileFor(mode) {
    var base = PACING[mode];
    return reducedMotion() ? { stageMs: REDUCED.stageMs, doneMs: REDUCED.doneMs, scrollMs: 0, countMs: 0, takeover: base.takeover, animate: false } :
      { stageMs: base.stageMs, doneMs: base.doneMs, scrollMs: base.scrollMs, countMs: base.countMs, takeover: base.takeover, animate: true };
  }

  // Scroll targets land below the sticky header: nav.js keeps --header-h equal to its pinned height.
  function headerOffset() {
    var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h'));
    return (isNaN(v) ? 58 : v) + 16;
  }
  function pageTop(el) { return el.getBoundingClientRect().top + window.scrollY; }
  function jumpTo(y) {
    var html = document.documentElement;
    html.style.scrollBehavior = 'auto';
    window.scrollTo(0, y);
    html.style.scrollBehavior = '';
  }
  // Eased scroll on requestAnimationFrame (ease in-out). Resolves through done(); cancel() stops it where it is.
  function animateScroll(y, ms, step, done) {
    var from = window.scrollY, dist = y - from, html = document.documentElement;
    if (!ms || Math.abs(dist) < 2) { jumpTo(y); step(y); done(); return { cancel: function () {} }; }
    var t0 = performance.now(), raf = 0, stopped = false;
    html.style.scrollBehavior = 'auto';
    function frame(now) {
      if (stopped) return;
      var t = Math.min(1, (now - t0) / ms);
      var e = -(Math.cos(Math.PI * t) - 1) / 2; // ease in-out (sine): gentle at both ends, so the whole duration is seen
      var pos = from + dist * e;
      window.scrollTo(0, pos);
      step(pos);
      if (t < 1) raf = requestAnimationFrame(frame);
      else { html.style.scrollBehavior = ''; done(); }
    }
    raf = requestAnimationFrame(frame);
    return { cancel: function () { stopped = true; cancelAnimationFrame(raf); html.style.scrollBehavior = ''; } };
  }
  // The user always wins: wheel, touch, a key, a mouse press or any scroll we did not make cancels what is running.
  function watchUser(onUser) {
    var events = ['wheel', 'touchstart', 'touchmove', 'keydown', 'mousedown'];
    var expected = null, live = true;
    function user() { if (live) onUser(); }
    function scrolled() { if (live && (expected === null ? window.scrollY > 2 : Math.abs(window.scrollY - expected) > 4)) onUser(); }
    events.forEach(function (ev) { window.addEventListener(ev, user, { capture: true, passive: true }); });
    window.addEventListener('scroll', scrolled, { passive: true });
    return {
      expect: function (y) { expected = y; },
      stop: function () { live = false; events.forEach(function (ev) { window.removeEventListener(ev, user, true); }); window.removeEventListener('scroll', scrolled); }
    };
  }

  // The progress card is much shorter than the result. While it shows, the section holds the height the
  // result will take, so what sits below (the MCP band) does not jump when the result replaces the card.
  function resultReserve() {
    var w = window.innerWidth;
    for (var i = 0; i < RESERVE.length; i++) if (w <= RESERVE[i][0]) return RESERVE[i][1];
    return 0;
  }
  function reserveSpace(on) {
    var px = resultReserve() + 'px';
    [progressSection, report].forEach(function (el) {
      if (!el) return;
      el.style.setProperty('--result-reserve', px);
      el.classList.toggle('is-reserving', !!on);
    });
  }

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
  // Smallest result heights measured by width band (px, section incl. padding): 3471 at 390, 3440 at 520, 2587 at 700, 2410 at 1000, 1793 at 1280 and up (smallest of four recorded scans). A taller result grows downward, below the fold.
  var RESERVE = [[400, 3470], [520, 3440], [700, 2580], [1000, 2410], [Infinity, 1790]]; // [max viewport width, px]

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

  var analyze = $('analyze');
  var analyzeText = $('analyzeText');
  var analyzeDots = $('analyzeDots');
  var analyzeStages = $('analyzeStages');
  var analyzeStill = $('analyzeStill');
  var analyzeLive = $('analyzeLive');
  var analyzeLink = $('analyzeLink');
  var heroEl = $('scan');

  function buildStageList(listEl) {
    if (!listEl) return;
    listEl.innerHTML = STAGES.map(function (st) {
      return '<li class="scan-progress__item is-pending">' +
        '<span class="scan-progress__marker" aria-hidden="true"></span>' +
        '<span class="scan-progress__label">' + esc(st.label) + '</span></li>';
    }).join('');
  }

  function setStageState(listEl, i, state) {
    if (!listEl) return;
    var item = listEl.children[i];
    if (!item) return;
    item.className = 'scan-progress__item is-' + state;
    var marker = item.querySelector('.scan-progress__marker');
    if (marker) marker.textContent = state === 'done' ? '✓' : '';
  }

  function updateProgressBar(doneCount) {
    if (!progressBarFill) return;
    progressBarFill.style.width = Math.round((doneCount / STAGES.length) * 100) + '%';
  }

  function showProgressPanel(domain, opts) {
    if (!progressSection) return;
    buildStageList(progressList);
    if (progressDomain) progressDomain.textContent = domain;
    updateProgressBar(0);
    if (progressContext) progressContext.textContent = '';
    if (progressStages) progressStages.hidden = false;
    if (progressError) progressError.hidden = true;
    progressSection.hidden = false;
    report.hidden = true;
    setStatus('');
    reserveSpace(true);
    if (opts && opts.scroll) {
      // bring the card into view, a third of the way down, so the stages can be read; the result later eases up to the header
      var h = progressSection.getBoundingClientRect().height;
      var top = Math.max(headerOffset(), window.innerHeight * 0.3);
      animateScroll(Math.max(0, pageTop(progressSection) - top), opts.scrollMs, opts.step || function () {}, function () {});
    }
  }

  function showProgressError(message) {
    if (!progressSection) return;
    progressSection.classList.remove('is-reserving');
    if (progressStages) progressStages.hidden = true;
    if (progressError) {
      progressError.hidden = false;
      if (progressErrorText) progressErrorText.textContent = message;
    }
  }

  function hideProgressPanel() {
    if (progressSection) progressSection.hidden = true;
  }

  // The share-link arrival: the hero hands its first viewport to the "Analyzing" screen. The hero keeps its height
  // while it does, so nothing moves when it comes back.
  function enterTakeover(domain) {
    if (!analyze || !heroEl) return false;
    heroEl.style.minHeight = heroEl.offsetHeight + 'px';
    heroEl.classList.add('is-analyzing');
    analyze.hidden = false;
    analyze.classList.remove('is-done');
    analyzeText.textContent = 'Analyzing ' + domain;
    if (analyzeDots) analyzeDots.hidden = false;
    if (analyzeStill) analyzeStill.hidden = true;
    if (analyzeLink) analyzeLink.hidden = true;
    if (analyzeLive) analyzeLive.textContent = '';
    buildStageList(analyzeStages);
    return true;
  }
  function leaveTakeover() {
    if (!heroEl) return;
    heroEl.classList.remove('is-analyzing');
    heroEl.style.minHeight = '';
    if (analyze) analyze.hidden = true;
  }

  // What the user sees for stages and the done beat: the takeover for a share link, the card otherwise.
  function makeUi(domain, takeover) {
    var list = takeover ? analyzeStages : progressList;
    return {
      activate: function (i) {
        setStageState(list, i, 'active');
        if (takeover) { if (analyzeLive) analyzeLive.textContent = 'Step ' + (i + 1) + ' of ' + STAGES.length + ': ' + STAGES[i].label; }
        else if (progressContext) progressContext.textContent = STAGES[i].context;
      },
      done: function (i) {
        setStageState(list, i, 'done');
        if (!takeover) updateProgressBar(i + 1);
      },
      still: function () {
        if (takeover) { if (analyzeStill) analyzeStill.hidden = false; }
        else if (progressContext) progressContext.textContent = 'Still working. Some sites answer slowly, and the scan waits for them.';
      },
      finish: function () {
        var text = 'Done. Here’s ' + domain + '’s score.';
        if (takeover) {
          if (analyzeText) analyzeText.textContent = text;
          if (analyzeDots) analyzeDots.hidden = true;
          if (analyzeStill) analyzeStill.hidden = true;
          if (analyze) analyze.classList.add('is-done');
          if (analyzeLive) analyzeLive.textContent = text;
        } else {
          if (progressDomain) progressDomain.textContent = text;
          if (progressContext) progressContext.textContent = '';
          updateProgressBar(STAGES.length);
        }
      }
    };
  }

  // The stages tick in order, each on screen for at least stageMs. The scan is one request, so stages 1 to 4 cannot be
  // tied to separate steps: they advance on the minimum time while the request is in flight, as the stages always have,
  // and "Scoring 16 checks" is the one that is gated on the real response: it never turns done before the scan has
  // succeeded, and while the response is slow it stays active (pulsing). A failure stops the ticking at once.
  async function runPacedStages(fetchPromise, p, ui) {
    var failed = false, outcome = null;
    var settled = fetchPromise.then(function (o) {
      outcome = o;
      failed = !(o.networkOk && o.res.ok && !o.data.error);
      return o;
    });
    function napUnlessFailed(ms) {
      return new Promise(function (resolve) {
        var t = setTimeout(resolve, ms);
        settled.then(function () { if (failed) { clearTimeout(t); resolve(); } });
      });
    }
    for (var i = 0; i < STAGES.length; i++) {
      if (failed) return outcome;
      ui.activate(i);
      if (i < STAGES.length - 1) {
        await napUnlessFailed(p.stageMs);
        if (failed) return outcome;
        ui.done(i);
      } else {
        await Promise.all([sleep(p.stageMs), settled]);
        if (!failed) ui.done(i);
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

  function failureMessage(outcome) {
    if (!outcome.networkOk) return 'Scan failed: ' + (outcome.error && outcome.error.message ? outcome.error.message : 'connection error');
    if (outcome.res.status === 429) return outcome.data.error || 'You’ve hit the scan limit. Try again in a little while.';
    if (!outcome.res.ok || outcome.data.error) return 'Scan failed: ' + (outcome.data.error || ('HTTP ' + outcome.res.status));
    return null;
  }

  // The result arrives in three beats once it is in view: the score counts up, the three bars fill one after another, then the
  // check list and the fix list fade in. Only transform and opacity move, and the real figures are in the DOM from the start
  // (the count is an aria-hidden overlay), so skipping the beats, reduced motion or no script all show the same final page.
  var playing = null;
  function finalizeResult() {
    if (playing) { playing.timers.forEach(clearTimeout); cancelAnimationFrame(playing.raf); playing = null; }
    report.classList.remove('is-prep', 'is-playing');
    var fills = report.querySelectorAll('.score-bar__fill');
    for (var i = 0; i < fills.length; i++) fills[i].style.animationDelay = '';
    var parts = report.querySelectorAll('.scan-checks, .scan-commerce, .scan-actions, .fix-snippets, .scan-bridge');
    for (var k = 0; k < parts.length; k++) parts[k].style.animationDelay = '';
    var host = report.querySelector('.score-entry__value');
    if (host) {
      host.classList.remove('is-counting');
      var ov = host.querySelector('.score-entry__count');
      if (ov) ov.remove();
    }
  }
  function playResult(countMs, total) {
    finalizeResult();
    var host = report.querySelector('.score-entry__value');
    var state = { timers: [], raf: 0 };
    playing = state;
    report.classList.add('is-playing');
    var fills = report.querySelectorAll('.score-bar__fill');
    for (var i = 0; i < fills.length; i++) fills[i].style.animationDelay = (BAR_START_MS + i * BAR_STAGGER_MS) + 'ms';
    var afterBars = BAR_START_MS + fills.length * BAR_STAGGER_MS + 100;
    var listDelay = [['.scan-checks', afterBars], ['.scan-commerce', afterBars + 200], ['.scan-actions', afterBars + 200], ['.fix-snippets', afterBars + 200], ['.scan-bridge', afterBars + 200]];
    listDelay.forEach(function (d) { var el = report.querySelector(d[0]); if (el) el.style.animationDelay = d[1] + 'ms'; });
    if (host) {
      var ov = document.createElement('span');
      ov.className = 'score-entry__count';
      ov.setAttribute('aria-hidden', 'true');
      ov.textContent = '0';
      host.appendChild(ov);
      host.classList.add('is-counting');
      var t0 = performance.now();
      var tick = function (now) {
        var t = Math.min(1, (now - t0) / countMs);
        ov.textContent = String(Math.round(total * (1 - Math.pow(1 - t, 3))));
        if (t < 1) state.raf = requestAnimationFrame(tick);
        else { ov.textContent = String(total); host.classList.remove('is-counting'); ov.remove(); }
      };
      state.raf = requestAnimationFrame(tick);
    }
    state.timers.push(setTimeout(finalizeResult, afterBars + 200 + REVEAL_MS + 200));
  }

  async function runScan(arrival) {
    var domain = normalizeDomain(input.value);
    if (!domain) { setStatus('Enter a valid domain, e.g. example.com', true); return; }

    var isParamScan = pendingIsParamScan;
    pendingIsParamScan = false;

    // arrival is set only for a share link. A link with a #hash, or a back/forward visit, runs the scan quietly:
    // no takeover, no scroll and no animation.
    var quiet = !!(arrival && arrival.quiet);
    var takeover = !!(arrival && arrival.takeover && !quiet && analyze);
    var p = profileFor(takeover ? 'share' : 'form');
    var guard = null, scrollJob = null, cancelled = false, resultShown = false;

    scanBtn.disabled = true;
    function skipAnimations() {
      cancelled = true;
      if (scrollJob) scrollJob.cancel();
      if (guard) guard.stop();
      if (resultShown) finalizeResult();
    }
    if (!quiet) guard = watchUser(skipAnimations);
    if (takeover) { enterTakeover(domain); report.hidden = true; hideProgressPanel(); setStatus(''); }
    else showProgressPanel(domain, { scroll: !quiet, scrollMs: p.animate ? 600 : 0, step: function (y) { if (guard) guard.expect(y); } });
    var ui = makeUi(domain, takeover);
    var stillTimer = setTimeout(ui.still, STILL_WORKING_MS);

    try {
      var fetchPromise = startFetch(domain);
      var outcome = await runPacedStages(fetchPromise, p, ui);
      clearTimeout(stillTimer);

      var failure = failureMessage(outcome);
      if (failure) {
        if (takeover) { leaveTakeover(); setStatus(failure, true); }
        else showProgressError(failure);
        if (guard) guard.stop();
        return;
      }
      var data = outcome.data;

      // the done beat, held before anything moves
      ui.finish();
      await sleep(p.doneMs);

      hideProgressPanel();
      var animate = p.animate && !cancelled && !quiet;
      renderReport(data.domain, data.robotsOk, data.botResults, data.result, data.siteInfo, isParamScan, data.commerce, { prep: animate });
      resultShown = true;
      updateShareableUrl(data.domain);

      if (quiet) { return; }
      if (cancelled) {
        // the user took over: leave the finished screen in place with a way to the result
        if (takeover && analyzeLink) analyzeLink.hidden = false;
        return;
      }

      // eased scroll to the result, landing below the sticky header
      var targetY = Math.max(0, pageTop(report) - headerOffset());
      await new Promise(function (resolve) {
        scrollJob = animateScroll(targetY, p.scrollMs, function (y) { if (guard) guard.expect(y); }, resolve);
        if (cancelled) { scrollJob.cancel(); resolve(); }
      });
      if (guard) guard.expect(window.scrollY);
      if (takeover) leaveTakeover();
      if (cancelled) { finalizeResult(); return; }
      if (animate) playResult(p.countMs, data.result.total);
      else finalizeResult();
    } catch (err) {
      clearTimeout(stillTimer);
      if (takeover) { leaveTakeover(); setStatus('Scan failed: ' + (err && err.message ? err.message : 'connection error'), true); }
      else showProgressError('Scan failed: ' + (err && err.message ? err.message : 'connection error'));
    } finally {
      if (guard) setTimeout(guard.stop, 4000);
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

  // window.CITEHOUND_BENCHMARKS is written by scripts/generate-benchmarks.js
  // alongside the homepage benchmark section — see index.html between the
  // BENCHMARKS:START/END markers. Returns HTML (a trusted string built from
  // numbers only), or null if the stats aren't available on this page.
  function benchmarkLine(score) {
    var stats = window.CITEHOUND_BENCHMARKS;
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

  function renderReport(domain, robotsOk, botResults, r, siteInfo, scannedFromParam, commerce, opts) {
    lastScore = { domain: domain, total: r.total, checks: r.checks, botResults: botResults };

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

    renderCommerce(domain, commerce);

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
    reserveSpace(false);
    report.classList.add('is-reserving'); // never shorter than the card it replaced
    finalizeResult();
    // prep: bars and lists start hidden so playResult can bring them in; the real figures are already in the DOM
    if (opts && opts.prep) report.classList.add('is-prep');
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

  /* ---------------- Agentic commerce readiness ----------------
     Shown only when the scan treats the site as a store. It has its own
     sub-score and never changes the score above. */

  function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : null; }

  function commerceRow(state, mark, label, value, detailHtml) {
    return '<div class="check-row' + (state ? ' is-' + state : '') + '">' +
      '<span class="check-row__mark">' + mark + '</span>' +
      '<span>' + esc(label) + (detailHtml ? '<span class="tool-evidence">' + detailHtml + '</span>' : '') + '</span>' +
      (value ? '<span class="check-row__pts">' + esc(value) + '</span>' : '') + '</div>';
  }

  function renderCommerce(domain, c) {
    var el = $('commerceBody');
    if (!el) return;
    if (!c || !c.detected) { el.hidden = true; el.innerHTML = ''; return; }

    var fired = c.signals.filter(function (s) { return s.fired === true; });
    var rows = '';

    rows += commerceRow('ok', '✓', 'Detected as a store', fired.length + ' of ' + c.signals.length + ' signals',
      fired.map(function (s) { return esc(s.label) + (s.evidence ? ' (' + esc(s.evidence) + ')' : ''); }).join('<br>'));

    var ucp = c.ucp;
    var ucpCheck = c.checks.filter(function (k) { return k.id === 'ucp'; })[0];
    if (ucp.state === 'valid') {
      rows += commerceRow('ok', '✓', 'UCP endpoint', ucpCheck.pts + '/' + ucpCheck.max,
        'Merchant profile found at /.well-known/ucp. Version ' + esc(ucp.version) + '; supports ' + esc(ucp.supportedVersions.join(', ')) +
        '; ' + ucp.capabilities.length + ' capabilities: ' + esc(ucp.capabilities.join(', ')) + '.');
    } else {
      rows += commerceRow('fail', '✗', 'UCP endpoint', ucpCheck.pts + '/' + ucpCheck.max, esc(ucp.detail));
    }

    var p = c.product;
    var pCheck = c.checks.filter(function (k) { return k.id === 'product-data'; })[0];
    var urlHtml = safeUrl(p.url)
      ? 'Checked <a href="' + esc(p.url).replace(/"/g, '&quot;') + '" target="_blank" rel="noopener noreferrer">' + esc(p.url) + '</a> (found via ' + esc(p.source) + ').'
      : '';
    if (p.state === 'checked') {
      var names = { name: 'name', price: 'price', availability: 'availability', image: 'image' };
      var have = Object.keys(names).filter(function (k) { return p.fields[k]; });
      var lack = Object.keys(names).filter(function (k) { return !p.fields[k]; });
      var detail = urlHtml + '<br>' + (p.found
        ? esc(p.schemaType) + ' schema (' + esc(p.schemaSource) + '). Present: ' + esc(have.join(', ') || 'none') + (lack.length ? '. Missing: ' + esc(lack.join(', ')) : '') + '.'
        : 'No Product schema found on that page.');
      rows += commerceRow(p.present === 4 ? 'ok' : 'fail', p.present === 4 ? '✓' : '✗', 'Structured product data', pCheck.pts + '/' + pCheck.max, detail);
    } else {
      rows += commerceRow('', '–', 'Structured product data', 'not assessed', (urlHtml ? urlHtml + '<br>' : '') + esc(p.detail));
    }

    var l = c.llms;
    if (l) {
      var checkerLink = ' <a href="/tools/llms-txt-checker?domain=' + encodeURIComponent(domain) + '">Open the checker</a>';
      rows += commerceRow('', '–', 'llms.txt authorship (not scored)', l.verdict || 'no file',
        esc(l.summary) + (l.caveat ? ' ' + esc(l.caveat) : '') + checkerLink);
    }

    var gaps = c.checks.filter(function (k) { return k.assessed && k.pts < k.max; });
    var gapsHtml = gaps.length
      ? '<ul class="scan-actions__list commerce-gaps">' + gaps.map(function (k) {
          return '<li class="action-item"><div class="action-item__top"><span class="action-item__label">' + esc(k.advice) +
            '</span><span class="action-item__gain">+' + (k.max - k.pts) + ' pts</span></div><p class="action-item__why">' + esc(k.why) + '</p></li>';
        }).join('') + '</ul>'
      : '';

    var sub = c.subScore;
    el.innerHTML =
      '<p class="kicker">Commerce only · scored separately</p>' +
      '<h3 class="scan-actions__title">Agentic commerce readiness</h3>' +
      '<div class="commerce-score"><span class="commerce-score__value">' + sub.earned + '<small>/' + sub.max + '</small></span>' +
      '<span class="commerce-score__note">Separate from the score above, which this never changes.' +
      (sub.complete ? '' : ' Product data could not be assessed, so it is left out of this total.') + '</span></div>' +
      '<div class="commerce-rows">' + rows + '</div>' + gapsHtml;
    el.hidden = false;
  }

  /* ---------------- Copy-paste fixes ---------------- */

  function renderFixSnippets(domain, checks, botResults, siteInfo) {
    var container = $('fixSnippets');
    if (!container) return;

    // JSON-LD comes from lib/schema.js, shared with the standalone
    // generator and the MCP server (loaded before this file).
    var schema = window.CITEHOUND_SCHEMA;

    var blocks = [];

    var blockedBots = (botResults || []).filter(function (b) { return b.state !== 'open'; });
    if (blockedBots.length > 0) {
      var today = new Date().toISOString().slice(0, 10);
      var lines = ['# Generated by Citehound on ' + today + ' — allows the AI crawlers currently blocked or limited'];
      blockedBots.forEach(function (b) {
        lines.push('User-agent: ' + b.name);
        lines.push('Allow: /');
        lines.push('');
      });
      lines.pop();
      blocks.push({ label: 'AI crawler access', code: lines.join('\n') });
    }

    // lib/schema.js is a separate script. If a page forgot to load it, skip
    // the JSON-LD blocks rather than lose the whole report.
    var orgCheck = schema && checks.filter(function (c) { return c.label === 'Organization / WebSite schema'; })[0];
    if (orgCheck && !orgCheck.ok) {
      blocks.push({
        label: orgCheck.label,
        code: schema.toScriptTag(schema.buildFromSite('organization', domain, siteInfo))
      });
    }

    var contentCheck = schema && checks.filter(function (c) { return c.label === 'Content schema (Article, FAQ…)'; })[0];
    if (contentCheck && !contentCheck.ok) {
      blocks.push({
        label: contentCheck.label,
        code: schema.toScriptTag(schema.buildFromSite('article', domain, siteInfo))
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

  /* ---------------- Share ----------------
     The share text leads with whatever's most interesting in the scan
     result, not a bare score:
       1. Any blocked/limited AI crawler — the most concrete finding.
       2. Otherwise, the highest-impact failing check, if it's "High
          impact" by the same >=6pt threshold the report itself uses.
       3. Otherwise, a small number of low-impact gaps only — brag copy.
       4. Every check passed — perfect-score copy.
     Short, per-check clauses for case 2, written to read naturally
     after "<domain> ...". Only covers checks that can be the reason a
     score isn't perfect while every crawler is open — "AI crawler
     access" itself is excluded, since case 1 already handles that. */
  var SHARE_FINDINGS = {
    'robots.txt present': 'has no robots.txt, so AI crawlers can’t find its access rules',
    'llms.txt present': 'has no llms.txt, the file some AI systems check for a content map',
    'Sitemap declared': 'has no sitemap declared, so crawlers can’t discover its pages',
    'Canonical tag': 'has no canonical tag, risking duplicate-content confusion',
    'html lang attribute': 'has no declared language, so AI systems can misread its content',
    'Page title': 'has a page title AI systems can’t use as a clean source label',
    'Meta description': 'has no usable meta description for AI systems to summarize it by',
    'Open Graph tags': 'has no Open Graph tags, so shared previews read inconsistently',
    'Structured data (JSON-LD)': 'has no structured data, so machines can’t label its content',
    'Single H1 heading': 'has an unclear heading structure, leaving its topic ambiguous',
    'Subheading structure (H2)': 'has no subheadings, making its content hard to quote',
    'Organization / WebSite schema': 'has no Organization schema, so AI systems can’t verify who’s behind it',
    'Content schema (Article, FAQ…)': 'has no content schema, so AI systems can’t tell what this page is',
    'Author / about signals': 'has no author or about signals AI systems can verify',
    'Contact signals': 'has no contact signals, a baseline trust marker'
  };

  function buildShareText(domain, r, botResults) {
    var blocked = botResults.filter(function (b) { return b.state !== 'open'; });
    if (blocked.length > 0) {
      return blocked.length + ' of ' + botResults.length + ' AI crawlers are blocked from reading ' + domain + '. Score: ' + r.total + '/100.';
    }

    var missed = r.checks
      .filter(function (c) { return c.pts < c.max; })
      .map(function (c) { return { label: c.label, gain: c.max - c.pts }; })
      .sort(function (a, b) { return b.gain - a.gain; });

    if (missed.length === 0) {
      return domain + ' passes all ' + r.checks.length + ' AI readiness checks. ' + r.total + '/100.';
    }

    var top = missed[0];
    var finding = SHARE_FINDINGS[top.label];
    if (top.gain >= 6 && finding) {
      return domain + ' ' + finding + '. AI readiness: ' + r.total + '/100.';
    }

    return domain + ' scores ' + r.total + '/100 for AI readiness. GPTBot, ClaudeBot and PerplexityBot can all read it.';
  }

  function shareScore() {
    if (!lastScore) return;
    var shareUrl = CONFIG.shareUrl + '?scan=' + encodeURIComponent(lastScore.domain);
    var text = buildShareText(lastScore.domain, lastScore, lastScore.botResults);
    var title = 'Citehound — AI readiness scan';

    if (navigator.share) {
      // url is its own field — the text must not also contain it, or
      // targets that concatenate text+url (WhatsApp among them) show
      // the link twice.
      navigator.share({ title: title, text: text, url: shareUrl }).catch(function () {});
    } else {
      // No separate url field here, so it's appended to the text once.
      navigator.clipboard.writeText(text + ' ' + shareUrl).then(function () {
        showToast('Result and link copied.');
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

  /* A share link opens at the top and shows the "Analyzing" screen while the scan runs: the stages tick one by one, a "Done"
     beat, then an eased scroll to the result and the count-up (see runScan and PACING). A link with a #hash, or a
     back/forward visit, runs the scan quietly and moves nothing. The domain is validated by normalizeDomain and only ever
     written with textContent. */
  (function initFromUrl() {
    var raw = new URLSearchParams(window.location.search).get('scan');
    if (!raw) return;
    var domain = normalizeDomain(raw);
    if (!domain) return;
    input.value = domain;
    pendingIsParamScan = true;
    var nav = window.performance && performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
    var restored = !!(nav && nav.type === 'back_forward');
    var hash = !!window.location.hash.replace('#', '');
    if (!hash && !restored) {
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    // a page restored from the back/forward cache keeps its state: show it as it is and drop any animation
    window.addEventListener('pageshow', function (e) { if (e.persisted) { finalizeResult(); leaveTakeover(); } });
    runScan({ takeover: true, quiet: hash || restored });
  }());

}());
