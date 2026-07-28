/* =====================================================================
   CITED SCAN — frontend
   All scanning logic now lives server-side in /api/scan.js (Vercel).
   This file only calls the API and renders the result. No proxies,
   no CORS workarounds.
   ===================================================================== */

(function () {
  'use strict';

  var CONFIG = {
    contactEmail: 'you@example.com', // ← replace before deploying
    shareUrl: 'https://andacuzel.github.io/cited-geo-guide/' // ← update if you move to a custom domain
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

  if (agencyLink) agencyLink.href = 'mailto:' + CONFIG.contactEmail + '?subject=Cited%20%E2%80%94%20done-for-you%20AI%20visibility';

  var lastScore = null;

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
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

    scanBtn.disabled = true;
    report.hidden = true;

    try {
      setStatus('Scanning\u2026');
      var res = await fetch('/api/scan?domain=' + encodeURIComponent(domain));
      var data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || ('Scan failed (HTTP ' + res.status + ')'));
      }

      renderReport(data.domain, data.robotsOk, data.botResults, data.result);
      setStatus('');
    } catch (err) {
      setStatus('Scan failed: ' + (err && err.message ? err.message : 'connection error'), true);
    } finally {
      scanBtn.disabled = false;
    }
  }

  /* ---------------- Render ---------------- */

  function renderReport(domain, robotsOk, botResults, r) {
    lastScore = { domain: domain, total: r.total };

    $('scoreValue').textContent = r.total;
    $('scoreDomain').textContent = domain + ' \u00b7 retrieved ' + new Date().toLocaleDateString('en-GB');

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

    report.hidden = false;
    report.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------- Share ---------------- */

  function shareScore() {
    if (!lastScore) return;
    var text = lastScore.domain + ' scored ' + lastScore.total + '/100 on AI visibility. Scan yours free \u2014 no signup: ' + CONFIG.shareUrl;
    if (navigator.share) {
      navigator.share({ title: 'Cited. \u2014 AI visibility score', text: text, url: CONFIG.shareUrl }).catch(function () {});
    } else {
      navigator.clipboard.writeText(text).then(function () {
        var toast = $('toast');
        if (toast) {
          toast.textContent = 'Score copied \u2014 paste it anywhere.';
          toast.classList.add('is-visible');
          setTimeout(function () { toast.classList.remove('is-visible'); }, 2600);
        }
      });
    }
  }

  /* ---------------- Wiring ---------------- */

  form.addEventListener('submit', function (e) { e.preventDefault(); runScan(); });
  retryBtn.addEventListener('click', function () { runScan(); });
  $('shareBtn').addEventListener('click', shareScore);

}());
