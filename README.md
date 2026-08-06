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

- **Drag a node** up/down to boost/cut that detail scale.
- **Mouse wheel** over the graph sets the **radius of influence** (the white
  circle) — a wider radius pulls neighbouring nodes along when you drag, for
  smooth, broad adjustments.
- **Double-click** a node to reset it.
- **Mix** scales the whole effect (deviation from the neutral curve).
- **Presets**: Sharpen, Deblur, Local contrast (clarity), Bloom, Denoise (luma /
  chroma), Denoise & sharpen.

## The math

Faithful to darktable's `atrous` module (`src/iop/atrous.c`, `src/common/eaw.c`):

- **B3-spline à trous** decomposition, `[1,4,6,4,1]/16` separable kernel, dilation
  `2^scale`, made **edge-aware** with darktable's weight
  `exp(-½·sharp·ΔL²)` (luma) / `exp(-sharp·(Δa²+Δb²))` (chroma).
- Detail is boosted by **`(2·curve)²`** and **soft-cored** against the denoise
  threshold `copysign(max(|d|−thr, 0))`, with darktable's per-scale threshold
  scaling `2^(−7(1−t))·{10,20}·curve`. The sharpness curve feeds `0.0025·curve`.
- The 0.5 centre and 0 thresholds make the neutral curve an exact identity.

### How it maps onto SafeLight

SafeLight runs extension wavelet passes through its GPU pre-pass framework, which
caps at four ping-pong stages. So the equalizer exposes **four of darktable's
eight wavelet octaves** — octaves 0, 2, 4 and 6, feature support ≈ 5 / 17 / 65 /
257 px — each a separate stage that runs the true à trous chain (dilation
doubling per level, exactly darktable's ladder) from the source down to its
octave. The curve's x-axis uses darktable's own scale mapping, so a node at the
coarse end drives the same big, soft structures it does in darktable, and a lift
there reads as a gentle tonal lift, not a clarity punch. Decomposing every band
from the source keeps the bands independent and lets the boosts/thresholds apply
*inline*, so dragging the luma/chroma curves is interactive (the wavelet
decomposition is cached and only recomputed when the **edges** curve or the image
changes). The six-node curves still shape all four sampled octaves because the
spline is continuous.

Differences from darktable to be aware of:

- darktable adjusts all eight octaves; here the four sampled ones respond and the
  in-between octaves (9 / 33 / 129 / 513 px) pass through unchanged, so very
  broad moves come out slightly gentler than darktable's total.
- Detail is computed in linear scene RGB split into luma + chroma (darktable works
  in Lab); the luma weight is taken to a 0–100 scale so the thresholds and edge
  weights keep darktable's numeric feel.
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
