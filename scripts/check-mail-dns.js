#!/usr/bin/env node
/* =====================================================================
   scripts/check-mail-dns.js: do the DNS records for the sending domain look right? Read-only: it only looks records up, it changes nothing.

     node scripts/check-mail-dns.js                       mail.getcitehound.com (the default sending domain)
     node scripts/check-mail-dns.js --domain mail.example.org --selector resend
     node scripts/check-mail-dns.js --json                the findings as JSON

   Checks, for the sending domain D (the domain in the From address):
     DKIM    a TXT record with a public key (p=...) at <selector>._domainkey.D, or a CNAME there. The default selector is "resend", which is what
             the existing records use; Resend's page does not publish the selector name, so confirm it on the Records tab of the domain in Resend.
     SPF     a v=spf1 TXT for the return-path host, which Resend defaults to send.D (Resend's "add a domain" page); the lookup follows a CNAME,
             so the CNAME-based setup counts. Also: an MX record there for bounces, and that D itself has no conflicting SPF.
     DMARC   the policy that applies to D: the TXT at _dmarc.D if there is one, else the organizational domain's _dmarc record (the policy
             tag p applies to subdomains too unless sp= says otherwise). Reported: p, sp, pct, rua, ruf, adkim, aspf, and where it was found.
     Aligned the DKIM signing domain (the domain in the selector's record path) against D, and the return-path domain against D, under the
             policy's alignment modes (relaxed unless adkim=s / aspf=s). Alignment here is worked out from the record names, not from a real message:
             to be sure, send a message and read its headers (Authentication-Results).
   Then a recommendation. It never prints a DKIM key, only that one is present.
   ===================================================================== */

'use strict';

const dns = require('dns').promises;

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i === -1 ? d : args[i + 1]; };

const orgOf = (host) => host.split('.').slice(-2).join('.'); // good enough for getcitehound.com and the like; not for co.uk-style suffixes (see the note in the report)

async function txt(r, name) { try { return (await r.resolveTxt(name)).map((x) => x.join('')); } catch (e) { return []; } }
async function cname(r, name) { try { return await r.resolveCname(name); } catch (e) { return []; } }
async function mx(r, name) { try { return await r.resolveMx(name); } catch (e) { return []; } }

function parseDmarc(records) {
  const rec = records.find((x) => /^v=DMARC1\b/i.test(x.trim()));
  if (!rec) return null;
  const tags = {};
  rec.split(';').map((s) => s.trim()).filter(Boolean).forEach((p) => { const i = p.indexOf('='); if (i > 0) tags[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim(); });
  return tags;
}

async function check(r, o) {
  o = o || {};
  const D = String(o.domain || 'mail.getcitehound.com').toLowerCase();
  const selector = o.selector || 'resend';
  const org = orgOf(D);
  const f = { domain: D, org: org, selector: selector, items: [], dmarc: null, advice: [] };
  const add = (name, ok, note) => f.items.push({ name: name, ok: ok, note: note });

  // DKIM
  const dkimName = selector + '._domainkey.' + D;
  const dkimTxt = await txt(r, dkimName), dkimCname = await cname(r, dkimName);
  const hasKey = dkimTxt.some((x) => /\bp=[A-Za-z0-9+/=]{20,}/.test(x));
  add('DKIM at ' + dkimName, hasKey || dkimCname.length > 0, hasKey ? 'a public key is published (not shown)' : (dkimCname.length ? 'a CNAME to ' + dkimCname[0] : 'no record: check the selector name on the Records tab in Resend'));
  f.dkimDomain = D; // the selector lives under D, so the signing domain (d=) is D when the key is published here

  // SPF and the return path
  const rp = 'send.' + D;
  const rpCname = await cname(r, rp);
  const spf = (await txt(r, rp)).filter((x) => /^v=spf1\b/i.test(x));
  add('SPF at the return-path host ' + rp, spf.length === 1, spf.length === 1 ? (rpCname.length ? 'a v=spf1 record, reached through a CNAME to ' + rpCname[0] : 'a v=spf1 record') : (spf.length > 1 ? 'more than one v=spf1 record: SPF fails when there are several' : 'no v=spf1 record found (checked the host, following a CNAME)'));
  const rpMx = await mx(r, rp);
  add('MX at ' + rp + ' (bounces)', rpMx.length > 0, rpMx.length ? 'goes to ' + rpMx[0].exchange : 'none: bounces and complaints would not reach the provider');
  const dSpf = (await txt(r, D)).filter((x) => /^v=spf1\b/i.test(x));
  add('SPF on ' + D + ' itself', dSpf.length <= 1, dSpf.length ? 'a v=spf1 record exists on the From domain' : 'none (not needed: the return path is a separate host)');
  f.returnPathDomain = rp;

  // DMARC
  const own = parseDmarc(await txt(r, '_dmarc.' + D));
  const root = D === org ? own : parseDmarc(await txt(r, '_dmarc.' + org));
  f.dmarc = { own: own, root: root, effective: own || root, foundAt: own ? '_dmarc.' + D : (root ? '_dmarc.' + org : null) };
  const e = f.dmarc.effective;
  add('DMARC applies to ' + D, !!e, e ? 'found at ' + f.dmarc.foundAt : 'no DMARC record at ' + D + ' or ' + org);
  if (e) {
    const subPolicy = own ? own.p : (root.sp || root.p);
    f.dmarc.policyForD = subPolicy;
    f.dmarc.hasRua = !!e.rua;
    const adkim = (e.adkim || 'r').toLowerCase(), aspf = (e.aspf || 'r').toLowerCase();
    const align = (a, mode) => a === D || (mode !== 's' && (a === org || a.endsWith('.' + org) || D.endsWith('.' + a) || a.endsWith('.' + D)));
    f.dmarc.dkimAligned = align(f.dkimDomain, adkim);
    f.dmarc.spfAligned = align(rp, aspf);
    add('DKIM aligned with ' + D + ' (adkim=' + adkim + ')', f.dmarc.dkimAligned, f.dmarc.dkimAligned ? 'the signing domain is ' + f.dkimDomain : 'the signing domain would be ' + f.dkimDomain);
    add('SPF aligned with ' + D + ' (aspf=' + aspf + ')', f.dmarc.spfAligned, f.dmarc.spfAligned ? 'the return path ' + rp + ' is a subdomain of ' + D + (aspf === 's' ? '' : ' (relaxed alignment)') : 'the return path ' + rp + ' is not aligned under strict alignment');
  }

  // Advice
  const A = f.advice;
  if (!e) A.push('Publish a DMARC record. Start with: v=DMARC1; p=none; rua=mailto:hey@' + org + ' on _dmarc.' + D + '.');
  else {
    const pol = f.dmarc.policyForD;
    if (!e.rua) A.push('No rua tag: nobody receives DMARC aggregate reports, so a failing sender would go unseen. Add rua=mailto:hey@' + org + '. The address is on the same organizational domain, so no extra authorization record is needed (RFC 7489 section 7.1; not tested against every receiver).');
    if (pol === 'reject' || pol === 'quarantine') A.push('The policy that applies to ' + D + ' is p=' + pol + (own ? '' : ' (inherited from ' + org + (root.sp ? ', sp=' + root.sp : ', no sp tag, so the root p applies to subdomains') + ')') + '. With no reports (no rua) you cannot see whether Resend mail passes before relying on it. Resend suggests starting with p=none and tightening once messages deliver and pass.');
    if (own && !root) A.push('The root domain ' + org + ' has no DMARC record of its own.');
    if (!own) A.push('Safer than lowering the root policy: add a record on the sending subdomain only, _dmarc.' + D + ' = "v=DMARC1; p=none; rua=mailto:hey@' + org + '". It overrides the root for ' + D + ' while ' + org + ' keeps p=' + (root && root.p) + '. After a few weeks of clean reports, move it to quarantine, then reject. If you lower the root itself to p=none instead, anyone can spoof ' + org + ' for as long as it stays there.');
    if (!f.dmarc.dkimAligned && !f.dmarc.spfAligned) A.push('Neither DKIM nor SPF is aligned with ' + D + ': DMARC would fail for every message.');
  }
  f.items.filter((x) => !x.ok).forEach((x) => A.push('Fix: ' + x.name + ' (' + x.note + ').'));
  f.ok = f.items.every((x) => x.ok);
  return f;
}

function report(f) {
  const L = [];
  L.push('Mail DNS for ' + f.domain + ' (organizational domain ' + f.org + '). Read-only; nothing was changed.', '');
  f.items.forEach((x) => L.push((x.ok ? '  ok    ' : '  CHECK ') + x.name + ': ' + x.note));
  const d = f.dmarc;
  L.push('');
  const show = (t) => t ? Object.keys(t).map((k) => k + '=' + (k === 'rua' || k === 'ruf' ? t[k].replace(/mailto:/g, '') : t[k])).join('; ') : 'none';
  L.push('DMARC on ' + f.domain + ': ' + show(d.own));
  L.push('DMARC on ' + f.org + ': ' + show(d.root));
  if (d.effective) L.push('Policy that applies to ' + f.domain + ': p=' + d.policyForD + ', reports (rua): ' + (d.hasRua ? 'yes' : 'NO'));
  L.push('');
  L.push(f.advice.length ? 'Recommendation:' : 'Recommendation: nothing to change.');
  f.advice.forEach((a) => L.push('  - ' + a));
  L.push('', 'Note: alignment is worked out from the record names. Send one message to a mailbox you control and read Authentication-Results to confirm spf=pass, dkim=pass and dmarc=pass.');
  return L.join('\n');
}

module.exports = { check: check, report: report, parseDmarc: parseDmarc };

if (require.main === module) {
  const r = new dns.Resolver();
  r.setServers(['1.1.1.1', '8.8.8.8']);
  check(r, { domain: val('--domain', 'mail.getcitehound.com'), selector: val('--selector', 'resend') }).then((f) => {
    process.stdout.write((args.indexOf('--json') !== -1 ? JSON.stringify(f, null, 2) : report(f)) + '\n');
    process.exit(0);
  }).catch((e) => { process.stderr.write('The lookup failed: ' + (e && e.code || e && e.message) + '\n'); process.exit(1); });
}
