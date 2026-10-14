/* =====================================================================
   app/ws-admin.js: the admin page (/admin/ws). Sign-in, the workspace list, create, edit.

   Everything from the server is put into the page as text (textContent), never as HTML, so nothing an admin or a client typed can run here. Requests are
   same-origin JSON to /api/pro/wsadminapi with the session cookie; the token is sent once, to /api/pro/wsadminlogin, and kept nowhere.
   ===================================================================== */
(function () {
  'use strict';

  function el(tag, props, kids) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'text') e.textContent = props[k];
      else if (k === 'class') e.className = props[k];
      else if (k === 'on') Object.keys(props.on).forEach(function (ev) { e.addEventListener(ev, props.on[ev]); });
      else e.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function api(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin', body: JSON.stringify(body) })
      .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, status: res.status, body: j }; }, function () { return { ok: false, status: res.status, body: {} }; }); });
  }
  var call = function (body) { return api('/api/pro/wsadminapi', body); };

  /* ---------- sign-in ---------- */
  var form = document.getElementById('wsLogin');
  if (form) {
    var st = document.getElementById('wsLoginStatus');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      st.textContent = '';
      api('/api/pro/wsadminlogin', { token: document.getElementById('wsToken').value }).then(function (r) {
        document.getElementById('wsToken').value = '';
        if (r.ok) location.reload(); else st.textContent = r.body.message || 'Could not sign in.';
      });
    });
    return;
  }

  var host = document.getElementById('wsAdmin');
  if (!host) return;
  var STATUS = { todo: 'To do', in_progress: 'In progress', applied: 'Applied', verified: 'Verified' };

  function msg(text, bad) { var m = document.getElementById('wsaMsg'); if (m) { m.textContent = text; m.className = 'wsa-msg' + (bad ? ' wsa-msg--bad' : ''); } }
  function fmt(iso) { try { return new Date(iso).toISOString().slice(0, 10); } catch (e) { return ''; } }

  function shell(children) {
    host.textContent = '';
    host.appendChild(el('p', { class: 'wsa-top' }, [
      el('button', { type: 'button', class: 'btn btn--ghost', text: 'Sign out', on: { click: function () { call({ action: 'logout' }).then(function () { location.reload(); }); } } })]));
    host.appendChild(el('p', { id: 'wsaMsg', class: 'wsa-msg', role: 'status', 'aria-live': 'polite' }));
    children.forEach(function (c) { host.appendChild(c); });
  }

  /* ---------- list and create ---------- */
  function showList() {
    call({ action: 'list' }).then(function (r) {
      if (!r.ok) { host.textContent = r.body.message || 'Could not load.'; return; }
      var dom = el('input', { class: 'field ps-input', type: 'text', placeholder: 'example.com', 'aria-label': 'Domain', autocomplete: 'off', spellcheck: 'false' });
      var typeSel = el('select', { class: 'field ps-input', 'aria-label': 'Type' }, [el('option', { value: 'fix', text: 'Fix' }), el('option', { value: 'beyond', text: 'Beyond' })]);
      var btn = el('button', { type: 'button', class: 'btn btn--primary', text: 'Create workspace and scan' });
      btn.addEventListener('click', function () {
        btn.disabled = true; msg('Scanning the site. This takes up to half a minute…');
        call({ action: 'create', type: typeSel.value, domain: dom.value }).then(function (c) {
          btn.disabled = false;
          if (c.ok) { msg('Created.'); showItem(c.body.id); } else msg(c.body.message || 'Could not create.', true);
        });
      });
      var rows = r.body.workspaces.map(function (w) {
        return el('tr', {}, [
          el('td', { text: w.domain }), el('td', { text: w.type }), el('td', { text: w.status + (w.review ? ' · ' + w.review + ' in review' : '') }), el('td', { text: w.score === null ? '' : String(w.score) + '/100' }), el('td', { text: fmt(w.createdAt) }),
          el('td', {}, [el('button', { type: 'button', class: 'btn btn--ghost', text: 'Edit', on: { click: function () { showItem(w.id); } } }), ' ',
            el('a', { class: 'btn btn--ghost', href: '/w/' + w.id, target: '_blank', rel: 'noopener noreferrer', text: 'Client view' })])]);
      });
      shell([
        el('div', { class: 'wsa-create' }, [el('label', { class: 'ps-label', text: 'New workspace' }), dom, typeSel, btn]),
        rows.length ? el('table', { class: 'wsa-table' }, [el('thead', {}, [el('tr', {}, ['Domain', 'Type', 'Status', 'Score', 'Created', ''].map(function (h) { return el('th', { scope: 'col', text: h }); }))]), el('tbody', {}, rows)]) : el('p', { class: 'ps-note', text: 'No workspaces yet.' })
      ]);
    });
  }

  /* ---------- one workspace ---------- */
  function showItem(id) {
    call({ action: 'get', id: id }).then(function (r) {
      if (!r.ok) { msg(r.body.message || 'Could not load.', true); return showList(); }
      var d = r.body, m = d.meta;
      if (m.type === 'beyond') return showBeyond(d);
      var head = el('div', { class: 'wsa-head' }, [
        el('button', { type: 'button', class: 'btn btn--ghost', text: 'All workspaces', on: { click: showList } }),
        el('h2', { class: 'wsa-h', text: m.domain + ' · ' + m.type + (m.status === 'archived' ? ' · archived' : '') }),
        el('p', { class: 'ps-note', text: 'Score ' + (d.score === null ? 'n/a' : d.score + '/100') + ' · created ' + fmt(m.createdAt) })]);
      var link = el('p', {}, [el('a', { class: 'btn btn--primary', href: '/w/' + m.id, target: '_blank', rel: 'noopener noreferrer', text: 'Open the client view' }), ' ',
        el('button', { type: 'button', class: 'btn btn--ghost', text: 'Copy client link', on: { click: function () { var u = location.origin + '/w/' + m.id; (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { msg('Link copied. It is the client\'s whole access: send it only to them.'); }, function () { msg(u); }); } } }), ' ',
        el('button', { type: 'button', class: 'btn btn--ghost', text: 'Rescan', on: { click: function () { msg('Scanning…'); call({ action: 'rescan', id: m.id }).then(function (x) { if (x.ok) { msg('Rescanned. Score ' + x.body.score + '/100.'); showItem(m.id); } else msg(x.body.message || 'Could not rescan.', true); }); } } }), ' ',
        el('button', { type: 'button', class: 'btn btn--ghost', text: m.status === 'archived' ? 'Unarchive' : 'Archive', on: { click: function () { call({ action: 'archive', id: m.id, on: m.status !== 'archived' }).then(function () { showItem(m.id); }); } } })]);
      var pro = el('div', { class: 'wsa-pro' }, []);
      var proIn = el('input', { class: 'field ps-input', type: 'text', value: m.proJobId || '', placeholder: 'Pro report id (32 characters), or empty', 'aria-label': 'Pro report id', autocomplete: 'off', spellcheck: 'false' });
      pro.appendChild(el('label', { class: 'ps-label', text: 'Citehound Pro report (shown as "Included")' }));
      pro.appendChild(proIn);
      pro.appendChild(el('button', { type: 'button', class: 'btn btn--ghost', text: 'Save', on: { click: function () { call({ action: 'setPro', id: m.id, proJobId: proIn.value }).then(function (x) { msg(x.ok ? 'Saved.' : (x.body.message || 'Could not save.'), !x.ok); }); } } }));
      var list = el('div', { class: 'wsa-items' }, d.items.map(function (i) { return itemEditor(m.id, i, d.statuses); }));
      var add = addForm(m.id);
      shell([head, link, pro, el('h3', { class: 'wsa-h', text: 'Fix list' }), list, add]);
    });
  }

  /* ---------- a Beyond workspace ---------- */
  function actions(m) {
    return el('p', {}, [el('a', { class: 'btn btn--primary', href: '/w/' + m.id, target: '_blank', rel: 'noopener noreferrer', text: 'Open the client view' }), ' ',
      el('button', { type: 'button', class: 'btn btn--ghost', text: 'Copy client link', on: { click: function () { var u = location.origin + '/w/' + m.id; (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { msg('Link copied. It is the client\'s whole access: send it only to them.'); }, function () { msg(u); }); } } }), ' ',
      el('button', { type: 'button', class: 'btn btn--ghost', text: 'Rescan (adds this month\'s score)', on: { click: function () { msg('Scanning…'); call({ action: 'rescan', id: m.id }).then(function (x) { if (x.ok) { msg('Rescanned. Score ' + x.body.score + '/100.'); showItem(m.id); } else msg(x.body.message || 'Could not rescan.', true); }); } } }), ' ',
      el('button', { type: 'button', class: 'btn btn--ghost', text: m.status === 'archived' ? 'Unarchive' : 'Archive', on: { click: function () { call({ action: 'archive', id: m.id, on: m.status !== 'archived' }).then(function () { showItem(m.id); }); } } })]);
  }
  function proBox(m) {
    var proIn = el('input', { class: 'field ps-input', type: 'text', value: m.proJobId || '', placeholder: 'Pro report id (32 characters), or empty', 'aria-label': 'Pro report id', autocomplete: 'off', spellcheck: 'false' });
    return el('div', { class: 'wsa-pro' }, [el('label', { class: 'ps-label', text: 'Citehound Pro report (shown as "Included")' }), proIn,
      el('button', { type: 'button', class: 'btn btn--ghost', text: 'Save', on: { click: function () { call({ action: 'setPro', id: m.id, proJobId: proIn.value }).then(function (x) { msg(x.ok ? 'Saved.' : (x.body.message || 'Could not save.'), !x.ok); }); } } })]);
  }
  function saved(id) { return function (x) { if (x.ok) { msg('Saved.'); showItem(id); } else msg(x.body.message || 'Could not save.', true); }; }

  function showBeyond(d) {
    var m = d.meta, id = m.id;
    var head = el('div', { class: 'wsa-head' }, [
      el('button', { type: 'button', class: 'btn btn--ghost', text: 'All workspaces', on: { click: showList } }),
      el('h2', { class: 'wsa-h', text: m.domain + ' · beyond' + (m.status === 'archived' ? ' · archived' : '') }),
      el('p', { class: 'ps-note', text: 'Readiness score ' + (d.score === null ? 'n/a' : d.score + '/100') + ' · created ' + fmt(m.createdAt) })]);

    // Questions: one per line
    var qa = el('textarea', { class: 'field ps-input', rows: '8', 'aria-label': 'Questions, one per line' });
    qa.value = d.questions.map(function (q) { return q.text; }).join('\n');
    var vsel = el('select', { class: 'field ps-input', 'aria-label': 'Category question set' }, d.verticals.map(function (v) { return el('option', { value: v, text: v }); }));
    var questions = el('div', { class: 'wsa-block' }, [el('h3', { class: 'wsa-h', text: 'Questions' }),
      el('p', { class: 'ps-note', text: 'One question per line, at least 8 characters each. Import the ones the linked Pro report wrote, or start from a category set, then edit.' }), qa,
      el('p', {}, [el('button', { type: 'button', class: 'btn btn--ghost', text: 'Save questions', on: { click: function () { call({ action: 'setQuestions', id: id, questions: qa.value.split('\n') }).then(saved(id)); } } }), ' ',
        el('button', { type: 'button', class: 'btn btn--ghost', text: 'Import from the Pro report', on: { click: function () { call({ action: 'importQuestions', id: id }).then(saved(id)); } } })]),
      el('p', {}, [vsel, ' ', el('button', { type: 'button', class: 'btn btn--ghost', text: 'Use this set', on: { click: function () { call({ action: 'seedQuestions', id: id, vertical: vsel.value }).then(saved(id)); } } })])]);

    // Gaps: rows
    var gapRows = [];
    var gapBox = el('div', { class: 'wsa-gaps' }, []);
    function gapRow(g) {
      var q = el('input', { class: 'field ps-input', type: 'text', maxlength: '200', 'aria-label': 'Question', placeholder: 'Question' }); q.value = g.question || '';
      var pg = el('input', { class: 'field ps-input', type: 'text', maxlength: '120', 'aria-label': 'Page', placeholder: 'Page, e.g. /pricing' }); pg.value = g.page || '';
      var nt = el('input', { class: 'field ps-input', type: 'text', maxlength: '300', 'aria-label': 'Gap note', placeholder: 'What is missing' }); nt.value = g.note || '';
      var pr = el('select', { class: 'field ps-input', 'aria-label': 'Priority' }, d.priorities.map(function (p) { var o = el('option', { value: p, text: p }); if (p === (g.priority || 'medium')) o.selected = true; return o; }));
      var row = { q: q, pg: pg, nt: nt, pr: pr, gone: false };
      var box = el('div', { class: 'wsa-gap' }, [q, pg, nt, pr, el('button', { type: 'button', class: 'btn btn--ghost', text: 'Remove', on: { click: function () { row.gone = true; box.hidden = true; } } })]);
      gapRows.push(row); gapBox.appendChild(box);
    }
    d.gaps.forEach(gapRow);
    var gaps = el('div', { class: 'wsa-block' }, [el('h3', { class: 'wsa-h', text: 'Gaps' }), gapBox,
      el('p', {}, [el('button', { type: 'button', class: 'btn btn--ghost', text: 'Add a gap', on: { click: function () { gapRow({}); } } }), ' ',
        el('button', { type: 'button', class: 'btn btn--primary', text: 'Save gaps', on: { click: function () { call({ action: 'setGaps', id: id, gaps: gapRows.filter(function (r) { return !r.gone; }).map(function (r) { return { question: r.q.value, page: r.pg.value, note: r.nt.value, priority: r.pr.value }; }) }).then(saved(id)); } } })])]);

    // Content
    var pieces = d.pieces.map(function (p) {
      var title = el('input', { class: 'field ps-input', type: 'text', maxlength: '120', 'aria-label': 'Title' }); title.value = p.title;
      var type = el('select', { class: 'field ps-input', 'aria-label': 'Type' }, d.types.map(function (t) { var o = el('option', { value: t, text: t }); if (t === p.type) o.selected = true; return o; }));
      var body = el('textarea', { class: 'field ps-input', rows: '10', 'aria-label': 'Text (markdown)', maxlength: '20000' }); body.value = p.body;
      var statuses = d.adminStatuses.slice(); if (statuses.indexOf(p.status) === -1) statuses.push(p.status);
      var st = el('select', { class: 'field ps-input', 'aria-label': 'Status' }, statuses.map(function (s2) { var o = el('option', { value: s2, text: s2.replace('_', ' ') }); if (s2 === p.status) o.selected = true; if (s2 === 'approved') o.disabled = true; return o; }));
      var note = el('textarea', { class: 'field ps-input', rows: '2', maxlength: '1000', 'aria-label': 'Note to the client', placeholder: 'A note the client sees under this piece' });
      var cms = (p.comments || []).map(function (c) { return el('li', { class: 'wsa-cm wsa-cm--' + c.by }, [el('b', { text: (c.by === 'client' ? 'Client' : 'Citehound') + ' · ' + c.kind + ' · ' + fmt(c.at) }), c.text ? el('span', { text: ' ' + c.text }) : '']); });
      return el('div', { class: 'wsa-item' }, [
        el('p', { class: 'wsa-item__t' }, [el('b', { text: p.title }), ' · ' + p.status.replace('_', ' ') + ' · v' + p.version]),
        cms.length ? el('ul', { class: 'wsa-cms' }, cms) : '',
        el('div', { class: 'wsa-item__row' }, [title, type]), body,
        el('p', { class: 'ps-note', text: 'Markdown: **bold**, lists, `code`, [links](https://…). Raw HTML is shown as text. Editing an approved or published piece sends it back to review.' }),
        el('p', {}, [el('button', { type: 'button', class: 'btn btn--ghost', text: 'Save text', on: { click: function () { call({ action: 'editPiece', id: id, cid: p.id, title: title.value, type: type.value, body: body.value }).then(saved(id)); } } }), ' ', st, ' ',
          el('button', { type: 'button', class: 'btn btn--ghost', text: 'Set status', on: { click: function () { call({ action: 'setPieceStatus', id: id, cid: p.id, status: st.value }).then(saved(id)); } } })]),
        note, el('p', {}, [el('button', { type: 'button', class: 'btn btn--ghost', text: 'Add note', on: { click: function () { call({ action: 'notePiece', id: id, cid: p.id, text: note.value }).then(saved(id)); } } }), ' ',
          el('button', { type: 'button', class: 'btn btn--ghost', text: 'Remove piece', on: { click: function () { call({ action: 'removePiece', id: id, cid: p.id }).then(saved(id)); } } })])]);
    });
    var nTitle = el('input', { class: 'field ps-input', type: 'text', maxlength: '120', 'aria-label': 'New piece title', placeholder: 'Title of a new piece' });
    var nType = el('select', { class: 'field ps-input', 'aria-label': 'New piece type' }, d.types.map(function (t) { return el('option', { value: t, text: t }); }));
    var nBody = el('textarea', { class: 'field ps-input', rows: '6', maxlength: '20000', 'aria-label': 'New piece text (markdown)' });
    var content = el('div', { class: 'wsa-block' }, [el('h3', { class: 'wsa-h', text: 'Content' })].concat(pieces, [
      el('div', { class: 'wsa-add' }, [el('h3', { class: 'wsa-h', text: 'Add a piece' }), nTitle, nType, nBody,
        el('button', { type: 'button', class: 'btn btn--ghost', text: 'Add as draft', on: { click: function () { call({ action: 'addPiece', id: id, title: nTitle.value, type: nType.value, body: nBody.value }).then(saved(id)); } } })])]));

    // Monthly
    var mo = d.months.map(function (x) {
      return el('li', {}, [x.month + ': named in ' + x.named + ' of ' + x.asked + (x.model ? ' (' + x.model + ')' : '') + (x.note ? ' · ' + x.note : '') + ' ', el('button', { type: 'button', class: 'btn btn--ghost', text: 'Remove', on: { click: function () { call({ action: 'removeMonth', id: id, month: x.month }).then(saved(id)); } } })]);
    });
    var mm = el('input', { class: 'field ps-input', type: 'text', placeholder: 'Month, 2026-09', 'aria-label': 'Month', maxlength: '7' });
    var mn = el('input', { class: 'field ps-input', type: 'number', min: '0', max: '99', placeholder: 'Named in', 'aria-label': 'Questions that named the brand' });
    var ma = el('input', { class: 'field ps-input', type: 'number', min: '1', max: '99', placeholder: 'Questions asked', 'aria-label': 'Questions asked' });
    var mmod = el('input', { class: 'field ps-input', type: 'text', maxlength: '40', placeholder: 'Assistant and model', 'aria-label': 'Model' });
    var mnote = el('input', { class: 'field ps-input', type: 'text', maxlength: '300', placeholder: 'A note (optional)', 'aria-label': 'Month note' });
    var monthly = el('div', { class: 'wsa-block' }, [el('h3', { class: 'wsa-h', text: 'Monthly citation checks (pilot)' }),
      el('p', { class: 'ps-note', text: 'Enter a month\'s citation-check result only when a run was made. The score of each month comes from the scans (Rescan).' }),
      mo.length ? el('ul', {}, mo) : el('p', { class: 'ps-note', text: 'None entered. The client sees "Not run this month".' }),
      el('div', { class: 'wsa-add' }, [mm, mn, ma, mmod, mnote, el('button', { type: 'button', class: 'btn btn--ghost', text: 'Save the month', on: { click: function () { call({ action: 'setMonth', id: id, month: mm.value, named: mn.value, asked: ma.value, model: mmod.value, note: mnote.value }).then(saved(id)); } } })])]);

    shell([head, actions(m), proBox(m), questions, gaps, content, monthly]);
  }


  function itemEditor(id, i, statuses) {
    var sel = el('select', { class: 'field ps-input', 'aria-label': 'Status of ' + i.label }, statuses.filter(function (s) { return s !== 'verified' || i.status === 'verified'; }).map(function (s) { var o = el('option', { value: s, text: STATUS[s] || s }); if (s === i.status) o.selected = true; return o; }));
    var note = el('textarea', { class: 'field ps-input', rows: '3', 'aria-label': 'Note for ' + i.label, maxlength: '4000' });
    note.value = i.note || '';
    var box = el('div', { class: 'wsa-item' }, [
      el('p', { class: 'wsa-item__t' }, [el('b', { text: i.label }), ' ' + (i.max ? '(' + i.max + ' points)' : '(custom)')]),
      el('div', { class: 'wsa-item__row' }, [sel, note]),
      el('p', { class: 'ps-note', text: 'The note accepts markdown: **bold**, lists, `code`, [links](https://…). Raw HTML is shown as text.' }),
      el('p', {}, [
        el('button', { type: 'button', class: 'btn btn--ghost', text: 'Save', on: { click: function () {
          var patch = { action: 'setItem', id: id, key: i.key, note: note.value };
          if (i.status !== 'verified') patch.status = sel.value;
          call(patch).then(function (x) { msg(x.ok ? 'Saved.' : (x.body.message || 'Could not save.'), !x.ok); });
        } } }),
        /^x-/.test(i.key) ? ' ' : '', /^x-/.test(i.key) ? el('button', { type: 'button', class: 'btn btn--ghost', text: 'Remove', on: { click: function () { call({ action: 'removeItem', id: id, key: i.key }).then(function () { showItem(id); }); } } }) : ''])]);
    return box;
  }

  function addForm(id) {
    var label = el('input', { class: 'field ps-input', type: 'text', maxlength: '120', 'aria-label': 'New item label', placeholder: 'A custom item (no check behind it)' });
    var advice = el('input', { class: 'field ps-input', type: 'text', maxlength: '300', 'aria-label': 'New item advice', placeholder: 'What to do (optional)' });
    return el('div', { class: 'wsa-add' }, [el('h3', { class: 'wsa-h', text: 'Add an item' }), label, advice,
      el('button', { type: 'button', class: 'btn btn--ghost', text: 'Add', on: { click: function () { call({ action: 'addItem', id: id, label: label.value, advice: advice.value }).then(function (x) { if (x.ok) showItem(id); else msg(x.body.message || 'Could not add.', true); }); } } })]);
  }

  showList();
}());
