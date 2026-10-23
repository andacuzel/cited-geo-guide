/* =====================================================================
   lib/lockup.js: the product lockups, one component.

   The Citehound mark and wordmark followed by a small gold tag in the mono-caps style of the Pro tag: "Citehound FREE", "Citehound PRO",
   "Citehound FIX", "Citehound BEYOND". Two variants, light (ink wordmark, for light surfaces) and navy (white wordmark, for navy surfaces). The main logo is
   not redrawn: the mark is the one in lib/site-footer.js. Styles: styles.css, "Product lockups". The homepage and the generated pages call html();
   scripts/test-lockup is not needed: the pages call html() so the copies cannot drift.
   ===================================================================== */

'use strict';

const MARK = '<svg viewBox="13 8.5 52 52" focusable="false" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M19 58V32a20 20 0 0 1 40 0v26ZM27 58V33a12 12 0 0 1 24 0v25Z"/><path fill="#F05A28" d="M27 58V32.5c0-3 1.6-5.4 4.4-6.6L45 24.2V54Z"/></svg>';
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
