/* =====================================================================
   lib/ws-beyond.js: the rules of a Beyond workspace, apart from storage and pages (the Fix side is lib/ws-fix.js).

   A Beyond workspace has four working tabs. Questions: the market questions in the customer's words, from the Pro report's question generator (when the
   linked report has them) or from one of the 14 category sets, edited by hand. Gaps: question, page, a note, a priority, entered by an admin. Content: the pieces
   we write (new pages, FAQ and comparison blocks, rewrites; a brief is an intermediate step), each draft, in review, approved or published; the client approves
   or asks for changes. Monthly: the AI-readiness score from each month's scan, and the citation-check result of that month when there is one. The citation check
   is a pilot and is labelled so: a dated sample of one assistant's answers, one run each, never a ranking.

   Who may set a status: an admin sets draft, in review and published (published only after approved); only the client's Approve sets approved. Editing the
   text of an approved or published piece sends it back to in review, with a note, so what was approved is always what was read.
   ===================================================================== */

'use strict';

const STATUSES = ['draft', 'in_review', 'approved', 'published'];
const STATUS_LABEL = { draft: 'Draft', in_review: 'In review', approved: 'Approved', published: 'Published' };
const ADMIN_STATUSES = ['draft', 'in_review', 'published'];
const TYPES = ['New page', 'FAQ block', 'Comparison block', 'Rewrite', 'Brief'];
const PRIORITIES = ['high', 'medium', 'low'];
const MAX_QUESTIONS = 40, MAX_GAPS = 60, MAX_PIECES = 60, MAX_COMMENTS = 30;

const line = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Admin input for the question list: an array of strings. Returns { ok, questions: [{ id, text }] } or { ok: false, reason }.
function cleanQuestions(input) {
  if (!Array.isArray(input)) return { ok: false, reason: 'questions' };
  const seen = {}; const out = [];
  input.forEach((q) => {
    const text = line(typeof q === 'string' ? q : (q && q.text), 200);
    if (text.length < 8) return;
    const key = text.toLowerCase();
    if (seen[key]) return;
    seen[key] = true; out.push({ id: 'q' + (out.length + 1), text: text });
  });
  if (out.length > MAX_QUESTIONS) return { ok: false, reason: 'too_many' };
  return { ok: true, questions: out };
}

function cleanGaps(input) {
  if (!Array.isArray(input)) return { ok: false, reason: 'gaps' };
  const out = [];
  for (const g of input) {
    const question = line(g && g.question, 200);
    if (!question) continue;
    const priority = PRIORITIES.indexOf(g && g.priority) === -1 ? 'medium' : g.priority;
    out.push({ id: 'g' + (out.length + 1), question: question, page: line(g && g.page, 120), note: line(g && g.note, 300), priority: priority });
  }
  if (out.length > MAX_GAPS) return { ok: false, reason: 'too_many' };
  return { ok: true, gaps: out };
}

// One month's citation-check result, entered by an admin. named and asked are whole numbers, named never above asked.
function cleanMonth(input) {
  const month = String((input && input.month) || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { ok: false, reason: 'month' };
  const named = parseInt(input.named, 10), asked = parseInt(input.asked, 10);
  if (!(asked >= 1 && asked <= 99) || !(named >= 0 && named <= asked)) return { ok: false, reason: 'counts' };
  return { ok: true, entry: { month: month, named: named, asked: asked, model: line(input.model, 40), note: line(input.note, 300) } };
}

// Rows for the Monthly tab, newest first: the score of the last scan in the month, and the citation-check entry if there is one.
function monthsTable(scans, months) {
  const by = {};
  (scans || []).forEach((s) => { const m = String(s.at).slice(0, 7); if (!by[m] || s.at > by[m].at) by[m] = s; });
  const cit = {}; (months || []).forEach((m) => { cit[m.month] = m; });
  const keys = Object.keys(by).concat(Object.keys(cit).filter((m) => !by[m])).sort().reverse();
  return keys.map((m) => ({ month: m, score: by[m] ? by[m].score : null, scanAt: by[m] ? by[m].at : null, citation: cit[m] || null }));
}

function counts(pieces) {
  const c = { draft: 0, in_review: 0, approved: 0, published: 0 };
  pieces.forEach((p) => { if (c[p.status] !== undefined) c[p.status]++; });
  return c;
}

const changesRequested = (p) => p.status === 'draft' && !!p.comments && p.comments.length > 0 && p.comments[p.comments.length - 1].kind === 'changes';

module.exports = {
  STATUSES: STATUSES, STATUS_LABEL: STATUS_LABEL, ADMIN_STATUSES: ADMIN_STATUSES, TYPES: TYPES, PRIORITIES: PRIORITIES, MAX_QUESTIONS: MAX_QUESTIONS, MAX_GAPS: MAX_GAPS,
  MAX_PIECES: MAX_PIECES, MAX_COMMENTS: MAX_COMMENTS, line: line, cleanQuestions: cleanQuestions, cleanGaps: cleanGaps, cleanMonth: cleanMonth, monthsTable: monthsTable,
  counts: counts, changesRequested: changesRequested
};
