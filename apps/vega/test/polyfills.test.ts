import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installVegaPolyfills, removeVegaPolyfills } from "../src/polyfills";

const native = vi.hoisted(() => ({
  MediaSource: class NativeMediaSource {},
  HTMLMediaElement: class NativeHTMLMediaElement {},
  WebCrypto: { subtle: {} },
}));
vi.mock("@amazon-devices/react-native-w3cmedia", () => native);

const globals = globalThis as Record<string, unknown>;
const previous = globals.gvideo;
beforeEach(() => {
  // Model React Native's writable globals; Node's built-in crypto is a getter.
  for (const name of ["MediaSource", "HTMLMediaElement", "crypto", "DOMParser", "Element", "atob", "btoa"]) {
    vi.stubGlobal(name, globals[name]);
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (previous === undefined) delete globals.gvideo;
  else globals.gvideo = previous;
});

describe("Vega runtime adapters", () => {
  it("installs the native media and crypto APIs without replacing URL", () => {
    for (const name of ["MediaSource", "HTMLMediaElement", "crypto"]) vi.stubGlobal(name, undefined);
    const nativeURL = globalThis.URL;
    installVegaPolyfills({} as Parameters<typeof installVegaPolyfills>[0]);
    expect(globals.MediaSource).toBe(native.MediaSource);
    expect(globals.HTMLMediaElement).toBe(native.HTMLMediaElement);
    expect(globals.crypto).toBe(native.WebCrypto);
    expect(globalThis.URL).toBe(nativeURL);
  });

  it("uses real XML DOM and Base64 implementations for manifest data", () => {
    for (const name of ["DOMParser", "Element", "atob", "btoa"]) vi.stubGlobal(name, undefined);
    installVegaPolyfills({} as Parameters<typeof installVegaPolyfills>[0]);
    const xml = new DOMParser().parseFromString('<MPD><Period id="main"/></MPD>', "application/xml");
    expect(xml.documentElement?.nodeName).toBe("MPD");
    expect(xml.getElementsByTagName("Period")[0]?.getAttribute("id")).toBe("main");
    expect(xml.documentElement instanceof Element).toBe(true);
    expect(atob(btoa("\u0000\u0080\u00ff"))).toBe("\u0000\u0080\u00ff");
  });

  it("adapts the session media element's attributes before exposing it to the SDK", () => {
    const video = { muted: false } as unknown as Parameters<typeof installVegaPolyfills>[0] & {
      setAttribute: (name: string, value: unknown) => void;
      getAttribute: (name: string) => unknown;
      hasAttribute: (name: string) => boolean;
      removeAttribute: (name: string) => void;
    };
    installVegaPolyfills(video);
    video.setAttribute("muted", true);
    expect(video.muted).toBe(true);
    expect(video.getAttribute("muted")).toBe(true);
    expect(video.hasAttribute("muted")).toBe(true);
    video.removeAttribute("muted");
    expect(video.hasAttribute("muted")).toBe(false);
    expect(globals.gvideo).toBe(video);
  });

  it("keeps existing native attribute methods", () => {
    const setAttribute = vi.fn();
    const video = { setAttribute } as unknown as Parameters<typeof installVegaPolyfills>[0];
    installVegaPolyfills(video);
    expect((video as unknown as { setAttribute: unknown }).setAttribute).toBe(setAttribute);
  });
});

describe("session media shim ownership", () => {
  it("removes the current media element", () => {
    const video = {} as Parameters<typeof installVegaPolyfills>[0];
    installVegaPolyfills(video);
    removeVegaPolyfills(video);
    expect(globals.gvideo).toBeUndefined();
  });

  it("does not remove a newer media element during an older cleanup", () => {
    const old = {} as Parameters<typeof installVegaPolyfills>[0];
    const current = {} as Parameters<typeof installVegaPolyfills>[0];
    installVegaPolyfills(old);
    installVegaPolyfills(current);
    removeVegaPolyfills(old);
    expect(globals.gvideo).toBe(current);
  });
});
