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
// darktable runs up to eight à trous octaves; the host's prepass framework caps
// us at four stages. Each stage therefore runs the full à trous chain (dilation
// 2^j per level, darktable's ladder) down to a TRUE darktable octave, and we
// expose octaves 0/2/4/6 — feature support 2·(2<<o)+1 ≈ 5/17/65/257 px — so the
// four bands span darktable's fine-to-coarse range. Curve positions use
// darktable's own get_scales() mapping t = 1 − (o+0.5)/i0 with i0 = 8 (its exact
// value for any image whose long edge exceeds ~2.5k px), so a node on our x-axis
// addresses the same physical feature size it does in darktable. The octaves in
// between (1/3/5/7) pass through unadjusted; the continuous 6-node spline shapes
// the four that are sampled.

export const DT_SCALES = 8;
export const OCTAVES: readonly number[] = [0, 2, 4, 6];
export const GPU_SCALES = OCTAVES.length;
/** Curve position of each exposed octave (darktable's t). */
export const BAND_T: number[] = OCTAVES.map((o) => 1 - (o + 0.5) / DT_SCALES);
// [0.9375, 0.6875, 0.4375, 0.1875]
/** Curve position of every à trous chain level — the edge-sharpness curve is
 *  sampled per decomposition level, exactly darktable's per-scale sharp[]. */
export const LEVEL_T: number[] = Array.from(
  { length: DT_SCALES },
  (_, j) => 1 - (j + 0.5) / DT_SCALES,
);

// ── Spline ───────────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** darktable's equalizer spline (curve_tools.c catmull_rom_set/_val via
 *  dt_draw_curve_calc_value): Hermite segments with central-difference tangents,
 *  ONE-SIDED slopes at the two end nodes — not endpoint duplication, which would
 *  halve the end tangents and flatten the outer segments — and only the final
 *  value clamped to [0,1]. */
export function evalCurve(y: number[], t: number): number {
  const n = y.length;
  let i = n - 2;
  for (let k = 0; k < n - 2; k++) {
    if (t < NODE_X[k + 1]) {
      i = k;
      break;
    }
  }
  const slope = (a: number, b: number) => (y[b] - y[a]) / (NODE_X[b] - NODE_X[a]);
  const m0 = i === 0 ? slope(0, 1) : slope(i - 1, i + 1);
  const m1 = i === n - 2 ? slope(n - 2, n - 1) : slope(i, i + 2);
  const h = NODE_X[i + 1] - NODE_X[i];
  const u = (t - NODE_X[i]) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return clamp01(h00 * y[i] + h10 * h * m0 + h01 * y[i + 1] + h11 * h * m1);
}

// ── darktable coefficient derivation ─────────────────────────────────────────
//
// "mix" scales every NODE's deviation from its channel default before the spline
// is evaluated (darktable's _apply_mix runs in commit_params, ahead of the
// interpolation): node' = clamp01(default + mix·(node − default)). mix = 1 is
// identity.

export const DEFAULT_MIX = 1;

function mixed(curves: Curves, ch: ChannelKey, t: number, mix: number): number {
  const def = CHANNEL_DEFAULT[ch];
  const nodes =
    mix === 1 ? curves[ch] : curves[ch].map((v) => clamp01(def + mix * (v - def)));
  return evalCurve(nodes, t);
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

/** Edge-sharpness weight per à trous chain level (darktable: 0.0025·curve_s),
 *  DT_SCALES entries the prepass indexes by pass (= level). */
export function sharps(curves: Curves, mix: number): number[] {
  return LEVEL_T.map((t) => 0.0025 * mixed(curves, "s", t, mix));
}
