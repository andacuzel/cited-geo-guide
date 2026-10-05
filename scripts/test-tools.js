#!/usr/bin/env node
/* =====================================================================
   scripts/test-tools.js

   Runs the three tool pages (llms.txt checker, robots.txt generator, schema
   generator) against a small DOM stub, one run, no browser needed: the page's
   own HTML is parsed, its scripts run in a vm context in page order, and fetch
   is answered from stored response shapes (the checker's from lib/llms.js
   itself, so the shape is the real one). Nothing leaves the machine.

   For every page it checks that: "Try an example" runs the page's own action and
   the result is non-empty and passes its format check; the address parameter runs
   automatically, is written back after a run, and an invalid value is dropped
   silently; errors are specific, a rate limit says how long to wait and offers a
   retry; focus moves to the result; copy and download confirm in the toast; the
   "Checked:" line appears only for output that passes; and nothing logs an error.

   Layout (no sideways scroll at 375px and 1440px) needs real layout, which a stub
   cannot give. It is asserted in the browser pane, with numbers, not here.

     node scripts/test-tools.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
const llms = require('../lib/llms.js');
const site = require('../lib/site-config.js');

/* ---------- a small DOM ---------- */

const observers = [];
let queued = false;
function mutated(el) {
  observers.forEach((o) => {
    for (let n = el; n; n = n.parentNode) {
      if (n === o.target) { o.pending = true; break; }
    }
  });
  if (!queued && observers.some((o) => o.pending)) {
    queued = true;
    queueMicrotask(() => {
      queued = false;
      observers.filter((o) => o.pending).forEach((o) => { o.pending = false; o.cb([]); });
    });
  }
}

class StubEvent {
  constructor(type, o) { o = o || {}; this.type = type; this.bubbles = !!o.bubbles; this.cancelable = !!o.cancelable; this.defaultPrevented = false; this._stop = false; this._stopNow = false; }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
  stopImmediatePropagation() { this._stop = true; this._stopNow = true; }
}

const VOID = { meta: 1, link: 1, input: 1, br: 1, img: 1, hr: 1 };
const decodeEntities = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&rsquo;/g, '’').replace(/&#39;/g, "'").replace(/&middot;/g, '·').replace(/&amp;/g, '&');

class Text { constructor(d) { this.nodeType = 3; this.data = d; this.parentNode = null; } get textContent() { return this.data; } }

function parseCompound(c) {
  const out = { tag: null, id: null, classes: [], attrs: [] };
  const re = /^([a-z][a-z0-9-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/gi;
  let m;
  while ((m = re.exec(c))) {
    if (m[1]) out.tag = m[1].toUpperCase();
    else if (m[2]) out.id = m[2];
    else if (m[3]) out.classes.push(m[3]);
    else out.attrs.push([m[4], m[5]]);
  }
  return out;
}
function matches(el, cp) {
  if (cp.tag && el.tagName !== cp.tag) return false;
  if (cp.id && el.getAttribute('id') !== cp.id) return false;
  const cls = (el.getAttribute('class') || '').split(/\s+/);
  if (!cp.classes.every((c) => cls.indexOf(c) !== -1)) return false;
  return cp.attrs.every((a) => el.hasAttribute(a[0]) && (a[1] === undefined || el.getAttribute(a[0]) === a[1]));
}

class El {
  constructor(tag) {
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this._a = {}; this.childNodes = []; this.parentNode = null; this._l = {}; this.style = {};
    this._value = null; this._checked = null; this.disabled = false;
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { if (!this.parentNode) return null; const s = this.parentNode.childNodes; return s[s.indexOf(this) + 1] || null; }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this._a, n) ? this._a[n] : null; }
  setAttribute(n, v) { this._a[n] = String(v); mutated(this); }
  hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this._a, n); }
  removeAttribute(n) { delete this._a[n]; mutated(this); }
  get id() { return this._a.id || ''; }
  set id(v) { this._a.id = String(v); }
  get className() { return this._a.class || ''; }
  set className(v) { this._a.class = String(v); mutated(this); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { if (v) this._a.hidden = ''; else delete this._a.hidden; mutated(this); }
  get type() { return this._a.type || ''; }
  set type(v) { this._a.type = v; }
  get value() { return this._value !== null ? this._value : (this._a.value || (this.tagName === 'TEXTAREA' ? this.textContent : '')); }
  set value(v) { this._value = String(v); }
  get checked() { return this._checked !== null ? this._checked : this.hasAttribute('checked'); }
  set checked(v) { this._checked = !!v; }
  get classList() {
    const self = this;
    const list = () => (self._a.class || '').split(/\s+/).filter(Boolean);
    return {
      add(c) { const l = list(); if (l.indexOf(c) === -1) { l.push(c); self._a.class = l.join(' '); mutated(self); } },
      remove(c) { self._a.class = list().filter((x) => x !== c).join(' '); mutated(self); },
      contains(c) { return list().indexOf(c) !== -1; },
      toggle(c, f) { const has = list().indexOf(c) !== -1; (f === undefined ? !has : f) ? this.add(c) : this.remove(c); }
    };
  }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(v) { this.childNodes.forEach((n) => { n.parentNode = null; }); this.childNodes = []; if (v !== '' && v !== null && v !== undefined) { const t = new Text(String(v)); t.parentNode = this; this.childNodes.push(t); } mutated(this); }
  set innerHTML(h) { this.childNodes.forEach((n) => { n.parentNode = null; }); this.childNodes = []; parseInto(this, String(h)); mutated(this); }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); mutated(this); return n; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i !== -1) { this.childNodes.splice(i, 1); n.parentNode = null; mutated(this); } return n; }
  insertBefore(n, ref) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; const i = ref ? this.childNodes.indexOf(ref) : -1; if (i === -1) this.childNodes.push(n); else this.childNodes.splice(i, 0, n); mutated(this); return n; }
  contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
  descendants() { const out = []; const walk = (e) => e.childNodes.forEach((c) => { if (c.nodeType === 1) { out.push(c); walk(c); } }); walk(this); return out; }
  querySelectorAll(sel) {
    const parts = sel.split(',').map((s) => s.trim().split(/\s+/).map(parseCompound));
    return this.descendants().filter((e) => parts.some((chain) => {
      if (!matches(e, chain[chain.length - 1])) return false;
      let a = e.parentNode;
      for (let i = chain.length - 2; i >= 0; i--) { while (a && !(a.nodeType === 1 && matches(a, chain[i]))) a = a.parentNode; if (!a) return false; a = a.parentNode; }
      return true;
    }));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { const cp = parseCompound(sel.trim()); for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (matches(n, cp)) return n; return null; }
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
  removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter((x) => x !== f); }
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    for (let n = this; n && n._l; n = n.parentNode) {
      ev.currentTarget = n;
      for (const f of (n._l[ev.type] || []).slice()) { f.call(n, ev); if (ev._stopNow) return !ev.defaultPrevented; }
      if (ev._stop || !ev.bubbles) break;
    }
    return !ev.defaultPrevented;
  }
  click() { this.dispatchEvent(new StubEvent('click', { bubbles: true, cancelable: true })); }
  focus() { this.ownerDocument.activeElement = this; }
  blur() {}
  scrollIntoView() {}
  requestSubmit() { this.dispatchEvent(new StubEvent('submit', { bubbles: true, cancelable: true })); }
}

function parseInto(parent, html) {
  const re = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m, cur = parent;
  while ((m = re.exec(html))) {
    if (m[5] !== undefined) { const t = new Text(decodeEntities(m[5])); t.parentNode = cur; cur.childNodes.push(t); continue; }
    if (m[1]) { const tag = m[1].toUpperCase(); for (let n = cur; n && n !== parent; n = n.parentNode) if (n.tagName === tag) { cur = n.parentNode; break; } continue; }
    if (!m[2]) continue;
    const el = new El(m[2]);
    const ar = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a;
    while ((a = ar.exec(m[3]))) el._a[a[1]] = decodeEntities(a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : '');
    el.parentNode = cur; cur.childNodes.push(el);
    const lower = m[2].toLowerCase();
    if (lower === 'script' || lower === 'style') {
      const close = html.indexOf('</' + lower, re.lastIndex);
      const raw = html.slice(re.lastIndex, close);
      if (raw) { const t = new Text(raw); t.parentNode = el; el.childNodes.push(t); }
      re.lastIndex = html.indexOf('>', close) + 1;
    } else if (!VOID[lower] && !m[4]) cur = el;
  }
}

function all(el, fn) { el.childNodes.forEach((c) => { if (c.nodeType === 1) { fn(c); all(c, fn); } }); }

/* ---------- loading a page ---------- */

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

function loadPage(file, search, responder) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const root = new El('html');
  parseInto(root, html);
  const doc = {
    documentElement: root, readyState: 'loading', activeElement: null, _l: {},
    getElementById(id) { return root.querySelector('#' + id); },
    querySelector(s) { return root.querySelector(s); },
    querySelectorAll(s) { return root.querySelectorAll(s); },
    createElement(t) { const e = new El(t); e.ownerDocument = doc; return e; },
    createTextNode(t) { return new Text(String(t)); },
    addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
    get body() { return root.querySelector('body'); }
  };
  all(root, (e) => { e.ownerDocument = doc; });
  const original = El.prototype.appendChild;
  const calls = [], errors = [], toasts = [], replaced = [];
  const loc = { search: search || '', pathname: '/' + file.replace(/\.html$/, ''), hash: '', href: '' };
  const sandbox = {
    document: doc, Event: StubEvent, URL, URLSearchParams, Response, Promise, setTimeout, clearTimeout, queueMicrotask, JSON,
    location: loc,
    history: { replaceState(s, t, url) { const u = new URL(url, 'http://localhost'); loc.search = u.search; loc.pathname = u.pathname; replaced.push(url); } },
    navigator: { clipboard: { writeText: (t) => { sandbox._copied = t; return Promise.resolve(); } } },
    MutationObserver: class { constructor(cb) { this.cb = cb; this.pending = false; } observe(target) { this.target = target; observers.push(this); } },
    Blob: class { constructor(parts) { this.parts = parts; } },
    console: { log() {}, warn() {}, error: (...a) => errors.push(a.join(' ')) },
    fetch: (url, init) => { calls.push(String(url)); return Promise.resolve(responder(String(url), init)); }
  };
  sandbox.URL = Object.assign(function (...a) { return new URL(...a); }, { createObjectURL: () => 'blob:stub', revokeObjectURL() {} });
  sandbox.URL.prototype = URL.prototype;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  const toast = doc.getElementById('toast');
  if (toast) {
    const orig = Object.getOwnPropertyDescriptor(El.prototype, 'textContent');
    Object.defineProperty(toast, 'textContent', { get() { return orig.get.call(this); }, set(v) { orig.set.call(this, v); toasts.push(v); } });
  }
  const dir = path.dirname(file);
  const scripts = [];
  all(root, (e) => { if (e.tagName === 'SCRIPT' && e.getAttribute('src')) scripts.push(e.getAttribute('src').split('?')[0]); });
  const errs = [];
  scripts.forEach((src) => {
    const full = path.join(ROOT, dir, src);
    try { vm.runInContext(fs.readFileSync(full, 'utf8'), sandbox, { filename: src }); } catch (e) { errs.push(src + ': ' + e.message); }
  });
  errs.forEach((e) => errors.push(e));
  doc.readyState = 'interactive';
  (doc._l.DOMContentLoaded || []).forEach((f) => f());
  return { doc, sandbox, loc, calls, errors, toasts, replaced, root };
}

/* ---------- stored response shapes ---------- */

const json = (body, status, headers) => new Response(JSON.stringify(body), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) });
const LLMS_TEXT = '# Answerable\n> Scan a site for AI readiness.\n\n## Pages\n- [Methodology](' + site.baseUrl + '/methodology): how the score is built\n';
function llmsResponse(url) {
  const domain = new URL(url, 'http://x').searchParams.get('domain');
  return json(llms.analyze({ ok: true, status: 200, text: LLMS_TEXT, contentType: 'text/plain', bytes: LLMS_TEXT.length }, domain.replace(/^www\./, ''), ''));
}
const siteInfo = (url) => json({ domain: new URL(url, 'http://x').searchParams.get('domain'), title: 'Answerable. — AI visibility scanner', description: 'Scan a site for AI readiness.', lang: 'en' });

/* ---------- the tests ---------- */

let pass = 0;
const results = [];
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ok  ' + name); } catch (e) { results.push(name); console.log('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; }
}
const byId = (p, id) => p.doc.getElementById(id);
const noErrors = (p) => assert.deepStrictEqual(p.errors, [], 'console errors: ' + p.errors.join(' | '));
const HOST = site.host;

(async function main() {
  console.log('tool pages against a DOM stub');

  /* ----- llms.txt checker ----- */
  const CHK = 'tools/llms-txt-checker.html';
  await t('checker: Try an example runs the page action on our own host and renders a result', async () => {
    const p = loadPage(CHK, '', llmsResponse);
    const btn = p.doc.querySelector('[data-toolx-example]');
    assert(btn, 'no example button');
    assert.strictEqual(btn.getAttribute('data-toolx-example'), HOST);
    btn.click();
    await settle();
    assert.strictEqual(p.calls.length, 1);
    assert(p.calls[0].indexOf('/api/llms-check?domain=' + HOST) === 0, p.calls[0]);
    const result = byId(p, 'llmsResult');
    assert(!result.hidden && result.textContent.length > 100, 'result empty');
    assert(/Custom|Platform default|Unclear/.test(result.textContent), 'no verdict');
    assert.strictEqual(byId(p, 'llmsDomain').value, HOST);
    noErrors(p);
  });
  await t('checker: focus moves to the result and the address is written back', async () => {
    const p = loadPage(CHK, '', llmsResponse);
    p.doc.querySelector('[data-toolx-example]').click();
    await settle();
    assert.strictEqual(p.doc.activeElement, byId(p, 'llmsResult'), 'focus not on the result');
    assert.strictEqual(byId(p, 'llmsResult').getAttribute('tabindex'), '-1');
    assert.strictEqual(p.loc.search, '?domain=' + HOST);
  });
  await t('checker: ?domain= runs automatically', async () => {
    const p = loadPage(CHK, '?domain=example.org', llmsResponse);
    await settle();
    assert.strictEqual(p.calls.length, 1);
    assert(p.calls[0].indexOf('domain=example.org') !== -1);
    assert(!byId(p, 'llmsResult').hidden);
    noErrors(p);
  });
  await t('checker: an invalid ?domain= is ignored silently and dropped from the address', async () => {
    const p = loadPage(CHK, '?domain=not%20a%20domain', llmsResponse);
    await settle();
    assert.strictEqual(p.calls.length, 0, 'it ran');
    assert.strictEqual(p.loc.search, '');
    assert.strictEqual(byId(p, 'llmsStatus').textContent, '');
    noErrors(p);
  });
  await t('checker: invalid typed input gets a specific message and no request', async () => {
    const p = loadPage(CHK, '', llmsResponse);
    byId(p, 'llmsDomain').value = 'not a domain';
    byId(p, 'llmsForm').requestSubmit();
    await settle();
    assert.strictEqual(p.calls.length, 0);
    assert(/valid domain/.test(byId(p, 'llmsStatus').textContent));
    assert(/is-error/.test(byId(p, 'llmsStatus').className));
  });
  await t('checker: a rate limit says how long to wait and offers a retry that runs again', async () => {
    let n = 0;
    const p = loadPage(CHK, '', (url) => (++n === 1 ? json({ error: 'You’ve hit the hourly limit. Try again in a little while.', limit: 'hour' }, 429, { 'Retry-After': '3600' }) : llmsResponse(url)));
    byId(p, 'llmsDomain').value = 'example.org';
    byId(p, 'llmsForm').requestSubmit();
    await settle();
    const status = byId(p, 'llmsStatus');
    assert(/about 1 hour/.test(status.textContent), status.textContent);
    assert(!/[{}]/.test(status.textContent), 'raw JSON shown');
    const retry = p.doc.querySelector('.toolx-retry');
    assert(retry && !retry.hidden, 'no retry button');
    retry.click();
    await settle();
    assert.strictEqual(p.calls.length, 2);
    assert(!byId(p, 'llmsResult').hidden);
    assert(p.doc.querySelector('.toolx-retry').hidden, 'retry still showing after success');
  });
  await t('checker: an unreachable domain shows the server’s specific message, with a retry', async () => {
    const p = loadPage(CHK, '', () => json({ error: 'Couldn’t reach nowhere.example (dns). Check the domain and try again.' }, 502));
    byId(p, 'llmsDomain').value = 'nowhere.example';
    byId(p, 'llmsForm').requestSubmit();
    await settle();
    assert(/Couldn’t reach nowhere\.example/.test(byId(p, 'llmsStatus').textContent));
    assert(!p.doc.querySelector('.toolx-retry').hidden);
  });

  /* ----- schema generator ----- */
  const SCH = 'tools/schema-generator.html';
  await t('schema: Try an example prefills from our own host and the output passes the JSON-LD check', async () => {
    const p = loadPage(SCH, '', siteInfo);
    p.doc.querySelector('[data-toolx-example]').click();
    await settle();
    assert(p.calls[0].indexOf('/api/site-info?domain=' + HOST) === 0, p.calls[0]);
    const out = byId(p, 'schemaOutput');
    assert(out.textContent.length > 80, 'output empty; errors: ' + p.errors.join(' | '));
    const m = /<script type="application\/ld\+json">([\s\S]*)<\/script>/.exec(out.textContent);
    const obj = JSON.parse(m[1]);
    assert(obj['@context'] && (obj['@type'] || (obj['@graph'] || []).every((n) => n['@type'])));
    const checked = p.doc.querySelector('.toolx-checked');
    assert(checked && !checked.hidden && /^Checked: valid JSON with @context and @type/.test(checked.textContent), 'no Checked line');
    assert.strictEqual(p.doc.activeElement, out, 'focus not on the output');
    assert.strictEqual(p.loc.search, '?domain=' + HOST);
    noErrors(p);
  });
  await t('schema: ?domain= runs automatically; an invalid one is dropped', async () => {
    const a = loadPage(SCH, '?domain=example.org', siteInfo);
    await settle();
    assert.strictEqual(a.calls.length, 1);
    const b = loadPage(SCH, '?domain=%3Cscript%3E', siteInfo);
    await settle();
    assert.strictEqual(b.calls.length, 0);
    assert.strictEqual(b.loc.search, '');
    noErrors(a); noErrors(b);
  });
  await t('schema: the Checked line is hidden for output that fails', async () => {
    const p = loadPage(SCH, '', siteInfo);
    await settle();
    const line = p.doc.querySelector('.toolx-checked');
    assert(!line.hidden, 'should pass at load');
    byId(p, 'schemaOutput').textContent = '<script type="application/ld+json">{ not json }</script>';
    await settle();
    assert(line.hidden && line.textContent === '', 'shown for broken JSON');
    byId(p, 'schemaOutput').textContent = '<script type="application/ld+json">{"@type":"Organization"}</script>';
    await settle();
    assert(line.hidden, 'shown without @context');
  });
  await t('schema: a rate limit on the prefill says how long to wait', async () => {
    const p = loadPage(SCH, '', () => json({ error: 'You’ve hit the daily limit. Try again tomorrow.', limit: 'day' }, 429, { 'Retry-After': '86400' }));
    byId(p, 'schemaDomain').value = 'example.org';
    byId(p, 'schemaForm').requestSubmit();
    await settle();
    assert(/about 24 hours/.test(byId(p, 'schemaStatus').textContent), byId(p, 'schemaStatus').textContent);
    assert(!p.doc.querySelector('.toolx-retry').hidden);
  });
  await t('schema: copy and download confirm in the toast and say what they did', async () => {
    const p = loadPage(SCH, '', siteInfo);
    byId(p, 'schemaCopyBtn').click();
    await settle();
    assert(p.toasts.some((x) => /^JSON-LD copied/.test(x)), p.toasts.join('|'));
    byId(p, 'schemaDownloadBtn').click();
    await settle();
    assert(p.toasts.some((x) => x === 'JSON-LD downloaded'), p.toasts.join('|'));
    assert(/<script type="application\/ld\+json">/.test(p.sandbox._copied));
  });

  /* ----- robots.txt generator ----- */
  const ROB = 'tools/robots-txt.html';
  await t('robots: output is non-empty, passes the directive check and the live status reads it', async () => {
    const p = loadPage(ROB, '', () => { throw new Error('robots.txt generator must not fetch'); });
    await settle();
    const out = byId(p, 'robotsOutput').textContent;
    assert(/^User-agent: /.test(out) && out.length > 40);
    const line = p.doc.querySelector('.toolx-checked');
    assert(line && !line.hidden && /^Checked: every line is a known robots\.txt directive/.test(line.textContent));
    assert(/robots\.txt updated: \d+ crawlers allowed, \d+ blocked\./.test(p.doc.querySelector('[data-toolx-live]').textContent));
    assert.strictEqual(p.calls.length, 0);
    noErrors(p);
  });
  await t('robots: Try an example fills the sitemap, runs the existing action and writes the address', async () => {
    const p = loadPage(ROB, '', () => { throw new Error('no fetch'); });
    p.doc.querySelector('[data-toolx-example]').click();
    await settle();
    const sm = site.baseUrl + '/sitemap.xml';
    assert(byId(p, 'robotsOutput').textContent.split('\n').pop() === 'Sitemap: ' + sm);
    assert.strictEqual(p.loc.search, '?sitemap=' + encodeURIComponent(sm));
    assert(!p.doc.querySelector('.toolx-checked').hidden);
  });
  await t('robots: ?sitemap= fills and runs automatically; an invalid value is dropped', async () => {
    const a = loadPage(ROB, '?sitemap=https%3A%2F%2Fexample.org%2Fs.xml', () => { throw new Error('no fetch'); });
    await settle();
    assert(/Sitemap: https:\/\/example\.org\/s\.xml$/.test(byId(a, 'robotsOutput').textContent));
    const b = loadPage(ROB, '?sitemap=javascript%3Aalert(1)', () => { throw new Error('no fetch'); });
    await settle();
    assert.strictEqual(b.loc.search, '');
    assert(!/Sitemap:/.test(byId(b, 'robotsOutput').textContent));
    noErrors(a); noErrors(b);
  });
  await t('robots: copy and download confirm in the toast', async () => {
    const p = loadPage(ROB, '', () => { throw new Error('no fetch'); });
    byId(p, 'robotsCopyBtn').click();
    await settle();
    assert(p.toasts.some((x) => /^robots\.txt copied/.test(x)), p.toasts.join('|'));
    byId(p, 'robotsDownloadBtn').click();
    await settle();
    assert(p.toasts.some((x) => x === 'robots.txt downloaded'), p.toasts.join('|'));
  });
  await t('robots: the Checked line is hidden when a line is not a directive', async () => {
    const p = loadPage(ROB, '', () => { throw new Error('no fetch'); });
    await settle();
    const line = p.doc.querySelector('.toolx-checked');
    byId(p, 'robotsOutput').textContent = 'User-agent: GPTBot\nAllow: /\nBlock: /private';
    await settle();
    assert(line.hidden);
  });

  /* ----- every page ----- */
  for (const file of [CHK, SCH, ROB]) {
    await t(file + ': the generated blocks, hooks and shared script are on the page', async () => {
      const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
      ['TOOL-INTRO', 'TOOL-MORE', 'NEXT'].forEach((n) => { assert.strictEqual(html.split('<!-- ' + n + ':START -->').length - 1, 1, n); assert.strictEqual(html.split('<!-- ' + n + ':END -->').length - 1, 1, n); });
      assert(html.indexOf('<script src="shared.js') !== -1);
      assert(/data-toolx-example=/.test(html));
    });
  }

  console.log('\n' + pass + ' passed' + (results.length ? ', ' + results.length + ' failed' : ''));
  if (results.length) process.exit(1);
}());
