#!/usr/bin/env node
/* =====================================================================
   scripts/capture-tour.js: the screenshots of the homepage product tour and of the /fix and /beyond heroes, taken from the LIVE pages.

     NODE_PATH=<a folder with playwright installed>/node_modules node scripts/capture-tour.js [base-url] [out-dir] [shot,shot]

   Playwright is not a dependency of this repository (the site has none; see CLAUDE.md): install it anywhere (npm i playwright; npx playwright install chromium) and
   point NODE_PATH at that folder. Defaults: https://getcitehound.com and assets/tour. It opens only the public, fictional or sample pages, at
   1200x800, and encodes each shot as WebP inside the browser (canvas.toDataURL), so no image tool is needed:

     /?scan=getcitehound.com  the free scan result for our own site (one real scan) -> free-scan.webp (1800x1200)
     /sample-report        the sample Pro report            -> pro-report.webp (1800x1200)
     /demo/fix             the Fix demo, its Overview       -> fix.webp (1800x1200), fix-hero.webp (960x640)
     /demo/fix#fixes       the Fix demo, the Fix list       -> fix-list.webp (1800x1200)
     /demo/beyond          the Beyond demo, its Overview    -> beyond.webp (1800x1200), beyond-hero.webp (960x640)
     /demo/beyond#content  the Beyond demo, the Content board -> beyond-content.webp (1800x1200)

   The demo data is never changed here. Re-run it when a page's layout changes, then commit the files. The pages show their own "Product demo · Sample data" band.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const BASE = (process.argv[2] || 'https://getcitehound.com').replace(/\/$/, '');
const OUT = path.resolve(process.argv[3] || path.join(__dirname, '..', 'assets', 'tour'));
const ONLY = process.argv[4] ? process.argv[4].split(',') : null;   // e.g. free-scan: only these shots
const SHOTS = [
  { path: '/?scan=getcitehound.com', file: 'free-scan', sizes: [['', 1.5]], wait: '#scanReport:not([hidden])' },
  { path: '/sample-report', file: 'pro-report', sizes: [['', 1.5]] },
  { path: '/demo/fix', file: 'fix', sizes: [['', 1.5], ['-hero', 0.8]] },
  { path: '/demo/fix#fixes', file: 'fix-list', sizes: [['', 1.5]] },
  { path: '/demo/beyond', file: 'beyond', sizes: [['', 1.5], ['-hero', 0.8]] },
  { path: '/demo/beyond#content', file: 'beyond-content', sizes: [['', 1.5]] }
];

async function main() {
  let pw;
  try { pw = require('playwright'); } catch (e) { console.error('playwright is not installed. Set NODE_PATH to a node_modules folder that has it (see the header of this file).'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await pw.chromium.launch();
  for (const s of SHOTS) {
    if (ONLY && ONLY.indexOf(s.file) === -1) continue;
    for (const [suffix, scale] of s.sizes) {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await page.goto(BASE + s.path, { waitUntil: 'networkidle', timeout: 60000 });
      if (s.wait) { await page.waitForSelector(s.wait, { timeout: 60000 }); await page.waitForTimeout(3500); }
      await page.evaluate(() => document.fonts && document.fonts.ready);
      await page.addStyleTag({ content: '.toast, .wl-bar, .rc-card { display: none !important; }' });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(600);
      const png = await page.screenshot({ type: 'png' });
      const b64 = await page.evaluate(async (data) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        return c.toDataURL('image/webp', 0.86).split(',')[1];
      }, png.toString('base64'));
      const buf = Buffer.from(b64, 'base64');
      const file = path.join(OUT, s.file + suffix + '.webp');
      fs.writeFileSync(file, buf);
      const w = Math.round(1200 * scale), h = Math.round(800 * scale);
      console.log(path.basename(file) + '  ' + w + 'x' + h + '  ' + Math.round(buf.length / 1024) + ' KB');
      await ctx.close();
    }
  }
  await browser.close();
}

main().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
