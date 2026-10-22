/* =====================================================================
   /v1/*: the Citehound API, behind ONE Vercel function (the Hobby plan allows twelve; this is the twelfth). vercel.json rewrites /v1/<path> to /api/v1/<path>;
   the router, the keys and the limits are in lib/api-v1/. Not listed anywhere but the /api page, the sitemap and llms.txt.
   ===================================================================== */

module.exports = function handler(req, res) {
  return require('../../lib/api-v1/index.js').handle(req, res);
};
