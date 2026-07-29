/* =====================================================================
   AI robots.txt Generator — tools/robots-txt.html
   Fully client-side. No API calls, nothing stored, nothing sent anywhere.
   ===================================================================== */

(function () {
  'use strict';

  var CRAWLERS = [
    {
      ua: 'GPTBot',
      vendor: 'OpenAI',
      defaultAllow: true,
      desc: 'OpenAI\u2019s crawler for training GPT models. Allowing it means your pages can shape what ChatGPT knows.'
    },
    {
      ua: 'ChatGPT-User',
      vendor: 'OpenAI',
      defaultAllow: true,
      desc: 'Used when ChatGPT browses live to answer a question. Allowing it means ChatGPT can read and cite your page in real time.'
    },
    {
      ua: 'OAI-SearchBot',
      vendor: 'OpenAI',
      defaultAllow: true,
      desc: 'Powers ChatGPT\u2019s search feature. Allowing it means your pages can surface in ChatGPT search results.'
    },
    {
      ua: 'ClaudeBot',
      vendor: 'Anthropic',
      defaultAllow: true,
      desc: 'Anthropic\u2019s crawler for training Claude models. Allowing it means your pages can shape what Claude knows.'
    },
    {
      ua: 'anthropic-ai',
      vendor: 'Anthropic',
      defaultAllow: true,
      desc: 'An older Anthropic user agent, same purpose as ClaudeBot. Allowing it covers legacy Anthropic crawler requests.'
    },
    {
      ua: 'PerplexityBot',
      vendor: 'Perplexity',
      defaultAllow: true,
      desc: 'Perplexity\u2019s indexing crawler. Allowing it means your content can be cited in Perplexity\u2019s answers.'
    },
    {
      ua: 'Perplexity-User',
      vendor: 'Perplexity',
      defaultAllow: true,
      desc: 'Used when Perplexity fetches a page live to answer a question. Allowing it means Perplexity can read your page in real time.'
    },
    {
      ua: 'Google-Extended',
      vendor: 'Google',
      defaultAllow: true,
      desc: 'Controls AI training access separate from Search indexing. Allowing it means Google can use your content to train Gemini and other AI features.'
    },
    {
      ua: 'CCBot',
      vendor: 'Common Crawl',
      defaultAllow: true,
      desc: 'Common Crawl\u2019s crawler, whose public dataset trains many AI models. Allowing it means your content may train models beyond any single company.'
    },
    {
      ua: 'Bytespider',
      vendor: 'ByteDance',
      defaultAllow: false,
      desc: 'ByteDance\u2019s crawler, used to gather AI training data. Many site owners block it over aggressive crawling behavior.'
    }
  ];

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
