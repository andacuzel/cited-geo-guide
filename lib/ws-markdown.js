/* =====================================================================
   lib/ws-markdown.js: a small, safe markdown renderer for text an admin pastes into a workspace (notes now, drafts and briefs later).

   Safety first: the whole input is HTML-escaped before anything is recognised, so no tag, attribute or entity from the input can reach the page;
   markdown then only ever adds tags this file writes itself. Supported: paragraphs, # to ### headings (rendered as h4 to h6, below the page's own),
   - and * lists, 1. lists, **bold**, *italic* and _italic_, `code`, and [text](url) with an http, https or mailto address only (links open in a new tab
   with rel="noopener noreferrer nofollow"). Raw HTML is shown as text. Input over MAX_CHARS is cut. No images, no tables, no HTML pass-through.
   ===================================================================== */

'use strict';

const MAX_CHARS = 20000;

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

// Inline markup on text that is already escaped.
function inline(t) {
  // Code spans first, so nothing inside them is formatted. Their content stays escaped.
  const parts = t.split('`');
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1 && i < parts.length - (parts.length % 2 === 0 ? 1 : 0)) { out += '<code>' + parts[i] + '</code>'; continue; }
    // An unmatched backtick (an odd number of parts that ends on a "code" part) is plain text.
    let s = (i % 2 === 1 ? '`' : '') + parts[i];
    s = s.replace(/\[([^\]\n]{1,200})\]\(((?:https?:\/\/|mailto:)[^\s()<>"']{1,500})\)/g, function (m, text, url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer nofollow">' + text + '</a>';
    });
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s.,;:!?)])/g, '$1<em>$2</em>').replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s.,;:!?)])/g, '$1<em>$2</em>');
    out += s;
  }
  return out;
}

function render(markdown) {
  const src = esc(String(markdown == null ? '' : markdown).slice(0, MAX_CHARS)).replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const html = [];
  let list = null;   // 'ul' | 'ol' | null
  let para = [];
  const flushPara = function () { if (para.length) { html.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  const closeList = function () { if (list) { html.push('</' + list + '>'); list = null; } };
  lines.forEach(function (raw) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if (line.trim() === '') { flushPara(); closeList(); return; }
    if ((m = /^(#{1,3})\s+(.+)$/.exec(line))) { flushPara(); closeList(); const lvl = m[1].length + 3; html.push('<h' + lvl + '>' + inline(m[2]) + '</h' + lvl + '>'); return; }
    if ((m = /^\s*[-*]\s+(.+)$/.exec(line))) { flushPara(); if (list !== 'ul') { closeList(); html.push('<ul>'); list = 'ul'; } html.push('<li>' + inline(m[1]) + '</li>'); return; }
    if ((m = /^\s*\d{1,3}[.)]\s+(.+)$/.exec(line))) { flushPara(); if (list !== 'ol') { closeList(); html.push('<ol>'); list = 'ol'; } html.push('<li>' + inline(m[1]) + '</li>'); return; }
    closeList();
    para.push(line.trim());
  });
  flushPara(); closeList();
  return html.join('\n');
}

module.exports = { render: render, esc: esc, MAX_CHARS: MAX_CHARS };
