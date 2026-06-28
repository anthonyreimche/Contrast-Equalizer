// Bridge between the panel's curve model and the develop param bag.
//
// Two things live in the (persisted, undoable, per-photo) param bag:
//  • the source of truth the PANEL reads — the five curve arrays + the mix value,
//    stored under contrast-equalizer.curve.* / .mix;
//  • the GPU uniforms the STAGES read — per-octave boosts/thresholds + the shared
//    sharpness vec4, derived from the curves.
// We always write both together (deriveAll), so the render is correct even when
// the panel never mounts (export, loupe, a freshly loaded edit).

import {
  BANDS,
  GPU_SCALES,
  bandCoeffs,
  cloneCurves,
  defaultCurves,
  sharps,
  type ChannelKey,
  type Curves,
} from "./model";
import { BASE_ID, bandStageId } from "./wavelet";

export const CHANNELS: ChannelKey[] = ["L", "c", "s", "Lt", "ct"];

const curveKey = (ch: ChannelKey): string => `${BASE_ID}.curve.${ch}`;
export const MIX_KEY = `${BASE_ID}.mix`;
export const DEFAULT_MIX = 1;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Bag = Record<string, any>;

function isCurveArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === BANDS && v.every((n) => typeof n === "number");
}

/** Read the five curves out of the param bag, falling back to darktable defaults. */
export function readCurves(bag: Bag): Curves {
  const def = defaultCurves();
  const out = cloneCurves(def);
  for (const ch of CHANNELS) {
    const v = bag[curveKey(ch)];
    if (isCurveArray(v)) out[ch] = [...v];
  }
  return out;
}

export function readMix(bag: Bag): number {
  const v = bag[MIX_KEY];
  return typeof v === "number" ? v : DEFAULT_MIX;
}

/** Everything to persist + drive the GPU for a given curve set. */
export function deriveAll(curves: Curves, mix: number): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = {};
  // Panel source-of-truth.
  for (const ch of CHANNELS) out[curveKey(ch)] = [...curves[ch]];
  out[MIX_KEY] = mix;
  // GPU uniforms, per octave.
  const sh = sharps(curves, mix);
  for (let i = 0; i < GPU_SCALES; i++) {
    const id = bandStageId(i);
    const cf = bandCoeffs(curves, i, mix);
    out[`${id}.gainL`] = cf.gainL;
    out[`${id}.gainC`] = cf.gainC;
    out[`${id}.thrL`] = cf.thrL;
    out[`${id}.thrC`] = cf.thrC;
    // Octave i's prepass only runs passes 0..i, so it only reads sharps[0..i].
    // Zero the higher components so editing a coarser octave's edge node doesn't
    // bust this finer stage's prepass cache (its sig is keyed on the full vec4).
    out[`${id}.uSharps`] = sh.map((v, j) => (j <= i ? v : 0));
  }
  return out;
}
