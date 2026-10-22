'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { OPS } = require('../../shared/citehound-core.js');

const ROOT = path.join(__dirname, '..');
const walk = (d, acc) => { fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, acc); else acc.push(f); }); return acc; };
const J = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const app = J('makecomapp.json');
const mods = fs.readdirSync(path.join(ROOT, 'modules'));

test('every JSON and IML file parses', () => {
  const files = walk(path.join(ROOT, 'general'), []).concat(walk(path.join(ROOT, 'connections'), []), walk(path.join(ROOT, 'modules'), []));
  assert.ok(files.length >= 30);
  files.filter((f) => /\.(json|imljson)$/.test(f)).forEach((f) => assert.doesNotThrow(() => JSON.parse(fs.readFileSync(f, 'utf8')), f));
});
test('the base: the API address, the Bearer header from the connection, the key sanitized in logs, the API\'s message as the error', () => {
  const b = J('general/base.imljson');
  assert.equal(b.baseUrl, 'https://getcitehound.com/v1'); assert.equal(b.headers.Authorization, 'Bearer {{connection.apiKey}}'); assert.deepEqual(b.log.sanitize, ['request.headers.authorization']); assert.match(b.response.error.message, /\{\{body\.message\}\}/);
});
test('the connection asks for an API key as a password and tests it with GET /me', () => {
  const p = J('connections/citehound/parameters.imljson'), a = J('connections/citehound/api.imljson');
  assert.equal(p[0].name, 'apiKey'); assert.equal(p[0].type, 'password'); assert.equal(p[0].required, true); assert.equal(a.url, '/me'); assert.equal(a.method, 'GET');
});
test('the app lists the same modules as the folders, each with a label, a description and a type', () => {
  assert.deepEqual(app.modules.map((m) => m.id).sort(), mods.slice().sort()); assert.equal(app.modules.length, 10);
  app.modules.forEach((m) => { assert.ok(m.label && m.description && ['action', 'search', 'trigger'].includes(m.type), m.id); });
  assert.equal(app.modules.filter((m) => m.type === 'trigger').length, 1);
});
test('every module calls a path and method the shared client knows, with query and body fields that exist for it, each filled from a declared parameter', () => {
  const known = Object.keys(OPS).map((k) => OPS[k]);
  mods.forEach((id) => {
    const api = J('modules/' + id + '/api.imljson'), params = J('modules/' + id + '/parameters.imljson').map((p) => p.name);
    const op = known.find((o) => o[0] === api.method && o[1] === api.url); assert.ok(op, id + ' ' + api.method + ' ' + api.url);
    Object.keys(api.qs || {}).forEach((k) => { assert.ok((op[2] || []).includes(k), id + ' qs ' + k); assert.ok(params.includes(/parameters\.(\w+)/.exec(api.qs[k])[1]), id + ' param for ' + k); });
    Object.keys(api.body || {}).forEach((k) => { assert.ok((op[3] || []).includes(k), id + ' body ' + k); assert.ok(params.includes(/parameters\.(\w+)/.exec(api.body[k])[1]), id + ' param for ' + k); });
    assert.ok(api.response && (api.response.output || api.response.iterate), id);
    assert.ok(Array.isArray(J('modules/' + id + '/interface.imljson')), id);
  });
});
test('the trigger de-duplicates by the event id, newest first, and takes the events from the answer\'s list', () => {
  const api = J('modules/watch-events/api.imljson');
  assert.deepEqual(api.response.trigger, { type: 'id', id: '{{item.id}}', order: 'desc' }); assert.equal(api.response.iterate, '{{body.events}}'); assert.equal(api.url, '/events');
});
test('modules that need a paid plan say so in their description, and the readiness sentence is not claimed as a ranking', () => {
  const d = (id) => app.modules.find((m) => m.id === id).description;
  assert.match(d('compare-domains'), /Pro, Fix or Beyond/); assert.match(d('watch-domain'), /Pro, Fix or Beyond/); assert.match(d('watch-events'), /Pro, Fix or Beyond/); assert.match(d('get-fix-list'), /Fix or Beyond/); assert.match(d('scan-domain'), /free key shows the first three findings/);
  assert.doesNotMatch(JSON.stringify(app), /recommend|guarantee|official|partner|rank/i);
});
test('no key or secret is in any file', () => {
  walk(ROOT, []).filter((f) => !/node_modules/.test(f) && /\.(json|imljson|md)$/.test(f)).forEach((f) => assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /chk_[A-Za-z0-9_-]{20,}/, f));
});
