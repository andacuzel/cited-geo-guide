/* =====================================================================
   mcp-demo.js — replays the MCP conversation on the homepage, once.

   The conversation is complete in index.html and is never built here.
   This file only hides it and reveals it again: user message, then the
   tool-call row, then the reply, in about four seconds, when the panel
   first scrolls into view. It does nothing at all under
   prefers-reduced-motion or without IntersectionObserver, so those
   visitors, and anyone without JavaScript, get the finished state.
   ===================================================================== */

(function () {
  'use strict';

  var band = document.getElementById('mcp');
  var chat = document.getElementById('mcpChat');
  if (!band || !chat) return;
  if (!('IntersectionObserver' in window)) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var USER_MS_PER_CHAR = 28;
  var REPLY_MS_PER_CHAR = 12;
  var PAUSE_BEFORE_CALL = 350;
  var CALL_HOLD = 650;
  var GIVE_UP_MS = 10000;

  var stepEls = {
    user: chat.querySelector('[data-step="user"]'),
    call: chat.querySelector('[data-step="call"]'),
    reply: chat.querySelector('[data-step="reply"]')
  };
  if (!stepEls.user || !stepEls.call || !stepEls.reply) return;

  // Split each typed paragraph into a typed part and a hidden remainder.
  // The remainder keeps its space, so line breaks and panel height are
  // already final while the text arrives.
  function prepare(el) {
    var text = el.textContent.trim();
    var typed = document.createElement('span');
    var rest = document.createElement('span');
    rest.className = 'mcp-type__rest';
    rest.textContent = text;
    el.textContent = '';
    el.appendChild(typed);
    el.appendChild(rest);
    return { el: el, text: text, typed: typed, rest: rest };
  }

  var user = prepare(stepEls.user.querySelector('[data-type]'));
  var reply = prepare(stepEls.reply.querySelector('[data-type]'));
  var timers = [];
  var finished = false;

  chat.setAttribute('aria-busy', 'true');
  band.classList.add('is-armed');

  function finish() {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    user.el.textContent = user.text;
    reply.el.textContent = reply.text;
    band.classList.remove('is-armed');
    chat.removeAttribute('aria-busy');
  }

  function show(el) { el.classList.add('is-shown'); }

  function type(t, msPerChar, done) {
    var start = null;
    function frame(ts) {
      if (finished) return;
      if (start === null) start = ts;
      var n = Math.min(t.text.length, Math.floor((ts - start) / msPerChar));
      t.typed.textContent = t.text.slice(0, n);
      t.rest.textContent = t.text.slice(n);
      if (n < t.text.length) requestAnimationFrame(frame);
      else done();
    }
    requestAnimationFrame(frame);
  }

  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }

  function play() {
    try {
      timers.push(setTimeout(finish, GIVE_UP_MS));
      show(stepEls.user);
      type(user, USER_MS_PER_CHAR, function () {
        later(function () {
          show(stepEls.call);
          later(function () {
            show(stepEls.reply);
            type(reply, REPLY_MS_PER_CHAR, finish);
          }, CALL_HOLD);
        }, PAUSE_BEFORE_CALL);
      });
    } catch (e) {
      finish();
    }
  }

  var observer = new IntersectionObserver(function (entries) {
    if (!entries.some(function (e) { return e.isIntersecting; })) return;
    observer.disconnect();
    play();
  }, { threshold: 0.4 });
  observer.observe(chat);
}());
