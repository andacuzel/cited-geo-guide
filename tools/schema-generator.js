/* =====================================================================
   Schema Generator — tools/schema-generator.html
   Scans a domain for its real title, description and language
   (/api/site-info), prefills the form, and builds the JSON-LD live with
   lib/schema.js, the same builder the scan report and the MCP server
   use. Values from the scanned site are only ever set as input values or
   text, never as HTML.
   ===================================================================== */

(function () {
  'use strict';

  var S = window.ANSWERABLE_SCHEMA;
  var fieldsEl = document.getElementById('schemaFields');
  if (!S || !fieldsEl) return;

  var $ = function (id) { return document.getElementById(id); };
  var domainInput = $('schemaDomain');
  var scanBtn = $('schemaScanBtn');
  var statusEl = $('schemaStatus');
  var output = $('schemaOutput');
  var metaEl = $('schemaMeta');
  var pasteEl = $('schemaPaste');
  var pickerBtns = Array.prototype.slice.call(document.querySelectorAll('.type-picker__btn'));

  var PASTE = {
    organization: 'Paste the script tag into the head of your homepage. It describes the company and the site once.',
    faqpage: 'Paste the script tag into the head of the page that shows these questions and answers. Only include questions that appear on that page.',
    article: 'Paste the script tag into the head of the article it describes. Use one per article.',
    product: 'Paste the script tag into the head of the product page. Use one per product, with that product’s own price.',
    localbusiness: 'Paste the script tag into the head of the page for this location, usually the homepage or a contact page.'
  };

  var state = {
    type: 'organization',
    domain: '',
    values: {},      // values[type][key] = string
    prefilled: {},   // prefilled[type][key] = true until the user edits it
    faqs: [{ q: '', a: '' }, { q: '', a: '' }],
    hours: {}        // hours[day] = { opens, closes }
  };
  Object.keys(S.TYPES).forEach(function (t) { state.values[t] = {}; state.prefilled[t] = {}; });

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function showToast(message) {
    var toast = $('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    setTimeout(function () { toast.classList.remove('is-visible'); }, 2600);
  }

  function joinList(items, conjunction) {
    if (items.length < 2) return items.join('');
    return items.slice(0, -1).join(', ') + ' ' + conjunction + ' ' + items[items.length - 1];
  }

  function setStatus(text, isError) {
    statusEl.textContent = text || '';
    statusEl.className = 'tool-status' + (isError ? ' is-error' : '');
  }

  // Light client-side tidy so the URL updates as you type; the server
  // normalises again when you scan.
  function cleanDomain(raw) {
    return String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }

  /* ---------------- building the output ---------------- */

  function currentInput() {
    var input = {};
    var vals = state.values[state.type];
    Object.keys(vals).forEach(function (k) { input[k] = vals[k]; });
    input.domain = state.domain;
    if (state.type === 'faqpage') input.faqs = state.faqs;
    if (state.type === 'localbusiness') {
      input.hours = S.DAYS.map(function (d) {
        var h = state.hours[d] || {};
        return { day: d, opens: h.opens || '', closes: h.closes || '' };
      });
    }
    return input;
  }

  function currentSchema() { return S.build(state.type, currentInput()); }

  function updateOutput() {
    var obj = currentSchema();
    output.textContent = S.toScriptTag(obj);

    var n = S.countPlaceholders(obj);
    metaEl.textContent = n === 0
      ? 'No placeholders left. Check the values once more, then publish.'
      : n + ' placeholder' + (n === 1 ? '' : 's') + ' left. Replace each bracketed value before you publish.';
    pasteEl.textContent = PASTE[state.type];
  }

  /* ---------------- the form ---------------- */

  function tagFor(type, key, wrap) {
    var tag = el('span', 'sf-tag', state.prefilled[type][key] ? 'from ' + (state.domain || 'your site') : '');
    wrap.appendChild(tag);
    return tag;
  }

  function simpleField(def) {
    var type = state.type;
    var wrap = el('div', 'sf-field');
    var head = el('div', 'sf-field__head');
    var label = el('label', 'tool-label', def.label);
    var id = 'sf-' + def.key;
    label.setAttribute('for', id);
    head.appendChild(label);
    var tag = tagFor(type, def.key, head);
    wrap.appendChild(head);

    var input;
    if (def.kind === 'textarea') {
      input = el('textarea', 'field');
      input.rows = 3;
    } else if (def.kind === 'availability') {
      input = el('select', 'field');
      var blank = el('option', null, 'Choose availability');
      blank.value = '';
      input.appendChild(blank);
      S.AVAILABILITY.forEach(function (o) {
        var opt = el('option', null, o.label);
        opt.value = o.value;
        input.appendChild(opt);
      });
    } else {
      input = el('input', 'field');
      input.type = 'text';
      input.autocomplete = 'off';
    }
    input.id = id;
    if (def.kind !== 'availability') input.placeholder = def.ph || '';
    input.value = state.values[type][def.key] || '';

    var onChange = function () {
      state.values[type][def.key] = input.value;
      if (state.prefilled[type][def.key]) {
        delete state.prefilled[type][def.key];
        tag.textContent = '';
      }
      updateOutput();
    };
    input.addEventListener('input', onChange);
    input.addEventListener('change', onChange);
    wrap.appendChild(input);
    return wrap;
  }

  function faqField() {
    var wrap = el('div', 'sf-field');
    wrap.appendChild(el('span', 'tool-label', 'Questions and answers'));

    state.faqs.forEach(function (row, i) {
      var box = el('div', 'sf-faq');
      var q = el('input', 'field');
      q.type = 'text';
      q.placeholder = S.PLACEHOLDERS.question;
      q.value = row.q;
      q.setAttribute('aria-label', 'Question ' + (i + 1));
      q.addEventListener('input', function () { row.q = q.value; updateOutput(); });
      var a = el('textarea', 'field');
      a.rows = 3;
      a.placeholder = S.PLACEHOLDERS.answer;
      a.value = row.a;
      a.setAttribute('aria-label', 'Answer ' + (i + 1));
      a.addEventListener('input', function () { row.a = a.value; updateOutput(); });
      box.appendChild(q);
      box.appendChild(a);
      if (state.faqs.length > 1) {
        var rm = el('button', 'sf-faq__remove', 'Remove question ' + (i + 1));
        rm.type = 'button';
        rm.addEventListener('click', function () { state.faqs.splice(i, 1); renderFields(); updateOutput(); });
        box.appendChild(rm);
      }
      wrap.appendChild(box);
    });

    var add = el('button', 'btn btn--ghost sf-add', 'Add a question');
    add.type = 'button';
    add.addEventListener('click', function () { state.faqs.push({ q: '', a: '' }); renderFields(); updateOutput(); });
    wrap.appendChild(add);
    return wrap;
  }

  function hoursField() {
    var wrap = el('div', 'sf-field');
    wrap.appendChild(el('span', 'tool-label', 'Opening hours'));
    var grid = el('div', 'sf-hours');
    S.DAYS.forEach(function (day) {
      var h = state.hours[day] || (state.hours[day] = { opens: '', closes: '' });
      grid.appendChild(el('span', 'sf-hours__day', day));
      ['opens', 'closes'].forEach(function (k) {
        var t = el('input', 'field');
        t.type = 'time';
        t.value = h[k];
        t.setAttribute('aria-label', day + ' ' + k);
        t.addEventListener('input', function () { h[k] = t.value; updateOutput(); });
        grid.appendChild(t);
      });
    });
    wrap.appendChild(grid);
    wrap.appendChild(el('p', 'tool-hint', 'Leave a day empty if the business is closed or you are unsure. Days with the same hours are grouped.'));
    return wrap;
  }

  function renderFields() {
    while (fieldsEl.firstChild) fieldsEl.removeChild(fieldsEl.firstChild);
    S.FIELDS[state.type].forEach(function (def) {
      if (def.kind === 'faqs') fieldsEl.appendChild(faqField());
      else if (def.kind === 'hours') fieldsEl.appendChild(hoursField());
      else fieldsEl.appendChild(simpleField(def));
    });
  }

  function setType(type) {
    state.type = type;
    pickerBtns.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-type') === type ? 'true' : 'false'); });
    renderFields();
    updateOutput();
  }

  /* ---------------- scanning ---------------- */

  function applySite(data) {
    var site = { title: data.title, metaDesc: data.description, lang: data.lang };
    Object.keys(S.TYPES).forEach(function (type) {
      var pre = S.inputFromSite(type, site);
      Object.keys(pre).forEach(function (key) {
        if (pre[key] && !state.values[type][key]) {
          state.values[type][key] = pre[key];
          state.prefilled[type][key] = true;
        }
      });
    });
  }

  async function scan() {
    var raw = domainInput.value.trim();
    if (!raw) { setStatus('Enter a domain, e.g. example.com.', true); domainInput.focus(); return; }

    scanBtn.disabled = true;
    setStatus('Reading the homepage…', false);
    try {
      var res = await fetch('/api/site-info?domain=' + encodeURIComponent(raw));
      var data = await res.json();
      if (!res.ok || data.error) {
        setStatus(data.error || 'Something went wrong. You can still fill the form in by hand.', true);
        return;
      }
      state.domain = data.domain;
      domainInput.value = data.domain;
      applySite(data);

      var found = [];
      if (data.title) found.push('a title');
      if (data.description) found.push('a description');
      if (data.lang) found.push('a language tag');
      var missing = [];
      if (!data.title) missing.push('title');
      if (!data.description) missing.push('description');
      if (!data.lang) missing.push('language');
      setStatus('Found ' + (found.length ? joinList(found, 'and') : 'nothing usable') + ' on ' + data.domain + '.' +
        (missing.length
          ? ' No ' + joinList(missing, 'or') + ', so ' + (missing.length === 1 ? 'that stays a placeholder.' : 'those stay placeholders.')
          : ' Edit anything that is not quite right.'), false);

      renderFields();
      updateOutput();
    } catch (e) {
      setStatus('Couldn’t reach the scanner. You can still fill the form in by hand.', true);
    } finally {
      scanBtn.disabled = false;
    }
  }

  /* ---------------- copy and download ---------------- */

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return Promise.reject(new Error('no clipboard'));
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  $('schemaCopyBtn').addEventListener('click', function () {
    var text = output.textContent;
    copyText(text).then(function () {
      showToast('JSON-LD copied — paste it into your page.');
    }, function () {
      showToast(fallbackCopy(text) ? 'JSON-LD copied — paste it into your page.' : 'Copy failed. Select the text and copy it by hand.');
    });
  });

  $('schemaDownloadBtn').addEventListener('click', function () {
    var json = JSON.stringify(currentSchema(), null, 2);
    var blob = new Blob([json], { type: 'application/ld+json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (state.domain ? state.domain + '-' : '') + state.type + '.jsonld';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  /* ---------------- wiring ---------------- */

  $('schemaForm').addEventListener('submit', function (e) { e.preventDefault(); scan(); });
  domainInput.addEventListener('input', function () {
    state.domain = cleanDomain(domainInput.value);
    updateOutput();
  });
  pickerBtns.forEach(function (b) {
    b.addEventListener('click', function () { setType(b.getAttribute('data-type')); });
  });

  var params = new URLSearchParams(window.location.search);
  var qType = params.get('type');
  if (qType && S.TYPES[qType]) state.type = qType;
  pickerBtns.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-type') === state.type ? 'true' : 'false'); });
  renderFields();
  updateOutput();

  if (params.get('domain')) {
    domainInput.value = params.get('domain');
    state.domain = cleanDomain(domainInput.value);
    updateOutput();
    scan();
  }
}());
