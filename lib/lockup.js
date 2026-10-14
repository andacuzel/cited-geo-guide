/* =====================================================================
   lib/lockup.js: the product lockups, one component.

   The Citehound mark and wordmark followed by a small gold tag in the mono-caps style of the Pro tag: "Citehound FREE", "Citehound PRO",
   "Citehound FIX", "Citehound BEYOND". Two variants, light (ink wordmark, for light surfaces) and navy (white wordmark, for navy surfaces). The main logo is
   not redrawn: the mark is the one in lib/site-footer.js. Styles: styles.css, "Product lockups". The homepage and the generated pages call html();
   scripts/test-lockup is not needed: scripts/generate-fix.js --check compares the homepage's copies with this output.
   ===================================================================== */

'use strict';

const MARK = '<svg viewBox="13 8.5 52 52" focusable="false" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M62 30 L58 28.5 L40 20 L35 17.5 L28 12 L21 15.5 Q13 32 17 57 L32 57 Q28.5 46.5 37 41 L39 38 L58 34.5 L61 32.5 Z M27.5 16.5 L16 25 L27 22.5 Z M38.4 22.9 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0 Z"/></svg>';
const TIERS = ['FREE', 'PRO', 'FIX', 'BEYOND'];

// tier: FREE, PRO, FIX or BEYOND. variant: 'light' (default) or 'navy'.
function html(tier, variant) {
  const t = String(tier).toUpperCase();
  if (TIERS.indexOf(t) === -1) throw new Error('unknown lockup tier: ' + tier);
  return '<span class="lockup lockup--' + (variant === 'navy' ? 'navy' : 'light') + '"><span class="lockup__icon">' + MARK + '</span><span class="lockup__mark">Citehound</span><span class="lockup__tag">' + t + '</span></span>';
}

module.exports = { html: html, TIERS: TIERS, MARK: MARK };
