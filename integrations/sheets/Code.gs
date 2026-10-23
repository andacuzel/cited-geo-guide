/* =====================================================================
   Citehound for Google Sheets (a script bound to a spreadsheet). A menu, "Citehound", that scans the domains listed in column A and writes the result in the columns next to each one.

   The key is asked for once (Citehound menu, Set API key) and kept in the user's script properties: it is never written to a cell, a note or a log, and goes only to https://getcitehound.com as a
   Bearer token. Plan limits are honored: before a run the script asks /v1/me for the plan; a free key may scan 5 sites a day, so a run does at most that many and says so, and it stops at the first
   limit, plan or key message from the API and writes that message in the Status column. At most MAX_PER_RUN domains are scanned in one run, so a run stays inside the Apps Script time limit.
   The score is a readiness score: crawler access and on-page signals; it does not measure whether any assistant names a brand.
   ===================================================================== */

var BASE = 'https://getcitehound.com/v1';
var KEY_PROP = 'citehound.key';
var SIGNUP = 'https://getcitehound.com/api';
var MAX_PER_RUN = 25;
var HEADERS = ['Domain', 'Score', 'Discoverability', 'Technical', 'Content and trust', 'Crawlers open', 'Crawlers limited', 'Crawlers blocked', 'First fix', 'Scanned', 'Status'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Citehound')
    .addItem('Set API key', 'setApiKey')
    .addItem('Show my plan', 'showPlan')
    .addItem('Scan the domains in column A', 'scanDomains')
    .addItem('Forget my API key', 'forgetApiKey')
    .addToUi();
}

function redact_(s) { return String(s === undefined || s === null ? '' : s).replace(/chk_[A-Za-z0-9_-]{6,}/g, 'chk_...'); }
// A text from the API never becomes a formula in a cell.
function cell_(v) { if (typeof v !== 'string') return v === undefined || v === null ? '' : v; return /^[=+\-@\t\r]/.test(v) ? "'" + v : v; }
function cleanDomain_(raw) {
  var s = String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[\/?#].*$/, '').replace(/^www\./, '').replace(/\.$/, '');
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$/.test(s) ? s : null;
}

// One call to the API: { ok, status, json, retry }. Returns { status: 0 } if the call itself failed.
function call_(path, qs, key) {
  var q = Object.keys(qs || {}).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(qs[k]); }).join('&');
  try {
    var res = UrlFetchApp.fetch(BASE + path + (q ? '?' + q : ''), { method: 'get', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + key, Accept: 'application/json', 'User-Agent': 'citehound-sheets/0.1.0' } });
    var status = res.getResponseCode(), json = null;
    try { json = JSON.parse(res.getContentText()); } catch (e) { json = null; }
    return { ok: status >= 200 && status < 300, status: status, json: json, retry: res.getHeaders ? (res.getHeaders()['Retry-After'] || null) : null };
  } catch (e) { return { ok: false, status: 0, json: null }; }
}

function message_(r) {
  var m = r.json && typeof r.json.message === 'string' ? redact_(r.json.message) : '';
  if (r.status === 0) return 'Could not reach Citehound. Check the connection and try again.';
  if (r.status === 401) return 'Citehound did not accept the API key. Use Citehound, Set API key (a free one is sent by email at ' + SIGNUP + ').';
  if (r.status === 402) return m || 'That is part of a higher plan. See https://getcitehound.com/pricing.';
  if (r.status === 429) return (m || 'A limit was reached.') + (r.retry ? ' Try again in about ' + r.retry + ' seconds.' : '');
  if (r.status === 503) return 'The Citehound API is not available right now. Try again later.';
  return m || 'Citehound answered with an error (HTTP ' + r.status + ').';
}

function key_() { return PropertiesService.getUserProperties().getProperty(KEY_PROP); }

function setApiKey() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.prompt('Citehound API key', 'Paste your key (it starts with chk_). A free one is sent by email at ' + SIGNUP + '. It is kept in your Google account\'s script properties, not in the sheet.', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  var k = String(answer.getResponseText() || '').trim();
  if (!/^chk_[A-Za-z0-9_-]{20,}$/.test(k)) { ui.alert('That does not look like a Citehound API key. A key starts with chk_.'); return; }
  var r = call_('/me', {}, k);
  if (!r.ok) { ui.alert(message_(r)); return; }
  PropertiesService.getUserProperties().setProperty(KEY_PROP, k);
  ui.alert('The key works. Plan: ' + r.json.plan + '.');
}

function forgetApiKey() { PropertiesService.getUserProperties().deleteProperty(KEY_PROP); SpreadsheetApp.getUi().alert('The key is forgotten.'); }

function showPlan() {
  var ui = SpreadsheetApp.getUi(), k = key_();
  if (!k) { ui.alert('Set your API key first (Citehound menu, Set API key).'); return; }
  var r = call_('/me', {}, k);
  if (!r.ok) { ui.alert(message_(r)); return; }
  var L = r.json.limits;
  ui.alert('Plan: ' + r.json.plan + '\nRequests: ' + L.requests_per_hour + ' an hour, ' + L.requests_per_day + ' a day' + (L.scans_per_day ? '\nScans: ' + L.scans_per_day + ' a day' : '') + '\nUsed today: ' + r.json.usage.today);
}

function scanDomains() {
  var ui = SpreadsheetApp.getUi(), k = key_();
  if (!k) { ui.alert('Set your API key first (Citehound menu, Set API key).'); return; }
  var me = call_('/me', {}, k);
  if (!me.ok) { ui.alert(message_(me)); return; }
  var sheet = SpreadsheetApp.getActiveSheet();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  var last = sheet.getLastRow();
  if (last < 2) { ui.alert('Put one domain in each row of column A, from A2 down, then run this again.'); return; }
  var domains = sheet.getRange(2, 1, last - 1, 1).getValues();
  var cap = Math.min(MAX_PER_RUN, me.json.limits.scans_per_day || MAX_PER_RUN);
  var done = 0, stopped = '', skipped = 0;
  for (var i = 0; i < domains.length; i++) {
    var raw = String(domains[i][0] || '').trim();
    if (!raw) continue;
    var row = i + 2, d = cleanDomain_(raw);
    if (!d) { sheet.getRange(row, 11).setValue('Not a domain. Use a domain such as example.com.'); continue; }
    if (done >= cap) { skipped++; sheet.getRange(row, 11).setValue('Not scanned in this run (' + cap + ' a run for this plan). Run again later.'); continue; }
    var r = call_('/scan', { domain: d }, k);
    if (!r.ok) {
      sheet.getRange(row, 11).setValue(message_(r));
      if ([0, 401, 402, 429, 503].indexOf(r.status) !== -1) { stopped = message_(r); break; }
      continue;
    }
    done++;
    var s = r.json, p = {}; (s.pillars || []).forEach(function (x) { p[x.id] = x.score; });
    var more = s.truncated ? ' (' + s.hidden_findings + ' more findings are on a paid plan)' : '';
    sheet.getRange(row, 1, 1, HEADERS.length).setValues([[s.domain, s.score, p.discover, p.tech, p.trust, s.crawlerSummary.open, s.crawlerSummary.limited, s.crawlerSummary.blocked, cell_(s.failed && s.failed[0] ? s.failed[0].fix : ''), String(s.scannedAt).slice(0, 10), 'OK' + more]]);
    Utilities.sleep(300);
  }
  ui.alert('Scanned ' + done + ' domain' + (done === 1 ? '' : 's') + '.' + (skipped ? ' ' + skipped + ' waiting for the next run.' : '') + (stopped ? '\nStopped: ' + stopped : '') + '\nThe score is a readiness score: crawler access and on-page signals.');
}
