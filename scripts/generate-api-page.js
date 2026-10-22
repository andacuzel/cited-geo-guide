#!/usr/bin/env node
/* =====================================================================
   scripts/generate-api-page.js

   Writes api.html (/api) and openapi.yaml (/openapi.yaml) from lib/api-v1/openapi.js, the one description of /v1, and keeps the sitemap and llms.txt entries for /api
   (only /api: the API is not in the footer or the main navigation). The limits come from lib/api-v1/limits.js and the contact address from site.config.json, so nothing
   is typed twice. Edit this file or the registry, never the page or the YAML.

   openapi.yaml is block-style YAML whose scalars are JSON strings and numbers, written by a small emitter here; scripts/test-api-v1.js parses it back and validates it
   against the OpenAPI 3.1 JSON Schema.

   --check fails if a file is out of date, if the page makes a claim the brief forbids (a recommendation, a guarantee, a partner, an integration that does not exist),
   if it has no single H1, if a title or description is too long, if the JSON-LD does not parse, if an internal link points at a page that does not exist, or if the
   sitemap or llms.txt has no /api.

     node scripts/generate-api-page.js            write api.html, openapi.yaml and the sitemap and llms.txt entries
     node scripts/generate-api-page.js --check    exit 1 on any mismatch
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const shell = require('../lib/page-shell.js');
const site = require('../lib/site-config.js');
const OA = require('../lib/api-v1/openapi.js');
const Limits = require('../lib/api-v1/limits.js');
const Monitor = require('../lib/api-v1/monitor.js');
const MCFG = Monitor.config({});

const ROOT = path.resolve(__dirname, '..');
const CSS_VERSION = 104;
const esc = shell.esc;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const L = Limits.PLAN_LIMITS;

const TITLE = 'Citehound API: scan a domain for AI readiness';
const DESC = 'A free JSON API: scan a domain for AI readiness, compare two sites, check ten AI crawlers, and generate llms.txt, robots.txt and schema. Free key by email.';
const H1 = 'Scan and generate from your own code';

const FAQ = [
  ['What does the score mean?', 'It is a readiness score out of 100: whether AI crawlers can reach the site and whether its homepage carries signals a model can read. It does not measure whether any assistant names a brand. The same score appears in the web scan and the MCP server.'],
  ['What does a scan read?', 'The public robots.txt, llms.txt, sitemap declaration and homepage of the domain you name, through the same guarded fetch as the web scan. One page, not the whole site. The API never sends your key, your address or any credential to the scanned site.'],
  ['What do you keep about a key?', 'A one-way hash of the key, a one-way hash of your address, the masked address shown by /v1/me, the plan and the dates. Your address itself is kept only if you tick the update box. Counters for the limits expire within a day. The key email is transactional only.'],
  ['Can I revoke a key?', 'Yes. Every key email has a link that revokes that key with one click. A revoked key answers 403 from then on.'],
  ['Is there a paid plan?', 'The API has a pro plan with higher limits and monitoring: a watchlist, scheduled re-scans, events, alert emails and webhooks. It is set by us for a key, and there is no checkout for it yet. Write to ' + site.contactEmail + ' to ask.'],
  ['What does monitoring keep?', 'For a Pro key: the domains it watches, a snapshot of each scan and the events between scans for ' + MCFG.retentionDays + ' days, the address for alerts if you give one, and the addresses of your webhooks (their secrets are stored encrypted and never shown again). Revoking the key deletes all of it.']
];

/* ---------- the YAML emitter ---------- */
const KEY_OK = /^[A-Za-z_][A-Za-z0-9_]*$/;
function scalar(v) { return v === null ? 'null' : typeof v === 'string' ? JSON.stringify(v) : String(v); }
function emit(v, indent) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(v)) {
    if (!v.length) return pad + '[]\n';
    return v.map((x) => {
      if (x !== null && typeof x === 'object') {
        if ((Array.isArray(x) && !x.length) || (!Array.isArray(x) && !Object.keys(x).length)) return pad + '- ' + (Array.isArray(x) ? '[]' : '{}') + '\n';
        const inner = emit(x, indent + 2);
        return pad + '- ' + inner.slice(indent + 2);
      }
      return pad + '- ' + scalar(x) + '\n';
    }).join('');
  }
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v);
    if (!keys.length) return pad + '{}\n';
    return keys.map((k) => {
      const key = KEY_OK.test(k) ? k : JSON.stringify(k), x = v[k];
      if (x !== null && typeof x === 'object') {
        if ((Array.isArray(x) && !x.length) || (!Array.isArray(x) && !Object.keys(x).length)) return pad + key + ': ' + (Array.isArray(x) ? '[]' : '{}') + '\n';
        return pad + key + ':\n' + emit(x, indent + 2);
      }
      return pad + key + ': ' + scalar(x) + '\n';
    }).join('');
  }
  return pad + scalar(v) + '\n';
}
function yaml() { return '# Citehound API v1. Written by scripts/generate-api-page.js from lib/api-v1/openapi.js. Do not edit by hand.\n' + emit(OA.spec(), 0); }

/* ---------- the page ---------- */
function head(kicker, id, title, sub) {
  return '        <div class="section-head">\n          <p class="kicker">' + esc(kicker) + '</p>\n          <h2 id="' + id + '" class="section-title">' + esc(title) + '</h2>\n' + (sub ? '          <p class="section-sub">' + sub + '</p>\n' : '') + '        </div>\n';
}
function snippet(id, label, code) {
  return '            <div class="fix-snippet" data-copy-wrap>\n              <div class="fix-snippet__head">\n                <span class="fix-snippet__label">' + esc(label) + '</span>\n                <div class="fix-snippet__actions"><button type="button" class="btn btn--ghost-on-navy cl-copybtn" data-copy-from="#' + id + '" data-copied="Copied" hidden>Copy</button></div>\n              </div>\n' +
    '              <pre class="fix-snippet__code" id="' + id + '">' + esc(code) + '</pre>\n              <p class="cl-status cl-status--on-navy" role="status" aria-live="polite"></p>\n            </div>\n';
}
function paramRows(e) {
  if (!e.params || !e.params.length) return '';
  const rows = e.params.map((p) => '              <tr><th scope="row" data-label="Parameter"><code>' + esc(p.name) + '</code></th><td data-label="Required">' + (p.required ? 'Yes' : 'No') + '</td><td data-label="What it is">' + esc(p.description || p.schema.description || '') + '</td></tr>').join('\n');
  return '            <div class="cl-tablewrap">\n              <table class="cl-table cl-table--wrap">\n                <caption class="mcp-vh">Parameters of ' + esc(e.method.toUpperCase() + ' /v1' + e.path) + '</caption>\n                <thead><tr><th scope="col">Parameter</th><th scope="col">Required</th><th scope="col">What it is</th></tr></thead>\n                <tbody>\n' + rows + '\n                </tbody>\n              </table>\n            </div>\n';
}
function endpointBlock(e, i) {
  const bodyNote = e.body ? '            <p>Send JSON with <code>Content-Type: application/json</code>.</p>\n' + snippet('ep' + (i + 1) + 'Body', 'Request body', JSON.stringify(e.body.example, null, 2)) : '';
  const post = e.id === 'generateLlmsTxt' || e.id === 'generateRobotsTxt' ? '            <p>A <code>POST</code> to the same path takes the same fields as a JSON body.</p>\n' : '';
  return '          <details' + (i === 0 ? '' : '') + '>\n            <summary><code>' + esc(e.method.toUpperCase()) + ' /v1' + esc(e.path) + '</code> ' + (e.pro ? '<strong>Pro</strong>: ' : '') + esc(e.summary) + '</summary>\n            <p>' + esc(e.description) + '</p>\n            <p>' + (e.pro ? 'Needs a key on the Pro plan (a free key gets 403).' : (e.auth ? 'Needs a key.' : 'No key needed.')) + ' Answers ' + esc([e.ok.status].concat(e.errors).join(', ')) + '.</p>\n' +
    bodyNote + paramRows(e) + post + snippet('ep' + (i + 1) + 'Curl', 'curl', e.curl) + snippet('ep' + (i + 1) + 'Out', 'Example response', JSON.stringify(e.ok.example, null, 2)) + '          </details>';
}


const SAMPLE_VERIFY = [
  "const crypto = require('crypto');",
  '',
  '// rawBody: the request body exactly as received (a string, not parsed JSON).',
  '// headers: the lower-cased request headers. secret: the secret of the webhook.',
  'function verify(secret, headers, rawBody) {',
  "  const ts = headers['x-citehound-timestamp'];",
  "  const want = Buffer.from('v1=' + crypto.createHmac('sha256', secret).update(ts + '.' + rawBody).digest('hex'));",
  "  const got = Buffer.from(String(headers['x-citehound-signature'] || ''));",
  '  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return false;',
  '  return Math.abs(Date.now() / 1000 - Number(ts)) < 300;   // reject old deliveries',
  '}'
].join('\n');

const EVENT_TEXT = { score_dropped: 'The score fell by ' + MCFG.scoreDelta + ' points or more since the last scan.', score_improved: 'The score rose by ' + MCFG.scoreDelta + ' points or more.', crawler_blocked: 'One of the ten AI crawlers is now blocked in robots.txt.', crawler_unblocked: 'A crawler that was blocked is no longer blocked.', llms_txt_added: 'llms.txt is now found at the site root.', llms_txt_removed: 'llms.txt is no longer found.', check_failed: 'A check that passed now fails.', check_fixed: 'A check that failed now passes.', scan_failed: 'The scheduled scan could not read the site (sent once when a run of failures starts).' };

function monitoringSection() {
  const rows = Monitor.EVENT_TYPES.map((t) => '            <tr><th scope="row" data-label="Event"><code>' + t + '</code></th><td data-label="When">' + esc(EVENT_TEXT[t]) + '</td><td data-label="Alert email">' + (Monitor.ALERT_TYPES.indexOf(t) !== -1 ? 'Yes' : 'No') + '</td></tr>').join('\n');
  return '    <section class="cl-sec hp-light" id="monitoring" aria-labelledby="monitoring-heading">\n      <div class="section__inner">\n' +
    head('Monitoring (Pro)', 'monitoring-heading', 'Watch domains, get told when something changes.', 'Needs a key on the Pro plan. A free key gets <code>403 pro_required</code> on these endpoints.') +
    '        <p class="cl-limits">Add a domain with <code>POST /v1/watchlist</code>. It is scanned at once, and that scan is the baseline. A scheduled job runs once a day and re-scans the domains that are due, about 7 days after their last scan, oldest first. Each scan is compared with the one before and the differences become events. A scan that fails is tried again the next day, up to three times. A domain is scanned once for everyone who watches it.</p>\n' +
    '        <h3 class="cl-h3">Events</h3>\n        <div class="cl-tablewrap">\n          <table class="cl-table cl-table--wrap">\n            <caption class="mcp-vh">Event types</caption>\n            <thead><tr><th scope="col">Event</th><th scope="col">When</th><th scope="col">Alert email</th></tr></thead>\n            <tbody>\n' + rows + '\n            </tbody>\n          </table>\n        </div>\n' +
    '        <p class="cl-note">Every event has a stable id, a time, the domain and a one-line summary. Read them with <code>GET /v1/events</code>: pass the newest id you have as <code>since</code> and you get only what is new, newest first. Alert emails go to the address you give as <code>alert_email</code> when you add a domain (it must be the address your key was sent to). They are sent for score drops, blocked crawlers and a removed llms.txt, at most one a day for each domain, and every email has a one-click link to stop them for that domain.</p>\n' +
    '        <h3 class="cl-h3">Webhooks</h3>\n' +
    '        <p class="cl-note">A webhook receives each event you chose as a JSON <code>POST</code>. The address must be https on the default port and a public host; no redirect is followed. Each request carries <code>X-Citehound-Timestamp</code> (unix seconds), <code>X-Citehound-Signature</code> (<code>v1=</code> and the hex HMAC-SHA-256 of the timestamp, a dot and the raw body, keyed with your secret), <code>X-Citehound-Event</code>, <code>X-Citehound-Event-Id</code> and <code>X-Citehound-Delivery</code>. Any 2xx answer is a success. Otherwise it is retried after 1 minute, 10 minutes and 1 hour, at the next run of the scheduled job, so a retry can be up to a day late. After ' + MCFG.maxFails + ' deliveries in a row fail all their attempts, the webhook is disabled; delete it and create it again to start over. Use <code>POST /v1/webhooks/{id}/test</code> to send a test event and <code>GET /v1/webhooks/{id}/deliveries</code> to see the log.</p>\n' +
    snippet('verifySample', 'Verify a delivery (Node.js)', SAMPLE_VERIFY) +
    '      </div>\n    </section>\n\n';
}

function body() {
  const tag = (t) => OA.ENDPOINTS.filter((e) => e.tag === t);
  const endpoints = OA.ENDPOINTS.map(endpointBlock).join('\n');
  const limitRows = [
    ['Free key', L.free.hour + ' requests an hour', L.free.day + ' requests a day (UTC)'],
    ['Pro key', L.pro.hour + ' requests an hour', L.pro.day + ' requests a day (UTC)'],
    ['One domain, all keys together', Limits.DOMAIN_PER_HOUR + ' scans an hour', 'Counts scans, compare, crawlers and schema'],
    ['One network address', Limits.IP_PER_HOUR + ' requests an hour', 'Across all keys'],
    ['Pro: watched domains', MCFG.watchLimit + ' per key', 'Each is re-scanned about every 7 days'],
    ['Pro: webhooks', MCFG.webhookLimit + ' per key', 'Disabled after ' + MCFG.maxFails + ' deliveries in a row fail all their attempts'],
    ['Pro: history and events', MCFG.retentionDays + ' days', 'Then they are deleted'],
    ['Asking for keys', Limits.CREATE.ipHour + ' an hour', Limits.CREATE.emailDay + ' a day for one address']
  ].map((r) => '            <tr><th scope="row" data-label="Limit">' + esc(r[0]) + '</th><td data-label="Allowed">' + esc(r[1]) + '</td><td data-label="Notes">' + esc(r[2]) + '</td></tr>').join('\n');
  const errRows = Object.keys(OA.ERRORS).map((c) => '            <tr><th scope="row" data-label="Status"><code>' + c + '</code></th><td data-label="Code"><code>' + esc(OA.ERRORS[c].code) + '</code></td><td data-label="Meaning">' + esc(OA.ERRORS[c].description) + '</td></tr>').join('\n');
  const KEYSTUB = 'chk_your_key_here';
  return '    <section aria-labelledby="hero-heading">\n      <div class="section__inner">\n        <div class="page-banner">\n          <div class="page-banner__body">\n            <p class="kicker kicker--on-navy">API v1</p>\n' +
    '            <h1 id="hero-heading" class="page-banner__title">' + esc(H1) + '</h1>\n' +
    '            <p class="page-banner__desc">A JSON API for the Citehound scan. It scores one page of a domain out of 100 for AI readiness, lists the fixes, shows the state of ten AI crawlers, compares two sites, and writes llms.txt, robots.txt and JSON-LD. The score measures readiness, not whether any assistant names a brand.</p>\n' +
    '          </div>\n        </div>\n      </div>\n    </section>\n\n' +

    '    <section class="cl-sec hp-light" id="key" aria-labelledby="key-heading">\n      <div class="section__inner">\n' + head('Get a key', 'key-heading', 'A free key, by email.', 'Free keys allow ' + L.free.hour + ' requests an hour and ' + L.free.day + ' a day. The key is in the email and is shown once.') +
    '        <form class="ps-form wl-form" id="akForm" novalidate>\n          <div class="ps-field"><label for="akEmail" class="ps-label">Email</label><input class="field ps-input" id="akEmail" name="email" type="email" inputmode="email" autocapitalize="off" autocomplete="email" maxlength="254" aria-describedby="akEmailError" required /><p class="ps-error" id="akEmailError" hidden></p></div>\n' +
    '          <div class="ps-field ps-field--check"><label class="ps-check" for="akOptin"><input id="akOptin" name="marketing_optin" type="checkbox" /><span>Also send me occasional product updates (optional)</span></label></div>\n' +
    '          <p class="ps-note">The key email is transactional and carries no marketing. We store a one-way hash of the key and of your address, plus the masked address. We keep your address itself only if you tick the box. Every key email has a link that revokes the key. See the <a href="/privacy">privacy page</a>.</p>\n' +
    '          <p class="ps-actions"><button type="submit" class="btn btn--gold ps-submit" id="akSubmit">Email me a key</button></p>\n          <p class="wl-status" id="akStatus" role="status" aria-live="polite" tabindex="-1"></p>\n        </form>\n' +
    '        <noscript><p class="ps-note">The form needs JavaScript. Without it, send a POST request to <code>/v1/keys</code> as shown below, or write to <a href="mailto:' + esc(site.contactEmail) + '">' + esc(site.contactEmail) + '</a>.</p></noscript>\n' +
    '      </div>\n    </section>\n\n' +

    '    <section class="cl-sec hp-light" id="start" aria-labelledby="start-heading">\n      <div class="section__inner">\n' + head('Quick start', 'start-heading', 'Send the key in a header.', 'Use <code>Authorization: Bearer &lt;key&gt;</code>, or <code>X-Citehound-Key: &lt;key&gt;</code>. Keep the key out of URLs and public code.') +
    snippet('qsCurl', 'curl', 'export CITEHOUND_KEY=' + KEYSTUB + '\ncurl "' + OA.BASE + '/scan?domain=example.com" \\\n  -H "Authorization: Bearer $CITEHOUND_KEY"') +
    '        <p class="cl-note">The full description is a machine-readable OpenAPI 3.1 file: <a href="/openapi.yaml">/openapi.yaml</a>.</p>\n' +
    '      </div>\n    </section>\n\n' +

    '    <section class="cl-sec hp-light" id="reference" aria-labelledby="reference-heading">\n      <div class="section__inner">\n' + head('Reference', 'reference-heading', OA.ENDPOINTS.length + ' endpoints.', 'Base address <code>' + esc(OA.BASE) + '</code>. Scan: ' + tag('Scan').length + '. Generate: ' + tag('Generate').length + '. Keys, account and benchmark: ' + (tag('Keys').length + tag('Account').length + tag('Benchmark').length) + '. Pro monitoring: ' + (tag('Monitoring').length + tag('Webhooks').length) + '.') +
    '        <div class="ac-faq cl-clients">\n' + endpoints + '\n        </div>\n      </div>\n    </section>\n\n' +

    monitoringSection() +
    '    <section class="cl-sec hp-light" id="limits" aria-labelledby="limits-heading">\n      <div class="section__inner">\n' + head('Limits', 'limits-heading', 'What a key can do.', 'Every answer carries <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code> and <code>X-RateLimit-Reset</code>. When a limit is reached the answer is 429 with a <code>Retry-After</code> header.') +
    '        <div class="cl-tablewrap">\n          <table class="cl-table cl-table--wrap">\n            <caption class="mcp-vh">Limits of the Citehound API</caption>\n            <thead><tr><th scope="col">Limit</th><th scope="col">Allowed</th><th scope="col">Notes</th></tr></thead>\n            <tbody>\n' + limitRows + '\n            </tbody>\n          </table>\n        </div>\n' +
    '        <p class="cl-note">Counters expire on their own within a day. Acceptable use: scan sites you have a reason to look at, keep to the limits, and do not use the API to probe private networks. A key that is abused is revoked.</p>\n' +
    '      </div>\n    </section>\n\n' +

    '    <section class="cl-sec hp-light" id="errors" aria-labelledby="errors-heading">\n      <div class="section__inner">\n' + head('Errors', 'errors-heading', 'Errors are JSON.', 'Every error has the shape <code>{"error": "code", "message": "…"}</code>. A 429 adds <code>retry_after</code> and <code>limit_scope</code>.') +
    '        <div class="cl-tablewrap">\n          <table class="cl-table cl-table--wrap">\n            <caption class="mcp-vh">Errors of the Citehound API</caption>\n            <thead><tr><th scope="col">Status</th><th scope="col">Code</th><th scope="col">Meaning</th></tr></thead>\n            <tbody>\n' + errRows + '\n            </tbody>\n          </table>\n        </div>\n' +
    '      </div>\n    </section>\n\n' +

    '    <section class="cl-sec hp-light" id="scope" aria-labelledby="scope-heading">\n      <div class="section__inner">\n' + head('Scope', 'scope-heading', 'What it does not do.') +
    '        <p class="cl-limits">The API measures readiness: whether crawlers can reach a site and whether its homepage carries signals a model can read. It does not measure whether any assistant names a brand, and the benchmark is our own archive of scans, dated as shown. It is read-only: it changes nothing on a scanned site. Browser calls from other sites are not allowed (no cross-origin access), so call it from a server.</p>\n' +
    '      </div>\n    </section>\n\n' +

    '    <section class="home-faq hp-light" id="faq" aria-labelledby="faq-heading">\n      <div class="section__inner">\n' + head('Questions', 'faq-heading', 'Before you build.') +
    '        <div class="ac-faq">\n' + FAQ.map((f) => '          <details>\n            <summary>' + esc(f[0]) + '</summary>\n            <p>' + esc(f[1]) + '</p>\n          </details>').join('\n') + '\n        </div>\n        <p class="cl-contact">Questions, or a key that will not arrive: <a href="mailto:' + esc(site.contactEmail) + '">' + esc(site.contactEmail) + '</a></p>\n      </div>\n    </section>\n';
}

function build() {
  const ld = [
    { '@context': 'https://schema.org', '@type': 'WebPage', name: TITLE, description: DESC, url: site.baseUrl + '/api', publisher: { '@id': site.baseUrl + '/#org' } },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f[0], acceptedAnswer: { '@type': 'Answer', text: f[1] } })) }
  ];
  return shell.page({
    title: TITLE, description: DESC, path: '/api', cssVersion: CSS_VERSION,
    headExtra: '  <script src="/claude.js?v=1" defer></script>\n  <script src="/get-api-key.js?v=1" defer></script>\n', jsonld: ld, body: body()
  });
}

function ensureSitemap() {
  const file = path.join(ROOT, 'sitemap.xml'), xml = fs.readFileSync(file, 'utf8'), loc = site.baseUrl + '/api';
  if (xml.indexOf('<loc>' + loc + '</loc>') !== -1) return false;
  fs.writeFileSync(file, xml.replace('</urlset>', '  <url>\n    <loc>' + loc + '</loc>\n  </url>\n</urlset>'), 'utf8');
  return true;
}

const LLMS_LINE = '- [API](' + site.baseUrl + '/api): a free JSON API (OpenAPI 3.1 at ' + site.baseUrl + '/openapi.yaml) to scan a domain for AI readiness and generate llms.txt, robots.txt and schema. Free key by email.\n';
function ensureLlms() {
  const file = path.join(ROOT, 'llms.txt'), t = fs.readFileSync(file, 'utf8');
  const re = /^- \[API\]\([^)]*\)[^\n]*\n/m;
  if (re.test(t)) { const n = t.replace(re, LLMS_LINE); if (n === t) return false; fs.writeFileSync(file, n, 'utf8'); return true; }
  const m = /^- \[Claude connector\]\([^)]*\)[^\n]*\n/m.exec(t);
  if (!m) throw new Error('llms.txt has no Claude connector line to put the API line after');
  fs.writeFileSync(file, t.replace(m[0], m[0] + LLMS_LINE), 'utf8');
  return true;
}

const visible = (html) => html.replace(/<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const FORBIDDEN = /\b(recommend(s|ed|ation|ations)?|cites|cited by|guarantee[sd]?|partners?|official(ly)?|verified|WordPress|Webflow|GitHub|Shopify|Zapier|Wix|Squarespace|HubSpot|Slack|unlock|supercharge|seamless(ly)?|game-changing|revolutioni[sz]e|robust|crucial|delve|landscape|ranking|rankings|ranks|unlimited)\b/i;

function pageExists(href) {
  const p = href.replace(/[?#].*$/, '');
  if (p === '' || p === '/') return true;
  if (/^\/(api|v1|r|demo|w|admin|openapi\.yaml)\b/.test(p)) return true;
  const rel = p.replace(/^\//, '').replace(/\/$/, '');
  return fs.existsSync(path.join(ROOT, rel + '.html')) || fs.existsSync(path.join(ROOT, rel, 'index.html')) || fs.existsSync(path.join(ROOT, rel));
}

function check() {
  const errors = [], bad = (m) => errors.push(m);
  const page = fs.existsSync(path.join(ROOT, 'api.html')) ? read('api.html') : '';
  if (page !== build()) bad('api.html is out of date; run node scripts/generate-api-page.js');
  if (!fs.existsSync(path.join(ROOT, 'openapi.yaml')) || read('openapi.yaml') !== yaml()) bad('openapi.yaml is out of date; run node scripts/generate-api-page.js');
  if (TITLE.length > 60) bad('the title is ' + TITLE.length + ' characters, over 60');
  if (DESC.length > 160) bad('the description is ' + DESC.length + ' characters, over 160');
  if ((page.match(/<h1[ >]/g) || []).length !== 1) bad('needs exactly one h1');
  if (!/name="robots" content="index, follow"/.test(page) || !/<link rel="canonical" href="https:\/\/getcitehound\.com\/api" \/>/.test(page)) bad('must be indexable with its canonical address');
  (page.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []).forEach((b) => { try { JSON.parse(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { bad('JSON-LD does not parse: ' + e.message); } });
  const text = visible(page.replace(/<header class="site-header">[\s\S]*?<\/header>/, '').replace(/<footer[\s\S]*?<\/footer>/, ''));
  const hit = FORBIDDEN.exec(text);
  if (hit) bad('a word the brief forbids is on the page: "' + hit[0] + '"');
  if (/\bChatGPT\b|\bClaude\b|\bGemini\b|\bPerplexity\b/.test(text)) bad('the page names an assistant; the API page is about the scan');
  if ((text.match(/—|&mdash;/g) || []).length > 2) bad('too many em dashes for the voice');
  if (!/does not measure whether any assistant names a brand/.test(text)) bad('the page must say the score does not measure whether any assistant names a brand');
  if (page.indexOf('mailto:' + site.contactEmail) === -1) bad('no contact line');
  (page.match(/href="(\/[^"]*)"/g) || []).forEach((m) => { const h = m.slice(6, -1); if (!pageExists(h)) bad('an internal link points at a page that does not exist: ' + h); });
  if (read('sitemap.xml').indexOf('<loc>' + site.baseUrl + '/api</loc>') === -1) bad('sitemap.xml has no /api');
  if (read('llms.txt').indexOf('(' + site.baseUrl + '/api)') === -1) bad('llms.txt has no /api');
  if (require('../lib/site-footer.js').hrefs().indexOf('/api') !== -1) bad('the footer must not link to /api (only the sitemap and llms.txt do)');
  return errors;
}

function main() {
  if (process.argv.indexOf('--check') !== -1) {
    const errors = check();
    if (errors.length) { errors.forEach((e) => console.error('FAIL: ' + e)); process.exit(1); }
    console.log('OK: /api and /openapi.yaml are current (' + OA.ENDPOINTS.length + ' endpoints from the registry); no forbidden claim; one h1; JSON-LD parses; internal links resolve; in the sitemap and llms.txt only');
    return;
  }
  fs.writeFileSync(path.join(ROOT, 'api.html'), build(), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'openapi.yaml'), yaml(), 'utf8');
  console.log('written: api.html, openapi.yaml' + (ensureSitemap() ? ', sitemap.xml entry' : '') + (ensureLlms() ? ', llms.txt entry' : ''));
}

if (require.main === module) main();
module.exports = { build: build, check: check, yaml: yaml, emit: emit };
