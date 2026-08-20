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

console.log(failures === 0 ? '\nLOOP OK' : '\nLOOP FAILED (' + failures + ')');
process.exit(failures === 0 ? 0 : 1);
