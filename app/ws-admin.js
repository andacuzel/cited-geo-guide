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
      var btn = el('button', { type: 'button', class: 'btn btn--primary', text: 'Create Fix workspace and scan' });
      btn.addEventListener('click', function () {
        btn.disabled = true; msg('Scanning the site. This takes up to half a minute…');
        call({ action: 'create', type: 'fix', domain: dom.value }).then(function (c) {
          btn.disabled = false;
          if (c.ok) { msg('Created.'); showItem(c.body.id); } else msg(c.body.message || 'Could not create.', true);
        });
      });
      var rows = r.body.workspaces.map(function (w) {
        return el('tr', {}, [
          el('td', { text: w.domain }), el('td', { text: w.type }), el('td', { text: w.status }), el('td', { text: w.score === null ? '' : String(w.score) + '/100' }), el('td', { text: fmt(w.createdAt) }),
          el('td', {}, [el('button', { type: 'button', class: 'btn btn--ghost', text: 'Edit', on: { click: function () { showItem(w.id); } } }), ' ',
            el('a', { class: 'btn btn--ghost', href: '/w/' + w.id, target: '_blank', rel: 'noopener noreferrer', text: 'Client view' })])]);
      });
      shell([
        el('div', { class: 'wsa-create' }, [el('label', { class: 'ps-label', text: 'New workspace' }), dom, btn]),
        rows.length ? el('table', { class: 'wsa-table' }, [el('thead', {}, [el('tr', {}, ['Domain', 'Type', 'Status', 'Score', 'Created', ''].map(function (h) { return el('th', { scope: 'col', text: h }); }))]), el('tbody', {}, rows)]) : el('p', { class: 'ps-note', text: 'No workspaces yet.' })
      ]);
    });
  }

  /* ---------- one workspace ---------- */
  function showItem(id) {
    call({ action: 'get', id: id }).then(function (r) {
      if (!r.ok) { msg(r.body.message || 'Could not load.', true); return showList(); }
      var d = r.body, m = d.meta;
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
