'use strict';

const { NOTE } = require('./util.js');

const pad = (s, n) => String(s) + ' '.repeat(Math.max(1, n - String(s).length));

function scanText(s) {
  const L = [];
  L.push(s.domain + ': ' + s.score + '/100  (AI readiness)', '');
  (s.pillars || []).forEach((p) => L.push('  ' + pad(p.name, 24) + p.score + '/' + p.max));
  const sum = s.crawlerSummary || { open: 0, limited: 0, blocked: 0 };
  L.push('', 'AI crawlers: ' + sum.open + ' open, ' + sum.limited + ' limited, ' + sum.blocked + ' blocked');
  const blocked = (s.crawlers || []).filter((c) => c.state === 'blocked').map((c) => c.name);
  if (blocked.length) L.push('  Blocked: ' + blocked.join(', '));
  L.push('');
  if (!s.failed || !s.failed.length) L.push('No failed checks.');
  else {
    L.push('To fix, most valuable first:');
    s.failed.forEach((f, i) => { L.push('  ' + (i + 1) + '. ' + f.label + ': ' + f.points + ' of ' + f.max + ' points'); if (f.fix) L.push('     ' + f.fix); });
  }
  if (s.benchmark && typeof s.benchmark.overallAverage === 'number') {
    const d = s.benchmark.delta;
    L.push('', (d === 0 ? 'About the average' : Math.abs(d) + ' point' + (Math.abs(d) === 1 ? '' : 's') + (d > 0 ? ' above' : ' below') + ' the average') + ' of the ' + s.benchmark.sitesScanned + ' sites in Citehound\'s own archive (' + s.benchmark.overallAverage + '/100).');
  }
  L.push('', (s.note || NOTE));
  return L.join('\n') + '\n';
}

function compareText(c) {
  const L = [];
  L.push(c.a.domain + ': ' + c.a.score + '/100', c.b.domain + ': ' + c.b.score + '/100', '');
  const pa = c.a.pillars || [], pb = c.b.pillars || [];
  pa.forEach((p, i) => { if (pb[i]) L.push('  ' + pad(p.name, 24) + pad(p.score + '/' + p.max, 8) + pb[i].score + '/' + pb[i].max); });
  const diffs = c.differences || [];
  L.push('', diffs.length ? 'Where they differ (' + c.a.domain + ' | ' + c.b.domain + '):' : 'No check differs.');
  diffs.forEach((d) => L.push('  ' + pad(d.check, 34) + pad(d.a.points + '/' + d.max, 8) + d.b.points + '/' + d.max));
  L.push('', c.note || NOTE);
  return L.join('\n') + '\n';
}

function crawlerListText(list) {
  const L = ['The ' + list.length + ' AI crawlers Citehound tracks:', ''];
  list.forEach((c) => { L.push(pad(c.name, 18) + pad(c.vendor, 14) + 'default: ' + c.default); });
  L.push('', 'Use these names with: citehound generate robots-txt <domain> --allow <names> --block <names>');
  return L.join('\n') + '\n';
}

function crawlersForText(r) {
  const L = [r.domain + ': AI crawler access in robots.txt', ''];
  r.crawlers.forEach((c) => L.push('  ' + pad(c.name, 18) + pad(c.state, 9) + (c.rule || '')));
  const s = r.summary || {};
  L.push('', (s.open || 0) + ' open, ' + (s.limited || 0) + ' limited, ' + (s.blocked || 0) + ' blocked', '', r.note || NOTE);
  return L.join('\n') + '\n';
}

module.exports = { scanText, compareText, crawlerListText, crawlersForText };
