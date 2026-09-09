// The GPU side: darktable's edge-aware à trous contrast equalizer on the host's
// processing-stage + prepass framework.
//
// darktable decomposes the image with eight à trous levels (dilation 2^j) and,
// per level, boosts / soft-cores the detail before summing everything back
// (eaw.c eaw_decompose + eaw_synthesize). A host prepass is a chain of
// full-frame draws that each read only the previous draw's RGB, so one chain
// carries darktable's whole recursion in three channels: the coarse level it
// blurs next and the *running change* it has accumulated so far,
// Σ ((1+gain)·core(detail) − detail). eaw.c treats luma and chroma
// independently (separate weights and normalisation), which is what makes the
// three-channel budget work: the luma chain carries (coarse L, ΔL); a chroma
// chain carries the two coarse chroma coordinates plus the change of ONE of
// them, so two chroma chains — identical apart from the coordinate they
// accumulate — cover both. Every draw is one 26-tap step; a chain is 8 draws.
//
// Why not something cleverer: 2.0.0 gave each of four band stages an
// independent chain whose last draw re-evaluated a 26-tap level at 26
// positions (676 fetches per pixel in ONE draw, ~7.5 G fetches at develop
// resolution). Integrated GPUs took seconds per draw, the driver's hang
// detection reset the GPU, Chromium's GPU process died and SafeLight reloaded
// into the Library. test/verify-cost.cjs pins the per-draw budget so the shader
// can't grow back into that shape.
//
// Coefficients are darktable's per level (no pair averaging): the result is its
// full eight-octave answer, which test/verify-render.cjs checks to float
// precision against an independent transcription of atrous.c / eaw.c.
//
// Working space: linear scene RGB split into achromatic luma and chroma, the
// nearest thing to darktable's Lab L / a,b; luma is scaled to 0..100 so the
// sharpen / threshold constants keep darktable's calibration. Chroma is stored
// as (R−L, B−L); G−L follows from luma(chroma) = 0. Changes are stored signed,
// so the chains need the host's float ping-pong targets
// (EXT_color_buffer_float — every desktop GPU); the 8-bit fallback clamps them.

import type { ProcessingStageContribution, UniformDeclaration } from "./safelight";
import { DT_SCALES } from "./model";

export const BASE_ID = "contrast-equalizer";

export type ChainKey = "luma" | "chroma-red" | "chroma-blue";
export const CHAINS: readonly ChainKey[] = ["luma", "chroma-red", "chroma-blue"];

// The host derives each stage's GLSL name prefix from a 4-char hash of its id
// (shader-compiler.ts `hashStageId` = top-4 base36 digits of a djb2-style hash).
// Sibling ids that hash to the same prefix redefine each other's uniforms in
// the single develop shader (a link error, nothing renders). Mirror the hash
// and salt an id until its prefix is unique.
function hash4(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36).slice(0, 4);
}

const CHAIN_IDS: Record<ChainKey, string> = (() => {
  const ids = {} as Record<ChainKey, string>;
  const seen = new Set<string>();
  for (const chain of CHAINS) {
    const base = `${BASE_ID}.${chain}`;
    let id = base;
    for (let salt = 1; seen.has(hash4(id)) && salt < 1000; salt++) id = `${base}-${salt}`;
    seen.add(hash4(id));
    ids[chain] = id;
  }
  return ids;
})();

export const chainStageId = (chain: ChainKey): string => CHAIN_IDS[chain];

// Rec. 709 luma weights, the host's luma().
const LR = "0.2126";
const LG = "0.7152";
const LB = "0.0722";

// ── Pass GLSL ────────────────────────────────────────────────────────────────
//
// Per-level tables arrive as vec4 pairs (levels 0-3 in A, 4-7 in B); the pass
// index is the level. `readPrev` is the host's: the linearised source on the
// first draw (uPrevRaw), this chain's previous output afterwards.

const SHARED_HELPERS = `
// B3 spline 1D weights [1,4,6,4,1]/16.
float ceB3(int d) { d = d < 0 ? -d : d; return d == 0 ? 0.375 : (d == 1 ? 0.25 : 0.0625); }
// Level i of a per-level table split across two vec4s.
float ceLevel(vec4 a, vec4 b, int i) {
  vec4 v = i < 4 ? a : b;
  int k = i < 4 ? i : i - 4;
  return k == 0 ? v.x : (k == 1 ? v.y : (k == 2 ? v.z : v.w));
}
`;

// Chain state: x = source luma, y = coarse luma as an offset from it, z =
// accumulated change. The ping-pong targets are half-float, whose precision is
// relative: a coarse level stored outright would round to ~1/4000 of itself and
// the level-to-level differences that become detail would inherit that error
// eight times over. The offset and the change stay small, so they keep far
// finer steps; the source luma round-trips unchanged.
const LUMA_HELPERS = `${SHARED_HELPERS}
vec3 ceState(vec2 uv) {
  vec3 p = readPrev(uv);
  return uPrevRaw ? vec3(luma(p), 0.0, 0.0) : p;
}
float ceCoarse(vec3 st) { return (st.x + st.y) * 100.0; }
`;

// One eaw_decompose step on the carried luma (25-tap B3 dilated by 2^level,
// weight exp(−sharp·ΔL²) — eaw.c's −0.5·sharpen luma lane multiplies a DOUBLED
// square, so the effective exponent is −sharp·ΔL²), then eaw_synthesize for
// this level folded into the running change. The last draw emits the change.
const LUMA_GLSL = `
{
  float mult = exp2(float(uPassIndex));
  float sharp = ceLevel(sharpA, sharpB, uPassIndex);
  vec3 st = ceState(vUv);
  float Lc = ceCoarse(st);
  float sum = 0.0;
  float wsum = 0.0;
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      float Ls = ceCoarse(ceState(vUv + vec2(float(dx), float(dy)) * mult * uTexel));
      float dL = Lc - Ls;
      float w = ceB3(dx) * ceB3(dy) * exp(-sharp * dL * dL);
      sum += w * Ls;
      wsum += w;
    }
  }
  float coarse = wsum > 0.0 ? sum / wsum : Lc;
  float d = Lc - coarse;
  float core = sign(d) * max(abs(d) - ceLevel(thrA, thrB, uPassIndex), 0.0);
  float acc = st.z + ((1.0 + ceLevel(gainA, gainB, uPassIndex)) * core - d) * 0.01;
  c = uPassIndex == uPassCount - 1 ? vec3(acc, 0.0, 0.0) : vec3(st.x, coarse * 0.01 - st.x, acc);
}
`;

// Chain state: xy = coarse chroma (R−L, B−L), z = accumulated change of the
// coordinate this chain owns (CE_COMP: 0 = R−L, 1 = B−L).
const chromaHelpers = (comp: 0 | 1): string => `${SHARED_HELPERS}
const int CE_COMP = ${comp};
vec3 ceState(vec2 uv) {
  vec3 p = readPrev(uv);
  if (uPrevRaw) {
    float L = luma(p);
    return vec3(p.r - L, p.b - L, 0.0);
  }
  return p;
}
// The zero-luma chroma vector from its (R−L, B−L) coordinates.
vec3 ceChroma(vec2 ab) { return vec3(ab.x, -(${LR} * ab.x + ${LB} * ab.y) / ${LG}, ab.y); }
`;

// eaw_decompose on the carried chroma (weight exp(−sharp·|Δab|²) over the full
// chroma vector), soft-coring by the detail vector's magnitude, the gain on the
// vector; only this chain's coordinate is accumulated. Both chroma chains run
// the identical blur — a draw has three channels to carry and the pair of
// coarse coordinates needs two of them.
const CHROMA_GLSL = `
{
  float mult = exp2(float(uPassIndex));
  float sharp = ceLevel(sharpA, sharpB, uPassIndex);
  vec3 st = ceState(vUv);
  vec2 abC = st.xy * 100.0;
  vec3 abC3 = ceChroma(abC);
  vec2 sum = vec2(0.0);
  float wsum = 0.0;
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      vec2 abS = ceState(vUv + vec2(float(dx), float(dy)) * mult * uTexel).xy * 100.0;
      vec3 dab = abC3 - ceChroma(abS);
      float w = ceB3(dx) * ceB3(dy) * exp(-sharp * dot(dab, dab));
      sum += w * abS;
      wsum += w;
    }
  }
  vec2 coarse = wsum > 0.0 ? sum / wsum : abC;
  vec2 d = abC - coarse;
  float mag = length(ceChroma(d));
  float thr = ceLevel(thrA, thrB, uPassIndex);
  // Below the epsilon the magnitude division is unstable; pass the (≤1e-7
  // linear) chroma through uncored so the zero-gain case stays an exact identity.
  float fac = mag > 1e-5 ? max(mag - thr, 0.0) / mag : 1.0;
  float dX = CE_COMP == 0 ? d.x : d.y;
  float acc = st.z + ((1.0 + ceLevel(gainA, gainB, uPassIndex)) * fac * dX - dX) * 0.01;
  c = uPassIndex == uPassCount - 1 ? vec3(acc, 0.0, 0.0) : vec3(coarse * 0.01, acc);
}
`;

const PASS_UNIFORMS: UniformDeclaration[] = ["gainA", "gainB", "thrA", "thrB", "sharpA", "sharpB"].map(
  (key) => ({ key, glslType: "vec4", default: [0, 0, 0, 0] }),
);

// ── Inline GLSL ──────────────────────────────────────────────────────────────
//
// stageResult.x is the chain's accumulated change in linear units. `active`
// gates it: the host binds the raw source as stageResult for a chain whose
// params are all zero (its prepass is skipped), and 0 × garbage is exactly 0.

const INLINE_UNIFORMS: UniformDeclaration[] = [
  { key: "active", glslType: "float", default: 0 },
];

const LUMA_INLINE = `lin += vec3(stageResult.x * active);`;

// A chroma coordinate's change, applied as the zero-luma vector it stands for.
const CHROMA_INLINE: Record<0 | 1, string> = {
  0: `{
  float d = stageResult.x * active;
  lin += vec3(d, -d * (${LR} / ${LG}), 0.0);
}`,
  1: `{
  float d = stageResult.x * active;
  lin += vec3(0.0, -d * (${LB} / ${LG}), d);
}`,
};

function stage(
  chain: ChainKey,
  name: string,
  priority: number,
  glsl: string,
  helpers: string,
  inline: string,
): ProcessingStageContribution {
  return {
    id: chainStageId(chain),
    name: `Contrast Equalizer · ${name}`,
    // Scene-linear, after exposure/white balance; the three changes are
    // additive so their order among themselves doesn't matter.
    phase: "scene-linear",
    priority,
    glsl: inline,
    uniforms: INLINE_UNIFORMS,
    passes: [{ glsl, helpers, iterations: DT_SCALES, uniforms: PASS_UNIFORMS }],
  };
}

export function allChainStages(): ProcessingStageContribution[] {
  return [
    stage("luma", "luma", 70, LUMA_GLSL, LUMA_HELPERS, LUMA_INLINE),
    stage("chroma-red", "chroma R−L", 71, CHROMA_GLSL, chromaHelpers(0), CHROMA_INLINE[0]),
    stage("chroma-blue", "chroma B−L", 72, CHROMA_GLSL, chromaHelpers(1), CHROMA_INLINE[1]),
  ];
}
