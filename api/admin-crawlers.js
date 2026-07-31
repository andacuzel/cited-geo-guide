/* =====================================================================
   /api/admin-crawlers — internal, unlisted. Served at the clean URL
   /admin/crawlers via the rewrite in vercel.json.

   Reads the aggregate counters middleware.js writes and renders a
   plain HTML table: per-crawler counts for the last 14 days, and the
   most-requested paths across all tracked crawlers combined. No auth
   beyond not being linked anywhere — see the note in the README/PR if
   that's not enough for your needs.

   Degrades to an honest empty state if KV isn't configured or errors,
   rather than crashing. This is an internal read-only tool; there's no
   "fail open" concern here the way there is for the scan endpoint.
   ===================================================================== */

const { kvPipeline } = require('./_kv');

var CRAWLERS = [
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'anthropic-ai',
  'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'CCBot', 'Bytespider',
  'Googlebot'
];
var DAYS_SHOWN = 14;
var TOP_PATHS_SHOWN = 25;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function lastNDates(n) {
  var out = [];
  var now = new Date();
  for (var i = n - 1; i >= 0; i--) {
    var d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function shell(bodyHtml) {
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '<meta charset="UTF-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    '<meta name="robots" content="noindex, nofollow" />\n' +
    '<title>Crawler visits — internal</title>\n' +
    '<style>\n' +
    'body{margin:0;padding:32px;background:#EEF1F5;color:#14202E;font-family:-apple-system,BlinkMacSystemFont,"Hanken Grotesk",sans-serif;}' +
    'h1{font-size:22px;margin:0 0 4px;}' +
    'h2{font-size:15px;margin:36px 0 10px;color:#4B5766;text-transform:uppercase;letter-spacing:0.06em;font-family:"SF Mono",monospace;}' +
    'p.note{color:#87909C;font-size:13px;margin:0 0 24px;}' +
    'table{border-collapse:collapse;font-size:12.5px;font-family:"SF Mono",monospace;background:#FFFFFF;border:1px solid #D9DEE6;border-radius:8px;overflow:hidden;}' +
    'th,td{padding:6px 10px;text-align:right;border-bottom:1px solid #D9DEE6;white-space:nowrap;}' +
    'th{background:#0B1526;color:#E7C77C;font-weight:500;position:sticky;top:0;}' +
    'td:first-child,th:first-child{text-align:left;position:sticky;left:0;background:#FFFFFF;}' +
    'th:first-child{background:#0B1526;}' +
    'tr:last-child td{border-bottom:none;}' +
    'tr.total td{font-weight:700;background:#F7F1E1;}' +
    '.scroll{overflow-x:auto;max-width:100%;}' +
    '.empty{color:#87909C;font-size:13px;}' +
    'a{color:#97701F;}' +
    '</style>\n</head>\n<body>\n' + bodyHtml + '\n</body>\n</html>\n';
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  var dates = lastNDates(DAYS_SHOWN);

  var cmds = [];
  CRAWLERS.forEach(function (name) {
    dates.forEach(function (date) {
      cmds.push(['GET', 'crawler:count:' + name + ':' + date]);
    });
  });
  cmds.push(['HGETALL', 'crawler:paths:_all']);

  var results = await kvPipeline(cmds);

  if (!results) {
    res.status(200).send(shell(
      '<h1>AI crawler visits</h1>' +
      '<p class="note">Counts recorded by middleware.js, aggregated per crawler per day.</p>' +
      '<p class="empty">No data available — Vercel KV isn’t configured or didn’t respond. ' +
      'Once KV_REST_API_URL / KV_REST_API_TOKEN are set and a tracked crawler visits the site, counts will show up here.</p>'
    ));
    return;
  }

  var grid = {};
  var idx = 0;
  var crawlerTotals = {};
  var dayTotals = {};
  CRAWLERS.forEach(function (name) {
    grid[name] = {};
    crawlerTotals[name] = 0;
    dates.forEach(function (date) {
      var r = results[idx++];
      var v = r && r.result != null ? parseInt(r.result, 10) : 0;
      if (isNaN(v)) v = 0;
      grid[name][date] = v;
      crawlerTotals[name] += v;
      dayTotals[date] = (dayTotals[date] || 0) + v;
    });
  });

  var pathsRaw = results[idx] && results[idx].result;
  var paths = [];
  if (pathsRaw) {
    if (Array.isArray(pathsRaw)) {
      for (var i = 0; i < pathsRaw.length; i += 2) {
        paths.push({ path: pathsRaw[i], count: parseInt(pathsRaw[i + 1], 10) || 0 });
      }
    } else if (typeof pathsRaw === 'object') {
      Object.keys(pathsRaw).forEach(function (k) {
        paths.push({ path: k, count: parseInt(pathsRaw[k], 10) || 0 });
      });
    }
    paths.sort(function (a, b) { return b.count - a.count; });
  }

  var grandTotal = Object.keys(crawlerTotals).reduce(function (a, k) { return a + crawlerTotals[k]; }, 0);

  var dateHeaders = dates.map(function (d) {
    return '<th>' + esc(d.slice(5)) + '</th>'; // MM-DD, keeps columns narrow
  }).join('');

  var rows = CRAWLERS.map(function (name) {
    var cells = dates.map(function (date) {
      var v = grid[name][date];
      return '<td' + (v > 0 ? '' : ' style="color:#C7CDD6"') + '>' + v + '</td>';
    }).join('');
    return '<tr><td>' + esc(name) + '</td>' + cells + '<td><strong>' + crawlerTotals[name] + '</strong></td></tr>';
  }).join('');

  var totalRow = '<tr class="total"><td>Total</td>' +
    dates.map(function (date) { return '<td>' + (dayTotals[date] || 0) + '</td>'; }).join('') +
    '<td>' + grandTotal + '</td></tr>';

  var pathRows = paths.length
    ? paths.slice(0, TOP_PATHS_SHOWN).map(function (p) {
        return '<tr><td>' + esc(p.path || '/') + '</td><td>' + p.count + '</td></tr>';
      }).join('')
    : '<tr><td colspan="2" class="empty">No paths recorded yet.</td></tr>';

  var body =
    '<h1>AI crawler visits</h1>' +
    '<p class="note">Last ' + DAYS_SHOWN + ' days, UTC. Counts only — no request-level log, nothing about human visitors.</p>' +
    '<h2>Per crawler, per day</h2>' +
    '<div class="scroll"><table><thead><tr><th>Crawler</th>' + dateHeaders + '<th>Total</th></tr></thead>' +
    '<tbody>' + rows + totalRow + '</tbody></table></div>' +
    '<h2>Most-requested paths (all crawlers combined)</h2>' +
    '<table><thead><tr><th style="text-align:left">Path</th><th>Hits</th></tr></thead>' +
    '<tbody>' + pathRows + '</tbody></table>';

  res.status(200).send(shell(body));
};
