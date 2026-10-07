/* =====================================================================
   lib/site-config.js

   The one place new code learns the site's address. Reads site.config.json at
   the repository root (baseUrl, host, name, contactEmail). Until that file
   exists it falls back to the current deployment, so nothing else needs to
   hardcode the host. scripts/set-domain.js rewrites site.config.json and the
   generated files that quote it.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const FALLBACK = { baseUrl: 'https://answerable-app.vercel.app', host: 'answerable-app.vercel.app', name: 'Citehound', contactEmail: 'andacuz@gmail.com' };

function load() {
  try {
    const file = path.join(__dirname, '..', 'site.config.json');
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const baseUrl = String(j.baseUrl || FALLBACK.baseUrl).replace(/\/+$/, '');
    return { baseUrl: baseUrl, host: j.host || baseUrl.replace(/^https?:\/\//, ''), name: j.name || FALLBACK.name, contactEmail: j.contactEmail || FALLBACK.contactEmail };
  } catch (e) {
    return Object.assign({}, FALLBACK);
  }
}

module.exports = load();
module.exports.load = load;
