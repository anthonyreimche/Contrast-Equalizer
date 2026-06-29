let Q = null, Z = null;
function ze(e) {
  Q = e.react, Z = e;
}
function M() {
  if (!Z) throw new Error("[contrast-equalizer] api used before activate()");
  return Z;
}
function Ne() {
  if (!Q) throw new Error("[contrast-equalizer] runtime used before activate()");
  return Q;
}
function D(e, t, ...n) {
  return Ne().createElement(e, t, ...n);
}
const E = 6, T = Array.from({ length: E }, (e, t) => t / (E - 1)), R = {
  L: 0.5,
  c: 0.5,
  s: 0.5,
  Lt: 0,
  ct: 0
};
function j() {
  const e = (t) => Array.from({ length: E }, () => t);
  return {
    L: e(R.L),
    c: e(R.c),
    s: e(R.s),
    Lt: e(R.Lt),
    ct: e(R.ct)
  };
}
function F(e) {
  return { L: [...e.L], c: [...e.c], s: [...e.s], Lt: [...e.Lt], ct: [...e.ct] };
}
const z = 4, pe = Array.from(
  { length: z },
  (e, t) => 1 - (t + 0.5) / z
), xe = {
  fine: [1, 2, 4, 8],
  // ~5..33 px feature support
  extended: [1, 4, 16, 64]
  // ~5..257 px — darktable's coarse reach
};
function O(e) {
  return e < 0 ? 0 : e > 1 ? 1 : e;
}
function ee(e, t) {
  const n = e.length;
  if (t <= T[0]) return O(e[0]);
  if (t >= T[n - 1]) return O(e[n - 1]);
  let a = 0;
  for (; a < n - 1 && t > T[a + 1]; ) a++;
  const r = T[a], d = T[a + 1], u = (t - r) / (d - r), h = e[Math.max(0, a - 1)], b = e[a], g = e[a + 1], L = e[Math.min(n - 1, a + 2)], _ = u * u, w = _ * u, c = 0.5 * (2 * b + (-h + g) * u + (2 * h - 5 * b + 4 * g - L) * _ + (-h + 3 * b - 3 * g + L) * w);
  return O(c);
}
function B(e, t, n, a) {
  const r = R[t];
  return O(r + a * (ee(e[t], n) - r));
}
function Be(e, t, n) {
  const a = pe[t], r = B(e, "L", a, n), d = B(e, "c", a, n), u = B(e, "Lt", a, n), h = B(e, "ct", a, n), b = Math.pow(2, -7 * (1 - a));
  return {
    gainL: 2 * r * (2 * r) - 1,
    gainC: 2 * d * (2 * d) - 1,
    thrL: b * 10 * u,
    thrC: b * 20 * h
  };
}
function He(e, t) {
  const n = pe.map((a) => 25e-4 * B(e, "s", a, t));
  return [n[0], n[1], n[2], n[3]];
}
const K = "contrast-equalizer";
function de(e) {
  let t = 0;
  for (let n = 0; n < e.length; n++) t = (t << 5) - t + e.charCodeAt(n) | 0;
  return (t >>> 0).toString(36).slice(0, 4);
}
const qe = ["fine", "medium", "coarse", "coarsest"], Ge = (() => {
  const e = [], t = /* @__PURE__ */ new Set();
  for (let n = 0; n < z; n++) {
    const a = `${K}.${qe[n] ?? `octave${n}`}`;
    let r = 0, d = a;
    for (; t.has(de(d)) && r < 1e3; ) d = `${a}-${++r}`;
    t.add(de(d)), e.push(d);
  }
  return e;
})(), ne = (e) => Ge[e], P = "100.0";
function Ye(e) {
  const [t, n, a, r] = e;
  return `
// B3 spline 1D weights [1,4,6,4,1]/16.
float ceB3(int d) { d = d < 0 ? -d : d; return d == 0 ? 0.375 : (d == 1 ? 0.25 : 0.0625); }
// Per-scale edge sharpness (darktable 'sharp'), one component per octave.
float ceSharp(int i) {
  return i == 0 ? uSharps.x : (i == 1 ? uSharps.y : (i == 2 ? uSharps.z : uSharps.w));
}
// Kernel dilation per pass (the detail-range schedule).
int ceDil(int j) { return j == 0 ? ${t} : (j == 1 ? ${n} : (j == 2 ? ${a} : ${r})); }
`;
}
const Ue = `
{
  int mult = ceDil(uPassIndex);
  float sharp = ceSharp(uPassIndex);
  vec3 ctr = c;
  float Lc = luma(ctr) * ${P};
  vec3  abC = (ctr - luma(ctr)) * ${P};   // chroma (zero-luma) of the centre
  float sumL = 0.0, wL = 0.0;
  vec3  sumC = vec3(0.0); float wC = 0.0;
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      vec2 off = vec2(float(dx), float(dy)) * float(mult) * uTexel;
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
`, Xe = `
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
`, Fe = [
  { key: "gainL", glslType: "float", default: 0, label: "Luma gain" },
  { key: "gainC", glslType: "float", default: 0, label: "Chroma gain" },
  { key: "thrL", glslType: "float", default: 0, label: "Luma threshold" },
  { key: "thrC", glslType: "float", default: 0, label: "Chroma threshold" }
];
function Oe(e, t) {
  return {
    glsl: Ue,
    helpers: Ye(t),
    // scale i needs i+1 octaves of the chain to reach its detail level.
    iterations: e + 1,
    uniforms: [{ key: "uSharps", glslType: "vec4", default: [0, 0, 0, 0] }]
  };
}
function je(e, t) {
  return {
    id: ne(e),
    name: `Contrast Equalizer · scale ${e}`,
    // Scene-linear, after exposure/white balance; bands are additive so their
    // order among themselves doesn't matter.
    phase: "scene-linear",
    priority: 70 + e,
    glsl: Xe,
    uniforms: Fe,
    passes: [Oe(e, t)]
  };
}
function Ke(e) {
  return Array.from({ length: z }, (t, n) => je(n, e));
}
const me = ["L", "c", "s", "Lt", "ct"], be = (e) => `${K}.curve.${e}`, Le = `${K}.mix`, oe = 1;
function We(e) {
  return Array.isArray(e) && e.length === E && e.every((t) => typeof t == "number");
}
function Ve(e) {
  const t = j(), n = F(t);
  for (const a of me) {
    const r = e[be(a)];
    We(r) && (n[a] = [...r]);
  }
  return n;
}
function Je(e) {
  const t = e[Le];
  return typeof t == "number" ? t : oe;
}
function ve(e, t) {
  const n = {};
  for (const r of me) n[be(r)] = [...e[r]];
  n[Le] = t;
  const a = He(e, t);
  for (let r = 0; r < z; r++) {
    const d = ne(r), u = Be(e, r, t);
    n[`${d}.gainL`] = u.gainL, n[`${d}.gainC`] = u.gainC, n[`${d}.thrL`] = u.thrL, n[`${d}.thrC`] = u.thrC, n[`${d}.uSharps`] = a.map((h, b) => b <= r ? h : 0);
  }
  return n;
}
const $ = (e) => {
  const t = j();
  for (const n of Object.keys(e)) t[n] = e[n].slice();
  return t;
}, ue = [
  { id: "flat", label: "Flat (reset)", build: () => j() },
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
], fe = [
  { key: "luma", label: "luma", primary: "L", thr: "Lt", color: "#dcdcdc", thrColor: "#5a8fd0" },
  { key: "chroma", label: "chroma", primary: "c", thr: "ct", color: "#d8b25a", thrColor: "#c06a9a" },
  { key: "edges", label: "edges", primary: "s", thr: null, color: "#6ac08a", thrColor: null }
], f = 10, Qe = 12, Ze = 3;
function he(e) {
  return e < 0 ? 0 : e > 1 ? 1 : e;
}
function et(e, t, n, a, r, d, u) {
  const h = t - 2 * f, b = n - 2 * f, g = (c) => f + c * h, L = (c) => f + (1 - c) * b;
  e.clearRect(0, 0, t, n), e.strokeStyle = "rgba(128,128,128,0.16)", e.lineWidth = 1;
  for (let c = 0; c < E; c++)
    e.beginPath(), e.moveTo(g(T[c]), f), e.lineTo(g(T[c]), f + b), e.stroke();
  for (let c = 0; c <= 4; c++) {
    const C = f + c / 4 * b;
    e.beginPath(), e.moveTo(f, C), e.lineTo(f + h, C), e.stroke();
  }
  e.strokeStyle = "rgba(160,160,160,0.4)", e.lineWidth = 1, e.beginPath(), e.moveTo(f, L(0.5)), e.lineTo(f + h, L(0.5)), e.stroke();
  const _ = (c, C, H, S) => {
    e.beginPath();
    for (let p = 0; p <= h; p++) {
      const m = p / h, A = ee(c, m);
      p === 0 ? e.moveTo(g(m), L(A)) : e.lineTo(g(m), L(A));
    }
    {
      e.lineTo(g(1), L(S)), e.lineTo(g(0), L(S)), e.closePath(), e.fillStyle = C, e.globalAlpha = 0.14, e.fill(), e.globalAlpha = 1, e.beginPath();
      for (let p = 0; p <= h; p++) {
        const m = p / h, A = ee(c, m);
        p === 0 ? e.moveTo(g(m), L(A)) : e.lineTo(g(m), L(A));
      }
    }
    e.strokeStyle = C, e.lineWidth = 1.6, e.stroke();
  };
  r.thr && r.thrColor && _(a[r.thr], r.thrColor, !0, 0), _(a[r.primary], r.color, !0, 0.5);
  const w = (c, C) => {
    const H = a[c];
    for (let S = 0; S < E; S++) {
      const p = g(T[S]), m = L(H[S]);
      d && d.channel === c && d.index === S && (e.strokeStyle = "#ffffff", e.lineWidth = 1.5, e.beginPath(), e.arc(p, m, 5.5, 0, Math.PI * 2), e.stroke()), e.fillStyle = C, e.beginPath(), e.arc(p, m, 3, 0, Math.PI * 2), e.fill();
    }
  };
  r.thr && r.thrColor && w(r.thr, r.thrColor), w(r.primary, r.color), u && (e.strokeStyle = "rgba(255,255,255,0.55)", e.lineWidth = 1, e.beginPath(), e.arc(u.x, u.y, u.r, 0, Math.PI * 2), e.stroke()), e.fillStyle = "rgba(170,170,170,0.7)", e.font = "9px sans-serif", e.textBaseline = "bottom", e.textAlign = "left", e.fillText("coarse", f + 1, n - 1), e.textAlign = "right", e.fillText("fine", f + h - 1, n - 1);
}
function tt() {
  const e = M().react, { useState: t, useRef: n, useEffect: a } = e, r = M().stores.useDevelopStore, d = M().components.Slider, u = M().ui;
  if (!u)
    return D(
      "div",
      { style: { padding: "10px", fontSize: "11px", color: "var(--color-text-muted)" } },
      "Update Safelight to use this panel."
    );
  const { SegmentedControl: h, Select: b } = u, g = r((o) => o.paramBag), L = r(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (o) => o.setDynParams
  ), _ = r((o) => o.commitEdit), w = Ve(g), c = Je(g), [C, H] = t("luma"), [S, p] = t(null), [m, A] = t(() => M().settings.get("coupling", 1)), [y, ye] = t({ w: 240, h: 150 }), [q, re] = t(null), se = n(null), W = n(null), N = n(null), ae = n(m);
  ae.current = m;
  const x = fe.find((o) => o.key === C);
  a(() => {
    const o = se.current;
    if (!o) return;
    const s = new ResizeObserver((i) => {
      const l = i[0].contentRect.width;
      l > 0 && ye({ w: Math.round(l), h: Math.round(l * 0.62) });
    });
    return s.observe(o), () => s.disconnect();
  }, []), a(() => {
    const o = W.current;
    if (!o) return;
    const s = (i) => {
      i.preventDefault();
      const l = i.deltaY < 0 ? 1 : -1, v = Math.min(E - 1, Math.max(0.4, ae.current + l * 0.25));
      A(v), M().settings.set("coupling", v);
    };
    return o.addEventListener("wheel", s, { passive: !1 }), () => o.removeEventListener("wheel", s);
  }, []), a(() => {
    const o = W.current;
    if (!o) return;
    const s = window.devicePixelRatio || 1;
    o.width = y.w * s, o.height = y.h * s;
    const i = o.getContext("2d");
    if (!i) return;
    i.setTransform(s, 0, 0, s, 0, 0);
    const l = y.w - 2 * f, v = m / (E - 1) * l;
    et(
      i,
      y.w,
      y.h,
      w,
      x,
      S,
      q ? { x: q.x, y: q.y, r: v } : null
    );
  }, [g, C, S, m, y, q]);
  const V = (o) => {
    const s = o.currentTarget.getBoundingClientRect(), i = s.width > 0 ? y.w / s.width : 1, l = s.height > 0 ? y.h / s.height : 1;
    return { x: (o.clientX - s.left) * i, y: (o.clientY - s.top) * l };
  }, Ce = y.w - 2 * f, le = y.h - 2 * f, Se = (o) => he(1 - (o - f) / le), we = (o, s) => [
    f + T[s] * Ce,
    f + (1 - w[o][s]) * le
  ], ie = (o, s) => {
    const i = x.thr ? [x.primary, x.thr] : [x.primary];
    let l = null, v = Qe;
    for (const I of i)
      for (let k = 0; k < E; k++) {
        const [U, J] = we(I, k), X = Math.hypot(U - o, J - s);
        X <= v && (v = X, l = { channel: I, index: k });
      }
    return l;
  }, G = (o, s = c) => L(ve(o, s)), Y = () => _("Contrast Equalizer"), Pe = (o, s, i) => {
    const l = s[o.channel], v = i - l[o.index], I = Math.max(0.18, m), k = l.map((J, X) => {
      const ce = (X - o.index) / I, Me = Math.exp(-0.5 * ce * ce);
      return he(J + v * Me);
    }), U = F(s);
    U[o.channel] = k, G(U);
  }, Te = (o) => {
    const { x: s, y: i } = V(o), l = ie(s, i);
    l && (o.currentTarget.setPointerCapture(o.pointerId), N.current = { hit: l, snapshot: F(w), startX: s, startY: i, moved: !1 }, p(l));
  }, Ee = (o) => {
    const { x: s, y: i } = V(o);
    re({ x: s, y: i });
    const l = N.current;
    l && (!l.moved && Math.hypot(s - l.startX, i - l.startY) < Ze || (l.moved = !0, Pe(l.hit, l.snapshot, Se(i))));
  }, Ae = () => {
    const o = N.current;
    N.current = null, o && o.moved && Y();
  }, ke = () => {
    N.current || re(null);
  }, De = (o) => {
    const { x: s, y: i } = V(o), l = ie(s, i);
    if (!l) return;
    const v = F(w);
    v[l.channel] = v[l.channel].map(
      (I, k) => k === l.index ? R[l.channel] : I
    ), G(v), Y();
  }, $e = D(h, {
    value: C,
    size: "sm",
    options: fe.map((o) => ({ value: o.key, label: o.label })),
    onChange: (o) => {
      H(o), p(null);
    }
  }), _e = D(
    "div",
    { ref: se, style: { width: "100%" } },
    D("canvas", {
      ref: W,
      style: {
        width: y.w,
        height: y.h,
        touchAction: "none",
        borderRadius: 4,
        background: "var(--color-surface-0)",
        cursor: "ns-resize",
        display: "block"
      },
      onPointerDown: Te,
      onPointerMove: Ee,
      onPointerUp: Ae,
      onPointerLeave: ke,
      onDoubleClick: De
    })
  ), Re = D(b, {
    value: "",
    style: { width: "100%" },
    onChange: (o) => {
      const s = ue.find((i) => i.id === o);
      s && (G(s.build()), Y(), p(null));
    },
    options: [
      { value: "", label: "Presets…" },
      ...ue.map((o) => ({ value: o.id, label: o.label }))
    ]
  }), Ie = D(
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
      value: c,
      min: 0,
      max: 3,
      step: 0.01,
      defaultValue: oe,
      onChange: (o) => G(w, o),
      onCommit: Y
    }),
    Re,
    Ie
  );
}
const nt = `${K}.panel`, te = "range";
function ot(e) {
  return e.settings.get(te, "fine") === "extended" ? "extended" : "fine";
}
function ge(e, t) {
  for (const n of Ke(xe[t])) e.registerProcessingStage(n);
}
function rt(e) {
  const t = e.stores.useDevelopStore.getState();
  t.setDynParams(ve(j(), oe)), t.commitEdit("Contrast Equalizer reset");
}
function st(e) {
  ze(e), ge(e, ot(e)), e.registerSettings({
    title: "Contrast Equalizer",
    fields: [
      {
        key: te,
        label: "Detail range",
        hint: "How far the four octaves reach. 'Fine' (default) covers ~5–33 px — best for sharpening, clarity and denoise. 'Extended' stretches the coarse end to ~257 px for big local-contrast / bloom moves, at some loss of smoothness.",
        type: "select",
        default: "fine",
        options: [
          { value: "fine", label: "Fine (sharpen / clarity / denoise)" },
          { value: "extended", label: "Extended (adds coarse / bloom)" }
        ]
      }
    ]
  }), e.registerPanel({
    id: nt,
    title: "Contrast Equalizer",
    component: tt,
    defaultDock: { module: "develop", direction: "right", order: 7, width: 268 },
    onReset: () => rt(e)
  }), e.settings.onChange((t, n) => {
    t === te && ge(e, n === "extended" ? "extended" : "fine");
  });
}
function at() {
  const e = globalThis.safelight;
  if (e)
    for (let t = 0; t < z; t++) e.unregisterProcessingStage(ne(t));
}
export {
  st as activate,
  at as deactivate
};
//# sourceMappingURL=index.js.map
