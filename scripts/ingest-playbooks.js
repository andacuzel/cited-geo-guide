#!/usr/bin/env node
/* =====================================================================
   scripts/ingest-playbooks.js

   Reads every content/playbooks/<id>.js file, validates it against the
   "Playbook content rules" in CLAUDE.md, and writes valid entries into
   the right data object in app.js (saasData / brandData /
   professionalData). Existing entries with the same id are replaced,
   not duplicated — running this twice is safe.

   Usage:
     node scripts/ingest-playbooks.js
     node scripts/ingest-playbooks.js --allow-legacy-lengths

   Exits non-zero if any file fails validation, or if app.js fails
   `node --check` after the rewrite.

   --allow-legacy-lengths downgrades ONLY the three word-count-range
   checks (Strategic Shift, strategy items, pitfall items) from errors
   to warnings — for migrating pre-existing content that predates this
   validator without rewriting it. Every other rule (escaping,
   structure/counts, banned words, scanner-label whitelist) is still a
   hard failure. Do not pass this flag for new content.
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ALLOW_LEGACY_LENGTHS = process.argv.indexOf('--allow-legacy-lengths') !== -1;

const ROOT = path.resolve(__dirname, '..');
const PLAYBOOKS_DIR = path.join(ROOT, 'content', 'playbooks');
const APP_JS_PATH = path.join(ROOT, 'app.js');

/* ---------------------------------------------------------------
   1. Fixed vocabulary, copied from CLAUDE.md. Keep in sync by hand —
      this script has no other way to read that file's prose rules.
   --------------------------------------------------------------- */

const ID_TO_OBJECT = {
  crm: 'saasData',
  martech: 'saasData',
  hrtech: 'saasData',
  fintech: 'saasData',
  cybersecurity: 'saasData',
  devtools: 'saasData',
  ecommerce: 'brandData',
  consumerapps: 'brandData',
  hospitality: 'brandData',
  marketplaces: 'brandData',
  realestate: 'professionalData',
  legal: 'professionalData',
  health: 'professionalData',
  localservices: 'professionalData'
};

const VALID_LABELS = [
  'AI crawler access',
  'Sitemap declared',
  'Canonical tag',
  'Structured data (JSON-LD)',
  'Organization / WebSite schema',
  'Content schema (Article, FAQ…)',
  'Author / about signals',
  'Contact signals',
  'Single H1 heading',
  'Subheading structure (H2)',
  'Meta description',
  'robots.txt present',
  'Page title',
  'Open Graph tags'
];

// Heuristic: a quoted string that looks like an attempted scanner-check
// reference (as opposed to an ordinary quoted phrase like a buyer query).
// If it matches this but isn't an exact VALID_LABELS entry, it's a typo'd
// or invented check name — reject it.
const LOOKS_LIKE_CHECK_REF = /crawler|sitemap|canonical|structured data|schema|author|about signals|contact signals|h1 heading|h2\)|subheading|meta description|robots\.txt|page title|open graph/i;

const BANNED_WORDS = [
  'quietly', 'actually', 'seamlessly', 'effortless', 'powerful', 'unlock',
  'elevate', 'supercharge', 'game-changing', 'revolutionize', 'landscape',
  'delve', 'crucial', 'robust'
];

const NOT_JUST_BUT = /\bnot\s+just\b[\s\S]{0,80}?\bbut\b/i;

/* ---------------------------------------------------------------
   2. Small text helpers
   --------------------------------------------------------------- */

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ');
}

function wordCount(html) {
  var text = stripTags(html).trim();
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ---------------------------------------------------------------
   3. Validation
   --------------------------------------------------------------- */

// Checks the RAW SOURCE TEXT of a content file (not the evaluated
// string) for escaping violations — this is the only way to tell
// whether the author wrote ’ or an escaped literal apostrophe,
// since both evaluate to visually similar/identical runtime strings.
function checkEscaping(rawSource, errors) {
  var stringLiteralRe = /'(?:[^'\\]|\\.)*'/g;
  var m;
  while ((m = stringLiteralRe.exec(rawSource))) {
    var lit = m[0];
    if (lit.indexOf("\\'") !== -1) {
      errors.push('Found an escaped literal apostrophe (\\\') inside a string — use \\u2019 instead.');
    }
    if (/—/.test(lit)) {
      errors.push('Found a raw em dash character in source — use \\u2014 instead.');
    }
    if (/’/.test(lit)) {
      errors.push('Found a raw curly-apostrophe character in source — use the \\u2019 escape sequence instead.');
    }
  }
}

function checkBannedWords(content, errors) {
  var text = stripTags(content);
  BANNED_WORDS.forEach(function (word) {
    var re = new RegExp('\\b' + escapeRegExp(word) + '\\b', 'i');
    if (re.test(text)) {
      errors.push('Contains banned word "' + word + '".');
    }
  });
  if (NOT_JUST_BUT.test(text)) {
    errors.push('Contains the banned "not just X, but Y" construction.');
  }
}

function checkScannerRefs(text, errors, whereLabel) {
  var quoted = text.match(/"([^"]{2,80})"/g) || [];
  quoted.forEach(function (q) {
    var inner = q.slice(1, -1);
    if (LOOKS_LIKE_CHECK_REF.test(inner) && VALID_LABELS.indexOf(inner) === -1) {
      errors.push('In ' + whereLabel + ', "' + inner + '" looks like a scanner-check reference but is not one of the exact report labels.');
    }
  });
}

function hasAnyValidLabel(text) {
  return VALID_LABELS.some(function (label) {
    return text.indexOf('"' + label + '"') !== -1;
  });
}

function validateEntry(id, rawSource, entry, errors, warnings) {
  // Word-count-range violations go to `warnings` instead of `errors`
  // when --allow-legacy-lengths is set; every other check always uses
  // `errors` regardless of the flag.
  var lengthTarget = ALLOW_LEGACY_LENGTHS ? warnings : errors;

  if (!entry || typeof entry !== 'object') {
    errors.push('Module does not export an object.');
    return;
  }
  if (typeof entry.name !== 'string' || !entry.name.trim()) {
    errors.push('Missing or empty "name" field.');
  }
  if (typeof entry.content !== 'string' || !entry.content.trim()) {
    errors.push('Missing or empty "content" field.');
    return;
  }

  var content = entry.content;

  checkEscaping(rawSource, errors);
  checkBannedWords(content, errors);

  // Required literal HTML headings, in order.
  var headings = [
    '<h3>The Strategic Shift</h3>',
    '<h3>Top 3 Actionable Strategies</h3>',
    '<h3>Outdated SEO Pitfalls to Avoid</h3>',
    '<h3>Expert Tip</h3>'
  ];
  var idxs = [];
  var cursor = 0;
  headings.forEach(function (h) {
    var idx = content.indexOf(h, cursor);
    idxs.push(idx);
    if (idx === -1) {
      errors.push('Missing required literal heading: ' + h + ' (check it is real HTML, not plain text).');
    } else {
      cursor = idx + h.length;
    }
  });
  if (idxs.indexOf(-1) !== -1) return; // can't safely slice sections below

  var shiftSection = content.slice(idxs[0] + headings[0].length, idxs[1]);
  var strategiesSection = content.slice(idxs[1] + headings[1].length, idxs[2]);
  var pitfallsSection = content.slice(idxs[2] + headings[2].length, idxs[3]);
  var tipSection = content.slice(idxs[3] + headings[3].length);

  // --- The Strategic Shift: exactly 2 <p>, 140-190 words combined ---
  var shiftPs = shiftSection.match(/<p>([\s\S]*?)<\/p>/g) || [];
  if (shiftPs.length !== 2) {
    errors.push('"The Strategic Shift" must contain exactly 2 <p> paragraphs, found ' + shiftPs.length + '.');
  } else {
    var shiftWords = wordCount(shiftPs.join(' '));
    if (shiftWords < 140 || shiftWords > 190) {
      lengthTarget.push('"The Strategic Shift" paragraphs total ' + shiftWords + ' words; must be 140-190.');
    }
    var p2Text = stripTags(shiftPs[1]);
    if (!hasAnyValidLabel(p2Text)) {
      errors.push('Paragraph 2 of "The Strategic Shift" must contain a scanner bridge (an exact report label in quotes).');
    }
  }

  // --- Top 3 Actionable Strategies: exactly one plain <ul>, 3 <li>, 55-85 words each ---
  var stratUlMatch = strategiesSection.match(/<ul>([\s\S]*?)<\/ul>/);
  if (!stratUlMatch) {
    errors.push('"Top 3 Actionable Strategies" must contain a plain <ul> (no class attribute).');
  } else {
    var stratLis = stratUlMatch[1].match(/<li>([\s\S]*?)<\/li>/g) || [];
    if (stratLis.length !== 3) {
      errors.push('"Top 3 Actionable Strategies" must contain exactly 3 <li> items, found ' + stratLis.length + '.');
    } else {
      var anyLabelInStrategies = false;
      stratLis.forEach(function (li, i) {
        var inner = li.replace(/^<li>/, '').replace(/<\/li>$/, '');
        if (!/^<strong>[^<]*\.<\/strong>/.test(inner)) {
          errors.push('Strategy item ' + (i + 1) + ' must open with <strong>Imperative phrase.</strong>');
        }
        var words = wordCount(inner);
        if (words < 55 || words > 85) {
          lengthTarget.push('Strategy item ' + (i + 1) + ' has ' + words + ' words; must be 55-85.');
        }
        if (hasAnyValidLabel(stripTags(inner))) anyLabelInStrategies = true;
        checkScannerRefs(stripTags(inner), errors, 'strategy item ' + (i + 1));
      });
      if (!anyLabelInStrategies) {
        errors.push('At least one of the 3 strategy items must name a scanner check by its exact report label.');
      }
    }
  }

  // --- Outdated SEO Pitfalls to Avoid: exactly one <ul class="pitfalls">, 4 <li>, 20-35 words each ---
  var pitfallsUlMatch = pitfallsSection.match(/<ul class="pitfalls">([\s\S]*?)<\/ul>/);
  if (!pitfallsUlMatch) {
    errors.push('"Outdated SEO Pitfalls to Avoid" must contain <ul class="pitfalls">.');
  } else {
    var pitfallLis = pitfallsUlMatch[1].match(/<li>([\s\S]*?)<\/li>/g) || [];
    if (pitfallLis.length !== 4) {
      errors.push('"Outdated SEO Pitfalls to Avoid" must contain exactly 4 <li> items, found ' + pitfallLis.length + '.');
    } else {
      pitfallLis.forEach(function (li, i) {
        var words = wordCount(li);
        if (words < 20 || words > 35) {
          lengthTarget.push('Pitfall item ' + (i + 1) + ' has ' + words + ' words; must be 20-35.');
        }
      });
    }
  }

  // --- Expert-tip divs: exactly 3, in sequence aside / data / plain ---
  var tipDivs = content.match(/<div class="expert-tip[^"]*">[\s\S]*?<\/div>/g) || [];
  if (tipDivs.length !== 3) {
    errors.push('Expected exactly 3 expert-tip divs, found ' + tipDivs.length + '.');
  } else {
    var expectClass = ['expert-tip expert-tip--aside', 'expert-tip expert-tip--data', 'expert-tip'];
    var expectClose = [
      'This box is for your proprietary point of view.',
      'Replace with a sourced figure.',
      'This box is for your proprietary point of view.'
    ];
    tipDivs.forEach(function (div, i) {
      var classMatch = div.match(/^<div class="([^"]*)">/);
      var cls = classMatch ? classMatch[1] : '';
      if (cls !== expectClass[i]) {
        errors.push('Expert-tip div ' + (i + 1) + ' has class "' + cls + '"; expected "' + expectClass[i] + '".');
      }
      var pMatch = div.match(/<p>([\s\S]*?)<\/p>/);
      if (!pMatch) {
        errors.push('Expert-tip div ' + (i + 1) + ' must contain exactly one <p>.');
        return;
      }
      var pText = pMatch[1].trim();
      if (pText.charAt(0) === '[') {
        if (pText.indexOf(expectClose[i]) === -1) {
          errors.push('Expert-tip div ' + (i + 1) + ' placeholder must end with "' + expectClose[i] + '".');
        }
      } else if (!pText) {
        errors.push('Expert-tip div ' + (i + 1) + ' is empty.');
      }
    });
    // The final expert-tip div (plain "expert-tip") must be the last thing in content.
    var lastDiv = tipDivs[2];
    var lastDivIdx = content.lastIndexOf(lastDiv);
    if (lastDivIdx === -1 || content.slice(lastDivIdx + lastDiv.length).trim() !== '') {
      errors.push('The final <div class="expert-tip"> must be the last element in content.');
    }
  }

  checkScannerRefs(stripTags(shiftPs.join(' ')), errors, '"The Strategic Shift"');
}

/* ---------------------------------------------------------------
   4. app.js source surgery — find/replace/insert a top-level entry
      inside one of the named data objects.
   --------------------------------------------------------------- */

function findMatchingBraceEnd(source, openBraceIdx) {
  var depth = 1;
  var i = openBraceIdx + 1;
  var str = null;
  while (i < source.length && depth > 0) {
    var c = source[i];
    if (str) {
      if (c === '\\') { i += 2; continue; }
      if (c === str) str = null;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { str = c; i++; continue; }
    if (c === '{') { depth++; i++; continue; }
    if (c === '}') { depth--; i++; continue; }
    i++;
  }
  return i; // index just after the matching closing brace
}

function findObjectBody(source, varName) {
  var needle = 'var ' + varName + ' = {';
  var startIdx = source.indexOf(needle);
  if (startIdx === -1) return null;
  var braceIdx = startIdx + needle.length - 1; // index of the '{'
  var end = findMatchingBraceEnd(source, braceIdx);
  return { bodyStart: braceIdx + 1, bodyEnd: end - 1 };
}

function parseTopLevelEntries(source, bodyStart, bodyEnd) {
  var entries = [];
  var i = bodyStart;
  var str = null;
  while (i < bodyEnd) {
    var c = source[i];
    if (str) {
      if (c === '\\') { i += 2; continue; }
      if (c === str) str = null;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { str = c; i++; continue; }
    if (c === '{') {
      var k = i - 1;
      while (k >= bodyStart && /\s/.test(source[k])) k--;
      if (source[k] === ':') {
        var m = k - 1;
        while (m >= bodyStart && /\s/.test(source[m])) m--;
        var idEnd = m + 1;
        var idStart = idEnd;
        while (idStart > bodyStart && /[A-Za-z0-9_$]/.test(source[idStart - 1])) idStart--;
        var id = source.slice(idStart, idEnd);
        // Trim back past whitespace/newlines so the span to replace starts
        // right after the previous entry's comma (or bodyStart) — otherwise
        // stale indentation accumulates on every re-run.
        var trimStart = idStart;
        while (trimStart > bodyStart && /[ \t\n\r]/.test(source[trimStart - 1])) trimStart--;
        var braceEnd = findMatchingBraceEnd(source, i);
        var afterEntry = braceEnd;
        while (afterEntry < bodyEnd && /[ \t]/.test(source[afterEntry])) afterEntry++;
        if (source[afterEntry] === ',') afterEntry++;
        entries.push({ id: id, entryStart: trimStart, entryEnd: afterEntry });
        i = braceEnd;
        continue;
      } else {
        i = findMatchingBraceEnd(source, i);
        continue;
      }
    }
    i++;
  }
  return entries;
}

// Re-serializes an evaluated content string back into app.js's house
// escaping style (’ / — as literal escape text, not raw
// characters), split into multiple '...'+  pieces at HTML tag
// boundaries so diffs stay readable.
function toSourceLiteral(str) {
  var escaped = str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/’/g, '\\u2019')
    .replace(/—/g, '\\u2014')
    .replace(/…/g, '\\u2026')
    .replace(/\n/g, '\\n');
  return "'" + escaped + "'";
}

function formatEntrySource(id, entry) {
  var chunks = entry.content.split(/(?<=<\/(?:h3|p|ul|div|li)>)/);
  var contentLines = chunks
    .filter(Boolean)
    .map(function (chunk) { return '        ' + toSourceLiteral(chunk); })
    .join(' +\n');
  return (
    '    ' + id + ': {\n' +
    '      name: ' + toSourceLiteral(entry.name) + ',\n' +
    '      content:\n' +
    contentLines + '\n' +
    '    },'
  );
}

// Every insertion point below is deliberately given its own fixed '\n\n'
// separator rather than reusing whatever whitespace happened to precede
// it in the existing source — parseTopLevelEntries() trims the replaced
// span back to the previous entry's comma, so re-running this on
// already-ingested content reproduces byte-identical output instead of
// compounding indentation on every run.
function upsertEntry(source, varName, id, entry) {
  var body = findObjectBody(source, varName);
  if (!body) {
    throw new Error('Could not find "var ' + varName + ' = {" in app.js.');
  }
  var entries = parseTopLevelEntries(source, body.bodyStart, body.bodyEnd);
  var newEntryText = formatEntrySource(id, entry);
  var existing = entries.filter(function (e) { return e.id === id; })[0];

  if (existing) {
    return source.slice(0, existing.entryStart) + '\n\n' + newEntryText + source.slice(existing.entryEnd);
  }

  if (entries.length === 0) {
    return source.slice(0, body.bodyStart) + '\n\n' + newEntryText + '\n  ' + source.slice(body.bodyEnd);
  }

  var last = entries[entries.length - 1];
  return source.slice(0, last.entryEnd) + '\n\n' + newEntryText + source.slice(last.entryEnd);
}

/* ---------------------------------------------------------------
   5. Main
   --------------------------------------------------------------- */

function main() {
  if (!fs.existsSync(PLAYBOOKS_DIR)) {
    console.error('content/playbooks/ does not exist.');
    process.exit(1);
  }

  var files = fs.readdirSync(PLAYBOOKS_DIR).filter(function (f) {
    return f.endsWith('.js');
  });

  if (files.length === 0) {
    console.log('No playbook files found in content/playbooks/.');
    process.exit(0);
  }

  var appSource = fs.readFileSync(APP_JS_PATH, 'utf8');
  var results = [];
  var anyFailed = false;
  var anyValid = false;

  files.forEach(function (file) {
    var id = file.replace(/\.js$/, '');
    var filePath = path.join(PLAYBOOKS_DIR, file);
    var errors = [];

    var targetObject = ID_TO_OBJECT[id];
    if (!targetObject) {
      errors.push('Unknown vertical id "' + id + '". Add it to subFields/brandFields/professionalFields in app.js first, then to ID_TO_OBJECT in this script.');
      results.push({ id: id, ok: false, errors: errors });
      anyFailed = true;
      return;
    }

    var rawSource = fs.readFileSync(filePath, 'utf8');
    var resolvedPath = require.resolve(filePath);
    delete require.cache[resolvedPath];

    var entry;
    try {
      entry = require(filePath);
    } catch (e) {
      errors.push('Failed to load module: ' + e.message);
      results.push({ id: id, ok: false, errors: errors });
      anyFailed = true;
      return;
    }

    var warnings = [];
    validateEntry(id, rawSource, entry, errors, warnings);

    if (errors.length > 0) {
      results.push({ id: id, ok: false, errors: errors });
      anyFailed = true;
      return;
    }

    appSource = upsertEntry(appSource, targetObject, id, entry);
    results.push({ id: id, ok: true, targetObject: targetObject, warnings: warnings });
    anyValid = true;
  });

  console.log('');
  results.forEach(function (r) {
    if (r.ok) {
      console.log('PASS  ' + r.id + '  -> ' + r.targetObject + (r.warnings.length ? '  (' + r.warnings.length + ' warning' + (r.warnings.length > 1 ? 's' : '') + ')' : ''));
      r.warnings.forEach(function (w) { console.log('        ! ' + w); });
    } else {
      console.log('FAIL  ' + r.id);
      r.errors.forEach(function (e) { console.log('        - ' + e); });
    }
  });
  console.log('');

  if (anyValid) {
    fs.writeFileSync(APP_JS_PATH, appSource, 'utf8');
    console.log('app.js updated.');

    try {
      execFileSync(process.execPath, ['--check', APP_JS_PATH], { stdio: 'pipe' });
      console.log('node --check app.js: OK');
    } catch (e) {
      console.error('node --check app.js FAILED:');
      console.error(e.stderr ? e.stderr.toString() : e.message);
      process.exit(1);
    }
  }

  var passCount = results.filter(function (r) { return r.ok; }).length;
  console.log(passCount + '/' + results.length + ' playbook(s) ingested.');

  process.exit(anyFailed ? 1 : 0);
}

main();
