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

    // ---- NEW COLOURS: red / black / yellow render as themselves ----
    const newcols = await page.evaluate(() => {
      var S = window.SparkleBitch;
      S.setMode('text'); S.setText({ text: 'RGB', size: 96, shadow: false, outlines: [] });
      function stat(style) {
        S.setGlitter({ glitterStyle: style, glitterIntensity: 1, glitterDensity: 1, glitterGrain: 1, seed: 7 });
        var cv = S.renderStillCanvas(), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        var opaque = 0, r = 0, g = 0, b = 0, lit = 0;
        for (var i = 0; i < d.length; i += 4) if (d[i + 3] > 180) {
          opaque++; r += d[i]; g += d[i + 1]; b += d[i + 2];
          if (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] > 150) lit++;
        }
        return { opaque: opaque, r: r / opaque | 0, g: g / opaque | 0, b: b / opaque | 0, lit: lit };
      }
      return { red: stat('red'), yellow: stat('yellow'), black: stat('black') };
    });
    ok(newcols.red.opaque > 200 && newcols.red.r > newcols.red.b + 25 && newcols.red.r > newcols.red.g + 20,
      'colours: red glitter reads red (' + newcols.red.r + ',' + newcols.red.g + ',' + newcols.red.b + ')');
    ok(newcols.yellow.opaque > 200 && newcols.yellow.r > 150 && newcols.yellow.g > 150 && newcols.yellow.b < newcols.yellow.g - 20,
      'colours: yellow glitter reads yellow (' + newcols.yellow.r + ',' + newcols.yellow.g + ',' + newcols.yellow.b + ')');
    ok(newcols.black.opaque > 200 && newcols.black.lit > 5,
      'colours: black glitter fills letters and still twinkles (' + newcols.black.lit + ' bright px)');

    // ---- PER-OUTLINE GLITTER: strength/density/grain independent of the fill ----
    const perOut = await page.evaluate(() => {
      var S = window.SparkleBitch;
      S.setMode('text');
      // dark fill so bright pixels are dominated by the gold outline band
      S.setGlitter({ glitterStyle: 'black', glitterIntensity: 1, glitterDensity: 1, glitterGrain: 1, seed: 1234 });
      function gold(cv) {
        var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, n = 0;
        for (var i = 0; i < d.length; i += 4) if (d[i + 3] > 160 && d[i] > 150 && d[i + 1] > 110 && d[i + 2] < 130) n++;
        return n;
      }
      S.setText({ text: 'O', size: 150, shadow: false,
        outlines: [{ width: 22, kind: 'glitter', glitter: 'gold', density: 1.6, grain: 1, intensity: 1 }] });
      var strong = gold(S.renderStillCanvas());
      var L1 = S.state.source.textRender.layers[0];
      // drop ONLY this outline's strength — the (black) fill is untouched
      S.setText({ outlines: [{ width: 22, kind: 'glitter', glitter: 'gold', density: 1.6, grain: 1, intensity: 0.2 }] });
      var weak = gold(S.renderStillCanvas());
      return { strong: strong, weak: weak, density: L1.density, grain: L1.grain, intensity: L1.intensity };
    });
    ok(perOut.density === 1.6 && perOut.intensity === 1 && perOut.grain === 1,
      'per-outline: the built layer carries its own density/grain/strength');
    ok(perOut.strong > 200 && perOut.strong > perOut.weak * 1.6,
      'per-outline: outline strength is independent of the fill (' + perOut.strong + ' -> ' + perOut.weak + ')');

    // ---- UPLOAD FILL: an N-frame GIF fills the text and drives N output frames ----
    const texFill = await page.evaluate(async () => {
      var S = window.SparkleBitch;
      // synthesize a 10-frame GIF fixture in-page
      var W = 48, H = 48, N = 10, frames = [];
      for (var f = 0; f < N; f++) {
        var d = new Uint8ClampedArray(W * H * 4);
        for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
          var p = (y * W + x) * 4; d[p] = (f * 25) & 255; d[p + 1] = (x * 5) & 255; d[p + 2] = (y * 5) & 255; d[p + 3] = 255;
        }
        frames.push({ data: d, delay: 80 });
      }
      var bytes = SB.encodeGIF(frames, { width: W, height: H, loop: 0 });
      var id = await S.loadTextureFromBuffer(bytes, true, 'mygif');
      S.setMode('text');
      S.setText({ text: 'GIF', size: 130, shadow: false, outlines: [] });
      S.setGlitter({ glitterStyle: 'tex:' + id });
      var src = S.state.source;
      var cv = S.renderStillCanvas(), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      var opaque = 0, transparent = 0;
      for (var i = 0; i < d.length; i += 4) { if (d[i + 3] > 200) opaque++; else if (d[i + 3] < 8) transparent++; }
      var u8 = new Uint8Array(await S.exportGifBytes());
      var dec = SB.decodeGIF(u8), hasT = false, f0 = dec.frames[0].data;
      for (var j = 0; j < f0.length; j += 4) { if (f0[j + 3] < 8) { hasT = true; break; } }
      return {
        frames: src.textureFrames, delaysLen: (src.textureDelays || []).length, delay0: (src.textureDelays || [])[0],
        opaque: opaque, transparent: transparent, outFrames: dec.frames.length, hasT: hasT,
        pickerHasUpload: !!document.querySelector('#glitterStyle optgroup[label="Your uploads"]')
      };
    });
    ok(texFill.frames === 10 && texFill.delaysLen === 10, 'upload: 10-frame GIF fill -> textureFrames = 10');
    ok(texFill.opaque > 200, 'upload: the image fills the letterforms (' + texFill.opaque + ' px)');
    ok(texFill.transparent > 0, 'upload: transparent background preserved');
    ok(texFill.outFrames === 10, 'upload: export is one frame per GIF frame — 16→16 (' + texFill.outFrames + ')');
    ok(texFill.delay0 === 80 && texFill.hasT, 'upload: export honours the GIF frame delays + transparency');
    ok(texFill.pickerHasUpload, 'upload: the texture appears in the Style picker');

    // ---- IMAGE PLACEMENT: detection modes / weights / trace / scatter ----
    await page.evaluate(async () => {
      var W = 240, H = 180, c = document.createElement('canvas'); c.width = W; c.height = H;
      var x = c.getContext('2d');
      x.fillStyle = '#050508'; x.fillRect(0, 0, W, H);
      x.fillStyle = '#ffffff'; x.fillRect(30, 30, 50, 50);      // bright blob (30..80, 30..80)
      x.fillStyle = '#888888'; x.fillRect(179, 20, 2, 140);     // gray vertical line (x~180, y 20..160)
      var blob = await new Promise(function (r) { c.toBlob(r, 'image/png'); });
      window.SparkleBitch.openFile(new File([blob], 'place.png', { type: 'image/png' }));
    });
    await poll(page, () => window.SparkleBitch.state.mode === 'image' && window.SparkleBitch.state.source, 5000, 'placement image loaded');

    const place = await page.evaluate(() => {
      var SBM = window.SparkleBitch;
      var nearLine = function (p) { return Math.abs(p.nx * 240 - 180) <= 5; };
      var inBlobStrict = function (p) { return p.nx * 240 >= 34 && p.nx * 240 <= 76 && p.ny * 180 >= 34 && p.ny * 180 <= 76; };
      function run(o) {
        SBM.setGlitter(o); SBM.redetect();
        return SBM.state.instances;
      }
      var out = {};
      // edges (grid): some points land on the gray line
      var eg = run({ detectMode: 'edges', trace: false, jitter: 0, spacing: 10, count: 700, lumaThreshold: 150, contrastThreshold: 60 });
      out.edgesTotal = eg.length; out.edgesOnLine = eg.filter(nearLine).length;
      // edges + trace: chains hug the line and span its length
      var tr = run({ detectMode: 'edges', trace: true });
      var trLine = tr.filter(nearLine);
      out.traceTotal = tr.length; out.traceOnLine = trLine.length;
      out.traceSpan = trLine.length
        ? Math.max.apply(null, trLine.map(function (p) { return p.ny; })) - Math.min.apply(null, trLine.map(function (p) { return p.ny; }))
        : 0;
      // scatter: exactly `count` points, ignores the image
      var sc = run({ detectMode: 'scatter', trace: false, count: 120 });
      out.scatterCount = sc.length;
      // shadow: avoids the bright blob interior
      var sh = run({ detectMode: 'shadow', count: 700 });
      out.shadowTotal = sh.length; out.shadowInBlob = sh.filter(inBlobStrict).length;
      // count cap
      out.cap = run({ detectMode: 'both', count: 40 }).length;
      // spacing: tighter grid = more points
      out.coarse = run({ detectMode: 'both', count: 2500, spacing: 30 }).length;
      out.fine = run({ detectMode: 'both', count: 2500, spacing: 8 }).length;
      // weights: luma-only scoring -> top points are the blob; edge-only -> none inside it
      var wl = run({ detectMode: 'both', count: 10, spacing: 10, lumaWeight: 2, edgeWeight: 0 });
      out.lumaAllInBlob = wl.every(function (p) { return p.nx * 240 >= 28 && p.nx * 240 <= 82 && p.ny * 180 >= 28 && p.ny * 180 <= 82; });
      var we = run({ detectMode: 'both', count: 10, spacing: 10, lumaWeight: 0, edgeWeight: 2 });
      out.edgeNoneInBlob = we.every(function (p) { return !inBlobStrict(p); });
      // back to sane defaults for later blocks
      run({ detectMode: 'both', trace: false, jitter: 0.35, spacing: 0, count: 700, lumaWeight: 0.75, edgeWeight: 0.6 });
      return out;
    });
    ok(place.edgesTotal > 0 && place.edgesOnLine >= 3, 'placement: edges mode finds the line (' + place.edgesOnLine + '/' + place.edgesTotal + ')');
    ok(place.traceOnLine >= 8, 'placement: trace chains along the line (' + place.traceOnLine + ' pts)');
    ok(place.traceSpan >= 0.45, 'placement: trace spans the line (ny span ' + place.traceSpan.toFixed(2) + ')');
    ok(place.scatterCount === 120, 'placement: scatter returns exactly count points (' + place.scatterCount + ')');
    ok(place.shadowTotal > 0 && place.shadowInBlob === 0, 'placement: shadow mode avoids bright blob (' + place.shadowTotal + ' pts, ' + place.shadowInBlob + ' in blob)');
    ok(place.cap <= 40, 'placement: count cap respected (' + place.cap + ')');
    ok(place.fine > place.coarse, 'placement: tighter spacing = more sparkles (' + place.coarse + ' -> ' + place.fine + ')');
    ok(place.lumaAllInBlob, 'placement: luma-only weighting tops the blob');
    ok(place.edgeNoneInBlob, 'placement: edge-only weighting skips the blob interior');

    // ---- DUST LAYER: fine glitter halo around detected centres ----
    const dustT = await page.evaluate(() => {
      var SBM = window.SparkleBitch;
      function bright() {
        var cv = SBM.renderStillCanvas();
        var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, n = 0;
        for (var i = 0; i < d.length; i += 4) if (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] > 150) n++;
        return n;
      }
      SBM.setGlitter({ dust: false }); var off = bright();
      SBM.setGlitter({ dust: true, dustDensity: 1.5, dustGrain: 0.3, dustIntensity: 1 });
      var hasField = !!(SBM.state.dust && SBM.state.dust.field && SBM.state.dust.field.flakes.length > 0);
      var flakes = hasField ? SBM.state.dust.field.flakes.length : 0;
      var on = bright();
      SBM.setGlitter({ dust: false });
      return { hasField: hasField, flakes: flakes, off: off, on: on };
    });
    ok(dustT.hasField, 'dust: halo field built (' + dustT.flakes + ' flakes)');
    ok(dustT.on > dustT.off + 50, 'dust: fine glitter halo renders (' + dustT.off + ' -> ' + dustT.on + ' bright px)');

    // ---- CUSTOM IMAGE PALETTE: swatches drive the 'mine' palette + persist ----
    const imgPal = await page.evaluate(() => {
      var SBM = window.SparkleBitch;
      var sw = document.querySelectorAll('#imgCustomPalette input[type=color]');
      if (!sw.length) return { swatches: 0 };
      sw[0].value = '#ff0000'; sw[0].dispatchEvent(new Event('input', { bubbles: true }));
      sw[1].value = '#00ff00'; sw[1].dispatchEvent(new Event('input', { bubbles: true }));
      var sel = document.getElementById('paletteId');
      sel.value = 'mine'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      var p = SBM.state.params.palette;
      var stored = JSON.parse(localStorage.getItem('sb-custom-image') || '[]');
      return {
        swatches: sw.length,
        palFirst: p && p[0] ? p[0].join(',') : 'none',
        palSecond: p && p[1] ? p[1].join(',') : 'none',
        storedFirst: stored[0] || 'none',
        mineOption: !!document.querySelector('#paletteId option[value="mine"]'),
        glitterStylesInPicker: document.querySelectorAll('#paletteId option').length
      };
    });
    ok(imgPal.swatches === 5, 'palette: image custom palette has 5 swatches');
    ok(imgPal.palFirst === '255,0,0' && imgPal.palSecond === '0,255,0', 'palette: custom swatches drive the image palette (' + imgPal.palFirst + ')');
    ok(imgPal.storedFirst === '#ff0000', 'palette: custom palette saved to localStorage');
    ok(imgPal.mineOption, 'palette: "My palette" option at the end of the list');
    ok(imgPal.glitterStylesInPicker >= 30, 'palette: all glitter styles usable as image palettes (' + imgPal.glitterStylesInPicker + ' options)');

    // ---- NEW SPRITE SETS + COLOUR MODES (pure engine) ----
    const spr = await page.evaluate(() => {
      var sets = SB.sparkles.STYLE_SETS;
      var centers = [];
      for (var i = 0; i < 40; i++) centers.push({ nx: (i % 8) / 8 + 0.06, ny: Math.floor(i / 8) / 5 + 0.1, size: 0.8, color: [255, 0, 0], score: 1 });
      function cols(o) { return SB.sparkles.build(centers, o, SB.util.mulberry32(7)).map(function (s) { return s.color; }); }
      var single = cols({ colorMode: 'single', singleColor: [255, 0, 0] });
      var comp = cols({ colorMode: 'complement' });
      var pas = cols({ colorMode: 'pastel' });
      var neo = cols({ colorMode: 'neon' });
      var bfly = SB.sparkles.build(centers, { styleMix: 'butterflies' }, SB.util.mulberry32(3));
      return {
        sets: ['butterflies', 'garden', 'bokeh', 'y2k'].every(function (id) { return !!sets[id]; }),
        star8: sets.stars.some(function (e) { return e[0] === 'star8'; }),
        allButterfly: bfly.some(function (s) { return s.style === 'butterfly'; }) &&
          bfly.every(function (s) { return sets.butterflies.some(function (e) { return e[0] === s.style; }); }),
        singleAllRed: single.every(function (c) { return c[0] === 255 && c[1] === 0 && c[2] === 0; }),
        compCyan: comp.every(function (c) { return c[0] < 90 && c[1] > 190 && c[2] > 190; }),
        pastelSoft: pas.every(function (c) { return c[0] > 200 && c[1] > 90 && c[2] > 90; }),
        neonHot: neo.every(function (c) { return c[0] === 255 && c[1] < 90; })
      };
    });
    ok(spr.sets, 'sprites: butterflies/garden/bokeh/y2k sets present');
    ok(spr.star8, 'sprites: star8 joined the stars set');
    ok(spr.allButterfly, 'sprites: butterflies set builds only butterflies');
    ok(spr.singleAllRed, 'colors: single-color mode forces the picked color');
    ok(spr.compCyan, 'colors: complement mode flips red to cyan');
    ok(spr.pastelSoft, 'colors: pastel mode softens');
    ok(spr.neonHot, 'colors: neon mode saturates');

    // ---- NEW CONTROLS EXIST ----
    const ui = await page.evaluate(() => {
      var ids = ['detectMode', 'lumaWeight', 'edgeWeight', 'count', 'spacing', 'jitter', 'trace', 'showDetect',
        'spriteScale', 'drift', 'motion', 'depthLayers', 'paletteId', 'singleColor', 'imgCustomPalette',
        'textCustomPalette', 'dustOn', 'dustDensity', 'dustGrain', 'dustIntensity',
        'undoBtn', 'compareBtn', 'chaosBtn', 'savedLooks', 'saveLookBtn'];
      var missing = ids.filter(function (id) { return !document.getElementById(id); });
      function opts(id) { return Array.prototype.map.call(document.getElementById(id).options, function (o) { return o.value; }); }
      return {
        missing: missing,
        modes: opts('detectMode'), colorModes: opts('colorMode'), shapes: opts('styleMix'), motions: opts('motion')
      };
    });
    ok(ui.missing.length === 0, 'ui: all new controls present' + (ui.missing.length ? ' (missing: ' + ui.missing.join(',') + ')' : ''));
    ok(['both', 'bright', 'edges', 'shadow', 'scatter'].every(function (m) { return ui.modes.indexOf(m) >= 0; }), 'ui: detection mode options complete');
    ok(['single', 'complement', 'pastel', 'neon'].every(function (m) { return ui.colorModes.indexOf(m) >= 0; }), 'ui: new colour modes in the picker');
    ok(['butterflies', 'garden', 'bokeh', 'y2k'].every(function (m) { return ui.shapes.indexOf(m) >= 0; }), 'ui: new shape sets in the picker');
    ok(['twinkle', 'fade', 'pulse'].every(function (m) { return ui.motions.indexOf(m) >= 0; }), 'ui: motion modes in the picker');

    // ---- MOTION / DRIFT / DEPTH / SPRITE-SCALE wire through and render ----
    const anim = await page.evaluate(() => {
      var SBM = window.SparkleBitch;
      SBM.setGlitter({ motion: 'pulse', drift: 0.6, depthLayers: true, spriteScale: 0.5 });
      SBM.redetect();
      var p = SBM.state.params;
      var snap = { motion: p.motion, drift: p.drift, depth: p.depthLayers, scale: p.spriteScale };
      var cv = SBM.renderStillCanvas();
      var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, hot = 0;
      for (var i = 0; i < d.length; i += 4) if (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] > 180) hot++;
      var depths = SBM.state.instances.map(function (s) { return s.depth; });
      SBM.setGlitter({ motion: 'twinkle', drift: 0, depthLayers: false, spriteScale: 1 });
      SBM.redetect();
      return { motion: snap.motion, drift: snap.drift, depth: snap.depth, scale: snap.scale, hot: hot, depthVar: Math.max.apply(null, depths) - Math.min.apply(null, depths) };
    });
    ok(anim.motion === 'pulse' && anim.drift === 0.6 && anim.depth === true && anim.scale === 0.5, 'anim: motion/drift/depth/sprite-scale params land');
    ok(anim.hot > 50, 'anim: pulse+depth+drift still renders (' + anim.hot + ' hot px)');
    ok(anim.depthVar > 0.2, 'anim: instances carry varied depths (' + anim.depthVar.toFixed(2) + ')');

    // ---- UNDO: restores the mask after a pen stroke ----
    const undo = await page.evaluate(() => {
      var SBM = window.SparkleBitch;
      SBM.state.tool = 'pen';
      var v = document.getElementById('view'), r = v.getBoundingClientRect();
      v.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + 30, clientY: r.top + 30, bubbles: true }));
      v.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + 130, clientY: r.top + 110, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      var stroked = SBM.state.penCenters.length > 0;
      document.getElementById('undoBtn').click();
      var restored = SBM.state.penCenters.length === 0;
      SBM.state.tool = 'auto';
      return { stroked: stroked, restored: restored };
    });
    ok(undo.stroked, 'undo: pen stroke adds sparkle points');
    ok(undo.restored, 'undo: button restores the pre-stroke state');

    // ---- COMPARE: holding the eye suppresses sparkles ----
    const cmp = await page.evaluate(() => {
      var SBM = window.SparkleBitch;
      var btn = document.getElementById('compareBtn');
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      var held = SBM.state.compare === true;
      btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      var released = SBM.state.compare === false;
      return { held: held, released: released };
    });
    ok(cmp.held && cmp.released, 'compare: hold-to-compare toggles the bare view');

    // ---- CHAOS DICE: randomizes without throwing ----
    const chaos = await page.evaluate(() => {
      var SBM = window.SparkleBitch;
      function snap() {
        var p = SBM.state.params;
        return JSON.stringify([p.detectMode, p.colorMode, p.paletteId, p.motion, p.speed, p.density, p.jitter, p.styleMix]);
      }
      var before = snap();
      document.getElementById('chaosBtn').click();
      return { changed: snap() !== before, noThrow: true };
    });
    ok(chaos.changed, 'chaos: dice rerolls the look');

    // ---- CUSTOM TEXT PALETTE: base + flakes register as a glitter style ----
    const textPal = await page.evaluate(() => {
      var SBM = window.SparkleBitch;
      var base = document.getElementById('textPalBase');
      base.value = '#102030'; base.dispatchEvent(new Event('input', { bubbles: true }));
      var flakes = document.querySelectorAll('.textPalFlake');
      if (flakes.length) { flakes[0].value = '#ff00ff'; flakes[0].dispatchEvent(new Event('input', { bubbles: true })); }
      var st = SB.glitter.STYLES.custom;
      SBM.setMode('text');
      SBM.setText({ text: 'MINE', size: 90, outlines: [], shadow: false });
      // fixed seed: chaos dice ran earlier and would make flake placement random
      SBM.setGlitter({ glitterStyle: 'custom', glitterIntensity: 1, seed: 1234 });
      var cv = SBM.renderStillCanvas();
      var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, magenta = 0, opaque = 0;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 180) { opaque++; if (d[i] > 180 && d[i + 1] < 90 && d[i + 2] > 180) magenta++; }
      }
      var stored = JSON.parse(localStorage.getItem('sb-custom-text') || '{}');
      return {
        flakeInputs: flakes.length,
        registered: !!st,
        baseOk: st && st.base.join(',') === '16,32,48',
        flakeOk: st && st.palette[0].join(',') === '255,0,255',
        opaque: opaque, magenta: magenta,
        storedBase: stored.base || 'none',
        optionLabel: (document.querySelector('#glitterStyle option[value="custom"]') || {}).textContent || 'none'
      };
    });
    ok(textPal.flakeInputs === 5, 'text palette: 5 flake swatches');
    ok(textPal.registered && textPal.baseOk && textPal.flakeOk, 'text palette: custom style registered from swatches');
    ok(textPal.opaque > 100 && textPal.magenta > 10, 'text palette: custom flakes render in the letters (' + textPal.magenta + ' magenta px)');
    ok(textPal.storedBase === '#102030', 'text palette: saved to localStorage');

    // ---- LIMINAL MODE: the third engine haunts the same image ----
    await page.evaluate(async () => {
      var W = 240, H = 160, c = document.createElement('canvas'); c.width = W; c.height = H;
      var x = c.getContext('2d');
      x.fillStyle = '#252530'; x.fillRect(0, 0, W, H);
      [[40, 50], [120, 30], [200, 60], [80, 120], [170, 120]].forEach(function (p) {
        x.fillStyle = '#fff8e0'; x.beginPath(); x.arc(p[0], p[1], 5, 0, 7); x.fill();
      });
      var blob = await new Promise(function (r) { c.toBlob(r, 'image/png'); });
      window.SparkleBitch.openFile(new File([blob], 'night.png', { type: 'image/png' }));
    });
    await poll(page, () => window.SparkleBitch.state.source && window.SparkleBitch.state.source.width === 240, 5000, 'liminal scene loaded');
    const lim = await page.evaluate(async () => {
      var SBM = window.SparkleBitch;
      var out = {};
      SBM.setMode('liminal');
      out.mode = SBM.state.mode;
      out.bodyClass = document.body.classList.contains('mode-liminal');
      out.hasImage = !!(SBM.state.source && SBM.state.source.kind === 'image');
      out.sparklePanelHidden = !document.querySelector('.image-controls').offsetParent;
      function hot(cv) {
        var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, n = 0;
        for (var i = 0; i < d.length; i += 4) if (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] > 200) n++;
        return n;
      }
      function rowGap(cv) {
        var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        var even = 0, odd = 0, n = 0;
        for (var y = 0; y < cv.height - 1; y += 2) {
          for (var x = 0; x < cv.width; x += 4) {
            var i = (y * cv.width + x) * 4, j = ((y + 1) * cv.width + x) * 4;
            even += d[i] + d[i + 1] + d[i + 2]; odd += d[j] + d[j + 1] + d[j + 2]; n++;
          }
        }
        return Math.abs(even - odd) / n;
      }
      SBM.applyLiminalPreset('');                          // all effects off
      out.hotOff = hot(SBM.renderStillCanvas());
      SBM.setLiminal('starbursts.enabled', true);          // starbursts alone
      out.hotOn = hot(SBM.renderStillCanvas());
      out.chips = document.querySelectorAll('#limPresets .chip').length;
      document.querySelector('[data-lim-preset="crt"]').click();
      var p = SBM.state.liminal;
      out.presetApplied = p.preset === 'crt' && p.scanlines.enabled && p.moire.enabled && p.grain.enabled;
      var cv = SBM.renderStillCanvas();
      out.rowGap = rowGap(cv);
      var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      function lumAt(px, py) { var i = (py * cv.width + px) * 4; return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; }
      out.corner = lumAt(2, 2);
      out.center = lumAt(cv.width >> 1, cv.height >> 1);
      // manual tweak overrides the preset and marks the stack custom
      SBM.setLiminal('scanlines.enabled', false);
      out.manualOff = SBM.state.liminal.scanlines.enabled === false && SBM.state.liminal.preset === '';
      out.rowGapOff = rowGap(SBM.renderStillCanvas());
      SBM.setLiminal('scanlines.enabled', true);           // back on, still custom
      // GIF export runs the liminal stack frame by frame
      var u8 = new Uint8Array(await SBM.exportGifBytes());
      out.gifFrames = SB.decodeGIF(u8).frames.length;
      return out;
    });
    ok(lim.mode === 'liminal' && lim.bodyClass, 'liminal: third mode activates');
    ok(lim.hasImage, 'liminal: keeps the loaded image');
    ok(lim.sparklePanelHidden, 'liminal: sparkle controls swap out');
    ok(lim.chips >= 6, 'liminal: vibe chips rendered (' + lim.chips + ')');
    ok(lim.presetApplied, 'liminal: CRT House chip applies the whole stack');
    ok(lim.hotOn > lim.hotOff + 50, 'liminal: starbursts add hot pixels (' + lim.hotOff + ' -> ' + lim.hotOn + ')');
    ok(lim.rowGap > 1 && lim.rowGap > lim.rowGapOff, 'liminal: scanlines alternate rows (gap ' + lim.rowGap.toFixed(1) + ' -> off ' + lim.rowGapOff.toFixed(1) + ')');
    ok(lim.corner < 10 && lim.center > lim.corner, 'liminal: frame + vignette darken corners (' + lim.corner.toFixed(0) + ' vs ' + lim.center.toFixed(0) + ')');
    ok(lim.manualOff, 'liminal: manual tweak overrides preset (custom stack)');
    ok(lim.gifFrames > 1, 'liminal: GIF export works (' + lim.gifFrames + ' frames)');

    // ---- LIMINAL EXPANSION: optics + print stacks ----
    const lim2 = await page.evaluate(async () => {
      var SBM = window.SparkleBitch, out = {};
      function meanLuma(cv) {
        var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, m = 0, n = 0;
        for (var i = 0; i < d.length; i += 4) { m += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
        return m / n;
      }
      SBM.applyLiminalPreset('');                            // all effects off
      out.meanOff = meanLuma(SBM.renderStillCanvas());
      // Mirror-Lens Motel: ring bokeh + chromatic auras around the five lamps
      SBM.applyLiminalPreset('mirrorlens');
      out.presetML = SBM.state.liminal.preset === 'mirrorlens' &&
        SBM.state.liminal.ringBokeh.enabled && SBM.state.liminal.chromaAura.enabled &&
        SBM.state.liminal.isoGrain.enabled && SBM.state.liminal.stuckPixels.enabled &&
        SBM.state.liminal.rollingShutter.enabled;
      out.meanML = meanLuma(SBM.renderStillCanvas());
      // Office Fax 2003: near-bilevel crush
      SBM.applyLiminalPreset('fax2003');
      out.presetFax = SBM.state.liminal.preset === 'fax2003' && SBM.state.liminal.fax.enabled;
      var cv = SBM.renderStillCanvas();
      var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      var extremes = 0, n = 0;
      for (var i = 0; i < d.length; i += 4) { if (d[i] < 60 || d[i] > 195) extremes++; n++; }
      out.faxFrac = extremes / n;
      out.chips = document.querySelectorAll('#limPresets .chip').length;
      // back to a custom stack so the persistence asserts below stay valid
      SBM.setLiminal('fax.enabled', false);
      out.customAfter = SBM.state.liminal.preset === '' && SBM.state.liminal.scanlines.enabled === true;
      // GIF export still runs the expanded stack frame by frame
      var u8 = new Uint8Array(await SBM.exportGifBytes());
      out.gifFrames = SB.decodeGIF(u8).frames.length;
      return out;
    });
    ok(lim2.presetML, 'liminal: Mirror-Lens Motel chip applies its stack');
    ok(lim2.meanML > lim2.meanOff + 8, 'liminal: ring bokeh + auras lift the frame (' + lim2.meanOff.toFixed(1) + ' -> ' + lim2.meanML.toFixed(1) + ')');
    ok(lim2.presetFax, 'liminal: Office Fax 2003 chip applies');
    ok(lim2.faxFrac > 0.6, 'liminal: fax mode crushes toward bilevel (' + (lim2.faxFrac * 100).toFixed(0) + '% extreme)');
    ok(lim2.chips >= 8, 'liminal: expanded vibe chips rendered (' + lim2.chips + ')');
    ok(lim2.customAfter, 'liminal: manual tweak returns to a custom stack');
    ok(lim2.gifFrames > 1, 'liminal: expanded stack still exports GIF (' + lim2.gifFrames + ' frames)');

    // ---- LIMINAL GEOMETRY + TIME: warps and weather ----
    const lim3 = await page.evaluate(async () => {
      var SBM = window.SparkleBitch, out = {};
      function meanLuma(cv) {
        var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, m = 0, n = 0;
        for (var i = 0; i < d.length; i += 4) { m += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
        return m / n;
      }
      function frameLuma(f) {
        var d = f.data, m = 0, n = 0;
        for (var i = 0; i < d.length; i += 4) { m += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
        return m / n;
      }
      function meanDiff(a, b) {
        var da = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
        var db = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
        var m = 0, n = 0;
        for (var i = 0; i < da.length; i += 4) {
          m += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]); n += 3;
        }
        return m / n;
      }
      SBM.applyLiminalPreset('');                            // all effects off
      var base = SBM.renderStillCanvas();
      // Vertigo Relay: wells + astigmatism + contours rearrange the still
      SBM.applyLiminalPreset('vertigo');
      out.presetV = SBM.state.liminal.preset === 'vertigo' &&
        SBM.state.liminal.shear.enabled && SBM.state.liminal.gravityWells.enabled &&
        SBM.state.liminal.astigmatism.enabled && SBM.state.liminal.contours.enabled;
      out.diffV = meanDiff(base, SBM.renderStillCanvas());
      // Terminal Twilight: ghosts + shadows + vignette shift the frame
      SBM.applyLiminalPreset('twilight');
      out.presetT = SBM.state.liminal.preset === 'twilight' &&
        SBM.state.liminal.dayNight.enabled && SBM.state.liminal.brownout.enabled &&
        SBM.state.liminal.shadowDrift.enabled && SBM.state.liminal.ghostTrails.enabled;
      out.diffT = meanDiff(base, SBM.renderStillCanvas());
      // day-night cycle: the mid-loop GIF frame is far darker than frame 0
      var u8 = new Uint8Array(await SBM.exportGifBytes());
      var gif = SB.decodeGIF(u8);
      out.gifFrames = gif.frames.length;
      out.f0 = frameLuma(gif.frames[0]);
      out.fMid = frameLuma(gif.frames[Math.floor(gif.frames.length / 2)]);
      out.chips = document.querySelectorAll('#limPresets .chip').length;
      // back to a custom stack so the persistence asserts below stay valid
      SBM.applyLiminalPreset('');
      SBM.setLiminal('scanlines.enabled', true);
      out.customAfter = SBM.state.liminal.preset === '' && SBM.state.liminal.scanlines.enabled === true;
      return out;
    });
    ok(lim3.presetV, 'liminal: Vertigo Relay chip applies its stack');
    ok(lim3.diffV > 6, 'liminal: vertigo visibly warps the still (mean diff ' + lim3.diffV.toFixed(1) + ')');
    ok(lim3.presetT, 'liminal: Terminal Twilight chip applies its stack');
    ok(lim3.diffT > 6, 'liminal: twilight visibly reweathers the still (mean diff ' + lim3.diffT.toFixed(1) + ')');
    ok(lim3.f0 - lim3.fMid > 10, 'liminal: day-night GIF dims mid-loop (' + lim3.f0.toFixed(1) + ' -> ' + lim3.fMid.toFixed(1) + ')');
    ok(lim3.chips >= 10, 'liminal: all vibe chips rendered (' + lim3.chips + ')');
    ok(lim3.customAfter, 'liminal: reset returns to a custom stack');
    ok(lim3.gifFrames > 1, 'liminal: geometry+time stack exports GIF (' + lim3.gifFrames + ' frames)');

    // ---- LIMINAL OS RESIDUE + AI HALLUCINATIONS ----
    const lim4 = await page.evaluate(async () => {
      var SBM = window.SparkleBitch, out = {};
      function meanDiff(a, b) {
        var da = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
        var db = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
        var m = 0, n = 0;
        for (var i = 0; i < da.length; i += 4) {
          m += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]); n += 3;
        }
        return m / n;
      }
      function frameDiff(a, b) {
        var m = 0, n = 0;
        for (var i = 0; i < a.data.length; i += 4) {
          m += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]); n += 3;
        }
        return m / n;
      }
      SBM.applyLiminalPreset('');                            // all effects off
      var base = SBM.renderStillCanvas();
      // Phantom Desktop: burn-in + windows + dialog + cursor haunt the still
      SBM.applyLiminalPreset('phantom');
      out.presetP = SBM.state.liminal.preset === 'phantom' &&
        SBM.state.liminal.burnIn.enabled && SBM.state.liminal.windowDrag.enabled &&
        SBM.state.liminal.dialogGhost.enabled && SBM.state.liminal.cursorTrail.enabled;
      out.diffP = meanDiff(base, SBM.renderStillCanvas());
      // Latent Dream: faces + denoise + melt + pixelation rework the still
      SBM.applyLiminalPreset('latent');
      out.presetL = SBM.state.liminal.preset === 'latent' &&
        SBM.state.liminal.pareidolia.enabled && SBM.state.liminal.denoiseBlocks.enabled &&
        SBM.state.liminal.semanticMelt.enabled && SBM.state.liminal.latentGrid.enabled;
      out.diffL = meanDiff(base, SBM.renderStillCanvas());
      // the dream keeps re-resolving: mid-loop GIF frame differs from frame 0
      var u8 = new Uint8Array(await SBM.exportGifBytes());
      var gif = SB.decodeGIF(u8);
      out.gifFrames = gif.frames.length;
      out.fDiff = frameDiff(gif.frames[0], gif.frames[Math.floor(gif.frames.length / 2)]);
      out.chips = document.querySelectorAll('#limPresets .chip').length;
      // back to a custom stack so the persistence asserts below stay valid
      SBM.applyLiminalPreset('');
      SBM.setLiminal('scanlines.enabled', true);
      out.customAfter = SBM.state.liminal.preset === '' && SBM.state.liminal.scanlines.enabled === true;
      return out;
    });
    ok(lim4.presetP, 'liminal: Phantom Desktop chip applies its stack');
    ok(lim4.diffP > 6, 'liminal: phantom desktop haunts the still (mean diff ' + lim4.diffP.toFixed(1) + ')');
    ok(lim4.presetL, 'liminal: Latent Dream chip applies its stack');
    ok(lim4.diffL > 6, 'liminal: latent dream reworks the still (mean diff ' + lim4.diffL.toFixed(1) + ')');
    ok(lim4.fDiff > 3, 'liminal: latent GIF re-resolves mid-loop (frame diff ' + lim4.fDiff.toFixed(1) + ')');
    ok(lim4.chips >= 11, 'liminal: all vibe chips rendered (' + lim4.chips + ')');
    ok(lim4.customAfter, 'liminal: reset returns to a custom stack');
    ok(lim4.gifFrames > 1, 'liminal: os+ai stack exports GIF (' + lim4.gifFrames + ' frames)');

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

    // ---- custom palettes persist across reloads ----
    const palRemembered = await page.evaluate(() => {
      var st = SB.glitter.STYLES.custom;
      var sw = document.querySelectorAll('#imgCustomPalette input[type=color]');
      var limP = window.SparkleBitch.state.liminal;
      return {
        textBase: st ? st.base.join(',') : 'none',
        imgFirst: sw.length ? sw[0].value : 'none',
        mineOption: !!document.querySelector('#paletteId option[value="mine"]'),
        customOption: !!document.querySelector('#glitterStyle option[value="custom"]'),
        limScan: limP && limP.scanlines.enabled === true,
        limCustom: limP && limP.preset === ''
      };
    });
    ok(palRemembered.textBase === '16,32,48', 'persistence: custom text palette re-registered after reload');
    ok(palRemembered.imgFirst === '#ff0000', 'persistence: image palette swatches restored after reload');
    ok(palRemembered.mineOption && palRemembered.customOption, 'persistence: "My palette" options present after reload');
    ok(palRemembered.limScan && palRemembered.limCustom, 'persistence: liminal stack remembered after reload');

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
