/* =====================================================================
   lib/lang-detect.js: a small language detector for page text and for the questions Pro writes.

   Not a general tool: it tells apart the languages Citehound's sites most often use, by script and by common
   function words, and says how sure it is. It is used to (a) check the html lang attribute against the text,
   (b) fall back when a page has no lang attribute, and (c) reject a generated question that is not in the
   site's language. detect() returns { lang, confidence } with confidence 0 when it cannot tell.
   ===================================================================== */

'use strict';

const STOP = {
  en: 'the and of to in is for with that on are as this by from or your you we at be an it not have can all more our will about their',
  tr: 've bir bu için ile da de çok daha ama gibi olarak olan her veya ise kadar sonra değil ya ne bizim sizin tüm bütün en mi hem ancak ise sizi bize bunu',
  de: 'der die das und ist nicht mit für von zu den ein eine auf im sich auch dem als wir sie ihr bei oder aus nach über wie wird sind zum zur',
  fr: 'le la les de des et est un une pour que dans en du sur avec pas par vous nous au ce qui ou plus sont aux votre notre cette',
  es: 'el la los las de y es un una para que en con por del se su al como más nuestro lo son sus este esta nuestros',
  it: 'il lo la gli le di e è un una per che in con non da del della dei sono più nostro nostra questo anche',
  pt: 'o a os as de e é um uma para que em com não por do da dos das mais nosso você são este esta',
  nl: 'de het een en van is dat op te in voor met niet zijn aan we ook bij of onze naar als wij',
  pl: 'i w nie na się z do jest to że o jak dla po od przez nasz oraz ale tym',
  sv: 'och att det som en är för på med av den till inte vi vår kan ett har'
};
const NAMES = { en: 'English', tr: 'Turkish', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', sv: 'Swedish', ru: 'Russian', ar: 'Arabic', ja: 'Japanese', zh: 'Chinese', ko: 'Korean', el: 'Greek', he: 'Hebrew', da: 'Danish', fi: 'Finnish', nb: 'Norwegian', cs: 'Czech', uk: 'Ukrainian', ro: 'Romanian', hu: 'Hungarian', id: 'Indonesian', vi: 'Vietnamese', hi: 'Hindi', th: 'Thai' };
const SETS = {}; Object.keys(STOP).forEach(function (k) { SETS[k] = new Set(STOP[k].split(/\s+/)); });
const BONUS = { tr: /[ğşıİ]/g, de: /[äöüß]/g, es: /[ñ¿¡]/g, fr: /[àâçèêëîïôûœ]/g, pt: /[ãõç]/g, pl: /[ąćęłńśźż]/g, sv: /[åäö]/g };
const SCRIPTS = [['ru', /[Ѐ-ӿ]/g], ['ar', /[؀-ۿ]/g], ['ja', /[぀-ヿ]/g], ['zh', /[一-鿿]/g], ['ko', /[가-힯]/g], ['el', /[Ͱ-Ͽ]/g], ['he', /[֐-׿]/g], ['hi', /[ऀ-ॿ]/g], ['th', /[฀-๿]/g]];

// BCP-47, loosely: a 2 or 3 letter language, then optional script and region subtags.
const BCP47 = /^[a-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|\d{3}))?$/;
function normalizeTag(tag) {
  const t = String(tag || '').trim().replace(/_/g, '-');
  if (!BCP47.test(t)) return null;
  const p = t.split('-');
  return [p[0].toLowerCase()].concat(p.slice(1).map(function (x) { return x.length === 4 ? x[0].toUpperCase() + x.slice(1).toLowerCase() : x.toUpperCase(); })).join('-');
}
const base = function (tag) { return String(tag || '').split('-')[0].toLowerCase(); };
const nameOf = function (tag) { return NAMES[base(tag)] || String(tag); };

function detect(text) {
  const s = String(text || '').slice(0, 20000);
  const letters = (s.match(/\p{L}/gu) || []).length;
  if (letters < 20) return { lang: null, confidence: 0 };
  for (let i = 0; i < SCRIPTS.length; i++) {
    const n = (s.match(SCRIPTS[i][1]) || []).length;
    if (n / letters > 0.3) return { lang: SCRIPTS[i][0], confidence: 0.95 };
  }
  const words = s.toLowerCase().match(/\p{L}+/gu) || [];
  const score = {};
  Object.keys(SETS).forEach(function (k) { score[k] = 0; });
  words.forEach(function (w) { Object.keys(SETS).forEach(function (k) { if (SETS[k].has(w)) score[k]++; }); });
  Object.keys(BONUS).forEach(function (k) { score[k] += Math.min(6, (s.match(BONUS[k]) || []).length) * 0.5; });
  const ranked = Object.keys(score).sort(function (a, b) { return score[b] - score[a]; });
  const best = score[ranked[0]], second = score[ranked[1]];
  // Short texts (a question is 8 to 20 words) get a lower bar than a page.
  const bar = words.length < 40 ? 1.5 : 4;
  if (best < bar) return { lang: null, confidence: 0 };
  return { lang: ranked[0], confidence: Math.round(Math.min(1, (best - second) / best) * 100) / 100 };
}

module.exports = { detect: detect, normalizeTag: normalizeTag, base: base, nameOf: nameOf, NAMES: NAMES, BCP47: BCP47 };
