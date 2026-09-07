// Independent recomputation of darktable's atrous.c init_presets() (master,
// downloaded 2026-09-05), diffed against the extension's PRESETS export.
// Typed directly from the C — do not import anything from the extension here.
const path = require("path");
const { PRESETS } = require(path.join(__dirname, ".build", "presets.js"));

const B = 6; // BANDS
const N = B - 1;
const seq = (f) => Array.from({ length: B }, (_, k) => f(k));
const flat = (v) => seq(() => v);

// #define GAUSS(x, sigma) expf(-(1-x)^2 / sigma^2) / (2.0 * sigma * sqrt(pi))
const gauss = (x, s) => Math.exp(-((1 - x) * (1 - x)) / (s * s)) / (2 * s * Math.sqrt(Math.PI));
const sigma = 3 / N; // float sigma = 3.f / (BANDS - 1)

// blurs: 1 = fine (sigma/2), 2 = +medium (sigma), 3 = +coarse (2*sigma)
const deblur = (blurs, coeffDiv, noiseDiv) => {
  const sum = (x) => [0.5, 1, 2].slice(0, blurs).reduce((a, m) => a + gauss(x, m * sigma), 0);
  return {
    L: seq((k) => 0.5 + sum(k / N) / coeffDiv),
    c: flat(0.5),
    s: seq((k) => 0.5 + sum(k / N) / coeffDiv),
    Lt: seq((k) => sum(k / N) / noiseDiv),
    ct: seq((k) => sum(k / N) / noiseDiv),
  };
};

const def = { L: flat(0.5), c: flat(0.5), s: flat(0.5), Lt: flat(0), ct: flat(0) };

// In darktable's menu order (atrous.c:730-1016), plus our "flat" reset.
const expected = {
  flat: { ...def },
  coarse: {
    L: seq((k) => Math.max(0.5, 0.75 - (0.5 * k) / N)),
    c: seq((k) => Math.max(0.5, 0.55 - (0.5 * k) / N)),
    s: seq((k) => Math.min(0.5, 0.2 + (0.35 * k) / N)),
    Lt: flat(0), ct: flat(0),
  },
  "denoise-sharpen": {
    L: seq((k) => 0.5 + (0.25 * k) / B),
    c: flat(0.5), s: flat(0.5),
    Lt: seq((k) => (0.2 * k) / B),
    ct: seq((k) => (0.3 * k) / B),
  },
  sharpen: { ...def, L: seq((k) => 0.5 + (0.25 * k) / B) },
  "denoise-chroma": {
    ...def,
    s: flat(0),
    ct: seq((k) => Math.max(0, (0.6 * k) / B - 0.3)),
  },
  denoise: {
    ...def,
    Lt: seq((k) => (0.2 * k) / B),
    ct: seq((k) => (0.3 * k) / B),
  },
  bloom: {
    ...def,
    L: seq((k) => (k === 0 ? 0.5 : Math.min(0.5, 0.3 + (0.35 * k) / N))),
    s: flat(0),
  },
  clarity: { L: flat(0.6), c: flat(0.55), s: flat(0), Lt: flat(0), ct: flat(0) },
  "deblur-large-3": deblur(3, 16, 128),
  "deblur-medium-3": deblur(2, 16, 128),
  "deblur-fine-3": deblur(1, 16, 128),
  "deblur-large-2": deblur(3, 24, 192),
  "deblur-medium-2": deblur(2, 24, 192),
  "deblur-fine-2": deblur(1, 24, 192),
  "deblur-large-1": deblur(3, 32, 128),
  "deblur-medium-1": deblur(2, 32, 128),
  "deblur-fine-1": deblur(1, 32, 128),
};

const TOL = 1e-12;
let fails = 0;
const ids = PRESETS.map((p) => p.id);
const wantIds = Object.keys(expected);

for (const id of wantIds) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) { console.log(`FAIL missing preset: ${id}`); fails++; continue; }
  const got = p.build();
  for (const ch of ["L", "c", "s", "Lt", "ct"]) {
    const want = expected[id][ch];
    const have = got[ch];
    const bad = want.map((w, k) => Math.abs(w - have[k]) > TOL ? k : -1).filter((k) => k >= 0);
    if (bad.length) {
      fails++;
      console.log(`FAIL ${id}.${ch}  nodes ${bad.join(",")}`);
      console.log(`  want ${want.map((v) => v.toFixed(4)).join(" ")}`);
      console.log(`  have ${have.map((v) => v.toFixed(4)).join(" ")}`);
    }
  }
}
for (const id of ids) if (!wantIds.includes(id)) { console.log(`FAIL unexpected preset: ${id}`); fails++; }
if (JSON.stringify(ids) !== JSON.stringify(wantIds)) { console.log(`FAIL order: [${ids}] vs [${wantIds}]`); fails++; }

console.log(fails ? `\n${fails} FAILURE(S)` : `\nALL ${wantIds.length} PRESETS MATCH darktable (tol ${TOL})`);
process.exit(fails ? 1 : 0);
