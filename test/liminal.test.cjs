/* Verifies the Liminal Engine: defaults, preset merging, pixel-level effects,
 * bright-spot detection — and that every motion helper closes the loop
 * (value at phase 0 == phase 1) so exported GIFs never snap at the seam.
 */
'use strict';
const SB = require('../js/util.js');
require('../js/anim.js');
require('../js/liminal.js');

let failures = 0;
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-9);
function assert(cond, msg) { if (!cond) { failures++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); } }

const LIM = SB.liminal;

// --- defaults: every effect off ---
const d0 = LIM.defaults();
const sections = ['breathingZoom', 'scanlines', 'moire', 'chromaticAberration', 'grain',
  'vignette', 'starbursts', 'anamorphic', 'roundedFrame', 'prismatic', 'diffusion', 'colorGrade'];
assert(sections.every(k => d0[k] && d0[k].enabled === false), 'defaults: all effects off');
assert(d0.preset === '', 'defaults: no preset selected');

// --- presets merge over defaults, and are fresh copies ---
const crt = LIM.preset('crt');
assert(crt.preset === 'crt', 'preset: id recorded');
assert(crt.scanlines.enabled && crt.moire.enabled && crt.grain.enabled && crt.vignette.enabled,
  'preset: CRT House enables its stack');
assert(crt.anamorphic.enabled === false && crt.prismatic.enabled === false,
  'preset: untouched effects stay off');
crt.scanlines.density = 0.99;
assert(LIM.preset('crt').scanlines.density !== 0.99, 'preset: returns fresh copies (no shared refs)');
assert(LIM.preset('nope').scanlines.enabled === false, 'preset: unknown id = defaults');
assert(LIM.presetList().length >= 5, 'preset list: 5+ vibes (' + LIM.presetList().length + ')');
assert(LIM.presetList().every(p => p.id && p.label), 'preset list: every vibe has id + label');

// --- motion helpers close the loop ---
assert(near(LIM.breathScale(0, 1), LIM.breathScale(1, 1)), 'breath: closes the loop');
assert(LIM.breathScale(0.5, 1) > 1.03, 'breath: actually breathes mid-loop (' + LIM.breathScale(0.5, 1).toFixed(3) + ')');
let minScale = 99;
for (let i = 0; i <= 40; i++) minScale = Math.min(minScale, LIM.breathScale(i / 40, 2));
assert(minScale >= 1, 'breath: never underscans (min ' + minScale.toFixed(3) + ')');
assert(near(LIM.moireDrift(0) % 3, LIM.moireDrift(1) % 3), 'moiré: drift wraps exactly one period');
assert(LIM.scanOffset(0) === LIM.scanOffset(1), 'scanlines: RGB offset closes');
let offs = {};
for (let i = 0; i < 40; i++) offs[LIM.scanOffset(i / 40)] = 1;
assert(Object.keys(offs).every(o => o === '0' || o === '1' || o === '2'), 'scanlines: offset stays in {0,1,2}');

// --- chromatic aberration: R pulled from the left, B from the right ---
// 40x20, single white vertical stripe at x=20
const W = 40, H = 20;
const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4;
  img.data[i + 3] = 255;
  if (x === 20) { img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; }
}
function chan(im, x, y, c) { return im.data[(y * im.width + x) * 4 + c]; }
const ab = LIM.chromaticAberration(img, 4, 'fullFrame');
assert(chan(ab, 24, 10, 0) === 255 && chan(ab, 20, 10, 0) === 0, 'aberration: red fringe shifted +4px');
assert(chan(ab, 16, 10, 2) === 255 && chan(ab, 20, 10, 2) === 0, 'aberration: blue fringe shifted -4px');
assert(chan(ab, 20, 10, 1) === 255, 'aberration: green channel untouched');
const abEdge = LIM.chromaticAberration(img, 6, 'edge');
assert(chan(abEdge, 20, 10, 0) === 255, 'aberration edge mode: ~no shift near the centre');

// --- color grade ---
function gradedPixel(r, g, b, params) {
  const im = { width: 1, height: 1, data: new Uint8ClampedArray([r, g, b, 255]) };
  LIM.colorGrade(im, params);
  return [im.data[0], im.data[1], im.data[2]];
}
const dark = gradedPixel(10, 10, 10, { liftBlack: 0, sodium: 0.6, prismShift: false });
assert(dark[2] > 10 + 10, 'grade: sodium crushes shadows toward blue (b=' + dark[2] + ')');
const mid = gradedPixel(200, 200, 200, { liftBlack: 0, sodium: 0.6, prismShift: false });
assert(mid[0] > 200 && mid[2] < 200, 'grade: sodium warms the mids (amber push)');
const lifted = gradedPixel(20, 20, 20, { liftBlack: 0.2, sodium: 0, prismShift: false });
assert(lifted[0] === 28, 'grade: liftBlack fades the blacks (20 -> ' + lifted[0] + ')');
const prism = gradedPixel(255, 255, 255, { liftBlack: 0, sodium: 0, prismShift: true });
assert(prism[0] === 255 && prism[2] === 235, 'grade: prismShift splits white toward warm');

// --- bright-spot detection: finds lamps, respects threshold + spacing ---
const SW = 128, SH = 96;
const scene = { width: SW, height: SH, data: new Uint8ClampedArray(SW * SH * 4) };
for (let i = 0; i < scene.data.length; i += 4) scene.data[i + 3] = 255;
function blob(cx, cy, v) {
  for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 4; x <= cx + 4; x++) {
    const i = (y * SW + x) * 4;
    scene.data[i] = scene.data[i + 1] = scene.data[i + 2] = v;
  }
}
blob(56, 40, 255);   // bright lamp
blob(24, 24, 100);   // dim smudge — below a high threshold
const hi = LIM.findBrightSpots(scene, 200, 40);
assert(hi.length === 1 && Math.abs(hi[0].x - 56) <= 16 && Math.abs(hi[0].y - 40) <= 16,
  'spots: finds the bright lamp, not the dim smudge (' + hi.length + ')');
const lo = LIM.findBrightSpots(scene, 90, 30);   // spots are ~36px apart
assert(lo.length === 2, 'spots: lower threshold finds both (' + lo.length + ')');
blob(64, 44, 255);   // second lamp 9px from the first
const close = LIM.findBrightSpots(scene, 200, 40);
assert(close.length === 1, 'spots: minDist merges near-duplicate lamps (' + close.length + ')');

console.log(failures === 0 ? '\nLIMINAL OK' : '\nLIMINAL FAILED (' + failures + ')');
process.exit(failures === 0 ? 0 : 1);
