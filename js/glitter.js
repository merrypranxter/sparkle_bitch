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
                palette: [[255,255,255],[255,225,120],[130,220,255],[255,150,220]] },
    // ---- multi-colour party styles ----
    neon:     { label: 'All Neon',  base: [22, 14, 34],    flake: 'dot',
                palette: [[255,20,147],[0,255,255],[57,255,20],[255,255,0],[255,105,0],[188,19,254],[30,144,255],[255,255,255]] },
    vaporwave:{ label: 'Vaporwave', base: [46, 20, 74],    flake: 'dot',
                palette: [[255,113,206],[1,205,254],[185,103,255],[5,255,161],[255,255,255]] },
    unicorn:  { label: 'Unicorn',   base: [238, 224, 246], flake: 'dot',
                palette: [[255,183,213],[199,178,255],[181,255,214],[255,223,186],[186,225,255]] },
    fire:     { label: 'Fire',      base: [50, 8, 4],      flake: 'dot',
                palette: [[255,60,0],[255,140,0],[255,215,0],[255,255,180],[255,90,20]] },
    mermaid:  { label: 'Mermaid',   base: [8, 44, 54],     flake: 'dot',
                palette: [[64,224,208],[102,255,204],[0,191,255],[148,80,255],[255,255,255]] },
    galaxy:   { label: 'Galaxy',    base: [16, 10, 38],    flake: 'dot',
                palette: [[255,0,204],[138,80,235],[80,120,255],[255,255,255],[255,150,220]] },
    candy:    { label: 'Candy',     base: [255, 205, 230], flake: 'dot',
                palette: [[255,110,180],[130,200,255],[255,240,140],[150,255,200],[255,255,255]] },
    // ---- light-background styles (no white flakes — they'd vanish) ----
    // `light: true` = draw twinkles non-additively with a soft core, so colour
    // survives on a near-white base instead of blowing out to white.
    sugarpaper:{ label: 'Sugar Paper', base: [244, 238, 250], flake: 'dot', light: true,
                palette: [[235,80,150],[120,140,245],[60,190,140],[245,160,60],[175,110,240],[240,90,110]] },
    creamsicle:{ label: 'Creamsicle', base: [255, 240, 222], flake: 'dot', light: true,
                palette: [[245,120,40],[240,80,105],[250,175,70],[225,70,140],[235,150,55]] },
    blueskies: { label: 'Blue Skies', base: [222, 238, 255], flake: 'dot', light: true,
                palette: [[35,105,235],[60,170,250],[15,80,200],[100,195,250],[70,135,245]] },
    rosequartz:{ label: 'Rose Quartz', base: [255, 234, 242], flake: 'dot', light: true,
                palette: [[225,55,130],[245,105,165],[190,40,105],[250,145,190],[215,75,150]] },
    // ---- monochrome sets (shades of one hue) ----
    allpink:  { label: 'All Pink',  base: [120, 14, 64],   flake: 'dot',
                palette: [[255,60,150],[255,110,180],[255,165,205],[220,30,110],[255,200,225]] },
    allblue:  { label: 'All Blue',  base: [12, 34, 104],   flake: 'dot',
                palette: [[70,140,255],[110,190,255],[40,100,235],[160,220,255],[200,240,255]] },
    allpurple:{ label: 'All Purple', base: [52, 18, 96],   flake: 'dot',
                palette: [[140,80,255],[180,130,255],[215,180,255],[110,45,215],[240,225,255]] },
    allgreen: { label: 'All Green', base: [12, 64, 32],    flake: 'dot',
                palette: [[70,220,120],[130,250,160],[35,175,85],[190,255,205],[95,235,135]] },
    // ---- new combos ----
    sherbet:  { label: 'Sherbet',   base: [46, 16, 54],    flake: 'dot',
                palette: [[255,135,90],[255,95,170],[255,215,90],[170,130,255],[255,170,200]] },
    toxic:    { label: 'Toxic',     base: [14, 24, 8],     flake: 'dot',
                palette: [[150,255,0],[0,255,150],[225,255,40],[0,215,120],[190,255,160]] },
    peach:    { label: 'Peach Melba', base: [255, 228, 212], flake: 'dot', light: true,
                palette: [[245,95,70],[250,145,95],[245,65,100],[225,75,50],[250,180,125]] },
    berry:    { label: 'Very Berry', base: [36, 8, 44],    flake: 'dot',
                palette: [[255,60,140],[175,85,255],[255,145,185],[125,65,225],[255,100,170]] },
    sunset:   { label: 'Sunset Strip', base: [40, 10, 36], flake: 'dot',
                palette: [[255,90,60],[255,160,50],[255,70,130],[200,80,220],[255,220,120]] },
    bubblegum:{ label: 'Bubblegum', base: [255, 218, 238], flake: 'dot', light: true,
                palette: [[245,60,160],[250,125,190],[225,40,130],[250,165,210],[185,105,235]] },
    // ---- the classics people keep asking for: a proper red, black, yellow ----
    red:      { label: 'Red',       base: [96, 12, 16],   flake: 'dot',
                palette: [[255,45,45],[225,20,40],[255,95,80],[190,0,25],[255,225,215]] },
    // black glitter = dark grain; the white twinkle cores (Pass B) give it the
    // "black diamond" sparkle. NOT a light-bg style.
    black:    { label: 'Black Diamond', base: [16, 16, 20], flake: 'dot',
                palette: [[70,72,82],[36,36,44],[120,122,134],[180,182,196],[24,24,30]] },
    yellow:   { label: 'Yellow',    base: [140, 108, 8],  flake: 'dot',
                palette: [[255,238,80],[255,216,32],[255,250,170],[232,190,20],[255,255,225]] },
    // ---- a few more fun combos ----
    blackgold:{ label: 'Black & Gold', base: [20, 16, 8], flake: 'dot',
                palette: [[255,205,80],[224,170,50],[255,240,170],[60,60,68],[36,34,30]] },
    emerald:  { label: 'Emerald',   base: [6, 46, 30],    flake: 'dot',
                palette: [[16,190,120],[70,230,150],[0,150,88],[210,255,190],[240,215,120]] },
    copper:   { label: 'Copper',    base: [92, 44, 20],   flake: 'dot',
                palette: [[214,124,66],[255,182,120],[176,92,48],[140,70,36],[255,228,196]] },
    oilslick: { label: 'Oil Slick', base: [12, 12, 20],   flake: 'dot', hueCycle: true,
                palette: [[80,60,200],[40,160,180],[150,60,170],[60,180,120],[200,200,220]] }
  };

  function styleList() {
    var out = [];
    for (var k in STYLES) if (STYLES.hasOwnProperty(k)) out.push({ id: k, label: STYLES[k].label });
    return out;
  }

  // Register (or replace) a user style — the "My palette" entry. Kept last in
  // the picker by convention: the UI appends it after styleList().
  function registerStyle(id, def) {
    STYLES[id] = {
      label: def.label || 'My palette',
      base: def.base || null,
      flake: def.flake || 'dot',
      light: !!def.light,
      palette: def.palette && def.palette.length ? def.palette : [[255, 255, 255]]
    };
    return STYLES[id];
  }

  // Build a seeded flake field for a w x h area at a density (0..2).
  // Positions are normalised so the same field renders at any output size.
  // grain scales flake size: 1 = classic, down to 0.2 for very fine dust.
  // density 0..1 behaves exactly as it always has (11px -> 3.6px spacing);
  // 1..2 packs tighter (down to 1.4px) so fine grain can read as solid glitter.
  function buildField(w, h, styleId, density, seed, grain) {
    var style = STYLES[styleId] || STYLES.silver;
    var rng = U.mulberry32(U.hashSeed(String(seed) + '|' + styleId));
    var d = U.clamp(density, 0, 2);
    var spacing = d <= 1 ? U.lerp(11, 3.6, d) : U.lerp(3.6, 1.4, d - 1);
    var count = Math.min(40000, Math.max(40, Math.round((w * h) / (spacing * spacing))));
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
    return { flakes: flakes, styleId: styleId, style: style, grain: grain || 1 };
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
    // flake size scales with output, then by the user's grain multiplier
    // (grain < 1 => much finer glitter than the classic default)
    var scale = Math.max(0.75, Math.min(w, h) / 300) * (field.grain || 1);
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
    var grainAlpha = overlay ? 0.65 : 0.85;
    for (i = 0; i < flakes.length; i++) {
      f = flakes[i];
      color = hueShift ? U.shiftHue(f.color, hueShift) : f.color;
      var gs = Math.max(0.75, f.size * scale);   // fine grain never goes invisible
      ctx.globalAlpha = grainAlpha;
      ctx.fillStyle = U.rgbToCss(color, 1);
      ctx.fillRect((f.nx * w) - gs / 2, (f.ny * h) - gs / 2, gs, gs);
    }

    // Pass B — twinkling bright highlights on the flakes lit this frame.
    // Light-based styles draw non-additively with a soft core: additive white
    // on a near-white base just blows every flake out to invisible white.
    var lightBg = !!style.light && !overlay;
    ctx.globalCompositeOperation = lightBg ? 'source-over' : 'lighter';
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
        ctx.fillStyle = lightBg
          ? 'rgba(255,255,255,' + (0.4 * st.bright).toFixed(2) + ')'
          : 'rgba(255,255,255,' + (0.5 + 0.5 * st.bright).toFixed(2) + ')';
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
    registerStyle: registerStyle,
    buildField: buildField,
    flakeState: flakeState,
    drawGlitter: drawGlitter
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
