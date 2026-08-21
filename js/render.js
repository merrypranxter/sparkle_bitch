/* Sparkle Bitch — render.js
 * Composite one frame. Three cases, all driven by phase01 (loop-safe):
 *   1. TEXT mode  — glitter-filled letterforms + outline + shadow (transparent bg)
 *   2. IMAGE      — base + additive sparkle sprite layer (the original engine)
 *   3. IMAGE + glitter fill — a Picasion-style animated glitter overlay, on the
 *      whole image or a painted selection, on top of (or instead of) sprites.
 */
(function (global) {
  'use strict';
  var SB = global.SB = global.SB || {};
  var A = SB.anim, U = SB.util, SPK = SB.sparkles, GL = SB.glitter;

  function createCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') {
      try { return new OffscreenCanvas(w, h); } catch (e) {}
    }
    var c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }

  var _layer = null, _tlayer = null;
  function layerFor(w, h) {
    if (!_layer || _layer.width !== w || _layer.height !== h) _layer = createCanvas(w, h);
    return _layer;
  }
  function textLayerFor(w, h) {
    if (!_tlayer || _tlayer.width !== w || _tlayer.height !== h) _tlayer = createCanvas(w, h);
    return _tlayer;
  }

  // Per-instance animated state for sparkle sprites.
  function stateOf(inst, params, phase01, still) {
    var t;
    if (still) {
      t = 0.9;
    } else {
      var depth = inst.wob || 1;
      t = 0.5 + 0.5 * Math.sin(A.TAU * Math.max(1, Math.round(params.speed || 1)) * phase01 + inst.phase);
      t = 0.5 + (t - 0.5) * depth;
    }
    var alpha = U.clamp(0.22 + 0.78 * t, 0, 1);
    var sizeMult = 0.6 + 0.55 * t;
    var angle = inst.phase + (params.spinRevs ? A.spin(phase01, params.spinRevs * inst.spinDir, 0) : 0);
    return { alpha: alpha, size: params.maxSize * inst.baseSize * sizeMult, angle: angle };
  }

  // glitter fields for outline styles are cached (normalised, so one per
  // style/size/density/seed works at any output resolution).
  var _fields = {};
  function fieldFor(style, w, h, params) {
    var d = params.glitterDensity != null ? params.glitterDensity : 0.6;
    var s = params.seed != null ? params.seed : 1234;
    var key = style + '|' + w + '|' + h + '|' + d + '|' + s;
    if (!_fields[key]) {
      if (Object.keys(_fields).length > 48) _fields = {};
      _fields[key] = GL.buildField(w, h, style, d, s);
    }
    return _fields[key];
  }
  // fill a white mask with animated glitter, composited at `alpha`
  function paintGlitterMasked(ctx, field, mask, phase01, still, alpha) {
    var W = ctx.canvas.width, H = ctx.canvas.height;
    var t = textLayerFor(W, H), tc = t.getContext('2d');
    tc.setTransform(1, 0, 0, 1, 0, 0); tc.globalCompositeOperation = 'source-over'; tc.globalAlpha = 1; tc.filter = 'none'; tc.clearRect(0, 0, W, H);
    GL.drawGlitter(tc, field, phase01, { w: W, h: H, base: true, still: still });
    tc.globalCompositeOperation = 'destination-in'; tc.drawImage(mask, 0, 0, W, H);
    ctx.save(); ctx.globalAlpha = U.clamp(alpha, 0, 1); ctx.drawImage(t, 0, 0); ctx.restore();
  }
  // fill a white mask with a solid colour
  function paintColorMasked(ctx, mask, color) {
    var W = ctx.canvas.width, H = ctx.canvas.height;
    var t = textLayerFor(W, H), tc = t.getContext('2d');
    tc.setTransform(1, 0, 0, 1, 0, 0); tc.globalCompositeOperation = 'source-over'; tc.globalAlpha = 1; tc.filter = 'none'; tc.clearRect(0, 0, W, H);
    tc.drawImage(mask, 0, 0, W, H);
    tc.globalCompositeOperation = 'source-in'; tc.fillStyle = color; tc.fillRect(0, 0, W, H);
    ctx.drawImage(t, 0, 0);
  }

  // ---- glitter text ----------------------------------------------------
  function renderText(ctx, tr, mainField, params, phase01, opts) {
    var W = ctx.canvas.width, H = ctx.canvas.height, still = !!opts.still;
    var alpha = params.glitterIntensity != null ? params.glitterIntensity : 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.clearRect(0, 0, W, H);
    if (opts.matte) { ctx.fillStyle = opts.matte; ctx.fillRect(0, 0, W, H); }
    if (tr.shadowCanvas) ctx.drawImage(tr.shadowCanvas, 0, 0, W, H);
    // outline layers, OUTERMOST first (inner bands overdraw on top)
    var layers = tr.layers || [];
    for (var k = layers.length - 1; k >= 0; k--) {
      var L = layers[k];
      if (L.kind === 'glitter') paintGlitterMasked(ctx, fieldFor(L.glitter, W, H, params), L.mask, phase01, still, alpha);
      else paintColorMasked(ctx, L.mask, L.color || '#000000');
    }
    // the glitter letter fill, on top
    paintGlitterMasked(ctx, mainField, tr.maskCanvas, phase01, still, alpha);
  }

  // ---- glitter overlay on an image -------------------------------------
  function glitterOverlay(ctx, field, params, phase01, opts) {
    var W = ctx.canvas.width, H = ctx.canvas.height;
    var lay = textLayerFor(W, H), lc = lay.getContext('2d');
    lc.setTransform(1, 0, 0, 1, 0, 0); lc.globalCompositeOperation = 'source-over';
    lc.globalAlpha = 1; lc.clearRect(0, 0, W, H);
    GL.drawGlitter(lc, field, phase01, { w: W, h: H, base: false, still: !!opts.still });
    if (opts.glitterMask) { lc.globalCompositeOperation = 'destination-in'; lc.drawImage(opts.glitterMask, 0, 0, W, H); }
    ctx.save();
    ctx.globalCompositeOperation = (params.blend === 'lighter') ? 'lighter' : 'screen';
    ctx.globalAlpha = U.clamp(params.glitterIntensity != null ? params.glitterIntensity : 0.9, 0, 1);
    ctx.drawImage(lay, 0, 0);
    ctx.restore();
  }

  /**
   * @param opts { still, matte, text(render result), glitterField, glitterOnImage, glitterMask }
   */
  function render(ctx, base, insts, params, phase01, opts) {
    opts = opts || {};
    var W = ctx.canvas.width, H = ctx.canvas.height, still = !!opts.still;

    // ---- TEXT MODE ----
    if (opts.text && opts.glitterField) { renderText(ctx, opts.text, opts.glitterField, params, phase01, opts); return; }

    // ---- base ----
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.clearRect(0, 0, W, H);
    if (opts.matte) { ctx.fillStyle = opts.matte; ctx.fillRect(0, 0, W, H); }
    if (base) ctx.drawImage(base, 0, 0, W, H);
    else if (!opts.matte) { ctx.fillStyle = opts.clearColor || '#0a0710'; ctx.fillRect(0, 0, W, H); }

    // ---- sparkle sprite layer ----
    if (insts && insts.length) {
      var layer = layerFor(W, H), lctx = layer.getContext('2d');
      lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.globalCompositeOperation = 'source-over';
      lctx.clearRect(0, 0, W, H); lctx.globalCompositeOperation = 'lighter'; lctx.filter = 'none';
      var glow = params.glow != null ? params.glow : 0.6;
      for (var i = 0; i < insts.length; i++) {
        var inst = insts[i], s = stateOf(inst, params, phase01, still);
        var sz = Math.max(6, s.size), sprite = SPK.getSprite(inst.style, inst.color, glow);
        var x = inst.nx * W, y = inst.ny * H;
        lctx.save(); lctx.globalAlpha = s.alpha; lctx.translate(x, y);
        if (s.angle) lctx.rotate(s.angle);
        lctx.drawImage(sprite, -sz / 2, -sz / 2, sz, sz); lctx.restore();
      }
      ctx.save();
      ctx.globalAlpha = U.clamp(params.intensity != null ? params.intensity : 0.85, 0, 1);
      ctx.globalCompositeOperation = (params.blend === 'lighter') ? 'lighter' : 'screen';
      if (params.hueCycle && !still) ctx.filter = 'hue-rotate(' + A.hueCycle(phase01, params.hueCycleRevs || 1).toFixed(1) + 'deg)';
      else ctx.filter = 'none';
      ctx.drawImage(layer, 0, 0); ctx.restore(); ctx.filter = 'none';
    }

    // ---- glitter fill over the image (Picasion style) ----
    if (opts.glitterField && opts.glitterOnImage) glitterOverlay(ctx, opts.glitterField, params, phase01, opts);
  }

  SB.render = { render: render, stateOf: stateOf };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
