/* =====================================================================
   lib/crawlers.js — the ten tracked AI crawlers: vendor, what each one
   does, and what allowing or blocking it means. Single source of truth,
   loaded two ways (UMD, no build step — see lib/playbooks.js for the
   same pattern):
     - As a browser <script>, before tools/robots-txt.js, which sets
       window.CITEHOUND_CRAWLERS.
     - Via Node's require() from api/mcp.js (list_ai_crawlers and
       generate_robots_txt).
   This list must stay the same ten user-agents lib/scanner.js's BOTS
   array checks for — it's the same ten crawlers, described for a
   human (or a model) deciding whether to allow or block each one.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CITEHOUND_CRAWLERS = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CRAWLERS = [
    {
      ua: 'GPTBot',
      vendor: 'OpenAI',
      defaultAllow: true,
      desc: 'OpenAI’s crawler for training GPT models. Allowing it means your pages can shape what ChatGPT knows.'
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
      desc: 'Powers ChatGPT’s search feature. Allowing it means your pages can surface in ChatGPT search results.'
    },
    {
      ua: 'ClaudeBot',
      vendor: 'Anthropic',
      defaultAllow: true,
      desc: 'Anthropic’s crawler for training Claude models. Allowing it means your pages can shape what Claude knows.'
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
      desc: 'Perplexity’s indexing crawler. Allowing it means your content can be cited in Perplexity’s answers.'
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
      desc: 'Common Crawl’s crawler, whose public dataset trains many AI models. Allowing it means your content may train models beyond any single company.'
    },
    {
      ua: 'Bytespider',
      vendor: 'ByteDance',
      defaultAllow: false,
      desc: 'ByteDance’s crawler, used to gather AI training data. Many site owners block it over aggressive crawling behavior.'
    }
  ];

  return CRAWLERS;
}));
