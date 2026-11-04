let me = null, pe = null;
function st(e) {
  me = e.react, pe = e;
}
function H() {
  if (!pe) throw new Error("[contrast-equalizer] api used before activate()");
  return pe;
}
function rt() {
  if (!me) throw new Error("[contrast-equalizer] runtime used before activate()");
  return me;
}
function q(e, t, ...s) {
  return rt().createElement(e, t, ...s);
}
const y = 6, Ce = Array.from({ length: y }, (e, t) => t / (y - 1)), K = {
  L: 0.5,
  c: 0.5,
  s: 0.5,
  Lt: 0,
  ct: 0
}, at = ["L", "c", "s", "Lt", "ct"];
function te() {
  const e = (t) => Array.from({ length: y }, () => t);
  return {
    L: e(K.L),
    c: e(K.c),
    s: e(K.s),
    Lt: e(K.Lt),
    ct: e(K.ct)
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
const ae = 8, V = Array.from(
  { length: ae },
  (e, t) => 1 - (t + 0.5) / ae
);
function ve(e) {
  return e < 0 ? 0 : e > 1 ? 1 : e;
}
function z(e, t, s) {
  const o = t.length;
  let n = o - 2;
  for (let p = 0; p < o - 2; p++)
    if (s < e[p + 1]) {
      n = p;
      break;
    }
  const r = (p, _) => (t[_] - t[p]) / (e[_] - e[p]), d = n === 0 ? r(0, 1) : r(n - 1, n + 1), v = n === o - 2 ? r(o - 2, o - 1) : r(n, n + 2), i = e[n + 1] - e[n], k = (s - e[n]) / i, L = k * k, E = L * k, S = 2 * E - 3 * L + 1, T = E - 2 * L + k, M = -2 * E + 3 * L, m = E - L;
  return ve(S * t[n] + T * i * d + M * t[n + 1] + m * i * v);
}
function be(e, t, s, o) {
  if (o === 1) return { xs: t, ys: s };
  const n = K[e];
  return {
    xs: t.map((r, d) => ve(r + (o - 1) * (r - Ce[d]))),
    ys: s.map((r) => ve(r + (o - 1) * (r - n)))
  };
}
function Q(e, t, s, o, n) {
  const { xs: r, ys: d } = be(s, t[s], e[s], n);
  return z(r, d, o);
}
function ct(e, t, s, o) {
  const n = V[s], r = Q(e, t, "L", n, o), d = Q(e, t, "c", n, o), v = Q(e, t, "Lt", n, o), i = Q(e, t, "ct", n, o), k = Math.pow(2, -7 * (1 - n));
  return {
    gainL: 2 * r * (2 * r) - 1,
    gainC: 2 * d * (2 * d) - 1,
    thrL: k * 10 * v,
    thrC: k * 20 * i
  };
}
function lt(e, t, s) {
  return V.map((o) => 25e-4 * Q(e, t, "s", o, s));
}
const ne = "contrast-equalizer", ke = ["luma", "chroma-red", "chroma-blue"];
function Te(e) {
  let t = 0;
  for (let s = 0; s < e.length; s++) t = (t << 5) - t + e.charCodeAt(s) | 0;
  return (t >>> 0).toString(36).slice(0, 4);
}
const it = (() => {
  const e = {}, t = /* @__PURE__ */ new Set();
  for (const s of ke) {
    const o = `${ne}.${s}`;
    let n = o;
    for (let r = 1; t.has(Te(n)) && r < 1e3; r++) n = `${o}-${r}`;
    t.add(Te(n)), e[s] = n;
  }
  return e;
})(), le = (e) => it[e], Ue = "0.2126", ge = "0.7152", Oe = "0.0722", He = `
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
`, ut = `${He}
vec3 ceState(vec2 uv) {
  vec3 p = readPrev(uv);
  return uPassIndex == 0 ? vec3(luma(p), 0.0, 0.0) : p;
}
float ceCoarse(vec3 st) { return (st.x + st.y) * 100.0; }
`, dt = `
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
`, Ie = (e) => `${He}
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
vec3 ceChroma(vec2 ab) { return vec3(ab.x, -(${Ue} * ab.x + ${Oe} * ab.y) / ${ge}, ab.y); }
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
`, ft = ["gainA", "gainB", "thrA", "thrB", "sharpA", "sharpB"].map(
  (e) => ({ key: e, glslType: "vec4", default: [0, 0, 0, 0] })
), ht = [
  { key: "active", glslType: "float", default: 0 }
], mt = "lin += vec3(stageResult.x * active);", De = {
  0: `{
  float d = stageResult.x * active;
  lin += vec3(d, -d * (${Ue} / ${ge}), 0.0);
}`,
  1: `{
  float d = stageResult.x * active;
  lin += vec3(0.0, -d * (${Oe} / ${ge}), d);
}`
};
function fe(e, t, s, o, n, r) {
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
    glsl: r,
    uniforms: ht,
    passes: [{ glsl: o, helpers: n, iterations: ae, uniforms: ft }],
    // A mask's copy runs its own decomposition with the mask's tables; a chain
    // the mask's curves leave idle is all zeros, so its passes are skipped too.
    mask: { maskable: !0 }
  };
}
function pt() {
  return [
    fe("luma", "luma", 70, dt, ut, mt),
    fe("chroma-red", "chroma R−L", 71, Be, Ie(0), De[0]),
    fe("chroma-blue", "chroma B−L", 72, Be, Ie(1), De[1])
  ];
}
const ie = ["L", "c", "s", "Lt", "ct"], Pe = (e) => `${ne}.curve.${e}`, qe = (e) => `${ne}.curvex.${e}`, Fe = `${ne}.mix`, ee = 1;
function we(e) {
  return Array.isArray(e) && e.length === y && e.every((t) => typeof t == "number");
}
function Ge(e) {
  const t = Z(te());
  for (const s of ie) {
    const o = e[Pe(s)];
    we(o) && (t[s] = [...o]);
  }
  return t;
}
function We(e) {
  const t = J(ce());
  for (const s of ie) {
    const o = e[qe(s)];
    we(o) && (t[s] = [...o]);
  }
  return t;
}
function Ke(e) {
  const t = e[Fe];
  return typeof t == "number" ? t : ee;
}
const vt = [0, 0, 0, 0];
function he(e, t, s, o, n) {
  const r = le(e), d = t.some((i) => i !== 0) || s.some((i) => i !== 0), v = (i) => d ? i : vt;
  n[`${r}.gainA`] = v(t.slice(0, 4)), n[`${r}.gainB`] = v(t.slice(4, 8)), n[`${r}.thrA`] = v(s.slice(0, 4)), n[`${r}.thrB`] = v(s.slice(4, 8)), n[`${r}.sharpA`] = v(o.slice(0, 4)), n[`${r}.sharpB`] = v(o.slice(4, 8)), n[`${r}.active`] = d ? 1 : 0;
}
function ue(e, t, s) {
  const o = {};
  for (const i of ie)
    o[Pe(i)] = [...e[i]], o[qe(i)] = [...t[i]];
  o[Fe] = s;
  const n = Array.from({ length: ae }, (i, k) => ct(e, t, k, s)), r = lt(e, t, s), d = n.map((i) => i.gainC), v = n.map((i) => i.thrC);
  return he("luma", n.map((i) => i.gainL), n.map((i) => i.thrL), r, o), he("chroma-red", d, v, r, o), he("chroma-blue", d, v, r, o), o;
}
function _e(e) {
  return !ie.some((t) => we(e[Pe(t)])) || ke.every((t) => `${le(t)}.active` in e) ? null : ue(Ge(e), We(e), Ke(e));
}
const U = y - 1, g = (e) => Array.from({ length: y }, (t, s) => e(s)), F = (e) => ({ ...te(), ...e }), bt = (e, t) => Math.exp(-((1 - e) * (1 - e)) / (t * t)) / (2 * t * Math.sqrt(Math.PI)), gt = 3 / U, yt = (e, t, s) => {
  const o = (n) => [0.5, 1, 2].slice(0, e).reduce((r, d) => r + bt(n, d * gt), 0);
  return F({
    L: g((n) => 0.5 + o(n / U) / t),
    s: g((n) => 0.5 + o(n / U) / t),
    Lt: g((n) => o(n / U) / s),
    ct: g((n) => o(n / U) / s)
  });
}, Lt = [
  [3, 16, 128],
  [2, 24, 192],
  [1, 32, 128]
], St = [
  ["large", 3],
  ["medium", 2],
  ["fine", 1]
], Ne = [
  { id: "flat", label: "Flat (reset)", build: () => te() },
  {
    id: "coarse",
    label: "Coarse",
    build: () => F({
      L: g((e) => Math.max(0.5, 0.75 - 0.5 * e / U)),
      c: g((e) => Math.max(0.5, 0.55 - 0.5 * e / U)),
      s: g((e) => Math.min(0.5, 0.2 + 0.35 * e / U))
    })
  },
  {
    id: "denoise-sharpen",
    label: "Denoise & sharpen",
    build: () => F({
      L: g((e) => 0.5 + 0.25 * e / y),
      Lt: g((e) => 0.2 * e / y),
      ct: g((e) => 0.3 * e / y)
    })
  },
  {
    id: "sharpen",
    label: "Sharpen",
    build: () => F({ L: g((e) => 0.5 + 0.25 * e / y) })
  },
  {
    id: "denoise-chroma",
    label: "Denoise chroma",
    build: () => F({
      s: g(() => 0),
      ct: g((e) => Math.max(0, 0.6 * e / y - 0.3))
    })
  },
  {
    id: "denoise",
    label: "Denoise",
    build: () => F({
      Lt: g((e) => 0.2 * e / y),
      ct: g((e) => 0.3 * e / y)
    })
  },
  {
    id: "bloom",
    label: "Bloom",
    build: () => F({
      L: g((e) => e === 0 ? 0.5 : Math.min(0.5, 0.3 + 0.35 * e / U)),
      s: g(() => 0)
    })
  },
  {
    id: "clarity",
    label: "Clarity (local contrast)",
    build: () => F({ L: g(() => 0.6), c: g(() => 0.55), s: g(() => 0) })
  },
  ...Lt.flatMap(
    ([e, t, s]) => St.map(([o, n]) => ({
      id: `deblur-${o}-${e}`,
      label: `Deblur · ${o} blur · strength ${e}`,
      build: () => yt(n, t, s)
    }))
  )
], re = [
  { key: "luma", label: "luma", primary: "L", thr: "Lt" },
  { key: "chroma", label: "chroma", primary: "c", thr: "ct" },
  { key: "edges", label: "edges", primary: "s", thr: null }
];
function Ct(e) {
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
  const [o, n, r, d] = e.ch[t];
  return `rgba(${o},${n},${r},${d * (s ? 0.5 : 1)})`;
}, h = 6, ye = 13, X = 64, kt = 1 / y, Pt = 0.25 / y, wt = 1;
function Le(e) {
  return e < 0 ? 0 : e > 1 ? 1 : e;
}
function Se(e, t, s, o, n) {
  return e.map((r, d) => {
    const v = s - t[d], i = Math.exp(-(v * v) / (n * n));
    return Le((1 - i) * r + i * o);
  });
}
function At(e, t, s, o, n, r, d, v, i, k, L, E, S) {
  const T = t - 2 * h, M = s - 2 * h - ye, m = (l) => h + l * T, p = (l) => h + (1 - l) * M;
  e.clearRect(0, 0, t, s), e.strokeStyle = `rgba(${S.ink},0.8)`, e.lineWidth = 1, e.strokeRect(h, h, T, M), e.strokeStyle = `rgba(${S.ink},0.22)`;
  for (let l = 1; l < 8; l++)
    e.beginPath(), e.moveTo(m(l / 8), h), e.lineTo(m(l / 8), h + M), e.stroke(), e.beginPath(), e.moveTo(h, h + l / 8 * M), e.lineTo(h + T, h + l / 8 * M), e.stroke();
  e.fillStyle = `rgba(${S.ink},0.10)`;
  for (let l = 1; l < V.length; l += 2) {
    const P = m(Math.min(V[l - 1], V[l])), I = m(Math.max(V[l - 1], V[l]));
    e.fillRect(P, h, I - P, M);
  }
  const _ = [...re.filter((l) => l.key !== r.key), r];
  for (const l of _) {
    const P = l.key !== r.key, I = be(l.primary, n[l.primary], o[l.primary], v);
    if (e.beginPath(), l.thr) {
      const B = be(l.thr, n[l.thr], o[l.thr], v);
      e.moveTo(m(1), p(z(B.xs, B.ys, 1)));
      for (let $ = X - 2; $ >= 0; $--) {
        const x = $ / (X - 1);
        e.lineTo(m(x), p(z(B.xs, B.ys, x)));
      }
      for (let $ = 0; $ < X; $++) {
        const x = $ / (X - 1);
        e.lineTo(m(x), p(z(I.xs, I.ys, x)));
      }
    } else {
      e.moveTo(m(0), p(0));
      for (let B = 0; B < X; B++) {
        const $ = B / (X - 1);
        e.lineTo(m($), p(z(I.xs, I.ys, $)));
      }
      e.lineTo(m(1), p(0));
    }
    e.closePath();
    const w = Xe(S, l.primary, P);
    e.strokeStyle = w, e.fillStyle = w, e.lineWidth = 2, e.stroke(), e.fill();
  }
  if ((k || i !== null && !i.strip && i.y > 0) && i) {
    const l = n[d], P = o[d];
    e.lineWidth = 1;
    const I = d === r.primary ? S.dotBoost : S.dotThr;
    for (let C = 0; C < y; C++)
      e.beginPath(), e.arc(m(l[C]), p(P[C]), 3, 0, Math.PI * 2), e.strokeStyle = I, e.fillStyle = I, E === C ? e.fill() : e.stroke();
    const w = Se(P, l, i.x, 1, L), B = Se(P, l, i.x, 0, L);
    e.beginPath();
    for (let C = 0; C < X; C++) {
      const N = C / (X - 1), D = z(l, w, N);
      C === 0 ? e.moveTo(m(N), p(D)) : e.lineTo(m(N), p(D));
    }
    for (let C = X - 1; C >= 0; C--) {
      const N = C / (X - 1);
      e.lineTo(m(N), p(z(l, B, N)));
    }
    e.closePath(), e.fillStyle = Xe(S, r.primary, !1), e.fill(), e.beginPath(), e.arc(m(i.x), p(z(l, P, i.x)), L * T, 0, Math.PI * 2), e.strokeStyle = S.circle, e.lineWidth = 1, e.stroke(), e.fillStyle = `rgba(${S.ink},0.85)`, e.font = "bold 10px sans-serif", e.textAlign = "center", e.textBaseline = "middle", e.save(), e.translate(h + 10, h + M * 0.5), e.rotate(-Math.PI / 2), e.fillText("coarse", 0, 0), e.restore(), e.save(), e.translate(h + T - 6, h + M * 0.5), e.rotate(-Math.PI / 2), e.fillText("fine", 0, 0), e.restore();
    const [$, x] = d === "Lt" || d === "ct" ? ["smooth", "noisy"] : d === "s" ? ["bold", "dull"] : ["contrasty", "smooth"];
    e.fillText($, h + T / 2, h + 9), e.fillText(x, h + T / 2, h + M - 9);
  }
  e.strokeStyle = `rgba(${S.ink},0.9)`, e.fillStyle = `rgba(${S.ink},0.9)`, e.lineWidth = 1;
  const W = h + M + 3;
  for (let l = 1; l < y - 1; l++) {
    const P = m(n[r.primary][l]);
    e.beginPath(), e.moveTo(P - 3.5, W + 7), e.lineTo(P, W), e.lineTo(P + 3.5, W + 7), e.closePath(), E === l ? e.fill() : e.stroke();
  }
}
function xe() {
  const e = H().react, { useState: t, useRef: s, useEffect: o } = e, n = H().components.Slider, r = H().ui;
  if (!r)
    return q(
      "div",
      { style: { padding: "10px", fontSize: "11px", color: "var(--color-text-muted)" } },
      "Update Safelight to use this panel."
    );
  const { SegmentedControl: d, Select: v } = r, i = H().develop.useParamScope(), k = i.getParams(), L = Ge(k), E = We(k), S = Ke(k), [T, M] = t(() => H().settings.get("channel", "luma")), [m, p] = t("L"), [_, Ae] = t(() => H().settings.get("radius", kt)), [W, l] = t(null), [P, I] = t(-1), [w, B] = t({ w: 240, h: 160 }), [$, x] = t(0), C = s(null), N = s(null), D = s(null), Ee = s(_);
  Ee.current = _;
  const Re = s(0), R = re.find((a) => a.key === T), O = m === R.primary || m === R.thr ? m : R.primary;
  o(() => {
    const a = C.current;
    if (!a) return;
    const c = new ResizeObserver((f) => {
      const b = f[0].contentRect.width;
      b > 0 && B({ w: Math.round(b), h: Math.round(b * 0.6) + ye });
    });
    return c.observe(a), () => c.disconnect();
  }, []), o(() => {
    const a = () => {
      Re.current += 1, x(Re.current);
    }, c = new MutationObserver(a);
    return c.observe(document.documentElement, { attributes: !0 }), c.observe(document.body, { attributes: !0 }), () => c.disconnect();
  }, []), o(() => {
    const a = N.current;
    if (!a) return;
    const c = (f) => {
      f.preventDefault();
      const b = 1 - 0.1 * Math.sign(f.deltaY), u = Math.min(wt, Math.max(Pt, Ee.current * b));
      Ae(u), H().settings.set("radius", u);
    };
    return a.addEventListener("wheel", c, { passive: !1 }), () => a.removeEventListener("wheel", c);
  }, []), o(() => {
    const a = N.current;
    if (!a) return;
    const c = window.devicePixelRatio || 1;
    a.width = w.w * c, a.height = w.h * c;
    const f = a.getContext("2d");
    if (!f) return;
    f.setTransform(c, 0, 0, c, 0, 0);
    const b = getComputedStyle(a).backgroundColor.match(/\d+(?:\.\d+)?/g), u = b ? (Number(b[0]) + Number(b[1]) + Number(b[2])) / (3 * 255) < 0.5 : !0, A = W !== null || D.current !== null;
    At(
      f,
      w.w,
      w.h,
      L,
      E,
      R,
      O,
      A ? 1 : S,
      W,
      D.current !== null,
      _,
      P,
      Ct(u)
    );
  }, [k, T, m, _, w, W, P, $]);
  const Ve = w.w - 2 * h, Me = w.h - 2 * h - ye, $e = (a) => {
    const c = a.currentTarget.getBoundingClientRect(), f = c.width > 0 ? w.w / c.width : 1, b = c.height > 0 ? w.h / c.height : 1, u = (a.clientX - c.left) * f, A = (a.clientY - c.top) * b;
    return {
      x: Le((u - h) / Ve),
      y: Le(1 - (A - h) / Me),
      strip: A > h + Me
    };
  }, de = (a) => {
    const c = E[R.primary];
    let f = 0, b = Math.abs(c[0] - a);
    for (let u = 1; u < y; u++) {
      const A = Math.abs(c[u] - a);
      A < b && (b = A, f = u);
    }
    return f;
  }, Y = (a, c, f = S) => i.setParams(ue(a, c, f)), oe = () => i.commit("Contrast Equalizer"), Ye = (a) => {
    const { x: c, y: f, strip: b } = $e(a);
    if (a.currentTarget.setPointerCapture(a.pointerId), b)
      D.current = {
        mode: "x",
        ch2: O,
        node: de(c),
        snapC: Z(L),
        snapX: J(E),
        pick: 0,
        fx: c,
        moved: !1
      };
    else {
      const u = z(E[O], L[O], c) - f;
      D.current = {
        mode: "y",
        ch2: O,
        node: -1,
        snapC: Z(L),
        snapX: J(E),
        pick: u,
        fx: c,
        moved: !1
      };
    }
  }, je = (a) => {
    const { x: c, y: f, strip: b } = $e(a), u = D.current;
    if (u) {
      if (u.mode === "x") {
        if (u.node > 0 && u.node < y - 1) {
          const A = u.snapX[R.primary], se = Math.min(A[u.node + 1] - 1e-3, Math.max(A[u.node - 1] + 1e-3, c)), j = J(u.snapX);
          j[R.primary][u.node] = se, R.thr && (j[R.thr][u.node] = se), u.moved = !0, Y(u.snapC, j);
        }
        l({ x: c, y: f, strip: !1 });
      } else {
        const A = Z(u.snapC);
        A[u.ch2] = Se(u.snapC[u.ch2], u.snapX[u.ch2], u.fx, f + u.pick, _), u.moved = !0, Y(A, u.snapX), l({ x: u.fx, y: f, strip: !1 });
      }
      return;
    }
    if (l({ x: c, y: f, strip: b }), b)
      I(de(c));
    else if (I(-1), R.thr) {
      const A = de(c), se = Math.abs(f - L[R.primary][A]), j = Math.abs(f - L[R.thr][A]);
      p(se <= j ? R.primary : R.thr);
    } else
      p(R.primary);
  }, Ze = () => {
    const a = D.current;
    D.current = null, a && a.moved && oe();
  }, Je = () => {
    D.current || (l(null), I(-1));
  }, Qe = () => {
    const a = Z(L);
    a[O] = Array.from({ length: y }, () => K[O]);
    const c = J(E);
    c[O] = [...Ce], Y(a, c), oe();
  }, et = q(d, {
    value: T,
    size: "sm",
    options: re.map((a) => ({ value: a.key, label: a.label })),
    onChange: (a) => {
      const c = re.find((f) => f.key === a);
      M(c.key), p(c.primary), H().settings.set("channel", c.key);
    }
  }), tt = q(
    "div",
    { ref: C, style: { width: "100%" } },
    q("canvas", {
      ref: N,
      style: {
        width: w.w,
        height: w.h,
        touchAction: "none",
        borderRadius: 4,
        background: "var(--color-surface-0)",
        cursor: "crosshair",
        display: "block"
      },
      onPointerDown: Ye,
      onPointerMove: je,
      onPointerUp: Ze,
      onPointerLeave: Je,
      onDoubleClick: Qe
    })
  ), nt = q(v, {
    value: "",
    style: { width: "100%" },
    onChange: (a) => {
      const c = Ne.find((f) => f.id === a);
      c && (Y(c.build(), ce(), ee), oe());
    },
    options: [
      { value: "", label: "Presets…" },
      ...Ne.map((a) => ({ value: a.id, label: a.label }))
    ]
  }), ot = q(
    "p",
    { style: { margin: "2px 0 0", fontSize: 10, color: "var(--color-text-muted)", lineHeight: 1.35 } },
    "Drag to shape the curve · wheel sets the radius · drag under the graph to move a node · double-click resets the curve."
  );
  return q(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 6, padding: 8 } },
    et,
    tt,
    q(n, {
      label: "Mix",
      value: S,
      min: 0,
      max: 3,
      step: 0.01,
      defaultValue: ee,
      onChange: (a) => Y(L, E, a),
      onCommit: oe
    }),
    nt,
    ot
  );
}
const Et = `${ne}.panel`;
function ze(e, t) {
  if (!t || e.params.masks !== t.params.masks)
    for (const o of e.params.masks) {
      if (t != null && t.params.masks.some((r) => r.id === o.id && r.bag === o.bag)) continue;
      const n = o.bag ? _e(o.bag) : null;
      n && e.updateMaskBag(o.id, n);
    }
  if (t && e.paramBag === t.paramBag) return;
  const s = _e(e.paramBag);
  s && e.setDynParams(s);
}
let G = null;
function Rt(e) {
  const t = e.stores.useDevelopStore.getState();
  t.setDynParams(ue(te(), ce(), ee)), t.commitEdit("Contrast Equalizer reset");
}
function Mt(e) {
  st(e);
  for (const t of pt()) e.registerProcessingStage(t);
  e.registerPanel({
    id: Et,
    title: "Contrast Equalizer",
    component: xe,
    defaultDock: { module: "develop", direction: "right", order: 7, width: 268 },
    onReset: () => Rt(e),
    // The same panel edits a mask's curves in the Masking panel's Adjust tab.
    // It writes the curves and every chain's tables together, so it owns both.
    mask: { component: xe, owns: Object.keys(ue(te(), ce(), ee)) }
  }), G == null || G(), G = e.stores.useDevelopStore.subscribe(ze), ze(e.stores.useDevelopStore.getState(), null);
}
function $t() {
  G == null || G(), G = null;
  const e = globalThis.safelight;
  if (e)
    for (const t of ke) e.unregisterProcessingStage(le(t));
}
export {
  Mt as activate,
  $t as deactivate
};
//# sourceMappingURL=index.js.map
