#!/usr/bin/env node
/* scripts/test-check-mail-dns.js: scripts/check-mail-dns.js against a fake resolver (no network): every record present, a CNAME-based return path, a missing DKIM key, a missing SPF, no DMARC, a root policy with and without rua/sp, strict alignment. */

'use strict';

const M = require('./check-mail-dns.js');
let pass = 0; const fails = [];
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const t = (name, ok, extra) => { if (ok) pass++; else fails.push(name + (extra ? ' :: ' + extra : '')); out((ok ? '  ok  ' : '  FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };

// zone: { 'TXT name': [[strings]], 'CNAME name': [target], 'MX name': [{exchange, priority}] }. A CNAME is followed for TXT and MX like a real resolver does.
function resolver(zone) {
  const follow = (type, name) => { const c = zone['CNAME ' + name]; return c && type !== 'CNAME' ? c[0] : name; };
  const get = (type, name) => { const v = zone[type + ' ' + follow(type, name)]; if (!v) { const e = new Error('nodata'); e.code = 'ENODATA'; throw e; } return v; };
  return { resolveTxt: async (n) => get('TXT', n), resolveCname: async (n) => get('CNAME', n), resolveMx: async (n) => get('MX', n) };
}
const KEY = 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC' + 'A'.repeat(40);
const GOOD = {
  'TXT resend._domainkey.mail.example.org': [[KEY]],
  'CNAME send.mail.example.org': ['send.provider.example'],
  'TXT send.provider.example': [['v=spf1 ip4:192.0.2.1 ~all']],
  'MX send.provider.example': [{ exchange: 'feedback.provider.example', priority: 10 }],
  'TXT _dmarc.example.org': [['v=DMARC1; p=reject; ruf=mailto:x@example.org']]
};
const run = (zone, o) => M.check(resolver(zone), Object.assign({ domain: 'mail.example.org' }, o || {}));

(async function main() {
  let f = await run(GOOD);
  t('all records present (SPF through a CNAME): every check passes and the records are aligned', f.ok && f.dmarc.dkimAligned && f.dmarc.spfAligned && f.dmarc.foundAt === '_dmarc.example.org');
  t('a root p=reject with no rua is flagged, and the sending-subdomain record is suggested instead of lowering the root', f.advice.some((a) => /No rua tag/.test(a)) && f.advice.some((a) => /_dmarc\.mail\.example\.org = "v=DMARC1; p=none; rua=mailto:hey@example\.org"/.test(a)) && f.advice.some((a) => /no sp tag/.test(a)));
  t('the report never prints the DKIM key', !M.report(f).includes('MIGfMA0'));
  f = await run(Object.assign({}, GOOD, { 'TXT _dmarc.mail.example.org': [['v=DMARC1; p=none; rua=mailto:hey@example.org']] }));
  t('a sending-subdomain record with p=none and rua overrides the root and leaves no DMARC advice', f.dmarc.foundAt === '_dmarc.mail.example.org' && f.dmarc.policyForD === 'none' && f.advice.length === 0);
  f = await run(Object.assign({}, GOOD, { 'TXT _dmarc.example.org': [['v=DMARC1; p=reject; sp=none; rua=mailto:hey@example.org']] }));
  t('sp= on the root is the policy for the subdomain', f.dmarc.policyForD === 'none' && !f.advice.some((a) => /No rua/.test(a)));
  const noKey = Object.assign({}, GOOD); delete noKey['TXT resend._domainkey.mail.example.org'];
  f = await run(noKey);
  t('no DKIM record: that check fails and the advice says to confirm the selector in Resend', !f.ok && f.items[0].ok === false && f.advice.some((a) => /selector name on the Records tab/.test(a)));
  const noSpf = Object.assign({}, GOOD, { 'TXT send.provider.example': [['something else']] });
  f = await run(noSpf);
  t('no v=spf1 at the return-path host fails', !f.ok && f.items.some((x) => /SPF at the return-path/.test(x.name) && !x.ok));
  const two = Object.assign({}, GOOD, { 'TXT send.provider.example': [['v=spf1 -all'], ['v=spf1 ~all']] });
  t('two SPF records are flagged (SPF fails with several)', (await run(two)).items.some((x) => /several|more than one/.test(x.note)));
  const noDmarc = Object.assign({}, GOOD); delete noDmarc['TXT _dmarc.example.org'];
  f = await run(noDmarc);
  t('no DMARC anywhere: flagged, with the starting record', !f.ok && f.advice.some((a) => /Publish a DMARC record/.test(a)));
  f = await run(Object.assign({}, GOOD, { 'TXT _dmarc.example.org': [['v=DMARC1; p=none; aspf=s; rua=mailto:hey@example.org']] }));
  t('strict SPF alignment: a return path under the From domain is a different host, so SPF is not aligned (DKIM still is)', f.dmarc.spfAligned === false && f.dmarc.dkimAligned === true);
  t('parseDmarc reads tags and ignores other TXT records', M.parseDmarc(['x', 'v=DMARC1; p=none; rua=mailto:a@b.c']).p === 'none' && M.parseDmarc(['v=spf1 -all']) === null);

  out('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { process.stderr.write('FAILED:\n  ' + fails.join('\n  ') + '\n'); process.exit(1); }
}()).catch((e) => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
