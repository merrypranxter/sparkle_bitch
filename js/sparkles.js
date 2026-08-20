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
    stars: [['star4', 3], ['star6', 2]],
    sparkles: [['sparkle', 3], ['flare', 2], ['star4', 1]],
    hearts: [['heart', 1]],
    icons: [['heart', 2], ['note', 2], ['diamond', 2]],
    mixed: [['star4', 4], ['sparkle', 4], ['star6', 2], ['flare', 2],
            ['heart', 1], ['diamond', 1], ['note', 1]]
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
    if (style !== 'flare') {
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
      } else if (params.colorMode === 'palette') {
        color = pal[(rng() * pal.length) | 0].slice();
      } else { // auto: inherit local colour
        color = c.color ? c.color.slice() : [255, 255, 255];
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
        wob: 0.7 + rng() * 0.6   // per-instance twinkle depth variation
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
