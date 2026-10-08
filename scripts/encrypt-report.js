#!/usr/bin/env node
/* =====================================================================
   scripts/encrypt-report.js — turn one self-contained HTML file into a single
   unlock page whose content only opens with an access code.

   The report is gzip-compressed and encrypted with AES-256-GCM. The key is
   derived from the access code with PBKDF2-SHA256 (1,000,000 iterations by
   default, a random 16-byte salt); the IV is random per file. The unlock page
   decrypts in the browser with WebCrypto, then replaces its own document with
   the report. Nothing is sent anywhere: the page makes no request.

   This file holds no code, no report and no recipient. It names nothing: the
   unlock page has a generic title and no text about its content.

     node scripts/encrypt-report.js --generate-code <file>
         Write a new access code to <file> (mode 600). The code is never printed.
     node scripts/encrypt-report.js <in.html> <out.html> --code-file <file>
         Encrypt. The code can also come from the REPORT_ACCESS_CODE
         environment variable. It is never taken from an argument.
     node scripts/encrypt-report.js --check <out.html> --code-file <file>
         Decrypt in Node and print only the size, to prove the code opens it.

   Options: --iterations N (default 1000000, minimum 600000).

   The code is 20 characters of Crockford base32 (100 bits), shown in groups of
   four. The unlock page and this tool both ignore case, spaces and dashes, and
   read O as 0 and I or L as 1, so the code can be read aloud and typed freely.
   ===================================================================== */

'use strict';

const fs = require('fs');
const zlib = require('zlib');
const nodeCrypto = require('crypto');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const MIN_ITERATIONS = 600000;
const DEFAULT_ITERATIONS = 1000000;
const AAD = 'citehound-private-report-v1';
const CODE_CHARS = 20;

function normalizeCode(s) {
  return String(s || '').toUpperCase().replace(/[\s-]+/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

function generateCode() {
  const bytes = nodeCrypto.randomBytes(CODE_CHARS);
  let out = '';
  for (let i = 0; i < CODE_CHARS; i++) {
    out += ALPHABET[bytes[i] & 31]; // 256 is a multiple of 32: every symbol is equally likely
    if (i % 4 === 3 && i < CODE_CHARS - 1) out += '-';
  }
  return out;
}

function encrypt(html, code, opts) {
  opts = opts || {};
  const iterations = opts.iterations || DEFAULT_ITERATIONS;
  if (iterations < MIN_ITERATIONS) throw new Error('iterations must be at least ' + MIN_ITERATIONS);
  const norm = normalizeCode(code);
  if (norm.length < 16) throw new Error('the access code is too short');
  const salt = nodeCrypto.randomBytes(16);
  const iv = nodeCrypto.randomBytes(12);
  const key = nodeCrypto.pbkdf2Sync(Buffer.from(norm, 'utf8'), salt, iterations, 32, 'sha256');
  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(AAD, 'utf8'));
  const packed = zlib.gzipSync(Buffer.from(html, 'utf8'), { level: 9 });
  const ct = Buffer.concat([cipher.update(packed), cipher.final(), cipher.getAuthTag()]); // WebCrypto expects the tag appended
  return {
    v: 1, alg: 'AES-GCM-256', zip: 'gzip',
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iter: iterations, salt: salt.toString('base64') },
    iv: iv.toString('base64'),
    ct: ct.toString('base64')
  };
}

function decryptPayload(payload, code) {
  const norm = normalizeCode(code);
  const key = nodeCrypto.pbkdf2Sync(Buffer.from(norm, 'utf8'), Buffer.from(payload.kdf.salt, 'base64'), payload.kdf.iter, 32, 'sha256');
  const all = Buffer.from(payload.ct, 'base64');
  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAAD(Buffer.from(AAD, 'utf8'));
  decipher.setAuthTag(all.subarray(all.length - 16));
  const packed = Buffer.concat([decipher.update(all.subarray(0, all.length - 16)), decipher.final()]);
  return zlib.gunzipSync(packed).toString('utf8');
}

/* ---------------- the unlock page ---------------- */

const LOGO = '<svg viewBox="13 8.5 52 52" width="28" height="28" focusable="false" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M62 30 L58 28.5 L40 20 L35 17.5 L28 12 L21 15.5 Q13 32 17 57 L32 57 Q28.5 46.5 37 41 L39 38 L58 34.5 L61 32.5 Z M27.5 16.5 L16 25 L27 22.5 Z M38.4 22.9 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0 Z"/></svg>';

const UNLOCK_JS = `(function () {
  var AAD = ${JSON.stringify(AAD)};
  var form = document.getElementById('f'), input = document.getElementById('c'), msg = document.getElementById('m'), btn = document.getElementById('b');
  var payload = JSON.parse(document.getElementById('p').textContent);
  function b64(s) { var bin = atob(s), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
  function norm(s) { return String(s || '').toUpperCase().replace(/[\\s-]+/g, '').replace(/O/g, '0').replace(/[IL]/g, '1'); }
  function say(t, bad) { msg.textContent = t; msg.className = bad ? 'err' : ''; }
  async function open(code) {
    var enc = new TextEncoder();
    var base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
    var key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: payload.kdf.hash, salt: b64(payload.kdf.salt), iterations: payload.kdf.iter }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    var plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(payload.iv), additionalData: enc.encode(AAD) }, key, b64(payload.ct));
    var stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var code = norm(input.value);
    if (!code) { say('Enter the access code.', true); return; }
    if (!(window.crypto && crypto.subtle) || typeof DecompressionStream === 'undefined') { say('This browser cannot open the report. Use a current version of Chrome, Safari, Firefox or Edge.', true); return; }
    btn.disabled = true; input.disabled = true; say('Opening the report…');
    open(code).then(function (html) {
      document.open(); document.write(html); document.close();
    }, function () {
      btn.disabled = false; input.disabled = false; say('That code did not work. Check it and try again.', true); input.focus(); input.select();
    });
  });
  input.focus();
})();`;

function unlockPage(payload) {
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    '<title>Private report</title>\n<meta name="robots" content="noindex, nofollow, noarchive" />\n<meta name="referrer" content="no-referrer" />\n' +
    '<link rel="icon" href="data:," />\n<style>\n' +
    ':root{--bg:#EEF1F5;--white:#FFFFFF;--navy:#0B1526;--ink:#14202E;--soft:#4B5766;--line:#D9DEE6;--gold:#C2922F;--gold-deep:#97701F;--risk:#B04A3A;--shadow:0 1px 2px rgba(11,21,38,.06),0 8px 24px rgba(11,21,38,.08)}\n' +
    '*{box-sizing:border-box}html,body{margin:0}\n' +
    'body{min-height:100vh;display:flex;flex-direction:column;background:var(--bg);color:var(--ink);font:16px/1.55 "Hanken Grotesk",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}\n' +
    'header{background:var(--navy);color:#fff;padding:14px 16px}header div{max-width:960px;margin:0 auto;display:flex;align-items:center;gap:10px;font:400 22px/1 Gloock,Georgia,"Times New Roman",serif;color:#fff}\n' +
    'main{flex:1;display:flex;align-items:flex-start;justify-content:center;padding:56px 16px}\n' +
    '.card{width:100%;max-width:440px;background:var(--white);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);padding:32px 28px}\n' +
    '.kicker{margin:0 0 10px;font:500 12px/1.2 "Spline Sans Mono",ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--gold-deep)}\n' +
    'h1{margin:0 0 8px;font:400 30px/1.15 Gloock,Georgia,"Times New Roman",serif;color:var(--navy)}\n' +
    'p{margin:0 0 20px;color:var(--soft)}\n' +
    'label{display:block;margin:0 0 6px;font-weight:600;font-size:14px}\n' +
    'input{width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink);font:500 18px/1.2 "Spline Sans Mono",ui-monospace,Menlo,monospace;letter-spacing:.06em}\n' +
    'input:focus{outline:2px solid var(--navy);outline-offset:1px;border-color:var(--navy)}\n' +
    'button{margin-top:14px;width:100%;padding:12px 16px;border:0;border-radius:6px;background:var(--gold);color:var(--navy);font:600 16px/1.2 "Hanken Grotesk",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer;transition:opacity 150ms ease}\n' +
    'button:hover{opacity:.9}button:disabled{opacity:.6;cursor:default}\n' +
    '#m{min-height:24px;margin:14px 0 0;font-size:14px;color:var(--soft)}#m.err{color:var(--risk)}\n' +
    '</style>\n</head>\n<body>\n<header><div>' + LOGO + '<span>Citehound</span></div></header>\n' +
    '<main><form class="card" id="f" autocomplete="off">\n<p class="kicker">Private</p>\n<h1>This report is private.</h1>\n<p>Enter the access code.</p>\n' +
    '<label for="c">Access code</label>\n<input id="c" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" aria-describedby="m" />\n' +
    '<button type="submit" id="b">Open report</button>\n<p id="m" role="status" aria-live="polite"></p>\n</form></main>\n' +
    '<script type="application/json" id="p">' + JSON.stringify(payload) + '</script>\n<script>\n' + UNLOCK_JS + '\n</script>\n</body>\n</html>\n';
}

function readCode(args) {
  const i = args.indexOf('--code-file');
  if (i !== -1) return fs.readFileSync(args[i + 1], 'utf8').trim();
  if (process.env.REPORT_ACCESS_CODE) return process.env.REPORT_ACCESS_CODE.trim();
  throw new Error('Give the access code with --code-file <file> or the REPORT_ACCESS_CODE environment variable.');
}

function main() {
  const args = process.argv.slice(2);
  const gi = args.indexOf('--generate-code');
  if (gi !== -1) {
    const file = args[gi + 1];
    if (!file) throw new Error('--generate-code needs a file path');
    if (fs.existsSync(file)) throw new Error(file + ' already exists; not overwriting an access code');
    fs.writeFileSync(file, generateCode() + '\n', { mode: 0o600 });
    console.log('Access code written to ' + file + ' (' + CODE_CHARS * 5 + ' bits). It is not printed.');
    return;
  }
  const ci = args.indexOf('--check');
  if (ci !== -1) {
    const page = fs.readFileSync(args[ci + 1], 'utf8');
    const m = page.match(/<script type="application\/json" id="p">([\s\S]*?)<\/script>/);
    if (!m) throw new Error('not an unlock page');
    try { console.log('Opens. Report size: ' + decryptPayload(JSON.parse(m[1]), readCode(args)).length + ' characters.'); }
    catch (e) { console.error('Does not open with this code.'); process.exit(1); }
    return;
  }
  const files = args.filter((a, i) => a.charAt(0) !== '-' && args[i - 1] !== '--code-file' && args[i - 1] !== '--iterations');
  if (files.length !== 2) throw new Error('Usage: node scripts/encrypt-report.js <in.html> <out.html> --code-file <file>');
  const ii = args.indexOf('--iterations');
  const html = fs.readFileSync(files[0], 'utf8');
  const out = unlockPage(encrypt(html, readCode(args), { iterations: ii !== -1 ? parseInt(args[ii + 1], 10) : DEFAULT_ITERATIONS }));
  fs.writeFileSync(files[1], out, 'utf8');
  console.log('Wrote ' + files[1] + ' (' + out.length + ' bytes).');
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('Error: ' + e.message); process.exit(1); }
}

module.exports = { normalizeCode, generateCode, encrypt, decryptPayload, unlockPage, MIN_ITERATIONS };
