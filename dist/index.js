let pe = null, ve = null;
function ot(e) {
  pe = e.react, ve = e;
}
function q() {
  if (!ve) throw new Error("[contrast-equalizer] api used before activate()");
  return ve;
}
function st() {
  if (!pe) throw new Error("[contrast-equalizer] runtime used before activate()");
  return pe;
}
function O(e, t, ...s) {
  return st().createElement(e, t, ...s);
}
const S = 6, Pe = Array.from({ length: S }, (e, t) => t / (S - 1)), W = {
  L: 0.5,
  c: 0.5,
  s: 0.5,
  Lt: 0,
  ct: 0
}, rt = ["L", "c", "s", "Lt", "ct"];
function le() {
  const e = (t) => Array.from({ length: S }, () => t);
  return {
    L: e(W.L),
    c: e(W.c),
    s: e(W.s),
    Lt: e(W.Lt),
    ct: e(W.ct)
  };
}
function ke() {
  const e = {};
  for (const t of rt) e[t] = [...Pe];
  return e;
}
function j(e) {
  return { L: [...e.L], c: [...e.c], s: [...e.s], Lt: [...e.Lt], ct: [...e.ct] };
}
function J(e) {
  return { L: [...e.L], c: [...e.c], s: [...e.s], Lt: [...e.Lt], ct: [...e.ct] };
}
const ae = 8, K = Array.from(
  { length: ae },
  (e, t) => 1 - (t + 0.5) / ae
);
function ge(e) {
  return e < 0 ? 0 : e > 1 ? 1 : e;
}
function X(e, t, s) {
  const o = t.length;
  let n = o - 2;
  for (let y = 0; y < o - 2; y++)
    if (s < e[y + 1]) {
      n = y;
      break;
    }
  const a = (y, D) => (t[D] - t[y]) / (e[D] - e[y]), d = n === 0 ? a(0, 1) : a(n - 1, n + 1), g = n === o - 2 ? a(o - 2, o - 1) : a(n, n + 2), i = e[n + 1] - e[n], k = (s - e[n]) / i, T = k * k, I = T * k, p = 2 * I - 3 * T + 1, C = I - 2 * T + k, w = -2 * I + 3 * T, v = I - T;
  return ge(p * t[n] + C * i * d + w * t[n + 1] + v * i * g);
}
function ye(e, t, s, o) {
  if (o === 1) return { xs: t, ys: s };
  const n = W[e];
  return {
    xs: t.map((a, d) => ge(a + (o - 1) * (a - Pe[d]))),
    ys: s.map((a) => ge(a + (o - 1) * (a - n)))
  };
}
function Q(e, t, s, o, n) {
  const { xs: a, ys: d } = ye(s, t[s], e[s], n);
  return X(a, d, o);
}
function at(e, t, s, o) {
  const n = K[s], a = Q(e, t, "L", n, o), d = Q(e, t, "c", n, o), g = Q(e, t, "Lt", n, o), i = Q(e, t, "ct", n, o), k = Math.pow(2, -7 * (1 - n));
  return {
    gainL: 2 * a * (2 * a) - 1,
    gainC: 2 * d * (2 * d) - 1,
    thrL: k * 10 * g,
    thrC: k * 20 * i
  };
}
function ct(e, t, s) {
  return K.map((o) => 25e-4 * Q(e, t, "s", o, s));
}
const te = "contrast-equalizer", we = ["luma", "chroma-red", "chroma-blue"];
function Ie(e) {
  let t = 0;
  for (let s = 0; s < e.length; s++) t = (t << 5) - t + e.charCodeAt(s) | 0;
  return (t >>> 0).toString(36).slice(0, 4);
}
const lt = (() => {
  const e = {}, t = /* @__PURE__ */ new Set();
  for (const s of we) {
    const o = `${te}.${s}`;
    let n = o;
    for (let a = 1; t.has(Ie(n)) && a < 1e3; a++) n = `${o}-${a}`;
    t.add(Ie(n)), e[s] = n;
  }
  return e;
})(), ie = (e) => lt[e], ze = "0.2126", be = "0.7152", He = "0.0722", xe = `
// B3 spline 1D weights [1,4,6,4,1]/16.
float ceB3(int d) { d = d < 0 ? -d : d; return d == 0 ? 0.375 : (d == 1 ? 0.25 : 0.0625); }
// Level i of a per-level table split across two vec4s.
float ceLevel(vec4 a, vec4 b, int i) {
  vec4 v = i < 4 ? a : b;
  int k = i < 4 ? i : i - 4;
  return k == 0 ? v.x : (k == 1 ? v.y : (k == 2 ? v.z : v.w));
}
`, it = `${xe}
vec3 ceState(vec2 uv) {
  vec3 p = readPrev(uv);
  return uPrevRaw ? vec3(luma(p), 0.0, 0.0) : p;
}
float ceCoarse(vec3 st) { return (st.x + st.y) * 100.0; }
`, ut = `
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
`, De = (e) => `${xe}
const int CE_COMP = ${e};
vec3 ceState(vec2 uv) {
  vec3 p = readPrev(uv);
  if (uPrevRaw) {
    float L = luma(p);
    return vec3(p.r - L, p.b - L, 0.0);
  }
  return p;
}
// The zero-luma chroma vector from its (R−L, B−L) coordinates.
vec3 ceChroma(vec2 ab) { return vec3(ab.x, -(${ze} * ab.x + ${He} * ab.y) / ${be}, ab.y); }
`, _e = `
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
`, dt = ["gainA", "gainB", "thrA", "thrB", "sharpA", "sharpB"].map(
  (e) => ({ key: e, glslType: "vec4", default: [0, 0, 0, 0] })
), ft = [
  { key: "active", glslType: "float", default: 0 }
], ht = "lin += vec3(stageResult.x * active);", Ne = {
  0: `{
  float d = stageResult.x * active;
  lin += vec3(d, -d * (${ze} / ${be}), 0.0);
}`,
  1: `{
  float d = stageResult.x * active;
  lin += vec3(0.0, -d * (${He} / ${be}), d);
}`
};
function he(e, t, s, o, n, a) {
  return {
    id: ie(e),
    name: `Contrast Equalizer · ${t}`,
    // Scene-linear, after exposure/white balance; the three changes are
    // additive so their order among themselves doesn't matter.
    phase: "scene-linear",
    priority: s,
    glsl: a,
    uniforms: ft,
    passes: [{ glsl: o, helpers: n, iterations: ae, uniforms: dt }]
  };
}
function mt() {
  return [
    he("luma", "luma", 70, ut, it, ht),
    he("chroma-red", "chroma R−L", 71, _e, De(0), Ne[0]),
    he("chroma-blue", "chroma B−L", 72, _e, De(1), Ne[1])
  ];
}
const ue = ["L", "c", "s", "Lt", "ct"], Ae = (e) => `${te}.curve.${e}`, qe = (e) => `${te}.curvex.${e}`, Oe = `${te}.mix`, ce = 1;
function Ee(e) {
  return Array.isArray(e) && e.length === S && e.every((t) => typeof t == "number");
}
function Fe(e) {
  const t = j(le());
  for (const s of ue) {
    const o = e[Ae(s)];
    Ee(o) && (t[s] = [...o]);
  }
  return t;
}
function Ge(e) {
  const t = J(ke());
  for (const s of ue) {
    const o = e[qe(s)];
    Ee(o) && (t[s] = [...o]);
  }
  return t;
}
function We(e) {
  const t = e[Oe];
  return typeof t == "number" ? t : ce;
}
const pt = [0, 0, 0, 0];
function me(e, t, s, o, n) {
  const a = ie(e), d = t.some((i) => i !== 0) || s.some((i) => i !== 0), g = (i) => d ? i : pt;
  n[`${a}.gainA`] = g(t.slice(0, 4)), n[`${a}.gainB`] = g(t.slice(4, 8)), n[`${a}.thrA`] = g(s.slice(0, 4)), n[`${a}.thrB`] = g(s.slice(4, 8)), n[`${a}.sharpA`] = g(o.slice(0, 4)), n[`${a}.sharpB`] = g(o.slice(4, 8)), n[`${a}.active`] = d ? 1 : 0;
}
function Me(e, t, s) {
  const o = {};
  for (const i of ue)
    o[Ae(i)] = [...e[i]], o[qe(i)] = [...t[i]];
  o[Oe] = s;
  const n = Array.from({ length: ae }, (i, k) => at(e, t, k, s)), a = ct(e, t, s), d = n.map((i) => i.gainC), g = n.map((i) => i.thrC);
  return me("luma", n.map((i) => i.gainL), n.map((i) => i.thrL), a, o), me("chroma-red", d, g, a, o), me("chroma-blue", d, g, a, o), o;
}
function vt(e) {
  return !ue.some((t) => Ee(e[Ae(t)])) || we.every((t) => `${ie(t)}.active` in e) ? null : Me(Fe(e), Ge(e), We(e));
}
const U = S - 1, L = (e) => Array.from({ length: S }, (t, s) => e(s)), F = (e) => ({ ...le(), ...e }), gt = (e, t) => Math.exp(-((1 - e) * (1 - e)) / (t * t)) / (2 * t * Math.sqrt(Math.PI)), yt = 3 / U, bt = (e, t, s) => {
  const o = (n) => [0.5, 1, 2].slice(0, e).reduce((a, d) => a + gt(n, d * yt), 0);
  return F({
    L: L((n) => 0.5 + o(n / U) / t),
    s: L((n) => 0.5 + o(n / U) / t),
    Lt: L((n) => o(n / U) / s),
    ct: L((n) => o(n / U) / s)
  });
}, Lt = [
  [3, 16, 128],
  [2, 24, 192],
  [1, 32, 128]
], St = [
  ["large", 3],
  ["medium", 2],
  ["fine", 1]
], Xe = [
  { id: "flat", label: "Flat (reset)", build: () => le() },
  {
    id: "coarse",
    label: "Coarse",
    build: () => F({
      L: L((e) => Math.max(0.5, 0.75 - 0.5 * e / U)),
      c: L((e) => Math.max(0.5, 0.55 - 0.5 * e / U)),
      s: L((e) => Math.min(0.5, 0.2 + 0.35 * e / U))
    })
  },
  {
    id: "denoise-sharpen",
    label: "Denoise & sharpen",
    build: () => F({
      L: L((e) => 0.5 + 0.25 * e / S),
      Lt: L((e) => 0.2 * e / S),
      ct: L((e) => 0.3 * e / S)
    })
  },
  {
    id: "sharpen",
    label: "Sharpen",
    build: () => F({ L: L((e) => 0.5 + 0.25 * e / S) })
  },
  {
    id: "denoise-chroma",
    label: "Denoise chroma",
    build: () => F({
      s: L(() => 0),
      ct: L((e) => Math.max(0, 0.6 * e / S - 0.3))
    })
  },
  {
    id: "denoise",
    label: "Denoise",
    build: () => F({
      Lt: L((e) => 0.2 * e / S),
      ct: L((e) => 0.3 * e / S)
    })
  },
  {
    id: "bloom",
    label: "Bloom",
    build: () => F({
      L: L((e) => e === 0 ? 0.5 : Math.min(0.5, 0.3 + 0.35 * e / U)),
      s: L(() => 0)
    })
  },
  {
    id: "clarity",
    label: "Clarity (local contrast)",
    build: () => F({ L: L(() => 0.6), c: L(() => 0.55), s: L(() => 0) })
  },
  ...Lt.flatMap(
    ([e, t, s]) => St.map(([o, n]) => ({
      id: `deblur-${o}-${e}`,
      label: `Deblur · ${o} blur · strength ${e}`,
      build: () => bt(n, t, s)
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
const Ue = (e, t, s) => {
  const [o, n, a, d] = e.ch[t];
  return `rgba(${o},${n},${a},${d * (s ? 0.5 : 1)})`;
}, h = 6, Le = 13, B = 64, Pt = 1 / S, kt = 0.25 / S, wt = 1;
function Se(e) {
  return e < 0 ? 0 : e > 1 ? 1 : e;
}
function Ce(e, t, s, o, n) {
  return e.map((a, d) => {
    const g = s - t[d], i = Math.exp(-(g * g) / (n * n));
    return Se((1 - i) * a + i * o);
  });
}
function At(e, t, s, o, n, a, d, g, i, k, T, I, p) {
  const C = t - 2 * h, w = s - 2 * h - Le, v = (l) => h + l * C, y = (l) => h + (1 - l) * w;
  e.clearRect(0, 0, t, s), e.strokeStyle = `rgba(${p.ink},0.8)`, e.lineWidth = 1, e.strokeRect(h, h, C, w), e.strokeStyle = `rgba(${p.ink},0.22)`;
  for (let l = 1; l < 8; l++)
    e.beginPath(), e.moveTo(v(l / 8), h), e.lineTo(v(l / 8), h + w), e.stroke(), e.beginPath(), e.moveTo(h, h + l / 8 * w), e.lineTo(h + C, h + l / 8 * w), e.stroke();
  e.fillStyle = `rgba(${p.ink},0.10)`;
  for (let l = 1; l < K.length; l += 2) {
    const P = v(Math.min(K[l - 1], K[l])), R = v(Math.max(K[l - 1], K[l]));
    e.fillRect(P, h, R - P, w);
  }
  const D = [...re.filter((l) => l.key !== a.key), a];
  for (const l of D) {
    const P = l.key !== a.key, R = ye(l.primary, n[l.primary], o[l.primary], g);
    if (e.beginPath(), l.thr) {
      const $ = ye(l.thr, n[l.thr], o[l.thr], g);
      e.moveTo(v(1), y(X($.xs, $.ys, 1)));
      for (let m = B - 2; m >= 0; m--) {
        const N = m / (B - 1);
        e.lineTo(v(N), y(X($.xs, $.ys, N)));
      }
      for (let m = 0; m < B; m++) {
        const N = m / (B - 1);
        e.lineTo(v(N), y(X(R.xs, R.ys, N)));
      }
    } else {
      e.moveTo(v(0), y(0));
      for (let $ = 0; $ < B; $++) {
        const m = $ / (B - 1);
        e.lineTo(v(m), y(X(R.xs, R.ys, m)));
      }
      e.lineTo(v(1), y(0));
    }
    e.closePath();
    const G = Ue(p, l.primary, P);
    e.strokeStyle = G, e.fillStyle = G, e.lineWidth = 2, e.stroke(), e.fill();
  }
  if ((k || i !== null && !i.strip && i.y > 0) && i) {
    const l = n[d], P = o[d];
    e.lineWidth = 1;
    const R = d === a.primary ? p.dotBoost : p.dotThr;
    for (let A = 0; A < S; A++)
      e.beginPath(), e.arc(v(l[A]), y(P[A]), 3, 0, Math.PI * 2), e.strokeStyle = R, e.fillStyle = R, I === A ? e.fill() : e.stroke();
    const G = Ce(P, l, i.x, 1, T), $ = Ce(P, l, i.x, 0, T);
    e.beginPath();
    for (let A = 0; A < B; A++) {
      const z = A / (B - 1), Y = X(l, G, z);
      A === 0 ? e.moveTo(v(z), y(Y)) : e.lineTo(v(z), y(Y));
    }
    for (let A = B - 1; A >= 0; A--) {
      const z = A / (B - 1);
      e.lineTo(v(z), y(X(l, $, z)));
    }
    e.closePath(), e.fillStyle = Ue(p, a.primary, !1), e.fill(), e.beginPath(), e.arc(v(i.x), y(X(l, P, i.x)), T * C, 0, Math.PI * 2), e.strokeStyle = p.circle, e.lineWidth = 1, e.stroke(), e.fillStyle = `rgba(${p.ink},0.85)`, e.font = "bold 10px sans-serif", e.textAlign = "center", e.textBaseline = "middle", e.save(), e.translate(h + 10, h + w * 0.5), e.rotate(-Math.PI / 2), e.fillText("coarse", 0, 0), e.restore(), e.save(), e.translate(h + C - 6, h + w * 0.5), e.rotate(-Math.PI / 2), e.fillText("fine", 0, 0), e.restore();
    const [m, N] = d === "Lt" || d === "ct" ? ["smooth", "noisy"] : d === "s" ? ["bold", "dull"] : ["contrasty", "smooth"];
    e.fillText(m, h + C / 2, h + 9), e.fillText(N, h + C / 2, h + w - 9);
  }
  e.strokeStyle = `rgba(${p.ink},0.9)`, e.fillStyle = `rgba(${p.ink},0.9)`, e.lineWidth = 1;
  const _ = h + w + 3;
  for (let l = 1; l < S - 1; l++) {
    const P = v(n[a.primary][l]);
    e.beginPath(), e.moveTo(P - 3.5, _ + 7), e.lineTo(P, _), e.lineTo(P + 3.5, _ + 7), e.closePath(), I === l ? e.fill() : e.stroke();
  }
}
function Et() {
  const e = q().react, { useState: t, useRef: s, useEffect: o } = e, n = q().stores.useDevelopStore, a = q().components.Slider, d = q().ui;
  if (!d)
    return O(
      "div",
      { style: { padding: "10px", fontSize: "11px", color: "var(--color-text-muted)" } },
      "Update Safelight to use this panel."
    );
  const { SegmentedControl: g, Select: i } = d, k = n((r) => r.paramBag), T = n(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r) => r.setDynParams
  ), I = n((r) => r.commitEdit), p = Fe(k), C = Ge(k), w = We(k), [v, y] = t(() => q().settings.get("channel", "luma")), [D, ne] = t("L"), [_, l] = t(() => q().settings.get("radius", Pt)), [P, R] = t(null), [G, $] = t(-1), [m, N] = t({ w: 240, h: 160 }), [A, z] = t(0), Y = s(null), de = s(null), H = s(null), Re = s(_);
  Re.current = _;
  const $e = s(0), M = re.find((r) => r.key === v), x = D === M.primary || D === M.thr ? D : M.primary;
  o(() => {
    const r = Y.current;
    if (!r) return;
    const c = new ResizeObserver((f) => {
      const b = f[0].contentRect.width;
      b > 0 && N({ w: Math.round(b), h: Math.round(b * 0.6) + Le });
    });
    return c.observe(r), () => c.disconnect();
  }, []), o(() => {
    const r = () => {
      $e.current += 1, z($e.current);
    }, c = new MutationObserver(r);
    return c.observe(document.documentElement, { attributes: !0 }), c.observe(document.body, { attributes: !0 }), () => c.disconnect();
  }, []), o(() => {
    const r = de.current;
    if (!r) return;
    const c = (f) => {
      f.preventDefault();
      const b = 1 - 0.1 * Math.sign(f.deltaY), u = Math.min(wt, Math.max(kt, Re.current * b));
      l(u), q().settings.set("radius", u);
    };
    return r.addEventListener("wheel", c, { passive: !1 }), () => r.removeEventListener("wheel", c);
  }, []), o(() => {
    const r = de.current;
    if (!r) return;
    const c = window.devicePixelRatio || 1;
    r.width = m.w * c, r.height = m.h * c;
    const f = r.getContext("2d");
    if (!f) return;
    f.setTransform(c, 0, 0, c, 0, 0);
    const b = getComputedStyle(r).backgroundColor.match(/\d+(?:\.\d+)?/g), u = b ? (Number(b[0]) + Number(b[1]) + Number(b[2])) / (3 * 255) < 0.5 : !0, E = P !== null || H.current !== null;
    At(
      f,
      m.w,
      m.h,
      p,
      C,
      M,
      x,
      E ? 1 : w,
      P,
      H.current !== null,
      _,
      G,
      Ct(u)
    );
  }, [k, v, D, _, m, P, G, A]);
  const Ke = m.w - 2 * h, Te = m.h - 2 * h - Le, Be = (r) => {
    const c = r.currentTarget.getBoundingClientRect(), f = c.width > 0 ? m.w / c.width : 1, b = c.height > 0 ? m.h / c.height : 1, u = (r.clientX - c.left) * f, E = (r.clientY - c.top) * b;
    return {
      x: Se((u - h) / Ke),
      y: Se(1 - (E - h) / Te),
      strip: E > h + Te
    };
  }, fe = (r) => {
    const c = C[M.primary];
    let f = 0, b = Math.abs(c[0] - r);
    for (let u = 1; u < S; u++) {
      const E = Math.abs(c[u] - r);
      E < b && (b = E, f = u);
    }
    return f;
  }, V = (r, c, f = w) => T(Me(r, c, f)), oe = () => I("Contrast Equalizer"), Ye = (r) => {
    const { x: c, y: f, strip: b } = Be(r);
    if (r.currentTarget.setPointerCapture(r.pointerId), b)
      H.current = {
        mode: "x",
        ch2: x,
        node: fe(c),
        snapC: j(p),
        snapX: J(C),
        pick: 0,
        fx: c,
        moved: !1
      };
    else {
      const u = X(C[x], p[x], c) - f;
      H.current = {
        mode: "y",
        ch2: x,
        node: -1,
        snapC: j(p),
        snapX: J(C),
        pick: u,
        fx: c,
        moved: !1
      };
    }
  }, Ve = (r) => {
    const { x: c, y: f, strip: b } = Be(r), u = H.current;
    if (u) {
      if (u.mode === "x") {
        if (u.node > 0 && u.node < S - 1) {
          const E = u.snapX[M.primary], se = Math.min(E[u.node + 1] - 1e-3, Math.max(E[u.node - 1] + 1e-3, c)), Z = J(u.snapX);
          Z[M.primary][u.node] = se, M.thr && (Z[M.thr][u.node] = se), u.moved = !0, V(u.snapC, Z);
        }
        R({ x: c, y: f, strip: !1 });
      } else {
        const E = j(u.snapC);
        E[u.ch2] = Ce(u.snapC[u.ch2], u.snapX[u.ch2], u.fx, f + u.pick, _), u.moved = !0, V(E, u.snapX), R({ x: u.fx, y: f, strip: !1 });
      }
      return;
    }
    if (R({ x: c, y: f, strip: b }), b)
      $(fe(c));
    else if ($(-1), M.thr) {
      const E = fe(c), se = Math.abs(f - p[M.primary][E]), Z = Math.abs(f - p[M.thr][E]);
      ne(se <= Z ? M.primary : M.thr);
    } else
      ne(M.primary);
  }, Ze = () => {
    const r = H.current;
    H.current = null, r && r.moved && oe();
  }, je = () => {
    H.current || (R(null), $(-1));
  }, Je = () => {
    const r = j(p);
    r[x] = Array.from({ length: S }, () => W[x]);
    const c = J(C);
    c[x] = [...Pe], V(r, c), oe();
  }, Qe = O(g, {
    value: v,
    size: "sm",
    options: re.map((r) => ({ value: r.key, label: r.label })),
    onChange: (r) => {
      const c = re.find((f) => f.key === r);
      y(c.key), ne(c.primary), q().settings.set("channel", c.key);
    }
  }), et = O(
    "div",
    { ref: Y, style: { width: "100%" } },
    O("canvas", {
      ref: de,
      style: {
        width: m.w,
        height: m.h,
        touchAction: "none",
        borderRadius: 4,
        background: "var(--color-surface-0)",
        cursor: "crosshair",
        display: "block"
      },
      onPointerDown: Ye,
      onPointerMove: Ve,
      onPointerUp: Ze,
      onPointerLeave: je,
      onDoubleClick: Je
    })
  ), tt = O(i, {
    value: "",
    style: { width: "100%" },
    onChange: (r) => {
      const c = Xe.find((f) => f.id === r);
      c && (V(c.build(), ke(), ce), oe());
    },
    options: [
      { value: "", label: "Presets…" },
      ...Xe.map((r) => ({ value: r.id, label: r.label }))
    ]
  }), nt = O(
    "p",
    { style: { margin: "2px 0 0", fontSize: 10, color: "var(--color-text-muted)", lineHeight: 1.35 } },
    "Drag to shape the curve · wheel sets the radius · drag under the graph to move a node · double-click resets the curve."
  );
  return O(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 6, padding: 8 } },
    Qe,
    et,
    O(a, {
      label: "Mix",
      value: w,
      min: 0,
      max: 3,
      step: 0.01,
      defaultValue: ce,
      onChange: (r) => V(p, C, r),
      onCommit: oe
    }),
    tt,
    nt
  );
}
const Mt = `${te}.panel`;
let ee = null;
function Rt(e) {
  const t = e.stores.useDevelopStore.getState();
  t.setDynParams(Me(le(), ke(), ce)), t.commitEdit("Contrast Equalizer reset");
}
function $t(e) {
  ot(e);
  for (const t of mt()) e.registerProcessingStage(t);
  e.registerPanel({
    id: Mt,
    title: "Contrast Equalizer",
    component: Et,
    defaultDock: { module: "develop", direction: "right", order: 7, width: 268 },
    onReset: () => Rt(e)
  }), ee = e.stores.useDevelopStore.subscribe(
    (t, s) => {
      if (t.paramBag === s.paramBag) return;
      const o = vt(t.paramBag);
      o && t.setDynParams(o);
    }
  );
}
function Tt() {
  ee == null || ee(), ee = null;
  const e = globalThis.safelight;
  if (e)
    for (const t of we) e.unregisterProcessingStage(ie(t));
}
export {
  $t as activate,
  Tt as deactivate
};
//# sourceMappingURL=index.js.map
