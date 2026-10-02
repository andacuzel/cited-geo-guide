/* =====================================================================
   Compare two sites — compare.html

   Calls the existing /api/scan endpoint twice, one site after the other,
   and shows where the two results differ. The scanner itself is not
   touched. Nothing is stored: the only state is the address bar
   (?a=domain&b=domain), set with history.replaceState.

   The pure logic (domain rules, scanning, diffing, share text) is kept
   apart from the DOM code and exported for Node, so it can be tested
   with mocked /api/scan responses.

   Values from the scan only ever reach the page as text, never as HTML.
   ===================================================================== */

(function (root) {
  'use strict';

  /* -------------------------------------------------------------------
     Logic
     ------------------------------------------------------------------- */

  // The scanner's own domain rule (scanner.js, api/scan.js, lib/scanner.js).
  function normalizeDomain(raw) {
    var d = (typeof raw === 'string' ? raw : '').trim().toLowerCase();
    d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)) return null;
    return d;
  }

  // ?a=...&b=... : an invalid value is ignored without comment.
  function parseParams(search) {
    var a = null;
    var b = null;
    try {
      var p = new URLSearchParams(search || '');
      a = normalizeDomain(p.get('a'));
      b = normalizeDomain(p.get('b'));
    } catch (e) { /* ignore */ }
    return { a: a, b: b };
  }

  function buildQuery(a, b) {
    return '?a=' + encodeURIComponent(a) + '&b=' + encodeURIComponent(b);
  }

  var PILLAR_NAMES = { discover: 'Discoverability', tech: 'Technical foundation', trust: 'Content & trust' };
  var PILLAR_ORDER = ['discover', 'tech', 'trust'];

  // "AI crawler access (6/10 open)" and "(10/10 open)" are one check.
  function checkKey(label) {
    return String(label).replace(/\s*\(\d+\s*\/\s*\d+\s+open\)\s*$/i, '').trim();
  }

  function status(pts, max) {
    if (pts >= max) return 'pass';
    if (pts <= 0) return 'fail';
    return 'partial';
  }

  // Keep only what the comparison needs from a /api/scan response.
  function summarize(domain, data) {
    var res = (data && data.result) || {};
    var checks = (res.checks || []).map(function (c) {
      return { key: checkKey(c.label), cat: c.cat, pts: c.pts, max: c.max, status: status(c.pts, c.max) };
    });
    var pillars = PILLAR_ORDER.map(function (cat) {
      var max = 0;
      checks.forEach(function (c) { if (c.cat === cat) max += c.max; });
      return { cat: cat, name: PILLAR_NAMES[cat], value: res[cat], max: max };
    });
    var bots = (data.botResults || []).map(function (b) {
      return { name: b.name, state: b.state === 'block' ? 'blocked' : b.state === 'partial' ? 'limited' : 'open' };
    });
    return { domain: domain, total: res.total, pillars: pillars, checks: checks, bots: bots };
  }

  // What a failed request means for that site, in words that name the cause.
  function describeFailure(httpStatus, body, domain) {
    var msg = body && typeof body.error === 'string' ? body.error : '';
    if (httpStatus === 429) {
      return { kind: 'rate', message: msg || 'The scanner’s rate limit was reached, so ' + domain + ' was not scanned. Try again later.' };
    }
    if (httpStatus === 400) {
      return { kind: 'invalid', message: msg || domain + ' is not a valid domain.' };
    }
    if (httpStatus === 502) {
      return { kind: 'unreachable', message: msg || domain + ' could not be read. Please try again.' };
    }
    return { kind: 'error', message: msg || 'The scan of ' + domain + ' failed unexpectedly. Please try again.' };
  }

  function scanOne(domain, fetchFn) {
    return Promise.resolve()
      .then(function () { return fetchFn('/api/scan?domain=' + encodeURIComponent(domain), { cache: 'no-store' }); })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (body) {
          if (!res.ok || !body || body.error || !body.result) {
            var f = describeFailure(res.status, body, domain);
            return { ok: false, domain: domain, kind: f.kind, message: f.message };
          }
          return { ok: true, domain: domain, summary: summarize(domain, body) };
        });
      })
      .catch(function () {
        return { ok: false, domain: domain, kind: 'network', message: 'Could not reach the scanner while scanning ' + domain + '. Check your connection and try again.' };
      });
  }

  // First A, then B. Never in parallel. onProgress(index, state, outcome)
  function runSequential(domains, fetchFn, onProgress) {
    var outcomes = [];
    var tell = onProgress || function () {};
    return domains.reduce(function (chain, domain, i) {
      return chain.then(function () {
        tell(i, 'scanning');
        return scanOne(domain, fetchFn).then(function (o) {
          outcomes.push(o);
          tell(i, o.ok ? 'done' : 'failed', o);
        });
      });
    }, Promise.resolve()).then(function () { return outcomes; });
  }

  // Differences only. Anything identical is left out.
  function compare(a, b) {
    var pillars = a.pillars.map(function (p, i) {
      return { name: p.name, max: p.max, a: p.value, b: b.pillars[i].value };
    });
    var byKey = {};
    b.checks.forEach(function (c) { byKey[c.key] = c; });
    var checks = [];
    a.checks.forEach(function (c) {
      var o = byKey[c.key];
      if (!o || o.pts === c.pts) return;
      checks.push({ key: c.key, a: c, b: o, gap: Math.abs(c.pts - o.pts) });
    });
    var botB = {};
    b.bots.forEach(function (x) { botB[x.name] = x.state; });
    var bots = [];
    a.bots.forEach(function (x) {
      if (botB[x.name] && botB[x.name] !== x.state) bots.push({ name: x.name, a: x.state, b: botB[x.name] });
    });
    var biggest = null;
    checks.forEach(function (c) { if (!biggest || c.gap > biggest.gap) biggest = c; });
    return { pillars: pillars, checks: checks, bots: bots, biggest: biggest };
  }

  // States both scores and the largest gap. No emoji, no call to action.
  function shareText(a, b, cmp) {
    var head = a.domain + ' scores ' + a.total + '/100 for AI readiness, ' + b.domain + ' ' + b.total + '/100. ';
    return head + (cmp.biggest ? 'The biggest gap: ' + cmp.biggest.key + '.' : 'The two sites score the same on every check.');
  }

  var Core = {
    normalizeDomain: normalizeDomain,
    parseParams: parseParams,
    buildQuery: buildQuery,
    checkKey: checkKey,
    summarize: summarize,
    describeFailure: describeFailure,
    scanOne: scanOne,
    runSequential: runSequential,
    compare: compare,
    shareText: shareText
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  root.ANSWERABLE_COMPARE = Core;

  /* -------------------------------------------------------------------
     DOM
     ------------------------------------------------------------------- */

  if (typeof document === 'undefined') return;
  var form = document.getElementById('cmpForm');
  if (!form) return;

  var $ = function (id) { return document.getElementById(id); };
  var inputA = $('cmpA');
  var inputB = $('cmpB');
  var btn = $('cmpBtn');
  var statusEl = $('cmpStatus');
  var progressEl = $('cmpProgress');
  var resultEl = $('cmpResult');

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function setStatus(msg, isError) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('is-error', !!isError);
  }
  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('is-visible');
    setTimeout(function () { t.classList.remove('is-visible'); }, 2600);
  }

  var STATE_LABEL = { pass: 'Passes', partial: 'Partial', fail: 'Fails', open: 'Open', limited: 'Limited', blocked: 'Blocked' };

  function renderProgress(domains) {
    clear(progressEl);
    progressEl.hidden = false;
    domains.forEach(function (d, i) {
      var li = el('li', 'cmp-progress__item');
      li.dataset.state = 'queued';
      li.appendChild(el('span', 'cmp-swatch cmp-swatch--' + (i ? 'b' : 'a')));
      li.appendChild(el('span', 'cmp-progress__domain', d));
      li.appendChild(el('span', 'cmp-progress__state', 'Waiting'));
      progressEl.appendChild(li);
    });
  }

  function updateProgress(i, state, outcome) {
    var li = progressEl.children[i];
    if (!li) return;
    li.dataset.state = state;
    var text = state === 'scanning' ? 'Scanning…'
      : state === 'done' ? 'Done, ' + outcome.summary.total + '/100'
      : state === 'failed' ? outcome.message : 'Waiting';
    li.querySelector('.cmp-progress__state').textContent = text;
  }

  function scoreCard(outcome, side) {
    var card = el('div', 'cmp-score cmp-score--' + side);
    var head = el('p', 'cmp-score__domain');
    head.appendChild(el('span', 'cmp-swatch cmp-swatch--' + side));
    head.appendChild(document.createTextNode(outcome.domain));
    card.appendChild(head);
    if (outcome.ok) {
      var num = el('p', 'cmp-score__num', String(outcome.summary.total));
      num.appendChild(el('small', null, '/100'));
      card.appendChild(num);
      card.appendChild(el('p', 'cmp-score__label', 'AI readiness score'));
    } else {
      card.appendChild(el('p', 'cmp-score__error', outcome.message));
    }
    return card;
  }

  function pillarBlock(p, outcomes) {
    var block = el('div', 'cmp-pillar');
    block.appendChild(el('p', 'cmp-pillar__name', p.name + ' · max ' + p.max));
    [['a', p.a, outcomes[0].domain], ['b', p.b, outcomes[1].domain]].forEach(function (r) {
      var row = el('div', 'cmp-bar');
      row.appendChild(el('span', 'cmp-bar__who', r[2]));
      var track = el('div', 'cmp-bar__track');
      var fill = el('div', 'cmp-bar__fill cmp-bar__fill--' + r[0]);
      fill.style.width = (p.max ? Math.max(0, Math.min(100, (r[1] / p.max) * 100)) : 0) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('span', 'cmp-bar__val', r[1] + '/' + p.max));
      block.appendChild(row);
    });
    return block;
  }

  function diffTable(title, heads, rows, emptyText) {
    var sec = el('div', 'cmp-section');
    sec.appendChild(el('h3', 'cmp-section__title', title));
    if (!rows.length) {
      sec.appendChild(el('p', 'cmp-section__none', emptyText));
      return sec;
    }
    var wrap = el('div', 'cmp-table-wrap');
    var table = el('table', 'cmp-table');
    var thead = el('thead');
    var hr = el('tr');
    heads.forEach(function (h) { var th = el('th', null, h); th.scope = 'col'; hr.appendChild(th); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr');
      r.forEach(function (cell, i) {
        var td = el('td', cell.cls || null, cell.text);
        if (i === 0) td.className = 'cmp-table__name';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    sec.appendChild(wrap);
    return sec;
  }

  function checkCell(c) {
    return { text: STATE_LABEL[c.status] + ' (' + c.pts + '/' + c.max + ')', cls: 'cmp-state cmp-state--' + c.status };
  }

  var lastShare = null;

  function render(outcomes) {
    clear(resultEl);
    resultEl.hidden = false;
    lastShare = null;

    var cards = el('div', 'cmp-cards');
    cards.appendChild(scoreCard(outcomes[0], 'a'));
    cards.appendChild(scoreCard(outcomes[1], 'b'));
    resultEl.appendChild(cards);

    if (!(outcomes[0].ok && outcomes[1].ok)) {
      if (outcomes[0].ok || outcomes[1].ok) {
        resultEl.appendChild(el('p', 'cmp-note', 'The comparison needs both scans, so the pillar scores, checks and crawlers are not shown. The result above is for the site that did scan.'));
      }
      return;
    }

    var a = outcomes[0].summary;
    var b = outcomes[1].summary;
    var cmp = compare(a, b);

    var pillars = el('div', 'cmp-section');
    pillars.appendChild(el('h3', 'cmp-section__title', 'The three pillars'));
    cmp.pillars.forEach(function (p) { pillars.appendChild(pillarBlock(p, outcomes)); });
    resultEl.appendChild(pillars);

    resultEl.appendChild(diffTable('Checks where the two sites differ',
      ['Check', a.domain, b.domain],
      cmp.checks.map(function (c) { return [{ text: c.key }, checkCell(c.a), checkCell(c.b)]; }),
      'No check differs.'));

    resultEl.appendChild(diffTable('AI crawlers whose access differs',
      ['Crawler', a.domain, b.domain],
      cmp.bots.map(function (x) {
        return [{ text: x.name }, { text: STATE_LABEL[x.a], cls: 'cmp-state cmp-state--' + x.a }, { text: STATE_LABEL[x.b], cls: 'cmp-state cmp-state--' + x.b }];
      }),
      'No crawler differs.'));

    var share = el('div', 'cmp-share');
    var shareBtn = el('button', 'btn btn--ghost', 'Share this comparison');
    shareBtn.type = 'button';
    shareBtn.id = 'cmpShare';
    shareBtn.addEventListener('click', doShare);
    share.appendChild(shareBtn);
    resultEl.appendChild(share);
    lastShare = { text: shareText(a, b, cmp) };
  }

  function currentUrl() {
    return location.origin + location.pathname + (location.search || '');
  }

  function doShare() {
    if (!lastShare) return;
    var url = currentUrl();
    if (navigator.share) {
      // The link goes in the url field only; the text does not repeat it.
      navigator.share({ title: 'AI readiness comparison', text: lastShare.text, url: url }).catch(function () { /* dismissed */ });
      return;
    }
    var full = lastShare.text + ' ' + url; // fallback: the link appended once
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(full).then(function () { toast('Comparison copied.'); }, function () { toast('Couldn’t copy. The link is in the address bar.'); });
    } else {
      toast('Couldn’t copy. The link is in the address bar.');
    }
  }

  var running = false;

  function start(a, b) {
    if (running) return;
    running = true;
    inputA.value = a;
    inputB.value = b;
    btn.disabled = true;
    resultEl.hidden = true;
    clear(resultEl);
    setStatus('Scanning one site after the other. This takes up to a minute.');
    renderProgress([a, b]);
    runSequential([a, b], function (u, o) { return root.fetch(u, o); }, updateProgress).then(function (outcomes) {
      render(outcomes);
      try { history.replaceState(null, '', location.pathname + buildQuery(a, b)); } catch (e) { /* ignore */ }
      var okCount = outcomes.filter(function (o) { return o.ok; }).length;
      setStatus(okCount === 2 ? 'Comparison ready.' : okCount === 1 ? 'One site could not be scanned. The other is shown.' : 'Neither site could be scanned.', okCount < 2);
    }).then(function () {
      running = false;
      btn.disabled = false;
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var a = normalizeDomain(inputA.value);
    var b = normalizeDomain(inputB.value);
    if (!a || !b || a === b) {
      resultEl.hidden = true;
      progressEl.hidden = true;
    }
    if (!a || !b) {
      setStatus('Enter two valid domains, for example example.com and example.org.', true);
      (a ? inputB : inputA).focus();
      return;
    }
    if (a === b) {
      setStatus('Enter two different domains.', true);
      inputB.focus();
      return;
    }
    start(a, b);
  });

  // Valid parameters fill the fields and run; invalid ones are ignored.
  var params = parseParams(location.search);
  if (params.a) inputA.value = params.a;
  if (params.b) inputB.value = params.b;
  if (params.a && params.b && params.a !== params.b) start(params.a, params.b);
})(typeof window !== 'undefined' ? window : globalThis);
