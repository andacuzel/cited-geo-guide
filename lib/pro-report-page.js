/* =====================================================================
   lib/pro-report-page.js: the page served at /r/<id>/ for a Pro report.

   Server-rendered HTML with the shared renderer (lib/report-render.js renderPro), the same one
   the public /sample-report uses. A job that is still running gets the progress screen instead
   (app/pro-progress.js), which carries on from wherever the crawl is. Nothing here reads a
   contact address; the page never says who ordered it.

   Every page is noindex and sends no referrer (headers in lib/pro-http.js and vercel.json).
   