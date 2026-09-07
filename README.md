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
  `2^scale`, made **edge-aware** with darktable's weight
  `exp(-sharp·ΔL²)` (luma) / `exp(-sharp·(Δa²+Δb²))` (chroma).
- Detail is boosted by **`(2·curve)²`** and **soft-cored** against the denoise
  threshold `copysign(max(|d|−thr, 0))`, with darktable's per-scale threshold
  scaling `2^(−7(1−t))·{10,20}·curve`. The sharpness curve feeds `0.0025·curve`.
- The 0.5 centre and 0 thresholds make the neutral curve an exact identity.

### How it maps onto SafeLight

SafeLight runs extension wavelet passes through its GPU pre-pass framework. The
equalizer registers **four stages, each owning a pair of darktable's eight
wavelet octaves** (0+1, 2+3, 4+5, 6+7). Each stage runs the true à trous chain
(dilation doubling per level, exactly darktable's ladder) from the source and
emits its pair's summed detail, so the four bands **tile darktable's eight-level
decomposition exactly** — a flat curve (e.g. the Clarity preset) reproduces
darktable's full eight-octave result to float precision. Sloped curves apply the
average of each pair's two boosts/thresholds, so they differ from darktable only
by the curve's variation *within* a pair. Decomposing every band from the source
keeps the bands independent and lets the boosts/thresholds apply *inline*, so
dragging the luma/chroma curves is interactive (the wavelet decomposition is
cached and only recomputed when the **edges** curve or the image changes).

Differences from darktable to be aware of:

- Detail is computed in linear scene RGB split into luma + chroma (darktable works
  in Lab); the luma weight is taken to a 0–100 scale so the thresholds and edge
  weights keep darktable's numeric feel.
- Boosts and thresholds act per two-octave band (the pair's average) rather than
  per octave, and the noise coring applies to the merged band's detail.
- darktable draws a per-band energy histogram behind the curve and shifts its
  scale marks with the zoom; the graph here shades the fixed octave spans.
- Wavelet detail is bias-encoded so it survives the 8-bit render-target fallback on
  GPUs without `EXT_color_buffer_float`; the float path (essentially all desktop
  GPUs) is full-precision.

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
