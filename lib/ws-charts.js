/* =====================================================================
   lib/ws-charts.js: the small chart helpers of the workspace dashboards. Hand-built inline SVG and HTML, no library, no script of its own.

   Every function returns a string and escapes everything it prints. Each chart is complete and readable without JavaScript; app/ws-view.js only adds the
   draw-in (a class that arms a CSS transition), the count-up and the tooltips, which read a plain text attribute (data-tip). Interactive points are focusable
   (tabindex 0) and carry an aria-label, so the tooltip is reachable by keyboard. Colours come from the site's tokens through CSS classes (styles.css, "Workspace
   dashboards"); there is no gradient anywhere.
   ===================================================================== */

'use strict';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n) => Math.round(n * 10) / 10;

/* A ring: value out of max, with a label under the number. size is the box in px (the SVG scales). */
function ring(o) {
  const size = o.size || 140, stroke = o.stroke || 14, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, o.max ? o.value / o.max : 0));
  return '<div class="wc-ring' + (o.cls ? ' ' + esc(o.cls) : '') + '" data-tip="' + esc(o.tip || (o.value + ' out of ' + o.max)) + '" tabindex="0" role="img" aria-label="' + esc(o.aria || (o.label + ': ' + o.value + ' out of ' + o.max)) + '">' +
    '<svg viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true" focusable="false"><circle class="wc-ring__track" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r1(r) + '" fill="none" stroke-width="' + stroke + '"/>' +
    '<circle class="wc-ring__bar" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r1(r) + '" fill="none" stroke-width="' + stroke + '" stroke-linecap="butt" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')" stroke-dasharray="' + r1(c) + '" stroke-dashoffset="' + r1(c * (1 - frac)) + '" data-full="' + r1(c) + '" data-off="' + r1(c * (1 - frac)) + '"/></svg>' +
    '<div class="wc-ring__num"><b data-count="' + esc(o.value) + '">' + esc(o.value) + '</b><small>/' + esc(o.max) + '</small></div></div>';
}

/* A line chart over time. points: [{ t (ms), y, tip, aria }] in time order. marks: [{ t, tip }] drawn as green diamonds on the time axis.
   yMin and yMax default to 0 and 100. xLabel(t) gives the text under a point. */
function lineChart(o) {
  const W = 640, H = 250, L = 38, R = 18, T = 16, B = 38;
  const pts = o.points || [];
  const yMin = o.yMin === undefined ? 0 : o.yMin, yMax = o.yMax === undefined ? 100 : o.yMax;
  if (!pts.length) return emptyState({ title: 'No scan yet', text: 'The chart appears after the first scan.' });
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = (t) => (t1 === t0 ? L + (W - L - R) / 2 : L + ((t - t0) / (t1 - t0)) * (W - L - R));
  const y = (v) => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => { const v = yMin + f * (yMax - yMin); return '<line class="wc-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + r1(y(v)) + '" y2="' + r1(y(v)) + '"/><text class="wc-axis" x="' + (L - 8) + '" y="' + r1(y(v) + 4) + '" text-anchor="end">' + Math.round(v) + '</text>'; }).join('');
  const d = pts.map((p, i) => (i ? 'L' : 'M') + r1(x(p.t)) + ' ' + r1(y(p.y))).join(' ');
  const area = d + ' L' + r1(x(t1)) + ' ' + r1(y(yMin)) + ' L' + r1(x(t0)) + ' ' + r1(y(yMin)) + ' Z';
  const every = Math.max(1, Math.ceil(pts.length / 6));
  const xl = pts.map((p, i) => (i % every === 0 || i === pts.length - 1) ? '<text class="wc-axis" x="' + r1(x(p.t)) + '" y="' + (H - 12) + '" text-anchor="' + (i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle') + '">' + esc(o.xLabel ? o.xLabel(p.t) : '') + '</text>' : '').join('');
  const marks = (o.marks || []).map((m) => '<g class="wc-mark" tabindex="0" role="img" aria-label="' + esc(m.tip) + '" data-tip="' + esc(m.tip) + '"><path d="M' + r1(x(m.t)) + ' ' + (H - B - 2) + ' l6 6 l-6 6 l-6 -6 z"/></g>').join('');
  const dots = pts.map((p) => '<circle class="wc-pt" cx="' + r1(x(p.t)) + '" cy="' + r1(y(p.y)) + '" r="5.5" tabindex="0" role="img" aria-label="' + esc(p.aria || p.tip) + '" data-tip="' + esc(p.tip) + '"/>').join('');
  return '<div class="wc-line" data-chart="line"><svg viewBox="0 0 ' + W + ' ' + H + '" role="group" aria-label="' + esc(o.aria || 'Score over time') + '">' + grid + '<path class="wc-area" d="' + area + '"/>' +
    '<path class="wc-path" d="' + d + '" fill="none" pathLength="1"/>' + marks + dots + xl + '</svg></div>';
}

/* Paired horizontal bars: rows [{ label, before, now, max }], before and now in points of max. */
function pairedBars(o) {
  const rows = (o.rows || []).map((r) => {
    const pb = r.max ? Math.round((r.before / r.max) * 100) : 0, pn = r.max ? Math.round((r.now / r.max) * 100) : 0;
    const row = (cls, name, v, p) => '<div class="wc-pair__line"><span class="wc-pair__name">' + name + '</span><span class="wc-pair__track"><span class="wc-pair__bar wc-pair__bar--' + cls + '" style="width:' + p + '%" data-w="' + p + '" tabindex="0" role="img" aria-label="' + esc(r.label + ', ' + name.toLowerCase() + ': ' + v + ' of ' + r.max) + '" data-tip="' + esc(r.label + ', ' + name.toLowerCase() + ': ' + v + ' of ' + r.max + ' points') + '"></span></span><span class="wc-pair__val">' + esc(v) + '/' + esc(r.max) + '</span></div>';
    return '<div class="wc-pair"><p class="wc-pair__label">' + esc(r.label) + '</p>' + (r.before === null || r.before === undefined ? '' : row('before', 'Before', r.before, pb)) + row('now', 'Now', r.now, pn) + '</div>';
  }).join('');
  return '<div class="wc-pairs" data-chart="bars">' + rows + '</div>';
}

/* A donut. segments: [{ label, value, cls }]; the centre shows the total with centreLabel under it. */
function donut(o) {
  const size = 150, stroke = 22, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const segs = (o.segments || []).filter((s) => s.value > 0);
  const total = (o.segments || []).reduce((n, s) => n + s.value, 0);
  let acc = 0;
  const arcs = total ? segs.map((s) => {
    const len = (s.value / total) * c;
    const el = '<circle class="wc-donut__seg wc-donut__seg--' + esc(s.cls) + '" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r1(r) + '" fill="none" stroke-width="' + stroke + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')" stroke-dasharray="' + r1(len) + ' ' + r1(c - len) + '" stroke-dashoffset="' + r1(-acc) + '" tabindex="0" role="img" aria-label="' + esc(s.label + ': ' + s.value) + '" data-tip="' + esc(s.label + ': ' + s.value + ' of ' + total) + '"/>';
    acc += len; return el;
  }).join('') : '';
  const legend = (o.segments || []).map((s) => '<li><span class="wc-dot wc-dot--' + esc(s.cls) + '" aria-hidden="true"></span>' + esc(s.label) + ' <b>' + esc(s.value) + '</b></li>').join('');
  return '<div class="wc-donut" data-chart="donut"><div class="wc-donut__fig"><svg viewBox="0 0 ' + size + ' ' + size + '" role="group" aria-label="' + esc(o.aria || 'Breakdown') + '"><circle class="wc-donut__track" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r1(r) + '" fill="none" stroke-width="' + stroke + '"/>' + arcs + '</svg>' +
    '<div class="wc-donut__num"><b>' + esc(total) + '</b><small>' + esc(o.centreLabel || '') + '</small></div></div><ul class="wc-legend">' + legend + '</ul></div>';
}

/* A progress bar with a caption line. */
function progress(o) {
  const p = o.max ? Math.round((o.value / o.max) * 100) : 0;
  return '<div class="wc-progress" data-chart="progress"><div class="wc-progress__track" role="progressbar" aria-valuemin="0" aria-valuemax="' + esc(o.max) + '" aria-valuenow="' + esc(o.value) + '" aria-label="' + esc(o.aria || o.caption) + '"><span class="wc-progress__bar" style="width:' + p + '%" data-w="' + p + '"></span></div><p class="wc-progress__cap">' + o.caption + '</p></div>';
}

/* A pipeline: steps [{ label, count, state: 'done' | 'now' | 'next' }], drawn as a row of numbered-free stages joined by a line. */
function stepper(o) {
  return '<ol class="wc-steps" aria-label="' + esc(o.aria || 'Pipeline') + '">' + (o.steps || []).map((s) =>
    '<li class="wc-step wc-step--' + esc(s.state || 'next') + '"><span class="wc-step__dot" aria-hidden="true"></span><span class="wc-step__count" data-count="' + esc(s.count) + '">' + esc(s.count) + '</span><span class="wc-step__label">' + esc(s.label) + '</span></li>').join('') + '</ol>';
}

function emptyState(o) {
  return '<div class="wc-empty"><p class="wc-empty__title">' + esc(o.title) + '</p>' + (o.text ? '<p class="wc-empty__text">' + esc(o.text) + '</p>' : '') + '</div>';
}

module.exports = { ring: ring, lineChart: lineChart, pairedBars: pairedBars, donut: donut, progress: progress, stepper: stepper, emptyState: emptyState, esc: esc };
