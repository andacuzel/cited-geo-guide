'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fx, KEY, reply, mockFetch, mcp, runCli, mcpError } = require('./helpers.js');
const parse = require('../src/parse.js');
const { normalizeDomain, redact } = require('../src/util.js');
const { parseArgs } = require('../src/cli.js');

const V1_SCAN = { domain: 'example.com', scannedAt: '2026-10-22T12:00:00.000Z', score: 62, pillars: [{ id: 'discover', name: 'Discoverability', score: 20, max: 40 }, { id: 'tech', name: 'Technical foundation', score: 12, max: 20 }, { id: 'trust', name: 'Content & trust', score: 30, max: 40 }],
  failed: [{ label: 'llms.txt present', pillar: 'Discoverability', points: 0, max: 4, fix: 'Add an llms.txt at the site root' }, { label: 'Meta description', pillar: 'Technical foundation', points: 0, max: 4, fix: 'Write a meta description' }],
  crawlers: [{ name: 'GPTBot', vendor: 'OpenAI', state: 'blocked', rule: 'Disallow: /' }, { name: 'ClaudeBot', vendor: 'Anthropic', state: 'open', rule: null }], crawlerSummary: { open: 1, limited: 0, blocked: 1 }, benchmark: { overallAverage: 73, sitesScanned: 219, categories: 6, delta: -11, position: 'below the average' },
  note: 'A readiness score: crawler access and on-page signals. It does not measure whether any assistant names a brand.', method: 'https://getcitehound.com/methodology' };
const v1 = (map) => (url, init) => { for (const k of Object.keys(map)) if (url.indexOf('/v1' + k) !== -1) { const r = map[k]; return typeof r === 'function' ? r(url, init) : reply(200, r); } return reply(404, { error: 'not_found', message: 'No such endpoint.' }); };

/* ---------- reading the public endpoint's text ---------- */

test('parseScan reads the real answer of the public endpoint', () => {
  const text = JSON.parse(fx('mcp-scan')).result.content[0].text;
  const s = parse.parseScan(text);
  assert.equal(s.domain, 'getcitehound.com'); assert.equal(s.score, 87);
  assert.deepEqual(s.pillars.map((p) => [p.id, p.score, p.max]), [['discover', 27, 40], ['tech', 20, 20], ['trust', 40, 40]]);
  assert.equal(s.crawlers.length, 10); assert.deepEqual(s.crawlerSummary, { open: 0, limited: 10, blocked: 0 });
  assert.equal(s.failed.length, 1); assert.equal(s.failed[0].points, 13); assert.equal(s.failed[0].max, 26); assert.match(s.failed[0].label, /AI crawler access/); assert.match(s.failed[0].fix, /^Review robots\.txt/);
  assert.equal(s.benchmark.overallAverage, 73); assert.equal(s.benchmark.sitesScanned, 219); assert.equal(s.benchmark.delta, 14);
});
test('parseScan refuses text it does not understand instead of guessing a score', () => {
  assert.throws(() => parse.parseScan('hello'), /could not read the answer/);
});
test('parseCompare, parseCrawlerList, fileBody and parseSchema read the real answers', () => {
  const t = (n) => JSON.parse(fx('mcp-' + n)).result.content[0].text;
  const c = parse.parseCompare(t('compare'));
  assert.equal(c.a.domain, 'getcitehound.com'); assert.equal(c.b.score, 29); assert.equal(c.differences.length, 15); assert.deepEqual(c.differences[3], { check: 'AI crawler access', a: { points: 13 }, b: { points: 26 }, max: 26 });
  const l = parse.parseCrawlerList(t('crawlers'));
  assert.equal(l.length, 10); assert.equal(l[0].name, 'GPTBot'); assert.equal(l[0].vendor, 'OpenAI'); assert.equal(l[9].name, 'Bytespider'); assert.equal(l[9].default, 'block');
  assert.equal(parse.fileBody(t('robots')).split('\n')[0], 'User-agent: GPTBot'); assert.ok(parse.fileBody(t('llms')).startsWith('# Example\n'));
  assert.equal(parse.parseSchema(t('schema'))['@context'], 'https://schema.org');
});

/* ---------- arguments and usage errors ---------- */

test('a domain is cleaned: scheme, www, path and case are removed; anything else is refused', () => {
  assert.equal(normalizeDomain('https://WWW.Example.com/pricing?x=1'), 'example.com');
  assert.equal(normalizeDomain('sub.example.co.uk'), 'sub.example.co.uk');
  for (const bad of ['', 'localhost', 'example', 'exa mple.com', 'user@example.com', 'example.com:8080', '-x.com', 12, null]) assert.equal(normalizeDomain(bad), null, String(bad));
});
test('options: --flag value and --flag=value, repeated --page, unknown options are refused', () => {
  assert.deepEqual(parseArgs(['scan', 'a.com', '--fail-under=70', '--json']), { _: ['scan', 'a.com'], page: [], failUnder: '70', json: true });
  assert.deepEqual(parseArgs(['x', '--page', 'a|b', '--page', 'c|d']).page, ['a|b', 'c|d']);
  assert.throws(() => parseArgs(['scan', '--nope']), /Unknown option/);
  assert.throws(() => parseArgs(['scan', 'a.com', '--fail-under']), /needs a value/);
});
test('help and version print and exit 0 without touching the network', async () => {
  const f = mockFetch(() => { throw new Error('no network'); });
  const h = await runCli(['--help'], {}, f), v = await runCli(['--version'], {}, f), none = await runCli([], {}, f);
  assert.equal(h.code, 0); assert.match(h.out, /citehound scan <domain>/); assert.match(h.out, /does not measure whether any assistant names a brand/); assert.match(h.out, /https:\/\/getcitehound\.com\/api/);
  assert.equal(v.code, 0); assert.match(v.out, /^\d+\.\d+\.\d+\n$/); assert.equal(none.code, 0); assert.equal(f.calls.length, 0);
});
test('usage errors exit 2 with a plain message and no stack trace', async () => {
  const f = mockFetch(() => { throw new Error('no network'); });
  const cases = [[['scan'], /Give a domain/], [['scan', 'not a domain'], /is not a domain/], [['scan', 'a.com', 'b.com'], /one domain/], [['compare', 'a.com'], /second domain/], [['compare', 'a.com', 'a.com'], /two different domains/], [['bogus'], /Unknown command/], [['generate'], /generate needs/], [['generate', 'nope', 'a.com'], /generate needs/],
    [['generate', 'schema', 'a.com', '--type', 'cookbook'], /--type must be/], [['scan', 'a.com', '--fail-under', 'high'], /whole number/], [['scan', 'a.com', '--fail-under', '101'], /0 to 100/], [['crawlers', '--fail-under', '5'], /works with scan and compare/], [['generate', 'robots-txt', 'a.com', '--sitemap', 'nope'], /full address/], [['generate', 'llms-txt', 'a.com', '--page', 'nope'], /<url>\|<description>/]];
  for (const [args, re] of cases) { const r = await runCli(args, {}, f); assert.equal(r.code, 2, args.join(' ')); assert.match(r.err, re, args.join(' ')); assert.doesNotMatch(r.err + r.out, /at .*\.js:\d+|Error:|node:internal/); }
  assert.equal(f.calls.length, 0);
});

/* ---------- scan ---------- */

test('scan without a key uses the public endpoint, sends no credential, and prints the score and the fixes', async () => {
  const f = mockFetch(mcp());
  const r = await runCli(['scan', 'HTTPS://www.GetCitehound.com/'], {}, f);
  assert.equal(r.code, 0); assert.match(r.out, /^getcitehound\.com: 87\/100/); assert.match(r.out, /Discoverability\s+27\/40/); assert.match(r.out, /AI crawlers: 0 open, 10 limited, 0 blocked/); assert.match(r.out, /1\. AI crawler access \(0\/10 open\): 13 of 26 points/);
  assert.match(r.out, /does not measure whether any assistant names a brand/);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].url, 'https://getcitehound.com/api/mcp'); assert.equal(f.calls[0].method, 'POST');
  assert.deepEqual(f.calls[0].body.params, { name: 'scan_site', arguments: { domain: 'getcitehound.com' } });
  assert.equal(f.calls[0].headers.Authorization, undefined); assert.match(f.calls[0].headers['User-Agent'], /^citehound-cli\/\d/);
});
test('scan --json prints the same shape the API returns, marked with its source', async () => {
  const r = await runCli(['scan', 'getcitehound.com', '--json'], {}, mockFetch(mcp()));
  const j = JSON.parse(r.out);
  assert.equal(j.source, 'public'); assert.equal(j.score, 87); assert.equal(j.pillars.length, 3); assert.equal(j.crawlers.length, 10); assert.ok(Array.isArray(j.failed)); assert.match(j.note, /readiness score/);
});
test('scan with a key uses GET /v1/scan with a Bearer header and prints the same kind of text', async () => {
  const f = mockFetch(v1({ '/scan': V1_SCAN }));
  const r = await runCli(['scan', 'example.com'], { CITEHOUND_API_KEY: KEY }, f);
  assert.equal(r.code, 0); assert.match(r.out, /^example\.com: 62\/100/); assert.match(r.out, /Blocked: GPTBot/); assert.match(r.out, /11 points below the average of the 219 sites/);
  assert.equal(f.calls[0].url, 'https://getcitehound.com/v1/scan?domain=example.com'); assert.equal(f.calls[0].method, 'GET'); assert.equal(f.calls[0].headers.Authorization, 'Bearer ' + KEY);
  assert.equal(JSON.parse((await runCli(['scan', 'example.com', '--json'], { CITEHOUND_API_KEY: KEY }, f)).out).source, 'api_key');
});
test('the key is never printed: not in the output, not in any error, not in the JSON', async () => {
  const leaks = [reply(401, { error: 'invalid_key', message: 'Key ' + KEY + ' is not valid.' }), reply(403, { error: 'key_revoked', message: 'The key ' + KEY + ' was revoked.' }), reply(500, 'server said ' + KEY), reply(502, { error: 'scan_failed', message: 'Failed for ' + KEY })];
  for (const l of leaks) { const r = await runCli(['scan', 'example.com'], { CITEHOUND_API_KEY: KEY }, mockFetch(() => l)); assert.equal(r.code, 3); assert.ok(!(r.out + r.err).includes(KEY), 'status ' + l.status); }
  const ok = await runCli(['scan', 'example.com', '--json'], { CITEHOUND_API_KEY: KEY }, mockFetch(v1({ '/scan': V1_SCAN })));
  assert.ok(!(ok.out + ok.err).includes(KEY));
  assert.equal(redact('x ' + KEY + ' y'), 'x chk_… y');
});
test('a malformed key is refused without printing it, and a key is not sent over plain http', async () => {
  const bad = await runCli(['scan', 'example.com'], { CITEHOUND_API_KEY: 'chk_short' }, mockFetch(() => { throw new Error('no network'); }));
  assert.equal(bad.code, 2); assert.match(bad.err, /does not look like a Citehound key/); assert.ok(!bad.err.includes('chk_short'));
  const http = await runCli(['scan', 'example.com'], { CITEHOUND_API_KEY: KEY, CITEHOUND_API_URL: 'http://example.org' }, mockFetch(() => { throw new Error('no network'); }));
  assert.equal(http.code, 2); assert.match(http.err, /only sent over https/); assert.ok(!http.err.includes(KEY));
});
test('--fail-under: exit 1 below the number, 0 at or above it, and the report is still printed', async () => {
  const f = mockFetch(mcp());
  const below = await runCli(['scan', 'getcitehound.com', '--fail-under', '90'], {}, f), at = await runCli(['scan', 'getcitehound.com', '--fail-under', '87'], {}, f), zero = await runCli(['scan', 'getcitehound.com', '--fail-under=0'], {}, f);
  assert.equal(below.code, 1); assert.match(below.out, /87\/100/); assert.match(below.err, /Score 87 is below --fail-under 90/); assert.equal(at.code, 0); assert.equal(zero.code, 0);
  assert.equal((await runCli(['scan', 'getcitehound.com', '--json', '--fail-under', '95'], {}, f)).code, 1);
});

/* ---------- limits and errors ---------- */

test('a rate limit without a key explains how to get a free key', async () => {
  for (const r of [await runCli(['scan', 'a.com'], {}, mockFetch(() => reply(429, 'slow down', { 'retry-after': '120' }))), await runCli(['scan', 'a.com'], {}, mockFetch(() => mcpError('Rate limit reached for a.com: try again in 40 minutes.')))]) {
    assert.equal(r.code, 3); assert.match(r.err, /public limit was reached/); assert.match(r.err, /get a free one/); assert.match(r.err, /https:\/\/getcitehound\.com\/api/); assert.match(r.err, /CITEHOUND_API_KEY/);
  }
  const withRetry = await runCli(['scan', 'a.com'], {}, mockFetch(() => reply(429, '', { 'retry-after': '120' })));
  assert.match(withRetry.err, /about 120 seconds/);
});
test('a rate limit with a key says so and does not offer a key', async () => {
  const r = await runCli(['scan', 'a.com'], { CITEHOUND_API_KEY: KEY }, mockFetch(() => reply(429, { error: 'rate_limited', message: 'x' }, { 'retry-after': '30' })));
  assert.equal(r.code, 3); assert.match(r.err, /limit of your API key/); assert.match(r.err, /30 seconds/); assert.doesNotMatch(r.err, /get one at/);
});
test('plain messages for 401, 403, 503, a scan that failed, a bad domain, a timeout, no network and a page that is not JSON', async () => {
  const k = { CITEHOUND_API_KEY: KEY };
  const t = async (resp, env, re, code) => { const r = await runCli(['scan', 'a.com'], env, mockFetch(typeof resp === 'function' ? resp : () => resp)); assert.equal(r.code, code === undefined ? 3 : code); assert.match(r.err, re); assert.doesNotMatch(r.err, /at .*\.js:\d+|node:internal|TypeError|\[object/); return r; };
  await t(reply(401, { error: 'invalid_key', message: 'x' }), k, /did not accept that API key/);
  await t(reply(403, { error: 'key_revoked', message: 'That key has been revoked.' }), k, /revoked/);
  await t(reply(503, { error: 'not_configured', message: 'x' }), {}, /not available right now/);
  await t(reply(502, { error: 'scan_failed', message: 'Could not read https://a.com/robots.txt (dns).' }), k, /Could not read https:\/\/a\.com\/robots\.txt/);
  await t(mcpError('Could not read https://a.com/robots.txt (network), so the score would not be reliable.'), {}, /Could not read/);
  await t(mcpError('Invalid or missing "domain".'), {}, /Invalid or missing/, 2);
  await t(() => { const e = new Error('aborted'); e.name = 'TimeoutError'; throw e; }, {}, /did not answer in time/);
  await t(() => { const e = new TypeError('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e; }, {}, /Could not reach getcitehound\.com \(ENOTFOUND\)\. Check your connection/);
  await t(reply(200, '<html>'), {}, /not JSON/);
  await t(reply(200, '{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"hello"}]}}'), {}, /could not read the answer/);
  await t(reply(418, 'teapot'), {}, /HTTP 418/);
});
test('an unexpected exception prints a plain apology, never a stack, and exits 3', async () => {
  const r = await runCli(['scan', 'a.com'], {}, async () => ({ status: 200, headers: null, text: async () => { throw new RangeError('boom ' + KEY); } }));
  assert.equal(r.code, 3); assert.match(r.err, /something went wrong that this version did not expect/); assert.ok(!(r.err + r.out).includes('boom') && !(r.err + r.out).includes(KEY));
});
test('the public MCP endpoint may answer as an event stream', async () => {
  const body = 'event: message\ndata: ' + fx('mcp-scan').trim() + '\n\n';
  const r = await runCli(['scan', 'getcitehound.com'], {}, mockFetch(() => reply(200, body)));
  assert.equal(r.code, 0); assert.match(r.out, /87\/100/);
});

/* ---------- compare ---------- */

test('compare without a key calls compare_sites once and prints both scores and the differences', async () => {
  const f = mockFetch(mcp());
  const r = await runCli(['compare', 'getcitehound.com', 'www.Example.com'], {}, f);
  assert.equal(r.code, 0); assert.match(r.out, /getcitehound\.com: 87\/100\nexample\.com: 29\/100/); assert.match(r.out, /Where they differ/); assert.match(r.out, /AI crawler access\s+13\/26\s+26\/26/);
  assert.deepEqual(f.calls[0].body.params, { name: 'compare_sites', arguments: { domain_a: 'getcitehound.com', domain_b: 'example.com' } });
  assert.equal(JSON.parse((await runCli(['compare', 'getcitehound.com', 'example.com', '--json'], {}, f)).out).differences.length, 15);
});
test('compare with a key uses GET /v1/compare; --fail-under fails if either site is below it', async () => {
  const V1C = { a: Object.assign({}, V1_SCAN, { domain: 'a.com', score: 80 }), b: Object.assign({}, V1_SCAN, { domain: 'b.com', score: 55 }), differences: [{ check: 'Meta description', a: { passed: true, points: 4 }, b: { passed: false, points: 0 }, max: 4 }], note: V1_SCAN.note };
  const f = mockFetch(v1({ '/compare': V1C }));
  const r = await runCli(['compare', 'a.com', 'b.com'], { CITEHOUND_API_KEY: KEY }, f);
  assert.equal(r.code, 0); assert.match(r.out, /a\.com: 80\/100\nb\.com: 55\/100/); assert.match(r.out, /Meta description\s+4\/4\s+0\/4/);
  assert.equal(f.calls[0].url, 'https://getcitehound.com/v1/compare?a=a.com&b=b.com'); assert.equal(f.calls[0].headers.Authorization, 'Bearer ' + KEY);
  const fail = await runCli(['compare', 'a.com', 'b.com', '--fail-under', '60'], { CITEHOUND_API_KEY: KEY }, f);
  assert.equal(fail.code, 1); assert.match(fail.err, /b\.com scored 55, below --fail-under 60/); assert.doesNotMatch(fail.err, /a\.com scored/);
  assert.equal((await runCli(['compare', 'a.com', 'b.com', '--fail-under', '50'], { CITEHOUND_API_KEY: KEY }, f)).code, 0);
});
test('compare says so when only one site could be read', async () => {
  const r = await runCli(['compare', 'a.com', 'b.com'], {}, mockFetch(() => reply(200, { jsonrpc: '2.0', id: 1, result: { isError: false, content: [{ type: 'text', text: 'Only a.com could be compared. Could not read https://b.com/ (dns).\n\nAI readiness scan — a.com' }] } })));
  assert.equal(r.code, 3); assert.match(r.err, /^Only a\.com could be compared/);
});

/* ---------- crawlers ---------- */

test('crawlers lists the ten tracked crawlers without a key and without scanning anything', async () => {
  const f = mockFetch(mcp());
  const r = await runCli(['crawlers'], { CITEHOUND_API_KEY: KEY }, f);
  assert.equal(r.code, 0); assert.match(r.out, /The 10 AI crawlers Citehound tracks/); assert.match(r.out, /Bytespider\s+ByteDance\s+default: block/);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].body.params.name, 'list_ai_crawlers'); assert.equal(f.calls[0].headers.Authorization, undefined);
  assert.equal(JSON.parse((await runCli(['crawlers', '--json'], {}, f)).out).crawlers.length, 10);
});
test('crawlers <domain> shows each crawler\'s state: from the scan without a key, from /v1/crawlers with one', async () => {
  const a = await runCli(['crawlers', 'getcitehound.com'], {}, mockFetch(mcp()));
  assert.equal(a.code, 0); assert.match(a.out, /GPTBot\s+limited/); assert.match(a.out, /0 open, 10 limited, 0 blocked/);
  const f = mockFetch(v1({ '/crawlers': { domain: 'example.com', scannedAt: 'x', crawlers: V1_SCAN.crawlers, summary: V1_SCAN.crawlerSummary, note: V1_SCAN.note } }));
  const b = await runCli(['crawlers', 'example.com'], { CITEHOUND_API_KEY: KEY }, f);
  assert.match(b.out, /GPTBot\s+blocked\s+Disallow: \//); assert.equal(f.calls[0].url, 'https://getcitehound.com/v1/crawlers?domain=example.com');
});

/* ---------- generate ---------- */

test('generate robots-txt: the file alone on stdout, the hint on stderr; defaults come from the tracked list; flags override', async () => {
  const f = mockFetch(mcp());
  const r = await runCli(['generate', 'robots-txt', 'example.com'], {}, f);
  assert.equal(r.code, 0); assert.match(r.out, /^User-agent: GPTBot\nAllow: \//); assert.doesNotMatch(r.out, /robots\.txt — paste/); assert.match(r.err, /https:\/\/example\.com\/robots\.txt/);
  const gen = f.calls.filter((c) => c.body.params.name === 'generate_robots_txt')[0].body.params.arguments;
  assert.equal(gen.allow.length, 9); assert.deepEqual(gen.block, ['Bytespider']); assert.equal(gen.sitemap_url, 'https://example.com/sitemap.xml');
  const f2 = mockFetch(mcp());
  await runCli(['generate', 'robots-txt', 'example.com', '--allow', 'GPTBot,ClaudeBot', '--block', 'CCBot', '--no-sitemap'], {}, f2);
  assert.equal(f2.calls.length, 1); assert.deepEqual(f2.calls[0].body.params.arguments, { allow: ['GPTBot', 'ClaudeBot'], block: ['CCBot'] });
  const j = JSON.parse((await runCli(['generate', 'robots-txt', 'example.com', '--json'], {}, mockFetch(mcp()))).out);
  assert.equal(j.type, 'robots.txt'); assert.ok(j.content.indexOf('User-agent') === 0);
});
test('generate robots-txt with a key uses /v1/generate/robots-txt', async () => {
  const f = mockFetch(v1({ '/generate/robots-txt': { type: 'robots.txt', content: 'User-agent: GPTBot\nAllow: /' } }));
  const r = await runCli(['generate', 'robots-txt', 'example.com', '--allow', 'GPTBot', '--block', 'Bytespider'], { CITEHOUND_API_KEY: KEY }, f);
  assert.equal(r.out, 'User-agent: GPTBot\nAllow: /\n'); const u = new URL(f.calls[0].url);
  assert.equal(u.pathname, '/v1/generate/robots-txt'); assert.equal(u.searchParams.get('allow'), 'GPTBot'); assert.equal(u.searchParams.get('block'), 'Bytespider'); assert.equal(u.searchParams.get('sitemap'), 'https://example.com/sitemap.xml');
  const calls = mockFetch(mcp());
  assert.equal((await runCli(['generate', 'robots-txt', 'example.com', '--allow', 'GPTBot', '--block', 'GPTBot'], {}, mockFetch(() => mcpError('Crawler(s) listed in both "allow" and "block": GPTBot.')))).code, 2);
  assert.ok(calls);
});
test('generate schema prints the JSON-LD alone on stdout; --type is passed through', async () => {
  const f = mockFetch(mcp());
  const r = await runCli(['generate', 'schema', 'example.com', '--type', 'FAQPage'], {}, f);
  assert.equal(r.code, 0); assert.equal(JSON.parse(r.out)['@context'], 'https://schema.org'); assert.match(r.err, /ld\+json/);
  assert.deepEqual(f.calls[0].body.params.arguments, { domain: 'example.com', type: 'faqpage' });
  const k = mockFetch(v1({ '/generate/schema': { domain: 'example.com', type: 'organization', json_ld: { '@context': 'https://schema.org', '@graph': [] } } }));
  assert.deepEqual(JSON.parse((await runCli(['generate', 'schema', 'example.com', '--json'], { CITEHOUND_API_KEY: KEY }, k)).out), { domain: 'example.com', type: 'organization', json_ld: { '@context': 'https://schema.org', '@graph': [] } });
  assert.equal(k.calls[0].url, 'https://getcitehound.com/v1/generate/schema?domain=example.com&type=organization');
});
test('generate llms-txt: name and description come from the site\'s own schema, never invented; bracketed placeholders are replaced by a visible placeholder', async () => {
  const f = mockFetch(mcp());
  const r = await runCli(['generate', 'llms-txt', 'example.com'], {}, f);
  assert.equal(r.code, 0); assert.match(r.out, /^# Example\n/); assert.match(r.err, /no demonstrated effect on Google/); assert.match(r.err, /https:\/\/example\.com\/llms\.txt/);
  const args = f.calls.filter((c) => c.body.params.name === 'generate_llms_txt')[0].body.params.arguments;
  assert.equal(args.name, 'Example Domain'); assert.equal(args.description, '[One sentence describing Example Domain.]'); assert.deepEqual(args.key_pages, [{ url: 'https://example.com/', description: 'Homepage' }]);
});
test('generate llms-txt with --name, --description and --page makes no call for the site\'s schema', async () => {
  const f = mockFetch(mcp());
  await runCli(['generate', 'llms-txt', 'example.com', '--name', 'Example Co', '--description', 'Project software.', '--page', 'https://example.com/pricing|Plans and prices', '--page', 'https://example.com/docs|Docs'], {}, f);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].body.params.arguments, { name: 'Example Co', description: 'Project software.', key_pages: [{ url: 'https://example.com/pricing', description: 'Plans and prices' }, { url: 'https://example.com/docs', description: 'Docs' }] });
  const k = mockFetch(v1({ '/generate/llms-txt': { type: 'llms.txt', content: '# Example Co\n\n> Project software.' } }));
  const r = await runCli(['generate', 'llms-txt', 'example.com', '--name', 'Example Co', '--description', 'Project software.', '--page', 'https://example.com/pricing|Plans'], { CITEHOUND_API_KEY: KEY }, k);
  assert.equal(r.out, '# Example Co\n\n> Project software.\n'); const u = new URL(k.calls[0].url);
  assert.equal(u.searchParams.get('name'), 'Example Co'); assert.deepEqual(u.searchParams.getAll('page'), ['https://example.com/pricing|Plans']);
});

/* ---------- words ---------- */

test('the text the CLI prints never claims a result: no recommend, cite, rank, guarantee, visibility', async () => {
  const outs = [(await runCli(['--help'], {}, mockFetch(mcp()))).out, (await runCli(['scan', 'getcitehound.com'], {}, mockFetch(mcp()))).out, (await runCli(['compare', 'getcitehound.com', 'example.com'], {}, mockFetch(mcp()))).out, (await runCli(['crawlers'], {}, mockFetch(mcp()))).out].join('\n');
  assert.doesNotMatch(outs.replace(/does not measure whether any assistant names a brand/g, ''), /\b(recommend\w*|cites?\b|cited|ranking\w*|guarantee\w*|visibility|boost\w*)/i);
});

/* ---------- plans (the API gates by plan: a 402 says which) ---------- */

const GATE402 = { error: 'plan_required', required_plan: 'pro', plan: 'free', message: 'Comparing two sites through the API is available on Pro, Fix and Beyond. This key is on the Free plan. See the plans at https://getcitehound.com/pricing.', plans_url: 'https://getcitehound.com/pricing' };
test('a plan gate (402) on a command with no public equivalent prints the API\'s own message, which names the plans and the pricing page, and exits 3', async () => {
  const r = await runCli(['compare', 'a.com', 'b.com'], { CITEHOUND_API_KEY: KEY }, mockFetch(() => reply(402, GATE402)));
  assert.equal(r.code, 3); assert.match(r.err, /available on Pro, Fix and Beyond/); assert.match(r.err, /https:\/\/getcitehound\.com\/pricing/); assert.ok(!(r.err + r.out).includes(KEY));
  const bare = await runCli(['compare', 'a.com', 'b.com'], { CITEHOUND_API_KEY: KEY }, mockFetch(() => reply(402, '{}')));
  assert.match(bare.err, /part of a higher plan/);
});
const both = (map) => (url, init, body) => (/\/api\/mcp$/.test(url) ? mcp()(url, init, body) : v1(map)(url, init));
const FREE_NOTE = 'The full scan detail is available on Pro, Fix and Beyond. See the plans at https://getcitehound.com/pricing.';
test('a Free key is never worse than no key: a trimmed scan is replaced by the full public output, with the plan note on stderr', async () => {
  const trimmed = Object.assign({}, V1_SCAN, { truncated: true, hidden_findings: 5, upgrade: { message: FREE_NOTE, required_plan: 'pro' } });
  const f = mockFetch(both({ '/scan': trimmed }));
  const r = await runCli(['scan', 'getcitehound.com'], { CITEHOUND_API_KEY: KEY }, f);
  assert.equal(r.code, 0); assert.match(r.out, /^getcitehound\.com: 87\/100/); assert.doesNotMatch(r.out, /not shown/); assert.match(r.err, /came from the public endpoint\. The full scan detail is available on Pro, Fix and Beyond/);
  assert.deepEqual(f.calls.map((c) => c.method + ' ' + new URL(c.url).pathname), ['GET /v1/scan', 'POST /api/mcp']); assert.equal(f.calls[1].headers.Authorization, undefined);
  const j = JSON.parse((await runCli(['scan', 'getcitehound.com', '--json'], { CITEHOUND_API_KEY: KEY }, mockFetch(both({ '/scan': trimmed })))).out);
  assert.equal(j.source, 'public'); assert.equal(j.crawlers.length, 10); assert.match(j.plan_note, /available on Pro/);
  const full = await runCli(['scan', 'example.com'], { CITEHOUND_API_KEY: KEY }, mockFetch(both({ '/scan': V1_SCAN })));
  assert.match(full.out, /^example\.com: 62\/100/); assert.equal(full.err, '');
});
test('a Free key\'s compare, preview files and non-organization schema come from the public endpoint, with the plan\'s message on stderr', async () => {
  const f = mockFetch((url, init, body) => (/\/api\/mcp$/.test(url) ? mcp()(url, init, body) : (/\/compare/.test(url) ? reply(402, GATE402) : (/generate\/schema/.test(url) ? reply(402, GATE402) : reply(200, { type: 'robots.txt', content: 'User-agent: GPTBot\n', preview: true, truncated: true, upgrade: { message: 'The full generated file is available on Pro, Fix and Beyond.' } })))));
  const c = await runCli(['compare', 'getcitehound.com', 'example.com'], { CITEHOUND_API_KEY: KEY }, f);
  assert.equal(c.code, 0); assert.match(c.out, /getcitehound\.com: 87\/100\nexample\.com: 29\/100/); assert.match(c.err, /does not include compare.*available on Pro, Fix and Beyond/);
  const s = await runCli(['generate', 'schema', 'example.com', '--type', 'faqpage'], { CITEHOUND_API_KEY: KEY }, f);
  assert.equal(s.code, 0); assert.equal(JSON.parse(s.out)['@context'], 'https://schema.org'); assert.match(s.err, /available on Pro, Fix and Beyond/);
  const r = await runCli(['generate', 'robots-txt', 'example.com', '--allow', 'GPTBot', '--block', 'Bytespider'], { CITEHOUND_API_KEY: KEY }, f);
  assert.match(r.out, /^User-agent: GPTBot\nAllow: \/\n/); assert.ok(r.out.split('\n').length > 5); assert.match(r.err, /full generated file is available on Pro/);
  const l = await runCli(['generate', 'llms-txt', 'example.com', '--name', 'E', '--description', 'D'], { CITEHOUND_API_KEY: KEY }, mockFetch((url, init, body) => (/\/api\/mcp$/.test(url) ? mcp()(url, init, body) : reply(200, { type: 'llms.txt', content: '# E\n', preview: true, upgrade: { message: 'full file on Pro' } }))));
  assert.match(l.out, /^# Example\n/); assert.match(l.err, /full file on Pro/);
  assert.ok(!(c.err + s.err + r.err + l.err + c.out).includes(KEY));
});
test('a plan gate that has no public equivalent (the key is Free, the command is monitoring-only) still prints the API\'s message and exits 3', async () => {
  const r = await runCli(['compare', 'a.com', 'b.com'], { CITEHOUND_API_KEY: KEY }, mockFetch(() => reply(402, GATE402)));
  assert.equal(r.code, 3); assert.match(r.err, /available on Pro, Fix and Beyond/);
});
test('the rate-limit message names the plans', async () => {
  const keyless = await runCli(['scan', 'a.com'], {}, mockFetch(() => reply(429, '', { 'retry-after': '60' })));
  assert.match(keyless.err, /Paid plans have higher limits: https:\/\/getcitehound\.com\/pricing/);
  const keyed = await runCli(['scan', 'a.com'], { CITEHOUND_API_KEY: KEY }, mockFetch(() => reply(429, '{}', { 'retry-after': '60' })));
  assert.match(keyed.err, /plans at https:\/\/getcitehound\.com\/pricing/);
});

/* ---------- the one-line plan hint ---------- */

const HINT = 'Watch this domain weekly and get alerts: Pro. Ready-to-paste fixes: Fix. See https://getcitehound.com/pricing';
const meOf = (plan) => (url, init, body) => (/\/v1\/me$/.test(url) ? reply(200, { plan: plan }) : both({ '/scan': V1_SCAN })(url, init, body));
test('the hint: one plain line on stderr after a scan without a key; stdout and --json stay clean', async () => {
  const r = await runCli(['scan', 'example.com'], {}, mockFetch(mcp()));
  assert.equal(r.code, 0); assert.equal(r.err, HINT + '\n'); assert.ok(!r.out.includes('pricing'));
  assert.equal((await runCli(['scan', 'example.com', '--json'], {}, mockFetch(mcp()))).err, '');
  const low = await runCli(['scan', 'example.com', '--fail-under', '99'], {}, mockFetch(mcp()));
  assert.equal(low.code, 1); assert.match(low.err, /^Watch this domain weekly/);
});
test('the hint: a Free key sees it (trimmed scan, or a full one when /v1/me says free); Pro, Fix and Beyond never do; an unreadable plan shows nothing', async () => {
  const trimmed = Object.assign({}, V1_SCAN, { truncated: true, hidden_findings: 5, upgrade: { message: FREE_NOTE, required_plan: 'pro' } });
  const t = await runCli(['scan', 'example.com'], { CITEHOUND_API_KEY: KEY }, mockFetch(both({ '/scan': trimmed })));
  assert.ok(t.err.includes(HINT));
  const free = await runCli(['scan', 'example.com'], { CITEHOUND_API_KEY: KEY }, mockFetch(meOf('free')));
  assert.equal(free.err, HINT + '\n');
  for (const plan of ['pro', 'fix', 'beyond']) { const f = mockFetch(meOf(plan)); const r = await runCli(['scan', 'example.com'], { CITEHOUND_API_KEY: KEY }, f); assert.equal(r.err, '', plan); assert.equal(f.calls.map((c) => new URL(c.url).pathname).join(), '/v1/scan,/v1/me'); }
  const unread = await runCli(['scan', 'example.com'], { CITEHOUND_API_KEY: KEY }, mockFetch(both({ '/scan': V1_SCAN })));
  assert.equal(unread.err, '');
  assert.ok(!(free.err + free.out).includes(KEY));
});
test('the hint can be turned off: --quiet, -q and CITEHOUND_NO_HINTS=1 (and no /v1/me call is made then)', async () => {
  for (const [args, env] of [[['--quiet'], {}], [['-q'], {}], [[], { CITEHOUND_NO_HINTS: '1' }], [[], { CITEHOUND_NO_HINTS: 'true' }]]) {
    const r = await runCli(['scan', 'example.com'].concat(args), env, mockFetch(mcp())); assert.equal(r.err, '', args.join() + JSON.stringify(env)); assert.equal(r.code, 0);
  }
  const f = mockFetch(meOf('free')); await runCli(['scan', 'example.com', '-q'], { CITEHOUND_API_KEY: KEY }, f); assert.equal(f.calls.length, 1);
  assert.equal((await runCli(['scan', 'example.com'], { CITEHOUND_NO_HINTS: '0' }, mockFetch(mcp()))).err, HINT + '\n');
});
test('the hint is only for scan: compare, crawlers and generate print none, and the hint makes no promise', async () => {
  assert.equal((await runCli(['crawlers'], {}, mockFetch(mcp()))).err, '');
  assert.equal((await runCli(['compare', 'a.com', 'b.com'], {}, mockFetch(mcp()))).err, '');
  assert.doesNotMatch(HINT, /\b(recommend|cite|cited|rank|ranking|guarantee|visibility|limited time|hurry|now)\b/i);
});
