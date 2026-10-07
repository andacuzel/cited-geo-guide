/* =====================================================================
   AI robots.txt Generator — tools/robots-txt.html
   Fully client-side. No API calls, nothing stored, nothing sent anywhere.
   ===================================================================== */

(function () {
  'use strict';

  // Shared with api/mcp.js (list_ai_crawlers, generate_robots_txt) via
  // lib/crawlers.js, loaded as a <script> before this file \u2014 see that
  // file for the data and why it's not duplicated here.
  var CRAWLERS = window.CITEHOUND_CRAWLERS || [];

  var $ = function (id) { return document.getElementById(id); };

  var list = $('crawlerList');
  if (!list) return;

  var output = $('robotsOutput');
  var sitemapInput = $('sitemapUrl');
  var copyBtn = $('robotsCopyBtn');
  var downloadBtn = $('robotsDownloadBtn');

  function showToast(message) {
    var toast = $('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    setTimeout(function () { toast.classList.remove('is-visible'); }, 2600);
  }

  function renderCrawlerList() {
    list.innerHTML = CRAWLERS.map(function (c, i) {
      return '<div class="crawler-row">' +
        '<label class="crawler-row__toggle">' +
          '<input type="checkbox" class="crawler-row__checkbox" data-index="' + i + '"' + (c.defaultAllow ? ' checked' : '') + ' />' +
          '<span class="crawler-row__name">' + c.ua + '</span>' +
          '<span class="crawler-row__vendor">' + c.vendor + '</span>' +
        '</label>' +
        '<p class="crawler-row__desc">' + c.desc + '</p>' +
      '</div>';
    }).join('');
  }

  function buildRobotsTxt() {
    var checkboxes = list.querySelectorAll('.crawler-row__checkbox');
    var lines = [];
    checkboxes.forEach(function (cb) {
      var c = CRAWLERS[Number(cb.getAttribute('data-index'))];
      lines.push('User-agent: ' + c.ua);
      lines.push(cb.checked ? 'Allow: /' : 'Disallow: /');
      lines.push('');
    });

    var sitemap = (sitemapInput.value || '').trim();
    if (sitemap) {
      lines.push('Sitemap: ' + sitemap);
    } else {
      lines.pop();
    }
    return lines.join('\n');
  }

  function renderOutput() {
    output.textContent = buildRobotsTxt();
  }

  function downloadRobotsTxt() {
    var blob = new Blob([buildRobotsTxt()], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'robots.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  renderCrawlerList();
  renderOutput();

  list.addEventListener('change', function (e) {
    if (e.target.classList.contains('crawler-row__checkbox')) renderOutput();
  });
  sitemapInput.addEventListener('input', renderOutput);

  copyBtn.addEventListener('click', function () {
    navigator.clipboard.writeText(output.textContent).then(function () {
      showToast('robots.txt copied \u2014 paste it at your site root.');
    });
  });

  downloadBtn.addEventListener('click', downloadRobotsTxt);

}());
