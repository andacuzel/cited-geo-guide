/* =====================================================================
   Shared Vercel KV helper (Node runtime only — Edge Middleware can't
   require() this, so middleware.js keeps its own small copy).

   Talks to KV directly over its REST API via fetch, not the @vercel/kv
   package — this project has zero dependencies, and there's no npm in
   this sandbox to add one anyway.

   Required environment variables (set when Vercel KV is connected in
   the dashboard):
     KV_REST_API_URL
     KV_REST_API_TOKEN

   Returns null on any failure (missing config, timeout, non-2xx,
   network error) — callers are expected to treat null as "storage
   unavailable" and degrade accordingly, never throw.
   ===================================================================== */

async function kvPipeline(commands) {
  var url = process.env.KV_REST_API_URL;
  var token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;

  var ctrl = new AbortController();
  var t = setTimeout(function () { ctrl.abort(); }, 3000);
  try {
    var res = await fetch(url + '/pipeline', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(commands)
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    clearTimeout(t);
    return null;
  }
}

module.exports = { kvPipeline: kvPipeline };
