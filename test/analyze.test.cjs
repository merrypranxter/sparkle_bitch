/* Verifies the image-side detection modes on a synthetic buffer:
 * black field + one bright blob + one hard vertical edge line.
 * Checks each mode puts points where it should, the count cap holds,
 * spacing/jitter behave, and edge tracing chains along the line.
 */
'use strict';
const SB = require('../js/util.js');
require('../js/analyze.js');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); } }

const W = 120, H = 90;
const data = new Uint8ClampedArray(W * H * 4); // all black, alpha 0
function px(x, y, r, g, b) {
  const i = (y * W + x) * 4;
  data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
}
// bright blob: rect (20..44, 20..44)
for (let y = 20; y <= 44; y++) for (let x = 20; x <= 44; x++) px(x, y, 255, 255, 255);
// hard vertical edge: MID-GRAY 1px line at x=90, y=10..79
// (gray, not white, so it has contrast but doesn't read as "bright")
for (let y = 10; y < 80; y++) px(90, y, 128, 128, 128);
// set remaining alpha so luma math sees opaque black
for (let i = 3; i < data.length; i += 4) if (data[i] === 0) data[i] = 255;
const img = { data, width: W, height: H };

const inBlob = p => p.nx * W >= 18 && p.nx * W <= 46 && p.ny * H >= 18 && p.ny * H <= 46;
// strict interior of the blob (edge pixels on the 20..44 boundary
// legitimately carry gradient, so "must avoid" asserts use the interior)
const inBlobStrict = p => p.nx * W >= 22 && p.nx * W <= 42 && p.ny * H >= 22 && p.ny * H <= 42;
const nearLine = p => Math.abs(p.nx * W - 90) <= 3;
const base = { lumaThreshold: 150, contrastThreshold: 60, spacing: 12, jitter: 0, count: 700, seed: 42 };

// --- bright mode: everything lands in the blob ---
const bright = SB.analyze.detect(img, Object.assign({}, base, { mode: 'bright' }));
assert(bright.length > 0, 'bright: finds points (' + bright.length + ')');
assert(bright.every(inBlob), 'bright: all points inside the blob');

// --- shadow mode: nothing lands in the blob ---
const shadow = SB.analyze.detect(img, Object.assign({}, base, { mode: 'shadow' }));
assert(shadow.length > 0, 'shadow: finds points (' + shadow.length + ')');
assert(shadow.every(p => !inBlobStrict(p)), 'shadow: avoids the bright blob');

// --- edges mode: points cluster on the line (and blob outline) ---
const edges = SB.analyze.detect(img, Object.assign({}, base, { mode: 'edges' }));
assert(edges.length > 0, 'edges: finds points (' + edges.length + ')');
const edgeOnLine = edges.filter(nearLine).length;
assert(edgeOnLine >= edges.length * 0.4, 'edges: >=40% on the line (' + edgeOnLine + '/' + edges.length + ')');
assert(edges.every(p => !inBlobStrict(p)), 'edges: blob interior stays empty');

// --- both mode: covers blob and line ---
const both = SB.analyze.detect(img, Object.assign({}, base, { mode: 'both' }));
assert(both.some(inBlob), 'both: includes the blob');
assert(both.some(nearLine), 'both: includes the line');

// --- scatter: uniform random, respects count, deterministic per seed ---
const sc1 = SB.analyze.detect(img, Object.assign({}, base, { mode: 'scatter', count: 150 }));
assert(sc1.length === 150, 'scatter: exactly count points (' + sc1.length + ')');
const sc2 = SB.analyze.detect(img, Object.assign({}, base, { mode: 'scatter', count: 150 }));
assert(sc1.every((p, i) => p.nx === sc2[i].nx && p.ny === sc2[i].ny), 'scatter: same seed = same points');
const scInBlob = sc1.filter(inBlob).length;
assert(scInBlob < sc1.length * 0.2, 'scatter: roughly uniform (blob share ' + scInBlob + '/' + sc1.length + ')');
const scAdaptive = SB.analyze.detectAdaptive(img, { mode: 'scatter', count: 60, seed: 7 }, 24);
assert(scAdaptive.length === 60, 'scatter: adaptive wrapper leaves it alone');

// --- count cap ---
const capped = SB.analyze.detect(img, Object.assign({}, base, { mode: 'both', spacing: 6, count: 10 }));
assert(capped.length <= 10, 'count cap respected (' + capped.length + ')');

// --- spacing: tighter grid = more points ---
const coarse = SB.analyze.detect(img, Object.assign({}, base, { mode: 'both', spacing: 30 }));
const fine = SB.analyze.detect(img, Object.assign({}, base, { mode: 'both', spacing: 6 }));
assert(fine.length > coarse.length, 'smaller spacing = more points (' + fine.length + ' > ' + coarse.length + ')');

// --- jitter: 0 is grid-stable, 1 moves points (still deterministic) ---
const j0a = SB.analyze.detect(img, Object.assign({}, base, { mode: 'both' }));
const j0b = SB.analyze.detect(img, Object.assign({}, base, { mode: 'both' }));
assert(j0a.every((p, i) => p.nx === j0b[i].nx && p.ny === j0b[i].ny), 'jitter 0: reproducible');
const j1 = SB.analyze.detect(img, Object.assign({}, base, { mode: 'both', jitter: 1 }));
assert(j1.length === j0a.length, 'jitter keeps point count');
assert(j1.some((p, i) => p.nx !== j0a[i].nx || p.ny !== j0a[i].ny), 'jitter 1: points actually move');
const j1b = SB.analyze.detect(img, Object.assign({}, base, { mode: 'both', jitter: 1 }));
assert(j1.every((p, i) => p.nx === j1b[i].nx && p.ny === j1b[i].ny), 'jitter 1: still seed-deterministic');

// --- edge trace: chains outline the line AND the blob contour ---
const traced = SB.analyze.detect(img, Object.assign({}, base, { mode: 'edges', trace: true }));
assert(traced.length > 0, 'trace: produces chain points (' + traced.length + ')');
const tracedOnLine = traced.filter(nearLine).length;
assert(tracedOnLine >= 5, 'trace: chain runs along the line (' + tracedOnLine + ' points)');
// the chain covers the line's length, not just one spot
const lineYs = traced.filter(nearLine).map(p => p.ny * H);
const ySpan = Math.max.apply(null, lineYs) - Math.min.apply(null, lineYs);
assert(ySpan >= 40, 'trace: chain spans the line (y span ' + ySpan.toFixed(0) + 'px)');
// chains are continuous: every on-line point has a traced neighbour within 1.6x spacing
const chainPts = traced.map(p => ({ x: p.nx * W, y: p.ny * H }));
let adj = 0;
for (let i = 0; i < chainPts.length; i++)
  for (let j = 0; j < chainPts.length; j++) {
    if (i === j) continue;
    const dx = chainPts[i].x - chainPts[j].x, dy = chainPts[i].y - chainPts[j].y;
    if (dx * dx + dy * dy <= (12 * 1.6) * (12 * 1.6)) { adj++; break; }
  }
assert(adj >= chainPts.length * 0.8, 'trace: chain points have neighbours (continuous outlines, ' + adj + '/' + chainPts.length + ')');
// blob contour gets outlined too (near the blob but outside its interior)
const onContour = p => {
  const x = p.nx * W, y = p.ny * H;
  const near = x >= 14 && x <= 50 && y >= 14 && y <= 50;
  const interior = x >= 23 && x <= 41 && y >= 23 && y <= 41;
  return near && !interior;
};
assert(traced.filter(onContour).length >= 4, 'trace: outlines the blob contour (' + traced.filter(onContour).length + ' points)');

// --- trace + both keeps grid heroes AND adds the chain ---
const tracedBoth = SB.analyze.detect(img, Object.assign({}, base, { mode: 'both', trace: true, count: 2000 }));
assert(tracedBoth.some(inBlob), 'trace+both: blob heroes kept');
assert(tracedBoth.filter(nearLine).length > both.filter(nearLine).length, 'trace+both: line coverage grows');

// --- mask: zeroed blob cells suppress bright detection there ---
const mask = new Uint8Array(W * H).fill(1);
for (let y = 15; y <= 50; y++) for (let x = 15; x <= 50; x++) mask[y * W + x] = 0;
const masked = SB.analyze.detect(img, Object.assign({}, base, { mode: 'bright', mask }));
assert(masked.length === 0, 'mask: masked blob yields no bright points');

console.log(failures === 0 ? '\nANALYZE OK' : '\nANALYZE FAILED (' + failures + ')');
process.exit(failures === 0 ? 0 : 1);
