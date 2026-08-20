/* Sparkle Bitch — media.js
 * Load an image / animated GIF / video into a common "source" descriptor and
 * build the small working buffer that highlight detection runs on.
 */
(function (global) {
  'use strict';
  var SB = global.SB = global.SB || {};

  function createCanvas(w, h) {
    var c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }

  function rgbaToCanvas(data, w, h) {
    var cv = createCanvas(w, h);
    var ctx = cv.getContext('2d');
    var id = ctx.createImageData(w, h);
    id.data.set(data);
    ctx.putImageData(id, 0, 0);
    return cv;
  }

  // Draw any drawable to an offscreen buffer scaled so the long side <= maxLong,
  // returning ImageData for analysis.
  function workingImageData(drawable, srcW, srcH, maxLong) {
    var scale = Math.min(1, maxLong / Math.max(srcW, srcH));
    var w = Math.max(1, Math.round(srcW * scale));
    var h = Math.max(1, Math.round(srcH * scale));
    var cv = createCanvas(w, h);
    var ctx = cv.getContext('2d');
    ctx.drawImage(drawable, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  function loadImage(url) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('Could not decode image')); };
      img.src = url;
    });
  }

  function readArrayBuffer(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(new Error('Could not read file')); };
      fr.readAsArrayBuffer(file);
    });
  }

  function kindOf(file) {
    var t = (file.type || '').toLowerCase();
    var n = (file.name || '').toLowerCase();
    if (t === 'image/gif' || /\.gif$/.test(n)) return 'gif';
    if (t.indexOf('video/') === 0 || /\.(mp4|webm|mov|m4v|ogv)$/.test(n)) return 'video';
    return 'image';
  }

  // Returns a Promise<source>.
  //  source = { kind, width, height, drawable, frames?, video?, duration?, revoke() }
  function loadFromFile(file, maxWork) {
    maxWork = maxWork || 700;
    var kind = kindOf(file);

    // GIF reads the File directly (FileReader) — no object URL needed, so none
    // is created here and nothing can leak on the error path.
    if (kind === 'gif') {
      return readArrayBuffer(file).then(function (buf) {
        var g = SB.decodeGIF(buf);
        var frames = g.frames.map(function (fr) {
          return { canvas: rgbaToCanvas(fr.data, g.width, g.height), delay: fr.delay };
        });
        if (!frames.length) throw new Error('GIF had no frames');
        return {
          kind: 'gif', width: g.width, height: g.height,
          drawable: frames[0].canvas, frames: frames,
          work: workingImageData(frames[0].canvas, g.width, g.height, maxWork),
          revoke: function () {}
        };
      });
    }

    // image/video use an object URL as the element source.
    var url = URL.createObjectURL(file);

    if (kind === 'video') {
      return new Promise(function (res, rej) {
        var v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
        v.onloadeddata = function () {
          var w = v.videoWidth, h = v.videoHeight;
          // grab first frame for detection
          v.currentTime = Math.min(0.1, (v.duration || 1) / 2);
          v.onseeked = function () {
            v.onseeked = null;
            res({
              kind: 'video', width: w, height: h, drawable: v, video: v,
              duration: v.duration || 0,
              work: workingImageData(v, w, h, maxWork),
              revoke: function () { URL.revokeObjectURL(url); }
            });
          };
        };
        v.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Could not load video')); };
      });
    }

    // image
    return loadImage(url).then(function (img) {
      return {
        kind: 'image', width: img.naturalWidth, height: img.naturalHeight,
        drawable: img, frames: null,
        work: workingImageData(img, img.naturalWidth, img.naturalHeight, maxWork),
        revoke: function () { URL.revokeObjectURL(url); }
      };
    }).catch(function (e) { URL.revokeObjectURL(url); throw e; });
  }

  // Build a "source" from text options (glitter TEXT mode). Same shape as the
  // other sources, so preview/export reuse works unchanged. Background is
  // transparent so it exports as a see-through sticker.
  function makeTextSource(textOpts) {
    var tr = SB.text.renderText(textOpts);
    return {
      kind: 'text', width: tr.width, height: tr.height,
      drawable: null, frames: null, transparent: true,
      textRender: tr, work: null, revoke: function () {}
    };
  }

  SB.media = {
    loadFromFile: loadFromFile,
    makeTextSource: makeTextSource,
    rgbaToCanvas: rgbaToCanvas,
    workingImageData: workingImageData,
    kindOf: kindOf
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
