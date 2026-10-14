/* =====================================================================
   lib/ws-service.js: what can be done to a workspace, on the store. The HTTP routes (lib/ws-api.js) and scripts/ws-admin.js both call this, so
   there is one set of rules: who can set which status, what a scan changes, what Verify proves.

   A is a storage adapter (lib/pro-store.js). deps.scanner lets a test hand in a fake scanner; nothing else here touches the network.
   ===================================================================== */

'use strict';

const WS = require('./ws-store.js');
const Fix = require('./ws-fix.js');
const { scanDomain } = require('./ws-scan.js');
const methodology = require('./methodology.js');

const VERIFY_COOLDOWN_SECONDS = 20;
const VERIFY_PER_DAY = 40;
const iso = (now) => new Date(now === undefined ? Date.now() : now).toISOString();
const cleanLine = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanText = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);

// Stores a scan: the history entry, the latest checks, the merged Fix list. Returns { summary, items }.
async function record(A, id, scan, kind, now) {
  const at = iso(now);
  const summary = Fix.summarize(scan, at);
  const items = Fix.mergeItems(await WS.getItems(A, id), summary, at);
  await WS.putItems(A, id, items);
  await WS.putLast(A, id, summary);
  await WS.addScan(A, id, { at: at, kind: kind, score: summary.total, failing: summary.checks.filter((c) => !c.ok).length });
  const f = { sitemapUrl: summary.sitemapUrl || '' };
  if (summary.siteInfo) f.siteInfo = summary.siteInfo;
  await WS.setMeta(A, id, f);
  return { summary: summary, items: items };
}

// A new Fix workspace for a domain (already validated by the caller): scans it first, so a site that cannot be read makes no workspace.
async function startFix(A, domain, deps, now) {
  const r = await scanDomain(domain, deps);
  if (!r.ok) return { ok: false, reason: r.reason };
  const id = await WS.create(A, { type: 'fix', domain: domain }, now);
  await record(A, id, r.scan, 'baseline', now);
  return { ok: true, id: id };
}

async function editable(A, id) {
  const meta = WS.HEX32.test(id) ? await WS.getMeta(A, id) : null;
  if (!meta || meta.demo) return null;
  return meta;
}

async function rescan(A, id, deps, now) {
  const meta = await editable(A, id);
  if (!meta || meta.type !== 'fix') return { ok: false, reason: 'not_found' };
  const r = await scanDomain(meta.domain, deps);
  if (!r.ok) return { ok: false, reason: r.reason };
  const out = await record(A, id, r.scan, 'rescan', now);
  return { ok: true, score: out.summary.total };
}

/* Verify: runs the scan again and marks the item verified only if its check passes now. A client may call it (the link is the credential), so it is
   limited: one run at a time per workspace (20 s), 40 a day, and never on an archived or demo workspace. */
async function verify(A, id, key, deps, now) {
  const meta = await editable(A, id);
  if (!meta || meta.type !== 'fix') return { ok: false, status: 404, reason: 'not_found' };
  if (meta.status === 'archived') return { ok: false, status: 409, reason: 'archived' };
  const items = await WS.getItems(A, id);
  const item = items.filter((i) => i.key === key)[0];
  if (!item || /^x-/.test(item.key)) return { ok: false, status: 404, reason: 'not_found' };
  if (item.status === 'verified') return { ok: true, passed: true, already: true, status: 'verified' };
  const got = await A.set(WS.key(id, 'vlock'), '1', { nx: true, ex: VERIFY_COOLDOWN_SECONDS });
  if (!got) return { ok: false, status: 429, reason: 'wait' };
  const day = iso(now).slice(0, 10);
  const nKey = WS.key(id, 'vn:' + day);
  const n = await A.incr(nKey); await A.expire(nKey, 2 * 86400);
  if (n > VERIFY_PER_DAY) { await A.decr(nKey); return { ok: false, status: 429, reason: 'daily' }; }
  const r = await scanDomain(meta.domain, deps);
  if (!r.ok) return { ok: false, status: 502, reason: 'scan_failed' };
  const at = iso(now);
  const summary = Fix.summarize(r.scan, at);
  const check = summary.checks.filter((c) => c.key === key)[0];
  let merged = Fix.mergeItems(items, summary, at);
  let passed = false;
  if (check && check.ok) {
    merged = merged.map((i) => (i.key === key ? Object.assign({}, i, { status: 'verified', verifiedAt: at, updatedAt: at, regressed: false }) : i));
    passed = true;
  }
  await WS.putItems(A, id, merged);
  await WS.putLast(A, id, summary);
  await WS.addScan(A, id, { at: at, kind: 'verify', score: summary.total, failing: summary.checks.filter((c) => !c.ok).length });
  return { ok: true, passed: passed, status: passed ? 'verified' : item.status, score: summary.total, message: passed ? 'The check passes. This item is verified.' : Fix.stillFailing(item) };
}

// An admin edit of one item: its status (never "verified": only a passing Verify sets that) and its note.
async function setItem(A, id, key, patch, now) {
  const meta = await editable(A, id);
  if (!meta) return { ok: false, reason: 'not_found' };
  const items = await WS.getItems(A, id);
  const i = items.findIndex((x) => x.key === key);
  if (i === -1) return { ok: false, reason: 'not_found' };
  const next = Object.assign({}, items[i]);
  if (patch.status !== undefined) {
    if (patch.status === 'verified') return { ok: false, reason: 'verified_by_check_only' };
    if (Fix.STATUSES.indexOf(patch.status) === -1) return { ok: false, reason: 'bad_status' };
    if (next.status === 'verified' && patch.status !== 'verified') next.verifiedAt = null;
    next.status = patch.status;
  }
  if (patch.note !== undefined) next.note = cleanText(patch.note, 4000);
  next.updatedAt = iso(now);
  items[i] = next;
  await WS.putItems(A, id, items);
  return { ok: true, item: next };
}

// A custom item (no check behind it, so it can never be verified): the key starts with x-.
async function addItem(A, id, fields, now) {
  const meta = await editable(A, id);
  if (!meta) return { ok: false, reason: 'not_found' };
  const label = cleanLine(fields.label, 120);
  if (!label) return { ok: false, reason: 'label' };
  const items = await WS.getItems(A, id);
  let n = items.filter((x) => /^x-/.test(x.key)).length + 1;
  while (items.some((x) => x.key === 'x-' + n)) n++;
  const item = { key: 'x-' + n, label: label, cat: '', max: 0, advice: cleanLine(fields.advice, 300), why: '', file: '', status: 'todo', note: cleanText(fields.note, 4000), updatedAt: iso(now), verifiedAt: null };
  items.push(item);
  await WS.putItems(A, id, items);
  return { ok: true, item: item };
}

async function removeItem(A, id, key) {
  const meta = await editable(A, id);
  if (!meta || !/^x-/.test(key)) return { ok: false, reason: 'not_found' };
  const items = await WS.getItems(A, id);
  await WS.putItems(A, id, items.filter((x) => x.key !== key));
  return { ok: true };
}

async function setPro(A, id, proJobId) {
  const meta = await editable(A, id);
  if (!meta) return { ok: false, reason: 'not_found' };
  const v = String(proJobId || '').trim().toLowerCase();
  if (v && !WS.HEX32.test(v)) return { ok: false, reason: 'bad_id' };
  await A.hset(WS.key(id), { proJobId: v, updatedAt: iso() });
  if (!v) await A.hdel(WS.key(id), 'proJobId');
  return { ok: true };
}

async function archive(A, id, on) {
  const meta = await editable(A, id);
  if (!meta) return { ok: false, reason: 'not_found' };
  await WS.archive(A, id, on !== false);
  return { ok: true };
}

/* ---------- the fictional demo ---------- */

// Four scans of the fictional example-co.com, built from the real check list with made-up outcomes. No network.
function demoChecks(passing, crawlerPts) {
  const reg = methodology.registry();
  return reg.map((c) => {
    const pts = c.label === 'AI crawler access' ? crawlerPts : (passing.indexOf(c.label) !== -1 ? c.max : 0);
    return { label: c.label === 'AI crawler access' ? 'AI crawler access (' + Math.round(crawlerPts / 26 * 10) + '/10 open)' : c.label, cat: c.cat, ok: c.label === 'AI crawler access' ? crawlerPts >= 21 : passing.indexOf(c.label) !== -1, pts: pts, max: c.max };
  });
}
function demoScan(passing, crawlerPts) {
  const checks = demoChecks(passing, crawlerPts);
  const sum = (cat) => checks.filter((c) => c.cat === cat).reduce((a, c) => a + c.pts, 0);
  return { ok: true, result: { checks: checks, discover: sum('discover'), tech: sum('tech'), trust: sum('trust'), total: sum('discover') + sum('tech') + sum('trust') },
    siteInfo: { title: 'Example Co: project software for small teams', metaDesc: 'Example Co makes project software for small teams. This is a fictional company used for the Citehound product demo.', lang: 'en' }, sitemapUrls: ['https://example-co.com/sitemap.xml'] };
}

async function seedDemoFix(A) {
  const id = WS.DEMO.fix;
  await WS.remove(A, id);
  const D = Date.UTC;
  const base = ['robots.txt present', 'html lang attribute', 'Page title', 'Single H1 heading', 'Subheading structure (H2)', 'Contact signals'];
  const s2 = base.concat(['Sitemap declared', 'Canonical tag', 'Meta description']);
  const s3 = s2.concat(['llms.txt present', 'Open Graph tags', 'Structured data (JSON-LD)']);
  const s4 = s3.concat(['Organization / WebSite schema']);
  const runs = [[D(2026, 8, 2, 9, 12), base, 10, 'baseline'], [D(2026, 8, 9, 14, 3), s2, 18, 'rescan'], [D(2026, 8, 16, 10, 41), s3, 26, 'rescan'], [D(2026, 8, 23, 16, 20), s4, 26, 'verify']];
  await WS.create(A, { type: 'fix', domain: 'example-co.com', demo: true }, D(2026, 8, 2, 9, 12), id);
  let items = [];
  for (const [at, passing, pts, kind] of runs) {
    const summary = Fix.summarize(demoScan(passing, pts), iso(at));
    items = Fix.mergeItems(items, summary, iso(at));
    await WS.addScan(A, id, { at: iso(at), kind: kind, score: summary.total, failing: summary.checks.filter((c) => !c.ok).length });
    await WS.putLast(A, id, summary);
    await WS.setMeta(A, id, { siteInfo: summary.siteInfo, sitemapUrl: summary.sitemapUrl });
  }
  const verified = { 'Sitemap declared': D(2026, 8, 16), 'Canonical tag': D(2026, 8, 16), 'Meta description': D(2026, 8, 16), 'AI crawler access': D(2026, 8, 16), 'llms.txt present': D(2026, 8, 23), 'Open Graph tags': D(2026, 8, 23), 'Structured data (JSON-LD)': D(2026, 8, 23), 'Organization / WebSite schema': D(2026, 8, 23) };
  const notes = {
    'AI crawler access': 'We allowed the three AI crawlers that robots.txt blocked.\n\n- Added explicit **Allow** rules for each tracked crawler\n- Kept your private paths disallowed',
    'Organization / WebSite schema': 'Added Organization and WebSite JSON-LD to the homepage. The `sameAs` list has your two social profiles.',
    'Content schema (Article, FAQ…)': 'In progress: the FAQ page markup is drafted. We apply it when your team approves the questions.',
    'Author / about signals': 'Needs a decision from you: who is named on the About page? See [our note on author signals](https://getcitehound.com/methodology).'
  };
  items = items.map((i) => {
    const n = Object.assign({}, i);
    if (verified[i.key]) { n.status = 'verified'; n.verifiedAt = iso(verified[i.key]); n.updatedAt = iso(verified[i.key]); }
    if (i.key === 'Content schema (Article, FAQ…)') { n.status = 'in_progress'; n.updatedAt = iso(D(2026, 8, 24)); }
    if (notes[i.key]) n.note = notes[i.key];
    return n;
  });
  await WS.putItems(A, id, items);
  return { ok: true, id: id };
}

module.exports = {
  VERIFY_COOLDOWN_SECONDS: VERIFY_COOLDOWN_SECONDS, VERIFY_PER_DAY: VERIFY_PER_DAY, record: record, startFix: startFix, rescan: rescan, verify: verify, setItem: setItem,
  addItem: addItem, removeItem: removeItem, setPro: setPro, archive: archive, seedDemoFix: seedDemoFix, cleanLine: cleanLine, cleanText: cleanText
};
