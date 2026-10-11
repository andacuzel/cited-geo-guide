/* =====================================================================
   report-card.js: the small "State of AI Readiness" card on the homepage.

   A card, never a modal: it sits bottom right on a wide screen and is a slim bar along the bottom on a narrow one, takes no focus, traps
   none, and leaves the page scrollable and clickable around it. It appears at most once per browser session, after the visitor has scrolled
   40% of the page or has been on it for 15 seconds with the tab visible, whichever comes first, and never while the scan's "Analyzing" screen
   is running. Escape and the close button remove it. Dismissal and "already shown" are kept in sessionStorage, inside try/catch, and fall back
   to the life of the page when storage is blocked. No cookie, no request, no tracking.

   The copy is in the <template id="rcTemplate"> of index.html (inert until shown, so it costs nothing at load: nothing is painted, no layout
   moves, and the card is position: fixed). It is never shown on /pro, /privacy, /r/*, /pro/*, a report page or the report page itself: the script runs on
   the homepage only, and checks the path again.
   ===================================================================== */
(function () {
  'use strict';

  var KEY = 'ch-rcard';
  var SCROLL_AT = 0.4;          // 40% of the scrollable height
  var SECONDS_AT = 15;          // seconds on the page with the tab visible
  var path = location.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/' && path !== '/index.html') return;
  if (/^\/(pro|privacy|r|app|waitlist|readiness|research|api)(\/|$)/.test(path)) return;

  var tpl = document.getElementById('rcTemplate');
  if (!tpl || !tpl.content) return;

  var memory = false;           // used when sessionStorage cannot be read or written
  function seen() { try { return sessionStorage.getItem(KEY) !== null; } catch (e) { return memory; } }
  function mark(v) { memory = true; try { sessionStorage.setItem(KEY, v); } catch (e) { /* kept in memory for this page only */ } }
  if (seen()) return;

  var card = null, seconds = 0, timer = 0, ticking = false;

  function scrolledEnough() {
    var el = document.documentElement;
    var room = el.scrollHeight - window.innerHeight;
    return room > 0 && (window.pageYOffset || el.scrollTop || 0) / room >= SCROLL_AT;
  }
  // The scan's progress screen must not be interrupted by anything.
  function scanBusy() { return !!document.querySelector('.hero.is-analyzing'); }

  function close(why) {
    if (!card) return;
    mark(why || '1');
    document.removeEventListener('keydown', onKey);
    card.parentNode && card.parentNode.removeChild(card);
    card = null;
  }
  function onKey(e) { if (e.key === 'Escape' || e.key === 'Esc') close('1'); }

  function show() {
    if (card || seen() || scanBusy()) return false;
    var frag = tpl.content.cloneNode(true);
    card = frag.firstElementChild;
    if (!card) return false;
    var btn = card.querySelector('.rc-card__close');
    if (btn) btn.addEventListener('click', function () { close('1'); });
    var go = card.querySelector('.rc-card__go');
    if (go) go.addEventListener('click', function () { mark('1'); });
    document.body.appendChild(card);
    // Reading the width forces a style flush, so the change of opacity below is a transition (reduced motion removes it in the stylesheet).
    void card.offsetWidth;
    card.classList.add('is-in');
    document.addEventListener('keydown', onKey);
    mark('shown');
    stop();
    return true;
  }

  function check() { if (scrolledEnough()) show(); }
  // At most one check every 150 ms while scrolling.
  function onScroll() { if (ticking) return; ticking = true; setTimeout(function () { ticking = false; check(); }, 150); }
  function tick() {
    if (document.visibilityState === 'hidden') return;
    seconds += 1;
    if (seconds >= SECONDS_AT) show();
  }
  function stop() {
    window.removeEventListener('scroll', onScroll);
    if (timer) { clearInterval(timer); timer = 0; }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  // After the visit has run long enough, a busy scan only delays the card: every later tick tries again.
  timer = setInterval(tick, 1000);
}());
