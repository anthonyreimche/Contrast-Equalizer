let Z = null, ee = null;
function ze(e) {
  Z = e.react, ee = e;
}
function M() {
  if (!ee) throw new Error("[contrast-equalizer] api used before activate()");
  return ee;
}
function Ie() {
  if (!Z) throw new Error("[contrast-equalizer] runtime used before activate()");
  return Z;
}
function D(e, t, ...o) {
  return Ie().createElement(e, t, ...o);
}
const T = 6, A = Array.from({ length: T }, (e, t) => t / (T - 1)), R = {
  L: 0.5,
  c: 0.5,
  s: 0.5,
  Lt: 0,
  ct: 0
};
function W() {
  const e = (t) => Array.from({ length: T }, () => t);
  return {
    L: e(R.L),
    c: e(R.c),
    s: e(R.s),
    Lt: e(R.Lt),
    ct: e(R.ct)
  };
}
function Y(e) {
  return { L: [...e.L], c: [...e.c], s: [...e.s], Lt: [...e.Lt], ct: [...e.ct] };
}
const te = 8, F = [0, 2, 4, 6], K = F.length, Ne = F.map((e) => 1 - (e + 0.5) / te), xe = Array.from(
  { length: te },
  (e, t) => 1 - (t + 0.5) / te
);
function O(e) {
  return e < 0 ? 0 : e > 1 ? 1 : e;
}
function ne(e, t) {
  const o = e.length;
  if (t <= A[0]) return O(e[0]);
  if (t >= A[o - 1]) return O(e[o - 1]);
  let a = 0;
  for (; a < o - 1 && t > A[a + 1]; ) a++;
  const r = A[a], d = A[a + 1], c = (t - r) / (d - r), p = e[Math.max(0, a - 1)], v = e[a], f = e[a + 1], m = e[Math.min(o - 1, a + 2)], _ = c * c, w = _ * c, u = 0.5 * (2 * v + (-p + f) * c + (2 * p - 5 * v + 4 * f - m) * _ + (-p + 3 * v - 3 * f + m) * w);
  return O(u);
}
function N(e, t, o, a) {
  const r = R[t];
  return O(r + a * (ne(e[t], o) - r));
}
function He(e, t, o) {
  const a = Ne[t], r = N(e, "L", a, o), d = N(e, "c", a, o), c = N(e, "Lt", a, o), p = N(e, "ct", a, o), v = Math.pow(2, -7 * (1 - a));
  return {
    gainL: 2 * r * (2 * r) - 1,
    gainC: 2 * d * (2 * d) - 1,
    thrL: v * 10 * c,
    thrC: v * 20 * p
  };
}
function qe(e, t) {
  return xe.map((o) => 25e-4 * N(e, "s", o, t));
}
const V = "contrast-equalizer";
function de(e) {
  let t = 0;
  for (let o = 0; o < e.length; o++) t = (t << 5) - t + e.charCodeAt(o) | 0;
  return (t >>> 0).toString(36).slice(0, 4);
}
const me = ["fine", "medium", "coarse", "coarsest"], Ge = (() => {
  const e = [], t = /* @__PURE__ */ new Set();
  for (let o = 0; o < K; o++) {
    const a = `${V}.${me[o] ?? `octave${o}`}`;
    let r = 0, d = a;
    for (; t.has(de(d)) && r < 1e3; ) d = `${a}-${++r}`;
    t.add(de(d)), e.push(d);
  }
  return e;
})(), oe = (e) => Ge[e], P = "100.0", Ue = `
// B3 spline 1D weights [1,4,6,4,1]/16.
float ceB3(int d) { d = d < 0 ? -d : d; return d == 0 ? 0.375 : (d == 1 ? 0.25 : 0.0625); }
// Per-level edge sharpness (darktable 'sharp'): levels 0-3 in A, 4-7 in B.
float ceSharp(int i) {
  vec4 v = i < 4 ? uSharpsA : uSharpsB;
  int k = i < 4 ? i : i - 4;
  return k == 0 ? v.x : (k == 1 ? v.y : (k == 2 ? v.z : v.w));
}
`, Xe = `
{
  float mult = exp2(float(uPassIndex));
  float sharp = ceSharp(uPassIndex);
  vec3 ctr = c;
  float Lc = luma(ctr) * ${P};
  vec3  abC = (ctr - luma(ctr)) * ${P};   // chroma (zero-luma) of the centre
  float sumL = 0.0, wL = 0.0;
  vec3  sumC = vec3(0.0); float wC = 0.0;
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      vec2 off = vec2(float(dx), float(dy)) * mult * uTexel;
      vec3 s = readPrev(vUv + off);
      float f = ceB3(dx) * ceB3(dy);
      float Ls = luma(s) * ${P};
      vec3  abS = (s - luma(s)) * ${P};
      float dL = Lc - Ls;
      float wl = exp(-0.5 * sharp * dL * dL);
      vec3  dab = abC - abS;
      float wc = exp(-sharp * dot(dab, dab));
      float fwl = f * wl;
      float fwc = f * wc;
      sumL += fwl * Ls; wL += fwl;
      sumC += fwc * abS; wC += fwc;
    }
  }
  float coarseL = (wL > 0.0 ? sumL / wL : Lc) / ${P};
  vec3  coarseAb = (wC > 0.0 ? sumC / wC : abC) / ${P};
  vec3 coarse = vec3(coarseL) + coarseAb;
  // The chained coarse stays as-is; the final pass emits this octave's *signed*
  // detail, bias-encoded into [0,1] (0.5 = zero) so it survives the host's RGBA8
  // ping-pong fallback on GPUs without EXT_color_buffer_float. The inline decodes
  // it. (On the RGBA16F path this just costs ~1 bit of precision.)
  c = (uPassIndex == uPassCount - 1) ? ((ctr - coarse) * 0.5 + 0.5) : coarse;
}
`, Ye = `
{
  vec3 d = (stageResult - 0.5) * 2.0;      // decode the bias-encoded signed detail
  float dL = luma(d);
  vec3  dC = d - dL;                       // chroma part (zero luma)
  float dL100 = dL * ${P};
  float coreL = sign(dL100) * max(abs(dL100) - thrL, 0.0) / ${P};
  float addL = (1.0 + gainL) * coreL - dL;
  float cmag = length(dC) * ${P};
  float fac = cmag > 1e-5 ? max(cmag - thrC, 0.0) / cmag : 0.0;
  vec3  coreC = dC * fac;
  vec3  addC = (1.0 + gainC) * coreC - dC;
  lin += vec3(addL) + addC;
}
`, Oe = [
  { key: "gainL", glslType: "float", default: 0, label: "Luma gain" },
  { key: "gainC", glslType: "float", default: 0, label: "Chroma gain" },
  { key: "thrL", glslType: "float", default: 0, label: "Luma threshold" },
  { key: "thrC", glslType: "float", default: 0, label: "Chroma threshold" }
];
function We(e) {
  return {
    glsl: Xe,
    helpers: Ue,
    // Reaching octave o's detail takes the full chain: o+1 levels from the source.
    iterations: F[e] + 1,
    uniforms: [
      { key: "uSharpsA", glslType: "vec4", default: [0, 0, 0, 0] },
      { key: "uSharpsB", glslType: "vec4", default: [0, 0, 0, 0] }
    ]
  };
}
function Fe(e) {
  return {
    id: oe(e),
    name: `Contrast Equalizer · ${me[e] ?? `band ${e}`}`,
    // Scene-linear, after exposure/white balance; bands are additive so their
    // order among themselves doesn't matter.
    phase: "scene-linear",
    priority: 70 + e,
    glsl: Ye,
    uniforms: Oe,
    passes: [We(e)]
  };
}
function Ke() {
  return Array.from({ length: K }, (e, t) => Fe(t));
}
const ge = ["L", "c", "s", "Lt", "ct"], Le = (e) => `${V}.curve.${e}`, ve = `${V}.mix`, re = 1;
function Ve(e) {
  return Array.isArray(e) && e.length === T && e.every((t) => typeof t == "number");
}
function je(e) {
  const t = W(), o = Y(t);
  for (const a of ge) {
    const r = e[Le(a)];
    Ve(r) && (o[a] = [...r]);
  }
  return o;
}
function Je(e) {
  const t = e[ve];
  return typeof t == "number" ? t : re;
}
function be(e, t) {
  const o = {};
  for (const r of ge) o[Le(r)] = [...e[r]];
  o[ve] = t;
  const a = qe(e, t);
  for (let r = 0; r < K; r++) {
    const d = oe(r), c = He(e, r, t);
    o[`${d}.gainL`] = c.gainL, o[`${d}.gainC`] = c.gainC, o[`${d}.thrL`] = c.thrL, o[`${d}.thrC`] = c.thrC;
    const p = c.gainL === 0 && c.gainC === 0 && c.thrL === 0 && c.thrC === 0, v = a.map((f, m) => !p && m <= F[r] ? f : 0);
    o[`${d}.uSharpsA`] = v.slice(0, 4), o[`${d}.uSharpsB`] = v.slice(4, 8);
  }
  return o;
}
const $ = (e) => {
  const t = W();
  for (const o of Object.keys(e)) t[o] = e[o].slice();
  return t;
}, fe = [
  { id: "flat", label: "Flat (reset)", build: () => W() },
  {
    id: "sharpen",
    label: "Sharpen",
    build: () => $({ L: [0.5, 0.5, 0.5, 0.56, 0.66, 0.74] })
  },
  {
    id: "deblur-medium",
    label: "Deblur · medium",
    build: () => $({ L: [0.5, 0.5, 0.54, 0.64, 0.78, 0.86] })
  },
  {
    id: "deblur-strong",
    label: "Deblur · strong",
    build: () => $({ L: [0.5, 0.52, 0.6, 0.74, 0.9, 1] })
  },
  {
    id: "clarity",
    label: "Local contrast (clarity)",
    build: () => $({ L: [0.5, 0.58, 0.64, 0.6, 0.52, 0.5] })
  },
  {
    id: "bloom",
    label: "Bloom",
    build: () => $({ L: [0.5, 0.64, 0.7, 0.6, 0.5, 0.44] })
  },
  {
    id: "denoise-luma",
    label: "Denoise · luma",
    build: () => $({ Lt: [0, 0, 0.1, 0.35, 0.62, 0.82] })
  },
  {
    id: "denoise-chroma",
    label: "Denoise · chroma",
    build: () => $({ ct: [0, 0, 0.15, 0.45, 0.72, 0.9] })
  },
  {
    id: "denoise-sharpen",
    label: "Denoise & sharpen",
    build: () => $({
      L: [0.5, 0.5, 0.5, 0.56, 0.66, 0.72],
      Lt: [0, 0, 0.08, 0.3, 0.55, 0.75],
      ct: [0, 0, 0.12, 0.4, 0.65, 0.85]
    })
  }
], he = [
  { key: "luma", label: "luma", primary: "L", thr: "Lt", color: "#dcdcdc", thrColor: "#5a8fd0" },
  { key: "chroma", label: "chroma", primary: "c", thr: "ct", color: "#d8b25a", thrColor: "#c06a9a" },
  { key: "edges", label: "edges", primary: "s", thr: null, color: "#6ac08a", thrColor: null }
], h = 10, Qe = 12, Ze = 3;
function pe(e) {
  return e < 0 ? 0 : e > 1 ? 1 : e;
}
function et(e, t, o, a, r, d, c) {
  const p = t - 2 * h, v = o - 2 * h, f = (u) => h + u * p, m = (u) => h + (1 - u) * v;
  e.clearRect(0, 0, t, o), e.strokeStyle = "rgba(128,128,128,0.16)", e.lineWidth = 1;
  for (let u = 0; u < T; u++)
    e.beginPath(), e.moveTo(f(A[u]), h), e.lineTo(f(A[u]), h + v), e.stroke();
  for (let u = 0; u <= 4; u++) {
    const C = h + u / 4 * v;
    e.beginPath(), e.moveTo(h, C), e.lineTo(h + p, C), e.stroke();
  }
  e.strokeStyle = "rgba(160,160,160,0.4)", e.lineWidth = 1, e.beginPath(), e.moveTo(h, m(0.5)), e.lineTo(h + p, m(0.5)), e.stroke();
  const _ = (u, C, x, S) => {
    e.beginPath();
    for (let g = 0; g <= p; g++) {
      const L = g / p, k = ne(u, L);
      g === 0 ? e.moveTo(f(L), m(k)) : e.lineTo(f(L), m(k));
    }
    {
      e.lineTo(f(1), m(S)), e.lineTo(f(0), m(S)), e.closePath(), e.fillStyle = C, e.globalAlpha = 0.14, e.fill(), e.globalAlpha = 1, e.beginPath();
      for (let g = 0; g <= p; g++) {
        const L = g / p, k = ne(u, L);
        g === 0 ? e.moveTo(f(L), m(k)) : e.lineTo(f(L), m(k));
      }
    }
    e.strokeStyle = C, e.lineWidth = 1.6, e.stroke();
  };
  r.thr && r.thrColor && _(a[r.thr], r.thrColor, !0, 0), _(a[r.primary], r.color, !0, 0.5);
  const w = (u, C) => {
    const x = a[u];
    for (let S = 0; S < T; S++) {
      const g = f(A[S]), L = m(x[S]);
      d && d.channel === u && d.index === S && (e.strokeStyle = "#ffffff", e.lineWidth = 1.5, e.beginPath(), e.arc(g, L, 5.5, 0, Math.PI * 2), e.stroke()), e.fillStyle = C, e.beginPath(), e.arc(g, L, 3, 0, Math.PI * 2), e.fill();
    }
  };
  r.thr && r.thrColor && w(r.thr, r.thrColor), w(r.primary, r.color), c && (e.strokeStyle = "rgba(255,255,255,0.55)", e.lineWidth = 1, e.beginPath(), e.arc(c.x, c.y, c.r, 0, Math.PI * 2), e.stroke()), e.fillStyle = "rgba(170,170,170,0.7)", e.font = "9px sans-serif", e.textBaseline = "bottom", e.textAlign = "left", e.fillText("coarse", h + 1, o - 1), e.textAlign = "right", e.fillText("fine", h + p - 1, o - 1);
}
function tt() {
  const e = M().react, { useState: t, useRef: o, useEffect: a } = e, r = M().stores.useDevelopStore, d = M().components.Slider, c = M().ui;
  if (!c)
    return D(
      "div",
      { style: { padding: "10px", fontSize: "11px", color: "var(--color-text-muted)" } },
      "Update Safelight to use this panel."
    );
  const { SegmentedControl: p, Select: v } = c, f = r((n) => n.paramBag), m = r(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (n) => n.setDynParams
  ), _ = r((n) => n.commitEdit), w = je(f), u = Je(f), [C, x] = t("luma"), [S, g] = t(null), [L, k] = t(() => M().settings.get("coupling", 1)), [y, ye] = t({ w: 240, h: 150 }), [H, se] = t(null), ae = o(null), j = o(null), z = o(null), le = o(L);
  le.current = L;
  const I = he.find((n) => n.key === C);
  a(() => {
    const n = ae.current;
    if (!n) return;
    const s = new ResizeObserver((i) => {
      const l = i[0].contentRect.width;
      l > 0 && ye({ w: Math.round(l), h: Math.round(l * 0.62) });
    });
    return s.observe(n), () => s.disconnect();
  }, []), a(() => {
    const n = j.current;
    if (!n) return;
    const s = (i) => {
      i.preventDefault();
      const l = i.deltaY < 0 ? 1 : -1, b = Math.min(T - 1, Math.max(0.4, le.current + l * 0.25));
      k(b), M().settings.set("coupling", b);
    };
    return n.addEventListener("wheel", s, { passive: !1 }), () => n.removeEventListener("wheel", s);
  }, []), a(() => {
    const n = j.current;
    if (!n) return;
    const s = window.devicePixelRatio || 1;
    n.width = y.w * s, n.height = y.h * s;
    const i = n.getContext("2d");
    if (!i) return;
    i.setTransform(s, 0, 0, s, 0, 0);
    const l = y.w - 2 * h, b = L / (T - 1) * l;
    et(
      i,
      y.w,
      y.h,
      w,
      I,
      S,
      H ? { x: H.x, y: H.y, r: b } : null
    );
  }, [f, C, S, L, y, H]);
  const J = (n) => {
    const s = n.currentTarget.getBoundingClientRect(), i = s.width > 0 ? y.w / s.width : 1, l = s.height > 0 ? y.h / s.height : 1;
    return { x: (n.clientX - s.left) * i, y: (n.clientY - s.top) * l };
  }, Ce = y.w - 2 * h, ie = y.h - 2 * h, Se = (n) => pe(1 - (n - h) / ie), we = (n, s) => [
    h + A[s] * Ce,
    h + (1 - w[n][s]) * ie
  ], ce = (n, s) => {
    const i = I.thr ? [I.primary, I.thr] : [I.primary];
    let l = null, b = Qe;
    for (const B of i)
      for (let E = 0; E < T; E++) {
        const [U, Q] = we(B, E), X = Math.hypot(U - n, Q - s);
        X <= b && (b = X, l = { channel: B, index: E });
      }
    return l;
  }, q = (n, s = u) => m(be(n, s)), G = () => _("Contrast Equalizer"), Pe = (n, s, i) => {
    const l = s[n.channel], b = i - l[n.index], B = Math.max(0.18, L), E = l.map((Q, X) => {
      const ue = (X - n.index) / B, Me = Math.exp(-0.5 * ue * ue);
      return pe(Q + b * Me);
    }), U = Y(s);
    U[n.channel] = E, q(U);
  }, Ae = (n) => {
    const { x: s, y: i } = J(n), l = ce(s, i);
    l && (n.currentTarget.setPointerCapture(n.pointerId), z.current = { hit: l, snapshot: Y(w), startX: s, startY: i, moved: !1 }, g(l));
  }, Te = (n) => {
    const { x: s, y: i } = J(n);
    se({ x: s, y: i });
    const l = z.current;
    l && (!l.moved && Math.hypot(s - l.startX, i - l.startY) < Ze || (l.moved = !0, Pe(l.hit, l.snapshot, Se(i))));
  }, ke = () => {
    const n = z.current;
    z.current = null, n && n.moved && G();
  }, Ee = () => {
    z.current || se(null);
  }, De = (n) => {
    const { x: s, y: i } = J(n), l = ce(s, i);
    if (!l) return;
    const b = Y(w);
    b[l.channel] = b[l.channel].map(
      (B, E) => E === l.index ? R[l.channel] : B
    ), q(b), G();
  }, $e = D(p, {
    value: C,
    size: "sm",
    options: he.map((n) => ({ value: n.key, label: n.label })),
    onChange: (n) => {
      x(n), g(null);
    }
  }), _e = D(
    "div",
    { ref: ae, style: { width: "100%" } },
    D("canvas", {
      ref: j,
      style: {
        width: y.w,
        height: y.h,
        touchAction: "none",
        borderRadius: 4,
        background: "var(--color-surface-0)",
        cursor: "ns-resize",
        display: "block"
      },
      onPointerDown: Ae,
      onPointerMove: Te,
      onPointerUp: ke,
      onPointerLeave: Ee,
      onDoubleClick: De
    })
  ), Re = D(v, {
    value: "",
    style: { width: "100%" },
    onChange: (n) => {
      const s = fe.find((i) => i.id === n);
      s && (q(s.build()), G(), g(null));
    },
    options: [
      { value: "", label: "Presets…" },
      ...fe.map((n) => ({ value: n.id, label: n.label }))
    ]
  }), Be = D(
    "p",
    { style: { margin: "2px 0 0", fontSize: 10, color: "var(--color-text-muted)", lineHeight: 1.35 } },
    "Drag nodes vertically · wheel sets the influence radius · double-click resets a node."
  );
  return D(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 6, padding: 8 } },
    $e,
    _e,
    D(d, {
      label: "Mix",
      value: u,
      min: 0,
      max: 3,
      step: 0.01,
      defaultValue: re,
      onChange: (n) => q(w, n),
      onCommit: G
    }),
    Re,
    Be
  );
}
const nt = `${V}.panel`;
function ot(e) {
  const t = e.stores.useDevelopStore.getState();
  t.setDynParams(be(W(), re)), t.commitEdit("Contrast Equalizer reset");
}
function rt(e) {
  ze(e);
  for (const t of Ke()) e.registerProcessingStage(t);
  e.registerPanel({
    id: nt,
    title: "Contrast Equalizer",
    component: tt,
    defaultDock: { module: "develop", direction: "right", order: 7, width: 268 },
    onReset: () => ot(e)
  });
}
function st() {
  const e = globalThis.safelight;
  if (e)
    for (let t = 0; t < K; t++) e.unregisterProcessingStage(oe(t));
}
export {
  rt as activate,
  st as deactivate
};
//# sourceMappingURL=index.js.map
