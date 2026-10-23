#!/usr/bin/env node
/* =====================================================================
   scripts/generate-og.js: the share images, 1200x630 PNG, one per page type (lib/og.js lists the types and which page uses which). They are drawn from HTML templates with
   headless Chromium and the site's own fonts (assets/fonts, no network). The words on every image are the page's own text: the headline is read from the page's <h1> (the default
   image uses the site tagline), the code and names are the ones the page shows.

     NODE_PATH=<folder with playwright>/node_modules [CHROME_PATH=<chromium>] node scripts/generate-og.js [type,type]
     node scripts/generate-og.js --check      the files exist, are 1200x630 PNG and are under 300 KB (no browser needed)

   After a change raise VERSION in lib/og.js, then run the generators and node scripts/apply-og.js. Guidance of the installed design skills: ui-ux-pro-max asks for a social preview image on
   every page (no sizes); design-taste-frontend has no rule for share images beyond its general ones (flat colour, no gradients, one real picture of the subject).
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const og = require('../lib/og.js');
const art = require('./brand/art.js');
const { TAGLINE } = require('../lib/site-footer.js');
const { C, esc, uri } = art;

const MAX_BYTES = 300 * 1024;
const read = (f) => fs.readFileSync(path.join(art.ROOT, f), 'utf8');
function pageText(file) {
  const t = read(file);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(t)[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&rsquo;/g, '’').replace(/&amp;/g, '&').replace(/\s+/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
  const desc = /<meta name="description" content="([^"]*)"/.exec(t)[1].replace(/&amp;/g, '&').replace(/&rsquo;/g, '’');
  return { h1, desc };
}

const HOUND = (cls) => '<img class="' + cls + '" src="' + uri('logo-mark-orange.svg') + '" alt="">';
const row = (a, b) => '<div class="row"><b>' + esc(a) + '</b><span>' + esc(b) + '</span></div>';

// the visual on the right, per type
const VISUAL = {
  hound: () => HOUND('hound'),
  home: () => {
    const doors = Array(10).fill('<svg viewBox="0 0 30 40"><use href="#door-limited"/></svg>').join('');
    return '<div class="card"><div class="ct"><b class="d">getcitehound.com</b><span>Scanned 23 Oct 2026</span></div>' +
      '<div class="sc"><div class="gauge"><svg viewBox="0 0 200 108"><path d="M14 100A86 86 0 0 1 186 100" pathLength="100" fill="none" stroke="' + C.paper + '" stroke-width="15"/><path d="M14 100A86 86 0 0 1 186 100" pathLength="100" stroke-dasharray="87 100" fill="none" stroke="' + C.orange + '" stroke-width="15"/></svg><b class="d">87</b></div>' +
      '<div class="bars">' + [['Discoverability', '27/40', 67.5], ['Technical foundation', '20/20', 100], ['Content and trust', '40/40', 100]].map((r) => '<div><span>' + r[0] + '</span><b>' + r[1] + '</b><i><u style="width:' + r[2] + '%"></u></i></div>').join('') + '</div></div>' +
      '<p class="dt">Ten AI crawlers at the robots.txt door</p><div class="doors">' + doors + '</div></div>';
  },
  pricing: () => '<div class="arches">' + [['Scan', 34, C.white, C.ink], ['Pro', 52, C.white, C.ink], ['Fix', 74, '#1F3552', C.white], ['Beyond', 100, C.orange, C.ink]].map((a) => '<div class="arch" style="height:' + a[1] + '%;background:' + a[2] + ';color:' + a[3] + '">' + a[0] + '</div>').join('') + '</div>',
  claude: () => '<div class="code m"><span class="c0">MCP server address</span><span class="c1">https://getcitehound.com/api/mcp</span><span class="c0">Free, read-only, no account</span></div>',
  api: () => '<div class="code m"><span class="c0">GET</span><span class="c1">/v1/scan?domain=example.com</span><span class="c0">Authorization: Bearer chk_…</span></div>',
  integrations: () => '<div class="list">' + row('Claude', 'MCP server') + row('Command line', 'npx citehound') + row('Public API', 'JSON, OpenAPI') + row('n8n', 'community node') + '</div>',
  tools: () => '<div class="list">' + row('robots.txt generator', 'AI crawlers') + row('Schema generator', 'JSON-LD') + row('llms.txt checker', 'optional file') + row('Compare two sites', 'side by side') + '</div>',
  compare: () => '<div class="cmp"><div class="field">yourdomain.com</div><div class="vs d">vs</div><div class="field">otherdomain.com</div><div class="go">Compare</div></div>'
};

// type -> { source page for the h1 (or null), visual, sub line (real text) }
const SPEC = {
  default: { h: () => TAGLINE, sub: '', visual: 'hound' },
  'default-light': { h: () => TAGLINE, sub: '', visual: 'hound', light: true },
  home: { page: 'index.html', visual: 'home', sub: 'Free. No email. About 30 seconds.' },
  pricing: { page: 'pricing.html', visual: 'pricing', sub: 'Start with a free scan.' },
  claude: { page: 'claude.html', visual: 'claude', sub: '13 read-only tools.' },
  api: { page: 'api.html', visual: 'api', sub: 'A JSON API with an OpenAPI description.' },
  integrations: { page: 'integrations.html', visual: 'integrations', sub: 'Each one runs the same scan and the same score.' },
  tools: { page: 'tools/index.html', visual: 'tools', sub: 'No signup.' },
  compare: { page: 'compare.html', visual: 'compare', sub: 'The same scanner and checks, side by side.' },
  about: { page: 'about.html', visual: 'hound', sub: 'Content strategist turned builder.' },
  pro: { h: () => 'The whole-site report, page by page.', sub: TAGLINE, visual: 'hound', kicker: 'Pro' },
  fix: { h: () => 'We make the technical changes.', sub: TAGLINE, visual: 'hound', kicker: 'Fix' },
  beyond: { h: () => 'We write the content.', sub: TAGLINE, visual: 'hound', kicker: 'Beyond' }
};

function visualCss(light) {
  const tagc = light ? C.orangeDeep : C.orangeSoft;
  return '.card{position:absolute;right:64px;top:92px;width:440px;background:#fff;color:' + C.ink + ';border-radius:24px;padding:24px 26px}' +
    '.ct{display:flex;justify-content:space-between;align-items:baseline;font-size:17px;color:' + C.faint + ';font-weight:600}.ct b{font-size:24px;color:' + C.ink + '}' +
    '.sc{display:grid;grid-template-columns:150px 1fr;gap:20px;align-items:end;margin-top:16px}.gauge{position:relative}.gauge svg{display:block;width:100%}.gauge b{position:absolute;left:0;right:0;bottom:6px;text-align:center;font-size:50px;line-height:1}' +
    '.bars>div{display:grid;grid-template-columns:1fr auto;gap:2px 8px;margin-top:10px;font-size:14px;font-weight:600}.bars b{font-family:"Bricolage Grotesque";font-weight:800}.bars i{grid-column:1/-1;display:block;height:7px;border-radius:4px;background:' + C.paper + '}.bars u{display:block;height:100%;border-radius:4px;background:' + C.ink + '}' +
    '.dt{margin:20px 0 8px;font-size:15px;font-weight:700;border-top:2px solid ' + C.paper + ';padding-top:14px}.doors{display:grid;grid-template-columns:repeat(10,1fr);gap:5px}.doors svg{display:block;width:100%}' +
    '.arches{position:absolute;right:72px;bottom:0;width:430px;height:430px;display:grid;grid-template-columns:repeat(4,1fr);gap:10px;align-items:end;border-bottom:3px solid ' + C.white + '}.arch{display:flex;align-items:flex-end;justify-content:center;padding-bottom:14px;border-radius:999px 999px 0 0;font-family:"Bricolage Grotesque";font-weight:800;font-size:19px;letter-spacing:-0.03em}' +
    '.code{position:absolute;right:64px;top:150px;width:470px;background:' + C.ink2 + ';border:2px solid rgba(255,255,255,.18);border-radius:20px;padding:30px 30px;font-size:21px;line-height:1.5;display:grid;gap:10px}.c0{color:' + C.soft + ';font-size:17px}.c1{color:' + C.orangeSoft + ';font-weight:500;word-break:break-all}' +
    '.list{position:absolute;right:64px;top:110px;width:440px;display:grid;gap:12px}.row{background:#fff;color:' + C.ink + ';border-radius:16px;padding:20px 24px;display:flex;justify-content:space-between;align-items:baseline;gap:14px}.row b{font-family:"Bricolage Grotesque";font-weight:800;font-size:25px;letter-spacing:-0.03em}.row span{font-size:17px;color:' + C.faint + ';font-weight:600}' +
    '.cmp{position:absolute;right:64px;top:150px;width:440px;display:grid;gap:12px}.field{background:#fff;color:' + C.faint + ';border:3px solid ' + C.white + ';border-radius:14px;padding:20px 22px;font-size:25px}.vs{text-align:center;font-size:26px;color:' + C.orangeSoft + '}.go{background:' + C.orange + ';color:' + C.ink + ';border-radius:14px;padding:18px;text-align:center;font-weight:700;font-size:24px}';
}

function html(type) {
  const s = SPEC[type];
  const light = !!s.light, bg = light ? C.paper : C.ink, ink = light ? C.ink : C.white, main = light ? '#435064' : C.soft, tagc = light ? C.orangeDeep : C.orangeSoft;
  const head = (s.h ? s.h() : pageText(s.page).h1);
  const big = head.length > 38 ? 60 : 68;
  const logo = uri(light ? 'logo-lockup.svg' : 'logo-lockup-dark.svg');
  const visual = VISUAL[s.visual]();
  const css = 'body{background:' + bg + ';color:' + ink + ';padding:64px 72px}' +
    '.logo{width:400px;height:auto;display:block}' +
    '.k{font-weight:700;font-size:26px;color:' + tagc + ';margin-top:46px}' +
    '.h{font-family:"Bricolage Grotesque",sans-serif;font-weight:800;letter-spacing:-0.04em;font-size:' + big + 'px;line-height:1.02;margin:' + (s.kicker ? '10px' : '52px') + ' 0 0;max-width:' + '560px' + '}' +
    '.s{font-size:25px;line-height:1.4;color:' + main + ';margin-top:24px;max-width:560px}' +
    '.u{position:absolute;left:72px;bottom:46px;font-weight:700;font-size:24px;color:' + tagc + '}' +
    '.hound{position:absolute;right:44px;bottom:-24px;height:420px;width:auto}' + visualCss(light);
  return art.shell(og.W, og.H, bg, css, art.doorDefs() + '<img class="logo" src="' + logo + '" alt="">' + (s.kicker ? '<div class="k">' + esc(s.kicker) + '</div>' : '') + '<div class="h">' + esc(head) + '</div>' + (s.sub ? '<div class="s">' + esc(s.sub) + '</div>' : '') + '<div class="u">getcitehound.com</div>' + visual);
}

function check() {
  let bad = 0;
  Object.keys(og.TYPES).forEach((t) => {
    const f = path.join(art.BRAND, og.TYPES[t].file);
    if (!fs.existsSync(f)) { console.log('FAIL missing ' + og.TYPES[t].file); bad++; return; }
    const b = fs.readFileSync(f), w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    if (b.slice(1, 4).toString() !== 'PNG' || w !== og.W || h !== og.H) { console.log('FAIL ' + og.TYPES[t].file + ' is ' + w + 'x' + h); bad++; }
    if (b.length > MAX_BYTES) { console.log('FAIL ' + og.TYPES[t].file + ' is ' + Math.round(b.length / 1024) + ' KB'); bad++; }
  });
  console.log(bad ? 'FAIL: ' + bad + ' problem(s)' : 'OK: ' + Object.keys(og.TYPES).length + ' share images, 1200x630 PNG, each under 300 KB');
  return bad ? 1 : 0;
}

async function main() {
  if (process.argv.includes('--check')) process.exit(check());
  const only = process.argv[2] ? process.argv[2].split(',') : Object.keys(SPEC);
  await art.render(only.map((t) => ({ out: path.join(art.BRAND, og.TYPES[t].file), w: og.W, h: og.H, html: html(t), check: { text: ['.logo', '.k', '.h', '.s', '.u'], art: ['.hound', '.card', '.arches', '.code', '.list', '.cmp'] } })));
  process.exit(check());
}

if (require.main === module) main().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
module.exports = { SPEC, VISUAL, html, check, visualCss, pageText };
