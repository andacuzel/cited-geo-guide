#!/usr/bin/env node
/* =====================================================================
   scripts/test-citation-providers.js: providers and brand extraction, mocks
   only. Asserts that a provider without its key makes no network call.
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const providers = require('../lib/citation/providers');
const brands = require('../lib/citation/brands');
const runner = require('../lib/citation/runner');
const common = require('../lib/citation/common');

let pass = 0; const fails = [];
const t = (n, ok, x) => { if (ok) pass++; else fails.push(n + (x ? ' :: ' + x : '')); console.log((ok ? '  ok  ' : '  FAIL ') + n + (ok ? '' : '  ' + (x || ''))); };
const ENVS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'PERPLEXITY_API_KEY', 'GEMINI_API_KEY'];
const saved = {}; ENVS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
const realFetch = global.fetch; let calls = 0; let last;
global.fetch = async (url, init) => { calls++; last = { url: String(url), init: init }; throw new Error('network call attempted'); };

(async () => {
  console.log('providers without a key');
  t('four providers are registered', Object.keys(providers.providers).sort().join() === 'anthropic,gemini,openai,perplexity');
  t('none reports configured', providers.status().every((p) => p.configured === false));
  for (const name of ['gemini', 'openai', 'anthropic', 'perplexity']) {
    calls = 0; let err;
    try { await providers.get(name).ask('Which CRM?', { model: 'x' }); } catch (e) { err = e; }
    t(name + ': says "not configured" and makes no network call', !!err && err.notConfigured === true && /not configured|is not set/.test(err.message) && calls === 0, err && err.message);
  }
  t('an unknown provider is an error', (() => { try { providers.get('nope'); return false; } catch (e) { return /Unknown provider/.test(e.message); } })());

  console.log('providers with a key (mock fetch)');
  const reply = (body) => async (url, init) => { calls++; last = { url: String(url), init: init, body: JSON.parse(init.body) }; return { ok: true, status: 200, json: async () => body }; };
  calls = 0; global.fetch = reply({ model: 'gpt-x', choices: [{ message: { content: 'HubSpot is one.' } }], usage: { prompt_tokens: 5, completion_tokens: 7 } });
  let r = await providers.get('openai').ask('Which CRM?', { key: 'k1', model: 'gpt-x' });
  t('openai: text, model, usage, key in a header only', r.text === 'HubSpot is one.' && r.model === 'gpt-x' && r.usage.inputTokens === 5 && r.usage.outputTokens === 7 && Array.isArray(r.sources) && last.init.headers.authorization === 'Bearer k1' && last.url.indexOf('k1') === -1 && calls === 1);
  global.fetch = reply({ model: 'claude-x', content: [{ type: 'text', text: 'Zoho.' }], usage: { input_tokens: 3, output_tokens: 4 } });
  r = await providers.get('anthropic').ask('Which CRM?', { key: 'k2', model: 'claude-x' });
  t('anthropic: text, model, usage, key in a header only', r.text === 'Zoho.' && r.usage.outputTokens === 4 && last.init.headers['x-api-key'] === 'k2' && last.url.indexOf('k2') === -1);
  global.fetch = reply({ model: 'sonar', choices: [{ message: { content: 'Pipedrive.' } }], citations: ['https://g2.com/a', 'https://reddit.com/b'], usage: { prompt_tokens: 1, completion_tokens: 2 } });
  r = await providers.get('perplexity').ask('Which CRM?', { key: 'k3' });
  t('perplexity: text and the sources it reports', r.text === 'Pipedrive.' && r.sources.length === 2 && r.sources[0].uri === 'https://g2.com/a' && last.init.headers.authorization === 'Bearer k3');
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) });
  let e2; try { await providers.get('openai').ask('x', { key: 'k', model: 'm' }); } catch (e) { e2 = e; }
  t('an HTTP error is an error with the status', !!e2 && /401/.test(e2.message));
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Attio.' }] }, groundingMetadata: { webSearchQueries: ['q'], groundingChunks: [{ web: { uri: 'https://x/1', title: 'g2.com' } }] } }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 2 } }) });
  r = await providers.get('gemini').ask('Which CRM?', { key: 'k4', model: 'gemini-x', grounded: true, pacer: { wait: async () => {}, ok() {}, limited() {}, delay: 0 } });
  t('gemini: text, sources, usage with search queries', r.text === 'Attio.' && r.sources[0].title === 'g2.com' && r.usage.searchQueries === 1 && r.usage.inputTokens === 9);

  console.log('brand extraction');
  const text = 'We like **Mailchimp** and Klaviyo; HubSpot too. mailchimp again.';
  t('accepts only strings that appear verbatim', brands.acceptVerbatim(['Klaviyo', 'Mailchimp', 'Invented', 'hubspot'], text).join() === 'Mailchimp,Klaviyo');
  t('a different case is not verbatim', !brands.acceptVerbatim(['hubspot'], text).length && brands.acceptVerbatim(['HubSpot'], text).length === 1);
  t('orders by position, drops duplicates and the target brand', brands.acceptVerbatim(['Klaviyo', 'Mailchimp', 'mailchimp', 'HubSpot'], text, ['HubSpot']).join() === 'Mailchimp,Klaviyo');
  t('rejects non-strings, empty and over-long names', brands.acceptVerbatim([1, null, '', 'x'.repeat(80), {}], text).length === 0);
  t('parses a bare array, a fenced array and an object with brands', brands.parseList('["A","B"]').length === 2 && brands.parseList('```json\n["A"]\n```').length === 1 && brands.parseList('{"brands":["A"]}').length === 1 && brands.parseList('nope').length === 0);
  const fakeProvider = { ask: async () => ({ text: JSON.stringify(['Klaviyo', 'Made Up Co', 'Mailchimp']) }) };
  t('extractBrands keeps what is verbatim and drops what the model invented', (await brands.extractBrands(fakeProvider, text, {}, [])).join() === 'Mailchimp,Klaviyo');
  const set = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/prompts/martech.json'), 'utf8'));
  const ctx = runner.makeContext({ brand: 'Acme', domain: 'acme.example', aliases: [], ambiguous: false, mode: 'ungrounded' }, set);
  const resp = { candidates: [{ content: { parts: [{ text: '1. **Klaviyo** is good. 2. **Mailchimp**.' }] } }] };
  t('martech has no lexicon, so parseRun without extraction finds no competitors', ctx.competitors.length === 0 && runner.parseRun(resp, ctx).competitors.length === 0);
  t('parseRun with extracted brands counts only the verbatim ones, in order', runner.parseRun(resp, ctx, ['Mailchimp', 'Klaviyo', 'Invented']).competitors.join() === 'Klaviyo,Mailchimp');
  const crm = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/prompts/crm.json'), 'utf8'));
  const cctx = runner.makeContext({ brand: 'Acme', domain: 'acme.example', aliases: [], ambiguous: false, mode: 'ungrounded' }, crm);
  const cresp = { candidates: [{ content: { parts: [{ text: 'Try **HubSpot** or Salesforce.' }] } }] };
  t('CRM keeps its lexicon: extracted brands are ignored when a lexicon exists', cctx.competitors.length > 0 && runner.parseRun(cresp, cctx, ['Invented']).competitors.join() === runner.parseRun(cresp, cctx).competitors.join());

  global.fetch = realFetch; ENVS.forEach((k) => { if (saved[k]) process.env[k] = saved[k]; });
  console.log('\n' + pass + ' passed' + (fails.length ? ', ' + fails.length + ' failed' : ''));
  if (fails.length) { console.error('\n' + fails.join('\n')); process.exit(1); }
})();
