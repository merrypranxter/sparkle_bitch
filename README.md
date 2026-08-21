# Sparkle Bitch ✨

A personal **Y2K glitter engine** — a from-scratch clone of the early-2000s
[Glitterboo](https://glitterboo.com) / Glitterfy / Picasion glitter tools. Two
modes:

- **Image / GIF:** drop in a picture or GIF; it finds the bright/high-contrast
  spots, drops in animated sparkle sprites that match the local colour and size,
  and (optionally) lays animated glitter over the photo.
- **Text:** type words (multi-line, with left/center/right align + line-spacing)
  and get **animated glitter text** — letterforms filled with shimmering "dry
  glitter" in 19 styles (rainbow, confetti, all-neon, unicorn, galaxy, fire…),
  on a transparent background so you can paste it anywhere. Add **stackable
  outlines**, each its own solid colour *or* its own glitter.

Everything exports as a **PNG**, **animated GIF**, or **video**.

Everything runs in the browser in plain JavaScript. **No build step, no server,
no dependencies, no accounts.** It works on a Chromebook, and it works offline.

---

## Use it

**Locally (easiest):** just open `index.html` in a browser — double-click it, or
drag it onto a browser window. That's it.

**Online / on your phone:** publish to GitHub Pages (see below) and open the URL.

Then:

1. **Open** an image or GIF (drag-and-drop, or click). Videos work too — see
   *Video* below.
2. Pick a look — **Classic Y2K** or **Astral Trash** — and hit **✨ Sparkle it**.
3. Nudge the sliders until it's right.
4. **Save** it as PNG, GIF, or Video. On a phone, long-press the result to save.

### Controls

| Control | What it does |
|---|---|
| **Intensity** | Overall strength / brightness of the sparkles |
| **Max size** | How big the biggest sparkles get |
| **Density** | How many sparkles (finer detection grid) |
| **Glow** | Size and strength of the halo behind each sparkle |
| **Color boost** | Saturation of the sparkle colour |
| **Speed** | How fast they twinkle (whole cycles per loop, so GIFs stay seamless) |
| **Shapes** | Stars / sparkles / hearts / icons / mixed |
| **Colors** | From photo (inherit local colour) · Palette · White |

**Advanced** (tucked away) adds Glitterboo-style placement tools:

- **Auto** — sparkle the whole image's bright areas (default).
- **Brush** — only sparkle where you paint.
- **Pen** — force sparkles anywhere, even dark/blank areas (white if there's no
  colour to sample).

…plus brightness/contrast thresholds, hue shimmer, spin, and a re-roll dice.

---

## How it works

The pipeline follows the documented Glitterboo behaviour:

1. **Analyze** (`js/analyze.js`) — compute luminance + Sobel contrast on a
   downscaled buffer, then pick well-spaced local maxima as sparkle centres,
   sampling each one's local colour and bright-region size.
2. **Instances** (`js/sparkles.js`) — each centre becomes a sparkle with a
   position, colour, size, shape and animation phase. Sprites are drawn
   procedurally and cached.
3. **Render** (`js/render.js`) — draw the base, then an additive sparkle layer
   (screen/lighter blend) with a soft glow, optional hue-shimmer, and twinkle.
   Every animated value is a function of loop phase, so exports loop cleanly.
4. **Export** (`js/export.js`, `js/gif-encode.js`) — PNG via canvas, animated
   GIF via a self-contained GIF89a encoder (median-cut palette + LZW +
   transparency frame-diff for small files), and video via `MediaRecorder`.

Animated GIFs are decoded with a self-contained decoder (`js/gif-decode.js`)
so sparkles can be composited over every frame, keeping the original timing.

---

## Videos (best-effort)

Image and GIF are the priority and always work. **Video is secondary:** you can
load an MP4/WebM and export a **WebM** (or MP4 where your browser's recorder
supports it). Sparkle positions are detected on the first frame and don't track
motion — good enough for a shimmer pass. If video doesn't work in your browser,
GIF always will.

---

## Fonts

Glitter **Text** mode ships a big grouped font picker: web-safe **System** fonts
plus **23 bundled** open-licensed Y2K faces (all OFL / Apache 2.0, so they work
offline with no downloads) across Pixel, Techno, Bubble, Retro, Gothic and
Handwriting — Press Start 2P, VT323, Orbitron, Michroma, Bungee, Baloo, Monoton,
UnifrakturCook (blackletter), Permanent Marker, and more. See
[`fonts/README.md`](fonts/README.md) for the full list and how to add more.

**Want a font that isn't listed** (Eurostile, Neuropol, a DaFont find…)? In Text
mode click **＋ Load font file** and pick any `.ttf` / `.otf` / `.woff` you've
downloaded — it loads instantly and shows up under **Your fonts**. It's
**remembered across visits** (saved in your browser's IndexedDB; nothing is
uploaded anywhere).

---

## Publish to GitHub Pages

A workflow is already included (`.github/workflows/pages.yml`). One-time setup:

1. Push to the default branch (`main`).
2. Repo **Settings → Pages → Source → "GitHub Actions"**.
3. It deploys automatically; your URL appears in the Actions run and on the
   Pages settings page. Open it on your phone and add it to your home screen.

---

## Develop / test

```bash
# codec round-trip, animation + glitter loop-closure (Node, no deps)
node test/codec.test.cjs
node test/loop.test.cjs
node test/glitter.test.cjs

# end-to-end in a real browser
npm install          # dev-only: installs playwright-core (NO bundled browser)
node test/e2e.cjs    # needs a Chromium; set CHROMIUM_PATH=/path/to/chrome
```

The e2e/demo scripts need a Chromium binary. In this project's environment one
is pre-installed at `/opt/pw-browsers/chromium`; elsewhere, point
`CHROMIUM_PATH` at your own Chrome/Chromium (playwright-core does not download
one).

---

## Files

```
index.html      app shell            js/analyze.js    highlight detection
css/style.css   styling              js/sparkles.js   instances + sprites
js/util.js      rng / colour maths   js/render.js     per-frame compositing
js/anim.js      loop-closure maths   js/glitter.js    dry-glitter flake engine
js/presets.js   Classic / Astral     js/text.js       glitter-text letterforms
js/media.js     load image/gif/text  js/gif-encode.js GIF89a encoder (+alpha)
js/export.js    PNG / GIF / video     js/gif-decode.js GIF decoder
js/main.js      UI + controller
```

No third-party code — the GIF codec, detection, and rendering are all original.
Do whatever you want with it. ✨
