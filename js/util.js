/* Sparkle Bitch — util.js
 * Small shared helpers: seeded RNG, math, colour conversions.
 * Written to work in the browser (attaches to window.SB) and in Node
 * (module.exports) so the same code can be unit-tested headless.
 */
(function (global) {
  'use strict';
  var SB = global.SB = global.SB || {};

  // ---- math -------------------------------------------------------------
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function mod(n, m) { return ((n % m) + m) % m; }

  // Deterministic 32-bit PRNG. Returns a function producing floats in [0,1).
  // Same seed -> same stream, which keeps sparkle placement stable across
  // re-renders and across every frame of an animation.
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Hash a string to a 32-bit seed (so a text seed works too).
  function hashSeed(str) {
    str = String(str);
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // ---- colour -----------------------------------------------------------
  function luma(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h * 360, s, l];
  }

  function hslToRgb(h, s, l) {
    h = mod(h, 360) / 360;
    var r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  // Increase saturation of an [r,g,b] without shifting hue. mult >= 1 boosts.
  function boostSaturation(rgb, mult) {
    var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    hsl[1] = clamp(hsl[1] * mult, 0, 1);
    return hslToRgb(hsl[0], hsl[1], hsl[2]);
  }

  // Rotate the hue of an [r,g,b] by `deg` degrees.
  function shiftHue(rgb, deg) {
    var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    return hslToRgb(hsl[0] + deg, hsl[1], hsl[2]);
  }

  function rgbToCss(rgb, a) {
    if (a == null) return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')';
  }
  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // Quantise a colour to a short cache key (4 bits per channel).
  function colorKey(rgb) {
    return ((rgb[0] >> 4) << 8) | ((rgb[1] >> 4) << 4) | (rgb[2] >> 4);
  }

  SB.util = {
    clamp: clamp, lerp: lerp, mod: mod,
    mulberry32: mulberry32, hashSeed: hashSeed,
    luma: luma, rgbToHsl: rgbToHsl, hslToRgb: hslToRgb,
    boostSaturation: boostSaturation, shiftHue: shiftHue,
    rgbToCss: rgbToCss, hexToRgb: hexToRgb, colorKey: colorKey
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
