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

  // Strip quotes/backslashes/control chars so a family name is always safe to
  // drop into a CSS font stack and a canvas font string.
  function cleanFamily(name) {
    return String(name == null ? '' : name).replace(/["'\\\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'My Font';
  }

  // Register a user-loaded font (its FontFace family must already be added to
  // document.fonts, using the same cleaned name). Returns the new id.
  function registerCustom(family) {
    family = cleanFamily(family);
    for (var j = 0; j < CUSTOM.length; j++) if (CUSTOM[j].label === family) return CUSTOM[j].id; // same font re-loaded
    // unique id even when different names normalise to the same slug
    var base = 'custom-' + (family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'font');
    var id = base, n = 1;
    while (CUSTOM.some(function (c) { return c.id === id; })) id = base + '-' + (n++);
    CUSTOM.push({ id: id, label: family, stack: "'" + family + "', sans-serif" });
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

  // Canvas letterSpacing is Chromium 99+ / Safari 17+; everywhere else we draw
  // glyph-by-glyph ourselves so tracking works on any browser.
  var _lsNative = null;
  function letterSpacingNative() {
    if (_lsNative == null) { try { _lsNative = 'letterSpacing' in newCanvas(4, 4).getContext('2d'); } catch (e) { _lsNative = false; } }
    return _lsNative;
  }

  function tintCanvas(src, color, W, H) {
    var t = newCanvas(W, H), tc = t.getContext('2d');
    tc.drawImage(src, 0, 0);
    tc.globalCompositeOperation = 'source-in';
    tc.fillStyle = color; tc.fillRect(0, 0, W, H);
    return t;
  }

  // Normalise outlines to an array (INNERMOST first). Each layer is either a
  // solid colour or a glitter style. Falls back to the legacy outline/outlineColor.
  function normOutlines(o) {
    if (o.outlines && o.outlines.length) {
      return o.outlines.filter(function (l) { return l && l.width > 0; }).map(function (l) {
        var kind = (l.kind === 'glitter' || l.kind === 'texture') ? l.kind : 'color';
        // per-outline glitter overrides (density/grain/intensity) pass through as
        // given; render.js falls back to the global fill values when they're unset.
        return { width: l.width, kind: kind,
                 color: l.color || '#000000', glitter: l.glitter || 'silver',
                 textureId: l.textureId || null,
                 density: l.density, grain: l.grain, intensity: l.intensity };
      });
    }
    if (o.outline > 0) return [{ width: o.outline, kind: 'color', color: o.outlineColor || '#000000' }];
    return [];
  }

  function renderText(o) {
    o = o || {};
    var text = o.text != null && String(o.text).length ? String(o.text) : 'sparkle bitch';
    if (o.caps) text = text.toUpperCase();           // ALL CAPS toggle (render-only)
    var size = o.size || 72;
    var lines = text.split('\n');
    var spacing = o.letterSpacing || 0;              // px between letters (can be negative)
    var nativeLS = letterSpacingNative();
    var leading = o.leading || 1.32;                 // line-spacing multiplier
    // clamp the type size so even pathological input (many long lines) can't
    // request a canvas beyond browser limits (~32k px) and blank the output.
    var MAXDIM = 6000, nLines = lines.length, longest = 1;
    for (var li = 0; li < nLines; li++) longest = Math.max(longest, (lines[li] || '').length);
    size = Math.max(8, Math.min(size,
      Math.floor((MAXDIM - 40) / (nLines * leading + 1)),
      Math.floor((MAXDIM - 40) / (longest * 0.72 + 1))));
    var lineH = Math.ceil(size * leading);
    var align = (o.align === 'left' || o.align === 'right') ? o.align : 'center';
    var outlines = normOutlines(o);
    var totalW = 0; for (var t0 = 0; t0 < outlines.length; t0++) totalW += outlines[t0].width;
    var pad = Math.ceil(size * 0.28) + Math.ceil(totalW) + (o.shadow ? Math.ceil(size * 0.22) : 0) + 8;

    var meas = newCanvas(8, 8).getContext('2d');
    meas.font = fontString(o);
    if (nativeLS) meas.letterSpacing = spacing + 'px';
    // line width: native tracking is included by measureText; in fallback mode
    // we add the per-gap spacing ourselves (no trailing gap after the last glyph)
    function lineWidth(ctx, line) {
      var w = ctx.measureText(line || ' ').width;
      if (spacing && !nativeLS) w += spacing * Math.max(0, (line || '').length - 1);
      return w;
    }
    var maxW = 1;
    for (var i = 0; i < lines.length; i++) maxW = Math.max(maxW, Math.ceil(lineWidth(meas, lines[i])));
    var W = Math.min(maxW + pad * 2, 8000);
    var H = Math.min(lineH * lines.length + pad * 2, 8000);
    var alignX = align === 'left' ? pad : align === 'right' ? (W - pad) : (W / 2);

    function setup(ctx) {
      ctx.font = fontString(o);
      if (nativeLS) ctx.letterSpacing = spacing + 'px';
      ctx.textAlign = align; ctx.textBaseline = 'middle';
    }
    // draw one line honouring letter spacing: natively when the browser can,
    // glyph-by-glyph (code-point safe) otherwise
    function drawLine(ctx, line, x, y, stroke) {
      if (!spacing || nativeLS) { if (stroke) ctx.strokeText(line, x, y); else ctx.fillText(line, x, y); return; }
      var total = lineWidth(ctx, line);
      var pen = align === 'left' ? x : align === 'right' ? x - total : x - total / 2;
      ctx.textAlign = 'left';
      var chars = Array.from(line);
      for (var ci = 0; ci < chars.length; ci++) {
        if (stroke) ctx.strokeText(chars[ci], pen, y); else ctx.fillText(chars[ci], pen, y);
        pen += ctx.measureText(chars[ci]).width + spacing;
      }
      ctx.textAlign = align;
    }
    function eachLine(ctx, fn) { for (var j = 0; j < lines.length; j++) fn(lines[j], alignX, pad + lineH * (j + 0.5)); }

    // fill letterforms
    var maskCanvas = newCanvas(W, H);
    var m = maskCanvas.getContext('2d'); setup(m); m.fillStyle = '#fff';
    eachLine(m, function (line, x, y) { drawLine(m, line, x, y, false); });

    // one mask per outline layer: the letter expanded by the cumulative radius.
    // Rendered outermost-first, inner layers overdraw the middle -> nested bands.
    var layers = [], cum = 0;
    for (var k = 0; k < outlines.length; k++) {
      cum += outlines[k].width;
      var lm = newCanvas(W, H), lc = lm.getContext('2d'); setup(lc);
      lc.fillStyle = '#fff'; lc.strokeStyle = '#fff';
      lc.lineWidth = cum * 2; lc.lineJoin = 'round'; lc.miterLimit = 2;
      eachLine(lc, function (line, x, y) { drawLine(lc, line, x, y, true); });
      eachLine(lc, function (line, x, y) { drawLine(lc, line, x, y, false); });
      layers.push({ mask: lm, kind: outlines[k].kind, color: outlines[k].color, glitter: outlines[k].glitter,
                    textureId: outlines[k].textureId, density: outlines[k].density,
                    grain: outlines[k].grain, intensity: outlines[k].intensity });
    }

    // shadow: a blurred, offset black silhouette of the outermost shape
    var shadowCanvas = null;
    if (o.shadow) {
      var src = layers.length ? layers[layers.length - 1].mask : maskCanvas;
      var sil = tintCanvas(src, '#000000', W, H);
      shadowCanvas = newCanvas(W, H);
      var sc = shadowCanvas.getContext('2d');
      sc.globalAlpha = 0.5;
      if ('filter' in sc) sc.filter = 'blur(' + Math.ceil(size * 0.06) + 'px)';
      var off = Math.ceil(size * 0.06);
      sc.drawImage(sil, off, off);
      sc.filter = 'none'; sc.globalAlpha = 1;
    }

    return { width: W, height: H, maskCanvas: maskCanvas, layers: layers, shadowCanvas: shadowCanvas };
  }

  SB.text = {
    renderText: renderText, fontList: fontList, fontGroups: fontGroups,
    fontString: fontString, fontCss: fontCss, primaryFamily: primaryFamily,
    stackOf: stackOf, registerCustom: registerCustom, cleanFamily: cleanFamily
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
