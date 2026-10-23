/* =====================================================================
   lib/hub.js: the integrations hub, a picture of Citehound at the centre with the LIVE integrations of content/integrations.json around it. Used by
   scripts/generate-integrations-page.js for the homepage block (between HUB markers) and for /integrations.

   Icons are neutral line icons drawn here, one per integration id. No third-party logo is used anywhere (docs/integrations/RULES.md): a name and a neutral icon.
   The orbit is decoration (aria-hidden); the list under it is the accessible content. It turns by itself (CSS only, no controls, nothing when reduced motion is on).
   ===================================================================== */

'use strict';

const MARK = require('./lockup.js').MARK;

const ICONS = {
  'claude-connector': '<path d="M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0V7zM12 16v5"/>',
  'mcp-registry': '<path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5"/>',
  'github-action': '<circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="M6 8.2V12a4 4 0 0 0 4 4h5.8M13.5 13.5l2.5 2.5-2.5 2.5"/>',
  'public-api': '<path d="M8 4c-2 0-3 1-3 3v2c0 1-1 2-2 3 1 1 2 2 2 3v2c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2c0 1 1 2 2 3-1 1-2 2-2 3v2c0 2-1 3-3 3"/>',
  cli: '<path d="M4 5h16v14H4zM8 10l3 2-3 2M13 15h4"/>',
  n8n: '<circle cx="5" cy="12" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 12h4l6-5M11 12l6 5"/>',
  'claude-plugin': '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM4 7.5l8 4.5 8-4.5M12 12v9"/>'
};
const FALLBACK = '<circle cx="12" cy="12" r="4"/>';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const icon = (id) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">' + (ICONS[id] || FALLBACK) + '</svg>';

// the picture: items = the live items of content/integrations.json, in order
function orbit(items) {
  const n = items.length;
  return '<div class="hub__orbit" aria-hidden="true">\n' +
    '          <span class="hub__ring hub__ring--a"></span><span class="hub__ring hub__ring--b"></span>\n' +
    '          <span class="hub__core"><span class="hub__ripple"></span><svg viewBox="13 8.5 52 52" focusable="false">' + MARK.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '') + '</svg></span>\n' +
    '          <ul class="hub__nodes">\n' + items.map((it, i) => '            <li class="hub__node" style="--a:' + (Math.round(i * 3600 / n) / 10) + 'deg;--d:' + (i * 0.55).toFixed(2) + 's"><span class="hub__spoke"></span><span class="hub__pulse"></span><span class="hub__chip">' + icon(it.id) + '<b>' + esc(it.name) + '</b></span></li>').join('\n') + '\n          </ul>\n        </div>';
}

// the text under the picture: every live item, a link where it has one
function list(items, withText) {
  return '<ul class="hub__list">\n' + items.map((it) => {
    const name = it.url ? '<a href="' + esc(it.url) + '">' + esc(it.name) + '</a>' : esc(it.name);
    return '          <li><span class="hub__ico">' + icon(it.id) + '</span><span class="hub__t"><b>' + name + '</b>' + (withText ? '<span>' + esc(it.description) + '</span>' : '') + '</span></li>';
  }).join('\n') + '\n        </ul>';
}

const NOTE = 'Product names belong to their owners, and mentioning them implies no endorsement.';

module.exports = { orbit, list, icon, NOTE, ICONS };
