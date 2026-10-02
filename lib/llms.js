/* =====================================================================
   lib/llms.js — assesses a fetched llms.txt. Server-side only; the
   fetching itself is lib/scanner.js's fetchText, so there is no second
   fetch path.

   The authorship check looks for the fingerprints a hosting platform
   leaves in the file it writes for every store, and for the absence of
   anything describing the brand. It reports what it found and never
   claims to know who wrote the file: the verdict is "platform default",
   "custom" or "unclear", and the text always says it is a pattern match.

   The signals come from reading real files, not from guesswork: the
   Shopify-generated files at allbirds.com and magicspoon.com (the two
   the research report examined) are near-identical apart from the brand
   name, and carry every Shopify signal below. Only Shopify has been
   observed, so only Shopify is listed; add a platform by adding an
   entry to PLATFORMS once its default file has been read.
   ===================================================================== */

var scanner = require('./scanner');

var MAX_BYTES = 512 * 1024;

var PLATFORMS = [
  {
    name: 'Shopify',
    signals: [
      {
        id: 'platform-skill',
        label: 'References shop.app or a Shop skill',
        test: /(?:^|[^a-z0-9-])shop\.app\b|\bShop skill\b/i
      },
      {
        id: 'commerce-protocol',
        label: 'Documents a commerce protocol and its endpoints',
        test: /Universal Commerce Protocol|\bUCP\b|ucp\.dev|\.well-known\/ucp|\/api\/ucp/i
      },
      {
        id: 'platform-marketing',
        label: 'Links to platform marketing or developer pages',
        test: /shopify\.com\/start|Start your own store|shopify\.dev|mock\.shop|built on \[?Shopify/i
      }
    ]
  }
];

var TEMPLATE_INTRO = /this document describes how ai agents can interact with/i;
var DESCRIBES = /\bis (an?|the)\b|\bare (an?|the)\b|\bwe (make|sell|build|offer|provide|help|design)\b|\bour (mission|products?|customers?|team|story)\b|\bfounded\b|\bhelps?\b/i;

// The whole line the pattern matched on, trimmed for display.
function snippet(text, re) {
  var m = re.exec(text);
  if (!m) return '';
  var start = text.lastIndexOf('\n', m.index) + 1;
  var end = text.indexOf('\n', m.index);
  if (end === -1) end = text.length;
  var line = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return line.length > 110 ? line.slice(0, 107).trimEnd() + '\u2026' : line;
}

// "allbirds" from shop.allbirds.com, "bbc" from www.bbc.co.uk.
function brandTermFromDomain(domain) {
  var labels = String(domain || '').toLowerCase().replace(/^www\./, '').split('.');
  if (labels.length > 2 && labels[labels.length - 1].length === 2 &&
      ['co', 'com', 'org', 'net', 'ac', 'gov'].indexOf(labels[labels.length - 2]) !== -1) {
    labels = labels.slice(0, -2);
  } else {
    labels = labels.slice(0, -1);
  }
  return labels[labels.length - 1] || '';
}

// Matches "Magic Spoon" for the term "magicspoon": optional space or
// hyphen between characters, and word edges on both sides.
function brandRegex(term) {
  var chars = term.replace(/[^a-z0-9]/gi, '').split('');
  if (chars.length === 0) return null;
  var body = chars.map(function (c) { return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('[\\s-]*');
  return new RegExp('(^|[^a-z0-9])' + body + '(?![a-z0-9])', 'gi');
}

function stripUrls(text) {
  return text.replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/\S+/g, ' ').replace(/\b[\w-]+\.(com|org|net|io|app|dev|co)\/\S*/gi, ' ');
}

function parseStructure(text) {
  var lines = text.split(/\r?\n/);
  var headings = [];
  var links = 0, listItems = 0;
  var hasSummary = false, summaryText = '';
  var proseLines = [];
  var inFence = false;

  lines.forEach(function (line) {
    if (/^\s*```/.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    var h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) { headings.push({ level: h[1].length, text: h[2] }); return; }
    if (/^>\s*\S/.test(line)) {
      if (!hasSummary) { hasSummary = true; summaryText = line.replace(/^>\s*/, ''); }
      return;
    }
    links += (line.match(/\[[^\]]+\]\([^)]+\)/g) || []).length;
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) { listItems++; return; }
    if (line.trim()) proseLines.push(line.trim());
  });

  return { headings: headings, links: links, listItems: listItems, hasSummary: hasSummary, summaryText: summaryText, proseLines: proseLines };
}

function wordCount(text) { return (text.match(/\S+/g) || []).length; }

// fetchResult: the object lib/scanner.js's fetchText returns (fetched
// with { maxBytes: MAX_BYTES }). domain: bare hostname. brandName:
// optional override for what to look for.
function analyze(fetchResult, domain, brandName) {
  var res = fetchResult || {};
  var url = 'https://' + domain + '/llms.txt';
  var out = { domain: domain, url: url };

  if (res.notFound) {
    out.state = 'missing';
    out.message = 'No llms.txt at ' + url + ' (the server answered 404).';
    return out;
  }
  if (!res.ok) {
    out.state = 'unreadable';
    out.message = res.status
      ? 'Could not read ' + url + ' (the server answered HTTP ' + res.status + ').'
      : 'Could not read ' + url + ' (' + (res.kind || 'network error') + ').';
    return out;
  }
  if (!res.text || !res.text.trim()) {
    out.state = 'missing';
    out.message = url + ' answers 200 but the file is empty.';
    return out;
  }
  if (!scanner.isUsableTextFile(res)) {
    out.state = 'not-text';
    out.message = url + ' answers with a web page, not a text file. This usually means the site returns its homepage for unknown paths, so there is no llms.txt.';
    out.contentType = res.contentType || '';
    return out;
  }

  var text = res.text;
  var struct = parseStructure(text);
  var bytes = res.bytes || Buffer.byteLength(text, 'utf8');

  out.state = 'found';
  out.finalUrl = res.finalUrl && res.finalUrl !== url ? res.finalUrl : null;
  out.contentType = res.contentType || '';
  out.size = {
    bytes: bytes,
    words: wordCount(text),
    lines: text.split(/\r?\n/).length,
    truncated: !!res.truncated,
    analyzedBytes: MAX_BYTES
  };

  // Readable text?
  var replacement = (text.match(/�/g) || []).length;
  var binary = text.indexOf('\u0000') !== -1 || replacement > Math.max(5, text.length * 0.02);
  var textual = !res.contentType || /^text\/|markdown|json|xml/i.test(res.contentType);
  var h1 = struct.headings.filter(function (h) { return h.level === 1; })[0] || null;
  var sections = struct.headings.filter(function (h) { return h.level >= 2; });
  var hasStructure = struct.headings.length > 0 || struct.links > 0 || struct.listItems > 0;
  out.readable = {
    ok: !binary && textual && (hasStructure || wordCount(text) >= 20),
    binary: binary,
    textContentType: textual,
    reason: binary ? 'The file contains binary data, not text.'
      : !textual ? 'It is served as ' + res.contentType + ', not as text.'
      : !hasStructure && wordCount(text) < 20 ? 'It is text, but too short and unstructured to read as markdown.'
      : 'It reads as plain markdown-style text.'
  };

  out.structure = {
    title: h1 ? h1.text : null,
    hasSummary: struct.hasSummary,
    summary: struct.hasSummary ? struct.summaryText.slice(0, 200) : null,
    sections: struct.headings.slice(0, 40),
    sectionCount: sections.length,
    headingCount: struct.headings.length,
    links: struct.links,
    listItems: struct.listItems,
    followsConvention: !!(h1 && struct.hasSummary && sections.length > 0 && struct.links > 0)
  };

  // Does it name the brand at all? URLs are stripped first, so a link to
  // the brand's own domain does not count as naming it.
  var term = (brandName && brandName.trim()) || brandTermFromDomain(domain);
  var re = brandRegex(term);
  var plain = stripUrls(text);
  var mentions = 0;
  if (re) { var all = plain.match(re); mentions = all ? all.length : 0; }
  var inTitle = !!(re && h1 && new RegExp(re.source, 'i').test(stripUrls(h1.text)));
  var inSummary = !!(re && struct.hasSummary && new RegExp(re.source, 'i').test(struct.summaryText));
  out.brand = { searchedFor: term, mentions: mentions, inTitle: inTitle, inSummary: inSummary };

  // Does anything in the file describe the brand? A blockquote summary
  // (the llmstxt.org layout) counts, as does a prose line that mentions
  // the brand and says what it is or does. The platform's own template
  // intro ("This document describes how AI agents can interact with X's
  // online store") names the brand without describing it, so it is skipped.
  var describes = struct.hasSummary && wordCount(struct.summaryText) >= 6;
  var describedBy = describes ? 'a summary line under the title' : '';
  if (!describes && re) {
    var lineRe = new RegExp(re.source, 'i');
    for (var i = 0; i < struct.proseLines.length; i++) {
      var line = struct.proseLines[i];
      if (TEMPLATE_INTRO.test(line) || wordCount(line) < 10) continue;
      var bare = stripUrls(line);
      if (lineRe.test(bare) && DESCRIBES.test(bare)) { describes = true; describedBy = 'a sentence about the brand'; break; }
    }
  }

  // Platform fingerprints.
  var platformHits = {};
  var signals = [];
  PLATFORMS.forEach(function (p) {
    p.signals.forEach(function (sg) {
      var found = sg.test.test(text);
      if (found) platformHits[p.name] = (platformHits[p.name] || 0) + 1;
      signals.push({
        id: sg.id, label: sg.label, kind: 'platform', platform: p.name,
        found: found, evidence: found ? snippet(text, sg.test) : ''
      });
    });
  });

  var endpointLines = text.split(/\r?\n/).filter(function (l) { return /\b(GET|POST|PUT|DELETE)\s+`?(https?:\/\/\S+|\/\S*)/.test(l); }).length;
  signals.push({
    id: 'endpoint-docs', label: 'Reads like endpoint documentation', kind: 'platform-weak',
    found: endpointLines >= 3, evidence: endpointLines >= 3 ? endpointLines + ' lines describe GET or POST endpoints' : ''
  });
  var genericTitle = !!(h1 && /^agent instructions\b/i.test(h1.text));
  signals.push({
    id: 'template-title', label: 'Title is a generic template ("Agent Instructions")', kind: 'platform-weak',
    found: genericTitle, evidence: genericTitle ? h1.text : ''
  });
  signals.push({
    id: 'brand-description', label: 'Describes what the brand is or does', kind: 'brand',
    found: describes, evidence: describedBy
  });

  var strong = signals.filter(function (s) { return s.kind === 'platform' && s.found; }).length;
  var platformName = Object.keys(platformHits).sort(function (a, b) { return platformHits[b] - platformHits[a]; })[0] || null;

  var verdict, summary;
  if (strong >= 2 && !describes) {
    verdict = 'platform default';
    summary = 'The file carries ' + strong + ' of 3 ' + platformName + ' signals and nothing in it describes the brand. It reads like the file the platform writes for every store.';
  } else if (strong === 0 && describes) {
    verdict = 'custom';
    summary = 'No platform signals were found, and the file describes the brand (' + describedBy + '). It reads as written for this site.';
  } else if (strong >= 1 && describes) {
    verdict = 'unclear';
    summary = 'The file has ' + strong + ' ' + platformName + ' signal' + (strong === 1 ? '' : 's') + ' and also describes the brand. It may be a platform default that was edited, or a custom file that links to platform tools.';
  } else if (strong >= 1) {
    verdict = 'unclear';
    summary = 'The file has ' + strong + ' ' + platformName + ' signal and does not describe the brand, which is not enough to call it a platform default.';
  } else {
    verdict = 'unclear';
    summary = 'No platform signals were found, but nothing in the file describes the brand either.';
  }

  out.authorship = {
    verdict: verdict,
    platform: verdict === 'custom' ? null : platformName,
    summary: summary,
    signals: signals,
    caveat: 'This is a pattern match on the text of the file. It cannot tell who wrote it.'
  };

  return out;
}

module.exports = { analyze: analyze, brandTermFromDomain: brandTermFromDomain, MAX_BYTES: MAX_BYTES };
