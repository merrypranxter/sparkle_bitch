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
  'vignette', 'starbursts', 'anamorphic', 'roundedFrame', 'prismatic', 'diffusion', 'colorGrade',
  'ringBokeh', 'chromaAura', 'isoGrain', 'stuckPixels', 'rollingShutter', 'halftone', 'cmyk',
  'photocopy', 'fax', 'photoLab',
  'shear', 'astigmatism', 'contours', 'gravityWells',
  'dayNight', 'ghostTrails', 'shadowDrift', 'brownout',
  'burnIn', 'windowDrag', 'dialogGhost', 'cursorTrail',
  'pareidolia', 'denoiseBlocks', 'semanticMelt', 'latentGrid'];
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

// --- new vibe presets wire up their stacks ---
const faxP = LIM.preset('fax2003');
assert(faxP.preset === 'fax2003' && faxP.fax.enabled && faxP.halftone.enabled && faxP.scanlines.enabled,
  'preset: Office Fax 2003 enables fax + halftone + scanlines');
assert(faxP.isoGrain.enabled === false && faxP.photoLab.enabled === false,
  'preset: fax keeps the optics stack off');
const ml = LIM.preset('mirrorlens');
assert(ml.ringBokeh.enabled && ml.chromaAura.enabled && ml.isoGrain.enabled && ml.stuckPixels.enabled &&
  ml.rollingShutter.enabled && ml.diffusion.enabled,
  'preset: Mirror-Lens Motel enables its full stack');
assert(LIM.presetList().length >= 7, 'preset list: 7+ vibes (' + LIM.presetList().length + ')');

// --- ISO push grain: shadows get slammed, highlights stay clean, deterministic ---
const GW = 60, GH = 20;
function grayImg(v, lohi) {
  const im = { width: GW, height: GH, data: new Uint8ClampedArray(GW * GH * 4) };
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = (y * GW + x) * 4, vv = x < GW / 2 ? lohi[0] : lohi[1];
    im.data[i] = im.data[i + 1] = im.data[i + 2] = vv; im.data[i + 3] = 255;
  }
  return im;
}
function halfVariance(im, leftHalf) {
  const vals = [];
  for (let y = 0; y < im.height; y++) for (let x = leftHalf ? 0 : GW / 2; x < (leftHalf ? GW / 2 : GW); x++)
    vals.push(im.data[(y * GW + x) * 4]);
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  return vals.reduce((a, b) => a + (b - m) * (b - m), 0) / vals.length;
}
const ig1 = grayImg(0, [10, 240]), ig2 = grayImg(0, [10, 240]);
LIM.isoGrain(ig1, 1, 0.3, 7); LIM.isoGrain(ig2, 1, 0.3, 7);
assert(Buffer.from(ig1.data).equals(Buffer.from(ig2.data)), 'isoGrain: deterministic for same seed+phase');
const vDark = halfVariance(ig1, true), vBright = halfVariance(ig1, false);
assert(vDark > vBright * 3, 'isoGrain: shadows far noisier than highlights (' + vDark.toFixed(0) + ' vs ' + vBright.toFixed(0) + ')');
const ig3 = grayImg(0, [10, 240]);
LIM.isoGrain(ig3, 1, 0.55, 7);
assert(!Buffer.from(ig1.data).equals(Buffer.from(ig3.data)), 'isoGrain: noise field changes with phase');

// --- halftone: darks darker, brights brighter, grid drift closes the loop ---
function uniImg(v, s) {
  const im = { width: s, height: s, data: new Uint8ClampedArray(s * s * 4) };
  for (let i = 0; i < im.data.length; i += 4) { im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
  return im;
}
function mean(im) {
  let m = 0;
  for (let i = 0; i < im.data.length; i += 4) m += im.data[i];
  return m / (im.data.length / 4);
}
const htDark = uniImg(30, 24);
LIM.halftone(htDark, 6, 1, 0);
assert(mean(htDark) < 30, 'halftone: dark tones get darker (' + mean(htDark).toFixed(1) + ')');
const htBright = uniImg(230, 24);
LIM.halftone(htBright, 6, 1, 0);
assert(mean(htBright) > 230, 'halftone: bright tones get brighter (' + mean(htBright).toFixed(1) + ')');
const htA = uniImg(120, 24), htB = uniImg(120, 24);
LIM.halftone(htA, 6, 1, 0); LIM.halftone(htB, 6, 1, 1);
assert(Buffer.from(htA.data).equals(Buffer.from(htB.data)), 'halftone: drift wraps exactly one cell per loop');

// --- CMYK misregistration: plates slip in different directions ---
const cm = LIM.cmykMisreg(img, 2); // reuse the 40x20 white-stripe-at-x=20 image
assert(chan(cm, 22, 10, 0) === 255 && chan(cm, 20, 10, 0) === 0, 'cmyk: red plate slipped +2px');
assert(chan(cm, 18, 10, 1) === 255 && chan(cm, 20, 10, 1) === 0, 'cmyk: green plate slipped -2px');
assert(chan(cm, 18, 10, 2) === 0 && chan(cm, 20, 10, 2) === 255, 'cmyk: blue plate keeps its x (vertical slip only)');

// --- fax mode: bilevel output, dropout rows go white ---
const FW = 32, FH = 32;
const faxImg = { width: FW, height: FH, data: new Uint8ClampedArray(FW * FH * 4) };
for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
  const i = (y * FW + x) * 4, v = (x / FW) * 255;
  faxImg.data[i] = faxImg.data[i + 1] = faxImg.data[i + 2] = v; faxImg.data[i + 3] = 255;
}
LIM.faxMode(faxImg, 128, 0, 0, 5);
let bilevel = true;
for (let i = 0; i < faxImg.data.length; i += 4)
  if (faxImg.data[i] !== 25 && faxImg.data[i] !== 245) bilevel = false;
assert(bilevel, 'fax: output is strictly bilevel (25/245)');
assert(chan(faxImg, 31, 16, 0) === 245 && chan(faxImg, 0, 16, 0) === 25, 'fax: bright end white, dark end black');
const faxDrop = { width: FW, height: FH, data: new Uint8ClampedArray(faxImg.data) };
LIM.faxMode(faxDrop, 128, 1, 0, 5);
let whiteRows = 0;
for (let y = 0; y < FH; y++) {
  let allWhite = true;
  for (let x = 0; x < FW; x++) if (chan(faxDrop, x, y, 0) !== 245) { allWhite = false; break; }
  if (allWhite) whiteRows++;
}
assert(whiteRows >= 5, 'fax: heavy dropouts whiten whole rows (' + whiteRows + '/' + FH + ')');

// --- photo lab chemistry ---
function labPixel(r, g, b, recipe, amount, phase) {
  const im = { width: 1, height: 1, data: new Uint8ClampedArray([r, g, b, 255]) };
  LIM.photoLab(im, recipe, amount, phase || 0);
  return [im.data[0], im.data[1], im.data[2]];
}
const bl = labPixel(200, 60, 60, 'bleach', 1, 0);
assert(bl[0] - bl[1] < 78, 'photoLab bleach: saturation crushed (r-g ' + (200 - 60) + ' -> ' + (bl[0] - bl[1]) + ')');
const blDark = labPixel(40, 40, 40, 'bleach', 1, 0);
assert(blDark[0] < 40, 'photoLab bleach: contrast crushes shadows (40 -> ' + blDark[0] + ')');
const solHi = labPixel(200, 200, 200, 'solarize', 1, 0); // solT ~= 89 at phase 0
assert(solHi[0] === 55, 'photoLab solarize: highlights invert above threshold (200 -> ' + solHi[0] + ')');
const solLo = labPixel(40, 40, 40, 'solarize', 1, 0);
assert(solLo[0] === 40, 'photoLab solarize: shadows untouched');
const solA = labPixel(200, 200, 200, 'solarize', 1, 0), solB = labPixel(200, 200, 200, 'solarize', 1, 1);
assert(solA[0] === solB[0], 'photoLab solarize: threshold closes the loop');
const cw = labPixel(30, 30, 30, 'crossWarm', 1, 0);
assert(cw[2] > 30 + 15, 'photoLab crossWarm: cyan shadows (b=' + cw[2] + ')');
const ct = labPixel(220, 220, 220, 'crossToxic', 1, 0);
assert(ct[2] > 220 && ct[1] < 220, 'photoLab crossToxic: magenta highlights');
const lomo = labPixel(100, 150, 100, 'lomo', 1, 0);
assert(lomo[1] - lomo[0] > 50, 'photoLab lomo: saturation stretched (g-r=' + (lomo[1] - lomo[0]) + ')');
const halfK = labPixel(200, 60, 60, 'bleach', 0.5, 0);
assert(Math.abs(halfK[0] - 200) < Math.abs(bl[0] - 200) || halfK[0] !== bl[0], 'photoLab: amount blends toward the recipe');

// --- stuck pixels: deterministic, adds hot pixels, blinking closes the loop ---
const SP = 64;
const spBase = { width: SP, height: SP, data: new Uint8ClampedArray(SP * SP * 4) };
for (let i = 0; i < spBase.data.length; i += 4) { spBase.data[i] = spBase.data[i + 1] = spBase.data[i + 2] = 128; spBase.data[i + 3] = 255; }
function hotCount(im) {
  let n = 0;
  for (let i = 0; i < im.data.length; i += 4) if (im.data[i] > 240 || im.data[i + 2] > 240) n++;
  return n;
}
const sp1 = { width: SP, height: SP, data: new Uint8ClampedArray(spBase.data) };
const sp2 = { width: SP, height: SP, data: new Uint8ClampedArray(spBase.data) };
LIM.stuckPixels(sp1, 40, false, 0.75, 5); LIM.stuckPixels(sp2, 40, false, 0.75, 5);
assert(Buffer.from(sp1.data).equals(Buffer.from(sp2.data)), 'stuckPixels: deterministic for same seed+phase');
assert(hotCount(sp1) > 10, 'stuckPixels: hot pixels appear at high blink phase (' + hotCount(sp1) + ')');
const spA = { width: SP, height: SP, data: new Uint8ClampedArray(spBase.data) };
const spB = { width: SP, height: SP, data: new Uint8ClampedArray(spBase.data) };
LIM.stuckPixels(spA, 40, false, 0, 5); LIM.stuckPixels(spB, 40, false, 1, 5);
assert(Buffer.from(spA.data).equals(Buffer.from(spB.data)), 'stuckPixels: blinking closes the loop');
const spCol = { width: SP, height: SP, data: new Uint8ClampedArray(spBase.data) };
LIM.stuckPixels(spCol, 0, true, 0, 5);
let colDiff = false;

// --- dominantColor: coarse scene average ---
const dom = LIM.dominantColor({ width: 4, height: 4, data: new Uint8ClampedArray([200, 40, 40, 255].concat(new Array(60).fill(0))) });
assert(Array.isArray(dom) && dom.length === 3, 'dominantColor: returns [r,g,b]');

// --- geometry/time vibe presets wire up their stacks ---
const vt = LIM.preset('vertigo');
assert(vt.preset === 'vertigo' && vt.shear.enabled && vt.gravityWells.enabled &&
  vt.astigmatism.enabled && vt.contours.enabled && vt.breathingZoom.enabled,
  'preset: Vertigo Relay enables shear + wells + astigmatism + contours');
assert(vt.dayNight.enabled === false && vt.brownout.enabled === false,
  'preset: vertigo keeps the time stack off');
const tw = LIM.preset('twilight');
assert(tw.preset === 'twilight' && tw.dayNight.enabled && tw.brownout.enabled &&
  tw.shadowDrift.enabled && tw.ghostTrails.enabled,
  'preset: Terminal Twilight enables day-night + brownout + shadows + ghosts');
assert(LIM.presetList().length >= 9, 'preset list: 9+ vibes (' + LIM.presetList().length + ')');

// --- contours: band boundaries get inked, crawl wraps one band per loop ---
// horizontal luma ramp 0..255 across 32px, 8 bands of ~31.9 luma each
const CW = 32, CH = 8;
function rampImg() {
  const im = { width: CW, height: CH, data: new Uint8ClampedArray(CW * CH * 4) };
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    const i = (y * CW + x) * 4, v = (x / (CW - 1)) * 255;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255;
  }
  return im;
}
const co1 = rampImg();
LIM.contours(co1, 8, 1, 0);
let inked = 0;
for (let x = 0; x < CW; x++) {
  const v = (x / (CW - 1)) * 255;
  if (chan(co1, x, 4, 0) < v - 10) inked++;
}
assert(inked >= 5, 'contours: band boundaries inked across the ramp (' + inked + '/' + CW + ' columns)');
const coMid = rampImg();
LIM.contours(coMid, 8, 1, 0);
const midV = (16 / 31) * 255; // ~131.6, deep inside band 4 -> not inked
assert(chan(coMid, 16, 4, 0) === Math.round(midV) || chan(coMid, 16, 4, 0) >= midV - 2,
  'contours: mid-band pixels untouched (' + chan(coMid, 16, 4, 0) + ' vs ' + midV.toFixed(1) + ')');
const coA = rampImg(), coB = rampImg();
LIM.contours(coA, 8, 1, 0); LIM.contours(coB, 8, 1, 1);
assert(Buffer.from(coA.data).equals(Buffer.from(coB.data)), 'contours: crawl wraps exactly one band per loop');

// --- gravity wells: pinches pixels near the well, far pixels untouched ---
const WW = 40, WH = 40;
const wellSrc = { width: WW, height: WH, data: new Uint8ClampedArray(WW * WH * 4) };
for (let i = 0; i < wellSrc.data.length; i += 4) {
  wellSrc.data[i] = 128; wellSrc.data[i + 1] = 128; wellSrc.data[i + 2] = 128; wellSrc.data[i + 3] = 255;
}
const wl1 = LIM.gravityWells(wellSrc, 2, 0.8, 0.25, 9);
const wl2 = LIM.gravityWells(wellSrc, 2, 0.8, 0.25, 9);
assert(Buffer.from(wl1.data).equals(Buffer.from(wl2.data)), 'gravityWells: deterministic for same seed+phase');
const wlA = LIM.gravityWells(wellSrc, 2, 0.8, 0, 9);
const wlB = LIM.gravityWells(wellSrc, 2, 0.8, 1, 9);
assert(Buffer.from(wlA.data).equals(Buffer.from(wlB.data)), 'gravityWells: orbits close the loop');
// corners are outside every well's reach (wells live in the central 56%)
assert(wl1.data[0] === 128 && chan(wl1, WW - 1, WH - 1, 0) === 128,
  'gravityWells: far corners untouched');
// put wells at a known place: seed 9 well 0 sits near cx=(0.22+r*0.56)*40 — just
// verify SOME displacement happens on a gradient source instead of grey flat
const grad = rampImg(); grad.width = CW; // reuse 32x8 ramp
const gwGrad = LIM.gravityWells(grad, 3, 1, 0.4, 4);
let moved = false;
for (let x = 2; x < CW - 2; x++)
  if (Math.abs(chan(gwGrad, x, 4, 0) - chan(grad, x, 4, 0)) > 4) { moved = true; break; }
assert(moved, 'gravityWells: strong wells visibly remap the ramp');

// --- dayNight: noon is warm, midnight is cold + dim, loop closes ---
function dnPixel(r, g, b, amount, phase) {
  const im = { width: 1, height: 1, data: new Uint8ClampedArray([r, g, b, 255]) };
  LIM.dayNight(im, amount, phase);
  return [im.data[0], im.data[1], im.data[2]];
}
const noon = dnPixel(140, 140, 140, 1, 0);
assert(noon[0] > 140 && noon[2] < 140, 'dayNight: noon warms the scene (r=' + noon[0] + ', b=' + noon[2] + ')');
const midnight = dnPixel(140, 140, 140, 1, 0.5);
assert(midnight[2] > midnight[0], 'dayNight: midnight turns blue (b=' + midnight[2] + ' > r=' + midnight[0] + ')');
const noonMean = (noon[0] + noon[1] + noon[2]) / 3;
const midMean = (midnight[0] + midnight[1] + midnight[2]) / 3;
assert(midMean < noonMean * 0.8, 'dayNight: midnight is much dimmer (' + midMean.toFixed(0) + ' vs ' + noonMean.toFixed(0) + ')');
const dnA = dnPixel(140, 140, 140, 1, 0), dnB = dnPixel(140, 140, 140, 1, 1);
assert(dnA[0] === dnB[0] && dnA[2] === dnB[2], 'dayNight: closes the loop');

// --- brownout: sags twice per loop, flicker deterministic, loop closes ---
function boMean(v, depth, flicker, phase, seed) {
  const im = uniImg(v, 8);
  LIM.brownout(im, depth, flicker, phase, seed);
  return mean(im);
}
const boFull = boMean(200, 0.8, false, 0, 5);
assert(boFull === 200, 'brownout: no sag at phase 0 (' + boFull + ')');
const boSag = boMean(200, 0.8, false, 0.25, 5);
assert(boSag < 200 * 0.5, 'brownout: deep sag at quarter loop (200 -> ' + boSag.toFixed(1) + ')');
const boEnd = boMean(200, 0.8, false, 1, 5);
assert(boEnd === 200, 'brownout: closes the loop at phase 1');
const boF1 = boMean(200, 0.8, true, 0.3, 5), boF2 = boMean(200, 0.8, true, 0.3, 5);
assert(boF1 === boF2, 'brownout: flicker is deterministic for same seed');
const boNoF = boMean(200, 0, true, 0.3, 5);
assert(boNoF < 200, 'brownout: flicker still shimmers at zero depth (' + boNoF.toFixed(1) + ')');

// --- os residue + ai hallucination vibe presets wire up their stacks ---
const ph = LIM.preset('phantom');
assert(ph.preset === 'phantom' && ph.burnIn.enabled && ph.windowDrag.enabled &&
  ph.dialogGhost.enabled && ph.cursorTrail.enabled,
  'preset: Phantom Desktop enables burn-in + windows + dialog + cursor');
assert(ph.pareidolia.enabled === false && ph.semanticMelt.enabled === false,
  'preset: phantom keeps the hallucination stack off');
const la = LIM.preset('latent');
assert(la.preset === 'latent' && la.pareidolia.enabled && la.denoiseBlocks.enabled &&
  la.semanticMelt.enabled && la.latentGrid.enabled,
  'preset: Latent Dream enables faces + denoise + melt + pixelation');
assert(LIM.presetList().length >= 11, 'preset list: 11+ vibes (' + LIM.presetList().length + ')');

// --- semanticMelt: columns droop downward, deterministic, loop closes ---
// vertical gradient (luma rises with y): a downward droop darkens the bottom
function vGradImg(w, h) {
  const im = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, v = Math.round((y / (h - 1)) * 240);
    im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255;
  }
  return im;
}
function bandMean(im, y0, y1) {
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < im.width; x++) { s += im.data[(y * im.width + x) * 4]; n++; }
  return s / n;
}
const melt0 = vGradImg(8, 40), meltMid = vGradImg(8, 40);
LIM.semanticMelt(meltMid, 1, 0.5, 11);
const meltBotBefore = bandMean(melt0, 30, 40), meltBotAfter = bandMean(meltMid, 30, 40);
assert(meltBotAfter < meltBotBefore - 5,
  'semanticMelt: bottom rows droop darker (' + meltBotBefore.toFixed(1) + ' -> ' + meltBotAfter.toFixed(1) + ')');
const meltTopBefore = bandMean(melt0, 0, 6), meltTopAfter = bandMean(meltMid, 0, 6);
assert(Math.abs(meltTopAfter - meltTopBefore) < 2,
  'semanticMelt: top rows barely move (' + meltTopBefore.toFixed(1) + ' -> ' + meltTopAfter.toFixed(1) + ')');
const meltD1 = vGradImg(8, 40), meltD2 = vGradImg(8, 40);
LIM.semanticMelt(meltD1, 1, 0.5, 11); LIM.semanticMelt(meltD2, 1, 0.5, 11);
assert(Buffer.from(meltD1.data).equals(Buffer.from(meltD2.data)), 'semanticMelt: deterministic for same seed');
const meltA = vGradImg(8, 40), meltB = vGradImg(8, 40);
LIM.semanticMelt(meltA, 1, 0, 11); LIM.semanticMelt(meltB, 1, 1, 11);
assert(Buffer.from(meltA.data).equals(Buffer.from(meltB.data)), 'semanticMelt: closes the loop');
const meltOff = vGradImg(8, 40);
LIM.semanticMelt(meltOff, 0, 0.5, 11);
assert(bandMean(meltOff, 30, 40) === meltBotBefore, 'semanticMelt: amount 0 leaves the frame alone');

// --- denoiseBlocks: blocks breathe static, deterministic, loop closes ---
const dn0a = uniImg(128, 16), dn0b = uniImg(128, 16);
LIM.denoiseBlocks(dn0a, 1, 8, 0, 7); LIM.denoiseBlocks(dn0b, 1, 8, 1, 7);
assert(Buffer.from(dn0a.data).equals(Buffer.from(dn0b.data)), 'denoiseBlocks: closes the loop');
const dnMa = uniImg(128, 16), dnMb = uniImg(128, 16);
LIM.denoiseBlocks(dnMa, 1, 8, 0.5, 7); LIM.denoiseBlocks(dnMb, 1, 8, 0.5, 7);
assert(Buffer.from(dnMa.data).equals(Buffer.from(dnMb.data)), 'denoiseBlocks: deterministic for same seed');
let dnDiff = 0;
for (let i = 0; i < dnMa.data.length; i += 4) dnDiff += Math.abs(dnMa.data[i] - 128);
dnDiff /= (dnMa.data.length / 4);
assert(dnDiff > 3, 'denoiseBlocks: static shimmers mid-loop (mean |delta| ' + dnDiff.toFixed(1) + ')');
const dnOff = uniImg(128, 16);
LIM.denoiseBlocks(dnOff, 0, 8, 0.5, 7);
assert(mean(dnOff) === 128, 'denoiseBlocks: amount 0 leaves the frame alone');

// --- latentGrid: mosaic cells share colour, collapses are loop-sealed ---
const lg0a = vGradImg(32, 32), lg0b = vGradImg(32, 32);
LIM.latentGrid(lg0a, 1, 16, 0); LIM.latentGrid(lg0b, 1, 16, 1);
assert(Buffer.from(lg0a.data).equals(Buffer.from(lg0b.data)), 'latentGrid: closes the loop');
const lgMid = vGradImg(32, 32);
LIM.latentGrid(lgMid, 1, 16, 0.5);
assert(chan(lgMid, 0, 0, 0) === chan(lgMid, 1, 0, 0) && chan(lgMid, 5, 3, 0) === chan(lgMid, 4, 3, 0),
  'latentGrid: neighbours collapse into shared mosaic cells');
const lgOff = vGradImg(32, 32);
LIM.latentGrid(lgOff, 0, 16, 0.5);
assert(Buffer.from(lgOff.data).equals(Buffer.from(vGradImg(32, 32).data)),
  'latentGrid: amount 0 leaves the frame alone');

console.log(failures === 0 ? '\nLIMINAL OK' : '\nLIMINAL FAILED (' + failures + ')');
process.exit(failures === 0 ? 0 : 1);
