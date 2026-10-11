#!/usr/bin/env node
/* =====================================================================
   scripts/verify-readiness-pdf.js: check every number in the State of AI Readiness PDF against the stored benchmark data. A manual tool, not a gate
   (the PDF and the raw data are not in the repository).

     node scripts/verify-readiness-pdf.js <stats.json> <directory with p1.txt ... p8.txt>

   stats.json is local/launch-report/stats.json (node scripts/launch-report-stats.js). The page texts are the PDF's text, one file per page, extracted
   with any PDF text tool, for example:  python3 -m pip install --target /tmp/pdftools pypdf  and then pypdf's extract_text() for each page.
   Each line is OK when the figure the data gives appears in the PDF as written, and MISMATCH or MISS otherwise. The exit code is 1 on any miss.
   Run on 11 October 2026 against the 8-page Launch Edition: 68 figures, 0 mismatches.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const statsArg = process.argv[2], dirArg = process.argv[3];
if (!statsArg || !dirArg) { console.error('Usage: node scripts/verify-readiness-pdf.js <stats.json> <directory with p1.txt ... p8.txt>'); process.exit(2); }
const s = JSON.parse(fs.readFileSync(statsArg, 'utf8'));
const pdf = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => fs.readFileSync(path.join(dirArg, 'p' + i + '.txt'), 'utf8')).join('\n');
let ok=0,bad=0;
const r1=(x)=>Math.round(x*10)/10;
function chk(name,expected,must){ // must: string that has to appear in the PDF text
  const present=pdf.includes(must);
  const line=(present?'OK  ':'MISS')+' '+name+' = '+expected+'  [pdf has "'+must+'"]';
  console.log(line); present?ok++:bad++;
}
const o=s.overall, a=s.access, C=s.categories, T=s.tracks;
chk('scored',o.n,'219 scored'); chk('attempted',a.attempted,'278'); chk('not scored',a.notScored+' '+a.notScoredShare.pct,'59 of 278'); chk('pct',a.notScoredShare.pct,'21.2%');
chk('mean',o.score.mean,'73 /100'); chk('median',o.score.median,'Median 75'); chk('q1-q3',o.score.q1+'-'+o.score.q3,'between 67 and 82'); chk('range',o.score.min+'-'+o.score.max,'30 to 100');
chk('band80',o.scoreBands.from80.pct,'33.3%'); chk('band<50',o.scoreBands.below50.pct,'4.1%');
chk('pillars',[o.pillarMeans.discover.mean,o.pillarMeans.tech.mean,o.pillarMeans.trust.mean].join('/'),'26.9 / 40'); chk('p2',o.pillarMeans.tech.mean,'16.9 / 20'); chk('p3',o.pillarMeans.trust.mean,'29.3 / 40');
chk('B2B',T['B2B SaaS'].score.mean+' n'+T['B2B SaaS'].n,'76.4 (125 sites)'); chk('cons',T['Consumer & e-commerce'].score.mean+' n'+T['Consumer & e-commerce'].n,'68.6 for the three'); chk('gap',s.categoryDifferences.trackMeanDifference.points,'7.8 points');
chk('sd consumer apps',C['consumer-apps'].score.sd,'16.4');
for (const k of Object.keys(C)) chk('cat '+k, C[k].label+' n'+C[k].n+' '+C[k].score.mean, C[k].label.replace('Hospitality & travel','Hospitality & travel')+' ('+C[k].n+') '+r1(C[k].score.mean).toFixed(1));
const ps=s.categoryDifferences.pillarMeanSpread; chk('trust range',ps.trust.low+'-'+ps.trust.high,'24.1 to 33.2'); chk('spread',ps.trust.points,'9-point'); chk('disc spread',ps.discover.points,'2.3 points'); chk('tech spread',ps.tech.points,'2.8');
const ck=s.checks.rankedByFailure;
console.log('--- checks'); ck.forEach(c=>console.log(c.rank,c.label,c.maxPoints,c.failRatePct,c.avgPointsLostPerSite,c.avgPointsAddedByFix));
chk('schema fail', ck[0].failRatePct,'76.7%');
const get=(l)=>ck.find(c=>c.label.indexOf(l)===0);
[['Content schema','5','3.84'],['Organization','8','3.03'],['Single H1','6','1.95'],['llms.txt','4','1.84']].forEach(([l,p,lost])=>{const c=get(l); console.log(l,'| max',c.maxPoints,'(pdf',p+')','| lost',c.avgPointsLostPerSite,'(pdf',lost+')'); if(String(c.maxPoints)!==p||c.avgPointsLostPerSite.toFixed(2)!==lost) {bad++;console.log('MISMATCH')} else ok++;});
console.log('Author',get('Author').maxPoints,'Contact',get('Contact').maxPoints);
chk('sitemap',o.signals.sitemapDeclared.pct,'95.9%'); chk('canonical',o.signals.canonical.pct,'91.3%'); chk('jsonld',o.signals.jsonLd.pct,'68%'); chk('h1',o.signals.singleH1.pct,'67.6%'); chk('norobots',o.crawlers.noRobotsTxt.n+' '+o.crawlers.noRobotsTxt.pct,'2.7%'); chk('org fail',100-o.signals.organizationSchema.pct,'37.9%'); chk('llms fail',100-o.signals.llmsTxt.pct,'46.1%'); chk('h1 fail',r1(100-o.signals.singleH1.pct),'32.4%');
chk('block>=1',JSON.stringify(o.crawlers.sitesBlockingAtLeastOne),'14 of 219'); chk('all ten',o.crawlers.sitesBlockingEveryCrawler.n,'blocks all ten'); chk('fully open',JSON.stringify(o.crawlers.sitesFullyOpenToAll),'34 sites (15.5%)'); chk('pairs',o.crawlers.pairs.total,'2,190');
chk('blocked pairs',o.crawlers.pairs.blocked.pct,'Blocked 1.9%'); chk('limited',o.crawlers.pairs.limited.pct,'80.4%'); chk('open',o.crawlers.pairs.open.pct,'17.7%');
console.log('--- perBot blocked'); o.crawlers.perBot.forEach(b=>console.log(b.crawler,b.blocked));
const pb=Object.fromEntries(o.crawlers.perBot.map(b=>[b.crawler,b.blocked]));
['Bytespider 8','GPTBot 7','CCBot 7','ClaudeBot 4','PerplexityBot 1'].forEach(x=>{const [n,v]=x.split(' '); if(String(pb[n])!==v){bad++;console.log('MISMATCH',x,pb[n])}else ok++; if(!pdf.includes(x)){bad++;console.log('MISS',x)} });
chk('block range',JSON.stringify(s.categoryDifferences.restrictedCrawlerShareRange.blockingAtLeastOnePct),'2.1% to 17.5%'); chk('restricting',o.crawlers.sitesRestrictingAtLeastOne.pct,'84.5%');
const cl=C; chk('llms hosp',cl.hospitality.signals.llmsTxt.pct,'23.8%'); chk('llms apps',cl['consumer-apps'].signals.llmsTxt.pct,'27.5%'); chk('llms dtc',cl['dtc-brands'].signals.llmsTxt.pct,'75.8%'); chk('llms all',o.signals.llmsTxt.pct,'53.9%');
chk('jsonld crm',cl.crm.signals.jsonLd.pct,'83.9%'); chk('jsonld apps',cl['consumer-apps'].signals.jsonLd.pct,'37.5%');
chk('robots unread',JSON.stringify(a.robotsUnreachable),'43 of the 59'); chk('home unread',a.homepageUnreadable.n,'16 because'); chk('43/278',a.robotsUnreachable.pct,'43 of 278 attempted');
chk('hosp unscored',a.byCategory.hospitality.notScoredShare.pct,'52.3% (23 of 44)'); chk('dtc unsc',a.byCategory['dtc-brands'].notScoredShare.pct,'29.8%'); chk('crm unsc',a.byCategory.crm.notScoredShare.pct,'20.5%');
chk('meta caveat',s.checks.metaDescriptionParserCaveat.upperBoundOnFalseFailures,'up to 7 meta-description'); chk('meta eff',s.checks.metaDescriptionParserCaveat.meanScoreEffectUpperBound,'0.13 points');
console.log('\nOK', ok, 'BAD', bad);
process.exit(bad ? 1 : 0);
