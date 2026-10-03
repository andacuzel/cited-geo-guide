#!/usr/bin/env node
/* =====================================================================
   scripts/test-scanner-signals.js

   Tests for how lib/scanner.js parseSignals reads attribute values, in
   particular quote handling: a meta description may contain a straight
   apostrophe inside double quotes (and a double quote inside single
   quotes) and must be read in full.

     node scripts/test-scanner-signals.js

   No network. Exits 1 on any failure.
   ===================================================================== */

'use strict';

const assert = require('assert');
const scanner = require('../lib/scanner.js');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { failures.push(name); console.log('  FAIL ' + name + '\n       ' + e.message.split('\n')[0]); }
}

const page = (head, body) => '<!DOCTYPE html><html lang="en"><head><title>T</title>' + head + '</head><body>' + (body || '<h1>H</h1>') + '</body></html>';
const metaCheck = (sig) => scanner.scoreAll(true, true, true, [], sig).checks.filter((c) => c.label === 'Meta description')[0];
const LONG = 'Scan your site\x27s AI visibility free: 16 checks, 10 AI crawlers, live data. Then fix it with playbooks built for your category.';

console.log('meta description quote handling');

test('apostrophe inside double quotes is read in full', () => {
  const d = 'Scan your site\'s AI visibility free: 16 checks and the fix for each, with no email.';
  const sig = scanner.parseSignals(page('<meta name="description" content="' + d + '">'));
  assert.strictEqual(sig.metaDesc, d);
});

test('double quotes inside single quotes are read in full', () => {
  const d = 'A guide to the "answer engine" shift, with 16 checks and the fix for each, free.';
  const sig = scanner.parseSignals(page('<meta name=\'description\' content=\'' + d + '\'>'));
  assert.strictEqual(sig.metaDesc, d);
});

test('single-quoted attribute with an apostrophe-free value still works', () => {
  const sig = scanner.parseSignals(page('<meta name="description" content=\'Plain description of about sixty characters, nothing special in it.\'>'));
  assert.strictEqual(sig.metaDesc, 'Plain description of about sixty characters, nothing special in it.');
});

test('entity-encoded apostrophes are decoded as before', () => {
  ['&#39;', '&#x27;', '&apos;', '&rsquo;'].forEach(function (ent) {
    const sig = scanner.parseSignals(page('<meta name="description" content="Scan your site' + ent + 's AI visibility with 16 checks and a fix for each one.">'));
    assert.ok(/^Scan your site.s AI visibility with 16 checks and a fix for each one\.$/.test(sig.metaDesc), ent + ' -> ' + sig.metaDesc);
    assert.ok(sig.metaDesc.indexOf('&') === -1, ent + ' left an entity');
  });
});

test('reversed attribute order (content before name), apostrophe in double quotes', () => {
  const d = 'Scan your site\'s AI visibility free: 16 checks and the fix for each, with no email.';
  const sig = scanner.parseSignals(page('<meta content="' + d + '" name="description">'));
  assert.strictEqual(sig.metaDesc, d);
});

test('reversed attribute order, quotation marks inside single quotes', () => {
  const d = 'A guide to the "answer engine" shift, with 16 checks and the fix for each, free.';
  const sig = scanner.parseSignals(page('<meta content=\'' + d + '\' name=\'description\'>'));
  assert.strictEqual(sig.metaDesc, d);
});

test('other attributes before and after, in either order', () => {
  const d = 'Owner\'s guide to AI readiness: what the scan checks and how each fix works.';
  assert.strictEqual(scanner.parseSignals(page('<meta data-x="1" name="description" id="d" content="' + d + '" data-y="2">')).metaDesc, d);
  assert.strictEqual(scanner.parseSignals(page('<meta data-x="1" content="' + d + '" id="d" name="description" data-y="2">')).metaDesc, d);
});

test('a description that is genuinely short still fails the length check', () => {
  const sig = scanner.parseSignals(page('<meta name="description" content="Short one\'s here.">'));
  assert.strictEqual(sig.metaDesc, 'Short one\'s here.');
  assert.strictEqual(metaCheck(sig).pts, 0);
});

test('a 50 to 170 character description containing an apostrophe now passes', () => {
  const sig = scanner.parseSignals(page('<meta name="description" content="' + LONG + '">'));
  assert.ok(LONG.length >= 50 && LONG.length <= 170, 'fixture length ' + LONG.length);
  assert.strictEqual(sig.metaDesc, LONG);
  assert.strictEqual(metaCheck(sig).pts, 4);
});

test('a description over 170 characters still fails', () => {
  const sig = scanner.parseSignals(page('<meta name="description" content="' + new Array(40).join('word ') + 'it\'s long">'));
  assert.ok(sig.metaDesc.length > 170);
  assert.strictEqual(metaCheck(sig).pts, 0);
});

test('og:description and twitter:description are not mistaken for the description', () => {
  const sig = scanner.parseSignals(page('<meta property="og:description" content="Not it\'s the one"><meta name="twitter:description" content="Nor this one\'s">'));
  assert.strictEqual(sig.metaDesc, '');
});

test('no description at all', () => {
  assert.strictEqual(scanner.parseSignals(page('')).metaDesc, '');
});

console.log('other attribute readers');

test('lang in either quote style', () => {
  assert.strictEqual(scanner.parseSignals('<html lang="en-GB"><body></body></html>').lang, 'en-GB');
  assert.strictEqual(scanner.parseSignals('<html lang=\'fr\'><body></body></html>').lang, 'fr');
});

test('a link whose href contains an apostrophe keeps its path for the contact and author signals', () => {
  const a = scanner.parseSignals(page('', '<h1>H</h1><a href="/o\'neil/contact">x</a>'));
  assert.strictEqual(a.contactSignal, true);
  const b = scanner.parseSignals(page('', '<h1>H</h1><a href=\'/our-"company"/about\'>x</a>'));
  assert.strictEqual(b.authorSignal, true);
});

test('canonical, og tags, author meta and JSON-LD in either quote style', () => {
  const dq = scanner.parseSignals(page('<link rel="canonical" href="https://a.example/"><meta property="og:title" content="t"><meta property="og:description" content="d"><meta name="author" content="A"><script type="application/ld+json">{"@type":"Organization"}</script>'));
  const sq = scanner.parseSignals(page('<link rel=\'canonical\' href=\'https://a.example/\'><meta property=\'og:title\' content=\'t\'><meta property=\'og:description\' content=\'d\'><meta name=\'author\' content=\'A\'><script type=\'application/ld+json\'>{"@type":"Organization"}</script>'));
  [dq, sq].forEach(function (s) {
    assert.strictEqual(s.canonical, true);
    assert.strictEqual(s.ogOk, true);
    assert.strictEqual(s.authorSignal, true);
    assert.strictEqual(s.hasOrgSchema, true);
  });
});

test('title is read whatever quotes it contains', () => {
  assert.strictEqual(scanner.parseSignals('<html><head><title>Bob\'s "best" page</title></head></html>').title, 'Bob\'s "best" page');
});

console.log('\n' + passed + ' passed' + (failures.length ? ', ' + failures.length + ' failed' : ''));
process.exit(failures.length ? 1 : 0);
