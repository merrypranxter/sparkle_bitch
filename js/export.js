/* Sparkle Bitch — export.js
 * Renders and encodes the final output: PNG still, animated GIF (loops clean,
 * with optional transparent background for glitter text), and best-effort
 * WebM/MP4. Every frame goes through SB.render.render with the same `renderOpts`
 * (matte, text render, glitter field/mask) so exports match the live preview.
 */
(function (global) {
  'use strict';
  var SB = global.SB = global.SB || {};

  function createCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function fitSize(w, h, maxLong) {
    var s = Math.min(1, maxLong / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  }
  function nextTick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function seekVideo(v, t) {
    return new Promise(function (res) {
      // already there (within a frame) -> no 'seeked' event will fire
      if (Math.abs(v.currentTime - t) < 0.04) return res();
      var settled = false;
      var done = function () {
        if (settled) return; settled = true;
        clearTimeout(to); v.removeEventListener('seeked', done); res();
      };
      // never let a lost seek event wedge the export (busy flag would stick on)
      var to = setTimeout(done, 1200);
      v.addEventListener('seeked', done);
      try { v.currentTime = t; } catch (e) { done(); }
    });
  }
  // Merge the caller's per-frame render options (text, glitter…) with matte/still.
  function frameOpts(base, extra) {
    var o = { matte: base.matte, still: base.still };
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) o[k] = extra[k];
    return o;
  }

  // ---- still (PNG) ------------------------------------------------------
  function renderStill(source, instances, params, maxLong, matte, rext) {
    var sz = fitSize(source.width, source.height, maxLong || 2000);
    var cv = createCanvas(sz.w, sz.h);
    SB.render.render(cv.getContext('2d'), source.drawable, instances, params, 0,
      frameOpts({ matte: matte, still: true }, rext));
    return cv;
  }
  function exportPNG(source, instances, params, opts) {
    opts = opts || {};
    var cv = renderStill(source, instances, params, opts.maxLong || 2000, opts.matte, opts.render);
    return new Promise(function (res) { cv.toBlob(function (b) { res(b); }, 'image/png'); });
  }

  // ---- animated GIF -----------------------------------------------------
  function exportGIF(source, instances, params, opts, onProgress) {
    opts = opts || {};
    var maxLong = opts.maxLong || 480;
    var matte = opts.matte;              // may be null/undefined for transparent
    onProgress = onProgress || function () {};
    // text filled with an animated image/GIF: one output frame per texture frame
    if (source.kind === 'text' && source.textureFrames > 1) {
      return gifFromTextFrames(source, instances, params, maxLong, matte, opts, onProgress);
    }
    if (source.kind === 'gif' && source.frames) {
      return gifFromFrames(source, instances, params, maxLong, matte, opts, onProgress);
    }
    return gifSynth(source, instances, params, maxLong, matte, opts, onProgress);
  }

  // Image / video / text: synthesize F evenly-spaced frames of the loop.
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
            transparencyDiff: opts.transparencyDiff !== false, transparent: !!opts.transparent, dither: !!opts.dither
          });
          onProgress(1, 'done'); return bytes;
        });
      }
      var phase = k / F;
      var pre = isVideo ? seekVideo(source.video, (k / F) * clip) : Promise.resolve();
      return pre.then(function () {
        SB.render.render(ctx, source.drawable, instances, params, phase, frameOpts({ matte: matte }, opts.render));
        frames.push({ data: ctx.getImageData(0, 0, sz.w, sz.h).data, delay: delay });
        k++; onProgress((k / F) * 0.9, 'rendering');
        return nextTick().then(step);
      });
    }
    return step();
  }

  // GIF input: composite over each source frame, loop the animation across the
  // GIF's own duration so it stays seamless.
  function gifFromFrames(source, instances, params, maxLong, matte, opts, onProgress) {
    var sz = fitSize(source.width, source.height, maxLong);
    var cv = createCanvas(sz.w, sz.h), ctx = cv.getContext('2d');
    var src = source.frames;
    var total = 0; for (var i = 0; i < src.length; i++) total += (src[i].delay || 100);
    var frames = [], acc = 0, k = 0;

    function step() {
      if (k >= src.length) {
        onProgress(0.95, 'encoding');
        return nextTick().then(function () {
          var bytes = SB.encodeGIF(frames, {
            width: sz.w, height: sz.h, loop: 0,
            transparencyDiff: opts.transparencyDiff !== false, dither: !!opts.dither
          });
          onProgress(1, 'done'); return bytes;
        });
      }
      var phase = total ? (acc / total) : 0;
      SB.render.render(ctx, src[k].canvas, instances, params, phase, frameOpts({ matte: matte || '#0a0710' }, opts.render));
      frames.push({ data: ctx.getImageData(0, 0, sz.w, sz.h).data, delay: src[k].delay || 100 });
      acc += (src[k].delay || 100); k++; onProgress((k / src.length) * 0.9, 'rendering');
      return nextTick().then(step);
    }
    return step();
  }

  // Glitter text with an uploaded animated texture: emit exactly one output frame
  // per driving-texture frame (a 16-frame GIF fill -> 16-frame text), honouring
  // that texture's own per-frame delays. Deliberately overrides Secs/FPS.
  function gifFromTextFrames(source, instances, params, maxLong, matte, opts, onProgress) {
    var sz = fitSize(source.width, source.height, maxLong);
    var cv = createCanvas(sz.w, sz.h), ctx = cv.getContext('2d');
    var F = source.textureFrames, delays = source.textureDelays || [];
    var frames = [], k = 0;

    function step() {
      if (k >= F) {
        onProgress(0.95, 'encoding');
        return nextTick().then(function () {
          var bytes = SB.encodeGIF(frames, {
            width: sz.w, height: sz.h, loop: 0,
            transparencyDiff: opts.transparencyDiff !== false, transparent: !!opts.transparent, dither: !!opts.dither
          });
          onProgress(1, 'done'); return bytes;
        });
      }
      // phase = k/F makes the driver texture show exactly its frame k (floor(k/F*F)=k)
      SB.render.render(ctx, source.drawable, instances, params, k / F, frameOpts({ matte: matte }, opts.render));
      frames.push({ data: ctx.getImageData(0, 0, sz.w, sz.h).data, delay: delays[k] != null ? delays[k] : 100 });
      k++; onProgress((k / F) * 0.9, 'rendering');
      return nextTick().then(step);
    }
    return step();
  }

  // ---- video (WebM / MP4 where supported) -------------------------------
  function pickVideoMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    var types = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (var i = 0; i < types.length; i++) { try { if (MediaRecorder.isTypeSupported(types[i])) return types[i]; } catch (e) {} }
    return null;
  }
  function videoSupported() { return !!pickVideoMime(); }

  function exportVideo(source, instances, params, opts, onProgress) {
    opts = opts || {};
    onProgress = onProgress || function () {};
    var mime = pickVideoMime();
    if (!mime) return Promise.reject(new Error('Video recording not supported in this browser'));

    var sz = fitSize(source.width, source.height, opts.maxLong || 720);
    var cv = createCanvas(sz.w, sz.h), ctx = cv.getContext('2d');
    var fps = Math.max(2, Math.min(30, opts.fps || params.fps || 15));
    var lengthSec = opts.lengthSec || params.lengthSec || 2;
    var matte = opts.matte || '#0a0710';   // WebM has no alpha -> always a matte
    var isVideo = source.kind === 'video';

    return new Promise(function (resolve, reject) {
      var stream = cv.captureStream(fps), rec;
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
        var elapsed = (performance.now() - t0) / 1000, phase = (elapsed / lengthSec) % 1;
        SB.render.render(ctx, source.drawable, instances, params, phase, frameOpts({ matte: matte }, opts.render));
        onProgress(Math.min(1, elapsed / lengthSec), 'recording');
        if (elapsed < lengthSec) requestAnimationFrame(frame); else rec.stop();
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
    renderStill: renderStill, exportPNG: exportPNG, exportGIF: exportGIF,
    exportVideo: exportVideo, videoSupported: videoSupported, download: download, fitSize: fitSize
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
