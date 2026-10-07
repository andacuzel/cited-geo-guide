/* =====================================================================
   lib/schema.js — the one JSON-LD builder. Single source of truth,
   loaded two ways (UMD, no build step — same pattern as lib/playbooks.js):
     - As a browser <script>, which sets window.CITEHOUND_SCHEMA. Used
       by the scan report's copy-paste fixes (scanner.js) and by the
       standalone generator (tools/schema-generator.js).
     - Via Node's require() from api/mcp.js (generate_schema).

   Rule throughout: a value that is genuinely unknown is a clearly
   bracketed placeholder, never an invented value. A blank input falls
   back to its placeholder, so a half-filled form still produces valid
   structure and countPlaceholders() can say how much is left to fill.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CITEHOUND_SCHEMA = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CONTEXT = 'https://schema.org';

  // Order is the order the generator's type picker shows.
  var TYPES = {
    organization: { label: 'Organization', outputLabel: 'Organization and WebSite' },
    faqpage:      { label: 'FAQPage',       outputLabel: 'FAQPage' },
    article:      { label: 'Article',       outputLabel: 'Article' },
    product:      { label: 'Product',       outputLabel: 'Product' },
    localbusiness:{ label: 'LocalBusiness', outputLabel: 'LocalBusiness' }
  };

  var PH = {
    siteUrl: '[Your site URL, e.g. https://example.com]',
    orgName: '[Your company name]',
    orgDescription: '[A one-sentence description of your business]',
    siteName: '[Your site name]',
    language: '[e.g. en]',
    pageTitle: '[Your page title]',
    pageDescription: '[A one-sentence description of this page]',
    publishedDate: '[YYYY-MM-DD]',
    question: '[A real question your visitors actually ask]',
    answer: '[The real answer, in plain text]',
    question2: '[A second real question]',
    answer2: '[The real answer]',
    productName: '[Your product name]',
    productDescription: '[A one-sentence product description]',
    brand: '[Your brand name]',
    price: '[e.g. 29.99]',
    currency: '[e.g. USD]',
    availability: '[e.g. https://schema.org/InStock]',
    businessName: '[Your business name]',
    businessDescription: '[A one-sentence description of the business]',
    phone: '[e.g. +1 555 010 0100]',
    street: '[Street address]',
    city: '[City]',
    region: '[State or region]',
    postalCode: '[Postal code]',
    country: '[Country code, e.g. US]',
    day: '[e.g. Monday]',
    opens: '[e.g. 09:00]',
    closes: '[e.g. 17:00]'
  };

  var AVAILABILITY = [
    { value: 'https://schema.org/InStock', label: 'In stock' },
    { value: 'https://schema.org/OutOfStock', label: 'Out of stock' },
    { value: 'https://schema.org/PreOrder', label: 'Pre-order' },
    { value: 'https://schema.org/BackOrder', label: 'Back order' },
    { value: 'https://schema.org/LimitedAvailability', label: 'Limited availability' },
    { value: 'https://schema.org/Discontinued', label: 'Discontinued' }
  ];

  var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // Form definition for the standalone generator. Keys are the builder's
  // input keys; ph is the same placeholder the builder falls back to.
  var FIELDS = {
    organization: [
      { key: 'name', label: 'Organization name', ph: PH.orgName },
      { key: 'description', label: 'Description', ph: PH.orgDescription, kind: 'textarea' },
      { key: 'siteName', label: 'Website name', ph: PH.siteName },
      { key: 'language', label: 'Language code', ph: PH.language }
    ],
    faqpage: [
      { key: 'faqs', label: 'Questions and answers', kind: 'faqs' }
    ],
    article: [
      { key: 'headline', label: 'Headline', ph: PH.pageTitle },
      { key: 'description', label: 'Description', ph: PH.pageDescription, kind: 'textarea' },
      { key: 'authorName', label: 'Author or publisher name', ph: PH.orgName },
      { key: 'datePublished', label: 'Date published', ph: PH.publishedDate },
      { key: 'language', label: 'Language code', ph: PH.language }
    ],
    product: [
      { key: 'name', label: 'Product name', ph: PH.productName },
      { key: 'description', label: 'Description', ph: PH.productDescription, kind: 'textarea' },
      { key: 'brand', label: 'Brand', ph: PH.brand },
      { key: 'price', label: 'Price', ph: PH.price },
      { key: 'currency', label: 'Currency code', ph: PH.currency },
      { key: 'availability', label: 'Availability', ph: PH.availability, kind: 'availability' }
    ],
    localbusiness: [
      { key: 'name', label: 'Business name', ph: PH.businessName },
      { key: 'description', label: 'Description', ph: PH.businessDescription, kind: 'textarea' },
      { key: 'phone', label: 'Phone', ph: PH.phone },
      { key: 'street', label: 'Street address', ph: PH.street },
      { key: 'city', label: 'City', ph: PH.city },
      { key: 'region', label: 'State or region', ph: PH.region },
      { key: 'postalCode', label: 'Postal code', ph: PH.postalCode },
      { key: 'country', label: 'Country code', ph: PH.country },
      { key: 'hours', label: 'Opening hours', kind: 'hours' }
    ]
  };

  function str(v) { return v === undefined || v === null ? '' : String(v).trim(); }
  function val(v, placeholder) { return str(v) || placeholder; }
  function siteUrl(domain) { var d = str(domain); return d ? 'https://' + d : PH.siteUrl; }

  function faqItems(faqs) {
    var rows = (Array.isArray(faqs) ? faqs : []).filter(function (f) { return f && (str(f.q) || str(f.a)); });
    if (rows.length === 0) {
      return [
        { '@type': 'Question', name: PH.question, acceptedAnswer: { '@type': 'Answer', text: PH.answer } },
        { '@type': 'Question', name: PH.question2, acceptedAnswer: { '@type': 'Answer', text: PH.answer2 } }
      ];
    }
    return rows.map(function (f) {
      return { '@type': 'Question', name: val(f.q, PH.question), acceptedAnswer: { '@type': 'Answer', text: val(f.a, PH.answer) } };
    });
  }

  // Days that share the same hours become one specification. With no
  // complete rows, one placeholder specification stands in.
  function openingHours(hours) {
    var groups = [];
    DAYS.forEach(function (day) {
      var row = (Array.isArray(hours) ? hours : []).filter(function (h) { return h && h.day === day; })[0];
      if (!row || !str(row.opens) || !str(row.closes)) return;
      var key = str(row.opens) + '|' + str(row.closes);
      var g = groups.filter(function (x) { return x.key === key; })[0];
      if (!g) { g = { key: key, opens: str(row.opens), closes: str(row.closes), days: [] }; groups.push(g); }
      g.days.push(day);
    });
    if (groups.length === 0) {
      return [{ '@type': 'OpeningHoursSpecification', dayOfWeek: PH.day, opens: PH.opens, closes: PH.closes }];
    }
    return groups.map(function (g) {
      return { '@type': 'OpeningHoursSpecification', dayOfWeek: g.days, opens: g.opens, closes: g.closes };
    });
  }

  // input keys: domain, name, description, siteName, language, headline,
  // authorName, datePublished, faqs[{q,a}], brand, price, currency,
  // availability, phone, street, city, region, postalCode, country,
  // hours[{day,opens,closes}].
  function build(type, input) {
    var i = input || {};
    var url = siteUrl(i.domain);

    if (type === 'organization') {
      return {
        '@context': CONTEXT,
        '@graph': [
          { '@type': 'Organization', name: val(i.name, PH.orgName), url: url, description: val(i.description, PH.orgDescription) },
          { '@type': 'WebSite', name: val(i.siteName, PH.siteName), url: url, inLanguage: val(i.language, PH.language) }
        ]
      };
    }

    if (type === 'article') {
      return {
        '@context': CONTEXT,
        '@type': 'Article',
        headline: val(i.headline, PH.pageTitle),
        description: val(i.description, PH.pageDescription),
        inLanguage: val(i.language, PH.language),
        author: { '@type': 'Organization', name: val(i.authorName, PH.orgName) },
        datePublished: val(i.datePublished, PH.publishedDate),
        url: url
      };
    }

    if (type === 'faqpage') {
      // Nothing about real FAQ content is knowable from a homepage scan,
      // so with no rows entered every field is a placeholder on purpose.
      return { '@context': CONTEXT, '@type': 'FAQPage', mainEntity: faqItems(i.faqs) };
    }

    if (type === 'product') {
      return {
        '@context': CONTEXT,
        '@type': 'Product',
        name: val(i.name, PH.productName),
        description: val(i.description, PH.productDescription),
        url: url,
        brand: { '@type': 'Brand', name: val(i.brand, PH.brand) },
        offers: {
          '@type': 'Offer',
          price: val(i.price, PH.price),
          priceCurrency: str(i.currency) ? str(i.currency).toUpperCase() : PH.currency,
          availability: val(i.availability, PH.availability),
          url: url
        }
      };
    }

    if (type === 'localbusiness') {
      return {
        '@context': CONTEXT,
        '@type': 'LocalBusiness',
        name: val(i.name, PH.businessName),
        url: url,
        description: val(i.description, PH.businessDescription),
        telephone: val(i.phone, PH.phone),
        address: {
          '@type': 'PostalAddress',
          streetAddress: val(i.street, PH.street),
          addressLocality: val(i.city, PH.city),
          addressRegion: val(i.region, PH.region),
          postalCode: val(i.postalCode, PH.postalCode),
          addressCountry: val(i.country, PH.country)
        },
        openingHoursSpecification: openingHours(i.hours)
      };
    }

    return null;
  }

  // What a scan of the homepage can genuinely tell us, per type. Used to
  // prefill the generator's form and by the scan report and MCP tool.
  function inputFromSite(type, siteInfo) {
    var si = siteInfo || {};
    var title = str(si.title), desc = str(si.metaDesc), lang = str(si.lang);
    if (type === 'organization') return { description: desc, siteName: title, language: lang };
    if (type === 'article') return { headline: title, description: desc, language: lang };
    if (type === 'product') return { name: title, description: desc };
    if (type === 'localbusiness') return { description: desc };
    return {};
  }

  function buildFromSite(type, domain, siteInfo) {
    var input = inputFromSite(type, siteInfo);
    input.domain = domain;
    return build(type, input);
  }

  function toScriptTag(obj) {
    return '<script type="application/ld+json">\n' + JSON.stringify(obj, null, 2) + '\n<\/script>';
  }

  function countPlaceholders(obj) {
    var n = 0;
    (function walk(v) {
      if (typeof v === 'string') { if (/^\[[^\]]*\]$/.test(v)) n++; return; }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { walk(v[k]); });
    }(obj));
    return n;
  }

  return {
    TYPES: TYPES,
    FIELDS: FIELDS,
    PLACEHOLDERS: PH,
    AVAILABILITY: AVAILABILITY,
    DAYS: DAYS,
    build: build,
    buildFromSite: buildFromSite,
    inputFromSite: inputFromSite,
    toScriptTag: toScriptTag,
    countPlaceholders: countPlaceholders
  };
}));
