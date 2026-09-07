// The Contrast Equalizer panel — a faithful clone of darktable's UI (atrous.c
// gui: area_draw / area_motion_notify / area_button_press / area_scrolled).
//
// Three tabs (luma / chroma / edges). The graph shows ALL channel groups (the
// inactive ones dimmed): x runs coarse→fine, y is the boost. Interaction is
// darktable's, not a node editor: press anywhere and drag vertically — every
// node is pulled toward the pointer with a Gaussian weight over x, the wheel
// sets that radius (the circle riding the curve), and the pull keeps the offset
// between the grab point and the curve. Hovering picks the boost or threshold
// curve by proximity; the strip under the graph drags a node's x position (the
// little triangles). Double-click resets the active curve. While hovering, the
// curve shows raw values; at rest it shows them with mix folded in — exactly
// darktable. The plot sits on the panel's themed surface like every other
// panel; the ink and overlays flip brightness against it, so no theme can
// swallow the curves or the circle (SafeLight #96).
//
// Runtime-loaded extensions aren't Tailwind-scanned, so all styling is inline +
// CSS variables (see the styling note in the repo memory).

import { h, api } from "./runtime";
import {
  BANDS,
  NODE_X,
  CHANNEL_DEFAULT,
  applyMix,
  cloneCurves,
  cloneXs,
  defaultXs,
  evalCurve,
  LEVEL_T,
  type ChannelKey,
  type Curves,
  type CurveXs,
} from "./model";
import { readCurves, readXs, readMix, deriveAll, DEFAULT_MIX } from "./params";
import { PRESETS } from "./presets";

type TabKey = "luma" | "chroma" | "edges";

interface TabInfo {
  key: TabKey;
  label: string;
  primary: "L" | "c" | "s";
  thr: ChannelKey | null;
}

const TABS: TabInfo[] = [
  { key: "luma", label: "luma", primary: "L", thr: "Lt" },
  { key: "chroma", label: "chroma", primary: "c", thr: "ct" },
  { key: "edges", label: "edges", primary: "s", thr: null },
];

// darktable's plot layout, drawn on the panel's themed surface
// (var(--color-surface-0), like every other panel). Canvas strokes can't
// reference CSS variables, so the ink is derived from the resolved surface and
// flips brightness against it — dark ink on light surfaces, light ink on dark.
interface Palette {
  /** "r,g,b" for the border, grid, stripes, labels and triangles. */
  ink: string;
  circle: string;
  dotBoost: string;
  dotThr: string;
  ch: Record<"L" | "c" | "s", readonly [number, number, number, number]>;
}

function palette(darkSurface: boolean): Palette {
  return {
    ink: darkSurface ? "224,224,224" : "43,43,43",
    circle: darkSurface ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.6)",
    dotBoost: "rgba(150,150,150,1)",
    dotThr: darkSurface ? "rgba(235,235,235,1)" : "rgba(26,26,26,1)",
    ch: {
      L: [153, 153, 153, 0.3],
      c: darkSurface ? [214, 140, 70, 0.4] : [102, 51, 0, 0.4],
      s: darkSurface ? [122, 160, 200, 0.4] : [26, 51, 77, 0.4],
    },
  };
}

const chColor = (pal: Palette, p: "L" | "c" | "s", dim: boolean): string => {
  const [r, g, b, a] = pal.ch[p];
  return `rgba(${r},${g},${b},${a * (dim ? 0.5 : 1)})`;
};

const PAD = 6;
const XSTRIP = 13; // strip under the plot holding the node-x triangles
const RES = 64; // curve tessellation, darktable's RES
const RADIUS_DEFAULT = 1 / BANDS;
const RADIUS_MIN = 0.25 / BANDS;
const RADIUS_MAX = 1;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** darktable's get_params: pull every node toward `target` with a Gaussian in x
 *  around `mx` of width `rad` — y_k' = (1−f)·y_k + f·target, f = e^(−Δx²/rad²). */
function pullCurve(
  ys: number[],
  xsArr: number[],
  mx: number,
  target: number,
  rad: number,
): number[] {
  return ys.map((y, k) => {
    const dx = mx - xsArr[k];
    const f = Math.exp(-(dx * dx) / (rad * rad));
    return clamp01((1 - f) * y + f * target);
  });
}

interface Hover {
  x: number;
  y: number;
  strip: boolean;
}

// ── Canvas drawing ───────────────────────────────────────────────────────────

function drawGraph(
  ctx: CanvasRenderingContext2D,
  w: number,
  hTotal: number,
  curves: Curves,
  xs: CurveXs,
  tab: TabInfo,
  ch2: ChannelKey,
  mixShown: number,
  hover: Hover | null,
  dragging: boolean,
  radius: number,
  xMove: number,
  pal: Palette,
) {
  const pw = w - 2 * PAD;
  const ph = hTotal - 2 * PAD - XSTRIP;
  const cx = (t: number) => PAD + t * pw;
  const cy = (v: number) => PAD + (1 - v) * ph;

  // The themed surface shows through (the canvas CSS background); only the
  // marks are drawn.
  ctx.clearRect(0, 0, w, hTotal);

  // Border + 8×8 grid (darktable's dt_draw_grid(8)).
  ctx.strokeStyle = `rgba(${pal.ink},0.8)`;
  ctx.lineWidth = 1;
  ctx.strokeRect(PAD, PAD, pw, ph);
  ctx.strokeStyle = `rgba(${pal.ink},0.22)`;
  for (let i = 1; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(cx(i / 8), PAD);
    ctx.lineTo(cx(i / 8), PAD + ph);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(PAD, PAD + (i / 8) * ph);
    ctx.lineTo(PAD + pw, PAD + (i / 8) * ph);
    ctx.stroke();
  }

  // Alternating stripes over the real octave spans (darktable shades between
  // its per-scale sample positions; ours sit at the fixed i0=8 level t's).
  ctx.fillStyle = `rgba(${pal.ink},0.10)`;
  for (let k = 1; k < LEVEL_T.length; k += 2) {
    const a = cx(Math.min(LEVEL_T[k - 1], LEVEL_T[k]));
    const b = cx(Math.max(LEVEL_T[k - 1], LEVEL_T[k]));
    ctx.fillRect(a, PAD, b - a, ph);
  }

  // Channel groups, active tab's last (drawn brightest) — darktable's rotation.
  const order: TabInfo[] = [...TABS.filter((t) => t.key !== tab.key), tab];
  for (const g of order) {
    const dim = g.key !== tab.key;
    const mp = applyMix(g.primary, xs[g.primary], curves[g.primary], mixShown);
    ctx.beginPath();
    if (g.thr) {
      const mq = applyMix(g.thr, xs[g.thr], curves[g.thr], mixShown);
      ctx.moveTo(cx(1), cy(evalCurve(mq.xs, mq.ys, 1)));
      for (let k = RES - 2; k >= 0; k--) {
        const t = k / (RES - 1);
        ctx.lineTo(cx(t), cy(evalCurve(mq.xs, mq.ys, t)));
      }
      for (let k = 0; k < RES; k++) {
        const t = k / (RES - 1);
        ctx.lineTo(cx(t), cy(evalCurve(mp.xs, mp.ys, t)));
      }
    } else {
      ctx.moveTo(cx(0), cy(0));
      for (let k = 0; k < RES; k++) {
        const t = k / (RES - 1);
        ctx.lineTo(cx(t), cy(evalCurve(mp.xs, mp.ys, t)));
      }
      ctx.lineTo(cx(1), cy(0));
    }
    ctx.closePath();
    const col = chColor(pal, g.primary, dim);
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fill();
  }

  // Hover/drag overlays (darktable: mouse_y > 0 || dragging).
  const overlays = dragging || (hover !== null && !hover.strip && hover.y > 0);
  if (overlays && hover) {
    const x2 = xs[ch2];
    const y2 = curves[ch2];

    // Node dots on the active curve: light when editing the boost curve, dark
    // for the threshold curve; a node armed for x-dragging is filled.
    ctx.lineWidth = 1;
    const dotCol = ch2 === tab.primary ? pal.dotBoost : pal.dotThr;
    for (let k = 0; k < BANDS; k++) {
      ctx.beginPath();
      ctx.arc(cx(x2[k]), cy(y2[k]), 3, 0, Math.PI * 2);
      ctx.strokeStyle = dotCol;
      ctx.fillStyle = dotCol;
      if (xMove === k) ctx.fill();
      else ctx.stroke();
    }

    // Reachable-range envelope: the curve pulled fully up and fully down at the
    // current radius.
    const up = pullCurve(y2, x2, hover.x, 1, radius);
    const dn = pullCurve(y2, x2, hover.x, 0, radius);
    ctx.beginPath();
    for (let k = 0; k < RES; k++) {
      const t = k / (RES - 1);
      const v = evalCurve(x2, up, t);
      if (k === 0) ctx.moveTo(cx(t), cy(v));
      else ctx.lineTo(cx(t), cy(v));
    }
    for (let k = RES - 1; k >= 0; k--) {
      const t = k / (RES - 1);
      ctx.lineTo(cx(t), cy(evalCurve(x2, dn, t)));
    }
    ctx.closePath();
    ctx.fillStyle = chColor(pal, tab.primary, false);
    ctx.fill();

    // Influence circle, riding the active curve at the pointer's x.
    ctx.beginPath();
    ctx.arc(cx(hover.x), cy(evalCurve(x2, y2, hover.x)), radius * pw, 0, Math.PI * 2);
    ctx.strokeStyle = pal.circle;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Labels: rotated coarse/fine plus the active curve's semantic ends.
    ctx.fillStyle = `rgba(${pal.ink},0.85)`;
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.save();
    ctx.translate(PAD + 10, PAD + ph * 0.5);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("coarse", 0, 0);
    ctx.restore();
    ctx.save();
    ctx.translate(PAD + pw - 6, PAD + ph * 0.5);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("fine", 0, 0);
    ctx.restore();
    const [upLbl, dnLbl] =
      ch2 === "Lt" || ch2 === "ct"
        ? ["smooth", "noisy"]
        : ch2 === "s"
          ? ["bold", "dull"]
          : ["contrasty", "smooth"];
    ctx.fillText(upLbl, PAD + pw / 2, PAD + 9);
    ctx.fillText(dnLbl, PAD + pw / 2, PAD + ph - 9);
  }

  // Node-x triangles in the strip (interior nodes only, like darktable).
  ctx.strokeStyle = `rgba(${pal.ink},0.9)`;
  ctx.fillStyle = `rgba(${pal.ink},0.9)`;
  ctx.lineWidth = 1;
  const baseY = PAD + ph + 3;
  for (let k = 1; k < BANDS - 1; k++) {
    const tx = cx(xs[tab.primary][k]);
    ctx.beginPath();
    ctx.moveTo(tx - 3.5, baseY + 7);
    ctx.lineTo(tx, baseY);
    ctx.lineTo(tx + 3.5, baseY + 7);
    ctx.closePath();
    if (xMove === k) ctx.fill();
    else ctx.stroke();
  }
}

// ── Panel component ──────────────────────────────────────────────────────────

interface DragState {
  mode: "y" | "x";
  ch2: ChannelKey;
  node: number;
  snapC: Curves;
  snapX: CurveXs;
  pick: number;
  fx: number;
  moved: boolean;
}

export function EqualizerPanel() {
  const react = api().react;
  const { useState, useRef, useEffect } = react;
  const useDevelopStore = api().stores.useDevelopStore;
  const Slider = api().components.Slider;
  const ui = api().ui;
  if (!ui)
    return h(
      "div",
      { style: { padding: "10px", fontSize: "11px", color: "var(--color-text-muted)" } },
      "Update Safelight to use this panel.",
    );
  const { SegmentedControl, Select } = ui;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paramBag: Record<string, any> = useDevelopStore((s: any) => s.paramBag);
  const setDynParams: (m: Record<string, unknown>) => void = useDevelopStore(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: any) => s.setDynParams,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commitEdit: (label: string) => void = useDevelopStore((s: any) => s.commitEdit);

  const curves = readCurves(paramBag);
  const xs = readXs(paramBag);
  const mix = readMix(paramBag);

  // api().react is untyped (any), so hooks can't take type arguments — cast the
  // returned tuples/refs instead.
  const [tabKey, setTabKey] = useState(() => api().settings.get("channel", "luma")) as [
    TabKey,
    (v: TabKey) => void,
  ];
  const [channel2, setChannel2] = useState("L") as [ChannelKey, (v: ChannelKey) => void];
  const [radius, setRadius] = useState(() => api().settings.get("radius", RADIUS_DEFAULT)) as [
    number,
    (v: number) => void,
  ];
  const [hover, setHover] = useState(null) as [Hover | null, (v: Hover | null) => void];
  const [xMove, setXMove] = useState(-1) as [number, (v: number) => void];
  const [size, setSize] = useState({ w: 240, h: 160 }) as [
    { w: number; h: number },
    (v: { w: number; h: number }) => void,
  ];
  const [themeEpoch, setThemeEpoch] = useState(0) as [number, (v: number) => void];

  const wrapRef = useRef(null) as { current: HTMLDivElement | null };
  const canvasRef = useRef(null) as { current: HTMLCanvasElement | null };
  const dragRef = useRef(null) as { current: DragState | null };
  // Mirror for the native (non-React) wheel listener below.
  const radiusRef = useRef(radius) as { current: number };
  radiusRef.current = radius;
  const themeCountRef = useRef(0) as { current: number };

  const tab = TABS.find((t) => t.key === tabKey)!;
  // The hover pick can lag a tab switch; fall back to the tab's boost curve.
  const ch2: ChannelKey = channel2 === tab.primary || channel2 === tab.thr ? channel2 : tab.primary;

  // Track width; darktable's graph proportions plus the triangle strip.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      const w = entries[0].contentRect.width;
      if (w > 0) setSize({ w: Math.round(w), h: Math.round(w * 0.6) + XSTRIP });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Theme and accessibility swaps restyle the root's CSS variables in place
  // (state/accessibility.ts setProperty); watch the root so the resolved ink
  // re-derives without waiting for the next interaction.
  useEffect(() => {
    const bump = () => {
      themeCountRef.current += 1;
      setThemeEpoch(themeCountRef.current);
    };
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true });
    mo.observe(document.body, { attributes: true });
    return () => mo.disconnect();
  }, []);

  // Wheel = influence radius (darktable: ×(1 − 0.1·dy), clamped). Attached
  // natively (non-passive) so the dock doesn't scroll; React's onWheel is
  // passive and can't preventDefault.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const factor = 1 - 0.1 * Math.sign(e.deltaY);
      const next = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, radiusRef.current * factor));
      setRadius(next);
      api().settings.set("radius", next);
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, []);

  // Redraw.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Resolve the themed surface behind the plot to choose the ink direction —
    // canvas strokes can't reference CSS variables.
    const rgb = getComputedStyle(canvas).backgroundColor.match(/\d+(?:\.\d+)?/g);
    const darkSurface = rgb
      ? (Number(rgb[0]) + Number(rgb[1]) + Number(rgb[2])) / (3 * 255) < 0.5
      : true;
    // Hovering (and dragging) shows the raw curves; at rest mix is folded in.
    const active = hover !== null || dragRef.current !== null;
    drawGraph(
      ctx,
      size.w,
      size.h,
      curves,
      xs,
      tab,
      ch2,
      active ? 1 : mix,
      hover,
      dragRef.current !== null,
      radius,
      xMove,
      palette(darkSurface),
    );
  }, [paramBag, tabKey, channel2, radius, size, hover, xMove, themeEpoch]);

  // ── Geometry helpers ──
  const pw = size.w - 2 * PAD;
  const ph = size.h - 2 * PAD - XSTRIP;
  const toData = (e: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    const sx = r.width > 0 ? size.w / r.width : 1;
    const sy = r.height > 0 ? size.h / r.height : 1;
    const px = (e.clientX - r.left) * sx;
    const py = (e.clientY - r.top) * sy;
    return {
      x: clamp01((px - PAD) / pw),
      y: clamp01(1 - (py - PAD) / ph),
      strip: py > PAD + ph,
    };
  };
  const nearestNode = (x: number): number => {
    const xsP = xs[tab.primary];
    let best = 0;
    let bd = Math.abs(xsP[0] - x);
    for (let k = 1; k < BANDS; k++) {
      const d = Math.abs(xsP[k] - x);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  };

  // ── Apply / commit ──
  const applyState = (c: Curves, x: CurveXs, m = mix) => setDynParams(deriveAll(c, x, m));
  const commit = () => commitEdit("Contrast Equalizer");

  // ── Pointer handlers (darktable's area_* callbacks) ──
  const onPointerDown = (e: PointerEvent & { currentTarget: HTMLCanvasElement }) => {
    const { x, y, strip } = toData(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (strip) {
      dragRef.current = {
        mode: "x",
        ch2,
        node: nearestNode(x),
        snapC: cloneCurves(curves),
        snapX: cloneXs(xs),
        pick: 0,
        fx: x,
        moved: false,
      };
    } else {
      // Keep the offset between the grab point and the curve (mouse_pick), so
      // the curve doesn't jump to the pointer.
      const pick = evalCurve(xs[ch2], curves[ch2], x) - y;
      dragRef.current = {
        mode: "y",
        ch2,
        node: -1,
        snapC: cloneCurves(curves),
        snapX: cloneXs(xs),
        pick,
        fx: x,
        moved: false,
      };
    }
  };

  const onPointerMove = (e: PointerEvent & { currentTarget: HTMLCanvasElement }) => {
    const { x, y, strip } = toData(e);
    const d = dragRef.current;
    if (d) {
      if (d.mode === "x") {
        // Interior nodes only, clamped between their neighbours; the boost and
        // threshold curves share the position (darktable moves both).
        if (d.node > 0 && d.node < BANDS - 1) {
          const xsP = d.snapX[tab.primary];
          const nx = Math.min(xsP[d.node + 1] - 0.001, Math.max(xsP[d.node - 1] + 0.001, x));
          const nextXs = cloneXs(d.snapX);
          nextXs[tab.primary][d.node] = nx;
          if (tab.thr) nextXs[tab.thr][d.node] = nx;
          d.moved = true;
          applyState(d.snapC, nextXs);
        }
        setHover({ x, y, strip: false });
      } else {
        // The pull centre x is frozen at the press position; vertical motion
        // shapes the curve.
        const next = cloneCurves(d.snapC);
        next[d.ch2] = pullCurve(d.snapC[d.ch2], d.snapX[d.ch2], d.fx, y + d.pick, radius);
        d.moved = true;
        applyState(next, d.snapX);
        setHover({ x: d.fx, y, strip: false });
      }
      return;
    }
    setHover({ x, y, strip });
    if (strip) {
      setXMove(nearestNode(x));
    } else {
      setXMove(-1);
      // Choose between the boost and threshold curve by which is vertically
      // closer at the node nearest the pointer.
      if (tab.thr) {
        const k = nearestNode(x);
        const dp = Math.abs(y - curves[tab.primary][k]);
        const dq = Math.abs(y - curves[tab.thr][k]);
        setChannel2(dp <= dq ? tab.primary : tab.thr);
      } else {
        setChannel2(tab.primary);
      }
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && d.moved) commit();
  };

  const onPointerLeave = () => {
    if (!dragRef.current) {
      setHover(null);
      setXMove(-1);
    }
  };

  const onDoubleClick = () => {
    // darktable: reset the ACTIVE curve (positions and values) to defaults.
    const next = cloneCurves(curves);
    next[ch2] = Array.from({ length: BANDS }, () => CHANNEL_DEFAULT[ch2]);
    const nextXs = cloneXs(xs);
    nextXs[ch2] = [...NODE_X];
    applyState(next, nextXs);
    commit();
  };

  // ── UI ──
  const tabBar = h(SegmentedControl, {
    value: tabKey,
    size: "sm",
    options: TABS.map((t) => ({ value: t.key, label: t.label })),
    onChange: (v: string) => {
      const t = TABS.find((x) => x.key === v)!;
      setTabKey(t.key);
      setChannel2(t.primary);
      api().settings.set("channel", t.key);
    },
  });

  const graph = h(
    "div",
    { ref: wrapRef, style: { width: "100%" } },
    h("canvas", {
      ref: canvasRef,
      style: {
        width: size.w,
        height: size.h,
        touchAction: "none",
        borderRadius: 4,
        background: "var(--color-surface-0)",
        cursor: "crosshair",
        display: "block",
      },
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerLeave,
      onDoubleClick,
    }),
  );

  const presetRow = h(Select, {
    value: "",
    style: { width: "100%" },
    onChange: (v: string) => {
      const p = PRESETS.find((x) => x.id === v);
      if (!p) return;
      // darktable presets store node positions and mix = 1.0 — applying one
      // resets both alongside the curves.
      applyState(p.build(), defaultXs(), DEFAULT_MIX);
      commit();
    },
    options: [
      { value: "", label: "Presets…" },
      ...PRESETS.map((p) => ({ value: p.id, label: p.label })),
    ],
  });

  const hint = h(
    "p",
    { style: { margin: "2px 0 0", fontSize: 10, color: "var(--color-text-muted)", lineHeight: 1.35 } },
    "Drag to shape the curve · wheel sets the radius · drag under the graph to move a node · double-click resets the curve.",
  );

  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 6, padding: 8 } },
    tabBar,
    graph,
    h(Slider, {
      label: "Mix",
      value: mix,
      min: 0,
      max: 3,
      step: 0.01,
      defaultValue: DEFAULT_MIX,
      onChange: (v: number) => applyState(curves, xs, v),
      onCommit: commit,
    }),
    presetRow,
    hint,
  );
}
