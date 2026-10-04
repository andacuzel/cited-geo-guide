/* =====================================================================
   lib/citation/providers/index.js: the providers a citation run can use.
   Each exposes { name, configured(), ask(question, options) }; see
   gemini.js for the shape ask() returns. Providers without a key report
   "not configured" and make no network call.
   ===================================================================== */
'use strict';

const providers = {
  gemini: require('./gemini'),
  openai: require('./openai'),
  anthropic: require('./anthropic'),
  perplexity: require('./perplexity')
};

function get(name) {
  if (!Object.prototype.hasOwnProperty.call(providers, name)) throw new Error('Unknown provider "' + name + '". Known: ' + Object.keys(providers).join(', '));
  return providers[name];
}

function status() {
  return Object.keys(providers).map(function (n) { return { name: n, configured: providers[n].configured() }; });
}

module.exports = { providers: providers, get: get, status: status };
