import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterContext, AdapterMark, FailureCode } from "../src/startup/contract";

const sdk = vi.hoisted(() => {
  function pending() {
    let resolve!: () => void; let reject!: (reason: unknown) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  }
  const state = {
    supported: true, configurationAccepted: true, configurationThrows: false, constructorThrows: false,
    destroyThrows: false, loadEmitsCritical: false, attachHasSource: true, mode: 2, media: null as unknown,
    configuration: {} as Record<string, unknown>, order: [] as string[],
    events: new Map<string, Set<(event: Event) => void>>(), destroys: 0,
    attach: pending(), load: pending(),
    stats: { loadLatency: 0.25, timeToFirstFrame: 0.3, estimatedBandwidth: 125000 },
    tracks: [{ active: true, language: "en", audioLanguage: "en" }],
  };
  class Source {}
  class Player {
    static version = "v5.3.3";
    static LoadMode = { DESTROYED: 0, NOT_LOADED: 1, MEDIA_SOURCE: 2, SRC_EQUALS: 3 };
    static isBrowserSupported() { return state.supported; }
    constructor(...args: unknown[]) { state.order.push("construct:" + args.length); if (state.constructorThrows) throw new Error("private constructor payload"); }
    configure(configuration: Record<string, unknown>) {
      state.order.push("configure"); state.configuration = configuration;
      if (state.configurationThrows) throw new Error("private configuration payload");
      return state.configurationAccepted;
    }
    attach(video: { currentSrc: string }) {
      state.order.push("attach"); state.media = video;
      return state.attach.promise.then(() => { if (!state.destroys && state.attachHasSource) video.currentSrc = "blob:owned-shaka-source"; });
    }
    load() {
      state.order.push("load");
      if (state.loadEmitsCritical) {
        const event = new Event("error"); Object.defineProperty(event, "detail", { value: { severity: 2, code: 7001 } });
        for (const listener of state.events.get("error") ?? []) listener(event);
      }
      return state.load.promise;
    }
    destroy() { state.destroys += 1; return state.destroyThrows ? Promise.reject(new Error("private destroy payload")) : Promise.resolve(); }
    addEventListener(event: string, listener: (event: Event) => void) {
      const listeners = state.events.get(event) ?? new Set(); listeners.add(listener); state.events.set(event, listeners);
    }
    removeEventListener(event: string, listener: (event: Event) => void) { state.events.get(event)?.delete(listener); }
    getLoadMode() { return state.mode; }
    getMediaElement() { return state.media; }
    getStats() { return state.stats; }
    getVariantTracks() { return state.tracks; }
  }
  return { state, pending, Source, Player };
});
vi.mock("shaka-player/dist/shaka-player.hls-es2021.js", () => ({ default: {
  Player: sdk.Player, polyfill: { installAll: () => { sdk.state.order.push("polyfills"); } },
  util: { Error: { Severity: { RECOVERABLE: 1, CRITICAL: 2 } } },
} }));
import { createAdapter } from "../src/startup/adapters/shaka";

function fixture() {
  const play = sdk.pending(); const abort = new AbortController();
  const marks: AdapterMark[] = []; const failures: [FailureCode, number | undefined][] = [];
  const video = {
    muted: false, defaultMuted: false, autoplay: true, playsInline: false,
    playbackRate: 2, defaultPlaybackRate: 2, currentTime: 20, currentSrc: "",
    srcObject: null, mediaKeys: null, paused: true,
    hasAttribute: () => false, getAttribute: () => null, querySelector: () => null,
    play: vi.fn(() => { sdk.state.order.push("play"); return play.promise; }),
  };
  const context: AdapterContext = {
    video: video as unknown as HTMLVideoElement, container: {} as HTMLElement,
    url: "https://fixture.invalid/manifest.m3u8?private=value", licenseKey: "private-license",
    profile: "default", signal: abort.signal,
    mark: (name) => { marks.push(name); }, fatal: (code, sdkCode) => { failures.push([code, sdkCode]); },
  };
  return { context, video, play, abort, marks, failures };
}
function emit(name: string, detail?: unknown) {
  const event = new Event(name); if (detail !== undefined) Object.defineProperty(event, "detail", { value: detail });
  for (const listener of sdk.state.events.get(name) ?? []) listener(event);
}
async function attach() { sdk.state.attach.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

beforeEach(() => {
  Object.assign(sdk.state, { supported: true, configurationAccepted: true, configurationThrows: false,
    constructorThrows: false, destroyThrows: false, loadEmitsCritical: false, attachHasSource: true, mode: 2, media: null, configuration: {}, destroys: 0,
    attach: sdk.pending(), load: sdk.pending(), stats: { loadLatency: 0.25, timeToFirstFrame: 0.3, estimatedBandwidth: 125000 },
    tracks: [{ active: true, language: "en", audioLanguage: "en" }] });
  sdk.state.order.length = 0; sdk.state.events.clear(); vi.stubGlobal("MediaSource", sdk.Source);
  vi.stubGlobal("ManagedMediaSource", undefined);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("Shaka HLS startup adapter", () => {
  it("awaits attach but requests play without awaiting load, and observes both completions", async () => {
    const f = fixture(); const session = await createAdapter(f.context); const started = session.start();
    expect(sdk.state.order).toEqual(["polyfills", "construct:0", "configure", "attach"]);
    expect(f.marks).toEqual(["constructorStart", "constructorEnd", "attachStart"]);
    await attach(); expect(sdk.state.order).toEqual(["polyfills", "construct:0", "configure", "attach", "load", "play"]);
    expect(f.marks).toContain("playRequest"); expect(f.marks).not.toContain("loadComplete");
    let settled = false; void started.then(() => { settled = true; });
    f.play.resolve(); await Promise.resolve(); await Promise.resolve(); expect(settled).toBe(false);
    expect(f.marks).toContain("playResolved");
    emit("loaded"); emit("loaded"); expect(f.marks.filter((mark) => mark === "sdkReady")).toHaveLength(1);
    expect(session.metadata.readyEvent).toBe("loaded"); expect(session.metadata.playingEvent).toBeNull();
    expect(f.marks).not.toContain("sdkPlaying"); emit("started"); expect(f.marks).not.toContain("sdkPlaying");
    sdk.state.load.resolve(); await started; expect(f.marks).toContain("loadComplete"); await session.dispose();
  });
  it("keeps a resolved load separate from a pending play request", async () => {
    const f = fixture(); const session = await createAdapter(f.context); const started = session.start(); await attach();
    sdk.state.load.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(f.marks).toContain("loadComplete"); expect(f.marks).not.toContain("playResolved");
    f.play.resolve(); await started; await session.dispose();
  });
  it("applies common constraints without optional collection or exposing keys and URLs", async () => {
    const f = fixture(); const session = await createAdapter(f.context); const started = session.start(); await attach();
    f.play.resolve(); sdk.state.load.resolve(); await started;
    expect(f.video).toMatchObject({ muted: true, defaultMuted: true, autoplay: false, playsInline: true,
      playbackRate: 1, defaultPlaybackRate: 1, currentTime: 0 });
    expect(sdk.state.configuration).toMatchObject({ preferredAudio: [{ language: "en" }],
      streaming: { preferNativeHls: false, fallbackToNativeHlsOnMseError: false,
        useNativeHlsForFairPlay: false, lowLatencyMode: false }, cmcd: { enabled: false }, cmsd: { enabled: false } });
    const metadata = JSON.stringify(session.metadata); expect(metadata).not.toContain("private"); expect(metadata).not.toContain("https://");
    await session.dispose();
  });
  it.each([0, 1, 2] as const)("uses the bounded prefetch=%s candidate and startup retention", async (prefetch) => {
    const session = await createAdapter({ ...fixture().context, profile: "startup", tuning: { shakaPrefetchLimit: prefetch } });
    expect(sdk.state.configuration.streaming).toMatchObject({ bufferingGoal: 12, bufferBehind: 6,
      rebufferingGoal: 0, segmentPrefetchLimit: prefetch }); await session.dispose();
  });
  it.each([false, true])("rejects partial configuration application (throws=%s) and cleans before attach", async (throws) => {
    const f = fixture(); sdk.state.configurationAccepted = false; sdk.state.configurationThrows = throws;
    await expect(createAdapter(f.context)).rejects.not.toThrow(/private/);
    expect(f.failures).toEqual([["configuration-rejected", undefined]]); expect(sdk.state.destroys).toBe(1);
    expect(sdk.state.order).not.toContain("attach"); expect(sdk.state.order).not.toContain("play");
  });
  it("rejects missing MSE or unsupported browsers without creating a Player", async () => {
    const f = fixture(); vi.stubGlobal("MediaSource", undefined);
    await expect(createAdapter(f.context)).rejects.toThrow(); expect(sdk.state.order).not.toContain("construct:0");
    vi.stubGlobal("MediaSource", sdk.Source); sdk.state.supported = false;
    await expect(createAdapter(fixture().context)).rejects.toThrow(); expect(sdk.state.order).not.toContain("construct:0");
  });
  it("does not initialize an aborted or reused media element", async () => {
    const f = fixture(); f.abort.abort(); await expect(createAdapter(f.context)).rejects.toMatchObject({ name: "AbortError" });
    expect(sdk.state.order).toEqual([]);
    const reused = fixture(); reused.video.currentSrc = "https://fixture.invalid/old.m3u8";
    await expect(createAdapter(reused.context)).rejects.toThrow(); expect(sdk.state.order).not.toContain("construct:0");
  });
  it("requires the actual MSE load mode and refuses native fallback", async () => {
    const f = fixture(); const session = await createAdapter(f.context); const started = session.start(); await attach();
    sdk.state.mode = 3; emit("streaming");
    await expect(started).rejects.toThrow(); expect(f.failures).toEqual([["unsupported", undefined]]);
    expect(sdk.state.destroys).toBe(1); await session.dispose();
  });
  it("also validates load mode at promise resolution when no event was delivered", async () => {
    const f = fixture(); const session = await createAdapter(f.context); const started = session.start(); await attach();
    sdk.state.mode = 3; sdk.state.load.resolve(); f.play.resolve();
    await expect(started).rejects.toThrow(); expect(f.failures[0]?.[0]).toBe("unsupported"); await session.dispose();
  });
  it("reports only critical SDK errors and only their finite numeric code", async () => {
    const f = fixture(); const session = await createAdapter(f.context); const started = session.start(); await attach();
    emit("error", { severity: 1, code: 1001, data: ["private"] }); emit("error", { message: "unknown severity" });
    expect(f.failures).toEqual([]);
    emit("error", { severity: 2, code: 7001, data: ["private token or URL"] });
    await expect(started).rejects.not.toThrow(/private/); expect(f.failures).toEqual([["sdk-error", 7001]]);
    await session.dispose();
  });
  it.each(["attach", "load", "play"] as const)("destroys partial initialization after %s rejection", async (stage) => {
    const f = fixture(); const session = await createAdapter(f.context); const started = session.start();
    if (stage === "attach") sdk.state.attach.reject(new Error("private attach"));
    else { await attach(); if (stage === "load") sdk.state.load.reject(new Error("private source URL")); else f.play.reject(new Error("private play")); }
    await expect(started).rejects.not.toThrow(/private/);
    expect(f.failures[0]?.[0]).toBe(stage === "attach" ? "initialization-failed" : stage === "load" ? "load-failed" : "play-rejected");
    expect(sdk.state.destroys).toBe(1); await session.dispose(); expect(sdk.state.destroys).toBe(1);
  });
  it.each(["attach", "load"] as const)("settles cancellation during %s and suppresses late work", async (stage) => {
    const f = fixture(); const session = await createAdapter(f.context); const started = session.start();
    if (stage === "load") await attach();
    const queued = [...(sdk.state.events.get("loaded") ?? [])][0];
    f.abort.abort(); await expect(started).rejects.toMatchObject({ name: "AbortError" });
    const before = [...f.marks]; sdk.state.attach.resolve(); sdk.state.load.resolve(); f.play.resolve(); queued?.(new Event("loaded"));
    await Promise.resolve(); await Promise.resolve(); expect(f.marks).toEqual(before); expect(f.failures).toEqual([]);
    if (stage === "attach") expect(f.video.play).not.toHaveBeenCalled();
    expect([...sdk.state.events.values()].every((listeners) => listeners.size === 0)).toBe(true);
    await session.dispose(); expect(sdk.state.destroys).toBe(1);
  });
  it("keeps original stats units and zero while unknown values remain null", async () => {
    const f = fixture(); const session = await createAdapter(f.context); const started = session.start(); await attach();
    f.play.resolve(); sdk.state.load.resolve(); await started;
    expect(session.sample()).toMatchObject({ mediaEngine: "media-source", audioLanguage: "en", workerActive: null,
      loadLatencySeconds: 0.25, timeToFirstFrameSeconds: 0.3, bandwidthEstimateBps: 125000 });
    sdk.state.stats = { loadLatency: 0, timeToFirstFrame: NaN, estimatedBandwidth: Infinity };
    sdk.state.tracks = [{ active: true, language: "private.invalid", audioLanguage: "https://private.invalid/" }];
    expect(session.sample()).toMatchObject({ loadLatencySeconds: 0, timeToFirstFrameSeconds: null,
      bandwidthEstimateBps: null, audioLanguage: null });
    await session.dispose(); expect(session.sample().loadLatencySeconds).toBeNull();
  });
  it("starts once and refuses initialization after disposal", async () => {
    const f = fixture(); const session = await createAdapter(f.context); const started = session.start();
    expect(session.start()).toBe(started); await attach(); sdk.state.load.resolve(); f.play.resolve(); await started;
    expect(f.video.play).toHaveBeenCalledTimes(1); await session.dispose();
    const next = await createAdapter(fixture().context); await next.dispose();
    await expect(next.start()).rejects.toMatchObject({ name: "AbortError" });
  });
  it("does not issue play after a synchronous fatal load event", async () => {
    const f = fixture(); sdk.state.loadEmitsCritical = true;
    const session = await createAdapter(f.context); const started = session.start(); await attach();
    await expect(started).rejects.toThrow(); expect(f.video.play).not.toHaveBeenCalled();
    sdk.state.load.resolve(); await Promise.resolve(); await session.dispose();
    expect(f.failures).toEqual([["sdk-error", 7001]]);
  });
  it("refuses an attach without a selected MSE source before load or play", async () => {
    const f = fixture(); sdk.state.attachHasSource = false;
    const session = await createAdapter(f.context); const started = session.start(); await attach();
    await expect(started).rejects.toThrow(); expect(sdk.state.order).not.toContain("load");
    expect(f.video.play).not.toHaveBeenCalled(); expect(f.failures).toEqual([["unsupported", undefined]]);
    await session.dispose();
  });
  it("reports only the MSE family when the public API cannot identify its subtype", async () => {
    vi.stubGlobal("ManagedMediaSource", class {});
    const f = fixture(); const session = await createAdapter(f.context); const started = session.start(); await attach();
    sdk.state.load.resolve(); f.play.resolve(); await started;
    expect(session.sample().mediaEngine).toBe("media-source-family");
    expect(session.metadata.sampleLimitations.mediaEngine).toContain("not publicly observable");
    await session.dispose();
  });
  it("rejects an out-of-range candidate even when an untyped caller bypasses the contract", async () => {
    const f = fixture(); const tuning = { shakaPrefetchLimit: 0 as const }; Reflect.set(tuning, "shakaPrefetchLimit", 3);
    await expect(createAdapter({ ...f.context, tuning })).rejects.toThrow();
    expect(f.failures).toEqual([["configuration-rejected", undefined]]); expect(sdk.state.order).not.toContain("construct:0");
  });
  it("omits non-finite SDK error codes", async () => {
    const f = fixture(); const session = await createAdapter(f.context); const started = session.start(); await attach();
    emit("error", { severity: 2, code: Infinity, data: ["private header"] });
    await expect(started).rejects.toThrow(); expect(f.failures).toEqual([["sdk-error", undefined]]); await session.dispose();
  });
  it("keeps exported settings isolated from later SDK mutation", async () => {
    const session = await createAdapter(fixture().context);
    Reflect.set(sdk.state.configuration, "runtimeHeaders", { Authorization: "private runtime token" });
    const audio = sdk.state.configuration.preferredAudio;
    if (Array.isArray(audio)) Reflect.set(audio, 0, { language: "private runtime URL" });
    expect(JSON.stringify(session.metadata.configuration)).not.toContain("private");
    expect(session.metadata.configuration.preferredAudio).toMatchObject([{ language: "en" }]);
    await session.dispose();
  });
  it("does not hide a rejected destroy promise", async () => {
    const session = await createAdapter(fixture().context); sdk.state.destroyThrows = true;
    await expect(session.dispose()).rejects.not.toThrow(/private/);
    await expect(session.dispose()).rejects.toThrow(); expect(sdk.state.destroys).toBe(1);
  });
});
