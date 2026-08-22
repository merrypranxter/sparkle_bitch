/* Sparkle Bitch — presets.js
 * Two named looks. Both are just parameter bundles; every slider still
 * overrides freely afterwards. `defaults()` documents the full param shape.
 */
(function (global) {
  'use strict';
  var SB = global.SB = global.SB || {};

  var PALETTES = {
    // Loud but classic Y2K rainbow (used when colorMode === 'palette').
    classic: [
      [255, 255, 255], [255, 95, 210], [255, 214, 92],
      [120, 230, 255], [180, 120, 255], [140, 255, 170]
    ],
    // Radioactive chrome. Hot pink / cyan / lime / gold / silver / violet.
    astral: [
      [255, 45, 190], [79, 227, 255], [170, 255, 60],
      [255, 210, 70], [235, 235, 245], [190, 90, 255], [255, 120, 40]
    ]
  };

  function defaults() {
    return {
      preset: 'classic',
      intensity: 0.85,     // 0..1 overall strength (alpha of sparkle layer)
      maxSize: 46,         // px, largest sparkle at output resolution
      density: 0.5,        // 0..1 -> detection grid fineness
      glow: 0.6,           // 0..1 halo size/strength
      colorBoost: 1.35,    // saturation multiplier on sparkle colour
      speed: 2,            // twinkle revolutions across one loop (integer)
      styleMix: 'mixed',   // stars | sparkles | hearts | icons | mixed
      colorMode: 'auto',   // auto (inherit) | palette | white
      blend: 'screen',     // 'screen' (gentle) | 'lighter' (additive bloom)
      palette: PALETTES.classic,
      hueCycle: false,
      hueCycleRevs: 1,
      spinRevs: 0,         // sprite rotation revolutions across the loop
      // detection thresholds (on 0..255 luma / sobel scales)
      lumaThreshold: 150,
      contrastThreshold: 60,
      maxPoints: 700,
      seed: 1234,
      // glitter (text fill + optional photo overlay)
      glitterStyle: 'silver',
      glitterDensity: 0.6,
      glitterIntensity: 0.9,
      glitterGrain: 1,       // flake size multiplier; <1 = much finer glitter
      glitterOnImage: false,
      // export animation
      lengthSec: 2,
      fps: 15
    };
  }

  var PRESETS = {
    classic: {
      intensity: 0.85, maxSize: 46, density: 0.45, glow: 0.6,
      colorBoost: 1.3, speed: 2, styleMix: 'mixed', colorMode: 'auto',
      blend: 'screen', palette: PALETTES.classic, hueCycle: false,
      hueCycleRevs: 1, spinRevs: 0,
      lumaThreshold: 155, contrastThreshold: 65, maxPoints: 600
    },
    astral: {
      intensity: 0.9, maxSize: 50, density: 0.66, glow: 0.72,
      colorBoost: 1.7, speed: 3, styleMix: 'mixed', colorMode: 'palette',
      blend: 'lighter', palette: PALETTES.astral, hueCycle: true,
      hueCycleRevs: 1, spinRevs: 1,
      lumaThreshold: 130, contrastThreshold: 50, maxPoints: 900
    }
  };

  // Apply a preset onto an existing params object (keeps seed/length/fps).
  function apply(params, name) {
    var p = PRESETS[name] || PRESETS.classic;
    for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) params[k] = p[k];
    params.preset = name;
    return params;
  }

  SB.presets = {
    PALETTES: PALETTES,
    defaults: defaults,
    apply: apply,
    names: ['classic', 'astral']
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
