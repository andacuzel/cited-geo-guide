'use strict';

const SIGNUP = 'https://getcitehound.com/api';
const HINT = 'Watch this domain weekly and get alerts: Pro. Ready-to-paste fixes: Fix. See https://getcitehound.com/pricing';
const NOTE = 'A readiness score: crawler access and on-page signals. It does not measure whether any assistant names a brand.';

// An error with a message that is safe and plain enough to print as it is, and an exit code.
class CliError extends Error {
  constructor(message, exitCode) { super(message); this.name = 'CliError'; this.exitCode = exitCode || 3; }
}

// A key is never printed: anything that looks like one is cut down, in every message, whatever its source.
function redact(s) { return String(s).replace(/chk_[A-Za-z0-9_-]{6,}/g, 'chk_…'); }

// A bare, lower-case domain from what a person typed (a URL, a www. name, a trailing slash). null if it cannot be one.
function normalizeDomain(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim().toLowerCase();
  if (!s || /\s/.test(s)) return null;
  s = s.replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/^www\./, '').replace(/\.$/, '');
  if (s.indexOf('@') !== -1 || s.indexOf(':') !== -1) return null;
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$/.test(s) || s.length > 253) return null;
  return s;
}

module.exports = { SIGNUP, NOTE, HINT, CliError, redact, normalizeDomain };
