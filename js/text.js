/* Sparkle Bitch — text.js
 * Renders glitter-text letterforms. Produces a white letterform MASK (used to
 * clip the animated glitter fill) plus precomputed OUTLINE and SHADOW layers,
 * all the same size and aligned, so render.js just composites them per frame.
 *
 * Fonts: web-safe system stacks + a bundled set of open-licensed Y2K fonts
 * (see fonts/fonts.css). Users can also load their own font file at runtime
 * (registerCustom), which appears in the picker under "Your fonts".
 */
(function (global) {
  'use strict';
  var SB = global.SB = global.SB || {};

  // grouped picker: [label, [ [id, label, css-stack], ... ]]
  var GROUPS = [
    ['System', [
      ['arialblack', 'Arial Black', "'Arial Black', Gadget, Impact, sans-serif"],
      ['arial', 'Arial', "Arial, 'Helvetica Neue', Helvetica, sans-serif"],
      ['verdana', 'Verdana', "Verdana, Geneva, sans-serif"],
      ['tahoma', 'Tahoma', "Tahoma, Geneva, sans-serif"],
      ['trebuchet', 'Trebuchet', "'Trebuchet MS', 'Segoe UI', sans-serif"],
      ['georgia', 'Georgia', "Georgia, 'Times New Roman', serif"],
      ['times', 'Times', "'Times New Roman', Times, serif"],
      ['courier', 'Courier', "'Courier New', Courier, monospace"],
      ['comicsans', 'Comic Sans', "'Comic Sans MS', 'Comic Sans', cursive"],
      ['impact', 'Impact', "Impact, Haettenschweiler, sans-serif"],
      ['papyrus', 'Papyrus', "Papyrus, fantasy"]
    ]],
    ['Pixel', [
      ['pressstart', 'Press Start 2P', "'Press Start 2P', monospace"],
      ['silkscreen', 'Silkscreen', "'Silkscreen', monospace"],
      ['vt323', 'VT323 (DOS)', "'VT323', monospace"],
      ['pixelify', 'Pixelify Sans', "'Pixelify Sans', sans-serif"]
    ]],
    ['Techno', [
      ['orbitron', 'Orbitron', "'Orbitron', sans-serif"],
      ['michroma', 'Michroma', "'Michroma', sans-serif"],
      ['audiowide', 'Audiowide', "'Audiowide', sans-serif"],
      ['zendots', 'Zen Dots', "'Zen Dots', sans-serif"],
      ['wallpoet', 'Wallpoet', "'Wallpoet', sans-serif"],
      ['syncopate', 'Syncopate', "'Syncopate', sans-serif"]
    ]],
    ['Bubble', [
      ['baloo', 'Baloo', "'Baloo 2', sans-serif"],
      ['fredoka', 'Fredoka', "'Fredoka', sans-serif"],
      ['bungee', 'Bungee', "'Bungee', sans-serif"],
      ['chewy', 'Chewy', "'Chewy', cursive"],
      ['sniglet', 'Sniglet', "'Sniglet', sans-serif"]
    ]],
    ['Retro', [
      ['monoton', 'Monoton', "'Monoton', cursive"],
      ['bungeeshade', 'Bungee Shade', "'Bungee Shade', sans-serif"]
    ]],
    ['Gothic', [
      ['blackletter', 'Blackletter', "'UnifrakturCook', 'UnifrakturMaguntia', serif"],
      ['pirata', 'Pirata One', "'Pirata One', serif"]
    ]],
    ['Handwriting', [
      ['marker', 'Marker', "'Permanent Marker', cursive"],
      ['rocksalt', 'Rock Salt', "'Rock Salt', cursive"],
      ['shadows', 'Shadows', "'Shadows Into Light', cursive"],
      ['comicneue', 'Comic Neue', "'Comic Neue', 'Comic Sans MS', cursive"]
    ]]
  ];

  var STACKS = {};   // id -> css stack
  (function () { for (var g = 0; g < GROUPS.length; g++) { var fs = GROUPS[g][1]; for (var i = 0; i < fs.length; i++) STACKS[fs[i][0]] = fs[i][2]; } })();
  // legacy ids from earlier versions, kept so old references still resolve
  var ALIAS = { fat: 'arialblack', rounded: 'comicsans', serif: 'georgia', script: 'comicneue', mono: 'courier', fantasy: 'impact', sans: 'arial' };
  var CUSTOM = [];   // { id, label, stack }

  function stackOf(id) {
    if (STACKS[id]) return STACKS[id];
    if (ALIAS[id] && STACKS[ALIAS[id]]) return STACKS[ALIAS[id]];
    for (var i = 0; i < CUSTOM.length; i++) if (CUSTOM[i].id === id) return CUSTOM[i].stack;
    return STACKS.arialblack;
  }

  function fontGroups() {
    var out = GROUPS.map(function (g) { return { label: g[0], fonts: g[1].map(function (f) { return { id: f[0], label: f[1] }; }) }; });
    if (CUSTOM.length) out.push({ label: 'Your fonts', fonts: CUSTOM.map(function (c) { return { id: c.id, label: c.label }; }) });
    return out;
  }
  function fontList() { var o = []; fontGroups().forEach(function (g) { g.fonts.forEach(function (f) { o.push(f); }); }); return o; }

  // Register a user-loaded font (its FontFace family must already be added to
  // document.fonts). Returns the new id.
  function registerCustom(family) {
    var id = 'custom-' + family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (!CUSTOM.some(function (c) { return c.id === id; })) {
      CUSTOM.push({ id: id, label: family, stack: "'" + family + "', sans-serif" });
    }
    return id;
  }

  function fontString(o) {
    return (o.italic ? 'italic ' : '') + (o.bold ? 'bold ' : '') + (o.size || 72) + 'px ' + stackOf(o.font);
  }
  // the primary family of a stack (what actually needs loading)
  function primaryFamily(id) {
    var s = stackOf(id);
    var m = s.match(/^\s*'([^']+)'/) || s.match(/^\s*"([^"]+)"/) || s.match(/^\s*([^,]+)/);
    return m ? m[1].trim() : s;
  }
  // shorthand for document.fonts.load()/check() — targets the primary family
  function fontCss(o) { return (o.bold ? 'bold ' : '') + '64px "' + primaryFamily(o.font) + '"'; }

  function newCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  function renderText(o) {
    o = o || {};
    var text = o.text != null && String(o.text).length ? String(o.text) : 'sparkle bitch';
    var size = o.size || 72;
    var outline = o.outline || 0;
    var lines = text.split('\n');
    var lineH = Math.ceil(size * 1.32);
    var pad = Math.ceil(size * 0.35) + outline + (o.shadow ? Math.ceil(size * 0.18) : 0) + 8;

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
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    }
    function eachLine(ctx, fn) { for (var j = 0; j < lines.length; j++) fn(lines[j], W / 2, pad + lineH * (j + 0.5)); }

    var maskCanvas = newCanvas(W, H);
    var m = maskCanvas.getContext('2d'); setup(m); m.fillStyle = '#fff';
    eachLine(m, function (line, x, y) { m.fillText(line, x, y); });

    var outlineCanvas = null;
    if (outline > 0) {
      outlineCanvas = newCanvas(W, H);
      var oc = outlineCanvas.getContext('2d'); setup(oc);
      oc.strokeStyle = o.outlineColor || '#000000';
      oc.lineWidth = outline * 2; oc.lineJoin = 'round'; oc.miterLimit = 2;
      eachLine(oc, function (line, x, y) { oc.strokeText(line, x, y); });
    }

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

    return { width: W, height: H, maskCanvas: maskCanvas, outlineCanvas: outlineCanvas, shadowCanvas: shadowCanvas };
  }

  SB.text = {
    renderText: renderText, fontList: fontList, fontGroups: fontGroups,
    fontString: fontString, fontCss: fontCss, primaryFamily: primaryFamily,
    stackOf: stackOf, registerCustom: registerCustom
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
