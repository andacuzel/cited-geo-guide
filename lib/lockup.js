/* =====================================================================
   lib/lockup.js: the product lockups, one component.

   The Citehound mark and wordmark followed by a small gold tag in the mono-caps style of the Pro tag: "Citehound FREE", "Citehound PRO",
   "Citehound FIX", "Citehound BEYOND". Two variants, light (ink wordmark, for light surfaces) and navy (white wordmark, for navy surfaces). The main logo is
   not redrawn: the mark is the one in lib/site-footer.js. Styles: styles.css, "Product lockups". The homepage and the generated pages call html();
   scripts/test-lockup is not needed: the pages call html() so the copies cannot drift.
   ===================================================================== */

'use strict';

const MARK = '<svg viewBox="13 8.5 52 52" focusable="false" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" d="M61.52 31.19 Q62.00 30.00 60.80 29.55 L59.31 28.99 Q58.00 28.50 56.73 27.90 L41.27 20.60 Q40.00 20.00 38.75 19.37 L36.25 18.13 Q35.00 17.50 33.90 16.64 L30.04 13.61 Q28.00 12.00 25.67 13.16 L22.97 14.51 Q21.00 15.50 20.14 17.53 L19.19 19.76 L17.75 24.28 L16.69 29.07 L16.00 34.12 L15.69 39.45 L15.75 45.03 L16.19 50.88 L16.66 54.42 Q17.00 57.00 19.60 57.00 L30.35 57.00 Q32.00 57.00 31.60 55.40 L31.17 53.64 L31.00 50.56 L31.50 47.75 L32.67 45.22 L34.50 42.97 L35.90 41.87 Q37.00 41.00 37.78 39.84 L38.22 39.16 Q39.00 38.00 40.38 37.75 L56.62 34.75 Q58.00 34.50 59.16 33.72 L59.93 33.21 Q61.00 32.50 61.48 31.31Z M28.62 16.05 Q28.70 15.05 27.90 15.64 L14.55 25.51 Q13.75 26.10 14.73 25.88 L27.07 23.07 Q28.05 22.85 28.13 21.85Z"/><circle cx="41" cy="23.4" r="2.3" fill="#F05A28"/></svg>';
const TIERS = ['FREE', 'PRO', 'FIX', 'BEYOND'];

// tier: FREE, PRO, FIX or BEYOND. variant: 'light' (default) or 'navy'.
function html(tier, variant) {
  const t = String(tier).toUpperCase();
  if (TIERS.indexOf(t) === -1) throw new Error('unknown lockup tier: ' + tier);
  return '<span class="lockup lockup--' + (variant === 'navy' ? 'navy' : 'light') + '"><span class="lockup__icon">' + MARK + '</span><span class="lockup__mark">Citehound</span><span class="lockup__tag">' + t + '</span></span>';
}

// "Includes Citehound PRO": the Pro lockup behind a small lead-in, for the Fix and Beyond surfaces. variant as for html().
function includes(variant) {
  return '<span class="includes-pro includes-pro--' + (variant === 'navy' ? 'navy' : 'light') + '"><span class="includes-pro__lead">Includes</span>' + html('PRO', variant) + '</span>';
}

module.exports = { includes: includes, html: html, TIERS: TIERS, MARK: MARK };
