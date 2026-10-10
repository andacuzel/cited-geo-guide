/* lib/citation-errors.js: the one error type the citation providers throw. kind is one of quota, timeout, provider, empty, incomplete, no_search. */

'use strict';

class CheckError extends Error {
  constructor(kind, message, status) { super(message || kind); this.name = 'CheckError'; this.kind = kind; this.status = status || null; }
}

module.exports = { CheckError: CheckError };
