/* Sparkle Bitch — analyze.js
 * Highlight / feature detection (the "Selection Marker" behaviour).
 * Finds bright, high-contrast points, reduces clusters to well-spaced
 * centres, and samples local colour + size for each — so sparkles match the
 * position, size and colour of features in the photo, exactly like Glitterboo.
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

  /**
   * Detect sparkle centres.
   * @param {ImageData|{data,width,height}} img  working RGBA buffer
   * @param {Object} opts  lumaThreshold, contrastThreshold, density(0..1),
   *   maxPoints, mask (Uint8Array w*h, >0 = allowed) or null, sampleRadius
   * @returns {Array<{nx,ny,size,color,score}>}
   */
  function detect(img, opts) {
    opts = opts || {};
    var data = img.data, w = img.width, h = img.height;
    var lumaT = opts.lumaThreshold != null ? opts.lumaThreshold : 150;
    var contrastT = opts.contrastThreshold != null ? opts.contrastThreshold : 60;
    var density = U.clamp(opts.density != null ? opts.density : 0.5, 0, 1);
    var maxPoints = opts.maxPoints || 700;
    var mask = opts.mask || null;
    var sampleRadius = opts.sampleRadius || 2;

    var L = lumaField(data, w, h);
    var G = gradField(L, w, h);

    // Denser setting -> finer grid -> more (closer) sparkles.
    var cell = Math.max(6, Math.round(U.lerp(40, 9, density)));
    var cap = Math.round(cell * 1.6); // blob-extent search cap

    var centers = [];
    for (var gy = 0; gy < h; gy += cell) {
      for (var gx = 0; gx < w; gx += cell) {
        var bestScore = 0, bx = -1, by = -1;
        var y1 = Math.min(h, gy + cell), x1 = Math.min(w, gx + cell);
        for (var y = gy; y < y1; y++) {
          for (var x = gx; x < x1; x++) {
            var i = y * w + x;
            if (mask && !mask[i]) continue;
            var lu = L[i], gr = G[i];
            if (lu < lumaT && gr < contrastT) continue;
            // Interest: reward brightness, add contrast for sparkly edges.
            var score = (lu / 255) * 0.75 + Math.min(1, gr / 255) * 0.6;
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
    var tries = 0;
    while (res.length < want && tries < 4) {
      o.lumaThreshold = Math.max(20, (o.lumaThreshold || 150) - 40);
      o.contrastThreshold = Math.max(10, (o.contrastThreshold || 60) - 20);
      res = detect(img, o);
      tries++;
    }
    return res;
  }

  SB.analyze = { detect: detect, detectAdaptive: detectAdaptive, lumaField: lumaField };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
