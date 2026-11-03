// The chains on the real renderer. Run via `npm run test:gpu` (test/gpu/run.cjs
// copies this file into a SafeLight checkout and runs it under its headless
// Chromium + SwiftShader rig). What the CPU harness cannot check:
//
//  • every pass program compiles and links on a real GLSL ES 3.00 driver;
//  • the rendered change equals darktable's answer chain by chain (the same
//    CPU transcription of atrous.c / eaw.c as test/verify-render.cjs) to
//    half-float precision, through the host's actual prepass plumbing — unit
//    allocation, ping-pong targets, the reads-current splits, the idle gate,
//    the inline blocks;
//  • an untouched photo is a bit-exact no-op;
//  • a signed source (a RAW decode's out-of-gamut colours) renders finite and
//    still matches darktable;
//  • a mask's copies of the three chains run their own decompositions with the
//    mask's curves inside the mask, leaving every pixel outside it as the
//    photo's own curves left it;
//  • the chains decompose the exposed image, and a level spans the same
//    stretch of the decode at every render size.
//
// The timings it prints are SwiftShader (CPU) numbers, only useful relative to
// each other.

import { describe, expect, it } from "vitest";
import { allChainStages } from "@ce/wavelet";
import { deriveAll } from "@ce/params";
import {
  applyMix,
  defaultCurves,
  defaultXs,
  evalCurve,
  DEFAULT_MIX,
  DT_SCALES,
  type Curves,
  type CurveXs,
} from "@ce/model";
import {
  LINEAR_PROBE_PIPELINE,
  OPEN_PROBE,
  type Frame,
  builtinStages,
  floatImage,
  identityParams,
  markerStage,
  takingStages,
  withRenderer,
} from "@/rendering/webgl/webgl.test-support";
import { CURRENT_PROCESS_VERSION, defaultMaskAdjustments, type Mask } from "@/catalog/types";

// ── darktable, restricted to the working domain (see test/verify-render.cjs) ─

const W = 256;
const H = 256;
const N = W * H;
const LR = 0.2126;
const LG = 0.7152;
const LB = 0.0722;
const lum = (r: number, g: number, b: number) => r * LR + g * LG + b * LB;
const B3 = (d: number) => (d === 0 ? 0.375 : Math.abs(d) === 1 ? 0.25 : 0.0625);
const clampi = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function makeImage(): Float64Array {
  const img = new Float64Array(N * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const u = x / W;
      const v = y / H;
      let base = 0.03 + 0.14 * Math.exp(-((u - 0.35) ** 2 + (v - 0.4) ** 2) * 2.2);
      base += 0.03 * Math.sin(2 * Math.PI * u) * Math.sin(2 * Math.PI * v);
      base += 0.05 * Math.exp(-((u - 0.7) ** 2 + (v - 0.65) ** 2) * 40);
      base += 0.04 * Math.sin(12 * Math.PI * u + 3 * Math.sin(6 * v)) * Math.exp(-((v - 0.3) ** 2) * 12);
      base += 0.015 * Math.sin(60 * Math.PI * u) * Math.sin(52 * Math.PI * v + u * 9);
      let r = base;
      let g = base * 0.96;
      let b = base * 1.05;
      if (x > 150 && x < 190 && y > 40 && y < 96) {
        r += 0.55;
        g += 0.5;
        b += 0.42;
      }
      const dx = (x - 90) / 34;
      const dy = (y - 170) / 26;
      if (dx * dx + dy * dy < 1) {
        r *= 0.25;
        g *= 0.28;
        b *= 0.35;
      }
      if (x > 40 && x < 78 && y > 60 && y < 92) {
        r += 0.1;
        b *= 0.6;
      }
      img[i] = Math.max(0, r);
      img[i + 1] = Math.max(0, g);
      img[i + 2] = Math.max(0, b);
    }
  }
  return img;
}

function eawBlur(src: Float64Array, mult: number, sharp: number): Float64Array {
  const out = new Float64Array(N * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const Lc = lum(src[i], src[i + 1], src[i + 2]);
      const a0 = (src[i] - Lc) * 100;
      const a1 = (src[i + 1] - Lc) * 100;
      const a2 = (src[i + 2] - Lc) * 100;
      const Lc100 = Lc * 100;
      let sumL = 0;
      let wL = 0;
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let wC = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const sy = clampi(y + dy * mult, 0, H - 1);
        for (let dx = -2; dx <= 2; dx++) {
          const sx = clampi(x + dx * mult, 0, W - 1);
          const j = (sy * W + sx) * 3;
          const Ls = lum(src[j], src[j + 1], src[j + 2]);
          const Ls100 = Ls * 100;
          const b0 = (src[j] - Ls) * 100;
          const b1 = (src[j + 1] - Ls) * 100;
          const b2 = (src[j + 2] - Ls) * 100;
          const f = B3(dx) * B3(dy);
          const dL = Lc100 - Ls100;
          const wl = Math.exp(-sharp * dL * dL);
          const d0 = a0 - b0;
          const d1 = a1 - b1;
          const d2 = a2 - b2;
          const wc = Math.exp(-sharp * (d0 * d0 + d1 * d1 + d2 * d2));
          const fwl = f * wl;
          const fwc = f * wc;
          sumL += fwl * Ls100;
          wL += fwl;
          s0 += fwc * b0;
          s1 += fwc * b1;
          s2 += fwc * b2;
          wC += fwc;
        }
      }
      const cl = (wL > 0 ? sumL / wL : Lc100) / 100;
      const c0 = (wC > 0 ? s0 / wC : a0) / 100;
      const c1 = (wC > 0 ? s1 / wC : a1) / 100;
      const c2 = (wC > 0 ? s2 / wC : a2) / 100;
      out[i] = cl + c0;
      out[i + 1] = cl + c1;
      out[i + 2] = cl + c2;
    }
  }
  return out;
}

function addBand(out: Float64Array, detail: Float64Array, gainL: number, gainC: number, thrL: number, thrC: number) {
  for (let i = 0; i < N * 3; i += 3) {
    const dL = lum(detail[i], detail[i + 1], detail[i + 2]);
    const dC0 = detail[i] - dL;
    const dC1 = detail[i + 1] - dL;
    const dC2 = detail[i + 2] - dL;
    const dL100 = dL * 100;
    const coreL = (Math.sign(dL100) * Math.max(Math.abs(dL100) - thrL, 0)) / 100;
    const cmag = Math.hypot(dC0, dC1, dC2) * 100;
    const fac = cmag > 1e-5 ? Math.max(cmag - thrC, 0) / cmag : 1;
    const addL = (1 + gainL) * coreL;
    out[i] += addL + (1 + gainC) * dC0 * fac;
    out[i + 1] += addL + (1 + gainC) * dC1 * fac;
    out[i + 2] += addL + (1 + gainC) * dC2 * fac;
  }
}

const octaveT = (o: number) => 1 - (o + 0.5) / DT_SCALES;

function reference(src: Float64Array, curves: Curves, xs: CurveXs, mix: number): Float64Array {
  const at = (ch: keyof Curves, t: number) => {
    const m = applyMix(ch, xs[ch], curves[ch], mix);
    return evalCurve(m.xs, m.ys, t);
  };
  const out = new Float64Array(N * 3);
  let coarse = src;
  for (let s = 0; s < DT_SCALES; s++) {
    const t = octaveT(s);
    const L = at("L", t);
    const c = at("c", t);
    const atten = Math.pow(2, -7 * (1 - t));
    const next = eawBlur(coarse, 1 << s, 0.0025 * at("s", t));
    const d = new Float64Array(N * 3);
    for (let i = 0; i < N * 3; i++) d[i] = coarse[i] - next[i];
    addBand(out, d, 4 * L * L - 1, 4 * c * c - 1, atten * 10 * at("Lt", t), atten * 20 * at("ct", t));
    coarse = next;
  }
  for (let i = 0; i < N * 3; i++) out[i] += coarse[i];
  return out;
}

// darktable run the way the stages run it (test/verify-render.cjs `staged`):
// each chain reads the image as the chains before it left it, so the B−L
// change is darktable's on the image already holding the luma and R−L changes.
function staged(src: Float64Array, curves: Curves, xs: CurveXs, mix: number): Float64Array {
  const first = reference(src, curves, xs, mix);
  const mid = new Float64Array(N * 3);
  for (let p = 0; p < N; p++) {
    const i = p * 3;
    const L0 = lum(src[i], src[i + 1], src[i + 2]);
    const L1 = lum(first[i], first[i + 1], first[i + 2]);
    const dR = first[i] - L1 - (src[i] - L0);
    for (let ch = 0; ch < 3; ch++) mid[i + ch] = src[i + ch] + (L1 - L0);
    mid[i] += dR;
    mid[i + 1] -= dR * (LR / LG);
  }
  const second = reference(mid, curves, xs, mix);
  const out = Float64Array.from(mid);
  for (let p = 0; p < N; p++) {
    const i = p * 3;
    const dB =
      second[i + 2] - lum(second[i], second[i + 1], second[i + 2]) - (mid[i + 2] - lum(mid[i], mid[i + 1], mid[i + 2]));
    out[i + 1] -= dB * (LB / LG);
    out[i + 2] += dB;
  }
  return out;
}

// ── Rig ──────────────────────────────────────────────────────────────────────

// The probe pipeline clamps its output to [0,1]; halve the scene so even the
// bright window plus a coarse boost stays inside the range.
const SRC = makeImage().map((v) => v * 0.5);
const SCENE = floatImage(W, H, (x, y) => {
  const i = (y * W + x) * 3;
  return [SRC[i], SRC[i + 1], SRC[i + 2]];
});

interface Comparison {
  /** rms of the GPU change against darktable's. */
  rmse: number;
  /** rms of darktable's change itself — the scale the error is judged on. */
  changeRms: number;
  max: number;
  /** Share of samples left out because the probe pipeline would clamp them. */
  clipped: number;
}

// The probe pipeline clamps its output to [0,1] and darktable's linear-light
// cuts do push dark edge pixels below zero, so samples whose reference result
// leaves the range are not comparable and are skipped.
const CLIP_LO = 0.002;
const CLIP_HI = 0.998;

/** The GPU's change against darktable's, over the columns `inside` picks (all by default). */
function compare(
  on: Frame,
  off: Frame,
  ref: Float64Array,
  src = SRC,
  offset = 0,
  inside = (_x: number) => true,
): Comparison {
  let se = 0;
  let max = 0;
  let change = 0;
  let n = 0;
  let clipped = 0;
  let total = 0;
  for (let p = 0; p < N; p++) {
    if (!inside(p % W)) continue;
    total += 3;
    for (let ch = 0; ch < 3; ch++) {
      const out = ref[p * 3 + ch];
      if (out + offset < CLIP_LO || out + offset > CLIP_HI) {
        clipped++;
        continue;
      }
      const g = on.data[p * 4 + ch] - off.data[p * 4 + ch];
      const r = out - src[p * 3 + ch];
      const e = g - r;
      se += e * e;
      change += r * r;
      n++;
      if (Math.abs(e) > max) max = Math.abs(e);
    }
  }
  return { rmse: Math.sqrt(se / n), changeRms: Math.sqrt(change / n), max, clipped: clipped / total };
}

const xs = defaultXs();
const cases: [string, Curves, number][] = [];
{
  const c = defaultCurves();
  c.L = [0.5, 0.5, 0.5, 0.5, 0.5, 0.7];
  cases.push(["finest luma only", c, 1]);
}
{
  const c = defaultCurves();
  c.L = [0.7, 0.5, 0.5, 0.5, 0.5, 0.5];
  cases.push(["coarsest luma only", c, 1]);
}
{
  const c = defaultCurves();
  c.c = [0.5, 0.56, 0.54, 0.5, 0.5, 0.5];
  cases.push(["chroma only", c, 1]);
}
{
  const c = defaultCurves();
  c.L = [0.62, 0.68, 0.62, 0.54, 0.5, 0.5];
  c.c = [0.5, 0.56, 0.54, 0.5, 0.5, 0.5];
  cases.push(["coarse luma + chroma boost", c, 1]);
}
{
  const c = defaultCurves();
  c.L = c.L.map(() => 0.6);
  c.c = c.c.map(() => 0.55);
  c.s = c.s.map(() => 0);
  cases.push(["clarity (flat)", c, 1]);
}
{
  const c = defaultCurves();
  c.Lt = [0, 1 / 30, 1 / 15, 0.1, 2 / 15, 1 / 6];
  c.ct = [0, 0.05, 0.1, 0.15, 0.2, 0.25];
  cases.push(["denoise ramp", c, 1]);
}
{
  const c = defaultCurves();
  c.L = [0.5, 0.5, 0.52, 0.6, 0.75, 0.9];
  c.s = [0.5, 0.5, 0.55, 0.7, 0.85, 1];
  c.Lt = [0, 0, 0.02, 0.05, 0.1, 0.15];
  cases.push(["fine sharpen with noise floor, mix 0.7", c, 0.7]);
}

// Half-float targets bound the agreement: the chains carry small offsets
// rather than whole levels, which leaves the stored result's own rounding
// (about one half-float step at 0.1) as the floor. Measured on SwiftShader:
// 0.7–2.8% of the change, the higher figures on the smallest changes.
const MAX_ERROR_FRACTION = 0.04;
const MAX_ERROR_FLOOR = 5e-5;

// A RAW decode keeps colours beyond the sRGB primaries as negative linear
// components, and noise near black can take luma below zero; the chains' first
// draw reads that decode as is. The chains are linear in the signal apart from
// the edge-stopping weights (exp of a negated square) and the soft-coring
// (sign-symmetric, magnitude-guarded), so a signed source must still render
// finite and match darktable. The probe lifts the working colour by
// SIGNED_OFFSET so values below black survive the display clamp.
const SIGNED_OFFSET = 0.25;
const SIGNED_PROBE_PIPELINE = {
  ...LINEAR_PROBE_PIPELINE,
  id: "test.ce-signed-probe",
  glsl: `vec3 pipelineToDisplay(vec3 lin) { return lin + ${SIGNED_OFFSET.toFixed(2)}; }`,
  sig: "test.ce-signed-probe",
};
const SIGNED_SRC = SRC.map((v, i) => {
  const ch = i % 3;
  const p = (i - ch) / 3;
  const x = p % W;
  const y = (p - x) / W;
  // An out-of-gamut yellow, textured so every octave has detail to work on.
  if (x >= 100 && x < 140 && y >= 190 && y < 235) {
    return [0.3, 0.25, -0.06][ch] * (1 + 0.3 * Math.sin(x * 0.9) * Math.sin(y * 0.7));
  }
  // Denoiser-sized excursions around black: channels and luma cross zero.
  if (x >= 200 && x < 250 && y >= 150 && y < 200) return 0.004 * (((x * 7 + y * 13 + ch * 5) % 5) - 2);
  return v;
});
const SIGNED_SCENE = floatImage(W, H, (x, y) => {
  const i = (y * W + x) * 3;
  return [SIGNED_SRC[i], SIGNED_SRC[i + 1], SIGNED_SRC[i + 2]];
});

// A linear gradient whose step sits at u = 0.5: the right half is covered.
const RIGHT_HALF: Mask["components"][number] = {
  id: "right",
  kind: "linear",
  mode: "add",
  invert: false,
  linear: { x0: 0.5, y0: 0, x1: 0.5001, y1: 0 },
};

describe("Contrast Equalizer chains on the real renderer", () => {
  it("is a bit-exact no-op while every chain is idle", () => {
    // Renderers share one context and a nested one's dispose() tears down GL
    // state the outer one relies on, so the two frames are taken in sequence.
    const bare = withRenderer({ stages: builtinStages(), pipeline: LINEAR_PROBE_PIPELINE }, (r) => {
      r.setImage(SCENE);
      r.setParams(identityParams());
      return r.captureFloatFrame();
    });
    const idle = withRenderer(
      { stages: [...builtinStages(), ...allChainStages()], pipeline: LINEAR_PROBE_PIPELINE },
      (r) => {
        r.setImage(SCENE);
        r.setParams(identityParams());
        r.setContributedParams(deriveAll(defaultCurves(), xs, DEFAULT_MIX));
        return r.captureFloatFrame();
      },
    );
    expect(bare).not.toBeNull();
    expect(idle).not.toBeNull();
    for (let i = 0; i < idle!.data.length; i++) expect(idle!.data[i]).toBe(bare!.data[i]);
  });

  it("reproduces darktable's eight-octave answer for every curve shape", () => {
    const stages = [...builtinStages(), ...allChainStages()];
    withRenderer({ stages, pipeline: LINEAR_PROBE_PIPELINE }, (renderer) => {
      renderer.setImage(SCENE);
      renderer.setParams(identityParams());
      renderer.setContributedParams(deriveAll(defaultCurves(), xs, DEFAULT_MIX));
      const off = renderer.captureFloatFrame();
      expect(off).not.toBeNull();
      expect(off!.width).toBe(W);
      expect(off!.height).toBe(H);

      for (const [name, curves, mix] of cases) {
        renderer.setContributedParams(deriveAll(curves, xs, mix));
        const t0 = performance.now();
        const on = renderer.captureFloatFrame();
        const ms = performance.now() - t0;
        expect(on).not.toBeNull();
        const s = compare(on!, off!, staged(SRC, curves, xs, mix));
        console.log(
          `[ce-gpu] ${name}: ${ms.toFixed(0)} ms; darktable change rms ${s.changeRms.toExponential(2)}; ` +
            `error rms ${s.rmse.toExponential(2)} (${((100 * s.rmse) / s.changeRms).toFixed(2)}%), ` +
            `max ${s.max.toExponential(2)}, ${(100 * s.clipped).toFixed(2)}% clipped`,
        );
        expect(s.changeRms).toBeGreaterThan(1e-4);
        expect(s.clipped).toBeLessThan(0.05);
        expect(s.rmse).toBeLessThan(Math.max(s.changeRms * MAX_ERROR_FRACTION, MAX_ERROR_FLOOR));
      }
    });
  });

  it("stays finite and matches darktable on a signed (RAW out-of-gamut) source", () => {
    const stages = [...builtinStages(), ...allChainStages()];
    withRenderer({ stages, pipeline: SIGNED_PROBE_PIPELINE }, (renderer) => {
      renderer.setImage(SIGNED_SCENE);
      renderer.setParams(identityParams());
      renderer.setContributedParams(deriveAll(defaultCurves(), xs, DEFAULT_MIX));
      const off = renderer.captureFloatFrame();
      expect(off).not.toBeNull();

      for (const [name, curves, mix] of cases.filter(([n]) => n === "coarse luma + chroma boost" || n === "denoise ramp")) {
        renderer.setContributedParams(deriveAll(curves, xs, mix));
        const on = renderer.captureFloatFrame();
        expect(on).not.toBeNull();
        const nonFinite = on!.data.filter((v) => !Number.isFinite(v)).length;
        const s = compare(on!, off!, staged(SIGNED_SRC, curves, xs, mix), SIGNED_SRC, SIGNED_OFFSET);
        console.log(
          `[ce-gpu] signed ${name}: ${nonFinite} non-finite; darktable change rms ${s.changeRms.toExponential(2)}; ` +
            `error rms ${s.rmse.toExponential(2)} (${((100 * s.rmse) / s.changeRms).toFixed(2)}%), ` +
            `max ${s.max.toExponential(2)}, ${(100 * s.clipped).toFixed(2)}% clipped`,
        );
        expect(nonFinite).toBe(0);
        expect(s.changeRms).toBeGreaterThan(1e-4);
        expect(s.clipped).toBeLessThan(0.05);
        expect(s.rmse).toBeLessThan(Math.max(s.changeRms * MAX_ERROR_FRACTION, MAX_ERROR_FLOOR));
      }
    });
  });

  it("applies a mask's curves inside the mask, and the photo's everywhere else", () => {
    const [name, curves, mix] = cases.find(([n]) => n === "coarse luma + chroma boost")!;
    const mask: Mask = {
      id: "m",
      name: "Mask",
      visible: true,
      invert: false,
      opacity: 100,
      adj: defaultMaskAdjustments(),
      panels: ["contrast-equalizer.panel"],
      bag: deriveAll(curves, xs, mix),
      components: [RIGHT_HALF],
    };
    const stages = [...builtinStages(), ...allChainStages()];
    withRenderer({ stages, pipeline: LINEAR_PROBE_PIPELINE }, (renderer) => {
      renderer.setImage(SCENE);
      renderer.setContributedParams(deriveAll(defaultCurves(), xs, DEFAULT_MIX));
      renderer.setParams(identityParams({ processVersion: 2 }));
      const off = renderer.captureFloatFrame();
      renderer.setParams(identityParams({ processVersion: 2, masks: [mask] }));
      const on = renderer.captureFloatFrame();
      expect(off).not.toBeNull();
      expect(on).not.toBeNull();

      // Columns either side of the step, clear of the three its baked coverage
      // ramps over at this width (about 0.2, 0.6 and 0.98 from column 128).
      const left = (x: number) => x < W / 2 - 1;
      const right = (x: number) => x > W / 2 + 2;
      for (let p = 0; p < N; p++) {
        if (!left(p % W)) continue;
        for (let ch = 0; ch < 3; ch++) expect(on!.data[p * 4 + ch]).toBe(off!.data[p * 4 + ch]);
      }
      const s = compare(on!, off!, staged(SRC, curves, xs, mix), SRC, 0, right);
      console.log(
        `[ce-gpu] masked ${name}: darktable change rms ${s.changeRms.toExponential(2)}; ` +
          `error rms ${s.rmse.toExponential(2)} (${((100 * s.rmse) / s.changeRms).toFixed(2)}%), ` +
          `max ${s.max.toExponential(2)}, ${(100 * s.clipped).toFixed(2)}% clipped`,
      );
      expect(s.changeRms).toBeGreaterThan(1e-4);
      expect(s.clipped).toBeLessThan(0.05);
      expect(s.rmse).toBeLessThan(Math.max(s.changeRms * MAX_ERROR_FRACTION, MAX_ERROR_FLOOR));
    });
  });

  // darktable decomposes the image as edited so far. At +2 EV the chains must
  // see the exposed image: darktable's answer on it, and with edge stopping and
  // thresholds off (where the decomposition is linear) four times the change
  // at 0 EV. The scene is dimmed so +2 EV stays inside the probe's range, and
  // the open probe keeps the shoulder off the exposed values.
  it("works on the exposed image: the change keeps its proportion to it at +2 EV", () => {
    const DIM = SRC.map((v) => v * 0.4);
    const dimScene = floatImage(W, H, (x, y) => {
      const i = (y * W + x) * 3;
      return [DIM[i], DIM[i + 1], DIM[i + 2]];
    });
    const flat = cases.find(([n]) => n === "clarity (flat)")!;
    const boost = cases.find(([n]) => n === "coarse luma + chroma boost")!;
    const stages = [...builtinStages(), ...allChainStages()];
    withRenderer({ stages, pipeline: OPEN_PROBE }, (renderer) => {
      renderer.setImage(dimScene);
      const frames = (exposure: number, curves: Curves, mix: number) => {
        renderer.setParams(identityParams({ processVersion: CURRENT_PROCESS_VERSION, exposure }));
        renderer.setContributedParams(deriveAll(defaultCurves(), xs, DEFAULT_MIX));
        const off = renderer.captureFloatFrame();
        renderer.setContributedParams(deriveAll(curves, xs, mix));
        const on = renderer.captureFloatFrame();
        expect(off).not.toBeNull();
        expect(on).not.toBeNull();
        return { on: on!, off: off! };
      };

      const exposed = DIM.map((v) => v * 4);
      const [name, curves, mix] = boost;
      const at2 = frames(2, curves, mix);
      const s = compare(at2.on, at2.off, staged(exposed, curves, xs, mix), exposed);
      console.log(
        `[ce-gpu] +2 EV ${name}: darktable change rms ${s.changeRms.toExponential(2)}; ` +
          `error rms ${s.rmse.toExponential(2)} (${((100 * s.rmse) / s.changeRms).toFixed(2)}%), ` +
          `max ${s.max.toExponential(2)}, ${(100 * s.clipped).toFixed(2)}% clipped`,
      );
      expect(s.changeRms).toBeGreaterThan(1e-4);
      expect(s.clipped).toBeLessThan(0.05);
      expect(s.rmse).toBeLessThan(Math.max(s.changeRms * MAX_ERROR_FRACTION, MAX_ERROR_FLOOR));

      const [, flatCurves, flatMix] = flat;
      const zero = frames(0, flatCurves, flatMix);
      const two = frames(2, flatCurves, flatMix);
      let se = 0;
      let change = 0;
      for (let p = 0; p < N; p++) {
        for (let ch = 0; ch < 3; ch++) {
          const i = p * 4 + ch;
          const want = 4 * (zero.on.data[i] - zero.off.data[i]);
          se += (two.on.data[i] - two.off.data[i] - want) ** 2;
          change += want ** 2;
        }
      }
      const ratio = Math.sqrt(se / change);
      console.log(`[ce-gpu] change/lin at +2 EV vs 0 EV, clarity (flat): ${(100 * ratio).toFixed(2)}% rms apart`);
      expect(change).toBeGreaterThan(0);
      expect(ratio).toBeLessThan(MAX_ERROR_FRACTION);
    });
  });

  // Version 1 photos keep the look they were edited with: the chains decompose
  // the decode, so at +1 EV the change is the one the untouched photo gets.
  // Version 2's change at +1 EV, twice that, is the control. The boost takes
  // dark pixels below black, which the output capture holds at 0, and how many
  // it holds there depends on the exposure; the scene capture is read signed,
  // and values a frame holds at or below black are left out wherever version 1
  // itself clips them.
  it("decomposes the decode on version 1, whatever the exposure", () => {
    const DIM = SRC.map((v) => v * 0.4);
    const dimScene = floatImage(W, H, (x, y) => {
      const i = (y * W + x) * 3;
      return [DIM[i], DIM[i + 1], DIM[i + 2]];
    });
    const [, curves, mix] = cases.find(([n]) => n === "coarse luma + chroma boost")!;
    const stages = [...builtinStages(), ...allChainStages()];
    const change = (processVersion: number, exposure: number) =>
      withRenderer({ stages, pipeline: OPEN_PROBE }, (renderer) => {
        renderer.setImage(dimScene);
        renderer.setParams(identityParams({ processVersion, exposure }));
        renderer.setContributedParams(deriveAll(defaultCurves(), xs, DEFAULT_MIX));
        renderer.render();
        const off = renderer.readFloatFrame("scene");
        renderer.setContributedParams(deriveAll(curves, xs, mix));
        renderer.render();
        const on = renderer.readFloatFrame("scene");
        expect(off).not.toBeNull();
        expect(on).not.toBeNull();
        const d = new Float64Array(N * 3);
        for (let p = 0; p < N; p++) for (let ch = 0; ch < 3; ch++) d[p * 3 + ch] = on!.data[p * 4 + ch] - off!.data[p * 4 + ch];
        const black = new Uint8Array(N * 3);
        for (let p = 0; p < N; p++) for (let ch = 0; ch < 3; ch++) if (on!.data[p * 4 + ch] <= 0) black[p * 3 + ch] = 1;
        return { d, black, belowBlack: black.reduce((n, b) => n + b, 0) };
      });
    const apart = (a: Float64Array, b: Float64Array, keep: (i: number) => boolean = () => true) => {
      let se = 0;
      let sum = 0;
      for (let i = 0; i < a.length; i++) {
        if (!keep(i)) continue;
        se += (a[i] - b[i]) ** 2;
        sum += b[i] ** 2;
      }
      return Math.sqrt(se / sum);
    };
    const untouched = change(1, 0);
    const exposed = change(1, 1);
    const v2 = change(CURRENT_PROCESS_VERSION, 1);
    const unclipped = (i: number) => untouched.black[i] === 0 && exposed.black[i] === 0;
    const all = apart(exposed.d, untouched.d);
    const same = apart(exposed.d, untouched.d, unclipped);
    const control = apart(v2.d, untouched.d, unclipped);
    console.log(
      `[ce-gpu] version 1 at +1 EV against 0 EV: ${(100 * same).toFixed(2)}% rms apart unclipped, ${(100 * all).toFixed(2)}% in all; ` +
        `version 2 at +1 EV: ${(100 * control).toFixed(2)}%; values at or below black ${untouched.belowBlack} at 0 EV, ${exposed.belowBlack} at +1 EV`,
    );
    expect(untouched.belowBlack).toBeLessThan(N * 0.3);
    expect(same).toBeLessThan(MAX_ERROR_FRACTION);
    expect(control).toBeGreaterThan(0.5);
  });
});

// ── Render size ──────────────────────────────────────────────────────────────
//
// The passes run at the render's cap of the decode: an edited thumbnail at
// ~960 px, Develop at 4096, an export at the full long edge. A level is 2^j
// pixels of the decode at all of them, so a 2048 px decode drawn whole and
// capped to 512 px must give the same change once the 2048 px one is
// box-averaged down (the cap's own resampling). Levels finer than a 512 px
// texel fade out there; the curve lifts the coarse and middle levels, which
// both sizes hold.

describe("Contrast Equalizer at every render size", () => {
  it("gives a 512 px render the change of a full-size one, resampled", () => {
    const FW = 2048;
    const FH = 1024;
    const S = 4;
    const pattern = (x: number, y: number) => {
      const u = x / FW;
      const v = y / FH;
      let l = 0.12 + 0.05 * Math.sin(2 * Math.PI * u * 3) + 0.03 * Math.sin(2 * Math.PI * (u * 9 + v * 4));
      l += 0.02 * Math.sin(2 * Math.PI * u * 23) * Math.cos(2 * Math.PI * v * 11);
      l += 0.06 / (1 + Math.exp(-(u - 0.62 + 0.1 * Math.sin(v * 5)) * 200));
      return l;
    };
    const decode = floatImage(FW, FH, (x, y) => {
      const l = pattern(x, y);
      return [l, l, l];
    });
    const curves = defaultCurves();
    curves.L = [0.75, 0.7, 0.62, 0.55, 0.5, 0.5];
    const stages = [...builtinStages(), ...allChainStages()];
    const change = (maxEdge: number) =>
      withRenderer({ stages, pipeline: LINEAR_PROBE_PIPELINE }, (renderer) => {
        renderer.setImage(decode, maxEdge);
        renderer.setParams(identityParams({ processVersion: CURRENT_PROCESS_VERSION }));
        renderer.setContributedParams(deriveAll(defaultCurves(), xs, DEFAULT_MIX));
        const off = renderer.captureFloatFrame();
        renderer.setContributedParams(deriveAll(curves, xs, DEFAULT_MIX));
        const on = renderer.captureFloatFrame();
        expect(off).not.toBeNull();
        expect(on).not.toBeNull();
        expect(on!.width).toBe(maxEdge);
        const d = new Float64Array(on!.width * on!.height);
        for (let p = 0; p < d.length; p++) d[p] = on!.data[p * 4 + 1] - off!.data[p * 4 + 1];
        return d;
      });
    const full = change(FW);
    const capped = change(FW / S);
    const cw = FW / S;
    const ch = FH / S;
    let se = 0;
    let sum = 0;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        let want = 0;
        for (let dy = 0; dy < S; dy++) {
          for (let dx = 0; dx < S; dx++) want += full[(y * S + dy) * FW + x * S + dx] / (S * S);
        }
        se += (capped[y * cw + x] - want) ** 2;
        sum += want ** 2;
      }
    }
    const rel = Math.sqrt(se / sum);
    console.log(`[ce-gpu] ${cw} px vs ${FW} px resampled: change rms ${Math.sqrt(sum / (cw * ch)).toExponential(2)}, ${(100 * rel).toFixed(2)}% apart`);
    expect(sum).toBeGreaterThan(0);
    expect(rel).toBeLessThan(0.06);
  });

  // Version 1 photos keep the look they were edited with: level j steps 2^j
  // pass texels whatever the decode's size, so a decode capped to 512 px gets
  // the change a 512 px decode of the same pattern gets. Version 2 on the same
  // capped decode is the control: it anchors the levels to the decode, so it
  // must part from version 1 by far more.
  it("keeps version 1's levels in pass texels at a capped size", () => {
    const FW = 2048;
    const FH = 1024;
    const S = 4;
    const pattern = (x: number, y: number) => {
      const u = x / FW;
      const v = y / FH;
      let l = 0.12 + 0.05 * Math.sin(2 * Math.PI * u * 3) + 0.03 * Math.sin(2 * Math.PI * (u * 9 + v * 4));
      l += 0.02 * Math.sin(2 * Math.PI * u * 23) * Math.cos(2 * Math.PI * v * 11);
      l += 0.06 / (1 + Math.exp(-(u - 0.62 + 0.1 * Math.sin(v * 5)) * 200));
      return l;
    };
    const decode = floatImage(FW, FH, (x, y) => {
      const l = pattern(x, y);
      return [l, l, l];
    });
    const small = floatImage(FW / S, FH / S, (x, y) => {
      let l = 0;
      for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) l += pattern(x * S + dx, y * S + dy) / (S * S);
      return [l, l, l];
    });
    const curves = defaultCurves();
    curves.L = [0.75, 0.7, 0.62, 0.55, 0.5, 0.5];
    const stages = [...builtinStages(), ...allChainStages()];
    const change = (image: ReturnType<typeof floatImage>, processVersion: number) =>
      withRenderer({ stages, pipeline: LINEAR_PROBE_PIPELINE }, (renderer) => {
        renderer.setImage(image, FW / S);
        renderer.setParams(identityParams({ processVersion }));
        renderer.setContributedParams(deriveAll(defaultCurves(), xs, DEFAULT_MIX));
        const off = renderer.captureFloatFrame();
        renderer.setContributedParams(deriveAll(curves, xs, DEFAULT_MIX));
        const on = renderer.captureFloatFrame();
        expect(off).not.toBeNull();
        expect(on).not.toBeNull();
        expect(on!.width).toBe(FW / S);
        const d = new Float64Array(on!.width * on!.height);
        for (let p = 0; p < d.length; p++) d[p] = on!.data[p * 4 + 1] - off!.data[p * 4 + 1];
        return d;
      });
    const apart = (a: Float64Array, b: Float64Array) => {
      let se = 0;
      let sum = 0;
      for (let i = 0; i < a.length; i++) {
        se += (a[i] - b[i]) ** 2;
        sum += b[i] ** 2;
      }
      return Math.sqrt(se / sum);
    };
    const v1Capped = change(decode, 1);
    const v1Small = change(small, 1);
    const v2Capped = change(decode, CURRENT_PROCESS_VERSION);
    const same = apart(v1Capped, v1Small);
    const control = apart(v2Capped, v1Capped);
    console.log(
      `[ce-gpu] version 1, ${FW / S} px capped vs a ${FW / S} px decode: ${(100 * same).toFixed(2)}% apart; ` +
        `version 2 capped: ${(100 * control).toFixed(2)}% apart`,
    );
    expect(same).toBeLessThan(0.06);
    expect(control).toBeGreaterThan(0.2);
  });
});

// ── At photo size ────────────────────────────────────────────────────────────
//
// The 256 px scene above can't exercise the coarse end: level 7 samples 128 and
// 256 px out, so almost every tap lands on the clamped border. Develop runs the
// prepass at the 4096 px cap, where level 7 spans about an eighth of the frame.
// A bright beach scene there, lifted at the coarse end, against darktable's
// luma lane (a luma-only curve leaves the chroma chains idle, and eaw.c's luma
// weights read luma alone, so the luma lane is the whole reference).

const PW = 4096;
const PH = 2734;
const PN = PW * PH;

function beachLuma(): Float32Array {
  const img = new Float32Array(PN);
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++) {
      const u = x / PW;
      const v = y / PH;
      let val: number;
      if (v < 0.4) val = 0.45 + 0.15 * (1 - v / 0.4) + 0.08 * Math.sin(u * 3.1);
      else if (v < 0.6) {
        val = 0.12 + 0.04 * Math.sin(u * 9 + v * 30);
        const surf = Math.exp(-(((v - 0.55 - 0.02 * Math.sin(u * 7)) / 0.012) ** 2));
        val += 0.75 * surf * (0.6 + 0.4 * Math.sin(u * 23));
      } else val = 0.32 + 0.1 * Math.sin(u * 2.3 + 1) * (v - 0.6) + 0.05 * (1 - u);
      val = val * (0.85 + 0.15 * Math.cos((u - 0.5) * 2)) + 0.01 * (rnd() - 0.5);
      // Halved so the lifted result stays inside the probe pipeline's [0, 1].
      img[y * PW + x] = Math.max(0.002, val) * 0.5;
    }
  }
  return img;
}

function eawLuma(src: Float32Array, mult: number, sharp: number): Float32Array {
  const out = new Float32Array(PN);
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++) {
      const c = src[y * PW + x];
      let sum = 0;
      let wsum = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const row = clampi(y + dy * mult, 0, PH - 1) * PW;
        for (let dx = -2; dx <= 2; dx++) {
          const s = src[row + clampi(x + dx * mult, 0, PW - 1)];
          const d = c - s;
          const w = B3(dx) * B3(dy) * Math.exp(-sharp * d * d);
          sum += w * s;
          wsum += w;
        }
      }
      out[y * PW + x] = wsum > 0 ? sum / wsum : c;
    }
  }
  return out;
}

/** darktable's luma change (linear units) for a luma-only curve set. */
function lumaChange(src: Float32Array, curves: Curves, xs: CurveXs): Float32Array {
  const at = (ch: keyof Curves, t: number) => {
    const m = applyMix(ch, xs[ch], curves[ch], 1);
    return evalCurve(m.xs, m.ys, t);
  };
  const change = new Float32Array(PN);
  let coarse = src.map((v) => v * 100);
  for (let s = 0; s < DT_SCALES; s++) {
    const t = octaveT(s);
    const L = at("L", t);
    const gain = 4 * L * L - 1;
    // A level with no gain still has to be decomposed for the next one.
    const blurred = eawLuma(coarse, 1 << s, 0.0025 * at("s", t));
    if (gain !== 0) for (let p = 0; p < PN; p++) change[p] += (gain * (coarse[p] - blurred[p])) / 100;
    coarse = blurred;
  }
  return change;
}

describe("Contrast Equalizer at photo size", () => {
  const SRC_L = beachLuma();
  const PHOTO = floatImage(PW, PH, (x, y) => {
    const l = SRC_L[y * PW + x];
    return [l, l, l];
  });

  const photoCases: [string, Curves][] = [];
  {
    // The leftmost node lifted to the top; the drag's pull raises the next one.
    const c = defaultCurves();
    c.L = [1, 0.62, 0.5, 0.5, 0.5, 0.5];
    photoCases.push(["coarse end lifted", c]);
  }
  {
    const c = defaultCurves();
    c.L = [0.5, 0.5, 0.8, 0.8, 0.5, 0.5];
    photoCases.push(["middle lifted", c]);
  }

  // Enough other active prepass stages to push the program onto the layered
  // results path, as a large extension set does.
  const crowd = Array.from({ length: 12 }, (_, i) => markerStage(i, 0));

  for (const [label, extra] of [["alone", []], ["among 12 other prepass stages", crowd]] as const) {
    it(`matches darktable's luma change at the coarse end and the middle, ${label}`, () => {
      const stages = [...builtinStages(), ...allChainStages(), ...extra];
      withRenderer({ stages, pipeline: LINEAR_PROBE_PIPELINE }, (renderer) => {
        renderer.setImage(PHOTO, 4096);
        renderer.setParams(identityParams({ processVersion: 2 }));
        const base = { ...takingStages(extra), ...deriveAll(defaultCurves(), xs, DEFAULT_MIX) };
        renderer.setContributedParams(base);
        const off = renderer.captureFloatFrame();
        expect(off).not.toBeNull();
        expect(off!.width).toBe(PW);
        expect(off!.height).toBe(PH);

        for (const [name, curves] of photoCases) {
          renderer.setContributedParams({ ...base, ...deriveAll(curves, xs, DEFAULT_MIX) });
          const t0 = performance.now();
          const on = renderer.captureFloatFrame();
          const ms = performance.now() - t0;
          expect(on).not.toBeNull();
          const ref = lumaChange(SRC_L, curves, xs);
          let se = 0;
          let change = 0;
          let n = 0;
          for (let p = 0; p < PN; p++) {
            const want = SRC_L[p] + ref[p];
            if (want < CLIP_LO || want > CLIP_HI) continue;
            const got = on!.data[p * 4 + 1] - off!.data[p * 4 + 1];
            se += (got - ref[p]) ** 2;
            change += ref[p] ** 2;
            n++;
          }
          const rmse = Math.sqrt(se / n);
          const changeRms = Math.sqrt(change / n);
          console.log(
            `[ce-gpu] photo ${label}, ${name}: ${ms.toFixed(0)} ms; darktable change rms ${changeRms.toExponential(2)}; ` +
              `error rms ${rmse.toExponential(2)} (${((100 * rmse) / changeRms).toFixed(2)}%), ${PN - n} clipped`,
          );
          expect(changeRms).toBeGreaterThan(1e-3);
          expect(rmse).toBeLessThan(changeRms * MAX_ERROR_FRACTION);
        }
      });
    });
  }
});
