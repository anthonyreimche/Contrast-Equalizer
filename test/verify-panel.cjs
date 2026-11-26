// The panel's chrome, mounted over a stand-in React: it keeps no explanation
// text of its own (the graph's tooltip carries it), takes its colours from the
// ui tokens, and follows the theme through the host's theme store.
const path = require("path");
const { initRuntime } = require(path.join(__dirname, ".build", "runtime.js"));
const { EqualizerPanel } = require(path.join(__dirname, ".build", "Equalizer.js"));

let fails = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails++;
};

const walk = (node) => (node && typeof node === "object" && "children" in node ? [node, ...node.children.flatMap(walk)] : Array.isArray(node) ? node.flatMap(walk) : []);

let effects = [];
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (init) => [typeof init === "function" ? init() : init, () => undefined],
  useRef: (current) => ({ current }),
  useEffect: (effect) => void effects.push(effect),
};

const listeners = new Set();
const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const Slider = () => null;
const SegmentedControl = () => null;
const Select = () => null;
const bag = {};
initRuntime({
  react,
  settings: { get: (_k, fallback) => fallback, set: () => undefined },
  components: { Slider },
  ui: { SegmentedControl, Select, tokens: { surface0: "surface-token", textMuted: "muted-token" } },
  stores: { useThemeStore: { subscribe } },
  develop: { useParamScope: () => ({ maskId: null, getParams: () => bag, getParam: (k) => bag[k], setParams: () => undefined, commit: () => undefined }) },
});

let observers = 0;
globalThis.MutationObserver = class {
  constructor() {
    observers++;
  }
  observe() {}
  disconnect() {}
};
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};

const tree = walk(EqualizerPanel());
const canvas = tree.find((e) => e.type === "canvas");
check("no explanation paragraph in the panel", !tree.some((e) => e.type === "p"));
check("the graph carries the how-to as its tooltip", !!canvas && /Drag to shape the curve/.test(canvas.props.title || ""));
check("the graph's surface is the ui token", !!canvas && canvas.props.style.background === "surface-token");

const cleanups = effects.map((e) => e({})).filter(Boolean);
effects = [];
check("the theme is followed through the store", listeners.size === 1);
check("no MutationObserver on the document", observers === 0);
cleanups.forEach((c) => c());
check("the store subscription ends with the panel", listeners.size === 0);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PANEL CHECKS PASS");
process.exit(fails ? 1 : 0);
