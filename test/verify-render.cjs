// CPU verification of the GPU design against darktable.
//
// `reference` is darktable's atrous.c/eaw.c restricted to our working domain
// (linear RGB split into achromatic luma + chroma, luma on a 0..100 scale):
// eight à trous levels decomposed in one chain, each detail boosted and
// soft-cored, the residual added back. `ours` mirrors the pass GLSL in
// src/wavelet.ts statement for statement — three chains that each carry their
// coarse level and the running change through the eight levels — so the two
// must agree to float precision for ANY curve, not just flat ones. The
// Lab-vs-linear space difference is a documented adaptation and is not what
// this file tests.
const path = require("path");
const M = require(path.join(__dirname, ".build", "model.js"));

const W = 256, H = 256, N = W * H;
const LR = 0.2126, LG = 0.7152, LB = 0.0722;
const lum = (r, g, b) => r * LR + g * LG + b * LB;
const B3 = (d) => (d === 0 ? 0.375 : Math.abs(d) === 1 ? 0.25 : 0.0625);
const clampi = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const LEVELS = Array.from({ length: M.DT_SCALES }, (_, j) => j);

// Synthetic scene, deliberately DARK (most pixels below linear 0.214 = sRGB
// 0.5): broad low-frequency light falloff for the coarse octaves, mid-scale
// blobs, fine texture, hard edges, a bright window, a saturated patch.
function makeImage() {
  const img = new Float64Array(N * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const u = x / W, v = y / H;
      let base = 0.03 + 0.14 * Math.exp(-((u - 0.35) ** 2 + (v - 0.4) ** 2) * 2.2);
      base += 0.03 * Math.sin(2 * Math.PI * u) * Math.sin(2 * Math.PI * v);
      base += 0.05 * Math.exp(-((u - 0.7) ** 2 + (v - 0.65) ** 2) * 40);
      base += 0.04 * Math.sin(12 * Math.PI * u + 3 * Math.sin(6 * v)) * Math.exp(-((v - 0.3) ** 2) * 12);
      base += 0.015 * Math.sin(60 * Math.PI * u) * Math.sin(52 * Math.PI * v + u * 9);
      let r = base, g = base * 0.96, b = base * 1.05;
      if (x > 150 && x < 190 && y > 40 && y < 96) { r += 0.55; g += 0.5; b += 0.42; }
      const dx = (x - 90) / 34, dy = (y - 170) / 26;
      if (dx * dx + dy * dy < 1) { r *= 0.25; g *= 0.28; b *= 0.35; }
      if (x > 40 && x < 78 && y > 60 && y < 92) { r += 0.1; b *= 0.6; }
      img[i] = Math.max(0, r); img[i + 1] = Math.max(0, g); img[i + 2] = Math.max(0, b);
    }
  }
  return img;
}

// ── darktable ────────────────────────────────────────────────────────────────

// One edge-aware à trous step on a 3-channel image, exactly eaw.c: 25-tap B3,
// dilation `mult`, clamp-to-edge, luma weight exp(-s·ΔL²), chroma weight
// exp(-s·|Δab|²), per-channel-group normalisation.
function eawBlur(src, mult, sharp) {
  const out = new Float64Array(N * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const Lc = lum(src[i], src[i + 1], src[i + 2]);
      const a0 = (src[i] - Lc) * 100, a1 = (src[i + 1] - Lc) * 100, a2 = (src[i + 2] - Lc) * 100;
      const Lc100 = Lc * 100;
      let sumL = 0, wL = 0, s0 = 0, s1 = 0, s2 = 0, wC = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const sy = clampi(y + dy * mult, 0, H - 1);
        for (let dx = -2; dx <= 2; dx++) {
          const sx = clampi(x + dx * mult, 0, W - 1);
          const j = (sy * W + sx) * 3;
          const Ls = lum(src[j], src[j + 1], src[j + 2]);
          const Ls100 = Ls * 100;
          const b0 = (src[j] - Ls) * 100, b1 = (src[j + 1] - Ls) * 100, b2 = (src[j + 2] - Ls) * 100;
          const f = B3(dx) * B3(dy);
          const dL = Lc100 - Ls100;
          const wl = Math.exp(-sharp * dL * dL);
          const d0 = a0 - b0, d1 = a1 - b1, d2 = a2 - b2;
          const wc = Math.exp(-sharp * (d0 * d0 + d1 * d1 + d2 * d2));
          const fwl = f * wl, fwc = f * wc;
          sumL += fwl * Ls100; wL += fwl;
          s0 += fwc * b0; s1 += fwc * b1; s2 += fwc * b2; wC += fwc;
        }
      }
      const cl = (wL > 0 ? sumL / wL : Lc100) / 100;
      const c0 = (wC > 0 ? s0 / wC : a0) / 100;
      const c1 = (wC > 0 ? s1 / wC : a1) / 100;
      const c2 = (wC > 0 ? s2 / wC : a2) / 100;
      out[i] = cl + c0; out[i + 1] = cl + c1; out[i + 2] = cl + c2;
    }
  }
  return out;
}

// darktable's accumulate(): boost + soft-core one detail plane into `out`.
function addBand(out, detail, gainL, gainC, thrL, thrC) {
  for (let i = 0; i < N * 3; i += 3) {
    const dL = lum(detail[i], detail[i + 1], detail[i + 2]);
    const dC0 = detail[i] - dL, dC1 = detail[i + 1] - dL, dC2 = detail[i + 2] - dL;
    const dL100 = dL * 100;
    const coreL = Math.sign(dL100) * Math.max(Math.abs(dL100) - thrL, 0) / 100;
    const cmag = Math.hypot(dC0, dC1, dC2) * 100;
    const fac = cmag > 1e-5 ? Math.max(cmag - thrC, 0) / cmag : 1;
    const addL = (1 + gainL) * coreL;
    out[i] += addL + (1 + gainC) * dC0 * fac;
    out[i + 1] += addL + (1 + gainC) * dC1 * fac;
    out[i + 2] += addL + (1 + gainC) * dC2 * fac;
  }
}

const octaveT = (o) => 1 - (o + 0.5) / M.DT_SCALES;
const curveAt = (curves, xs, ch, t) => M.evalCurve(xs[ch], curves[ch], t);

// Typed from atrous.c commit_params — independent of model.levelCoeffs.
function coeffsAt(curves, xs, t) {
  const L = curveAt(curves, xs, "L", t), c = curveAt(curves, xs, "c", t);
  const Lt = curveAt(curves, xs, "Lt", t), ct = curveAt(curves, xs, "ct", t);
  const atten = Math.pow(2, -7 * (1 - t));
  return {
    gainL: 4 * L * L - 1, gainC: 4 * c * c - 1,
    thrL: atten * 10 * Lt, thrC: atten * 20 * ct,
    sharp: 0.0025 * curveAt(curves, xs, "s", t),
  };
}

// All eight octaves decomposed in one chain, each detail boosted/cored into a
// zeroed accumulator, residue added back. Curves are taken as given (mix must
// already be folded in).
function reference(src, curves, xs) {
  const out = new Float64Array(N * 3);
  let coarse = src;
  for (const s of LEVELS) {
    const k = coeffsAt(curves, xs, octaveT(s));
    const next = eawBlur(coarse, 1 << s, k.sharp);
    const d = new Float64Array(N * 3);
    for (let i = 0; i < N * 3; i++) d[i] = coarse[i] - next[i];
    addBand(out, d, k.gainL, k.gainC, k.thrL, k.thrC);
    coarse = next;
  }
  for (let i = 0; i < N * 3; i++) out[i] += coarse[i];
  return out;
}

// ── the shipped design (src/wavelet.ts) ─────────────────────────────────────

// Luma chain, per pass j: 25-tap edge-aware blur of the carried coarse luma,
// detail = coarse − blurred, running change += ((1+gain)·core(detail) −
// detail), then carry the blurred level on. Values on the 0..100 scale inside,
// stored linear.
function lumaChain(src, gains, thrs, sharps) {
  let coarse = new Float64Array(N);
  for (let i = 0; i < N; i++) coarse[i] = lum(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
  const acc = new Float64Array(N);
  for (const j of LEVELS) {
    const mult = 1 << j;
    const next = new Float64Array(N);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const Lc = coarse[y * W + x] * 100;
        let sum = 0, wsum = 0;
        for (let dy = -2; dy <= 2; dy++) {
          const sy = clampi(y + dy * mult, 0, H - 1);
          for (let dx = -2; dx <= 2; dx++) {
            const sx = clampi(x + dx * mult, 0, W - 1);
            const Ls = coarse[sy * W + sx] * 100;
            const dL = Lc - Ls;
            const w = B3(dx) * B3(dy) * Math.exp(-sharps[j] * dL * dL);
            sum += w * Ls; wsum += w;
          }
        }
        const blurred = wsum > 0 ? sum / wsum : Lc;
        const d = Lc - blurred;
        const core = Math.sign(d) * Math.max(Math.abs(d) - thrs[j], 0);
        acc[y * W + x] += ((1 + gains[j]) * core - d) * 0.01;
        next[y * W + x] = blurred * 0.01;
      }
    }
    coarse = next;
  }
  return acc;
}

// The zero-luma chroma vector from its (R−L, B−L) coordinates.
const chroma3 = (a, b) => [a, -(LR * a + LB * b) / LG, b];

// Chroma chain accumulating coordinate `comp` (0 = R−L, 1 = B−L); the coarse
// (R−L, B−L) pair rides along and is identical in both chroma chains.
function chromaChain(src, comp, gains, thrs, sharps) {
  let ca = new Float64Array(N), cb = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const L = lum(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
    ca[i] = src[i * 3] - L; cb[i] = src[i * 3 + 2] - L;
  }
  const acc = new Float64Array(N);
  for (const j of LEVELS) {
    const mult = 1 << j;
    const na = new Float64Array(N), nb = new Float64Array(N);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        const aC = ca[p] * 100, bC = cb[p] * 100;
        const c3 = chroma3(aC, bC);
        let sa = 0, sb = 0, wsum = 0;
        for (let dy = -2; dy <= 2; dy++) {
          const sy = clampi(y + dy * mult, 0, H - 1);
          for (let dx = -2; dx <= 2; dx++) {
            const q = sy * W + clampi(x + dx * mult, 0, W - 1);
            const aS = ca[q] * 100, bS = cb[q] * 100;
            const s3 = chroma3(aS, bS);
            const d0 = c3[0] - s3[0], d1 = c3[1] - s3[1], d2 = c3[2] - s3[2];
            const w = B3(dx) * B3(dy) * Math.exp(-sharps[j] * (d0 * d0 + d1 * d1 + d2 * d2));
            sa += w * aS; sb += w * bS; wsum += w;
          }
        }
        const blurredA = wsum > 0 ? sa / wsum : aC;
        const blurredB = wsum > 0 ? sb / wsum : bC;
        const da = aC - blurredA, db = bC - blurredB;
        const d3 = chroma3(da, db);
        const mag = Math.hypot(d3[0], d3[1], d3[2]);
        const fac = mag > 1e-5 ? Math.max(mag - thrs[j], 0) / mag : 1;
        const dX = comp === 0 ? da : db;
        acc[p] += ((1 + gains[j]) * fac * dX - dX) * 0.01;
        na[p] = blurredA * 0.01; nb[p] = blurredB * 0.01;
      }
    }
    ca = na; cb = nb;
  }
  return acc;
}

// The three chains + the inline blocks: luma change is achromatic, each chroma
// change is applied as the zero-luma vector of that coordinate.
function ours(src, curves, xs, mix) {
  const k = LEVELS.map((j) => M.levelCoeffs(curves, xs, j, mix));
  const sharps = M.sharps(curves, xs, mix);
  const dL = lumaChain(src, k.map((c) => c.gainL), k.map((c) => c.thrL), sharps);
  const dA = chromaChain(src, 0, k.map((c) => c.gainC), k.map((c) => c.thrC), sharps);
  const dB = chromaChain(src, 1, k.map((c) => c.gainC), k.map((c) => c.thrC), sharps);
  const out = Float64Array.from(src);
  for (let i = 0; i < N; i++) {
    const a = chroma3(dA[i], 0);
    const b = chroma3(0, dB[i]);
    out[i * 3] += dL[i] + a[0] + b[0];
    out[i * 3 + 1] += dL[i] + a[1] + b[1];
    out[i * 3 + 2] += dL[i] + a[2] + b[2];
  }
  return out;
}

const rmse = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) * (a[i] - b[i]);
  return Math.sqrt(s / a.length);
};
const maxAbs = (a, b) => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

// Fold mix into a curve set the way commit_params does, for the reference.
function mixed(curves, xs, mix) {
  const c = {}, x = {};
  for (const ch of ["L", "c", "s", "Lt", "ct"]) {
    const r = M.applyMix(ch, xs[ch], curves[ch], mix);
    c[ch] = r.ys; x[ch] = r.xs;
  }
  return { curves: c, xs: x };
}

let fails = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails++;
};

const src = makeImage();
const xs = M.defaultXs();
const EXACT = 1e-12;

// 1. Neutral curve is an exact identity.
{
  const out = ours(src, M.defaultCurves(), xs, 1);
  const m = maxAbs(out, src);
  check("identity at neutral curve", m === 0, `max |Δ| = ${m.toExponential(2)}`);
}

// 2. Every curve shape reproduces darktable's eight-octave answer to float
//    precision: sloped boosts, a denoise ramp, darktable's clarity, a fine
//    deblur-style sharpen with noise floors, chroma-only work, and moved nodes.
const cases = [];
{
  const c = M.defaultCurves();
  c.L = [0.62, 0.68, 0.62, 0.54, 0.5, 0.5];
  c.c = [0.5, 0.56, 0.54, 0.5, 0.5, 0.5];
  cases.push(["coarse luma + chroma boost", c, xs]);
}
{
  const c = M.defaultCurves();
  c.Lt = [0, 1 / 30, 1 / 15, 0.1, 2 / 15, 1 / 6];
  c.ct = [0, 0.05, 0.1, 0.15, 0.2, 0.25];
  cases.push(["denoise ramp", c, xs]);
}
{
  const c = M.defaultCurves();
  c.L = c.L.map(() => 0.6);
  c.c = c.c.map(() => 0.55);
  c.s = c.s.map(() => 0);
  cases.push(["clarity (flat)", c, xs]);
}
{
  const c = M.defaultCurves();
  c.L = [0.5, 0.5, 0.52, 0.6, 0.75, 0.9];
  c.s = [0.5, 0.5, 0.55, 0.7, 0.85, 1];
  c.Lt = [0, 0, 0.02, 0.05, 0.1, 0.15];
  cases.push(["fine sharpen with noise floor", c, xs]);
}
{
  const c = M.defaultCurves();
  c.c = [0.3, 0.35, 0.5, 0.7, 0.8, 0.8];
  c.ct = [0.1, 0.1, 0.05, 0, 0, 0];
  cases.push(["chroma only, cut coarse / boost fine", c, xs]);
}
{
  const c = M.defaultCurves();
  c.L = [0.4, 0.7, 0.45, 0.65, 0.5, 0.55];
  const x = M.defaultXs();
  x.L = [0, 0.1, 0.35, 0.5, 0.9, 1];
  x.Lt = [...x.L];
  cases.push(["moved node positions", c, x]);
}
for (const [name, curves, cx] of cases) {
  const ref = reference(src, curves, cx);
  const out = ours(src, curves, cx, 1);
  const e = rmse(out, ref);
  check(`matches darktable — ${name}`, e < EXACT, `rmse ${e.toExponential(2)}, max ${maxAbs(out, ref).toExponential(2)}`);
}

// 3. Mix scales node positions and values toward the defaults before the
//    spline (darktable's _apply_mix); mix 0 is an identity.
{
  const [, curves, cx] = cases[0];
  const m = mixed(curves, cx, 0.4);
  const ref = reference(src, m.curves, m.xs);
  const out = ours(src, curves, cx, 0.4);
  const e = rmse(out, ref);
  check("mix folds in before the spline", e < EXACT, `rmse ${e.toExponential(2)}`);
  const zero = maxAbs(ours(src, curves, cx, 0), src);
  check("mix 0 is an identity", zero === 0, `max |Δ| = ${zero.toExponential(2)}`);
}

// 4. The effect is real: the clarity preset lifts local contrast on this scene.
{
  const [, curves] = cases[2];
  const out = ours(src, curves, xs, 1);
  const e = rmse(out, src);
  check("clarity changes the image", e > 1e-3, `rmse vs source ${e.toExponential(2)}`);
}

console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL RENDER CHECKS PASS");
process.exit(fails ? 1 : 0);
