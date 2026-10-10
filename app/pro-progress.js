/* =====================================================================
   Citehound Pro: the progress screen.

   Shown after the start form and, with the same code, on /r/<id>/ while a report is
   still being made. It drives the crawl (one POST /api/pro/step after another, each
   a few seconds of server work) and shows it as four readable stages, then a Done
   beat, then the "View your report" button. Nothing redirects on its own.

   The rules from the share-link scan apply here too: a stage stays on screen at
   least a moment, every wait pauses while the tab is hidden, the stage changes are
   announced to screen readers, reduced motion drops the waits to a minimum, and a
   failure is shown in place with a retry rather than left blank.

   The server is the source of truth: if this page is closed and opened again, the
   job is still where it was, and this screen picks it up.
   ===================================================================== */
(function () {
  'use strict';

  var STAGES = [
    { id: 'site', label: 'Reading robots.txt and the sitemap' },
    { id: 'pick', label: 'Choosing up to 25 pages' },
    { id: 'scan', label: 'Reading and scoring the pages' },
    { id: 'plan', label: 'Estimating the fixes' }
  ];
  var PACE = { stageMs: 700, doneMs: 700 };
  var REDUCED = { stageMs: 250, doneMs: 150 };
  var STEP_TIMEOUT_MS = 70000;      // a step can take most of a minute on the server
  var BUSY_WAIT_MS = 1500;          // another tab is working on the same job: look again shortly
  var MAX_QUIET_FAILS = 2;          // failed steps retried silently before the error is shown
  var SLOW_HINT_MS = 90000;

  function reduced() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }

  /* ---------- a clock that waits for the tab (same idea as scanner.js vwait) ---------- */
  var waiting = [];
  function hidden() { return document.visibilityState === 'hidden'; }
  function vwait(ms) {
    return new Promise(function (resolve) {
      var left = ms, t0 = 0, timer = 0;
      var w = {
        resume: function () { if (timer || hidden()) return; t0 = Date.now(); timer = setTimeout(finish, left); },
        pause: function () { if (!timer) return; clearTimeout(timer); timer = 0; left = Math.max(0, left - (Date.now() - t0)); }
      };
      function finish() { timer = 0; var i = waiting.indexOf(w); if (i !== -1) waiting.splice(i, 1); resolve(); }
      waiting.push(w);
      w.resume();
    });
  }
  document.addEventListener('visibilitychange', function () { waiting.slice().forEach(function (w) { if (hidden()) w.pause(); else w.resume(); }); });
  function untilVisible() {
    return new Promise(function (resolve) {
      if (!hidden()) return resolve();
      function on() { if (!hidden()) { document.removeEventListener('visibilitychange', on); resolve(); } }
      document.addEventListener('visibilitychange', on);
    });
  }

  /* ---------- requests ---------- */
  function call(method, url) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, STEP_TIMEOUT_MS);
    return fetch(url, { method: method, headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'omit', signal: ctrl ? ctrl.signal : undefined }).then(function (res) {
      clearTimeout(timer);
      return res.json().then(function (body) { return { ok: res.ok, status: res.status, body: body }; }, function () { return { ok: false, status: res.status, body: {} }; });
    }, function (err) { clearTimeout(timer); throw err; });
  }

  function mount(root, opts) {
    var jobId = opts.jobId;
    var pace = reduced() ? REDUCED : PACE;
    var startedAt = Date.now();
    var shown = 0;            // index of the stage on screen (stages before it are done)
    var target = 0;           // the stage the real work has reached
    var finished = false;     // the server said done, partial or failed
    var last = null;          // the last job view from the server
    var errorShown = false;
    var stopped = false;

    root.textContent = '';
    root.classList.add('pp');
    var head = el('div', 'pp-head');
    var kicker = el('p', 'pp-kicker', 'Citehound Pro');
    var title = el('h1', 'pp-title', 'Making your report');
    title.setAttribute('tabindex', '-1');
    var sub = el('p', 'pp-sub', 'A report usually takes a few minutes, because the crawl waits one second between requests to be polite to your site.');
    var keep = el('p', 'pp-note pp-keepopen', 'Keep this tab open while we scan. If you close it, open the same link again and it will continue.');
    head.appendChild(kicker); head.appendChild(title); head.appendChild(sub); head.appendChild(keep);
    var live = el('p', 'pp-live');
    live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
    var list = el('ol', 'pp-stages');
    var items = STAGES.map(function (s) {
      var li = el('li', 'pp-stage is-todo');
      var label = el('span', 'pp-stage__label', s.label);
      var count = el('span', 'pp-stage__count');
      var state = el('span', 'pp-stage__state', 'Waiting');
      var bar = null;
      if (s.id === 'scan') { bar = el('span', 'rp-bar pp-stage__bar'); bar.setAttribute('aria-hidden', 'true'); var fill = el('span', 'rp-bar__fill'); fill.style.width = '0%'; bar.appendChild(fill); }
      li.appendChild(label); li.appendChild(count); li.appendChild(state); if (bar) li.appendChild(bar);
      list.appendChild(li);
      return { li: li, state: state, count: count, bar: bar };
    });
    var slow = el('p', 'pp-note');
    var errBox = el('div', 'pp-error'); errBox.hidden = true;
    var result = el('div', 'pp-result'); result.hidden = true;
    root.appendChild(head); root.appendChild(live); root.appendChild(list); root.appendChild(slow); root.appendChild(errBox); root.appendChild(result);

    function say(text) { live.textContent = text; }

    function paint() {
      items.forEach(function (it, i) {
        var done = i < shown, active = i === shown && !finishedAll;
        it.li.className = 'pp-stage ' + (done ? 'is-done' : (active ? 'is-active' : 'is-todo'));
        it.state.textContent = done ? 'Done' : (active ? 'Working' : 'Waiting');
        if (active) it.li.setAttribute('aria-current', 'step'); else it.li.removeAttribute('aria-current');
      });
      var p = last && last.progress;
      if (p) {
        var scan = items[2];
        var pct = p.total ? Math.round(p.settled / p.total * 100) : 0;
        scan.count.textContent = p.total ? p.settled + ' of ' + p.total + ' pages' : '';
        if (scan.bar) scan.bar.firstChild.style.width = (shown > 2 ? 100 : pct) + '%';
      }
    }

    var finishedAll = false;

    // Stages tick one at a time, each on screen for at least stageMs, and only once the work has reached the next one.
    // A failed job skips the cascade: it did not do the stages it would otherwise be shown as having finished.
    async function ticker() {
      say(STAGES[0].label + '.');
      paint();
      while (!stopped && shown < STAGES.length) {
        await vwait(pace.stageMs);
        while (!stopped && !(target > shown || finished)) await vwait(150);
        if (stopped) return;
        if (finished && last && last.status === 'failed') break;
        shown++;
        if (shown < STAGES.length) say(STAGES[shown].label + '.');
        paint();
      }
      if (stopped) return;
      finishedAll = true;
      paint();
      await vwait(pace.doneMs);
      if (!stopped) showResult();
    }

    function apply(view) {
      last = view;
      if (view.status === 'done' || view.status === 'partial' || view.status === 'failed') { finished = true; target = STAGES.length - 1; }
      else if (view.phase === 'scan') target = Math.max(target, 2);
      paint();
    }

    function showError(message, retry) {
      errorShown = true;
      errBox.hidden = false;
      errBox.textContent = '';
      var p = el('p', 'pp-error__text', message);
      p.setAttribute('role', 'alert');
      var b = el('button', 'btn btn--primary pp-error__retry', 'Try again');
      b.type = 'button';
      b.addEventListener('click', function () { errBox.hidden = true; errorShown = false; retry(); });
      errBox.appendChild(p); errBox.appendChild(b);
    }

    function userMessage(r) {
      if (r && r.status === 429) return 'Too many requests from your network right now. Wait a minute and try again. Your report keeps its place.';
      if (r && r.status === 503) return 'Report storage is not available right now. Your report keeps its place; try again in a few minutes.';
      if (r && r.status === 404) return 'This report is no longer available.';
      return 'We lost the connection to the crawl. Your report keeps its place; try again.';
    }

    async function drive() {
      var quiet = 0;
      while (!stopped && !finished) {
        if (hidden()) await untilVisible();
        var r = null;
        try { r = await call('POST', '/api/pro/step?id=' + encodeURIComponent(jobId)); } catch (e) { r = null; }
        if (stopped) return;
        if (r && r.ok && r.body && r.body.status) {
          quiet = 0;
          apply(r.body);
          if (r.body.busy && !finished) await vwait(BUSY_WAIT_MS);
          continue;
        }
        if (r && r.status === 404) { showError(userMessage(r), function () {}); errBox.querySelector('button').hidden = true; return; }
        quiet++;
        if (quiet <= MAX_QUIET_FAILS && !(r && r.status === 429)) { await vwait(1500 * quiet); continue; }
        showError(userMessage(r), function () { drive(); });
        return;
      }
    }

    function reportUrl() { return location.origin + (last && last.reportPath ? last.reportPath : '/r/' + jobId + '/'); }

    function copy(text, button) {
      var done = function () { var was = button.textContent; button.textContent = 'Copied'; say('Link copied.'); setTimeout(function () { button.textContent = was; }, 2000); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallback(); });
      else fallback();
      function fallback() {
        var ta = el('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { button.textContent = 'Select and copy'; }
        document.body.removeChild(ta);
      }
    }

    function showResult() {
      list.classList.add('is-finished');
      slow.textContent = '';
      keep.hidden = true;
      result.hidden = false; result.textContent = '';
      var s = last && last.status;
      if (s === 'failed') {
        var why = (last && last.reason) || 'The crawl could not read the site.';
        if (last && last.linkRestored) {
          // No page was read, so the link has been given back.
          title.textContent = 'We couldn\u2019t scan this site';
          sub.textContent = 'We couldn\u2019t scan this site. Your link is still valid, try again or use a different site.';
          say(sub.textContent + ' ' + why);
          result.appendChild(el('p', 'pp-note', why));
          if (opts.retryHref) {
            var again = el('a', 'btn btn--primary pp-view', 'Try again');
            again.href = opts.retryHref;
            result.appendChild(again);
          } else {
            result.appendChild(el('p', 'pp-note', 'Open the link you were sent again to start over.'));
          }
          title.focus({ preventScroll: true });
          return;
        }
        title.textContent = 'We could not make this report';
        sub.textContent = why;
        say('The report could not be made. ' + sub.textContent);
        var contact = el('p', 'pp-note');
        contact.appendChild(document.createTextNode('This link can no longer be used, so write to '));
        var a = el('a', null, 'hey@getcitehound.com'); a.href = 'mailto:hey@getcitehound.com';
        contact.appendChild(a);
        contact.appendChild(document.createTextNode(' with this page\u2019s address and we will look into it.'));
        result.appendChild(contact);
        title.focus({ preventScroll: true });
        return;
      }
      var partial = s === 'partial';
      title.textContent = partial ? 'Your report is ready, with limits' : 'Your report is ready';
      sub.textContent = partial ? ((last && last.reason) || 'The crawl covered part of the site.') + ' The report says exactly what it covers.' : 'Open it now, or copy the link and open it later.';
      say(title.textContent + '.');
      var btn = el('a', 'btn btn--gold pp-view', 'View your report');
      btn.href = (last && last.reportPath) || '/r/' + jobId + '/';
      result.appendChild(btn);
      var row = el('div', 'pp-link');
      var url = el('input', 'field pp-link__url');
      url.type = 'text'; url.readOnly = true; url.value = reportUrl(); url.setAttribute('aria-label', 'Report link');
      url.addEventListener('focus', function () { url.select(); });
      var cp = el('button', 'btn btn--ghost pp-link__copy', 'Copy link');
      cp.type = 'button';
      cp.addEventListener('click', function () { copy(url.value, cp); });
      row.appendChild(url); row.appendChild(cp);
      result.appendChild(row);
      result.appendChild(el('p', 'pp-keep', 'Keep this link. Anyone with it can open the report. It expires in 90 days.'));
      title.focus({ preventScroll: true });
      if (opts.onDone) opts.onDone(last);
    }

    // What to say after a long wait.
    var slowTimer = setInterval(function () {
      if (stopped || finished) return;
      if (Date.now() - startedAt > SLOW_HINT_MS && !slow.textContent) slow.textContent = 'This site needs a little longer. The crawl is still running; you can keep waiting here.';
    }, 5000);

    // Start from wherever the job already is, then drive it.
    call('GET', '/api/pro/status?id=' + encodeURIComponent(jobId)).then(function (r) {
      if (r.ok && r.body && r.body.status) apply(r.body);
    }, function () { /* the first step will say */ }).then(function () {
      if (!finished) drive();
      ticker();
    });

    return { destroy: function () { stopped = true; clearInterval(slowTimer); } };
  }

  window.CITEHOUND_PRO_PROGRESS = { mount: mount };

  // /r/<id>/ for a report that is still being made: the page carries the job id, this screen takes over.
  var auto = document.querySelector('[data-pro-job]');
  if (auto) mount(auto, { jobId: auto.getAttribute('data-pro-job') });
}());
