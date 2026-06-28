// Shared access to the app's React instance + the scoped API. Extensions must
// NOT bundle their own React — we use api.react (captured at activate) and build
// elements with createElement (no JSX), so nothing external needs resolving at
// bundle time.

import type { SafelightAPI } from "./safelight";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReactNS = any;

let _react: ReactNS | null = null;
let _api: SafelightAPI | null = null;

export function initRuntime(api: SafelightAPI): void {
  _react = api.react;
  _api = api;
}

export function api(): SafelightAPI {
  if (!_api) throw new Error("[contrast-equalizer] api used before activate()");
  return _api;
}

export function R(): ReactNS {
  if (!_react) throw new Error("[contrast-equalizer] runtime used before activate()");
  return _react;
}

/** createElement shorthand. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function h(type: any, props?: any, ...children: any[]): any {
  return R().createElement(type, props, ...children);
}
