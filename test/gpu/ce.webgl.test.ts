// The chains on the real renderer. Run via `npm run test:gpu` (test/gpu/run.cjs
// copies this file into a SafeLight checkout and runs it under its headless
// Chromium + SwiftShader rig). Three things the CPU harness cannot check:
//
//  • every pass program compiles and links on a real GLSL ES 3.00 driver;
//  • the rendered change equals darktable's answer (the same CPU transcription
//    of atrous.c / eaw.c as test/verify-render.cjs) to half-float precision,
//    through the host's actual prepass plumbing — unit allocation, ping-pong
//    targets, the idle gate, the inline blocks;
//  • an untouched photo is a bit-exact no-op.
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
  type Frame,
  builtinStages,
  floatImage,
  identityParams,
  withRenderer,
} from "@/rendering/webgl/webgl.test-support";

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

function compare(on: Frame, off: Frame, ref: Float64Array): Comparison {
  let se = 0;
  let max = 0;
  let change = 0;
  let n = 0;
  let clipped = 0;
  for (let p = 0; p < N; p++) {
    for (let ch = 0; ch < 3; ch++) {
      const out = ref[p * 3 + ch];
      if (out < CLIP_LO || out > CLIP_HI) {
        clipped++;
        continue;
      }
      const g = on.data[p * 4 + ch] - off.data[p * 4 + ch];
      const r = out - SRC[p * 3 + ch];
      const e = g - r;
      se += e * e;
      change += r * r;
      n++;
      if (Math.abs(e) > max) max = Math.abs(e);
    }
  }
  return { rmse: Math.sqrt(se / n), changeRms: Math.sqrt(change / n), max, clipped: clipped / (N * 3) };
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
        const s = compare(on!, off!, reference(SRC, curves, xs, mix));
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
});
