/* Sparkle Bitch — render.js
 * Composite one frame: base image + animated sparkle layer.
 * The sparkle layer is drawn to its own canvas with additive ('lighter')
 * blending so overlaps bloom, then screen/lighter-composited onto the base.
 * Optional whole-layer hue-rotate gives the shimmer without busting the
 * per-colour sprite cache.
 */
(function (global) {
  'use strict';
  var SB = global.SB = global.SB || {};
  var A = SB.anim, U = SB.util, SPK = SB.sparkles;

  function createCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') {
      try { return new OffscreenCanvas(w, h); } catch (e) {}
    }
    var c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }

  var _layer = null;
  function layerFor(w, h) {
    if (!_layer || _layer.width !== w || _layer.height !== h) _layer = createCanvas(w, h);
    return _layer;
  }

  // Per-instance animated state at a given phase.
  function stateOf(inst, params, phase01, still) {
    var t;
    if (still) {
      t = 0.9;
    } else {
      var depth = inst.wob || 1;
      t = 0.5 + 0.5 * Math.sin(A.TAU * Math.max(1, Math.round(params.speed || 1)) * phase01 + inst.phase);
      t = 0.5 + (t - 0.5) * depth;               // vary twinkle depth per sparkle
    }
    var alpha = U.clamp(0.22 + 0.78 * t, 0, 1);
    var sizeMult = 0.6 + 0.55 * t;
    var angle = inst.phase + (params.spinRevs ? A.spin(phase01, params.spinRevs * inst.spinDir, 0) : 0);
    return { alpha: alpha, size: params.maxSize * inst.baseSize * sizeMult, angle: angle };
  }

  /**
   * @param ctx     destination 2D context (canvas W x H)
   * @param base    drawable (canvas/image/video/ImageBitmap) or null
   * @param insts   sparkle instances
   * @param params
   * @param phase01 [0,1)
   * @param opts    { still:bool, clearColor:'#000' }
   */
  function render(ctx, base, insts, params, phase01, opts) {
    opts = opts || {};
    var W = ctx.canvas.width, H = ctx.canvas.height;
    var still = !!opts.still;

    // 1) base layer (clear/matte first so transparent sources don't ghost)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.clearRect(0, 0, W, H);
    if (opts.matte) { ctx.fillStyle = opts.matte; ctx.fillRect(0, 0, W, H); }
    if (base) {
      ctx.drawImage(base, 0, 0, W, H);
    } else if (!opts.matte) {
      ctx.fillStyle = opts.clearColor || '#0a0710';
      ctx.fillRect(0, 0, W, H);
    }
    if (!insts || !insts.length) return;

    // 2) sparkle layer (additive among sparkles)
    var layer = layerFor(W, H);
    var lctx = layer.getContext('2d');
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, W, H);
    lctx.globalCompositeOperation = 'lighter';
    lctx.filter = 'none';

    var glow = params.glow != null ? params.glow : 0.6;
    for (var i = 0; i < insts.length; i++) {
      var inst = insts[i];
      var s = stateOf(inst, params, phase01, still);
      var sz = Math.max(6, s.size);
      var sprite = SPK.getSprite(inst.style, inst.color, glow);
      var x = inst.nx * W, y = inst.ny * H;
      lctx.save();
      lctx.globalAlpha = s.alpha;
      lctx.translate(x, y);
      if (s.angle) lctx.rotate(s.angle);
      lctx.drawImage(sprite, -sz / 2, -sz / 2, sz, sz);
      lctx.restore();
    }

    // 3) composite sparkle layer onto base
    ctx.save();
    ctx.globalAlpha = U.clamp(params.intensity != null ? params.intensity : 0.85, 0, 1);
    ctx.globalCompositeOperation = (params.blend === 'lighter') ? 'lighter' : 'screen';
    if (params.hueCycle && !still) {
      ctx.filter = 'hue-rotate(' + A.hueCycle(phase01, params.hueCycleRevs || 1).toFixed(1) + 'deg)';
    } else {
      ctx.filter = 'none';
    }
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
    ctx.filter = 'none';
  }

  SB.render = { render: render, stateOf: stateOf };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
