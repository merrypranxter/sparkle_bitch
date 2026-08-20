/* Sparkle Bitch — glitter.js
 * The "dry glitter" engine: a dense field of tiny flakes that flash and
 * twinkle, looping cleanly. Used to fill glitter TEXT and to lay animated
 * glitter over photos (Glitterfy / MySpace / Picasion style).
 *
 * Loop-safe by construction: each flake blinks an INTEGER number of times per
 * loop, so its state at phase 0 equals its state at phase 1 (no GIF snap).
 * flakeState() is pure (no canvas), so it is unit-tested in Node.
 */
(function (global) {
  'use strict';
  var SB = global.SB = global.SB || {};
  var U = SB.util, A = SB.anim;

  // base = tint painted under the flakes (glitter TEXT fill); null = flakes only
  // (photo overlay). flake = 'dot' | 'star' | 'heart'. hueCycle animates hue.
  // base = medium tint of the letter fill; grain specks (palette) sit on top,
  // brighter, densely, so it reads as packed glitter. flake shape for stars/hearts.
  var STYLES = {
    silver:   { label: 'Silver',    base: [120, 124, 140], flake: 'dot',
                palette: [[255,255,255],[210,214,224],[168,174,190],[236,240,248]] },
    gold:     { label: 'Gold',      base: [150, 108, 32],  flake: 'dot',
                palette: [[255,240,170],[255,205,80],[224,170,50],[255,255,220]] },
    rose:     { label: 'Rose Gold', base: [176, 96, 92],   flake: 'dot',
                palette: [[255,220,214],[255,170,160],[240,150,150],[255,240,236]] },
    chrome:   { label: 'Chrome',    base: [110, 124, 150], flake: 'dot',
                palette: [[255,255,255],[190,205,225],[140,160,190],[225,235,250]] },
    rainbow:  { label: 'Rainbow',   base: [70, 46, 96],    flake: 'dot', hueCycle: true,
                palette: [[255,110,190],[110,200,255],[170,255,120],[255,230,110],[200,130,255],[255,255,255]] },
    confetti: { label: 'Confetti',  base: [34, 28, 46],    flake: 'dot',
                palette: [[255,70,150],[80,220,255],[180,255,70],[255,210,80],[200,120,255],[255,255,255]] },
    pink:     { label: 'Hot Pink',  base: [190, 40, 130],  flake: 'dot',
                palette: [[255,150,225],[255,90,200],[255,225,245],[255,255,255]] },
    cyan:     { label: 'Cyan',      base: [30, 130, 170],  flake: 'dot',
                palette: [[190,245,255],[90,225,255],[255,255,255],[130,235,255]] },
    lime:     { label: 'Lime',      base: [92, 150, 34],   flake: 'dot',
                palette: [[210,255,140],[160,245,70],[255,255,255],[190,255,110]] },
    purple:   { label: 'Purple',    base: [96, 52, 168],   flake: 'dot',
                palette: [[210,170,255],[180,120,250],[255,255,255],[160,110,240]] },
    hearts:   { label: 'Hearts',    base: [200, 60, 140],  flake: 'heart',
                palette: [[255,150,220],[255,100,190],[255,225,240],[255,255,255]] },
    stars:    { label: 'Stars',     base: [150, 100, 26],  flake: 'star',
                palette: [[255,255,255],[255,225,120],[130,220,255],[255,150,220]] }
  };

  function styleList() {
    var out = [];
    for (var k in STYLES) if (STYLES.hasOwnProperty(k)) out.push({ id: k, label: STYLES[k].label });
    return out;
  }

  // Build a seeded flake field for a w x h area at a density (0..1).
  // Positions are normalised so the same field renders at any output size.
  function buildField(w, h, styleId, density, seed) {
    var style = STYLES[styleId] || STYLES.silver;
    var rng = U.mulberry32(U.hashSeed(String(seed) + '|' + styleId));
    var spacing = U.lerp(11, 3.6, U.clamp(density, 0, 1));
    var count = Math.min(16000, Math.max(40, Math.round((w * h) / (spacing * spacing))));
    var cyc = [2, 3, 4, 5, 6];
    var flakes = new Array(count);
    for (var i = 0; i < count; i++) {
      var col = style.palette[(rng() * style.palette.length) | 0];
      flakes[i] = {
        nx: rng(), ny: rng(),
        color: col,
        size: 1 + rng() * 2.2,
        cycles: cyc[(rng() * cyc.length) | 0],
        phase: rng(),
        duty: 0.28 + rng() * 0.22
      };
    }
    return { flakes: flakes, styleId: styleId, style: style };
  }

  // PURE: brightness of a flake at a given loop phase. Triangle pulse inside a
  // duty window; integer cycles => value at phase 0 == value at phase 1.
  function flakeState(flake, phase01) {
    var t = (flake.cycles * phase01 + flake.phase) % 1;
    if (t < 0) t += 1;
    var duty = flake.duty || 0.35;
    var bright = 0;
    if (t < duty) bright = 1 - Math.abs(t / duty - 0.5) * 2; // 0->1->0 across the window
    return { lit: bright > 0.02, bright: bright };
  }

  // Draw the glitter field onto ctx (w x h). opts.base paints the style tint
  // first (for TEXT fill); omit for a transparent photo overlay. Flakes are
  // added with 'lighter' so they bloom.
  function drawGlitter(ctx, field, phase01, opts) {
    opts = opts || {};
    var w = opts.w || ctx.canvas.width, h = opts.h || ctx.canvas.height;
    var style = field.style;
    var scale = Math.max(0.75, Math.min(w, h) / 300); // flake size scales with output
    var hueShift = style.hueCycle ? A.hueCycle(phase01, 1) : 0;
    var flakes = field.flakes;
    var useSprite = style.flake === 'star' || style.flake === 'heart';
    var spriteName = style.flake === 'heart' ? 'heart' : 'star4';
    var overlay = opts.base === false; // photo overlay vs. text fill
    var i, f, color, x, y;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // base tint fill (text letter fill; skipped for a photo overlay)
    if (!overlay && style.base) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = U.rgbToCss(style.base, 1);
      ctx.fillRect(0, 0, w, h);
    }

    // Pass A — dense colour grain: the packed-glitter texture. Opaque for text
    // (a solid glittery fill), additive for overlay (a sparkly sheen on the photo).
    ctx.globalCompositeOperation = overlay ? 'lighter' : 'source-over';
    var grainAlpha = overlay ? 0.5 : 0.85;
    for (i = 0; i < flakes.length; i++) {
      f = flakes[i];
      color = hueShift ? U.shiftHue(f.color, hueShift) : f.color;
      var gs = f.size * scale;
      ctx.globalAlpha = grainAlpha;
      ctx.fillStyle = U.rgbToCss(color, 1);
      ctx.fillRect((f.nx * w) - gs / 2, (f.ny * h) - gs / 2, gs, gs);
    }

    // Pass B — twinkling bright highlights on the flakes lit this frame.
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < flakes.length; i++) {
      f = flakes[i];
      var st = opts.still
        ? { lit: true, bright: 0.35 + 0.65 * ((f.phase * 7.13) % 1) }
        : flakeState(f, phase01);
      if (!st.lit || st.bright < 0.05) continue;
      color = hueShift ? U.shiftHue(f.color, hueShift) : f.color;
      x = f.nx * w; y = f.ny * h;
      var sz = f.size * scale * (1.1 + 0.8 * st.bright);
      ctx.globalAlpha = st.bright;
      if (useSprite && SB.sparkles) {
        var sp = SB.sparkles.getSprite(spriteName, color, 0.3);
        var d = sz * 3.4;
        ctx.drawImage(sp, x - d / 2, y - d / 2, d, d);
      } else {
        ctx.fillStyle = U.rgbToCss(color, 1);
        ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
        ctx.fillStyle = 'rgba(255,255,255,' + (0.5 + 0.5 * st.bright).toFixed(2) + ')';
        var c = sz * 0.5;
        ctx.fillRect(x - c / 2, y - c / 2, c, c);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  SB.glitter = {
    STYLES: STYLES,
    styleList: styleList,
    buildField: buildField,
    flakeState: flakeState,
    drawGlitter: drawGlitter
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
