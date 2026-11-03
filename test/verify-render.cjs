// CPU verification of the GPU design against darktable.
//
// `reference` is darktable's atrous.c/eaw.c restricted to our working domain
// (linear RGB split into achromatic luma + chroma, luma on a 0..100 scale):
// eight à trous levels decomposed in one chain, each detail boosted and
// soft-cored, the residual added back. `ours` mirrors the pass GLSL in
// src/wavelet.ts statement for statement — three chains that each carry their
// coarse level and the running change through the eight levels, at the
// level's step in decode pixels, each reading the image as the chains before
// it left it — so the two must agree to float precision for ANY curve, chain
// by chain, not just flat ones. The Lab-vs-linear space difference is a
// documented adaptation and is not what this file tests.
const path = require("path");
const M = require(path.join(__dirname, ".build", "model.js"));
const WAV = require(path.join(__dirname, ".build", "wavelet.js"));

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

// darktable run the way the stages run it: each chain is its own stage that
// reads the image as the stages before it left it. The luma and R−L changes
// come from darktable on the image itself (the achromatic luma change leaves
// chroma as it was); the B−L change from darktable on the image holding both.
function staged(src, curves, xs) {
  const first = reference(src, curves, xs);
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
  const second = reference(mid, curves, xs);
  const out = Float64Array.from(mid);
  for (let p = 0; p < N; p++) {
    const i = p * 3;
    const dB = second[i + 2] - lum(second[i], second[i + 1], second[i + 2]) - (mid[i + 2] - lum(mid[i], mid[i + 1], mid[i + 2]));
    out[i + 1] -= dB * (LB / LG);
    out[i + 2] += dB;
  }
  return out;
}

// ── the shipped design (src/wavelet.ts) ─────────────────────────────────────

// A plane read the way the GPU reads the LINEAR / CLAMP_TO_EDGE ping-pong
// targets: bilinear between texel centres, held at the edge texel. Integer
// positions return the texel exactly.
function bilinear(plane, w, h, px, py) {
  const x0 = Math.floor(px), y0 = Math.floor(py);
  const fx = px - x0, fy = py - y0;
  const cx0 = clampi(x0, 0, w - 1), cx1 = clampi(x0 + 1, 0, w - 1);
  const cy0 = clampi(y0, 0, h - 1), cy1 = clampi(y0 + 1, 0, h - 1);
  const top = plane[cy0 * w + cx0] * (1 - fx) + plane[cy0 * w + cx1] * fx;
  const bottom = plane[cy1 * w + cx0] * (1 - fx) + plane[cy1 * w + cx1] * fx;
  return top * (1 - fy) + bottom * fy;
}

// A w×h frame drawn from a decode whose long edge is `sourceLong`.
const frame = (w, h, sourceLong = Math.max(w, h)) => ({ w, h, n: w * h, passLong: Math.max(w, h), sourceLong });
const FULL = frame(W, H);

// Luma chain, per pass j: 25-tap edge-aware blur of the carried coarse luma at
// the level's step, detail = coarse − blurred, running change += fade ·
// ((1+gain)·core(detail) − detail), then carry the blurred level on (the
// coarse level as it was, for a level faded out). Values on the 0..100 scale
// inside, stored linear.
function lumaChain(src, gains, thrs, sharps, f = FULL) {
  const { w, h, n } = f;
  let coarse = new Float64Array(n);
  for (let i = 0; i < n; i++) coarse[i] = lum(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
  const acc = new Float64Array(n);
  for (const j of LEVELS) {
    const step = M.levelStep(j, f.passLong, f.sourceLong);
    const fade = M.levelFade(step);
    const next = new Float64Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const Lc = coarse[y * w + x] * 100;
        let sum = 0, wsum = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const Ls = bilinear(coarse, w, h, x + dx * step, y + dy * step) * 100;
            const dL = Lc - Ls;
            const wt = B3(dx) * B3(dy) * Math.exp(-sharps[j] * dL * dL);
            sum += wt * Ls; wsum += wt;
          }
        }
        const blurred = fade > 0 && wsum > 0 ? sum / wsum : Lc;
        const d = Lc - blurred;
        const core = Math.sign(d) * Math.max(Math.abs(d) - thrs[j], 0);
        acc[y * w + x] += fade * ((1 + gains[j]) * core - d) * 0.01;
        next[y * w + x] = blurred * 0.01;
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
function chromaChain(src, comp, gains, thrs, sharps, f = FULL) {
  const { w, h, n } = f;
  let ca = new Float64Array(n), cb = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const L = lum(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
    ca[i] = src[i * 3] - L; cb[i] = src[i * 3 + 2] - L;
  }
  const acc = new Float64Array(n);
  for (const j of LEVELS) {
    const step = M.levelStep(j, f.passLong, f.sourceLong);
    const fade = M.levelFade(step);
    const na = new Float64Array(n), nb = new Float64Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const aC = ca[p] * 100, bC = cb[p] * 100;
        const c3 = chroma3(aC, bC);
        let sa = 0, sb = 0, wsum = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const aS = bilinear(ca, w, h, x + dx * step, y + dy * step) * 100;
            const bS = bilinear(cb, w, h, x + dx * step, y + dy * step) * 100;
            const s3 = chroma3(aS, bS);
            const d0 = c3[0] - s3[0], d1 = c3[1] - s3[1], d2 = c3[2] - s3[2];
            const wt = B3(dx) * B3(dy) * Math.exp(-sharps[j] * (d0 * d0 + d1 * d1 + d2 * d2));
            sa += wt * aS; sb += wt * bS; wsum += wt;
          }
        }
        const on = fade > 0 && wsum > 0;
        const blurredA = on ? sa / wsum : aC;
        const blurredB = on ? sb / wsum : bC;
        const da = aC - blurredA, db = bC - blurredB;
        const d3 = chroma3(da, db);
        const mag = Math.hypot(d3[0], d3[1], d3[2]);
        const fac = mag > 1e-5 ? Math.max(mag - thrs[j], 0) / mag : 1;
        const dX = comp === 0 ? da : db;
        acc[p] += fade * ((1 + gains[j]) * fac * dX - dX) * 0.01;
        na[p] = blurredA * 0.01; nb[p] = blurredB * 0.01;
      }
    }
    ca = na; cb = nb;
  }
  return acc;
}

// What the chains read first: the decode, or the image as edited up to them.
const STAGES = WAV.allChainStages();
const readsCurrent = STAGES.every((s) => s.reads === "current");

// The three chains + the inline blocks, in stage order: luma change is
// achromatic, each chroma change is applied as the zero-luma vector of that
// coordinate. `lin` is the image as edited up to the chains (the decode itself
// by default); a chain reading the current image reads it as the chains before
// it left it, from process version 2 on. Version 1 decomposes the decode.
function ours(src, curves, xs, mix, f = FULL, lin = src, version = 2) {
  const k = LEVELS.map((j) => M.levelCoeffs(curves, xs, j, mix));
  const sharps = M.sharps(curves, xs, mix);
  const gainC = k.map((c) => c.gainC), thrC = k.map((c) => c.thrC);
  const out = Float64Array.from(lin);
  const input = () => (readsCurrent && version >= 2 ? Float64Array.from(out) : src);
  const dL = lumaChain(input(), k.map((c) => c.gainL), k.map((c) => c.thrL), sharps, f);
  for (let i = 0; i < f.n * 3; i++) out[i] += dL[(i / 3) | 0];
  for (const comp of [0, 1]) {
    const d = chromaChain(input(), comp, gainC, thrC, sharps, f);
    for (let i = 0; i < f.n; i++) {
      const v = comp === 0 ? chroma3(d[i], 0) : chroma3(0, d[i]);
      out[i * 3] += v[0];
      out[i * 3 + 1] += v[1];
      out[i * 3 + 2] += v[2];
    }
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

// `out` against darktable's `ref` for an image whose unedited state is `base`:
// to float precision when `share` is null, otherwise within that share of
// darktable's change. The chains are separate stages that each read the image
// as the ones before left it, so the B−L chain decomposes chroma that already
// holds the R−L chain's change; its edge weights and soft-coring see it. Where
// both are off (no chroma edit, or edges 0 with no chroma threshold) the answer
// is exact.
function matches(name, out, ref, base, share) {
  const e = rmse(out, ref);
  const change = rmse(ref, base);
  const ok = share === null ? e < EXACT : e < share * change;
  check(name, ok, `rmse ${e.toExponential(2)}, ${((100 * e) / change).toFixed(4)}% of the change, max ${maxAbs(out, ref).toExponential(2)}`);
}

// 2. Every curve shape reproduces darktable's eight-octave answer: sloped
//    boosts, a denoise ramp, darktable's clarity, a fine deblur-style sharpen
//    with noise floors, chroma-only work, and moved nodes.
const cases = [];
{
  const c = M.defaultCurves();
  c.L = [0.62, 0.68, 0.62, 0.54, 0.5, 0.5];
  c.c = [0.5, 0.56, 0.54, 0.5, 0.5, 0.5];
  cases.push(["coarse luma + chroma boost", c, xs, 2e-4]);
}
{
  const c = M.defaultCurves();
  c.Lt = [0, 1 / 30, 1 / 15, 0.1, 2 / 15, 1 / 6];
  c.ct = [0, 0.05, 0.1, 0.15, 0.2, 0.25];
  cases.push(["denoise ramp", c, xs, 0.05]);
}
{
  const c = M.defaultCurves();
  c.L = c.L.map(() => 0.6);
  c.c = c.c.map(() => 0.55);
  c.s = c.s.map(() => 0);
  cases.push(["clarity (flat)", c, xs, null]);
}
{
  const c = M.defaultCurves();
  c.L = [0.5, 0.5, 0.52, 0.6, 0.75, 0.9];
  c.s = [0.5, 0.5, 0.55, 0.7, 0.85, 1];
  c.Lt = [0, 0, 0.02, 0.05, 0.1, 0.15];
  cases.push(["fine sharpen with noise floor", c, xs, null]);
}
{
  const c = M.defaultCurves();
  c.c = [0.3, 0.35, 0.5, 0.7, 0.8, 0.8];
  c.ct = [0.1, 0.1, 0.05, 0, 0, 0];
  cases.push(["chroma only, cut coarse / boost fine", c, xs, 0.05]);
}
{
  const c = M.defaultCurves();
  c.L = [0.4, 0.7, 0.45, 0.65, 0.5, 0.55];
  const x = M.defaultXs();
  x.L = [0, 0.1, 0.35, 0.5, 0.9, 1];
  x.Lt = [...x.L];
  cases.push(["moved node positions", c, x, null]);
}
// Where the B−L chain's input differs, it is still darktable's answer on that
// input, chain by chain.
for (const [name, curves, cx, share] of cases) {
  const out = ours(src, curves, cx, 1);
  matches(`matches darktable — ${name}`, out, reference(src, curves, cx), src, share);
  if (share !== null) matches(`matches darktable chain by chain — ${name}`, out, staged(src, curves, cx), src, null);
}

// 3. Mix scales node positions and values toward the defaults before the
//    spline (darktable's _apply_mix); mix 0 is an identity.
{
  const [, curves, cx, share] = cases[0];
  const m = mixed(curves, cx, 0.4);
  matches("mix folds in before the spline", ours(src, curves, cx, 0.4), reference(src, m.curves, m.xs), src, share);
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

// 5. The chains work on the image as edited, as darktable's module does: at
//    +2 EV the result is darktable's on the exposed image, and with edge
//    stopping and thresholds off (where the decomposition is linear) the change
//    keeps its proportion to the image.
{
  const exposed = (k) => src.map((v) => v * k);
  // Four times the chroma makes the B−L chain's edge weights four times as
  // sensitive to the R−L change it sees.
  for (const [[name, curves, cx], share] of [[cases[0], 0.02], [cases[3], null]]) {
    const lin = exposed(4);
    const out = ours(src, curves, cx, 1, FULL, lin);
    matches(`at +2 EV matches darktable on the exposed image — ${name}`, out, reference(lin, curves, cx), lin, share);
    if (share !== null) matches(`at +2 EV matches darktable chain by chain — ${name}`, out, staged(lin, curves, cx), lin, null);
  }
  const [, clarity] = cases[2];
  const change = (k) => {
    const lin = exposed(k);
    return ours(src, clarity, xs, 1, FULL, lin).map((v, i) => v - lin[i]);
  };
  const c0 = change(1), c2 = change(4);
  const e = rmse(c2, c0.map((v) => v * 4)) / rmse(c0, new Float64Array(c0.length));
  check("change/lin ratio is the same at 0 and +2 EV", e < 1e-9, `relative rms ${e.toExponential(2)}`);
}

// 6. A level spans the same stretch of the photo at every render size: the
//    edited thumbnail and Develop draw the passes at a fraction of the decode,
//    an export at all of it. A smooth pattern drawn from a 4096 px decode at its
//    full 4096 px and capped to 1024 px, the 4096 px change box-averaged down,
//    must agree with the 1024 px change.
{
  const LW = 4096, LH = 192, S = 4;
  const fine = new Float64Array(LW * LH * 3);
  for (let y = 0; y < LH; y++) {
    for (let x = 0; x < LW; x++) {
      const u = x / LW, v = y / LH;
      let l = 0.12 + 0.05 * Math.sin(2 * Math.PI * u * 3) + 0.03 * Math.sin(2 * Math.PI * (u * 17 + v * 0.7));
      l += 0.02 * Math.sin(2 * Math.PI * u * 41) * Math.cos(2 * Math.PI * v * 1.5);
      l += 0.06 / (1 + Math.exp(-(u - 0.62) * 400));
      const i = (y * LW + x) * 3;
      fine[i] = fine[i + 1] = fine[i + 2] = l;
    }
  }
  const box = (img, w, h, ch) => {
    const bw = w / S, bh = h / S;
    const out = new Float64Array(bw * bh * ch);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < ch; c++) out[((y / S | 0) * bw + (x / S | 0)) * ch + c] += img[(y * w + x) * ch + c] / (S * S);
      }
    }
    return out;
  };
  const coarse = box(fine, LW, LH, 3);
  const curves = M.defaultCurves();
  curves.L = [0.75, 0.7, 0.62, 0.55, 0.5, 0.5];
  const k = LEVELS.map((j) => M.levelCoeffs(curves, xs, j, 1));
  const sharps = M.sharps(curves, xs, 1);
  const run = (img, f) => lumaChain(img, k.map((c) => c.gainL), k.map((c) => c.thrL), sharps, f);
  const big = box(run(fine, frame(LW, LH)), LW, LH, 1);
  const small = run(coarse, frame(LW / S, LH / S, LW));
  const e = rmse(small, big) / rmse(big, new Float64Array(big.length));
  check("1024 px and 4096 px renders agree after resampling", e < 0.1, `relative rms ${(100 * e).toFixed(2)}%`);
}

// 7. Version 1 photos keep the look they were edited with: level j steps 2^j
//    pass texels whatever the decode's size, and every level applies in full.
//    The model and the GLSL a version 1 program compiles must both say so.
{
  const { atVersion } = require("./process-version.cjs");
  const steps = LEVELS.map((j) => M.levelStep(j, 1024, 4096, 1));
  check("version 1 steps 2^j texels at any render size", steps.every((s, j) => s === 2 ** j), `steps ${steps.join(", ")}`);
  const fades = [0.25, 0.5, 1, 4].map((s) => M.levelFade(s, 1));
  check("version 1 applies every level in full", fades.every((f) => f === 1), `fades ${fades.join(", ")}`);
  check("version 2 anchors the step to the decode", M.levelStep(3, 1024, 4096, 2) === 2 && M.levelFade(0.25, 2) === 0);
  for (const stage of STAGES) {
    for (const pass of stage.passes) {
      const glsl = `${pass.helpers}\n${pass.glsl}`;
      const v1 = atVersion(glsl, 1);
      const v2 = atVersion(glsl, 2);
      check(
        `${stage.id}: version 1 GLSL steps exp2(level) texels and never fades`,
        /float ceDilation\(int level\) \{\s*return exp2\(float\(level\)\);\s*\}/.test(v1) &&
          /float ceFade\(float dilation\) \{\s*return 1\.0;\s*\}/.test(v1) &&
          !v1.includes("uSourceSize"),
      );
      check(`${stage.id}: version 2 GLSL anchors to the decode and fades`, v2.includes("uSourceSize") && v2.includes("log2(dilation)"));
      check(`${stage.id}: version 3 compiles version 2's GLSL`, atVersion(glsl, 3) === v2);
    }
  }
}

// 8. Version 1 decomposed the decode. The chains read the image as edited from
//    version 2 only, so on a version 1 photo the host hands their first draw
//    the decode, draws no split and keeps their result through upstream edits.
//    Each chain is one pass of eight draws, the same GLSL on every version but
//    for the level steps.
{
  for (const stage of STAGES) {
    check(`${stage.id}: reads the image as edited from version 2`, stage.reads === "current" && stage.readsCurrentFrom === 2);
    const [pass] = stage.passes;
    check(
      `${stage.id}: one pass of ${M.DT_SCALES} draws, reading only the previous draw`,
      stage.passes.length === 1 && pass.iterations === M.DT_SCALES && !`${pass.helpers}${pass.glsl}`.includes("readSource"),
    );
  }
  // So on version 1 the change is the decode's whatever came before: +1 EV and
  // a white balance tilt leave it as it is on the untouched photo.
  for (const [name, curves, cx] of cases) {
    const own = ours(src, curves, cx, 1, FULL, src, 1).map((v, i) => v - src[i]);
    for (const [label, lin] of [["+1 EV", src.map((v) => v * 2)], ["a white balance tilt", src.map((v, i) => v * [0.9, 1, 1.1][i % 3])]]) {
      const change = ours(src, curves, cx, 1, FULL, lin, 1).map((v, i) => v - lin[i]);
      const e = maxAbs(change, own);
      check(`version 1 keeps the decode's change at ${label} — ${name}`, e < EXACT, `max ${e.toExponential(2)}`);
    }
  }
}

console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL RENDER CHECKS PASS");
process.exit(fails ? 1 : 0);
