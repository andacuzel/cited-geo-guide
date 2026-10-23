#!/usr/bin/env node
/* =====================================================================
   scripts/test-workspaces.js

   Project workspaces (lib/ws-*.js) through the real handler (lib/pro-api.js handle), with the in-memory store and a fake scanner: the store and its
   expiry, the Fix list built from failed checks, Verify (passes only when the check passes, one at a time, a daily cap, never on a demo or archived
   workspace), the safe markdown, the escaping of everything rendered, the bearer link and the demo (noindex, no-referrer, read-only), and the admin:
   a 404 for every route while ADMIN_TOKEN is unset or short, a constant-time sign-in with a limited number of attempts, a session cookie that is
   httpOnly, SameSite=Strict and never holds the token, and every action behind it. Also that the function count and the routing stay as documented.

     node scripts/test-workspaces.js
   ===================================================================== */

'use strict';

process.env.PRO_HASH_SECRET = 'test-only-secret-0123456789abcdef';
const fs = require('fs');
const path = require('path');
const S = require('../lib/pro-store.js');
const api = require('../lib/pro-api.js');
const WS = require('../lib/ws-store.js');
const Svc = require('../lib/ws-service.js');
const Fix = require('../lib/ws-fix.js');
const Md = require('../lib/ws-markdown.js');
const Render = require('../lib/ws-render.js');
const WsApi = require('../lib/ws-api.js');
const Bey = require('../lib/ws-beyond.js');
const methodology = require('../lib/methodology.js');
const ROOT = path.resolve(__dirname, '..');

let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const logged = [];
['log', 'warn', 'error', 'info'].forEach((k) => { console[k] = function () { logged.push(Array.prototype.slice.call(arguments).join(' ')); }; });

const TOKEN = 'admin-token-for-tests-0123456789';
let ipCounter = 0;
function call(o, deps) {
  if (!o.ip) o.ip = '10.' + Math.floor(ipCounter / 250) + '.' + (ipCounter++ % 250) + '.7';
  return new Promise((resolve, reject) => {
    const headers = {};
    const req = { method: o.method || 'GET', url: '/', headers: Object.assign({ 'x-forwarded-for': o.ip, 'content-type': 'application/json', host: 'localhost:4180' }, o.headers || {}), query: o.query || {}, body: o.body, socket: {} };
    const res = { statusCode: 200, setHeader: (k, v) => { headers[k.toLowerCase()] = v; }, end: (b) => { let json = null; try { json = JSON.parse(b); } catch (e) { /* html */ } resolve({ status: res.statusCode, headers, body: String(b || ''), json }); } };
    Promise.resolve(api.handle(req, res, deps)).catch(reject);
  });
}
const mk = () => { const adapter = S.memoryAdapter(); return { adapter, store: S.createStore(adapter) }; };

// A fake scanner: the checks come from the real registry; `failing` is the set of base labels that fail.
function fakeScanner(state) {
  return { scanPage: async function () {
    if (state.down) return { ok: false, stage: 'page' };
    const checks = methodology.registry().map((c) => {
      const ok = state.failing.indexOf(c.label) === -1;
      return { label: c.label === 'AI crawler access' ? 'AI crawler access (' + (ok ? 10 : 4) + '/10 open)' : c.label, cat: c.cat, ok: ok, pts: ok ? c.max : 0, max: c.max };
    });
    const sum = (cat) => checks.filter((c) => c.cat === cat).reduce((a, c) => a + c.pts, 0);
    return { ok: true, result: { checks: checks, discover: sum('discover'), tech: sum('tech'), trust: sum('trust'), total: sum('discover') + sum('tech') + sum('trust') },
      siteInfo: { title: 'Test <b>Site</b>', metaDesc: 'A test site.', lang: 'en' }, sitemapUrls: [] };
  } };
}
const okHost = async () => ({ ok: true });

(async function main() {
  /* ---- the store ---- */
  {
    const { adapter } = mk();
    const id = await WS.create(adapter, { type: 'fix', domain: 'example.org' });
    t('store: an id is 32 random hex characters, and two are never alike', WS.HEX32.test(id) && id !== await WS.create(adapter, { type: 'fix', domain: 'example.org' }));
    const ttl = await adapter.ttl(WS.key(id));
    t('store: a workspace lives 400 days after its last write', ttl > 399 * 86400 && ttl <= 400 * 86400, String(ttl));
    await WS.archive(adapter, id, true);
    const ttl2 = await adapter.ttl(WS.key(id)); const ttlItems = await adapter.ttl(WS.key(id, 'items'));
    t('store: archiving shortens every key to 90 days', ttl2 <= 90 * 86400 && ttlItems <= 90 * 86400 && ttlItems > 89 * 86400);
    t('store: the list shows real workspaces only', (await WS.list(adapter)).length === 2);
    let threw = false; try { await WS.create(adapter, { type: 'nope', domain: 'x.org' }); } catch (e) { threw = true; }
    t('store: an unknown type is refused', threw);
    await Svc.seedDemoFix(adapter);
    t('store: the demo has a fixed name, is not in the index and has no expiry', (await WS.list(adapter)).every((m) => !m.demo) && (await adapter.ttl(WS.key('demo-fix'))) === -1 && !WS.HEX32.test('demo-fix'));
    t('store: nothing in a workspace record is contact data', !/mail|name|phone/i.test(Object.keys(await adapter.hgetall(WS.key(id))).join(',')));
  }

  /* ---- the Fix list and Verify ---- */
  {
    const { adapter } = mk();
    const state = { failing: ['llms.txt present', 'Sitemap declared', 'AI crawler access', 'Canonical tag'] };
    const deps = { scanner: fakeScanner(state) };
    const r = await Svc.startFix(adapter, 'example.org', deps);
    const id = r.id;
    let items = await WS.getItems(adapter, id);
    t('fix: one todo item for each failed check, keyed by the base label', r.ok && items.length === 4 && items.every((i) => i.status === 'todo') && items.some((i) => i.key === 'AI crawler access'));
    t('fix: each item carries the check metadata (advice, why, points, pillar)', items.every((i) => i.advice && i.why && i.max > 0 && i.cat));
    t('fix: a site that cannot be scanned makes no workspace', !(await Svc.startFix(adapter, 'down.org', { scanner: fakeScanner({ down: true, failing: [] }) })).ok && (await WS.list(adapter)).length === 1);
    const scans = await WS.getScans(adapter, id);
    t('fix: the history starts with a baseline scan holding the scanner\'s own total', scans.length === 1 && scans[0].kind === 'baseline' && scans[0].score === (await WS.getLast(adapter, id)).total);

    const v1 = await Svc.verify(adapter, id, 'llms.txt present', deps);
    t('verify: a check that still fails is not verified, and says so', v1.ok && v1.passed === false && v1.status === 'todo' && /still fails/.test(v1.message));
    state.failing = ['Sitemap declared', 'AI crawler access', 'Canonical tag'];
    const v2 = await Svc.verify(adapter, id, 'llms.txt present', deps);
    t('verify: one run at a time per workspace (20 seconds)', !v2.ok && v2.status === 429 && v2.reason === 'wait');
    await adapter.del(WS.key(id, 'vlock'));
    const v3 = await Svc.verify(adapter, id, 'llms.txt present', deps);
    items = await WS.getItems(adapter, id);
    t('verify: a check that passes makes the item verified, with the date', v3.ok && v3.passed && items.filter((i) => i.key === 'llms.txt present')[0].status === 'verified' && items.filter((i) => i.key === 'llms.txt present')[0].verifiedAt);
    t('verify: every Verify is a scan in the history', (await WS.getScans(adapter, id)).length === 3);
    const s = await Svc.setItem(adapter, id, 'Canonical tag', { status: 'verified' });
    t('items: nobody can type "verified": only a passing check sets it', !s.ok && s.reason === 'verified_by_check_only');
    const s2 = await Svc.setItem(adapter, id, 'Canonical tag', { status: 'applied', note: 'Added **today**' });
    t('items: an admin can set todo, in progress or applied, and a note', s2.ok && s2.item.status === 'applied' && s2.item.note === 'Added **today**');
    t('items: an unknown status is refused', !(await Svc.setItem(adapter, id, 'Canonical tag', { status: 'done' })).ok);
    state.failing = ['llms.txt present', 'Sitemap declared', 'AI crawler access'];
    await Svc.rescan(adapter, id, deps);
    items = await WS.getItems(adapter, id);
    t('rescan: a verified item whose check fails again goes back to todo', items.filter((i) => i.key === 'llms.txt present')[0].status === 'todo' && items.filter((i) => i.key === 'llms.txt present')[0].regressed === true);
    state.failing = ['Sitemap declared', 'AI crawler access', 'Canonical tag', 'Page title'];
    await Svc.rescan(adapter, id, deps);
    items = await WS.getItems(adapter, id);
    t('rescan: a newly failing check comes in as a todo item', items.some((i) => i.key === 'Page title' && i.status === 'todo'));
    const add = await Svc.addItem(adapter, id, { label: '  A custom <b>item</b> ', advice: 'Do it' });
    t('items: a custom item has an x- key, no check, and can never be verified', add.ok && /^x-\d+$/.test(add.item.key) && (await Svc.verify(adapter, id, add.item.key, deps)).reason === 'not_found');
    t('items: only a custom item can be removed', !(await Svc.removeItem(adapter, id, 'Page title')).ok && (await Svc.removeItem(adapter, id, add.item.key)).ok);
    await adapter.del(WS.key(id, 'vlock'));
    const day = new Date().toISOString().slice(0, 10);
    await adapter.set(WS.key(id, 'vn:' + day), String(Svc.VERIFY_PER_DAY));
    t('verify: a daily cap per workspace', (await Svc.verify(adapter, id, 'Page title', deps)).reason === 'daily');
    await Svc.archive(adapter, id, true);
    await adapter.del(WS.key(id, 'vlock'));
    t('verify: never on an archived workspace', (await Svc.verify(adapter, id, 'Page title', deps)).reason === 'archived');
    t('files: schema, robots.txt and llms.txt come from the shared generators', (() => { const f = Fix.files({ domain: 'example.org', siteInfo: { title: 'Ex', metaDesc: 'A site.', lang: 'en' } }, null); return f.length === 3 && /application\/ld\+json/.test(f[0].text) && /^User-agent: GPTBot\nAllow: \//.test(f[1].text) && /^# Ex\n\n> A site\./.test(f[2].text); })());
    t('files: robots.txt allows all ten tracked crawlers and names a sitemap', (() => { const r = Fix.files({ domain: 'example.org', siteInfo: {} }, null)[1].text; return (r.match(/^User-agent:/gm) || []).length === 10 && /Sitemap: https:\/\/example\.org\/sitemap\.xml/.test(r); })());
  }

  /* ---- markdown ---- */
  {
    const r = Md.render;
    t('markdown: a script tag is shown as text', !/<script/i.test(r('<script>alert(1)</script>')) && /&lt;script&gt;/.test(r('<script>alert(1)</script>')));
    t('markdown: an image tag with an event handler is shown as text', !/<img/i.test(r('<img src=x onerror=alert(1)>')));
    t('markdown: a javascript: link is not a link', !/href="javascript/i.test(r('[x](javascript:alert(1))')) && !/<a /.test(r('[x](javascript:alert(1))')));
    t('markdown: a data: link is not a link', !/<a /.test(r('[x](data:text/html,hi)')));
    t('markdown: an https link is a link that opens safely', /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer nofollow">ok<\/a>/.test(r('[ok](https://example.com/a?b=1&c=2)')));
    t('markdown: a quote cannot break out of a link address', !/onmouseover=\s*"/.test(r('[bad](https://x.co"onmouseover="alert(1))')) && !/<a [^>]*onmouseover/.test(r('[bad](https://x.co"onmouseover="alert(1))')));
    t('markdown: bold, lists and code render, and code stays escaped', /<strong>b<\/strong>/.test(r('**b**')) && /<ul>\s*<li>a<\/li>\s*<li>b<\/li>\s*<\/ul>/.test(r('- a\n- b')) && /<code>&lt;b&gt;<\/code>/.test(r('`<b>`')));
    t('markdown: input is cut at the cap', r('a'.repeat(Md.MAX_CHARS + 5000)).length < Md.MAX_CHARS + 20);
  }

  /* ---- the pages ---- */
  const { adapter, store } = mk();
  const state = { failing: ['llms.txt present', 'Sitemap declared'] };
  const deps = { store, scanner: fakeScanner(state), checkHost: okHost, env: { ADMIN_TOKEN: TOKEN } };
  const created = await Svc.startFix(adapter, 'example.org', deps);
  const id = created.id;
  await Svc.setItem(adapter, id, 'llms.txt present', { note: '<script>alert("note")</script> and [x](javascript:alert(1))' });
  await Svc.addItem(adapter, id, { label: '<img src=x onerror=alert(1)>', advice: '"><script>alert(2)</script>' });
  {
    const r = await call({ query: { a: 'ws', id } }, deps);
    t('page: a workspace link gives the workspace', r.status === 200 && /<h1 class="ws-head__title">example\.org<\/h1>/.test(r.body) && /Fix list/.test(r.body) && /Citehound Pro report/.test(r.body));
    t('page: noindex, no referrer, no store', /noindex/.test(r.headers['x-robots-tag']) && r.headers['referrer-policy'] === 'no-referrer' && r.headers['cache-control'] === 'no-store' && /noindex/.test(r.body));
    t('page: nothing an admin typed or a site served reaches the page as markup', !/<script>alert/.test(r.body) && !/<img src=x/.test(r.body) && !/href="javascript/.test(r.body) && !/Test <b>/.test(r.body));
    t('page: the only script is our own, and nothing is loaded from a third party except the fonts', (r.body.match(/<script[^>]*>/g) || []).every((x) => /src="\/app\/ws-view\.js/.test(x)) && !/<script>[\s\S]*?<\/script>/.test(r.body));
    t('page: the four tabs and the Pro tab are there', ['overview', 'fixes', 'files', 'history', 'pro'].every((x) => r.body.indexOf('id="' + x + '"') !== -1));
    t('page: the Pro tab says "Included"', /Citehound Pro report <span class="ws-included">Included<\/span>/.test(r.body));
    t('page: before and now are side by side with no arrow between two scores', /ws-stat__label">Before/.test(r.body) && /ws-stat__label">Now/.test(r.body) && !/→|&rarr;/.test(r.body));
    t('page: it says the score is readiness, not presence in answers', /do not measure whether any assistant names a brand/.test(r.body));
    t('page: unknown, malformed and demo ids all give the same 404', (await call({ query: { a: 'ws', id: '0'.repeat(32) } }, deps)).status === 404 && (await call({ query: { a: 'ws', id: 'demo-fix' } }, deps)).status === 404 && (await call({ query: { a: 'ws', id: 'x' } }, deps)).status === 404);
    const pj = await store.createJob({ domain: 'example.org' });
    await Svc.setPro(adapter, id, pj);
    await store.adapter.hset('pro:job:' + pj, { status: 'done' });
    const r2 = await call({ query: { a: 'ws', id } }, deps);
    t('page: with a finished Pro report the tab links to it', new RegExp('href="/r/' + pj + '/"').test(r2.body));
    await Svc.archive(adapter, id, true);
    const r3 = await call({ query: { a: 'ws', id } }, deps);
    t('page: an archived workspace is read-only', r3.status === 200 && /archived, read-only/.test(r3.body) && !/class="btn btn--ghost ws-verify"/.test(r3.body));
    await Svc.archive(adapter, id, false);
  }
  {
    await Svc.seedDemoFix(adapter);
    const r = await call({ query: { a: 'demofix' } }, deps);
    t('demo: /demo/fix shows the ribbon "Product demo · Sample data"', r.status === 200 && /Product demo &middot; Sample data/.test(r.body) && /example-co\.com/.test(r.body));
    t('demo: it is noindex and carries no Verify button', /noindex/.test(r.headers['x-robots-tag']) && !/class="btn btn--ghost ws-verify"/.test(r.body));
    const firstScore = (await WS.getScans(adapter, 'demo-fix'))[0].score;
    t('demo: it shows a before and an after, and the sample Pro report link', new RegExp('ws-stat__label">Before[\\s\\S]*?>' + firstScore + '<').test(r.body) && /href="\/sample-report"/.test(r.body));
    const v = await call({ method: 'POST', query: { a: 'wsverify' }, body: { id: 'demo-fix', key: 'Canonical tag' } }, deps);
    t('demo: Verify on the demo is refused', v.status === 404);
    const e = await Svc.setItem(adapter, 'demo-fix', 'Canonical tag', { note: 'x' });
    t('demo: nothing in it can be edited', !e.ok);
  }
  {
    const fresh = (await Svc.startFix(adapter, 'example.org', deps)).id;
    state.failing = ['Sitemap declared'];
    const v = await call({ method: 'POST', query: { a: 'wsverify' }, body: { id: fresh, key: 'llms.txt present' } }, deps);
    t('verify route: a passing check answers passed and the status', v.status === 200 && v.json.passed === true && v.json.status === 'verified', v.body);
    t('verify route: no cookie, no origin and a bad id are all generic', (await call({ method: 'POST', query: { a: 'wsverify' }, body: { id: 'nope', key: 'x' } }, deps)).status === 404);
    t('verify route: a form-encoded or foreign-origin request is refused before anything runs', (await call({ method: 'POST', query: { a: 'wsverify' }, headers: { 'content-type': 'text/plain' }, body: { id: fresh, key: 'x' } }, deps)).status === 415 && (await call({ method: 'POST', query: { a: 'wsverify' }, headers: { origin: 'https://evil.example' }, body: { id: fresh, key: 'x' } }, deps)).status === 403);
    let last = 0; for (let i = 0; i < 33; i++) { const r = await call({ method: 'POST', query: { a: 'wsverify' }, ip: '10.99.99.99', body: { id: '0'.repeat(32), key: 'k' } }, deps); last = r.status; }
    t('verify route: limited per network (30 an hour)', last === 429);
  }

  /* ---- the admin ---- */
  {
    const off = { store, scanner: fakeScanner(state), checkHost: okHost, env: {} };
    const short = { store, scanner: fakeScanner(state), checkHost: okHost, env: { ADMIN_TOKEN: 'short' } };
    for (const [label, d] of [['unset', off], ['too short', short]]) {
      const page = await call({ query: { a: 'wsadmin' } }, d);
      const login = await call({ method: 'POST', query: { a: 'wsadminlogin' }, body: { token: TOKEN } }, d);
      const apiR = await call({ method: 'POST', query: { a: 'wsadminapi' }, headers: { cookie: 'ws_admin=' + WsApi.makeSession(TOKEN) }, body: { action: 'list' } }, d);
      t('admin: with ADMIN_TOKEN ' + label + ' the page, the sign-in and the API are all 404', page.status === 404 && login.status === 404 && apiR.status === 404);
      t('admin: with ADMIN_TOKEN ' + label + ' nothing renders (no form, no script, no workspace list)', !/wsLogin|wsAdmin|ws-admin\.js|Workspaces/.test(page.body) && !/workspaces/.test(apiR.body));
    }
    const p0 = await call({ query: { a: 'wsadmin' } }, deps);
    t('admin: not signed in, the page is only a sign-in form, noindex, not framable', p0.status === 200 && /id="wsLogin"/.test(p0.body) && !/id="wsAdmin"/.test(p0.body) && /noindex/.test(p0.headers['x-robots-tag']) && p0.headers['x-frame-options'] === 'DENY');
    const bad = await call({ method: 'POST', query: { a: 'wsadminlogin' }, body: { token: 'wrong-token-wrong-token-1' } }, deps);
    t('admin: a wrong token is 401 and sets no cookie', bad.status === 401 && !bad.headers['set-cookie']);
    const good = await call({ method: 'POST', query: { a: 'wsadminlogin' }, body: { token: TOKEN } }, deps);
    const cookie = String(good.headers['set-cookie'] || '');
    t('admin: the right token sets an httpOnly, SameSite=Strict session cookie', good.status === 200 && /^ws_admin=/.test(cookie) && /HttpOnly/.test(cookie) && /SameSite=Strict/.test(cookie) && /Max-Age=28800/.test(cookie));
    t('admin: the cookie never holds the token, and no response echoes it', cookie.indexOf(TOKEN) === -1 && JSON.stringify([good.body, bad.body, p0.body]).indexOf(TOKEN) === -1 && logged.join('\n').indexOf(TOKEN) === -1);
    const session = cookie.split(';')[0];
    const A = (body, headers) => call({ method: 'POST', query: { a: 'wsadminapi' }, headers: Object.assign({ cookie: session }, headers || {}), body: body }, deps);
    t('admin: a signed-in visitor gets the tool', /id="wsAdmin"/.test((await call({ query: { a: 'wsadmin' }, headers: { cookie: session } }, deps)).body));
    t('admin: the admin page loads only our own script', (((await call({ query: { a: 'wsadmin' }, headers: { cookie: session } }, deps)).body.match(/<script[^>]*>/g)) || []).every((x) => /src="\/app\/ws-admin\.js/.test(x)));
    t('admin: no cookie, a forged cookie and an expired cookie are all 401', (await call({ method: 'POST', query: { a: 'wsadminapi' }, body: { action: 'list' } }, deps)).status === 401 &&
      (await call({ method: 'POST', query: { a: 'wsadminapi' }, headers: { cookie: 'ws_admin=9999999999.' + '0'.repeat(64) }, body: { action: 'list' } }, deps)).status === 401 &&
      (await call({ method: 'POST', query: { a: 'wsadminapi' }, headers: { cookie: 'ws_admin=' + WsApi.makeSession(TOKEN, Date.now() - 9 * 3600 * 1000) }, body: { action: 'list' } }, deps)).status === 401);
    t('admin: a cookie made with another token is refused', (await call({ method: 'POST', query: { a: 'wsadminapi' }, headers: { cookie: 'ws_admin=' + WsApi.makeSession('another-token-another-token-1') }, body: { action: 'list' } }, deps)).status === 401);
    t('admin: a foreign-origin or non-JSON call is refused even with the cookie', (await A({ action: 'list' }, { origin: 'https://evil.example' })).status === 403 && (await A({ action: 'list' }, { 'content-type': 'text/plain' })).status === 415);
    const list = await A({ action: 'list' });
    t('admin: list shows real workspaces with their score, and not the demo', list.status === 200 && list.json.workspaces.length >= 1 && list.json.workspaces.every((w) => WS.HEX32.test(w.id)));
    const cr = await A({ action: 'create', type: 'fix', domain: 'https://www.Example.net/page' });
    t('admin: create scans the site and answers with the client path', cr.status === 200 && /^\/w\/[0-9a-f]{32}$/.test(cr.json.path));
    t('admin: create refuses an unknown type, a bad domain and a non-public host', (await A({ action: 'create', type: 'essay', domain: 'example.org' })).status === 400 && (await A({ action: 'create', type: 'fix', domain: 'not a domain' })).status === 400 &&
      (await call({ method: 'POST', query: { a: 'wsadminapi' }, headers: { cookie: session }, body: { action: 'create', type: 'fix', domain: 'localhost.example' } }, Object.assign({}, deps, { checkHost: async () => ({ ok: false, kind: 'blocked_host' }) }))).status === 400);
    const wid = cr.json.id;
    const got = await A({ action: 'get', id: wid });
    t('admin: get returns the items, the history and the statuses an admin may set', got.status === 200 && Array.isArray(got.json.items) && got.json.statuses.indexOf('verified') !== -1 && got.json.scans.length === 1);
    const key = got.json.items[0].key;
    t('admin: setItem changes a status and a note', (await A({ action: 'setItem', id: wid, key: key, status: 'in_progress', note: 'On it' })).status === 200 && (await A({ action: 'get', id: wid })).json.items.filter((i) => i.key === key)[0].status === 'in_progress');
    t('admin: setItem will not set verified', (await A({ action: 'setItem', id: wid, key: key, status: 'verified' })).status === 400);
    t('admin: a malformed or demo id is not found', (await A({ action: 'get', id: 'demo-fix' })).status === 404 && (await A({ action: 'get', id: 'zz' })).status === 404);
    t('admin: setPro takes a 32-hex id or empty, nothing else', (await A({ action: 'setPro', id: wid, proJobId: 'abc' })).status === 400 && (await A({ action: 'setPro', id: wid, proJobId: '' })).status === 200);
    t('admin: rescan and archive work', (await A({ action: 'rescan', id: wid })).status === 200 && (await A({ action: 'archive', id: wid, on: true })).status === 200 && (await A({ action: 'get', id: wid })).json.meta.status === 'archived');
    t('admin: an unknown action is a 400', (await A({ action: 'drop-everything' })).status === 400);
    const out2 = await A({ action: 'logout' });
    t('admin: sign-out clears the cookie', /Max-Age=0/.test(String(out2.headers['set-cookie'])));
    let status = 0; for (let i = 0; i < 10; i++) { status = (await call({ method: 'POST', query: { a: 'wsadminlogin' }, ip: '10.77.77.77', body: { token: 'wrong-token-wrong-token-' + i } }, deps)).status; }
    t('admin: sign-in attempts are limited (8 in 15 minutes per network), right or wrong', status === 429);
    t('admin: the right token from a blocked network is refused too (the limit counts every attempt)', (await call({ method: 'POST', query: { a: 'wsadminlogin' }, ip: '10.77.77.77', body: { token: TOKEN } }, deps)).status === 429);
    t('admin: the token is compared in constant time (timingSafeEqual on digests)', /timingSafeEqual/.test(fs.readFileSync(path.join(ROOT, 'lib/ws-api.js'), 'utf8')) && !/(^|[^.\w])token\s*===|===\s*token\b/.test(fs.readFileSync(path.join(ROOT, 'lib/ws-api.js'), 'utf8')));
  }

  /* ---- Beyond ---- */
  {
    const { adapter, store } = mk();
    const state = { failing: ['Author / about signals'] };
    const deps = { store, scanner: fakeScanner(state), checkHost: okHost, env: { ADMIN_TOKEN: TOKEN } };
    const r = await Svc.startBeyond(adapter, 'example.org', deps);
    const id = r.id;
    const meta = await WS.getMeta(adapter, id);
    t('beyond: a workspace of type beyond, with a baseline scan and no Fix list', r.ok && meta.type === 'beyond' && (await WS.getScans(adapter, id)).length === 1 && (await WS.getItems(adapter, id)).length === 0);
    t('beyond: a site that cannot be scanned makes no workspace', !(await Svc.startBeyond(adapter, 'down.org', { scanner: fakeScanner({ down: true, failing: [] }) })).ok);
    t('beyond: Fix-only operations are refused on it', !(await Svc.addItem(adapter, id, { label: 'x' })).ok && (await Svc.verify(adapter, id, 'Page title', deps)).reason === 'not_found');
    t('beyond: a rescan adds a score to the history and nothing else', (await Svc.rescan(adapter, id, deps)).ok && (await WS.getScans(adapter, id)).length === 2 && (await WS.getItems(adapter, id)).length === 0);

    const q = await Svc.setQuestions(adapter, id, ['What is the best invoicing tool?', 'short', 'What is the best invoicing tool?', '  How do I send a recurring invoice?  ']);
    t('questions: short and repeated ones are dropped, the rest get ids', q.ok && q.count === 2 && (await WS.getQuestions(adapter, id)).map((x) => x.id).join() === 'q1,q2');
    t('questions: more than the limit is refused', !(await Svc.setQuestions(adapter, id, Array.from({ length: 41 }, (_, i) => 'A question number ' + i + ' about invoices'))).ok);
    t('questions: a category set is a starting point; an unknown one is refused', (await Svc.seedQuestions(adapter, id, 'crm')).count > 5 && (await Svc.seedQuestions(adapter, id, '../etc')).reason === 'vertical');
    t('questions: import needs a linked Pro report that has questions', (await Svc.importQuestions(store, id)).reason === 'no_pro_report');
    const job = await store.createJob({ domain: 'example.org', citation: true });
    await Svc.setPro(adapter, id, job);
    t('questions: ... and one without questions says so', (await Svc.importQuestions(store, id)).reason === 'no_questions');
    await store.setCitation(job, { status: 'done', questions: { source: 'llm', items: [{ text: 'Which invoicing tool suits a freelancer?', gloss: '', kind: 'category', brand: false }, { text: 'What does Example Books offer?', gloss: '', kind: 'brand', brand: true }] } });
    t('questions: import takes what the Pro report\'s generator wrote, with no model call', (await Svc.importQuestions(store, id)).count === 2 && (await WS.getQuestions(adapter, id))[0].text === 'Which invoicing tool suits a freelancer?');
    const g = await Svc.setGaps(adapter, id, [{ question: 'Q one is here', page: '/pricing', note: 'No direct answer', priority: 'high' }, { question: 'Q two is here', priority: 'weird' }, { question: '' }]);
    const gaps = await WS.getGaps(adapter, id);
    t('gaps: empty rows are dropped, an unknown priority becomes medium', g.ok && gaps.length === 2 && gaps[1].priority === 'medium' && gaps[0].page === '/pricing');

    const add = await Svc.addPiece(adapter, id, { title: ' A <b>piece</b> ', type: 'FAQ block', body: 'Text **here** <script>alert(1)</script>' });
    const cid = add.cid;
    t('content: a new piece is a draft with a version', add.ok && cid === 'c1' && (await WS.getPiece(adapter, id, cid)).status === 'draft' && (await WS.getPiece(adapter, id, cid)).version === 1);
    t('content: a bad type or an empty title is refused', !(await Svc.addPiece(adapter, id, { title: 'x', type: 'Essay' })).ok && !(await Svc.addPiece(adapter, id, { title: '  ', type: 'Rewrite' })).ok);
    t('content: an admin cannot set approved, and cannot publish a draft', (await Svc.setPieceStatus(adapter, id, cid, 'approved')).reason === 'approved_by_client_only' && (await Svc.setPieceStatus(adapter, id, cid, 'published')).reason === 'publish_needs_approval');
    t('content: the client cannot review a piece that is not in review', (await Svc.review(adapter, id, cid, { action: 'approve' })).reason === 'not_in_review');
    await Svc.setPieceStatus(adapter, id, cid, 'in_review');
    t('content: Request changes needs a comment', (await Svc.review(adapter, id, cid, { action: 'changes', comment: ' ' })).reason === 'comment');
    t('content: an unknown action is refused', (await Svc.review(adapter, id, cid, { action: 'delete' })).reason === 'action');
    const ch = await Svc.review(adapter, id, cid, { action: 'changes', comment: 'Please name the rate source.' });
    const afterCh = await WS.getPiece(adapter, id, cid); const cms1 = await WS.getComments(adapter, id, cid);
    t('content: Request changes puts the piece back to draft and keeps the comment for the admin', ch.ok && afterCh.status === 'draft' && cms1.length === 1 && cms1[0].by === 'client' && cms1[0].kind === 'changes' && cms1[0].text === 'Please name the rate source.');
    t('content: the admin sees it as changes requested', Bey.changesRequested(Object.assign({}, afterCh, { comments: cms1 })));
    await Svc.setPieceStatus(adapter, id, cid, 'in_review');
    const ap = await Svc.review(adapter, id, cid, { action: 'approve', comment: 'Good.' });
    t('content: Approve sets approved and records who and when', ap.ok && (await WS.getPiece(adapter, id, cid)).status === 'approved' && (await WS.getComments(adapter, id, cid)).pop().kind === 'approve');
    const ed = await Svc.editPiece(adapter, id, cid, { body: 'A different text.' });
    t('content: editing an approved piece sends it back to review, with a note', ed.ok && ed.reopened && (await WS.getPiece(adapter, id, cid)).status === 'in_review' && (await WS.getPiece(adapter, id, cid)).version === 2 && (await WS.getComments(adapter, id, cid)).pop().kind === 'note');
    await Svc.review(adapter, id, cid, { action: 'approve' });
    t('content: after approval the admin can publish; an unchanged save does not reopen it', (await Svc.editPiece(adapter, id, cid, { body: 'A different text.' })).reopened === false && (await Svc.setPieceStatus(adapter, id, cid, 'published')).ok);
    t('content: an admin note is a comment the client sees', (await Svc.noteOnPiece(adapter, id, cid, 'Live on 12 Oct.')).ok && (await WS.getComments(adapter, id, cid)).pop().by === 'admin');
    t('content: writes are limited per piece (30 comments)', await (async () => { const p2 = (await Svc.addPiece(adapter, id, { title: 'Second', type: 'Rewrite' })).cid; await Svc.setPieceStatus(adapter, id, p2, 'in_review'); for (let i = 0; i < 31; i++) await WS.addComment(adapter, id, p2, { by: 'admin', kind: 'note', text: 'n' + i }, Date.now() + i); return (await Svc.review(adapter, id, p2, { action: 'approve' })).reason === 'limit'; })());
    t('content: and per workspace per day', await (async () => { const p3 = (await Svc.addPiece(adapter, id, { title: 'Third', type: 'Rewrite' })).cid; await Svc.setPieceStatus(adapter, id, p3, 'in_review'); const dayKey = WS.key(id, 'cn:' + new Date().toISOString().slice(0, 10)); await adapter.set(dayKey, String(Svc.CLIENT_PER_DAY)); const out = (await Svc.review(adapter, id, p3, { action: 'approve' })).reason === 'daily'; await adapter.del(dayKey); return out; })());

    t('questions: a question keeps its id when the list is edited, so a piece\'s link survives', await (async () => { const before = await WS.getQuestions(adapter, id); const keep = before[1].text; await Svc.setQuestions(adapter, id, ['A brand new question for the list', keep]); const after = await WS.getQuestions(adapter, id); return after.find((x) => x.text === keep).id === before[1].id && after.find((x) => x.text === 'A brand new question for the list').id !== before[1].id; })());
    t('content: a piece links to the questions it answers; unknown ids are dropped', await (async () => { const qs = await WS.getQuestions(adapter, id); const r = await Svc.addPiece(adapter, id, { title: 'Linked', type: 'Rewrite', questions: [qs[0].id, 'q999', qs[0].id] }); return r.ok && (await WS.getPiece(adapter, id, r.cid)).forIds.join() === qs[0].id && (await Svc.editPiece(adapter, id, r.cid, { questions: [] })).ok && (await WS.getPiece(adapter, id, r.cid)).forIds.length === 0; })());
    t('months: a bad month or counts are refused', (await Svc.setMonth(adapter, id, { month: '2026-13', named: 1, asked: 5 })).reason === 'month' && (await Svc.setMonth(adapter, id, { month: '2026-09', named: 6, asked: 5 })).reason === 'counts');
    await Svc.setMonth(adapter, id, { month: '2026-09', named: 2, asked: 10, model: 'one assistant', note: 'one run each' });
    const table = Bey.monthsTable(await WS.getScans(adapter, id), await WS.getMonths(adapter, id));
    t('months: the table joins the scans of a month with its citation-check entry', table.some((x) => x.month === '2026-09' && x.citation && x.citation.named === 2) && table.every((x) => x.score === null || typeof x.score === 'number'));

    // The pages
    const hostile = (await Svc.addPiece(adapter, id, { title: '<img src=x onerror=alert(1)>', type: 'Rewrite', body: '<script>alert("body")</script> **bold** [x](javascript:alert(1))' })).cid;
    await Svc.setPieceStatus(adapter, id, hostile, 'in_review');
    await WS.addComment(adapter, id, hostile, { by: 'client', kind: 'changes', text: '<script>alert("comment")</script>' });
    const page = await call({ query: { a: 'ws', id } }, deps);
    t('beyond page: the tabs, the Pro tab and the lockup are there', page.status === 200 && ['questions', 'gaps', 'content', 'monthly', 'pro'].every((x) => page.body.indexOf('id="' + x + '"') !== -1) && /BEYOND/.test(page.body) && /Citehound Pro report <span class="ws-included">Included<\/span>/.test(page.body));
    t('beyond page: nothing typed by an admin or a client reaches it as markup', !/<script>alert/.test(page.body) && !/<img src=x/.test(page.body) && !/href="javascript/.test(page.body));
    t('beyond page: a piece in review shows Approve and Request changes; one that is not does not', (page.body.match(/class="ws-review"/g) || []).length === Bey.counts(await WS.listContent(adapter, id, false)).in_review && /data-action="approve"/.test(page.body) && /data-action="changes"/.test(page.body));
    t('beyond page: the piece\'s text is rendered through the safe markdown', /<strong>bold<\/strong>/.test(page.body) && /&lt;script&gt;alert\(&quot;body&quot;\)&lt;\/script&gt;/.test(page.body));
    t('beyond page: Monthly says the citation check is a pilot, never a ranking, and shows an entered result', /Citation check: pilot/.test(page.body) && /never a ranking/.test(page.body) && /Named in <b>2<\/b> of 10 questions/.test(page.body));
    t('beyond page: it opens on Overview, which says what waits for the client', /data-default-tab="overview"/.test(page.body) && /Waiting for you/.test(page.body) && /waiting for your review/.test(page.body));
    t('beyond page: noindex, no referrer, a script-src self policy', /noindex/.test(page.headers['x-robots-tag']) && page.headers['referrer-policy'] === 'no-referrer' && /script-src 'self'/.test(page.headers['content-security-policy']));
    await Svc.archive(adapter, id, true);
    const arch = await call({ query: { a: 'ws', id } }, deps);
    t('beyond page: an archived workspace has no review buttons', !/class="ws-review"/.test(arch.body) && /archived, read-only/.test(arch.body));
    t('beyond: an archived workspace refuses a review', (await Svc.review(adapter, id, hostile, { action: 'approve' })).reason === 'archived');
    await Svc.archive(adapter, id, false);

    // The client's route
    await Svc.setPieceStatus(adapter, id, hostile, 'in_review');
    const ok1 = await call({ method: 'POST', query: { a: 'wscontent' }, body: { id: id, cid: hostile, action: 'changes', comment: 'Please simplify the title.' } }, deps);
    t('route: Request changes through /api/pro/wscontent', ok1.status === 200 && ok1.json.status === 'draft', ok1.body);
    const again = await call({ method: 'POST', query: { a: 'wscontent' }, body: { id: id, cid: hostile, action: 'approve' } }, deps);
    t('route: a piece that is no longer in review is a 409', again.status === 409);
    t('route: a bad id, a bad cid and the demo are generic 404s', (await call({ method: 'POST', query: { a: 'wscontent' }, body: { id: 'nope', cid: 'c1', action: 'approve' } }, deps)).status === 404 && (await call({ method: 'POST', query: { a: 'wscontent' }, body: { id: id, cid: '../x', action: 'approve' } }, deps)).status === 404 && (await call({ method: 'POST', query: { a: 'wscontent' }, body: { id: 'demo-beyond', cid: 'c3', action: 'approve' } }, deps)).status === 404);
    t('route: a foreign origin or a form-encoded post is refused before anything runs', (await call({ method: 'POST', query: { a: 'wscontent' }, headers: { origin: 'https://evil.example' }, body: { id: id, cid: 'c1', action: 'approve' } }, deps)).status === 403 && (await call({ method: 'POST', query: { a: 'wscontent' }, headers: { 'content-type': 'text/plain' }, body: {} }, deps)).status === 415);
    let last = 0; for (let i = 0; i < 63; i++) last = (await call({ method: 'POST', query: { a: 'wscontent' }, ip: '10.88.88.88', body: { id: '0'.repeat(32), cid: 'c1', action: 'approve' } }, deps)).status;
    t('route: limited per network (60 an hour)', last === 429);

    // The admin
    const login = await call({ method: 'POST', query: { a: 'wsadminlogin' }, body: { token: TOKEN } }, deps);
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const A = (body) => call({ method: 'POST', query: { a: 'wsadminapi' }, headers: { cookie: cookie }, body: body }, deps);
    const cr = await A({ action: 'create', type: 'beyond', domain: 'example.net' });
    t('admin: create makes a Beyond workspace', cr.status === 200 && /^\/w\/[0-9a-f]{32}$/.test(cr.json.path) && (await WS.getMeta(adapter, cr.json.id)).type === 'beyond');
    const bid = cr.json.id;
    const got = await A({ action: 'get', id: bid });
    t('admin: get on a Beyond workspace returns its collections and the lists an editor needs', got.status === 200 && Array.isArray(got.json.questions) && Array.isArray(got.json.pieces) && got.json.types.indexOf('FAQ block') !== -1 && got.json.adminStatuses.indexOf('approved') === -1 && got.json.verticals.indexOf('crm') !== -1);
    t('admin: questions, gaps, a piece, a note and a month through the API', (await A({ action: 'setQuestions', id: bid, questions: ['What is the best tool for me?', 'How do I start with it?'] })).status === 200 && (await A({ action: 'setGaps', id: bid, gaps: [{ question: 'A gap question', page: '/x', note: 'n', priority: 'low' }] })).status === 200 &&
      (await A({ action: 'addPiece', id: bid, title: 'T', type: 'Rewrite', body: 'b' })).json.cid === 'c1' && (await A({ action: 'notePiece', id: bid, cid: 'c1', text: 'hello' })).status === 200 && (await A({ action: 'setMonth', id: bid, month: '2026-10', named: 1, asked: 8 })).status === 200);
    t('admin: it cannot set approved or publish a draft, and says why', (await A({ action: 'setPieceStatus', id: bid, cid: 'c1', status: 'approved' })).json.error === 'approved_by_client_only' && (await A({ action: 'setPieceStatus', id: bid, cid: 'c1', status: 'published' })).json.error === 'publish_needs_approval');
    await A({ action: 'setPieceStatus', id: bid, cid: 'c1', status: 'in_review' });
    await Svc.review(adapter, bid, 'c1', { action: 'changes', comment: 'A client comment.' });
    const g2 = await A({ action: 'get', id: bid });
    t('admin: the client\'s comment is there for the admin, with the status it caused', g2.json.pieces[0].status === 'draft' && g2.json.pieces[0].comments.some((c) => c.by === 'client' && c.text === 'A client comment.'));
    const lst = await A({ action: 'list' });
    t('admin: the list shows a Beyond workspace with its pieces', lst.json.workspaces.some((w) => w.id === bid && w.type === 'beyond' && w.pieces === 1));
    t('admin: a Fix action on a Beyond workspace and a demo id are refused', (await A({ action: 'addItem', id: bid, label: 'x' })).status === 400 && (await A({ action: 'get', id: 'demo-beyond' })).status === 404);
    t('admin: everything the admin stores is escaped on the client page', !/<script>/.test((await call({ query: { a: 'ws', id: bid } }, deps)).body.replace(/<script src=[^>]*><\/script>/g, '')));
  }
  {
    const { adapter, store } = mk();
    await Svc.seedDemoBeyond(adapter);
    const deps = { store, env: {} };
    const r = await call({ query: { a: 'demobeyond' } }, deps);
    t('demo beyond: /demo/beyond shows the ribbon, a fictional domain, the five tabs and no review form', r.status === 200 && /Product demo &middot; Sample data/.test(r.body) && /example-books\.com/.test(r.body) && ['questions', 'gaps', 'content', 'monthly', 'pro'].every((x) => r.body.indexOf('id="' + x + '"') !== -1) && !/class="ws-review"/.test(r.body));
    t('demo beyond: noindex, no referrer, and it is not reachable as a /w/ link', /noindex/.test(r.headers['x-robots-tag']) && r.headers['referrer-policy'] === 'no-referrer' && (await call({ query: { a: 'ws', id: 'demo-beyond' } }, deps)).status === 404);
    t('demo beyond: it has every status, a client comment and a changes-requested history, and invents no citation numbers', ['Draft', 'In review', 'Approved', 'Published'].every((x) => r.body.indexOf('>' + x + '<') !== -1) && /asked for changes/.test(r.body) && !/Named in <b>/.test(r.body) && /Citation check: pilot\. Not run for this project yet\./.test(r.body) && (r.body.match(/Not run/g) || []).length === 1);
    {
      const q = await WS.getQuestions(adapter, 'demo-beyond'); const pcs = await WS.listContent(adapter, 'demo-beyond', true);
      const cov = Bey.coverage(q, pcs);
      t('demo beyond: it is rich enough to chart (9 questions, 7 pieces in all four statuses, 5 monthly scores)', q.length === 9 && pcs.length === 7 && Bey.STATUSES.every((s) => pcs.some((p) => p.status === s)) && (await WS.getScans(adapter, 'demo-beyond')).length === 5);
      t('coverage: a question is Covered, In progress or Gap from the pieces that say they answer it, never from the words', cov.filter((x) => x.status === 'covered').length === 3 && cov.filter((x) => x.status === 'progress').length === 5 && cov.filter((x) => x.status === 'gap').length === 1);
      t('demo beyond: the Overview has the pipeline, the waiting card with a disabled Approve, the coverage donut, the score chart and the feed', /class="wc-steps"/.test(r.body) && /Waiting for you/.test(r.body) && /class="btn btn--primary ws-ro-btn" disabled/.test(r.body) && /Question coverage/.test(r.body) && /Readiness score by month/.test(r.body) && /class="ws-feed"/.test(r.body));
      t('demo beyond: the Content board has four columns and a drawer for every piece', (r.body.match(/class="wsb__col"/g) || []).length === 4 && pcs.every((p) => r.body.indexOf('<template id="dp-' + p.id + '"') !== -1));
      t('demo beyond: write controls are disabled with the "Demo is read-only" tooltip, and none of them can work (no live review form, no live buttons)', /data-tip="Demo is read-only"/.test(r.body) && !/class="ws-review"/.test(r.body) && !/ws-review__btn/.test(r.body) && !/class="btn btn--ghost ws-verify"/.test(r.body) && /ws-review ws-review--ro/.test(r.body));
      t('demo beyond: the gaps table has priority heat bars, is sortable and every row opens a drawer', /class="ws-heat ws-heat--high"/.test(r.body) && /<th scope="col" data-sort>/.test(r.body) && (r.body.match(/<tr data-prio=/g) || []).length === 6 && /<template id="dg-5"/.test(r.body));
    }
    t('demo beyond: nothing in it can be changed', !(await Svc.setQuestions(adapter, 'demo-beyond', ['A question that is long enough'])).ok && !(await Svc.addPiece(adapter, 'demo-beyond', { title: 'x', type: 'Rewrite' })).ok && (await Svc.review(adapter, 'demo-beyond', 'c3', { action: 'approve' })).reason === 'not_found');
    t('demo beyond: the seed is repeatable (a second run leaves the same seven pieces)', (await Svc.seedDemoBeyond(adapter)).ok && (await WS.listContent(adapter, 'demo-beyond')).length === 7 && (await adapter.ttl(WS.key('demo-beyond'))) === -1);
  }

  /* ---- routing and the repository ---- */
  {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    const rw = (src) => (v.rewrites || []).some((r) => r.source === src);
    t('routing: /w/<id>, /demo/fix, /demo/beyond and /admin/ws are rewritten onto the one Pro function', rw('/w/:id([0-9a-f]{32})') && rw('/demo/fix') && rw('/demo/beyond') && rw('/admin/ws') && (v.rewrites || []).some((r) => /wsverify\|wscontent\|wsadminlogin\|wsadminapi/.test(r.source)));
    const hdr = (src) => (v.headers || []).filter((h) => h.source === src)[0];
    t('routing: those paths send noindex, no-referrer and no-store from vercel.json (the site-wide CSP is the one on /(.*), set first so these rules follow it)', ['/(w|demo)/(.*)', '/admin/ws'].every((s) => { const h = hdr(s); const m = {}; (h ? h.headers : []).forEach((x) => { m[x.key] = x.value; }); return h && /noindex/.test(m['X-Robots-Tag']) && m['Referrer-Policy'] === 'no-referrer' && m['Cache-Control'] === 'no-store'; }) && (v.headers || []).filter((h) => /Content-Security-Policy/.test(JSON.stringify(h))).every((h) => h.source === '/(.*)') && v.headers[0].source === '/(.*)');
    const wsPage = await call({ query: { a: 'ws', id } }, deps);
    const demoPage = await call({ query: { a: 'demofix' } }, deps);
    t('routing: the workspace, demo and admin pages send a script-src self policy and cannot be framed', [wsPage, demoPage].every((r) => /script-src 'self'/.test(r.headers['content-security-policy']) && /frame-ancestors 'none'/.test(r.headers['content-security-policy'])) && /script-src 'self'/.test((await call({ query: { a: 'wsadmin' } }, deps)).headers['content-security-policy']));
    const fns = fs.readdirSync(path.join(ROOT, 'api')).filter((f) => /\.js$/.test(f) && f[0] !== '_');
    t('routing: the function count is unchanged (Hobby allows 12)', fns.length <= 11, String(fns.length));
    const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8') + fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8') + fs.readFileSync(path.join(ROOT, 'llms.txt'), 'utf8');
    t('routing: no workspace or admin path is in robots.txt, the sitemap or llms.txt', !/\/w\/|\/admin\/ws|\/demo\//.test(robots));
    t('security: nothing is logged by the workspace code paths (no domain, link or token)', logged.every((l) => !/example\.org|example-co|[0-9a-f]{32}/.test(l)), logged.slice(0, 3).join(' | '));
  }

  out('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { out('FAILED:'); fails.forEach((f) => out('  ' + f)); process.exit(1); }
})().catch((e) => { out('CRASH ' + (e && e.stack || e)); process.exit(1); });
