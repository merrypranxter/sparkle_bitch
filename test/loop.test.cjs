/* Verifies animation loop-closure: every animated quantity at phase 0 equals
 * its value at phase 1, so exported GIFs/videos don't snap at the seam — and
 * that the values actually vary (no dead animation).
 */
'use strict';
const SB = require('../js/util.js');
require('../js/anim.js');
require('../js/sparkles.js');
require('../js/render.js');

let failures = 0;
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-9);
function assert(cond, msg) { if (!cond) { failures++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); } }

const TAU = Math.PI * 2;
const A = SB.anim;

// --- helpers close the loop ---
assert(near(A.loopSin(0, 1, 0, 2), A.loopSin(1, 1, 0, 2)), 'loopSin closes (0 == 1)');
assert(near(A.loopPing(0), 0) && near(A.loopPing(1), 0), 'loopPing 0 at ends');
assert(A.loopPing(0.5) > 0.99, 'loopPing peaks mid-loop');
assert(near(A.hueCycle(0, 1), 0), 'hueCycle starts at 0');
assert(near((A.spin(1, 1, 0)) % TAU, 0, 1e-9), 'spin completes whole turns');

// --- render.stateOf closes the loop and varies ---
const inst = { phase: 0.7, wob: 1, baseSize: 0.6, spinDir: 1, color: [255, 120, 200], style: 'star4' };
const params = { speed: 3, maxSize: 50, spinRevs: 1 };

const s0 = SB.render.stateOf(inst, params, 0, false);
const s1 = SB.render.stateOf(inst, params, 1, false);
assert(near(s0.alpha, s1.alpha, 1e-9), 'alpha closes (' + s0.alpha.toFixed(4) + ')');
assert(near(s0.size, s1.size, 1e-9), 'size closes (' + s0.size.toFixed(4) + ')');
assert(near((s0.angle - s1.angle) % TAU, 0, 1e-9), 'rotation closes mod 2π');

// sample across the loop -> must vary
let amin = 1, amax = 0, smin = 1e9, smax = 0;
const F = 24;
for (let k = 0; k < F; k++) {
  const st = SB.render.stateOf(inst, params, k / F, false);
  amin = Math.min(amin, st.alpha); amax = Math.max(amax, st.alpha);
  smin = Math.min(smin, st.size); smax = Math.max(smax, st.size);
}
assert(amax - amin > 0.1, 'alpha varies across loop (' + (amax - amin).toFixed(2) + ')');
assert(smax - smin > 2, 'size varies across loop (' + (smax - smin).toFixed(1) + 'px)');

// still mode is constant (no twinkle)
const st0 = SB.render.stateOf(inst, params, 0.1, true);
const st1 = SB.render.stateOf(inst, params, 0.6, true);
assert(near(st0.alpha, st1.alpha), 'still mode: alpha constant');

// --- motion modes close the loop and stay visible in stills ---
const MOTIONS = ['twinkle', 'fade', 'pulse'];
for (const m of MOTIONS) {
  const pM = { speed: 3, maxSize: 50, spinRevs: 1, motion: m };
  const a = SB.render.stateOf(inst, pM, 0, false);
  const b = SB.render.stateOf(inst, pM, 1, false);
  assert(near(a.size, b.size) && near(a.alpha, b.alpha), m + ' motion closes loop');
  const sStill = SB.render.stateOf(inst, pM, 0.37, true);
  assert(sStill.alpha > 0.5 && sStill.size > 0, m + ' still frame visible');
}
// pulse crest beats twinkle crest (it grows instead of just brightening)
const sPulse = SB.render.stateOf(inst, { speed: 1, maxSize: 50, spinRevs: 1, motion: 'pulse' }, 0.25, false);
const sTwnk = SB.render.stateOf(inst, { speed: 1, maxSize: 50, spinRevs: 1, motion: 'twinkle' }, 0.25, false);
assert(sPulse.size > sTwnk.size, 'pulse crest > twinkle crest');

// --- depth layers: deeper instance is smaller/dimmer, loop still closes ---
const deepInst = { phase: 0.7, wob: 1, baseSize: 0.6, spinDir: 1, color: [255, 120, 200], style: 'star8', depth: 0.6, driftPhase: 0.3 };
const pD = { speed: 2, maxSize: 50, spinRevs: 1, depthLayers: true };
const sDeep = SB.render.stateOf(deepInst, pD, 0.3, false);
const sFlat = SB.render.stateOf(deepInst, { speed: 2, maxSize: 50, spinRevs: 1 }, 0.3, false);
assert(sDeep.size < sFlat.size && sDeep.alpha <= sFlat.alpha, 'depth shrinks/dims');
assert(near(SB.render.stateOf(deepInst, pD, 0, false).size, SB.render.stateOf(deepInst, pD, 1, false).size), 'depth loop closes (size)');
assert(near(SB.render.stateOf(deepInst, pD, 0, false).alpha, SB.render.stateOf(deepInst, pD, 1, false).alpha), 'depth loop closes (alpha)');

// --- drift offset: loop-closed, zero when disabled, bounded by amplitude ---
assert(near(SB.render.driftOffset(deepInst, { drift: 1 }, 0, 300), SB.render.driftOffset(deepInst, { drift: 1 }, 1, 300)), 'drift closes loop');
assert(SB.render.driftOffset(deepInst, { drift: 0 }, 0.4, 300) === 0, 'drift 0 = no offset');
assert(SB.render.driftOffset(deepInst, {}, 0.4, 300) === 0, 'missing drift param = no offset');
let dMax = 0;
for (let di = 0; di <= 40; di++) dMax = Math.max(dMax, Math.abs(SB.render.driftOffset(deepInst, { drift: 1 }, di / 40, 300)));
assert(dMax > 1 && dMax <= 0.08 * 300 * 1.01, 'drift bounded by amplitude (max ' + dMax.toFixed(1) + 'px)');
const dOff = SB.render.driftOffset({ driftPhase: 0.5, depth: 0.5, spinDir: -1 }, { drift: 1 }, 0, 300);
assert(Math.abs(dOff) <= 0.08 * 300 * 0.5 + 1e-9, 'drift scales with depth');

console.log(failures === 0 ? '\nLOOP OK' : '\nLOOP FAILED (' + failures + ')');
process.exit(failures === 0 ? 0 : 1);
