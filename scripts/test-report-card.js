#!/usr/bin/env node
/* =====================================================================
   scripts/test-report-card.js: the homepage report card (report-card.js, the template and CSS in index.html and styles.css).

   Runs the script in a stub browser (window, document, sessionStorage, timers) and checks when it shows the card and when it never does: not before
   40% scroll or 15 visible seconds, at the first of the two, once per session, never on /pro, /privacy, /r/*, /pro/*, a report page or any page but the
   homepage, not while the scan's "Analyzing" screen runs, Escape and the close button remove it, sessionStorage that throws still works (once per page),
   and that the card takes no focus and sets no cookie. Then the markup: the copy, the number 219 from the content file, the link, the close
   button's label, no modal, one script, one place.

     node scripts/test-report-card.js
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const content = require('../content/readiness.json');
let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

const SRC = read('report-card.js');

/* A stub of just enough browser: returns handles to drive it. */
function world(opts) {
  opts = opts || {};
  const listeners = { window: {}, document: {} };
  const store = {};
  let interval = null, cookieSet = false, focused = 0;
  const card = {
    classList: { _s: new Set(), add(c) { this._s.add(c); }, contains(c) { return this._s.has(c); } },
    parentNode: null, offsetWidth: 340,
    focus() { focused++; },
    querySelector(sel) { return sel === '.rc-card__close' ? close : (sel === '.rc-card__go' ? go : null); }
  };
  const mkBtn = () => ({ _l: {}, addEventListener(e, f) { this._l[e] = f; }, click() { this._l.click && this._l.click(); }, focus() { focused++; } });
  const close = mkBtn(), go = mkBtn();
  const body = { children: [], appendChild(el) { this.children.push(el); el.parentNode = body; }, removeChild(el) { this.children = this.children.filter((x) => x !== el); el.parentNode = null; } };
  card.parentNode = null;
  const frag = { firstElementChild: card };
  const document = {
    visibilityState: 'visible', body: body,
    documentElement: { scrollHeight: 5000, scrollTop: 0 },
    getElementById: (id) => (id === 'rcTemplate' && !opts.noTemplate ? { content: { cloneNode: () => frag } } : null),
    querySelector: (sel) => (sel === '.hero.is-analyzing' && opts.busy ? {} : null),
    addEventListener(e, f) { (listeners.document[e] = listeners.document[e] || []).push(f); },
    removeEventListener(e, f) { listeners.document[e] = (listeners.document[e] || []).filter((x) => x !== f); },
    get cookie() { return ''; }, set cookie(v) { cookieSet = true; }
  };
  const window = {
    innerHeight: 1000, pageYOffset: 0,
    addEventListener(e, f) { (listeners.window[e] = listeners.window[e] || []).push(f); },
    removeEventListener(e, f) { listeners.window[e] = (listeners.window[e] || []).filter((x) => x !== f); }
  };
  const sessionStorage = opts.storageThrows ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } : { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  if (opts.preset) store['ch-rcard'] = opts.preset;
  const timers = [];
  const ctx = {
    window, document, sessionStorage,
    location: { pathname: opts.path === undefined ? '/' : opts.path },
    setInterval: (f) => { interval = f; return 1; }, clearInterval: () => { interval = null; },
    setTimeout: (f) => { timers.push(f); return timers.length; },
    pageYOffset: 0
  };
  ctx.self = ctx.window;
  const sandbox = vm.createContext(Object.assign(ctx, { Event: function () {} }));
  // the script reads window.pageYOffset and innerHeight through window; keep them in step
  vm.runInContext(SRC, sandbox);
  const w = {
    card, close, go, body, store,
    shown: () => body.children.indexOf(card) !== -1 && card.classList.contains('is-in'),
    scrollTo(frac) { window.pageYOffset = frac * (document.documentElement.scrollHeight - window.innerHeight); (listeners.window.scroll || []).forEach((f) => f()); while (timers.length) timers.shift()(); },
    tick(n) { for (let i = 0; i < (n || 1); i++) if (interval) interval(); },
    key(k) { (listeners.document.keydown || []).slice().forEach((f) => f({ key: k })); },
    ran: () => (listeners.window.scroll || []).length > 0,
    keyHandlers: () => (listeners.document.keydown || []).length,
    cookieSet: () => cookieSet, focused: () => focused, hasInterval: () => interval !== null, document, window
  };
  return w;
}

/* ---- when it appears ---- */
{
  const w = world();
  t('it listens for scrolling and counts seconds on the homepage', w.ran() && w.hasInterval());
  t('nothing is shown at load', !w.shown());
  w.scrollTo(0.39); t('not at 39% of the scroll', !w.shown());
  w.tick(14); t('not after 14 seconds', !w.shown());
  w.scrollTo(0.41); t('at 41% of the scroll it appears', w.shown());
  t('it is stored as shown, so a reload in the same session does not show it again', w.store['ch-rcard'] === 'shown');
  t('it listens for nothing more and counts no more once shown', !w.ran() && !w.hasInterval());
}
{
  const w = world();
  w.tick(14); t('14 visible seconds: not yet', !w.shown());
  w.tick(1); t('the 15th visible second: it appears (no scrolling needed)', w.shown());
}
{
  const w = world();
  w.document.visibilityState = 'hidden';
  w.tick(40); t('seconds with the tab hidden do not count', !w.shown());
  w.document.visibilityState = 'visible';
  w.tick(14); t('... only visible seconds do (14 so far)', !w.shown());
  w.tick(1); t('... and the 15th visible second shows it', w.shown());
}
{
  const w = world();
  w.scrollTo(0.5);
  const before = w.body.children.length;
  w.scrollTo(0.9); w.tick(30);
  t('it appears once, however long the visit', w.body.children.length === before && before === 1);
}
{
  const a = world({ preset: 'shown' }), b = world({ preset: '1' });
  t('already shown in this session: the script does nothing (no listener, no timer)', !a.ran() && !a.hasInterval() && !b.ran() && !b.hasInterval());
}

/* ---- when it never appears ---- */
['/pro', '/pro/', '/pro/start/abc', '/pro/welcome', '/privacy', '/r/0123456789abcdef0123456789abcdef', '/r/0123456789abcdef0123456789abcdef/', '/app/report', '/app/pro-start', '/waitlist/remove/x', '/readiness/remove/x', '/research/state-of-ai-readiness', '/research', '/methodology', '/tools', '/api/pro', '/sample-report'].forEach((p) => {
  const w = world({ path: p });
  w.scrollTo(0.9); w.tick(30);
  t('never on ' + p, !w.ran() && !w.hasInterval() && w.body.children.length === 0);
});
t('on the homepage written as /index.html it still runs', world({ path: '/index.html' }).ran());
{
  const w = world({ busy: true });
  w.scrollTo(0.9); w.tick(30);
  t('not while the scan\'s Analyzing screen is running', !w.shown());
  w.document.querySelector = () => null;
  w.tick(1);
  t('... and it comes once the scan is over (the next tick tries again)', w.shown());
}
t('without the template the script does nothing and does not throw', (() => { try { const w = world({ noTemplate: true }); return !w.ran(); } catch (e) { return false; } })());

/* ---- leaving ---- */
{
  const w = world();
  w.scrollTo(0.5);
  w.key('a'); t('another key does nothing', w.shown());
  w.key('Escape'); t('Escape removes it', !w.shown() && w.body.children.length === 0);
  t('... and remembers that it was closed for the session', w.store['ch-rcard'] === '1');
  w.scrollTo(0.9); w.tick(30); t('... and it does not come back', !w.shown());
  t('... and the Escape listener is gone', w.keyHandlers() === 0);
}
{
  const w = world();
  w.scrollTo(0.5);
  w.close.click(); t('the close button removes it', !w.shown() && w.body.children.length === 0 && w.store['ch-rcard'] === '1');
}
{
  const w = world();
  w.scrollTo(0.5);
  w.go.click(); t('following the link marks the session as done too', w.store['ch-rcard'] === '1');
}
t('it never takes focus and sets no cookie', (() => { const w = world(); w.scrollTo(0.5); w.key('Escape'); return w.focused() === 0 && !w.cookieSet(); })());

/* ---- storage that cannot be used ---- */
{
  let w;
  try { w = world({ storageThrows: true }); } catch (e) { w = null; }
  t('sessionStorage that throws does not break the script', !!w && w.ran());
  w.scrollTo(0.5); t('... the card still appears', w.shown());
  w.key('Escape'); w.scrollTo(0.9); w.tick(30);
  t('... and, closed, it stays closed for the life of the page', !w.shown());
}

/* ---- the source and the markup ---- */
t('the script has no cookie, localStorage, network call, focus call or timer longer than one second', !/document\.cookie|localStorage|fetch\(|XMLHttpRequest|sendBeacon|\.focus\(|setTimeout\([^)]*\b\d{4,}/.test(SRC) && /setInterval\(tick, 1000\)/.test(SRC));
t('the script reads and writes sessionStorage inside try/catch', (SRC.match(/try \{[^}]*sessionStorage/g) || []).length >= 2);
t('the triggers are 40% and 15 seconds', /SCROLL_AT = 0\.4/.test(SRC) && /SECONDS_AT = 15/.test(SRC));
t('no requestAnimationFrame (nothing depends on a frame being drawn) and no focus trap', !/requestAnimationFrame|keydown[^;]*Tab|tabindex|aria-modal|role="dialog"/.test(SRC));
const home = read('index.html');
const tpl = (/<template id="rcTemplate">([\s\S]*?)<\/template>/.exec(home) || [])[1] || '';
const words = tpl.replace(/<[^>]+>/g, ' ').replace(/&times;/g, '×').replace(/\s+/g, ' ').trim();
t('the copy is the brief\'s: "State of AI Readiness: what we found scanning 219 sites. Free report, sent to your inbox." and the button "Get the report"', /State of AI Readiness: what we found scanning 219 sites\. Free report, sent to your inbox\./.test(words) && />Get the report</.test(tpl));
t('219 is the content file\'s scored count (which test-readiness-figures checks against the data)', content.sample.scored === 219 && tpl.indexOf(String(content.sample.scored)) !== -1);
t('the button links to the teaser page', /href="\/research\/state-of-ai-readiness"/.test(tpl));
t('the close button is visible text, has an accessible name, and is a real button', /<button type="button" class="rc-card__close" aria-label="[^"]+">&times;<\/button>/.test(tpl));
t('it is a region, not a dialog: no aria-modal, no role dialog, no backdrop', /role="region"/.test(tpl) && !/aria-modal|role="dialog"|backdrop|overlay/i.test(tpl + SRC + read('styles.css').split('Report card')[1].split('/* Homepage "Beyond technical" band')[0].split('/* ----------------------------- Sections')[0]));
t('the template is inert (a <template>), so nothing is painted or laid out at load', /<template id="rcTemplate">/.test(home));
t('the script is loaded deferred, once, on the homepage only', (home.match(/report-card\.js/g) || []).length === 1 && /report-card\.js\?v=\d+" defer/.test(home));
const walk = (d, acc) => { fs.readdirSync(path.join(ROOT, d)).forEach((n) => { if (/^(node_modules|\.git|local|docs|scripts|lib)$/.test(n)) return; const rel = d ? d + '/' + n : n; if (fs.statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, acc); else if (/\.(html|js)$/.test(n)) acc.push(rel); }); return acc; };
t('no other page loads it', walk('', []).filter((f) => f !== 'index.html' && f !== 'report-card.js' && /report-card/.test(read(f))).length === 0);
const css = read('styles.css');
const block = css.split('Report card (homepage only')[1].split('/* Homepage "Beyond technical" band')[0].split('/* ----------------------------- Sections')[0];
t('the card is position: fixed, bottom right on a wide screen and a bar along the bottom under 700px', /\.rc-card \{ position: fixed; right: 20px; bottom: 20px;/.test(block) && /@media \(max-width: 700px\) \{\s*\.rc-card \{ left: 0; right: 0; bottom: 0;/.test(block));
t('its one transition is opacity, and there is no gradient, animation or transform', /transition: opacity var\(--t\)/.test(block) && !/gradient|animation|transform|@keyframes/.test(block));
t('it is hidden when printed', /\.rp-noprint, \.wl-bar, \.rc-card \{ display: none !important; \}/.test(css));
t('reduced motion is respected by the global rule that removes every transition', /prefers-reduced-motion: reduce\)[\s\S]{0,200}transition: none !important/.test(css));
t('the privacy page mentions the two homepage notices and session storage', /session storage/.test(read('privacy.html')) && /report card/.test(read('privacy.html')));

out('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
