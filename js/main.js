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
    mode: 'image',      // 'image' | 'text' | 'liminal'
    source: null,       // active source (points at imageSource or textSource)
    imageSource: null,  // last opened image/gif/video (kept across tab switches)
    textSource: null,   // last built glitter-text source
    params: PRE.defaults(),
    liminal: null,      // liminal engine params (built below, persisted)
    centers: [],
    penCenters: [],
    instances: [],
    rng: null,
    glitterField: null,
    textures: {},       // id -> uploaded image/GIF texture (fill/outline source)
    dust: null,         // { field, mask, intensity, blend } | null
    compare: false,     // hold-to-compare: render the bare source
    textOpts: {
      text: 'sparkle bitch', font: 'arialblack', size: 96, bold: true, italic: false,
      align: 'center', leading: 1.3, letterSpacing: 0, caps: false,
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

  // ------------------------------------------------------------- persistence
  function loadJSON(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v || fallback; }
    catch (e) { return fallback; }
  }
  function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
  function rgbToHex(c) {
    return '#' + [c[0], c[1], c[2]].map(function (n) {
      return ('0' + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2);
    }).join('');
  }

  // user palettes (image swatches + text glitter style), remembered across visits
  var IMG_PAL_KEY = 'sb-custom-image', TXT_PAL_KEY = 'sb-custom-text';
  var imageCustomHex = loadJSON(IMG_PAL_KEY, ['#ff5fd2', '#4fe3ff', '#b6ff5a', '#ffd45c', '#ffffff']);
  var textCustomDef = loadJSON(TXT_PAL_KEY, { base: '#3a0a2e', flakes: ['#ff5fd2', '#4fe3ff', '#b6ff5a', '#ffd45c', '#ffffff'] });

  // liminal engine params, remembered across visits; saved objects are merged
  // over defaults so newly added effect keys always exist
  var LIM_KEY = 'sb-liminal';
  function mergeLiminal(saved) {
    var p = SB.liminal.defaults();
    if (saved) for (var k in saved) {
      if (!saved.hasOwnProperty(k)) continue;
      if (saved[k] && typeof saved[k] === 'object' && p[k] && typeof p[k] === 'object') {
        for (var j in saved[k]) if (saved[k].hasOwnProperty(j)) p[k][j] = saved[k][j];
      } else p[k] = saved[k];
    }
    return p;
  }
  state.liminal = mergeLiminal(loadJSON(LIM_KEY, null));

  function imageCustomPalette() { return imageCustomHex.map(U.hexToRgb); }
  function applyTextCustom() {
    GL.registerStyle('custom', {
      label: '✏️ My palette',
      base: U.hexToRgb(textCustomDef.base),
      palette: textCustomDef.flakes.map(U.hexToRgb)
    });
  }

  // which flake palette the image side sprays with
  function paletteFor() {
    var id = state.params.paletteId;
    if (id === 'mine') return imageCustomPalette();
    if (PRE.PALETTES[id]) return PRE.PALETTES[id];
    if (GL.STYLES[id]) return GL.STYLES[id].palette;   // any glitter style works as a palette
    return PRE.PALETTES.classic;
  }

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
    if (!state.source || state.mode !== 'image') return;
    var p = state.params;
    var centers = A.detectAdaptive(state.source.work, {
      mode: p.detectMode,
      lumaThreshold: p.lumaThreshold, contrastThreshold: p.contrastThreshold,
      lumaWeight: p.lumaWeight, edgeWeight: p.edgeWeight,
      count: p.count, spacing: p.spacing || undefined, density: p.density,
      jitter: p.jitter, trace: p.trace, seed: p.seed,
      mask: maskArray(), sampleRadius: 2
    }, 24);
    // pen points are forced sparkle centres (colour sampled, white if dark)
    state.centers = centers.concat(state.penCenters);
    rebuild();
    buildDust();
  }

  function rebuild() {
    var p = state.params;
    p.palette = paletteFor();
    state.rng = U.mulberry32(U.hashSeed(p.seed));
    state.instances = SPK.build(state.centers, p, state.rng);
    setStatus(state.instances.length + ' sparkles');
  }

  // ---- glitter / text / dust --------------------------------------------
  function refDims() {
    if (state.source) return { w: state.source.width, h: state.source.height };
    return { w: view.width, h: view.height };
  }
  function buildGlitterField() {
    var d = refDims();
    state.glitterField = GL.buildField(d.w, d.h, state.params.glitterStyle, state.params.glitterDensity, state.params.seed, state.params.glitterGrain);
  }

  // soft blobs over every detected centre — the dust's "stay here" mask
  function buildDustMask() {
    var d = workDims();
    var c = document.createElement('canvas'); c.width = d.w; c.height = d.h;
    var ctx = c.getContext('2d');
    var r = Math.max(16, (state.params.spacing || 22) * 1.8);
    ctx.fillStyle = '#fff';
    for (var i = 0; i < state.centers.length; i++) {
      var x = state.centers[i].nx * d.w, y = state.centers[i].ny * d.h;
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
    return c;
  }
  function buildDust() {
    if (!state.params.dust || !state.source || state.mode !== 'image') { state.dust = null; return; }
    var d = refDims();
    var fit = EXP.fitSize(d.w, d.h, 480);   // dust stays fine + fast at any size
    state.dust = {
      field: GL.buildField(fit.w, fit.h, state.params.glitterStyle, state.params.dustDensity, state.params.seed + 77, state.params.dustGrain),
      mask: buildDustMask(),
      intensity: state.params.dustIntensity,
      blend: 'screen'
    };
  }

  // 'tex:<id>' -> the registered texture object, else null
  function textureFor(styleId) {
    return (typeof styleId === 'string' && styleId.indexOf('tex:') === 0) ? (state.textures[styleId.slice(4)] || null) : null;
  }
  // Attach uploaded textures to a text source: the fill (from glitterStyle) and
  // any texture outline layers. The animated texture with the MOST frames becomes
  // the "driver" whose frame count + per-frame delays the GIF export honours.
  function resolveTextures(src) {
    if (!src || !src.textRender) return;
    var driver = null;
    function consider(tex) { if (tex && tex.animated && (!driver || tex.frames.length > driver.frames.length)) driver = tex; }
    src.fillTexture = textureFor(state.params.glitterStyle);
    consider(src.fillTexture);
    (src.textRender.layers || []).forEach(function (L) {
      if (L.kind === 'texture') { L.texture = state.textures[L.textureId] || null; consider(L.texture); }
    });
    if (driver) {
      src.textureFrames = driver.frames.length;
      src.textureDelays = driver.frames.map(function (f) { return f.delay || 100; });
      src.textureTotalMs = src.textureDelays.reduce(function (a, b) { return a + b; }, 0);
    } else { src.textureFrames = 0; src.textureDelays = null; src.textureTotalMs = 0; }
  }
  function buildTextNow() {
    state.textSource = MED.makeTextSource(state.textOpts);
    state.source = state.textSource;
    view.width = state.source.width; view.height = state.source.height;
    document.body.classList.add('has-image');
    buildGlitterField();
    resolveTextures(state.textSource);
    var frames = state.textSource.textureFrames;
    setStatus('“' + state.textOpts.text + '”' +
      (frames > 1 ? ' · ' + frames + '-frame image fill' : ' · ' + state.params.glitterStyle + ' glitter'));
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

  // ---- uploaded fill / outline textures ----
  function populateGlitterStyleSelect() {
    var sel = $('glitterStyle'); if (!sel) return;
    var cur = state.params.glitterStyle;
    sel.innerHTML = '';
    GL.styleList().forEach(function (s) { var o = document.createElement('option'); o.value = s.id; o.textContent = s.label; sel.appendChild(o); });
    var tex = textureOptions();
    if (tex.length) {
      var tg = document.createElement('optgroup'); tg.label = 'Your uploads';
      tex.forEach(function (t) { var o = document.createElement('option'); o.value = t.id; o.textContent = t.label; tg.appendChild(o); });
      sel.appendChild(tg);
    }
    sel.value = cur;
  }
  var _texN = 0;
  function registerTexture(tex, label) {
    var id = 'tex' + (++_texN);
    tex.label = ((label || '').replace(/[_-]+/g, ' ').trim() || ('upload ' + _texN)).slice(0, 22);
    state.textures[id] = tex;
    return id;
  }
  function refreshTexturePickers() { populateGlitterStyleSelect(); renderOutlineList(); }
  function onTextureFile(file) {
    if (!file) return;
    setStatus('Loading “' + (file.name || 'image') + '”…');
    MED.loadTexture(file).then(function (tex) {
      var id = registerTexture(tex, (file.name || 'upload').replace(/\.[a-z0-9]+$/i, ''));
      state.params.glitterStyle = 'tex:' + id;     // use it as the fill right away
      refreshTexturePickers();
      if (state.mode !== 'text') setMode('text'); else rebuildText();
      updateColorUI();
      setStatus(tex.animated
        ? 'Loaded ' + tex.frames.length + '-frame GIF fill ✨ — exports ' + tex.frames.length + ' frames'
        : 'Loaded image fill ✨');
    }).catch(function (e) { setStatus('⚠ ' + (e && e.message || 'Could not load that file')); });
  }
  // e2e harness: register a texture straight from bytes (mirrors loadFontFromBuffer)
  function loadTextureFromBuffer(buffer, isGif, label) {
    var file = new File([buffer], (label || 'tex') + (isGif ? '.gif' : '.png'), { type: isGif ? 'image/gif' : 'image/png' });
    return MED.loadTexture(file).then(function (tex) {
      var id = registerTexture(tex, label || 'upload');
      refreshTexturePickers();
      return id;
    });
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
  // uploaded textures as picker options ('tex:<id>'); empty until one is loaded
  function textureOptions() {
    var out = [];
    for (var id in state.textures) if (state.textures.hasOwnProperty(id)) out.push({ id: 'tex:' + id, label: state.textures[id].label });
    return out;
  }
  function fillOutlineType(sel, current) {
    sel.innerHTML = '';
    var solid = document.createElement('option'); solid.value = 'color'; solid.textContent = 'Solid'; sel.appendChild(solid);
    var og = document.createElement('optgroup'); og.label = 'Glitter';
    GL.styleList().forEach(function (s) { var o = document.createElement('option'); o.value = s.id; o.textContent = s.label; og.appendChild(o); });
    sel.appendChild(og);
    var tex = textureOptions();
    if (tex.length) {
      var tg = document.createElement('optgroup'); tg.label = 'Your uploads';
      tex.forEach(function (t) { var o = document.createElement('option'); o.value = t.id; o.textContent = t.label; tg.appendChild(o); });
      sel.appendChild(tg);
    }
    sel.value = current;
  }
  // a compact labelled slider for a single per-outline glitter knob
  function miniSlider(label, min, max, step, val, title) {
    var wrap = document.createElement('label'); wrap.className = 'mini-ctl'; wrap.title = title;
    var span = document.createElement('span'); span.textContent = label;
    var input = document.createElement('input'); input.type = 'range';
    input.min = min; input.max = max; input.step = step; input.value = val;
    wrap.appendChild(span); wrap.appendChild(input);
    return { wrap: wrap, input: input, set: function (v) { input.value = v; } };
  }
  // current picker value for a layer: 'color' | glitter-id | 'tex:<id>'
  function outlineTypeValue(layer) {
    if (layer.kind === 'texture') return 'tex:' + layer.textureId;
    if (layer.kind === 'glitter') return layer.glitter || 'silver';
    return 'color';
  }
  function renderOutlineList() {
    var box = $('outlineList'); if (!box) return;
    box.innerHTML = '';
    state.textOpts.outlines.forEach(function (layer) {
      var item = document.createElement('div'); item.className = 'outline-item';
      var row = document.createElement('div'); row.className = 'outline-row';
      var ty = document.createElement('select');
      fillOutlineType(ty, outlineTypeValue(layer));
      var col = document.createElement('input'); col.type = 'color'; col.value = layer.color || '#3a0a2e';
      var w = document.createElement('input'); w.type = 'range'; w.min = '2'; w.max = '26'; w.step = '1'; w.value = layer.width; w.title = 'band width';
      var rm = document.createElement('button'); rm.className = 'btn tiny'; rm.textContent = '✕'; rm.title = 'remove';
      row.appendChild(ty); row.appendChild(col); row.appendChild(w); row.appendChild(rm);
      item.appendChild(row);

      // per-outline glitter knobs — density / grain / strength, this band only
      var sub = document.createElement('div'); sub.className = 'outline-glitter';
      var dS = miniSlider('D', 0.1, 2, 0.05, layer.density != null ? layer.density : state.params.glitterDensity, 'glitter density (this outline)');
      var gS = miniSlider('G', 0.2, 2, 0.05, layer.grain != null ? layer.grain : state.params.glitterGrain, 'grain size (this outline)');
      var sS = miniSlider('S', 0.2, 1, 0.05, layer.intensity != null ? layer.intensity : state.params.glitterIntensity, 'glitter strength (this outline)');
      sub.appendChild(dS.wrap); sub.appendChild(gS.wrap); sub.appendChild(sS.wrap);
      item.appendChild(sub);
      box.appendChild(item);

      function showControls() {
        var glit = layer.kind === 'glitter', tex = layer.kind === 'texture';
        col.style.visibility = layer.kind === 'color' ? 'visible' : 'hidden';  // keep the grid cell
        sub.style.display = (glit || tex) ? '' : 'none';
        dS.wrap.style.display = glit ? '' : 'none';        // grain/density are glitter-only
        gS.wrap.style.display = glit ? '' : 'none';
        sS.wrap.style.display = (glit || tex) ? '' : 'none';  // strength applies to textures too
      }
      showControls();

      ty.addEventListener('change', function () {
        var v = ty.value;
        if (v === 'color') { layer.kind = 'color'; }
        else if (v.indexOf('tex:') === 0) { layer.kind = 'texture'; layer.textureId = v.slice(4); }
        else {
          layer.kind = 'glitter'; layer.glitter = v;
          // seed this outline's knobs from the fill so it starts sane, then tweak
          if (layer.density == null) layer.density = state.params.glitterDensity;
          if (layer.grain == null) layer.grain = state.params.glitterGrain;
          if (layer.intensity == null) layer.intensity = state.params.glitterIntensity;
          dS.set(layer.density); gS.set(layer.grain); sS.set(layer.intensity);
        }
        showControls();
        if (state.mode === 'text') rebuildText();
      });
      col.addEventListener('input', function () { layer.color = col.value; if (state.mode === 'text') rebuildText(); });
      w.addEventListener('input', function () { layer.width = parseFloat(w.value); if (state.mode === 'text') rebuildText(); });
      dS.input.addEventListener('input', function () { layer.density = parseFloat(dS.input.value); if (state.mode === 'text') rebuildText(); });
      gS.input.addEventListener('input', function () { layer.grain = parseFloat(gS.input.value); if (state.mode === 'text') rebuildText(); });
      sS.input.addEventListener('input', function () { layer.intensity = parseFloat(sS.input.value); if (state.mode === 'text') rebuildText(); });
      rm.addEventListener('click', function () {
        var i = state.textOpts.outlines.indexOf(layer);
        if (i >= 0) state.textOpts.outlines.splice(i, 1);
        renderOutlineList(); if (state.mode === 'text') rebuildText();
      });
    });
  }
  function addOutline() {
    var palette = ['#4fe3ff', '#ff5fd2', '#b6ff5a', '#ffd45c', '#ffffff'];
    var c = palette[state.textOpts.outlines.length % palette.length];
    state.textOpts.outlines.push({ width: 6, kind: 'color', color: c, glitter: 'neon' });
    renderOutlineList(); if (state.mode === 'text') rebuildText();
  }
  function renderExtras() {
    if (state.mode === 'liminal') return { liminal: state.liminal };
    if (state.mode === 'text' && state.source && state.source.textRender) {
      return { text: state.source.textRender, glitterField: state.glitterField, fillTexture: state.source.fillTexture || null };
    }
    var o = {};
    if (state.dust) o.dust = state.dust;
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
      // an animated image/GIF fill plays at its own native speed in the preview
      var T = (state.mode === 'text' && state.source.textureTotalMs > 0)
        ? state.source.textureTotalMs
        : Math.max(300, (state.params.lengthSec || 2) * 1000);
      var phase = state.playing ? ((ts % T) / T) : 0;
      var cmp = state.compare && state.mode === 'image';
      var o = cmp ? {} : renderExtras();
      o.matte = currentMatte();
      R.render(vctx, state.source.drawable, cmp ? [] : state.instances, state.params, phase, o);
      if (state.mode === 'image' && !cmp) drawOverlay();
    }
    requestAnimationFrame(loop);
  }

  function drawOverlay() {
    var showDots = state.params.showDetect;
    if (state.tool === 'auto' && !showDots) return;
    var W = view.width, H = view.height, d = workDims();
    if (state.maskActive && state.tool !== 'auto') {
      vctx.save();
      vctx.globalAlpha = 0.28; vctx.globalCompositeOperation = 'source-over';
      vctx.imageSmoothingEnabled = false;
      vctx.drawImage(state.maskCanvas, 0, 0, W, H);
      vctx.restore();
    }
    if (state.penCenters.length && state.tool !== 'auto') {
      vctx.save();
      vctx.strokeStyle = 'rgba(79,227,255,0.9)'; vctx.lineWidth = 2;
      for (var i = 0; i < state.penCenters.length; i++) {
        var c = state.penCenters[i];
        vctx.beginPath(); vctx.arc(c.nx * W, c.ny * H, 4, 0, 7); vctx.stroke();
      }
      vctx.restore();
    }
    // "Show placement": a dot everywhere a sparkle will land
    if (showDots) {
      vctx.save();
      vctx.fillStyle = 'rgba(79,227,255,0.85)';
      vctx.strokeStyle = 'rgba(10,7,16,0.9)'; vctx.lineWidth = 1;
      for (var j = 0; j < state.centers.length; j++) {
        var p = state.centers[j], x = p.nx * W, y = p.ny * H;
        vctx.beginPath(); vctx.arc(x, y, 2.2, 0, 7); vctx.fill(); vctx.stroke();
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
      // dropping a file while in Liminal keeps you in Liminal; Text falls back to Image
      if (state.mode !== 'liminal') state.mode = 'image';
      applyModeUI();
      // reset selection + undo history
      state.penCenters = []; state.maskActive = false; ensureMaskCanvas();
      state.maskCanvas.getContext('2d').clearRect(0, 0, state.maskCanvas.width, state.maskCanvas.height);
      undoStack.length = 0;
      // size the visible canvas to the source aspect (cap for perf)
      var sz = EXP.fitSize(src.width, src.height, 960);
      view.width = sz.w; view.height = sz.h;
      document.body.classList.add('has-image');
      if (src.kind === 'video' && src.video) { src.video.loop = true; src.video.play().catch(function () {}); }
      redetect();
      buildGlitterField();
      state.busy = false;
      setStatus(src.kind.toUpperCase() + ' ' + src.width + '×' + src.height +
        (state.mode === 'liminal' ? ' · 🌑 liminal' : ' · ' + state.instances.length + ' sparkles'));
    }).catch(function (err) {
      state.busy = false; setStatus('⚠ ' + err.message);
    });
  }

  // ----------------------------------------------------------- pen / brush
  var undoStack = [];
  function pushUndo() {
    try {
      var c = ensureMaskCanvas();
      undoStack.push({
        w: c.width, h: c.height,
        pen: state.penCenters.slice(),
        maskActive: state.maskActive,
        mask: state.maskActive ? c.getContext('2d').getImageData(0, 0, c.width, c.height) : null
      });
      if (undoStack.length > 20) undoStack.shift();
    } catch (e) {}
  }
  function undo() {
    var s = undoStack.pop();
    if (!s) { setStatus('Nothing to undo'); return; }
    state.penCenters = s.pen;
    var c = ensureMaskCanvas();
    var ctx = c.getContext('2d');
    if (s.mask && s.w === c.width && s.h === c.height) {
      state.maskActive = s.maskActive;
      ctx.putImageData(s.mask, 0, 0);
    } else {
      state.maskActive = false;
      ctx.clearRect(0, 0, c.width, c.height);
    }
    redetect();
    setStatus('↩ Undone · ' + state.instances.length + ' sparkles');
  }

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
    pushUndo();
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

  // Ensure the chosen text font is loaded (and the source rebuilt with it)
  // before exporting, so an export never bakes in the fallback font.
  function ensureExportFont(cb) {
    if (state.mode === 'text' && document.fonts && document.fonts.load) {
      try {
        var css = TXT.fontCss(state.textOpts);
        if (!document.fonts.check(css)) { document.fonts.load(css).then(function () { buildTextNow(); cb(); }, cb); return; }
      } catch (e) {}
    }
    cb();
  }

  var _lastResultURL = null;
  function showResult(kind, url, filename) {
    var box = $('result'); box.innerHTML = '';
    if (_lastResultURL) { try { URL.revokeObjectURL(_lastResultURL); } catch (e) {} }
    _lastResultURL = url;
    var el;
    if (kind === 'video') { el = document.createElement('video'); el.src = url; el.controls = true; el.autoplay = true; el.loop = true; el.muted = true; }
    else { el = document.createElement('img'); el.src = url; }
    el.className = 'result-media';
    var a = document.createElement('a');
    a.href = url; a.download = filename; a.className = 'result-save'; a.textContent = '⬇ Save ' + filename;
    box.appendChild(el); box.appendChild(a);
    box.classList.remove('hidden');
    // make the result impossible to miss: scroll to it + pulse. When a browser
    // silently blocks the automatic download (multi-download protection kicks
    // in after the first one), this Save button — a real user click — always
    // works, so a page refresh is never needed to export again.
    box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash');
    try { box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { box.scrollIntoView(); }
  }

  // Run an export job with a busy flag that CANNOT wedge: any throw or
  // rejection releases it, so one bad export never disables the buttons.
  function runExport(label, job) {
    state.busy = true; setStatus(label + '…');
    var done = function () { state.busy = false; };
    try {
      job().then(done, function (e) { done(); setProgress(null); setStatus('⚠ ' + (e && e.message || e)); });
    } catch (e) {
      done(); setProgress(null); setStatus('⚠ ' + (e && e.message || e));
    }
  }

  function doPNG() {
    if (busyGuard()) return;
    ensureExportFont(function () {
      setProgress(null);
      runExport('Rendering PNG', function () {
        return EXP.exportPNG(state.source, state.instances, state.params,
          { maxLong: 2000, matte: currentMatte(), render: renderExtras() }).then(function (blob) {
          if (!blob) throw new Error('PNG encode failed');
          var name = 'sparklebitch.png';
          EXP.download(blob, name);
          showResult('image', URL.createObjectURL(blob), name);
          setStatus('Saved PNG ✨ — no download? Use the ⬇ Save button under the preview.');
        });
      });
    });
  }

  function doGIF() {
    if (busyGuard()) return;
    ensureExportFont(function () {
      setProgress(0);
      var opts = {
        maxLong: state.mode === 'text' ? 640 : 480, matte: currentMatte(),
        render: renderExtras(), transparent: textTransparent(),
        lengthSec: state.params.lengthSec, fps: state.params.fps
      };
      runExport('Making GIF', function () {
        return EXP.exportGIF(state.source, state.instances, state.params, opts, function (frac, label) {
          setProgress(frac); setStatus('Making GIF… ' + label);
        }).then(function (bytes) {
          setProgress(null);
          var name = 'sparklebitch.gif';
          var blob = EXP.download(bytes, name, 'image/gif');
          showResult('image', URL.createObjectURL(blob), name);
          setStatus('Saved GIF ✨ (' + (bytes.length / 1024 | 0) + ' KB) — no download? Use the ⬇ Save button under the preview.');
        });
      });
    });
  }

  function doVideo() {
    if (busyGuard()) return;
    if (!EXP.videoSupported()) { setStatus('⚠ Video export not supported in this browser — try GIF.'); return; }
    ensureExportFont(function () {
      setProgress(0);
      var opts = { maxLong: 720, matte: currentMatte() || MATTE, render: renderExtras(), lengthSec: state.params.lengthSec, fps: Math.max(12, state.params.fps) };
      runExport('Recording video', function () {
        return EXP.exportVideo(state.source, state.instances, state.params, opts, function (frac) { setProgress(frac); })
          .then(function (out) {
            setProgress(null);
            var ext = out.mime.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
            var name = 'sparklebitch.' + ext;
            EXP.download(out.blob, name);
            showResult('video', URL.createObjectURL(out.blob), name);
            setStatus('Saved ' + ext.toUpperCase() + ' ✨ — no download? Use the ⬇ Save button under the preview.');
          });
      });
    });
  }

  // -------------------------------------------------------- palettes / looks
  function populatePaletteSelect() {
    var items = [{ id: 'classic', label: 'Classic Y2K' }, { id: 'astral', label: 'Astral Trash' }];
    GL.styleList().forEach(function (s) { items.push({ id: s.id, label: s.label + ' ✨' }); });
    items.push({ id: 'mine', label: '✏️ My palette' });
    populateSelect('paletteId', items);
  }

  var LOOKS_KEY = 'sb-looks';
  function refreshLooks(selectId) {
    var sel = $('savedLooks'); sel.innerHTML = '';
    var d = document.createElement('option'); d.value = ''; d.textContent = 'My looks…'; sel.appendChild(d);
    var looks = loadJSON(LOOKS_KEY, {});
    Object.keys(looks).forEach(function (name) {
      var o = document.createElement('option'); o.value = name; o.textContent = name; sel.appendChild(o);
    });
    sel.value = selectId || '';
  }
  function saveLook() {
    var name = (window.prompt('Name this look:', 'My look') || '').trim();
    if (!name) return;
    var looks = loadJSON(LOOKS_KEY, {});
    looks[name] = JSON.parse(JSON.stringify(state.params));
    saveJSON(LOOKS_KEY, looks);
    refreshLooks(name);
    setStatus('💾 Saved look “' + name + '”');
  }
  function applyLook(name) {
    var looks = loadJSON(LOOKS_KEY, {});
    var look = looks[name];
    if (!look) return;
    for (var k in look) if (look.hasOwnProperty(k)) state.params[k] = look[k];
    syncControls(); redetect(); buildGlitterField();
    setStatus('Look “' + name + '” applied ✨');
  }

  // 🎲 randomize everything, tastefully
  function chaos() {
    var r = Math.random;
    function pick(arr) { return arr[(r() * arr.length) | 0]; }
    var p = state.params;
    p.seed = (r() * 1e9) | 0;
    p.detectMode = pick(['bright', 'edges', 'both', 'both', 'shadow', 'scatter']);
    p.colorMode = pick(['auto', 'palette', 'palette', 'white', 'single', 'complement', 'pastel', 'neon']);
    var palIds = ['classic', 'astral'].concat(GL.styleList().map(function (s) { return s.id; })).concat(['mine']);
    p.paletteId = pick(palIds);
    p.singleColor = U.hslToRgb(r() * 360, 1, 0.6);
    p.styleMix = pick(Object.keys(SPK.STYLE_SETS));
    p.motion = pick(['twinkle', 'twinkle', 'fade', 'pulse']);
    p.speed = 1 + ((r() * 4) | 0);
    p.glow = 0.4 + r() * 0.5;
    p.density = 0.3 + r() * 0.7;
    p.jitter = 0.2 + r() * 0.6;
    p.drift = r() < 0.5 ? 0 : r() * 0.6;
    p.depthLayers = r() < 0.5;
    p.trace = r() < 0.45;
    p.spriteScale = 0.5 + r();
    p.intensity = 0.6 + r() * 0.4;
    syncControls(); redetect(); buildGlitterField();
    setStatus('🎲 CHAOS! ' + state.instances.length + ' sparkles');
  }

  // ------------------------------------------------------------ liminal mode
  function limGet(path) {
    return path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, state.liminal);
  }
  function limSet(path, v) {
    var ks = path.split('.'), o = state.liminal;
    for (var i = 0; i < ks.length - 1; i++) { if (!o[ks[i]]) o[ks[i]] = {}; o = o[ks[i]]; }
    o[ks[ks.length - 1]] = v;
    state.liminal.preset = '';            // any manual tweak = custom stack
    saveJSON(LIM_KEY, state.liminal);
    markLiminalChips();
  }
  function markLiminalChips() {
    var box = $('limPresets'); if (!box) return;
    var cur = state.liminal.preset || '';
    box.querySelectorAll('.chip').forEach(function (chip) {
      chip.classList.toggle('active', chip.getAttribute('data-lim-preset') === cur);
    });
  }
  function applyLiminalPreset(id) {
    state.liminal = SB.liminal.preset(id);
    saveJSON(LIM_KEY, state.liminal);
    syncLiminalControls();
    setStatus(id ? '🌑 ' + SB.liminal.PRESETS[id].label : '🌑 effects off — plain image');
  }
  function syncLiminalControls() {
    document.querySelectorAll('[data-lim]').forEach(function (el) {
      var v = limGet(el.getAttribute('data-lim'));
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    });
    markLiminalChips();
    updateAllLabels();
  }
  function buildLiminalUI() {
    var box = $('limPresets'); if (!box) return;
    box.innerHTML = '';
    SB.liminal.presetList().forEach(function (pr) {
      var chip = document.createElement('button');
      chip.className = 'chip'; chip.textContent = pr.label;
      chip.setAttribute('data-lim-preset', pr.id);
      chip.addEventListener('click', function () { applyLiminalPreset(pr.id); });
      box.appendChild(chip);
    });
    var off = document.createElement('button');
    off.className = 'chip'; off.textContent = '✖️ Off';
    off.setAttribute('data-lim-preset', '');
    off.addEventListener('click', function () { applyLiminalPreset(''); });
    box.appendChild(off);
    // generic binding: every [data-lim] input writes straight into state.liminal
    document.querySelectorAll('[data-lim]').forEach(function (el) {
      var path = el.getAttribute('data-lim');
      var evt = (el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input';
      el.addEventListener(evt, function () {
        var v = el.type === 'checkbox' ? el.checked : (el.type === 'range' ? parseFloat(el.value) : el.value);
        limSet(path, v); updateAllLabels();
      });
    });
    syncLiminalControls();
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

  function restoreImageSource() {
    if (!state.imageSource) {
      state.source = null; document.body.classList.remove('has-image');
      return;
    }
    // restore the previously loaded image/gif/video instead of losing it
    state.source = state.imageSource;
    var sz = EXP.fitSize(state.source.width, state.source.height, 960);
    view.width = sz.w; view.height = sz.h;
    document.body.classList.add('has-image');
    buildGlitterField();
    buildDust();
  }

  function setMode(mode) {
    state.mode = mode; applyModeUI();
    if (mode === 'text') {
      // never paint on a text canvas — drop back to the Auto tool
      state.tool = 'auto'; if ($('toolAuto')) $('toolAuto').checked = true;
      view.classList.remove('painting');
      rebuildText();
    } else {
      if (mode === 'liminal') {
        // liminal haunts the loaded image — but it has no paint tools
        state.tool = 'auto'; if ($('toolAuto')) $('toolAuto').checked = true;
        view.classList.remove('painting');
      }
      restoreImageSource();
      if (state.source) {
        setStatus(state.source.kind.toUpperCase() + ' ' + state.source.width + '×' + state.source.height +
          (mode === 'liminal' ? ' · 🌑 pick a vibe' : ''));
      } else {
        setStatus(mode === 'liminal' ? 'Open an image or GIF first 🌑' : 'Open an image or GIF ✨');
      }
    }
  }
  function applyModeUI() {
    document.body.classList.toggle('mode-text', state.mode === 'text');
    document.body.classList.toggle('mode-image', state.mode === 'image');
    document.body.classList.toggle('mode-liminal', state.mode === 'liminal');
    $('tabImage').classList.toggle('active', state.mode === 'image');
    $('tabText').classList.toggle('active', state.mode === 'text');
    $('tabLiminal').classList.toggle('active', state.mode === 'liminal');
    updateGlitterVisibility();
  }
  function updateGlitterVisibility() {
    $('glitterGroup').classList.toggle('hidden',
      !(state.mode === 'text' || (state.mode === 'image' && state.params.glitterOnImage)));
    updateColorUI();
  }
  // show/hide the conditional controls (palette editor, single colour, dust…)
  function updateColorUI() {
    var cm = state.params.colorMode;
    $('paletteRow').classList.toggle('hidden', cm !== 'palette');
    $('singleColorRow').classList.toggle('hidden', cm !== 'single');
    $('imgCustomPalette').classList.toggle('hidden', !(cm === 'palette' && state.params.paletteId === 'mine'));
    $('textCustomPalette').classList.toggle('hidden', state.params.glitterStyle !== 'custom');
    $('dustControls').style.opacity = state.params.dust ? '1' : '0.45';
    // a texture fill ignores density/grain (they're glitter-only) — hide them, keep strength
    var fillIsTex = textureFor(state.params.glitterStyle) != null;
    var dLbl = $('glitterDensity') && $('glitterDensity').closest('.ctl');
    var gLbl = $('glitterGrain') && $('glitterGrain').closest('.ctl');
    if (dLbl) dLbl.style.display = fillIsTex ? 'none' : '';
    if (gLbl) gLbl.style.display = fillIsTex ? 'none' : '';
  }

  function syncControls() {
    var p = state.params, t = state.textOpts;
    setVal('intensity', p.intensity); setVal('maxSize', p.maxSize);
    setVal('density', p.density); setVal('glow', p.glow);
    setVal('colorBoost', p.colorBoost); setVal('speed', p.speed);
    setVal('lengthSec', p.lengthSec); setVal('fps', p.fps);
    setVal('lumaThreshold', p.lumaThreshold); setVal('contrastThreshold', p.contrastThreshold);
    setVal('spriteScale', p.spriteScale); setVal('drift', p.drift);
    setVal('lumaWeight', p.lumaWeight); setVal('edgeWeight', p.edgeWeight);
    setVal('count', p.count); setVal('spacing', p.spacing); setVal('jitter', p.jitter);
    setVal('dustDensity', p.dustDensity); setVal('dustGrain', p.dustGrain); setVal('dustIntensity', p.dustIntensity);
    $('styleMix').value = p.styleMix; $('colorMode').value = p.colorMode;
    $('motion').value = p.motion; $('detectMode').value = p.detectMode;
    setVal('paletteId', p.paletteId); $('singleColor').value = rgbToHex(p.singleColor);
    $('hueCycle').checked = !!p.hueCycle; $('spin').checked = !!p.spinRevs;
    $('depthLayers').checked = !!p.depthLayers; $('trace').checked = !!p.trace;
    $('showDetect').checked = !!p.showDetect; $('dustOn').checked = !!p.dust;
    $('presetClassic').classList.toggle('active', p.preset === 'classic');
    $('presetAstral').classList.toggle('active', p.preset === 'astral');
    // glitter
    setVal('glitterStyle', p.glitterStyle); setVal('glitterDensity', p.glitterDensity);
    setVal('glitterIntensity', p.glitterIntensity); setVal('glitterGrain', p.glitterGrain);
    $('glitterFill').checked = !!p.glitterOnImage;
    // custom palette swatches
    $('textPalBase').value = textCustomDef.base;
    document.querySelectorAll('.textPalFlake').forEach(function (el, i) { el.value = textCustomDef.flakes[i] || '#ffffff'; });
    document.querySelectorAll('.palSwatch').forEach(function (el, i) { el.value = imageCustomHex[i] || '#ffffff'; });
    // text
    setVal('textInput', t.text); setVal('textFont', t.font); setVal('textSize', t.size);
    setVal('textAlign', t.align); setVal('textLeading', t.leading); setVal('textSpacing', t.letterSpacing);
    $('textBold').checked = !!t.bold; $('textItalic').checked = !!t.italic;
    $('textCaps').checked = !!t.caps;
    renderOutlineList();
    $('textShadow').checked = !!t.shadow;
    $('textTransparent').checked = !t.bg; setVal('textBgColor', t.bg || '#101018');
    $('textBgColor').disabled = !t.bg;
    updateAllLabels();
    updateColorUI();
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
    state.params.paletteId = name;   // presets pick their own palette
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
      else if (mode === 'dust') buildDust();
      // 'render' => nothing, preview loop picks it up
    });
  }

  var _rd = null;
  function scheduleRedetect() { clearTimeout(_rd); _rd = setTimeout(redetect, 120); }

  function init() {
    applyTextCustom();   // register the "My palette" glitter style (last in the picker)

    // file input + drop
    var input = $('fileInput');
    input.addEventListener('change', function () { if (input.files[0]) openFile(input.files[0]); });
    $('openBtn').addEventListener('click', function () { input.click(); });
    $('dropHint').addEventListener('click', function () { input.click(); });

    // hold-to-compare
    var cmp = $('compareBtn');
    function cmpOff() { state.compare = false; }
    cmp.addEventListener('pointerdown', function (ev) { ev.preventDefault(); state.compare = true; });
    cmp.addEventListener('pointerup', cmpOff);
    cmp.addEventListener('pointerleave', cmpOff);
    cmp.addEventListener('pointercancel', cmpOff);

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

    // presets + looks + chaos
    $('presetClassic').addEventListener('click', function () { applyPreset('classic'); });
    $('presetAstral').addEventListener('click', function () { applyPreset('astral'); });
    $('saveLookBtn').addEventListener('click', saveLook);
    $('savedLooks').addEventListener('change', function () { if (this.value) applyLook(this.value); });
    $('chaosBtn').addEventListener('click', chaos);
    refreshLooks();

    // mode tabs
    $('tabImage').addEventListener('click', function () { setMode('image'); });
    $('tabText').addEventListener('click', function () { setMode('text'); });
    $('tabLiminal').addEventListener('click', function () { setMode('liminal'); });
    buildLiminalUI();

    // sparkle it (re-roll)
    $('sparkleBtn').addEventListener('click', function () {
      state.params.seed = (Math.random() * 1e9) | 0;
      if (state.mode === 'text') { buildGlitterField(); setStatus('✨ Reglittered!'); }
      else if (state.mode === 'liminal') { setStatus('🌑 Re-haunted! (fresh grain)'); }
      else if (!state.source) { $('fileInput').click(); }
      else { redetect(); buildGlitterField(); setStatus('✨ Sparkled! ' + state.instances.length + ' sparkles'); }
    });

    // sliders
    bindSlider('intensity', 'intensity', 'render');
    bindSlider('maxSize', 'maxSize', 'render');
    bindSlider('spriteScale', 'spriteScale', 'render');
    bindSlider('density', 'density', 'redetect');
    bindSlider('glow', 'glow', 'render');
    bindSlider('colorBoost', 'colorBoost', 'rebuild');
    bindSlider('speed', 'speed', 'render');
    bindSlider('drift', 'drift', 'render');
    bindSlider('lengthSec', 'lengthSec', 'render');
    bindSlider('fps', 'fps', 'render');
    bindSlider('lumaThreshold', 'lumaThreshold', 'redetect');
    bindSlider('contrastThreshold', 'contrastThreshold', 'redetect');
    bindSlider('lumaWeight', 'lumaWeight', 'redetect');
    bindSlider('edgeWeight', 'edgeWeight', 'redetect');
    bindSlider('count', 'count', 'redetect');
    bindSlider('spacing', 'spacing', 'redetect');
    bindSlider('jitter', 'jitter', 'redetect');
    bindSlider('dustDensity', 'dustDensity', 'dust');
    bindSlider('dustGrain', 'dustGrain', 'dust');
    bindSlider('dustIntensity', 'dustIntensity', 'dust');
    $('brushSize').addEventListener('input', function () { state.brushSize = parseFloat($('brushSize').value); updateAllLabels(); });

    // selects / checkboxes
    $('styleMix').addEventListener('change', function () { state.params.styleMix = $('styleMix').value; rebuild(); });
    $('colorMode').addEventListener('change', function () { state.params.colorMode = $('colorMode').value; rebuild(); updateColorUI(); });
    $('paletteId').addEventListener('change', function () { state.params.paletteId = $('paletteId').value; rebuild(); updateColorUI(); });
    $('singleColor').addEventListener('input', function () { state.params.singleColor = U.hexToRgb($('singleColor').value); rebuild(); });
    $('motion').addEventListener('change', function () { state.params.motion = $('motion').value; });
    $('detectMode').addEventListener('change', function () { state.params.detectMode = $('detectMode').value; redetect(); });
    $('hueCycle').addEventListener('change', function () { state.params.hueCycle = $('hueCycle').checked; });
    $('spin').addEventListener('change', function () { state.params.spinRevs = $('spin').checked ? 1 : 0; });
    $('depthLayers').addEventListener('change', function () { state.params.depthLayers = $('depthLayers').checked; });
    $('trace').addEventListener('change', function () { state.params.trace = $('trace').checked; redetect(); });
    $('showDetect').addEventListener('change', function () { state.params.showDetect = $('showDetect').checked; });
    $('dustOn').addEventListener('change', function () { state.params.dust = $('dustOn').checked; buildDust(); updateColorUI(); });

    // image custom palette swatches
    document.querySelectorAll('.palSwatch').forEach(function (el, i) {
      el.addEventListener('input', function () {
        imageCustomHex[i] = el.value;
        saveJSON(IMG_PAL_KEY, imageCustomHex);
        if (state.params.colorMode === 'palette' && state.params.paletteId === 'mine') rebuild();
      });
    });
    // text custom palette swatches
    function onTextPal() {
      textCustomDef.base = $('textPalBase').value;
      textCustomDef.flakes = [];
      document.querySelectorAll('.textPalFlake').forEach(function (el) { textCustomDef.flakes.push(el.value); });
      saveJSON(TXT_PAL_KEY, textCustomDef);
      applyTextCustom();
      buildGlitterField();
    }
    $('textPalBase').addEventListener('input', onTextPal);
    document.querySelectorAll('.textPalFlake').forEach(function (el) { el.addEventListener('input', onTextPal); });

    // glitter controls (shared by text mode + image glitter-fill)
    populateGlitterStyleSelect();
    populatePaletteSelect();
    $('glitterStyle').addEventListener('change', function () {
      state.params.glitterStyle = $('glitterStyle').value;
      buildGlitterField();
      if (state.mode === 'text' && state.source && state.source.textRender) resolveTextures(state.source);
      buildDust(); updateColorUI();
    });
    $('uploadFillBtn').addEventListener('click', function () { $('texFileInput').click(); });
    $('texFileInput').addEventListener('change', function () {
      if (this.files && this.files[0]) onTextureFile(this.files[0]);
      this.value = '';
    });
    $('glitterDensity').addEventListener('input', function () { state.params.glitterDensity = parseFloat($('glitterDensity').value); updateAllLabels(); buildGlitterField(); });
    $('glitterIntensity').addEventListener('input', function () { state.params.glitterIntensity = parseFloat($('glitterIntensity').value); updateAllLabels(); });
    $('glitterGrain').addEventListener('input', function () { state.params.glitterGrain = parseFloat($('glitterGrain').value); updateAllLabels(); buildGlitterField(); });
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
    bindText('textCaps', 'caps', 'change'); bindText('textSpacing', 'letterSpacing');
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
      pushUndo();
      state.penCenters = []; state.maskActive = false;
      if (state.maskCanvas) state.maskCanvas.getContext('2d').clearRect(0, 0, state.maskCanvas.width, state.maskCanvas.height);
      redetect();
    });
    $('undoBtn').addEventListener('click', undo);
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
    setLiminal: limSet,
    applyLiminalPreset: applyLiminalPreset,
    loadFontFromBuffer: loadFontFromBuffer,
    loadTextureFromBuffer: loadTextureFromBuffer,
    setText: function (o) { for (var k in o) state.textOpts[k] = o[k]; syncControls(); if (state.mode === 'text') rebuildText(); },
    setGlitter: function (o) {
      for (var k in o) if (o[k] != null) state.params[k] = o[k];
      syncControls(); buildGlitterField();
      if (state.mode === 'text' && state.source && state.source.textRender) resolveTextures(state.source);
      buildDust();
    },
    redetect: redetect,
    renderStillCanvas: function () { return EXP.renderStill(state.source, state.instances, state.params, 640, currentMatte(), renderExtras()); },
    exportGifBytes: function () {
      return EXP.exportGIF(state.source, state.instances, state.params,
        { maxLong: 240, matte: currentMatte(), render: renderExtras(), transparent: textTransparent(), lengthSec: 1, fps: 8 }, function () {});
    }
  };
})();
