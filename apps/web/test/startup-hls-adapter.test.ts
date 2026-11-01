import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterContext, AdapterMark, FailureCode } from "../src/startup/contract";

const sdk = vi.hoisted(() => {
  const state = {
    supported: true, version: "1.7.4", constructorThrows: false,
    attachThrows: false, loadThrows: false, destroyThrows: false,
    configuration: {} as Record<string, unknown>, order: [] as string[],
    events: new Map<string, Set<(event: string, data: unknown) => void>>(),
    destroys: 0, bandwidth: 125000, language: "en",
  };
  class Source {}
  class ManagedSource extends Source {}
  class Player {
    static get version() { return state.version; }
    static isSupported() { return state.supported; }
    static Events = { MEDIA_ATTACHED: "hlsMediaAttached", MANIFEST_PARSED: "hlsManifestParsed", ERROR: "hlsError" };
    constructor(configuration: Record<string, unknown>) {
      state.order.push("construct"); state.configuration = configuration;
      if (state.constructorThrows) throw new Error("private constructor payload");
    }
    on(event: string, listener: (event: string, data: unknown) => void) {
      const listeners = state.events.get(event) ?? new Set();
      listeners.add(listener); state.events.set(event, listeners);
    }
    off(event: string, listener: (event: string, data: unknown) => void) { state.events.get(event)?.delete(listener); }
    attachMedia(video: { setAttribute(name: string, value: string): void }) {
      state.order.push("attach");
      if (state.attachThrows) throw new Error("private attach payload");
      video.setAttribute("src", "blob:owned-hls-source");
    }
    loadSource() { state.order.push("load"); if (state.loadThrows) throw new Error("private URL payload"); }
    destroy() { state.destroys += 1; if (state.destroyThrows) throw new Error("private destroy payload"); }
    get bandwidthEstimate() { return state.bandwidth; }
    get audioTracks() { return [{ lang: state.language }]; }
    get audioTrack() { return 0; }
  }
  return { state, Source, ManagedSource, Player };
});
vi.mock("hls.js", () => ({ default: sdk.Player }));
vi.mock("hls.js/dist/hls.worker.js?url", () => ({ default: "/same-version-hls-worker.js" }));
import { createAdapter } from "../src/startup/adapters/hls";

function deferred() {
  let resolve!: () => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const play = deferred(); const abort = new AbortController();
  const marks: AdapterMark[] = []; const failures: [FailureCode, number | undefined][] = [];
  const attributes = new Map<string, string>();
  const video = {
    muted: false, defaultMuted: false, autoplay: true, playsInline: false,
    playbackRate: 2, defaultPlaybackRate: 2, currentTime: 20,
    currentSrc: "", srcObject: null, mediaKeys: null, paused: true,
    hasAttribute: (name: string) => attributes.has(name),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
    querySelector: () => null,
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
function emit(event: string, data: unknown = {}) { for (const listener of sdk.state.events.get(event) ?? []) listener(event, data); }

beforeEach(() => {
  Object.assign(sdk.state, { supported: true, version: "1.7.4", constructorThrows: false,
    attachThrows: false, loadThrows: false, destroyThrows: false, configuration: {},
    destroys: 0, bandwidth: 125000, language: "en" });
  sdk.state.order.length = 0; sdk.state.events.clear();
  vi.stubGlobal("MediaSource", sdk.Source); vi.stubGlobal("ManagedMediaSource", undefined);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("hls.js startup adapter", () => {
  it("requests native play immediately after attach and source load, before SDK readiness", async () => {
    const f = fixture(); const session = await createAdapter(f.context);
    const started = session.start();
    expect(sdk.state.order).toEqual(["construct", "attach", "load", "play"]);
    expect(f.marks).toEqual(["constructorStart", "constructorEnd", "attachStart", "attachComplete", "loadStart", "playRequest"]);
    expect(session.metadata.loadCompletion).toBe("unavailable");
    expect(session.metadata.readyEvent).toBe("hlsManifestParsed");
    expect(session.metadata.playingEvent).toBeNull();
    emit("hlsManifestParsed"); emit("hlsManifestParsed");
    expect(f.marks.filter((mark) => mark === "sdkReady")).toHaveLength(1);
    expect(f.marks).not.toContain("loadComplete"); expect(f.marks).not.toContain("sdkPlaying");
    f.play.resolve(); await started;
    expect(f.marks[f.marks.length - 1]).toBe("playResolved"); await session.dispose();
  });
  it("sets common playback conditions and the same-version external worker without exporting secrets", async () => {
    const f = fixture(); const session = await createAdapter(f.context);
    const started = session.start(); f.play.resolve(); await started;
    expect(f.video).toMatchObject({ muted: true, defaultMuted: true, autoplay: false, playsInline: true,
      playbackRate: 1, defaultPlaybackRate: 1, currentTime: 0 });
    expect(sdk.state.configuration).toMatchObject({ autoStartLoad: true, startPosition: 0,
      audioPreference: { lang: "en" }, enableWorker: true, workerPath: "/same-version-hls-worker.js",
      preferManagedMediaSource: false, debug: false, lowLatencyMode: false, enableInterstitialPlayback: false });
    expect(session.sample().workerActive).toBeNull();
    const metadata = JSON.stringify(session.metadata);
    expect(metadata).not.toContain("private"); expect(metadata).not.toContain("https://");
    expect(metadata).not.toContain("/same-version-hls-worker.js"); await session.dispose();
  });
  it("keeps default retention distinct from the bounded startup and worker candidates", async () => {
    const f = fixture(); const defaults = await createAdapter(f.context);
    expect(sdk.state.configuration).not.toHaveProperty("maxBufferLength"); await defaults.dispose();
    const candidate = await createAdapter({ ...f.context, profile: "startup", tuning: { hlsWorker: false } });
    expect(sdk.state.configuration).toMatchObject({ maxBufferLength: 12, maxMaxBufferLength: 12,
      backBufferLength: 6, frontBufferFlushThreshold: 12, enableWorker: false }); await candidate.dispose();
  });
  it.each([false, true])("observes the attached MediaSource instance (managed=%s)", async (managed) => {
    const f = fixture(); if (managed) vi.stubGlobal("ManagedMediaSource", sdk.ManagedSource);
    const session = await createAdapter(f.context); const started = session.start();
    expect(session.sample().mediaEngine).toBe("unknown");
    emit("hlsMediaAttached", { media: f.context.video, mediaSource: managed ? new sdk.ManagedSource() : new sdk.Source() });
    expect(session.sample().mediaEngine).toBe(managed ? "managed-media-source" : "media-source");
    f.play.resolve(); await started; await session.dispose();
  });
  it("rejects an attached route without an observed MediaSource and destroys it", async () => {
    const f = fixture(); const session = await createAdapter(f.context); const started = session.start();
    emit("hlsMediaAttached", { media: f.context.video });
    await expect(started).rejects.toThrow(); expect(f.failures).toEqual([["unsupported", undefined]]);
    expect(sdk.state.destroys).toBe(1); await session.dispose();
  });
  it("does not initialize on an unsupported browser or an already aborted trial", async () => {
    const f = fixture(); sdk.state.supported = false;
    await expect(createAdapter(f.context)).rejects.toThrow(); expect(sdk.state.order).toEqual([]);
    expect(f.failures).toEqual([["unsupported", undefined]]);
    sdk.state.supported = true; f.abort.abort();
    await expect(createAdapter(f.context)).rejects.toMatchObject({ name: "AbortError" });
    expect(sdk.state.order).toEqual([]);
  });
  it("refuses a reused media element before creating another SDK instance", async () => {
    const f = fixture(); f.video.currentSrc = "https://fixture.invalid/old.m3u8";
    await expect(createAdapter(f.context)).rejects.toThrow(); expect(sdk.state.order).toEqual([]);
    expect(f.failures).toEqual([["unsupported", undefined]]);
  });
  it("reports only fatal SDK errors, once, without forwarding error payloads", async () => {
    const f = fixture(); const session = await createAdapter(f.context); const started = session.start();
    emit("hlsError", { fatal: false, details: "private URL" }); expect(f.failures).toEqual([]);
    emit("hlsError", { fatal: true, details: "private URL", response: { code: 403 } });
    emit("hlsError", { fatal: true }); await expect(started).rejects.toThrow();
    expect(f.failures).toEqual([["sdk-error", undefined]]); expect(sdk.state.destroys).toBe(1);
    await session.dispose();
  });
  it.each(["attach", "load", "play"] as const)("cleans partial initialization after a %s failure", async (stage) => {
    const f = fixture(); sdk.state.attachThrows = stage === "attach"; sdk.state.loadThrows = stage === "load";
    const session = await createAdapter(f.context); const started = session.start();
    if (stage === "play") f.play.reject(new Error("private license or URL"));
    await expect(started).rejects.not.toThrow(/private/);
    expect(f.failures[0]?.[0]).toBe(stage === "attach" ? "initialization-failed" : stage === "load" ? "load-failed" : "play-rejected");
    expect(sdk.state.destroys).toBe(1); await session.dispose(); expect(sdk.state.destroys).toBe(1);
  });
  it("settles an aborted pending play and suppresses queued SDK and promise callbacks", async () => {
    const f = fixture(); const session = await createAdapter(f.context); const started = session.start();
    const queuedReady = [...(sdk.state.events.get("hlsManifestParsed") ?? [])][0];
    f.abort.abort(); await expect(started).rejects.toMatchObject({ name: "AbortError" });
    const before = [...f.marks]; queuedReady?.("hlsManifestParsed", {}); f.play.resolve();
    await Promise.resolve(); expect(f.marks).toEqual(before); expect(f.failures).toEqual([]);
    expect([...sdk.state.events.values()].every((listeners) => listeners.size === 0)).toBe(true);
    await session.dispose(); expect(sdk.state.destroys).toBe(1);
  });
  it("starts once and refuses to start after disposal", async () => {
    const f = fixture(); const session = await createAdapter(f.context);
    const first = session.start(); expect(session.start()).toBe(first); f.play.resolve(); await first;
    expect(f.video.play).toHaveBeenCalledTimes(1); await session.dispose();
    const second = await createAdapter(fixture().context); await second.dispose();
    await expect(second.start()).rejects.toMatchObject({ name: "AbortError" });
  });
  it("keeps finite provider units and zero, and returns null for unknown or unsafe samples", async () => {
    const f = fixture(); const session = await createAdapter(f.context);
    sdk.state.bandwidth = 0; expect(session.sample()).toMatchObject({ bandwidthEstimateBps: 0,
      audioLanguage: "en", loadLatencySeconds: null, timeToFirstFrameSeconds: null, workerActive: null });
    sdk.state.bandwidth = Infinity; sdk.state.language = "https://private.invalid/token";
    expect(session.sample()).toMatchObject({ bandwidthEstimateBps: null, audioLanguage: null });
    await session.dispose(); expect(session.sample().bandwidthEstimateBps).toBeNull();
  });
  it("keeps exported settings isolated from later SDK mutation", async () => {
    const session = await createAdapter(fixture().context);
    const audio = sdk.state.configuration.audioPreference;
    if (audio && typeof audio === "object") Reflect.set(audio, "lang", "private runtime URL");
    Reflect.set(sdk.state.configuration, "runtimeHeaders", { Authorization: "private runtime token" });
    expect(JSON.stringify(session.metadata.configuration)).not.toContain("private");
    expect(session.metadata.configuration.audioPreference).toEqual({ lang: "en" });
    await session.dispose();
  });
  it("rejects a malformed worker candidate from an untyped caller", async () => {
    const f = fixture(); const tuning = { hlsWorker: true }; Reflect.set(tuning, "hlsWorker", "private value");
    await expect(createAdapter({ ...f.context, tuning })).rejects.toThrow();
    expect(f.failures).toEqual([["configuration-rejected", undefined]]); expect(sdk.state.order).toEqual([]);
  });
  it("sanitizes a constructor failure without claiming an owned instance was destroyed", async () => {
    const f = fixture(); sdk.state.constructorThrows = true;
    await expect(createAdapter(f.context)).rejects.not.toThrow(/private/);
    expect(f.failures).toEqual([["initialization-failed", undefined]]); expect(sdk.state.destroys).toBe(0);
  });
  it("propagates a sanitized cleanup failure instead of claiming successful disposal", async () => {
    const session = await createAdapter(fixture().context); sdk.state.destroyThrows = true;
    await expect(session.dispose()).rejects.not.toThrow(/private/);
    await expect(session.dispose()).rejects.toThrow(); expect(sdk.state.destroys).toBe(1);
  });
});
