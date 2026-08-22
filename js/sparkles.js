/* Sparkle Bitch — sparkles.js
 * Turns detected centres into sparkle "instances", and draws the sprites
 * procedurally (no image assets) into a cache so they can be blitted fast,
 * recoloured and rescaled, every frame.
 */
(function (global) {
  'use strict';
  var SB = global.SB = global.SB || {};
  var U = SB.util;

  var SP = 100;            // sprite canvas size (drawn once, scaled on use)
  var C = SP / 2;
  var cache = {};

  function createCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') {
      try { return new OffscreenCanvas(w, h); } catch (e) {}
    }
    var c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }

  var STYLE_SETS = {
    stars: [['star4', 3], ['star6', 2], ['star8', 2]],
    sparkles: [['sparkle', 3], ['flare', 2], ['star4', 1]],
    hearts: [['heart', 1]],
    icons: [['heart', 2], ['note', 2], ['diamond', 2]],
    butterflies: [['butterfly', 3], ['sparkle', 1]],
    garden: [['flower', 2], ['butterfly', 2], ['heart', 1]],
    bokeh: [['bokeh', 1]],
    mixed: [['star4', 4], ['sparkle', 4], ['star6', 2], ['flare', 2],
            ['heart', 1], ['diamond', 1], ['note', 1]],
    y2k: [['butterfly', 3], ['star8', 2], ['star4', 2], ['heart', 2],
          ['note', 1], ['diamond', 1], ['flower', 1]]
  };

  function pickStyle(set, rng) {
    var total = 0, i;
    for (i = 0; i < set.length; i++) total += set[i][1];
    var r = rng() * total;
    for (i = 0; i < set.length; i++) { r -= set[i][1]; if (r <= 0) return set[i][0]; }
    return set[0][0];
  }

  // ---- shape paths ------------------------------------------------------
  function starPath(ctx, points, outer, inner) {
    ctx.beginPath();
    for (var i = 0; i < points * 2; i++) {
      var rad = (i % 2 === 0) ? outer : inner;
      var a = (Math.PI / points) * i - Math.PI / 2;
      var x = C + Math.cos(a) * rad, y = C + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function heartPath(ctx, s) {
    var x = C, y = C - s * 0.35;
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.25);
    ctx.bezierCurveTo(x, y, x - s * 0.5, y - s * 0.1, x - s * 0.5, y + s * 0.25);
    ctx.bezierCurveTo(x - s * 0.5, y + s * 0.55, x, y + s * 0.8, x, y + s * 1.0);
    ctx.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.55, x + s * 0.5, y + s * 0.25);
    ctx.bezierCurveTo(x + s * 0.5, y - s * 0.1, x, y, x, y + s * 0.25);
    ctx.closePath();
  }

  function butterflyPath(ctx, s) {
    // four wing lobes + body, centred on (C,C)
    ctx.beginPath();   // upper wings
    ctx.ellipse(C - s * 0.48, C - s * 0.30, s * 0.46, s * 0.34, -0.5, 0, 7);
    ctx.ellipse(C + s * 0.48, C - s * 0.30, s * 0.46, s * 0.34, 0.5, 0, 7);
    ctx.fill();
    ctx.beginPath();   // lower wings
    ctx.ellipse(C - s * 0.34, C + s * 0.34, s * 0.30, s * 0.24, 0.5, 0, 7);
    ctx.ellipse(C + s * 0.34, C + s * 0.34, s * 0.30, s * 0.24, -0.5, 0, 7);
    ctx.fill();
    ctx.fillRect(C - s * 0.07, C - s * 0.5, s * 0.14, s * 1.05);   // body
  }

  function flowerPath(ctx, s) {
    for (var i = 0; i < 5; i++) {
      var a = (Math.PI * 2 / 5) * i - Math.PI / 2;
      ctx.beginPath();
      ctx.ellipse(C + Math.cos(a) * s * 0.5, C + Math.sin(a) * s * 0.5, s * 0.34, s * 0.22, a, 0, 7);
      ctx.fill();
    }
    ctx.beginPath(); ctx.arc(C, C, s * 0.22, 0, 7); ctx.fill();
  }

  function drawGlow(ctx, color, glow) {
    var rad = C * (0.55 + 0.45 * glow);
    var g = ctx.createRadialGradient(C, C, 0, C, C, rad);
    var col = U.rgbToCss(color, 1);
    g.addColorStop(0, U.rgbToCss(color, 0.55 * (0.4 + glow)));
    g.addColorStop(0.4, U.rgbToCss(color, 0.22 * (0.4 + glow)));
    g.addColorStop(1, U.rgbToCss(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SP, SP);
  }

  function drawShape(ctx, style, color) {
    var col = U.rgbToCss(color, 1);
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    ctx.lineJoin = 'round';
    switch (style) {
      case 'star6': starPath(ctx, 6, C * 0.82, C * 0.30); ctx.fill(); break;
      case 'star8': starPath(ctx, 8, C * 0.86, C * 0.38); ctx.fill(); break;
      case 'sparkle': starPath(ctx, 4, C * 0.92, C * 0.10); ctx.fill(); break;
      case 'flare':
        // specular cross: horizontal + vertical bright streaks
        ctx.save();
        ctx.translate(C, C);
        var lg = ctx.createLinearGradient(-C, 0, C, 0);
        lg.addColorStop(0, U.rgbToCss(color, 0)); lg.addColorStop(0.5, col);
        lg.addColorStop(1, U.rgbToCss(color, 0));
        ctx.fillStyle = lg; ctx.fillRect(-C, -C * 0.06, SP, C * 0.12);
        var lg2 = ctx.createLinearGradient(0, -C, 0, C);
        lg2.addColorStop(0, U.rgbToCss(color, 0)); lg2.addColorStop(0.5, col);
        lg2.addColorStop(1, U.rgbToCss(color, 0));
        ctx.fillStyle = lg2; ctx.fillRect(-C * 0.06, -C, C * 0.12, SP);
        ctx.restore();
        break;
      case 'heart': heartPath(ctx, C * 0.9); ctx.fill(); break;
      case 'butterfly': butterflyPath(ctx, C * 0.85); break;
      case 'flower': flowerPath(ctx, C * 0.9); break;
      case 'bokeh':
        // soft translucent disc — no hard core, no crisp edge
        var bg = ctx.createRadialGradient(C, C, 0, C, C, C * 0.8);
        bg.addColorStop(0, U.rgbToCss(color, 0.75));
        bg.addColorStop(0.7, U.rgbToCss(color, 0.45));
        bg.addColorStop(1, U.rgbToCss(color, 0));
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.arc(C, C, C * 0.8, 0, 7); ctx.fill();
        // the classic bokeh rim
        ctx.strokeStyle = U.rgbToCss(color, 0.5); ctx.lineWidth = C * 0.07;
        ctx.beginPath(); ctx.arc(C, C, C * 0.62, 0, 7); ctx.stroke();
        break;
      case 'x':
        ctx.save(); ctx.translate(C, C); ctx.rotate(Math.PI / 4);
        ctx.fillRect(-C * 0.8, -C * 0.14, C * 1.6, C * 0.28);
        ctx.fillRect(-C * 0.14, -C * 0.8, C * 0.28, C * 1.6);
        ctx.restore();
        break;
      case 'diamond':
        ctx.beginPath();
        ctx.moveTo(C, C * 0.18); ctx.lineTo(C * 1.55, C); ctx.lineTo(C, C * 1.82);
        ctx.lineTo(C * 0.45, C); ctx.closePath(); ctx.fill(); break;
      case 'note':
        ctx.beginPath(); ctx.ellipse(C * 0.7, C * 1.35, C * 0.28, C * 0.2, -0.4, 0, 7); ctx.fill();
        ctx.fillRect(C * 0.92, C * 0.4, C * 0.13, C * 1.0);
        ctx.beginPath(); ctx.moveTo(C * 0.92, C * 0.4);
        ctx.quadraticCurveTo(C * 1.5, C * 0.5, C * 1.35, C * 0.9);
        ctx.quadraticCurveTo(C * 1.2, C * 0.6, C * 0.92, C * 0.62); ctx.closePath(); ctx.fill();
        break;
      default: /* star4 */ starPath(ctx, 4, C * 0.85, C * 0.24); ctx.fill();
    }
    // bright hot core so sparkles pop under screen/lighter blending
    // (bokeh stays soft — a hard core would ruin it)
    if (style !== 'flare' && style !== 'bokeh') {
      var cr = ctx.createRadialGradient(C, C, 0, C, C, C * 0.3);
      cr.addColorStop(0, 'rgba(255,255,255,0.95)');
      cr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = cr; ctx.beginPath(); ctx.arc(C, C, C * 0.3, 0, 7); ctx.fill();
    }
  }

  function getSprite(style, color, glow) {
    var gb = Math.round(glow * 4);
    var key = style + '|' + U.colorKey(color) + '|' + gb;
    if (cache[key]) return cache[key];
    var cv = createCanvas(SP, SP);
    var ctx = cv.getContext('2d');
    drawGlow(ctx, color, glow);
    drawShape(ctx, style, color);
    cache[key] = cv;
    return cv;
  }

  function clearCache() { cache = {}; }

  // ---- colour modes ------------------------------------------------------
  function pastelize(color) {
    var hsl = U.rgbToHsl(color[0], color[1], color[2]);   // [h, s, l]
    return U.hslToRgb(hsl[0], Math.min(hsl[1], 0.55), Math.max(hsl[2], 0.72));
  }
  function neonize(color) {
    var hsl = U.rgbToHsl(color[0], color[1], color[2]);
    return U.hslToRgb(hsl[0], 1, U.clamp(hsl[2], 0.5, 0.62));
  }

  // ---- instance generation ---------------------------------------------
  // centers: [{nx,ny,size,color,forceColor?}]  (forceColor set for pen pts)
  function build(centers, params, rng) {
    var set = STYLE_SETS[params.styleMix] || STYLE_SETS.mixed;
    var pal = params.palette || [[255, 255, 255]];
    var out = [];
    for (var i = 0; i < centers.length; i++) {
      var c = centers[i];
      var color;
      if (c.forceColor) {
        color = c.forceColor;
      } else if (params.colorMode === 'white') {
        color = [255, 255, 255];
      } else if (params.colorMode === 'single') {
        color = (params.singleColor || [255, 255, 255]).slice();
      } else if (params.colorMode === 'palette') {
        color = pal[(rng() * pal.length) | 0].slice();
      } else { // auto family: inherit local colour, then restyle it
        color = c.color ? c.color.slice() : [255, 255, 255];
        if (params.colorMode === 'complement') color = U.shiftHue(color, 180);
        else if (params.colorMode === 'pastel') color = pastelize(color);
        else if (params.colorMode === 'neon') color = neonize(color);
      }
      if (params.colorBoost && params.colorBoost !== 1) {
        color = U.boostSaturation(color, params.colorBoost);
      }
      out.push({
        nx: c.nx, ny: c.ny,
        baseSize: c.size != null ? c.size : 0.6,
        color: color,
        style: pickStyle(set, rng),
        phase: rng() * Math.PI * 2,
        spinDir: rng() < 0.5 ? -1 : 1,
        wob: 0.7 + rng() * 0.6,   // per-instance twinkle depth variation
        depth: 0.55 + rng() * 0.45, // background layer: smaller, dimmer, slower
        driftPhase: rng()           // where in its float cycle it starts
      });
    }
    return out;
  }

  SB.sparkles = {
    build: build,
    getSprite: getSprite,
    clearCache: clearCache,
    STYLE_SETS: STYLE_SETS,
    SPRITE_SIZE: SP
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
