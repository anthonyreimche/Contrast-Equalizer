// darktable's shipped contrast-equalizer presets, values verbatim from
// atrous.c init_presets() (GPL-3.0), in darktable's menu order plus a "flat"
// reset. Node order is coarse (index 0) → fine (index 5). Upstream's ramps
// divide by BANDS in some presets and BANDS−1 in others — each is kept exactly
// as written, these are the shapes darktable users expect.

import { BANDS, defaultCurves, type Curves } from "./model";

export interface Preset {
  id: string;
  label: string;
  build: () => Curves;
}

const N = BANDS - 1;

const seq = (f: (k: number) => number): number[] =>
  Array.from({ length: BANDS }, (_, k) => f(k));

const make = (over: Partial<Curves>): Curves => ({ ...defaultCurves(), ...over });

// darktable's GAUSS(x, σ) — centred on the fine end (x = 1), atrous.c:728.
const gauss = (x: number, sigma: number): number =>
  Math.exp(-((1 - x) * (1 - x)) / (sigma * sigma)) / (2 * sigma * Math.sqrt(Math.PI));

const DEBLUR_SIGMA = 3 / N;

// Deblur lifts luma + edges by summed Gaussians over the fine scales and raises
// both noise floors. blurs = how many Gaussians join in (fine σ/2, medium σ,
// coarse 2σ); the strength tier picks the divisors.
const deblur = (blurs: number, boostDiv: number, noiseDiv: number): Curves => {
  const sum = (x: number) =>
    [0.5, 1, 2].slice(0, blurs).reduce((a, m) => a + gauss(x, m * DEBLUR_SIGMA), 0);
  return make({
    L: seq((k) => 0.5 + sum(k / N) / boostDiv),
    s: seq((k) => 0.5 + sum(k / N) / boostDiv),
    Lt: seq((k) => sum(k / N) / noiseDiv),
    ct: seq((k) => sum(k / N) / noiseDiv),
  });
};

// Strength 1's noise divisor really is 128 upstream (not the /256 the /192
// midpoint suggests) — copied verbatim.
const DEBLUR_STRENGTHS: [strength: number, boostDiv: number, noiseDiv: number][] = [
  [3, 16, 128],
  [2, 24, 192],
  [1, 32, 128],
];
const DEBLUR_BLURS: [name: string, blurs: number][] = [
  ["large", 3],
  ["medium", 2],
  ["fine", 1],
];

export const PRESETS: Preset[] = [
  { id: "flat", label: "Flat (reset)", build: () => defaultCurves() },
  {
    id: "coarse",
    label: "Coarse",
    build: () =>
      make({
        L: seq((k) => Math.max(0.5, 0.75 - (0.5 * k) / N)),
        c: seq((k) => Math.max(0.5, 0.55 - (0.5 * k) / N)),
        s: seq((k) => Math.min(0.5, 0.2 + (0.35 * k) / N)),
      }),
  },
  {
    id: "denoise-sharpen",
    label: "Denoise & sharpen",
    build: () =>
      make({
        L: seq((k) => 0.5 + (0.25 * k) / BANDS),
        Lt: seq((k) => (0.2 * k) / BANDS),
        ct: seq((k) => (0.3 * k) / BANDS),
      }),
  },
  {
    id: "sharpen",
    label: "Sharpen",
    build: () => make({ L: seq((k) => 0.5 + (0.25 * k) / BANDS) }),
  },
  {
    id: "denoise-chroma",
    label: "Denoise chroma",
    build: () =>
      make({
        s: seq(() => 0),
        ct: seq((k) => Math.max(0, (0.6 * k) / BANDS - 0.3)),
      }),
  },
  {
    id: "denoise",
    label: "Denoise",
    build: () =>
      make({
        Lt: seq((k) => (0.2 * k) / BANDS),
        ct: seq((k) => (0.3 * k) / BANDS),
      }),
  },
  {
    id: "bloom",
    label: "Bloom",
    build: () =>
      make({
        L: seq((k) => (k === 0 ? 0.5 : Math.min(0.5, 0.3 + (0.35 * k) / N))),
        s: seq(() => 0),
      }),
  },
  {
    id: "clarity",
    label: "Clarity (local contrast)",
    build: () => make({ L: seq(() => 0.6), c: seq(() => 0.55), s: seq(() => 0) }),
  },
  ...DEBLUR_STRENGTHS.flatMap(([strength, boostDiv, noiseDiv]) =>
    DEBLUR_BLURS.map(([blurName, blurs]) => ({
      id: `deblur-${blurName}-${strength}`,
      label: `Deblur · ${blurName} blur · strength ${strength}`,
      build: () => deblur(blurs, boostDiv, noiseDiv),
    })),
  ),
];
