let fe = null, he = null;
function Ve(e) {
  fe = e.react, he = e;
}
function F() {
  if (!he) throw new Error("[contrast-equalizer] api used before activate()");
  return he;
}
function xe() {
  if (!fe) throw new Error("[contrast-equalizer] runtime used before activate()");
  return fe;
}
function H(e, t, ...s) {
  return xe().createElement(e, t, ...s);
}
const S = 6, ye = Array.from({ length: S }, (e, t) => t / (S - 1)), Y = {
  L: 0.5,
  c: 0.5,
  s: 0.5,
  Lt: 0,
  ct: 0
}, je = ["L", "c", "s", "Lt", "ct"];
function le() {
  const e = (t) => Array.from({ length: S }, () => t);
  return {
    L: e(Y.L),
    c: e(Y.c),
    s: e(Y.s),
    Lt: e(Y.Lt),
    ct: e(Y.ct)
  };
}
function Ce() {
  const e = {};
  for (const t of je) e[t] = [...ye];
  return e;
}
function Q(e) {
  return { L: [...e.L], c: [...e.c], s: [...e.s], Lt: [...e.Lt], ct: [...e.ct] };
}
function Z(e) {
  return { L: [...e.L], c: [...e.c], s: [...e.s], Lt: [...e.Lt], ct: [...e.ct] };
}
const Me = 8, ce = [0, 2, 4, 6], ie = ce.length, me = (e) => 1 - (e + 0.5) / Me, Je = ce.map(
  (e) => [me(e), me(e + 1)]
), V = Array.from({ length: Me }, (e, t) => me(t));
function pe(e) {
  return e < 0 ? 0 : e > 1 ? 1 : e;
}
function U(e, t, s) {
  const n = t.length;
  let r = n - 2;
  for (let b = 0; b < n - 2; b++)
    if (s < e[b + 1]) {
      r = b;
      break;
    }
  const l = (b, _) => (t[_] - t[b]) / (e[_] - e[b]), u = r === 0 ? l(0, 1) : l(r - 1, r + 1), L = r === n - 2 ? l(n - 2, n - 1) : l(r, r + 2), h = e[r + 1] - e[r], w = (s - e[r]) / h, T = w * w, D = T * w, m = 2 * D - 3 * T + 1, v = D - 2 * T + w, A = -2 * D + 3 * T, g = D - T;
  return pe(m * t[r] + v * h * u + A * t[r + 1] + g * h * L);
}
function ge(e, t, s, n) {
  if (n === 1) return { xs: t, ys: s };
  const r = Y[e];
  return {
    xs: t.map((l, u) => pe(l + (n - 1) * (l - ye[u]))),
    ys: s.map((l) => pe(l + (n - 1) * (l - r)))
  };
}
function ee(e, t, s, n, r) {
  const { xs: l, ys: u } = ge(s, t[s], e[s], r);
  return U(l, u, n);
}
function Qe(e, t, s, n) {
  let r = 0, l = 0, u = 0, L = 0;
  for (const h of Je[s]) {
    const w = ee(e, t, "L", h, n), T = ee(e, t, "c", h, n), D = ee(e, t, "Lt", h, n), m = ee(e, t, "ct", h, n), v = Math.pow(2, -7 * (1 - h));
    r += (2 * w * (2 * w) - 1) / 2, l += (2 * T * (2 * T) - 1) / 2, u += v * 10 * D / 2, L += v * 20 * m / 2;
  }
  return { gainL: r, gainC: l, thrL: u, thrC: L };
}
function Ze(e, t, s) {
  return V.map((n) => 25e-4 * ee(e, t, "s", n, s));
}
const te = "contrast-equalizer";
function Pe(e) {
  let t = 0;
  for (let s = 0; s < e.length; s++) t = (t << 5) - t + e.charCodeAt(s) | 0;
  return (t >>> 0).toString(36).slice(0, 4);
}
const Re = ["fine", "medium", "coarse", "coarsest"], et = (() => {
  const e = [], t = /* @__PURE__ */ new Set();
  for (let s = 0; s < ie; s++) {
    const n = `${te}.${Re[s] ?? `octave${s}`}`;
    let r = 0, l = n;
    for (; t.has(Pe(l)) && r < 1e3; ) l = `${n}-${++r}`;
    t.add(Pe(l)), e.push(l);
  }
  return e;
})(), Se = (e) => et[e], B = "100.0", tt = `
// B3 spline 1D weights [1,4,6,4,1]/16.
float ceB3(int d) { d = d < 0 ? -d : d; return d == 0 ? 0.375 : (d == 1 ? 0.25 : 0.0625); }
// Per-level edge sharpness (darktable 'sharp'): levels 0-3 in A, 4-7 in B.
float ceSharp(int i) {
  vec4 v = i < 4 ? uSharpsA : uSharpsB;
  int k = i < 4 ? i : i - 4;
  return k == 0 ? v.x : (k == 1 ? v.y : (k == 2 ? v.z : v.w));
}
// One edge-aware à trous step of the previous pass's buffer (darktable's
// eaw_decompose): 25-tap B3 dilated by mult, luma weight exp(−s·ΔL²) — eaw.c
// weight()'s −0.5·sharpen luma lane multiplies a DOUBLED square, so the
// effective exponent is −s·ΔL² — chroma weight exp(−s·|Δab|²), per-group
// normalisation, luma on the 0..100 scale.
vec3 ceBlur(vec2 uv, float mult, float sharp) {
  vec3 ctr = readPrev(uv);
  float Lc = luma(ctr) * ${B};
  vec3  abC = (ctr - luma(ctr)) * ${B};
  float sumL = 0.0, wL = 0.0;
  vec3  sumC = vec3(0.0); float wC = 0.0;
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      vec2 off = vec2(float(dx), float(dy)) * mult * uTexel;
      vec3 s = readPrev(uv + off);
      float f = ceB3(dx) * ceB3(dy);
      float Ls = luma(s) * ${B};
      vec3  abS = (s - luma(s)) * ${B};
      float dL = Lc - Ls;
      float wl = exp(-sharp * dL * dL);
      vec3  dab = abC - abS;
      float wc = exp(-sharp * dot(dab, dab));
      sumL += f * wl * Ls; wL += f * wl;
      sumC += f * wc * abS; wC += f * wc;
    }
  }
  float coarseL = (wL > 0.0 ? sumL / wL : Lc) / ${B};
  vec3  coarseAb = (wC > 0.0 ? sumC / wC : abC) / ${B};
  return vec3(coarseL) + coarseAb;
}
// The chain level AFTER the next one, evaluated from ceBlur values: the level
// o+1 step over level o+1 samples, each themselves a ceBlur of the previous
// buffer. Only the final pass pays for this (25 + 25×26 taps); the prepass is
// cached until the image or the edges curve changes.
vec3 ceBlur2(vec2 uv, float multIn, float sharpIn, float mult2, float sharp2) {
  vec3 ctr = ceBlur(uv, multIn, sharpIn);
  float Lc = luma(ctr) * ${B};
  vec3  abC = (ctr - luma(ctr)) * ${B};
  float sumL = 0.0, wL = 0.0;
  vec3  sumC = vec3(0.0); float wC = 0.0;
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      vec2 off = vec2(float(dx), float(dy)) * mult2 * uTexel;
      vec3 s = ceBlur(uv + off, multIn, sharpIn);
      float f = ceB3(dx) * ceB3(dy);
      float Ls = luma(s) * ${B};
      vec3  abS = (s - luma(s)) * ${B};
      float dL = Lc - Ls;
      float wl = exp(-sharp2 * dL * dL);
      vec3  dab = abC - abS;
      float wc = exp(-sharp2 * dot(dab, dab));
      sumL += f * wl * Ls; wL += f * wl;
      sumC += f * wc * abS; wC += f * wc;
    }
  }
  float coarseL = (wL > 0.0 ? sumL / wL : Lc) / ${B};
  vec3  coarseAb = (wC > 0.0 ? sumC / wC : abC) / ${B};
  return vec3(coarseL) + coarseAb;
}
`, nt = `
{
  float mult = exp2(float(uPassIndex));
  float sharp = ceSharp(uPassIndex);
  if (uPassIndex < uPassCount - 1) {
    c = ceBlur(vUv, mult, sharp);
  } else {
    // Signed detail, bias-encoded into [0,1] (0.5 = zero) so it survives the
    // host's RGBA8 ping-pong fallback on GPUs without EXT_color_buffer_float.
    // The inline decodes it. (On the RGBA16F path this costs ~1 bit.)
    vec3 coarse2 = ceBlur2(vUv, mult, sharp, mult * 2.0, ceSharp(uPassIndex + 1));
    c = (c - coarse2) * 0.5 + 0.5;
  }
}
`, ot = `
{
  vec3 d = (stageResult - 0.5) * 2.0;      // decode the bias-encoded signed detail
  float dL = luma(d);
  vec3  dC = d - dL;                       // chroma part (zero luma)
  float dL100 = dL * ${B};
  float coreL = sign(dL100) * max(abs(dL100) - thrL, 0.0) / ${B};
  float addL = (1.0 + gainL) * coreL - dL;
  float cmag = length(dC) * ${B};
  // Below the epsilon the magnitude division is unstable; pass the (≤1e-7
  // linear) chroma through UNcored — the zero-gain identity stays exact, which
  // the idle-stage fallback contract depends on.
  float fac = cmag > 1e-5 ? max(cmag - thrC, 0.0) / cmag : 1.0;
  vec3  coreC = dC * fac;
  vec3  addC = (1.0 + gainC) * coreC - dC;
  lin += vec3(addL) + addC;
}
`, st = [
  { key: "gainL", glslType: "float", default: 0, label: "Luma gain" },
  { key: "gainC", glslType: "float", default: 0, label: "Chroma gain" },
  { key: "thrL", glslType: "float", default: 0, label: "Luma threshold" },
  { key: "thrC", glslType: "float", default: 0, label: "Chroma threshold" }
];
function rt(e) {
  return {
    glsl: nt,
    helpers: tt,
    // o+1 chained passes from the source; the final one evaluates levels o+1
    // AND o+2 itself (ceBlur2) to emit the band's two-octave detail.
    iterations: ce[e] + 1,
    uniforms: [
      { key: "uSharpsA", glslType: "vec4", default: [0, 0, 0, 0] },
      { key: "uSharpsB", glslType: "vec4", default: [0, 0, 0, 0] }
    ]
  };
}
function at(e) {
  return {
    id: Se(e),
    name: `Contrast Equalizer · ${Re[e] ?? `band ${e}`}`,
    // Scene-linear, after exposure/white balance; bands are additive so their
    // order among themselves doesn't matter.
    phase: "scene-linear",
    priority: 70 + e,
    glsl: ot,
    uniforms: st,
    passes: [rt(e)]
  };
}
function lt() {
  return Array.from({ length: ie }, (e, t) => at(t));
}
const we = ["L", "c", "s", "Lt", "ct"], De = (e) => `${te}.curve.${e}`, Ie = (e) => `${te}.curvex.${e}`, _e = `${te}.mix`, ae = 1;
function Ne(e) {
  return Array.isArray(e) && e.length === S && e.every((t) => typeof t == "number");
}
function ct(e) {
  const t = Q(le());
  for (const s of we) {
    const n = e[De(s)];
    Ne(n) && (t[s] = [...n]);
  }
  return t;
}
function it(e) {
  const t = Z(Ce());
  for (const s of we) {
    const n = e[Ie(s)];
    Ne(n) && (t[s] = [...n]);
  }
  return t;
}
function ut(e) {
  const t = e[_e];
  return typeof t == "number" ? t : ae;
}
function Xe(e, t, s) {
  const n = {};
  for (const l of we)
    n[De(l)] = [...e[l]], n[Ie(l)] = [...t[l]];
  n[_e] = s;
  const r = Ze(e, t, s);
  for (let l = 0; l < ie; l++) {
    const u = Se(l), L = Qe(e, t, l, s);
    n[`${u}.gainL`] = L.gainL, n[`${u}.gainC`] = L.gainC, n[`${u}.thrL`] = L.thrL, n[`${u}.thrC`] = L.thrC;
    const h = L.gainL === 0 && L.gainC === 0 && L.thrL === 0 && L.thrC === 0, w = r.map((T, D) => !h && D <= ce[l] + 1 ? T : 0);
    n[`${u}.uSharpsA`] = w.slice(0, 4), n[`${u}.uSharpsB`] = w.slice(4, 8);
  }
  return n;
}
const z = S - 1, C = (e) => Array.from({ length: S }, (t, s) => e(s)), W = (e) => ({ ...le(), ...e }), dt = (e, t) => Math.exp(-((1 - e) * (1 - e)) / (t * t)) / (2 * t * Math.sqrt(Math.PI)), ft = 3 / z, ht = (e, t, s) => {
  const n = (r) => [0.5, 1, 2].slice(0, e).reduce((l, u) => l + dt(r, u * ft), 0);
  return W({
    L: C((r) => 0.5 + n(r / z) / t),
    s: C((r) => 0.5 + n(r / z) / t),
    Lt: C((r) => n(r / z) / s),
    ct: C((r) => n(r / z) / s)
  });
}, mt = [
  [3, 16, 128],
  [2, 24, 192],
  [1, 32, 128]
], pt = [
  ["large", 3],
  ["medium", 2],
  ["fine", 1]
], $e = [
  { id: "flat", label: "Flat (reset)", build: () => le() },
  {
    id: "coarse",
    label: "Coarse",
    build: () => W({
      L: C((e) => Math.max(0.5, 0.75 - 0.5 * e / z)),
      c: C((e) => Math.max(0.5, 0.55 - 0.5 * e / z)),
      s: C((e) => Math.min(0.5, 0.2 + 0.35 * e / z))
    })
  },
  {
    id: "denoise-sharpen",
    label: "Denoise & sharpen",
    build: () => W({
      L: C((e) => 0.5 + 0.25 * e / S),
      Lt: C((e) => 0.2 * e / S),
      ct: C((e) => 0.3 * e / S)
    })
  },
  {
    id: "sharpen",
    label: "Sharpen",
    build: () => W({ L: C((e) => 0.5 + 0.25 * e / S) })
  },
  {
    id: "denoise-chroma",
    label: "Denoise chroma",
    build: () => W({
      s: C(() => 0),
      ct: C((e) => Math.max(0, 0.6 * e / S - 0.3))
    })
  },
  {
    id: "denoise",
    label: "Denoise",
    build: () => W({
      Lt: C((e) => 0.2 * e / S),
      ct: C((e) => 0.3 * e / S)
    })
  },
  {
    id: "bloom",
    label: "Bloom",
    build: () => W({
      L: C((e) => e === 0 ? 0.5 : Math.min(0.5, 0.3 + 0.35 * e / z)),
      s: C(() => 0)
    })
  },
  {
    id: "clarity",
    label: "Clarity (local contrast)",
    build: () => W({ L: C(() => 0.6), c: C(() => 0.55), s: C(() => 0) })
  },
  ...mt.flatMap(
    ([e, t, s]) => pt.map(([n, r]) => ({
      id: `deblur-${n}-${e}`,
      label: `Deblur · ${n} blur · strength ${e}`,
      build: () => ht(r, t, s)
    }))
  )
], re = [
  { key: "luma", label: "luma", primary: "L", thr: "Lt" },
  { key: "chroma", label: "chroma", primary: "c", thr: "ct" },
  { key: "edges", label: "edges", primary: "s", thr: null }
];
function gt(e) {
  return {
    ink: e ? "224,224,224" : "43,43,43",
    circle: e ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.6)",
    dotBoost: "rgba(150,150,150,1)",
    dotThr: e ? "rgba(235,235,235,1)" : "rgba(26,26,26,1)",
    ch: {
      L: [153, 153, 153, 0.3],
      c: e ? [214, 140, 70, 0.4] : [102, 51, 0, 0.4],
      s: e ? [122, 160, 200, 0.4] : [26, 51, 77, 0.4]
    }
  };
}
const Be = (e, t, s) => {
  const [n, r, l, u] = e.ch[t];
  return `rgba(${n},${r},${l},${u * (s ? 0.5 : 1)})`;
}, f = 6, Le = 13, I = 64, Lt = 1 / S, bt = 0.25 / S, vt = 1;
function be(e) {
  return e < 0 ? 0 : e > 1 ? 1 : e;
}
function ve(e, t, s, n, r) {
  return e.map((l, u) => {
    const L = s - t[u], h = Math.exp(-(L * L) / (r * r));
    return be((1 - h) * l + h * n);
  });
}
function yt(e, t, s, n, r, l, u, L, h, w, T, D, m) {
  const v = t - 2 * f, A = s - 2 * f - Le, g = (c) => f + c * v, b = (c) => f + (1 - c) * A;
  e.clearRect(0, 0, t, s), e.strokeStyle = `rgba(${m.ink},0.8)`, e.lineWidth = 1, e.strokeRect(f, f, v, A), e.strokeStyle = `rgba(${m.ink},0.22)`;
  for (let c = 1; c < 8; c++)
    e.beginPath(), e.moveTo(g(c / 8), f), e.lineTo(g(c / 8), f + A), e.stroke(), e.beginPath(), e.moveTo(f, f + c / 8 * A), e.lineTo(f + v, f + c / 8 * A), e.stroke();
  e.fillStyle = `rgba(${m.ink},0.10)`;
  for (let c = 1; c < V.length; c += 2) {
    const k = g(Math.min(V[c - 1], V[c])), M = g(Math.max(V[c - 1], V[c]));
    e.fillRect(k, f, M - k, A);
  }
  const _ = [...re.filter((c) => c.key !== l.key), l];
  for (const c of _) {
    const k = c.key !== l.key, M = ge(c.primary, r[c.primary], n[c.primary], L);
    if (e.beginPath(), c.thr) {
      const R = ge(c.thr, r[c.thr], n[c.thr], L);
      e.moveTo(g(1), b(U(R.xs, R.ys, 1)));
      for (let p = I - 2; p >= 0; p--) {
        const X = p / (I - 1);
        e.lineTo(g(X), b(U(R.xs, R.ys, X)));
      }
      for (let p = 0; p < I; p++) {
        const X = p / (I - 1);
        e.lineTo(g(X), b(U(M.xs, M.ys, X)));
      }
    } else {
      e.moveTo(g(0), b(0));
      for (let R = 0; R < I; R++) {
        const p = R / (I - 1);
        e.lineTo(g(p), b(U(M.xs, M.ys, p)));
      }
      e.lineTo(g(1), b(0));
    }
    e.closePath();
    const K = Be(m, c.primary, k);
    e.strokeStyle = K, e.fillStyle = K, e.lineWidth = 2, e.stroke(), e.fill();
  }
  if ((w || h !== null && !h.strip && h.y > 0) && h) {
    const c = r[u], k = n[u];
    e.lineWidth = 1;
    const M = u === l.primary ? m.dotBoost : m.dotThr;
    for (let E = 0; E < S; E++)
      e.beginPath(), e.arc(g(c[E]), b(k[E]), 3, 0, Math.PI * 2), e.strokeStyle = M, e.fillStyle = M, D === E ? e.fill() : e.stroke();
    const K = ve(k, c, h.x, 1, T), R = ve(k, c, h.x, 0, T);
    e.beginPath();
    for (let E = 0; E < I; E++) {
      const q = E / (I - 1), x = U(c, K, q);
      E === 0 ? e.moveTo(g(q), b(x)) : e.lineTo(g(q), b(x));
    }
    for (let E = I - 1; E >= 0; E--) {
      const q = E / (I - 1);
      e.lineTo(g(q), b(U(c, R, q)));
    }
    e.closePath(), e.fillStyle = Be(m, l.primary, !1), e.fill(), e.beginPath(), e.arc(g(h.x), b(U(c, k, h.x)), T * v, 0, Math.PI * 2), e.strokeStyle = m.circle, e.lineWidth = 1, e.stroke(), e.fillStyle = `rgba(${m.ink},0.85)`, e.font = "bold 10px sans-serif", e.textAlign = "center", e.textBaseline = "middle", e.save(), e.translate(f + 10, f + A * 0.5), e.rotate(-Math.PI / 2), e.fillText("coarse", 0, 0), e.restore(), e.save(), e.translate(f + v - 6, f + A * 0.5), e.rotate(-Math.PI / 2), e.fillText("fine", 0, 0), e.restore();
    const [p, X] = u === "Lt" || u === "ct" ? ["smooth", "noisy"] : u === "s" ? ["bold", "dull"] : ["contrasty", "smooth"];
    e.fillText(p, f + v / 2, f + 9), e.fillText(X, f + v / 2, f + A - 9);
  }
  e.strokeStyle = `rgba(${m.ink},0.9)`, e.fillStyle = `rgba(${m.ink},0.9)`, e.lineWidth = 1;
  const N = f + A + 3;
  for (let c = 1; c < S - 1; c++) {
    const k = g(r[l.primary][c]);
    e.beginPath(), e.moveTo(k - 3.5, N + 7), e.lineTo(k, N), e.lineTo(k + 3.5, N + 7), e.closePath(), D === c ? e.fill() : e.stroke();
  }
}
function Ct() {
  const e = F().react, { useState: t, useRef: s, useEffect: n } = e, r = F().stores.useDevelopStore, l = F().components.Slider, u = F().ui;
  if (!u)
    return H(
      "div",
      { style: { padding: "10px", fontSize: "11px", color: "var(--color-text-muted)" } },
      "Update Safelight to use this panel."
    );
  const { SegmentedControl: L, Select: h } = u, w = r((o) => o.paramBag), T = r(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (o) => o.setDynParams
  ), D = r((o) => o.commitEdit), m = ct(w), v = it(w), A = ut(w), [g, b] = t(() => F().settings.get("channel", "luma")), [_, ne] = t("L"), [N, c] = t(() => F().settings.get("radius", Lt)), [k, M] = t(null), [K, R] = t(-1), [p, X] = t({ w: 240, h: 160 }), [E, q] = t(0), x = s(null), ue = s(null), G = s(null), ke = s(N);
  ke.current = N;
  const Te = s(0), $ = re.find((o) => o.key === g), O = _ === $.primary || _ === $.thr ? _ : $.primary;
  n(() => {
    const o = x.current;
    if (!o) return;
    const a = new ResizeObserver((d) => {
      const y = d[0].contentRect.width;
      y > 0 && X({ w: Math.round(y), h: Math.round(y * 0.6) + Le });
    });
    return a.observe(o), () => a.disconnect();
  }, []), n(() => {
    const o = () => {
      Te.current += 1, q(Te.current);
    }, a = new MutationObserver(o);
    return a.observe(document.documentElement, { attributes: !0 }), a.observe(document.body, { attributes: !0 }), () => a.disconnect();
  }, []), n(() => {
    const o = ue.current;
    if (!o) return;
    const a = (d) => {
      d.preventDefault();
      const y = 1 - 0.1 * Math.sign(d.deltaY), i = Math.min(vt, Math.max(bt, ke.current * y));
      c(i), F().settings.set("radius", i);
    };
    return o.addEventListener("wheel", a, { passive: !1 }), () => o.removeEventListener("wheel", a);
  }, []), n(() => {
    const o = ue.current;
    if (!o) return;
    const a = window.devicePixelRatio || 1;
    o.width = p.w * a, o.height = p.h * a;
    const d = o.getContext("2d");
    if (!d) return;
    d.setTransform(a, 0, 0, a, 0, 0);
    const y = getComputedStyle(o).backgroundColor.match(/\d+(?:\.\d+)?/g), i = y ? (Number(y[0]) + Number(y[1]) + Number(y[2])) / (3 * 255) < 0.5 : !0, P = k !== null || G.current !== null;
    yt(
      d,
      p.w,
      p.h,
      m,
      v,
      $,
      O,
      P ? 1 : A,
      k,
      G.current !== null,
      N,
      K,
      gt(i)
    );
  }, [w, g, _, N, p, k, K, E]);
  const Ue = p.w - 2 * f, Ae = p.h - 2 * f - Le, Ee = (o) => {
    const a = o.currentTarget.getBoundingClientRect(), d = a.width > 0 ? p.w / a.width : 1, y = a.height > 0 ? p.h / a.height : 1, i = (o.clientX - a.left) * d, P = (o.clientY - a.top) * y;
    return {
      x: be((i - f) / Ue),
      y: be(1 - (P - f) / Ae),
      strip: P > f + Ae
    };
  }, de = (o) => {
    const a = v[$.primary];
    let d = 0, y = Math.abs(a[0] - o);
    for (let i = 1; i < S; i++) {
      const P = Math.abs(a[i] - o);
      P < y && (y = P, d = i);
    }
    return d;
  }, j = (o, a, d = A) => T(Xe(o, a, d)), oe = () => D("Contrast Equalizer"), ze = (o) => {
    const { x: a, y: d, strip: y } = Ee(o);
    if (o.currentTarget.setPointerCapture(o.pointerId), y)
      G.current = {
        mode: "x",
        ch2: O,
        node: de(a),
        snapC: Q(m),
        snapX: Z(v),
        pick: 0,
        fx: a,
        moved: !1
      };
    else {
      const i = U(v[O], m[O], a) - d;
      G.current = {
        mode: "y",
        ch2: O,
        node: -1,
        snapC: Q(m),
        snapX: Z(v),
        pick: i,
        fx: a,
        moved: !1
      };
    }
  }, qe = (o) => {
    const { x: a, y: d, strip: y } = Ee(o), i = G.current;
    if (i) {
      if (i.mode === "x") {
        if (i.node > 0 && i.node < S - 1) {
          const P = i.snapX[$.primary], se = Math.min(P[i.node + 1] - 1e-3, Math.max(P[i.node - 1] + 1e-3, a)), J = Z(i.snapX);
          J[$.primary][i.node] = se, $.thr && (J[$.thr][i.node] = se), i.moved = !0, j(i.snapC, J);
        }
        M({ x: a, y: d, strip: !1 });
      } else {
        const P = Q(i.snapC);
        P[i.ch2] = ve(i.snapC[i.ch2], i.snapX[i.ch2], i.fx, d + i.pick, N), i.moved = !0, j(P, i.snapX), M({ x: i.fx, y: d, strip: !1 });
      }
      return;
    }
    if (M({ x: a, y: d, strip: y }), y)
      R(de(a));
    else if (R(-1), $.thr) {
      const P = de(a), se = Math.abs(d - m[$.primary][P]), J = Math.abs(d - m[$.thr][P]);
      ne(se <= J ? $.primary : $.thr);
    } else
      ne($.primary);
  }, Ge = () => {
    const o = G.current;
    G.current = null, o && o.moved && oe();
  }, Oe = () => {
    G.current || (M(null), R(-1));
  }, Fe = () => {
    const o = Q(m);
    o[O] = Array.from({ length: S }, () => Y[O]);
    const a = Z(v);
    a[O] = [...ye], j(o, a), oe();
  }, He = H(L, {
    value: g,
    size: "sm",
    options: re.map((o) => ({ value: o.key, label: o.label })),
    onChange: (o) => {
      const a = re.find((d) => d.key === o);
      b(a.key), ne(a.primary), F().settings.set("channel", a.key);
    }
  }), We = H(
    "div",
    { ref: x, style: { width: "100%" } },
    H("canvas", {
      ref: ue,
      style: {
        width: p.w,
        height: p.h,
        touchAction: "none",
        borderRadius: 4,
        background: "var(--color-surface-0)",
        cursor: "crosshair",
        display: "block"
      },
      onPointerDown: ze,
      onPointerMove: qe,
      onPointerUp: Ge,
      onPointerLeave: Oe,
      onDoubleClick: Fe
    })
  ), Ke = H(h, {
    value: "",
    style: { width: "100%" },
    onChange: (o) => {
      const a = $e.find((d) => d.id === o);
      a && (j(a.build(), Ce(), ae), oe());
    },
    options: [
      { value: "", label: "Presets…" },
      ...$e.map((o) => ({ value: o.id, label: o.label }))
    ]
  }), Ye = H(
    "p",
    { style: { margin: "2px 0 0", fontSize: 10, color: "var(--color-text-muted)", lineHeight: 1.35 } },
    "Drag to shape the curve · wheel sets the radius · drag under the graph to move a node · double-click resets the curve."
  );
  return H(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 6, padding: 8 } },
    He,
    We,
    H(l, {
      label: "Mix",
      value: A,
      min: 0,
      max: 3,
      step: 0.01,
      defaultValue: ae,
      onChange: (o) => j(m, v, o),
      onCommit: oe
    }),
    Ke,
    Ye
  );
}
const St = `${te}.panel`;
function wt(e) {
  const t = e.stores.useDevelopStore.getState();
  t.setDynParams(Xe(le(), Ce(), ae)), t.commitEdit("Contrast Equalizer reset");
}
function kt(e) {
  Ve(e);
  for (const t of lt()) e.registerProcessingStage(t);
  e.registerPanel({
    id: St,
    title: "Contrast Equalizer",
    component: Ct,
    defaultDock: { module: "develop", direction: "right", order: 7, width: 268 },
    onReset: () => wt(e)
  });
}
function Tt() {
  const e = globalThis.safelight;
  if (e)
    for (let t = 0; t < ie; t++) e.unregisterProcessingStage(Se(t));
}
export {
  kt as activate,
  Tt as deactivate
};
//# sourceMappingURL=index.js.map
