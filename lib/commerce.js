/* =====================================================================
   lib/commerce.js — the agentic-commerce checks, as pure analysis. No
   network access here: lib/scanner.js does the fetching (and decides what
   is fetched, in what order, and how politely) and hands the results to
   these functions, which makes every rule below testable offline.

   Everything in here is deliberately separate from the main 16-check
   score. A commerce sub-score exists only when a site is detected as a
   store, and it never touches result.total, so commerce and non-commerce
   sites stay comparable and the published category benchmarks stay valid.

   The patterns come from reading real sites: Shopify's markers and the
   UCP merchant profile shape were checked against 30+ live stores, and
   Salesforce Commerce Cloud's against two. WooCommerce, BigCommerce and
   Magento use their documented asset paths but have not been checked
   against a live store of their own.
   ===================================================================== */

var THRESHOLD = 2;

var PLATFORMS = [
  {
    name: 'Shopify',
    html: /cdn\.shopify\.com|window\.Shopify|Shopify\.(theme|shop|routes)|shopify-section/i,
    headers: [['powered-by', /shopify/i], ['x-shopify-stage', /./], ['x-shopid', /./]]
  },
  { name: 'WooCommerce', html: /\/wp-content\/plugins\/woocommerce\/|woocommerce-(page|no-js)|class="[^"]*\bwoocommerce\b/i },
  { name: 'BigCommerce', html: /cdn\d*\.bigcommerce\.com|bigcommerce\.com\/s-/i },
  { name: 'Magento', html: /\/static\/version\d+\/frontend\/|text\/x-magento-init|Magento_/ },
  { name: 'Salesforce Commerce Cloud', html: /demandware\.(static|net)|dwanalytics|\/on\/demandware\.store/i }
];

var PRODUCT_PATH = /\/products?\/[^/?#]+/i;
var CART_LINK = /href\s*=\s*["']([^"']*\/(?:cart|checkout|basket|bag|shopping-cart)(?:[\/?#][^"']*)?)["']/i;
var COLLECTION_PATH = /\/collections?\/[^/?#]+/i;

function str(v) { return typeof v === 'string' ? v.trim() : (typeof v === 'number' ? String(v) : ''); }
function nonEmptyObject(v) { return !!v && typeof v === 'object' && Object.keys(v).length > 0; }
function decodeXml(s) { return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\''); }
function bareHost(h) { return String(h || '').toLowerCase().replace(/^www\./, ''); }

function sameSite(url, origin) {
  try { return bareHost(new URL(url).hostname) === bareHost(new URL(origin).hostname); } catch (e) { return false; }
}

/* ---------------- UCP merchant profile ---------------- */

// A valid profile is a JSON object with a "ucp" block that has a version
// string and at least one declared service or capability: the shape every
// live profile examined (Allbirds, Magic Spoon, Bearaby, Outdoor Voices)
// shares. A 200 that is HTML (a soft 404) or JSON of another shape is
// reported as what it is, not as a profile.
function analyzeUcp(res) {
  res = res || {};
  if (res.notFound) return { state: 'absent', detail: 'The server answered 404.' };
  if (!res.ok) {
    return { state: 'absent', detail: res.status ? 'The server answered HTTP ' + res.status + '.' : 'The request failed (' + (res.kind || 'network error') + ').' };
  }
  var data;
  try { data = JSON.parse(res.text); } catch (e) {
    return { state: 'not-json', detail: 'The URL answers, but not with JSON.' };
  }
  var u = data && data.ucp;
  if (!u || typeof u !== 'object' || !str(u.version) || !(nonEmptyObject(u.services) || nonEmptyObject(u.capabilities))) {
    return { state: 'not-profile', detail: 'It returns JSON, but not a merchant profile (no ucp block with a version and declared services or capabilities).' };
  }

  var versions = Object.keys(u.supported_versions || {});
  if (versions.indexOf(u.version) === -1) versions.push(u.version);
  versions.sort().reverse();

  var transports = [];
  Object.keys(u.services || {}).forEach(function (k) {
    [].concat(u.services[k] || []).forEach(function (s) {
      if (s && s.transport && transports.indexOf(s.transport) === -1) transports.push(s.transport);
    });
  });

  return {
    state: 'valid',
    version: u.version,
    supportedVersions: versions,
    capabilities: Object.keys(u.capabilities || {}).map(function (k) { return k.replace(/^dev\.ucp\./, ''); }),
    services: Object.keys(u.services || {}).map(function (k) { return k.replace(/^dev\.ucp\./, ''); }),
    transports: transports,
    paymentHandlers: Object.keys(u.payment_handlers || {}).length
  };
}

/* ---------------- sitemap ---------------- */

function locs(text) {
  var out = [];
  var re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  var m;
  while ((m = re.exec(text)) !== null && out.length < 5000) out.push(decodeXml(m[1]));
  return out;
}

// A store's sitemap is mostly products, and its product sitemap is named
// for them. A B2B site with a /products/ marketing section is neither, so
// the signal needs a real share of the file, not a single matching URL
// (hubspot.com: 104 of 3,066 URLs under /products/; imperva.com: a child
// sitemap at /products/page-sitemap.xml).
var MIN_PRODUCT_URLS = 5;
var MIN_PRODUCT_SHARE = 0.2;
var PRODUCT_SITEMAP_NAME = /(^|[_-])products?([_-]|\d|\.xml)/i;
var COLLECTION_SITEMAP_NAME = /(^|[_-])collections?([_-]|\d|\.xml)/i;

function fileName(u) {
  try { return new URL(u).pathname.split('/').pop() || ''; } catch (e) { return ''; }
}

function analyzeSitemap(text, origin) {
  var t = String(text || '');
  var isIndex = /<sitemapindex/i.test(t);
  var isUrlset = /<urlset/i.test(t);
  if (!isIndex && !isUrlset) return { kind: 'unknown', fired: false, evidence: '', firstProductUrl: null, productChild: null };

  var all = locs(t);
  if (isIndex) {
    var children = all.filter(function (u) { return sameSite(u, origin); });
    var child = children.filter(function (u) { return PRODUCT_SITEMAP_NAME.test(fileName(u)); })[0] || null;
    var collection = children.filter(function (u) { return COLLECTION_SITEMAP_NAME.test(fileName(u)); })[0] || null;
    var hit = child || collection;
    return {
      kind: 'index',
      fired: !!hit,
      evidence: hit ? 'Sitemap index lists ' + fileName(hit) : '',
      firstProductUrl: null,
      productChild: child
    };
  }

  var same = all.filter(function (u) { return sameSite(u, origin); });
  var paths = same.map(function (u) { try { return new URL(u).pathname; } catch (e) { return ''; } });
  var products = same.filter(function (u, i) { return PRODUCT_PATH.test(paths[i]); });
  var storeLike = same.filter(function (u, i) { return PRODUCT_PATH.test(paths[i]) || COLLECTION_PATH.test(paths[i]); });
  var fired = storeLike.length >= MIN_PRODUCT_URLS && storeLike.length / Math.max(same.length, 1) >= MIN_PRODUCT_SHARE;
  return {
    kind: 'urlset',
    fired: fired,
    evidence: fired ? 'Sitemap lists ' + storeLike.length + ' product or collection URLs (' + Math.round(100 * storeLike.length / same.length) + '% of the file)' : '',
    firstProductUrl: products[0] || null,
    productChild: null
  };
}

// First same-site link on the homepage that looks like a product page.
function firstProductLink(html, baseUrl) {
  var re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
  var m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var abs;
    try { abs = new URL(decodeXml(m[1]), baseUrl); } catch (e) { continue; }
    if (!/^https?:$/.test(abs.protocol) || !sameSite(abs.href, baseUrl)) continue;
    if (PRODUCT_PATH.test(abs.pathname)) { abs.hash = ''; return abs.href; }
  }
  return null;
}

/* ---------------- detection ---------------- */

function detectPlatform(html, headers) {
  for (var i = 0; i < PLATFORMS.length; i++) {
    var p = PLATFORMS[i];
    var h = headers || {};
    if (p.headers) {
      for (var j = 0; j < p.headers.length; j++) {
        var v = h[p.headers[j][0]];
        if (v !== undefined && p.headers[j][1].test(String(v))) return { name: p.name, via: p.headers[j][0] + ' header' };
      }
    }
    if (html && p.html.test(html)) return { name: p.name, via: 'page scripts and markup' };
  }
  return null;
}

// input: { schemaTypes, html, headers, ucp, sitemap }. sitemap is null when
// it was not fetched, which leaves that signal unassessed (fired: null)
// rather than false.
function detect(input) {
  var types = input.schemaTypes || [];
  var html = input.html || '';
  var schemaType = types.filter(function (t) { return /^(product|productgroup|offer|aggregateoffer)$/i.test(t); })[0] || null;
  var microdata = /itemtype\s*=\s*["']https?:\/\/schema\.org\/(Product|Offer)\b/i.test(html);
  var platform = detectPlatform(html, input.headers);
  var cart = CART_LINK.exec(html);
  var ucp = input.ucp || { state: 'absent' };
  var sm = input.sitemap;

  return [
    {
      id: 'product-schema', label: 'Product or Offer schema on the homepage',
      fired: !!(schemaType || microdata),
      evidence: schemaType ? schemaType + ' in JSON-LD' : (microdata ? 'Product or Offer microdata' : '')
    },
    {
      id: 'platform', label: 'Store platform markers',
      fired: !!platform,
      evidence: platform ? platform.name + ' (' + platform.via + ')' : ''
    },
    {
      id: 'sitemap', label: 'Product or collection URLs in the sitemap',
      fired: sm ? !!sm.fired : null,
      evidence: sm && sm.fired ? sm.evidence : ''
    },
    {
      id: 'cart-link', label: 'A cart or checkout link on the homepage',
      fired: !!cart,
      evidence: cart ? 'Links to ' + cart[1].replace(/^https?:\/\/[^/]+/, '') : ''
    },
    {
      id: 'ucp', label: 'A UCP merchant profile at /.well-known/ucp',
      fired: ucp.state === 'valid',
      evidence: ucp.state === 'valid' ? 'UCP ' + ucp.version : ''
    }
  ];
}

function countFired(signals) {
  return signals.filter(function (s) { return s.fired === true; }).length;
}

/* ---------------- product page schema ---------------- */

function ldNodes(html) {
  var out = [];
  function walk(v) {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    out.push(v);
    if (v['@graph']) walk(v['@graph']);
  }
  var re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  var m;
  while ((m = re.exec(String(html || ''))) !== null) {
    try { walk(JSON.parse(m[1].trim())); } catch (e) { /* a malformed block is skipped, as in the main scan */ }
  }
  return out;
}

function hasType(node, re) {
  return [].concat(node['@type'] || []).some(function (t) { return re.test(String(t)); });
}

function offersOf(node) {
  var out = [];
  (function collect(o) {
    [].concat(o || []).forEach(function (x) {
      if (!x || typeof x !== 'object') return;
      out.push(x);
      if (x.offers) collect(x.offers);
    });
  }(node && node.offers));
  return out;
}

function hasPrice(offer) {
  var candidates = [offer.price, offer.lowPrice];
  [].concat(offer.priceSpecification || []).forEach(function (ps) { if (ps) candidates.push(ps.price); });
  return candidates.some(function (c) {
    var s = str(c);
    return s !== '' && isFinite(parseFloat(s.replace(/,/g, '')));
  });
}

function hasImage(img) {
  return [].concat(img || []).some(function (i) {
    return typeof i === 'string' ? !!i.trim() : !!(i && (str(i.url) || str(i.contentUrl)));
  });
}

// Looks for name, price, availability and image on a product page. Modern
// Shopify themes describe a product as a ProductGroup with its variants
// nested, so the group's own fields count and its first variant fills any
// gap, which is how an agent reading the page would see it.
function analyzeProductPage(html) {
  var nodes = ldNodes(html);
  var product = nodes.filter(function (n) { return hasType(n, /^(Product|ProductGroup)$/i); })[0] || null;

  if (product) {
    var variant = [].concat(product.hasVariant || [])[0] || null;
    var offers = offersOf(product).concat(variant ? offersOf(variant) : []);
    var fields = {
      name: !!(str(product.name) || (variant && str(variant.name))),
      price: offers.some(hasPrice),
      availability: offers.some(function (o) { return !!str(o.availability); }),
      image: hasImage(product.image) || !!(variant && hasImage(variant.image))
    };
    return { found: true, source: 'json-ld', type: [].concat(product['@type'])[0], fields: fields, present: countTrue(fields) };
  }

  if (/itemtype\s*=\s*["']https?:\/\/schema\.org\/Product\b/i.test(String(html || ''))) {
    var h = String(html);
    var mf = {
      name: /itemprop\s*=\s*["']name["']/i.test(h),
      price: /itemprop\s*=\s*["']price["']/i.test(h),
      availability: /itemprop\s*=\s*["']availability["']/i.test(h),
      image: /itemprop\s*=\s*["']image["']/i.test(h)
    };
    return { found: true, source: 'microdata', type: 'Product', fields: mf, present: countTrue(mf) };
  }

  return { found: false, source: null, type: null, fields: { name: false, price: false, availability: false, image: false }, present: 0 };
}

function countTrue(o) { return Object.keys(o).filter(function (k) { return o[k]; }).length; }

/* ---------------- the sub-score ---------------- */

var FIELD_ORDER = ['name', 'price', 'availability', 'image'];

// UCP endpoint: 4 points. Structured product data: 1 point each for name,
// price, availability and image. A check that could not be run (no product
// page located, robots.txt disallowing it, unreadable) is not assessed and
// is left out of the total, never counted as a failure.
function buildChecks(ucp, product) {
  var checks = [];

  checks.push({
    id: 'ucp', label: 'UCP endpoint', assessed: true, max: 4,
    pts: ucp.state === 'valid' ? 4 : 0,
    advice: 'Publish a UCP merchant profile at /.well-known/ucp',
    why: 'A shopping agent looks here for a structured entry point: your supported versions, services and capabilities. Without it there is nothing for an agent to act on.'
  });

  var assessed = product.state === 'checked';
  var missing = assessed ? FIELD_ORDER.filter(function (f) { return !product.fields[f]; }) : [];
  checks.push({
    id: 'product-data', label: 'Structured product data', assessed: assessed, max: 4,
    pts: assessed ? product.present : 0,
    advice: assessed && !product.found
      ? 'Add Product schema (name, price, availability and image) to your product pages'
      : 'Add the missing Product fields to your product pages: ' + missing.join(', '),
    why: 'Price and availability have to be machine-readable, not just visible on the page. An agent that cannot read them cannot compare or buy.'
  });

  var assessedChecks = checks.filter(function (c) { return c.assessed; });
  var earned = assessedChecks.reduce(function (a, c) { return a + c.pts; }, 0);
  var max = assessedChecks.reduce(function (a, c) { return a + c.max; }, 0);
  return { checks: checks, subScore: { earned: earned, max: max, complete: assessedChecks.length === checks.length } };
}

module.exports = {
  THRESHOLD: THRESHOLD,
  analyzeUcp: analyzeUcp,
  analyzeSitemap: analyzeSitemap,
  firstProductLink: firstProductLink,
  detect: detect,
  countFired: countFired,
  analyzeProductPage: analyzeProductPage,
  buildChecks: buildChecks,
  sameSite: sameSite
};
