'use strict';

// Turns Citehound answers into the markdown the Raycast views show. Pure functions: tested without Raycast.

const NOTE = 'A readiness score: crawler access and on-page signals. It does not measure whether any assistant names a brand.';

function scanMarkdown(s) {
  const L = ['# ' + s.domain + ': ' + s.score + '/100', '', '**AI readiness.** ' + (s.note || NOTE), ''];
  L.push('| Pillar | Score |', '|---|---|');
  (s.pillars || []).forEach((p) => L.push('| ' + p.name + ' | ' + p.score + '/' + p.max + ' |'));
  const c = s.crawlerSummary || { open: 0, limited: 0, blocked: 0 };
  L.push('', '**AI crawlers:** ' + c.open + ' open, ' + c.limited + ' limited, ' + c.blocked + ' blocked');
  const blocked = (s.crawlers || []).filter((x) => x.state === 'blocked').map((x) => x.name);
  if (blocked.length) L.push('', 'Blocked: ' + blocked.join(', '));
  L.push('');
  if (!s.failed || !s.failed.length) L.push('No failed checks.');
  else { L.push('## To fix, most valuable first'); s.failed.forEach((f, i) => L.push((i + 1) + '. **' + f.label + '** (' + f.points + ' of ' + f.max + ' points)' + (f.fix ? ': ' + f.fix : ''))); }
  if (s.truncated && s.upgrade) L.push('', '_' + s.hidden_findings + ' more finding' + (s.hidden_findings === 1 ? ' is' : 's are') + ' not shown. ' + s.upgrade.message + '_');
  return L.join('\n') + '\n';
}

function compareMarkdown(c) {
  const L = ['# ' + c.a.domain + ' ' + c.a.score + '/100 and ' + c.b.domain + ' ' + c.b.score + '/100', '', c.note || NOTE, ''];
  const d = c.differences || [];
  if (!d.length) L.push('No check differs.');
  else { L.push('| Check | ' + c.a.domain + ' | ' + c.b.domain + ' |', '|---|---|---|'); d.forEach((x) => L.push('| ' + x.check + ' | ' + x.a.points + '/' + x.max + ' | ' + x.b.points + '/' + x.max + ' |')); }
  return L.join('\n') + '\n';
}

// A file result: the text for the clipboard, and a note for a preview.
function fileResult(r) { return { text: String(r.content || '').replace(/\s+$/, '') + '\n', note: r.preview && r.upgrade ? 'Preview (the first lines). ' + r.upgrade.message : null }; }

function eventTitle(e) { return e.domain + ': ' + e.type.replace(/_/g, ' '); }

module.exports = { scanMarkdown, compareMarkdown, fileResult, eventTitle, NOTE };
