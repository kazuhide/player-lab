import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  uuid: 0,
  initializeSource: vi.fn(async (_id: string, _drm: unknown, _config: unknown) => {}),
  destroySource: vi.fn((_id: string) => {}),
  loadSource: vi.fn(async (_player: string, _source: string) => {}),
  unload: vi.fn(async (_player: string) => {}),
  destroyPlayer: vi.fn(async (_player: string) => {}),
}));
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import type * as SDK from "bitmovin-player-react-native";
import { disposeOwnedSources, initializeOwnedSource, loadOwnedSource, unloadOwnedSource } from "../src/sourceOwnership";

/** Execute the exact installed SDK lifecycle, replacing only its native bridge imports. */
function installedPlayer(): typeof SDK.Player {
  const root = path.dirname(createRequire(import.meta.url).resolve("bitmovin-player-react-native/package.json"));
  expect(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version).toBe("1.29.0");
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  function load(file: string): Record<string, unknown> {
    if (file.endsWith("/modules/SourceModule.ts")) return { initializeWithConfig: bridge.initializeSource, destroy: bridge.destroySource };
    if (file.endsWith("/modules/PlayerModule.ts")) return { loadSource: bridge.loadSource, unload: bridge.unload, destroy: bridge.destroyPlayer };
    if (/\/(?:modules\/[^/]+|[^/]*Module)\.ts$/i.test(file)) return {};
    const cached = cache.get(file); if (cached) return cached.exports;
    const module = { exports: {} }; cache.set(file, module);
    const source = fs.readFileSync(file, "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    const evaluate = vm.runInThisContext("(function(require,module,exports){\n" + compiled + "\n})", { filename: file });
    evaluate((name: string) => {
      if (name === "expo-crypto") return { randomUUID: () => "public-test-native-" + (++bridge.uuid) };
      if (name === "react-native") return { Platform: { OS: "android" } };
      if (!name.startsWith(".")) throw new Error("Unexpected installed SDK boundary: " + name);
      const entry = path.resolve(path.dirname(file), name);
      return load(fs.existsSync(entry + ".ts") ? entry + ".ts" : path.join(entry, "index.ts"));
    }, module, module.exports);
    return module.exports;
  }
  const constructor = load(path.join(root, "src/player.ts")).Player;
  if (typeof constructor !== "function") throw new Error("The installed SDK Player constructor is missing.");
  return constructor as typeof SDK.Player;
}
const Player = installedPlayer();

const flush = async () => { for (let turn = 0; turn < 12; turn++) await Promise.resolve(); };
beforeEach(() => { vi.clearAllMocks(); bridge.initializeSource.mockResolvedValue(undefined); });
afterEach(async () => { await flush(); });

describe("source ownership against the installed SDK's asynchronous bridge", () => {
  it("preserves the SDK-created source identity and restores both exact method descriptors", async () => {
    const player = new Player();
    const loadDescriptor = Object.getOwnPropertyDescriptor(player, "loadSource");
    let initialize!: () => void;
    bridge.initializeSource.mockImplementationOnce(() => new Promise<void>((resolve) => { initialize = resolve; }));
    const loading = loadOwnedSource(player, { nativeId: "exact-real-sdk-source", url: "https://example.com/source.m3u8" });
    const source = player.source!;
    const initializeDescriptor = Object.getOwnPropertyDescriptor(source, "initialize");
    expect(source.config?.nativeId).toBe("exact-real-sdk-source");
    expect(Object.getOwnPropertyDescriptor(player, "loadSource")).toEqual(loadDescriptor);
    expect(initializeOwnedSource(player)).toBe(loading);
    expect(bridge.initializeSource).toHaveBeenCalledOnce();
    initialize(); await loading; await flush();
    expect(player.source).toBe(source);
    expect(bridge.loadSource).toHaveBeenCalledExactlyOnceWith(player.nativeId, source.nativeId);
    expect(Object.getOwnPropertyDescriptor(player, "loadSource")).toEqual(loadDescriptor);
    expect(Object.getOwnPropertyDescriptor(source, "initialize")).toEqual(initializeDescriptor);
    disposeOwnedSources(player); player.destroy();
  });

  it("guards the SDK's final native-dispatch microtask when unload reenters immediately after loadSource", async () => {
    const player = new Player(); const original = player.loadSource;
    player.loadSource = (source) => { original(source); unloadOwnedSource(player); };
    const descriptor = Object.getOwnPropertyDescriptor(player, "loadSource");
    await loadOwnedSource(player, { nativeId: "retired-same-tick", url: "https://example.com/a.m3u8" });
    await flush();
    expect(bridge.loadSource).not.toHaveBeenCalled();
    expect(bridge.destroySource).toHaveBeenCalledExactlyOnceWith("retired-same-tick");
    expect(Object.getOwnPropertyDescriptor(player, "loadSource")).toEqual(descriptor);
    disposeOwnedSources(player); player.destroy();
  });

  it("keeps one unresolved native initialization and one replaceable request through retries", async () => {
    const player = new Player(); const sdkLoad = vi.spyOn(player, "load");
    let initialize!: () => void;
    bridge.initializeSource.mockImplementationOnce(() => new Promise<void>((resolve) => { initialize = resolve; }));
    const first = loadOwnedSource(player, { nativeId: "blocked-first", url: "https://example.com/first.m3u8" });
    const requests = Array.from({ length: 100 }, (_, index) => loadOwnedSource(player, {
      nativeId: "retry-" + index, url: "https://example.com/retry-" + index + ".m3u8",
    }));
    await Promise.all([first, ...requests.slice(0, -1)]);
    expect(sdkLoad).toHaveBeenCalledOnce();
    expect(bridge.initializeSource).toHaveBeenCalledOnce();
    expect(bridge.destroySource).not.toHaveBeenCalled();
    initialize(); await requests[requests.length - 1]; await flush();
    expect(sdkLoad).toHaveBeenCalledTimes(2);
    expect(bridge.initializeSource).toHaveBeenCalledTimes(2);
    expect(bridge.loadSource).toHaveBeenCalledExactlyOnceWith(player.nativeId, "retry-99");
    expect(bridge.destroySource).toHaveBeenCalledExactlyOnceWith("blocked-first");
    disposeOwnedSources(player); player.destroy();
  });

  it("cancels a queued replacement immediately and cannot attach it after unload", async () => {
    const player = new Player(); let initialize!: () => void;
    bridge.initializeSource.mockImplementationOnce(() => new Promise<void>((resolve) => { initialize = resolve; }));
    const first = loadOwnedSource(player, { nativeId: "first-before-unload", url: "https://example.com/a.m3u8" });
    const second = loadOwnedSource(player, { nativeId: "queued-before-unload", url: "https://example.com/b.m3u8" });
    unloadOwnedSource(player); await Promise.all([first, second]);
    expect(bridge.initializeSource).toHaveBeenCalledOnce();
    initialize(); await flush();
    expect(bridge.initializeSource).toHaveBeenCalledOnce();
    expect(bridge.loadSource).not.toHaveBeenCalled();
    expect(bridge.destroySource).toHaveBeenCalledExactlyOnceWith("first-before-unload");
    disposeOwnedSources(player); player.destroy();
  });

  it("retires pending initialization before recreation and starts the next player's source after settlement", async () => {
    const firstPlayer = new Player(); let initialize!: () => void;
    bridge.initializeSource.mockImplementationOnce(() => new Promise<void>((resolve) => { initialize = resolve; }));
    const first = loadOwnedSource(firstPlayer, { nativeId: "retired-player-source", url: "https://example.com/a.m3u8" });
    disposeOwnedSources(firstPlayer); firstPlayer.destroy();
    const nextPlayer = new Player();
    const second = loadOwnedSource(nextPlayer, { nativeId: "current-player-source", url: "https://example.com/b.m3u8" });
    expect(bridge.initializeSource).toHaveBeenCalledOnce();
    expect(bridge.destroySource).not.toHaveBeenCalled();
    initialize(); await Promise.all([first, second]); await flush();
    expect(bridge.destroySource).toHaveBeenCalledExactlyOnceWith("retired-player-source");
    expect(bridge.loadSource).toHaveBeenCalledExactlyOnceWith(nextPlayer.nativeId, "current-player-source");
    disposeOwnedSources(nextPlayer); nextPlayer.destroy();
  });

  it("destroys a failed partial initialization once and continues with the latest queued source", async () => {
    const player = new Player(); let reject!: (error: Error) => void;
    bridge.initializeSource.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const first = loadOwnedSource(player, { nativeId: "failed-retired-source", url: "https://example.com/a.m3u8" });
    const next = loadOwnedSource(player, { nativeId: "after-initialization-failure", url: "https://example.com/b.m3u8" });
    expect(bridge.destroySource).not.toHaveBeenCalled();
    reject(new Error("Controlled initialization failure")); await Promise.all([first, next]); await flush();
    expect(bridge.destroySource).toHaveBeenCalledExactlyOnceWith("failed-retired-source");
    expect(bridge.loadSource).toHaveBeenCalledExactlyOnceWith(player.nativeId, "after-initialization-failure");
    disposeOwnedSources(player); player.destroy();
  });

  it("surfaces an active initializer failure without retaining its native source or a blocked queue", async () => {
    const player = new Player();
    bridge.initializeSource.mockRejectedValueOnce(new Error("Controlled active initialization failure"));
    await expect(loadOwnedSource(player, { nativeId: "active-failure", url: "https://example.com/a.m3u8" })).rejects.toThrow("Controlled active initialization failure");
    await flush();
    expect(bridge.destroySource).toHaveBeenCalledExactlyOnceWith("active-failure");
    expect(player.source).toBeUndefined();
    await loadOwnedSource(player, { nativeId: "recovered", url: "https://example.com/b.m3u8" });
    expect(bridge.loadSource).toHaveBeenCalledExactlyOnceWith(player.nativeId, "recovered");
    disposeOwnedSources(player); player.destroy();
  });

  it("restores the original descriptor after a synchronous SDK throw and remains usable", async () => {
    const player = new Player(); const descriptor = Object.getOwnPropertyDescriptor(player, "loadSource");
    const original = player.load;
    player.load = () => { throw new Error("Controlled SDK load failure"); };
    await expect(loadOwnedSource(player, { url: "https://example.com/a.m3u8" })).rejects.toThrow("Controlled SDK load failure");
    expect(Object.getOwnPropertyDescriptor(player, "loadSource")).toEqual(descriptor);
    player.load = original;
    await loadOwnedSource(player, { nativeId: "after-sync-throw", url: "https://example.com/b.m3u8" });
    expect(bridge.loadSource).toHaveBeenCalledExactlyOnceWith(player.nativeId, "after-sync-throw");
    disposeOwnedSources(player); player.destroy();
  });

  it("preserves exact descriptor restoration during synchronous Player.load reentry", async () => {
    const player = new Player(); const descriptor = Object.getOwnPropertyDescriptor(player, "loadSource");
    const sdkLoad = player.load; let nested: Promise<void> | undefined;
    player.load = (configuration) => {
      if (configuration.nativeId === "outer") nested = loadOwnedSource(player, { nativeId: "nested-latest", url: "https://example.com/b.m3u8" });
      sdkLoad(configuration);
    };
    await loadOwnedSource(player, { nativeId: "outer", url: "https://example.com/a.m3u8" });
    await nested; await flush();
    expect(Object.getOwnPropertyDescriptor(player, "loadSource")).toEqual(descriptor);
    expect(bridge.initializeSource).toHaveBeenCalledOnce();
    expect(bridge.initializeSource.mock.calls[0]![0]).toBe("nested-latest");
    expect(bridge.loadSource).toHaveBeenCalledExactlyOnceWith(player.nativeId, "nested-latest");
    disposeOwnedSources(player); player.destroy();
  });

  it.each(["replacement", "unload", "dispose"])("never attaches or destroys a retired initializing source early after %s", async (action) => {
    let initialize!: () => void;
    bridge.initializeSource.mockImplementationOnce(() => new Promise<void>((resolve) => { initialize = resolve; }));
    const player = new Player();
    const first = loadOwnedSource(player, { url: "https://example.com/first.m3u8" });
    await flush();
    const firstId = bridge.initializeSource.mock.calls[0]![0];
    if (action === "replacement") void loadOwnedSource(player, { url: "https://example.com/replacement.m3u8" });
    else if (action === "unload") unloadOwnedSource(player);
    else { disposeOwnedSources(player); player.destroy(); }
    expect(bridge.destroySource).not.toHaveBeenCalledWith(firstId);
    initialize(); await first; await flush();
    expect(bridge.loadSource.mock.calls.filter(([, source]) => source === firstId)).toEqual([]);
    expect(bridge.destroySource.mock.calls.filter(([source]) => source === firstId)).toHaveLength(1);
    unloadOwnedSource(player); await flush(); player.destroy();
  });
});
