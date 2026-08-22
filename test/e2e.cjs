/* End-to-end test in a real browser (pre-installed Chromium via playwright-core).
 * Serves the app over http, then drives it exactly like a user would:
 *   - upload a high-contrast image -> detect -> sparkles rendered
 *   - export an animated GIF and confirm the BROWSER natively decodes it
 *   - upload an animated GIF -> decode -> composite -> export
 *   - check video-export support
 * Saves screenshots to test/out/.
 */
'use strict';
const { chromium } = require('playwright-core');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SB = require('../js/util.js');
require('../js/gif-encode.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const PORT = 8123;
// Override with CHROMIUM_PATH=/path/to/chrome on other machines; defaults to the
// browser pre-installed in this environment.
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

let failures = 0, warns = 0;
function ok(cond, msg) { if (!cond) { failures++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); } }
function warn(msg) { warns++; console.warn('  ! ' + msg); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --- build a small animated GIF fixture with our own encoder ---
function makeGifFixture() {
  const W = 80, H = 60, N = 6, frames = [];
  for (let f = 0; f < N; f++) {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4;
      d[p] = 30 + ((x * 3) & 120); d[p + 1] = 20; d[p + 2] = 40 + ((y * 3) & 120); d[p + 3] = 255;
    }
    const bx = 6 + f * 11, by = 24;
    for (let y = by; y < by + 10; y++) for (let x = bx; x < bx + 10; x++) {
      if (x >= W || y >= H) continue; const p = (y * W + x) * 4;
      d[p] = 255; d[p + 1] = 255; d[p + 2] = 255; d[p + 3] = 255;
    }
    frames.push({ data: d, delay: 120 });
  }
  return SB.encodeGIF(frames, { width: W, height: H, loop: 0 });
}

function waitServer() {
  return new Promise((res, rej) => {
    let tries = 0;
    const t = setInterval(() => {
      http.get(`http://localhost:${PORT}/index.html`, r => { r.destroy(); clearInterval(t); res(); })
        .on('error', () => { if (++tries > 50) { clearInterval(t); rej(new Error('server never came up')); } });
    }, 100);
  });
}

async function poll(page, fn, timeout, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn)) return true;
    await sleep(80);
  }
  throw new Error('timeout waiting for ' + (label || 'condition'));
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const gifB64 = Buffer.from(makeGifFixture()).toString('base64');

  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await waitServer();

  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  try {
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
    await poll(page, () => !!window.SparkleBitch && !!window.SB, 5000, 'app init');
    ok(true, 'app loaded and engine present');

    // ---- IMAGE: build a high-contrast test image in-page and open it ----
    await page.evaluate(async () => {
      const W = 480, H = 320;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      x.fillStyle = '#0a0a12'; x.fillRect(0, 0, W, H);
      const cols = ['#fff', '#ff5fd2', '#4fe3ff', '#b6ff5a', '#ffd45c'];
      for (let i = 0; i < 60; i++) {
        x.fillStyle = cols[i % cols.length];
        const r = 3 + (i % 5);
        x.beginPath(); x.arc(20 + (i * 37) % (W - 40), 20 + (i * 53) % (H - 40), r, 0, 7); x.fill();
      }
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      const file = new File([blob], 'test.png', { type: 'image/png' });
      window.SparkleBitch.openFile(file);
    });
    await poll(page, () => window.SparkleBitch.state.source && window.SparkleBitch.state.instances.length > 0, 6000, 'image sparkles');
    const imgInfo = await page.evaluate(() => {
      const st = window.SparkleBitch.state;
      // count hot (near-white) pixels of base vs. a still render with sparkles;
      // sparkle cores + glow are bright, so this is a direct "were they drawn?"
      function stats(cv) {
        const g = cv.getContext('2d'); const d = g.getImageData(0, 0, cv.width, cv.height).data;
        let sum = 0, hot = 0;
        for (let i = 0; i < d.length; i += 4) {
          const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          sum += L; if (L > 210) hot++;
        }
        return { luma: sum / (d.length / 4), hot: hot };
      }
      const base = document.createElement('canvas'); base.width = 480; base.height = 320;
      base.getContext('2d').drawImage(st.source.drawable, 0, 0, 480, 320);
      const b = stats(base);
      const still = SB.exporter.renderStill(st.source, st.instances, st.params, 480, '#0a0710');
      const s = stats(still);
      return { count: st.instances.length, baseHot: b.hot, stillHot: s.hot, baseLuma: b.luma, stillLuma: s.luma };
    });
    ok(imgInfo.count > 20, 'image: detected sparkles (' + imgInfo.count + ')');
    ok(imgInfo.stillHot > imgInfo.baseHot + 100,
      'image: sparkles drawn — hot pixels ' + imgInfo.baseHot + ' -> ' + imgInfo.stillHot +
      ' (avg luma ' + imgInfo.baseLuma.toFixed(1) + ' -> ' + imgInfo.stillLuma.toFixed(1) + ')');
    await sleep(300);
    await page.screenshot({ path: path.join(OUT, '01-image.png') });

    // ---- GIF EXPORT: bytes valid + browser natively decodes them ----
    const gifOut = await page.evaluate(async () => {
      const bytes = await window.SparkleBitch.exportGifBytes();
      const u8 = new Uint8Array(bytes);
      const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3], u8[4], u8[5]);
      const dec = SB.decodeGIF(u8); // our decoder, in-browser
      // native decode via <img>
      let b = '';
      for (let i = 0; i < u8.length; i++) b += String.fromCharCode(u8[i]);
      const dataUrl = 'data:image/gif;base64,' + btoa(b);
      const img = new Image();
      const nativeLuma = await new Promise((res) => {
        img.onload = () => {
          const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
          const g = c.getContext('2d'); g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data;
          let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
          res(s / (d.length / 4));
        };
        img.onerror = () => res(-1);
        img.src = dataUrl;
      });
      return { len: u8.length, magic, frames: dec.frames.length, w: dec.width, h: dec.height, nativeLuma };
    });
    ok(gifOut.magic === 'GIF89a', 'gif export: valid GIF89a header');
    ok(gifOut.len > 200, 'gif export: non-trivial size (' + gifOut.len + ' bytes)');
    ok(gifOut.frames > 1, 'gif export: multi-frame (' + gifOut.frames + ')');
    ok(gifOut.nativeLuma > 0, 'gif export: BROWSER natively decodes our GIF (luma ' + (gifOut.nativeLuma | 0) + ')');

    // ---- GIF INPUT: open an animated GIF, decode+composite+re-export ----
    await page.evaluate(async (b64) => {
      const bin = atob(b64); const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const file = new File([u8], 'in.gif', { type: 'image/gif' });
      window.SparkleBitch.openFile(file);
    }, gifB64);
    await poll(page, () => {
      const st = window.SparkleBitch.state;
      return st.source && st.source.kind === 'gif' && st.source.frames && st.source.frames.length > 1;
    }, 6000, 'gif input decoded');
    const gifIn = await page.evaluate(async () => {
      const st = window.SparkleBitch.state;
      const bytes = await window.SparkleBitch.exportGifBytes();
      const dec = SB.decodeGIF(new Uint8Array(bytes));
      return { srcFrames: st.source.frames.length, instances: st.instances.length, outFrames: dec.frames.length };
    });
    ok(gifIn.srcFrames === 6, 'gif input: decoded all frames (' + gifIn.srcFrames + ')');
    ok(gifIn.instances > 0, 'gif input: sparkles placed (' + gifIn.instances + ')');
    ok(gifIn.outFrames === gifIn.srcFrames, 'gif input: re-exported same frame count (' + gifIn.outFrames + ')');
    await sleep(200);
    await page.screenshot({ path: path.join(OUT, '02-gif.png') });

    // ---- TEXT MODE: glitter text, transparent background, export ----
    await page.evaluate(async () => {
      window.SparkleBitch.setMode('text');
      window.SparkleBitch.setText({ text: 'SPARKLE BITCH', size: 96, outlines: [{ width: 5, kind: 'color', color: '#3a0a2e' }] });
      window.SparkleBitch.setGlitter({ glitterStyle: 'rainbow', glitterDensity: 0.7 });
    });
    await poll(page, () => {
      var s = window.SparkleBitch.state;
      return s.mode === 'text' && s.source && s.source.kind === 'text' && s.glitterField;
    }, 5000, 'text source');
    const textInfo = await page.evaluate(() => {
      var cv = window.SparkleBitch.renderStillCanvas();
      var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      var lit = 0, opaque = 0, transparent = 0;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 200) { opaque++; if (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] > 110) lit++; }
        else if (d[i + 3] < 8) transparent++;
      }
      return { opaque: opaque, lit: lit, transparent: transparent, total: d.length / 4 };
    });
    ok(textInfo.opaque > 200, 'text: letterforms rendered (' + textInfo.opaque + ' opaque px)');
    ok(textInfo.lit > 100, 'text: glitter fills the letters (' + textInfo.lit + ' bright px)');
    ok(textInfo.transparent > textInfo.total * 0.3, 'text: transparent background (' + Math.round(100 * textInfo.transparent / textInfo.total) + '%)');
    const tgif = await page.evaluate(async () => {
      var u8 = new Uint8Array(await window.SparkleBitch.exportGifBytes());
      var dec = SB.decodeGIF(u8), f = dec.frames[0].data, hasT = false;
      for (var i = 0; i < f.length; i += 4) { if (f[i + 3] < 8) { hasT = true; break; } }
      return { magic: String.fromCharCode(u8[0], u8[1], u8[2]), frames: dec.frames.length, hasT: hasT };
    });
    ok(tgif.magic === 'GIF', 'text gif: valid GIF');
    ok(tgif.frames > 1, 'text gif: multi-frame (' + tgif.frames + ')');
    ok(tgif.hasT, 'text gif: transparent background preserved');
    await sleep(200);
    await page.screenshot({ path: path.join(OUT, '03-text.png') });

    // ---- GLITTER FILL over an image ----
    await page.evaluate(async () => {
      var W = 320, H = 200, c = document.createElement('canvas'); c.width = W; c.height = H;
      var x = c.getContext('2d'); x.fillStyle = '#141018'; x.fillRect(0, 0, W, H);
      var blob = await new Promise(function (r) { c.toBlob(r, 'image/png'); });
      window.SparkleBitch.openFile(new File([blob], 'flat.png', { type: 'image/png' }));
    });
    await poll(page, () => window.SparkleBitch.state.mode === 'image' && window.SparkleBitch.state.source, 5000, 'image reloaded');
    const gfill = await page.evaluate(() => {
      window.SparkleBitch.setGlitter({ glitterOnImage: true, glitterStyle: 'gold', glitterDensity: 0.8, glitterIntensity: 1 });
      var cv = window.SparkleBitch.renderStillCanvas();
      var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, bright = 0;
      for (var i = 0; i < d.length; i += 4) if (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] > 120) bright++;
      return { on: window.SparkleBitch.state.params.glitterOnImage, bright: bright };
    });
    ok(gfill.on === true, 'image: glitter fill toggles on');
    ok(gfill.bright > 300, 'image: glitter lays flakes over the photo (' + gfill.bright + ' bright px)');

    // ---- FIX: glitter strength affects text output ----
    // (shadow/outline off so the fill's own opacity — driven by the slider — is
    // what's measured; otherwise the shadow floors the interior alpha.)
    const strength = await page.evaluate(() => {
      var SBM = window.SparkleBitch;
      SBM.setMode('text'); SBM.setText({ text: 'AB', size: 120, shadow: false, outlines: [] });
      SBM.setGlitter({ glitterStyle: 'gold', glitterIntensity: 1 });
      function opaque(cv) { var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, n = 0; for (var i = 0; i < d.length; i += 4) if (d[i + 3] > 180) n++; return n; }
      var hi = opaque(SBM.renderStillCanvas());
      SBM.setGlitter({ glitterIntensity: 0.25 });
      var lo = opaque(SBM.renderStillCanvas());
      return { hi: hi, lo: lo };
    });
    ok(strength.hi > strength.lo * 1.8, 'fix: glitter strength changes text output (' + strength.hi + ' -> ' + strength.lo + ')');

    // ---- FIX: switching modes preserves the image + never crashes painting ----
    await page.evaluate(async () => {
      var W = 200, H = 140, c = document.createElement('canvas'); c.width = W; c.height = H;
      c.getContext('2d').fillStyle = '#123'; c.getContext('2d').fillRect(0, 0, W, H);
      var blob = await new Promise(function (r) { c.toBlob(r, 'image/png'); });
      window.SparkleBitch.openFile(new File([blob], 'keep.png', { type: 'image/png' }));
    });
    await poll(page, () => window.SparkleBitch.state.mode === 'image' && window.SparkleBitch.state.source, 5000, 'image for mode test');
    const modeSafe = await page.evaluate(() => {
      var SBM = window.SparkleBitch;
      var before = SBM.state.source && SBM.state.source.kind;
      SBM.state.tool = 'pen';                 // as if Pen was picked in image mode
      SBM.setMode('text');                    // switch to text
      var v = document.getElementById('view'), r = v.getBoundingClientRect();
      v.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      var toolInText = SBM.state.tool;
      SBM.setMode('image');                   // back to image — must still be loaded
      return { before: before, restored: SBM.state.source && SBM.state.source.kind, tool: toolInText };
    });
    ok(modeSafe.before === 'image', 'fix: image loaded before switch');
    ok(modeSafe.restored === 'image', 'fix: image preserved after Text round-trip (no reopen)');
    ok(modeSafe.tool === 'auto', 'fix: paint tool reset to Auto in Text mode (no crash on click)');

    // ---- FONTS: grouped picker + a bundled pixel font renders in-browser ----
    const fontUI = await page.evaluate(() => {
      var sel = document.getElementById('textFont');
      return { groups: sel.querySelectorAll('optgroup').length, opts: sel.querySelectorAll('option').length };
    });
    ok(fontUI.groups >= 6, 'fonts: picker is grouped (' + fontUI.groups + ' groups)');
    ok(fontUI.opts >= 25, 'fonts: many fonts in the picker (' + fontUI.opts + ')');

    const pixelFont = await page.evaluate(async () => {
      var S = window.SparkleBitch;
      S.setMode('text');
      S.setGlitter({ glitterStyle: 'gold', glitterIntensity: 1 });   // reset from the strength test
      S.setText({ text: 'AB', size: 90, font: 'pressstart', outlines: [], shadow: false });
      await document.fonts.load('64px "Press Start 2P"');   // resolves when the face is ready
      S.setText({ font: 'pressstart' });                    // sync rebuild now uses the loaded font
      var cv = S.renderStillCanvas();
      var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, opaque = 0;
      for (var i = 0; i < d.length; i += 4) if (d[i + 3] > 180) opaque++;
      return { opaque: opaque, loaded: document.fonts.check('64px "Press Start 2P"') };
    });
    ok(pixelFont.loaded, 'fonts: bundled Press Start 2P loaded in-browser');
    ok(pixelFont.opaque > 200, 'fonts: bundled font renders letterforms (' + pixelFont.opaque + ' px)');

    // ---- multi-line text + alignment + leading ----
    const multi = await page.evaluate(() => {
      var S = window.SparkleBitch;
      S.setMode('text'); S.setGlitter({ glitterIntensity: 1 });
      S.setText({ text: 'line one\nline two\nthree', font: 'arialblack', size: 60, align: 'left', leading: 1.3, outlines: [], shadow: false });
      var h1 = S.state.source.height;
      S.setText({ leading: 2.2 });
      var h2 = S.state.source.height;               // more leading -> taller canvas
      S.setText({ align: 'right' });
      return { h1: h1, h2: h2, lines: S.state.textOpts.text.split('\n').length, align: S.state.textOpts.align };
    });
    ok(multi.lines === 3, 'text: multi-line via newlines (' + multi.lines + ' lines)');
    ok(multi.h2 > multi.h1 + 20, 'text: line-spacing (leading) changes height (' + multi.h1 + ' -> ' + multi.h2 + ')');
    ok(multi.align === 'right', 'text: alignment control applies');

    // ---- pathological input can't blow past canvas limits ----
    const cap = await page.evaluate(() => {
      var S = window.SparkleBitch;
      var big = new Array(60).fill('WWWWWWWWWW').join('\n');   // 60 wide lines
      S.setText({ text: big, size: 200, leading: 2.4, outlines: [], shadow: false });
      return { w: S.state.source.width, h: S.state.source.height };
    });
    ok(cap.h <= 8000 && cap.w <= 8000, 'text: canvas clamped on huge input (' + cap.w + 'x' + cap.h + ')');

    // ---- REGRESSION: repeat GIF export via the real button (no refresh) ----
    await page.evaluate(() => {
      var S = window.SparkleBitch;
      S.setMode('text'); S.setText({ text: 'AGAIN', size: 72, outlines: [], shadow: false });
      S.setGlitter({ glitterStyle: 'gold', glitterIntensity: 1, glitterGrain: 1, lengthSec: 1, fps: 8 });
    });
    await sleep(200);
    let reexportOK = true, busyStuck = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      await page.evaluate(() => {
        document.getElementById('status').textContent = '';
        document.getElementById('exportGif').click();
      });
      const finished = await poll(page, () => {
        var s = document.getElementById('status').textContent;
        return s.indexOf('Saved GIF') === 0 || s.indexOf('⚠') === 0;
      }, 30000, 'gif re-export #' + attempt).catch(() => false);
      const st = await page.evaluate(() => ({
        status: document.getElementById('status').textContent, busy: window.SparkleBitch.state.busy
      }));
      if (!finished || st.status.indexOf('Saved GIF') !== 0) reexportOK = false;
      if (st.busy) busyStuck = true;
    }
    ok(reexportOK, 'export bug: GIF export works twice in a row, no refresh');
    ok(!busyStuck, 'export bug: busy flag always released (buttons never wedge)');
    const resultUI = await page.evaluate(() => ({
      shown: !document.getElementById('result').classList.contains('hidden'),
      saveBtn: !!document.querySelector('#result .result-save')
    }));
    ok(resultUI.shown && resultUI.saveBtn, 'export bug: result panel + Save button shown after export');

    // ---- letter spacing + ALL CAPS ----
    const typo = await page.evaluate(() => {
      var S = window.SparkleBitch;
      S.setMode('text'); S.setGlitter({ glitterIntensity: 1 });
      S.setText({ text: 'SPARKLE', size: 80, letterSpacing: 0, caps: false, outlines: [], shadow: false });
      var tight = S.state.source.width;
      S.setText({ letterSpacing: 12 });
      var wide = S.state.source.width;
      S.setText({ text: 'sparkle', letterSpacing: 0, caps: false });
      var lower = S.state.source.textRender.maskCanvas;
      S.setText({ caps: true });
      var upper = S.state.source.textRender.maskCanvas;
      // caps render must be identical to typing the caps yourself
      S.setText({ text: 'SPARKLE', caps: false });
      var typed = S.state.source.textRender.maskCanvas;
      function px(cv) { return cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data.join(','); }
      return { tight: tight, wide: wide, capsMatch: px(upper) === px(typed), capsDiffer: px(lower) !== px(typed) };
    });
    ok(typo.wide > typo.tight + 30, 'text: letter spacing widens lines (' + typo.tight + ' -> ' + typo.wide + ')');
    ok(typo.capsMatch && typo.capsDiffer, 'text: ALL CAPS renders uppercase (same as typing caps)');

    // ---- grain size + extended density + new styles ----
    const grain = await page.evaluate(() => {
      var S = window.SparkleBitch;
      S.setText({ text: 'FINE', size: 80, caps: false });
      S.setGlitter({ glitterStyle: 'silver', glitterGrain: 0.25 });
      var fineGrain = S.state.glitterField.grain;
      var cv = S.renderStillCanvas();
      var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, opaque = 0;
      for (var i = 0; i < d.length; i += 4) if (d[i + 3] > 180) opaque++;
      var gslider = document.getElementById('glitterGrain');
      var dslider = document.getElementById('glitterDensity');
      return { grain: fineGrain, opaque: opaque, gmin: gslider && gslider.min, dmax: dslider && dslider.max };
    });
    ok(grain.grain === 0.25, 'glitter: grain size reaches the field (0.25x = extra fine)');
    ok(grain.opaque > 200, 'glitter: fine grain still fills letters (' + grain.opaque + ' px)');
    ok(grain.gmin === '0.2', 'glitter: grain slider goes down to 0.2');
    ok(grain.dmax === '2', 'glitter: density slider goes up to 2');
    const maxSizeMin = await page.evaluate(() => document.getElementById('maxSize').min);
    ok(maxSizeMin === '4', 'image: Max size slider now goes down to 4px');

    // density 0..1 unchanged; >1 packs tighter; fine grain + max density = way more flakes
    const dens = await page.evaluate(() => {
      function n(density, grain) { return SB.glitter.buildField(400, 300, 'silver', density, 42, grain).flakes.length; }
      return { d06: n(0.6, 1), d06fine: n(0.6, 0.2), d1: n(1, 1), d2: n(2, 1), capped: n(2, 0.2) };
    });
    ok(dens.d06 === dens.d06fine, 'glitter: grain does not change flake count (' + dens.d06 + ')');
    ok(dens.d06 === Math.round(400 * 300 / (6.56 * 6.56)), 'glitter: density 0..1 mapping unchanged (' + dens.d06 + ' flakes)');
    ok(dens.d2 > dens.d1 * 2, 'glitter: density 2 packs much tighter than 1 (' + dens.d1 + ' -> ' + dens.d2 + ')');
    ok(dens.capped <= 40000, 'glitter: flake count capped for perf (' + dens.capped + ')');

    const styles2 = await page.evaluate(() => SB.glitter.styleList().map(function (s) { return s.id; }));
    ['sugarpaper', 'creamsicle', 'blueskies', 'rosequartz', 'allpink', 'allblue', 'allpurple', 'allgreen', 'sherbet', 'toxic', 'peach', 'berry', 'sunset', 'bubblegum']
      .forEach(function (id) { ok(styles2.indexOf(id) >= 0, 'glitter: new style "' + id + '" present'); });
    ok(styles2.length >= 30, 'glitter: big style set (' + styles2.length + ' styles)');

    // light styles really are light-based with no near-white flakes
    const lightCheck = await page.evaluate(() => {
      var out = [];
      ['sugarpaper', 'creamsicle', 'blueskies', 'rosequartz', 'peach', 'bubblegum'].forEach(function (id) {
        var st = SB.glitter.STYLES[id];
        var baseLum = 0.2126 * st.base[0] + 0.7152 * st.base[1] + 0.0722 * st.base[2];
        var hasWhite = st.palette.some(function (c) { return c[0] > 245 && c[1] > 245 && c[2] > 245; });
        out.push(baseLum > 180 && !hasWhite);
      });
      return out.every(function (x) { return x; });
    });
    ok(lightCheck, 'glitter: light styles have light bases + NO invisible white flakes');

    // ---- new multi-colour glitter styles ----
    const styles = await page.evaluate(() => SB.glitter.styleList().map(function (s) { return s.id; }));
    ok(styles.indexOf('neon') >= 0, 'glitter: "All Neon" style present');
    ok(styles.length >= 18, 'glitter: expanded style set (' + styles.length + ' styles)');

    // ---- layered sparkle outlines ----
    const outlines = await page.evaluate(() => {
      var S = window.SparkleBitch;
      S.setMode('text'); S.setGlitter({ glitterStyle: 'silver', glitterIntensity: 1 });
      S.setText({ text: 'A', size: 120, outlines: [], shadow: false });
      var noneW = S.state.source.width;
      S.setText({ outlines: [
        { width: 8, kind: 'glitter', glitter: 'neon' },   // inner: glitter outline
        { width: 8, kind: 'color', color: '#00e5ff' }     // outer: solid cyan
      ] });
      var withW = S.state.source.width;
      var layers = S.state.source.textRender.layers.length;
      var cv = S.renderStillCanvas();
      var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, cyan = 0;
      for (var i = 0; i < d.length; i += 4) if (d[i + 3] > 180 && d[i] < 120 && d[i + 1] > 170 && d[i + 2] > 200) cyan++;
      return { noneW: noneW, withW: withW, layers: layers, cyan: cyan };
    });
    ok(outlines.withW > outlines.noneW, 'outlines: layers widen the canvas (' + outlines.noneW + ' -> ' + outlines.withW + ')');
    ok(outlines.layers === 2, 'outlines: two outline layers built');
    ok(outlines.cyan > 100, 'outlines: solid cyan outer outline is visible (' + outlines.cyan + ' px)');

    // ---- VIDEO SUPPORT ----
    const vid = await page.evaluate(() => ({ supported: SB.exporter.videoSupported() }));
    if (vid.supported) ok(true, 'video: MediaRecorder available in this browser');
    else warn('video: MediaRecorder not available (best-effort feature)');

    // ---- custom fonts persist across reloads (IndexedDB) ----
    const optionHas = function () {
      return Array.prototype.some.call(document.querySelectorAll('#textFont option'),
        function (o) { return o.textContent === 'My Persist Font'; });
    };
    const loaded = await page.evaluate(async (has) => {
      var buf = await (await fetch('fonts/vt323.woff2')).arrayBuffer();
      await window.SparkleBitch.loadFontFromBuffer('My Persist Font', buf, true);
      await new Promise(function (r) { setTimeout(r, 60); });   // let the IDB put settle
      return (new Function('return (' + has + ')()'))();
    }, optionHas.toString());
    ok(loaded, 'fonts: uploaded font appears in the picker');

    await page.reload({ waitUntil: 'load' });
    await poll(page, () => !!window.SparkleBitch && !!window.SB, 6000, 'reload init');
    const remembered = await page.evaluate((has) => {
      return new Promise(function (res) {
        var check = new Function('return (' + has + ')()'), tries = 0;
        var t = setInterval(function () {
          if (check() || ++tries > 60) { clearInterval(t); res(check()); }
        }, 50);
      });
    }, optionHas.toString());
    ok(remembered, 'fonts: custom font is REMEMBERED after a page reload');

    ok(pageErrors.length === 0, 'no uncaught page errors' + (pageErrors.length ? ': ' + pageErrors[0] : ''));
  } catch (e) {
    failures++; console.error('  ✗ EXCEPTION: ' + e.message);
    try { await page.screenshot({ path: path.join(OUT, 'error.png') }); } catch (_) {}
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }

  console.log(failures === 0 ? `\nE2E OK${warns ? ' (' + warns + ' warnings)' : ''}` : `\nE2E FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
})();
