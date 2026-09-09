// Static per-pixel texture-fetch budget for every prepass program the
// extension registers.
//
// 2.0.0's last pass per band evaluated a 26-tap blur at 26 positions — 676
// fetches per pixel in ONE draw call. At develop resolution (4096 px, ~11 Mpx)
// that is ~7.5 G texture fetches per draw; integrated GPUs take seconds for it,
// the driver's hang detection resets the GPU, Chromium's GPU process dies and
// SafeLight reloads into the Library. The CPU harness never saw it because it
// memoises each level across the frame, so this file counts what the GPU
// actually executes: loops with literal bounds multiply the fetches inside
// them, helper calls are expanded, every branch of a conditional is counted (an
// upper bound), and any loop form the analyser does not understand FAILS the
// run instead of being skipped.
const path = require("path");
const W = require(path.join(__dirname, ".build", "wavelet.js"));

const MAX_FETCHES_PER_DRAW = 32;    // one 5×5 à trous step + its centre = 26
const MAX_DRAWS_PER_CHAIN = 8;      // darktable's eight octaves
const MAX_FETCHES_PER_FRAME = 700;  // every chain recomputed from scratch
const MAX_PREPASS_STAGES = 3;       // host budget is 5; builtin denoise takes 1

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function closingBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return i;
  }
  throw new Error("unbalanced braces");
}

// name → body of every function defined in `src`.
function collectFunctions(src) {
  const fns = new Map();
  const def = /\b(?:float|int|bool|vec[234]|ivec[234]|mat[34]|void)\s+(\w+)\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = def.exec(src))) {
    const open = m.index + m[0].length - 1;
    const close = closingBrace(src, open);
    fns.set(m[1], src.slice(open + 1, close));
    def.lastIndex = close;
  }
  return fns;
}

const LOOP = /\bfor\s*\(\s*int\s+(\w+)\s*=\s*(-?\d+)\s*;\s*\1\s*(<=|<)\s*(-?\d+)\s*;\s*\1\s*(?:\+\+|\+=\s*1)\s*\)\s*\{/g;

function functionFetches(name, fns, memo) {
  if (memo.has(name)) {
    const v = memo.get(name);
    if (v === null) throw new Error(`recursive helper ${name}`);
    return v;
  }
  memo.set(name, null);
  const v = blockFetches(fns.get(name), fns, memo);
  memo.set(name, v);
  return v;
}

// Fetches in loop-free text: the host's readPrev, raw texture() calls, and
// calls into the stage's own helpers.
function flatFetches(text, fns, memo) {
  if (/\b(for|while|do)\b/.test(text)) {
    throw new Error(`unrecognised loop form: ${text.trim().slice(0, 80)}`);
  }
  let n = (text.match(/\b(?:texture|readPrev)\s*\(/g) || []).length;
  for (const name of fns.keys()) {
    const calls = (text.match(new RegExp(`\\b${name}\\s*\\(`, "g")) || []).length;
    if (calls) n += calls * functionFetches(name, fns, memo);
  }
  return n;
}

// Fetches per pixel of a block: text between loops counts once, each loop's
// body counts trip-count times (recursively, so nested loops multiply).
function blockFetches(block, fns, memo) {
  let total = 0;
  let cursor = 0;
  const loop = new RegExp(LOOP.source, "g");
  let m;
  while ((m = loop.exec(block))) {
    const open = m.index + m[0].length - 1;
    const close = closingBrace(block, open);
    total += flatFetches(block.slice(cursor, m.index), fns, memo);
    const from = Number(m[2]);
    const to = Number(m[4]);
    const trips = Math.max(0, m[3] === "<=" ? to - from + 1 : to - from);
    total += trips * blockFetches(block.slice(open + 1, close), fns, memo);
    cursor = close + 1;
    loop.lastIndex = cursor;
  }
  return total + flatFetches(block.slice(cursor), fns, memo);
}

// Fetches per pixel of one draw of `pass`, including the host's own initial
// `vec3 c = readPrev(vUv)`.
function passFetches(pass) {
  const helpers = stripComments(pass.helpers || "");
  const fns = collectFunctions(helpers);
  const memo = new Map();
  return 1 + blockFetches(stripComments(pass.glsl), fns, memo);
}

let fails = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails++;
};

const stages = W.allChainStages();
let frame = 0;
for (const stage of stages) {
  const passes = stage.passes || [];
  let chain = 0;
  let draws = 0;
  for (const pass of passes) {
    const perDraw = passFetches(pass);
    const iterations = pass.iterations || 1;
    draws += iterations;
    chain += perDraw * iterations;
    check(
      `${stage.id}: fetches per draw ≤ ${MAX_FETCHES_PER_DRAW}`,
      perDraw <= MAX_FETCHES_PER_DRAW,
      `${perDraw} per pixel per draw`,
    );
  }
  check(`${stage.id}: draws per chain ≤ ${MAX_DRAWS_PER_CHAIN}`, draws <= MAX_DRAWS_PER_CHAIN, `${draws} draws`);
  console.log(`      ${stage.id}: ${chain} fetches per pixel over ${draws} draws`);
  frame += chain;
}
check(`prepass stages ≤ ${MAX_PREPASS_STAGES}`, stages.length <= MAX_PREPASS_STAGES, `${stages.length} stages`);
check(
  `full recompute ≤ ${MAX_FETCHES_PER_FRAME} fetches per pixel`,
  frame <= MAX_FETCHES_PER_FRAME,
  `${frame} per pixel`,
);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL COST CHECKS PASS");
process.exit(fails ? 1 : 0);
