// Bridge between the panel's curve model and the develop param bag.
//
// Three things live in the (persisted, undoable, per-photo) param bag:
//  • the source of truth the PANEL reads — the five y-curve arrays + the five
//    node-x arrays + the mix value, under contrast-equalizer.curve.* /
//    .curvex.* / .mix;
//  • the GPU uniforms the STAGES read — per-octave boosts/thresholds + the shared
//    sharpness vec4s, derived from the curves.
// We always write both together (deriveAll), so the render is correct even when
// the panel never mounts (export, loupe, a freshly loaded edit).

import {
  BANDS,
  GPU_SCALES,
  OCTAVES,
  bandCoeffs,
  cloneCurves,
  cloneXs,
  defaultCurves,
  defaultXs,
  sharps,
  type ChannelKey,
  type Curves,
  type CurveXs,
} from "./model";
import { BASE_ID, bandStageId } from "./wavelet";

export const CHANNELS: ChannelKey[] = ["L", "c", "s", "Lt", "ct"];

const curveKey = (ch: ChannelKey): string => `${BASE_ID}.curve.${ch}`;
const curveXKey = (ch: ChannelKey): string => `${BASE_ID}.curvex.${ch}`;
export const MIX_KEY = `${BASE_ID}.mix`;
export const DEFAULT_MIX = 1;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Bag = Record<string, any>;

function isCurveArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === BANDS && v.every((n) => typeof n === "number");
}

/** Read the five y-curves out of the param bag, falling back to darktable defaults. */
export function readCurves(bag: Bag): Curves {
  const out = cloneCurves(defaultCurves());
  for (const ch of CHANNELS) {
    const v = bag[curveKey(ch)];
    if (isCurveArray(v)) out[ch] = [...v];
  }
  return out;
}

/** Read the five node-x arrays; edits from before x-dragging existed simply
 *  fall back to the uniform default positions. */
export function readXs(bag: Bag): CurveXs {
  const out = cloneXs(defaultXs());
  for (const ch of CHANNELS) {
    const v = bag[curveXKey(ch)];
    if (isCurveArray(v)) out[ch] = [...v];
  }
  return out;
}

export function readMix(bag: Bag): number {
  const v = bag[MIX_KEY];
  return typeof v === "number" ? v : DEFAULT_MIX;
}

/** Everything to persist + drive the GPU for a given curve set. */
export function deriveAll(
  curves: Curves,
  xs: CurveXs,
  mix: number,
): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = {};
  // Panel source-of-truth.
  for (const ch of CHANNELS) {
    out[curveKey(ch)] = [...curves[ch]];
    out[curveXKey(ch)] = [...xs[ch]];
  }
  out[MIX_KEY] = mix;
  // GPU uniforms, per exposed octave.
  const sh = sharps(curves, xs, mix);
  for (let i = 0; i < GPU_SCALES; i++) {
    const id = bandStageId(i);
    const cf = bandCoeffs(curves, xs, i, mix);
    out[`${id}.gainL`] = cf.gainL;
    out[`${id}.gainC`] = cf.gainC;
    out[`${id}.thrL`] = cf.thrL;
    out[`${id}.thrC`] = cf.thrC;
    // A band with zero gains and thresholds is an exact identity no matter how
    // it decomposes — zero its sharps too so the whole param set is zero and the
    // host idles the prepass. Otherwise, band i's chain runs levels 0..o+1 (its
    // detail spans octaves o and o+1), so zero the levels above: editing a
    // coarser level's edge node must not bust this stage's prepass cache (its
    // sig is keyed on the pass uniforms).
    const idle = cf.gainL === 0 && cf.gainC === 0 && cf.thrL === 0 && cf.thrC === 0;
    const masked = sh.map((v, j) => (!idle && j <= OCTAVES[i] + 1 ? v : 0));
    out[`${id}.uSharpsA`] = masked.slice(0, 4);
    out[`${id}.uSharpsB`] = masked.slice(4, 8);
  }
  return out;
}
