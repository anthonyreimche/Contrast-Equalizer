// The data model + math of darktable's contrast equalizer, reimplemented.
//
// darktable's "atrous" module (GPL-3.0) decomposes the image into wavelet detail
// scales (à trous) and lets you boost/cut local contrast, sharpen and denoise per
// scale, on three curves: luma, chroma and edges. We mirror its parameterisation
// exactly — 6 control nodes per curve (y freely draggable, interior x draggable
// too, exactly like darktable's graph), the (2·y)² boost mapping, the
// scale-weighted soft-coring thresholds and the 0.0025·s edge weight — so the
// numbers and the feel match the tool darktable users already know.
//
// Reference: darktable src/iop/atrous.c + src/common/eaw.c.

// ── darktable constants ──────────────────────────────────────────────────────

export const BANDS = 6;

/** Default node x positions: k/(BANDS-1) → 0, .2, .4, .6, .8, 1 (coarse→fine).
 *  darktable stores x per node and lets the interior ones be dragged; the two
 *  end nodes are pinned to 0 and 1. */
export const NODE_X: number[] = Array.from({ length: BANDS }, (_, k) => k / (BANDS - 1));

/** The five wavelet channels darktable exposes (boosts + noise thresholds + edge). */
export type ChannelKey = "L" | "c" | "s" | "Lt" | "ct";

/** One curve per channel: a y value (0..1) for each of the BANDS nodes. */
export type Curves = Record<ChannelKey, number[]>;
/** Node x positions (0..1, ends pinned) per channel — darktable's p.x arrays. */
export type CurveXs = Record<ChannelKey, number[]>;

/** Channel y-default: contrast/edge curves centre on 0.5 (= no change); the noise
 *  thresholds sit at 0 (= off), matching darktable's init(). */
export const CHANNEL_DEFAULT: Record<ChannelKey, number> = {
  L: 0.5, c: 0.5, s: 0.5, Lt: 0, ct: 0,
};

const CHANNELS: ChannelKey[] = ["L", "c", "s", "Lt", "ct"];

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

export function defaultXs(): CurveXs {
  const out = {} as CurveXs;
  for (const ch of CHANNELS) out[ch] = [...NODE_X];
  return out;
}

export function cloneCurves(src: Curves): Curves {
  return { L: [...src.L], c: [...src.c], s: [...src.s], Lt: [...src.Lt], ct: [...src.ct] };
}

export function cloneXs(src: CurveXs): CurveXs {
  return { L: [...src.L], c: [...src.c], s: [...src.s], Lt: [...src.Lt], ct: [...src.ct] };
}

// ── Wavelet levels ───────────────────────────────────────────────────────────
//
// darktable runs eight à trous levels (dilation 2^j); every level gets its own
// boost/threshold/sharpness, sampled from the curves at darktable's own
// get_scales() position t = 1 − (j+0.5)/i0. i0 is fixed at 8 — its exact value
// for any image whose long edge exceeds ~2.5k px (darktable shrinks it below
// that; we keep the decomposition identical at every image size instead).

export const DT_SCALES = 8;

/** Curve position of every à trous level: j=0 is the finest (dilation 1,
 *  t≈0.94 — the curve's right end), j=7 the coarsest (dilation 128, t≈0.06). */
export const LEVEL_T: number[] = Array.from(
  { length: DT_SCALES },
  (_, j) => 1 - (j + 0.5) / DT_SCALES,
);

/** Dilation of level j in pass texels. darktable's levels are 2^j pixels of the
 *  full-resolution image (get_scales remaps a scaled preview's levels to them),
 *  so a level covers the same stretch of the photo whether the passes run at a
 *  thumbnail's 960 px, Develop's 4096 or an export's full long edge. A source
 *  size of 0 (none yet) counts the pass as full resolution. Process version 1
 *  steps 2^j pass texels at any size, the look those edits were made with. */
export function levelStep(level: number, passLongEdge: number, sourceLongEdge: number, processVersion = 2): number {
  if (processVersion < 2) return 2 ** level;
  return 2 ** level * (sourceLongEdge > 0 ? passLongEdge / sourceLongEdge : 1);
}

/** How much of a level's change applies. A level finer than a pass texel isn't
 *  in the image at this size; darktable has no such level at a scaled preview
 *  and drops it. Over the octave below one texel it fades out instead of
 *  popping as the render size crosses it; at a step of ½ texel or less it is
 *  skipped and passes the coarse level on as it was. Process version 1 applies
 *  every level in full. */
export function levelFade(step: number, processVersion = 2): number {
  if (processVersion < 2) return 1;
  return Math.min(1, Math.max(0, 1 + Math.log2(step)));
}

// ── Spline ───────────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** darktable's equalizer spline (curve_tools.c catmull_rom_set/_val via
 *  dt_draw_curve_calc_value): Hermite segments with central-difference tangents,
 *  ONE-SIDED slopes at the two end nodes — not endpoint duplication, which would
 *  halve the end tangents and flatten the outer segments — and only the final
 *  value clamped to [0,1]. Node x positions are the channel's own (draggable). */
export function evalCurve(xs: number[], ys: number[], t: number): number {
  const n = ys.length;
  let i = n - 2;
  for (let k = 0; k < n - 2; k++) {
    if (t < xs[k + 1]) {
      i = k;
      break;
    }
  }
  const slope = (a: number, b: number) => (ys[b] - ys[a]) / (xs[b] - xs[a]);
  const m0 = i === 0 ? slope(0, 1) : slope(i - 1, i + 1);
  const m1 = i === n - 2 ? slope(n - 2, n - 1) : slope(i, i + 2);
  const h = xs[i + 1] - xs[i];
  const u = (t - xs[i]) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return clamp01(h00 * ys[i] + h10 * h * m0 + h01 * ys[i + 1] + h11 * h * m1);
}

// ── mix ──────────────────────────────────────────────────────────────────────
//
// darktable's _apply_mix (commit_params AND the graph display) pulls every node
// toward its default on BOTH axes before the spline is evaluated:
//   v' = clamp01(v + (mix − 1)·(v − default)),   mix = 1 is identity.

export const DEFAULT_MIX = 1;

export function applyMix(
  ch: ChannelKey,
  xs: number[],
  ys: number[],
  mix: number,
): { xs: number[]; ys: number[] } {
  if (mix === 1) return { xs, ys };
  const dy = CHANNEL_DEFAULT[ch];
  return {
    xs: xs.map((x, k) => clamp01(x + (mix - 1) * (x - NODE_X[k]))),
    ys: ys.map((y) => clamp01(y + (mix - 1) * (y - dy))),
  };
}

function mixedEval(
  curves: Curves,
  xsAll: CurveXs,
  ch: ChannelKey,
  t: number,
  mix: number,
): number {
  const { xs, ys } = applyMix(ch, xsAll[ch], curves[ch], mix);
  return evalCurve(xs, ys, t);
}

// ── darktable coefficient derivation ─────────────────────────────────────────

/** One level's coefficients. darktable: boost = (2·curve)², thrs_L =
 *  2^(−7(1−t))·10·Lt, thrs_c = …·20·ct. The boost is stored as a **delta from
 *  the 1.0 identity** (gain = boost − 1) so a neutral level's params are zero
 *  (the host idles a prepass whose params are all zero) while a full cut stays
 *  non-zero, so the level is *removed* rather than skipped. */
export interface LevelCoeffs {
  gainL: number;
  gainC: number;
  thrL: number;
  thrC: number;
}

export function levelCoeffs(
  curves: Curves,
  xs: CurveXs,
  level: number,
  mix: number,
): LevelCoeffs {
  const t = LEVEL_T[level];
  const L = mixedEval(curves, xs, "L", t, mix);
  const c = mixedEval(curves, xs, "c", t, mix);
  const Lt = mixedEval(curves, xs, "Lt", t, mix);
  const ct = mixedEval(curves, xs, "ct", t, mix);
  const atten = Math.pow(2, -7 * (1 - t));
  return {
    gainL: 2 * L * (2 * L) - 1,
    gainC: 2 * c * (2 * c) - 1,
    thrL: atten * 10 * Lt,
    thrC: atten * 20 * ct,
  };
}

/** Edge-sharpness weight per à trous level (darktable: 0.0025·curve_s),
 *  DT_SCALES entries the prepass indexes by pass (= level). */
export function sharps(curves: Curves, xs: CurveXs, mix: number): number[] {
  return LEVEL_T.map((t) => 0.0025 * mixedEval(curves, xs, "s", t, mix));
}
