let me = null, pe = null;
function ot(e) {
  me = e.react, pe = e;
}
function z() {
  if (!pe) throw new Error("[contrast-equalizer] api used before activate()");
  return pe;
}
function st() {
  if (!me) throw new Error("[contrast-equalizer] runtime used before activate()");
  return me;
}
function V(e, t, ...s) {
  return st().createElement(e, t, ...s);
}
const y = 6, Ce = Array.from({ length: y }, (e, t) => t / (y - 1)), W = {
  L: 0.5,
  c: 0.5,
  s: 0.5,
  Lt: 0,
  ct: 0
}, at = ["L", "c", "s", "Lt", "ct"];
function te() {
  const e = (t) => Array.from({ length: y }, () => t);
  return {
    L: e(W.L),
    c: e(W.c),
    s: e(W.s),
    Lt: e(W.Lt),
    ct: e(W.ct)
  };
}
function ce() {
  const e = {};
  for (const t of at) e[t] = [...Ce];
  return e;
}
function Z(e) {
  return { L: [...e.L], c: [...e.c], s: [...e.s], Lt: [...e.Lt], ct: [...e.ct] };
}
function J(e) {
  return { L: [...e.L], c: [...e.c], s: [...e.s], Lt: [...e.Lt], ct: [...e.ct] };
}
const re = 8, K = Array.from(
  { length: re },
  (e, t) => 1 - (t + 0.5) / re
);
function ve(e) {
  return e < 0 ? 0 : e > 1 ? 1 : e;
}
function x(e, t, s) {
  const o = t.length;
  let n = o - 2;
  for (let p = 0; p < o - 2; p++)
    if (s < e[p + 1]) {
      n = p;
      break;
    }
  const a = (p, D) => (t[D] - t[p]) / (e[D] - e[p]), d = n === 0 ? a(0, 1) : a(n - 1, n + 1), v = n === o - 2 ? a(o - 2, o - 1) : a(n, n + 2), i = e[n + 1] - e[n], k = (s - e[n]) / i, L = k * k, E = L * k, S = 2 * E - 3 * L + 1, T = E - 2 * L + k, I = -2 * E + 3 * L, m = E - L;
  return ve(S * t[n] + T * i * d + I * t[n + 1] + m * i * v);
}
function ge(e, t, s, o) {
  if (o === 1) return { xs: t, ys: s };
  const n = W[e];
  return {
    xs: t.map((a, d) => ve(a + (o - 1) * (a - Ce[d]))),
    ys: s.map((a) => ve(a + (o - 1) * (a - n)))
  };
}
function Q(e, t, s, o, n) {
  const { xs: a, ys: d } = ge(s, t[s], e[s], n);
  return x(a, d, o);
}
function rt(e, t, s, o) {
  const n = K[s], a = Q(e, t, "L", n, o), d = Q(e, t, "c", n, o), v = Q(e, t, "Lt", n, o), i = Q(e, t, "ct", n, o), k = Math.pow(2, -7 * (1 - n));
  return {
    gainL: 2 * a * (2 * a) - 1,
    gainC: 2 * d * (2 * d) - 1,
    thrL: k * 10 * v,
    thrC: k * 20 * i
  };
}
function ct(e, t, s) {
  return K.map((o) => 25e-4 * Q(e, t, "s", o, s));
}
const ne = "contrast-equalizer", ke = ["luma", "chroma-red", "chroma-blue"];
function Te(e) {
  let t = 0;
  for (let s = 0; s < e.length; s++) t = (t << 5) - t + e.charCodeAt(s) | 0;
  return (t >>> 0).toString(36).slice(0, 4);
}
const lt = (() => {
  const e = {}, t = /* @__PURE__ */ new Set();
  for (const s of ke) {
    const o = `${ne}.${s}`;
    let n = o;
    for (let a = 1; t.has(Te(n)) && a < 1e3; a++) n = `${o}-${a}`;
    t.add(Te(n)), e[s] = n;
  }
  return e;
})(), le = (e) => lt[e], xe = "0.2126", be = "0.7152", Oe = "0.0722", He = `
// B3 spline 1D weights [1,4,6,4,1]/16.
float ceB3(int d) { d = d < 0 ? -d : d; return d == 0 ? 0.375 : (d == 1 ? 0.25 : 0.0625); }
// Level i of a per-level table split across two vec4s.
float ceLevel(vec4 a, vec4 b, int i) {
  vec4 v = i < 4 ? a : b;
  int k = i < 4 ? i : i - 4;
  return k == 0 ? v.x : (k == 1 ? v.y : (k == 2 ? v.z : v.w));
}
// model.ts levelStep / levelFade; version 1 steps 2^level pass texels and
// applies every level in full.
float ceDilation(int level) {
#if SL_PROCESS_VERSION >= 2
  vec2 res = 1.0 / uTexel;
  float source = max(uSourceSize.x, uSourceSize.y);
  return exp2(float(level)) * (source > 0.0 ? max(res.x, res.y) / source : 1.0);
#else
  return exp2(float(level));
#endif
}
float ceFade(float dilation) {
#if SL_PROCESS_VERSION >= 2
  return clamp(1.0 + log2(dilation), 0.0, 1.0);
#else
  return 1.0;
#endif
}
`, it = `${He}
vec3 ceState(vec2 uv) {
  vec3 p = readPrev(uv);
  return uPassIndex == 0 ? vec3(luma(p), 0.0, 0.0) : p;
}
float ceCoarse(vec3 st) { return (st.x + st.y) * 100.0; }
`, ut = `
{
  float dilation = ceDilation(uPassIndex);
  float fade = ceFade(dilation);
  float sharp = ceLevel(sharpA, sharpB, uPassIndex);
  vec3 st = ceState(vUv);
  float Lc = ceCoarse(st);
  float sum = 0.0;
  float wsum = 0.0;
  if (fade > 0.0) {
    for (int dy = -2; dy <= 2; dy++) {
      for (int dx = -2; dx <= 2; dx++) {
        float Ls = ceCoarse(ceState(vUv + vec2(float(dx), float(dy)) * dilation * uTexel));
        float dL = Lc - Ls;
        float w = ceB3(dx) * ceB3(dy) * exp(-sharp * dL * dL);
        sum += w * Ls;
        wsum += w;
      }
    }
  }
  float coarse = wsum > 0.0 ? sum / wsum : Lc;
  float d = Lc - coarse;
  float core = sign(d) * max(abs(d) - ceLevel(thrA, thrB, uPassIndex), 0.0);
  float acc = st.z + fade * ((1.0 + ceLevel(gainA, gainB, uPassIndex)) * core - d) * 0.01;
  c = uPassIndex == uPassCount - 1 ? vec3(acc, 0.0, 0.0) : vec3(st.x, coarse * 0.01 - st.x, acc);
}
`, $e = (e) => `${He}
const int CE_COMP = ${e};
vec3 ceState(vec2 uv) {
  vec3 p = readPrev(uv);
  if (uPassIndex == 0) {
    float L = luma(p);
    return vec3(p.r - L, p.b - L, 0.0);
  }
  return p;
}
// The zero-luma chroma vector from its (R−L, B−L) coordinates.
vec3 ceChroma(vec2 ab) { return vec3(ab.x, -(${xe} * ab.x + ${Oe} * ab.y) / ${be}, ab.y); }
`, Be = `
{
  float dilation = ceDilation(uPassIndex);
  float fade = ceFade(dilation);
  float sharp = ceLevel(sharpA, sharpB, uPassIndex);
  vec3 st = ceState(vUv);
  vec2 abC = st.xy * 100.0;
  vec3 abC3 = ceChroma(abC);
  vec2 sum = vec2(0.0);
  float wsum = 0.0;
  if (fade > 0.0) {
    for (int dy = -2; dy <= 2; dy++) {
      for (int dx = -2; dx <= 2; dx++) {
        vec2 abS = ceState(vUv + vec2(float(dx), float(dy)) * dilation * uTexel).xy * 100.0;
        vec3 dab = abC3 - ceChroma(abS);
        float w = ceB3(dx) * ceB3(dy) * exp(-sharp * dot(dab, dab));
        sum += w * abS;
        wsum += w;
      }
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
  float acc = st.z + fade * ((1.0 + ceLevel(gainA, gainB, uPassIndex)) * fac * dX - dX) * 0.01;
  c = uPassIndex == uPassCount - 1 ? vec3(acc, 0.0, 0.0) : vec3(coarse * 0.01, acc);
}
`, dt = ["gainA", "gainB", "thrA", "thrB", "sharpA", "sharpB"].map(
  (e) => ({ key: e, glslType: "vec4", default: [0, 0, 0, 0] })
), ft = [
  { key: "active", glslType: "float", default: 0 }
], ht = "lin += vec3(stageResult.x * active);", _e = {
  0: `{
  float d = stageResult.x * active;
  lin += vec3(d, -d * (${xe} / ${be}), 0.0);
}`,
  1: `{
  float d = stageResult.x * active;
  lin += vec3(0.0, -d * (${Oe} / ${be}), d);
}`
};
function fe(e, t, s, o, n, a) {
  return {
    id: le(e),
    name: `Contrast Equalizer · ${t}`,
    // Scene-linear, after exposure/white balance; the three changes are
    // additive so their order among themselves doesn't matter.
    phase: "scene-linear",
    priority: s,
    // darktable decomposes the image as edited so far. Its thresholds and edge
    // weights are absolute, so the source's decomposition rescaled to the
    // exposure would not be the same answer. A later chain's input holds the
    // earlier ones' changes: the luma change is achromatic, so the chroma
    // chains decompose the same chroma, but the B−L chain's edge weights see
    // the R−L chain's change. Version 1 decomposed the decode, the look
    // those edits were made with.
    reads: "current",
    readsCurrentFrom: 2,
    glsl: a,
    uniforms: ft,
    passes: [{ glsl: o, helpers: n, iterations: re, uniforms: dt }],
    // A mask's copy runs its own decomposition with the mask's tables; a chain
    // the mask's curves leave idle is all zeros, so its passes are skipped too.
    mask: { maskable: !0 }
  };
}
function mt() {
  return [
    fe("luma", "luma", 70, ut, it, ht),
    fe("chroma-red", "chroma R−L", 71, Be, $e(0), _e[0]),
    fe("chroma-blue", "chroma B−L", 72, Be, $e(1), _e[1])
  ];
}
const ie = ["L", "c", "s", "Lt", "ct"], Pe = (e) => `${ne}.curve.${e}`, qe = (e) => `${ne}.curvex.${e}`, Fe = `${ne}.mix`, ee = 1;
function Ae(e) {
  return Array.isArray(e) && e.length === y && e.every((t) => typeof t == "number");
}
function Ge(e) {
  const t = Z(te());
  for (const s of ie) {
    const o = e[Pe(s)];
    Ae(o) && (t[s] = [...o]);
  }
  return t;
}
function We(e) {
  const t = J(ce());
  for (const s of ie) {
    const o = e[qe(s)];
    Ae(o) && (t[s] = [...o]);
  }
  return t;
}
function Ke(e) {
  const t = e[Fe];
  return typeof t == "number" ? t : ee;
}
const pt = [0, 0, 0, 0];
function he(e, t, s, o, n) {
  const a = le(e), d = t.some((i) => i !== 0) || s.some((i) => i !== 0), v = (i) => d ? i : pt;
  n[`${a}.gainA`] = v(t.slice(0, 4)), n[`${a}.gainB`] = v(t.slice(4, 8)), n[`${a}.thrA`] = v(s.slice(0, 4)), n[`${a}.thrB`] = v(s.slice(4, 8)), n[`${a}.sharpA`] = v(o.slice(0, 4)), n[`${a}.sharpB`] = v(o.slice(4, 8)), n[`${a}.active`] = d ? 1 : 0;
}
function ue(e, t, s) {
  const o = {};
  for (const i of ie)
    o[Pe(i)] = [...e[i]], o[qe(i)] = [...t[i]];
  o[Fe] = s;
  const n = Array.from({ length: re }, (i, k) => rt(e, t, k, s)), a = ct(e, t, s), d = n.map((i) => i.gainC), v = n.map((i) => i.thrC);
  return he("luma", n.map((i) => i.gainL), n.map((i) => i.thrL), a, o), he("chroma-red", d, v, a, o), he("chroma-blue", d, v, a, o), o;
}
function De(e) {
  return !ie.some((t) => Ae(e[Pe(t)])) || ke.every((t) => `${le(t)}.active` in e) ? null : ue(Ge(e), We(e), Ke(e));
}
const O = y - 1, b = (e) => Array.from({ length: y }, (t, s) => e(s)), q = (e) => ({ ...te(), ...e }), vt = (e, t) => Math.exp(-((1 - e) * (1 - e)) / (t * t)) / (2 * t * Math.sqrt(Math.PI)), gt = 3 / O, bt = (e, t, s) => {
  const o = (n) => [0.5, 1, 2].slice(0, e).reduce((a, d) => a + vt(n, d * gt), 0);
  return q({
    L: b((n) => 0.5 + o(n / O) / t),
    s: b((n) => 0.5 + o(n / O) / t),
    Lt: b((n) => o(n / O) / s),
    ct: b((n) => o(n / O) / s)
  });
}, yt = [
  [3, 16, 128],
  [2, 24, 192],
  [1, 32, 128]
], Lt = [
  ["large", 3],
  ["medium", 2],
  ["fine", 1]
], Ne = [
  { id: "flat", label: "Flat (reset)", build: () => te() },
  {
    id: "coarse",
    label: "Coarse",
    build: () => q({
      L: b((e) => Math.max(0.5, 0.75 - 0.5 * e / O)),
      c: b((e) => Math.max(0.5, 0.55 - 0.5 * e / O)),
      s: b((e) => Math.min(0.5, 0.2 + 0.35 * e / O))
    })
  },
  {
    id: "denoise-sharpen",
    label: "Denoise & sharpen",
    build: () => q({
      L: b((e) => 0.5 + 0.25 * e / y),
      Lt: b((e) => 0.2 * e / y),
      ct: b((e) => 0.3 * e / y)
    })
  },
  {
    id: "sharpen",
    label: "Sharpen",
    build: () => q({ L: b((e) => 0.5 + 0.25 * e / y) })
  },
  {
    id: "denoise-chroma",
    label: "Denoise chroma",
    build: () => q({
      s: b(() => 0),
      ct: b((e) => Math.max(0, 0.6 * e / y - 0.3))
    })
  },
  {
    id: "denoise",
    label: "Denoise",
    build: () => q({
      Lt: b((e) => 0.2 * e / y),
      ct: b((e) => 0.3 * e / y)
    })
  },
  {
    id: "bloom",
    label: "Bloom",
    build: () => q({
      L: b((e) => e === 0 ? 0.5 : Math.min(0.5, 0.3 + 0.35 * e / O)),
      s: b(() => 0)
    })
  },
  {
    id: "clarity",
    label: "Clarity (local contrast)",
    build: () => q({ L: b(() => 0.6), c: b(() => 0.55), s: b(() => 0) })
  },
  ...yt.flatMap(
    ([e, t, s]) => Lt.map(([o, n]) => ({
      id: `deblur-${o}-${e}`,
      label: `Deblur · ${o} blur · strength ${e}`,
      build: () => bt(n, t, s)
    }))
  )
], ae = [
  { key: "luma", label: "luma", primary: "L", thr: "Lt" },
  { key: "chroma", label: "chroma", primary: "c", thr: "ct" },
  { key: "edges", label: "edges", primary: "s", thr: null }
];
function St(e) {
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
const Xe = (e, t, s) => {
  const [o, n, a, d] = e.ch[t];
  return `rgba(${o},${n},${a},${d * (s ? 0.5 : 1)})`;
}, h = 6, ye = 13, X = 64, Ct = 1 / y, kt = 0.25 / y, Pt = 1;
function Le(e) {
  return e < 0 ? 0 : e > 1 ? 1 : e;
}
function Se(e, t, s, o, n) {
  return e.map((a, d) => {
    const v = s - t[d], i = Math.exp(-(v * v) / (n * n));
    return Le((1 - i) * a + i * o);
  });
}
function At(e, t, s, o, n, a, d, v, i, k, L, E, S) {
  const T = t - 2 * h, I = s - 2 * h - ye, m = (c) => h + c * T, p = (c) => h + (1 - c) * I;
  e.clearRect(0, 0, t, s), e.strokeStyle = `rgba(${S.ink},0.8)`, e.lineWidth = 1, e.strokeRect(h, h, T, I), e.strokeStyle = `rgba(${S.ink},0.22)`;
  for (let c = 1; c < 8; c++)
    e.beginPath(), e.moveTo(m(c / 8), h), e.lineTo(m(c / 8), h + I), e.stroke(), e.beginPath(), e.moveTo(h, h + c / 8 * I), e.lineTo(h + T, h + c / 8 * I), e.stroke();
  e.fillStyle = `rgba(${S.ink},0.10)`;
  for (let c = 1; c < K.length; c += 2) {
    const P = m(Math.min(K[c - 1], K[c])), $ = m(Math.max(K[c - 1], K[c]));
    e.fillRect(P, h, $ - P, I);
  }
  const D = [...ae.filter((c) => c.key !== a.key), a];
  for (const c of D) {
    const P = c.key !== a.key, $ = ge(c.primary, n[c.primary], o[c.primary], v);
    if (e.beginPath(), c.thr) {
      const B = ge(c.thr, n[c.thr], o[c.thr], v);
      e.moveTo(m(1), p(x(B.xs, B.ys, 1)));
      for (let M = X - 2; M >= 0; M--) {
        const U = M / (X - 1);
        e.lineTo(m(U), p(x(B.xs, B.ys, U)));
      }
      for (let M = 0; M < X; M++) {
        const U = M / (X - 1);
        e.lineTo(m(U), p(x($.xs, $.ys, U)));
      }
    } else {
      e.moveTo(m(0), p(0));
      for (let B = 0; B < X; B++) {
        const M = B / (X - 1);
        e.lineTo(m(M), p(x($.xs, $.ys, M)));
      }
      e.lineTo(m(1), p(0));
    }
    e.closePath();
    const A = Xe(S, c.primary, P);
    e.strokeStyle = A, e.fillStyle = A, e.lineWidth = 2, e.stroke(), e.fill();
  }
  if ((k || i !== null && !i.strip && i.y > 0) && i) {
    const c = n[d], P = o[d];
    e.lineWidth = 1;
    const $ = d === a.primary ? S.dotBoost : S.dotThr;
    for (let C = 0; C < y; C++)
      e.beginPath(), e.arc(m(c[C]), p(P[C]), 3, 0, Math.PI * 2), e.strokeStyle = $, e.fillStyle = $, E === C ? e.fill() : e.stroke();
    const A = Se(P, c, i.x, 1, L), B = Se(P, c, i.x, 0, L);
    e.beginPath();
    for (let C = 0; C < X; C++) {
      const N = C / (X - 1), _ = x(c, A, N);
      C === 0 ? e.moveTo(m(N), p(_)) : e.lineTo(m(N), p(_));
    }
    for (let C = X - 1; C >= 0; C--) {
      const N = C / (X - 1);
      e.lineTo(m(N), p(x(c, B, N)));
    }
    e.closePath(), e.fillStyle = Xe(S, a.primary, !1), e.fill(), e.beginPath(), e.arc(m(i.x), p(x(c, P, i.x)), L * T, 0, Math.PI * 2), e.strokeStyle = S.circle, e.lineWidth = 1, e.stroke(), e.fillStyle = `rgba(${S.ink},0.85)`, e.font = "bold 10px sans-serif", e.textAlign = "center", e.textBaseline = "middle", e.save(), e.translate(h + 10, h + I * 0.5), e.rotate(-Math.PI / 2), e.fillText("coarse", 0, 0), e.restore(), e.save(), e.translate(h + T - 6, h + I * 0.5), e.rotate(-Math.PI / 2), e.fillText("fine", 0, 0), e.restore();
    const [M, U] = d === "Lt" || d === "ct" ? ["smooth", "noisy"] : d === "s" ? ["bold", "dull"] : ["contrasty", "smooth"];
    e.fillText(M, h + T / 2, h + 9), e.fillText(U, h + T / 2, h + I - 9);
  }
  e.strokeStyle = `rgba(${S.ink},0.9)`, e.fillStyle = `rgba(${S.ink},0.9)`, e.lineWidth = 1;
  const G = h + I + 3;
  for (let c = 1; c < y - 1; c++) {
    const P = m(n[a.primary][c]);
    e.beginPath(), e.moveTo(P - 3.5, G + 7), e.lineTo(P, G), e.lineTo(P + 3.5, G + 7), e.closePath(), E === c ? e.fill() : e.stroke();
  }
}
const wt = "Drag to shape the curve · wheel sets the radius · drag under the graph to move a node · double-click resets the curve.";
function Ue() {
  const e = z().react, { useState: t, useRef: s, useEffect: o } = e, n = z().components.Slider, { SegmentedControl: a, Select: d, tokens: v } = z().ui, i = z().develop.useParamScope(), k = i.getParams(), L = Ge(k), E = We(k), S = Ke(k), [T, I] = t(() => z().settings.get("channel", "luma")), [m, p] = t("L"), [D, we] = t(() => z().settings.get("radius", Ct)), [G, c] = t(null), [P, $] = t(-1), [A, B] = t({ w: 240, h: 160 }), [M, U] = t(0), C = s(null), N = s(null), _ = s(null), Ee = s(D);
  Ee.current = D;
  const Re = s(0), R = ae.find((r) => r.key === T), H = m === R.primary || m === R.thr ? m : R.primary;
  o(() => {
    const r = C.current;
    if (!r) return;
    const l = new ResizeObserver((f) => {
      const g = f[0].contentRect.width;
      g > 0 && B({ w: Math.round(g), h: Math.round(g * 0.6) + ye });
    });
    return l.observe(r), () => l.disconnect();
  }, []), o(
    () => z().stores.useThemeStore.subscribe((r, l) => {
      r.activeId !== l.activeId && (Re.current += 1, U(Re.current));
    }),
    []
  ), o(() => {
    const r = N.current;
    if (!r) return;
    const l = (f) => {
      f.preventDefault();
      const g = 1 - 0.1 * Math.sign(f.deltaY), u = Math.min(Pt, Math.max(kt, Ee.current * g));
      we(u), z().settings.set("radius", u);
    };
    return r.addEventListener("wheel", l, { passive: !1 }), () => r.removeEventListener("wheel", l);
  }, []), o(() => {
    const r = N.current;
    if (!r) return;
    const l = window.devicePixelRatio || 1;
    r.width = A.w * l, r.height = A.h * l;
    const f = r.getContext("2d");
    if (!f) return;
    f.setTransform(l, 0, 0, l, 0, 0);
    const g = getComputedStyle(r).backgroundColor.match(/\d+(?:\.\d+)?/g), u = g ? (Number(g[0]) + Number(g[1]) + Number(g[2])) / (3 * 255) < 0.5 : !0, w = G !== null || _.current !== null;
    At(
      f,
      A.w,
      A.h,
      L,
      E,
      R,
      H,
      w ? 1 : S,
      G,
      _.current !== null,
      D,
      P,
      St(u)
    );
  }, [k, T, m, D, A, G, P, M]);
  const Ve = A.w - 2 * h, Ie = A.h - 2 * h - ye, Me = (r) => {
    const l = r.currentTarget.getBoundingClientRect(), f = l.width > 0 ? A.w / l.width : 1, g = l.height > 0 ? A.h / l.height : 1, u = (r.clientX - l.left) * f, w = (r.clientY - l.top) * g;
    return {
      x: Le((u - h) / Ve),
      y: Le(1 - (w - h) / Ie),
      strip: w > h + Ie
    };
  }, de = (r) => {
    const l = E[R.primary];
    let f = 0, g = Math.abs(l[0] - r);
    for (let u = 1; u < y; u++) {
      const w = Math.abs(l[u] - r);
      w < g && (g = w, f = u);
    }
    return f;
  }, Y = (r, l, f = S) => i.setParams(ue(r, l, f)), oe = () => i.commit("Contrast Equalizer"), Ye = (r) => {
    const { x: l, y: f, strip: g } = Me(r);
    if (r.currentTarget.setPointerCapture(r.pointerId), g)
      _.current = {
        mode: "x",
        ch2: H,
        node: de(l),
        snapC: Z(L),
        snapX: J(E),
        pick: 0,
        fx: l,
        moved: !1
      };
    else {
      const u = x(E[H], L[H], l) - f;
      _.current = {
        mode: "y",
        ch2: H,
        node: -1,
        snapC: Z(L),
        snapX: J(E),
        pick: u,
        fx: l,
        moved: !1
      };
    }
  }, je = (r) => {
    const { x: l, y: f, strip: g } = Me(r), u = _.current;
    if (u) {
      if (u.mode === "x") {
        if (u.node > 0 && u.node < y - 1) {
          const w = u.snapX[R.primary], se = Math.min(w[u.node + 1] - 1e-3, Math.max(w[u.node - 1] + 1e-3, l)), j = J(u.snapX);
          j[R.primary][u.node] = se, R.thr && (j[R.thr][u.node] = se), u.moved = !0, Y(u.snapC, j);
        }
        c({ x: l, y: f, strip: !1 });
      } else {
        const w = Z(u.snapC);
        w[u.ch2] = Se(u.snapC[u.ch2], u.snapX[u.ch2], u.fx, f + u.pick, D), u.moved = !0, Y(w, u.snapX), c({ x: u.fx, y: f, strip: !1 });
      }
      return;
    }
    if (c({ x: l, y: f, strip: g }), g)
      $(de(l));
    else if ($(-1), R.thr) {
      const w = de(l), se = Math.abs(f - L[R.primary][w]), j = Math.abs(f - L[R.thr][w]);
      p(se <= j ? R.primary : R.thr);
    } else
      p(R.primary);
  }, Ze = () => {
    const r = _.current;
    _.current = null, r && r.moved && oe();
  }, Je = () => {
    _.current || (c(null), $(-1));
  }, Qe = () => {
    const r = Z(L);
    r[H] = Array.from({ length: y }, () => W[H]);
    const l = J(E);
    l[H] = [...Ce], Y(r, l), oe();
  }, et = V(a, {
    value: T,
    size: "sm",
    options: ae.map((r) => ({ value: r.key, label: r.label })),
    onChange: (r) => {
      const l = ae.find((f) => f.key === r);
      I(l.key), p(l.primary), z().settings.set("channel", l.key);
    }
  }), tt = V(
    "div",
    { ref: C, style: { width: "100%" } },
    V("canvas", {
      ref: N,
      title: wt,
      style: {
        width: A.w,
        height: A.h,
        touchAction: "none",
        borderRadius: 4,
        background: v.surface0,
        cursor: "crosshair",
        display: "block"
      },
      onPointerDown: Ye,
      onPointerMove: je,
      onPointerUp: Ze,
      onPointerLeave: Je,
      onDoubleClick: Qe
    })
  ), nt = V(d, {
    value: "",
    style: { width: "100%" },
    onChange: (r) => {
      const l = Ne.find((f) => f.id === r);
      l && (Y(l.build(), ce(), ee), oe());
    },
    options: [
      { value: "", label: "Presets…" },
      ...Ne.map((r) => ({ value: r.id, label: r.label }))
    ]
  });
  return V(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 6, padding: 8 } },
    et,
    tt,
    V(n, {
      label: "Mix",
      value: S,
      min: 0,
      max: 3,
      step: 0.01,
      defaultValue: ee,
      onChange: (r) => Y(L, E, r),
      onCommit: oe
    }),
    nt
  );
}
const Et = `${ne}.panel`;
function ze(e, t) {
  if (!t || e.params.masks !== t.params.masks)
    for (const o of e.params.masks) {
      if (t != null && t.params.masks.some((a) => a.id === o.id && a.bag === o.bag)) continue;
      const n = o.bag ? De(o.bag) : null;
      n && e.updateMaskBag(o.id, n);
    }
  if (t && e.paramBag === t.paramBag) return;
  const s = De(e.paramBag);
  s && e.setDynParams(s);
}
let F = null;
function Rt(e) {
  const t = e.stores.useDevelopStore.getState();
  t.setDynParams(ue(te(), ce(), ee)), t.commitEdit("Contrast Equalizer reset");
}
function It(e) {
  ot(e);
  for (const t of mt()) e.registerProcessingStage(t);
  e.registerPanel({
    id: Et,
    title: "Contrast Equalizer",
    component: Ue,
    defaultDock: { module: "develop", direction: "right", order: 7, width: 268 },
    modules: ["develop"],
    onReset: () => Rt(e),
    // The same panel edits a mask's curves in the Masking panel's Adjust tab.
    // It writes the curves and every chain's tables together, so it owns both.
    mask: { component: Ue, owns: Object.keys(ue(te(), ce(), ee)) }
  }), F == null || F(), F = e.stores.useDevelopStore.subscribe(ze), ze(e.stores.useDevelopStore.getState(), null);
}
function Mt() {
  F == null || F(), F = null;
  const e = globalThis.safelight;
  if (e)
    for (const t of ke) e.unregisterProcessingStage(le(t));
}
export {
  It as activate,
  Mt as deactivate
};
//# sourceMappingURL=index.js.map
