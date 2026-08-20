/* Sparkle Bitch — gif-encode.js
 * Self-contained animated GIF89a encoder. No workers, no dependencies, runs
 * in the browser and in Node. Median-cut global palette + optional
 * transparency frame-diff (only changed pixels stored) + variable-width LZW.
 *
 * The LZW code-size rules mirror the widely-used omggif encoder, so output
 * decodes correctly in browsers and standard GIF tools.
 *
 * API:  SB.encodeGIF(frames, opts) -> Uint8Array
 *   frames: [{ data: Uint8ClampedArray|Uint8Array (RGBA, w*h*4), delay: ms }]
 *   opts:   { width, height, loop=0, maxColors=256, transparencyDiff=true,
 *             dither=false }
 */
(function (global) {
  'use strict';
  var SB = global.SB = global.SB || {};

  // ---- growable byte buffer --------------------------------------------
  function ByteBuf() { this.buf = new Uint8Array(1024); this.len = 0; }
  ByteBuf.prototype.ensure = function (n) {
    if (this.len + n <= this.buf.length) return;
    var cap = this.buf.length;
    while (cap < this.len + n) cap *= 2;
    var nb = new Uint8Array(cap); nb.set(this.buf); this.buf = nb;
  };
  ByteBuf.prototype.u8 = function (v) { this.ensure(1); this.buf[this.len++] = v & 0xff; };
  ByteBuf.prototype.u16 = function (v) { this.u8(v); this.u8(v >> 8); };
  ByteBuf.prototype.str = function (s) { for (var i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); };
  ByteBuf.prototype.bytes = function (arr) { this.ensure(arr.length); this.buf.set(arr, this.len); this.len += arr.length; };
  ByteBuf.prototype.done = function () { return this.buf.subarray(0, this.len); };

  // ---- median-cut quantiser --------------------------------------------
  function buildPalette(frames, w, h, maxColors) {
    var px = w * h;
    // gather samples across all frames, capped for speed
    var maxSamples = 40000;
    var totalPx = px * frames.length;
    var stride = Math.max(1, Math.floor(totalPx / maxSamples));
    var R = [], G = [], B = [];
    for (var f = 0; f < frames.length; f++) {
      var d = frames[f].data;
      for (var i = 0; i < px; i += stride) {
        var p = i * 4;
        if (d[p + 3] < 8) continue; // skip transparent source px
        R.push(d[p]); G.push(d[p + 1]); B.push(d[p + 2]);
      }
    }
    var n = R.length;
    if (n === 0) { R.push(255); G.push(255); B.push(255); n = 1; }

    var order = new Uint32Array(n);
    for (var k = 0; k < n; k++) order[k] = k;

    function boxRange(lo, hi) {
      var rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
      for (var j = lo; j < hi; j++) {
        var id = order[j];
        var r = R[id], g = G[id], b = B[id];
        if (r < rmin) rmin = r; if (r > rmax) rmax = r;
        if (g < gmin) gmin = g; if (g > gmax) gmax = g;
        if (b < bmin) bmin = b; if (b > bmax) bmax = b;
      }
      return [rmax - rmin, gmax - gmin, bmax - bmin];
    }

    var boxes = [[0, n]];
    while (boxes.length < maxColors) {
      // pick box with largest (range * population) that can still split
      var bi = -1, best = -1;
      for (var t = 0; t < boxes.length; t++) {
        var lo = boxes[t][0], hi = boxes[t][1];
        if (hi - lo < 2) continue;
        var rng = boxRange(lo, hi);
        var maxr = Math.max(rng[0], rng[1], rng[2]);
        var scoreV = maxr * (hi - lo);
        if (scoreV > best) { best = scoreV; bi = t; }
      }
      if (bi < 0) break;
      var lo2 = boxes[bi][0], hi2 = boxes[bi][1];
      var rng2 = boxRange(lo2, hi2);
      var ch = rng2[0] >= rng2[1] && rng2[0] >= rng2[2] ? 0 : (rng2[1] >= rng2[2] ? 1 : 2);
      var chan = ch === 0 ? R : ch === 1 ? G : B;
      var sub = order.subarray(lo2, hi2);
      Array.prototype.sort.call(sub, function (a, b) { return chan[a] - chan[b]; });
      var mid = (lo2 + hi2) >> 1;
      boxes.splice(bi, 1, [lo2, mid], [mid, hi2]);
    }

    var pal = [];
    for (var bx = 0; bx < boxes.length; bx++) {
      var l = boxes[bx][0], hh = boxes[bx][1], sr = 0, sg = 0, sb = 0, c = hh - l;
      for (var q = l; q < hh; q++) { var idr = order[q]; sr += R[idr]; sg += G[idr]; sb += B[idr]; }
      pal.push([Math.round(sr / c), Math.round(sg / c), Math.round(sb / c)]);
    }
    return pal;
  }

  // Fast nearest-colour lookup keyed by 15-bit rgb.
  function makeMapper(pal) {
    var cache = new Int16Array(32768).fill(-1);
    return function (r, g, b) {
      var key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      var got = cache[key];
      if (got >= 0) return got;
      var best = 0, bestd = 1e12;
      for (var i = 0; i < pal.length; i++) {
        var dr = r - pal[i][0], dg = g - pal[i][1], db = b - pal[i][2];
        var dd = dr * dr + dg * dg + db * db;
        if (dd < bestd) { bestd = dd; best = i; if (dd === 0) break; }
      }
      cache[key] = best;
      return best;
    };
  }

  var BAYER = [
    [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]
  ];

  function mapFrame(data, w, h, mapper, dither) {
    var px = w * h, out = new Uint8Array(px);
    for (var y = 0, i = 0; y < h; y++) {
      for (var x = 0; x < w; x++, i++) {
        var p = i * 4, r = data[p], g = data[p + 1], b = data[p + 2];
        if (dither) {
          var off = (BAYER[y & 7][x & 7] / 64 - 0.5) * 24;
          r = r + off < 0 ? 0 : r + off > 255 ? 255 : r + off;
          g = g + off < 0 ? 0 : g + off > 255 ? 255 : g + off;
          b = b + off < 0 ? 0 : b + off > 255 ? 255 : b + off;
        }
        out[i] = mapper(r | 0, g | 0, b | 0);
      }
    }
    return out;
  }

  // ---- LZW (omggif-compatible) -----------------------------------------
  function encodeLZW(minCodeSize, indices) {
    var out = new ByteBuf();
    var clearCode = 1 << minCodeSize;
    var codeMask = clearCode - 1;
    var eoiCode = clearCode + 1;
    var nextCode = eoiCode + 1;
    var curCodeSize = minCodeSize + 1;
    var cur = 0, curShift = 0;

    function emit(code) {
      cur |= code << curShift;
      curShift += curCodeSize;
      while (curShift >= 8) { out.u8(cur & 0xff); cur >>= 8; curShift -= 8; }
    }

    var table = new Map();
    var ib = indices[0] & codeMask;
    emit(clearCode);

    for (var i = 1; i < indices.length; i++) {
      var kk = indices[i] & codeMask;
      var key = (ib << 8) | kk;
      var code = table.get(key);
      if (code === undefined) {
        emit(ib);
        if (nextCode === 4096) {
          emit(clearCode);
          nextCode = eoiCode + 1;
          curCodeSize = minCodeSize + 1;
          table.clear();
        } else {
          if (nextCode >= (1 << curCodeSize)) curCodeSize++;
          table.set(key, nextCode++);
        }
        ib = kk;
      } else {
        ib = code;
      }
    }
    emit(ib);
    emit(eoiCode);
    if (curShift > 0) { out.u8(cur & 0xff); }
    return out.done();
  }

  function writeImageData(gif, minCodeSize, indices) {
    gif.u8(minCodeSize);
    var lzw = encodeLZW(minCodeSize, indices);
    var off = 0;
    while (off < lzw.length) {
      var n = Math.min(255, lzw.length - off);
      gif.u8(n);
      gif.bytes(lzw.subarray(off, off + n));
      off += n;
    }
    gif.u8(0); // block terminator
  }

  // ---- top level --------------------------------------------------------
  function encodeGIF(frames, opts) {
    opts = opts || {};
    var w = opts.width, h = opts.height;
    var loop = opts.loop == null ? 0 : opts.loop;
    var diff = opts.transparencyDiff !== false && frames.length > 1;
    // opts.transparent: treat source pixels with alpha < 8 as see-through
    // (glitter TEXT on a transparent background exports as a sticker).
    var wantTransparent = !!opts.transparent;
    var useTranspIndex = diff || wantTransparent;
    // Transparent output uses disposal=2 (restore-to-background) with full,
    // independent frames — the inter-frame diff (disposal=1 "leave") would let a
    // moving opaque region smear, since newly-transparent pixels can't clear.
    if (wantTransparent) diff = false;
    var maxColors = Math.min(opts.maxColors || 256, useTranspIndex ? 255 : 256);

    var pal = buildPalette(frames, w, h, maxColors);
    var transparentIndex = useTranspIndex ? pal.length : -1;

    // table size must be a power of two, >= colours (+1 for transparent), >= 4
    var need = pal.length + (useTranspIndex ? 1 : 0);
    var bits = 2; while ((1 << bits) < need) bits++;
    var tableSize = 1 << bits;
    var minCodeSize = bits; // >= 2 guaranteed

    var mapper = makeMapper(pal);
    var px = w * h;

    var gif = new ByteBuf();
    gif.str('GIF89a');
    // logical screen descriptor
    gif.u16(w); gif.u16(h);
    gif.u8(0x80 | ((bits - 1) << 4) | (bits - 1)); // global color table, size
    gif.u8(0); gif.u8(0);
    // global color table
    for (var c = 0; c < tableSize; c++) {
      var col = pal[c] || [0, 0, 0];
      gif.u8(col[0]); gif.u8(col[1]); gif.u8(col[2]);
    }
    // netscape loop extension
    gif.u8(0x21); gif.u8(0xff); gif.u8(11);
    gif.str('NETSCAPE2.0');
    gif.u8(3); gif.u8(1); gif.u16(loop); gif.u8(0);

    var prevIdx = null;
    for (var f = 0; f < frames.length; f++) {
      var data = frames[f].data;
      // 'mapped' is what this frame fully shows (background made transparent).
      var mapped = mapFrame(data, w, h, mapper, !!opts.dither);
      if (wantTransparent) {
        for (var a = 0; a < px; a++) if (data[a * 4 + 3] < 8) mapped[a] = transparentIndex;
      }
      // 'idx' is what we actually write: inter-frame diff may blank unchanged
      // pixels to the transparent index (with disposal=1 they reveal the prev).
      var idx = mapped;
      if (diff && f > 0) {
        idx = mapped.slice();
        for (var i = 0; i < px; i++) {
          if (idx[i] === transparentIndex) continue;
          if (idx[i] === prevIdx[i]) idx[i] = transparentIndex;
        }
      }
      var useTransp = useTranspIndex && (wantTransparent || f > 0);
      prevIdx = f === 0 ? mapped.slice() : mergePrev(prevIdx, mapped, transparentIndex);

      // graphic control extension
      var delay = Math.max(2, Math.round((frames[f].delay || 100) / 10));
      var disposal = wantTransparent ? 2 : 1; // 2 = restore to bg (no trails), 1 = leave
      gif.u8(0x21); gif.u8(0xf9); gif.u8(4);
      gif.u8((disposal << 2) | (useTransp ? 1 : 0));
      gif.u16(delay);
      gif.u8(useTransp ? transparentIndex : 0);
      gif.u8(0);
      // image descriptor
      gif.u8(0x2c);
      gif.u16(0); gif.u16(0); gif.u16(w); gif.u16(h);
      gif.u8(0); // no local color table, no interlace
      writeImageData(gif, minCodeSize, idx);
    }
    gif.u8(0x3b); // trailer
    return gif.done();
  }

  // Rebuild the coalesced index map so the next diff compares against what a
  // decoder would actually be showing (transparent pixels keep the old index).
  function mergePrev(prev, cur, transp) {
    var out = new Uint8Array(cur.length);
    for (var i = 0; i < cur.length; i++) out[i] = cur[i] === transp ? prev[i] : cur[i];
    return out;
  }

  SB.encodeGIF = encodeGIF;
  SB._gifEncInternals = { buildPalette: buildPalette, encodeLZW: encodeLZW, makeMapper: makeMapper };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
