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

// ── GPU scales ───────────────────────────────────────────────────────────────
//
// darktable runs eight à trous octaves; we run four stages, each owning a PAIR
// of consecutive octaves. Stage b chains from the source to octave o = 2b and
// emits the two-octave detail c_o − c_{o+2} (wavelet.ts), so the four bands
// TILE darktable's eight-level decomposition exactly: Σ bands = source − c_8.
// Curve positions use darktable's own get_scales() mapping t = 1 − (s+0.5)/i0
// with i0 = 8 (its exact value for any image whose long edge exceeds ~2.5k px);
// a band's boost/threshold is the average of its two octaves' — exact for a
// flat curve, and off only by the within-pair curve slope otherwise.

export const DT_SCALES = 8;
export const OCTAVES: readonly number[] = [0, 2, 4, 6];
export const GPU_SCALES = OCTAVES.length;

const octaveT = (o: number): number => 1 - (o + 0.5) / DT_SCALES;

/** The two octaves each band spans (its emitted detail is their sum), as curve
 *  positions. darktable boosts/cores the two separately; a single coefficient
 *  serves the merged band, so the pair's values are AVERAGED. */
export const BAND_PAIR_T: ReadonlyArray<readonly [number, number]> = OCTAVES.map(
  (o) => [octaveT(o), octaveT(o + 1)] as const,
);

/** Curve position of every à trous chain level — the edge-sharpness curve is
 *  sampled per decomposition level, exactly darktable's per-scale sharp[]. */
export const LEVEL_T: number[] = Array.from({ length: DT_SCALES }, (_, j) => octaveT(j));

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

/** Per-scale inline uniforms. darktable: boost = (2·curve)², thrs_L =
 *  2^(−7(1−t))·10·Lt, thrs_c = …·20·ct. We store the boost as a **delta from the
 *  1.0 identity** (gain = boost − 1) so a neutral octave's four GPU params are all
 *  zero. That matters twice: the host idles the prepass for an identity band (it
 *  gates on "any non-zero numeric param"), and a full cut stays non-zero, so the
 *  band stays active and is *removed* rather than left subtracting the raw-source
 *  fallback the host binds when a stage looks inert. */
export interface BandCoeffs {
  gainL: number;
  gainC: number;
  thrL: number;
  thrC: number;
}

export function bandCoeffs(
  curves: Curves,
  xs: CurveXs,
  scale: number,
  mix: number,
): BandCoeffs {
  let gainL = 0;
  let gainC = 0;
  let thrL = 0;
  let thrC = 0;
  // Average the two spanned octaves' coefficients (see BAND_PAIR_T) — each t
  // keeps its own 2^(−7(1−t)) threshold attenuation. An average of per-octave
  // gains stays within darktable's own [−1, 3] range, so no clamp is needed.
  for (const t of BAND_PAIR_T[scale]) {
    const L = mixedEval(curves, xs, "L", t, mix);
    const c = mixedEval(curves, xs, "c", t, mix);
    const Lt = mixedEval(curves, xs, "Lt", t, mix);
    const ct = mixedEval(curves, xs, "ct", t, mix);
    const atten = Math.pow(2, -7 * (1 - t));
    gainL += (2 * L * (2 * L) - 1) / 2;
    gainC += (2 * c * (2 * c) - 1) / 2;
    thrL += (atten * 10 * Lt) / 2;
    thrC += (atten * 20 * ct) / 2;
  }
  return { gainL, gainC, thrL, thrC };
}

/** Edge-sharpness weight per à trous chain level (darktable: 0.0025·curve_s),
 *  DT_SCALES entries the prepass indexes by pass (= level). */
export function sharps(curves: Curves, xs: CurveXs, mix: number): number[] {
  return LEVEL_T.map((t) => 0.0025 * mixedEval(curves, xs, "s", t, mix));
}
