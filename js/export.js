/* Sparkle Bitch — export.js
 * Renders and encodes the final output: PNG still, animated GIF (loops clean),
 * and best-effort WebM/MP4 video. Uses SB.render for every frame so exports
 * match the live preview exactly.
 */
(function (global) {
  'use strict';
  var SB = global.SB = global.SB || {};

  function createCanvas(w, h) {
    var c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  function fitSize(w, h, maxLong) {
    var s = Math.min(1, maxLong / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  }
  function nextTick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function seekVideo(v, t) {
    return new Promise(function (res) {
      var done = function () { v.removeEventListener('seeked', done); res(); };
      v.addEventListener('seeked', done);
      v.currentTime = t;
    });
  }

  // ---- still (PNG) ------------------------------------------------------
  function renderStill(source, instances, params, maxLong, matte) {
    var sz = fitSize(source.width, source.height, maxLong || 2000);
    var cv = createCanvas(sz.w, sz.h);
    var ctx = cv.getContext('2d');
    SB.render.render(ctx, source.drawable, instances, params, 0, { still: true, matte: matte });
    return cv;
  }
  function exportPNG(source, instances, params, opts) {
    opts = opts || {};
    var cv = renderStill(source, instances, params, opts.maxLong || 2000, opts.matte);
    return new Promise(function (res) { cv.toBlob(function (b) { res(b); }, 'image/png'); });
  }

  // ---- animated GIF -----------------------------------------------------
  // Returns Promise<Uint8Array>. onProgress(frac, label).
  function exportGIF(source, instances, params, opts, onProgress) {
    opts = opts || {};
    var maxLong = opts.maxLong || 480;
    var matte = opts.matte || '#0a0710';
    onProgress = onProgress || function () {};

    if (source.kind === 'gif' && source.frames) {
      return gifFromFrames(source, instances, params, maxLong, matte, opts, onProgress);
    }
    return gifSynth(source, instances, params, maxLong, matte, opts, onProgress);
  }

  // Image / video: synthesize F evenly-spaced frames of the sparkle loop.
  function gifSynth(source, instances, params, maxLong, matte, opts, onProgress) {
    var sz = fitSize(source.width, source.height, maxLong);
    var cv = createCanvas(sz.w, sz.h), ctx = cv.getContext('2d');
    var fps = Math.max(2, Math.min(30, opts.fps || params.fps || 15));
    var F = Math.max(1, Math.round((opts.lengthSec || params.lengthSec || 2) * fps));
    var delay = Math.round(1000 / fps);
    var isVideo = source.kind === 'video';
    var clip = isVideo ? Math.min(source.duration || F / fps, (opts.lengthSec || params.lengthSec || 2)) : 0;
    var frames = [];

    var k = 0;
    function step() {
      if (k >= F) {
        onProgress(0.95, 'encoding');
        return nextTick().then(function () {
          var bytes = SB.encodeGIF(frames, {
            width: sz.w, height: sz.h, loop: 0,
            transparencyDiff: opts.transparencyDiff !== false, dither: !!opts.dither
          });
          onProgress(1, 'done');
          return bytes;
        });
      }
      var phase = k / F;
      var pre = isVideo ? seekVideo(source.video, (k / F) * clip) : Promise.resolve();
      return pre.then(function () {
        SB.render.render(ctx, source.drawable, instances, params, phase, { matte: matte });
        frames.push({ data: ctx.getImageData(0, 0, sz.w, sz.h).data, delay: delay });
        k++;
        onProgress((k / F) * 0.9, 'rendering');
        return nextTick().then(step);
      });
    }
    return step();
  }

  // GIF input: composite sparkles over each source frame; loop the sparkle
  // animation across the GIF's own duration so it stays seamless.
  function gifFromFrames(source, instances, params, maxLong, matte, opts, onProgress) {
    var sz = fitSize(source.width, source.height, maxLong);
    var cv = createCanvas(sz.w, sz.h), ctx = cv.getContext('2d');
    var src = source.frames;
    var total = 0; for (var i = 0; i < src.length; i++) total += (src[i].delay || 100);
    var frames = [], acc = 0;

    var k = 0;
    function step() {
      if (k >= src.length) {
        onProgress(0.95, 'encoding');
        return nextTick().then(function () {
          var bytes = SB.encodeGIF(frames, {
            width: sz.w, height: sz.h, loop: 0,
            transparencyDiff: opts.transparencyDiff !== false, dither: !!opts.dither
          });
          onProgress(1, 'done');
          return bytes;
        });
      }
      var phase = total ? (acc / total) : 0;
      SB.render.render(ctx, src[k].canvas, instances, params, phase, { matte: matte });
      frames.push({ data: ctx.getImageData(0, 0, sz.w, sz.h).data, delay: src[k].delay || 100 });
      acc += (src[k].delay || 100);
      k++;
      onProgress((k / src.length) * 0.9, 'rendering');
      return nextTick().then(step);
    }
    return step();
  }

  // ---- video (WebM / MP4 where supported) -------------------------------
  function pickVideoMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    var types = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (var i = 0; i < types.length; i++) {
      try { if (MediaRecorder.isTypeSupported(types[i])) return types[i]; } catch (e) {}
    }
    return null;
  }
  function videoSupported() { return !!pickVideoMime(); }

  // Returns Promise<{blob, mime}>.
  function exportVideo(source, instances, params, opts, onProgress) {
    opts = opts || {};
    onProgress = onProgress || function () {};
    var mime = pickVideoMime();
    if (!mime) return Promise.reject(new Error('Video recording not supported in this browser'));

    var sz = fitSize(source.width, source.height, opts.maxLong || 720);
    var cv = createCanvas(sz.w, sz.h), ctx = cv.getContext('2d');
    var fps = Math.max(2, Math.min(30, opts.fps || params.fps || 15));
    var lengthSec = opts.lengthSec || params.lengthSec || 2;
    var matte = opts.matte || '#0a0710';
    var isVideo = source.kind === 'video';

    return new Promise(function (resolve, reject) {
      var stream = cv.captureStream(fps);
      var rec;
      try { rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6000000 }); }
      catch (e) { return reject(e); }
      var chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function () {
        if (isVideo) { try { source.video.pause(); } catch (e) {} }
        resolve({ blob: new Blob(chunks, { type: mime }), mime: mime });
      };

      if (isVideo) { source.video.loop = true; source.video.currentTime = 0; source.video.play().catch(function () {}); }
      rec.start();
      var t0 = performance.now();
      function frame() {
        var elapsed = (performance.now() - t0) / 1000;
        var phase = (elapsed / lengthSec) % 1;
        SB.render.render(ctx, source.drawable, instances, params, phase, { matte: matte });
        onProgress(Math.min(1, elapsed / lengthSec), 'recording');
        if (elapsed < lengthSec) requestAnimationFrame(frame);
        else rec.stop();
      }
      requestAnimationFrame(frame);
    });
  }

  // ---- download helper (real browser; not the artifact sandbox) ---------
  function download(data, filename, mime) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    return blob;
  }

  SB.exporter = {
    renderStill: renderStill,
    exportPNG: exportPNG,
    exportGIF: exportGIF,
    exportVideo: exportVideo,
    videoSupported: videoSupported,
    download: download,
    fitSize: fitSize
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
