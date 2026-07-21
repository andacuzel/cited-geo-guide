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
        '<p>For a decade, CRM buyers built their shortlist by Googling "best CRM for small business" and skimming ten blue links. That research layer is collapsing into a single AI-generated answer. When a sales-ops lead asks ChatGPT, Perplexity, or Gemini to compare HubSpot, Salesforce, and Pipedrive, the model is not crawling your homepage in real time — it is synthesizing a response from training data, indexed reviews, and structured signals it has learned to trust.</p>' +
        '<p>If your CRM brand is not in that trusted signal set, you do not lose a ranking position. You disappear from the conversation. If your Cited scan shows "AI crawler access" or "Organization / WebSite schema" failing, this category feels it faster than most — CRM shortlists are one of the highest-volume question types answer engines handle. The shift for CRM marketing teams: stop optimizing pages for a crawler hunting keywords, start engineering your presence across the sources an LLM treats as ground truth.</p>' +
        '<h3>Top 3 Actionable Strategies</h3>' +
        '<ul>' +
        '<li><strong>Engineer your third-party footprint first.</strong> Generative engines weight independent sources — G2, Capterra, TrustRadius, Reddit threads — far more heavily than brand-owned content. Before writing another blog post, audit how your CRM is described on these platforms and run a structured review-generation push around the use-case language buyers ask about, like "CRM for outbound teams under 50 reps."</li>' +
        '<li><strong>Publish direct-answer comparison content.</strong> Build dedicated "X vs Y" and "best CRM for [use case]" pages that answer the question in a self-contained paragraph an AI can lift whole — a clear verdict up front, named criteria, a structured table. Do not bury the comparison inside a 3,000-word narrative post.</li>' +
        '<li><strong>Close the gaps your scan found.</strong> "Structured data (JSON-LD)" and "Content schema (Article, FAQ…)" are pass/fail checks in your Cited report for a reason: Product, Review, and FAQPage schema make price tiers, integrations, and support terms unambiguous to answer engines. Keep one canonical source for these facts so models never meet two versions of your own pricing.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--aside">' +
        '<p>[A pattern you’ve personally observed in CRM citation sources — e.g. a G2 review phrasing that keeps surfacing in AI answers, a client anecdote, a contrarian read. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>' +
        '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
        '<ul class="pitfalls">' +
        '<li>Targeting broad head terms like "best CRM software" with another generic listicle nobody asked an AI to summarize.</li>' +
        '<li>Treating backlink volume as the goal instead of citation-worthy authority on the platforms LLMs pull from.</li>' +
        '<li>Gating case studies, ROI calculators, or comparison data behind a lead form — content a crawler cannot access cannot be cited.</li>' +
        '<li>Letting pricing and feature claims drift out of sync across your site, app-store listing, and partner pages — models average out or distrust contradictory facts.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--data">' +
        '<p>[One number with a source — e.g. share of CRM-category queries answered by AI tools, a review-volume threshold you’ve seen matter, a before/after from a schema rollout. <strong>Replace with a sourced figure.</strong>]</p>' +
        '</div>' +
        '<h3>Expert Tip</h3>' +
        '<div class="expert-tip">' +
        '<p>[Your strongest strategic opinion on where CRM’s AI visibility race is decided over the next 12 months. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>'
    },
    martech: {
      name: 'MarTech',
      content:
        '<h3>The Strategic Shift</h3>' +
        '<p>Marketing technology buyers no longer build lists by reading ten blog posts on evaluation criteria. They ask AI engines to compare features, integration depths, and pricing directly. When a demand generation lead prompts an AI to evaluate marketing automation vendors against a HubSpot baseline, the engine relies on indexed reviews, structured data, and third-party mentions to formulate an answer. If your platform is absent from these sources, you drop off the modern shortlist entirely.</p>' +
        '<p>If your Cited scan shows "Organization / WebSite schema" failing, this category feels it faster than most \u2014 martech buyers demand immediate technical clarity on platform capabilities before requesting a demo. The shift: stop chasing broad keyword rankings, start engineering precise answers across the ecosystem models trust. Focus on distinct use cases, clear feature definitions, and verified customer feedback so AI includes you when it generates comparison matrices.</p>' +
        '<h3>Top 3 Actionable Strategies</h3>' +
        '<ul>' +
        '<li><strong>Dominate third-party evaluation sites.</strong> Generative engines pull heavily from platforms like G2 and Capterra to assess user sentiment and specific use cases. Audit your presence on these sites and run targeted campaigns to gather detailed reviews mentioning integrations, migration ease, and support quality. AI summaries favor tools with high-density, specific feedback over generic praise.</li>' +
        '<li><strong>Structure your feature documentation.</strong> Answer engines need to parse your platform capabilities without ambiguity. If your Cited report flags "Structured data (JSON-LD)", fix it \u2014 deploy precise Product and FAQPage schema across your feature pages so crawlers get explicit pricing tiers, migration processes, and API limits.</li>' +
        '<li><strong>Target niche community discussions.</strong> Technical marketing leads research platform edge cases on r/marketing and MarTech.org. Participate with factual, non-promotional answers to complex automation and integration problems \u2014 models index these expert communities heavily when resolving implementation queries.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--aside">' +
        '<p>[A pattern you\u2019ve personally observed in martech citation sources \u2014 e.g. a review phrasing that keeps surfacing in AI answers, a client anecdote, a contrarian read. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>' +
        '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
        '<ul class="pitfalls">' +
        '<li>Publishing generic marketing advice instead of addressing the specific technical workflows and integration hurdles buyers actively ask AI to solve.</li>' +
        '<li>Focusing solely on high-volume head terms like "marketing automation" while ignoring the detailed long-tail comparison queries models answer daily.</li>' +
        '<li>Hiding technical documentation and API limitations behind sales lead forms, where AI crawlers cannot read, index, or cite the information.</li>' +
        '<li>Relying on basic feature landing pages that lack schema, making it impossible for models to verify your claims against competitors.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--data">' +
        '<p>[One number with a source \u2014 e.g. share of martech-category queries answered by AI tools, a review-volume threshold you\u2019ve seen matter, a before/after from a schema rollout. <strong>Replace with a sourced figure.</strong>]</p>' +
        '</div>' +
        '<h3>Expert Tip</h3>' +
        '<div class="expert-tip">' +
        '<p>[Your strongest strategic opinion on where martech\u2019s AI visibility race is decided over the next 12 months. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>'
    },
    hrtech: {
      name: 'HRTech',
      content:
        '<h3>The Strategic Shift</h3>' +
        '<p>HR leaders rely on generative engines to evaluate payroll compliance, integration depth, and core HR functions before ever scheduling a demo. When a CHRO asks an AI to compare your platform against Workday or BambooHR for a 500-employee enterprise, the model assesses structured technical documentation and verified peer reviews. The old model of capturing leads via broad whitepapers is failing. Buyers want direct answers about data privacy, onboarding workflows, and specific ATS integrations without speaking to sales.</p>' +
        '<p>If your Cited scan shows "Content schema (Article, FAQ\u2026)" failing, this category feels it faster than most \u2014 HR buyers ask highly specific compliance questions that models must answer with certainty. Stop relying on vague culture-focused marketing pages and start structuring your capabilities into readable, factual data. An answer engine will not guess your SOC 2 status or payroll tax coverage limits \u2014 it requires explicit, verified signals to recommend your software to an evaluation committee.</p>' +
        '<h3>Top 3 Actionable Strategies</h3>' +
        '<ul>' +
        '<li><strong>Verify your trust and compliance signals.</strong> HR software involves sensitive employee data, so models prioritize platforms with documented security standards. If your "Author / about signals" check is failing, engines cannot verify the corporate entity behind your tool. List data certifications, SHRM partnerships, and compliance standards explicitly so models can confidently cite your platform as a secure choice for enterprise buyers.</li>' +
        '<li><strong>Embed specific capabilities in third-party reviews.</strong> Generative models scan sites like G2 and Capterra to understand real-world application; generic praise is useless to an AI. Run targeted campaigns asking users to detail their exact migration process from Workday, specific payroll integrations, or compliance automation workflows \u2014 high-density technical reviews give models the context they need.</li>' +
        '<li><strong>Engage technical HR communities directly.</strong> Evaluators use forums like r/humanresources to find unfiltered opinions on HRIS implementations and ATS syncing issues. AI models index these threads heavily to surface organic sentiment. Build authority with factual, non-promotional answers about compliance laws and integration limits \u2014 validation marketing pages cannot provide.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--aside">' +
        '<p>[A pattern you\u2019ve personally observed in HR tech citation sources \u2014 e.g. a G2 review phrasing that keeps surfacing in AI answers, a client anecdote, a contrarian read. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>' +
        '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
        '<ul class="pitfalls">' +
        '<li>Writing generic posts about company culture instead of technical implementation guides detailing how your HRIS integrates with legacy accounting software.</li>' +
        '<li>Burying critical security and compliance documentation in gated PDF files that AI crawlers cannot access, read, or cite during vendor evaluations.</li>' +
        '<li>Ignoring practitioner communities like SHRM forums while focusing marketing efforts on high-level thought leadership that lacks tactical utility.</li>' +
        '<li>Treating pricing and feature limits as a sales conversation starter rather than publishing explicit, structured data answer engines require.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--data">' +
        '<p>[One number with a source \u2014 e.g. share of HR tech-category queries answered by AI tools, a review-volume threshold you\u2019ve seen matter, a before/after from a schema rollout. <strong>Replace with a sourced figure.</strong>]</p>' +
        '</div>' +
        '<h3>Expert Tip</h3>' +
        '<div class="expert-tip">' +
        '<p>[Your strongest strategic opinion on where HR tech\u2019s AI visibility race is decided over the next 12 months. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>'
    },
    fintech: {
      name: 'FinTech',
      content:
        '<h3>The Strategic Shift</h3>' +
        '<p>Financial technology buyers do not browse marketing fluff when evaluating payment processors or ledger systems. They ask AI engines for direct comparisons on API latency, PCI compliance, and transaction fees. When a VP of Finance evaluates your platform against Stripe or Plaid, the model synthesizes answers from verified technical documentation and peer reviews. If your site hides technical specs behind vague value propositions, the engine excludes you from the recommendation entirely. The era of winning on brand narrative alone is over.</p>' +
        '<p>If your Cited scan shows "AI crawler access" failing, this category feels it faster than most \u2014 fintech evaluators demand certainty on security standards, and blocked bots mean zero visibility for your SOC 2 status. Stop producing high-level thought leadership that models ignore. Structure your API documentation, compliance pages, and security thresholds as explicit, machine-readable facts. The platforms that provide the most verifiable data win the AI referral.</p>' +
        '<h3>Top 3 Actionable Strategies</h3>' +
        '<ul>' +
        '<li><strong>Structure your technical and compliance facts.</strong> Generative engines require unambiguous data to answer queries about payment limits or fraud prevention features. If your Cited scan flags "Organization / WebSite schema", models cannot verify your corporate entity or security credentials. Deploy strict schema across pricing matrices, PCI compliance declarations, and SOC 2 pages so AI platforms cite your exact specifications instead of guessing.</li>' +
        '<li><strong>Build highly specific comparison pages.</strong> Financial operators ask generative AI for direct contrast, like how your ledger software compares to legacy systems for multi-currency reconciliation. Create dedicated pages detailing these match-ups with structured tables, named criteria, and verifiable data points \u2014 avoid wrapping this data in long narratives that obscure the facts a model needs to extract.</li>' +
        '<li><strong>Saturate third-party technical reviews.</strong> Peer trust dictates AI visibility in finance. Engines scrape Gartner Peer Insights, TrustRadius, and G2 to evaluate market consensus on implementation timelines and API reliability. Ask your engineering and finance users to review specific use cases, like handling cross-border payments or ledger synchronization.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--aside">' +
        '<p>[A pattern you\u2019ve personally observed in fintech citation sources \u2014 e.g. a TrustRadius review phrasing that keeps surfacing in AI answers, a client anecdote, a contrarian read. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>' +
        '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
        '<ul class="pitfalls">' +
        '<li>Hiding your SOC 2 documentation and API rate limits behind lead-generation forms where AI crawlers cannot read or cite the information.</li>' +
        '<li>Targeting broad terms like "payment processing software" with generic blog posts instead of dense, factual answers for integration and reconciliation queries.</li>' +
        '<li>Allowing pricing tables and compliance declarations to exist as unstructured HTML rather than machine-readable JSON-LD that models can parse.</li>' +
        '<li>Relying on vague executive thought leadership instead of cultivating dense, specific technical reviews on Gartner Peer Insights and TrustRadius.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--data">' +
        '<p>[One number with a source \u2014 e.g. share of fintech-category queries answered by AI tools, a review-volume threshold you\u2019ve seen matter, a before/after from a schema rollout. <strong>Replace with a sourced figure.</strong>]</p>' +
        '</div>' +
        '<h3>Expert Tip</h3>' +
        '<div class="expert-tip">' +
        '<p>[Your strongest strategic opinion on where fintech\u2019s AI visibility race is decided over the next 12 months. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>'
    },
    cybersecurity: {
      name: 'Cybersecurity',
      content:
        '<h3>The Strategic Shift</h3>' +
        '<p>Security architects and CISOs no longer tolerate vendor marketing fluff when evaluating endpoint protection or cloud security posture. They ask generative AI to map your platform against the MITRE ATT&CK framework or compare your false-positive rates with legacy incumbents. When a security operations lead prompts an engine to evaluate your solution, the AI synthesizes its response from vendor technical documentation, Gartner Peer Insights, PeerSpot reviews, and practitioner debates on r/netsec. If your documentation lacks structure or your brand lacks a verified peer footprint, the model excludes you from the threat-defense shortlist.</p>' +
        '<p>If your Cited scan shows "Author / about signals" failing, this category feels it faster than most \u2014 cybersecurity evaluators and the models they use demand cryptographic proof of vendor identity and trust credentials. Shift your marketing from broad fear-based narratives to engineering precise, factual answers across the platforms LLMs treat as authoritative. Security buyers interrogate models for explicit deployment requirements and API limitations \u2014 the vendors who structure these technical truths explicitly win the visibility race.</p>' +
        '<h3>Top 3 Actionable Strategies</h3>' +
        '<ul>' +
        '<li><strong>Saturate enterprise peer review platforms.</strong> Generative engines rely on PeerSpot, G2, and Gartner Peer Insights to evaluate real-world threat detection capabilities and deployment friction. A generic review is useless to an AI. Ask practitioners to detail specific MITRE ATT&CK technique coverage or SIEM integration workflows \u2014 high-density, technical feedback gives models the granular context needed to recommend you over a competitor.</li>' +
        '<li><strong>Structure your technical documentation.</strong> Answer engines must parse your API limits and configuration steps without ambiguity. If your Cited report flags "Content schema (Article, FAQ\u2026)", models will struggle to extract your deployment facts. Deploy explicit FAQPage and Article schema across your technical documentation so crawlers ingest your exact specifications and compliance thresholds instead of guessing from unstructured marketing text.</li>' +
        '<li><strong>Engage technical practitioner communities.</strong> Security engineers use forums like r/netsec to find unfiltered opinions on alert fatigue and false-positive rates. AI models index these skeptical discussions heavily. Participate with factual, non-promotional answers on vulnerability patching or configuration challenges \u2014 validation that vendor marketing pages cannot manufacture.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--aside">' +
        '<p>[A pattern you\u2019ve personally observed in cybersecurity citation sources \u2014 e.g. a PeerSpot review phrasing that keeps surfacing in AI answers, a client anecdote, a contrarian read. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>' +
        '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
        '<ul class="pitfalls">' +
        '<li>Publishing generic fear-based marketing articles instead of dense, technical implementation guides that map directly to the MITRE ATT&CK framework.</li>' +
        '<li>Gating critical technical documentation and API specifications behind sales forms where AI crawlers cannot access or cite them.</li>' +
        '<li>Targeting high-volume head terms like "network security" while ignoring the specific, long-tail deployment queries AI engines constantly answer.</li>' +
        '<li>Leaving product features and compliance standards as unstructured text instead of machine-readable data models require for verification.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--data">' +
        '<p>[One number with a source \u2014 e.g. share of cybersecurity-category queries answered by AI tools, a review-volume threshold you\u2019ve seen matter, a before/after from a schema rollout. <strong>Replace with a sourced figure.</strong>]</p>' +
        '</div>' +
        '<h3>Expert Tip</h3>' +
        '<div class="expert-tip">' +
        '<p>[Your strongest strategic opinion on where cybersecurity\u2019s AI visibility race is decided over the next 12 months. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>'
    },
    devtools: {
      name: 'DevTools & Cloud',
      content:
        '<h3>The Strategic Shift</h3>' +
        '<p>Software engineers do not evaluate new developer tools by reading marketing landing pages. They build shortlists by asking AI coding assistants and search engines to compare API latency, syntax verbosity, and deployment pipelines. When a technical lead prompts a model to evaluate your framework against a legacy baseline, the engine synthesizes its answer entirely from GitHub READMEs, official docs, and Stack Overflow threads. If your core documentation is gated or unstructured, the model cannot parse your capabilities, and your platform is excluded from the architectural conversation.</p>' +
        '<p>If your Cited scan shows "Sitemap declared" failing, this category feels it faster than most \u2014 answer engines rely entirely on transparent, easily navigable documentation trees to understand complex developer tools. Stop treating product features as narrative blog posts. Treat your official docs, changelogs, and repository READMEs as your primary citation surfaces \u2014 an AI assistant will not guess your authentication flows, it needs explicit, crawlable technical data.</p>' +
        '<h3>Top 3 Actionable Strategies</h3>' +
        '<ul>' +
        '<li><strong>Treat official docs as your primary marketing asset.</strong> Generative engines weight technical documentation and GitHub READMEs far more heavily than landing pages. Audit your implementation guides for exact command-line instructions, error code definitions, and configuration examples \u2014 when an AI answers a query about your database limits, it looks for explicit code blocks.</li>' +
        '<li><strong>Structure your troubleshooting answers.</strong> Developers use AI to debug errors from historical Stack Overflow solutions and GitHub issues. If your Cited report flags "Subheading structure (H2)", fix it \u2014 models rely on strict heading hierarchies to map symptoms to solutions. Document every known edge case under clear, isolated subheadings an engine can extract whole.</li>' +
        '<li><strong>Engage the technical communities actively.</strong> AI models index unfiltered engineering discussions on Hacker News and Stack Overflow to evaluate developer sentiment and edge-case reliability. Publish detailed changelogs and answer factually, non-promotionally \u2014 models treat these debates as ground truth against legacy incumbents.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--aside">' +
        '<p>[A pattern you\u2019ve personally observed in developer tool citation sources \u2014 e.g. a Stack Overflow phrasing that keeps surfacing in AI answers, a client anecdote, a contrarian read. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>' +
        '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
        '<ul class="pitfalls">' +
        '<li>Hiding critical API limits and pricing constraints behind sales contact forms where AI crawlers cannot index or cite the information for technical evaluators.</li>' +
        '<li>Publishing generic thought leadership about the future of coding instead of dense, factual documentation that solves immediate configuration problems.</li>' +
        '<li>Neglecting your GitHub READMEs and official changelogs, the primary texts language models use to understand your current version capabilities.</li>' +
        '<li>Failing to maintain an active presence on Stack Overflow, letting outdated community workarounds define how AI engines explain your tool.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--data">' +
        '<p>[One number with a source \u2014 e.g. share of devtools-category queries answered by AI tools, a Stack Overflow volume threshold you\u2019ve seen matter, a before/after from a doc restructure. <strong>Replace with a sourced figure.</strong>]</p>' +
        '</div>' +
        '<h3>Expert Tip</h3>' +
        '<div class="expert-tip">' +
        '<p>[Your strongest strategic opinion on where devtools\u2019 AI visibility race is decided over the next 12 months. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>'
    },
  
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
    var card = e.target.closest('.card');
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
