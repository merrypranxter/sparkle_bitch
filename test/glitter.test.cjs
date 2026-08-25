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

// the colours Merry asked for + the new combos are all present
['red', 'black', 'yellow', 'blackgold', 'emerald', 'copper', 'oilslick'].forEach(function (id) {
  assert(!!SB.glitter.STYLES[id], 'new style "' + id + '" present');
});
// black glitter is dark-based (NOT a light-bg style) so it actually reads black —
// its sparkle comes from the white twinkle cores, not the flake colour
const blk = SB.glitter.STYLES.black;
const blkLum = 0.2126 * blk.base[0] + 0.7152 * blk.base[1] + 0.0722 * blk.base[2];
assert(!blk.light && blkLum < 40, 'black glitter has a dark base (lum ' + blkLum.toFixed(0) + ')');
// red reads red, yellow reads yellow (dominant channels in the base tint)
assert(SB.glitter.STYLES.red.base[0] > SB.glitter.STYLES.red.base[2] + 40, 'red glitter base is red-dominant');

// loop closure holds for EVERY style, not just rainbow (no GIF snap on any colour)
let worstAll = 0;
SB.glitter.styleList().forEach(function (s) {
  const fld = SB.glitter.buildField(200, 120, s.id, 0.8, 99, 1);
  for (let i = 0; i < fld.flakes.length; i += 5) {
    const f = fld.flakes[i];
    worstAll = Math.max(worstAll, Math.abs(SB.glitter.flakeState(f, 0).bright - SB.glitter.flakeState(f, 1).bright));
  }
});
assert(near(worstAll, 0, 1e-9), 'every style loops cleanly (worst seam ' + worstAll.toExponential(1) + ')');

// grain multiplier reaches the field but never changes the flake COUNT
const gA = SB.glitter.buildField(300, 200, 'gold', 0.7, 5, 1);
const gB = SB.glitter.buildField(300, 200, 'gold', 0.7, 5, 0.3);
assert(gA.grain === 1 && gB.grain === 0.3, 'grain multiplier is carried on the field');
assert(gA.flakes.length === gB.flakes.length, 'grain does not change the flake count (' + gA.flakes.length + ')');

console.log(failures === 0 ? '\nGLITTER OK' : '\nGLITTER FAILED (' + failures + ')');
process.exit(failures === 0 ? 0 : 1);
