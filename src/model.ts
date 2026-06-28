// The data model + math of darktable's contrast equalizer, reimplemented.
//
// darktable's "atrous" module (GPL-3.0) decomposes the image into wavelet detail
// scales (à trous) and lets you boost/cut local contrast, sharpen and denoise per
// scale, on three curves: luma, chroma and edges. We mirror its parameterisation
// exactly — 6 fixed-x control nodes per curve, the (2·y)² boost mapping, the
// scale-weighted soft-coring thresholds and the 0.0025·s edge weight — so the
// numbers and the feel match the tool darktable users already know.
//
// Reference: darktable src/iop/atrous.c + src/common/eaw.c.

// ── darktable constants ──────────────────────────────────────────────────────

export const BANDS = 6;
/** Control-node x positions: k/(BANDS-1) → 0, .2, .4, .6, .8, 1 (coarse→fine). */
export const NODE_X: number[] = Array.from({ length: BANDS }, (_, k) => k / (BANDS - 1));

/** The five wavelet channels darktable exposes (boosts + noise thresholds + edge). */
export type ChannelKey = "L" | "c" | "s" | "Lt" | "ct";

/** One curve per channel: a y value (0..1) for each of the BANDS nodes. */
export type Curves = Record<ChannelKey, number[]>;

/** Channel y-default: contrast/edge curves centre on 0.5 (= no change); the noise
 *  thresholds sit at 0 (= off), matching darktable's init(). */
export const CHANNEL_DEFAULT: Record<ChannelKey, number> = {
  L: 0.5, c: 0.5, s: 0.5, Lt: 0, ct: 0,
};

export function defaultCurves(): Curves {
  const fill = (v: number) => Array.from({ length: BANDS }, () => v);
  return {
    L: fill(CHANNEL_DEFAULT.L),
    c: fill(CHANNEL_DEFAULT.c),
    s: fill(CHANNEL_DEFAULT.s),
    Lt: fill(CHANNEL_DEFAULT.Lt),
    ct: fill(CHANNEL_DEFAULT.ct),
  };
}

export function cloneCurves(src: Curves): Curves {
  return { L: [...src.L], c: [...src.c], s: [...src.s], Lt: [...src.Lt], ct: [...src.ct] };
}

// ── GPU scales ───────────────────────────────────────────────────────────────
//
// The host's prepass framework caps at 4 ping-pong stages, so we run 4 wavelet
// octaves (dilations 1,2,4,8 → ~5..33 px feature support). The 6-node curve is
// continuous, so all six nodes still shape these four sampled scales. Scale i's
// position on the curve follows darktable's get_scales(): t = 1 − (i+0.5)/N.

export const GPU_SCALES = 4;
export const BAND_T: number[] = Array.from(
  { length: GPU_SCALES },
  (_, i) => 1 - (i + 0.5) / GPU_SCALES,
); // [0.875, 0.625, 0.375, 0.125]

// How far the four octaves reach. Most contrast-equalizer work (sharpen, clarity,
// denoise) lives in the fine half, so the default is four even octaves. Users who
// want big tonal / bloom moves can switch to the extended schedule in Preferences.
// Values are the B3 kernel dilation applied at each pass (1<<scale would be the
// even default); larger jumps reach coarser features at the cost of smoothness.
export type DetailRange = "fine" | "extended";

export const DILATIONS: Record<DetailRange, [number, number, number, number]> = {
  fine: [1, 2, 4, 8], // ~5..33 px feature support
  extended: [1, 4, 16, 64], // ~5..257 px — darktable's coarse reach
};

// ── Spline ───────────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Catmull-Rom spline through the BANDS nodes (uniform x spacing), clamped to
 *  [0,1] — darktable draws its equalizer splines the same way. */
export function evalCurve(y: number[], t: number): number {
  const n = y.length;
  if (t <= NODE_X[0]) return clamp01(y[0]);
  if (t >= NODE_X[n - 1]) return clamp01(y[n - 1]);
  let i = 0;
  while (i < n - 1 && t > NODE_X[i + 1]) i++;
  const x0 = NODE_X[i];
  const x1 = NODE_X[i + 1];
  const u = (t - x0) / (x1 - x0);
  const p0 = y[Math.max(0, i - 1)];
  const p1 = y[i];
  const p2 = y[i + 1];
  const p3 = y[Math.min(n - 1, i + 2)];
  const u2 = u * u;
  const u3 = u2 * u;
  const v =
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
  return clamp01(v);
}

// ── darktable coefficient derivation ─────────────────────────────────────────
//
// "mix" scales every node's deviation from its channel default (darktable's
// _apply_mix): effective = default + mix·(value − default). mix = 1 is identity.

export const DEFAULT_MIX = 1;

function mixed(curves: Curves, ch: ChannelKey, t: number, mix: number): number {
  const def = CHANNEL_DEFAULT[ch];
  return clamp01(def + mix * (evalCurve(curves[ch], t) - def));
}

/** Per-scale inline uniforms. darktable: boost = (2·curve)², thrs_L =
 *  2^(−7(1−t))·10·Lt, thrs_c = …·20·ct. We store the boost as a **delta from the
 *  1.0 identity** (gain = boost − 1) so a neutral octave's four GPU params are all
 *  zero. That matters twice: the host idles the prepass for an identity band (it
 *  gates on "any non-zero numeric param"), and a full cut (boost 0 → gain −1) is
 *  still non-zero, so the band stays active and is *removed* rather than left
 *  subtracting the raw-source fallback the host binds when a stage looks inert. */
export interface BandCoeffs {
  gainL: number;
  gainC: number;
  thrL: number;
  thrC: number;
}

export function bandCoeffs(curves: Curves, scale: number, mix: number): BandCoeffs {
  const t = BAND_T[scale];
  const L = mixed(curves, "L", t, mix);
  const c = mixed(curves, "c", t, mix);
  const Lt = mixed(curves, "Lt", t, mix);
  const ct = mixed(curves, "ct", t, mix);
  const atten = Math.pow(2, -7 * (1 - t));
  return {
    gainL: (2 * L) * (2 * L) - 1,
    gainC: (2 * c) * (2 * c) - 1,
    thrL: atten * 10 * Lt,
    thrC: atten * 20 * ct,
  };
}

/** The four per-scale edge-sharpness weights (darktable: 0.0025·curve_s), packed
 *  as a vec4 the prepass indexes by pass (= scale). */
export function sharps(curves: Curves, mix: number): [number, number, number, number] {
  const s = BAND_T.map((t) => 0.0025 * mixed(curves, "s", t, mix));
  return [s[0], s[1], s[2], s[3]];
}
