/* =====================================================================
   lib/ws-scan.js: the one place a workspace asks for a scan: lib/scanner.js scanPage on the workspace's own domain (fetches go through
   lib/safe-fetch.js). A test hands in a fake scanner. Returns { ok: true, scan } or { ok: false, reason }. Never throws, never logs the domain.
   ===================================================================== */

'use strict';

async function scanDomain(domain, deps) {
  const scanner = (deps && deps.scanner) || require('./scanner.js');
  try {
    const scan = await scanner.scanPage('https://' + domain + '/');
    if (!scan || !scan.ok) return { ok: false, reason: scan && scan.stage === 'robots' ? 'robots' : 'page' };
    return { ok: true, scan: scan };
  } catch (e) {
    return { ok: false, reason: 'error' };
  }
}

module.exports = { scanDomain: scanDomain };
