// Contrast Equalizer — SafeLight extension (GPL-3.0-or-later).
//
// A faithful port of darktable's contrast equalizer (the "atrous" module): an
// edge-aware à trous wavelet decomposition with per-scale luma / chroma boost and
// noise thresholds plus an edge-awareness curve. Registers four wavelet-octave GPU
// stages (the host's prepass cap) and a Develop panel that reproduces darktable's
// three-tab frequency-curve UI.
//
// See wavelet.ts for the GPU model and Equalizer.ts for the panel.

import type { SafelightAPI } from "./safelight";
import { initRuntime } from "./runtime";
import { allBandStages, BASE_ID, bandStageId } from "./wavelet";
import { EqualizerPanel } from "./Equalizer";
import { deriveAll, DEFAULT_MIX } from "./params";
import { defaultCurves, GPU_SCALES, DILATIONS, type DetailRange } from "./model";

const PANEL_ID = `${BASE_ID}.panel`;
const RANGE_KEY = "range";

function rangeOf(api: SafelightAPI): DetailRange {
  const v = api.settings.get<DetailRange>(RANGE_KEY, "fine");
  return v === "extended" ? "extended" : "fine";
}

function registerStages(api: SafelightAPI, range: DetailRange): void {
  // Re-registering the same stage ids replaces them (and recompiles the develop
  // shader) — so flipping the detail range just rebuilds with a new dilation
  // schedule. Each stage stays an exact identity until the panel writes non-
  // default boosts/thresholds, so an untouched photo renders unchanged.
  for (const stage of allBandStages(DILATIONS[range])) api.registerProcessingStage(stage);
}

function resetPanel(api: SafelightAPI): void {
  const store = api.stores.useDevelopStore.getState();
  store.setDynParams(deriveAll(defaultCurves(), DEFAULT_MIX));
  // Persist the reset so it survives a library round-trip / reload.
  void store.commitEdit("Contrast Equalizer reset");
}

export function activate(api: SafelightAPI): void {
  initRuntime(api);

  registerStages(api, rangeOf(api));

  api.registerSettings({
    title: "Contrast Equalizer",
    fields: [
      {
        key: RANGE_KEY,
        label: "Detail range",
        hint: "How far the four octaves reach. 'Fine' (default) covers ~5–33 px — best for sharpening, clarity and denoise. 'Extended' stretches the coarse end to ~257 px for big local-contrast / bloom moves, at some loss of smoothness.",
        type: "select",
        default: "fine",
        options: [
          { value: "fine", label: "Fine (sharpen / clarity / denoise)" },
          { value: "extended", label: "Extended (adds coarse / bloom)" },
        ],
      },
    ],
  });

  api.registerPanel({
    id: PANEL_ID,
    title: "Contrast Equalizer",
    component: EqualizerPanel,
    defaultDock: { module: "develop", direction: "right", order: 7, width: 268 },
    onReset: () => resetPanel(api),
  });

  // Follow the Preferences dropdown: rebuild the stages on a range change.
  api.settings.onChange((key, value) => {
    if (key === RANGE_KEY) {
      registerStages(api, value === "extended" ? "extended" : "fine");
    }
  });
}

export function deactivate(): void {
  // The host sweeps the registry (stages + panel + settings) on disable/uninstall
  // and recompiles the develop shader without these stages. We still explicitly
  // drop the stages so a re-enable starts clean.
  const api = (globalThis as unknown as { safelight?: SafelightAPI }).safelight;
  if (!api) return;
  for (let i = 0; i < GPU_SCALES; i++) api.unregisterProcessingStage(bandStageId(i));
}
