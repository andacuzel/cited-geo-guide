/* =====================================================================
   lib/ws-store.js: storage for project workspaces (Fix now, Beyond next), in the same Redis as Pro (docs/workspaces.md).

     ws:<id>          hash    type (fix | beyond), domain, status (active | archived), createdAt, updatedAt, proJobId (optional, a Pro report job id),
                              demo ("1" for the fictional demo workspaces), siteInfo (JSON: title, metaDesc, lang), sitemapUrl
     ws:<id>:items    string  JSON array: the work items (the Fix list)
     ws:<id>:scans    string  JSON array: the history, one entry per scan (baseline, rescan, verify), newest last, at most 60
     ws:<id>:last     string  JSON: the latest scan's checks (what the Overview and the Files tab are built from)
     ws:<id>:vlock    string  exists for 20 seconds after a Verify (one at a time per workspace)
     ws:<id>:vn:<day> counter Verify runs that UTC day
     Beyond workspaces also have:
     ws:<id>:questions string JSON array: the market questions ({ id, text })
     ws:<id>:gaps      string JSON array: question, page, note, priority (admin-entered)
     ws:<id>:months    string JSON array: the citation-check result of a month, when there is one ({ month, named, asked, model, note })
     ws:<id>:content   set     of content ids (c1, c2 ...)
     ws:<id>:c:<cid>   hash    title, type, status (draft | in_review | approved | published), body (markdown), version, createdAt, updatedAt
     ws:<id>:cm:<cid>  hash    comments on a piece, one field each (a time and a random tail): JSON { at, by (client | admin), kind (approve | changes | note), text }
                              A client's Approve or Request changes is one HSET of the status field and one HSET of a comment: no read-modify-write of a whole record.
     ws:index         set     of ids of real workspaces, only so the admin can list them

   <id> is 32 random hex characters from crypto.randomBytes: unguessable, the whole of the client's access (a bearer link, /w/<id>, like /r/<id>). The two demo
   workspaces have fixed names (demo-fix, demo-beyond), are never in the index, never match the link pattern, and have no expiry; the seed script rewrites them.
   Nothing here holds contact data: a workspace has a domain, work items and notes, not a person.
   ===================================================================== */

'use strict';

const crypto = require('crypto');

const HEX32 = /^[0-9a-f]{32}$/;
const DEMO = { fix: 'demo-fix', beyond: 'demo-beyond' };
const ACTIVE_TTL = 400 * 86400;     // refreshed on every write: 400 days after the last activity
const ARCHIVED_TTL = 90 * 86400;    // 90 days after archiving, then it is gone
const INDEX = 'ws:index';
const MAX_SCANS = 60;
const TYPES = ['fix', 'beyond'];

const newId = () => crypto.randomBytes(16).toString('hex');
const k = (id, part) => 'ws:' + id + (part ? ':' + part : '');
const isDemoId = (id) => id === DEMO.fix || id === DEMO.beyond;

const FIXED = ['', 'items', 'scans', 'last', 'questions', 'gaps', 'months', 'content'];

const cidNum = (cid) => parseInt(String(cid).slice(1), 10) || 0;
async function contentIds(A, id) { return (await A.smembers(k(id, 'content'))).sort((a, b) => cidNum(a) - cidNum(b)); }

// Every key a workspace owns, the content pieces and their comments included.
async function allKeys(A, id) {
  const keys = FIXED.map((p) => k(id, p));
  for (const cid of await contentIds(A, id)) { keys.push(k(id, 'c:' + cid)); keys.push(k(id, 'cm:' + cid)); }
  return keys;
}

async function expireAll(A, id, ttl) {
  if (isDemoId(id)) return;
  for (const key of await allKeys(A, id)) await A.expire(key, ttl);
}

// Makes a workspace. Returns its id. meta: { type, domain, siteInfo?, sitemapUrl?, proJobId?, demo? }.
async function create(A, meta, now, forcedId) {
  if (TYPES.indexOf(meta.type) === -1) throw new Error('unknown workspace type');
  const id = forcedId || newId();
  const at = new Date(now === undefined ? Date.now() : now).toISOString();
  const f = { type: meta.type, domain: meta.domain, status: 'active', createdAt: at, updatedAt: at };
  if (meta.siteInfo) f.siteInfo = JSON.stringify(meta.siteInfo);
  if (meta.sitemapUrl) f.sitemapUrl = meta.sitemapUrl;
  if (meta.proJobId) f.proJobId = meta.proJobId;
  if (meta.demo) f.demo = '1';
  await A.hset(k(id), f);
  await A.set(k(id, 'items'), '[]');
  await A.set(k(id, 'scans'), '[]');
  if (!forcedId) await A.sadd(INDEX, id);
  await expireAll(A, id, ACTIVE_TTL);
  return id;
}

async function getMeta(A, id) {
  const h = await A.hgetall(k(id));
  if (!h) return null;
  let siteInfo = null; try { siteInfo = h.siteInfo ? JSON.parse(h.siteInfo) : null; } catch (e) { siteInfo = null; }
  return { id: id, type: h.type, domain: h.domain, status: h.status || 'active', createdAt: h.createdAt, updatedAt: h.updatedAt, proJobId: h.proJobId || '', demo: h.demo === '1', siteInfo: siteInfo, sitemapUrl: h.sitemapUrl || '' };
}

async function setMeta(A, id, fields) {
  const f = Object.assign({}, fields, { updatedAt: new Date().toISOString() });
  if (f.siteInfo && typeof f.siteInfo !== 'string') f.siteInfo = JSON.stringify(f.siteInfo);
  await A.hset(k(id), f);
}

async function getJson(A, id, part, fallback) {
  const v = await A.get(k(id, part));
  if (v === null || v === undefined) return fallback;
  try { return JSON.parse(v); } catch (e) { return fallback; }
}
async function putJson(A, id, part, value) {
  await A.set(k(id, part), JSON.stringify(value));
  const m = await A.hget(k(id), 'status');
  await expireAll(A, id, m === 'archived' ? ARCHIVED_TTL : ACTIVE_TTL);
}

const getItems = (A, id) => getJson(A, id, 'items', []);
const putItems = (A, id, items) => putJson(A, id, 'items', items);
const getScans = (A, id) => getJson(A, id, 'scans', []);
const getLast = (A, id) => getJson(A, id, 'last', null);
const putLast = (A, id, last) => putJson(A, id, 'last', last);
async function addScan(A, id, entry) {
  const scans = await getScans(A, id);
  scans.push(entry);
  await putJson(A, id, 'scans', scans.slice(-MAX_SCANS));
}

async function archive(A, id, on) {
  const m = await A.hget(k(id), 'status');
  if (m === null) return false;
  await A.hset(k(id), { status: on ? 'archived' : 'active', updatedAt: new Date().toISOString() });
  await expireAll(A, id, on ? ARCHIVED_TTL : ACTIVE_TTL);
  return true;
}

// Every real workspace still alive, newest first. An id whose record has expired is dropped from the index on the way.
async function list(A) {
  const ids = await A.smembers(INDEX);
  const out = [];
  for (const id of ids) {
    const m = await getMeta(A, id);
    if (!m) { await A.srem(INDEX, id); continue; }
    out.push(m);
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return out;
}

async function remove(A, id) {
  for (const key of await allKeys(A, id)) await A.del(key);
  await A.del(k(id, 'vlock'));
  await A.srem(INDEX, id);
}

/* ---------- Beyond: questions, gaps, months ---------- */

const getQuestions = (A, id) => getJson(A, id, 'questions', []);
const putQuestions = (A, id, v) => putJson(A, id, 'questions', v);
const getGaps = (A, id) => getJson(A, id, 'gaps', []);
const putGaps = (A, id, v) => putJson(A, id, 'gaps', v);
const getMonths = (A, id) => getJson(A, id, 'months', []);
const putMonths = (A, id, v) => putJson(A, id, 'months', v);

/* ---------- Beyond: content pieces and their comments ---------- */

const CONTENT_FIELDS = ['title', 'type', 'status', 'body', 'version', 'createdAt', 'updatedAt'];
async function getPiece(A, id, cid) {
  const h = await A.hgetall(k(id, 'c:' + cid));
  if (!h) return null;
  return { id: cid, title: h.title || '', type: h.type || '', status: h.status || 'draft', body: h.body || '', version: parseInt(h.version || '1', 10), createdAt: h.createdAt, updatedAt: h.updatedAt };
}
async function getComments(A, id, cid) {
  const h = await A.hgetall(k(id, 'cm:' + cid));
  const out = [];
  Object.keys(h || {}).sort().forEach((f) => { try { out.push(JSON.parse(h[f])); } catch (e) { /* skip a damaged one */ } });
  return out;
}
async function listContent(A, id, withComments) {
  const out = [];
  for (const cid of await contentIds(A, id)) {
    const p = await getPiece(A, id, cid);
    if (!p) continue;
    if (withComments) p.comments = await getComments(A, id, cid);
    out.push(p);
  }
  return out;
}
async function putPiece(A, id, cid, fields) {
  await A.hset(k(id, 'c:' + cid), fields);
  await A.sadd(k(id, 'content'), cid);
  const m = await A.hget(k(id), 'status');
  await expireAll(A, id, m === 'archived' ? ARCHIVED_TTL : ACTIVE_TTL);
}
let commentSeq = 0;
async function addComment(A, id, cid, c, now) {
  const at = new Date(now === undefined ? Date.now() : now).toISOString();
  const field = String(Date.parse(at)).padStart(14, '0') + '-' + String(++commentSeq % 1000).padStart(3, '0') + crypto.randomBytes(2).toString('hex');   // a time, then a counter, so two comments in one millisecond keep their order
  await A.hset(k(id, 'cm:' + cid), { [field]: JSON.stringify({ at: at, by: c.by, kind: c.kind, text: c.text }) });
  const m = await A.hget(k(id), 'status');
  await expireAll(A, id, m === 'archived' ? ARCHIVED_TTL : ACTIVE_TTL);
}
async function removePiece(A, id, cid) {
  await A.del(k(id, 'c:' + cid)); await A.del(k(id, 'cm:' + cid)); await A.srem(k(id, 'content'), cid);
}

module.exports = {
  HEX32: HEX32, DEMO: DEMO, TYPES: TYPES, MAX_SCANS: MAX_SCANS, ACTIVE_TTL: ACTIVE_TTL, ARCHIVED_TTL: ARCHIVED_TTL, key: k, isDemoId: isDemoId,
  create: create, getMeta: getMeta, setMeta: setMeta, getItems: getItems, putItems: putItems, getScans: getScans, addScan: addScan, getLast: getLast, putLast: putLast,
  archive: archive, list: list, remove: remove,
  getQuestions: getQuestions, putQuestions: putQuestions, getGaps: getGaps, putGaps: putGaps, getMonths: getMonths, putMonths: putMonths,
  contentIds: contentIds, getPiece: getPiece, listContent: listContent, putPiece: putPiece, getComments: getComments, addComment: addComment, removePiece: removePiece, cidNum: cidNum
};
