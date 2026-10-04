/* =====================================================================
   lib/citation/brands.js: brand extraction for verticals with no lexicon.

   The model is asked for a JSON list of the brands an answer mentions. A brand
   is accepted only if its string appears verbatim in the answer text, so the
   model can point at names but can never add one. Verticals with a lexicon (CRM)
   keep using it and never reach this.
   ===================================================================== */
'use strict';

// Accept a candidate only if it is a non-empty string that appears, character for character, in `text`.
// Result is ordered by first position in the text, de-duplicated, and leaves out `exclude` names.
function acceptVerbatim(candidates, text, exclude) {
  const skip = new Set((exclude || []).map((x) => String(x).toLowerCase()));
  const seen = new Set();
  const out = [];
  (Array.isArray(candidates) ? candidates : []).forEach(function (c) {
    if (typeof c !== 'string') return;
    const name = c.trim();
    if (!name || name.length > 60 || seen.has(name.toLowerCase()) || skip.has(name.toLowerCase())) return;
    const pos = text.indexOf(name);
    if (pos === -1) return;
    seen.add(name.toLowerCase());
    out.push({ name: name, pos: pos });
  });
  out.sort((a, b) => a.pos - b.pos);
  return out.map((x) => x.name);
}

function parseList(reply) {
  const t = String(reply == null ? '' : reply).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const v = JSON.parse(t);
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.brands)) return v.brands;
  } catch (e) { /* not JSON */ }
  return [];
}

const PROMPT = 'Below is an answer to a buying question. List every company, product or brand name it mentions. ' +
  'Reply with a JSON array of strings and nothing else. Copy each name exactly as it is written in the answer. ' +
  'Do not add names that are not in the answer.\n\nANSWER:\n';

// provider.ask(prompt, options) -> { text }. Returns the accepted brands.
async function extractBrands(provider, answerText, options, exclude) {
  const r = await provider.ask(PROMPT + answerText, options);
  return acceptVerbatim(parseList(r.text), answerText, exclude);
}

module.exports = { acceptVerbatim: acceptVerbatim, parseList: parseList, extractBrands: extractBrands, PROMPT: PROMPT };
