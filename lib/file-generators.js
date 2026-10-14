/* =====================================================================
   lib/file-generators.js: the robots.txt and llms.txt text builders, one place.

   The MCP tools generate_robots_txt and generate_llms_txt (api/mcp.js) validate their input and call these; the workspaces' Files tab
   (lib/ws-fix.js) calls the same ones, so the text a customer copies is the text the MCP server would give. The JSON-LD builder is lib/schema.js.
   Pure functions: no network, no input validation beyond what the caller has already done.
   ===================================================================== */

'use strict';

// crawlers: lib/crawlers.js (each has .ua). allow and block: names from that list, not overlapping. sitemapUrl: '' or an absolute URL.
function robotsTxt(crawlers, allow, block, sitemapUrl) {
  const lines = [];
  crawlers.forEach(function (c) {
    if (allow.indexOf(c.ua) !== -1) {
      lines.push('User-agent: ' + c.ua);
      lines.push('Allow: /');
      lines.push('');
    } else if (block.indexOf(c.ua) !== -1) {
      lines.push('User-agent: ' + c.ua);
      lines.push('Disallow: /');
      lines.push('');
    }
  });
  if (sitemapUrl) {
    lines.push('Sitemap: ' + sitemapUrl);
  } else if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.join('\n');
}

// name and description are non-empty; keyPages is [{ url, description }] with both set.
function llmsTxt(name, description, keyPages) {
  const lines = ['# ' + name, '', '> ' + description];
  if (keyPages.length > 0) {
    lines.push('');
    lines.push('## Pages');
    keyPages.forEach(function (p) {
      lines.push('- [' + p.description.trim() + '](' + p.url.trim() + ')');
    });
  }
  return lines.join('\n');
}

module.exports = { robotsTxt: robotsTxt, llmsTxt: llmsTxt };
