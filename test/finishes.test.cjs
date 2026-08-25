/* Finish registry integrity + schema — what the stack editor + compositor rely
 * on. The heavy per-pixel DRAWS need a canvas, so their look and loop-seam are
 * verified in the browser e2e (renderAt phase 0 ≈ phase 1); here we check the
 * registry headlessly.
 */
'use strict';
const SB = require('../js/util.js');
require('../js/anim.js');
require('../js/glitter.js');
require('../js/finishes.js');

let failures = 0;
function assert(c, m) { if (!c) { failures++; console.error('  ✗ ' + m); } else { console.log('  ✓ ' + m); } }

const F = SB.finishes;
const l = F.list();
assert(l.length >= 13, 'ships the finish library (' + l.length + ' finishes)');

// the top-12 + chrome, under Merry's names
['holographic', 'oilslick', 'pearl', 'soap', 'dichroic', 'plasma', 'chrome', 'liquidchrome', 'cdrom', 'jelly', 'rhinestone', 'sequin', 'opalfire']
  .forEach(function (id) { assert(F.has(id), 'finish "' + id + '" present'); });

// every finish has a schema the UI can render + the compositor can blend
var BLENDS = { base: 1, over: 1, add: 1 }, bad = 0;
l.forEach(function (f) {
  var d = F.get(f.id);
  if (!d.label || !BLENDS[d.blend] || !Array.isArray(d.params) || typeof d.draw !== 'function' || !d.category) bad++;
  d.params.forEach(function (pr) { if (!pr.key || !pr.type || pr.def === undefined) bad++; });
});
assert(bad === 0, 'every finish has a valid {label,blend,category,params,draw} schema');

// defaults() returns each declared param key
var dh = F.defaults('holographic');
assert('bands' in dh && 'sheen' in dh, 'defaults() fills the declared param keys');
assert(F.defaults('nope') && Object.keys(F.defaults('nope')).length === 0, 'defaults() of an unknown id is a safe empty object');

// the fun families are all represented
var cats = l.map(function (f) { return f.category; });
['Iridescent', 'Metal', 'Gems', 'Refraction', 'Liquid'].forEach(function (c) { assert(cats.indexOf(c) >= 0, 'category "' + c + '" present'); });

// renderStack tolerates junk without throwing (unknown type is skipped)
assert(typeof F.renderStack === 'function', 'renderStack is exported');

console.log(failures === 0 ? '\nFINISHES OK' : '\nFINISHES FAILED (' + failures + ')');
process.exit(failures === 0 ? 0 : 1);
