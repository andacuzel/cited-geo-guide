/* =====================================================================
   lib/citation-content.js

   The content behind the two citation tools in api/mcp.js:
     get_citation_prompts  the buying-intent question set for a vertical,
                           from content/prompts/<vertical>.json
     get_citation_sample   the anonymised sample, from
                           content/citations/sample-crm.json

   Both read the content files, so nothing is copied here and nothing can
   drift from the files. The files are loaded with static require() calls
   so a deploy bundles them (a computed path would not be traced), and each
   load is guarded: a missing or unreadable file becomes a specific message
   from the tool, never a crash of the whole server.

   No tool here runs a live check. A run is about 90 model calls at about
   five seconds each, far past the function timeout, and it would spend a
   quota that anyone could drain.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

function safe(fn) {
  try { return fn(); } catch (e) { return null; }
}

// One static require per vertical. Add a line when a new
// content/prompts/<vertical>.json appears; unregisteredFiles() reports a miss.
const SETS = {
  consumerapps: safe(() => require('../content/prompts/consumerapps.json')),
  crm: safe(() => require('../content/prompts/crm.json')),
  cybersecurity: safe(() => require('../content/prompts/cybersecurity.json')),
  devtools: safe(() => require('../content/prompts/devtools.json')),
  ecommerce: safe(() => require('../content/prompts/ecommerce.json')),
  fintech: safe(() => require('../content/prompts/fintech.json')),
  health: safe(() => require('../content/prompts/health.json')),
  hospitality: safe(() => require('../content/prompts/hospitality.json')),
  hrtech: safe(() => require('../content/prompts/hrtech.json')),
  legal: safe(() => require('../content/prompts/legal.json')),
  localservices: safe(() => require('../content/prompts/localservices.json')),
  marketplaces: safe(() => require('../content/prompts/marketplaces.json')),
  martech: safe(() => require('../content/prompts/martech.json')),
  realestate: safe(() => require('../content/prompts/realestate.json'))
};

function questionsOf(set) {
  return set && Array.isArray(set.prompts) ? set.prompts : [];
}

function verticals() {
  return Object.keys(SETS);
}

function verticalsWithSets() {
  return verticals().filter((v) => questionsOf(SETS[v]).length > 0);
}

// Files in content/prompts that the registry above does not know about.
function unregisteredFiles() {
  const dir = path.join(__dirname, '..', 'content', 'prompts');
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((v) => !Object.prototype.hasOwnProperty.call(SETS, v));
}

const SELF_RUN = [
  'Pick one assistant and one model, and note its name and today’s date.',
  'Ask each question in a separate, new conversation. Do not reuse a chat: earlier answers change later ones.',
  'Ask every question three to five times, each time in a new conversation.',
  'For each answer, note two things: whether your brand is named at all, and whether it appears in a heading, list label, table or bold text (featured) rather than only in running prose (named only).',
  'Judge the spread, not one answer. A question where you are named in some tries and not others is unstable. One where you are never named is a gap. A single answer is not a finding.'
];

// What the questions do and do not name. The files' own description says "No
// brand names", which is not quite true of crm.json (two questions mention an
// integration platform, and that file is fixed because the published sample was
// collected with those exact questions), so the tool states it itself.
const NAMES_NOTE = 'The questions don’t name any brand in the category being measured.';
const PLATFORM_NOTE = 'A few mention an integration platform such as Slack or Google Workspace, because that is how buyers ask.';
const PLATFORM = /\b(Slack|Google Workspace|Gmail|Microsoft Teams|Zapier)\b/;

function namesNote(questions) {
  return questions.some((q) => PLATFORM.test(q.text || '')) ? NAMES_NOTE + ' ' + PLATFORM_NOTE : NAMES_NOTE;
}

// The set's description without its "No brand names: ..." sentence.
function describe(set) {
  return String(set.description || '').replace(/\s*No brand names:[^.]*\./, '').trim();
}

const LIMITS = 'Keep the limits in view: the result describes one assistant on one date. It is not a ranking, it says nothing about other assistants, and it is not a forecast of traffic. Answers move with phrasing and over time.';

function listOrNone(list) {
  return list.length ? list.join(', ') : 'none yet';
}

/* ---------------------------------------------------------------------
   get_citation_prompts
   --------------------------------------------------------------------- */

// Returns { isError, text } for the tool.
function promptsFor(vertical) {
  const all = verticals().join(', ');
  const withSets = verticalsWithSets();
  const given = typeof vertical === 'string' ? vertical.trim() : '';
  if (!given) {
    return { isError: true, text: '"vertical" is required. Valid verticals: ' + all + '. Question sets exist for: ' + listOrNone(withSets) + '.' };
  }
  if (!Object.prototype.hasOwnProperty.call(SETS, given)) {
    return { isError: true, text: 'Unknown vertical "' + given + '". Valid verticals: ' + all + '. Question sets exist for: ' + listOrNone(withSets) + '.' };
  }
  const set = SETS[given];
  const questions = questionsOf(set);
  if (!set) {
    return { isError: true, text: 'The question set for "' + given + '" could not be read from this deployment. Question sets exist for: ' + listOrNone(withSets) + '.' };
  }
  if (!questions.length) {
    return {
      isError: false,
      text: 'The "' + given + '" vertical has no questions yet, so there is nothing to run. ' +
        (withSets.length ? 'Question sets exist for: ' + withSets.join(', ') + '. Call get_citation_prompts with one of those.' : 'No vertical has a question set yet.')
    };
  }
  const lines = [];
  lines.push('Citation question set: ' + given + ' (' + questions.length + ' questions, set version ' + (set.version || 1) + ')');
  if (describe(set)) lines.push(describe(set));
  lines.push(namesNote(questions));
  lines.push('');
  questions.forEach((q, i) => lines.push((i + 1) + '. ' + q.text));
  lines.push('');
  lines.push('How to run this yourself, in any assistant you have access to:');
  SELF_RUN.forEach((s, i) => lines.push((i + 1) + '. ' + s));
  lines.push('');
  lines.push(LIMITS);
  return { isError: false, text: lines.join('\n') };
}

/* ---------------------------------------------------------------------
   get_citation_sample
   --------------------------------------------------------------------- */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : String(iso);
}
const pct = (x) => Math.round(x * 100) + '%';

function loadSample() {
  return safe(() => require('../content/citations/sample-crm.json'));
}

function sampleValid(s) {
  return s && s.label && s.model && s.date && Array.isArray(s.prompts) && s.prompts.length &&
    s.overall && typeof s.overall.mentionRate === 'number' && s.overall.range && s.runsPerPrompt;
}

// loader is injectable so a missing file can be tested without touching it.
function sampleText(loader) {
  const s = (loader || loadSample)();
  if (!s) {
    return { isError: true, text: 'The citation sample (content/citations/sample-crm.json) is not available in this deployment, so there is nothing to return.' };
  }
  if (!sampleValid(s)) {
    return { isError: true, text: 'The citation sample file was found but is not in the expected shape, so it was not returned.' };
  }
  const tries = s.runsPerPrompt;
  const group = (g) => s.prompts.filter((p) => p.group === g);
  const always = group('always');
  const unstable = group('unstable');
  const never = group('never');
  const state = { featured: 'featured', named: 'named only', absent: 'not named' };
  const lines = [];
  lines.push('Citation tracking sample: ' + s.label);
  lines.push('Model: ' + s.model + '. Date: ' + longDate(s.date) + '. ' + (s.mode === 'ungrounded' ? 'No web search was enabled.' : 'Web search was enabled.'));
  lines.push('Each of ' + s.prompts.length + ' questions was asked ' + tries + ' times (' + tries + ' tries per question), each in its own conversation.');
  lines.push('');
  lines.push('Overall, the brand was named in ' + pct(s.overall.mentionRate) + ' of answers. Taking one try of every question as a sweep, the rate ranged from ' +
    pct(s.overall.range.min) + ' to ' + pct(s.overall.range.max) + ' across ' + (s.overall.sweeps || tries) + ' sweeps. The average hides that spread.');
  lines.push('');
  lines.push('Named in every try (' + always.length + '):');
  always.forEach((p) => lines.push('  - ' + p.question));
  lines.push('');
  lines.push('Unstable, named in some tries and not others (' + unstable.length + '):');
  unstable.forEach((p) => lines.push('  - ' + p.question + '\n    tries: ' + p.runs.map((r) => state[r] || r).join(', ')));
  lines.push('');
  lines.push('Never named (' + never.length + '):');
  never.forEach((p) => lines.push('  - ' + p.question));
  lines.push('');
  lines.push('Featured means named in a heading, list label, table or bold text. Named only means named in running prose, which can include a mention that is not a recommendation.');
  lines.push('');
  lines.push('Limits: this is one model on one date. It is not a ranking, it says nothing about other assistants, and it is not a forecast of traffic. Answers move with phrasing and over time. The sample is anonymised: it names no brand in the category being measured, no domain and no competitor.');
  return { isError: false, text: lines.join('\n') };
}

module.exports = {
  verticals: verticals,
  verticalsWithSets: verticalsWithSets,
  unregisteredFiles: unregisteredFiles,
  promptsFor: promptsFor,
  sampleText: sampleText,
  SELF_RUN: SELF_RUN
};
