import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseCaseDriver, UseCaseDriverOptions, UseCaseSource } from "../src/startup/use-cases/contracts";

const sdk = vi.hoisted(() => {
  function gate() {
    let resolve!: () => void;
    const promise = new Promise<void>((yes) => { resolve = yes; });
    return { promise, resolve };
  }
  class Preloader {
    readonly finished = gate();
    destroyed = false;
    waitForFinish() { return this.finished.promise; }
    async destroy() { this.destroyed = true; this.finished.resolve(); }
  }
  const players: Player[] = [];
  class Player {
    static LoadMode = { MEDIA_SOURCE: 2 };
    static isBrowserSupported() { return true; }
    readonly listeners = new Map<string, Set<(event: Event) => void>>();
    readonly preloaders = new Map<string, Preloader>();
    destroys = 0;
    constructor() { players.push(this); }
    configure() { return true; }
    addEventListener(name: string, listener: (event: Event) => void) {
      const listeners = this.listeners.get(name) ?? new Set();
      listeners.add(listener); this.listeners.set(name, listeners);
    }
    removeEventListener(name: string, listener: (event: Event) => void) { this.listeners.get(name)?.delete(listener); }
    emit(event: Event) { for (const listener of this.listeners.get(event.type) ?? []) listener(event); }
    async attach() {}
    async load() {}
    async unload() {}
    getLoadMode() { return 2; }
    async preload(url: string) {
      const manager = new Preloader(); this.preloaders.set(url, manager); return manager;
    }
    async destroy() {
      this.destroys++;
      await Promise.all([...this.preloaders.values()].map((manager) => manager.destroy()));
    }
  }
  return { Player, players };
});
vi.mock("shaka-player/dist/shaka-player.hls-es2021.js", () => ({ default: {
  Player: sdk.Player, polyfill: { installAll() {} }, util: { Error: { Severity: { RECOVERABLE: 1, CRITICAL: 2 } } },
} }));
vi.mock("../src/startup/use-cases/prepared-media", async (original) => {
  const actual = await original<typeof import("../src/startup/use-cases/prepared-media")>();
  return { ...actual, createPreparedMedia: () => {
    const video = {
      paused: true, currentTime: 0, readyState: 2, buffered: { length: 0 },
      async play() { video.paused = false; }, pause() { video.paused = true; },
    };
    return { video, container: {}, show() {}, destroy() { video.pause(); } };
  } };
});
import { createDriver } from "../src/startup/use-cases/shaka-shared";

const open: UseCaseDriver[] = [];
const source = (index: number): UseCaseSource => ({ id: `source-${index}`, url: `https://fixture.invalid/source-${index}.m3u8`,
  format: "hls", startTimeSeconds: 0 });
function error(severity: number) {
  const event = new Event("error");
  Object.defineProperty(event, "detail", { value: { severity, code: 7001 } });
  return event;
}
async function drain() { await vi.dynamicImportSettled(); for (let index = 0; index < 16; index++) await Promise.resolve(); }

async function begin() {
  const events: Array<{ name: string; sourceId: string }> = [];
  const options: UseCaseDriverOptions = {
    container: {} as HTMLElement, licenseKey: "test-only-key", policy: "segments", bufferSeconds: 12,
    signal: new AbortController().signal, event: (name, sourceId) => { events.push({ name, sourceId }); },
  };
  const driver = await createDriver(options); open.push(driver);
  const initial = driver.prepare(source(0)); await drain();
  const player = sdk.players[0]!;
  player.preloaders.get(source(0).url)!.finished.resolve(); await initial;
  const video = await driver.activate("source-0", () => {});
  return { driver, player, video, events };
}

beforeEach(() => {
  sdk.players.length = 0;
  vi.stubGlobal("MediaSource", class {}); vi.stubGlobal("ManagedMediaSource", undefined);
});
afterEach(async () => { await Promise.all(open.splice(0).map((driver) => driver.dispose())); vi.unstubAllGlobals(); });

describe("shared Shaka source lifetime", () => {
  it("invalidates the loaded source and every pending preparation after a late critical player error, emitting one error", async () => {
    const f = await begin();
    const pending = Promise.allSettled([f.driver.prepare(source(1)), f.driver.prepare(source(2))]);
    await drain();
    expect(f.player.preloaders.size).toBe(3);
    expect(f.driver.state("source-0").video).toBe(f.video);
    expect(f.video.paused).toBe(false);
    f.player.emit(error(2)); f.player.emit(error(2));
    for (const manager of f.player.preloaders.values()) manager.finished.resolve();
    const outcomes = await pending;
    expect(outcomes.map((row) => row.status)).toEqual(["rejected", "rejected"]);
    expect(f.events.filter((event) => event.name === "error")).toEqual([{ name: "error", sourceId: "source-0" }]);
    expect(f.driver.state("source-0").video).toBeNull();
    expect(f.video.paused).toBe(true);
    await expect(Promise.resolve().then(() => f.driver.activate("source-1", () => {}))).rejects.toThrow();
    await f.driver.dispose();
    expect(f.player.destroys).toBe(1);
    expect([...f.player.preloaders.values()].every((manager) => manager.destroyed)).toBe(true);
  });

  it("keeps foreground playback and pending preparations usable after a recoverable player error", async () => {
    const f = await begin();
    const preparation = f.driver.prepare(source(1)); await drain();
    f.player.emit(error(1));
    f.player.preloaders.get(source(1).url)!.finished.resolve(); await preparation;
    expect(f.events.filter((event) => event.name === "error")).toEqual([]);
    expect(f.driver.state("source-0").video).toBe(f.video);
    expect(f.video.paused).toBe(false);
    expect(await f.driver.activate("source-1", () => {})).toBe(f.video);
    expect(f.player.destroys).toBe(0);
  });

  it("ignores SDK errors and callbacks queued before disposal after the owned player has been released", async () => {
    const f = await begin();
    const queued = [...(f.player.listeners.get("error") ?? [])];
    expect(queued).toHaveLength(1);
    await f.driver.dispose();
    const before = [...f.events];
    f.player.emit(error(2));
    for (const callback of queued) callback(error(2));
    expect(f.events).toEqual(before);
    expect(f.player.listeners.get("error")?.size).toBe(0);
    expect(f.driver.state("source-0").video).toBeNull();
    expect(f.player.destroys).toBe(1);
  });
});
