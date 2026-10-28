// Local-adjustment masks: every chain runs again inside a mask that holds its
// keys, activate() offers the panel in the Masking panel's Adjust tab owning
// every key it writes, and the panel edits whatever scope it is handed. The
// panel renders here without React or a DOM: hooks hand back their initial
// state, effects never run, and the element tree is plain objects whose
// handlers are called as the core's controls would call them.
const path = require("path");
const M = require(path.join(__dirname, ".build", "model.js"));
const P = require(path.join(__dirname, ".build", "params.js"));
const W = require(path.join(__dirname, ".build", "wavelet.js"));
const I = require(path.join(__dirname, ".build", "index.js"));
const E = require(path.join(__dirname, ".build", "Equalizer.js"));

let fails = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function fakeStore(init) {
  let state = init;
  const listeners = new Set();
  const hook = (selector) => (selector ? selector(state) : state);
  hook.getState = () => state;
  hook.setState = (partial) => {
    const prev = state;
    state = { ...state, ...(typeof partial === "function" ? partial(state) : partial) };
    for (const l of listeners) l(state, prev);
  };
  hook.subscribe = (l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  return hook;
}

const Slider = () => null;
const Select = () => null;
const SegmentedControl = () => null;

/** The API over a photo bag, inside a mask holding `maskBag` when one is given. */
function rig(photoBag = {}, maskBag) {
  const commits = [];
  const registered = { stages: [], panels: [] };
  const develop = fakeStore({
    photoId: "p1",
    paramBag: photoBag,
    setDynParams: (patch) => develop.setState((s) => ({ paramBag: { ...s.paramBag, ...patch } })),
    commitEdit: async (label) => void commits.push(label),
  });
  const mask = fakeStore({ bag: maskBag ?? {} });
  const photoScope = {
    maskId: null,
    getParam: (key) => develop.getState().paramBag[key],
    getParams: () => develop.getState().paramBag,
    setParams: (patch) => develop.getState().setDynParams(patch),
    commit: (label) => void develop.getState().commitEdit(label),
  };
  const maskScope = {
    maskId: "mask-1",
    getParam: (key) => mask.getState().bag[key],
    getParams: () => mask.getState().bag,
    setParams: (patch) => mask.setState((s) => ({ bag: { ...s.bag, ...patch } })),
    commit: (label) => void commits.push(`mask: ${label}`),
  };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (init) => [typeof init === "function" ? init() : init, () => undefined],
    useRef: (current) => ({ current }),
    useEffect: () => undefined,
  };
  const api = {
    version: 1,
    extensionId: "contrast-equalizer",
    react,
    registerProcessingStage: (c) => void registered.stages.push(c),
    unregisterProcessingStage: () => undefined,
    registerPanel: (c) => void registered.panels.push(c),
    registerSettings: () => undefined,
    settings: { get: (_key, fallback) => fallback, set: () => undefined, onChange: () => () => undefined },
    components: { Slider },
    ui: { SegmentedControl, Select },
    stores: { useDevelopStore: develop },
    develop: { useParamScope: () => (maskBag === undefined ? photoScope : maskScope) },
  };
  return { api, develop, mask, commits, registered };
}

/** Every element of `type` in a rendered tree. */
function find(node, type) {
  if (!node || typeof node !== "object") return [];
  return [...(node.type === type ? [node] : []), ...node.children.flatMap((c) => find(c, type))];
}

/** Activates against the rig and renders the panel once. */
function mount(r) {
  I.activate(r.api);
  const tree = E.EqualizerPanel();
  I.deactivate();
  return tree;
}

const xs = M.defaultXs();
const neutral = () => P.deriveAll(M.defaultCurves(), xs, M.DEFAULT_MIX);
const boosted = (mix) => {
  const c = M.defaultCurves();
  c.L = [0.62, 0.68, 0.62, 0.54, 0.5, 0.5];
  return P.deriveAll(c, xs, mix);
};

// ── The chains ───────────────────────────────────────────────────────────────
{
  const stages = W.allChainStages();
  check("every chain runs again inside masks", stages.length === 3 && stages.every((s) => same(s.mask, { maskable: true })));
}

// ── activate() ───────────────────────────────────────────────────────────────
{
  const r = rig();
  I.activate(r.api);
  I.deactivate();
  const mask = r.registered.panels[0] && r.registered.panels[0].mask;
  check("the panel is offered in masks", !!mask && mask.component === E.EqualizerPanel);
  const owns = mask ? [...mask.owns].sort() : [];
  check("it owns every key the panel writes, curves and chain tables alike", same(owns, Object.keys(neutral()).sort()), `${owns.length} keys`);
}

// ── The panel in a mask ──────────────────────────────────────────────────────
// Nothing here measures or picks from the photo, so a mask's panel has all of it.
{
  const r = rig(boosted(0.5), boosted(2));
  const tree = mount(r);
  const mix = find(tree, Slider)[0];
  check("shows the mask's mix, not the photo's", !!mix && mix.props.value === 2, mix && String(mix.props.value));
  check(
    "has the dock's tabs, graph, mix and presets",
    find(tree, SegmentedControl).length === 1 && find(tree, "canvas").length === 1 && !!mix && find(tree, Select).length === 1,
  );
}
{
  const r = rig({}, {});
  const mix = find(mount(r), Slider)[0];
  mix.props.onChange(1.5);
  mix.props.onCommit();
  check("the mix writes the mask's curves and chain tables", same(r.mask.getState().bag, P.deriveAll(M.defaultCurves(), xs, 1.5)));
  check("the mix leaves the photo's bag alone", same(r.develop.getState().paramBag, {}));
  check("the mix commits once, to the mask", same(r.commits, ["mask: Contrast Equalizer"]), r.commits.join(", "));
}
{
  const r = rig({}, {});
  const presets = find(mount(r), Select)[0];
  const preset = require(path.join(__dirname, ".build", "presets.js")).PRESETS[0];
  presets.props.onChange(preset.id);
  check("a preset lands in the mask", same(r.mask.getState().bag, P.deriveAll(preset.build(), xs, M.DEFAULT_MIX)), preset.id);
  check("a preset leaves the photo's bag alone", same(r.develop.getState().paramBag, {}));
  check("a preset commits once, to the mask", same(r.commits, ["mask: Contrast Equalizer"]), r.commits.join(", "));
}
{
  const r = rig({}, {});
  const canvas = find(mount(r), "canvas")[0];
  const currentTarget = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 240, height: 160 }),
    setPointerCapture: () => undefined,
  };
  canvas.props.onPointerDown({ clientX: 120, clientY: 73.5, pointerId: 1, currentTarget });
  canvas.props.onPointerMove({ clientX: 120, clientY: 40, pointerId: 1, currentTarget });
  canvas.props.onPointerUp();
  const L = P.readCurves(r.mask.getState().bag).L;
  check("a drag on the graph raises the mask's luma curve", L.some((y, k) => y > M.defaultCurves().L[k] + 0.1), L.map((y) => y.toFixed(2)).join(" "));
  check("a drag leaves the photo's bag alone", same(r.develop.getState().paramBag, {}));
  check("a drag commits once, to the mask", same(r.commits, ["mask: Contrast Equalizer"]), r.commits.join(", "));
}

// ── The same panel in the dock ───────────────────────────────────────────────
{
  const r = rig();
  const mix = find(mount(r), Slider)[0];
  mix.props.onChange(1.5);
  mix.props.onCommit();
  check("in the dock the mix writes the photo's bag", same(r.develop.getState().paramBag, P.deriveAll(M.defaultCurves(), xs, 1.5)));
  check("in the dock the mix commits under the panel's name", same(r.commits, ["Contrast Equalizer"]), r.commits.join(", "));
}

console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL MASK CHECKS PASS");
process.exit(fails ? 1 : 0);
