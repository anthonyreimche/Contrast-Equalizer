//#region src/runtime.ts
var e = null, t = null;
function n(n) {
	e = n.react, t = n;
}
function r() {
	if (!t) throw Error("[contrast-equalizer] api used before activate()");
	return t;
}
function i() {
	if (!e) throw Error("[contrast-equalizer] runtime used before activate()");
	return e;
}
function a(e, t, ...n) {
	return i().createElement(e, t, ...n);
}
var o = Array.from({ length: 6 }, (e, t) => t / 5), s = {
	L: .5,
	c: .5,
	s: .5,
	Lt: 0,
	ct: 0
};
function c() {
	let e = (e) => Array.from({ length: 6 }, () => e);
	return {
		L: e(s.L),
		c: e(s.c),
		s: e(s.s),
		Lt: e(s.Lt),
		ct: e(s.ct)
	};
}
function l(e) {
	return {
		L: [...e.L],
		c: [...e.c],
		s: [...e.s],
		Lt: [...e.Lt],
		ct: [...e.ct]
	};
}
var u = Array.from({ length: 4 }, (e, t) => 1 - (t + .5) / 4), d = {
	fine: [
		1,
		2,
		4,
		8
	],
	extended: [
		1,
		4,
		16,
		64
	]
};
function f(e) {
	return e < 0 ? 0 : e > 1 ? 1 : e;
}
function p(e, t) {
	let n = e.length;
	if (t <= o[0]) return f(e[0]);
	if (t >= o[n - 1]) return f(e[n - 1]);
	let r = 0;
	for (; r < n - 1 && t > o[r + 1];) r++;
	let i = o[r], a = o[r + 1], s = (t - i) / (a - i), c = e[Math.max(0, r - 1)], l = e[r], u = e[r + 1], d = e[Math.min(n - 1, r + 2)], p = s * s, m = p * s;
	return f(.5 * (2 * l + (-c + u) * s + (2 * c - 5 * l + 4 * u - d) * p + (-c + 3 * l - 3 * u + d) * m));
}
function m(e, t, n, r) {
	let i = s[t];
	return f(i + r * (p(e[t], n) - i));
}
function h(e, t, n) {
	let r = u[t], i = m(e, "L", r, n), a = m(e, "c", r, n), o = m(e, "Lt", r, n), s = m(e, "ct", r, n), c = 2 ** (-7 * (1 - r));
	return {
		gainL: 2 * i * (2 * i) - 1,
		gainC: 2 * a * (2 * a) - 1,
		thrL: c * 10 * o,
		thrC: c * 20 * s
	};
}
function g(e, t) {
	let n = u.map((n) => .0025 * m(e, "s", n, t));
	return [
		n[0],
		n[1],
		n[2],
		n[3]
	];
}
//#endregion
//#region src/wavelet.ts
var _ = "contrast-equalizer";
function v(e) {
	let t = 0;
	for (let n = 0; n < e.length; n++) t = (t << 5) - t + e.charCodeAt(n) | 0;
	return (t >>> 0).toString(36).slice(0, 4);
}
var y = [
	"fine",
	"medium",
	"coarse",
	"coarsest"
], b = (() => {
	let e = [], t = /* @__PURE__ */ new Set();
	for (let n = 0; n < 4; n++) {
		let r = `${_}.${y[n] ?? `octave${n}`}`, i = 0, a = r;
		for (; t.has(v(a)) && i < 1e3;) a = `${r}-${++i}`;
		t.add(v(a)), e.push(a);
	}
	return e;
})(), x = (e) => b[e], S = "100.0";
function C(e) {
	let [t, n, r, i] = e;
	return `
// B3 spline 1D weights [1,4,6,4,1]/16.
float ceB3(int d) { d = d < 0 ? -d : d; return d == 0 ? 0.375 : (d == 1 ? 0.25 : 0.0625); }
// Per-scale edge sharpness (darktable 'sharp'), one component per octave.
float ceSharp(int i) {
  return i == 0 ? uSharps.x : (i == 1 ? uSharps.y : (i == 2 ? uSharps.z : uSharps.w));
}
// Kernel dilation per pass (the detail-range schedule).
int ceDil(int j) { return j == 0 ? ${t} : (j == 1 ? ${n} : (j == 2 ? ${r} : ${i})); }
`;
}
var w = `
{
  int mult = ceDil(uPassIndex);
  float sharp = ceSharp(uPassIndex);
  vec3 ctr = c;
  float Lc = luma(ctr) * ${S};
  vec3  abC = (ctr - luma(ctr)) * ${S};   // chroma (zero-luma) of the centre
  float sumL = 0.0, wL = 0.0;
  vec3  sumC = vec3(0.0); float wC = 0.0;
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      vec2 off = vec2(float(dx), float(dy)) * float(mult) * uTexel;
      vec3 s = readPrev(vUv + off);
      float f = ceB3(dx) * ceB3(dy);
      float Ls = luma(s) * ${S};
      vec3  abS = (s - luma(s)) * ${S};
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
  float coarseL = (wL > 0.0 ? sumL / wL : Lc) / ${S};
  vec3  coarseAb = (wC > 0.0 ? sumC / wC : abC) / ${S};
  vec3 coarse = vec3(coarseL) + coarseAb;
  // The chained coarse stays as-is; the final pass emits this octave's *signed*
  // detail, bias-encoded into [0,1] (0.5 = zero) so it survives the host's RGBA8
  // ping-pong fallback on GPUs without EXT_color_buffer_float. The inline decodes
  // it. (On the RGBA16F path this just costs ~1 bit of precision.)
  c = (uPassIndex == uPassCount - 1) ? ((ctr - coarse) * 0.5 + 0.5) : coarse;
}
`, T = `
{
  vec3 d = (stageResult - 0.5) * 2.0;      // decode the bias-encoded signed detail
  float dL = luma(d);
  vec3  dC = d - dL;                       // chroma part (zero luma)
  float dL100 = dL * ${S};
  float coreL = sign(dL100) * max(abs(dL100) - thrL, 0.0) / ${S};
  float addL = (1.0 + gainL) * coreL - dL;
  float cmag = length(dC) * ${S};
  float fac = cmag > 1e-5 ? max(cmag - thrC, 0.0) / cmag : 0.0;
  vec3  coreC = dC * fac;
  vec3  addC = (1.0 + gainC) * coreC - dC;
  lin += vec3(addL) + addC;
}
`, E = [
	{
		key: "gainL",
		glslType: "float",
		default: 0,
		label: "Luma gain"
	},
	{
		key: "gainC",
		glslType: "float",
		default: 0,
		label: "Chroma gain"
	},
	{
		key: "thrL",
		glslType: "float",
		default: 0,
		label: "Luma threshold"
	},
	{
		key: "thrC",
		glslType: "float",
		default: 0,
		label: "Chroma threshold"
	}
];
function D(e, t) {
	return {
		glsl: w,
		helpers: C(t),
		iterations: e + 1,
		uniforms: [{
			key: "uSharps",
			glslType: "vec4",
			default: [
				0,
				0,
				0,
				0
			]
		}]
	};
}
function O(e, t) {
	return {
		id: x(e),
		name: `Contrast Equalizer · scale ${e}`,
		phase: "scene-linear",
		priority: 70 + e,
		glsl: T,
		uniforms: E,
		passes: [D(e, t)]
	};
}
function k(e) {
	return Array.from({ length: 4 }, (t, n) => O(n, e));
}
//#endregion
//#region src/params.ts
var A = [
	"L",
	"c",
	"s",
	"Lt",
	"ct"
], j = (e) => `${_}.curve.${e}`, M = `${_}.mix`;
function N(e) {
	return Array.isArray(e) && e.length === 6 && e.every((e) => typeof e == "number");
}
function P(e) {
	let t = l(c());
	for (let n of A) {
		let r = e[j(n)];
		N(r) && (t[n] = [...r]);
	}
	return t;
}
function F(e) {
	let t = e[M];
	return typeof t == "number" ? t : 1;
}
function I(e, t) {
	let n = {};
	for (let t of A) n[j(t)] = [...e[t]];
	n[M] = t;
	let r = g(e, t);
	for (let i = 0; i < 4; i++) {
		let a = x(i), o = h(e, i, t);
		n[`${a}.gainL`] = o.gainL, n[`${a}.gainC`] = o.gainC, n[`${a}.thrL`] = o.thrL, n[`${a}.thrC`] = o.thrC, n[`${a}.uSharps`] = r.map((e, t) => t <= i ? e : 0);
	}
	return n;
}
//#endregion
//#region src/presets.ts
var L = (e) => {
	let t = c();
	for (let n of Object.keys(e)) t[n] = e[n].slice();
	return t;
}, R = [
	{
		id: "flat",
		label: "Flat (reset)",
		build: () => c()
	},
	{
		id: "sharpen",
		label: "Sharpen",
		build: () => L({ L: [
			.5,
			.5,
			.5,
			.56,
			.66,
			.74
		] })
	},
	{
		id: "deblur-medium",
		label: "Deblur · medium",
		build: () => L({ L: [
			.5,
			.5,
			.54,
			.64,
			.78,
			.86
		] })
	},
	{
		id: "deblur-strong",
		label: "Deblur · strong",
		build: () => L({ L: [
			.5,
			.52,
			.6,
			.74,
			.9,
			1
		] })
	},
	{
		id: "clarity",
		label: "Local contrast (clarity)",
		build: () => L({ L: [
			.5,
			.58,
			.64,
			.6,
			.52,
			.5
		] })
	},
	{
		id: "bloom",
		label: "Bloom",
		build: () => L({ L: [
			.5,
			.64,
			.7,
			.6,
			.5,
			.44
		] })
	},
	{
		id: "denoise-luma",
		label: "Denoise · luma",
		build: () => L({ Lt: [
			0,
			0,
			.1,
			.35,
			.62,
			.82
		] })
	},
	{
		id: "denoise-chroma",
		label: "Denoise · chroma",
		build: () => L({ ct: [
			0,
			0,
			.15,
			.45,
			.72,
			.9
		] })
	},
	{
		id: "denoise-sharpen",
		label: "Denoise & sharpen",
		build: () => L({
			L: [
				.5,
				.5,
				.5,
				.56,
				.66,
				.72
			],
			Lt: [
				0,
				0,
				.08,
				.3,
				.55,
				.75
			],
			ct: [
				0,
				0,
				.12,
				.4,
				.65,
				.85
			]
		})
	}
], z = [
	{
		key: "luma",
		label: "luma",
		primary: "L",
		thr: "Lt",
		color: "#dcdcdc",
		thrColor: "#5a8fd0"
	},
	{
		key: "chroma",
		label: "chroma",
		primary: "c",
		thr: "ct",
		color: "#d8b25a",
		thrColor: "#c06a9a"
	},
	{
		key: "edges",
		label: "edges",
		primary: "s",
		thr: null,
		color: "#6ac08a",
		thrColor: null
	}
], B = 10, V = 12, H = 3;
function U(e) {
	return e < 0 ? 0 : e > 1 ? 1 : e;
}
function W(e, t, n, r, i, a, s) {
	let c = t - 2 * B, l = n - 2 * B, u = (e) => B + e * c, d = (e) => B + (1 - e) * l;
	e.clearRect(0, 0, t, n), e.strokeStyle = "rgba(128,128,128,0.16)", e.lineWidth = 1;
	for (let t = 0; t < 6; t++) e.beginPath(), e.moveTo(u(o[t]), B), e.lineTo(u(o[t]), B + l), e.stroke();
	for (let t = 0; t <= 4; t++) {
		let n = B + t / 4 * l;
		e.beginPath(), e.moveTo(B, n), e.lineTo(B + c, n), e.stroke();
	}
	e.strokeStyle = "rgba(160,160,160,0.4)", e.lineWidth = 1, e.beginPath(), e.moveTo(B, d(.5)), e.lineTo(B + c, d(.5)), e.stroke();
	let f = (t, n, r, i) => {
		e.beginPath();
		for (let n = 0; n <= c; n++) {
			let r = n / c, i = p(t, r);
			n === 0 ? e.moveTo(u(r), d(i)) : e.lineTo(u(r), d(i));
		}
		if (r) {
			e.lineTo(u(1), d(i)), e.lineTo(u(0), d(i)), e.closePath(), e.fillStyle = n, e.globalAlpha = .14, e.fill(), e.globalAlpha = 1, e.beginPath();
			for (let n = 0; n <= c; n++) {
				let r = n / c, i = p(t, r);
				n === 0 ? e.moveTo(u(r), d(i)) : e.lineTo(u(r), d(i));
			}
		}
		e.strokeStyle = n, e.lineWidth = 1.6, e.stroke();
	};
	i.thr && i.thrColor && f(r[i.thr], i.thrColor, !0, 0), f(r[i.primary], i.color, !0, .5);
	let m = (t, n) => {
		let i = r[t];
		for (let r = 0; r < 6; r++) {
			let s = u(o[r]), c = d(i[r]);
			a && a.channel === t && a.index === r && (e.strokeStyle = "#ffffff", e.lineWidth = 1.5, e.beginPath(), e.arc(s, c, 5.5, 0, Math.PI * 2), e.stroke()), e.fillStyle = n, e.beginPath(), e.arc(s, c, 3, 0, Math.PI * 2), e.fill();
		}
	};
	i.thr && i.thrColor && m(i.thr, i.thrColor), m(i.primary, i.color), s && (e.strokeStyle = "rgba(255,255,255,0.55)", e.lineWidth = 1, e.beginPath(), e.arc(s.x, s.y, s.r, 0, Math.PI * 2), e.stroke()), e.fillStyle = "rgba(170,170,170,0.7)", e.font = "9px sans-serif", e.textBaseline = "bottom", e.textAlign = "left", e.fillText("coarse", 11, n - 1), e.textAlign = "right", e.fillText("fine", B + c - 1, n - 1);
}
function G() {
	let { useState: e, useRef: t, useEffect: n } = r().react, i = r().stores.useDevelopStore, c = r().components.Slider, u = i((e) => e.paramBag), d = i((e) => e.setDynParams), f = i((e) => e.commitEdit), p = P(u), m = F(u), [h, g] = e("luma"), [_, v] = e(null), [y, b] = e(() => r().settings.get("coupling", 1)), [x, S] = e({
		w: 240,
		h: 150
	}), [C, w] = e(null), T = t(null), E = t(null), D = t(null), O = t(y);
	O.current = y;
	let k = z.find((e) => e.key === h);
	n(() => {
		let e = T.current;
		if (!e) return;
		let t = new ResizeObserver((e) => {
			let t = e[0].contentRect.width;
			t > 0 && S({
				w: Math.round(t),
				h: Math.round(t * .62)
			});
		});
		return t.observe(e), () => t.disconnect();
	}, []), n(() => {
		let e = E.current;
		if (!e) return;
		let t = (e) => {
			e.preventDefault();
			let t = e.deltaY < 0 ? 1 : -1, n = Math.min(5, Math.max(.4, O.current + t * .25));
			b(n), r().settings.set("coupling", n);
		};
		return e.addEventListener("wheel", t, { passive: !1 }), () => e.removeEventListener("wheel", t);
	}, []), n(() => {
		let e = E.current;
		if (!e) return;
		let t = window.devicePixelRatio || 1;
		e.width = x.w * t, e.height = x.h * t;
		let n = e.getContext("2d");
		if (!n) return;
		n.setTransform(t, 0, 0, t, 0, 0);
		let r = x.w - 2 * B, i = y / 5 * r;
		W(n, x.w, x.h, p, k, _, C ? {
			x: C.x,
			y: C.y,
			r: i
		} : null);
	}, [
		u,
		h,
		_,
		y,
		x,
		C
	]);
	let A = (e) => {
		let t = e.currentTarget.getBoundingClientRect(), n = t.width > 0 ? x.w / t.width : 1, r = t.height > 0 ? x.h / t.height : 1;
		return {
			x: (e.clientX - t.left) * n,
			y: (e.clientY - t.top) * r
		};
	}, j = x.w - 2 * B, M = x.h - 2 * B, N = (e) => U(1 - (e - B) / M), L = (e, t) => [B + o[t] * j, B + (1 - p[e][t]) * M], G = (e, t) => {
		let n = k.thr ? [k.primary, k.thr] : [k.primary], r = null, i = V;
		for (let a of n) for (let n = 0; n < 6; n++) {
			let [o, s] = L(a, n), c = Math.hypot(o - e, s - t);
			c <= i && (i = c, r = {
				channel: a,
				index: n
			});
		}
		return r;
	}, K = (e, t = m) => d(I(e, t)), q = () => f("Contrast Equalizer"), J = (e, t, n) => {
		let r = t[e.channel], i = n - r[e.index], a = Math.max(.18, y), o = r.map((t, n) => {
			let r = (n - e.index) / a;
			return U(t + i * Math.exp(-.5 * r * r));
		}), s = l(t);
		s[e.channel] = o, K(s);
	}, Y = (e) => {
		let { x: t, y: n } = A(e), r = G(t, n);
		r && (e.currentTarget.setPointerCapture(e.pointerId), D.current = {
			hit: r,
			snapshot: l(p),
			startX: t,
			startY: n,
			moved: !1
		}, v(r));
	}, X = (e) => {
		let { x: t, y: n } = A(e);
		w({
			x: t,
			y: n
		});
		let r = D.current;
		r && (!r.moved && Math.hypot(t - r.startX, n - r.startY) < H || (r.moved = !0, J(r.hit, r.snapshot, N(n))));
	}, Z = () => {
		let e = D.current;
		D.current = null, e && e.moved && q();
	}, Q = () => {
		D.current || w(null);
	}, $ = (e) => {
		let { x: t, y: n } = A(e), r = G(t, n);
		if (!r) return;
		let i = l(p);
		i[r.channel] = i[r.channel].map((e, t) => t === r.index ? s[r.channel] : e), K(i), q();
	}, ee = a("div", { style: {
		display: "flex",
		marginBottom: 6,
		borderRadius: 4,
		overflow: "hidden",
		background: "var(--color-surface-2)"
	} }, z.map((e) => a("button", {
		key: e.key,
		onClick: () => {
			g(e.key), v(null);
		},
		style: {
			flex: 1,
			padding: "4px 0",
			fontSize: 10,
			fontWeight: 600,
			textTransform: "uppercase",
			letterSpacing: "0.08em",
			border: "none",
			cursor: "pointer",
			background: h === e.key ? "var(--color-surface-3)" : "transparent",
			color: h === e.key ? e.color : "var(--color-text-muted)"
		}
	}, e.label))), te = a("div", {
		ref: T,
		style: { width: "100%" }
	}, a("canvas", {
		ref: E,
		style: {
			width: x.w,
			height: x.h,
			touchAction: "none",
			borderRadius: 4,
			background: "var(--color-surface-0)",
			cursor: "ns-resize",
			display: "block"
		},
		onPointerDown: Y,
		onPointerMove: X,
		onPointerUp: Z,
		onPointerLeave: Q,
		onDoubleClick: $
	})), ne = a("select", {
		value: "",
		onChange: (e) => {
			let t = R.find((t) => t.id === e.target.value);
			t && (K(t.build()), q(), v(null));
		},
		style: {
			width: "100%",
			borderRadius: 4,
			background: "var(--color-surface-2)",
			color: "var(--color-text-primary)",
			border: "none",
			padding: "3px 6px",
			fontSize: 11,
			outline: "none"
		}
	}, [a("option", {
		key: "_",
		value: ""
	}, "Presets…"), ...R.map((e) => a("option", {
		key: e.id,
		value: e.id
	}, e.label))]), re = a("p", { style: {
		margin: "2px 0 0",
		fontSize: 10,
		color: "var(--color-text-muted)",
		lineHeight: 1.35
	} }, "Drag nodes vertically · wheel sets the influence radius · double-click resets a node.");
	return a("div", { style: {
		display: "flex",
		flexDirection: "column",
		gap: 6,
		padding: 8
	} }, ee, te, a(c, {
		label: "Mix",
		value: m,
		min: 0,
		max: 3,
		step: .01,
		defaultValue: 1,
		onChange: (e) => K(p, e),
		onCommit: q
	}), ne, re);
}
//#endregion
//#region src/index.ts
var K = `${_}.panel`, q = "range";
function J(e) {
	return e.settings.get(q, "fine") === "extended" ? "extended" : "fine";
}
function Y(e, t) {
	for (let n of k(d[t])) e.registerProcessingStage(n);
}
function X(e) {
	let t = e.stores.useDevelopStore.getState();
	t.setDynParams(I(c(), 1)), t.commitEdit("Contrast Equalizer reset");
}
function Z(e) {
	n(e), Y(e, J(e)), e.registerSettings({
		title: "Contrast Equalizer",
		fields: [{
			key: q,
			label: "Detail range",
			hint: "How far the four octaves reach. 'Fine' (default) covers ~5–33 px — best for sharpening, clarity and denoise. 'Extended' stretches the coarse end to ~257 px for big local-contrast / bloom moves, at some loss of smoothness.",
			type: "select",
			default: "fine",
			options: [{
				value: "fine",
				label: "Fine (sharpen / clarity / denoise)"
			}, {
				value: "extended",
				label: "Extended (adds coarse / bloom)"
			}]
		}]
	}), e.registerPanel({
		id: K,
		title: "Contrast Equalizer",
		component: G,
		defaultDock: {
			module: "develop",
			direction: "right",
			order: 7,
			width: 268
		},
		onReset: () => X(e)
	}), e.settings.onChange((t, n) => {
		t === q && Y(e, n === "extended" ? "extended" : "fine");
	});
}
function Q() {
	let e = globalThis.safelight;
	if (e) for (let t = 0; t < 4; t++) e.unregisterProcessingStage(x(t));
}
//#endregion
export { Z as activate, Q as deactivate };

//# sourceMappingURL=index.js.map