// The GPU side: an edge-aware à trous wavelet contrast equalizer built on the
// host's processing-stage + prepass framework.
//
// One STAGE per exposed wavelet octave (4 of them, the host's prepass cap; they
// expose darktable octaves 0/2/4/6 — see model.ts). Each stage's prepass
// independently re-runs the à trous chain from the source — pass j blurs the
// previous coarse level with the B3-spline kernel dilated by 2^j (an edge-aware
// blur, darktable's eaw_decompose) — and its LAST pass emits its octave's detail
// (coarse_o − coarse_{o+1}), bias-encoded into [0,1] so the sign survives the
// host's RGBA8 ping-pong fallback. Because every stage decomposes from the
// immutable source, the bands are independent: the inline glsl decodes each
// octave's detail and sums its boosted, soft-cored change back onto `lin`
// (darktable's eaw_synthesize, reorganised as `lin += (1+gain)·core(detail) −
// detail`). Boost is carried as gain = boost−1 so an identity octave's params are
// all zero (the host idles its prepass) yet a full cut (gain −1) stays active.
// Gains/thresholds are inline uniforms, so dragging the luma/chroma curves never
// recomputes the (cached) prepass — only the cheap inline re-runs.
//
// We work in linear scene RGB split into an achromatic-luma + chroma pair (the
// nearest thing to darktable's Lab L / a,b); luma is taken to a 0..100 scale so
// the edge weight and the noise thresholds keep darktable's numeric calibration.
//
// Reference: darktable src/common/eaw.c (eaw_decompose / eaw_synthesize).

import type { ProcessingStageContribution, StagePass, UniformDeclaration } from "./safelight";
import { GPU_SCALES, OCTAVES } from "./model";

export const BASE_ID = "contrast-equalizer";

// The host derives each stage's GLSL name prefix from a 4-char hash of its id
// (shader-compiler.ts `hashStageId` = top-4 base36 digits of a djb2-style hash).
// Sibling ids that differ only at the tail (band0/band1/…) hash to the SAME
// prefix, so all four stages' uniforms — and the framework's per-stage
// `stageResult` sampler, whose name is purely prefix-derived — would collide in
// the single develop shader (a "redefinition" link error). We mirror that hash
// here and pick ids whose prefixes are provably distinct: readable scale names
// (verified distinct under this hash) with a salt loop as a guarantee.
function hash4(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36).slice(0, 4);
}

const SCALE_NAMES = ["fine", "medium", "coarse", "coarsest"];

const BAND_IDS: string[] = (() => {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < GPU_SCALES; i++) {
    const base = `${BASE_ID}.${SCALE_NAMES[i] ?? `octave${i}`}`;
    let salt = 0;
    let id = base;
    while (seen.has(hash4(id)) && salt < 1000) id = `${base}-${++salt}`;
    seen.add(hash4(id));
    ids.push(id);
  }
  return ids;
})();

export const bandStageId = (scale: number): string => BAND_IDS[scale];

// Map our 0..100 luma working scale; keeps darktable's sharpen / threshold
// constants (tuned for Lab L ∈ 0..100) numerically meaningful on linear RGB.
const CE_SCALE = "100.0";

// ── Prepass: one edge-aware à trous step per iteration ───────────────────────

const PASS_HELPERS = `
// B3 spline 1D weights [1,4,6,4,1]/16.
float ceB3(int d) { d = d < 0 ? -d : d; return d == 0 ? 0.375 : (d == 1 ? 0.25 : 0.0625); }
// Per-level edge sharpness (darktable 'sharp'): levels 0-3 in A, 4-7 in B.
float ceSharp(int i) {
  vec4 v = i < 4 ? uSharpsA : uSharpsB;
  int k = i < 4 ? i : i - 4;
  return k == 0 ? v.x : (k == 1 ? v.y : (k == 2 ? v.z : v.w));
}
`;

// `c` enters as readPrev(vUv) = the coarse approximation at this level. We blur it
// (edge-aware, dilated by the schedule) to the next coarser level; the final pass
// instead emits this octave's detail = coarse − nextCoarse.
const PASS_GLSL = `
{
  float mult = exp2(float(uPassIndex));
  float sharp = ceSharp(uPassIndex);
  vec3 ctr = c;
  float Lc = luma(ctr) * ${CE_SCALE};
  vec3  abC = (ctr - luma(ctr)) * ${CE_SCALE};   // chroma (zero-luma) of the centre
  float sumL = 0.0, wL = 0.0;
  vec3  sumC = vec3(0.0); float wC = 0.0;
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      vec2 off = vec2(float(dx), float(dy)) * mult * uTexel;
      vec3 s = readPrev(vUv + off);
      float f = ceB3(dx) * ceB3(dy);
      float Ls = luma(s) * ${CE_SCALE};
      vec3  abS = (s - luma(s)) * ${CE_SCALE};
      float dL = Lc - Ls;
      float wl = exp(-0.5 * sharp * dL * dL);
      vec3  dab = abC - abS;
      float wc = exp(-sharp * dot(dab, dab));
      float fwl = f * wl;
      float fwc = f * wc;
      sumL += fwl * Ls; wL += fwl;
      sumC += fwc * abS; wC += fwc;
    }
  }
  float coarseL = (wL > 0.0 ? sumL / wL : Lc) / ${CE_SCALE};
  vec3  coarseAb = (wC > 0.0 ? sumC / wC : abC) / ${CE_SCALE};
  vec3 coarse = vec3(coarseL) + coarseAb;
  // The chained coarse stays as-is; the final pass emits this octave's *signed*
  // detail, bias-encoded into [0,1] (0.5 = zero) so it survives the host's RGBA8
  // ping-pong fallback on GPUs without EXT_color_buffer_float. The inline decodes
  // it. (On the RGBA16F path this just costs ~1 bit of precision.)
  c = (uPassIndex == uPassCount - 1) ? ((ctr - coarse) * 0.5 + 0.5) : coarse;
}
`;

// ── Inline: boost + soft-core this octave's detail back onto the image ───────
//
// stageResult = this octave's bias-encoded detail; decode it first. Split into
// achromatic-luma + chroma, soft-core each (darktable: copysign(max(|d|−thr,0))),
// apply the boost as (1 + gain), and add the *change* ((1+gain)·core − detail).
// gain = 0 / thr = 0 is an exact identity — true even when the stage is inactive
// and the host binds the raw source as stageResult, since core then equals the
// (garbage) detail and the change is exactly zero.

const INLINE_GLSL = `
{
  vec3 d = (stageResult - 0.5) * 2.0;      // decode the bias-encoded signed detail
  float dL = luma(d);
  vec3  dC = d - dL;                       // chroma part (zero luma)
  float dL100 = dL * ${CE_SCALE};
  float coreL = sign(dL100) * max(abs(dL100) - thrL, 0.0) / ${CE_SCALE};
  float addL = (1.0 + gainL) * coreL - dL;
  float cmag = length(dC) * ${CE_SCALE};
  float fac = cmag > 1e-5 ? max(cmag - thrC, 0.0) / cmag : 0.0;
  vec3  coreC = dC * fac;
  vec3  addC = (1.0 + gainC) * coreC - dC;
  lin += vec3(addL) + addC;
}
`;

const INLINE_UNIFORMS: UniformDeclaration[] = [
  { key: "gainL", glslType: "float", default: 0, label: "Luma gain" },
  { key: "gainC", glslType: "float", default: 0, label: "Chroma gain" },
  { key: "thrL", glslType: "float", default: 0, label: "Luma threshold" },
  { key: "thrC", glslType: "float", default: 0, label: "Chroma threshold" },
];

function bandPass(band: number): StagePass {
  return {
    glsl: PASS_GLSL,
    helpers: PASS_HELPERS,
    // Reaching octave o's detail takes the full chain: o+1 levels from the source.
    iterations: OCTAVES[band] + 1,
    uniforms: [
      { key: "uSharpsA", glslType: "vec4", default: [0, 0, 0, 0] },
      { key: "uSharpsB", glslType: "vec4", default: [0, 0, 0, 0] },
    ],
  };
}

/** The processing stage for one exposed wavelet octave. */
export function bandStage(band: number): ProcessingStageContribution {
  return {
    id: bandStageId(band),
    name: `Contrast Equalizer · ${SCALE_NAMES[band] ?? `band ${band}`}`,
    // Scene-linear, after exposure/white balance; bands are additive so their
    // order among themselves doesn't matter.
    phase: "scene-linear",
    priority: 70 + band,
    glsl: INLINE_GLSL,
    uniforms: INLINE_UNIFORMS,
    passes: [bandPass(band)],
  };
}

export function allBandStages(): ProcessingStageContribution[] {
  return Array.from({ length: GPU_SCALES }, (_, i) => bandStage(i));
}
