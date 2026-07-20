/* =====================================================================
   CITED. — GEO & AEO Strategy Generator
   Vanilla JS, zero backend, zero API calls. Built for static hosting
   (e.g. GitHub Pages).

   --------------------------------------------------------------------
   HOW TO ADD A NEW VERTICAL (e.g. "MarTech")
   --------------------------------------------------------------------
   1. Find its entry in the subFields array below and confirm its `id`
      (e.g. 'martech').
   2. Add a matching key to the saasData object with that same id,
      following the exact structure used for `crm` (the four required
      headings: "The Strategic Shift", "Top 3 Actionable Strategies",
      "Outdated SEO Pitfalls to Avoid", and an "Expert Tip" block).
   3. That's it — the card automatically switches from a disabled
      "Soon" badge to a clickable "Live" card, because liveness is
      derived from `saasData.hasOwnProperty(id)`, not hardcoded.
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

  /* ---------------------------------------------------------------
     3. SAAS_DATA — the actual playbook content. Only "crm" is
        populated for now; this is the mock entry that establishes
        the structure every future vertical must follow.
     --------------------------------------------------------------- */

  var saasData = {
    crm: {
      name: 'CRM Software',
      content:
        '<h3>The Strategic Shift</h3>' +
        '<p>For a decade, CRM buyers built their shortlist by Googling "best CRM for small business" and skimming ten blue links. That research layer is now collapsing into a single AI-generated answer. When a sales-ops lead asks ChatGPT, Perplexity, or Gemini to compare HubSpot, Salesforce, and Pipedrive, the model isn\u2019t crawling your homepage in real time \u2014 it\u2019s synthesizing a response from training data, indexed reviews, and structured signals it has already learned to trust.</p>' +
        '<p>If your CRM brand isn\u2019t already part of that trusted signal set \u2014 cited on G2, referenced in comparison content, structured in a way a language model can parse \u2014 you don\u2019t lose a ranking position. You disappear from the conversation entirely. The strategic shift for CRM marketing teams is to stop optimizing pages for a crawler hunting keywords, and start engineering your brand\u2019s presence across the sources an LLM treats as ground truth.</p>' +
        '<h3>Top 3 Actionable Strategies</h3>' +
        '<ul>' +
        '<li><strong>Engineer your third-party footprint first.</strong> Generative engines weight independent sources \u2014 G2, Capterra, TrustRadius, Reddit threads \u2014 far more heavily than brand-owned content. Before writing another blog post, audit how your CRM is described on these platforms and run a structured review-generation push focused on the specific use-case language buyers actually ask about, like "CRM for outbound teams under 50 reps."</li>' +
        '<li><strong>Publish direct-answer comparison content.</strong> Build dedicated "X vs Y" and "best CRM for [use case]" pages that answer the question in a self-contained paragraph an AI can lift whole \u2014 a clear verdict up front, named criteria, and a structured table. Don\u2019t bury the comparison inside a 3,000-word narrative blog post.</li>' +
        '<li><strong>Mark up everything machine-readable.</strong> Implement Product, Review, and FAQPage schema across pricing and comparison pages so structured facts \u2014 price tiers, integrations, support hours \u2014 are unambiguous to both search and answer engines. Keep one canonical source for these facts so models never encounter two conflicting versions of your own pricing.</li>' +
        '</ul>' +
        '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
        '<ul class="pitfalls">' +
        '<li>Targeting broad head terms like "best CRM software" with yet another generic listicle nobody asked an AI to summarize.</li>' +
        '<li>Treating backlink volume as the goal instead of citation-worthy authority on the platforms LLMs actually pull from.</li>' +
        '<li>Gating case studies, ROI calculators, or comparison data behind a lead form \u2014 content an AI crawler can\u2019t access can\u2019t be cited, full stop.</li>' +
        '<li>Letting pricing, feature lists, and positioning drift out of sync across your website, app-store listing, and partner pages, since models tend to average out or simply distrust contradictory facts about the same product.</li>' +
        '</ul>' +
        '<h3>Expert Tip</h3>' +
        '<div class="expert-tip">' +
        '<p>[Add your own field insight here \u2014 for example, a specific G2 review pattern you\u2019ve seen influence AI citations, a client result from a structured-data rollout, or a contrarian take on where the CRM category\u2019s AI visibility is headed next. <strong>This box is designed for your proprietary point of view.</strong>]</p>' +
        '</div>'
    }
  };

  /* ---------------------------------------------------------------
     4. DOM references
     --------------------------------------------------------------- */

  var viewLanding = document.getElementById('view-landing');
  var viewResults = document.getElementById('view-results');
  var cardGrid = document.getElementById('cardGrid');
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
    var html = subFields.map(function (field) {
      var isLive = saasData.hasOwnProperty(field.id);
      var rowClass = 'index-row' + (isLive ? '' : ' index-row--soon');
      var status = isLive
        ? '<span class="index-row__status index-row__status--live">\u25CF Live</span>'
        : '<span class="index-row__status index-row__status--soon">\u25CB In preparation</span>';

      return (
        '<button type="button" class="' + rowClass + '" data-id="' + field.id + '" data-live="' + isLive + '" aria-label="' + field.name + (isLive ? '' : ' \u2014 playbook in preparation') + '">' +
          '<span class="index-row__code">' + field.code + '</span>' +
          '<span class="index-row__name">' + field.name + '</span>' +
          '<span class="index-row__desc">' + field.description + '</span>' +
          status +
        '</button>'
      );
    }).join('');

    cardGrid.innerHTML = html;
  }

  /* ---------------------------------------------------------------
     6. Toast (used for "coming soon" verticals)
     --------------------------------------------------------------- */

  function showToast(message) {
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

  function showResults(id) {
    var entry = saasData[id];
    if (!entry) {
      showToast('That playbook is in preparation.');
      return;
    }

    lastFocusedCardId = id;

    resultsContent.innerHTML =
      '<p class="results-content__eyebrow">GEO &amp; AEO Playbook</p>' +
      '<h2 class="results-content__title">' + entry.name + '</h2>' +
      '<div class="results-content__body">' + entry.content + '</div>';

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

    viewResults.hidden = true;
    viewResults.setAttribute('aria-hidden', 'true');
    viewLanding.hidden = false;
    viewLanding.setAttribute('aria-hidden', 'false');

    if (location.hash) {
      history.replaceState(null, '', location.pathname + location.search);
    }

    if (!opts.skipScroll) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }

    if (lastFocusedCardId) {
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
    var entry = saasData[activeId];
    var fileSlug = (entry ? entry.name : 'playbook').toLowerCase().replace(/[^a-z0-9]+/g, '-');

    downloadBtn.disabled = true;
    downloadBtnLabel.textContent = 'Preparing PDF\u2026';

    var opts = {
      margin: [14, 12, 16, 12],
      filename: 'cited-geo-aeo-playbook-' + fileSlug + '.pdf',
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

  cardGrid.addEventListener('click', function (e) {
    var card = e.target.closest('.index-row');
    if (!card) return;
    showResults(card.getAttribute('data-id'));
  });

  backBtn.addEventListener('click', function () {
    showLanding();
  });

  downloadBtn.addEventListener('click', downloadPDF);

  logoLink.addEventListener('click', function (e) {
    e.preventDefault();
    showLanding();
  });

  window.addEventListener('hashchange', function () {
    var id = (location.hash || '').replace('#', '');
    if (id && saasData[id]) {
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
  if (initialId && saasData[initialId]) {
    showResults(initialId);
  }

}());
