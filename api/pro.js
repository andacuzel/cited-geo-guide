/* =====================================================================
   /api/pro: every Citehound Pro action behind one function (Hobby plan
   function limit). vercel.json maps /api/pro/<action> and /r/<id> onto it;
   the actions are in lib/pro-api.js. Not listed in the sitemap, robots.txt,
   llms.txt or the MCP server.
   ===================================================================== */

const api = require('../lib/pro-api.js');

module.exports = function handler(req, res) {
  return api.handle(req, res);
};
