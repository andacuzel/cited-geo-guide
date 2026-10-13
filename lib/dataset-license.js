/* =====================================================================
   lib/dataset-license.js: what every Dataset JSON-LD block on the site says about who made it and under what licence, and the one visible line that says the
   same on the page. Used by the generators (benchmarks, the crawler access study); the llms.txt adoption study, which is written by hand, carries the same
   words, and scripts/test-dataset-schema.js fails if any Dataset block or its page differs.

   The licence (CC BY 4.0) covers the aggregate figures published on the page. The gated State of AI Readiness PDF and the raw per-site scan data are not
   part of it (the raw data is not published at all). 13 Oct 2026, after Search Console reported "invalid object type for creator" (a bare @id reference
   is not an object type Google reads there) and "missing license" on the Dataset blocks.
   ===================================================================== */

'use strict';

const site = require('./site-config.js');

const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';

// An Organization object, not a reference.
function creator() { return { '@type': 'Organization', name: site.name, url: site.baseUrl }; }

// The visible line, as HTML (a link to the licence) and as plain text.
const LINE_TEXT = 'License: the aggregate figures on this page are published under CC BY 4.0. The gated PDF and the raw scan data are excluded.';
function lineHtml() {
  return 'License: the aggregate figures on this page are published under <a href="' + LICENSE_URL + '">CC BY 4.0</a>. The gated PDF and the raw scan data are excluded.';
}

module.exports = { LICENSE_URL: LICENSE_URL, creator: creator, lineHtml: lineHtml, LINE_TEXT: LINE_TEXT };
