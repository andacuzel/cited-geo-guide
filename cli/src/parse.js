'use strict';

// The public MCP endpoint answers in text. These functions read that text into the same shape the API (with a key) returns, so the rest of the CLI has one shape to work with.
// If the text is not what was expected, they throw a CliError: the CLI never guesses a score.

const { CliError, NOTE } = require('./util.js');

const PILLAR_IDS = { 'Discoverability': 'discover', 'Technical foundation': 'tech', 'Technical': 'tech', 'Content & trust': 'trust' };
const unreadable = () => new CliError('Citehound answered, but this version of the CLI could not read the answer. Update with "npx citehound@latest", or write to hey@getcitehound.com if it keeps happening.', 3);

function crawlerSummary(crawlers) {
  const n = (s) => crawlers.filter((c) => c.state === s).length;
  return { open: n('open'), limited: n('limited'), blocked: n('blocked') };
}

function parseScan(text) {
  const domain = (/^AI readiness scan — (\S+)/m.exec(text) || [])[1];
  const score = (/^Score: (\d+)\/100/m.exec(text) || [])[1];
  if (!domain || score === undefined) throw unreadable();
  const pillars = []; let m;
  const pr = /^\s+(Discoverability|Technical foundation|Content & trust):\s+(\d+)\/(\d+)/gm;
  while ((m = pr.exec(text))) pillars.push({ id: PILLAR_IDS[m[1]], name: m[1], score: +m[2], max: +m[3] });
  const crawlers = [];
  const cr = /^\s{2}(\S+) — (Open|Limited|Blocked)(?: \((.*)\))?\s*$/gm;
  while ((m = cr.exec(text))) crawlers.push({ name: m[1], vendor: null, state: m[2].toLowerCase(), rule: m[3] || null });
  const failed = [];
  const fr = /^\s*- (.+?) \((\d+)\/(\d+) pts\): (.+)$/gm;
  while ((m = fr.exec(text))) { const parts = m[4].split(' — '); failed.push({ label: m[1], pillar: null, points: +m[2], max: +m[3], fix: parts[0].trim() }); }
  let benchmark = null;
  const b = /(?:(\d+) points? (above|below)|about) the average of the ([\d,]+) sites[^()]*\((\d+)\/100\)/.exec(text);
  if (b) { const delta = b[1] ? (b[2] === 'below' ? -1 : 1) * +b[1] : 0; benchmark = { overallAverage: +b[4], sitesScanned: +b[3].replace(/,/g, ''), delta: delta }; }
  return { domain: domain, score: +score, pillars: pillars, failed: failed, crawlers: crawlers, crawlerSummary: crawlerSummary(crawlers), benchmark: benchmark, note: NOTE };
}

function parseCompare(text) {
  if (/^Only /.test(text)) throw new CliError(text.split('\n')[0], 3);
  const sites = []; let m;
  const sr = /^(\S+): (\d+)\/100 \(Discoverability (\d+)\/(\d+), Technical (\d+)\/(\d+), Content & trust (\d+)\/(\d+)\)/gm;
  while ((m = sr.exec(text))) sites.push({ domain: m[1], score: +m[2], pillars: [{ id: 'discover', name: 'Discoverability', score: +m[3], max: +m[4] }, { id: 'tech', name: 'Technical foundation', score: +m[5], max: +m[6] }, { id: 'trust', name: 'Content & trust', score: +m[7], max: +m[8] }] });
  if (sites.length !== 2) throw unreadable();
  const differences = [];
  const dr = /^\s{2}(.+?) — (\S+): (\d+)\/(\d+)\s+(\S+): (\d+)\/(\d+)\s*$/gm;
  while ((m = dr.exec(text))) differences.push({ check: m[1], a: { points: +m[3] }, b: { points: +m[6] }, max: +m[4] });
  return { a: sites[0], b: sites[1], differences: differences, note: NOTE };
}

function parseCrawlerList(text) {
  const out = []; let m;
  const re = /^(\S+) \(([^)]+)\)\n\s+(.+)\n\s+This project’s robots\.txt generator defaults it to: (Allow|Disallow)\./gm;
  while ((m = re.exec(text))) out.push({ name: m[1], vendor: m[2], description: m[3].trim(), default: m[4].toLowerCase() === 'allow' ? 'allow' : 'block' });
  if (!out.length) throw unreadable();
  return out;
}

// The file text after the one-line introduction ("robots.txt — paste this at ...:") and the blank line.
function fileBody(text) {
  const i = text.indexOf('\n\n');
  const body = i === -1 ? '' : text.slice(i + 2).replace(/\s+$/, '');
  if (!body) throw unreadable();
  return body + '\n';
}

function parseSchema(text) {
  const i = text.indexOf('\n\n{');
  if (i === -1) throw unreadable();
  try { return JSON.parse(text.slice(i + 2)); } catch (e) { throw unreadable(); }
}

module.exports = { parseScan, parseCompare, parseCrawlerList, fileBody, parseSchema, crawlerSummary };
