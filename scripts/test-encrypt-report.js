#!/usr/bin/env node
/* scripts/test-encrypt-report.js: round trip, wrong code, and what the unlock page may and may not contain.
   Uses a throwaway code made at run time and a dummy report. No real code or report is involved. */
'use strict';

const assert = require('assert');
const er = require('./encrypt-report.js');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const code = er.generateCode();
ok(/^([0-9A-HJKMNP-TV-Z]{4}-){4}[0-9A-HJKMNP-TV-Z]{4}$/.test(code), 'code is 20 Crockford base32 characters in groups of four');
ok(code !== er.generateCode(), 'two codes differ');
ok(er.normalizeCode(' ' + code.toLowerCase().replace(/-/g, ' ') + ' ') === er.normalizeCode(code), 'case, spaces and dashes are ignored');
ok(er.normalizeCode('oil-0') === '0110', 'O reads as 0 and I or L as 1');

const report = '<!DOCTYPE html><html><head><title>Dummy report</title></head><body><h1>SECRET-MARKER-12345</h1>' + 'x'.repeat(5000) + '</body></html>';
const payload = er.encrypt(report, code);
ok(payload.kdf.iter >= 600000 && payload.kdf.name === 'PBKDF2' && payload.kdf.hash === 'SHA-256', 'PBKDF2-SHA256 at 600,000 iterations or more');
ok(Buffer.from(payload.kdf.salt, 'base64').length === 16 && Buffer.from(payload.iv, 'base64').length === 12, '16-byte salt and 12-byte IV');
ok(er.decryptPayload(payload, code) === report, 'the right code opens it');
ok(er.decryptPayload(payload, code.toLowerCase().replace(/-/g, ' ')) === report, 'the code is read loosely');
let failed = false;
try { er.decryptPayload(payload, er.generateCode()); } catch (e) { failed = true; }
ok(failed, 'a wrong code fails');
const again = er.encrypt(report, code);
ok(again.ct !== payload.ct && again.iv !== payload.iv && again.kdf.salt !== payload.kdf.salt, 'every file gets a fresh salt and IV');
let low = false;
try { er.encrypt(report, code, { iterations: 1000 }); } catch (e) { low = true; }
ok(low, 'fewer than 600,000 iterations is refused');

const page = er.unlockPage(payload);
ok(page.indexOf('SECRET-MARKER') === -1 && page.indexOf('Dummy report') === -1, 'the page holds no plaintext');
ok(/<meta name="robots" content="noindex, nofollow, noarchive"/.test(page), 'noindex, nofollow, noarchive');
ok(/<title>Private report<\/title>/.test(page), 'generic title');
ok(!/https?:\/\//i.test(page.replace(/xmlns="[^"]*"/g, '')), 'no URL in the unlock page');
ok(!/<(link|img|iframe|audio|video|source)\b[^>]*\b(src|href)=/i.test(page.replace(/<link rel="icon" href="data:,"/, '')), 'no external resource');
ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|import)\s*\(/.test(page), 'no network call');
ok(page.indexOf(code) === -1 && page.indexOf(er.normalizeCode(code)) === -1, 'the code is not in the page');
console.log('OK: ' + n + ' checks passed.');
