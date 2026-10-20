import { HTMLMediaElement, MediaSource, WebCrypto, type VideoPlayer } from "@amazon-devices/react-native-w3cmedia";
import { DOMParser, Element } from "@xmldom/xmldom";
import { decode, encode } from "base-64";

/** Connect the public runtime APIs used by the pinned Bitmovin Vega sample.
 * https://github.com/bitmovin/bitmovin-player-web-sample-fire-tv-vega/tree/0c7463104d3c18f56440aeec7beccd0d92c11aaa/src/polyfills
 * Media/crypto implementations stay in the Amazon package; XML and Base64 stay in
 * their upstream packages. URL is deliberately left to the native media runtime.
 */
function installRuntimeAPIs(): void {
  const globals = globalThis as Record<string, unknown>;
  const apis = { MediaSource, HTMLMediaElement, crypto: WebCrypto, DOMParser, Element, atob: decode, btoa: encode };
  Object.assign(globals, apis);
  // React Native normally aliases window to globalThis; support a distinct alias too.
  if (globals.window && typeof globals.window === "object") Object.assign(globals.window, apis);
}

export function installVegaPolyfills(video: VideoPlayer): void {
  installRuntimeAPIs();
  // The SDK ReactNative module routes document.createElement('video') to gvideo.
  // Its attribute operations address native media properties, not an HTML DOM.
  const attributes = {
    hasAttribute: (name: string): boolean => Reflect.get(video, name) !== undefined,
    getAttribute: (name: string): unknown => Reflect.get(video, name),
    setAttribute: (name: string, value: unknown): void => { Reflect.set(video, name, value); },
    removeAttribute: (name: string): void => { Reflect.deleteProperty(video, name); },
  };
  for (const [name, method] of Object.entries(attributes)) {
    if (typeof Reflect.get(video, name) !== "function") Reflect.set(video, name, method);
  }
  (globalThis as Record<string, unknown>).gvideo = video;
}

/** Remove only the media element owned by the session being released. */
export function removeVegaPolyfills(video: VideoPlayer): void {
  const globals = globalThis as Record<string, unknown>;
  if (globals.gvideo === video) delete globals.gvideo;
}
