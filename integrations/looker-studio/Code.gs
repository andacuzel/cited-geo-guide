/* =====================================================================
   Citehound community connector for Looker Studio (Google Apps Script).

   Three sources, chosen in the configuration:
     scan     one row per domain, from /v1/scan (all plans; a free key shows the first three findings and may scan 5 sites a day)
     history  one row per stored scan of a watched domain, from /v1/history (Pro, Fix and Beyond)
     events   one row per monitoring event, from /v1/events (Pro, Fix and Beyond)
   The key is typed once in the connector's authentication screen and kept by Looker Studio in the user's properties; it is sent only to https://getcitehound.com as a Bearer token and is never
   in a configuration, a field or an error message. A dashboard refresh calls getData again and again, so every answer is cached for 6 hours (the longest Apps Script allows) and a refresh does
   not scan a site again. The score is a readiness score: crawler access and on-page signals; it does not measure whether any assistant names a brand.
   ===================================================================== */

var cc = DataStudioApp.createCommunityConnector();
var BASE = 'https://getcitehound.com/v1';
var KEY_PROP = 'dscc.key';
var CACHE_SECONDS = 21600;
var MAX_DOMAINS = 10;
var SIGNUP = 'https://getcitehound.com/api';

/* ---------- authentication ---------- */

function getAuthType() {
  return cc.newAuthTypeResponse().setAuthType(cc.AuthType.KEY).setHelpUrl(SIGNUP).build();
}

function isAuthValid() {
  var key = PropertiesService.getUserProperties().getProperty(KEY_PROP);
  return !!key && /^chk_[A-Za-z0-9_-]{20,}$/.test(key) && fetchJson_('/me', {}, key).ok;
}

function setCredentials(request) {
  var key = String((request && request.key) || '').trim();
  if (!/^chk_[A-Za-z0-9_-]{20,}$/.test(key)) return { errorCode: 'INVALID_CREDENTIALS' };
  var r = fetchJson_('/me', {}, key);
  if (!r.ok) return { errorCode: 'INVALID_CREDENTIALS' };
  PropertiesService.getUserProperties().setProperty(KEY_PROP, key);
  return { errorCode: 'NONE' };
}

function resetAuth() { PropertiesService.getUserProperties().deleteProperty(KEY_PROP); }
function isAdminUser() { return false; }

/* ---------- configuration and fields ---------- */

function getConfig(request) {
  var config = cc.getConfig();
  config.newInfo().setId('about').setText('Scan domains for AI readiness, or chart the history and events of domains you watch. History and events need a Pro, Fix or Beyond key. The score does not measure whether any assistant names a brand.');
  var source = config.newSelectSingle().setId('source').setName('Data').setHelpText('What each row is').setAllowOverride(false);
  source.addOption(config.newOptionBuilder().setLabel('Scan: one row per domain').setValue('scan'));
  source.addOption(config.newOptionBuilder().setLabel('History: one row per stored scan (Pro, Fix, Beyond)').setValue('history'));
  source.addOption(config.newOptionBuilder().setLabel('Events: one row per event (Pro, Fix, Beyond)').setValue('events'));
  config.newTextInput().setId('domains').setName('Domains').setHelpText('Comma-separated, up to ' + MAX_DOMAINS + ', for example example.com, example.org. For events, leave empty for all watched domains.').setPlaceholder('example.com').setAllowOverride(true);
  config.setDateRangeRequired(false);
  return config.build();
}

function getFields(source) {
  var fields = cc.getFields(), types = cc.FieldType, aggr = cc.AggregationType;
  if (source === 'events') {
    fields.newDimension().setId('event_id').setName('Event id').setType(types.TEXT);
    fields.newDimension().setId('at').setName('Time').setType(types.YEAR_MONTH_DAY_HOUR);
    fields.newDimension().setId('domain').setName('Domain').setType(types.TEXT);
    fields.newDimension().setId('type').setName('Event type').setType(types.TEXT);
    fields.newDimension().setId('summary').setName('What changed').setType(types.TEXT);
    fields.newMetric().setId('count').setName('Events').setType(types.NUMBER).setAggregation(aggr.SUM);
    return fields;
  }
  fields.newDimension().setId('domain').setName('Domain').setType(types.TEXT);
  fields.newDimension().setId(source === 'history' ? 'scanned_at' : 'scanned_on').setName('Scanned').setType(source === 'history' ? types.YEAR_MONTH_DAY_HOUR : types.YEAR_MONTH_DAY);
  fields.newMetric().setId('score').setName('Readiness score').setType(types.NUMBER).setAggregation(aggr.AVG);
  if (source === 'scan') {
    fields.newMetric().setId('discoverability').setName('Discoverability').setType(types.NUMBER).setAggregation(aggr.AVG);
    fields.newMetric().setId('technical').setName('Technical foundation').setType(types.NUMBER).setAggregation(aggr.AVG);
    fields.newMetric().setId('content_trust').setName('Content and trust').setType(types.NUMBER).setAggregation(aggr.AVG);
    fields.newMetric().setId('crawlers_open').setName('Crawlers open').setType(types.NUMBER).setAggregation(aggr.AVG);
    fields.newMetric().setId('crawlers_limited').setName('Crawlers limited').setType(types.NUMBER).setAggregation(aggr.AVG);
    fields.newMetric().setId('findings_shown').setName('Findings shown').setType(types.NUMBER).setAggregation(aggr.AVG);
    fields.newDimension().setId('top_fix').setName('First fix').setType(types.TEXT);
  } else {
    fields.newMetric().setId('failed_checks').setName('Checks failing').setType(types.NUMBER).setAggregation(aggr.AVG);
  }
  fields.newMetric().setId('crawlers_blocked').setName('Crawlers blocked').setType(types.NUMBER).setAggregation(aggr.AVG);
  if (source === 'history') {
    fields.newDimension().setId('llms_txt').setName('llms.txt found').setType(types.BOOLEAN);
    fields.newDimension().setId('json_ld').setName('JSON-LD found').setType(types.BOOLEAN);
  }
  return fields;
}

function getSchema(request) {
  var source = (request.configParams && request.configParams.source) || 'scan';
  return { schema: getFields(source).build() };
}

/* ---------- data ---------- */

// A key is never shown: anything that looks like one is cut down in every message.
function redact_(s) { return String(s || '').replace(/chk_[A-Za-z0-9_-]{6,}/g, 'chk_...'); }

function userError_(text, debug) {
  cc.newUserError().setText(redact_(text)).setDebugText(redact_(debug)).throwException();
}

// One call to the API: { ok, status, json }. The key comes from the user's properties unless given (the authentication check).
function fetchJson_(path, qs, keyOverride) {
  var key = keyOverride || PropertiesService.getUserProperties().getProperty(KEY_PROP);
  var q = Object.keys(qs || {}).filter(function (k) { return qs[k] !== undefined && qs[k] !== ''; }).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(qs[k]); }).join('&');
  var res = UrlFetchApp.fetch(BASE + path + (q ? '?' + q : ''), { method: 'get', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + key, Accept: 'application/json', 'User-Agent': 'citehound-looker-studio/0.1.0' } });
  var status = res.getResponseCode(), json = null;
  try { json = JSON.parse(res.getContentText()); } catch (e) { json = null; }
  return { ok: status >= 200 && status < 300, status: status, json: json, retry: res.getHeaders ? (res.getHeaders()['Retry-After'] || null) : null };
}

// The cached call used by getData: a dashboard refresh must not scan a site again.
function cachedJson_(path, qs) {
  var cache = CacheService.getUserCache(), id = 'cht:' + path + ':' + JSON.stringify(qs || {});
  var hit = cache.get(id);
  if (hit) return JSON.parse(hit);
  var r = fetchJson_(path, qs);
  if (!r.ok) throw friendlyError_(r);
  cache.put(id, JSON.stringify(r.json), CACHE_SECONDS);
  return r.json;
}

function friendlyError_(r) {
  var msg = r.json && typeof r.json.message === 'string' ? r.json.message : '';
  if (r.status === 401) return { text: 'Citehound did not accept the API key. Reset the connector credentials and enter a valid key (a free one is sent by email at ' + SIGNUP + ').', debug: 'HTTP 401' };
  if (r.status === 402) return { text: msg || 'That data is part of a higher plan. See https://getcitehound.com/pricing.', debug: 'HTTP 402' };
  if (r.status === 429) return { text: (msg || 'A limit was reached.') + (r.retry ? ' Try again in about ' + r.retry + ' seconds.' : ''), debug: 'HTTP 429' };
  if (r.status === 404 || r.status === 400 || r.status === 502) return { text: msg || 'Citehound could not use that input.', debug: 'HTTP ' + r.status };
  return { text: 'Citehound answered with an error (HTTP ' + r.status + '). Try again later.', debug: 'HTTP ' + r.status };
}

function domainsOf_(params) {
  var list = String((params && params.domains) || '').split(',').map(function (s) { return s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[\/?#].*$/, '').replace(/^www\./, ''); }).filter(Boolean);
  return list.slice(0, MAX_DOMAINS);
}

function rowsFor_(source, params) {
  var out = [], domains = domainsOf_(params);
  try {
    if (source === 'events') {
      var r = cachedJson_('/events', { domain: domains[0], limit: 100 });
      return r.events.map(function (e) { return { event_id: e.id, at: e.at.replace(/[-:T]/g, '').slice(0, 10), domain: e.domain, type: e.type, summary: e.summary, count: 1 }; });
    }
    if (!domains.length) userError_('Enter at least one domain in the connector settings.', 'no domains');
    if (source === 'history') {
      domains.forEach(function (d) {
        cachedJson_('/history', { domain: d, limit: 120 }).snapshots.forEach(function (s) {
          out.push({ domain: d, scanned_at: s.at.replace(/[-:T]/g, '').slice(0, 10), score: s.score, failed_checks: s.failed.length, crawlers_blocked: Object.keys(s.crawlers).filter(function (n) { return s.crawlers[n] === 'blocked'; }).length, llms_txt: !!s.llms_txt, json_ld: !!s.schema });
        });
      });
      return out;
    }
    domains.forEach(function (d) {
      var s = cachedJson_('/scan', { domain: d });
      var p = {}; (s.pillars || []).forEach(function (x) { p[x.id] = x.score; });
      out.push({ domain: s.domain, scanned_on: String(s.scannedAt).slice(0, 10).replace(/-/g, ''), score: s.score, discoverability: p.discover, technical: p.tech, content_trust: p.trust, crawlers_open: s.crawlerSummary.open, crawlers_limited: s.crawlerSummary.limited, crawlers_blocked: s.crawlerSummary.blocked, findings_shown: (s.failed || []).length, top_fix: s.failed && s.failed[0] ? s.failed[0].fix : '' });
    });
    return out;
  } catch (e) {
    if (e && e.text) userError_(e.text, e.debug);
    throw e;
  }
}

function getData(request) {
  var source = (request.configParams && request.configParams.source) || 'scan';
  var requested = getFields(source).forIds(request.fields.map(function (f) { return f.name; }));
  var rows = rowsFor_(source, request.configParams).map(function (r) {
    return { values: requested.asArray().map(function (f) { var v = r[f.getId()]; return v === undefined ? null : v; }) };
  });
  return { schema: requested.build(), rows: rows };
}
