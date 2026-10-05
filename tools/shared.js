/* =====================================================================
   tools/shared.js: behaviour every tool page shares, driven by data
   attributes so the page scripts stay as they are.

     data-toolx-param="domain|sitemap"   the input whose value lives in the address
     data-toolx-status                   the status area (errors get a retry button)
     data-toolx-result                   the region that takes focus after a run
     data-toolx-check="robots|jsonld|llmstxt"  output that gets a "Checked:" line
     data-toolx-download="<label>"       a download button that confirms in the toast
     data-toolx-example / -target        the "Try an example" button and the input it fills
     data-toolx-live                     a status line that reads the output (robots.txt)

   Load it before the page's own script. Nothing is stored and nothing is
   sent anywhere; the only request is the one the page already makes.
   ===================================================================== */

(function () {
  'use strict';

  var doc = document;
  var $$ = function (sel) { return Array.prototype.slice.call(doc.querySelectorAll(sel)); };

  /* ---------------- the scanner's domain rule (lib/scanner.js normalizeDomain) ---------------- */

  function normalizeDomain(raw) {
    var d = (typeof raw === 'string' ? raw : '').trim().toLowerCase();
    d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)) return null;
    return d;
  }

  function validUrl(raw) {
    try { var u = new URL(raw); return u.protocol === 'http:' || u.protocol === 'https:'; } catch (e) { return false; }
  }

  function valid(name, value) {
    return name === 'domain' ? normalizeDomain(value) !== null : validUrl(value);
  }

  /* ---------------- address ---------------- */

  function setAddress(params) {
    var q = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (q ? '?' + q : '') + (window.location.hash || ''));
  }

  function writeParam(name, value) {
    var params = new URLSearchParams(window.location.search);
    if (value) params.set(name, value); else params.delete(name);
    setAddress(params);
  }

  // An invalid value is dropped before the page script reads the address, so it is ignored silently.
  var paramInputs = $$('[data-toolx-param]');
  (function dropInvalid() {
    var params = new URLSearchParams(window.location.search);
    var changed = false;
    paramInputs.forEach(function (inp) {
      var name = inp.getAttribute('data-toolx-param');
      if (params.has(name) && !valid(name, params.get(name))) { params.delete(name); changed = true; }
    });
    if (changed) setAddress(params);
  }());

  /* ---------------- toast and a clearer rate-limit message ---------------- */

  function toast(message) {
    var t = doc.getElementById('toast');
    if (!t) return;
    t.textContent = message;
    t.classList.add('is-visible');
    setTimeout(function () { t.classList.remove('is-visible'); }, 2600);
  }

  function humanWait(seconds) {
    if (!(seconds > 0)) return null;
    if (seconds < 90) return seconds + ' seconds';
    if (seconds < 3600) return Math.round(seconds / 60) + ' minutes';
    var h = Math.round(seconds / 3600);
    return h + (h === 1 ? ' hour' : ' hours');
  }

  // The API says "try again in a little while". The Retry-After header says how long.
  if (typeof window.fetch === 'function') {
    var nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      return nativeFetch(input, init).then(function (res) {
        var u = typeof input === 'string' ? input : (input && input.url) || '';
        if (!res || res.status !== 429 || u.indexOf('/api/') === -1) return res;
        var wait = humanWait(parseInt(res.headers.get('Retry-After'), 10));
        return res.clone().json().then(function (body) {
          var msg = (body && body.error) || 'You’ve hit the limit.';
          if (wait) msg = /Try again[^.]*\./.test(msg) ? msg.replace(/Try again[^.]*\./, 'Try again in about ' + wait + '.') : msg + ' Try again in about ' + wait + '.';
          return new Response(JSON.stringify({ error: msg, limit: body && body.limit }), { status: 429, headers: { 'Content-Type': 'application/json' } });
        }, function () { return res; });
      });
    };
  }

  /* ---------------- observe ---------------- */

  function observe(target, fn) {
    if (typeof MutationObserver !== 'function' || !target) return;
    new MutationObserver(fn).observe(target, { childList: true, subtree: true, attributes: true, characterData: true });
  }

  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* ---------------- forms: validation, address, errors with a retry, focus on the result ---------------- */

  var statusEl = doc.querySelector('[data-toolx-status]');
  var resultEl = doc.querySelector('[data-toolx-result]');

  paramInputs.forEach(function (inp) {
    var name = inp.getAttribute('data-toolx-param');
    var form = inp.closest('form');
    if (!form) return; // sitemap: handled below, it has no form

    var retry = null;
    var pending = false;

    function submit() {
      if (form.requestSubmit) form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }

    if (statusEl) {
      retry = el('button', 'btn btn--ghost toolx-retry', 'Try again');
      retry.type = 'button';
      retry.hidden = true;
      statusEl.parentNode.insertBefore(retry, statusEl.nextSibling);
      retry.addEventListener('click', submit);
    }

    // First listener on the form: it can stop the page from sending a value the scanner would refuse.
    form.addEventListener('submit', function (e) {
      var raw = inp.value.trim();
      if (!raw) return; // the page already says what is missing
      var clean = name === 'domain' ? normalizeDomain(raw) : raw;
      if (!clean) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (statusEl) { statusEl.textContent = 'Enter a valid domain, such as example.com.'; statusEl.className = 'tool-status is-error'; }
        inp.focus();
        return;
      }
      pending = true;
      writeParam(name, clean);
    });

    function changed() {
      if (!statusEl) return;
      var text = statusEl.textContent || '';
      var isError = /\bis-error\b/.test(statusEl.className || '');
      if (retry) retry.hidden = !(isError && !/^Enter/.test(text));
      if (!pending) return;
      if (isError) { pending = false; return; }
      if (/…$/.test(text)) return; // still working
      if (resultEl && !resultEl.hidden) {
        pending = false;
        if (!resultEl.hasAttribute('tabindex')) resultEl.setAttribute('tabindex', '-1');
        resultEl.focus();
      }
    }
    observe(statusEl, changed);
    observe(resultEl, changed);
  });

  /* ---------------- the cheap, real format checks behind "Checked:" ---------------- */

  var CHECKS = {
    robots: function (text) {
      var lines = String(text).split('\n');
      var sawAgent = false;
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i].trim();
        if (!l || l.charAt(0) === '#') continue;
        if (/^user-agent:\s*\S/i.test(l)) { sawAgent = true; continue; }
        if (!sawAgent) return null;
        if (/^(allow|disallow|crawl-delay):/i.test(l) || /^sitemap:\s*\S/i.test(l)) continue;
        return null;
      }
      return sawAgent ? 'every line is a known robots.txt directive.' : null;
    },
    jsonld: function (text) {
      var s = String(text).trim();
      var m = /^<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*)<\/script>$/.exec(s);
      if (m) s = m[1];
      var obj;
      try { obj = JSON.parse(s); } catch (e) { return null; }
      if (!obj || typeof obj !== 'object' || typeof obj['@context'] !== 'string') return null;
      var typed = function (o) { return o && typeof o === 'object' && o['@type']; };
      var ok = Array.isArray(obj['@graph']) ? obj['@graph'].length > 0 && obj['@graph'].every(typed) : !!typed(obj);
      return ok ? 'valid JSON with @context and @type.' : null;
    },
    llmstxt: function (text) {
      return /^# \S/.test(String(text)) ? 'starts with a level-one heading.' : null;
    }
  };

  $$('[data-toolx-check]').forEach(function (out) {
    var check = CHECKS[out.getAttribute('data-toolx-check')];
    if (!check) return;
    var holder = (out.closest && out.closest('.fix-snippet')) || out;
    var line = el('p', 'toolx-checked');
    line.hidden = true;
    holder.parentNode.insertBefore(line, holder.nextSibling);
    function update() {
      var msg = check(out.textContent);
      line.hidden = !msg;
      line.textContent = msg ? 'Checked: ' + msg : '';
    }
    observe(out, update);
    update();
  });

  /* ---------------- robots.txt: a status line that reads the output ---------------- */

  var live = doc.querySelector('[data-toolx-live]');
  var liveFrom = doc.querySelector('[data-toolx-check="robots"]');
  if (live && liveFrom) {
    var tell = function () {
      var lines = String(liveFrom.textContent).split('\n');
      var allowed = lines.filter(function (l) { return /^Allow:/i.test(l); }).length;
      var blocked = lines.filter(function (l) { return /^Disallow:/i.test(l); }).length;
      live.textContent = allowed + blocked ? 'robots.txt updated: ' + allowed + ' crawlers allowed, ' + blocked + ' blocked.' : '';
    };
    observe(liveFrom, tell);
  }

  /* ---------------- downloads confirm in the toast ---------------- */

  $$('[data-toolx-download]').forEach(function (b) {
    b.addEventListener('click', function () { toast(b.getAttribute('data-toolx-download') + ' downloaded'); });
  });

  /* ---------------- sitemap parameter (robots.txt generator) ---------------- */

  function ready(fn) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn);
    else setTimeout(fn, 0);
  }

  paramInputs.forEach(function (inp) {
    if (inp.getAttribute('data-toolx-param') !== 'sitemap') return;
    // The page script listens for input after this file loads, so fill the field once it is ready.
    ready(function () {
      var v = new URLSearchParams(window.location.search).get('sitemap');
      if (v) { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    inp.addEventListener('input', function () {
      var v = inp.value.trim();
      writeParam('sitemap', v && validUrl(v) ? v : '');
    });
  });

  /* ---------------- Try an example ---------------- */

  $$('[data-toolx-example]').forEach(function (b) {
    b.addEventListener('click', function () {
      var target = doc.querySelector(b.getAttribute('data-toolx-target'));
      if (!target) return;
      target.value = b.getAttribute('data-toolx-example');
      var form = target.closest('form');
      if (form) {
        if (form.requestSubmit) form.requestSubmit();
        else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      } else {
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  });
}());
