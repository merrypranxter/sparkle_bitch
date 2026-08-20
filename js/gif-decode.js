/* Sparkle Bitch — gif-decode.js
 * Self-contained animated GIF decoder. Parses GIF87a/89a, handles graphic
 * control (delay/transparency/disposal), local colour tables and interlace,
 * decodes LZW, and COALESCES frames into full-size RGBA buffers (applying
 * disposal), so each frame is a complete image ready to composite over.
 *
 * API:  SB.decodeGIF(bufferLike) ->
 *   { width, height, loop, frames: [{ data: Uint8ClampedArray, delay: ms }] }
 */
(function (global) {
  'use strict';
  var SB = global.SB = global.SB || {};

  function decodeLZW(minCodeSize, data, pixelCount) {
    var clear = 1 << minCodeSize, eoi = clear + 1;
    var codeSize = minCodeSize + 1;
    var out = new Uint8Array(pixelCount), oi = 0;
    var dict = [];
    function resetDict() {
      dict.length = 0;
      for (var i = 0; i < clear; i++) dict.push([i]);
      dict.push(null); dict.push(null); // clear, eoi
      codeSize = minCodeSize + 1;
    }
    resetDict();

    var bitBuf = 0, bitCnt = 0, bpos = 0, prev = null;
    function readCode() {
      while (bitCnt < codeSize) {
        if (bpos >= data.length) return eoi;
        bitBuf |= data[bpos++] << bitCnt;
        bitCnt += 8;
      }
      var code = bitBuf & ((1 << codeSize) - 1);
      bitBuf >>= codeSize; bitCnt -= codeSize;
      return code;
    }

    while (true) {
      var code = readCode();
      if (code === clear) { resetDict(); prev = null; continue; }
      if (code === eoi) break;
      var entry;
      if (code < dict.length && dict[code] != null) {
        entry = dict[code];
      } else if (prev != null) {
        entry = prev.concat(prev[0]);   // KwKwK case
      } else {
        break;
      }
      for (var j = 0; j < entry.length; j++) { if (oi < out.length) out[oi++] = entry[j]; }
      if (prev != null && dict.length < 4096) {
        dict.push(prev.concat(entry[0]));
        if (dict.length === (1 << codeSize) && codeSize < 12) codeSize++;
      }
      prev = entry;
      if (oi >= pixelCount) break;
    }
    return out;
  }

  var INTERLACE = [[0, 8], [4, 8], [2, 4], [1, 2]];

  function decodeGIF(bufferLike) {
    var b = bufferLike instanceof Uint8Array ? bufferLike : new Uint8Array(bufferLike);
    var pos = 0;
    function u8() { return b[pos++]; }
    function u16() { var v = b[pos] | (b[pos + 1] << 8); pos += 2; return v; }
    function readSubBlocks() {
      var chunks = [], total = 0, n;
      while ((n = u8()) !== 0) { chunks.push(b.subarray(pos, pos + n)); pos += n; total += n; }
      var merged = new Uint8Array(total), off = 0;
      for (var i = 0; i < chunks.length; i++) { merged.set(chunks[i], off); off += chunks[i].length; }
      return merged;
    }
    function readColorTable(size) {
      var t = new Uint8Array(size * 3);
      t.set(b.subarray(pos, pos + size * 3)); pos += size * 3;
      return t;
    }

    var sig = String.fromCharCode(b[0], b[1], b[2], b[3], b[4], b[5]);
    if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new Error('Not a GIF (' + sig + ')');
    pos = 6;

    var W = u16(), H = u16();
    var packed = u8(); u8(); u8(); // bg, aspect
    var gct = null, gctSize = 0;
    if (packed & 0x80) { gctSize = 1 << ((packed & 7) + 1); gct = readColorTable(gctSize); }

    var frames = [];
    var loop = 0;
    // coalescing state
    var canvas = new Uint8ClampedArray(W * H * 4); // transparent
    var disposePrev = 0, rectPrev = null, savedRestore = null;

    // pending graphic control
    var gceDelay = 100, gceTransp = -1, gceDisposal = 0;

    var guard = 0;
    while (pos < b.length) {
      if (guard++ > 100000) break;
      var block = u8();
      if (block === 0x3b) break;            // trailer
      if (block === 0x21) {                  // extension
        var label = u8();
        if (label === 0xf9) {                // graphic control
          u8(); // block size (4)
          var p = u8();
          gceDisposal = (p >> 2) & 7;
          gceTransp = (p & 1) ? 0 : -1;      // resolved after reading index
          gceDelay = u16() * 10;             // centis -> ms
          var ti = u8();
          gceTransp = (p & 1) ? ti : -1;
          u8();                              // terminator
        } else if (label === 0xff) {         // application
          var blk = u8(); var app = '';
          for (var a = 0; a < blk; a++) app += String.fromCharCode(u8());
          var sub = readSubBlocks();
          if (app.indexOf('NETSCAPE') === 0 && sub.length >= 3 && sub[0] === 1) {
            loop = sub[1] | (sub[2] << 8);
          }
        } else {
          readSubBlocks();                   // comment / plain text / other
        }
        continue;
      }
      if (block !== 0x2c) continue;          // unknown -> skip

      // image descriptor
      var ix = u16(), iy = u16(), iw = u16(), ih = u16();
      var ip = u8();
      var lct = null;
      if (ip & 0x80) { var lsize = 1 << ((ip & 7) + 1); lct = readColorTable(lsize); }
      var interlaced = !!(ip & 0x40);
      var ct = lct || gct;
      var ctLen = ct ? ct.length / 3 : 0;

      var minCode = u8();
      var lzwData = readSubBlocks();
      var indices = decodeLZW(minCode, lzwData, iw * ih);

      // --- apply previous disposal ---
      if (disposePrev === 3 && savedRestore) {
        canvas.set(savedRestore);
      } else if (disposePrev === 2 && rectPrev) {
        for (var yy = rectPrev.y; yy < rectPrev.y + rectPrev.h; yy++) {
          for (var xx = rectPrev.x; xx < rectPrev.x + rectPrev.w; xx++) {
            var o = (yy * W + xx) * 4;
            canvas[o] = canvas[o + 1] = canvas[o + 2] = canvas[o + 3] = 0;
          }
        }
      }
      if (gceDisposal === 3) savedRestore = canvas.slice();

      // --- draw this frame ---
      var rowMap = buildRowMap(ih, interlaced);
      for (var row = 0; row < ih; row++) {
        var cy = iy + rowMap[row];
        if (cy < 0 || cy >= H) continue;
        for (var col = 0; col < iw; col++) {
          var idx = indices[row * iw + col];
          if (idx === gceTransp) continue;
          if (idx >= ctLen) continue;
          var cx = ix + col;
          if (cx < 0 || cx >= W) continue;
          var co = (cy * W + cx) * 4, ci = idx * 3;
          canvas[co] = ct[ci]; canvas[co + 1] = ct[ci + 1];
          canvas[co + 2] = ct[ci + 2]; canvas[co + 3] = 255;
        }
      }

      frames.push({ data: canvas.slice(), delay: gceDelay || 100 });
      disposePrev = gceDisposal; rectPrev = { x: ix, y: iy, w: iw, h: ih };
      // reset gce defaults
      gceDelay = 100; gceTransp = -1; gceDisposal = 0;
    }

    return { width: W, height: H, loop: loop, frames: frames };
  }

  // Precompute decoded-row -> real-row mapping (identity when not interlaced).
  function buildRowMap(height, interlaced) {
    var map = new Uint32Array(height);
    if (!interlaced) { for (var i = 0; i < height; i++) map[i] = i; return map; }
    var count = 0;
    for (var p = 0; p < 4; p++) {
      var start = INTERLACE[p][0], step = INTERLACE[p][1];
      for (var y = start; y < height; y += step) { map[count++] = y; }
    }
    return map;
  }

  SB.decodeGIF = decodeGIF;
  SB._gifDecInternals = { decodeLZW: decodeLZW };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
