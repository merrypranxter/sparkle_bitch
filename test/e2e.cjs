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
const EXE = '/opt/pw-browsers/chromium';

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

    // ---- VIDEO SUPPORT ----
    const vid = await page.evaluate(() => ({ supported: SB.exporter.videoSupported() }));
    if (vid.supported) ok(true, 'video: MediaRecorder available in this browser');
    else warn('video: MediaRecorder not available (best-effort feature)');

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
