// CPU verification of the Contrast Equalizer GPU design against darktable.
//
// Both sides run in the SAME domain the shader uses (linear RGB split into
// achromatic luma + chroma, luma weighted to 0..100), so this isolates the
// things that changed: the texture-unit starvation bug, the wl exponent, and
// the 4-of-8 octave sampling with pair compensation. The Lab-vs-linear space
// difference is a documented adaptation and is NOT what this file tests.
//
// Reference: darktable atrous.c get_scales/process + eaw.c
// eaw_decompose_and_synthesize, i0 = 8 (its exact value for large images).
const path = require("path");
const M = require(path.join(__dirname, ".build", "model.js"));

const W = 256, H = 256, N = W * H;
const LR = 0.2126, LG = 0.7152, LB = 0.0722;
const lum = (r, g, b) => r * LR + g * LG + b * LB;
const B3 = (d) => (d === 0 ? 0.375 : Math.abs(d) === 1 ? 0.25 : 0.0625);
const clampi = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Synthetic scene, deliberately DARK (like the report's photo — most pixels
// below linear 0.214 = sRGB 0.5): broad low-frequency light falloff for the
// coarse octaves, mid-scale blobs, fine texture, hard edges, a bright window,
// a saturated patch. Deterministic.
function makeImage() {
  const img = new Float64Array(N * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const u = x / W, v = y / H;
      // broad falloff + slow waves (drives octaves 5-7)
      let base = 0.03 + 0.14 * Math.exp(-((u - 0.35) ** 2 + (v - 0.4) ** 2) * 2.2);
      base += 0.03 * Math.sin(2 * Math.PI * u) * Math.sin(2 * Math.PI * v);
      // mid-scale blobs (octaves 3-5)
      base += 0.05 * Math.exp(-((u - 0.7) ** 2 + (v - 0.65) ** 2) * 40);
      base += 0.04 * Math.sin(12 * Math.PI * u + 3 * Math.sin(6 * v)) * Math.exp(-((v - 0.3) ** 2) * 12);
      // fine texture (octaves 0-2)
      base += 0.015 * Math.sin(60 * Math.PI * u) * Math.sin(52 * Math.PI * v + u * 9);
      let r = base, g = base * 0.96, b = base * 1.05;
      // bright window with hard edges
      if (x > 150 && x < 190 && y > 40 && y < 96) { r += 0.55; g += 0.5; b += 0.42; }
      // dark object
      const dx = (x - 90) / 34, dy = (y - 170) / 26;
      if (dx * dx + dy * dy < 1) { r *= 0.25; g *= 0.28; b *= 0.35; }
      // saturated patch
      if (x > 40 && x < 78 && y > 60 && y < 92) { r += 0.1; b *= 0.6; }
      img[i] = Math.max(0, r); img[i + 1] = Math.max(0, g); img[i + 2] = Math.max(0, b);
    }
  }
  return img;
}

// One edge-aware à trous blur step, exactly the pass GLSL / eaw.c: 25-tap B3,
// dilation `mult`, clamp-to-edge, luma weight exp(-s·ΔL²) (or the old halved
// exponent), chroma weight exp(-s·|Δab|²), per-channel-group normalisation.
function eawBlur(src, mult, sharp, halvedWl) {
  const out = new Float64Array(N * 3);
  const wlK = (halvedWl ? 0.5 : 1) * sharp;
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
          const wl = Math.exp(-wlK * dL * dL);
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

// Boost + soft-core one detail plane onto `out`. `changeForm` mirrors our
// inline GLSL (adds (1+g)·core − d onto the running image); without it this is
// darktable's accumulate() (adds boost·core into a zeroed accumulator).
function addBand(out, detail, gainL, gainC, thrL, thrC, changeForm) {
  for (let i = 0; i < N * 3; i += 3) {
    const dL = lum(detail[i], detail[i + 1], detail[i + 2]);
    const dC0 = detail[i] - dL, dC1 = detail[i + 1] - dL, dC2 = detail[i + 2] - dL;
    const dL100 = dL * 100;
    const coreL = Math.sign(dL100) * Math.max(Math.abs(dL100) - thrL, 0) / 100;
    const cmag = Math.hypot(dC0, dC1, dC2) * 100;
    const fac = cmag > 1e-5 ? Math.max(cmag - thrC, 0) / cmag : 1;
    const subL = changeForm ? dL : 0;
    const subC = changeForm ? 1 : 0;
    const addL = (1 + gainL) * coreL - subL;
    const aC0 = (1 + gainC) * dC0 * fac - subC * dC0;
    const aC1 = (1 + gainC) * dC1 * fac - subC * dC1;
    const aC2 = (1 + gainC) * dC2 * fac - subC * dC2;
    out[i] += addL + aC0; out[i + 1] += addL + aC1; out[i + 2] += addL + aC2;
  }
}

const octaveT = (o) => 1 - (o + 0.5) / M.DT_SCALES;
const curveAt = (curves, xs, ch, t) => M.evalCurve(xs[ch], curves[ch], t);

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

// darktable, restricted to our domain: ALL EIGHT octaves decomposed in one
// chain, each detail boosted/cored, residue added back.
function reference(src, curves, xs, { halvedWl = false } = {}) {
  const out = new Float64Array(N * 3);
  const details = [];
  let coarse = src;
  for (let s = 0; s < M.DT_SCALES; s++) {
    const k = coeffsAt(curves, xs, octaveT(s));
    const next = eawBlur(coarse, 1 << s, k.sharp, halvedWl);
    const d = new Float64Array(N * 3);
    for (let i = 0; i < N * 3; i++) d[i] = coarse[i] - next[i];
    details.push(d);
    addBand(out, d, k.gainL, k.gainC, k.thrL, k.thrC, false);
    coarse = next;
  }
  for (let i = 0; i < N * 3; i++) out[i] += coarse[i];
  return { out, details };
}

// Our four band stages. mode "new" (the shipped design): each band chains from
// the source to octave o = 2b and emits the TWO-OCTAVE detail c_o − c_{o+2}
// (with the bias encode/decode round-trip), coefficients = the pair's average
// via model.bandCoeffs. mode "old" (v1.x): single-octave detail c_o − c_{o+1},
// gains at the octave's own t, halved wl exponent. mode "bug" = "old" plus the
// starved coarsest band decoding the sRGB-encoded raw image as detail (the
// unit-starvation bug).
function ours(src, curves, xs, mode) {
  const halvedWl = mode !== "new";
  const out = Float64Array.from(src);
  const sh = M.sharps(curves, xs, 1);
  const bandDetails = [];
  for (let b = 0; b < M.GPU_SCALES; b++) {
    const o = M.OCTAVES[b];
    let k;
    if (mode === "new") {
      k = M.bandCoeffs(curves, xs, b, 1);
    } else {
      const c = coeffsAt(curves, xs, octaveT(o));
      k = { gainL: c.gainL, gainC: c.gainC, thrL: c.thrL, thrC: c.thrC };
    }
    let detail;
    if (mode === "bug" && b === M.GPU_SCALES - 1) {
      // stageResult sampler left at unit 0 → the raw (sRGB-encoded) image,
      // decoded as bias-encoded detail: d = 2·srgb(src) − 1.
      detail = new Float64Array(N * 3);
      for (let i = 0; i < N * 3; i++) {
        const v = Math.max(0, Math.min(1, src[i]));
        const srgb = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
        detail[i] = 2 * srgb - 1;
      }
    } else {
      let c = src;
      for (let j = 0; j < o; j++) c = eawBlur(c, 1 << j, sh[j], halvedWl);
      const next = eawBlur(c, 1 << o, sh[o], halvedWl);
      const last = mode === "new" ? eawBlur(next, 1 << (o + 1), sh[o + 1], halvedWl) : next;
      detail = new Float64Array(N * 3);
      for (let i = 0; i < N * 3; i++) {
        const enc = (c[i] - last[i]) * 0.5 + 0.5; // final-pass bias encode
        detail[i] = (enc - 0.5) * 2;              // inline decode
      }
      bandDetails.push({ o, detail });
    }
    addBand(out, detail, k.gainL, k.gainC, k.thrL, k.thrC, true);
  }
  return { out, bandDetails };
}

const rmse = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) * (a[i] - b[i]);
  return Math.sqrt(s / a.length);
};
const meanLuma = (img) => {
  let s = 0;
  for (let i = 0; i < N * 3; i += 3) s += lum(img[i], img[i + 1], img[i + 2]);
  return s / N;
};

// ── Scenario: the screenshot's coarse-boost curve + a denoise ramp ──────────
const src = makeImage();
const xs = M.defaultXs();
const boostCurves = M.defaultCurves();
boostCurves.L = [0.62, 0.68, 0.62, 0.54, 0.5, 0.5]; // coarse hump (coarse→fine)
boostCurves.c = [0.5, 0.56, 0.54, 0.5, 0.5, 0.5];
const denoiseCurves = M.defaultCurves();
denoiseCurves.Lt = [0, 0.03333333333333333, 0.06666666666666667, 0.1, 0.13333333333333333, 0.16666666666666666];
denoiseCurves.ct = [0, 0.05, 0.1, 0.15, 0.2, 0.25];

let fails = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails++;
};

// 1. Neutral curve is an exact identity through our whole pipeline.
{
  const { out } = ours(src, M.defaultCurves(), xs, "new");
  let maxd = 0;
  for (let i = 0; i < N * 3; i++) maxd = Math.max(maxd, Math.abs(out[i] - src[i]));
  check("identity at neutral curve", maxd < 1e-9, `max |Δ| = ${maxd.toExponential(2)}`);
}

// 2. Each band's emitted two-octave detail equals the sum of the reference
//    decomposition's two details at those octaves exactly — the four bands
//    tile darktable's chain (same per-level sharps).
{
  const ref = reference(src, boostCurves, xs, { halvedWl: false });
  const { bandDetails } = ours(src, boostCurves, xs, "new");
  let worst = 0;
  for (const { o, detail } of bandDetails) {
    const want = new Float64Array(N * 3);
    for (let i = 0; i < N * 3; i++) want[i] = ref.details[o][i] + ref.details[o + 1][i];
    worst = Math.max(worst, rmse(detail, want));
  }
  check("bands tile the reference decomposition", worst < 1e-12, `worst rmse = ${worst.toExponential(2)}`);
}

// 2b. A FLAT curve (darktable's clarity preset: L 0.6, c 0.55, edges 0) makes
//     the averaged pair coefficients exact — our output must equal darktable's
//     full eight-octave answer to float precision.
{
  const cCurves = M.defaultCurves();
  cCurves.L = cCurves.L.map(() => 0.6);
  cCurves.c = cCurves.c.map(() => 0.55);
  cCurves.s = cCurves.s.map(() => 0);
  const ref = reference(src, cCurves, xs).out;
  const { out } = ours(src, cCurves, xs, "new");
  const e = rmse(out, ref);
  check("flat clarity == darktable exactly", e < 1e-12, `rmse = ${e.toExponential(2)}`);
}

// 3. The unit-starvation bug reproduces the reported black crush on a dark
//    scene, and is wildly off darktable; the fixed pipeline is neither.
{
  const ref = reference(src, boostCurves, xs).out;
  const bug = ours(src, boostCurves, xs, "bug").out;
  const oldOut = ours(src, boostCurves, xs, "old").out;
  const fixedNew = ours(src, boostCurves, xs, "new").out;
  const dropBug = meanLuma(ref) - meanLuma(bug);
  const dropNew = Math.abs(meanLuma(ref) - meanLuma(fixedNew));
  const eBug = rmse(bug, ref);
  const eOld = rmse(oldOut, ref);
  check("bug mode crushes brightness", dropBug > 0.08, `mean-luma drop = ${dropBug.toFixed(3)}`);
  check("bug mode dwarfs every fixed mode", eBug > 4 * eOld, `rmse bug ${eBug.toExponential(3)} vs old ${eOld.toExponential(3)}`);
  check("fixed mode holds brightness", dropNew < 0.02, `mean-luma diff = ${dropNew.toFixed(4)}`);
  console.log(`      mean luma: src ${meanLuma(src).toFixed(3)}, darktable ${meanLuma(ref).toFixed(3)}, bug ${meanLuma(bug).toFixed(3)}, fixed ${meanLuma(fixedNew).toFixed(3)}`);
}

// 4. Pair compensation halves-or-better the gap to darktable's 8-octave answer
//    (old = single-octave gains + halved wl, vs new = summed pair + fixed wl).
for (const [name, curves] of [["coarse boost", boostCurves], ["denoise ramp", denoiseCurves]]) {
  const ref = reference(src, curves, xs).out;
  const oldOut = ours(src, curves, xs, "old").out;
  const newOut = ours(src, curves, xs, "new").out;
  const eOld = rmse(oldOut, ref);
  const eNew = rmse(newOut, ref);
  check(
    `pair compensation vs darktable — ${name}`,
    eNew < 0.7 * eOld,
    `rmse old ${eOld.toExponential(3)} → new ${eNew.toExponential(3)} (${((1 - eNew / eOld) * 100).toFixed(0)}% closer)`,
  );
}

console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL RENDER CHECKS PASS");
process.exit(fails ? 1 : 0);
