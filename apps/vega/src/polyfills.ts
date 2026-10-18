/**
 * Vega runs the modular *web* player in a non-browser React Native environment, so
 * the player needs browser-API shims (a W3C `<video>` element, base64, DOMParser,
 * WebCrypto).
 *
 * This is a deliberately minimal shim so the app type-checks. For a real
 * Kepler / Fire-TV build, replace it with the polyfills from the Bitmovin Vega
 * sample (`src/polyfills/*`), which also provide `atob`/`btoa`, `DOMParser` and
 * `crypto.subtle`. See README. The one piece modeled here is routing
 * `document.createElement('video')` to the W3C media element.
 */
import type { VideoPlayer } from "@amazon-devices/react-native-w3cmedia";

export function installVegaPolyfills(video: VideoPlayer): void {
  // `document.createElement('video')` is stubbed (in the full sample) to return this.
  (globalThis as Record<string, unknown>).gvideo = video;
}

/** Remove only the media element owned by the session being released. */
export function removeVegaPolyfills(video: VideoPlayer): void {
  const globals = globalThis as Record<string, unknown>;
  if (globals.gvideo === video) delete globals.gvideo;
}
