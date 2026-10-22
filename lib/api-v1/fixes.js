/* =====================================================================
   lib/api-v1/fixes.js: the Fix and Beyond output of the API. From one scan of a domain it builds the prioritized list of what to change, and for each finding the file or the snippet to paste.
   Priority is the points at stake, highest first (the scan's own point values). Nothing here scores anything: the scan is lib/scanner.js scanPage(), the file text is lib/api-v1/data.js
   (robots, llms) and lib/schema.js. A fact the scan cannot know is left in [square brackets]. The re-check compares a new scan with the one the fix list was made from.
   ===================================================================== */

'use strict';

const Data = require('./data.js');
const Monitor = require('./monitor.js');
const schemaLib = require('../schema.js');

const script = (obj) => '<script type="application/ld+json">\n' + JSON.stringify(obj, null, 2) + '\n</script>';

// The ready-to-paste files for one finding: [{ where, kind, content }]. The domain's own public facts only.
function filesFor(id, domain, info) {
  const origin = 'https://' + domain, lang = (info && info.lang) || '[en]', title = (info && info.title) || '[Page title]';
  const robots = () => { const r = Data.robots({ allow: [], block: [], sitemap: origin + '/sitemap.xml' }); return r.ok ? r.content : null; };
  switch (id) {
    case 'robots-txt-present': case 'ai-crawler-access': case 'sitemap-declared': {
      const defaults = require('../crawlers.js');
      const allow = defaults.filter((c) => c.defaultAllow).map((c) => c.ua), block = defaults.filter((c) => !c.defaultAllow).map((c) => c.ua);
      const r = Data.robots({ allow: allow, block: block, sitemap: origin + '/sitemap.xml' });
      return r.ok ? [{ where: origin + '/robots.txt', kind: 'robots.txt', content: r.content }] : [];
    }
    case 'llms-txt-present': {
      const r = Data.llms({ name: title, description: (info && info.metaDesc) || '[One sentence describing the site.]', pages: [{ url: origin + '/', description: 'Homepage' }] });
      return r.ok ? [{ where: origin + '/llms.txt', kind: 'llms.txt', content: r.content }] : [];
    }
    case 'structured-data': case 'organization-website-schema':
      return [{ where: 'the <head> of the homepage', kind: 'json-ld', content: script(schemaLib.buildFromSite('organization', domain, info || {})) }];
    case 'content-schema':
      return [{ where: 'the <head> of a page with questions and answers', kind: 'json-ld', content: script(schemaLib.buildFromSite('faqpage', domain, info || {})) }];
    case 'canonical-tag': return [{ where: 'the <head> of each page, with that page\'s own address', kind: 'html', content: '<link rel="canonical" href="' + origin + '/" />' }];
    case 'html-lang-attribute': return [{ where: 'the opening <html> tag', kind: 'html', content: '<html lang="' + lang + '">' }];
    case 'page-title': return [{ where: 'the <head>', kind: 'html', content: '<title>[Page title, about 50 to 60 characters]</title>' }];
    case 'meta-description': return [{ where: 'the <head>', kind: 'html', content: '<meta name="description" content="[One or two sentences saying what this page offers, under 160 characters]" />' }];
    case 'open-graph-tags': return [{ where: 'the <head>', kind: 'html', content: ['<meta property="og:type" content="website" />', '<meta property="og:title" content="' + title + '" />', '<meta property="og:description" content="[Short description]" />', '<meta property="og:url" content="' + origin + '/" />', '<meta property="og:image" content="[Address of a 1200x630 image]" />'].join('\n') }];
    case 'contact-signals': return [{ where: 'the footer or a contact page', kind: 'html', content: '<a href="mailto:[hello@' + domain + ']">[hello@' + domain + ']</a>' }];
    default: return [];   // headings and author signals are edits to the page's content, not a file
  }
}

// -> { domain, scannedAt, score, items: [{ priority, id, label, pillar, points_at_stake, fix, files }], note }
function build(domain, scan, now) {
  const checks = scan.result.checks.filter((c) => !c.ok).map((c) => ({ c: c, id: Monitor.checkId(c.label) }));
  checks.sort((a, b) => (b.c.max - b.c.pts) - (a.c.max - a.c.pts) || (a.id < b.id ? -1 : 1));
  const sum = Data.scanSummary(domain, scan, now), pillarOf = {};
  sum.failed.forEach((f) => { pillarOf[Monitor.checkId(f.label)] = f.pillar; });
  return {
    domain: domain, scannedAt: sum.scannedAt, score: sum.score,
    items: checks.map((x, i) => ({ priority: i + 1, id: x.id, label: Monitor.checkName(x.c.label), pillar: pillarOf[x.id] || null, points_at_stake: x.c.max - x.c.pts, fix: x.c.advice, files: filesFor(x.id, domain, scan.siteInfo) })),
    note: Data.NOTE
  };
}

// The re-check: a new scan against the ids of the findings the fix list was made from.
function recheck(base, scan, now) {
  const sum = Data.scanSummary(base.domain, scan, now), still = scan.result.checks.filter((c) => !c.ok).map((c) => Monitor.checkId(c.label));
  const was = base.failed, fixed = was.filter((id) => still.indexOf(id) === -1), left = was.filter((id) => still.indexOf(id) !== -1), added = still.filter((id) => was.indexOf(id) === -1);
  return { domain: base.domain, checked_at: sum.scannedAt, score_before: base.score, score_after: sum.score, fixed: fixed, still_failing: left, new_failures: added, note: Data.NOTE };
}

module.exports = { build, recheck, filesFor };
