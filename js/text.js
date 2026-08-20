/* Sparkle Bitch — text.js
 * Renders glitter-text letterforms. Produces a white letterform MASK (used to
 * clip the animated glitter fill) plus precomputed OUTLINE and SHADOW layers,
 * all the same size and aligned, so render.js just composites them per frame.
 * Uses system font stacks so the app stays self-contained (no bundled fonts).
 */
(function (global) {
  'use strict';
  var SB = global.SB = global.SB || {};

  var FONTS = {
    fat:     "'Arial Black', Impact, Haettenschweiler, sans-serif",
    rounded: "'Comic Sans MS', 'Chalkboard SE', 'Comic Neue', cursive",
    serif:   "Georgia, 'Times New Roman', serif",
    script:  "'Brush Script MT', 'Segoe Script', 'Snell Roundhand', cursive",
    mono:    "'Courier New', monospace",
    fantasy: "Impact, 'Arial Black', fantasy",
    sans:    "'Segoe UI', system-ui, Arial, sans-serif"
  };

  function fontList() {
    return [
      { id: 'fat', label: 'Fat' }, { id: 'rounded', label: 'Rounded' },
      { id: 'serif', label: 'Serif' }, { id: 'script', label: 'Script' },
      { id: 'fantasy', label: 'Impact' }, { id: 'mono', label: 'Mono' },
      { id: 'sans', label: 'Sans' }
    ];
  }

  function fontString(o) {
    var stack = FONTS[o.font] || FONTS.fat;
    return (o.italic ? 'italic ' : '') + (o.bold ? 'bold ' : '') + (o.size || 72) + 'px ' + stack;
  }

  function newCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  function renderText(o) {
    o = o || {};
    var text = o.text != null && String(o.text).length ? String(o.text) : 'sparkle bitch';
    var size = o.size || 72;
    var outline = o.outline || 0;
    var lines = text.split('\n');
    var lineH = Math.ceil(size * 1.28);
    var pad = Math.ceil(size * 0.3) + outline + (o.shadow ? Math.ceil(size * 0.18) : 0) + 6;

    var meas = newCanvas(8, 8).getContext('2d');
    meas.font = fontString(o);
    if ('letterSpacing' in meas) meas.letterSpacing = (o.letterSpacing || 0) + 'px';
    var maxW = 1;
    for (var i = 0; i < lines.length; i++) maxW = Math.max(maxW, Math.ceil(meas.measureText(lines[i] || ' ').width));
    var W = maxW + pad * 2;
    var H = lineH * lines.length + pad * 2;

    function setup(ctx) {
      ctx.font = fontString(o);
      if ('letterSpacing' in ctx) ctx.letterSpacing = (o.letterSpacing || 0) + 'px';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
    }
    function eachLine(ctx, fn) {
      for (var j = 0; j < lines.length; j++) fn(lines[j], W / 2, pad + lineH * (j + 0.5));
    }

    // letterform mask (solid white)
    var maskCanvas = newCanvas(W, H);
    var m = maskCanvas.getContext('2d'); setup(m); m.fillStyle = '#fff';
    eachLine(m, function (line, x, y) { m.fillText(line, x, y); });

    // outline
    var outlineCanvas = null;
    if (outline > 0) {
      outlineCanvas = newCanvas(W, H);
      var oc = outlineCanvas.getContext('2d'); setup(oc);
      oc.strokeStyle = o.outlineColor || '#000000';
      oc.lineWidth = outline * 2; oc.lineJoin = 'round'; oc.miterLimit = 2;
      eachLine(oc, function (line, x, y) { oc.strokeText(line, x, y); });
    }

    // drop shadow
    var shadowCanvas = null;
    if (o.shadow) {
      shadowCanvas = newCanvas(W, H);
      var sc = shadowCanvas.getContext('2d'); setup(sc);
      sc.fillStyle = 'rgba(0,0,0,0.55)';
      sc.shadowColor = 'rgba(0,0,0,0.55)';
      sc.shadowBlur = Math.ceil(size * 0.14);
      sc.shadowOffsetX = Math.ceil(size * 0.05);
      sc.shadowOffsetY = Math.ceil(size * 0.07);
      eachLine(sc, function (line, x, y) { sc.fillText(line, x, y); });
    }

    return {
      width: W, height: H,
      maskCanvas: maskCanvas, outlineCanvas: outlineCanvas, shadowCanvas: shadowCanvas
    };
  }

  SB.text = { renderText: renderText, fontList: fontList, FONTS: FONTS };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
