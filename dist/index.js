let Q = null, Z = null;
function Ie(e) {
  Q = e.react, Z = e;
}
function I() {
  if (!Z) throw new Error("[contrast-equalizer] api used before activate()");
  return Z;
}
function Me() {
  if (!Q) throw new Error("[contrast-equalizer] runtime used before activate()");
  return Q;
}
function $(e, t, ...o) {
  return Me().createElement(e, t, ...o);
}
const k = 6, A = Array.from({ length: k }, (e, t) => t / (k - 1)), R = {
  L: 0.5,
  c: 0.5,
  s: 0.5,
  Lt: 0,
  ct: 0
};
function W() {
  const e = (t) => Array.from({ length: k }, () => t);
  return {
    L: e(R.L),
    c: e(R.c),
    s: e(R.s),
    Lt: e(R.Lt),
    ct: e(R.ct)
  };
}
function O(e) {
  return { L: [...e.L], c: [...e.c], s: [...e.s], Lt: [...e.Lt], ct: [...e.ct] };
}
const ee = 8, x = [0, 2, 4, 6], F = x.length, Ne = x.map((e) => 1 - (e + 0.5) / ee), He = Array.from(
  { length: ee },
  (e, t) => 1 - (t + 0.5) / ee
);
function me(e) {
  return e < 0 ? 0 : e > 1 ? 1 : e;
}
function te(e, t) {
  const o = e.length;
  let a = o - 2;
  for (let S = 0; S < o - 2; S++)
    if (t < A[S + 1]) {
      a = S;
      break;
    }
  const s = (S, v) => (e[v] - e[S]) / (A[v] - A[S]), c = a === 0 ? s(0, 1) : s(a - 1, a + 1), d = a === o - 2 ? s(o - 2, o - 1) : s(a, a + 2), m = A[a + 1] - A[a], g = (t - A[a]) / m, f = g * g, p = f * g, B = 2 * p - 3 * f + 1, P = p - 2 * f + g, u = -2 * p + 3 * f, y = p - f;
  return me(B * e[a] + P * m * c + u * e[a + 1] + y * m * d);
}
function H(e, t, o, a) {
  const s = R[t], c = a === 1 ? e[t] : e[t].map((d) => me(s + a * (d - s)));
  return te(c, o);
}
function qe(e, t, o) {
  const a = Ne[t], s = H(e, "L", a, o), c = H(e, "c", a, o), d = H(e, "Lt", a, o), m = H(e, "ct", a, o), g = Math.pow(2, -7 * (1 - a));
  return {
    gainL: 2 * s * (2 * s) - 1,
    gainC: 2 * c * (2 * c) - 1,
    thrL: g * 10 * d,
    thrC: g * 20 * m
  };
}
function Ge(e, t) {
  return He.map((o) => 25e-4 * H(e, "s", o, t));
}
const K = "contrast-equalizer";
function ue(e) {
  let t = 0;
  for (let o = 0; o < e.length; o++) t = (t << 5) - t + e.charCodeAt(o) | 0;
  return (t >>> 0).toString(36).slice(0, 4);
}
const pe = ["fine", "medium", "coarse", "coarsest"], Ue = (() => {
  const e = [], t = /* @__PURE__ */ new Set();
  for (let o = 0; o < F; o++) {
    const a = `${K}.${pe[o] ?? `octave${o}`}`;
    let s = 0, c = a;
    for (; t.has(ue(c)) && s < 1e3; ) c = `${a}-${++s}`;
    t.add(ue(c)), e.push(c);
  }
  return e;
})(), ne = (e) => Ue[e], T = "100.0", Xe = `
// B3 spline 1D weights [1,4,6,4,1]/16.
float ceB3(int d) { d = d < 0 ? -d : d; return d == 0 ? 0.375 : (d == 1 ? 0.25 : 0.0625); }
// Per-level edge sharpness (darktable 'sharp'): levels 0-3 in A, 4-7 in B.
float ceSharp(int i) {
  vec4 v = i < 4 ? uSharpsA : uSharpsB;
  int k = i < 4 ? i : i - 4;
  return k == 0 ? v.x : (k == 1 ? v.y : (k == 2 ? v.z : v.w));
}
`, Ye = `
{
  float mult = exp2(float(uPassIndex));
  float sharp = ceSharp(uPassIndex);
  vec3 ctr = c;
  float Lc = luma(ctr) * ${T};
  vec3  abC = (ctr - luma(ctr)) * ${T};   // chroma (zero-luma) of the centre
  float sumL = 0.0, wL = 0.0;
  vec3  sumC = vec3(0.0); float wC = 0.0;
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      vec2 off = vec2(float(dx), float(dy)) * mult * uTexel;
      vec3 s = readPrev(vUv + off);
      float f = ceB3(dx) * ceB3(dy);
      float Ls = luma(s) * ${T};
      vec3  abS = (s - luma(s)) * ${T};
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
  float coarseL = (wL > 0.0 ? sumL / wL : Lc) / ${T};
  vec3  coarseAb = (wC > 0.0 ? sumC / wC : abC) / ${T};
  vec3 coarse = vec3(coarseL) + coarseAb;
  // The chained coarse stays as-is; the final pass emits this octave's *signed*
  // detail, bias-encoded into [0,1] (0.5 = zero) so it survives the host's RGBA8
  // ping-pong fallback on GPUs without EXT_color_buffer_float. The inline decodes
  // it. (On the RGBA16F path this just costs ~1 bit of precision.)
  c = (uPassIndex == uPassCount - 1) ? ((ctr - coarse) * 0.5 + 0.5) : coarse;
}
`, Oe = `
{
  vec3 d = (stageResult - 0.5) * 2.0;      // decode the bias-encoded signed detail
  float dL = luma(d);
  vec3  dC = d - dL;                       // chroma part (zero luma)
  float dL100 = dL * ${T};
  float coreL = sign(dL100) * max(abs(dL100) - thrL, 0.0) / ${T};
  float addL = (1.0 + gainL) * coreL - dL;
  float cmag = length(dC) * ${T};
  float fac = cmag > 1e-5 ? max(cmag - thrC, 0.0) / cmag : 0.0;
  vec3  coreC = dC * fac;
  vec3  addC = (1.0 + gainC) * coreC - dC;
  lin += vec3(addL) + addC;
}
`, We = [
  { key: "gainL", glslType: "float", default: 0, label: "Luma gain" },
  { key: "gainC", glslType: "float", default: 0, label: "Chroma gain" },
  { key: "thrL", glslType: "float", default: 0, label: "Luma threshold" },
  { key: "thrC", glslType: "float", default: 0, label: "Chroma threshold" }
];
function xe(e) {
  return {
    glsl: Ye,
    helpers: Xe,
    // Reaching octave o's detail takes the full chain: o+1 levels from the source.
    iterations: x[e] + 1,
    uniforms: [
      { key: "uSharpsA", glslType: "vec4", default: [0, 0, 0, 0] },
      { key: "uSharpsB", glslType: "vec4", default: [0, 0, 0, 0] }
    ]
  };
}
function Fe(e) {
  return {
    id: ne(e),
    name: `Contrast Equalizer · ${pe[e] ?? `band ${e}`}`,
    // Scene-linear, after exposure/white balance; bands are additive so their
    // order among themselves doesn't matter.
    phase: "scene-linear",
    priority: 70 + e,
    glsl: Oe,
    uniforms: We,
    passes: [xe(e)]
  };
}
function Ke() {
  return Array.from({ length: F }, (e, t) => Fe(t));
}
const ge = ["L", "c", "s", "Lt", "ct"], Le = (e) => `${K}.curve.${e}`, be = `${K}.mix`, oe = 1;
function Ve(e) {
  return Array.isArray(e) && e.length === k && e.every((t) => typeof t == "number");
}
function je(e) {
  const t = W(), o = O(t);
  for (const a of ge) {
    const s = e[Le(a)];
    Ve(s) && (o[a] = [...s]);
  }
  return o;
}
function Je(e) {
  const t = e[be];
  return typeof t == "number" ? t : oe;
}
function ve(e, t) {
  const o = {};
  for (const s of ge) o[Le(s)] = [...e[s]];
  o[be] = t;
  const a = Ge(e, t);
  for (let s = 0; s < F; s++) {
    const c = ne(s), d = qe(e, s, t);
    o[`${c}.gainL`] = d.gainL, o[`${c}.gainC`] = d.gainC, o[`${c}.thrL`] = d.thrL, o[`${c}.thrC`] = d.thrC;
    const m = d.gainL === 0 && d.gainC === 0 && d.thrL === 0 && d.thrC === 0, g = a.map((f, p) => !m && p <= x[s] ? f : 0);
    o[`${c}.uSharpsA`] = g.slice(0, 4), o[`${c}.uSharpsB`] = g.slice(4, 8);
  }
  return o;
}
const _ = (e) => {
  const t = W();
  for (const o of Object.keys(e)) t[o] = e[o].slice();
  return t;
}, de = [
  { id: "flat", label: "Flat (reset)", build: () => W() },
  {
    id: "sharpen",
    label: "Sharpen",
    build: () => _({ L: [0.5, 0.5, 0.5, 0.56, 0.66, 0.74] })
  },
  {
    id: "deblur-medium",
    label: "Deblur · medium",
    build: () => _({ L: [0.5, 0.5, 0.54, 0.64, 0.78, 0.86] })
  },
  {
    id: "deblur-strong",
    label: "Deblur · strong",
    build: () => _({ L: [0.5, 0.52, 0.6, 0.74, 0.9, 1] })
  },
  {
    id: "clarity",
    label: "Local contrast (clarity)",
    build: () => _({ L: [0.5, 0.58, 0.64, 0.6, 0.52, 0.5] })
  },
  {
    id: "bloom",
    label: "Bloom",
    build: () => _({ L: [0.5, 0.64, 0.7, 0.6, 0.5, 0.44] })
  },
  {
    id: "denoise-luma",
    label: "Denoise · luma",
    build: () => _({ Lt: [0, 0, 0.1, 0.35, 0.62, 0.82] })
  },
  {
    id: "denoise-chroma",
    label: "Denoise · chroma",
    build: () => _({ ct: [0, 0, 0.15, 0.45, 0.72, 0.9] })
  },
  {
    id: "denoise-sharpen",
    label: "Denoise & sharpen",
    build: () => _({
      L: [0.5, 0.5, 0.5, 0.56, 0.66, 0.72],
      Lt: [0, 0, 0.08, 0.3, 0.55, 0.75],
      ct: [0, 0, 0.12, 0.4, 0.65, 0.85]
    })
  }
], fe = [
  { key: "luma", label: "luma", primary: "L", thr: "Lt", color: "#dcdcdc", thrColor: "#5a8fd0" },
  { key: "chroma", label: "chroma", primary: "c", thr: "ct", color: "#d8b25a", thrColor: "#c06a9a" },
  { key: "edges", label: "edges", primary: "s", thr: null, color: "#6ac08a", thrColor: null }
], h = 10, Qe = 12, Ze = 3;
function he(e) {
  return e < 0 ? 0 : e > 1 ? 1 : e;
}
function et(e, t, o, a, s, c, d) {
  const m = t - 2 * h, g = o - 2 * h, f = (u) => h + u * m, p = (u) => h + (1 - u) * g;
  e.clearRect(0, 0, t, o), e.strokeStyle = "rgba(128,128,128,0.16)", e.lineWidth = 1;
  for (let u = 0; u < k; u++)
    e.beginPath(), e.moveTo(f(A[u]), h), e.lineTo(f(A[u]), h + g), e.stroke();
  for (let u = 0; u <= 4; u++) {
    const y = h + u / 4 * g;
    e.beginPath(), e.moveTo(h, y), e.lineTo(h + m, y), e.stroke();
  }
  e.strokeStyle = "rgba(160,160,160,0.4)", e.lineWidth = 1, e.beginPath(), e.moveTo(h, p(0.5)), e.lineTo(h + m, p(0.5)), e.stroke();
  const B = (u, y, S, v) => {
    e.beginPath();
    for (let L = 0; L <= m; L++) {
      const b = L / m, E = te(u, b);
      L === 0 ? e.moveTo(f(b), p(E)) : e.lineTo(f(b), p(E));
    }
    {
      e.lineTo(f(1), p(v)), e.lineTo(f(0), p(v)), e.closePath(), e.fillStyle = y, e.globalAlpha = 0.14, e.fill(), e.globalAlpha = 1, e.beginPath();
      for (let L = 0; L <= m; L++) {
        const b = L / m, E = te(u, b);
        L === 0 ? e.moveTo(f(b), p(E)) : e.lineTo(f(b), p(E));
      }
    }
    e.strokeStyle = y, e.lineWidth = 1.6, e.stroke();
  };
  s.thr && s.thrColor && B(a[s.thr], s.thrColor, !0, 0), B(a[s.primary], s.color, !0, 0.5);
  const P = (u, y) => {
    const S = a[u];
    for (let v = 0; v < k; v++) {
      const L = f(A[v]), b = p(S[v]);
      c && c.channel === u && c.index === v && (e.strokeStyle = "#ffffff", e.lineWidth = 1.5, e.beginPath(), e.arc(L, b, 5.5, 0, Math.PI * 2), e.stroke()), e.fillStyle = y, e.beginPath(), e.arc(L, b, 3, 0, Math.PI * 2), e.fill();
    }
  };
  s.thr && s.thrColor && P(s.thr, s.thrColor), P(s.primary, s.color), d && (e.strokeStyle = "rgba(255,255,255,0.55)", e.lineWidth = 1, e.beginPath(), e.arc(d.x, d.y, d.r, 0, Math.PI * 2), e.stroke()), e.fillStyle = "rgba(170,170,170,0.7)", e.font = "9px sans-serif", e.textBaseline = "bottom", e.textAlign = "left", e.fillText("coarse", h + 1, o - 1), e.textAlign = "right", e.fillText("fine", h + m - 1, o - 1);
}
function tt() {
  const e = I().react, { useState: t, useRef: o, useEffect: a } = e, s = I().stores.useDevelopStore, c = I().components.Slider, d = I().ui;
  if (!d)
    return $(
      "div",
      { style: { padding: "10px", fontSize: "11px", color: "var(--color-text-muted)" } },
      "Update Safelight to use this panel."
    );
  const { SegmentedControl: m, Select: g } = d, f = s((n) => n.paramBag), p = s(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (n) => n.setDynParams
  ), B = s((n) => n.commitEdit), P = je(f), u = Je(f), [y, S] = t("luma"), [v, L] = t(null), [b, E] = t(() => I().settings.get("coupling", 1)), [w, ye] = t({ w: 240, h: 150 }), [q, se] = t(null), re = o(null), V = o(null), M = o(null), ae = o(b);
  ae.current = b;
  const N = fe.find((n) => n.key === y);
  a(() => {
    const n = re.current;
    if (!n) return;
    const r = new ResizeObserver((i) => {
      const l = i[0].contentRect.width;
      l > 0 && ye({ w: Math.round(l), h: Math.round(l * 0.62) });
    });
    return r.observe(n), () => r.disconnect();
  }, []), a(() => {
    const n = V.current;
    if (!n) return;
    const r = (i) => {
      i.preventDefault();
      const l = i.deltaY < 0 ? 1 : -1, C = Math.min(k - 1, Math.max(0.4, ae.current + l * 0.25));
      E(C), I().settings.set("coupling", C);
    };
    return n.addEventListener("wheel", r, { passive: !1 }), () => n.removeEventListener("wheel", r);
  }, []), a(() => {
    const n = V.current;
    if (!n) return;
    const r = window.devicePixelRatio || 1;
    n.width = w.w * r, n.height = w.h * r;
    const i = n.getContext("2d");
    if (!i) return;
    i.setTransform(r, 0, 0, r, 0, 0);
    const l = w.w - 2 * h, C = b / (k - 1) * l;
    et(
      i,
      w.w,
      w.h,
      P,
      N,
      v,
      q ? { x: q.x, y: q.y, r: C } : null
    );
  }, [f, y, v, b, w, q]);
  const j = (n) => {
    const r = n.currentTarget.getBoundingClientRect(), i = r.width > 0 ? w.w / r.width : 1, l = r.height > 0 ? w.h / r.height : 1;
    return { x: (n.clientX - r.left) * i, y: (n.clientY - r.top) * l };
  }, Ce = w.w - 2 * h, le = w.h - 2 * h, Se = (n) => he(1 - (n - h) / le), we = (n, r) => [
    h + A[r] * Ce,
    h + (1 - P[n][r]) * le
  ], ie = (n, r) => {
    const i = N.thr ? [N.primary, N.thr] : [N.primary];
    let l = null, C = Qe;
    for (const z of i)
      for (let D = 0; D < k; D++) {
        const [X, J] = we(z, D), Y = Math.hypot(X - n, J - r);
        Y <= C && (C = Y, l = { channel: z, index: D });
      }
    return l;
  }, G = (n, r = u) => p(ve(n, r)), U = () => B("Contrast Equalizer"), Pe = (n, r, i) => {
    const l = r[n.channel], C = i - l[n.index], z = Math.max(0.18, b), D = l.map((J, Y) => {
      const ce = (Y - n.index) / z, ze = Math.exp(-0.5 * ce * ce);
      return he(J + C * ze);
    }), X = O(r);
    X[n.channel] = D, G(X);
  }, Ae = (n) => {
    const { x: r, y: i } = j(n), l = ie(r, i);
    l && (n.currentTarget.setPointerCapture(n.pointerId), M.current = { hit: l, snapshot: O(P), startX: r, startY: i, moved: !1 }, L(l));
  }, Te = (n) => {
    const { x: r, y: i } = j(n);
    se({ x: r, y: i });
    const l = M.current;
    l && (!l.moved && Math.hypot(r - l.startX, i - l.startY) < Ze || (l.moved = !0, Pe(l.hit, l.snapshot, Se(i))));
  }, ke = () => {
    const n = M.current;
    M.current = null, n && n.moved && U();
  }, Ee = () => {
    M.current || se(null);
  }, De = (n) => {
    const { x: r, y: i } = j(n), l = ie(r, i);
    if (!l) return;
    const C = O(P);
    C[l.channel] = C[l.channel].map(
      (z, D) => D === l.index ? R[l.channel] : z
    ), G(C), U();
  }, $e = $(m, {
    value: y,
    size: "sm",
    options: fe.map((n) => ({ value: n.key, label: n.label })),
    onChange: (n) => {
      S(n), L(null);
    }
  }), _e = $(
    "div",
    { ref: re, style: { width: "100%" } },
    $("canvas", {
      ref: V,
      style: {
        width: w.w,
        height: w.h,
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
  ), Re = $(g, {
    value: "",
    style: { width: "100%" },
    onChange: (n) => {
      const r = de.find((i) => i.id === n);
      r && (G(r.build()), U(), L(null));
    },
    options: [
      { value: "", label: "Presets…" },
      ...de.map((n) => ({ value: n.id, label: n.label }))
    ]
  }), Be = $(
    "p",
    { style: { margin: "2px 0 0", fontSize: 10, color: "var(--color-text-muted)", lineHeight: 1.35 } },
    "Drag nodes vertically · wheel sets the influence radius · double-click resets a node."
  );
  return $(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 6, padding: 8 } },
    $e,
    _e,
    $(c, {
      label: "Mix",
      value: u,
      min: 0,
      max: 3,
      step: 0.01,
      defaultValue: oe,
      onChange: (n) => G(P, n),
      onCommit: U
    }),
    Re,
    Be
  );
}
const nt = `${K}.panel`;
function ot(e) {
  const t = e.stores.useDevelopStore.getState();
  t.setDynParams(ve(W(), oe)), t.commitEdit("Contrast Equalizer reset");
}
function st(e) {
  Ie(e);
  for (const t of Ke()) e.registerProcessingStage(t);
  e.registerPanel({
    id: nt,
    title: "Contrast Equalizer",
    component: tt,
    defaultDock: { module: "develop", direction: "right", order: 7, width: 268 },
    onReset: () => ot(e)
  });
}
function rt() {
  const e = globalThis.safelight;
  if (e)
    for (let t = 0; t < F; t++) e.unregisterProcessingStage(ne(t));
}
export {
  st as activate,
  rt as deactivate
};
//# sourceMappingURL=index.js.map
