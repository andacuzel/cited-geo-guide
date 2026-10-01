/* =====================================================================
   lib/playbooks.js — the fourteen vertical playbook entries.

   Single source of truth, loaded two different ways so the content
   never drifts between the site and anything else that reads it:
     - As a plain browser <script>, loaded before app.js on every page
       that renders playbook cards. Sets window.ANSWERABLE_PLAYBOOKS.
     - Via Node's require() — api/mcp.js's get_playbook tool reads the
       same object this file exports.
   No build step either way: this is the UMD pattern, not a bundle.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ANSWERABLE_PLAYBOOKS = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var saasData = {

    crm: {
      name: 'CRM Software',
      content:
        '<h3>The Strategic Shift</h3>' +
        '<p>For a decade, CRM buyers built their shortlist by Googling "best CRM for small business" and skimming ten blue links. That research layer is collapsing into a single AI-generated answer. When a sales-ops lead asks ChatGPT, Perplexity, or Gemini to compare HubSpot, Salesforce, and Pipedrive, the model is not crawling your homepage in real time — it is synthesizing a response from training data, indexed reviews, and structured signals it has learned to trust.</p>' +
        '<p>If your CRM brand is not in that trusted signal set, you do not lose a ranking position. You disappear from the conversation. If your Answerable scan shows "AI crawler access" or "Organization / WebSite schema" failing, this category feels it faster than most — CRM shortlists are one of the highest-volume question types answer engines handle. The shift for CRM marketing teams: stop optimizing pages for a crawler hunting keywords, start engineering your presence across the sources an LLM treats as ground truth.</p>' +
        '<h3>Top 3 Actionable Strategies</h3>' +
        '<ul><li><strong>Engineer your third-party footprint first.</strong> Generative engines weight independent sources — G2, Capterra, TrustRadius, Reddit threads — far more heavily than brand-owned content. Before writing another blog post, audit how your CRM is described on these platforms and run a structured review-generation push around the use-case language buyers ask about, like "CRM for outbound teams under 50 reps."</li>' +
        '<li><strong>Publish direct-answer comparison content.</strong> Build dedicated "X vs Y" and "best CRM for [use case]" pages that answer the question in a self-contained paragraph an AI can lift whole — a clear verdict up front, named criteria, a structured table. Do not bury the comparison inside a 3,000-word narrative post.</li>' +
        '<li><strong>Close the gaps your scan found.</strong> "Structured data (JSON-LD)" and "Content schema (Article, FAQ…)" are pass/fail checks in your Answerable report for a reason: Product, Review, and FAQPage schema make price tiers, integrations, and support terms unambiguous to answer engines. Keep one canonical source for these facts so models never meet two versions of your own pricing.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--aside"><p>[A pattern you’ve personally observed in CRM citation sources — e.g. a G2 review phrasing that keeps surfacing in AI answers, a client anecdote, a contrarian read. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>' +
        '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
        '<ul class="pitfalls"><li>Targeting broad head terms like "best CRM software" with another generic listicle nobody asked an AI to summarize.</li>' +
        '<li>Treating backlink volume as the goal instead of citation-worthy authority on the platforms LLMs pull from.</li>' +
        '<li>Gating case studies, ROI calculators, or comparison data behind a lead form — content a crawler cannot access cannot be cited.</li>' +
        '<li>Letting pricing and feature claims drift out of sync across your site, app-store listing, and partner pages — models average out or distrust contradictory facts.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--data"><p>[One number with a source — e.g. share of CRM-category queries answered by AI tools, a review-volume threshold you’ve seen matter, a before/after from a schema rollout. <strong>Replace with a sourced figure.</strong>]</p>' +
        '</div>' +
        '<h3>Expert Tip</h3>' +
        '<div class="expert-tip"><p>[Your strongest strategic opinion on where CRM’s AI visibility race is decided over the next 12 months. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>'
    },

    martech: {
      name: 'MarTech',
      content:
        '<h3>The Strategic Shift</h3>' +
        '<p>Marketing technology buyers no longer build lists by reading ten blog posts on evaluation criteria. They ask AI engines to compare features, integration depths, and pricing directly. When a demand generation lead prompts an AI to evaluate marketing automation vendors against a HubSpot baseline, the engine relies on indexed reviews, structured data, and third-party mentions to formulate an answer. If your platform is absent from these sources, you drop off the modern shortlist entirely.</p>' +
        '<p>If your Answerable scan shows "Organization / WebSite schema" failing, this category feels it faster than most — martech buyers demand immediate technical clarity on platform capabilities before requesting a demo. The shift: stop chasing broad keyword rankings, start engineering precise answers across the ecosystem models trust. Focus on distinct use cases, clear feature definitions, and verified customer feedback so AI includes you when it generates comparison matrices.</p>' +
        '<h3>Top 3 Actionable Strategies</h3>' +
        '<ul><li><strong>Dominate third-party evaluation sites.</strong> Generative engines pull heavily from platforms like G2 and Capterra to assess user sentiment and specific use cases. Audit your presence on these sites and run targeted campaigns to gather detailed reviews mentioning integrations, migration ease, and support quality. AI summaries favor tools with high-density, specific feedback over generic praise.</li>' +
        '<li><strong>Structure your feature documentation.</strong> Answer engines need to parse your platform capabilities without ambiguity. If your Answerable report flags "Structured data (JSON-LD)", fix it — deploy precise Product and FAQPage schema across your feature pages so crawlers get explicit pricing tiers, migration processes, and API limits.</li>' +
        '<li><strong>Target niche community discussions.</strong> Technical marketing leads research platform edge cases on r/marketing and MarTech.org. Participate with factual, non-promotional answers to complex automation and integration problems — models index these expert communities heavily when resolving implementation queries.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--aside"><p>[A pattern you’ve personally observed in martech citation sources — e.g. a review phrasing that keeps surfacing in AI answers, a client anecdote, a contrarian read. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>' +
        '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
        '<ul class="pitfalls"><li>Publishing generic marketing advice instead of addressing the specific technical workflows and integration hurdles buyers actively ask AI to solve.</li>' +
        '<li>Focusing solely on high-volume head terms like "marketing automation" while ignoring the detailed long-tail comparison queries models answer daily.</li>' +
        '<li>Hiding technical documentation and API limitations behind sales lead forms, where AI crawlers cannot read, index, or cite the information.</li>' +
        '<li>Relying on basic feature landing pages that lack schema, making it impossible for models to verify your claims against competitors.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--data"><p>[One number with a source — e.g. share of martech-category queries answered by AI tools, a review-volume threshold you’ve seen matter, a before/after from a schema rollout. <strong>Replace with a sourced figure.</strong>]</p>' +
        '</div>' +
        '<h3>Expert Tip</h3>' +
        '<div class="expert-tip"><p>[Your strongest strategic opinion on where martech’s AI visibility race is decided over the next 12 months. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>'
    },

    hrtech: {
      name: 'HRTech',
      content:
        '<h3>The Strategic Shift</h3>' +
        '<p>HR leaders rely on generative engines to evaluate payroll compliance, integration depth, and core HR functions before ever scheduling a demo. When a CHRO asks an AI to compare your platform against Workday or BambooHR for a 500-employee enterprise, the model assesses structured technical documentation and verified peer reviews. The old model of capturing leads via broad whitepapers is failing. Buyers want direct answers about data privacy, onboarding workflows, and specific ATS integrations without speaking to sales.</p>' +
        '<p>If your Answerable scan shows "Content schema (Article, FAQ…)" failing, this category feels it faster than most — HR buyers ask highly specific compliance questions that models must answer with certainty. Stop relying on vague culture-focused marketing pages and start structuring your capabilities into readable, factual data. An answer engine will not guess your SOC 2 status or payroll tax coverage limits — it requires explicit, verified signals to recommend your software to an evaluation committee.</p>' +
        '<h3>Top 3 Actionable Strategies</h3>' +
        '<ul><li><strong>Verify your trust and compliance signals.</strong> HR software involves sensitive employee data, so models prioritize platforms with documented security standards. If your "Author / about signals" check is failing, engines cannot verify the corporate entity behind your tool. List data certifications, SHRM partnerships, and compliance standards explicitly so models can confidently cite your platform as a secure choice for enterprise buyers.</li>' +
        '<li><strong>Embed specific capabilities in third-party reviews.</strong> Generative models scan sites like G2 and Capterra to understand real-world application; generic praise is useless to an AI. Run targeted campaigns asking users to detail their exact migration process from Workday, specific payroll integrations, or compliance automation workflows — high-density technical reviews give models the context they need.</li>' +
        '<li><strong>Engage technical HR communities directly.</strong> Evaluators use forums like r/humanresources to find unfiltered opinions on HRIS implementations and ATS syncing issues. AI models index these threads heavily to surface organic sentiment. Build authority with factual, non-promotional answers about compliance laws and integration limits — validation marketing pages cannot provide.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--aside"><p>[A pattern you’ve personally observed in HR tech citation sources — e.g. a G2 review phrasing that keeps surfacing in AI answers, a client anecdote, a contrarian read. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>' +
        '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
        '<ul class="pitfalls"><li>Writing generic posts about company culture instead of technical implementation guides detailing how your HRIS integrates with legacy accounting software.</li>' +
        '<li>Burying critical security and compliance documentation in gated PDF files that AI crawlers cannot access, read, or cite during vendor evaluations.</li>' +
        '<li>Ignoring practitioner communities like SHRM forums while focusing marketing efforts on high-level thought leadership that lacks tactical utility.</li>' +
        '<li>Treating pricing and feature limits as a sales conversation starter rather than publishing explicit, structured data answer engines require.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--data"><p>[One number with a source — e.g. share of HR tech-category queries answered by AI tools, a review-volume threshold you’ve seen matter, a before/after from a schema rollout. <strong>Replace with a sourced figure.</strong>]</p>' +
        '</div>' +
        '<h3>Expert Tip</h3>' +
        '<div class="expert-tip"><p>[Your strongest strategic opinion on where HR tech’s AI visibility race is decided over the next 12 months. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>'
    },

    fintech: {
      name: 'FinTech',
      content:
        '<h3>The Strategic Shift</h3>' +
        '<p>Financial technology buyers do not browse marketing fluff when evaluating payment processors or ledger systems. They ask AI engines for direct comparisons on API latency, PCI compliance, and transaction fees. When a VP of Finance evaluates your platform against Stripe or Plaid, the model synthesizes answers from verified technical documentation and peer reviews. If your site hides technical specs behind vague value propositions, the engine excludes you from the recommendation entirely. The era of winning on brand narrative alone is over.</p>' +
        '<p>If your Answerable scan shows "AI crawler access" failing, this category feels it faster than most — fintech evaluators demand certainty on security standards, and blocked bots mean zero visibility for your SOC 2 status. Stop producing high-level thought leadership that models ignore. Structure your API documentation, compliance pages, and security thresholds as explicit, machine-readable facts. The platforms that provide the most verifiable data win the AI referral.</p>' +
        '<h3>Top 3 Actionable Strategies</h3>' +
        '<ul><li><strong>Structure your technical and compliance facts.</strong> Generative engines require unambiguous data to answer queries about payment limits or fraud prevention features. If your Answerable scan flags "Organization / WebSite schema", models cannot verify your corporate entity or security credentials. Deploy strict schema across pricing matrices, PCI compliance declarations, and SOC 2 pages so AI platforms cite your exact specifications instead of guessing.</li>' +
        '<li><strong>Build highly specific comparison pages.</strong> Financial operators ask generative AI for direct contrast, like how your ledger software compares to legacy systems for multi-currency reconciliation. Create dedicated pages detailing these match-ups with structured tables, named criteria, and verifiable data points — avoid wrapping this data in long narratives that obscure the facts a model needs to extract.</li>' +
        '<li><strong>Saturate third-party technical reviews.</strong> Peer trust dictates AI visibility in finance. Engines scrape Gartner Peer Insights, TrustRadius, and G2 to evaluate market consensus on implementation timelines and API reliability. Ask your engineering and finance users to review specific use cases, like handling cross-border payments or ledger synchronization.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--aside"><p>[A pattern you’ve personally observed in fintech citation sources — e.g. a TrustRadius review phrasing that keeps surfacing in AI answers, a client anecdote, a contrarian read. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>' +
        '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
        '<ul class="pitfalls"><li>Hiding your SOC 2 documentation and API rate limits behind lead-generation forms where AI crawlers cannot read or cite the information.</li>' +
        '<li>Targeting broad terms like "payment processing software" with generic blog posts instead of dense, factual answers for integration and reconciliation queries.</li>' +
        '<li>Allowing pricing tables and compliance declarations to exist as unstructured HTML rather than machine-readable JSON-LD that models can parse.</li>' +
        '<li>Relying on vague executive thought leadership instead of cultivating dense, specific technical reviews on Gartner Peer Insights and TrustRadius.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--data"><p>[One number with a source — e.g. share of fintech-category queries answered by AI tools, a review-volume threshold you’ve seen matter, a before/after from a schema rollout. <strong>Replace with a sourced figure.</strong>]</p>' +
        '</div>' +
        '<h3>Expert Tip</h3>' +
        '<div class="expert-tip"><p>[Your strongest strategic opinion on where fintech’s AI visibility race is decided over the next 12 months. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>'
    },

    cybersecurity: {
      name: 'Cybersecurity',
      content:
        '<h3>The Strategic Shift</h3>' +
        '<p>Security architects and CISOs no longer tolerate vendor marketing fluff when evaluating endpoint protection or cloud security posture. They ask generative AI to map your platform against the MITRE ATT&CK framework or compare your false-positive rates with legacy incumbents. When a security operations lead prompts an engine to evaluate your solution, the AI synthesizes its response from vendor technical documentation, Gartner Peer Insights, PeerSpot reviews, and practitioner debates on r/netsec. If your documentation lacks structure or your brand lacks a verified peer footprint, the model excludes you from the threat-defense shortlist.</p>' +
        '<p>If your Answerable scan shows "Author / about signals" failing, this category feels it faster than most — cybersecurity evaluators and the models they use demand cryptographic proof of vendor identity and trust credentials. Shift your marketing from broad fear-based narratives to engineering precise, factual answers across the platforms LLMs treat as authoritative. Security buyers interrogate models for explicit deployment requirements and API limitations — the vendors who structure these technical truths explicitly win the visibility race.</p>' +
        '<h3>Top 3 Actionable Strategies</h3>' +
        '<ul><li><strong>Saturate enterprise peer review platforms.</strong> Generative engines rely on PeerSpot, G2, and Gartner Peer Insights to evaluate real-world threat detection capabilities and deployment friction. A generic review is useless to an AI. Ask practitioners to detail specific MITRE ATT&CK technique coverage or SIEM integration workflows — high-density, technical feedback gives models the granular context needed to recommend you over a competitor.</li>' +
        '<li><strong>Structure your technical documentation.</strong> Answer engines must parse your API limits and configuration steps without ambiguity. If your Answerable report flags "Content schema (Article, FAQ…)", models will struggle to extract your deployment facts. Deploy explicit FAQPage and Article schema across your technical documentation so crawlers ingest your exact specifications and compliance thresholds instead of guessing from unstructured marketing text.</li>' +
        '<li><strong>Engage technical practitioner communities.</strong> Security engineers use forums like r/netsec to find unfiltered opinions on alert fatigue and false-positive rates. AI models index these skeptical discussions heavily. Participate with factual, non-promotional answers on vulnerability patching or configuration challenges — validation that vendor marketing pages cannot manufacture.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--aside"><p>[A pattern you’ve personally observed in cybersecurity citation sources — e.g. a PeerSpot review phrasing that keeps surfacing in AI answers, a client anecdote, a contrarian read. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>' +
        '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
        '<ul class="pitfalls"><li>Publishing generic fear-based marketing articles instead of dense, technical implementation guides that map directly to the MITRE ATT&CK framework.</li>' +
        '<li>Gating critical technical documentation and API specifications behind sales forms where AI crawlers cannot access or cite them.</li>' +
        '<li>Targeting high-volume head terms like "network security" while ignoring the specific, long-tail deployment queries AI engines constantly answer.</li>' +
        '<li>Leaving product features and compliance standards as unstructured text instead of machine-readable data models require for verification.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--data"><p>[One number with a source — e.g. share of cybersecurity-category queries answered by AI tools, a review-volume threshold you’ve seen matter, a before/after from a schema rollout. <strong>Replace with a sourced figure.</strong>]</p>' +
        '</div>' +
        '<h3>Expert Tip</h3>' +
        '<div class="expert-tip"><p>[Your strongest strategic opinion on where cybersecurity’s AI visibility race is decided over the next 12 months. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>'
    },

    devtools: {
      name: 'DevTools & Cloud',
      content:
        '<h3>The Strategic Shift</h3>' +
        '<p>Software engineers do not evaluate new developer tools by reading marketing landing pages. They build shortlists by asking AI coding assistants and search engines to compare API latency, syntax verbosity, and deployment pipelines. When a technical lead prompts a model to evaluate your framework against a legacy baseline, the engine synthesizes its answer entirely from GitHub READMEs, official docs, and Stack Overflow threads. If your core documentation is gated or unstructured, the model cannot parse your capabilities, and your platform is excluded from the architectural conversation.</p>' +
        '<p>If your Answerable scan shows "Sitemap declared" failing, this category feels it faster than most — answer engines rely entirely on transparent, easily navigable documentation trees to understand complex developer tools. Stop treating product features as narrative blog posts. Treat your official docs, changelogs, and repository READMEs as your primary citation surfaces — an AI assistant will not guess your authentication flows, it needs explicit, crawlable technical data.</p>' +
        '<h3>Top 3 Actionable Strategies</h3>' +
        '<ul><li><strong>Treat official docs as your primary marketing asset.</strong> Generative engines weight technical documentation and GitHub READMEs far more heavily than landing pages. Audit your implementation guides for exact command-line instructions, error code definitions, and configuration examples — when an AI answers a query about your database limits, it looks for explicit code blocks.</li>' +
        '<li><strong>Structure your troubleshooting answers.</strong> Developers use AI to debug errors from historical Stack Overflow solutions and GitHub issues. If your Answerable report flags "Subheading structure (H2)", fix it — models rely on strict heading hierarchies to map symptoms to solutions. Document every known edge case under clear, isolated subheadings an engine can extract whole.</li>' +
        '<li><strong>Engage the technical communities actively.</strong> AI models index unfiltered engineering discussions on Hacker News and Stack Overflow to evaluate developer sentiment and edge-case reliability. Publish detailed changelogs and answer factually, non-promotionally — models treat these debates as ground truth against legacy incumbents.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--aside"><p>[A pattern you’ve personally observed in developer tool citation sources — e.g. a Stack Overflow phrasing that keeps surfacing in AI answers, a client anecdote, a contrarian read. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>' +
        '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
        '<ul class="pitfalls"><li>Hiding critical API limits and pricing constraints behind sales contact forms where AI crawlers cannot index or cite the information for technical evaluators.</li>' +
        '<li>Publishing generic thought leadership about the future of coding instead of dense, factual documentation that solves immediate configuration problems.</li>' +
        '<li>Neglecting your GitHub READMEs and official changelogs, the primary texts language models use to understand your current version capabilities.</li>' +
        '<li>Failing to maintain an active presence on Stack Overflow, letting outdated community workarounds define how AI engines explain your tool.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--data"><p>[One number with a source — e.g. share of devtools-category queries answered by AI tools, a Stack Overflow volume threshold you’ve seen matter, a before/after from a doc restructure. <strong>Replace with a sourced figure.</strong>]</p>' +
        '</div>' +
        '<h3>Expert Tip</h3>' +
        '<div class="expert-tip"><p>[Your strongest strategic opinion on where devtools’ AI visibility race is decided over the next 12 months. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>'
    },

  };

  var brandData = {

    ecommerce: {
      name: 'E-commerce & DTC Brands',
      content:
        '<h3>The Strategic Shift</h3>' +
        '<p>A decade of product-led SEO trained shoppers to scan ten blue links and compare specs themselves. That habit is disappearing. When someone asks ChatGPT or Perplexity to recommend a running shoe, a mattress, or a skincare routine, the model does not scroll a results page — it synthesizes an answer from product reviews, marketplace listings, and structured data it already trusts, then names two or three brands and stops.</p>' +
        '<p>If your store is not part of that trusted set, you are not buried on page two, you are absent from the answer entirely. A scan that shows "Structured data (JSON-LD)" or "Content schema (Article, FAQ…)" failing means a model cannot confidently confirm your price, availability, or reviews. The task for DTC teams: stop chasing keyword rankings and start feeding the structured facts and third-party proof engines cite when a shopper asks for a recommendation.</p>' +
        '<h3>Top 3 Actionable Strategies</h3>' +
        '<ul><li><strong>Treat Trustpilot and marketplace reviews as primary sources.</strong> Generative engines weight independent review volume and sentiment far more heavily than your own product copy. Audit how your best sellers are described on Trustpilot, Amazon, and comparison sites, then close the gap between what reviewers say and what your product pages claim — model answers favor the version of the story reviewers keep repeating.</li>' +
        '<li><strong>Mark up every product with Product and Review schema.</strong> "Structured data (JSON-LD)" is the fastest way to hand a model your price, stock status, and star rating without ambiguity. Ship Product and Review schema on every SKU page, keep it in sync with real stock levels, and treat a schema gap as a launch blocker, not a follow-up task.</li>' +
        '<li><strong>Answer comparison queries before a customer asks them.</strong> Build dedicated pages for "best [category] for [use case]" and direct brand-versus-brand comparisons, naming a clear winner and the criteria behind it. These are the exact question shapes shoppers put to AI assistants, and a page shaped like the answer is easy for a model to lift whole.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--aside"><p>[A pattern you’ve personally observed in e-commerce citation sources — e.g. a Trustpilot phrasing that keeps surfacing in AI answers, a UGC trend, a contrarian read on marketplace reviews. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>' +
        '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
        '<ul class="pitfalls"><li>Writing product descriptions as marketing copy alone, with no factual spec table a model can extract cleanly from the page.</li>' +
        '<li>Chasing backlink volume from deal-aggregator sites instead of building citation-worthy reviews on Trustpilot and the category-specific forums shoppers read before buying.</li>' +
        '<li>Letting price or stock status drift out of sync between your site, marketplace listings, and structured data — models distrust contradictory facts.</li>' +
        '<li>Gating size guides, ingredient lists, or return policies behind a chat widget instead of publishing them as crawlable page content.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--data"><p>[One number with a source — e.g. share of product-discovery queries now answered by AI shopping tools, a review-volume threshold you’ve seen matter, a before/after from a schema rollout. <strong>Replace with a sourced figure.</strong>]</p>' +
        '</div>' +
        '<h3>Expert Tip</h3>' +
        '<div class="expert-tip"><p>[Your strongest strategic opinion on where e-commerce AI visibility is decided over the next 12 months. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>'
    },

    consumerapps: {
      name: 'Consumer Apps',
      content:
        '<h3>The Strategic Shift</h3>' +
        '<p>Smartphone users used to browse top charts or read tech press round-ups to find new software. Today, they ask conversational agents for hyper-specific solutions. When someone asks ChatGPT or Perplexity for a habit tracker with offline mode and a one-time fee, the model does not browse your landing page — it builds a response from App Store listings, Play Store reviews, Product Hunt discussions, and verified subreddits. If your app lacks density across these platforms, you are entirely invisible to the user.</p>' +
        '<p>If your Answerable scan shows "AI crawler access" failing, this category feels it faster than most — app discovery relies heavily on third-party aggregators parsing your web footprint. The mandate for consumer app developers: stop relying solely on paid user acquisition and standard store optimization. Start shaping your brand narrative on the external platforms that feed generative models, ensuring your features and pricing are immediately clear to an automated agent.</p>' +
        '<h3>Top 3 Actionable Strategies</h3>' +
        '<ul><li><strong>Seed authentic community discussions.</strong> Generative engines pull heavily from user-generated content to judge an app’s utility. Ensure your core features and use cases are discussed on Product Hunt and relevant subreddits. Answer engines look for genuine user problems solved by your software. Encourage active users to mention specific features in their App Store and Play Store reviews, giving models the exact vocabulary potential new users search for.</li>' +
        '<li><strong>Structure your marketing site for extraction.</strong> An AI needs to parse your core value proposition instantly. If your report shows "Subheading structure (H2)" failing, you are burying your features. Organize your landing page with clear, semantic headings that separate pricing, privacy policies, and offline capabilities. Clear architecture allows an answer engine to index your software’s specifics without getting lost in promotional copy.</li>' +
        '<li><strong>Standardize your feature claims.</strong> Models distrust contradictory information. Ensure your App Store description, technical documentation, and landing page present the exact same feature names, subscription tiers, and compatibility requirements. Deploy explicit schema markup on your main site to state operating system requirements and pricing models clearly. This consistency leaves zero ambiguity for an AI when it evaluates your app against a user’s hyper-specific prompt.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--aside"><p>[A pattern you’ve personally observed in consumer app citation sources — e.g. a review phrasing that keeps surfacing in AI answers, a client anecdote, a contrarian read. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>' +
        '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
        '<ul class="pitfalls"><li>Hiding pricing and subscription details inside the app instead of publishing them clearly on the web where models can index them.</li>' +
        '<li>Focusing solely on App Store keywords while ignoring the detailed, problem-solving feature discussions in tech press round-ups and relevant Reddit communities.</li>' +
        '<li>Using vague marketing language on your landing page instead of stating exactly what the app does in plain text.</li>' +
        '<li>Overlooking the importance of user reviews, which provide the conversational, long-tail phrases that AI engines use to match search intent.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--data"><p>[One number with a source — e.g. share of consumer app-category queries answered by AI tools, a review-volume threshold you’ve seen matter, a before/after from a schema rollout. <strong>Replace with a sourced figure.</strong>]</p>' +
        '</div>' +
        '<h3>Expert Tip</h3>' +
        '<div class="expert-tip"><p>[Your strongest strategic opinion on where consumer apps’ AI visibility race is decided over the next 12 months. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>'
    },

    hospitality: {
      name: 'Hospitality & Travel',
      content:
        '<h3>The Strategic Shift</h3>' +
        '<p>Travelers used to read ten blogs and search OTA listings to find the right stay. Now, they ask an AI agent for a boutique hotel with a pool near the historic district under $250. When a traveler prompts an engine for recommendations, the model bypasses your beautifully designed homepage. It builds a consensus from your Google Business Profile, TripAdvisor ratings, OTA listings, and mentions in the local press. If your property lacks deep, consistent context across these third-party sources, you vanish from the itinerary.</p>' +
        '<p>If your Answerable scan shows "Structured data (JSON-LD)" failing, this category feels it faster than most — hospitality searches hinge entirely on confirmed amenities, pricing, and location data. Answer engines require absolute certainty on check-in policies and pet rules before suggesting a stay. The shift for hospitality marketers: stop relying on visual storytelling alone and start feeding models the raw, structured facts they need to confidently answer "best hotel in X" queries.</p>' +
        '<h3>Top 3 Actionable Strategies</h3>' +
        '<ul><li><strong>Dominate your third-party footprint.</strong> Generative models trust consensus over self-published claims. Claim and actively manage your Google Business Profile, TripAdvisor presence, and OTA listings. Encourage guests to mention specific amenities like fast Wi-Fi or a heated pool in their reviews. A dense, positive presence on these sites ensures models associate your property with the exact terms travelers search for.</li>' +
        '<li><strong>Publish direct answers for amenities.</strong> Avoid burying your check-in times, parking availability, and pet policies inside lengthy paragraphs. Build a dedicated FAQ page that answers these common questions in clear, definitive sentences. An AI crawler needs to extract this information instantly to satisfy user prompts. Format your site to serve as a clean database of facts about your property, stripping away marketing fluff.</li>' +
        '<li><strong>Standardize your contact signals.</strong> If your report flags "Contact signals" as failing, answer engines cannot verify your legitimacy. Ensure your physical address, phone number, and email are identical across your website, local press mentions, and aggregator profiles. Models average out discrepancies, and conflicting addresses will cause an AI to drop your property from its recommendations. A unified footprint builds algorithmic trust.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--aside"><p>[A pattern you’ve personally observed in hospitality citation sources — e.g. a review phrasing that keeps surfacing in AI answers, a client anecdote, a contrarian read. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>' +
        '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
        '<ul class="pitfalls"><li>Relying exclusively on heavy imagery and video tours while neglecting the text-based descriptions that AI crawlers require to understand your property.</li>' +
        '<li>Ignoring your Google Business Profile and TripAdvisor reviews, allowing outdated or incorrect guest feedback to shape the model’s understanding of your hotel.</li>' +
        '<li>Hiding key policies like parking fees or cancellation terms inside downloadable PDFs that generative models cannot easily parse or index.</li>' +
        '<li>Using contradictory names or addresses across OTA listings and your own site, forcing answer engines to doubt your core business information.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--data"><p>[One number with a source — e.g. share of hospitality-category queries answered by AI tools, a review-volume threshold you’ve seen matter, a before/after from a schema rollout. <strong>Replace with a sourced figure.</strong>]</p>' +
        '</div>' +
        '<h3>Expert Tip</h3>' +
        '<div class="expert-tip"><p>[Your strongest strategic opinion on where hospitality’s AI visibility race is decided over the next 12 months. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>'
    },

    marketplaces: {
      name: 'Marketplaces',
      content:
        '<h3>The Strategic Shift</h3>' +
        '<p>Marketplace growth traditionally relied on capturing long-tail keyword traffic and outbidding competitors on paid search. That playbook is shifting as buyers ask conversational agents to filter the noise. When a user asks an AI to compare freelance platforms or find a safe peer-to-peer used car market, the engine does not scroll your category pages. It synthesizes insights from category comparison content, buyer and seller review platforms, and raw discussions on Reddit. If your marketplace lacks a strong reputation across these external nodes, you lose the recommendation.</p>' +
        '<p>If your Answerable scan shows "Content schema (Article, FAQ…)" failing, this category feels it faster than most — marketplaces live and die by their inventory visibility. Answer engines demand clear structures to understand the depth and categories of your offerings. The mandate for marketplace operators: stop burying your inventory behind complex search facets. Start exposing your supply liquidity and trust metrics through structured data and independent reviews so an AI can confidently recommend your ecosystem.</p>' +
        '<h3>Top 3 Actionable Strategies</h3>' +
        '<ul><li><strong>Cultivate dual-sided reviews.</strong> Marketplaces require algorithmic trust from both buyers and sellers. Direct your community teams to actively build a presence on independent review platforms and facilitate organic discussions on Reddit. Generative models evaluate the health of your marketplace by scanning these third-party sites for consensus on safety, fee transparency, and customer support. A strong off-site reputation provides the foundational data models use.</li>' +
        '<li><strong>Expose your inventory structure.</strong> Generative models struggle with deep, gated site architectures. If your report shows "Sitemap declared" as failing, models cannot discover your category hubs. Provide a clean, text-based map of your inventory categories and seller policies, allowing an AI to understand your entire platform without executing internal searches. Build static category comparison content that clearly explains what your marketplace offers.</li>' +
        '<li><strong>Clarify policies with plain text.</strong> Marketplaces often bury their buyer protection policies, seller fees, and dispute resolution processes in massive legal documents. Extract these core facts into a centralized, easily scannable FAQ format. Answer engines prefer short, declarative sentences when explaining how a platform works to a user. Making your rules unambiguous ensures models can confidently explain your value proposition and safety mechanisms.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--aside"><p>[A pattern you’ve personally observed in marketplace citation sources — e.g. a review phrasing that keeps surfacing in AI answers, a client anecdote, a contrarian read. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>' +
        '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
        '<ul class="pitfalls"><li>Locking your best seller profiles and inventory behind login walls, preventing AI crawlers from seeing the liquidity that makes your marketplace valuable.</li>' +
        '<li>Ignoring seller and buyer complaints on external review sites, allowing negative consensus to dominate the training data models consume.</li>' +
        '<li>Relying on heavy infinite scroll for category pages without providing clear, crawlable pagination or static links for answer engines to follow.</li>' +
        '<li>Publishing conflicting fee structures across different support pages, causing models to provide inaccurate pricing information to potential new users.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--data"><p>[One number with a source — e.g. share of marketplace-category queries answered by AI tools, a review-volume threshold you’ve seen matter, a before/after from a schema rollout. <strong>Replace with a sourced figure.</strong>]</p>' +
        '</div>' +
        '<h3>Expert Tip</h3>' +
        '<div class="expert-tip"><p>[Your strongest strategic opinion on where marketplaces’ AI visibility race is decided over the next 12 months. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>'
    },
  };

  var professionalData = {

    health: {
      name: 'Health & Wellness',
      content:
        '<h3>The Strategic Shift</h3>' +
        '<p>Patients used to ask friends for doctor recommendations or scroll through generic insurance portals. Now, they query AI agents for specialists matching exact symptoms and coverage. When a patient asks an engine for a local pediatrician taking Cigna with weekend hours, the model is not crawling your static clinic site. It cross-references Zocdoc, Healthgrades, Google Business Profile ratings, and state insurance directories to verify your practice. If your professional footprint is absent from these critical nodes, you disappear from the patient’s options entirely.</p>' +
        '<p>If your Answerable scan shows "Author / about signals" failing, this category feels it faster than most — medical queries require the highest tier of algorithmic trust to satisfy safety thresholds. An LLM simply will not recommend a physician it cannot verify. The shift for independent practitioners: stop writing generic wellness advice that models already know. Start verifying your exact credentials, insurance networks, and patient sentiment across the external healthcare platforms that answer engines trust.</p>' +
        '<h3>Top 3 Actionable Strategies</h3>' +
        '<ul><li><strong>Claim your healthcare directory profiles.</strong> Generative models rely on authoritative third-party medical databases to verify your license and specialties. Spend an afternoon updating your Zocdoc and Healthgrades profiles to reflect your exact current address, accepted insurance plans, and practice areas. Models use these platforms as primary fact-checking layers before recommending a provider to a patient searching for a specific treatment.</li>' +
        '<li><strong>Consolidate your local patient feedback.</strong> Answer engines prioritize practices with consistent, detailed patient reviews. Direct your front desk to hand out review cards pointing patients to your Google Business Profile. Encourage them to mention specific logistical details like wait times, bedside manner, and ease of booking. Models scan this consensus text to answer nuanced prompts about patient experience and clinic reliability.</li>' +
        '<li><strong>Deploy basic medical structured data.</strong> If your report flags "Structured data (JSON-LD)" as missing, models cannot parse your clinic’s core facts. Use a free online generator to build MedicalBusiness and Physician schema code, then paste it directly into your website builder. This explicit tagging tells an AI exactly who you are, where you practice, and what services you offer without needing a developer.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--aside"><p>[A pattern you’ve personally observed in health citation sources — e.g. a review phrasing that keeps surfacing in AI answers, a client anecdote, a contrarian read. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>' +
        '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
        '<ul class="pitfalls"><li>Leaving your insurance network lists outdated on your main website, causing models to provide incorrect billing information to patients.</li>' +
        '<li>Writing extensive medical advice blogs instead of publishing clear, simple FAQs about your clinic hours, parking, and booking policies.</li>' +
        '<li>Letting your clinic address drift out of sync across Healthgrades and your Google Business Profile, which immediately fractures algorithmic trust.</li>' +
        '<li>Ignoring unverified profiles on secondary medical directories, allowing automated and incorrect data to pollute the training sets models consume.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--data"><p>[One number with a source — e.g. share of health-category queries answered by AI tools, a review-volume threshold you’ve seen matter, a before/after from a schema rollout. <strong>Replace with a sourced figure.</strong>]</p>' +
        '</div>' +
        '<h3>Expert Tip</h3>' +
        '<div class="expert-tip"><p>[Your strongest strategic opinion on where health’s AI visibility race is decided over the next 12 months. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>'
    },

    localservices: {
      name: 'Local Services & Trades',
      content:
        '<h3>The Strategic Shift</h3>' +
        '<p>Homeowners used to hunt through direct mailers or search Google for local plumbers, scrolling past ads to find a decent website. Today, they ask conversational agents for a licensed professional with emergency hours and five-star ratings. When a user asks an AI to find a top-rated local electrician for a panel upgrade, the engine ignores your beautifully coded homepage. It synthesizes reviews from your Google Business Profile, Angi, Houzz, Yelp, and local press mentions to build a consensus on your reliability.</p>' +
        '<p>If your Answerable scan shows "Contact signals" failing, this category feels it faster than most — local service recommendations are built entirely on verified service areas and immediate contact availability. A model will not suggest a contractor it cannot map. The new mandate for independent tradespeople: stop spending weekends tweaking your website design. Start aligning your core business details across the exact consumer directories and review aggregators that generative models treat as absolute factual ground truth.</p>' +
        '<h3>Top 3 Actionable Strategies</h3>' +
        '<ul><li><strong>Standardize your local business citations.</strong> Answer engines need absolute certainty about your service area. Ensure your business name, phone number, and physical address match perfectly across Yelp, Angi, Houzz, and your Google Business Profile. If you are an event vendor, do the same for The Knot and WeddingWire. Models penalize conflicting data, so a mismatched phone number will cause an AI to drop you from its trusted list.</li>' +
        '<li><strong>Extract direct answers for service queries.</strong> Avoid burying your pricing models or emergency fees in long paragraphs. If your scan marks "Content schema (Article, FAQ…)" as missing, models cannot confidently quote your terms. Build a simple FAQ page that directly answers common questions about your hourly rates, dispatch fees, and warranty policies. Clear, definitive sentences give an AI the exact text it needs to satisfy a homeowner’s prompt.</li>' +
        '<li><strong>Drive hyper-specific customer reviews.</strong> Generative models prioritize vendors with dense, descriptive feedback over those with simple star ratings. Send an email to past clients asking them to mention the exact service you performed on their Google Business Profile review. When a homeowner searches for a contractor experienced in installing tankless water heaters, the AI scans these external platforms for those specific keywords to match the prompt.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--aside"><p>[A pattern you’ve personally observed in local services citation sources — e.g. a review phrasing that keeps surfacing in AI answers, a client anecdote, a contrarian read. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>' +
        '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
        '<ul class="pitfalls"><li>Hiding your service area behind a generic contact form instead of listing the specific towns and zip codes you cover.</li>' +
        '<li>Using tracking phone numbers on external directories like Yelp or Angi, which confuses models comparing data against your main site.</li>' +
        '<li>Pasting plain-text testimonials onto your website instead of pointing happy customers to third-party platforms that answer engines inherently trust.</li>' +
        '<li>Relying on generic homepages without deploying LocalBusiness and Service schema to explicitly tell models exactly what trades you practice.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--data"><p>[One number with a source — e.g. share of local services-category queries answered by AI tools, a review-volume threshold you’ve seen matter, a before/after from a schema rollout. <strong>Replace with a sourced figure.</strong>]</p>' +
        '</div>' +
        '<h3>Expert Tip</h3>' +
        '<div class="expert-tip"><p>[Your strongest strategic opinion on where local services’ AI visibility race is decided over the next 12 months. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>'
    },

    realestate: {
      name: 'Real Estate Agents',
      content:
        '<h3>The Strategic Shift</h3>' +
        '<p>Home buyers and sellers used to hunt for local realtors on Google, browsing generic agency sites and comparing headshots. Today, they ask conversational agents for hyper-local experts with specific experience. When a family asks an AI to find an agent who specializes in mid-century homes in a specific zip code, the model does not crawl your personal blog. It reads Google Business Profile reviews, Zillow sales histories, Realtor.com agent profiles, and local press mentions to determine who has actual authority. If you lack a dominant presence in those specific channels, you miss the lead entirely.</p>' +
        '<p>If your Answerable scan shows "Contact signals" failing, this category feels it faster than most — real estate is a hyper-local, trust-based business where models quickly penalize mismatched phone numbers or missing office addresses. A solo agent cannot outspend a massive national brokerage on paid search ads. The new mandate is to claim your third-party profiles and aggressively align your core contact details across the web, so answer engines recognize you as the definitive local expert they can confidently recommend to a buyer.</p>' +
        '<h3>Top 3 Actionable Strategies</h3>' +
        '<ul><li><strong>Centralize your client testimonials.</strong> Generative engines trust verified third-party reviews far more than the quotes you paste on your homepage. Send your past clients direct links to leave reviews on your Google Business Profile and Zillow profile. Instruct them to mention the specific neighborhoods and property types you helped them with. An AI engine scans these platforms to match your exact expertise to a buyer’s hyper-local search prompt.</li>' +
        '<li><strong>Fix your local business citations.</strong> Answer engines require absolute certainty about where you work. If your report shows "Structured data (JSON-LD)" failing, models struggle to verify your service area. You can fix this in an afternoon without a developer by using a free schema generator to create LocalBusiness and RealEstateAgent markup. Paste this code into your website builder to explicitly state your office address, phone number, and operating hours.</li>' +
        '<li><strong>Align your agent profiles.</strong> Inconsistent information fractures an AI model’s confidence in your business. Audit your Realtor.com, Zillow, and local chamber of commerce directories to ensure your name, brokerage affiliation, and contact details match exactly. Answer engines look for a unified digital footprint. A mismatched email address or an outdated phone number across different platforms causes a model to drop you from its list of trusted local recommendations.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--aside"><p>[A pattern you’ve personally observed in real estate citation sources — e.g. a review phrasing that keeps surfacing in AI answers, a client anecdote, a contrarian read. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>' +
        '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
        '<ul class="pitfalls"><li>Writing generic blog posts about national mortgage rates instead of focusing on hyper-local market updates that answer engines can cite.</li>' +
        '<li>Leaving your Zillow or Realtor.com profiles empty or incomplete, forcing generative models to guess your recent sales history and neighborhood expertise.</li>' +
        '<li>Pasting text-only testimonials directly onto your homepage without pointing clients to verified review platforms, which models discount as unverified self-promotion.</li>' +
        '<li>Using a different phone number on your website than the one listed on your Google Business Profile, destroying algorithmic trust.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--data"><p>[One number with a source — e.g. share of real estate-category queries answered by AI tools, a review-volume threshold you’ve seen matter, a before/after from a schema rollout. <strong>Replace with a sourced figure.</strong>]</p>' +
        '</div>' +
        '<h3>Expert Tip</h3>' +
        '<div class="expert-tip"><p>[Your strongest strategic opinion on where real estate’s AI visibility race is decided over the next 12 months. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>'
    },

    legal: {
      name: 'Legal Practices',
      content:
        '<h3>The Strategic Shift</h3>' +
        '<p>People facing a legal crisis used to scroll past ads to find a local attorney. Now, they ask AI tools to recommend a lawyer based on exact circumstances. When a user asks an engine for a local attorney experienced in commercial lease disputes, the model does not read your generic homepage. It synthesizes insights from Avvo, Martindale-Hubbell, your Google Business Profile, state bar directories, and practice-area queries. If your practice lacks deep authority in those specific off-site repositories, you are excluded from the answer.</p>' +
        '<p>If your Answerable scan shows "Author / about signals" failing, this category feels it faster than most — legal queries demand high authoritative trust, and an LLM will ignore a practitioner it cannot verify. Independent attorneys do not need an enterprise marketing budget to win this space. The new standard is strictly defining your expertise and maintaining a flawless, verified presence across the exact directories and review platforms that generative models treat as factual ground truth.</p>' +
        '<h3>Top 3 Actionable Strategies</h3>' +
        '<ul><li><strong>Claim your legal directories.</strong> Models pull heavily from established industry databases to verify your credentials. Spend an afternoon updating your Avvo, Martindale-Hubbell, and state bar directory profiles. Ensure your practice areas, bar admission dates, and disciplinary records are accurate and detailed. Generative engines use these specific platforms as primary fact-checking layers before they ever suggest your name to a user seeking legal representation.</li>' +
        '<li><strong>Answer specific practice-area queries.</strong> Broad claims about being a trial lawyer give an AI nothing to extract. Build simple, single-topic pages on your site that directly answer specific client questions, like the exact statute of limitations for personal injury in your state. Write in plain, definitive sentences without excessive legalese. Models lift these clear answers verbatim when users ask complex legal questions.</li>' +
        '<li><strong>Structure your contact and practice data.</strong> Generative models need to read your credentials easily. If your scan marks "Structured data (JSON-LD)" as missing, an AI cannot definitively parse your practice details. Use a free tool to generate LegalService schema and add it to your site. This code directly tells the engine your precise business name, location, and verified contact details, bridging the gap between your site and your external profiles.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--aside"><p>[A pattern you’ve personally observed in legal citation sources — e.g. a review phrasing that keeps surfacing in AI answers, a client anecdote, a contrarian read. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>' +
        '<h3>Outdated SEO Pitfalls to Avoid</h3>' +
        '<ul class="pitfalls"><li>Stuffing your homepage with generic keywords like "best lawyer near me" instead of clearly stating your specific practice areas and jurisdictions.</li>' +
        '<li>Ignoring your Google Business Profile reviews, allowing a handful of negative or unanswered client experiences to shape a model’s baseline understanding.</li>' +
        '<li>Publishing long, unstructured essays on case law instead of offering direct, scannable answers to the common practice-area queries clients ask.</li>' +
        '<li>Listing conflicting office addresses or phone numbers across your state bar directory and Avvo profile, which breaks a model’s confidence.</li>' +
        '</ul>' +
        '<div class="expert-tip expert-tip--data"><p>[One number with a source — e.g. share of legal-category queries answered by AI tools, a review-volume threshold you’ve seen matter, a before/after from a schema rollout. <strong>Replace with a sourced figure.</strong>]</p>' +
        '</div>' +
        '<h3>Expert Tip</h3>' +
        '<div class="expert-tip"><p>[Your strongest strategic opinion on where legal’s AI visibility race is decided over the next 12 months. <strong>This box is for your proprietary point of view.</strong>]</p>' +
        '</div>'
    },
  };

  return { saasData: saasData, brandData: brandData, professionalData: professionalData };
}));
