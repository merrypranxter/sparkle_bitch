/* Loop-closure + determinism for the glitter flake engine.
 * flakeState is pure, so we can verify the shimmer loops seamlessly (phase 0 ==
 * phase 1) and actually animates (not a dead field), all headless in Node.
 */
'use strict';
const SB = require('../js/util.js');
require('../js/anim.js');
require('../js/glitter.js');

let failures = 0;
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-9);
function assert(cond, msg) { if (!cond) { failures++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); } }

assert(SB.glitter.styleList().length >= 10, 'ships a dozen glitter styles (' + SB.glitter.styleList().length + ')');

const field = SB.glitter.buildField(400, 200, 'rainbow', 0.6, 777);
assert(field.flakes.length > 200, 'buildField scatters flakes (' + field.flakes.length + ')');

// loop closure: every flake's brightness returns to its start at phase 1
let maxSeam = 0, varied = 0;
for (let i = 0; i < field.flakes.length; i++) {
  const f = field.flakes[i];
  const s0 = SB.glitter.flakeState(f, 0).bright;
  const s1 = SB.glitter.flakeState(f, 1).bright;
  maxSeam = Math.max(maxSeam, Math.abs(s0 - s1));
  // does this flake change across the loop?
  let lo = 1, hi = 0;
  for (let k = 0; k < 12; k++) { const b = SB.glitter.flakeState(f, k / 12).bright; lo = Math.min(lo, b); hi = Math.max(hi, b); }
  if (hi - lo > 0.2) varied++;
}
assert(near(maxSeam, 0, 1e-9), 'all flakes loop cleanly (worst seam ' + maxSeam.toExponential(1) + ')');
assert(varied > field.flakes.length * 0.5, 'most flakes actually twinkle (' + varied + '/' + field.flakes.length + ')');

// determinism: same seed -> identical field
const a = SB.glitter.buildField(400, 200, 'gold', 0.5, 42);
const b = SB.glitter.buildField(400, 200, 'gold', 0.5, 42);
let same = a.flakes.length === b.flakes.length;
for (let i = 0; i < a.flakes.length && same; i++) same = a.flakes[i].nx === b.flakes[i].nx && a.flakes[i].cycles === b.flakes[i].cycles;
assert(same, 'same seed reproduces the same glitter field');

// a "still" full field: brightness is bounded 0..1
const st = SB.glitter.flakeState(field.flakes[0], 0.33);
assert(st.bright >= 0 && st.bright <= 1, 'brightness stays in [0,1]');

console.log(failures === 0 ? '\nGLITTER OK' : '\nGLITTER FAILED (' + failures + ')');
process.exit(failures === 0 ? 0 : 1);
