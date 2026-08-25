/* Generates real sample output (PNG + animated GIF) for both presets on a
 * photo-like bokeh scene, so the look can be eyeballed and shared.
 * Writes to demo/.
 */
'use strict';
const { chromium } = require('playwright-core');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DEMO = path.join(ROOT, 'demo');
const PORT = 8124;
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function waitServer() {
  return new Promise((res, rej) => {
    let n = 0;
    const t = setInterval(() => {
      http.get(`http://localhost:${PORT}/index.html`, r => { r.destroy(); clearInterval(t); res(); })
        .on('error', () => { if (++n > 50) { clearInterval(t); rej(new Error('no server')); } });
    }, 100);
  });
}

(async () => {
  if (!fs.existsSync(DEMO)) fs.mkdirSync(DEMO, { recursive: true });
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await waitServer();
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
  page.on('pageerror', e => console.error('PAGEERR', String(e)));

  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.SparkleBitch && !!window.SB);

  // draw a dark bokeh "photo": soft coloured light blobs on a moody gradient
  await page.evaluate(async () => {
    const W = 720, H = 460;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const bg = x.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#140a24'); bg.addColorStop(0.5, '#0b0713'); bg.addColorStop(1, '#221033');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    const cols = ['#ffd98a', '#ff9ad5', '#8fe4ff', '#c6a3ff', '#fff2c0', '#a0ffd0'];
    function blob(cx, cy, r, col, a) {
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, col); g.addColorStop(0.5, col.length === 7 ? col + '88' : col); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.globalAlpha = a; x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); x.globalAlpha = 1;
    }
    let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 26; i++) blob(rnd() * W, rnd() * H, 20 + rnd() * 70, cols[(rnd() * cols.length) | 0], 0.35 + rnd() * 0.5);
    // a few crisp bright speculars
    for (let i = 0; i < 16; i++) { x.fillStyle = '#fff'; x.globalAlpha = 0.9; x.beginPath(); x.arc(rnd() * W, rnd() * H, 1.5 + rnd() * 2.5, 0, 7); x.fill(); }
    x.globalAlpha = 1;
    const blob2 = await new Promise(res => c.toBlob(res, 'image/png'));
    window.SparkleBitch.openFile(new File([blob2], 'bokeh.png', { type: 'image/png' }));
  });
  await page.waitForFunction(() => window.SparkleBitch.state.source && window.SparkleBitch.state.instances.length > 0, { timeout: 8000 });

  async function exportBoth(tag) {
    await sleep(500);
    await page.screenshot({ path: path.join(DEMO, tag + '-ui.png') });
    const out = await page.evaluate(async () => {
      const st = window.SparkleBitch.state;
      const png = SB.exporter.renderStill(st.source, st.instances, st.params, 720, '#0a0710').toDataURL('image/png');
      const gif = await SB.exporter.exportGIF(st.source, st.instances, st.params,
        { maxLong: 480, matte: '#0a0710', lengthSec: 2, fps: 15 }, function () {});
      let b = ''; const u8 = new Uint8Array(gif);
      for (let i = 0; i < u8.length; i++) b += String.fromCharCode(u8[i]);
      return { png: png, gif: btoa(b) };
    });
    fs.writeFileSync(path.join(DEMO, tag + '.png'), Buffer.from(out.png.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(DEMO, tag + '.gif'), Buffer.from(out.gif, 'base64'));
    const kb = (fs.statSync(path.join(DEMO, tag + '.gif')).size / 1024) | 0;
    console.log('wrote demo/' + tag + '.png and demo/' + tag + '.gif (' + kb + ' KB)');
  }

  // Classic (default)
  await exportBoth('classic');
  // Astral
  await page.click('#presetAstral');
  await page.waitForFunction(() => window.SparkleBitch.state.params.preset === 'astral');
  await sleep(400);
  await exportBoth('astral');

  // ---- glitter TEXT demos ----
  async function textDemo(tag, text, style, bg, font, outlines) {
    await page.evaluate(function (a) {
      window.SparkleBitch.setMode('text');
      window.SparkleBitch.setText({ text: a.text, size: 120, font: a.font, bold: true, shadow: true, bg: a.bg,
        outlines: a.outlines || [{ width: 6, kind: 'color', color: '#3a0a2e' }] });
      window.SparkleBitch.setGlitter({ glitterStyle: a.style, glitterDensity: 0.8, glitterIntensity: 1 });
    }, { text: text, style: style, bg: bg || null, font: font || 'arialblack', outlines: outlines || null });
    await page.waitForFunction(() => window.SparkleBitch.state.mode === 'text' && window.SparkleBitch.state.glitterField);
    await page.evaluate(() => document.fonts.ready);
    await sleep(500); // let the webfont load + the mask rebuild with real glyphs
    await page.screenshot({ path: path.join(DEMO, tag + '-ui.png') });
    var out = await page.evaluate(async function (transparent) {
      var st = window.SparkleBitch.state;
      var gif = await SB.exporter.exportGIF(st.source, st.instances, st.params, {
        maxLong: 600, matte: st.textOpts.bg || undefined,
        render: { text: st.source.textRender, glitterField: st.glitterField },
        transparent: transparent, lengthSec: 1.6, fps: 14
      }, function () {});
      var b = '', u8 = new Uint8Array(gif);
      for (var i = 0; i < u8.length; i++) b += String.fromCharCode(u8[i]);
      return btoa(b);
    }, !bg);
    fs.writeFileSync(path.join(DEMO, tag + '.gif'), Buffer.from(out, 'base64'));
    console.log('wrote demo/' + tag + '.gif (' + ((fs.statSync(path.join(DEMO, tag + '.gif')).size / 1024) | 0) + ' KB)');
  }
  await textDemo('text-pixel', 'Y2K', 'rainbow', '#0b0713', 'pressstart');    // pixel arcade
  await textDemo('text-techno', 'SPARKLE', 'cyan', '#0b0713', 'orbitron');    // techno
  await textDemo('text-bubble', 'glitter', 'pink', '#0b0713', 'bungee');      // bubble / signage
  await textDemo('text-goth', 'bitch', 'silver', '#0b0713', 'blackletter');   // blackletter
  await textDemo('text-gold', 'sparkle bitch', 'gold', null, 'arialblack');   // transparent sticker
  await textDemo('text-neon', 'NEON', 'neon', '#08040f', 'arialblack');       // all-neon glitter
  // layered sparkle outlines: neon fill + rainbow glitter outline + 2 solid rings
  await textDemo('text-layers', 'sparkle', 'neon', '#08040f', 'fredoka', [
    { width: 7, kind: 'glitter', glitter: 'rainbow' },
    { width: 6, kind: 'color', color: '#ff5fd2' },
    { width: 6, kind: 'color', color: '#4fe3ff' }
  ]);

  // ---- NEW colours: a proper red, black and yellow ----
  await textDemo('text-red', 'RED HOT', 'red', '#0b0713', 'arialblack');
  await textDemo('text-yellow', 'sunshine', 'yellow', '#0b0713', 'fredoka');
  await textDemo('text-black', 'BLACK ✦', 'black', '#f2ecf6', 'arialblack');   // black glitter reads on a light bg

  // ---- PER-OUTLINE glitter: fine dense silver fill + a chunky, low-density gold outline ----
  await textDemo('text-peroutline', 'outline', 'silver', '#0b0713', 'bungee', [
    { width: 13, kind: 'glitter', glitter: 'gold', density: 0.5, grain: 1.8, intensity: 1 }
  ]);

  // ---- UPLOAD FILL: an animated GIF is the fill; its 12 frames drive the text ----
  await page.evaluate(async () => {
    var S = window.SparkleBitch;
    var W = 96, H = 96, N = 12, frames = [];
    for (var f = 0; f < N; f++) {
      var d = new Uint8ClampedArray(W * H * 4);
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
        var p = (y * W + x) * 4;
        var rgb = SB.util.hslToRgb(((x + f * (W / N)) / W) * 360, 1, 0.55);
        d[p] = rgb[0]; d[p + 1] = rgb[1]; d[p + 2] = rgb[2]; d[p + 3] = 255;
      }
      frames.push({ data: d, delay: 90 });
    }
    var bytes = SB.encodeGIF(frames, { width: W, height: H, loop: 0 });
    var id = await S.loadTextureFromBuffer(bytes, true, 'rainbow-shimmer');
    S.setMode('text');
    S.setText({ text: 'SHINY', size: 130, font: 'arialblack', bold: true, shadow: true, bg: null,
      outlines: [{ width: 8, kind: 'color', color: '#20112e' }] });
    S.setGlitter({ glitterStyle: 'tex:' + id });
  });
  await page.waitForFunction(() => window.SparkleBitch.state.source && window.SparkleBitch.state.source.textureFrames === 12, { timeout: 5000 });
  await sleep(400);
  const giffill = await page.evaluate(async () => {
    var st = window.SparkleBitch.state;
    var gif = await SB.exporter.exportGIF(st.source, st.instances, st.params, {
      maxLong: 600, matte: undefined,
      render: { text: st.source.textRender, glitterField: st.glitterField, fillTexture: st.source.fillTexture },
      transparent: true
    }, function () {});
    var b = '', u8 = new Uint8Array(gif);
    for (var i = 0; i < u8.length; i++) b += String.fromCharCode(u8[i]);
    return { gif: btoa(b), frames: SB.decodeGIF(u8).frames.length };
  });
  fs.writeFileSync(path.join(DEMO, 'text-giffill.gif'), Buffer.from(giffill.gif, 'base64'));
  console.log('wrote demo/text-giffill.gif (' + ((fs.statSync(path.join(DEMO, 'text-giffill.gif')).size / 1024) | 0) + ' KB, ' + giffill.frames + ' frames)');

  // ---- FINISH engine: animated stacks ----
  async function finishDemo(tag, text, stack, bg, font) {
    await page.evaluate(function (a) {
      window.SparkleBitch.setMode('text');
      window.SparkleBitch.setText({ text: a.text, size: 120, font: a.font || 'arialblack', bold: true, shadow: true, bg: a.bg || null, outlines: [] });
      window.SparkleBitch.setFillStack(a.stack);
    }, { text: text, stack: stack, bg: bg, font: font });
    await page.evaluate(() => document.fonts.ready);
    await sleep(350);
    const out = await page.evaluate(async function (transparent) {
      var st = window.SparkleBitch.state;
      var gif = await SB.exporter.exportGIF(st.source, st.instances, st.params, {
        maxLong: 600, matte: st.textOpts.bg || undefined,
        render: { text: st.source.textRender, glitterField: st.glitterField, finishStack: st.textOpts.finishes },
        transparent: transparent, lengthSec: 2, fps: 16
      }, function () {});
      var b = '', u8 = new Uint8Array(gif);
      for (var i = 0; i < u8.length; i++) b += String.fromCharCode(u8[i]);
      return btoa(b);
    }, !bg);
    fs.writeFileSync(path.join(DEMO, tag + '.gif'), Buffer.from(out, 'base64'));
    console.log('wrote demo/' + tag + '.gif (' + ((fs.statSync(path.join(DEMO, tag + '.gif')).size / 1024) | 0) + ' KB)');
  }
  await finishDemo('fx-holographic', 'HOLO', [{ type: 'holographic', alpha: 1 }], '#0b0713');
  await finishDemo('fx-liquidchrome', 'CHROME', [{ type: 'liquidchrome', alpha: 1 }], '#08060f');
  await finishDemo('fx-cdrom', 'CD-R', [{ type: 'cdrom', alpha: 1 }], '#08060f');
  await finishDemo('fx-oilslick', 'OIL', [{ type: 'oilslick', alpha: 1 }], '#05040a');
  await finishDemo('fx-rhinestone', 'BLING', [{ type: 'rhinestone', alpha: 1 }], '#0b0713', 'fredoka');
  await finishDemo('fx-neon', 'NEON', [{ type: 'neontube', alpha: 1 }], '#08040f');
  await finishDemo('fx-chromatic', 'GHOST', [{ type: 'holographic', alpha: 1 }, { type: 'chromatic', alpha: 0.9, blend: 'add' }], '#0b0713');
  // the stacked monster — a glowing chrome life-form (transparent sticker)
  await finishDemo('fx-monster', 'MONSTER', [
    { type: 'liquidchrome', alpha: 1 },
    { type: 'cdrom', alpha: 0.7, blend: 'add' },
    { type: 'chromatic', alpha: 0.85, blend: 'add' },
    { type: 'starburst', alpha: 1, blend: 'add' }
  ], null);

  await browser.close();
  server.kill('SIGTERM');
  console.log('demo done');
})();
