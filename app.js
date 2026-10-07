/* =====================================================================
   CITEHOUND — GEO & AEO Strategy Generator
   Vanilla JS, zero backend, zero API calls. Built for static hosting.

   Three tracks share this one file: B2B SaaS (for-saas.html), consumer
   and e-commerce brands (for-brands.html), local and independent
   professionals (for-professionals.html). Each page has exactly one
   card grid element; at init the script detects which one is present
   and renders that track's fields into it.

   --------------------------------------------------------------------
   HOW TO ADD A NEW VERTICAL (e.g. "MarTech")
   --------------------------------------------------------------------
   1. Find its entry in the relevant fields array below (subFields,
      brandFields or professionalFields) and confirm its `id`
      (e.g. 'martech').
   2. Add a matching key to that track's data object (saasData,
      brandData or professionalData) with that same id, following the
      exact structure used for `crm` (the four required headings:
      "The Strategic Shift", "Top 3 Actionable Strategies", "Outdated
      SEO Pitfalls to Avoid", and an "Expert Tip" block).
   3. That's it — the card automatically switches from a disabled
      "Soon" badge to a clickable "Live" card, because liveness is
      derived from the data object's `hasOwnProperty(id)`, not
      hardcoded.
   ===================================================================== */

(function () {
  'use strict';

  /* ---------------------------------------------------------------
     1. ICONS — simple inline SVGs, one per vertical, currentColor
     --------------------------------------------------------------- */

  var icons = {
    crm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.25"/><circle cx="18" cy="6" r="2.25"/><circle cx="12" cy="18" r="2.25"/><path d="M7.7 7.7L10.4 16.1M16.3 7.7L13.6 16.1M8.25 6H15.75"/></svg>',
    martech: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4a1 1 0 001 1h2l5 4V5l-5 4H5a1 1 0 00-1 1z"/><path d="M16.2 9a4 4 0 010 6"/><path d="M19.2 6.2a8 8 0 010 11.6"/></svg>',
    hrtech: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="2.75"/><path d="M4 19c0-2.8 2.2-5 5-5s5 2.2 5 5"/><circle cx="17.5" cy="9" r="2.1"/><path d="M14.7 14.3c2.1.4 3.7 2.1 4.3 4.2"/></svg>',
    fintech: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 18.5V13M9.5 18.5V9M14.5 18.5v-6M19.5 18.5V5"/><path d="M3.5 19h17"/></svg>',
    cybersecurity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 5-3.2 8.4-7 10-3.8-1.6-7-5-7-10V6l7-3z"/><path d="M9 12.2l2 2 4-4.2"/></svg>',
    devtools: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6.5L4 12l5 5.5M15 6.5l5 5.5-5 5.5"/></svg>'
  };

  /* ---------------------------------------------------------------
     2. SUB_FIELDS — card metadata for every vertical shown on the
        landing grid. `live` is computed below, not stored here.
     --------------------------------------------------------------- */

  var subFields = [
    {
      id: 'crm',
      name: 'CRM Software',
      code: 'VERT / CRM',
      description: 'Sales platforms competing for a place inside AI-generated buyer shortlists.'
    },
    {
      id: 'martech',
      name: 'MarTech',
      code: 'VERT / MTK',
      description: 'Marketing platforms racing to become the cited source on their own category.'
    },
    {
      id: 'hrtech',
      name: 'HRTech',
      code: 'VERT / HRT',
      description: 'People-ops software navigating a buyer journey that now starts in a chat window.'
    },
    {
      id: 'fintech',
      name: 'FinTech SaaS',
      code: 'VERT / FIN',
      description: 'Financial software where third-party trust signals decide who gets cited.'
    },
    {
      id: 'cybersecurity',
      name: 'Cybersecurity',
      code: 'VERT / SEC',
      description: 'Security platforms competing for authority in answer engines, not just SERPs.'
    },
    {
      id: 'devtools',
      name: 'DevTools & Cloud',
      code: 'VERT / DEV',
      description: 'Developer-first products where documentation has become the real landing page.'
    }
  ];

  var brandFields = [
    {
      id: 'ecommerce',
      name: 'E-commerce & DTC Brands',
      code: 'VERT / ECM',
      description: 'Online stores competing to be the product AI names when shoppers ask.'
    },
    {
      id: 'consumerapps',
      name: 'Consumer Apps',
      code: 'VERT / APP',
      description: 'Apps discovered through AI recommendations instead of app-store search.'
    },
    {
      id: 'hospitality',
      name: 'Hospitality & Travel',
      code: 'VERT / HSP',
      description: 'Hotels, restaurants and venues surfacing in AI trip planning.'
    },
    {
      id: 'marketplaces',
      name: 'Marketplaces',
      code: 'VERT / MKT',
      description: 'Platforms competing to be the source AI cites for category comparisons.'
    }
  ];

  var professionalFields = [
    {
      id: 'realestate',
      name: 'Real Estate Agents',
      code: 'PROF / RES',
      description: 'Agents competing to be named when buyers ask AI who to work with locally.'
    },
    {
      id: 'legal',
      name: 'Legal Practices',
      code: 'PROF / LAW',
      description: 'Small firms and solo practitioners in a market where referrals now start with a chatbot.'
    },
    {
      id: 'health',
      name: 'Health & Wellness',
      code: 'PROF / HLT',
      description: 'Practitioners whose new patients ask an AI before they ask a friend.'
    },
    {
      id: 'localservices',
      name: 'Local Services & Trades',
      code: 'PROF / LOC',
      description: 'Contractors, photographers and event vendors competing for AI recommendations.'
    }
  ];

  /* ---------------------------------------------------------------
     3. SAAS_DATA / BRAND_DATA / PROFESSIONAL_DATA — the playbook
        content for all fourteen verticals. Lives in lib/playbooks.js
        now, not here — api/mcp.js's get_playbook tool reads the same
        object via require(), so the two can never drift apart. See
        that file for the actual content and how to add a vertical.
     --------------------------------------------------------------- */

  var _playbooks = (typeof window !== 'undefined' && window.CITEHOUND_PLAYBOOKS) || { saasData: {}, brandData: {}, professionalData: {} };
  var saasData = _playbooks.saasData;
  var brandData = _playbooks.brandData;
  var professionalData = _playbooks.professionalData;

  /* ---------------------------------------------------------------
     4. DOM references
     --------------------------------------------------------------- */

  var fieldSets = [
    { gridId: 'saasCardGrid', fields: subFields, data: saasData },
    { gridId: 'brandCardGrid', fields: brandFields, data: brandData },
    { gridId: 'professionalCardGrid', fields: professionalFields, data: professionalData }
  ];

  var activeSet = null;
  for (var fs = 0; fs < fieldSets.length; fs++) {
    if (document.getElementById(fieldSets[fs].gridId)) {
      activeSet = fieldSets[fs];
      break;
    }
  }

  var activeFields = activeSet ? activeSet.fields : [];
  var activeData = activeSet ? activeSet.data : {};

  var viewLanding = document.getElementById('view-landing');
  var viewResults = document.getElementById('view-results');
  var cardGrid = activeSet ? document.getElementById(activeSet.gridId) : null;
  var resultsContent = document.getElementById('resultsContent');
  var backBtn = document.getElementById('backBtn');
  var downloadBtn = document.getElementById('downloadBtn');
  var downloadBtnLabel = document.getElementById('downloadBtnLabel');
  var toastEl = document.getElementById('toast');
  var logoLink = document.getElementById('logoLink');

  var lastFocusedCardId = null;
  var toastTimer = null;

  /* ---------------------------------------------------------------
     5. Card rendering
     --------------------------------------------------------------- */

  function renderCards() {
    var html = activeFields.map(function (field) {
      var isLive = activeData.hasOwnProperty(field.id);
      var cardClass = 'card' + (isLive ? '' : ' card--soon');
      var badge = isLive
        ? '<span class="card__badge card__badge--live">Live</span>'
        : '<span class="card__badge card__badge--soon">Soon</span>';
      var ctaLabel = isLive ? 'Read the playbook' : 'In preparation';

      return (
        '<button type="button" class="' + cardClass + '" data-id="' + field.id + '" data-live="' + isLive + '" aria-label="' + field.name + (isLive ? '' : ' \u2014 playbook coming soon') + '">' +
          '<div class="card__top">' +
            '<span class="card__code">' + field.code + '</span>' +
            badge +
          '</div>' +
          '<span class="card__icon">' + (icons[field.id] || '') + '</span>' +
          '<span class="card__name">' + field.name + '</span>' +
          '<span class="card__desc">' + field.description + '</span>' +
          '<span class="card__cta">' + ctaLabel +
            '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>' +
          '</span>' +
        '</button>'
      );
    }).join('');

    if (cardGrid) cardGrid.innerHTML = html;
  }

  /* ---------------------------------------------------------------
     6. Toast (used for "coming soon" verticals)
     --------------------------------------------------------------- */

  function showToast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('is-visible');
    }, 2600);
  }

  /* ---------------------------------------------------------------
     7. View switching
     --------------------------------------------------------------- */

  function hideUnfilledExpertTips(container) {
    var tips = container.querySelectorAll('.expert-tip');
    for (var i = 0; i < tips.length; i++) {
      var tip = tips[i];
      var text = (tip.textContent || '').trim();
      if (text.charAt(0) === '[') {
        var heading = tip.previousElementSibling;
        tip.parentNode.removeChild(tip);
        if (heading && heading.tagName === 'H3' && heading.textContent.trim() === 'Expert Tip') {
          heading.parentNode.removeChild(heading);
        }
      }
    }
  }

  function showResults(id) {
    var entry = activeData[id];
    if (!entry) {
      showToast('That playbook is in preparation.');
      return;
    }
    if (!resultsContent || !viewLanding || !viewResults) return;

    lastFocusedCardId = id;

    resultsContent.innerHTML =
      '<p class="results-content__eyebrow">GEO &amp; AEO Playbook</p>' +
      '<h2 class="results-content__title">' + entry.name + '</h2>' +
      '<div class="results-content__body">' + entry.content + '</div>';

    hideUnfilledExpertTips(resultsContent);

    viewLanding.hidden = true;
    viewLanding.setAttribute('aria-hidden', 'true');
    viewResults.hidden = false;
    viewResults.setAttribute('aria-hidden', 'false');

    window.scrollTo({ top: 0, behavior: 'instant' });

    if (location.hash !== '#' + id) {
      history.replaceState(null, '', '#' + id);
    }

    var heading = resultsContent.querySelector('.results-content__title');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus();
    }
  }

  function showLanding(opts) {
    opts = opts || {};

    if (viewResults) {
      viewResults.hidden = true;
      viewResults.setAttribute('aria-hidden', 'true');
    }
    if (viewLanding) {
      viewLanding.hidden = false;
      viewLanding.setAttribute('aria-hidden', 'false');
    }

    if (location.hash) {
      history.replaceState(null, '', location.pathname + location.search);
    }

    if (!opts.skipScroll) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }

    if (lastFocusedCardId && cardGrid) {
      var card = cardGrid.querySelector('[data-id="' + lastFocusedCardId + '"]');
      if (card) card.focus();
    }
  }

  /* ---------------------------------------------------------------
     8. PDF export
     --------------------------------------------------------------- */

  function downloadPDF() {
    if (typeof html2pdf === 'undefined') {
      showToast('PDF library failed to load \u2014 check your connection.');
      return;
    }

    var activeId = (location.hash || '').replace('#', '') || lastFocusedCardId;
    var entry = activeData[activeId];
    var fileSlug = (entry ? entry.name : 'playbook').toLowerCase().replace(/[^a-z0-9]+/g, '-');

    downloadBtn.disabled = true;
    downloadBtnLabel.textContent = 'Preparing PDF\u2026';

    var opts = {
      margin: [14, 12, 16, 12],
      filename: 'citehound-geo-aeo-playbook-' + fileSlug + '.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'avoid-all'] }
    };

    html2pdf().set(opts).from(resultsContent).save().then(function () {
      downloadBtn.disabled = false;
      downloadBtnLabel.textContent = 'Download as PDF';
    }).catch(function () {
      downloadBtn.disabled = false;
      downloadBtnLabel.textContent = 'Download as PDF';
      showToast('Something went wrong generating the PDF. Please try again.');
    });
  }

  /* ---------------------------------------------------------------
     9. Event wiring
     --------------------------------------------------------------- */

  if (cardGrid) {
    cardGrid.addEventListener('click', function (e) {
      var card = e.target.closest('.card');
      if (!card) return;
      showResults(card.getAttribute('data-id'));
    });
  }

  if (backBtn) {
    backBtn.addEventListener('click', function () {
      showLanding();
    });
  }

  if (downloadBtn) {
    downloadBtn.addEventListener('click', downloadPDF);
  }

  logoLink.addEventListener('click', function (e) {
    if (viewResults && !viewResults.hidden) {
      e.preventDefault();
      showLanding();
    }
  });

  window.addEventListener('hashchange', function () {
    var id = (location.hash || '').replace('#', '');
    if (id && activeData[id]) {
      showResults(id);
    } else if (!id) {
      showLanding({ skipScroll: true });
    }
  });

  /* ---------------------------------------------------------------
     10. Init
     --------------------------------------------------------------- */

  renderCards();

  var initialId = (location.hash || '').replace('#', '');
  if (initialId && activeData[initialId]) {
    showResults(initialId);
  }

}());
