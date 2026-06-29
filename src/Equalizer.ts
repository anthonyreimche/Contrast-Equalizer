// The Contrast Equalizer panel — a faithful clone of darktable's UI.
//
// Three tabs (luma / chroma / edges). Each shows a frequency graph: x runs from
// coarse detail (left) to fine detail (right), y is the boost (centre line = no
// change). Six fixed-x nodes are dragged vertically; the mouse wheel sets the
// radius of influence (the white circle) so a drag pulls neighbouring nodes with
// a soft falloff — exactly darktable's interaction. The luma/chroma tabs carry a
// second curve, the noise threshold (denoise), anchored at the bottom.
//
// Runtime-loaded extensions aren't Tailwind-scanned, so all styling is inline +
// CSS variables (see the styling note in the repo memory).

import { h, api } from "./runtime";
import {
  BANDS,
  NODE_X,
  CHANNEL_DEFAULT,
  evalCurve,
  cloneCurves,
  type ChannelKey,
  type Curves,
} from "./model";
import { readCurves, readMix, deriveAll, DEFAULT_MIX } from "./params";
import { PRESETS } from "./presets";

type TabKey = "luma" | "chroma" | "edges";

interface TabInfo {
  key: TabKey;
  label: string;
  primary: ChannelKey;
  thr: ChannelKey | null;
  color: string;
  thrColor: string | null;
}

const TABS: TabInfo[] = [
  { key: "luma", label: "luma", primary: "L", thr: "Lt", color: "#dcdcdc", thrColor: "#5a8fd0" },
  { key: "chroma", label: "chroma", primary: "c", thr: "ct", color: "#d8b25a", thrColor: "#c06a9a" },
  { key: "edges", label: "edges", primary: "s", thr: null, color: "#6ac08a", thrColor: null },
];

const PAD = 10;
const HIT = 12;
// A press must move at least this many px before it counts as a drag — so a plain
// click (or either click of a double-click) selects without yanking the node or
// committing a stray undo step.
const DRAG_THRESH = 3;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ── Canvas drawing ───────────────────────────────────────────────────────────

interface NodeHit {
  channel: ChannelKey;
  index: number;
}

function drawGraph(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  curves: Curves,
  tab: TabInfo,
  selected: NodeHit | null,
  hover: { x: number; y: number; r: number } | null,
) {
  const pw = w - 2 * PAD;
  const ph = h - 2 * PAD;
  const cx = (x: number) => PAD + x * pw;
  const cy = (y: number) => PAD + (1 - y) * ph;

  ctx.clearRect(0, 0, w, h);

  // Grid (vertical at node positions, horizontal quarters).
  ctx.strokeStyle = "rgba(128,128,128,0.16)";
  ctx.lineWidth = 1;
  for (let k = 0; k < BANDS; k++) {
    ctx.beginPath();
    ctx.moveTo(cx(NODE_X[k]), PAD);
    ctx.lineTo(cx(NODE_X[k]), PAD + ph);
    ctx.stroke();
  }
  for (let i = 0; i <= 4; i++) {
    const yy = PAD + (i / 4) * ph;
    ctx.beginPath();
    ctx.moveTo(PAD, yy);
    ctx.lineTo(PAD + pw, yy);
    ctx.stroke();
  }

  // Centre line (no change).
  ctx.strokeStyle = "rgba(160,160,160,0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, cy(0.5));
  ctx.lineTo(PAD + pw, cy(0.5));
  ctx.stroke();

  const plotCurve = (y: number[], color: string, fillToHalf: boolean, baseline: number) => {
    ctx.beginPath();
    for (let i = 0; i <= pw; i++) {
      const x = i / pw;
      const v = evalCurve(y, x);
      if (i === 0) ctx.moveTo(cx(x), cy(v));
      else ctx.lineTo(cx(x), cy(v));
    }
    if (fillToHalf) {
      ctx.lineTo(cx(1), cy(baseline));
      ctx.lineTo(cx(0), cy(baseline));
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.14;
      ctx.fill();
      ctx.globalAlpha = 1;
      // re-stroke the line on top
      ctx.beginPath();
      for (let i = 0; i <= pw; i++) {
        const x = i / pw;
        const v = evalCurve(y, x);
        if (i === 0) ctx.moveTo(cx(x), cy(v));
        else ctx.lineTo(cx(x), cy(v));
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  };

  // Threshold curve first (under the boost curve), filled up from the bottom.
  if (tab.thr && tab.thrColor) {
    plotCurve(curves[tab.thr], tab.thrColor, true, 0);
  }
  // Boost curve, filled toward the centre line.
  plotCurve(curves[tab.primary], tab.color, true, 0.5);

  // Nodes.
  const drawNodes = (channel: ChannelKey, color: string) => {
    const y = curves[channel];
    for (let k = 0; k < BANDS; k++) {
      const px = cx(NODE_X[k]);
      const py = cy(y[k]);
      const isSel = selected && selected.channel === channel && selected.index === k;
      if (isSel) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, 5.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  if (tab.thr && tab.thrColor) drawNodes(tab.thr, tab.thrColor);
  drawNodes(tab.primary, tab.color);

  // Influence circle (wheel radius).
  if (hover) {
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(hover.x, hover.y, hover.r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Axis hints.
  ctx.fillStyle = "rgba(170,170,170,0.7)";
  ctx.font = "9px sans-serif";
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  ctx.fillText("coarse", PAD + 1, h - 1);
  ctx.textAlign = "right";
  ctx.fillText("fine", PAD + pw - 1, h - 1);
}

// ── Panel component ──────────────────────────────────────────────────────────

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
  const mix = readMix(paramBag);

  // api().react is untyped (any), so hooks can't take type arguments — cast the
  // returned tuples/refs instead.
  const [tabKey, setTabKey] = useState("luma") as [TabKey, (v: TabKey) => void];
  const [selected, setSelected] = useState(null) as [
    NodeHit | null,
    (v: NodeHit | null) => void,
  ];
  const [coupling, setCoupling] = useState(() => api().settings.get("coupling", 1)) as [
    number,
    (v: number) => void,
  ];
  const [size, setSize] = useState({ w: 240, h: 150 }) as [
    { w: number; h: number },
    (v: { w: number; h: number }) => void,
  ];
  const [hover, setHover] = useState(null) as [
    { x: number; y: number } | null,
    (v: { x: number; y: number } | null) => void,
  ];

  const wrapRef = useRef(null) as { current: HTMLDivElement | null };
  const canvasRef = useRef(null) as { current: HTMLCanvasElement | null };
  const dragRef = useRef(null) as {
    current: { hit: NodeHit; snapshot: Curves; startX: number; startY: number; moved: boolean } | null;
  };
  // Mirror coupling for the native (non-React) wheel listener below.
  const couplingRef = useRef(coupling) as { current: number };
  couplingRef.current = coupling;

  const tab = TABS.find((t) => t.key === tabKey)!;

  // Track width; keep a 0.62 aspect.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      const w = entries[0].contentRect.width;
      if (w > 0) setSize({ w: Math.round(w), h: Math.round(w * 0.62) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel = influence radius. Attached natively (non-passive) so we can stop the
  // dock from scrolling; React's onWheel is passive and can't preventDefault.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      const next = Math.min(BANDS - 1, Math.max(0.4, couplingRef.current + dir * 0.25));
      setCoupling(next);
      api().settings.set("coupling", next);
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
    const pw = size.w - 2 * PAD;
    const rPx = (coupling / (BANDS - 1)) * pw; // coupling in node units → px
    drawGraph(
      ctx,
      size.w,
      size.h,
      curves,
      tab,
      selected,
      hover ? { x: hover.x, y: hover.y, r: rPx } : null,
    );
  }, [paramBag, tabKey, selected, coupling, size, hover]);

  // ── Geometry helpers ──
  const localXY = (e: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    const sx = r.width > 0 ? size.w / r.width : 1;
    const sy = r.height > 0 ? size.h / r.height : 1;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  };
  const pw = size.w - 2 * PAD;
  const ph = size.h - 2 * PAD;
  const dataY = (cyPix: number) => clamp01(1 - (cyPix - PAD) / ph);
  const nodeCanvas = (channel: ChannelKey, k: number): [number, number] => [
    PAD + NODE_X[k] * pw,
    PAD + (1 - curves[channel][k]) * ph,
  ];

  const hitTest = (px: number, py: number): NodeHit | null => {
    const channels: ChannelKey[] = tab.thr ? [tab.primary, tab.thr] : [tab.primary];
    let best: NodeHit | null = null;
    let bestD = HIT;
    for (const channel of channels) {
      for (let k = 0; k < BANDS; k++) {
        const [nx, ny] = nodeCanvas(channel, k);
        const d = Math.hypot(nx - px, ny - py);
        if (d <= bestD) {
          bestD = d;
          best = { channel, index: k };
        }
      }
    }
    return best;
  };

  // ── Apply / commit ──
  const applyCurves = (next: Curves, m = mix) => setDynParams(deriveAll(next, m));
  const commit = () => commitEdit("Contrast Equalizer");

  const dragTo = (hit: NodeHit, snapshot: Curves, targetY: number) => {
    const base = snapshot[hit.channel];
    const delta = targetY - base[hit.index];
    const sigma = Math.max(0.18, coupling);
    const nextY = base.map((y0, j) => {
      const d = (j - hit.index) / sigma;
      const w = Math.exp(-0.5 * d * d);
      return clamp01(y0 + delta * w);
    });
    const next = cloneCurves(snapshot);
    next[hit.channel] = nextY;
    applyCurves(next);
  };

  // ── Pointer handlers ──
  // Press only selects + arms a potential drag; the node isn't moved (and no edit
  // is committed) until the pointer travels past DRAG_THRESH. So a click or a
  // double-click selects/resets cleanly without dragging the node or polluting undo.
  const onPointerDown = (e: PointerEvent & { currentTarget: HTMLCanvasElement }) => {
    const { x, y } = localXY(e);
    const hit = hitTest(x, y);
    if (!hit) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { hit, snapshot: cloneCurves(curves), startX: x, startY: y, moved: false };
    setSelected(hit);
  };
  const onPointerMove = (e: PointerEvent & { currentTarget: HTMLCanvasElement }) => {
    const { x, y } = localXY(e);
    setHover({ x, y });
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(x - d.startX, y - d.startY) < DRAG_THRESH) return;
    d.moved = true;
    dragTo(d.hit, d.snapshot, dataY(y));
  };
  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    // Commit only if the press actually became a drag — a plain click is select-only.
    if (d && d.moved) commit();
  };
  const onPointerLeave = () => {
    if (!dragRef.current) setHover(null);
  };
  const onDoubleClick = (e: MouseEvent & { currentTarget: HTMLCanvasElement }) => {
    const { x, y } = localXY(e);
    const hit = hitTest(x, y);
    if (!hit) return;
    const next = cloneCurves(curves);
    next[hit.channel] = next[hit.channel].map((v, j) =>
      j === hit.index ? CHANNEL_DEFAULT[hit.channel] : v,
    );
    applyCurves(next);
    commit();
  };

  // ── UI ──
  const tabBar = h(SegmentedControl, {
    value: tabKey,
    size: "sm",
    options: TABS.map((t) => ({ value: t.key, label: t.label })),
    onChange: (v: string) => {
      setTabKey(v as TabKey);
      setSelected(null);
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
        cursor: "ns-resize",
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
      applyCurves(p.build());
      commit();
      setSelected(null);
    },
    options: [
      { value: "", label: "Presets…" },
      ...PRESETS.map((p) => ({ value: p.id, label: p.label })),
    ],
  });

  const hint = h(
    "p",
    { style: { margin: "2px 0 0", fontSize: 10, color: "var(--color-text-muted)", lineHeight: 1.35 } },
    "Drag nodes vertically · wheel sets the influence radius · double-click resets a node.",
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
      onChange: (v: number) => applyCurves(curves, v),
      onCommit: commit,
    }),
    presetRow,
    hint,
  );
}
