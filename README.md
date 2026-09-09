# Contrast Equalizer for SafeLight

A [SafeLight](https://github.com/anthonyreimche/SafeLight) extension that ports
[**darktable**](https://www.darktable.org/)'s *contrast equalizer* — the wavelet
local-contrast / sharpening / denoise tool — into SafeLight's Develop module. If
you came from darktable and miss equalizing detail by frequency band, this is that
tool, with the same three-tab curve UI and the same underlying à trous wavelet
math.

![tabs: luma · chroma · edges](#)

## What it does

The image is decomposed into wavelet **detail scales** (à trous). On each scale you
independently raise or lower:

- **luma** — lightness contrast, plus a luminance **denoise** threshold;
- **chroma** — colour/saturation contrast, plus a chroma **denoise** threshold;
- **edges** — how edge-aware the wavelet is (controls halos vs. crispness).

Each tab is a graph whose **x-axis runs coarse → fine** (left to right) and whose
**y-axis is the boost** — the centre line is *no change*, up boosts that band of
detail, down softens it. Six control nodes per curve, exactly as in darktable.

### Interaction (same as darktable)

- **Press anywhere and drag** vertically — every node is pulled toward the
  pointer with a Gaussian falloff over x, keeping the offset between the grab
  point and the curve. The **mouse wheel** sets that radius (the circle riding
  the curve); while hovering you see the reachable range as a shaded envelope.
- Hovering picks the **boost or threshold curve** by which is closer; the
  luma/chroma tabs carry both.
- **Drag under the graph** (the small triangles) to move an interior node's x
  position.
- **Double-click** resets the active curve.
- **Mix** scales the whole effect (deviation from the neutral curve); the graph
  shows the mixed curves at rest and the raw ones while you hover, like
  darktable.
- **Presets**: darktable's own set with its exact values — Coarse, Denoise &
  sharpen, Sharpen, Denoise chroma, Denoise, Bloom, Clarity and the nine Deblur
  variants (large / medium / fine blur × strength 1–3) — plus a flat reset.
  Applying one resets the node positions and the mix, as darktable does.
- The plot sits on the panel's themed surface like every other panel; the grid,
  curves and overlays flip brightness against it, so no theme can hide them.

## The math

Faithful to darktable's `atrous` module (`src/iop/atrous.c`, `src/common/eaw.c`):

- **B3-spline à trous** decomposition, `[1,4,6,4,1]/16` separable kernel, dilation
  `2^scale` over darktable's **eight levels**, made **edge-aware** with darktable's
  weight `exp(-sharp·ΔL²)` (luma) / `exp(-sharp·(Δa²+Δb²))` (chroma).
- Detail is boosted by **`(2·curve)²`** and **soft-cored** against the denoise
  threshold `copysign(max(|d|−thr, 0))`, with darktable's per-scale threshold
  scaling `2^(−7(1−t))·{10,20}·curve`. The sharpness curve feeds `0.0025·curve`.
  Every level takes its own coefficients from the curves at darktable's own
  sample positions.
- The 0.5 centre and 0 thresholds make the neutral curve an exact identity.

### How it maps onto SafeLight

SafeLight runs extension wavelet passes through its GPU pre-pass framework: a
chain of full-frame draws, each reading only the previous draw's three channels.
The equalizer registers **three chains** that each carry darktable's whole
recursion in those three channels — the coarse level to blur next and the
running result of the levels already processed:

- **luma** — source luma, the coarse level as an offset from it, and the
  accumulated luma change;
- **chroma R−L** and **chroma B−L** — the two coarse chroma coordinates plus the
  accumulated change of one of them (darktable's chroma synthesis acts on a
  vector, so each chain runs the identical blur and keeps its own coordinate).

Each chain is darktable's eight-level decomposition and synthesis in eight
26-tap draws; the result is its full eight-octave answer, which the test suite
checks to float precision against an independent transcription of the C. A chain
whose curves are neutral costs nothing (its pre-pass is skipped), and editing the
luma curve reruns only the luma chain.

Differences from darktable to be aware of:

- Detail is computed in linear scene RGB split into luma + chroma (darktable works
  in Lab); the luma weight is taken to a 0–100 scale so the thresholds and edge
  weights keep darktable's numeric feel.
- darktable uses fewer levels below ~2.5k px; the decomposition here is the same
  eight at every render size, so thumbnails and exports match the develop view.
- darktable draws a per-band energy histogram behind the curve and shifts its
  scale marks with the zoom; the graph here shades the fixed octave spans.
- The chains store signed values and need float render targets
  (`EXT_color_buffer_float`, present on every desktop GPU); on the 8-bit fallback
  the tool degrades.

### Tests

`npm test` runs on the CPU: darktable's presets recomputed from the C, the
param-bag contract (what idles a chain, how older edits are brought forward), a
**per-draw texture-fetch budget** on the actual pass GLSL, and the render
model against the darktable transcription for many curve shapes.

`npm run test:gpu` runs the chains through a SafeLight checkout's WebGL harness
(headless Chromium on SwiftShader): every pass program compiles, an untouched
photo is a bit-exact no-op, and the rendered change matches darktable to
half-float precision. It needs the SafeLight repository beside this one (or
`SAFELIGHT_CORE=<path>`) with its dev dependencies installed.

The budget exists because 2.0.0's last draw per band re-evaluated a 26-tap level
at 26 positions — 676 fetches per pixel in one draw call, several seconds on an
integrated GPU at develop resolution. The driver's hang detection reset the GPU,
Chromium's GPU process went down with it and SafeLight fell back to the Library.
The CPU harness never saw it because it computes each level once per frame; the
budget counts what the GPU executes.

## Install

Install from the SafeLight **Extensions** window, or load this folder via
Developer Tools ▸ Extensions during development. A **Contrast Equalizer** panel
appears in Develop (right dock). Build from source with `npm install && npm run
build` (outputs `dist/index.js`).

## License & credits

**GPL-3.0-or-later.** The algorithm and UI are a reimplementation of darktable's
contrast equalizer, which is GPL-3.0; this extension is licensed under the GPL to
respect that. darktable is © its authors — see
[darktable-org/darktable](https://github.com/darktable-org/darktable). This is an
independent port and is not affiliated with or endorsed by the darktable project.
