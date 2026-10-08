#!/usr/bin/env node
/* =====================================================================
   scripts/test-subscribe.js — api/subscribe.js against a mock provider webhook and a
   mock KV. No real request is made and no mail is sent.
   ===================================================================== */
'use strict';

const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// ----- mock KV (rate-limit counters) -----
const kvLog = []; let kvForce = null; const counters = new Map();
const kv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    const out = JSON.parse(b).map((c) => {
      kvLog.push(c); const op = c[0], key = c[1];
      if (op === 'INCR') { if (kvForce) return { result: kvForce }; const n = (counters.get(key) || 0) + 1; counters.set(key, n); return { result: n }; }
      return { result: 1 };
    });
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out));
  });
});

// ----- mock provider webhook -----
const hooks = []; let hookStatus = 200;
const hook = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => { hooks.push({ method: req.method, type: req.headers['content-type'], body: JSON.parse(b) }); res.statusCode = hookStatus; res.end('{}'); });
});

const mockRes = () => { const r = { code: 200, headers: {}, body: null, setHeader(k, v) { r.headers[k.toLowerCase()] = v; }, status(c) { r.code = c; return r; }, json(x) { r.body = x; return r; } }; return r; };
let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra === undefined ? '' : JSON.stringify(extra)))); };

const ORIGIN = require(ROOT + '/lib/site-config.js').baseUrl;
const HOST = new URL(ORIGIN).host.replace(/^www\./, '');
const GOOD = { email: 'Reader@Example.org', site: 'example.com', role: 'Founder', form: 'report', consent: true };
const post = async (handler, body, over) => {
  if (!kvForce) counters.clear(); // each call is a fresh caller unless a test forces the count
  const res = mockRes();
  const req = Object.assign({ method: 'POST', url: '/api/subscribe', headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.23' }, body: body }, over || {});
  await handler(req, res);
  return res;
};

kv.listen(0, () => hook.listen(0, async () => {
  const launch = require(ROOT + '/lib/launch-config.js');
  const handler = require(ROOT + '/api/subscribe.js');
  const site = require(ROOT + '/lib/site-config.js');
  process.env.KV_REST_API_URL = 'http://127.0.0.1:' + kv.address().port; process.env.KV_REST_API_TOKEN = 't';
  const HOOK_URL = 'http://127.0.0.1:' + hook.address().port + '/webhook';

  // capture everything the handler prints
  const printed = []; const origErr = console.error, origLog = console.log;
  const spy = (...a) => { printed.push(a.join(' ')); };

  console.log('as shipped: disabled');
  delete process.env.SUBSCRIBE_WEBHOOK_URL;
  t('the committed config has ENABLED false', launch.ENABLED === false);
  let r = await post(handler, GOOD);
  t('a valid signup gets 503 not_enabled', r.code === 503 && r.body && r.body.error === 'not_enabled', r);
  r = await post(handler, GOOD, { method: 'GET' });
  t('so does a GET', r.code === 503 && r.body.error === 'not_enabled');
  process.env.SUBSCRIBE_WEBHOOK_URL = HOOK_URL;
  r = await post(handler, GOOD);
  t('with the webhook set but ENABLED false it is still 503', r.code === 503 && r.body.error === 'not_enabled');
  t('nothing was forwarded', hooks.length === 0);

  console.log('enabled in the test only (the module object is patched, nothing on disk)');
  launch.ENABLED = true; launch.CONSENT_VERSION = 'test-v1';
  delete process.env.SUBSCRIBE_WEBHOOK_URL;
  r = await post(handler, GOOD);
  t('webhook env missing: 503 not_enabled', r.code === 503 && r.body.error === 'not_enabled');
  process.env.SUBSCRIBE_WEBHOOK_URL = HOOK_URL;

  console.error = spy; console.log = spy;
  r = await post(handler, GOOD);
  console.error = origErr; console.log = origLog;
  t('valid request: 200 {ok:true}', r.code === 200 && r.body.ok === true, r);
  t('one webhook call, JSON POST', hooks.length === 1 && hooks[0].method === 'POST' && /application\/json/.test(hooks[0].type), hooks.length);
  const p = hooks[0] && hooks[0].body;
  t('payload has exactly the agreed fields', p && JSON.stringify(Object.keys(p).sort()) === JSON.stringify(['consent', 'consentVersion', 'email', 'form', 'role', 'site', 'timestamp']), p && Object.keys(p));
  t('email is lower-cased, consent is true, version comes from the config', p.email === 'reader@example.org' && p.consent === true && p.consentVersion === 'test-v1' && p.form === 'report' && p.site === 'example.com' && p.role === 'Founder');
  t('timestamp is an ISO time from the server', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p.timestamp) && Math.abs(Date.now() - Date.parse(p.timestamp)) < 5000);
  t('the email address is not printed anywhere', !printed.some((l) => /reader@example\.org/i.test(l)), printed);

  hooks.length = 0;
  r = await post(handler, Object.assign({}, GOOD, { consentVersion: 'client-says', timestamp: '1999-01-01', extra: 'x', company_fax: '' }));
  t('browser-sent consentVersion, timestamp and unknown fields are not forwarded', r.code === 200 && hooks[0].body.consentVersion === 'test-v1' && hooks[0].body.timestamp !== '1999-01-01' && !('extra' in hooks[0].body) && !('company_fax' in hooks[0].body));
  hooks.length = 0;
  r = await post(handler, { email: 'a@b.co', form: 'founding', consent: true });
  t('site and role are optional and forwarded as empty strings', r.code === 200 && hooks[0].body.site === '' && hooks[0].body.role === '' && hooks[0].body.form === 'founding');

  console.log('consent');
  hooks.length = 0;
  for (const c of [undefined, false, 'true', 1, null]) {
    r = await post(handler, Object.assign({}, GOOD, { consent: c }));
    t('consent ' + JSON.stringify(c) + ' is refused', r.code === 400 && r.body.error === 'consent_required', r.body);
  }
  t('and nothing was forwarded', hooks.length === 0);

  console.log('honeypot');
  r = await post(handler, Object.assign({}, GOOD, { company_fax: 'http://spam.example' }));
  t('a filled honeypot looks like a success', r.code === 200 && r.body.ok === true);
  t('and is dropped', hooks.length === 0);

  console.log('origin');
  for (const o of [undefined, 'https://evil.example', 'http://' + HOST, 'https://' + HOST + '.evil.example', 'null', 'https://sub.' + HOST]) {
    r = await post(handler, GOOD, { headers: { origin: o, 'content-type': 'application/json' } });
    t('origin ' + o + ' is refused', r.code === 403 && r.body.error === 'forbidden_origin', r.body);
  }
  hooks.length = 0;
  const www = 'https://www.' + new URL(site.baseUrl).host.replace(/^www\./, '');
  r = await post(handler, GOOD, { headers: { origin: www, 'content-type': 'application/json' } });
  t('the www origin is accepted', r.code === 200 && hooks.length === 1);
  r = await post(handler, GOOD, { headers: { origin: site.baseUrl, 'content-type': 'application/json; charset=utf-8' } });
  t('the apex origin and a charset parameter are accepted', r.code === 200);
  t('nothing was forwarded for the refused origins', hooks.length === 2);

  console.log('email and fields');
  hooks.length = 0;
  const bad = ['', 'plain', 'a@b', 'a b@c.com', '@c.com', 'a@.com', 'a@@c.com', 'a..b@c.com', 'a@b..com', '<x>@c.com', 'a@c.com\nBcc: x@y.com', 'x'.repeat(65) + '@c.com', 'a@' + 'b'.repeat(250) + '.com', 12345, null, ['a@b.co']];
  for (const e of bad) {
    r = await post(handler, Object.assign({}, GOOD, { email: e }));
    t('email ' + JSON.stringify(typeof e === 'string' ? e.slice(0, 24) : e) + ' is refused', r.code === 400 && r.body.error === 'invalid_email', r.body);
  }
  r = await post(handler, Object.assign({}, GOOD, { site: 'x'.repeat(201) }));
  t('a site over 200 characters is refused', r.code === 400 && r.body.error === 'invalid_field');
  r = await post(handler, Object.assign({}, GOOD, { role: 'x'.repeat(81) }));
  t('a role over 80 characters is refused', r.code === 400 && r.body.error === 'invalid_field');
  r = await post(handler, Object.assign({}, GOOD, { role: 'a\nb' }));
  t('a role with a line break is refused', r.code === 400 && r.body.error === 'invalid_field');
  r = await post(handler, Object.assign({}, GOOD, { site: { a: 1 } }));
  t('a non-text site is refused', r.code === 400 && r.body.error === 'invalid_field');
  r = await post(handler, Object.assign({}, GOOD, { form: 'other' }));
  t('an unknown form is refused', r.code === 400 && r.body.error === 'invalid_form');
  t('nothing was forwarded', hooks.length === 0);

  console.log('transport');
  r = await post(handler, GOOD, { headers: { origin: ORIGIN, 'content-type': 'text/plain' } });
  t('a non-JSON content type is 415', r.code === 415 && r.body.error === 'json_only');
  r = await post(handler, '{not json');
  t('a body that is not JSON is 400', r.code === 400 && r.body.error === 'invalid_json');
  r = await post(handler, JSON.stringify(GOOD));
  t('a JSON string body is parsed', r.code === 200);
  r = await post(handler, ['a@b.co']);
  t('a JSON array is refused', r.code === 400 && r.body.error === 'invalid_json');
  r = await post(handler, GOOD, { method: 'GET' });
  t('GET is 405 with an Allow header', r.code === 405 && r.headers.allow === 'POST');
  t('responses are not cached', r.headers['cache-control'] === 'no-store');

  console.log('rate limit');
  kvLog.length = 0; counters.clear(); hooks.length = 0;
  r = await post(handler, GOOD);
  t('under the limit it passes', r.code === 200);
  t('the counters are keyed by a SHA-256 hash under their own prefix, no raw IP and no email', kvLog.length > 0 && kvLog.every((c) => !JSON.stringify(c).includes('198.51.100.23') && !/reader@/i.test(JSON.stringify(c)) && (c[0] !== 'INCR' || /^sub:[hd]:[0-9a-f]{64}$/.test(c[1]))), kvLog.slice(0, 2));
  kvForce = 6;
  hooks.length = 0;
  r = await post(handler, GOOD);
  t('over the hourly limit: 429 rate_limited with Retry-After', r.code === 429 && r.body.error === 'rate_limited' && Number(r.headers['retry-after']) > 0, r);
  t('and nothing is forwarded', hooks.length === 0);
  kvForce = 21;
  r = await post(handler, GOOD);
  t('over the daily limit: 429', r.code === 429);
  kvForce = null;
  delete process.env.KV_REST_API_URL;
  r = await post(handler, GOOD);
  t('with KV unavailable it fails open, like the scan endpoints', r.code === 200);
  process.env.KV_REST_API_URL = 'http://127.0.0.1:' + kv.address().port;

  console.log('the scan endpoints keep their own counters');
  kvLog.length = 0;
  const rl = require(ROOT + '/api/_rateLimit.js');
  await rl.checkRateLimit({ headers: { 'x-forwarded-for': '203.0.113.9' } });
  t('checkRateLimit without options still uses rl:h and rl:d', kvLog.some((c) => c[0] === 'INCR' && /^rl:h:/.test(c[1])) && kvLog.some((c) => c[0] === 'INCR' && /^rl:d:/.test(c[1])));

  console.log('provider trouble');
  hookStatus = 500; hooks.length = 0; printed.length = 0;
  console.error = spy; console.log = spy;
  r = await post(handler, GOOD);
  console.error = origErr; console.log = origLog;
  t('a provider 500 gives 502 upstream_failed', r.code === 502 && r.body.error === 'upstream_failed');
  t('the failure is logged without the address', printed.length > 0 && !printed.some((l) => /reader@example\.org/i.test(l)), printed);
  hookStatus = 200;
  process.env.SUBSCRIBE_WEBHOOK_URL = 'http://127.0.0.1:1/unreachable';
  console.error = spy; console.log = spy;
  r = await post(handler, GOOD);
  console.error = origErr; console.log = origLog;
  t('an unreachable provider gives 502 upstream_failed', r.code === 502 && r.body.error === 'upstream_failed');

  console.log('\n' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''));
  kv.close(); hook.close();
  process.exit(fail ? 1 : 0);
}));
