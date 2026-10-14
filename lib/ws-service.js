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
const B = require('./ws-beyond.js');
const Prompts = require('./citation-prompts.js');
const fs = require('fs');
const path = require('path');

const VERIFY_COOLDOWN_SECONDS = 20;
const VERIFY_PER_DAY = 40;
const iso = (now) => new Date(now === undefined ? Date.now() : now).toISOString();
const cleanLine = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanText = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);

// A history entry: when, what kind, the score, the failing checks and the three pillar scores (for the before-and-now bars).
function scanEntry(at, kind, summary) {
  return { at: at, kind: kind, score: summary.total, failing: summary.checks.filter((c) => !c.ok).length, pillars: { discover: summary.discover, tech: summary.tech, trust: summary.trust } };
}

// Stores a scan: the history entry, the latest checks, the merged Fix list. Returns { summary, items }.
async function record(A, id, scan, kind, now) {
  const at = iso(now);
  const summary = Fix.summarize(scan, at);
  const items = Fix.mergeItems(await WS.getItems(A, id), summary, at);
  await WS.putItems(A, id, items);
  await WS.putLast(A, id, summary);
  await WS.addScan(A, id, scanEntry(at, kind, summary));
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

// A Beyond workspace has no Fix list: a scan only adds a score to its history (the Monthly tab).
async function recordScore(A, id, scan, kind, now) {
  const at = iso(now);
  const summary = Fix.summarize(scan, at);
  await WS.putLast(A, id, summary);
  await WS.addScan(A, id, scanEntry(at, kind, summary));
  await WS.setMeta(A, id, { sitemapUrl: summary.sitemapUrl || '', siteInfo: summary.siteInfo || {} });
  return { summary: summary };
}

async function startBeyond(A, domain, deps, now) {
  const r = await scanDomain(domain, deps);
  if (!r.ok) return { ok: false, reason: r.reason };
  const id = await WS.create(A, { type: 'beyond', domain: domain }, now);
  await recordScore(A, id, r.scan, 'baseline', now);
  return { ok: true, id: id };
}

async function rescan(A, id, deps, now) {
  const meta = await editable(A, id);
  if (!meta) return { ok: false, reason: 'not_found' };
  const r = await scanDomain(meta.domain, deps);
  if (!r.ok) return { ok: false, reason: r.reason };
  const out = meta.type === 'fix' ? await record(A, id, r.scan, 'rescan', now) : await recordScore(A, id, r.scan, 'rescan', now);
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
  await WS.addScan(A, id, scanEntry(at, 'verify', summary));
  return { ok: true, passed: passed, status: passed ? 'verified' : item.status, score: summary.total, message: passed ? 'The check passes. This item is verified.' : Fix.stillFailing(item) };
}

// An admin edit of one item: its status (never "verified": only a passing Verify sets that) and its note.
async function setItem(A, id, key, patch, now) {
  const meta = await editable(A, id);
  if (!meta || meta.type !== 'fix') return { ok: false, reason: 'not_found' };
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
  if (!meta || meta.type !== 'fix') return { ok: false, reason: 'not_found' };
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
  if (!meta || meta.type !== 'fix' || !/^x-/.test(key)) return { ok: false, reason: 'not_found' };
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


/* ---------- Beyond: questions, gaps, months ---------- */

async function editableBeyond(A, id) { const m = await editable(A, id); return m && m.type === 'beyond' ? m : null; }

async function setQuestions(A, id, input) {
  if (!await editableBeyond(A, id)) return { ok: false, reason: 'not_found' };
  const c = B.cleanQuestions(input);
  if (!c.ok) return c;
  // A question keeps its id when its text is unchanged, so a piece's link to it survives an edit of the list; a new one gets the next free id.
  const had = await WS.getQuestions(A, id);
  const byText = {}; let max = 0;
  had.forEach((q) => { byText[q.text.toLowerCase()] = q.id; max = Math.max(max, parseInt(String(q.id).slice(1), 10) || 0); });
  const kept = {}; c.questions.forEach((q) => { const old = byText[q.text.toLowerCase()]; if (old) kept[old] = true; });
  c.questions.forEach((q) => { const old = byText[q.text.toLowerCase()]; if (old) q.id = old; else { do { max++; } while (kept['q' + max]); q.id = 'q' + max; kept[q.id] = true; } });
  await WS.putQuestions(A, id, c.questions);
  return { ok: true, count: c.questions.length };
}

// The questions the Pro report's generator already wrote for the linked report (no new model call, no new cost).
async function importQuestions(store, id) {
  const A = store.adapter;
  const meta = await editableBeyond(A, id);
  if (!meta) return { ok: false, reason: 'not_found' };
  if (!meta.proJobId) return { ok: false, reason: 'no_pro_report' };
  const job = await store.getJob(meta.proJobId);
  const items = job && job.citation && job.citation.questions && job.citation.questions.items;
  if (!items || !items.length) return { ok: false, reason: 'no_questions' };
  return setQuestions(A, id, items.map((q) => q.text));
}

const VERTICALS = fs.readdirSync(path.join(__dirname, '..', 'content', 'prompts')).filter((f) => /\.json$/.test(f)).map((f) => f.replace(/\.json$/, '')).sort();

// One of the 14 category question sets (the free ones the MCP server and the Pro report also use) as a starting point.
async function seedQuestions(A, id, vertical) {
  if (!await editableBeyond(A, id)) return { ok: false, reason: 'not_found' };
  if (VERTICALS.indexOf(vertical) === -1) return { ok: false, reason: 'vertical' };
  return setQuestions(A, id, Prompts.loadVertical(vertical));
}

async function setGaps(A, id, input) {
  if (!await editableBeyond(A, id)) return { ok: false, reason: 'not_found' };
  const c = B.cleanGaps(input);
  if (!c.ok) return c;
  await WS.putGaps(A, id, c.gaps);
  return { ok: true, count: c.gaps.length };
}

async function setMonth(A, id, input) {
  if (!await editableBeyond(A, id)) return { ok: false, reason: 'not_found' };
  const c = B.cleanMonth(input);
  if (!c.ok) return c;
  const months = (await WS.getMonths(A, id)).filter((m) => m.month !== c.entry.month);
  months.push(c.entry);
  await WS.putMonths(A, id, months.sort((a, b) => (a.month < b.month ? -1 : 1)));
  return { ok: true };
}
async function removeMonth(A, id, month) {
  if (!await editableBeyond(A, id)) return { ok: false, reason: 'not_found' };
  await WS.putMonths(A, id, (await WS.getMonths(A, id)).filter((m) => m.month !== month));
  return { ok: true };
}

/* ---------- Beyond: content pieces ---------- */

const CID = /^c\d{1,4}$/;

async function addPiece(A, id, f, now) {
  if (!await editableBeyond(A, id)) return { ok: false, reason: 'not_found' };
  const title = cleanLine(f.title, 120);
  if (!title) return { ok: false, reason: 'title' };
  if (B.TYPES.indexOf(f.type) === -1) return { ok: false, reason: 'type' };
  const ids = await WS.contentIds(A, id);
  if (ids.length >= B.MAX_PIECES) return { ok: false, reason: 'too_many' };
  const cid = 'c' + ((ids.length ? WS.cidNum(ids[ids.length - 1]) : 0) + 1);
  const at = iso(now);
  const fl = B.cleanFor(f.questions, await WS.getQuestions(A, id));
  await WS.putPiece(A, id, cid, { title: title, type: f.type, status: 'draft', body: cleanText(f.body, 20000), version: '1', createdAt: at, updatedAt: at, for: fl.join(',') });
  return { ok: true, cid: cid };
}

async function editPiece(A, id, cid, patch, now) {
  if (!await editableBeyond(A, id) || !CID.test(cid)) return { ok: false, reason: 'not_found' };
  const p = await WS.getPiece(A, id, cid);
  if (!p) return { ok: false, reason: 'not_found' };
  const f = { updatedAt: iso(now) };
  if (patch.title !== undefined) { const t = cleanLine(patch.title, 120); if (!t) return { ok: false, reason: 'title' }; f.title = t; }
  if (patch.type !== undefined) { if (B.TYPES.indexOf(patch.type) === -1) return { ok: false, reason: 'type' }; f.type = patch.type; }
  if (patch.questions !== undefined) f.for = B.cleanFor(patch.questions, await WS.getQuestions(A, id)).join(',');
  let reopened = false;
  if (patch.body !== undefined) {
    const body = cleanText(patch.body, 20000);
    if (body !== p.body) {
      f.body = body; f.version = String(p.version + 1);
      if (p.status === 'approved' || p.status === 'published') { f.status = 'in_review'; reopened = true; }
    }
  }
  await WS.putPiece(A, id, cid, f);
  if (reopened) await WS.addComment(A, id, cid, { by: 'admin', kind: 'note', text: 'The text was edited after it was approved, so it is back in review.' }, now);
  return { ok: true, reopened: reopened };
}

// An admin sets draft, in review or published. Published only follows approved, and approved is set only by the client (review()).
async function setPieceStatus(A, id, cid, status, now) {
  if (!await editableBeyond(A, id) || !CID.test(cid)) return { ok: false, reason: 'not_found' };
  if (B.ADMIN_STATUSES.indexOf(status) === -1) return { ok: false, reason: status === 'approved' ? 'approved_by_client_only' : 'bad_status' };
  const p = await WS.getPiece(A, id, cid);
  if (!p) return { ok: false, reason: 'not_found' };
  if (status === 'published' && p.status !== 'approved' && p.status !== 'published') return { ok: false, reason: 'publish_needs_approval' };
  await WS.putPiece(A, id, cid, { status: status, updatedAt: iso(now) });
  return { ok: true };
}

async function removePiece(A, id, cid) {
  if (!await editableBeyond(A, id) || !CID.test(cid)) return { ok: false, reason: 'not_found' };
  await WS.removePiece(A, id, cid);
  return { ok: true };
}

async function noteOnPiece(A, id, cid, text, now) {
  if (!await editableBeyond(A, id) || !CID.test(cid) || !(await WS.getPiece(A, id, cid))) return { ok: false, reason: 'not_found' };
  const t = cleanText(text, 1000);
  if (!t) return { ok: false, reason: 'comment' };
  await WS.addComment(A, id, cid, { by: 'admin', kind: 'note', text: t }, now);
  return { ok: true };
}

const CLIENT_PER_DAY = 60;
/* The client's answer on a piece that is in review: Approve (an optional comment) or Request changes (a comment is required). The status and the comment are each one
   write. Never on a demo or an archived workspace; a limited number of writes a day per workspace and of comments per piece. */
async function review(A, id, cid, input, now) {
  const meta = WS.HEX32.test(id) ? await WS.getMeta(A, id) : null;
  if (!meta || meta.demo || meta.type !== 'beyond' || !CID.test(cid)) return { ok: false, reason: 'not_found' };
  if (meta.status === 'archived') return { ok: false, reason: 'archived' };
  const p = await WS.getPiece(A, id, cid);
  if (!p) return { ok: false, reason: 'not_found' };
  if (p.status !== 'in_review') return { ok: false, reason: 'not_in_review' };
  const action = input && input.action;
  if (action !== 'approve' && action !== 'changes') return { ok: false, reason: 'action' };
  const text = cleanText(input.comment, 1000);
  if (action === 'changes' && text.length < 3) return { ok: false, reason: 'comment' };
  if (Object.keys((await A.hgetall(WS.key(id, 'cm:' + cid))) || {}).length >= B.MAX_COMMENTS) return { ok: false, reason: 'limit' };
  const nKey = WS.key(id, 'cn:' + iso(now).slice(0, 10));
  const n = await A.incr(nKey); await A.expire(nKey, 2 * 86400);
  if (n > CLIENT_PER_DAY) { await A.decr(nKey); return { ok: false, reason: 'daily' }; }
  await WS.addComment(A, id, cid, { by: 'client', kind: action === 'approve' ? 'approve' : 'changes', text: text }, now);
  await WS.putPiece(A, id, cid, { status: action === 'approve' ? 'approved' : 'draft', updatedAt: iso(now) });
  return { ok: true, status: action === 'approve' ? 'approved' : 'draft' };
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
  // Eight weekly scans of the made-up site (17 Aug to 5 Oct 2026; Date.UTC months are 0-based): the outcomes are invented, the check list and the scoring are the real ones.
  const base = ['robots.txt present', 'html lang attribute', 'Page title', 'Subheading structure (H2)', 'Contact signals'];
  const s2 = base.concat(['Sitemap declared', 'Canonical tag']);
  const s3 = s2.concat(['Meta description']);
  const s4 = s3.concat(['Single H1 heading']);
  const s5 = s4.concat(['llms.txt present', 'Open Graph tags']);
  const s6 = s5.concat(['Structured data (JSON-LD)']);
  const s7 = s6.concat(['Organization / WebSite schema']);
  const runs = [[D(2026, 7, 17, 9, 12), base, 10, 'baseline'], [D(2026, 7, 24, 14, 3), s2, 18, 'rescan'], [D(2026, 7, 31, 10, 41), s3, 18, 'verify'], [D(2026, 8, 7, 16, 20), s4, 26, 'rescan'],
    [D(2026, 8, 14, 11, 5), s5, 26, 'verify'], [D(2026, 8, 21, 9, 48), s6, 26, 'rescan'], [D(2026, 8, 28, 15, 30), s7, 26, 'verify'], [D(2026, 9, 5, 10, 2), s7, 26, 'rescan']];
  await WS.create(A, { type: 'fix', domain: 'example-co.com', demo: true }, D(2026, 7, 17, 9, 12), id);
  let items = [];
  for (const [at, passing, pts, kind] of runs) {
    const summary = Fix.summarize(demoScan(passing, pts), iso(at));
    items = Fix.mergeItems(items, summary, iso(at));
    await WS.addScan(A, id, scanEntry(iso(at), kind, summary));
    await WS.putLast(A, id, summary);
    await WS.setMeta(A, id, { siteInfo: summary.siteInfo, sitemapUrl: summary.sitemapUrl });
  }
  const verified = { 'Sitemap declared': D(2026, 7, 31), 'Canonical tag': D(2026, 7, 31), 'Meta description': D(2026, 7, 31), 'AI crawler access': D(2026, 8, 14), 'Single H1 heading': D(2026, 8, 14),
    'llms.txt present': D(2026, 8, 28), 'Open Graph tags': D(2026, 8, 28), 'Organization / WebSite schema': D(2026, 8, 28) };
  const notes = {
    'AI crawler access': 'We allowed the three AI crawlers that robots.txt blocked.\n\n- Added explicit **Allow** rules for each tracked crawler\n- Kept your private paths disallowed',
    'Sitemap declared': 'The sitemap was already there; robots.txt now points to it with a `Sitemap:` line.',
    'Organization / WebSite schema': 'Added Organization and WebSite JSON-LD to the homepage. The `sameAs` list has your two social profiles.',
    'Structured data (JSON-LD)': 'Applied on 21 September. It passes in the latest scan; we verify it with you on the next review.',
    'Content schema (Article, FAQ…)': 'In progress: the FAQ page markup is drafted. We apply it when your team approves the questions.',
    'Author / about signals': 'Needs a decision from you: who is named on the About page? See [our note on author signals](https://getcitehound.com/methodology).'
  };
  items = items.map((i) => {
    const n = Object.assign({}, i);
    if (verified[i.key]) { n.status = 'verified'; n.verifiedAt = iso(verified[i.key]); n.updatedAt = iso(verified[i.key]); }
    if (i.key === 'Structured data (JSON-LD)') { n.status = 'applied'; n.updatedAt = iso(D(2026, 8, 21)); }
    if (i.key === 'Content schema (Article, FAQ…)') { n.status = 'in_progress'; n.updatedAt = iso(D(2026, 9, 1)); }
    if (notes[i.key]) n.note = notes[i.key];
    return n;
  });
  await WS.putItems(A, id, items);
  return { ok: true, id: id };
}

// The fictional Beyond demo: example-books.com, invoicing software for freelancers (made up), five monthly scans, nine questions, seven pieces with a believable comment
// history. No network. No citation-check numbers are invented: the Monthly tab says the pilot has not run for this project. Date.UTC months are 0-based.
async function seedDemoBeyond(A) {
  const id = WS.DEMO.beyond;
  await WS.remove(A, id);
  const D = Date.UTC;
  await WS.create(A, { type: 'beyond', domain: 'example-books.com', demo: true }, D(2026, 5, 12, 9, 30), id);
  const p0 = ['robots.txt present', 'html lang attribute', 'Page title', 'Single H1 heading', 'Subheading structure (H2)', 'Contact signals', 'Sitemap declared', 'Canonical tag', 'Meta description'];
  const p1 = p0.concat(['llms.txt present', 'Open Graph tags']);
  const p2 = p1.concat(['Structured data (JSON-LD)', 'Organization / WebSite schema']);
  const p3 = p2.concat(['Content schema (Article, FAQ…)']);
  const p4 = p3.concat(['Author / about signals']);
  const runs = [[D(2026, 5, 12, 9, 30), p0, 18, 'baseline'], [D(2026, 6, 12, 10, 5), p1, 26, 'rescan'], [D(2026, 7, 12, 11, 15), p2, 26, 'rescan'], [D(2026, 8, 12, 9, 40), p3, 26, 'rescan'], [D(2026, 9, 12, 10, 20), p4, 26, 'rescan']];
  for (const [at, passing, pts, kind] of runs) {
    const summary = Fix.summarize(demoScan(passing, pts), iso(at));
    await WS.addScan(A, id, scanEntry(iso(at), kind, summary));
    await WS.putLast(A, id, summary);
    await WS.setMeta(A, id, { siteInfo: { title: 'Example Books: invoicing for freelancers', metaDesc: 'Example Books is a fictional invoicing tool used for the Citehound product demo.', lang: 'en' }, sitemapUrl: 'https://example-books.com/sitemap.xml' });
  }
  await WS.putQuestions(A, id, B.cleanQuestions([
    'What is the best invoicing tool for a freelancer?', 'How do I send a recurring invoice?', 'Which invoicing tool connects to my bank?', 'Can I invoice in two currencies?', 'How do I chase a late payment?',
    'Is there an invoicing tool with no monthly fee?', 'Invoicing tool or spreadsheet: which suits a one-person business?', 'What should an invoice include?', 'How do I issue a credit note?'
  ]).questions);
  await WS.putGaps(A, id, B.cleanGaps([
    { question: 'What is the best invoicing tool for a freelancer?', page: '/pricing', note: 'The page lists plans but never answers the question.', priority: 'high' },
    { question: 'Which invoicing tool connects to my bank?', page: '', note: 'No page covers bank connections.', priority: 'high' },
    { question: 'How do I chase a late payment?', page: '', note: 'No page. A short guide would also feed the help centre.', priority: 'medium' },
    { question: 'Is there an invoicing tool with no monthly fee?', page: '/pricing', note: 'The free plan is mentioned in a footnote only.', priority: 'medium' },
    { question: 'Invoicing tool or spreadsheet: which suits a one-person business?', page: '/blog', note: 'Two blog posts touch it; neither gives a plain answer.', priority: 'medium' },
    { question: 'How do I issue a credit note?', page: '/help/credit-notes', note: 'The help page explains the screen but not when to use a credit note.', priority: 'low' }
  ]).gaps);
  const piece = async (cid, f, comments) => {
    await WS.putPiece(A, id, cid, { title: f.title, type: f.type, status: f.status, body: f.body, version: String(f.version || 1), createdAt: iso(f.at), updatedAt: iso(f.updated || f.at), for: (f.for || []).join(',') });
    for (const c of comments || []) await WS.addComment(A, id, cid, { by: c[1], kind: c[2], text: c[3] }, c[0]);
  };
  await piece('c1', { title: 'How to send a recurring invoice', type: 'Rewrite', status: 'published', at: D(2026, 6, 20), updated: D(2026, 7, 6), version: 2, for: ['q2'],
    body: 'Open **Invoices**, choose **New** and switch on **Repeat**.\n\n1. Pick how often it repeats: weekly, monthly or yearly.\n2. Choose the day it is sent.\n3. Choose whether it is sent to the client or saved as a draft for you.\n\nThe next invoice goes out on its own until you stop it. You can stop or change it from the same screen.\n\n**What recurring invoices cannot do:** they cannot change the amount by themselves. Edit the template when a price changes.' },
    [[D(2026, 7, 3, 14, 20), 'client', 'approve', 'Good. The last line about prices is exactly what customers ask us.'], [D(2026, 7, 6, 9, 0), 'admin', 'note', 'Published on the help page on 6 August.']]);
  await piece('c5', { title: 'What an invoice must include', type: 'New page', status: 'published', at: D(2026, 6, 28), updated: D(2026, 7, 14), version: 1, for: ['q8'],
    body: '## What an invoice must include\n\nA clear invoice saves a reminder later. Put these on every one:\n\n- your name and address, and the client\u2019s\n- a unique invoice number\n- the date, and the date payment is due\n- what you did, one line each, with the price\n- the total, and any tax shown separately\n- how to pay you\n\nIf you are unsure about tax wording where you live, ask your accountant: the rules differ.' },
    [[D(2026, 7, 12, 10, 30), 'client', 'approve', 'Approved. Please keep the tax line as it is.'], [D(2026, 7, 14, 9, 0), 'admin', 'note', 'Published on 14 August.']]);
  await piece('c2', { title: 'Invoicing in two currencies', type: 'FAQ block', status: 'approved', at: D(2026, 7, 18), updated: D(2026, 7, 26), version: 2, for: ['q4'],
    body: '### Can I invoice in two currencies?\n\nYes. Set a currency for each client, and each invoice uses it.\n\n- The invoice shows the amount in the client\u2019s currency.\n- Your reports show it in your own currency, at the rate on the day the invoice was sent.\n- You can change a client\u2019s currency until you send their first invoice.' },
    [[D(2026, 7, 22, 10, 10), 'client', 'changes', 'Please say which rate source you use. Our accountant will ask.'], [D(2026, 7, 24, 13, 0), 'admin', 'note', 'Added the line on the rate. Back in review.'], [D(2026, 7, 26, 16, 45), 'client', 'approve', 'Approved.']]);
  await piece('c6', { title: 'Which invoicing tool connects to my bank?', type: 'FAQ block', status: 'in_review', at: D(2026, 8, 14), updated: D(2026, 8, 22), version: 2, for: ['q3'],
    body: '### Which invoicing tool connects to my bank?\n\nExample Books connects to the banks in its supported list, so payments can be matched to invoices on their own.\n\n- Open **Settings**, then **Bank**, and choose your bank.\n- You sign in at your bank, not with us.\n- If your bank is not on the list, you can import a statement file instead.' },
    [[D(2026, 8, 18, 9, 40), 'client', 'changes', 'Say clearly that we never see the bank password.'], [D(2026, 8, 22, 15, 10), 'admin', 'note', 'Added the line about signing in at the bank. Ready for another look.']]);
  await piece('c3', { title: 'Invoicing tool or spreadsheet: which suits a one-person business?', type: 'Comparison block', status: 'in_review', at: D(2026, 8, 2), updated: D(2026, 9, 10), version: 1, for: ['q7'],
    body: 'A spreadsheet is enough while you send a few invoices a month. A tool starts to pay for itself when you:\n\n- send more than a handful a month,\n- need to **chase late payments**,\n- invoice in more than one currency,\n- need records an accountant can read without asking you.\n\nIf you invoice rarely and in one currency, keep the spreadsheet. See [our pricing](https://example-books.com/pricing) when that changes.' },
    [[D(2026, 9, 10, 9, 30), 'admin', 'note', 'Ready for your review. A comparison table goes on the final page once you approve the wording.']]);
  await piece('c7', { title: 'Pricing: the plain answer for a freelancer', type: 'Rewrite', status: 'draft', at: D(2026, 8, 28), updated: D(2026, 8, 28), version: 1, for: ['q1', 'q6'],
    body: '## Draft outline\n\n- Open with the answer: which plan suits one person, and what it costs\n- Say what the free plan includes and what it does not\n- Compare the first paid plan with doing it by hand\n\nThe full text follows once the outline is agreed.' }, []);
  await piece('c4', { title: 'How to chase a late payment', type: 'New page', status: 'draft', at: D(2026, 8, 22), updated: D(2026, 8, 22), version: 1, for: ['q5'],
    body: '## Draft outline\n\n- When a payment counts as late\n- The first reminder: what to say\n- The second reminder, and when to stop sending them\n- What to do about a client who never answers\n\nThe full text follows once the outline is agreed.' }, []);
  return { ok: true, id: id };
}

module.exports = {
  VERIFY_COOLDOWN_SECONDS: VERIFY_COOLDOWN_SECONDS, VERIFY_PER_DAY: VERIFY_PER_DAY, record: record, startFix: startFix, rescan: rescan, verify: verify, setItem: setItem,
  addItem: addItem, removeItem: removeItem, setPro: setPro, archive: archive, seedDemoFix: seedDemoFix, seedDemoBeyond: seedDemoBeyond, cleanLine: cleanLine, cleanText: cleanText,
  startBeyond: startBeyond, recordScore: recordScore, setQuestions: setQuestions, importQuestions: importQuestions, seedQuestions: seedQuestions, VERTICALS: VERTICALS, setGaps: setGaps,
  setMonth: setMonth, removeMonth: removeMonth, addPiece: addPiece, editPiece: editPiece, setPieceStatus: setPieceStatus, removePiece: removePiece, noteOnPiece: noteOnPiece, review: review, CLIENT_PER_DAY: CLIENT_PER_DAY
};
