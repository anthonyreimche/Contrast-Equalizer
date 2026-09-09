// Contrast Equalizer — SafeLight extension (GPL-3.0-or-later).
//
// A faithful port of darktable's contrast equalizer (the "atrous" module): an
// edge-aware à trous wavelet decomposition with per-scale luma / chroma boost and
// noise thresholds plus an edge-awareness curve. Registers three wavelet-chain
// GPU stages and a Develop panel that reproduces darktable's three-tab
// frequency-curve UI and its graph interaction.
//
// See wavelet.ts for the GPU model and Equalizer.ts for the panel.

import type { SafelightAPI } from "./safelight";
import { initRuntime } from "./runtime";
import { allChainStages, BASE_ID, CHAINS, chainStageId } from "./wavelet";
import { EqualizerPanel } from "./Equalizer";
import { deriveAll, migrateBag, DEFAULT_MIX } from "./params";
import { defaultCurves, defaultXs } from "./model";

const PANEL_ID = `${BASE_ID}.panel`;

interface DevelopState {
  paramBag: Record<string, unknown>;
  setDynParams: (patch: Record<string, unknown>) => void;
}

let stopMigrating: (() => void) | null = null;

function resetPanel(api: SafelightAPI): void {
  const store = api.stores.useDevelopStore.getState();
  store.setDynParams(deriveAll(defaultCurves(), defaultXs(), DEFAULT_MIX));
  // Persist the reset so it survives a library round-trip / reload.
  void store.commitEdit("Contrast Equalizer reset");
}

export function activate(api: SafelightAPI): void {
  initRuntime(api);

  // Each chain stays an exact identity until the panel writes non-default
  // boosts/thresholds, so an untouched photo renders unchanged.
  for (const stage of allChainStages()) api.registerProcessingStage(stage);

  api.registerPanel({
    id: PANEL_ID,
    title: "Contrast Equalizer",
    component: EqualizerPanel,
    defaultDock: { module: "develop", direction: "right", order: 7, width: 268 },
    onReset: () => resetPanel(api),
  });

  // Edits saved by earlier releases keep their curves but drove the GPU through
  // keys these chains never read; re-derive the live uniforms whenever such a
  // bag is loaded so the render matches the panel. Live params only — the edit
  // itself is rewritten by the next commit, as any other change would be.
  stopMigrating = api.stores.useDevelopStore.subscribe(
    (state: DevelopState, prev: DevelopState) => {
      if (state.paramBag === prev.paramBag) return;
      const patch = migrateBag(state.paramBag);
      if (patch) state.setDynParams(patch);
    },
  );
}

export function deactivate(): void {
  stopMigrating?.();
  stopMigrating = null;
  // The host sweeps the registry (stages + panel + settings) on disable/uninstall
  // and recompiles the develop shader without these stages. We still explicitly
  // drop the stages so a re-enable starts clean.
  const api = (globalThis as unknown as { safelight?: SafelightAPI }).safelight;
  if (!api) return;
  for (const chain of CHAINS) api.unregisterProcessingStage(chainStageId(chain));
}
