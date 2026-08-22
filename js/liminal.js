/* Sparkle Bitch — liminal.js
 * The Liminal Engine: a second render path that degrades reality instead of
 * decorating it. CRT scanlines, drifting DVD moiré, film grain, chromatic
 * aberration, sodium-vapor grades, diffusion bloom, starbursts on real light
 * sources, anamorphic streaks, vignette, rounded frame, breathing zoom.
 *
 * Same rules as the sparkle side: every animated quantity is a pure function
 * of phase01 with integer cycles, so exported GIFs never snap at the seam.
 * Pixel-level effects work on any {data,width,height} (Node-testable);
 * canvas overlays run in the browser only.
 */
(function (global) {
  'use strict';
  var SB = global.SB = global.SB || {};
  var A = SB.anim;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ------------------------------------------------------------------ params
  function defaults() {
    return {
      preset: '',
      breathingZoom: { enabled: false, amount: 1.0 },
      scanlines: { enabled: false, density: 0.5, rgbOffset: false },
      moire: { enabled: false, opacity: 0.1, drift: true },
      chromaticAberration: { enabled: false, amount: 3, mode: 'edge' },
      grain: { enabled: false, amount: 0.15, animated: true },
      vignette: { enabled: false, strength: 0.4, color: '#000000' },
      starbursts: { enabled: false, threshold: 200, intensity: 1.0 },
      anamorphic: { enabled: false, length: 0.2, intensity: 1.0 },
      roundedFrame: { enabled: false, radius: 40 },
      prismatic: { enabled: false, strength: 0.3 },
      diffusion: { enabled: false, amount: 0.3, radius: 12 },
      colorGrade: { enabled: false, liftBlack: 0, sodium: 0, prismShift: false }
    };
  }

  function deepMerge(target, source) {
    for (var k in source) {
      if (!source.hasOwnProperty(k)) continue;
      var sv = source[k];
      if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
        if (!target[k] || typeof target[k] !== 'object') target[k] = {};
        deepMerge(target[k], sv);
      } else target[k] = sv;
    }
    return target;
  }

  // ---- vibe presets: one click = a whole stack ---------------------------
  var PRESETS = {
    'crt': {
      label: '📺 CRT House',
      scanlines: { enabled: true, density: 0.6, rgbOffset: true },
      moire: { enabled: true, opacity: 0.12, drift: true },
      chromaticAberration: { enabled: true, amount: 5, mode: 'fullFrame' },
      grain: { enabled: true, amount: 0.18, animated: true },
      vignette: { enabled: true, strength: 0.45, color: '#000000' },
      starbursts: { enabled: true, threshold: 190, intensity: 1.1 },
      roundedFrame: { enabled: true, radius: 45 },
      colorGrade: { enabled: true, liftBlack: 0.05, sodium: 0.25, prismShift: false },
      breathingZoom: { enabled: true, amount: 1.0 }
    },
    'prismatic': {
      label: '🌈 Prismatic Street',
      chromaticAberration: { enabled: true, amount: 8, mode: 'edge' },
      grain: { enabled: true, amount: 0.08, animated: false },
      vignette: { enabled: true, strength: 0.2, color: '#000022' },
      starbursts: { enabled: true, threshold: 180, intensity: 0.9 },
      anamorphic: { enabled: true, length: 0.25, intensity: 1.2 },
      prismatic: { enabled: true, strength: 0.4 },
      colorGrade: { enabled: true, liftBlack: 0, sodium: 0, prismShift: true },
      breathingZoom: { enabled: true, amount: 0.5 },
      diffusion: { enabled: true, amount: 0.2, radius: 10 }
    },
    '3am': {
      label: '🌃 3 AM Sidewalk',
      moire: { enabled: true, opacity: 0.08, drift: true },
      chromaticAberration: { enabled: true, amount: 3, mode: 'edge' },
      grain: { enabled: true, amount: 0.12, animated: true },
      vignette: { enabled: true, strength: 0.6, color: '#000011' },
      starbursts: { enabled: true, threshold: 210, intensity: 0.7 },
      colorGrade: { enabled: true, liftBlack: 0.08, sodium: 0.4, prismShift: false },
      diffusion: { enabled: true, amount: 0.35, radius: 14 },
      breathingZoom: { enabled: true, amount: 0.8 }
    },
    'vaseline': {
      label: '🕯️ Vaseline Dream',
      diffusion: { enabled: true, amount: 0.55, radius: 18 },
      grain: { enabled: true, amount: 0.1, animated: false },
      vignette: { enabled: true, strength: 0.35, color: '#1a0a14' },
      colorGrade: { enabled: true, liftBlack: 0.12, sodium: 0.15, prismShift: false },
      breathingZoom: { enabled: true, amount: 0.6 }
    },
    'polaroid': {
      label: '📸 Faded Polaroid',
      grain: { enabled: true, amount: 0.14, animated: false },
      vignette: { enabled: true, strength: 0.5, color: '#2e1a0a' },
      colorGrade: { enabled: true, liftBlack: 0.22, sodium: 0.2, prismShift: false },
      roundedFrame: { enabled: true, radius: 18 },
      diffusion: { enabled: true, amount: 0.18, radius: 8 }
    }
  };

  function preset(id) {
    var p = defaults();
    if (PRESETS[id]) { p.preset = id; deepMerge(p, PRESETS[id]); }
    return p;
  }
  function presetList() {
    var out = [];
    for (var k in PRESETS) if (PRESETS.hasOwnProperty(k)) out.push({ id: k, label: PRESETS[k].label });
    return out;
  }

  // ------------------------------------------------- loop-safe motion helpers
  // Overscan breathing zoom: scale stays >= 1 so no bare edges, and closes.
  function breathScale(phase01, amount) {
    return 1 + A.loopPing(phase01, 1) * 0.04 * (amount == null ? 1 : amount);
  }
  // DVD moiré drift: exactly one grid period (3px) per loop -> wraps seamlessly.
  var MOIRE_PERIOD = 3;
  function moireDrift(phase01) { return phase01 * MOIRE_PERIOD; }
  // RGB scanline offset steps 0,1,2 and lands back on 0 at the seam.
  function scanOffset(phase01) { return Math.round(phase01 * 3) % 3; }

  // ------------------------------------------------------- pixel-level effects
  function newImageData(w, h) {
    if (typeof ImageData !== 'undefined') return new ImageData(w, h);
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; // Node
  }

  // RGB channel splitting. 'edge' scales the shift with distance from centre
  // (cheap-lens look); 'fullFrame' smears everywhere (dead-format look).
  function chromaticAberration(imgData, amount, mode) {
    var w = imgData.width, h = imgData.height, d = imgData.data;
    var out = newImageData(w, h), o = out.data;
    var cx = w / 2, cy = h / 2;
    var maxDist = Math.sqrt(cx * cx + cy * cy) || 1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        var shift = amount;
        if (mode === 'edge') {
          var dx = x - cx, dy = y - cy;
          shift = Math.round(amount * (Math.sqrt(dx * dx + dy * dy) / maxDist));
        }
        var rX = clamp(x - shift, 0, w - 1), bX = clamp(x + shift, 0, w - 1);
        var rI = (y * w + rX) * 4, bI = (y * w + bX) * 4;
        o[i] = d[rI]; o[i + 1] = d[i + 1]; o[i + 2] = d[bI + 2]; o[i + 3] = d[i + 3];
      }
    }
    return out;
  }

  // liftBlack: raise shadows toward grey (faded film).
  // sodium: crush shadows to blue, push mids amber (streetlight nostalgia).
  // prismShift: rotate the whole spectrum by luminance (diffraction haze).
  function colorGrade(imgData, params) {
    var d = imgData.data;
    var liftBlack = params.liftBlack || 0, sodium = params.sodium || 0;
    for (var i = 0; i < d.length; i += 4) {
      var r = d[i], g = d[i + 1], b = d[i + 2];
      if (liftBlack) { r += liftBlack * 40; g += liftBlack * 40; b += liftBlack * 40; }
      if (sodium) {
        var avg = (r + g + b) / 3;
        if (avg < 80) { r *= (1 - sodium * 0.3); g *= (1 - sodium * 0.1); b += sodium * 30; }
        else { r += sodium * 20; g += sodium * 10; b -= sodium * 15; }
      }
      if (params.prismShift) {
        var shift = ((r + g + b) / 765) * 20;
        r += shift; b -= shift;
      }
      d[i] = clamp(r, 0, 255); d[i + 1] = clamp(g, 0, 255); d[i + 2] = clamp(b, 0, 255);
    }
    return imgData;
  }

  // Find local-brightness maxima on a coarse grid — the real light sources.
  function findBrightSpots(imgData, threshold, minDist) {
    var w = imgData.width, h = imgData.height, d = imgData.data;
    var spots = [];
    for (var y = 8; y < h; y += 16) {
      for (var x = 8; x < w; x += 16) {
        var i = (y * w + x) * 4;
        var b = (d[i] + d[i + 1] + d[i + 2]) / 3;
        if (b <= threshold) continue;
        var isMax = true;
        for (var dy = -4; dy <= 4 && isMax; dy += 4) {
          for (var dx = -4; dx <= 4 && isMax; dx += 4) {
            if (!dx && !dy) continue;
            var xx = clamp(x + dx, 0, w - 1), yy = clamp(y + dy, 0, h - 1);
            var j = (yy * w + xx) * 4;
            if ((d[j] + d[j + 1] + d[j + 2]) / 3 > b) isMax = false;
          }
        }
        if (!isMax) continue;
        var tooClose = false;
        for (var s = 0; s < spots.length; s++) {
          var sx = spots[s].x - x, sy = spots[s].y - y;
          if (Math.sqrt(sx * sx + sy * sy) < minDist) { tooClose = true; break; }
        }
        if (!tooClose) spots.push({ x: x, y: y, brightness: b });
      }
    }
    return spots;
  }

  // ---------------------------------------------------------- canvas overlays
  function createCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') {
      try { return new OffscreenCanvas(w, h); } catch (e) {}
    }
    var c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }

  var _fx = null, _tile = null;
  function fxLayer(w, h) {
    if (!_fx || _fx.width !== w || _fx.height !== h) _fx = createCanvas(w, h);
    return _fx;
  }
  function tileLayer(s) {
    if (!_tile || _tile.width !== s) _tile = createCanvas(s, s);
    return _tile;
  }

  // Vaseline bloom: screen-blend a blurred copy of the frame back over itself.
  function diffusion(ctx, w, h, amount, radius) {
    var c = fxLayer(w, h), x = c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 1; x.clearRect(0, 0, w, h);
    x.filter = 'blur(' + radius + 'px)';
    x.drawImage(ctx.canvas, 0, 0);
    x.filter = 'none';
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = clamp(amount, 0, 1);
    ctx.drawImage(c, 0, 0);
    ctx.restore();
  }

  function scanlines(ctx, w, h, params, phase01) {
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = 'rgba(0,0,0,' + (params.density * 0.6).toFixed(3) + ')';
    for (var y = 0; y < h; y += 2) ctx.fillRect(0, y, w, 1);
    if (params.rgbOffset) {
      var off = scanOffset(phase01);
      ctx.globalCompositeOperation = 'screen';
      var cols = ['255,0,0', '0,255,0', '0,0,255'];
      for (var ch = 0; ch < 3; ch++) {
        ctx.fillStyle = 'rgba(' + cols[ch] + ',0.04)';
        for (var yy = off + ch; yy < h; yy += 3) ctx.fillRect(0, yy, w, 1);
      }
    }
    ctx.restore();
  }

  // The DVD overlay: a fine 3px grid drifting exactly one period per loop.
  var _moireCache = {};
  function moirePattern(w, h) {
    var key = w + 'x' + h;
    if (_moireCache[key]) return _moireCache[key];
    if (Object.keys(_moireCache).length > 8) _moireCache = {};
    var c = createCanvas(w + MOIRE_PERIOD * 2, h + MOIRE_PERIOD * 2);
    var x = c.getContext('2d');
    x.strokeStyle = 'rgba(255,255,255,0.06)'; x.lineWidth = 1;
    for (var y = 0; y < c.height; y += MOIRE_PERIOD) { x.beginPath(); x.moveTo(0, y + 0.5); x.lineTo(c.width, y + 0.5); x.stroke(); }
    for (var i = 0; i < c.width; i += MOIRE_PERIOD) { x.beginPath(); x.moveTo(i + 0.5, 0); x.lineTo(i + 0.5, c.height); x.stroke(); }
    _moireCache[key] = c;
    return c;
  }
  function moire(ctx, w, h, params, phase01) {
    var drift = params.drift === false ? 0 : moireDrift(phase01);
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = clamp(params.opacity, 0, 1);
    ctx.drawImage(moirePattern(w, h), -drift, -drift);
    ctx.restore();
  }

  // Animated film grain from a small re-seeded tile (cheap at 60fps).
  function grain(ctx, w, h, params, phase01, seed) {
    var TS = 160;
    var tile = tileLayer(TS), tx = tile.getContext('2d');
    var img = tx.createImageData(TS, TS), d = img.data;
    // pure function of phase -> deterministic frames; static grain = one seed
    var s = (((seed || 1) + (params.animated ? Math.round(phase01 * 4096) : 0)) * 16807) % 2147483647;
    if (s <= 0) s += 2147483646;
    var amp = params.amount * 255;
    for (var i = 0; i < d.length; i += 4) {
      s = (s * 16807) % 2147483647;
      var v = (s / 2147483647 - 0.5) * amp;
      d[i] = d[i + 1] = d[i + 2] = clamp(128 + v, 0, 255); d[i + 3] = 255;
    }
    tx.putImageData(img, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.imageSmoothingEnabled = false;
    var pat = ctx.createPattern(tile, 'repeat');
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function hexA(hex, a) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 'rgba(0,0,0,' + a + ')';
    var n = parseInt(m[1], 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + clamp(a, 0, 1).toFixed(3) + ')';
  }

  // darkened/tinted edges — transparent centre bleeding to colour at the rim
  function vignette(ctx, w, h, params) {
    var grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, hexA(params.color, params.strength));
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function prismatic(ctx, w, h, params) {
    var grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, 'rgba(255,0,0,0.08)');
    grad.addColorStop(0.2, 'rgba(255,255,0,0.08)');
    grad.addColorStop(0.4, 'rgba(0,255,0,0.08)');
    grad.addColorStop(0.6, 'rgba(0,255,255,0.08)');
    grad.addColorStop(0.8, 'rgba(0,0,255,0.08)');
    grad.addColorStop(1, 'rgba(255,0,255,0.08)');
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = clamp(params.strength, 0, 1);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // Cross-screen flares on the real light sources, twinkling loop-safely.
  function starbursts(ctx, w, h, imgData, params, phase01, still) {
    var spots = findBrightSpots(imgData, params.threshold, 40);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (var k = 0; k < spots.length; k++) {
      var s = spots[k];
      var tw = still ? 1 : 0.75 + 0.25 * A.loopSin(phase01, 1, (s.x * 0.7 + s.y * 1.3) % 6.2832, 2);
      var size = (s.brightness / 255) * 25 * params.intensity * tw;
      if (size < 2) continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.strokeStyle = 'rgba(255,255,230,0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-size, 0); ctx.lineTo(size, 0);
      ctx.moveTo(0, -size); ctx.lineTo(0, size);
      var dd = size * 0.6;
      ctx.moveTo(-dd, -dd); ctx.lineTo(dd, dd);
      ctx.moveTo(-dd, dd); ctx.lineTo(dd, -dd);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.25, 0, 6.2832);
      ctx.fillStyle = 'rgba(255,255,220,0.5)';
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function anamorphic(ctx, w, h, imgData, params) {
    var spots = findBrightSpots(imgData, 200, 60);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (var k = 0; k < spots.length; k++) {
      var s = spots[k];
      var l = params.length * w * (s.brightness / 255);
      if (l < 4) continue;
      var grad = ctx.createLinearGradient(s.x - l, s.y, s.x + l, s.y);
      grad.addColorStop(0, 'rgba(100,200,255,0)');
      grad.addColorStop(0.5, 'rgba(100,200,255,' + (0.25 * params.intensity).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(100,200,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(s.x - l, s.y - 1, l * 2, 2);
    }
    ctx.restore();
  }

  function roundedFrame(ctx, w, h, params) {
    var r = clamp(params.radius, 0, Math.min(w, h) / 2);
    if (r <= 0) return;
    var c = fxLayer(w, h), x = c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, w, h);
    x.fillStyle = '#000';
    x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'destination-out';
    x.beginPath();
    x.moveTo(r, 0);
    x.lineTo(w - r, 0); x.quadraticCurveTo(w, 0, w, r);
    x.lineTo(w, h - r); x.quadraticCurveTo(w, h, w - r, h);
    x.lineTo(r, h); x.quadraticCurveTo(0, h, 0, h - r);
    x.lineTo(0, r); x.quadraticCurveTo(0, 0, r, 0);
    x.fill();
    ctx.drawImage(c, 0, 0);
  }

  // ------------------------------------------------------------- the stack
  /**
   * Composite one liminal frame.
   * @param ctx    destination 2d context (already sized)
   * @param base   drawable (canvas/image/video frame)
   * @param p      liminal params (see defaults())
   * @param phase01 loop position in [0,1)
   * @param still  true for PNG export (no per-frame motion)
   * @param matte  background colour behind the base (letterboxing etc.)
   */
  function render(ctx, base, p, phase01, still, matte, seed) {
    var W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.clearRect(0, 0, W, H);
    if (matte) { ctx.fillStyle = matte; ctx.fillRect(0, 0, W, H); }

    // 1. base, with overscan breathing zoom
    if (base) {
      if (p.breathingZoom.enabled && !still) {
        var sc = breathScale(phase01, p.breathingZoom.amount);
        var bw = W * sc, bh = H * sc;
        ctx.drawImage(base, (W - bw) / 2, (H - bh) / 2, bw, bh);
      } else {
        ctx.drawImage(base, 0, 0, W, H);
      }
    }

    // 2. pixel-level effects (skip the ImageData round-trip when both are off)
    if (p.chromaticAberration.enabled || p.colorGrade.enabled) {
      var imgData = ctx.getImageData(0, 0, W, H);
      if (p.chromaticAberration.enabled) {
        imgData = chromaticAberration(imgData, p.chromaticAberration.amount, p.chromaticAberration.mode);
      }
      if (p.colorGrade.enabled) imgData = colorGrade(imgData, p.colorGrade);
      ctx.putImageData(imgData, 0, 0);
    }

    // 3. diffusion bloom
    if (p.diffusion.enabled) diffusion(ctx, W, H, p.diffusion.amount, p.diffusion.radius);

    // 4. texture overlays
    if (p.scanlines.enabled) scanlines(ctx, W, H, p.scanlines, phase01);
    if (p.moire.enabled) moire(ctx, W, H, p.moire, phase01);
    if (p.grain.enabled) grain(ctx, W, H, p.grain, phase01, seed || 1);
    if (p.prismatic.enabled) prismatic(ctx, W, H, p.prismatic);
    if (p.vignette.enabled) vignette(ctx, W, H, p.vignette);

    // 5. light-source overlays (detect on the graded frame)
    if (p.starbursts.enabled || p.anamorphic.enabled) {
      var fresh = ctx.getImageData(0, 0, W, H);
      if (p.starbursts.enabled) starbursts(ctx, W, H, fresh, p.starbursts, phase01, still);
      if (p.anamorphic.enabled) anamorphic(ctx, W, H, fresh, p.anamorphic);
    }

    // 6. frame
    if (p.roundedFrame.enabled) roundedFrame(ctx, W, H, p.roundedFrame);
  }

  SB.liminal = {
    render: render,
    defaults: defaults,
    preset: preset,
    presetList: presetList,
    PRESETS: PRESETS,
    breathScale: breathScale,
    moireDrift: moireDrift,
    scanOffset: scanOffset,
    chromaticAberration: chromaticAberration,
    colorGrade: colorGrade,
    findBrightSpots: findBrightSpots
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
