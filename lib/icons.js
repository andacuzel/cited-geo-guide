/* =====================================================================
   lib/icons.js — the line icons used on generated pages.

   One place for every icon, so a page can inline the same drawing
   without copying it. 24px viewBox, 1.5 stroke, round caps and joins,
   currentColor, the style of the six vertical icons in app.js (those six
   are copied here unchanged).

   UMD, like lib/playbooks.js: required by the page generators in Node and
   usable as a plain script. Pages inline the markup; nothing is loaded
   at view time, and no icon is referenced by <img> or an external <use>.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ANSWERABLE_ICONS = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Inner SVG paths only. svg() wraps them.
  var PATHS = {
    // --- the six vertical icons from app.js, unchanged ---
    crm: '<circle cx="6" cy="6" r="2.25"/><circle cx="18" cy="6" r="2.25"/><circle cx="12" cy="18" r="2.25"/><path d="M7.7 7.7L10.4 16.1M16.3 7.7L13.6 16.1M8.25 6H15.75"/>',
    martech: '<path d="M4 10v4a1 1 0 001 1h2l5 4V5l-5 4H5a1 1 0 00-1 1z"/><path d="M16.2 9a4 4 0 010 6"/><path d="M19.2 6.2a8 8 0 010 11.6"/>',
    hrtech: '<circle cx="9" cy="8" r="2.75"/><path d="M4 19c0-2.8 2.2-5 5-5s5 2.2 5 5"/><circle cx="17.5" cy="9" r="2.1"/><path d="M14.7 14.3c2.1.4 3.7 2.1 4.3 4.2"/>',
    fintech: '<path d="M4.5 18.5V13M9.5 18.5V9M14.5 18.5v-6M19.5 18.5V5"/><path d="M3.5 19h17"/>',
    cybersecurity: '<path d="M12 3l7 3v5c0 5-3.2 8.4-7 10-3.8-1.6-7-5-7-10V6l7-3z"/><path d="M9 12.2l2 2 4-4.2"/>',
    devtools: '<path d="M9 6.5L4 12l5 5.5M15 6.5l5 5.5-5 5.5"/>',

    // --- the eight verticals that had no icon ---
    ecommerce: '<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6.5a3 3 0 016 0V8"/>',
    consumerapps: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M10.5 17.5h3"/>',
    hospitality: '<path d="M3.5 18.5V6"/><path d="M3.5 13.5h17"/><path d="M20.5 18.5v-5a3 3 0 00-3-3h-7v3"/><circle cx="7" cy="10" r="1.6"/>',
    marketplaces: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9a2 2 0 004 0 2 2 0 004 0 2 2 0 004 0 2 2 0 004 0"/><path d="M5.5 11.5V20h13v-8.5"/><path d="M10 20v-4.5h4V20"/>',
    realestate: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
    legal: '<path d="M12 4v16M7 20h10"/><path d="M5 7h14"/><path d="M5 7l-2.5 6a2.5 2.5 0 005 0L5 7zM19 7l-2.5 6a2.5 2.5 0 005 0L19 7z"/>',
    health: '<path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0112 7.6 4.2 4.2 0 0119.5 10c0 5.4-7.5 10-7.5 10z"/><path d="M12 11v4M10 13h4"/>',
    localservices: '<path d="M14.5 5a4 4 0 00-3.8 5.4L4.4 16.7a1.9 1.9 0 002.7 2.7l6.3-6.3A4 4 0 0019 9.5l-2.4 2.3-2.4-.6-.6-2.4L15.9 6.5A4 4 0 0014.5 5z"/>',

    // --- general ---
    search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="M15 15l5 5"/>',
    pricetag: '<path d="M3.5 12.2V4.5a1 1 0 011-1h7.7a1 1 0 01.7.3l7.3 7.3a1 1 0 010 1.4l-7.4 7.4a1 1 0 01-1.4 0l-7.3-7.3a1 1 0 01-.3-.7z"/><circle cx="8.5" cy="8.5" r="1.4"/>',
    balance: '<path d="M12 4v16M7 20h10"/><path d="M5 7.5h14"/><path d="M5 7.5l-2 5a2.2 2.2 0 004 0l-2-5zM19 7.5l-2 5a2.2 2.2 0 004 0l-2-5z"/>',
    cart: '<path d="M3 4.5h2.4l2 10.5h10.2l2-7.5H6.6"/><circle cx="9.5" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
    bag: '<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6.5a3 3 0 016 0V8"/>',
    box: '<path d="M4 7.5L12 4l8 3.5v9L12 20l-8-3.5v-9z"/><path d="M4 7.5L12 11l8-3.5M12 11v9"/>',
    plug: '<path d="M9 3.5v4M15 3.5v4"/><path d="M6.5 7.5h11v3.2a5.5 5.5 0 01-11 0V7.5z"/><path d="M12 16.2V20.5"/>',
    document: '<path d="M6.5 3.5h7.8L19 8.2V20.5H6.5V3.5z"/><path d="M14 3.5V8.5h5"/><path d="M9.5 12.5h6M9.5 15.5h6M9.5 18h3.5"/>',
    truck: '<path d="M3 6.5h11v9H3z"/><path d="M14 9.5h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.7"/><circle cx="17" cy="17.5" r="1.7"/>',
    chat: '<path d="M4 5.5h16v10.5H10.5L6.5 19.5V16H4V5.5z"/><path d="M8 9.5h8M8 12.5h5"/>',
    question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.7a2.5 2.5 0 114 2c-.9.6-1.6 1.1-1.6 2.1"/><path d="M12 16.8v.1"/>',
    repeat: '<path d="M4.5 11.5V10a3.5 3.5 0 013.5-3.5h10.5"/><path d="M15.5 3.5l3 3-3 3"/><path d="M19.5 12.5V14a3.5 3.5 0 01-3.5 3.5H5.5"/><path d="M8.5 20.5l-3-3 3-3"/>',
    eyeoff: '<path d="M3 12s3.2-6 9-6 9 6 9 6-3.2 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.5"/><path d="M4.5 4.5l15 15"/>',
    people: '<circle cx="9" cy="8" r="2.75"/><path d="M4 19c0-2.8 2.2-5 5-5s5 2.2 5 5"/><circle cx="17.5" cy="9" r="2.1"/><path d="M14.7 14.3c2.1.4 3.7 2.1 4.3 4.2"/>',
    list: '<path d="M8.5 7h11M8.5 12h11M8.5 17h11"/><path d="M4.5 7h.1M4.5 12h.1M4.5 17h.1"/>',
    report: '<path d="M6.5 3.5h11v17h-11z"/><path d="M9.5 15.5v-3M12 15.5v-6M14.5 15.5v-4.5"/><path d="M9.5 7h5"/>',
    sparse: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 12.5h5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    arrow: '<path d="M4 12h15M13.5 6.5L19 12l-5.5 5.5"/>',
    printer: '<path d="M7 9V4h10v5"/><path d="M7 17H4.5v-6.5h15V17H17"/><path d="M7 14h10v6H7z"/>',
    layers: '<path d="M12 4l8.5 4.5L12 13 3.5 8.5 12 4z"/><path d="M3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5"/>',
    link: '<path d="M10 14a3.5 3.5 0 005 0l3-3a3.5 3.5 0 00-5-5l-.8.8"/><path d="M14 10a3.5 3.5 0 00-5 0l-3 3a3.5 3.5 0 005 5l.8-.8"/>'
  };

  var ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

  // The complete <svg> markup for an icon. `cls` and a decorative aria-hidden are optional.
  function svg(name, opts) {
    if (!Object.prototype.hasOwnProperty.call(PATHS, name)) throw new Error('Unknown icon: ' + name);
    opts = opts || {};
    return '<svg ' + ATTRS + (opts.cls ? ' class="' + opts.cls + '"' : '') + (opts.decorative === false ? '' : ' aria-hidden="true" focusable="false"') + '>' + PATHS[name] + '</svg>';
  }

  return { PATHS: PATHS, svg: svg, names: function () { return Object.keys(PATHS); } };
}));
