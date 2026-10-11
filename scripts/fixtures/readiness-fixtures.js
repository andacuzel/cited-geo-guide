/* A stand-in for the State of AI Readiness PDF in tests and the dev server: valid enough for the store's checks (starts with %PDF-, over 1 KB, under the
   limit), obviously not the report. The real PDF is never in the repository. */
'use strict';

function fakePdf(extra) {
  const head = '%PDF-1.4\n% citehound test fixture, not the report\n';
  const body = '1 0 obj\n<< /Type /Catalog >>\nendobj\n' + ('% filler line to pass the size check of the store\n').repeat(40) + (extra || '');
  return Buffer.from(head + body + '%%EOF\n', 'latin1');
}

module.exports = { fakePdf: fakePdf, NAME: 'Citehound-State-of-AI-Readiness-Launch-Edition-2026.pdf' };
