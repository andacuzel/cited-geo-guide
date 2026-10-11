/* Recorded shapes of the real replies (trimmed, secrets and encrypted blobs removed), from one live call each on 11 Oct 2026. scripts/test-citation.js feeds them to the adapters. */
'use strict';

module.exports = {
  anthropicSearch: {
    "model": "claude-haiku-5-5",
    "id": "msg_fixture",
    "type": "message",
    "role": "assistant",
    "content": [
      {
        "type": "thinking",
        "thinking": "",
        "signature": "REDACTED"
      },
      {
        "type": "server_tool_use",
        "id": "srvtoolu_01P9mqs8ELWvgTdvSDYHMMFF",
        "name": "web_search",
        "input": {
          "query": "tools check website readable by AI crawlers"
        }
      },
      {
        "type": "web_search_tool_result",
        "tool_use_id": "srvtoolu_01P9mqs8ELWvgTdvSDYHMMFF",
        "content": [
          {
            "type": "web_search_result",
            "title": "AI Crawler Access Checker - MRS Digital",
            "url": "https://mrs.digital/tools/ai-crawler-access-checker/",
            "encrypted_content": "REDACTED",
            "page_age": "236 days ago"
          },
          {
            "type": "web_search_result",
            "title": "AI Crawlability Checker - Can AI Bots Read Your Page? - LLMrefs",
            "url": "https://llmrefs.com/tools/ai-crawl-checker",
            "encrypted_content": "REDACTED",
            "page_age": null
          },
          {
            "type": "web_search_result",
            "title": "Free GEO Crawlability Checker: Static vs JS Content",
            "url": "https://llmpulse.ai/geo-crawlability-checker",
            "encrypted_content": "REDACTED",
            "page_age": null
          },
          {
            "type": "web_search_result",
            "title": "Free AI Crawlability Checker [No Signup Required]",
            "url": "https://orchly.ai/free-tools/ai-crawlability-checker/",
            "encrypted_content": "REDACTED",
            "page_age": null
          },
          {
            "type": "web_search_result",
            "title": "AI Crawler Checker: Can ChatGPT See Your Site?",
            "url": "https://www.surmado.com/tools/ai-crawler-checker",
            "encrypted_content": "REDACTED",
            "page_age": null
          },
          {
            "type": "web_search_result",
            "title": "CrawlerCheck: Free Googlebot & AI Crawlability Test",
            "url": "https://crawlercheck.com/",
            "encrypted_content": "REDACTED",
            "page_age": "244 days ago"
          },
          {
            "type": "web_search_result",
            "title": "Crawl Readiness — Check If AI Can Read Your Site",
            "url": "https://www.crawlreadiness.com/",
            "encrypted_content": "REDACTED",
            "page_age": null
          },
          {
            "type": "web_search_result",
            "title": "Free AI Crawler Accessibility Checker",
            "url": "https://www.adamigo.ai/free-tools/ai-search-visibility-checker",
            "encrypted_content": "REDACTED",
            "page_age": null
          },
          {
            "type": "web_search_result",
            "title": "ai crawler optimization tips",
            "url": "https://www.practicalecommerce.com/ai-crawler-optimization-tips",
            "encrypted_content": "REDACTED",
            "page_age": null
          }
        ],
        "caller": {
          "type": "direct"
        }
      },
      {
        "type": "thinking",
        "thinking": "",
        "signature": "REDACTED"
      },
      {
        "type": "text",
        "text": "Several free tools check whether AI bots can reach your site. Robots.txt-focused checkers include "
      },
      {
        "citations": [
          {
            "type": "web_search_result_location",
            "cited_text": "See if OAI-SearchBot, ClaudeBot, PerplexityBot and more are allowed or blocked by your robots.txt. ",
            "url": "https://www.surmado.com/tools/ai-crawler-checker",
            "title": "AI Crawler Checker: Can ChatGPT See Your Site?",
            "encrypted_index": "REDACTED"
          }
        ],
        "type": "text",
        "text": "Surmado's AI Crawler Checker, which shows whether OAI-SearchBot, ClaudeBot, and PerplexityBot are allowed or blocked"
      },
      {
        "type": "text",
        "text": ", along with MRS Digital's AI Crawler Access Checker and CrawlerCheck. For JavaScript-rendering problems, LLMrefs' AI Crawlability Checker and LLM Pulse's GEO Crawlability Checker "
      },
      {
        "citations": [
          {
            "type": "web_search_result_location",
            "cited_text": "## Crawlability is the foundation of AI visibility\nThis free checker fetches your page exactly the way an AI crawler does and compares it against the ...",
            "url": "https://llmpulse.ai/geo-crawlability-checker",
            "title": "Free GEO Crawlability Checker: Static vs JS Content",
            "encrypted_index": "REDACTED"
          }
        ],
        "type": "text",
        "text": "fetch your page the way an AI crawler does and compare it against the fully rendered browser version"
      }
    ],
    "container": null,
    "stop_reason": "end_turn",
    "stop_sequence": null,
    "stop_details": null,
    "usage": {
      "input_tokens": 14280,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 0,
      "cache_creation": {
        "ephemeral_5m_input_tokens": 0,
        "ephemeral_1h_input_tokens": 0
      },
      "output_tokens": 721,
      "output_tokens_details": {
        "thinking_tokens": 356
      },
      "service_tier": "standard",
      "inference_geo": "global",
      "server_tool_use": {
        "web_search_requests": 1,
        "web_fetch_requests": 0
      }
    },
    "diagnostics": null
  },
  perplexityAgent: {
    "background": false,
    "completed_at": 1791713440,
    "created_at": 1791713440,
    "error": null,
    "frequency_penalty": 0,
    "id": "fixture",
    "incomplete_details": null,
    "max_output_tokens": 600,
    "max_tool_calls": null,
    "model": "perplexity/sonar",
    "object": "response",
    "output": [
      {
        "queries": [
          "AI crawler accessibility checker website robots.txt tool",
          "website check AI crawlers readability tool GPTBot ClaudeBot"
        ],
        "results": [
          {
            "date": "2026-09-28",
            "id": 1,
            "last_updated": "2026-10-11",
            "snippet": "# AI Crawler Checker - robots.txt Checker for GPTBot & AI Bots\nCheck if GPTBot, ClaudeBot, PerplexityBot and 26 more AI crawlers are blocked on your site: bulk robots.txt check of up to 10,000 domains, AI search score, fix snippet, Content Signals, change alerts.\n...\n## What does AI Crawler Access Checker do?\nAI Crawler Access Checker (an AI crawler checker and bulk robots.txt checker) tells you whether **GPTBot and 28 other AI crawlers are blocked** on a site: give it one website or **up to 10,000 domains**, and get each bot's status (`allowed`, `partial`, `blocked` or `unknown`) from the site's `robots.txt`, an AI search score, a **ready-to-paste robots.txt fix** and **change tracking week to week**, for **$2 per 1,000 sites**.\n...\n### How to check if GPTBot is blocked on your site\n1. Paste your website (`example.com`) into **websites**; add more lines to check many sites at once.\n2. Click **Start**.\n3. Find `GPTBot` in `bots` (or in `blockedBots`): `allowed`, `partial`, `blocked`, or `unknown` when robots.txt could not be read (not charged).\n4. To change it, paste the lines from the *Fix snippets* view into your robots.txt.",
            "source": "web",
            "title": "apify.com › tidytools › ai-crawler-access-checkerAI Crawler Access Checker - Block AI Bots in robots.txt · Apify",
            "url": "https://apify.com/tidytools/ai-crawler-access-checker"
          },
          {
            "id": 2,
            "last_updated": "2026-10-06",
            "snippet": "# AI Access Tester\nYour website’s robots.txt file controls which AI crawlers can access your content.\nIf models like ChatGPT, Claude, or Gemini are blocked, they can’t learn about your brand — and they can’t recommend you.\nEnter your domain and see exactly who’s allowed in.\n...\n## Free Assessment in Seconds\n### Enter Your Domain\nType any website URL.\nNo login, no email, no strings attached.\n02Step 02\n### Scan For Crawler Access\nCentium reads your robots.txt file and checks access rules for 23 AI crawlers across 11 companies.\n...\n### See Your Results\nInstantly see which AI models can access your site, which are blocked, and what it means for your visibility.\n...\n## Why AI Crawler Access Matters\nYour website’s robots.txt file is the gatekeeper.\nIt’s a small text file at the root of your domain that tells web crawlers (including AI-specific ones) what they’re allowed to access.",
            "source": "web",
            "title": "Free AI Crawler Checker | Centium",
            "url": "https://centium.ai/tools/ai-crawler-checker"
          },
          {
            "id": 3,
            "last_updated": "2026-10-07",
            "snippet": "# Can AI see your site?\nA free AI crawler checker.\nIt tests whether GPTBot, ClaudeBot and PerplexityBot can reach and read your site, the way ChatGPT, Claude and Perplexity do before they quote anyone.\n...\n7 checks · robots.txt, raw HTML, llms.txt, structured data, sitemapFree · no signup\n...\n## Questions.\nAn AI crawler checker tests whether the bots behind AI assistants, such as GPTBot for ChatGPT, ClaudeBot for Claude and PerplexityBot for Perplexity, can reach and read a website.\nThis one runs seven checks on your homepage: robots.txt rules for AI crawlers, how much text is readable without JavaScript, the title and meta description, llms.txt, structured data, sitemap.xml and the main heading.\nIt returns a score out of 100 and the fixes in order.\n...\nThe checker fetches your homepage, robots.txt, llms.txt and sitemap once, scores them, and keeps the result for ten minutes so a shared link loads fast.\nNothing is stored beyond that and you do not need an account.",
            "source": "web",
            "title": "Clerion - Website intelligence for AI founders",
            "url": "https://getclerion.com/tools/ai-readiness"
          },
          {
            "date": "2026-09-07",
            "id": 4,
            "last_updated": "2026-10-10",
            "snippet": "bmiller1009/ai-crawler-access-checker\nEnter a domain and see which major AI crawlers its robots.txt allows or blocks.\n...\nAudit robots.txt files for AI crawler access.\nGet an AI Readiness Score (0-100), analyze 61+ AI crawlers (ChatGPT, Claude, Perplexity, Gemini), detect syntax errors, security concerns, and get actionable recommendations.\n...\nAudit which AI crawlers can access a site via robots.txt, llms.txt, and sitemap signals for GPTBot, ClaudeBot, PerplexityBot, and more.",
            "source": "web",
            "title": "Input · AI Crawler Access Checker",
            "url": "https://apify.com/bmiller1009/ai-crawler-access-checker/input-schema"
          },
          {
            "id": 5,
            "last_updated": "2026-09-22",
            "snippet": "Check whether your website tells major AI crawlers they can access your pages.\n...\nFetch a public page and its robots.txt, then evaluate declared rules for eight search and AI user agents.",
            "source": "web",
            "title": "Free AI Crawler Access Checker | Marsen",
            "url": "https://www.marsentech.com/tools/ai-crawler-checker"
          }
        ],
        "type": "search_results"
      },
      {
        "content": [
          {
            "annotations": [],
            "text": "Try **Clerion’s AI Readiness Checker** or **Siftly’s Crawler Audit** to test both crawler access and whether page content is readable without JavaScript. For a simpler robots.txt-only check, use **Centium’s AI Access Tester**.",
            "type": "output_text"
          }
        ],
        "id": "msg_3df66b44-a437-4e5d-b8f1-d6cabd7a252e",
        "role": "assistant",
        "status": "completed",
        "type": "message"
      }
    ],
    "parallel_tool_calls": true,
    "presence_penalty": 0,
    "service_tier": "default",
    "status": "completed",
    "temperature": 1,
    "top_logprobs": 0,
    "top_p": 1,
    "truncation": "",
    "usage": {
      "cost": {
        "cache_creation_cost": 0.0011,
        "currency": "USD",
        "input_cost": 0.00014,
        "output_cost": 0.0003,
        "tool_calls_cost": 0.0025,
        "tool_calls_cost_details": {
          "search_web": 0.0025
        },
        "total_cost": 0.00404
      },
      "input_tokens": 4940,
      "input_tokens_details": {
        "cache_creation_input_tokens": 4385,
        "cache_read_input_tokens": 0,
        "cached_tokens": 0
      },
      "output_tokens": 119,
      "output_tokens_details": {
        "reasoning_tokens": 0
      },
      "tool_calls_details": {
        "search_web": {
          "cost_usd": 0.0025,
          "invocation": 1
        }
      },
      "total_tokens": 5059
    }
  }
};
