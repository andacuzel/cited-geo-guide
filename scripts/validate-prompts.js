#!/usr/bin/env node
/* =====================================================================
   scripts/validate-prompts.js

   Checks the citation question sets in content/prompts/<vertical>.json.

     node scripts/validate-prompts.js                the 13 sets other than crm
     node scripts/validate-prompts.js --all          every set, crm included
     node scripts/validate-prompts.js --show-blocklist
     node scripts/validate-prompts.js --dir <folder>   check another folder (for testing the checker)

   Per file:
     - same structure as crm.json: keys vertical, description, version,
       prompts, brandsNote, brands in that order; every prompt is exactly
       { id, text } with id "<vertical>-NN" in sequence; vertical matches
       the file name; brands is empty (no lexicon has been built)
     - 15 to 20 questions
     - each is one sentence, ends with a question mark, is under 140
       characters, and is unique within the file
     - no domain names, no British spellings, and for health nothing that
       reads as medical advice (finding a practitioner only)
     - no brand, product or company name from the blocklist

   The blocklist is built from:
     1. content/playbooks: capitalised words used mid-sentence that never
        appear in lowercase there (Google, Reddit, Gartner, Zillow...),
        minus GENERIC, the capitalised words that are not names
     2. the CRM lexicon in content/prompts/crm.json: every name, alias and
        domain (ambiguous ones, which are ordinary words such as Close or
        Copper, match case-sensitively)
     3. lib/crawlers.js: the crawler user agents and their vendors
     4. EXTRA: names a question writer is likely to reach for. This list is
        stricter than the three sources and is not derived from them.

   crm.json is not edited by this project's tooling. It names Slack,
   Google Workspace and Gmail in two questions, so --all reports hits there.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const dirArg = process.argv.indexOf('--dir');
const PROMPTS = dirArg !== -1 ? path.resolve(process.argv[dirArg + 1]) : path.join(ROOT, 'content', 'prompts');
const PLAYBOOKS = path.join(ROOT, 'content', 'playbooks');
const MIN_Q = 15;
const MAX_Q = 20;
const MAX_LEN = 140;
const KEYS = ['vertical', 'description', 'version', 'prompts', 'brandsNote', 'brands'];

// Capitalised in the playbooks but not names of anything.
const GENERIC = new Set(('AI Answerable If SEO Actionable Strategies Pitfalls Replace Tip CRM API JSON LD FAQ HR Article Hiding Stack Overflow Author ' +
  'READMEs SOC OTA Standardize Organization LLM LLMs FAQPage Targeting Gating Engage Leaving Play Subheading H2 Publish Saturate Sitemap DTC Financial ' +
  'PCI Pasting LocalBusiness Smartphone Seed Overlooking Googling Engineer ROI CISOs SIEM Hacker News Mark SKU UGC VP HTML Consolidate MedicalBusiness ' +
  'FAQs Travel Wi Fi PDFs HRTech CHRO Embed PDF People LegalService Stuffing Homeowners Drive Cultivate Expose Clarify Locking Target Home Centralize ' +
  'RealEstateAgent Inconsistent ATS HRIS ATT&CK').split(/\s+/));

// Strict extras (matched exactly as written, capital letters included).
const EXTRA = ['Slack', 'Zoom', 'Gmail', 'Outlook', 'Excel', 'QuickBooks', 'Shopify', 'WordPress', 'Airbnb', 'Uber', 'Apple', 'Microsoft', 'Facebook',
  'Instagram', 'TikTok', 'WhatsApp', 'PayPal', 'Venmo', 'Visa', 'Mastercard', 'Expedia', 'Kayak', 'Booking.com', 'Etsy', 'eBay', 'Craigslist',
  'Upwork', 'Fiverr', 'Stack Overflow', 'Hacker News', 'The Knot', 'Android', 'iPhone', 'iOS', 'Windows', 'Linux', 'AWS', 'Azure', 'GitHub', 'GitLab'];

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function pattern(name, caseSensitive) {
  return { name: name, re: new RegExp('(?<![A-Za-z0-9])' + name.trim().split(/\s+/).map(esc).join('\\s+') + '(?![A-Za-z0-9])', caseSensitive ? '' : 'i') };
}

function playbookNames() {
  let text = '';
  fs.readdirSync(PLAYBOOKS).filter((f) => f.endsWith('.js')).forEach(function (f) {
    const src = fs.readFileSync(path.join(PLAYBOOKS, f), 'utf8');
    for (const m of src.matchAll(/'((?:[^'\\]|\\.)*)'/g)) text += ' ' + m[1];
  });
  text = text.replace(/\\u2019/g, '’').replace(/\\u2014/g, ' — ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&');
  const lower = new Set((text.match(/[A-Za-z0-9][A-Za-z0-9.&'’-]*[A-Za-z0-9]|[A-Za-z0-9]/g) || []).filter((t) => /^[a-z]/.test(t)));
  const out = new Set();
  for (const m of text.matchAll(/(?<![.!?:]\s)(?<!^)\b([A-Z][A-Za-z0-9&]+)\b/g)) {
    const w = m[1];
    if (!lower.has(w.toLowerCase()) && !GENERIC.has(w)) out.add(w);
  }
  return Array.from(out);
}

function lexiconNames() {
  const crm = JSON.parse(fs.readFileSync(path.join(PROMPTS, 'crm.json'), 'utf8'));
  const out = [];
  (crm.brands || []).forEach(function (b) {
    [b.name].concat(b.aliases || []).forEach((n) => out.push({ name: n, cs: !!b.ambiguous }));
    if (b.domain) out.push({ name: b.domain, cs: false });
  });
  return out;
}

function crawlerNames() {
  const list = require(path.join(ROOT, 'lib', 'crawlers.js'));
  const out = [];
  list.forEach(function (c) {
    if (c.ua) out.push(c.ua);
    if (c.vendor) {
      out.push(c.vendor);
      const first = String(c.vendor).split(/\s+/)[0];
      if (first.length > 2 && !GENERIC.has(first) && !/^(Common)$/.test(first)) out.push(first);
    }
  });
  return Array.from(new Set(out));
}

function buildBlocklist() {
  const seen = new Set();
  const list = [];
  const add = (name, cs, source) => {
    const k = name + '|' + cs;
    if (seen.has(k) || !name || name.length < 2) return;
    seen.add(k);
    const p = pattern(name, cs);
    p.source = source;
    list.push(p);
  };
  playbookNames().forEach((n) => add(n, false, 'playbooks'));
  lexiconNames().forEach((n) => add(n.name, n.cs, 'crm lexicon'));
  crawlerNames().forEach((n) => add(n, false, 'crawlers'));
  EXTRA.forEach((n) => add(n, true, 'extra'));
  return list;
}

const BRITISH = /\b(colour|favour|honour|behaviour|neighbour|centre|theatre|litre|metre|organis\w+|realis\w+|recognis\w+|programme|licence|cheque|travell\w+|jewellery|whilst|learnt|grey|catalogue|analyse|defence|fulfil|enrol|cancell\w+|labell\w+|modell\w+|tyre|mum|petrol|flat \(apartment\))\b/i;
const MEDICAL_ADVICE = /\b(symptoms?|cure|cures|dosage|dose|diagnos\w+|side effects?|get rid of|how (?:do|can|should) i treat|home remedies|medication for|what causes)\b/i;
const DOMAIN = /\b[a-z0-9-]+\.(?:com|org|net|io|co|ai|app|dev|edu|gov|us|uk)\b/i;

function checkFile(slug, blocklist, crmKeys) {
  const problems = [];
  const bad = (m) => problems.push(slug + ': ' + m);
  const file = path.join(PROMPTS, slug + '.json');
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return [slug + ': not valid JSON (' + e.message + ')']; }

  // structure
  if (JSON.stringify(Object.keys(j)) !== JSON.stringify(KEYS)) bad('keys are [' + Object.keys(j).join(', ') + '], expected [' + KEYS.join(', ') + ']');
  if (JSON.stringify(Object.keys(j)) !== JSON.stringify(crmKeys)) bad('key order differs from crm.json');
  if (j.vertical !== slug) bad('vertical "' + j.vertical + '" does not match the file name');
  if (typeof j.description !== 'string' || !j.description.trim()) bad('description is empty');
  if (typeof j.version !== 'number') bad('version is not a number');
  if (typeof j.brandsNote !== 'string' || !j.brandsNote.trim()) bad('brandsNote is missing');
  if (slug !== 'crm' && !(Array.isArray(j.brands) && j.brands.length === 0)) bad('brands must be an empty array: no lexicon has been built, and none may be invented');
  if (!Array.isArray(j.prompts)) { bad('prompts is not an array'); return problems; }

  const n = j.prompts.length;
  if (n < MIN_Q || n > MAX_Q) bad(n + ' questions, expected ' + MIN_Q + ' to ' + MAX_Q);

  const seen = new Map();
  j.prompts.forEach(function (p, i) {
    const id = slug + '-' + String(i + 1).padStart(2, '0');
    const at = '#' + (i + 1) + ' ';
    if (JSON.stringify(Object.keys(p)) !== '["id","text"]') bad(at + 'has keys [' + Object.keys(p).join(', ') + '], expected [id, text]');
    if (p.id !== id) bad(at + 'id is "' + p.id + '", expected "' + id + '"');
    const t = typeof p.text === 'string' ? p.text : '';
    if (!t) { bad(at + 'text is empty'); return; }
    if (t !== t.trim() || /\s{2,}/.test(t)) bad(at + 'has stray whitespace');
    if (!t.endsWith('?')) bad(at + 'does not end with a question mark: "' + t + '"');
    if (t.length > MAX_LEN) bad(at + 'is ' + t.length + ' characters (max ' + MAX_LEN + ')');
    if (/[.!?]/.test(t.slice(0, -1))) bad(at + 'is more than one sentence: "' + t + '"');
    const key = t.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) bad(at + 'duplicates #' + seen.get(key)); else seen.set(key, i + 1);
    if (DOMAIN.test(t)) bad(at + 'contains a domain name: "' + t + '"');
    if (BRITISH.test(t)) bad(at + 'uses a non-US spelling: "' + t.match(BRITISH)[0] + '"');
    if (slug === 'health' && MEDICAL_ADVICE.test(t)) bad(at + 'reads as medical advice, not finding a practitioner: "' + t + '"');
    blocklist.forEach(function (b) { if (b.re.test(t)) bad(at + 'contains the name "' + b.name + '" (' + b.source + '): "' + t + '"'); });
  });
  return problems;
}

function main() {
  const all = process.argv.indexOf('--all') !== -1;
  const blocklist = buildBlocklist();
  if (process.argv.indexOf('--show-blocklist') !== -1) {
    ['playbooks', 'crm lexicon', 'crawlers', 'extra'].forEach(function (src) {
      console.log(src + ' (' + blocklist.filter((b) => b.source === src).length + '): ' + blocklist.filter((b) => b.source === src).map((b) => b.name).join(', '));
    });
    return;
  }
  const crm = JSON.parse(fs.readFileSync(path.join(PROMPTS, 'crm.json'), 'utf8'));
  const crmKeys = Object.keys(crm);
  const slugs = fs.readdirSync(PROMPTS).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).filter((s) => all || s !== 'crm').sort();
  let problems = [];
  let questions = 0;
  slugs.forEach(function (s) {
    const p = checkFile(s, blocklist, crmKeys);
    problems = problems.concat(p);
    questions += JSON.parse(fs.readFileSync(path.join(PROMPTS, s + '.json'), 'utf8')).prompts.length;
    console.log('  ' + (p.length ? 'FAIL' : 'ok  ') + '  ' + s.padEnd(14) + JSON.parse(fs.readFileSync(path.join(PROMPTS, s + '.json'), 'utf8')).prompts.length + ' questions' + (p.length ? '  (' + p.length + ' problems)' : ''));
  });
  if (problems.length) {
    console.error('\n' + problems.length + ' problems:');
    problems.forEach((p) => console.error('  - ' + p));
    process.exit(1);
  }
  console.log('\nOK: ' + slugs.length + ' files, ' + questions + ' questions, ' + blocklist.length + ' blocklisted names checked.');
}

main();
