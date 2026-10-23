'use strict';

const { CliError, SIGNUP, NOTE, HINT, redact, normalizeDomain } = require('./util.js');
const { createClient } = require('./client.js');
const fmt = require('./format.js');
const VERSION = require('../package.json').version;

const SCHEMA_TYPES = ['organization', 'faqpage', 'article', 'product', 'localbusiness'];

const HELP = `citehound ${VERSION}: scan a domain for AI readiness from the command line.

Usage
  citehound scan <domain>                          Score a domain out of 100 and list what to fix, most valuable first
  citehound compare <domain-a> <domain-b>          Scan two domains and show where they differ
  citehound crawlers [domain]                      List the 10 AI crawlers, or show their state in a domain's robots.txt
  citehound generate llms-txt <domain>             Write an llms.txt (--name, --description, --page "<url>|<description>")
  citehound generate robots-txt <domain>           Write a robots.txt for AI crawlers (--allow a,b --block c,d --sitemap <url>)
  citehound generate schema <domain>               Write JSON-LD from the site's homepage (--type organization|faqpage|article|product|localbusiness)

Options
  --json                 Print JSON instead of text
  --fail-under <score>   For scan and compare: exit with code 1 if a score is below this number (0 to 100)
  -q, --quiet            Leave out the one-line note about plans that follows a scan (or set CITEHOUND_NO_HINTS=1)
  -h, --help             Show this help
  -v, --version          Show the version

Key
  No key is needed. The public endpoint has public limits. For higher limits, get a free key at ${SIGNUP}
  and set it in the environment: CITEHOUND_API_KEY=chk_... (it is never printed).

Exit codes
  0 done   1 below --fail-under   2 the command was not understood   3 Citehound could not be reached or could not do it

The score is a readiness score: crawler access and on-page signals. It does not measure whether any assistant names a brand.
Generated files are printed to standard output, so you can redirect them: citehound generate robots-txt example.com > robots.txt
`;

const VALUE_FLAGS = { '--fail-under': 'failUnder', '--type': 'type', '--allow': 'allow', '--block': 'block', '--sitemap': 'sitemap', '--name': 'name', '--description': 'description', '--page': 'page' };
const BOOL_FLAGS = { '--json': 'json', '--quiet': 'quiet', '-q': 'quiet', '--help': 'help', '-h': 'help', '--version': 'version', '-v': 'version', '--no-sitemap': 'noSitemap' };

function parseArgs(argv) {
  const o = { _: [], page: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { o._.push.apply(o._, argv.slice(i + 1)); break; }
    if (/^-/.test(a) && a.length > 1) {
      const eq = a.indexOf('='), name = eq === -1 ? a : a.slice(0, eq);
      if (BOOL_FLAGS[name]) { o[BOOL_FLAGS[name]] = true; continue; }
      if (VALUE_FLAGS[name]) {
        const v = eq === -1 ? argv[++i] : a.slice(eq + 1);
        if (v === undefined || (eq === -1 && /^--/.test(v))) throw new CliError(name + ' needs a value. Example: ' + name + ' ' + ({ '--fail-under': '70', '--type': 'organization', '--allow': 'GPTBot,ClaudeBot', '--block': 'Bytespider', '--sitemap': 'https://example.com/sitemap.xml', '--name': '"Example"', '--description': '"What the site is"', '--page': '"https://example.com/pricing|Plans"' }[name]) + '.', 2);
        if (name === '--page') o.page.push(v); else o[VALUE_FLAGS[name]] = v;
        continue;
      }
      throw new CliError('Unknown option ' + redact(name) + '. Run "citehound --help" to see the options.', 2);
    }
    o._.push(a);
  }
  return o;
}

function domainArg(raw, what) {
  if (raw === undefined) throw new CliError('Give ' + what + '. Example: citehound scan example.com', 2);
  const d = normalizeDomain(raw);
  if (!d) throw new CliError('"' + redact(String(raw).slice(0, 80)) + '" is not a domain. Give a domain such as example.com (no spaces, no port).', 2);
  return d;
}
function list(v) { return String(v || '').split(',').map((s) => s.trim()).filter(Boolean); }

async function main(argv, env, io, fetchImpl) {
  const o = parseArgs(argv);
  if (o.version) { io.out(VERSION + '\n'); return 0; }
  if (o.help || !o._.length || o._[0] === 'help') { io.out(HELP); return 0; }
  const cmd = o._[0];
  if (['scan', 'compare', 'crawlers', 'generate'].indexOf(cmd) === -1) throw new CliError('Unknown command "' + redact(cmd.slice(0, 40)) + '". Run "citehound --help" to see the commands.', 2);
  let floor = null;
  if (o.failUnder !== undefined) {
    if (cmd !== 'scan' && cmd !== 'compare') throw new CliError('--fail-under works with scan and compare.', 2);
    if (!/^\d{1,3}$/.test(o.failUnder) || +o.failUnder > 100) throw new CliError('--fail-under needs a whole number from 0 to 100. Example: --fail-under 70', 2);
    floor = +o.failUnder;
  }
  const json = (v) => io.out(JSON.stringify(v, null, 2) + '\n');
  const client = createClient(env, fetchImpl, VERSION);

  if (cmd === 'scan') {
    const domain = domainArg(o._[1], 'a domain to scan');
    if (o._.length > 2) throw new CliError('scan takes one domain. To compare two, use: citehound compare a.com b.com', 2);
    const s = await client.scan(domain);
    if (o.json) json(s); else io.out(fmt.scanText(s));
    if (!o.json && !o.quiet && !/^(1|true|yes)$/i.test(String(env.CITEHOUND_NO_HINTS || ''))) {
      // The line goes to standard error, so a redirected scan stays clean. Without a key, or on the Free plan: a paid plan sees nothing, and neither does a key whose plan could not be read.
      const free = !client.keyed || !!s.plan_note || (await client.plan()) === 'free';
      if (free) io.err(HINT + '\n');
    }
    if (s.plan_note) io.err('Your key\'s plan has less than the public output, so the full result came from the public endpoint. ' + s.plan_note + '\n');
    if (floor !== null && s.score < floor) { io.err('Score ' + s.score + ' is below --fail-under ' + floor + '.\n'); return 1; }
    return 0;
  }

  if (cmd === 'compare') {
    const a = domainArg(o._[1], 'two domains to compare'), b = domainArg(o._[2], 'a second domain to compare with');
    if (a === b) throw new CliError('Give two different domains.', 2);
    if (o._.length > 3) throw new CliError('compare takes two domains.', 2);
    const c = await client.compare(a, b);
    if (o.json) json(c); else io.out(fmt.compareText(c));
    if (c.plan_note) io.err('Your key\'s plan does not include compare, so the result came from the public endpoint. ' + c.plan_note + '\n');
    const low = [c.a, c.b].filter((x) => floor !== null && x.score < floor);
    if (low.length) { io.err(low.map((x) => x.domain + ' scored ' + x.score).join(', ') + ', below --fail-under ' + floor + '.\n'); return 1; }
    return 0;
  }

  if (cmd === 'crawlers') {
    if (o._.length > 2) throw new CliError('crawlers takes at most one domain.', 2);
    if (o._[1] === undefined) { const l = await client.crawlerList(); if (o.json) json({ crawlers: l }); else io.out(fmt.crawlerListText(l)); return 0; }
    const r = await client.crawlersFor(domainArg(o._[1], 'a domain'));
    if (o.json) json(r); else io.out(fmt.crawlersForText(r));
    return 0;
  }

  // generate
  const kind = o._[1];
  if (['llms-txt', 'robots-txt', 'schema'].indexOf(kind) === -1) throw new CliError('generate needs one of: llms-txt, robots-txt, schema. Example: citehound generate robots-txt example.com', 2);
  const domain = domainArg(o._[2], 'a domain');
  if (o._.length > 3) throw new CliError('generate takes one domain.', 2);

  if (kind === 'schema') {
    const type = (o.type || 'organization').toLowerCase();
    if (SCHEMA_TYPES.indexOf(type) === -1) throw new CliError('--type must be one of: ' + SCHEMA_TYPES.join(', ') + '.', 2);
    const r = await client.schema(domain, type);
    if (o.json) json({ domain: domain, type: type, json_ld: r.json_ld }); else { io.out(JSON.stringify(r.json_ld, null, 2) + '\n'); if (r.note) io.err(r.note + '\n'); io.err('Paste this inside <script type="application/ld+json"> in the <head> of the page. Fill in anything left in [square brackets] first.\n'); }
    return 0;
  }

  if (kind === 'robots-txt') {
    if (o.sitemap && !/^https?:\/\/\S+$/.test(o.sitemap)) throw new CliError('--sitemap must be a full address such as https://example.com/sitemap.xml.', 2);
    let allow = list(o.allow), block = list(o.block);
    if (!allow.length && !block.length) {   // the project's own defaults for the tracked crawlers
      const l = await client.crawlerList();
      allow = l.filter((c) => c.default === 'allow').map((c) => c.name); block = l.filter((c) => c.default === 'block').map((c) => c.name);
    }
    const sitemap = o.noSitemap ? undefined : (o.sitemap || 'https://' + domain + '/sitemap.xml');
    const gen = await client.robots(allow, block, sitemap), text = gen.text;
    if (o.json) json({ domain: domain, type: 'robots.txt', allow: allow, block: block, sitemap: sitemap || null, content: text }); else { io.out(text); if (gen.note) io.err(gen.note + '\n'); io.err('Put this at https://' + domain + '/robots.txt. If the site already has a robots.txt, merge the AI crawler groups into it instead of replacing it.\n'); }
    return 0;
  }

  // llms-txt
  let pages = o.page.map((p) => { const i = p.indexOf('|'); const url = i === -1 ? p : p.slice(0, i), description = i === -1 ? '' : p.slice(i + 1).trim(); if (!/^https?:\/\/\S+$/.test(url.trim()) || !description) throw new CliError('--page needs "<url>|<description>", for example --page "https://example.com/pricing|Plans and prices".', 2); return { url: url.trim(), description: description }; });
  if (!pages.length) pages = [{ url: 'https://' + domain + '/', description: 'Homepage' }];
  let name = o.name, description = o.description;
  if (!name || !description) {
    const info = (await client.schema(domain, 'organization')).json_ld;
    const graph = (info && info['@graph']) || [];
    const org = graph.filter((g) => g['@type'] === 'Organization')[0] || {}, web = graph.filter((g) => g['@type'] === 'WebSite')[0] || {};
    const real = (v) => typeof v === 'string' && v && v.charAt(0) !== '[';
    if (!name) name = real(org.name) ? org.name : (real(web.name) ? web.name : domain);
    if (!description) description = real(org.description) ? org.description : '[One sentence describing ' + name + '.]';
  }
  const gen = await client.llms(name, description, pages), text = gen.text;
  if (o.json) json({ domain: domain, type: 'llms.txt', content: text, pages: pages }); else { io.out(text); if (gen.note) io.err(gen.note + '\n'); io.err('Put this at https://' + domain + '/llms.txt. Check the description and the pages first. llms.txt is optional and has no demonstrated effect on Google.\n'); }
  return 0;
}

// run() never throws and never prints a stack trace: a CliError prints its message, anything else prints a plain apology.
async function run(argv, env, io, fetchImpl) {
  try { return await main(argv, env || {}, io, fetchImpl || globalThis.fetch); }
  catch (e) {
    if (e instanceof CliError) { io.err(redact(e.message) + '\n'); return e.exitCode; }
    io.err('citehound: something went wrong that this version did not expect. Try again, or write to hey@getcitehound.com.\n');
    return 3;
  }
}

module.exports = { run, parseArgs, HELP, NOTE };
