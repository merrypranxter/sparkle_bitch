/* Sparkle Bitch — finishes.js
 * The shiny-text FINISH engine: a pluggable registry of reflective / iridescent
 * / refractive surface effects that fill a letter (or outline) mask, and a
 * compositor that STACKS them — Liquid Chrome + CD Diffraction + Starburst Glare
 * + Chromatic Ghosting = a hostile reflective life-form.
 *
 * A finish is register(id, { label, category, blend, params, draw(fx) }).
 *   blend: 'base' (source-over) | 'over' (screen) | 'add' (lighter)
 *   draw(fx): paint a full W×H rect into fx.ctx; the framework clips it to the
 *             letter mask (unless selfMask) and composites it at blend + alpha.
 *   fx = { ctx, w, h, mask, phase01, still, p(params), seed, U, A, GL, SPK,
 *          shade, field }
 *
 * Loop-safe by construction: every animated quantity is a function of phase01
 * with INTEGER revolutions, so the value at phase 0 equals phase 1 and exported
 * GIFs never snap. The heavy per-pixel finishes render at a capped resolution
 * (smooth gradients upscale fine) so stacking stays fast in the live preview.
 */
(function (global) {
  'use strict';
  var SB = global.SB = global.SB || {};
  var U = SB.util, A = SB.anim;
  var TAU = Math.PI * 2;

  function createCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') { try { return new OffscreenCanvas(w, h); } catch (e) {} }
    var c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }

  // ---- shared: capped-resolution per-pixel shader -----------------------
  // fn(nx, ny, phase01) -> [r,g,b] or [r,g,b,a]. Returns a canvas of size sw×sh
  // (a reduced copy of w×h); the caller upscales it into the finish layer.
  var _sbuf = {};
  function shade(w, h, cap, phase01, fn) {
    cap = cap || 340;
    var scale = Math.min(1, cap / Math.max(w, h));
    var sw = Math.max(1, Math.round(w * scale)), sh = Math.max(1, Math.round(h * scale));
    var key = sw + 'x' + sh;
    var b = _sbuf[key];
    if (!b) { var cv = createCanvas(sw, sh); b = _sbuf[key] = { cv: cv, cx: cv.getContext('2d'), img: cv.getContext('2d').createImageData(sw, sh) }; }
    var d = b.img.data, i = 0, c;
    for (var y = 0; y < sh; y++) {
      var ny = (y + 0.5) / sh;
      for (var x = 0; x < sw; x++) {
        c = fn((x + 0.5) / sw, ny, phase01);
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3] == null ? 255 : c[3]; i += 4;
      }
    }
    b.cx.putImageData(b.img, 0, 0);
    return b.cv;
  }

  // ---- shared: seeded point field (reuses the glitter flake scatter) -----
  var _ff = {};
  function field(w, h, density, seed) {
    var key = w + '|' + h + '|' + density + '|' + seed;
    if (!_ff[key]) { if (Object.keys(_ff).length > 40) _ff = {}; _ff[key] = SB.glitter.buildField(w, h, 'silver', density, seed, 1); }
    return _ff[key];
  }

  // ---- registry ----------------------------------------------------------
  var REG = {}, ORDER = [];
  function register(id, def) { def.id = id; REG[id] = def; if (ORDER.indexOf(id) < 0) ORDER.push(id); return def; }
  function get(id) { return REG[id]; }
  function has(id) { return !!REG[id]; }
  function list() { return ORDER.map(function (id) { return { id: id, label: REG[id].label, category: REG[id].category || 'Other' }; }); }
  // default params object for a finish id
  function defaults(id) {
    var def = REG[id], out = {};
    if (def && def.params) def.params.forEach(function (pr) { out[pr.key] = pr.def; });
    return out;
  }
  function blendOp(b) { return b === 'add' ? 'lighter' : b === 'over' ? 'screen' : 'source-over'; }

  // ---- the compositor: stack finishes into a mask ------------------------
  var _fl = null;
  function finishLayer(w, h) { if (!_fl || _fl.width !== w || _fl.height !== h) _fl = createCanvas(w, h); return _fl; }

  // stack = [ { type, params, alpha? }, … ] (bottom -> top)
  function renderStack(ctx, stack, mask, phase01, still, seed) {
    if (!stack || !stack.length) return;
    var W = ctx.canvas.width, H = ctx.canvas.height;
    for (var i = 0; i < stack.length; i++) {
      var item = stack[i]; var def = REG[item.type]; if (!def) continue;
      var lay = finishLayer(W, H), lc = lay.getContext('2d');
      lc.setTransform(1, 0, 0, 1, 0, 0); lc.globalCompositeOperation = 'source-over'; lc.globalAlpha = 1; lc.filter = 'none'; lc.clearRect(0, 0, W, H);
      var p = item.params || defaults(item.type);
      def.draw({ ctx: lc, w: W, h: H, mask: mask, phase01: phase01, still: still, p: p, seed: (seed || 1234) + i * 911, U: U, A: A, GL: SB.glitter, SPK: SB.sparkles, shade: shade, field: field });
      if (!def.selfMask) { lc.globalCompositeOperation = 'destination-in'; lc.drawImage(mask, 0, 0, W, H); }
      ctx.save();
      ctx.globalAlpha = U.clamp(item.alpha != null ? item.alpha : 1, 0, 1);
      ctx.globalCompositeOperation = blendOp(item.blend || def.blend);   // per-item override
      ctx.drawImage(lay, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function css(rgb, a) { return 'rgba(' + (rgb[0] | 0) + ',' + (rgb[1] | 0) + ',' + (rgb[2] | 0) + ',' + (a == null ? 1 : a) + ')'; }
  function hx(hex) { return U.hexToRgb(hex); }

  // =======================================================================
  //  BASIC finishes (so a stack can also hold solid colour / glitter)
  // =======================================================================
  register('solid', {
    label: 'Solid colour', category: 'Basic', blend: 'base',
    params: [{ key: 'color', type: 'color', def: '#ff5fd2', label: 'Colour' }],
    draw: function (fx) { fx.ctx.fillStyle = fx.p.color || '#ff5fd2'; fx.ctx.fillRect(0, 0, fx.w, fx.h); }
  });
  register('glitter', {
    label: 'Glitter', category: 'Basic', blend: 'base',
    params: [
      { key: 'style', type: 'glitterStyle', def: 'silver', label: 'Style' },
      { key: 'density', type: 'range', def: 0.7, min: 0.1, max: 2, step: 0.05, label: 'Density' },
      { key: 'grain', type: 'range', def: 1, min: 0.2, max: 2, step: 0.05, label: 'Grain' }
    ],
    draw: function (fx) {
      var f = fx.GL.buildField(fx.w, fx.h, fx.p.style || 'silver', fx.p.density != null ? fx.p.density : 0.7, fx.seed, fx.p.grain != null ? fx.p.grain : 1);
      fx.GL.drawGlitter(fx.ctx, f, fx.phase01, { w: fx.w, h: fx.h, base: true, still: fx.still });
    }
  });

  // =======================================================================
  //  IRIDESCENT surface shaders  (Merry's picks, plus foundations)
  // =======================================================================

  // Holographic Menace — rainbow bands slide across the letters as the "angle"
  // rolls. Diagonal spectral gradient + a travelling metallic sheen.
  register('holographic', {
    label: 'Holographic Menace', category: 'Iridescent', blend: 'base',
    params: [{ key: 'bands', type: 'range', def: 3, min: 1, max: 8, step: 1, label: 'Bands' },
             { key: 'sheen', type: 'range', def: 0.6, min: 0, max: 1, step: 0.05, label: 'Sheen' }],
    draw: function (fx) {
      var bands = Math.max(1, Math.round(fx.p.bands || 3)), sheen = fx.p.sheen != null ? fx.p.sheen : 0.6;
      var buf = fx.shade(fx.w, fx.h, 360, fx.phase01, function (nx, ny, ph) {
        var hue = ((nx * 0.85 + ny * 0.5) * bands + ph) % 1;
        var band = 0.5 + 0.5 * Math.sin((nx - ny) * bands * TAU + ph * TAU);
        var li = 0.5 + 0.16 * band;
        var rgb = fx.U.hslToRgb(hue * 360, 0.95, li);
        var s = sheen * Math.pow(band, 6);            // sharp travelling highlight
        return [rgb[0] + (255 - rgb[0]) * s, rgb[1] + (255 - rgb[1]) * s, rgb[2] + (255 - rgb[2]) * s];
      });
      fx.ctx.drawImage(buf, 0, 0, fx.w, fx.h);
    }
  });

  // Oil-Slick Slut — liquid pools of magenta/cyan/violet/green crawling over a
  // near-black film. Thin-film interference driven by a slow turbulent field.
  register('oilslick', {
    label: 'Oil-Slick Slut', category: 'Iridescent', blend: 'base',
    params: [{ key: 'swirl', type: 'range', def: 0.5, min: 0.1, max: 1, step: 0.05, label: 'Swirl' }],
    draw: function (fx) {
      var sw = 4 + (fx.p.swirl != null ? fx.p.swirl : 0.5) * 6;
      var buf = fx.shade(fx.w, fx.h, 360, fx.phase01, function (nx, ny, ph) {
        var f = Math.sin(nx * sw + Math.sin(ny * sw * 0.7 + ph * TAU) * 2 + ph * TAU)
              + Math.sin(ny * sw * 1.3 + Math.cos(nx * sw + ph * TAU) * 2);
        var hue = (f * 0.18 + 0.6 + ph) % 1; if (hue < 0) hue += 1;
        var thin = 0.5 + 0.5 * Math.sin(f * 3.1);   // interference brightness
        var rgb = fx.U.hslToRgb(hue * 360, 0.95, 0.22 + 0.42 * thin);
        return rgb;
      });
      fx.ctx.drawImage(buf, 0, 0, fx.w, fx.h);
    }
  });

  // Radioactive Mother-of-Pearl — milky light striations with subtle, slightly
  // toxic spectral flashes moving through.
  register('pearl', {
    label: 'Radioactive Mother-of-Pearl', category: 'Iridescent', blend: 'base',
    params: [{ key: 'flash', type: 'range', def: 0.5, min: 0, max: 1, step: 0.05, label: 'Flash' }],
    draw: function (fx) {
      var flash = fx.p.flash != null ? fx.p.flash : 0.5;
      var buf = fx.shade(fx.w, fx.h, 340, fx.phase01, function (nx, ny, ph) {
        var stri = Math.sin(ny * 34 + Math.sin(nx * 5) * 2.2 + Math.sin(nx * 13) * 0.6);
        var sh = 200 + 60 * Math.sin(nx * 3 + ny * 2 + ph * TAU) * flash; // hue drifts green<->cyan<->violet
        var rgb = fx.U.hslToRgb(sh, 0.28 + 0.22 * flash, 0.78 + 0.09 * stri);
        var spark = flash * Math.pow(0.5 + 0.5 * Math.sin(stri * 6 + ph * 2 * TAU), 8);
        return [rgb[0] + (255 - rgb[0]) * spark, rgb[1] + (255 - rgb[1]) * spark, rgb[2] + (255 - rgb[2]) * spark];
      });
      fx.ctx.drawImage(buf, 0, 0, fx.w, fx.h);
    }
  });

  // Soap-Bubble Delusion — swirling thin-film interference on a delicate,
  // slightly translucent skin.
  register('soap', {
    label: 'Soap-Bubble Delusion', category: 'Iridescent', blend: 'base',
    params: [{ key: 'rings', type: 'range', def: 4, min: 1, max: 9, step: 1, label: 'Rings' }],
    draw: function (fx) {
      var rings = Math.max(1, Math.round(fx.p.rings || 4));
      var buf = fx.shade(fx.w, fx.h, 360, fx.phase01, function (nx, ny, ph) {
        var cx = nx - 0.5, cy = ny - 0.5;
        var thick = (Math.sqrt(cx * cx + cy * cy) * 2 + 0.3 * Math.sin(nx * 8 + ph * TAU) + 0.3 * Math.cos(ny * 7 - ph * TAU));
        var hue = (thick * rings + ph) % 1; if (hue < 0) hue += 1;
        var rgb = fx.U.hslToRgb(hue * 360, 0.7, 0.62);
        var a = 210 + 45 * Math.sin(thick * rings * TAU);   // filmy translucency
        return [rgb[0], rgb[1], rgb[2], a];
      });
      fx.ctx.drawImage(buf, 0, 0, fx.w, fx.h);
    }
  });

  // Dichroic Glass — transparent jewel text flopping between two colours, with a
  // brightened refractive edge.
  register('dichroic', {
    label: 'Dichroic Glass', category: 'Iridescent', blend: 'base',
    params: [{ key: 'c1', type: 'color', def: '#00e5ff', label: 'Colour A' },
             { key: 'c2', type: 'color', def: '#ff2fd0', label: 'Colour B' }],
    draw: function (fx) {
      var a = hx(fx.p.c1 || '#00e5ff'), b = hx(fx.p.c2 || '#ff2fd0');
      var buf = fx.shade(fx.w, fx.h, 340, fx.phase01, function (nx, ny, ph) {
        var t = 0.5 + 0.5 * Math.sin((nx * 3.5 + ny * 2.5) * TAU / 3 + ph * TAU);
        var edge = Math.pow(0.5 + 0.5 * Math.sin((nx + ny) * 22), 3) * 0.6;
        var r = a[0] + (b[0] - a[0]) * t, g = a[1] + (b[1] - a[1]) * t, bl = a[2] + (b[2] - a[2]) * t;
        return [r + (255 - r) * edge, g + (255 - g) * edge, bl + (255 - bl) * edge, 235];
      });
      fx.ctx.drawImage(buf, 0, 0, fx.w, fx.h);
    }
  });

  // Lisa Frank Plasma — electrically writhing neon colour clouds.
  register('plasma', {
    label: 'Lisa Frank Plasma', category: 'Iridescent', blend: 'base',
    params: [{ key: 'scale', type: 'range', def: 0.5, min: 0.1, max: 1, step: 0.05, label: 'Scale' }],
    draw: function (fx) {
      var s = 6 + (fx.p.scale != null ? fx.p.scale : 0.5) * 10;
      var PAL = [[255, 60, 180], [60, 220, 255], [180, 255, 70], [255, 240, 90], [190, 90, 255]];
      var buf = fx.shade(fx.w, fx.h, 340, fx.phase01, function (nx, ny, ph) {
        var v = Math.sin(nx * s + ph * TAU) + Math.sin(ny * s * 1.2) +
                Math.sin((nx + ny) * s * 0.7 + ph * TAU) + Math.sin(Math.sqrt((nx - 0.5) * (nx - 0.5) + (ny - 0.5) * (ny - 0.5)) * s * 2 - ph * TAU);
        var t = (v + 4) / 8;                       // 0..1
        var f = t * (PAL.length); var i = f | 0, k = f - i;
        var c0 = PAL[i % PAL.length], c1 = PAL[(i + 1) % PAL.length];
        return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
      });
      fx.ctx.drawImage(buf, 0, 0, fx.w, fx.h);
    }
  });

  // =======================================================================
  //  METAL
  // =======================================================================

  // Chrome — mirror-silver ramp (sky/horizon reflection) with a violent
  // highlight. Optional tint gives pink / alien-green / gold chrome.
  function mirrorRamp(fx, tint, highlights, ooze) {
    var g = fx.ctx, w = fx.w, h = fx.h, ph = fx.phase01;
    var grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.00, '#e9edf5'); grad.addColorStop(0.28, '#8a93a8');
    grad.addColorStop(0.50, '#4a5164'); grad.addColorStop(0.52, '#2b3040');
    grad.addColorStop(0.62, '#9aa3b6'); grad.addColorStop(0.80, '#eef2fa');
    grad.addColorStop(1.00, '#7788a0');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    if (tint) { g.globalCompositeOperation = 'overlay'; g.fillStyle = tint; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over'; }
    // travelling specular highlight band(s)
    g.globalCompositeOperation = 'lighter';
    for (var k = 0; k < highlights; k++) {
      var cyc = k + 1;                                 // integer revs -> loop-safe
      var yy = ((ph * cyc + k / highlights) % 1) * h;
      var band = g.createLinearGradient(0, yy - h * 0.12, 0, yy + h * 0.12);
      band.addColorStop(0, 'rgba(255,255,255,0)'); band.addColorStop(0.5, 'rgba(255,255,255,0.85)'); band.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = band;
      if (ooze) { g.save(); g.translate(Math.sin(ph * TAU + k) * w * 0.05, 0); g.fillRect(0, 0, w, h); g.restore(); }
      else g.fillRect(0, 0, w, h);
    }
    g.globalCompositeOperation = 'source-over';
  }
  register('chrome', {
    label: 'Chrome', category: 'Metal', blend: 'base',
    params: [{ key: 'tint', type: 'color', def: '#8a93a8', label: 'Tint' }],
    draw: function (fx) {
      var t = fx.p.tint || '#8a93a8';
      var isSilver = t.toLowerCase() === '#8a93a8';
      mirrorRamp(fx, isSilver ? null : t, 1, false);
    }
  });

  // Liquid Chrome — the same mirror, but multiple highlights OOZE across the
  // letters like molten mercury.
  register('liquidchrome', {
    label: 'Liquid Chrome', category: 'Metal', blend: 'base',
    params: [{ key: 'tint', type: 'color', def: '#8a93a8', label: 'Tint' },
             { key: 'blobs', type: 'range', def: 3, min: 1, max: 6, step: 1, label: 'Streaks' }],
    draw: function (fx) {
      var t = fx.p.tint || '#8a93a8', isSilver = t.toLowerCase() === '#8a93a8';
      mirrorRamp(fx, isSilver ? null : t, Math.max(1, Math.round(fx.p.blobs || 3)), true);
    }
  });

  // =======================================================================
  //  REFRACTION
  // =======================================================================

  // CD-R Rainbow — sharp radial spectral streaks that rotate across the type,
  // like light off a burned disc.
  register('cdrom', {
    label: 'CD-R Rainbow', category: 'Refraction', blend: 'base',
    params: [{ key: 'spokes', type: 'range', def: 6, min: 3, max: 14, step: 1, label: 'Streaks' }],
    draw: function (fx) {
      var g = fx.ctx, w = fx.w, h = fx.h, spokes = Math.max(3, Math.round(fx.p.spokes || 6));
      var buf = fx.shade(w, h, 440, fx.phase01, function (nx, ny, ph) {
        var dx = nx - 0.5, dy = ny - 0.5;
        var ang = Math.atan2(dy, dx) / TAU + 0.5;           // 0..1 around the disc
        var rad = Math.sqrt(dx * dx + dy * dy) * 2;         // 0..~1.4 out
        var hue = ((ang + ph) * spokes + rad * 1.6) % 1; if (hue < 0) hue += 1;
        // sharp radial streaks that rotate (dark grooves between bright spectra)
        var streak = Math.pow(0.5 + 0.5 * Math.sin((ang + ph) * spokes * TAU * 3), 4);
        var rgb = U.hslToRgb(hue * 360, 1, 0.14 + 0.52 * streak);
        return rgb;
      });
      g.drawImage(buf, 0, 0, w, h);
      // a small central hotspot only (no big white wash)
      g.globalCompositeOperation = 'lighter';
      var cx = w / 2, cy = h / 2, rg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.2);
      rg.addColorStop(0, 'rgba(255,255,255,0.32)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
    }
  });

  // =======================================================================
  //  LIQUID
  // =======================================================================

  // Wet Alien Jelly — translucent gummy letters with glossy specular blobs,
  // bubbles and drip highlights.
  register('jelly', {
    label: 'Wet Alien Jelly', category: 'Liquid', blend: 'base',
    params: [{ key: 'color', type: 'color', def: '#39ff9e', label: 'Jelly' },
             { key: 'gloss', type: 'range', def: 0.8, min: 0, max: 1, step: 0.05, label: 'Gloss' }],
    draw: function (fx) {
      var g = fx.ctx, w = fx.w, h = fx.h, ph = fx.phase01;
      var c = hx(fx.p.color || '#39ff9e'), gloss = fx.p.gloss != null ? fx.p.gloss : 0.8;
      var base = g.createLinearGradient(0, 0, 0, h);
      base.addColorStop(0, css([c[0] * 0.5 + 60, c[1] * 0.5 + 60, c[2] * 0.5 + 60], 0.95));
      base.addColorStop(0.6, css(c, 0.92));
      base.addColorStop(1, css([c[0] * 0.35, c[1] * 0.35, c[2] * 0.35], 0.95));
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      // rim darkening for a thick jelly edge is handled by mask; add specular blobs
      g.globalCompositeOperation = 'lighter';
      var seed = fx.seed, rng = U.mulberry32(U.hashSeed('jelly' + seed));
      var n = 10;
      for (var i = 0; i < n; i++) {
        var bx = rng() * w, by = rng() * h, r = (0.05 + rng() * 0.12) * Math.min(w, h);
        var dy = Math.sin(ph * TAU + i) * h * 0.03;   // gentle drift, loop-safe
        var rg = g.createRadialGradient(bx, by + dy, 0, bx, by + dy, r);
        var b = 0.35 + 0.5 * gloss * (0.5 + 0.5 * Math.sin(ph * TAU + i * 1.7));
        rg.addColorStop(0, 'rgba(255,255,255,' + b.toFixed(3) + ')'); rg.addColorStop(0.6, 'rgba(255,255,255,0.06)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = rg; g.beginPath(); g.arc(bx, by + dy, r, 0, 7); g.fill();
      }
      // big top gloss streak
      var streak = g.createLinearGradient(0, 0, 0, h * 0.5);
      streak.addColorStop(0, 'rgba(255,255,255,' + (0.5 * gloss) + ')'); streak.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = streak; g.fillRect(0, 0, w, h * 0.5);
      g.globalCompositeOperation = 'source-over';
    }
  });

  // =======================================================================
  //  GEMS  (seeded fields of independently-glinting sprites)
  // =======================================================================

  // Rhinestone Overdose — gem-covered letters; every stone catches light on its
  // own beat with a coloured glint.
  register('rhinestone', {
    label: 'Rhinestone Overdose', category: 'Gems', blend: 'base',
    params: [{ key: 'size', type: 'range', def: 1, min: 0.5, max: 2, step: 0.1, label: 'Stone size' },
             { key: 'density', type: 'range', def: 0.7, min: 0.3, max: 1.4, step: 0.05, label: 'Density' }],
    draw: function (fx) {
      var g = fx.ctx, w = fx.w, h = fx.h, ph = fx.phase01;
      g.fillStyle = '#2a2140'; g.fillRect(0, 0, w, h);        // setting
      var f = fx.field(w, h, fx.p.density != null ? fx.p.density : 0.7, fx.seed);
      var scale = Math.max(0.75, Math.min(w, h) / 300) * (fx.p.size != null ? fx.p.size : 1) * 3.4;
      for (var i = 0; i < f.flakes.length; i++) {
        var fl = f.flakes[i], x = fl.nx * w, y = fl.ny * h, r = fl.size * scale;
        var st = fx.still ? { bright: 0.35 + 0.6 * ((fl.phase * 7.1) % 1) } : fx.GL.flakeState(fl, ph);
        var hue = (fl.phase + ph * (fl.cycles || 3)) % 1;      // glint colour, loop-safe
        var glint = fx.U.hslToRgb(hue * 360, 0.9, 0.7);
        var rg = g.createRadialGradient(x - r * 0.2, y - r * 0.2, 0, x, y, r);
        rg.addColorStop(0, 'rgba(255,255,255,0.95)');
        rg.addColorStop(0.45, css(glint, 0.85));
        rg.addColorStop(1, 'rgba(60,60,90,0.15)');
        g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
        // hot spark on the stones lit this frame
        if (st.bright > 0.25) {
          g.globalCompositeOperation = 'lighter';
          g.fillStyle = 'rgba(255,255,255,' + (st.bright).toFixed(2) + ')';
          var c = r * 0.5; g.fillRect(x - c / 2, y - c / 2, c, c);
          g.globalCompositeOperation = 'source-over';
        }
      }
    }
  });

  // Sequin Seizure — reflective discs flip in travelling waves, changing colour.
  register('sequin', {
    label: 'Sequin Seizure', category: 'Gems', blend: 'base',
    params: [{ key: 'c1', type: 'color', def: '#ff3fbf', label: 'Face A' },
             { key: 'c2', type: 'color', def: '#3fd0ff', label: 'Face B' },
             { key: 'density', type: 'range', def: 0.55, min: 0.3, max: 1.2, step: 0.05, label: 'Density' }],
    draw: function (fx) {
      var g = fx.ctx, w = fx.w, h = fx.h, ph = fx.phase01;
      var a = hx(fx.p.c1 || '#ff3fbf'), b = hx(fx.p.c2 || '#3fd0ff');
      g.fillStyle = '#1a1230'; g.fillRect(0, 0, w, h);
      var f = fx.field(w, h, fx.p.density != null ? fx.p.density : 0.55, fx.seed + 5);
      var scale = Math.max(0.75, Math.min(w, h) / 300) * 4.2;
      for (var i = 0; i < f.flakes.length; i++) {
        var fl = f.flakes[i], x = fl.nx * w, y = fl.ny * h, R = fl.size * scale;
        // travelling flip wave across x + each disc's own phase
        var flip = 0.5 + 0.5 * Math.sin((fl.nx * 4 + fl.phase) * TAU + ph * TAU * (fl.cycles || 3));
        var col = flip > 0.5 ? a : b, sh = Math.abs(flip - 0.5) * 2; // 0 edge-on .. 1 face-on
        var rr = R * (0.35 + 0.65 * sh);
        var rg = g.createRadialGradient(x - rr * 0.3, y - rr * 0.3, 0, x, y, rr);
        rg.addColorStop(0, 'rgba(255,255,255,0.9)'); rg.addColorStop(0.5, css(col, 0.95)); rg.addColorStop(1, css([col[0] * 0.4, col[1] * 0.4, col[2] * 0.4], 1));
        g.fillStyle = rg; g.beginPath(); g.ellipse ? g.ellipse(x, y, rr, R, 0, 0, 7) : g.arc(x, y, rr, 0, 7); g.fill();
      }
    }
  });

  // Opal Fire — cloudy milky-white stone with coloured sparks blooming inside.
  register('opalfire', {
    label: 'Opal Fire', category: 'Gems', blend: 'base',
    params: [{ key: 'fire', type: 'range', def: 0.7, min: 0.2, max: 1, step: 0.05, label: 'Fire' }],
    draw: function (fx) {
      var g = fx.ctx, w = fx.w, h = fx.h, ph = fx.phase01;
      // cloudy pale base
      var buf = fx.shade(w, h, 300, ph, function (nx, ny, p) {
        var c = 0.72 + 0.14 * Math.sin(nx * 7 + Math.sin(ny * 5 + p * TAU) * 2) + 0.08 * Math.cos(ny * 9);
        return fx.U.hslToRgb(200 + 40 * Math.sin(nx * 3 + ny * 3), 0.18, Math.max(0.55, Math.min(0.92, c)));
      });
      g.drawImage(buf, 0, 0, w, h);
      // colour sparks
      var f = fx.field(w, h, 0.55, fx.seed + 9), fire = fx.p.fire != null ? fx.p.fire : 0.7;
      var scale = Math.max(0.75, Math.min(w, h) / 300) * 6;
      g.globalCompositeOperation = 'lighter';
      for (var i = 0; i < f.flakes.length; i++) {
        var fl = f.flakes[i];
        // still: show a representative sparse frame (only ~half lit), not all-max
        var st = fx.still ? { bright: (fl.phase * 6.1) % 1 < 0.45 ? 0.3 + 0.5 * ((fl.phase * 6.1) % 1) : 0 } : fx.GL.flakeState(fl, ph);
        if (st.bright < 0.18) continue;
        var x = fl.nx * w, y = fl.ny * h, r = fl.size * scale * (0.45 + 0.7 * st.bright);
        var hue = (fl.phase + ph * (fl.cycles || 4)) % 1;
        var col = fx.U.hslToRgb(hue * 360, 1, 0.6);
        var rg = g.createRadialGradient(x, y, 0, x, y, r);
        rg.addColorStop(0, css(col, Math.min(0.95, 0.95 * fire * st.bright))); rg.addColorStop(0.55, css(col, 0.28 * fire)); rg.addColorStop(1, css(col, 0));
        g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      }
      g.globalCompositeOperation = 'source-over';
    }
  });

  // =======================================================================
  //  LIGHT treatments + GLITCH + more iridescent / metal  (batch 2)
  // =======================================================================
  var _fl2 = null;
  function finishLayer2(w, h) { if (!_fl2 || _fl2.width !== w || _fl2.height !== h) _fl2 = createCanvas(w, h); return _fl2; }
  // draw the mask tinted a flat colour onto g (via a scratch layer)
  function drawTint(g, m, color, w, h) {
    var t = finishLayer2(w, h), tc = t.getContext('2d');
    tc.setTransform(1, 0, 0, 1, 0, 0); tc.globalCompositeOperation = 'source-over'; tc.globalAlpha = 1; tc.filter = 'none'; tc.clearRect(0, 0, w, h);
    tc.drawImage(m, 0, 0, w, h); tc.globalCompositeOperation = 'source-in'; tc.fillStyle = color; tc.fillRect(0, 0, w, h);
    g.drawImage(t, 0, 0);
  }

  // Chromatic Ghosting — RGB copies separate, vibrate, snap back together. Draws
  // its own offset copies of the letter mask, so it exceeds the mask (selfMask).
  register('chromatic', {
    label: 'Chromatic Ghosting', category: 'Glitch', blend: 'add', selfMask: true,
    params: [{ key: 'amount', type: 'range', def: 0.5, min: 0.05, max: 1, step: 0.05, label: 'Split' }],
    draw: function (fx) {
      var g = fx.ctx, w = fx.w, h = fx.h, m = fx.mask;
      var amt = (fx.p.amount != null ? fx.p.amount : 0.5) * 0.03 * Math.min(w, h);
      var dx = amt * Math.cos(fx.phase01 * TAU), dy = amt * Math.sin(fx.phase01 * TAU);   // 1 rev -> loop-safe
      g.globalCompositeOperation = 'lighter';
      function copy(color, ox, oy) {
        var t = finishLayer2(w, h), tc = t.getContext('2d');
        tc.setTransform(1, 0, 0, 1, 0, 0); tc.globalCompositeOperation = 'source-over'; tc.globalAlpha = 1; tc.filter = 'none'; tc.clearRect(0, 0, w, h);
        tc.drawImage(m, ox, oy, w, h); tc.globalCompositeOperation = 'source-in'; tc.fillStyle = color; tc.fillRect(0, 0, w, h);
        g.drawImage(t, 0, 0);
      }
      copy('#ff0033', -dx, -dy); copy('#00ff44', 0, 0); copy('#0044ff', dx, dy);
      g.globalCompositeOperation = 'source-over';
    }
  });

  // Starburst Glare — bright points that explode into 4/6/8-point stars.
  register('starburst', {
    label: 'Starburst Glare', category: 'Light', blend: 'add',
    params: [{ key: 'points', type: 'range', def: 4, min: 4, max: 8, step: 2, label: 'Points' },
             { key: 'density', type: 'range', def: 0.35, min: 0.15, max: 0.8, step: 0.05, label: 'Count' }],
    draw: function (fx) {
      var g = fx.ctx, w = fx.w, h = fx.h, ph = fx.phase01;
      var f = fx.field(w, h, fx.p.density != null ? fx.p.density : 0.35, fx.seed + 3);
      var pts = Math.max(4, Math.round(fx.p.points || 4)), scale = Math.max(0.75, Math.min(w, h) / 300);
      for (var i = 0; i < f.flakes.length; i++) {
        var fl = f.flakes[i];
        var st = fx.still ? { bright: 0.6 * ((fl.phase * 3.3) % 1) + 0.25 } : fx.GL.flakeState(fl, ph);
        if (st.bright < 0.35) continue;
        var x = fl.nx * w, y = fl.ny * h, L = fl.size * scale * 11 * st.bright, b = st.bright;
        g.save(); g.translate(x, y); g.rotate(fl.phase * TAU);
        g.globalAlpha = b; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = Math.max(1, L * 0.03);
        for (var k = 0; k < pts; k++) { var a = (k / pts) * TAU; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * L, Math.sin(a) * L); g.stroke(); }
        var rg = g.createRadialGradient(0, 0, 0, 0, 0, L * 0.3); rg.addColorStop(0, 'rgba(255,255,255,' + b.toFixed(2) + ')'); rg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = rg; g.beginPath(); g.arc(0, 0, L * 0.3, 0, 7); g.fill();
        g.restore();
      }
      g.globalAlpha = 1;
    }
  });

  // Satin Sheen — broad silky light bands sweep across like moving fabric.
  register('satin', {
    label: 'Satin Sheen', category: 'Light', blend: 'add',
    params: [{ key: 'bands', type: 'range', def: 2, min: 1, max: 5, step: 1, label: 'Bands' },
             { key: 'tint', type: 'color', def: '#ffffff', label: 'Tint' }],
    draw: function (fx) {
      var g = fx.ctx, w = fx.w, h = fx.h, ph = fx.phase01, bands = Math.max(1, Math.round(fx.p.bands || 2));
      var c = hx(fx.p.tint || '#ffffff');
      g.globalCompositeOperation = 'lighter';
      for (var k = 0; k < bands; k++) {
        var pos = (ph * (k + 1) + k / bands) % 1;         // integer revs -> loop-safe
        var cx = pos * (w + h) - h * 0.5;
        var grad = g.createLinearGradient(cx - w * 0.28, 0, cx + w * 0.28, h);
        grad.addColorStop(0, css(c, 0)); grad.addColorStop(0.5, css(c, 0.5)); grad.addColorStop(1, css(c, 0));
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
      }
      g.globalCompositeOperation = 'source-over';
    }
  });

  // Neon Tubing — coloured glow halo + a blazing near-white core; the halo
  // spills past the letters (selfMask).
  register('neontube', {
    label: 'Neon Tubing', category: 'Light', blend: 'add', selfMask: true,
    params: [{ key: 'color', type: 'color', def: '#ff2fd0', label: 'Tube' },
             { key: 'glow', type: 'range', def: 0.6, min: 0.2, max: 1, step: 0.05, label: 'Glow' }],
    draw: function (fx) {
      var g = fx.ctx, w = fx.w, h = fx.h, m = fx.mask;
      var c = fx.p.color || '#ff2fd0', glow = fx.p.glow != null ? fx.p.glow : 0.6;
      var rad = Math.max(2, Math.min(w, h) * 0.03 * glow);
      g.globalCompositeOperation = 'lighter';
      if ('filter' in g) {
        g.globalAlpha = 0.55; g.filter = 'blur(' + (rad * 2).toFixed(1) + 'px)'; drawTint(g, m, c, w, h);
        g.filter = 'blur(' + rad.toFixed(1) + 'px)'; drawTint(g, m, c, w, h); g.filter = 'none';
      } else { g.globalAlpha = 0.5; drawTint(g, m, c, w, h); }
      g.globalAlpha = 1; drawTint(g, m, '#fff5ff', w, h);   // core
      g.globalCompositeOperation = 'source-over';
    }
  });

  // Aurora Shimmer — slow luminous green/cyan/violet/pink ribbons drifting inside.
  register('aurora', {
    label: 'Aurora Shimmer', category: 'Iridescent', blend: 'base',
    params: [{ key: 'ribbons', type: 'range', def: 1, min: 1, max: 3, step: 1, label: 'Ribbons' }],
    draw: function (fx) {
      var revs = Math.max(1, Math.round(fx.p.ribbons || 1));
      var buf = fx.shade(fx.w, fx.h, 340, fx.phase01, function (nx, ny, ph) {
        var ribbon = Math.sin(nx * 6 + Math.sin(ny * 4 + ph * TAU * revs) * 2.5 + ph * TAU * revs);
        var hue = 150 + 95 * Math.sin(nx * 2 + ny * 3 + ph * TAU * revs);
        var li = 0.1 + 0.42 * Math.pow(0.5 + 0.5 * ribbon, 2);
        return fx.U.hslToRgb(hue, 0.85, li);
      });
      fx.ctx.drawImage(buf, 0, 0, fx.w, fx.h);
    }
  });

  // Anodized Aluminum — saturated metallic bands with a fine brushed grain.
  register('anodized', {
    label: 'Anodized Aluminum', category: 'Metal', blend: 'base',
    params: [{ key: 'hue', type: 'range', def: 200, min: 0, max: 360, step: 5, label: 'Hue' }],
    draw: function (fx) {
      var baseHue = fx.p.hue != null ? fx.p.hue : 200;
      var buf = fx.shade(fx.w, fx.h, 400, fx.phase01, function (nx, ny, ph) {
        var ramp = 0.4 + 0.35 * Math.sin(ny * Math.PI);
        var sheen = Math.pow(0.5 + 0.5 * Math.sin((ny - ph) * TAU), 8) * 0.5;   // 1 rev -> loop-safe
        var brush = 0.04 * Math.sin(nx * 260);
        var hue = baseHue + 40 * Math.sin(ny * 3);
        return fx.U.hslToRgb(hue, 0.55, Math.max(0.05, Math.min(0.95, ramp + sheen + brush)));
      });
      fx.ctx.drawImage(buf, 0, 0, fx.w, fx.h);
    }
  });

  SB.finishes = {
    register: register, get: get, has: has, list: list, defaults: defaults,
    renderStack: renderStack, shade: shade, field: field, _REG: REG
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
