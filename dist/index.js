let me = null, pe = null;
function nt(e) {
  me = e.react, pe = e;
}
function q() {
  if (!pe) throw new Error("[contrast-equalizer] api used before activate()");
  return pe;
}
function ot() {
  if (!me) throw new Error("[contrast-equalizer] runtime used before activate()");
  return me;
}
function O(e, t, ...s) {
  return ot().createElement(e, t, ...s);
}
const y = 6, Se = Array.from({ length: y }, (e, t) => t / (y - 1)), W = {
  L: 0.5,
  c: 0.5,
  s: 0.5,
  Lt: 0,
  ct: 0
}, st = ["L", "c", "s", "Lt", "ct"];
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
  for (const t of st) e[t] = [...Se];
  return e;
}
function j(e) {
  return { L: [...e.L], c: [...e.c], s: [...e.s], Lt: [...e.Lt], ct: [...e.ct] };
}
function Z(e) {
  return { L: [...e.L], c: [...e.c], s: [...e.s], Lt: [...e.Lt], ct: [...e.ct] };
}
const ae = 8, K = Array.from(
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
  const r = (p, _) => (t[_] - t[p]) / (e[_] - e[p]), d = n === 0 ? r(0, 1) : r(n - 1, n + 1), v = n === o - 2 ? r(o - 2, o - 1) : r(n, n + 2), i = e[n + 1] - e[n], P = (s - e[n]) / i, L = P * P, E = L * P, C = 2 * E - 3 * L + 1, T = E - 2 * L + P, R = -2 * E + 3 * L, m = E - L;
  return ve(C * t[n] + T * i * d + R * t[n + 1] + m * i * v);
}
function be(e, t, s, o) {
  if (o === 1) return { xs: t, ys: s };
  const n = W[e];
  return {
    xs: t.map((r, d) => ve(r + (o - 1) * (r - Se[d]))),
    ys: s.map((r) => ve(r + (o - 1) * (r - n)))
  };
}
function J(e, t, s, o, n) {
  const { xs: r, ys: d } = be(s, t[s], e[s], n);
  return z(r, d, o);
}
function rt(e, t, s, o) {
  const n = K[s], r = J(e, t, "L", n, o), d = J(e, t, "c", n, o), v = J(e, t, "Lt", n, o), i = J(e, t, "ct", n, o), P = Math.pow(2, -7 * (1 - n));
  return {
    gainL: 2 * r * (2 * r) - 1,
    gainC: 2 * d * (2 * d) - 1,
    thrL: P * 10 * v,
    thrC: P * 20 * i
  };
}
function at(e, t, s) {
  return K.map((o) => 25e-4 * J(e, t, "s", o, s));
}
const ne = "contrast-equalizer", Pe = ["luma", "chroma-red", "chroma-blue"];
function Te(e) {
  let t = 0;
  for (let s = 0; s < e.length; s++) t = (t << 5) - t + e.charCodeAt(s) | 0;
  return (t >>> 0).toString(36).slice(0, 4);
}
const ct = (() => {
  const e = {}, t = /* @__PURE__ */ new Set();
  for (const s of Pe) {
    const o = `${ne}.${s}`;
    let n = o;
    for (let r = 1; t.has(Te(n)) && r < 1e3; r++) n = `${o}-${r}`;
    t.add(Te(n)), e[s] = n;
  }
  return e;
})(), le = (e) => ct[e], Ue = "0.2126", ge = "0.7152", ze = "0.0722", He = `
// B3 spline 1D weights [1,4,6,4,1]/16.
float ceB3(int d) { d = d < 0 ? -d : d; return d == 0 ? 0.375 : (d == 1 ? 0.25 : 0.0625); }
// Level i of a per-level table split across two vec4s.
float ceLevel(vec4 a, vec4 b, int i) {
  vec4 v = i < 4 ? a : b;
  int k = i < 4 ? i : i - 4;
  return k == 0 ? v.x : (k == 1 ? v.y : (k == 2 ? v.z : v.w));
}
`, lt = `${He}
vec3 ceState(vec2 uv) {
  vec3 p = readPrev(uv);
  return uPrevRaw ? vec3(luma(p), 0.0, 0.0) : p;
}
float ceCoarse(vec3 st) { return (st.x + st.y) * 100.0; }
`, it = `
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
`, Be = (e) => `${He}
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
vec3 ceChroma(vec2 ab) { return vec3(ab.x, -(${Ue} * ab.x + ${ze} * ab.y) / ${ge}, ab.y); }
`, Ie = `
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
`, ut = ["gainA", "gainB", "thrA", "thrB", "sharpA", "sharpB"].map(
  (e) => ({ key: e, glslType: "vec4", default: [0, 0, 0, 0] })
), dt = [
  { key: "active", glslType: "float", default: 0 }
], ft = "lin += vec3(stageResult.x * active);", De = {
  0: `{
  float d = stageResult.x * active;
  lin += vec3(d, -d * (${Ue} / ${ge}), 0.0);
}`,
  1: `{
  float d = stageResult.x * active;
  lin += vec3(0.0, -d * (${ze} / ${ge}), d);
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
    glsl: r,
    uniforms: dt,
    passes: [{ glsl: o, helpers: n, iterations: ae, uniforms: ut }],
    // A mask's copy runs its own decomposition with the mask's tables; a chain
    // the mask's curves leave idle is all zeros, so its passes are skipped too.
    mask: { maskable: !0 }
  };
}
function ht() {
  return [
    fe("luma", "luma", 70, it, lt, ft),
    fe("chroma-red", "chroma R−L", 71, Ie, Be(0), De[0]),
    fe("chroma-blue", "chroma B−L", 72, Ie, Be(1), De[1])
  ];
}
const ie = ["L", "c", "s", "Lt", "ct"], ke = (e) => `${ne}.curve.${e}`, xe = (e) => `${ne}.curvex.${e}`, qe = `${ne}.mix`, ee = 1;
function we(e) {
  return Array.isArray(e) && e.length === y && e.every((t) => typeof t == "number");
}
function Oe(e) {
  const t = j(te());
  for (const s of ie) {
    const o = e[ke(s)];
    we(o) && (t[s] = [...o]);
  }
  return t;
}
function Fe(e) {
  const t = Z(ce());
  for (const s of ie) {
    const o = e[xe(s)];
    we(o) && (t[s] = [...o]);
  }
  return t;
}
function Ge(e) {
  const t = e[qe];
  return typeof t == "number" ? t : ee;
}
const mt = [0, 0, 0, 0];
function he(e, t, s, o, n) {
  const r = le(e), d = t.some((i) => i !== 0) || s.some((i) => i !== 0), v = (i) => d ? i : mt;
  n[`${r}.gainA`] = v(t.slice(0, 4)), n[`${r}.gainB`] = v(t.slice(4, 8)), n[`${r}.thrA`] = v(s.slice(0, 4)), n[`${r}.thrB`] = v(s.slice(4, 8)), n[`${r}.sharpA`] = v(o.slice(0, 4)), n[`${r}.sharpB`] = v(o.slice(4, 8)), n[`${r}.active`] = d ? 1 : 0;
}
function ue(e, t, s) {
  const o = {};
  for (const i of ie)
    o[ke(i)] = [...e[i]], o[xe(i)] = [...t[i]];
  o[qe] = s;
  const n = Array.from({ length: ae }, (i, P) => rt(e, t, P, s)), r = at(e, t, s), d = n.map((i) => i.gainC), v = n.map((i) => i.thrC);
  return he("luma", n.map((i) => i.gainL), n.map((i) => i.thrL), r, o), he("chroma-red", d, v, r, o), he("chroma-blue", d, v, r, o), o;
}
function pt(e) {
  return !ie.some((t) => we(e[ke(t)])) || Pe.every((t) => `${le(t)}.active` in e) ? null : ue(Oe(e), Fe(e), Ge(e));
}
const H = y - 1, g = (e) => Array.from({ length: y }, (t, s) => e(s)), F = (e) => ({ ...te(), ...e }), vt = (e, t) => Math.exp(-((1 - e) * (1 - e)) / (t * t)) / (2 * t * Math.sqrt(Math.PI)), bt = 3 / H, gt = (e, t, s) => {
  const o = (n) => [0.5, 1, 2].slice(0, e).reduce((r, d) => r + vt(n, d * bt), 0);
  return F({
    L: g((n) => 0.5 + o(n / H) / t),
    s: g((n) => 0.5 + o(n / H) / t),
    Lt: g((n) => o(n / H) / s),
    ct: g((n) => o(n / H) / s)
  });
}, yt = [
  [3, 16, 128],
  [2, 24, 192],
  [1, 32, 128]
], Lt = [
  ["large", 3],
  ["medium", 2],
  ["fine", 1]
], _e = [
  { id: "flat", label: "Flat (reset)", build: () => te() },
  {
    id: "coarse",
    label: "Coarse",
    build: () => F({
      L: g((e) => Math.max(0.5, 0.75 - 0.5 * e / H)),
      c: g((e) => Math.max(0.5, 0.55 - 0.5 * e / H)),
      s: g((e) => Math.min(0.5, 0.2 + 0.35 * e / H))
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
      L: g((e) => e === 0 ? 0.5 : Math.min(0.5, 0.3 + 0.35 * e / H)),
      s: g(() => 0)
    })
  },
  {
    id: "clarity",
    label: "Clarity (local contrast)",
    build: () => F({ L: g(() => 0.6), c: g(() => 0.55), s: g(() => 0) })
  },
  ...yt.flatMap(
    ([e, t, s]) => Lt.map(([o, n]) => ({
      id: `deblur-${o}-${e}`,
      label: `Deblur · ${o} blur · strength ${e}`,
      build: () => gt(n, t, s)
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
const Ne = (e, t, s) => {
  const [o, n, r, d] = e.ch[t];
  return `rgba(${o},${n},${r},${d * (s ? 0.5 : 1)})`;
}, h = 6, ye = 13, X = 64, St = 1 / y, Pt = 0.25 / y, kt = 1;
function Le(e) {
  return e < 0 ? 0 : e > 1 ? 1 : e;
}
function Ce(e, t, s, o, n) {
  return e.map((r, d) => {
    const v = s - t[d], i = Math.exp(-(v * v) / (n * n));
    return Le((1 - i) * r + i * o);
  });
}
function wt(e, t, s, o, n, r, d, v, i, P, L, E, C) {
  const T = t - 2 * h, R = s - 2 * h - ye, m = (l) => h + l * T, p = (l) => h + (1 - l) * R;
  e.clearRect(0, 0, t, s), e.strokeStyle = `rgba(${C.ink},0.8)`, e.lineWidth = 1, e.strokeRect(h, h, T, R), e.strokeStyle = `rgba(${C.ink},0.22)`;
  for (let l = 1; l < 8; l++)
    e.beginPath(), e.moveTo(m(l / 8), h), e.lineTo(m(l / 8), h + R), e.stroke(), e.beginPath(), e.moveTo(h, h + l / 8 * R), e.lineTo(h + T, h + l / 8 * R), e.stroke();
  e.fillStyle = `rgba(${C.ink},0.10)`;
  for (let l = 1; l < K.length; l += 2) {
    const k = m(Math.min(K[l - 1], K[l])), B = m(Math.max(K[l - 1], K[l]));
    e.fillRect(k, h, B - k, R);
  }
  const _ = [...re.filter((l) => l.key !== r.key), r];
  for (const l of _) {
    const k = l.key !== r.key, B = be(l.primary, n[l.primary], o[l.primary], v);
    if (e.beginPath(), l.thr) {
      const I = be(l.thr, n[l.thr], o[l.thr], v);
      e.moveTo(m(1), p(z(I.xs, I.ys, 1)));
      for (let $ = X - 2; $ >= 0; $--) {
        const U = $ / (X - 1);
        e.lineTo(m(U), p(z(I.xs, I.ys, U)));
      }
      for (let $ = 0; $ < X; $++) {
        const U = $ / (X - 1);
        e.lineTo(m(U), p(z(B.xs, B.ys, U)));
      }
    } else {
      e.moveTo(m(0), p(0));
      for (let I = 0; I < X; I++) {
        const $ = I / (X - 1);
        e.lineTo(m($), p(z(B.xs, B.ys, $)));
      }
      e.lineTo(m(1), p(0));
    }
    e.closePath();
    const w = Ne(C, l.primary, k);
    e.strokeStyle = w, e.fillStyle = w, e.lineWidth = 2, e.stroke(), e.fill();
  }
  if ((P || i !== null && !i.strip && i.y > 0) && i) {
    const l = n[d], k = o[d];
    e.lineWidth = 1;
    const B = d === r.primary ? C.dotBoost : C.dotThr;
    for (let S = 0; S < y; S++)
      e.beginPath(), e.arc(m(l[S]), p(k[S]), 3, 0, Math.PI * 2), e.strokeStyle = B, e.fillStyle = B, E === S ? e.fill() : e.stroke();
    const w = Ce(k, l, i.x, 1, L), I = Ce(k, l, i.x, 0, L);
    e.beginPath();
    for (let S = 0; S < X; S++) {
      const N = S / (X - 1), D = z(l, w, N);
      S === 0 ? e.moveTo(m(N), p(D)) : e.lineTo(m(N), p(D));
    }
    for (let S = X - 1; S >= 0; S--) {
      const N = S / (X - 1);
      e.lineTo(m(N), p(z(l, I, N)));
    }
    e.closePath(), e.fillStyle = Ne(C, r.primary, !1), e.fill(), e.beginPath(), e.arc(m(i.x), p(z(l, k, i.x)), L * T, 0, Math.PI * 2), e.strokeStyle = C.circle, e.lineWidth = 1, e.stroke(), e.fillStyle = `rgba(${C.ink},0.85)`, e.font = "bold 10px sans-serif", e.textAlign = "center", e.textBaseline = "middle", e.save(), e.translate(h + 10, h + R * 0.5), e.rotate(-Math.PI / 2), e.fillText("coarse", 0, 0), e.restore(), e.save(), e.translate(h + T - 6, h + R * 0.5), e.rotate(-Math.PI / 2), e.fillText("fine", 0, 0), e.restore();
    const [$, U] = d === "Lt" || d === "ct" ? ["smooth", "noisy"] : d === "s" ? ["bold", "dull"] : ["contrasty", "smooth"];
    e.fillText($, h + T / 2, h + 9), e.fillText(U, h + T / 2, h + R - 9);
  }
  e.strokeStyle = `rgba(${C.ink},0.9)`, e.fillStyle = `rgba(${C.ink},0.9)`, e.lineWidth = 1;
  const G = h + R + 3;
  for (let l = 1; l < y - 1; l++) {
    const k = m(n[r.primary][l]);
    e.beginPath(), e.moveTo(k - 3.5, G + 7), e.lineTo(k, G), e.lineTo(k + 3.5, G + 7), e.closePath(), E === l ? e.fill() : e.stroke();
  }
}
function Xe() {
  const e = q().react, { useState: t, useRef: s, useEffect: o } = e, n = q().components.Slider, r = q().ui;
  if (!r)
    return O(
      "div",
      { style: { padding: "10px", fontSize: "11px", color: "var(--color-text-muted)" } },
      "Update Safelight to use this panel."
    );
  const { SegmentedControl: d, Select: v } = r, i = q().develop.useParamScope(), P = i.getParams(), L = Oe(P), E = Fe(P), C = Ge(P), [T, R] = t(() => q().settings.get("channel", "luma")), [m, p] = t("L"), [_, Ae] = t(() => q().settings.get("radius", St)), [G, l] = t(null), [k, B] = t(-1), [w, I] = t({ w: 240, h: 160 }), [$, U] = t(0), S = s(null), N = s(null), D = s(null), Ee = s(_);
  Ee.current = _;
  const Me = s(0), M = re.find((a) => a.key === T), x = m === M.primary || m === M.thr ? m : M.primary;
  o(() => {
    const a = S.current;
    if (!a) return;
    const c = new ResizeObserver((f) => {
      const b = f[0].contentRect.width;
      b > 0 && I({ w: Math.round(b), h: Math.round(b * 0.6) + ye });
    });
    return c.observe(a), () => c.disconnect();
  }, []), o(() => {
    const a = () => {
      Me.current += 1, U(Me.current);
    }, c = new MutationObserver(a);
    return c.observe(document.documentElement, { attributes: !0 }), c.observe(document.body, { attributes: !0 }), () => c.disconnect();
  }, []), o(() => {
    const a = N.current;
    if (!a) return;
    const c = (f) => {
      f.preventDefault();
      const b = 1 - 0.1 * Math.sign(f.deltaY), u = Math.min(kt, Math.max(Pt, Ee.current * b));
      Ae(u), q().settings.set("radius", u);
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
    const b = getComputedStyle(a).backgroundColor.match(/\d+(?:\.\d+)?/g), u = b ? (Number(b[0]) + Number(b[1]) + Number(b[2])) / (3 * 255) < 0.5 : !0, A = G !== null || D.current !== null;
    wt(
      f,
      w.w,
      w.h,
      L,
      E,
      M,
      x,
      A ? 1 : C,
      G,
      D.current !== null,
      _,
      k,
      Ct(u)
    );
  }, [P, T, m, _, w, G, k, $]);
  const We = w.w - 2 * h, Re = w.h - 2 * h - ye, $e = (a) => {
    const c = a.currentTarget.getBoundingClientRect(), f = c.width > 0 ? w.w / c.width : 1, b = c.height > 0 ? w.h / c.height : 1, u = (a.clientX - c.left) * f, A = (a.clientY - c.top) * b;
    return {
      x: Le((u - h) / We),
      y: Le(1 - (A - h) / Re),
      strip: A > h + Re
    };
  }, de = (a) => {
    const c = E[M.primary];
    let f = 0, b = Math.abs(c[0] - a);
    for (let u = 1; u < y; u++) {
      const A = Math.abs(c[u] - a);
      A < b && (b = A, f = u);
    }
    return f;
  }, Y = (a, c, f = C) => i.setParams(ue(a, c, f)), oe = () => i.commit("Contrast Equalizer"), Ke = (a) => {
    const { x: c, y: f, strip: b } = $e(a);
    if (a.currentTarget.setPointerCapture(a.pointerId), b)
      D.current = {
        mode: "x",
        ch2: x,
        node: de(c),
        snapC: j(L),
        snapX: Z(E),
        pick: 0,
        fx: c,
        moved: !1
      };
    else {
      const u = z(E[x], L[x], c) - f;
      D.current = {
        mode: "y",
        ch2: x,
        node: -1,
        snapC: j(L),
        snapX: Z(E),
        pick: u,
        fx: c,
        moved: !1
      };
    }
  }, Ye = (a) => {
    const { x: c, y: f, strip: b } = $e(a), u = D.current;
    if (u) {
      if (u.mode === "x") {
        if (u.node > 0 && u.node < y - 1) {
          const A = u.snapX[M.primary], se = Math.min(A[u.node + 1] - 1e-3, Math.max(A[u.node - 1] + 1e-3, c)), V = Z(u.snapX);
          V[M.primary][u.node] = se, M.thr && (V[M.thr][u.node] = se), u.moved = !0, Y(u.snapC, V);
        }
        l({ x: c, y: f, strip: !1 });
      } else {
        const A = j(u.snapC);
        A[u.ch2] = Ce(u.snapC[u.ch2], u.snapX[u.ch2], u.fx, f + u.pick, _), u.moved = !0, Y(A, u.snapX), l({ x: u.fx, y: f, strip: !1 });
      }
      return;
    }
    if (l({ x: c, y: f, strip: b }), b)
      B(de(c));
    else if (B(-1), M.thr) {
      const A = de(c), se = Math.abs(f - L[M.primary][A]), V = Math.abs(f - L[M.thr][A]);
      p(se <= V ? M.primary : M.thr);
    } else
      p(M.primary);
  }, Ve = () => {
    const a = D.current;
    D.current = null, a && a.moved && oe();
  }, je = () => {
    D.current || (l(null), B(-1));
  }, Ze = () => {
    const a = j(L);
    a[x] = Array.from({ length: y }, () => W[x]);
    const c = Z(E);
    c[x] = [...Se], Y(a, c), oe();
  }, Je = O(d, {
    value: T,
    size: "sm",
    options: re.map((a) => ({ value: a.key, label: a.label })),
    onChange: (a) => {
      const c = re.find((f) => f.key === a);
      R(c.key), p(c.primary), q().settings.set("channel", c.key);
    }
  }), Qe = O(
    "div",
    { ref: S, style: { width: "100%" } },
    O("canvas", {
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
      onPointerDown: Ke,
      onPointerMove: Ye,
      onPointerUp: Ve,
      onPointerLeave: je,
      onDoubleClick: Ze
    })
  ), et = O(v, {
    value: "",
    style: { width: "100%" },
    onChange: (a) => {
      const c = _e.find((f) => f.id === a);
      c && (Y(c.build(), ce(), ee), oe());
    },
    options: [
      { value: "", label: "Presets…" },
      ..._e.map((a) => ({ value: a.id, label: a.label }))
    ]
  }), tt = O(
    "p",
    { style: { margin: "2px 0 0", fontSize: 10, color: "var(--color-text-muted)", lineHeight: 1.35 } },
    "Drag to shape the curve · wheel sets the radius · drag under the graph to move a node · double-click resets the curve."
  );
  return O(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 6, padding: 8 } },
    Je,
    Qe,
    O(n, {
      label: "Mix",
      value: C,
      min: 0,
      max: 3,
      step: 0.01,
      defaultValue: ee,
      onChange: (a) => Y(L, E, a),
      onCommit: oe
    }),
    et,
    tt
  );
}
const At = `${ne}.panel`;
let Q = null;
function Et(e) {
  const t = e.stores.useDevelopStore.getState();
  t.setDynParams(ue(te(), ce(), ee)), t.commitEdit("Contrast Equalizer reset");
}
function Mt(e) {
  nt(e);
  for (const t of ht()) e.registerProcessingStage(t);
  e.registerPanel({
    id: At,
    title: "Contrast Equalizer",
    component: Xe,
    defaultDock: { module: "develop", direction: "right", order: 7, width: 268 },
    onReset: () => Et(e),
    // The same panel edits a mask's curves in the Masking panel's Adjust tab.
    // It writes the curves and every chain's tables together, so it owns both.
    mask: { component: Xe, owns: Object.keys(ue(te(), ce(), ee)) }
  }), Q = e.stores.useDevelopStore.subscribe(
    (t, s) => {
      if (t.paramBag === s.paramBag) return;
      const o = pt(t.paramBag);
      o && t.setDynParams(o);
    }
  );
}
function Rt() {
  Q == null || Q(), Q = null;
  const e = globalThis.safelight;
  if (e)
    for (const t of Pe) e.unregisterProcessingStage(le(t));
}
export {
  Mt as activate,
  Rt as deactivate
};
//# sourceMappingURL=index.js.map
