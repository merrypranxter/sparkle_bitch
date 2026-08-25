/* Sparkle Bitch — render.js
 * Composite one frame. Four cases, all driven by phase01 (loop-safe):
 *   1. TEXT mode  — glitter-filled letterforms + outline + shadow (transparent bg)
 *   2. LIMINAL    — the Liminal Engine: degrade/haunt the base image, no sprites
 *   3. IMAGE      — base + additive sparkle sprite layer (the original engine)
 *   4. IMAGE + glitter fill — a Picasion-style animated glitter overlay, on the
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
  // All motion is a pure function of phase01 with integer cycles, so every
  // mode (twinkle / fade / pulse / drift) loops cleanly in a GIF.
  function stateOf(inst, params, phase01, still) {
    var t;
    var depth = params.depthLayers ? (inst.depth || 1) : 1;
    var speedMult = 0.5 + 0.5 * depth;   // far layers twinkle slower
    if (still) {
      t = 0.9;
    } else {
      var wob = inst.wob || 1;
      t = 0.5 + 0.5 * Math.sin(A.TAU * Math.max(1, Math.round((params.speed || 1) * speedMult)) * phase01 + inst.phase);
      t = 0.5 + (t - 0.5) * wob;
    }
    var motion = params.motion || 'twinkle';
    var alpha, sizeMult;
    if (motion === 'fade') {           // pure alpha breathe, size constant
      alpha = U.clamp(0.05 + 0.95 * t, 0, 1); sizeMult = 1;
    } else if (motion === 'pulse') {   // mostly visible, size throbs
      alpha = U.clamp(0.45 + 0.55 * t, 0, 1); sizeMult = 0.45 + 0.95 * t;
    } else {                           // classic twinkle
      alpha = U.clamp(0.22 + 0.78 * t, 0, 1); sizeMult = 0.6 + 0.55 * t;
    }
    alpha *= 0.55 + 0.45 * depth;
    var size = params.maxSize * inst.baseSize * sizeMult * depth * (params.spriteScale || 1);
    var angle = inst.phase + (params.spinRevs ? A.spin(phase01, params.spinRevs * inst.spinDir, 0) : 0);
    return { alpha: alpha, size: size, angle: angle };
  }

  // loop-safe float: ping-pong drift, each sparkle in its own phase + direction
  function driftOffset(inst, params, phase01, minDim) {
    if (!params.drift) return 0;
    var amp = params.drift * 0.08 * minDim * (inst.depth || 1);
    var p = (phase01 + (inst.driftPhase || 0)) % 1;
    return (A.loopPing(p) - 0.5) * 2 * amp * (inst.spinDir || 1);
  }

  // glitter fields for outline styles are cached (normalised, so one per
  // style/size/density/seed works at any output resolution).
  var _fields = {};
  function fieldFor(style, w, h, density, grain, seed) {
    var d = density != null ? density : 0.6;
    var s = seed != null ? seed : 1234;
    var g = grain != null ? grain : 1;
    var key = style + '|' + w + '|' + h + '|' + d + '|' + s + '|' + g;
    if (!_fields[key]) {
      if (Object.keys(_fields).length > 48) _fields = {};
      _fields[key] = GL.buildField(w, h, style, d, s, g);
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

  // PURE: which source frame a texture shows at a loop phase. floor(phase*n)%n
  // walks 0..n-1 exactly once across phase [0,1) and wraps to 0 at phase 1, so a
  // texture-filled letter loops as cleanly as the glitter does.
  function textureFrameIndex(n, phase01) {
    if (!n || n <= 1) return 0;
    var i = Math.floor(phase01 * n) % n;
    return i < 0 ? i + n : i;
  }
  // Delay-aware frame pick: map phase through the CUMULATIVE per-frame delays so
  // a GIF with uneven delays previews at its true timing (and matches the export,
  // which drives each frame's phase to the midpoint of its delay window). Falls
  // back to even spacing when delays are absent/zero.
  function textureFrameAt(frames, phase01) {
    var n = frames.length; if (n <= 1) return 0;
    var total = 0, i, d;
    for (i = 0; i < n; i++) { d = frames[i].delay; total += (d != null ? d : 100); }
    if (total <= 0) return textureFrameIndex(n, phase01);
    var p = phase01 % 1; if (p < 0) p += 1;
    var t = p * total, acc = 0;
    for (i = 0; i < n; i++) { d = frames[i].delay; acc += (d != null ? d : 100); if (t < acc) return i; }
    return n - 1;
  }
  // fill a white mask with one frame of an uploaded image/GIF, Cover-fit (scale to
  // fill W×H, centre-crop the overflow), composited at `alpha`.
  function paintTextureMasked(ctx, texture, mask, phase01, still, alpha) {
    var W = ctx.canvas.width, H = ctx.canvas.height;
    var frames = texture.frames;
    var src = frames[still ? 0 : textureFrameAt(frames, phase01)].canvas;
    var sw = src.width || 1, sh = src.height || 1;
    var scale = Math.max(W / sw, H / sh);            // cover
    var dw = sw * scale, dh = sh * scale, dx = (W - dw) / 2, dy = (H - dh) / 2;
    var t = textLayerFor(W, H), tc = t.getContext('2d');
    tc.setTransform(1, 0, 0, 1, 0, 0); tc.globalCompositeOperation = 'source-over'; tc.globalAlpha = 1; tc.filter = 'none';
    tc.clearRect(0, 0, W, H);
    tc.drawImage(src, dx, dy, dw, dh);
    tc.globalCompositeOperation = 'destination-in'; tc.drawImage(mask, 0, 0, W, H);
    ctx.save(); ctx.globalAlpha = U.clamp(alpha, 0, 1); ctx.drawImage(t, 0, 0); ctx.restore();
  }

  // ---- glitter text ----------------------------------------------------
  function renderText(ctx, tr, mainField, params, phase01, opts) {
    var W = ctx.canvas.width, H = ctx.canvas.height, still = !!opts.still;
    var fillAlpha = params.glitterIntensity != null ? params.glitterIntensity : 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.clearRect(0, 0, W, H);
    if (opts.matte) { ctx.fillStyle = opts.matte; ctx.fillRect(0, 0, W, H); }
    if (tr.shadowCanvas) ctx.drawImage(tr.shadowCanvas, 0, 0, W, H);
    // outline layers, OUTERMOST first (inner bands overdraw on top). Each glitter
    // outline uses its OWN density/grain/strength when set, else the fill's.
    var layers = tr.layers || [];
    for (var k = layers.length - 1; k >= 0; k--) {
      var L = layers[k];
      if (L.kind === 'finish' && L.finish && SB.finishes) {
        SB.finishes.renderStack(ctx, [L.finish], L.mask, phase01, still, params.seed);
      } else if (L.kind === 'texture' && L.texture) {
        paintTextureMasked(ctx, L.texture, L.mask, phase01, still, L.intensity != null ? L.intensity : fillAlpha);
      } else if (L.kind === 'glitter') {
        var d = L.density != null ? L.density : params.glitterDensity;
        var g = L.grain != null ? L.grain : params.glitterGrain;
        var a = L.intensity != null ? L.intensity : fillAlpha;
        paintGlitterMasked(ctx, fieldFor(L.glitter, W, H, d, g, params.seed), L.mask, phase01, still, a);
      } else {
        paintColorMasked(ctx, L.mask, L.color || '#000000');
      }
    }
    // the letter fill, on top: an uploaded texture if set, else the glitter field
    if (opts.fillTexture) paintTextureMasked(ctx, opts.fillTexture, tr.maskCanvas, phase01, still, fillAlpha);
    else if (mainField) paintGlitterMasked(ctx, mainField, tr.maskCanvas, phase01, still, fillAlpha);
    // stacked reflective finishes on top of the fill (Liquid Chrome + CD + Starburst + …)
    if (opts.finishStack && opts.finishStack.length && SB.finishes) {
      SB.finishes.renderStack(ctx, opts.finishStack, tr.maskCanvas, phase01, still, params.seed);
    }
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

  // ---- dust: a dense fine-flake shimmer restricted to detected areas ----
  function dustOverlay(ctx, dust, phase01, still) {
    var W = ctx.canvas.width, H = ctx.canvas.height;
    var lay = textLayerFor(W, H), lc = lay.getContext('2d');
    lc.setTransform(1, 0, 0, 1, 0, 0); lc.globalCompositeOperation = 'source-over';
    lc.globalAlpha = 1; lc.clearRect(0, 0, W, H);
    GL.drawGlitter(lc, dust.field, phase01, { w: W, h: H, base: false, still: still });
    if (dust.mask) { lc.globalCompositeOperation = 'destination-in'; lc.drawImage(dust.mask, 0, 0, W, H); }
    ctx.save();
    ctx.globalCompositeOperation = dust.blend === 'lighter' ? 'lighter' : 'screen';
    ctx.globalAlpha = U.clamp(dust.intensity != null ? dust.intensity : 0.8, 0, 1);
    ctx.drawImage(lay, 0, 0);
    ctx.restore();
  }

  /**
   * @param opts { still, matte, text(render result), glitterField, glitterOnImage, glitterMask, dust }
   */
  function render(ctx, base, insts, params, phase01, opts) {
    opts = opts || {};
    var W = ctx.canvas.width, H = ctx.canvas.height, still = !!opts.still;

    // ---- TEXT MODE ----
    if (opts.text && (opts.glitterField || opts.fillTexture)) { renderText(ctx, opts.text, opts.glitterField, params, phase01, opts); return; }

    // ---- LIMINAL MODE — hand the whole frame to the Liminal Engine ----
    if (opts.liminal && SB.liminal) {
      SB.liminal.render(ctx, base, opts.liminal, phase01, still, opts.matte, params.seed);
      return;
    }

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
        var sz = Math.max(2, s.size), sprite = SPK.getSprite(inst.style, inst.color, glow);
        var x = inst.nx * W, y = inst.ny * H + (still ? 0 : driftOffset(inst, params, phase01, Math.min(W, H)));
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

    // ---- dust shimmer over the detected areas (fine, dense) ----
    if (opts.dust && opts.dust.field) dustOverlay(ctx, opts.dust, phase01, still);

    // ---- glitter fill over the image (Picasion style) ----
    if (opts.glitterField && opts.glitterOnImage) glitterOverlay(ctx, opts.glitterField, params, phase01, opts);
  }

  SB.render = { render: render, stateOf: stateOf, driftOffset: driftOffset, textureFrameIndex: textureFrameIndex, textureFrameAt: textureFrameAt };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
