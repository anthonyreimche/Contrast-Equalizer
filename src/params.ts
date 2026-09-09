// Bridge between the panel's curve model and the develop param bag.
//
// Three things live in the (persisted, undoable, per-photo) param bag:
//  • the source of truth the PANEL reads — the five y-curve arrays + the five
//    node-x arrays + the mix value, under contrast-equalizer.curve.* /
//    .curvex.* / .mix;
//  • the GPU uniforms the CHAINS read — per-level gain / threshold / sharpness
//    tables plus an `active` flag per chain, derived from the curves.
// We always write both together (deriveAll), so the render is correct even when
// the panel never mounts (export, loupe, a freshly loaded edit).

import {
  BANDS,
  DT_SCALES,
  cloneCurves,
  cloneXs,
  defaultCurves,
  defaultXs,
  levelCoeffs,
  sharps,
  type ChannelKey,
  type Curves,
  type CurveXs,
} from "./model";
import { BASE_ID, CHAINS, chainStageId, type ChainKey } from "./wavelet";

export const CHANNELS: ChannelKey[] = ["L", "c", "s", "Lt", "ct"];

const curveKey = (ch: ChannelKey): string => `${BASE_ID}.curve.${ch}`;
const curveXKey = (ch: ChannelKey): string => `${BASE_ID}.curvex.${ch}`;
export const MIX_KEY = `${BASE_ID}.mix`;
export const DEFAULT_MIX = 1;

type Bag = Record<string, unknown>;
type Patch = Record<string, number | number[]>;

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

const ZERO4 = [0, 0, 0, 0];

// A chain whose gains and thresholds are all zero is an exact identity no
// matter how it decomposes, so every one of its params is zeroed (the host runs
// a prepass only while some param under its stage id is non-zero) and its
// inline is gated off. Otherwise the whole level table goes up, sharps
// included — editing the edges curve must rerun exactly the chains it affects.
function chainParams(
  chain: ChainKey,
  gains: number[],
  thrs: number[],
  sharp: number[],
  out: Patch,
): void {
  const id = chainStageId(chain);
  const on = gains.some((g) => g !== 0) || thrs.some((t) => t !== 0);
  const table = (v: number[]) => (on ? v : ZERO4);
  out[`${id}.gainA`] = table(gains.slice(0, 4));
  out[`${id}.gainB`] = table(gains.slice(4, 8));
  out[`${id}.thrA`] = table(thrs.slice(0, 4));
  out[`${id}.thrB`] = table(thrs.slice(4, 8));
  out[`${id}.sharpA`] = table(sharp.slice(0, 4));
  out[`${id}.sharpB`] = table(sharp.slice(4, 8));
  out[`${id}.active`] = on ? 1 : 0;
}

/** Everything to persist + drive the GPU for a given curve set. */
export function deriveAll(curves: Curves, xs: CurveXs, mix: number): Patch {
  const out: Patch = {};
  // Panel source-of-truth.
  for (const ch of CHANNELS) {
    out[curveKey(ch)] = [...curves[ch]];
    out[curveXKey(ch)] = [...xs[ch]];
  }
  out[MIX_KEY] = mix;
  // GPU tables, one entry per à trous level.
  const levels = Array.from({ length: DT_SCALES }, (_, j) => levelCoeffs(curves, xs, j, mix));
  const sharp = sharps(curves, xs, mix);
  const gainC = levels.map((k) => k.gainC);
  const thrC = levels.map((k) => k.thrC);
  chainParams("luma", levels.map((k) => k.gainL), levels.map((k) => k.thrL), sharp, out);
  chainParams("chroma-red", gainC, thrC, sharp, out);
  chainParams("chroma-blue", gainC, thrC, sharp, out);
  return out;
}

/** An edit saved by 1.x / 2.0 carries the curves but stores its GPU uniforms
 *  under per-band keys this release's chains never read, so the panel would
 *  show an edit the render ignores. Returns the params to re-derive from the
 *  bag's curves, or null when the bag is current or holds no equalizer edit. */
export function migrateBag(bag: Bag): Patch | null {
  if (!CHANNELS.some((ch) => isCurveArray(bag[curveKey(ch)]))) return null;
  if (CHAINS.every((chain) => `${chainStageId(chain)}.active` in bag)) return null;
  return deriveAll(readCurves(bag), readXs(bag), readMix(bag));
}
