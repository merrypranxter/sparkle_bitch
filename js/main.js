/* Sparkle Bitch — main.js
 * App controller: state, UI wiring, selection tools, live preview, export.
 */
(function () {
  'use strict';
  var U = SB.util, A = SB.analyze, SPK = SB.sparkles, R = SB.render,
      MED = SB.media, EXP = SB.exporter, PRE = SB.presets, GL = SB.glitter, TXT = SB.text;

  var $ = function (id) { return document.getElementById(id); };
  var MATTE = '#0a0710';

  var state = {
    mode: 'image',      // 'image' | 'text'
    source: null,       // active source (points at imageSource or textSource)
    imageSource: null,  // last opened image/gif/video (kept across tab switches)
    textSource: null,   // last built glitter-text source
    params: PRE.defaults(),
    centers: [],
    penCenters: [],
    instances: [],
    rng: null,
    glitterField: null,
    textOpts: {
      text: 'sparkle bitch', font: 'arialblack', size: 96, bold: true, italic: false,
      align: 'center', leading: 1.3,
      // layered outlines, innermost first; each is a solid colour OR a glitter style
      outlines: [{ width: 5, kind: 'color', color: '#3a0a2e' }],
      shadow: true, bg: null // null = transparent
    },
    maskCanvas: null,   // working-res canvas; painted = selected
    maskActive: false,
    tool: 'auto',
    brushSize: 40,
    playing: true,
    busy: false
  };

  var view = $('view'), vctx = view.getContext('2d');

  // ---------------------------------------------------------------- helpers
  function setStatus(msg) { $('status').textContent = msg || ''; }
  function setProgress(frac) {
    var bar = $('progressBar');
    if (frac == null) { $('progress').classList.add('hidden'); return; }
    $('progress').classList.remove('hidden');
    bar.style.width = Math.round(frac * 100) + '%';
  }

  function workDims() { return state.source ? { w: state.source.work.width, h: state.source.work.height } : { w: 1, h: 1 }; }

  function ensureMaskCanvas() {
    var d = workDims();
    if (!state.maskCanvas || state.maskCanvas.width !== d.w || state.maskCanvas.height !== d.h) {
      var c = document.createElement('canvas'); c.width = d.w; c.height = d.h;
      state.maskCanvas = c;
    }
    return state.maskCanvas;
  }

  function maskArray() {
    if (!state.maskActive) return null;
    var c = state.maskCanvas, ctx = c.getContext('2d');
    var id = ctx.getImageData(0, 0, c.width, c.height).data;
    var m = new Uint8Array(c.width * c.height);
    for (var i = 0, p = 3; i < m.length; i++, p += 4) m[i] = id[p] > 8 ? 1 : 0;
    return m;
  }

  // -------------------------------------------------------------- pipeline
  function redetect() {
    if (!state.source) return;
    var p = state.params;
    var centers = A.detectAdaptive(state.source.work, {
      lumaThreshold: p.lumaThreshold, contrastThreshold: p.contrastThreshold,
      density: p.density, maxPoints: p.maxPoints, mask: maskArray(), sampleRadius: 2
    }, 24);
    // pen points are forced sparkle centres (colour sampled, white if dark)
    state.centers = centers.concat(state.penCenters);
    rebuild();
  }

  function rebuild() {
    var p = state.params;
    state.rng = U.mulberry32(U.hashSeed(p.seed));
    state.instances = SPK.build(state.centers, p, state.rng);
    setStatus(state.instances.length + ' sparkles');
  }

  // ---- glitter / text ---------------------------------------------------
  function refDims() {
    if (state.source) return { w: state.source.width, h: state.source.height };
    return { w: view.width, h: view.height };
  }
  function buildGlitterField() {
    var d = refDims();
    state.glitterField = GL.buildField(d.w, d.h, state.params.glitterStyle, state.params.glitterDensity, state.params.seed);
  }
  function buildTextNow() {
    state.textSource = MED.makeTextSource(state.textOpts);
    state.source = state.textSource;
    view.width = state.source.width; view.height = state.source.height;
    document.body.classList.add('has-image');
    buildGlitterField();
    setStatus('“' + state.textOpts.text + '” · ' + state.params.glitterStyle + ' glitter');
  }
  function rebuildText() {
    // Build now (always fresh / correct size). If the chosen font's glyphs
    // aren't loaded yet, load them and rebuild so the mask swaps from the
    // fallback to the real font once it's ready.
    buildTextNow();
    if (document.fonts && document.fonts.load) {
      var css = TXT.fontCss(state.textOpts);
      try {
        if (!document.fonts.check(css)) {
          document.fonts.load(css).then(function () { if (state.mode === 'text') buildTextNow(); }, function () {});
        }
      } catch (e) {}
    }
  }

  function populateFontSelect() {
    var sel = $('textFont'); sel.innerHTML = '';
    TXT.fontGroups().forEach(function (grp) {
      var og = document.createElement('optgroup'); og.label = grp.label;
      grp.fonts.forEach(function (f) {
        var o = document.createElement('option'); o.value = f.id; o.textContent = f.label; og.appendChild(o);
      });
      sel.appendChild(og);
    });
    sel.value = state.textOpts.font;
  }

  // Load a user-supplied font file (FontFace API) and add it to the picker.
  // Load a font from raw bytes, add it to the picker, select it, and (optionally)
  // remember it in IndexedDB so it survives a reload.
  function loadFontFromBuffer(family, buffer, persist) {
    family = TXT.cleanFamily(family);   // one clean name for FontFace + registry
    return new FontFace(family, buffer).load().then(function (f) {
      document.fonts.add(f);
      var id = TXT.registerCustom(family);
      state.textOpts.font = id;
      populateFontSelect();
      if (persist && SB.fontStore) { try { SB.fontStore.put(family, buffer.slice(0)).catch(function () {}); } catch (e) {} }
      if (state.mode !== 'text') setMode('text'); else rebuildText();
      setStatus('Loaded font “' + family + '” ✨');
      return id;
    });
  }
  function onFontFile(file) {
    if (!file) return;
    if (typeof FontFace === 'undefined') { setStatus('⚠ This browser can’t load custom fonts'); return; }
    var family = (file.name || 'My Font').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ');
    setStatus('Loading font “' + TXT.cleanFamily(family) + '”…');
    var reader = new FileReader();
    reader.onload = function () {
      loadFontFromBuffer(family, reader.result, true).catch(function () { setStatus('⚠ Could not read that font file'); });
    };
    reader.onerror = function () { setStatus('⚠ Could not read that font file'); };
    reader.readAsArrayBuffer(file);
  }
  // Re-load fonts saved on a previous visit (persisted in IndexedDB), silently.
  function loadStoredFonts() {
    if (!SB.fontStore || typeof FontFace === 'undefined') return;
    SB.fontStore.all().then(function (list) {
      list.forEach(function (rec) {
        try {
          new FontFace(rec.family, rec.buffer).load().then(function (f) {
            document.fonts.add(f); TXT.registerCustom(rec.family); populateFontSelect();
          }, function () {});
        } catch (e) {}
      });
    }).catch(function () {});
  }

  // ---- layered outlines UI ----
  function fillOutlineType(sel, current) {
    sel.innerHTML = '';
    var solid = document.createElement('option'); solid.value = 'color'; solid.textContent = 'Solid'; sel.appendChild(solid);
    var og = document.createElement('optgroup'); og.label = 'Glitter';
    GL.styleList().forEach(function (s) { var o = document.createElement('option'); o.value = s.id; o.textContent = s.label; og.appendChild(o); });
    sel.appendChild(og);
    sel.value = current;
  }
  function renderOutlineList() {
    var box = $('outlineList'); if (!box) return;
    box.innerHTML = '';
    state.textOpts.outlines.forEach(function (layer) {
      var row = document.createElement('div'); row.className = 'outline-row';
      var ty = document.createElement('select');
      fillOutlineType(ty, layer.kind === 'glitter' ? (layer.glitter || 'silver') : 'color');
      var col = document.createElement('input'); col.type = 'color'; col.value = layer.color || '#3a0a2e';
      col.style.visibility = layer.kind === 'glitter' ? 'hidden' : 'visible';
      var w = document.createElement('input'); w.type = 'range'; w.min = '2'; w.max = '26'; w.step = '1'; w.value = layer.width; w.title = 'width';
      var rm = document.createElement('button'); rm.className = 'btn tiny'; rm.textContent = '✕'; rm.title = 'remove';
      ty.addEventListener('change', function () {
        if (ty.value === 'color') { layer.kind = 'color'; col.style.visibility = 'visible'; }
        else { layer.kind = 'glitter'; layer.glitter = ty.value; col.style.visibility = 'hidden'; }
        if (state.mode === 'text') rebuildText();
      });
      col.addEventListener('input', function () { layer.color = col.value; if (state.mode === 'text') rebuildText(); });
      w.addEventListener('input', function () { layer.width = parseFloat(w.value); if (state.mode === 'text') rebuildText(); });
      rm.addEventListener('click', function () {
        var i = state.textOpts.outlines.indexOf(layer);
        if (i >= 0) state.textOpts.outlines.splice(i, 1);
        renderOutlineList(); if (state.mode === 'text') rebuildText();
      });
      row.appendChild(ty); row.appendChild(col); row.appendChild(w); row.appendChild(rm);
      box.appendChild(row);
    });
  }
  function addOutline() {
    var palette = ['#4fe3ff', '#ff5fd2', '#b6ff5a', '#ffd45c', '#ffffff'];
    var c = palette[state.textOpts.outlines.length % palette.length];
    state.textOpts.outlines.push({ width: 6, kind: 'color', color: c, glitter: 'neon' });
    renderOutlineList(); if (state.mode === 'text') rebuildText();
  }
  function renderExtras() {
    if (state.mode === 'text' && state.source && state.source.textRender) {
      return { text: state.source.textRender, glitterField: state.glitterField };
    }
    var o = {};
    if (state.params.glitterOnImage && state.glitterField) {
      o.glitterField = state.glitterField;
      o.glitterOnImage = true;
      if (state.maskActive) o.glitterMask = state.maskCanvas;
    }
    return o;
  }
  function currentMatte() { return state.mode === 'text' ? (state.textOpts.bg || null) : MATTE; }
  function textTransparent() { return state.mode === 'text' && !state.textOpts.bg; }

  // --------------------------------------------------------------- preview
  function loop(ts) {
    if (state.source) {
      var T = Math.max(300, (state.params.lengthSec || 2) * 1000);
      var phase = state.playing ? ((ts % T) / T) : 0;
      var o = renderExtras(); o.matte = currentMatte();
      R.render(vctx, state.source.drawable, state.instances, state.params, phase, o);
      if (state.mode === 'image') drawOverlay();
    }
    requestAnimationFrame(loop);
  }

  function drawOverlay() {
    if (state.tool === 'auto') return;
    var W = view.width, H = view.height, d = workDims();
    if (state.maskActive) {
      vctx.save();
      vctx.globalAlpha = 0.28; vctx.globalCompositeOperation = 'source-over';
      vctx.imageSmoothingEnabled = false;
      vctx.drawImage(state.maskCanvas, 0, 0, W, H);
      vctx.restore();
    }
    if (state.penCenters.length) {
      vctx.save();
      vctx.strokeStyle = 'rgba(79,227,255,0.9)'; vctx.lineWidth = 2;
      for (var i = 0; i < state.penCenters.length; i++) {
        var c = state.penCenters[i];
        vctx.beginPath(); vctx.arc(c.nx * W, c.ny * H, 4, 0, 7); vctx.stroke();
      }
      vctx.restore();
    }
  }

  // ------------------------------------------------------------ open a file
  function openFile(file) {
    if (!file) return;
    state.busy = true; setStatus('Loading ' + (file.name || 'file') + '…'); setProgress(null);
    MED.loadFromFile(file, 700).then(function (src) {
      if (state.imageSource && state.imageSource.revoke) state.imageSource.revoke();
      state.imageSource = src;
      state.source = src;
      state.mode = 'image'; applyModeUI();
      // reset selection
      state.penCenters = []; state.maskActive = false; ensureMaskCanvas();
      state.maskCanvas.getContext('2d').clearRect(0, 0, state.maskCanvas.width, state.maskCanvas.height);
      // size the visible canvas to the source aspect (cap for perf)
      var sz = EXP.fitSize(src.width, src.height, 960);
      view.width = sz.w; view.height = sz.h;
      document.body.classList.add('has-image');
      if (src.kind === 'video' && src.video) { src.video.loop = true; src.video.play().catch(function () {}); }
      redetect();
      buildGlitterField();
      state.busy = false;
      setStatus(src.kind.toUpperCase() + ' ' + src.width + '×' + src.height + ' · ' + state.instances.length + ' sparkles');
    }).catch(function (err) {
      state.busy = false; setStatus('⚠ ' + err.message);
    });
  }

  // ----------------------------------------------------------- pen / brush
  function pointerToNorm(ev) {
    var r = view.getBoundingClientRect();
    var x = (ev.clientX - r.left) / r.width;
    var y = (ev.clientY - r.top) / r.height;
    return { nx: U.clamp(x, 0, 1), ny: U.clamp(y, 0, 1) };
  }

  function paintMask(nx, ny) {
    var c = ensureMaskCanvas(), ctx = c.getContext('2d');
    var rad = Math.max(3, (state.brushSize / view.width) * c.width);
    ctx.fillStyle = 'rgba(79,227,255,1)';
    ctx.beginPath(); ctx.arc(nx * c.width, ny * c.height, rad, 0, 7); ctx.fill();
    state.maskActive = true;
  }

  function addPen(nx, ny) {
    var d = workDims();
    var wx = Math.floor(nx * d.w), wy = Math.floor(ny * d.h);
    var col = A ? sampleWork(wx, wy) : [255, 255, 255];
    var lum = U.luma(col[0], col[1], col[2]);
    var forceColor;
    if (state.params.colorMode === 'palette') forceColor = null; // let build pick palette
    else if (state.params.colorMode === 'white' || lum < 40) forceColor = [255, 255, 255];
    else forceColor = col;
    state.penCenters.push({ nx: nx, ny: ny, size: 0.7, color: col, forceColor: forceColor });
  }

  var _workData = null, _workFor = null;
  function sampleWork(x, y) {
    if (_workFor !== state.source) {
      _workData = state.source.work; _workFor = state.source;
    }
    var d = _workData, w = d.width, h = d.height;
    x = U.clamp(x, 0, w - 1); y = U.clamp(y, 0, h - 1);
    var p = (y * w + x) * 4;
    return [d.data[p], d.data[p + 1], d.data[p + 2]];
  }

  var drawing = false, lastPen = null;
  function onDown(ev) {
    if (!state.source || state.mode !== 'image' || state.tool === 'auto') return;
    ev.preventDefault(); drawing = true; lastPen = null;
    var n = pointerToNorm(ev);
    if (state.tool === 'brush') paintMask(n.nx, n.ny);
    else { addPen(n.nx, n.ny); lastPen = n; }
  }
  function onMove(ev) {
    if (!drawing) return;
    ev.preventDefault();
    var n = pointerToNorm(ev);
    if (state.tool === 'brush') paintMask(n.nx, n.ny);
    else if (!lastPen || Math.hypot(n.nx - lastPen.nx, n.ny - lastPen.ny) > 0.03) { addPen(n.nx, n.ny); lastPen = n; }
  }
  function onUp() {
    if (!drawing) return;
    drawing = false;
    redetect();
  }

  // --------------------------------------------------------------- exports
  function busyGuard() {
    if (state.busy) return true;
    if (!state.source) { setStatus('Open an image, GIF or video first.'); return true; }
    return false;
  }

  function showResult(kind, url, filename) {
    var box = $('result'); box.innerHTML = '';
    var el;
    if (kind === 'video') { el = document.createElement('video'); el.src = url; el.controls = true; el.autoplay = true; el.loop = true; el.muted = true; }
    else { el = document.createElement('img'); el.src = url; }
    el.className = 'result-media';
    var a = document.createElement('a');
    a.href = url; a.download = filename; a.className = 'result-save'; a.textContent = '⬇ Save ' + filename;
    box.appendChild(el); box.appendChild(a);
    box.classList.remove('hidden');
  }

  function doPNG() {
    if (busyGuard()) return;
    state.busy = true; setStatus('Rendering PNG…');
    EXP.exportPNG(state.source, state.instances, state.params,
      { maxLong: 2000, matte: currentMatte(), render: renderExtras() }).then(function (blob) {
      var name = 'sparklebitch.png';
      EXP.download(blob, name);
      showResult('image', URL.createObjectURL(blob), name);
      state.busy = false; setStatus('Saved PNG ✨');
    });
  }

  function doGIF() {
    if (busyGuard()) return;
    state.busy = true; setStatus('Making GIF…'); setProgress(0);
    var opts = {
      maxLong: state.mode === 'text' ? 640 : 480, matte: currentMatte(),
      render: renderExtras(), transparent: textTransparent(),
      lengthSec: state.params.lengthSec, fps: state.params.fps
    };
    EXP.exportGIF(state.source, state.instances, state.params, opts, function (frac, label) {
      setProgress(frac); setStatus('Making GIF… ' + label);
    }).then(function (bytes) {
      setProgress(null);
      var name = 'sparklebitch.gif';
      var blob = EXP.download(bytes, name, 'image/gif');
      showResult('image', URL.createObjectURL(blob), name);
      state.busy = false; setStatus('Saved GIF ✨ (' + (bytes.length / 1024 | 0) + ' KB)');
    }).catch(function (e) { setProgress(null); state.busy = false; setStatus('⚠ ' + e.message); });
  }

  function doVideo() {
    if (busyGuard()) return;
    if (!EXP.videoSupported()) { setStatus('⚠ Video export not supported in this browser — try GIF.'); return; }
    state.busy = true; setStatus('Recording video…'); setProgress(0);
    var opts = { maxLong: 720, matte: currentMatte() || MATTE, render: renderExtras(), lengthSec: state.params.lengthSec, fps: Math.max(12, state.params.fps) };
    EXP.exportVideo(state.source, state.instances, state.params, opts, function (frac) { setProgress(frac); })
      .then(function (out) {
        setProgress(null);
        var ext = out.mime.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
        var name = 'sparklebitch.' + ext;
        EXP.download(out.blob, name);
        showResult('video', URL.createObjectURL(out.blob), name);
        state.busy = false; setStatus('Saved ' + ext.toUpperCase() + ' ✨');
      }).catch(function (e) { setProgress(null); state.busy = false; setStatus('⚠ ' + e.message); });
  }

  // ------------------------------------------------------------------ wire
  function populateSelect(id, items) {
    var el = $(id); if (!el) return;
    el.innerHTML = '';
    for (var i = 0; i < items.length; i++) {
      var o = document.createElement('option'); o.value = items[i].id; o.textContent = items[i].label; el.appendChild(o);
    }
  }
  function bindText(id, key, kind) {
    var el = $(id); if (!el) return;
    el.addEventListener(kind === 'change' ? 'change' : 'input', function () {
      var v = el.type === 'checkbox' ? el.checked : (el.type === 'range' ? parseFloat(el.value) : el.value);
      state.textOpts[key] = v; updateAllLabels();
      if (state.mode === 'text') rebuildText();
    });
  }
  function setMode(mode) {
    state.mode = mode; applyModeUI();
    if (mode === 'text') {
      // never paint on a text canvas — drop back to the Auto tool
      state.tool = 'auto'; if ($('toolAuto')) $('toolAuto').checked = true;
      view.classList.remove('painting');
      rebuildText();
    } else if (state.imageSource) {
      // restore the previously loaded image/gif/video instead of losing it
      state.source = state.imageSource;
      var sz = EXP.fitSize(state.source.width, state.source.height, 960);
      view.width = sz.w; view.height = sz.h;
      document.body.classList.add('has-image');
      buildGlitterField();
      setStatus(state.source.kind.toUpperCase() + ' ' + state.source.width + '×' + state.source.height);
    } else {
      state.source = null; document.body.classList.remove('has-image'); setStatus('Open an image or GIF ✨');
    }
  }
  function applyModeUI() {
    document.body.classList.toggle('mode-text', state.mode === 'text');
    document.body.classList.toggle('mode-image', state.mode === 'image');
    $('tabImage').classList.toggle('active', state.mode === 'image');
    $('tabText').classList.toggle('active', state.mode === 'text');
    updateGlitterVisibility();
  }
  function updateGlitterVisibility() {
    $('glitterGroup').classList.toggle('hidden', !(state.mode === 'text' || state.params.glitterOnImage));
  }

  function syncControls() {
    var p = state.params, t = state.textOpts;
    setVal('intensity', p.intensity); setVal('maxSize', p.maxSize);
    setVal('density', p.density); setVal('glow', p.glow);
    setVal('colorBoost', p.colorBoost); setVal('speed', p.speed);
    setVal('lengthSec', p.lengthSec); setVal('fps', p.fps);
    setVal('lumaThreshold', p.lumaThreshold); setVal('contrastThreshold', p.contrastThreshold);
    $('styleMix').value = p.styleMix; $('colorMode').value = p.colorMode;
    $('hueCycle').checked = !!p.hueCycle; $('spin').checked = !!p.spinRevs;
    $('presetClassic').classList.toggle('active', p.preset === 'classic');
    $('presetAstral').classList.toggle('active', p.preset === 'astral');
    // glitter
    setVal('glitterStyle', p.glitterStyle); setVal('glitterDensity', p.glitterDensity);
    setVal('glitterIntensity', p.glitterIntensity); $('glitterFill').checked = !!p.glitterOnImage;
    // text
    setVal('textInput', t.text); setVal('textFont', t.font); setVal('textSize', t.size);
    setVal('textAlign', t.align); setVal('textLeading', t.leading);
    $('textBold').checked = !!t.bold; $('textItalic').checked = !!t.italic;
    renderOutlineList();
    $('textShadow').checked = !!t.shadow;
    $('textTransparent').checked = !t.bg; setVal('textBgColor', t.bg || '#101018');
    $('textBgColor').disabled = !t.bg;
    updateAllLabels();
  }
  function setVal(id, v) { var el = $(id); if (el) el.value = v; }
  function updateAllLabels() {
    document.querySelectorAll('[data-label-for]').forEach(function (lab) {
      var el = $(lab.getAttribute('data-label-for'));
      if (el) lab.textContent = el.value;
    });
  }

  function applyPreset(name) {
    PRE.apply(state.params, name);
    syncControls();
    redetect();
  }

  function bindSlider(id, param, mode) {
    var el = $(id);
    if (!el) return;
    el.addEventListener('input', function () {
      var v = parseFloat(el.value);
      state.params[param] = v;
      updateAllLabels();
      if (mode === 'redetect') scheduleRedetect();
      else if (mode === 'rebuild') rebuild();
      // 'render' => nothing, preview loop picks it up
    });
  }

  var _rd = null;
  function scheduleRedetect() { clearTimeout(_rd); _rd = setTimeout(redetect, 120); }

  function init() {
    // file input + drop
    var input = $('fileInput');
    input.addEventListener('change', function () { if (input.files[0]) openFile(input.files[0]); });
    $('openBtn').addEventListener('click', function () { input.click(); });
    $('dropHint').addEventListener('click', function () { input.click(); });

    var stage = $('stage');
    ['dragenter', 'dragover'].forEach(function (e) {
      stage.addEventListener(e, function (ev) { ev.preventDefault(); stage.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (e) {
      stage.addEventListener(e, function (ev) { ev.preventDefault(); stage.classList.remove('drag'); });
    });
    stage.addEventListener('drop', function (ev) {
      var f = ev.dataTransfer && ev.dataTransfer.files[0]; if (f) openFile(f);
    });

    // presets
    $('presetClassic').addEventListener('click', function () { applyPreset('classic'); });
    $('presetAstral').addEventListener('click', function () { applyPreset('astral'); });

    // mode tabs
    $('tabImage').addEventListener('click', function () { setMode('image'); });
    $('tabText').addEventListener('click', function () { setMode('text'); });

    // sparkle it (re-roll)
    $('sparkleBtn').addEventListener('click', function () {
      state.params.seed = (Math.random() * 1e9) | 0;
      if (state.mode === 'text') { buildGlitterField(); setStatus('✨ Reglittered!'); }
      else if (!state.source) { $('fileInput').click(); }
      else { redetect(); buildGlitterField(); setStatus('✨ Sparkled! ' + state.instances.length + ' sparkles'); }
    });

    // sliders
    bindSlider('intensity', 'intensity', 'render');
    bindSlider('maxSize', 'maxSize', 'render');
    bindSlider('density', 'density', 'redetect');
    bindSlider('glow', 'glow', 'render');
    bindSlider('colorBoost', 'colorBoost', 'rebuild');
    bindSlider('speed', 'speed', 'render');
    bindSlider('lengthSec', 'lengthSec', 'render');
    bindSlider('fps', 'fps', 'render');
    bindSlider('lumaThreshold', 'lumaThreshold', 'redetect');
    bindSlider('contrastThreshold', 'contrastThreshold', 'redetect');
    $('brushSize').addEventListener('input', function () { state.brushSize = parseFloat($('brushSize').value); updateAllLabels(); });

    // selects / checkboxes
    $('styleMix').addEventListener('change', function () { state.params.styleMix = $('styleMix').value; rebuild(); });
    $('colorMode').addEventListener('change', function () { state.params.colorMode = $('colorMode').value; rebuild(); });
    $('hueCycle').addEventListener('change', function () { state.params.hueCycle = $('hueCycle').checked; });
    $('spin').addEventListener('change', function () { state.params.spinRevs = $('spin').checked ? 1 : 0; });

    // glitter controls (shared by text mode + image glitter-fill)
    populateSelect('glitterStyle', GL.styleList());
    $('glitterStyle').addEventListener('change', function () { state.params.glitterStyle = $('glitterStyle').value; buildGlitterField(); });
    $('glitterDensity').addEventListener('input', function () { state.params.glitterDensity = parseFloat($('glitterDensity').value); updateAllLabels(); buildGlitterField(); });
    $('glitterIntensity').addEventListener('input', function () { state.params.glitterIntensity = parseFloat($('glitterIntensity').value); updateAllLabels(); });
    $('glitterFill').addEventListener('change', function () {
      state.params.glitterOnImage = $('glitterFill').checked;
      updateGlitterVisibility(); if (state.params.glitterOnImage) buildGlitterField();
    });

    // text controls
    populateFontSelect();
    $('loadFontBtn').addEventListener('click', function () { $('fontFileInput').click(); });
    $('fontFileInput').addEventListener('change', function () {
      if (this.files && this.files[0]) onFontFile(this.files[0]);
      this.value = '';
    });
    loadStoredFonts();   // bring back fonts saved on a previous visit
    bindText('textInput', 'text'); bindText('textFont', 'font', 'change');
    bindText('textSize', 'size'); bindText('textBold', 'bold', 'change');
    bindText('textItalic', 'italic', 'change'); bindText('textShadow', 'shadow', 'change');
    bindText('textAlign', 'align', 'change'); bindText('textLeading', 'leading');
    renderOutlineList();
    $('addOutlineBtn').addEventListener('click', addOutline);
    $('textTransparent').addEventListener('change', function () {
      state.textOpts.bg = $('textTransparent').checked ? null : $('textBgColor').value;
      $('textBgColor').disabled = $('textTransparent').checked;
      if (state.mode === 'text') rebuildText();
    });
    $('textBgColor').addEventListener('input', function () {
      if (!$('textTransparent').checked) { state.textOpts.bg = $('textBgColor').value; if (state.mode === 'text') rebuildText(); }
    });

    // tools
    ['toolAuto', 'toolBrush', 'toolPen'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        if (!$(id).checked) return;
        state.tool = id === 'toolAuto' ? 'auto' : id === 'toolBrush' ? 'brush' : 'pen';
        view.classList.toggle('painting', state.tool !== 'auto');
      });
    });
    $('clearSel').addEventListener('click', function () {
      state.penCenters = []; state.maskActive = false;
      if (state.maskCanvas) state.maskCanvas.getContext('2d').clearRect(0, 0, state.maskCanvas.width, state.maskCanvas.height);
      redetect();
    });
    $('seedBtn').addEventListener('click', function () {
      state.params.seed = (Math.random() * 1e9) | 0; rebuild();
    });

    // pointer paint
    view.addEventListener('pointerdown', onDown);
    view.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    // exports
    $('exportPng').addEventListener('click', doPNG);
    $('exportGif').addEventListener('click', doGIF);
    $('exportVideo').addEventListener('click', doVideo);

    if (!EXP.videoSupported()) { $('exportVideo').title = 'Not supported in this browser'; }

    syncControls();
    applyModeUI();
    requestAnimationFrame(loop);
    setStatus('Open an image or GIF to start ✨');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // expose a little for the e2e test harness
  window.SparkleBitch = {
    openFile: openFile, state: state,
    doPNG: doPNG, doGIF: doGIF,
    setMode: setMode,
    loadFontFromBuffer: loadFontFromBuffer,
    setText: function (o) { for (var k in o) state.textOpts[k] = o[k]; syncControls(); if (state.mode === 'text') rebuildText(); },
    setGlitter: function (o) { for (var k in o) if (o[k] != null) state.params[k] = o[k]; syncControls(); buildGlitterField(); },
    renderStillCanvas: function () { return EXP.renderStill(state.source, state.instances, state.params, 640, currentMatte(), renderExtras()); },
    exportGifBytes: function () {
      return EXP.exportGIF(state.source, state.instances, state.params,
        { maxLong: 240, matte: currentMatte(), render: renderExtras(), transparent: textTransparent(), lengthSec: 1, fps: 8 }, function () {});
    }
  };
})();
