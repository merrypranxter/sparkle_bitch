/* Loop-safety for the uploaded-texture frame picker (render.textureFrameIndex).
 * A GIF-filled letter must walk every source frame exactly once across phase
 * [0,1) and return to frame 0 at phase 1, so the exported text loops seamlessly.
 * Pure integer math -> testable headless in Node.
 */
'use strict';
const SB = require('../js/util.js');
require('../js/anim.js');
require('../js/glitter.js');
require('../js/render.js');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); } }

const idx = SB.render.textureFrameIndex;
assert(typeof idx === 'function', 'textureFrameIndex is exported');

// a static image (1 frame) always shows frame 0
assert(idx(1, 0) === 0 && idx(1, 0.5) === 0 && idx(1, 0.999) === 0, 'single-frame texture stays on frame 0');
assert(idx(0, 0.5) === 0, 'zero-frame guard returns 0');

// sampled at phase = k/n, an n-frame texture selects frame k, in order
[6, 10, 16, 24].forEach(function (n) {
  let ordered = true;
  for (let k = 0; k < n; k++) if (idx(n, k / n) !== k) ordered = false;
  assert(ordered, n + '-frame texture: phase k/n selects frame k (in order)');
  assert(idx(n, 1) === 0, n + '-frame texture: phase 1 wraps back to frame 0 (loop-safe)');
});

// across the whole loop the index never leaves [0, n-1]
let outOfRange = false;
for (let p = 0; p < 1; p += 0.0011) { const v = idx(16, p); if (v < 0 || v > 15) outOfRange = true; }
assert(!outOfRange, '16-frame texture: index stays in [0,15] across the loop');

// ---- delay-aware picker: uneven per-frame delays (preview == export) ----
const at = SB.render.textureFrameAt;
assert(typeof at === 'function', 'textureFrameAt is exported');
const uneven = [{ delay: 900 }, { delay: 100 }];   // frame 0 owns 90% of the loop
assert(at(uneven, 0) === 0 && at(uneven, 0.5) === 0 && at(uneven, 0.89) === 0, 'long frame holds across its whole delay window');
assert(at(uneven, 0.95) === 1, 'short frame shows only in its (late) window');
assert(at(uneven, 1) === 0, 'phase 1 wraps back to frame 0 (loop-safe)');
// uniform delays, sampled at each frame's midpoint, match the even index
const uni = [{ delay: 80 }, { delay: 80 }, { delay: 80 }, { delay: 80 }];
let okUni = true; for (let k = 0; k < 4; k++) if (at(uni, (k + 0.5) / 4) !== k) okUni = false;
assert(okUni, 'uniform delays reduce to even spacing at frame midpoints');
assert(at([{ delay: 100 }], 0.5) === 0, 'single-frame texture stays on frame 0');

console.log(failures === 0 ? '\nTEXTURE OK' : '\nTEXTURE FAILED (' + failures + ')');
process.exit(failures === 0 ? 0 : 1);
