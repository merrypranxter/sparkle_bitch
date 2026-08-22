/* Sparkle Bitch — analyze.js
 * Highlight / feature detection (the "Selection Marker" behaviour).
 * Finds bright, high-contrast points, reduces clusters to well-spaced
 * centres, and samples local colour + size for each — so sparkles match the
 * position, size and colour of features in the photo, exactly like Glitterboo.
 *
 * Detection modes:
 *   bright  — only luminance (classic: sparkle the highlights)
 *   edges   — only Sobel contrast (sparkle along outlines/lines)
 *   both    — either test passes (the original behaviour)
 *   shadow  — inverted luminance: sparkle the DARK areas
 *   scatter — ignore the image; seeded random points everywhere
 * `trace` additionally walks edge ridges and drops chains of sparkles along
 * them, so lines and contours get literally outlined in glitter.
 *
 * Works on a downscaled RGBA buffer for speed; returns NORMALISED positions
 * so sparkles can be rendered at any output resolution.
 */
(function (global) {
  'use strict';
  var SB = global.SB = global.SB || {};
  var U = SB.util;

  // Build the luminance field for a buffer.
  function lumaField(data, w, h) {
    var L = new Float32Array(w * h);
    for (var i = 0, p = 0; i < L.length; i++, p += 4) {
      L[i] = U.luma(data[p], data[p + 1], data[p + 2]);
    }
    return L;
  }

  // Sobel gradient magnitude of the luminance field.
  function gradField(L, w, h) {
    var G = new Float32Array(w * h);
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x;
        var tl = L[i - w - 1], t = L[i - w], tr = L[i - w + 1];
        var l = L[i - 1], r = L[i + 1];
        var bl = L[i + w - 1], b = L[i + w], br = L[i + w + 1];
        var gx = (tr + 2 * r + br) - (tl + 2 * l + bl);
        var gy = (bl + 2 * b + br) - (tl + 2 * t + tr);
        G[i] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    return G;
  }

  // Average colour over a (2*rad+1)^2 window.
  function sampleColor(data, w, h, cx, cy, rad) {
    var r = 0, g = 0, b = 0, n = 0;
    for (var dy = -rad; dy <= rad; dy++) {
      var y = cy + dy; if (y < 0 || y >= h) continue;
      for (var dx = -rad; dx <= rad; dx++) {
        var x = cx + dx; if (x < 0 || x >= w) continue;
        var p = (y * w + x) * 4;
        r += data[p]; g += data[p + 1]; b += data[p + 2]; n++;
      }
    }
    if (!n) return [255, 255, 255];
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }

  // Estimate how large the bright region under a point is (in px radius).
  function blobRadius(L, w, h, cx, cy, cap) {
    var center = L[cy * w + cx];
    var floor = Math.max(center * 0.55, 40);
    var ext = 0, dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var d = 0; d < 4; d++) {
      var dx = dirs[d][0], dy = dirs[d][1], steps = 0;
      for (var s = 1; s <= cap; s++) {
        var x = cx + dx * s, y = cy + dy * s;
        if (x < 0 || y < 0 || x >= w || y >= h) break;
        if (L[y * w + x] < floor) break;
        steps = s;
      }
      ext += steps;
    }
    return ext / 4;
  }

  // Does a pixel pass the mode's test?
  function passes(mode, lu, gr, lumaT, contrastT) {
    switch (mode) {
      case 'bright': return lu >= lumaT;
      case 'edges': return gr >= contrastT;
      case 'shadow': return lu <= lumaT;   // slider reads as "dark enough"
      default: return lu >= lumaT || gr >= contrastT;   // 'both'
    }
  }

  function scoreOf(mode, lu, gr, lumaW, edgeW) {
    var lumPart = mode === 'shadow' ? (1 - lu / 255) : (lu / 255);
    return lumPart * lumaW + Math.min(1, gr / 255) * edgeW;
  }

  // Walk edge ridges: from strong-gradient seeds, step along the tangent
  // (perpendicular to the gradient) in both directions, dropping a point every
  // `spacing` px while the ridge holds. The "outline things in glitter" mode.
  function traceEdges(L, G, w, h, contrastT, spacing, mask, rng) {
    var pts = [];
    var visited = new Uint8Array(w * h);
    var step = Math.max(2, Math.round(spacing));
    var floor = contrastT * 0.45;
    var cell = step * 2;
    var MAXCHAIN = 60, MAXPTS = 4000;

    function gradAngle(x, y) {
      var i = y * w + x;
      var gx = L[i + 1] - L[i - 1], gy = L[i + w] - L[i - w];
      return Math.atan2(gy, gx);
    }
    function walk(x, y, dx, dy) {
      var cx = x, cy = y;
      for (var s = 0; s < MAXCHAIN; s++) {
        cx += dx * step; cy += dy * step;
        var ix = Math.round(cx), iy = Math.round(cy);
        if (ix < 1 || iy < 1 || ix >= w - 1 || iy >= h - 1) break;
        // snap back to the ridge: strongest gradient in a 5x5 window
        var bi = -1, bg = floor, bxx = 0, byy = 0;
        for (var oy = -2; oy <= 2; oy++) {
          for (var ox = -2; ox <= 2; ox++) {
            var xx = ix + ox, yy = iy + oy;
            if (xx < 1 || yy < 1 || xx >= w - 1 || yy >= h - 1) continue;
            var ii = yy * w + xx;
            if (visited[ii] || (mask && !mask[ii])) continue;
            if (G[ii] >= bg) { bg = G[ii]; bi = ii; bxx = xx; byy = yy; }
          }
        }
        if (bi < 0) break;
        visited[bi] = 1;
        pts.push({ x: bxx, y: byy });
        cx = bxx; cy = byy;
        // re-orient to the local ridge so chains follow curves
        var a = gradAngle(bxx, byy) + Math.PI / 2;
        // keep walking the same general way (no 180° flips)
        var nx2 = Math.cos(a), ny2 = Math.sin(a);
        if (nx2 * dx + ny2 * dy < 0) { nx2 = -nx2; ny2 = -ny2; }
        dx = nx2; dy = ny2;
      }
    }

    for (var gy = 0; gy < h && pts.length < MAXPTS; gy += cell) {
      for (var gx = 0; gx < w && pts.length < MAXPTS; gx += cell) {
        var best = -1, bx = 0, by = 0;
        var y1 = Math.min(h - 1, gy + cell), x1 = Math.min(w - 1, gx + cell);
        for (var y = Math.max(1, gy); y < y1; y++) {
          for (var x = Math.max(1, gx); x < x1; x++) {
            var i = y * w + x;
            if (visited[i] || (mask && !mask[i])) continue;
            if (G[i] > best) { best = G[i]; bx = x; by = y; }
          }
        }
        if (best < contrastT) continue;
        var a = gradAngle(bx, by) + Math.PI / 2;   // tangent of the edge
        // seed exactly on the ridge — jittering off it kills the chain
        var sx = bx, sy = by;
        visited[sy * w + sx] = 1;
        pts.push({ x: sx, y: sy });
        walk(sx, sy, Math.cos(a), Math.sin(a));
        walk(sx, sy, -Math.cos(a), -Math.sin(a));
      }
    }
    return pts;
  }

  /**
   * Detect sparkle centres.
   * @param {ImageData|{data,width,height}} img  working RGBA buffer
   * @param {Object} opts  mode, lumaThreshold, contrastThreshold, lumaWeight,
   *   edgeWeight, density(0..1, legacy) OR spacing(px), count/maxPoints,
   *   jitter(0..1), trace(bool), seed, mask (Uint8Array w*h) or null,
   *   sampleRadius
   * @returns {Array<{nx,ny,size,color,score}>}
   */
  function detect(img, opts) {
    opts = opts || {};
    var data = img.data, w = img.width, h = img.height;
    var mode = opts.mode || 'both';
    var lumaT = opts.lumaThreshold != null ? opts.lumaThreshold : 150;
    var contrastT = opts.contrastThreshold != null ? opts.contrastThreshold : 60;
    var lumaW = opts.lumaWeight != null ? opts.lumaWeight : 0.75;
    var edgeW = opts.edgeWeight != null ? opts.edgeWeight : 0.6;
    var maxPoints = Math.min(3000, opts.count || opts.maxPoints || 700);
    var mask = opts.mask || null;
    var sampleRadius = opts.sampleRadius || 2;
    var jitter = U.clamp(opts.jitter != null ? opts.jitter : 0.35, 0, 1);
    var rng = U.mulberry32(U.hashSeed('detect|' + (opts.seed != null ? opts.seed : 1234)));

    // ---- scatter: the image doesn't matter, rain sparkles everywhere ----
    if (mode === 'scatter') {
      var out = [];
      for (var n = 0; n < maxPoints; n++) {
        var sx = (rng() * w) | 0, sy = (rng() * h) | 0;
        if (mask && !mask[sy * w + sx]) { n--; if (n < -maxPoints) break; continue; }
        out.push({
          nx: (sx + 0.5) / w, ny: (sy + 0.5) / h,
          size: 0.3 + rng() * 0.5,
          color: sampleColor(data, w, h, sx, sy, sampleRadius),
          score: rng()
        });
      }
      return out;
    }

    var L = lumaField(data, w, h);
    var G = gradField(L, w, h);

    // spacing: explicit px wins; otherwise legacy density (finer grid = more)
    var cell = opts.spacing != null
      ? Math.max(4, Math.round(opts.spacing))
      : Math.max(6, Math.round(U.lerp(40, 9, U.clamp(opts.density != null ? opts.density : 0.5, 0, 1))));
    var cap = Math.round(cell * 1.6); // blob-extent search cap

    var centers = [];
    // grid detection is skipped in pure traced-edges mode
    if (!(mode === 'edges' && opts.trace)) {
      for (var gy = 0; gy < h; gy += cell) {
        for (var gx = 0; gx < w; gx += cell) {
          var bestScore = 0, bx = -1, by = -1;
          var y1 = Math.min(h, gy + cell), x1 = Math.min(w, gx + cell);
          for (var y = gy; y < y1; y++) {
            for (var x = gx; x < x1; x++) {
              var i = y * w + x;
              if (mask && !mask[i]) continue;
              var lu = L[i], gr = G[i];
              if (!passes(mode, lu, gr, lumaT, contrastT)) continue;
              var score = scoreOf(mode, lu, gr, lumaW, edgeW);
              if (score > bestScore) { bestScore = score; bx = x; by = y; }
            }
          }
          if (bx < 0) continue;
          var rad = blobRadius(L, w, h, bx, by, cap);
          centers.push({
            nx: (bx + 0.5) / w,
            ny: (by + 0.5) / h,
            size: U.clamp(0.28 + rad / cap, 0.28, 1),
            color: sampleColor(data, w, h, bx, by, sampleRadius),
            score: bestScore
          });
        }
      }
    }

    // ---- edge tracing: chains of sparkles along lines/contours ----
    if (opts.trace && (mode === 'edges' || mode === 'both')) {
      var chain = traceEdges(L, G, w, h, Math.max(8, contrastT), cell, mask, rng);
      for (var c = 0; c < chain.length; c++) {
        var p = chain[c];
        centers.push({
          nx: (p.x + 0.5) / w,
          ny: (p.y + 0.5) / h,
          size: 0.3 + rng() * 0.25,
          color: sampleColor(data, w, h, p.x, p.y, sampleRadius),
          score: 0.55   // mid-rank: survives the count cap, doesn't outrank heroes
        });
      }
    }

    // organic scatter: nudge points off the grid
    if (jitter > 0) {
      for (var j = 0; j < centers.length; j++) {
        var pt = centers[j];
        pt.nx = U.clamp(pt.nx + (rng() - 0.5) * jitter * (cell / w), 0, 1);
        pt.ny = U.clamp(pt.ny + (rng() - 0.5) * jitter * (cell / h), 0, 1);
      }
    }

    centers.sort(function (a, b) { return b.score - a.score; });
    if (centers.length > maxPoints) centers.length = maxPoints;
    return centers;
  }

  // Adaptive wrapper: relax thresholds until at least `want` points appear.
  // Guarantees "Sparkle it" produces something even on flat/dark images.
  function detectAdaptive(img, opts, want) {
    want = want || 24;
    var o = {};
    for (var k in opts) o[k] = opts[k];
    var res = detect(img, o);
    if (o.mode === 'scatter') return res;   // thresholds are meaningless there
    var tries = 0;
    while (res.length < want && tries < 4) {
      o.lumaThreshold = Math.max(20, (o.lumaThreshold || 150) - 40);
      o.contrastThreshold = Math.max(10, (o.contrastThreshold || 60) - 20);
      res = detect(img, o);
      tries++;
    }
    return res;
  }

  SB.analyze = { detect: detect, detectAdaptive: detectAdaptive, lumaField: lumaField, gradField: gradField };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
