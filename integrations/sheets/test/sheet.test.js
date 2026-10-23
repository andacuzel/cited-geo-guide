'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const KEY = 'chk_' + 'Ss7Hh8Ee'.repeat(4);

// Stand-ins for Apps Script: a sheet with a grid, the UI, properties, fetch.
function load(api, rows) {
  const grid = {}, alerts = [], props = {}, calls = [];
  grid[1] = []; rows.forEach((d, i) => { grid[i + 2] = [d]; });
  const ui = { Button: { OK: 'OK' }, ButtonSet: { OK_CANCEL: 'OK_CANCEL' }, alert: (m) => { alerts.push(m); }, prompt: () => ({ getSelectedButton: () => 'OK', getResponseText: () => ctx._answer }), createMenu: () => { const m = { items: [], addItem(l, f) { m.items.push([l, f]); return m; }, addToUi() { ctx._menu = m.items; } }; return m; } };
  const range = (r, c, n, w) => ({ setValues: (v) => { v.forEach((rowv, i) => { grid[r + i] = grid[r + i] || []; rowv.forEach((x, j) => { grid[r + i][c - 1 + j] = x; }); }); }, setValue: (x) => { grid[r] = grid[r] || []; grid[r][c - 1] = x; }, getValues: () => { const out = []; for (let i = 0; i < n; i++) out.push([(grid[r + i] || [])[c - 1] === undefined ? '' : grid[r + i][c - 1]]); return out; } });
  const ctx = {
    SpreadsheetApp: { getUi: () => ui, getActiveSheet: () => ({ getLastRow: () => Math.max.apply(null, Object.keys(grid).map(Number)), getRange: range }) },
    PropertiesService: { getUserProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; } }) },
    UrlFetchApp: { fetch: (url, o) => { calls.push({ url, o }); const r = api(url, o); return { getResponseCode: () => r.status, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)), getHeaders: () => r.headers || {} }; } },
    Utilities: { sleep: () => {} }, encodeURIComponent, JSON, _answer: KEY,
  };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  const run = (fn) => vm.runInContext(fn, ctx)();
  return { ctx, grid, alerts, props, calls, run };
}
const ME = (plan, scans) => ({ plan: plan, limits: { requests_per_hour: 10, requests_per_day: 40, scans_per_day: scans }, usage: { today: 3 } });
const SCAN = (d, extra) => Object.assign({ domain: d, scannedAt: '2026-10-23T08:00:00.000Z', score: 62, pillars: [{ id: 'discover', score: 20 }, { id: 'tech', score: 12 }, { id: 'trust', score: 30 }], failed: [{ fix: 'Add an llms.txt' }], crawlerSummary: { open: 1, limited: 2, blocked: 3 } }, extra || {});
const api = (plan, scans) => (url) => (url.includes('/me') ? { status: 200, body: ME(plan, scans) } : { status: 200, body: SCAN(new URL(url).searchParams.get('domain')) });

test('the manifest: V8, only getcitehound.com may be fetched, the narrow sheet scope', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'appsscript.json'), 'utf8'));
  assert.equal(m.runtimeVersion, 'V8'); assert.deepEqual(m.urlFetchWhitelist, ['https://getcitehound.com/']); assert.ok(m.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets.currentonly')); assert.ok(!m.oauthScopes.some((s) => /drive|gmail|calendar/.test(s)));
});
test('the menu has the four items', () => {
  const t = load(api('pro', null), []); t.run('onOpen');
  assert.deepEqual(t.ctx._menu.map((x) => x[1]), ['setApiKey', 'showPlan', 'scanDomains', 'forgetApiKey']);
});
test('set API key: a valid key is checked with /v1/me and kept in the user properties, never in a cell; a malformed or refused key is not kept', () => {
  const t = load(api('pro', null), []); t.run('setApiKey');
  assert.equal(t.props['citehound.key'], KEY); assert.match(t.alerts[0], /The key works\. Plan: pro/); assert.equal(t.calls[0].o.headers.Authorization, 'Bearer ' + KEY); assert.ok(!JSON.stringify(t.grid).includes(KEY));
  const bad = load(api('pro', null), []); bad.ctx._answer = 'nope'; bad.run('setApiKey'); assert.equal(bad.props['citehound.key'], undefined); assert.match(bad.alerts[0], /does not look like/); assert.equal(bad.calls.length, 0);
  const refused = load(() => ({ status: 401, body: {} }), []); refused.run('setApiKey'); assert.equal(refused.props['citehound.key'], undefined); assert.match(refused.alerts[0], /did not accept the API key/);
  t.run('forgetApiKey'); assert.equal(t.props['citehound.key'], undefined);
});
test('scanning needs a key first', () => {
  const t = load(api('pro', null), ['example.com']); t.run('scanDomains'); assert.match(t.alerts[0], /Set your API key first/); assert.equal(t.calls.length, 0);
});
test('scan: the header row is written, each domain gets its row (cleaned domain, scores, crawlers, first fix, date, OK), the key is in no cell', () => {
  const t = load(api('pro', null), ['https://www.Example.com/x', 'other.org']); t.props['citehound.key'] = KEY; t.run('scanDomains');
  assert.equal(t.grid[1][0], 'Domain'); assert.equal(t.grid[1].length, 11);
  assert.deepEqual(t.grid[2], ['example.com', 62, 20, 12, 30, 1, 2, 3, 'Add an llms.txt', '2026-10-23', 'OK']); assert.equal(t.grid[3][0], 'other.org');
  assert.deepEqual(t.calls.map((c) => c.url.replace('https://getcitehound.com/v1', '')), ['/me', '/scan?domain=example.com', '/scan?domain=other.org']); assert.match(t.alerts[0], /Scanned 2 domains/); assert.match(t.alerts[0], /readiness score/); assert.ok(!JSON.stringify(t.grid).includes(KEY));
});
test('a free key: at most the plan\'s scans a day per run, the rest say they wait; a trimmed scan says more findings are on a paid plan', () => {
  const t = load((url) => (url.includes('/me') ? { status: 200, body: ME('free', 2) } : { status: 200, body: SCAN(new URL(url).searchParams.get('domain'), { truncated: true, hidden_findings: 4 }) }), ['a.com', 'b.com', 'c.com', 'd.com']); t.props['citehound.key'] = KEY; t.run('scanDomains');
  assert.equal(t.calls.filter((c) => c.url.includes('/scan')).length, 2); assert.match(t.grid[2][10], /^OK \(4 more findings are on a paid plan\)/); assert.match(t.grid[4][10], /Not scanned in this run \(2 a run for this plan\)/); assert.match(t.alerts[0], /Scanned 2 domains\. 2 waiting/);
});
test('a run is capped at 25 domains whatever the plan', () => {
  const rows = Array.from({ length: 30 }, (_, i) => 'site' + i + '.com'), t = load(api('beyond', null), rows); t.props['citehound.key'] = KEY; t.run('scanDomains');
  assert.equal(t.calls.filter((c) => c.url.includes('/scan')).length, 25); assert.match(t.grid[31][10], /Not scanned in this run/);
});
test('the first limit, plan or key message stops the run and is written in the Status column; the key is in none of it', () => {
  const t = load((url) => (url.includes('/me') ? { status: 200, body: ME('free', 5) } : { status: 429, body: { message: 'A free key may scan 5 sites a day, and this key has used 5 today (UTC). ' + KEY }, headers: { 'Retry-After': '7200' } }), ['a.com', 'b.com']); t.props['citehound.key'] = KEY; t.run('scanDomains');
  assert.equal(t.calls.filter((c) => c.url.includes('/scan')).length, 1); assert.match(t.grid[2][10], /may scan 5 sites a day.*about 7200 seconds/); assert.match(t.alerts[0], /Stopped:/); assert.ok(!JSON.stringify(t.grid).includes(KEY) && !t.alerts.join().includes(KEY));
});
test('a domain that cannot be scanned (502) gets its message and the run goes on; a value that looks like a formula is made text; a bad domain is flagged without a request', () => {
  const t = load((url) => { if (url.includes('/me')) return { status: 200, body: ME('pro', null) }; const d = new URL(url).searchParams.get('domain'); return d === 'down.com' ? { status: 502, body: { message: 'Could not read https://down.com/ (dns).' } } : { status: 200, body: SCAN(d, { failed: [{ fix: '=HYPERLINK("http://x","y")' }] }) }; }, ['down.com', 'not a domain', 'ok.com']); t.props['citehound.key'] = KEY; t.run('scanDomains');
  assert.match(t.grid[2][10], /Could not read https:\/\/down\.com\//); assert.match(t.grid[3][10], /Not a domain/); assert.equal(t.grid[4][8], "'=HYPERLINK(\"http://x\",\"y\")"); assert.equal(t.grid[4][10], 'OK'); assert.equal(t.calls.filter((c) => c.url.includes('/scan')).length, 2);
});
test('show my plan prints the plan, the caps and the scans a day', () => {
  const t = load(api('free', 5), []); t.props['citehound.key'] = KEY; t.run('showPlan'); assert.match(t.alerts[0], /Plan: free\nRequests: 10 an hour, 40 a day\nScans: 5 a day/);
});
test('the script promises no outcome and holds no key', () => {
  const src = fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8');
  assert.doesNotMatch(src, /recommend|guarantee|official|partner|ranking/i); assert.doesNotMatch(src, /chk_[A-Za-z0-9_-]{20,}/); assert.match(src, /does not measure whether any assistant names a brand/);
});
