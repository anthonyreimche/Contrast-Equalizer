// Built-in presets, mirroring the ones darktable ships with its contrast
// equalizer. Each returns a full curve set (coarse→fine, 6 nodes). The contrast/
// edge curves centre on 0.5 (no change); the denoise thresholds sit at 0 (off).

import { defaultCurves, type Curves } from "./model";

export interface Preset {
  id: string;
  label: string;
  build: () => Curves;
}

// Node order is coarse (index 0) → fine (index 5).
const make = (over: Partial<Record<keyof Curves, number[]>>): Curves => {
  const c = defaultCurves();
  for (const k of Object.keys(over) as (keyof Curves)[]) c[k] = over[k]!.slice();
  return c;
};

export const PRESETS: Preset[] = [
  { id: "flat", label: "Flat (reset)", build: () => defaultCurves() },
  {
    id: "sharpen",
    label: "Sharpen",
    build: () => make({ L: [0.5, 0.5, 0.5, 0.56, 0.66, 0.74] }),
  },
  {
    id: "deblur-medium",
    label: "Deblur · medium",
    build: () => make({ L: [0.5, 0.5, 0.54, 0.64, 0.78, 0.86] }),
  },
  {
    id: "deblur-strong",
    label: "Deblur · strong",
    build: () => make({ L: [0.5, 0.52, 0.6, 0.74, 0.9, 1.0] }),
  },
  {
    id: "clarity",
    label: "Local contrast (clarity)",
    build: () => make({ L: [0.5, 0.58, 0.64, 0.6, 0.52, 0.5] }),
  },
  {
    id: "bloom",
    label: "Bloom",
    build: () => make({ L: [0.5, 0.64, 0.7, 0.6, 0.5, 0.44] }),
  },
  {
    id: "denoise-luma",
    label: "Denoise · luma",
    build: () => make({ Lt: [0, 0, 0.1, 0.35, 0.62, 0.82] }),
  },
  {
    id: "denoise-chroma",
    label: "Denoise · chroma",
    build: () => make({ ct: [0, 0, 0.15, 0.45, 0.72, 0.9] }),
  },
  {
    id: "denoise-sharpen",
    label: "Denoise & sharpen",
    build: () =>
      make({
        L: [0.5, 0.5, 0.5, 0.56, 0.66, 0.72],
        Lt: [0, 0, 0.08, 0.3, 0.55, 0.75],
        ct: [0, 0, 0.12, 0.4, 0.65, 0.85],
      }),
  },
];
