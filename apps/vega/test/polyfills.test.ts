import { afterEach, describe, expect, it } from "vitest";
import { installVegaPolyfills, removeVegaPolyfills } from "../src/polyfills";

const globals = globalThis as Record<string, unknown>;
const previous = globals.gvideo;
afterEach(() => {
  if (previous === undefined) delete globals.gvideo;
  else globals.gvideo = previous;
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
