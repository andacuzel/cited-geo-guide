#!/usr/bin/env python3
"""
scripts/brand/build_logo.py: draws the Citehound hound (variant B of docs/redesign/logo-options.png) and writes the SVG logo set into assets/brand/.

  python3 -m venv /tmp/vf && /tmp/vf/bin/pip install fonttools brotli
  /tmp/vf/bin/python scripts/brand/build_logo.py <path to bricolage-grotesque-wght-latin.woff2 (default assets/fonts/...)>

The hound is the original silhouette redrawn with the corner radius and weight of Bricolage Grotesque: polygon corners rounded with quadratic curves, a 1.1 unit round-join stroke
for weight, a larger ear and eye so it reads at 16 px. The wordmark is the outline of "Citehound" in Bricolage Grotesque 800 (OFL), tracking -40/1000 em, so the files need no font.
The door is not part of the logo (docs/brand/BRAND.md). PNG exports, the favicon and the other assets come from scripts/generate-brand-assets.js.
"""
import math, os, sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'brand')
INK, ORANGE, WHITE = '#0E1B2C', '#F05A28', '#FFFFFF'

def rpoly(items):
    n = len(items); d = []
    pts = [(x, y) for x, y, _ in items]
    lerp = lambda a, b, t: (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    for i, (x, y, r) in enumerate(items):
        p0, p, p1 = pts[i - 1], pts[i], pts[(i + 1) % n]
        l0, l1 = math.dist(p0, p), math.dist(p, p1)
        rr = min(r, l0 / 2.1, l1 / 2.1)
        a = lerp(p, p0, rr / l0) if rr else p
        b = lerp(p, p1, rr / l1) if rr else p
        d.append(('M' if i == 0 else 'L') + '%.2f %.2f' % a)
        if rr: d.append('Q%.2f %.2f %.2f %.2f' % (p[0], p[1], b[0], b[1]))
    return ' '.join(d) + 'Z'

def curve(p0, c, p1, n):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]) for t in [i / n for i in range(1, n)]]

head = curve((21, 15.5), (13, 32), (17, 57), 8)
neck = curve((32, 57), (28.5, 46.5), (37, 41), 6)
pts = [(62, 30, 2.6), (58, 28.5, 1.4), (40, 20, 1.4), (35, 17.5, 1.4), (28, 12, 2.6), (21, 15.5, 2.6)] + [(x, y, 0) for x, y in head] + [(17, 57, 2.6), (32, 57, 2.6)] + [(x, y, 0) for x, y in neck] + [(37, 41, 1.4), (39, 38, 1.4), (58, 34.5, 1.4), (61, 32.5, 2.6)]
cx, cy = (27.5 + 16 + 27) / 3, (16.5 + 25 + 22.5) / 3
ear = rpoly([(cx + (x - cx) * 1.3, cy + (y - cy) * 1.3, 1.0) for x, y in [(27.5, 16.5), (16, 25), (27, 22.5)]])
BODY = rpoly(pts) + ' ' + ear
EYE = (41, 23.4, 2.3)
STROKE = 1.1
VB = '13 8.5 52 52'

def hound(fill, eye, eye_hole=False, tf=''):
    """the hound as SVG elements. eye_hole: the eye is cut out of the body (one-colour versions)."""
    if eye_hole:
        e = 'M%s %s a%s %s 0 1 0 %s 0 a%s %s 0 1 0 -%s 0Z' % (EYE[0] - EYE[2], EYE[1], EYE[2], EYE[2], 2 * EYE[2], EYE[2], EYE[2], 2 * EYE[2])
        return '<path%s fill="%s" fill-rule="evenodd" stroke="%s" stroke-width="%s" stroke-linejoin="round" d="%s %s"/>' % (tf, fill, fill, STROKE, BODY, e)
    return '<path%s fill="%s" fill-rule="evenodd" stroke="%s" stroke-width="%s" stroke-linejoin="round" d="%s"/><circle%s cx="%s" cy="%s" r="%s" fill="%s"/>' % (tf, fill, fill, STROKE, BODY, tf, EYE[0], EYE[1], EYE[2], eye)

# the wordmark
woff = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'assets', 'fonts', 'bricolage-grotesque-wght-latin.woff2')
font = instantiateVariableFont(TTFont(woff), {'wght': 800})
gs, cmap = font.getGlyphSet(), font.getBestCmap()
SCALE, TRACK = 0.06, -40
def word(x0, base):
    x, ds = 0, []
    for ch in 'Citehound':
        g = cmap[ord(ch)]; pen = SVGPathPen(gs, ntos=lambda v: ('%.1f' % v).rstrip('0').rstrip('.'))
        gs[g].draw(TransformPen(pen, (SCALE, 0, 0, -SCALE, x0 + x * SCALE, base))); ds.append(pen.getCommands()); x += gs[g].width + TRACK
    return ' '.join(ds), x * SCALE
HX0, HX1, HY0, HY1 = 13.5, 62.5, 11.5, 57.5   # the hound's box in mark units
MARK_W, MARK_H = HX1 - HX0, HY1 - HY0
GAP = 11

def svg(vb, body, label='Citehound'):
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s" role="img" aria-label="%s"><title>%s</title>%s</svg>\n' % (vb, label, label, body)

def write(name, s):
    open(os.path.join(OUT, name), 'w').write(s)

# colourways: (name suffix, body colour, eye colour or None for a hole, wordmark colour)
WAYS = [('', INK, ORANGE, INK), ('-dark', WHITE, ORANGE, WHITE), ('-mono', 'currentColor', None, 'currentColor'), ('-white', WHITE, None, WHITE), ('-orange', ORANGE, None, ORANGE)]
for suf, fg, eye, wm in WAYS:
    write('logo-mark%s.svg' % suf, svg(VB, hound(fg, eye, eye_hole=eye is None)))
    # horizontal lockup: the hound, then the wordmark on the hound's baseline
    w0, ww = word(HX1 + GAP, HY1)
    write('logo-lockup%s.svg' % suf, svg('%s %s %.1f %s' % (HX0 - 1, HY0 - 1, MARK_W + GAP + ww + 3, MARK_H + 2), hound(fg, eye, eye_hole=eye is None) + '<path fill="%s" d="%s"/>' % (wm, w0)))
    # stacked lockup: the hound centred above the wordmark
    sw, sww = word(0, 0)
    mw = MARK_W * 2.0; total_w = max(sww, mw) + 8
    tf = ' transform="translate(%.1f %.1f) scale(2)"' % ((total_w - mw) / 2 - HX0 * 2, -HY0 * 2)
    write('logo-stacked%s.svg' % suf, svg('0 0 %.1f %.1f' % (total_w, MARK_H * 2 + 34 + 46), hound(fg, eye, eye_hole=eye is None, tf=tf) + '<path fill="%s" transform="translate(%.1f %.1f)" d="%s"/>' % (wm, (total_w - sww) / 2, MARK_H * 2 + 34 + 44, sw)))
for suf, fg, wm in (('', INK, INK), ('-dark', WHITE, WHITE)):
    w0, ww = word(0, 0)
    write('logo-wordmark%s.svg' % suf, svg('-1 -46 %.1f 52' % (ww + 2), '<path fill="%s" d="%s"/>' % (wm, w0)))
# compact lockups are the horizontal lockup (kept under their old names)
for suf in ('', '-dark'):
    write('logo-lockup-compact%s.svg' % suf, open(os.path.join(OUT, 'logo-lockup%s.svg' % suf)).read())
# badges: the hound reversed in a rounded square (avatars, favicon, app icons). Full-bleed variants have rx 0 (for platforms that round them).
def badge(bg, fg, rx):
    k = 0.95
    return svg('0 0 64 64', '<rect width="64" height="64" rx="%s" fill="%s"/><g transform="translate(%.2f %.2f) scale(%s)">%s</g>' % (rx, bg, 32 - (HX0 + MARK_W / 2) * k + 1, 33 - (HY0 + MARK_H / 2) * k, k, hound(fg, ORANGE)))
write('logo-badge.svg', badge(INK, WHITE, 14))
write('logo-badge-light.svg', badge(WHITE, INK, 14))
write('logo-badge-square.svg', badge(INK, WHITE, 0))
write('favicon.svg', badge(INK, WHITE, 14))
print('wrote the SVG logo set to', OUT)
