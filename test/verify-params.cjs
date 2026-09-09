// The param-bag contract between the panel/model and the GPU chains: what
// deriveAll writes, when a chain idles (the host runs a prepass only while some
// param under its stage id is non-zero), and how edits saved by earlier
// releases are brought forward.
const path = require("path");
const M = require(path.join(__dirname, ".build", "model.js"));
const P = require(path.join(__dirname, ".build", "params.js"));
const W = require(path.join(__dirname, ".build", "wavelet.js"));

let fails = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails++;
};

const ids = W.CHAINS.map((c) => W.chainStageId(c));
const [LUMA, CHROMA_A, CHROMA_B] = ids;
const xs = M.defaultXs();

const isZero = (v) => (Array.isArray(v) ? v.every((x) => x === 0) : v === 0);
const stageKeys = (bag, id) => Object.keys(bag).filter((k) => k.startsWith(`${id}.`));
const stageIdle = (bag, id) => stageKeys(bag, id).every((k) => isZero(bag[k]));
const stageActive = (bag, id) => bag[`${id}.active`] === 1 && !stageIdle(bag, id);

// The host hashes a stage id to a 4-char prefix (shader-compiler.ts
// hashStageId); siblings whose prefixes collide redefine each other's
// uniforms and nothing renders. Mirror the hash and pin distinctness.
function hash4(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36).slice(0, 4);
}
check("three chains, one stage each", ids.length === 3 && new Set(ids).size === 3, ids.join(", "));
check("stage-id hash prefixes are distinct", new Set(ids.map(hash4)).size === ids.length, ids.map(hash4).join(", "));
check("chain ids needed no salt (persisted keys stay readable)", ids.every((id) => !/-\d+$/.test(id)));

// ── Per-level coefficients are darktable's ──────────────────────────────────
{
  const flat = (v) => Array.from({ length: M.BANDS }, () => v);
  const at = (L, c, Lt, ct, level) =>
    M.levelCoeffs({ L: flat(L), c: flat(c), s: flat(0.5), Lt: flat(Lt), ct: flat(ct) }, xs, level, 1);
  const k0 = at(0.5, 0.5, 0, 0, 3);
  check("neutral curve ⇒ zero gains and thresholds", k0.gainL === 0 && k0.gainC === 0 && k0.thrL === 0 && k0.thrC === 0);
  const kUp = at(1, 1, 0, 0, 0);
  check("boost (2·1)² ⇒ gain 3", Math.abs(kUp.gainL - 3) < 1e-12 && Math.abs(kUp.gainC - 3) < 1e-12);
  const kDn = at(0, 0, 0, 0, 0);
  check("boost (2·0)² ⇒ gain −1 (full cut)", kDn.gainL === -1 && kDn.gainC === -1);
  const t = M.LEVEL_T[2];
  const kT = at(0.5, 0.5, 0.3, 0.3, 2);
  const atten = Math.pow(2, -7 * (1 - t));
  check(
    "thresholds 2^(−7(1−t))·{10,20}·curve",
    Math.abs(kT.thrL - atten * 10 * 0.3) < 1e-12 && Math.abs(kT.thrC - atten * 20 * 0.3) < 1e-12,
  );
  check("eight levels, coarse→fine t = 1−(j+0.5)/8", M.LEVEL_T.length === 8 && M.LEVEL_T[0] === 1 - 0.5 / 8 && M.LEVEL_T[7] === 1 - 7.5 / 8);
}

// ── deriveAll ────────────────────────────────────────────────────────────────
{
  const bag = P.deriveAll(M.defaultCurves(), xs, M.DEFAULT_MIX);
  check("panel keys are written", ["L", "c", "s", "Lt", "ct"].every((ch) => Array.isArray(bag[`contrast-equalizer.curve.${ch}`]) && Array.isArray(bag[`contrast-equalizer.curvex.${ch}`])) && bag[P.MIX_KEY] === 1);
  check("neutral curves ⇒ every chain idle (all params zero)", ids.every((id) => stageIdle(bag, id)));
  check("neutral curves ⇒ active flags 0", ids.every((id) => bag[`${id}.active`] === 0));
  for (const id of ids) {
    check(`${id} carries six vec4 level tables`, ["gainA", "gainB", "thrA", "thrB", "sharpA", "sharpB"].every((k) => Array.isArray(bag[`${id}.${k}`]) && bag[`${id}.${k}`].length === 4));
  }
}
{
  const c = M.defaultCurves();
  c.s = c.s.map(() => 0.9); // only the edges curve moved
  const bag = P.deriveAll(c, xs, 1);
  check("edges-only edit is still an identity ⇒ all chains idle", ids.every((id) => stageIdle(bag, id)));
}
{
  const c = M.defaultCurves();
  c.L = [0.5, 0.5, 0.5, 0.5, 0.7, 0.7];
  const bag = P.deriveAll(c, xs, 1);
  check("luma edit ⇒ luma chain active", stageActive(bag, LUMA));
  check("luma edit ⇒ chroma chains idle", stageIdle(bag, CHROMA_A) && stageIdle(bag, CHROMA_B));
  const sharps = [...bag[`${LUMA}.sharpA`], ...bag[`${LUMA}.sharpB`]];
  const want = M.sharps(c, xs, 1);
  check("active chain gets darktable's per-level sharps (0.0025·curve)", sharps.every((v, j) => Math.abs(v - want[j]) < 1e-15) && sharps.every((v) => v > 0));
  // Level 0 is the finest scale (the curve's right end, which this edit raised);
  // level 7 the coarsest (left end, untouched).
  const gains = [...bag[`${LUMA}.gainA`], ...bag[`${LUMA}.gainB`]];
  check("gain tables are per level, fine (0) → coarse (7)", gains.every((g, j) => Math.abs(g - M.levelCoeffs(c, xs, j, 1).gainL) < 1e-15) && gains[0] > 0 && gains[7] === 0);
}
{
  const c = M.defaultCurves();
  c.ct = [0, 0.05, 0.1, 0.15, 0.2, 0.25];
  const bag = P.deriveAll(c, xs, 1);
  check("chroma-threshold edit ⇒ both chroma chains active", stageActive(bag, CHROMA_A) && stageActive(bag, CHROMA_B));
  check("chroma-threshold edit ⇒ luma chain idle", stageIdle(bag, LUMA));
  const same = ["gainA", "gainB", "thrA", "thrB", "sharpA", "sharpB"].every(
    (k) => JSON.stringify(bag[`${CHROMA_A}.${k}`]) === JSON.stringify(bag[`${CHROMA_B}.${k}`]),
  );
  check("the two chroma chains share one coefficient set", same);
}
{
  const c = M.defaultCurves();
  c.L = c.L.map(() => 0.6);
  const bag = P.deriveAll(c, xs, 0); // mix 0 folds every node back to its default
  check("mix 0 ⇒ identity ⇒ chains idle", ids.every((id) => stageIdle(bag, id)));
}

// ── Bringing older edits forward ─────────────────────────────────────────────
{
  check("empty bag needs no migration", P.migrateBag({}) === null);
  const c = M.defaultCurves();
  c.L = [0.6, 0.6, 0.6, 0.6, 0.6, 0.6];
  const current = P.deriveAll(c, xs, 1);
  check("current bag needs no migration", P.migrateBag(current) === null);

  // A 2.0.0 edit: curves plus the retired per-band keys, no chain keys.
  const legacy = {};
  for (const ch of ["L", "c", "s", "Lt", "ct"]) {
    legacy[`contrast-equalizer.curve.${ch}`] = c[ch];
    legacy[`contrast-equalizer.curvex.${ch}`] = xs[ch];
  }
  legacy[P.MIX_KEY] = 1;
  legacy["contrast-equalizer.fine.gainL"] = 0.44;
  const patch = P.migrateBag(legacy);
  check("legacy bag ⇒ chain uniforms re-derived from its curves", !!patch && stageActive(patch, LUMA) && JSON.stringify(patch[`${LUMA}.gainA`]) === JSON.stringify(current[`${LUMA}.gainA`]));
  check("migration leaves the curves as they were", !!patch && JSON.stringify(patch["contrast-equalizer.curve.L"]) === JSON.stringify(c.L));
  check("migrated bag is current (no second migration)", !!patch && P.migrateBag({ ...legacy, ...patch }) === null);

  // A 1.x edit stored only its curves under the same keys.
  const v1 = {};
  for (const ch of ["L", "c", "s", "Lt", "ct"]) v1[`contrast-equalizer.curve.${ch}`] = c[ch];
  const p1 = P.migrateBag(v1);
  check("1.x bag (curves only) ⇒ migrated with default node positions", !!p1 && stageActive(p1, LUMA));
}

console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PARAM CHECKS PASS");
process.exit(fails ? 1 : 0);
