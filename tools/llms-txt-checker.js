/* =====================================================================
   llms.txt Checker — tools/llms-txt-checker.html
   Calls /api/llms-check and renders the assessment. Everything returned
   comes from a third-party site, so it is only ever written with
   textContent, never as HTML.
   ===================================================================== */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var form = $('llmsForm');
  if (!form) return;

  var domainInput = $('llmsDomain');
  var brandInput = $('llmsBrand');
  var button = $('llmsBtn');
  var status = $('llmsStatus');
  var result = $('llmsResult');

  var GENERATOR_URL = '/mcp#generate_llms_txt';
  var REPORT_URL = '/research/llms-txt-adoption-2026';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function link(href, text) {
    var a = el('a', null, text);
    a.href = href;
    return a;
  }

  function panel(title) {
    var p = el('div', 'tool-panel');
    if (title) p.appendChild(el('p', 'tool-panel__title', title));
    return p;
  }

  function row(mark, state, label, value, evidence) {
    var r = el('div', 'check-row' + (state ? ' is-' + state : ''));
    r.appendChild(el('span', 'check-row__mark', mark));
    var body = el('span');
    body.appendChild(document.createTextNode(label));
    if (evidence) body.appendChild(el('span', 'tool-evidence', evidence));
    r.appendChild(body);
    if (value) r.appendChild(el('span', 'check-row__pts', value));
    return r;
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    return (n / 1024).toFixed(1) + ' KB';
  }

  function setStatus(text, isError) {
    status.textContent = text || '';
    status.className = 'tool-status' + (isError ? ' is-error' : '');
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  /* ---------------- rendering ---------------- */

  function renderNotFound(r) {
    var p = panel('Result for ' + r.domain);
    p.appendChild(el('p', null, r.message));
    if (r.state === 'missing') {
      p.appendChild(el('p', null, 'The scanner counts a missing llms.txt as a failed check.'));
      var c = el('div', 'callout callout--gold');
      c.appendChild(el('p', 'callout__label', 'Next step'));
      var t = el('p');
      t.appendChild(document.createTextNode('Build one from a name, a one-line description and your key pages with the '));
      t.appendChild(link(GENERATOR_URL, 'generate_llms_txt tool'));
      t.appendChild(document.createTextNode('.'));
      c.appendChild(t);
      p.appendChild(c);
    }
    result.appendChild(p);
  }

  function renderVerdict(r) {
    var a = r.authorship;
    var p = panel('Who the file speaks for');

    var v = el('div', 'verdict' + (a.verdict === 'platform default' ? ' verdict--default' : a.verdict === 'custom' ? ' verdict--custom' : ''));
    v.appendChild(el('p', 'verdict__label', 'Assessment for ' + r.domain));
    v.appendChild(el('h2', 'verdict__word', a.verdict.charAt(0).toUpperCase() + a.verdict.slice(1)));
    v.appendChild(el('p', 'verdict__summary', a.summary));
    v.appendChild(el('p', 'verdict__caveat', a.caveat));
    p.appendChild(v);

    var list = el('div');
    list.style.marginTop = '20px';
    a.signals.forEach(function (s) {
      list.appendChild(row(s.found ? '+' : '–', '', s.label, s.found ? 'found' : 'not found', s.found ? s.evidence : ''));
    });
    p.appendChild(list);

    if (a.verdict === 'platform default') {
      var c = el('div', 'callout callout--gold');
      c.appendChild(el('p', 'callout__label', 'What this means'));
      var t = el('p');
      t.appendChild(document.createTextNode('This file currently speaks for ' + (a.platform || 'the platform') + ' rather than for your brand. An AI system that reads it learns about the platform’s shopping tools and nothing about what you sell. '));
      t.appendChild(link(GENERATOR_URL, 'Generate your own llms.txt'));
      t.appendChild(document.createTextNode(' from a name, a one-line description and your key pages. '));
      t.appendChild(link(REPORT_URL, 'See the research behind this check →'));
      c.appendChild(t);
      p.appendChild(c);
    }
    result.appendChild(p);
  }

  function renderFacts(r) {
    var p = panel('The file');
    var sz = r.size;

    p.appendChild(row('✓', 'ok', 'Exists', '200', 'Served at ' + (r.finalUrl || r.url)));

    var sizeLabel = formatBytes(sz.bytes) + ' · ' + plural(sz.words, 'word') + ' · ' + plural(sz.lines, 'line');
    p.appendChild(row('–', '', 'Size', sizeLabel,
      sz.truncated ? 'Larger than ' + formatBytes(sz.analyzedBytes) + '. Only the first ' + formatBytes(sz.analyzedBytes) + ' was read.' : ''));

    p.appendChild(row(r.readable.ok ? '✓' : '✗', r.readable.ok ? 'ok' : 'fail', 'Readable markdown-style text', '', r.readable.reason));

    var st = r.structure;
    var layoutBits = [
      st.title ? 'title “' + st.title + '”' : 'no title heading',
      st.hasSummary ? 'summary line' : 'no summary line',
      plural(st.sectionCount, 'section'),
      plural(st.links, 'link')
    ];
    p.appendChild(row(st.followsConvention ? '✓' : '–', st.followsConvention ? 'ok' : '', 'Layout',
      st.followsConvention ? 'llmstxt.org layout' : 'other layout', layoutBits.join(', ')));

    var b = r.brand;
    var where = [];
    where.push(b.inTitle ? 'in the title' : 'not in the title');
    where.push(b.inSummary ? 'in a summary' : 'not in a summary');
    p.appendChild(row(b.mentions > 0 ? '✓' : '✗', b.mentions > 0 ? 'ok' : 'fail', 'Names the brand',
      plural(b.mentions, 'mention'), 'Looked for “' + b.searchedFor + '” in the text, ignoring URLs: ' + where.join(', ') + '.'));

    result.appendChild(p);
  }

  function renderSections(r) {
    var st = r.structure;
    if (!st.sections.length) return;
    var p = panel('Sections it contains (' + st.headingCount + ')');
    var ul = el('ul', 'tool-sections');
    var shown = st.sections.slice(0, 14);
    shown.forEach(function (h) {
      var li = el('li', null, h.text);
      li.setAttribute('data-level', String(Math.min(h.level, 6)));
      ul.appendChild(li);
    });
    p.appendChild(ul);
    if (st.headingCount > shown.length) {
      p.appendChild(el('p', 'tool-hint', 'and ' + (st.headingCount - shown.length) + ' more'));
    }
    result.appendChild(p);
  }

  function render(r) {
    while (result.firstChild) result.removeChild(result.firstChild);
    if (r.state !== 'found') {
      renderNotFound(r);
    } else {
      renderVerdict(r);
      renderFacts(r);
      renderSections(r);
    }
    result.hidden = false;
  }

  /* ---------------- request ---------------- */

  async function run() {
    var domain = domainInput.value.trim();
    if (!domain) { setStatus('Enter a domain, e.g. example.com.', true); domainInput.focus(); return; }

    var url = '/api/llms-check?domain=' + encodeURIComponent(domain);
    var brand = brandInput.value.trim();
    if (brand) url += '&brand=' + encodeURIComponent(brand);

    button.disabled = true;
    result.hidden = true;
    setStatus('Reading llms.txt…', false);
    try {
      var res = await fetch(url);
      var data = await res.json();
      if (!res.ok || data.error) {
        setStatus(data.error || 'Something went wrong. Please try again.', true);
      } else {
        setStatus('', false);
        render(data);
      }
    } catch (e) {
      setStatus('Couldn’t reach the checker. Check your connection and try again.', true);
    } finally {
      button.disabled = false;
    }
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); run(); });

  document.querySelectorAll('.tool-example').forEach(function (b) {
    b.addEventListener('click', function () {
      domainInput.value = b.getAttribute('data-domain');
      brandInput.value = '';
      run();
    });
  });

  var params = new URLSearchParams(window.location.search);
  if (params.get('domain')) {
    domainInput.value = params.get('domain');
    if (params.get('brand')) brandInput.value = params.get('brand');
    run();
  }
}());
