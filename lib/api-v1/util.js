/* lib/api-v1/util.js: the few helpers the router and the monitoring routes share. */

'use strict';

// Races a scan against a deadline. A thrown error becomes { ok: false } with no detail (an error message never reaches a caller).
function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, stage: 'deadline', kind: 'timed out after ' + Math.round(ms / 1000) + ' seconds' }), ms); });
  return Promise.race([promise, deadline]).then((r) => { clearTimeout(timer); return r; }, () => { clearTimeout(timer); return { ok: false, stage: 'error', kind: 'scan failed' }; });
}

module.exports = { withDeadline };
