/* Sparkle Bitch — anim.js
 * Loop-closure math. Every animated quantity is a function of phase01
 * (a value in [0,1) representing progress through the loop). Because each
 * uses an INTEGER number of revolutions, the value at phase 0 equals the
 * value at phase 1 — so an exported GIF/video never "snaps" at the seam.
 */
(function (global) {
  'use strict';
  var SB = global.SB = global.SB || {};
  var TAU = Math.PI * 2;

  // Sine that closes the loop. revs must be an integer.
  function loopSin(phase01, amp, phaseOffset, revs) {
    amp = amp == null ? 1 : amp;
    phaseOffset = phaseOffset || 0;
    revs = revs == null ? 1 : Math.max(1, Math.round(revs));
    return amp * Math.sin(TAU * revs * phase01 + phaseOffset);
  }

  // Smooth 0 -> 1 -> 0 over one loop (cosine ping). Closes exactly.
  function loopPing(phase01, revs) {
    revs = revs == null ? 1 : Math.max(1, Math.round(revs));
    return 0.5 - 0.5 * Math.cos(TAU * revs * phase01);
  }

  // Twinkle brightness in [lo,hi]. Each instance gets its own phaseOffset so
  // the field shimmers instead of pulsing in unison.
  function twinkle(phase01, lo, hi, phaseOffset, revs) {
    var t = 0.5 + 0.5 * Math.sin(TAU * Math.max(1, Math.round(revs || 1)) * phase01 + (phaseOffset || 0));
    return lo + (hi - lo) * t;
  }

  // Continuous hue rotation in degrees, integer revolutions -> closes.
  function hueCycle(phase01, revs) {
    revs = revs == null ? 1 : Math.max(1, Math.round(revs));
    return (phase01 * 360 * revs) % 360;
  }

  // Rotation angle in radians, integer revolutions -> closes.
  function spin(phase01, revs, phaseOffset) {
    return TAU * (revs || 0) * phase01 + (phaseOffset || 0);
  }

  SB.anim = {
    TAU: TAU,
    loopSin: loopSin,
    loopPing: loopPing,
    twinkle: twinkle,
    hueCycle: hueCycle,
    spin: spin
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
