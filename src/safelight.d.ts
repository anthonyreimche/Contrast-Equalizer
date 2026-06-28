// Minimal SafeLight extension API surface used by Contrast Equalizer. Extensions
// are standalone bundles, so we declare just the pieces we touch rather than
// depend on the host's source. Mirrors src/extensions/types.ts in the app.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ComponentType = any;

export type GlslType =
  | "float" | "int" | "bool"
  | "vec2" | "vec3" | "vec4"
  | "ivec2" | "ivec3" | "ivec4"
  | "mat3" | "mat4"
  | "sampler2D";

export interface UniformDeclaration {
  key: string;
  glslType: GlslType;
  default: number | number[] | boolean;
  range?: { min: number; max: number; step?: number };
  label?: string;
}

/** A full-screen GPU pre-pass (ping-pong, source-UV space). The body mutates
 *  `vec3 c` (= readPrev(vUv), linear scene RGB). Engine-provided in every pass:
 *  uniform vec2 uTexel; uniform int uPassIndex, uPassCount; vec3 readPrev(vec2);
 *  plus luma()/srgbToLinear()/linearToSrgb(). The final pass result is exposed
 *  to the owning stage's inline glsl as `vec3 stageResult`. */
export interface StagePass {
  glsl: string;
  helpers?: string;
  iterations?: number;
  uniforms?: UniformDeclaration[];
}

export type ProcessingPhase =
  | "geometry"
  | "decode"
  | "noise-reduction"
  | "scene-linear"
  | "tone-map"
  | "display-adjust"
  | "effects"
  | "output-encode";

export interface ProcessingStageContribution {
  id: string;
  name: string;
  phase: ProcessingPhase;
  priority?: number;
  glsl: string;
  helpers?: string;
  uniforms: UniformDeclaration[];
  passes?: StagePass[];
}

export interface PanelDockDefault {
  module: "library" | "develop";
  direction: "left" | "right";
  order?: number;
  width?: number;
  height?: number;
}

export interface PanelContribution {
  id: string;
  title: string;
  component: ComponentType;
  order?: number;
  defaultDock?: PanelDockDefault;
  onReset?: () => void;
  headerAccessory?: ComponentType;
}

export type SettingsField =
  | { key: string; label: string; hint?: string; type: "boolean"; default: boolean }
  | {
      key: string;
      label: string;
      hint?: string;
      type: "select";
      default: string;
      options: { value: string; label: string }[];
    };

export interface SettingsContribution {
  title?: string;
  fields: SettingsField[];
  order?: number;
  keywords?: string[];
  component?: ComponentType;
}

export interface SafelightAPI {
  version: 1;
  extensionId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  react: any;
  registerProcessingStage(c: ProcessingStageContribution): void;
  unregisterProcessingStage(id: string): void;
  registerPanel(c: PanelContribution): void;
  registerSettings(c: SettingsContribution): void;
  settings: {
    get<T>(key: string, fallback: T): T;
    set(key: string, value: unknown): void;
    onChange(cb: (key: string, value: unknown) => void): () => void;
  };
  /** { Panel, Slider, Histogram, CurveEditor, Rating, Thumbnail }. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components: Record<string, ComponentType>;
  /** { useDevelopStore, useCatalogStore, useUIStore, usePresetsStore, … }. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stores: Record<string, any>;
}

export interface ExtensionModule {
  activate(api: SafelightAPI): void;
  deactivate?(): void;
}
