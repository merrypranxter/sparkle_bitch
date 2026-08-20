/* Round-trip test for the self-contained GIF encoder + decoder.
 * Runs in Node (the codec is browser/Node agnostic). No dependencies.
 */
'use strict';
const SB = require('../js/util.js');
require('../js/gif-encode.js');
require('../js/gif-decode.js');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); } }

// ---- build synthetic frames: colourful static bg + a moving bright block --
const W = 64, H = 48, N = 5;
function makeFrames() {
  const frames = [];
  for (let f = 0; f < N; f++) {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        data[p] = (x * 4) & 255;
        data[p + 1] = (y * 5) & 255;
        data[p + 2] = ((x + y) * 3) & 255;
        data[p + 3] = 255;
      }
    }
    // moving bright block (the "sparkle")
    const bx = 6 + f * 10, by = 20;
    for (let y = by; y < by + 8; y++) {
      for (let x = bx; x < bx + 8; x++) {
        if (x >= W || y >= H) continue;
        const p = (y * W + x) * 4;
        data[p] = 255; data[p + 1] = 255; data[p + 2] = 255; data[p + 3] = 255;
      }
    }
    frames.push({ data, delay: 120 });
  }
  return frames;
}

const frames = makeFrames();
const bytes = SB.encodeGIF(frames, { width: W, height: H, loop: 0, transparencyDiff: true });

console.log('encoded bytes:', bytes.length);
assert(bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46, 'starts with GIF magic');
assert(String.fromCharCode(bytes[3], bytes[4], bytes[5]) === '89a', 'GIF89a version');
assert(bytes[bytes.length - 1] === 0x3b, 'ends with trailer 0x3b');

const dec = SB.decodeGIF(bytes);
assert(dec.width === W, 'decoded width ' + dec.width);
assert(dec.height === H, 'decoded height ' + dec.height);
assert(dec.frames.length === N, 'decoded frame count ' + dec.frames.length);
assert(dec.loop === 0, 'loop count 0 (infinite)');
assert(dec.frames[0].delay === 120, 'delay preserved (' + dec.frames[0].delay + 'ms)');

// pixel fidelity (allow quantisation error)
let worstAvg = 0;
for (let f = 0; f < N; f++) {
  const a = frames[f].data, b = dec.frames[f].data;
  let sum = 0, n = 0, maxSparkleErr = 0;
  for (let i = 0; i < a.length; i += 4) {
    const de = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    sum += de; n++;
    // white sparkle pixels should be near-white after decode
    if (a[i] === 255 && a[i + 1] === 255 && a[i + 2] === 255) {
      maxSparkleErr = Math.max(maxSparkleErr, de);
    }
  }
  const avg = sum / n;
  worstAvg = Math.max(worstAvg, avg);
  assert(maxSparkleErr < 60, 'frame ' + f + ' sparkle stays bright (err ' + maxSparkleErr + ')');
}
assert(worstAvg < 30, 'avg colour error acceptable (' + worstAvg.toFixed(1) + '/3ch)');

// A single-frame (still) encode should also work (no diff path).
const one = SB.encodeGIF([frames[0]], { width: W, height: H });
const decOne = SB.decodeGIF(one);
assert(decOne.frames.length === 1, 'single-frame GIF round-trips');

// ---- transparent-background round-trip (glitter text) ----
const tw = 48, th = 32;
const tframes = [];
for (let f = 0; f < 3; f++) {
  const d = new Uint8ClampedArray(tw * th * 4); // all alpha 0 -> transparent bg
  const bx = 6 + f * 10;
  for (let y = 10; y < 22; y++) for (let x = bx; x < bx + 12; x++) {
    if (x >= tw) continue; const p = (y * tw + x) * 4;
    d[p] = 255; d[p + 1] = 80; d[p + 2] = 200; d[p + 3] = 255;
  }
  tframes.push({ data: d, delay: 100 });
}
const tbytes = SB.encodeGIF(tframes, { width: tw, height: th, transparent: true });
const tdec = SB.decodeGIF(tbytes);
assert(tdec.frames.length === 3, 'transparent GIF: frame count (' + tdec.frames.length + ')');
const tb = tdec.frames[0].data;
assert(tb[3] < 8, 'transparent GIF: corner background is see-through (alpha ' + tb[3] + ')');
const sqPix = (14 * tw + 10) * 4;
assert(tb[sqPix + 3] > 200, 'transparent GIF: foreground stays opaque (alpha ' + tb[sqPix + 3] + ')');
// the moving square must NOT leave trails (disposal=2 clears each frame)
function opaqueCount(d) { let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) n++; return n; }
const counts = tdec.frames.map(f => opaqueCount(f.data));
assert(counts.every(c => c >= 120 && c <= 180), 'transparent GIF: one square per frame, no trails (' + counts.join(',') + ')');
assert(counts[2] <= counts[0] + 20, 'transparent GIF: opaque pixels do not accumulate (' + counts.join(',') + ')');

console.log(failures === 0 ? '\nCODEC OK' : '\nCODEC FAILED (' + failures + ')');
process.exit(failures === 0 ? 0 : 1);
