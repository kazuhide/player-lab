import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterContext, AdapterSession } from "../src/startup/contract";
import { bitmovin8Module, makeBitmovin8Adapter, type Bitmovin8Constructor } from "../src/startup/adapters/bitmovin8-shared";

const registration = vi.hoisted(() => ({ modules: undefined as Record<string, boolean> | undefined, order: [] as string[] }));
vi.mock("bitmovin-player/modules/bitmovinplayer-core", () => ({
  PlayerEvent: { Ready: "ready", Playing: "playing", Error: "error" },
  PlayerType: { Html5: "html5" }, LogLevel: { OFF: "off" },
  StreamType: { Hls: "hls", Dash: "dash" },
  ModuleName: { EngineBitmovin: "EngineBitmovin", RendererMse: "RendererMSE", HLS: "HLS", DASH: "DASH",
    XML: "XML", ABR: "ABR", ContainerMP4: "ContainerMP4", ContainerTS: "ContainerTS" },
  Player: {
    addModule(module: { name: string; module: unknown }) {
      if (!module.name || !module.module) throw new Error("MODULE_INVALID_DEFINITION: missing name or module");
      registration.modules ??= {}; registration.modules[module.name] = true; registration.order.push(module.name);
    },
    // Public 8.283.0 getModuleNames uses Object.getOwnPropertyNames on a registry
    // initialized by the first addModule; querying it before that throws.
    getModules: () => Object.getOwnPropertyNames(registration.modules as Record<string, boolean>),
  },
}));
// Production Vite's CommonJS interop supplies a namespace whose default is the definition.
vi.mock("bitmovin-player/modules/bitmovinplayer-engine-bitmovin", () => ({ default: { default: { name: "EngineBitmovin", module: {} } } }));
vi.mock("bitmovin-player/modules/bitmovinplayer-mserenderer", () => ({ default: { default: { name: "RendererMSE", module: {} } } }));
vi.mock("bitmovin-player/modules/bitmovinplayer-hls", () => ({ default: { default: { name: "HLS", module: {} } } }));
vi.mock("bitmovin-player/modules/bitmovinplayer-dash", () => ({ default: { default: { name: "DASH", module: {} } } }));
vi.mock("bitmovin-player/modules/bitmovinplayer-xml", () => ({ default: { default: { name: "XML", module: {} } } }));
vi.mock("bitmovin-player/modules/bitmovinplayer-abr", () => ({ default: { default: { name: "ABR", module: {} } } }));
vi.mock("bitmovin-player/modules/bitmovinplayer-container-mp4", () => ({ default: { default: { name: "ContainerMP4", module: {} } } }));
vi.mock("bitmovin-player/modules/bitmovinplayer-container-ts", () => ({ default: { default: { name: "ContainerTS", module: {} } } }));
function gate() {
  let resolve!: () => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const sessions: AdapterSession[] = [];
function fixture(profile: "startup" | "default" = "startup", format: "hls" | "dash" = "hls") {
  const load = gate(); const play = gate(); const order: string[] = [];
  const events = new Map<string, (event: unknown) => void>(); const controller = new AbortController();
  const video = { currentSrc: "", srcObject: null, mediaKeys: null, hasAttribute: () => false, querySelector: () => null,
    currentTime: 10, muted: false, defaultMuted: false, autoplay: true, playsInline: false, controls: true,
    playbackRate: 1, defaultPlaybackRate: 1 } as unknown as HTMLVideoElement;
  const player = {
    on: vi.fn((event: string, listener: (event: unknown) => void) => { events.set(event, listener); }),
    off: vi.fn((event: string) => { events.delete(event); }),
    load: vi.fn(() => { order.push("load"); return load.promise; }),
    play: vi.fn(() => { order.push("play"); return play.promise; }), pause: vi.fn(), seek: vi.fn(() => true),
    isLive: vi.fn(() => false), timeShift: vi.fn(), getTimeShift: vi.fn(() => -10), getMaxTimeShift: vi.fn(() => -60),
    setVideoElement: vi.fn(() => { order.push("attach"); }), getVideoElement: vi.fn(() => video),
    getPlayerType: vi.fn(() => "html5"), getAudio: vi.fn(() => ({ lang: "en" })),
    destroy: vi.fn(async () => { order.push("destroy"); }),
  };
  const construct = vi.fn(function (..._arguments: unknown[]) { order.push("construct"); return player; });
  const mark = vi.fn(); const fatal = vi.fn();
  const context: AdapterContext = { video, container: {} as HTMLElement, url: "https://media.invalid/private-manifest",
    licenseKey: "private-license", profile, signal: controller.signal, mark, fatal };
  const create = makeBitmovin8Adapter(construct as unknown as Bitmovin8Constructor, format);
  const session = async () => { const value = await create(context); sessions.push(value); return value; };
  return { context, controller, video, load, play, player, events, construct, order, mark, fatal, create, session };
}
async function drain() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
beforeEach(() => { vi.stubGlobal("MediaSource", class {}); vi.stubGlobal("ManagedMediaSource", undefined); });
afterEach(async () => { await Promise.all(sessions.splice(0).map((session) => session.dispose().catch(() => {}))); vi.unstubAllGlobals(); });

describe("Bitmovin v8 modular comparison adapter", () => {
  it("preserves every field and identity of direct or CommonJS-wrapped public module definitions", () => {
    const definition = { name: "EngineBitmovin", module: () => ({}), dependencies: ["Core"], hooks: { add: () => {} }, version: "8.283.0" };
    expect(bitmovin8Module(definition)).toBe(definition);
    expect(bitmovin8Module({ default: definition, MseModuleDefinition: definition })).toBe(definition);
  });
  it("rejects invalid module shapes rather than passing a namespace to the SDK", () => {
    for (const invalid of [null, {}, { name: "EngineBitmovin" }, { name: "", module: {} },
      { name: "EngineBitmovin", module: null }, { default: { default: { name: "EngineBitmovin", module: {} } } }]) {
      expect(() => bitmovin8Module(invalid)).toThrow("Invalid Bitmovin module definition");
    }
  });
  it.each(["hls", "dash"] as const)("registers %s modules before querying any uninitialized SDK registry", async (format) => {
    vi.resetModules(); registration.modules = undefined; registration.order.length = 0;
    const adapter = format === "hls" ? await import("../src/startup/adapters/bitmovin8") : await import("../src/startup/adapters/bitmovin8-dash");
    expect(adapter.createAdapter).toBeTypeOf("function");
    expect(registration.order).toEqual(format === "hls"
      ? ["EngineBitmovin", "RendererMSE", "HLS", "ABR", "ContainerMP4", "ContainerTS"]
      : ["EngineBitmovin", "RendererMSE", "XML", "DASH", "ABR", "ContainerMP4"]);
  });
  it("attaches the shared video before load and requests SDK play after genuine load completion", async () => {
    const f = fixture(); const session = await f.session(); const started = session.start();
    expect(f.order).toEqual(["construct", "attach", "load"]);
    expect(f.context.mark).toHaveBeenCalledWith("attachComplete");
    expect(f.context.mark).not.toHaveBeenCalledWith("loadComplete");
    f.load.resolve(); await drain();
    expect(f.order).toEqual(["construct", "attach", "load", "play"]);
    expect(f.context.mark).toHaveBeenCalledWith("loadComplete");
    expect(f.context.mark).not.toHaveBeenCalledWith("playResolved");
    f.play.resolve(); await started;
    expect(f.context.mark).toHaveBeenCalledWith("playResolved");
    expect(session.start()).toBe(started); expect(f.player.load).toHaveBeenCalledTimes(1);
  });
  it.each(["hls", "dash"] as const)("loads the real %s source through the explicitly selected MSE technology", async (format) => {
    const f = fixture("startup", format); const session = await f.session(); const started = session.start();
    expect(f.player.load).toHaveBeenCalledExactlyOnceWith({ [format]: f.context.url, options: { startOffset: 0 } }, `html5.${format}`);
    f.load.resolve(); f.play.resolve(); await started;
    expect(session.metadata.configuration.format).toBe(format);
    expect(session.metadata.configuration.modules).toEqual(format === "hls"
      ? ["Core", "EngineBitmovin", "RendererMSE", "HLS", "ABR", "ContainerMP4", "ContainerTS"]
      : ["Core", "EngineBitmovin", "RendererMSE", "XML", "DASH", "ABR", "ContainerMP4"]);
  });
  it("exports only explicit safe configuration and keeps common conditions separate from SDK defaults", async () => {
    const f = fixture(); const session = await f.session();
    expect(f.construct.mock.calls[0]?.[1]).toMatchObject({ playback: { muted: true, autoplay: false, audioLanguage: "en" },
      buffer: { audio: { forwardduration: 12, backwardduration: 6 }, video: { forwardduration: 12, backwardduration: 6 } },
      ui: false, analytics: false, storage: { disableStorageApi: true }, logs: { level: "off", bitmovin: false } });
    const exported = JSON.stringify(session.metadata);
    expect(exported).not.toContain("private-"); expect(exported).not.toContain("https://");
    expect(session.metadata).toMatchObject({ engine: "bitmovin-8", loadCompletion: "promise", readyEvent: "ready", playingEvent: "playing" });
  });
  it("leaves v8 buffer and logging defaults untouched in the default profile", async () => {
    const f = fixture("default"); const session = await f.session();
    expect(f.construct.mock.calls[0]?.[1]).not.toHaveProperty("buffer");
    expect(f.construct.mock.calls[0]?.[1]).not.toHaveProperty("logs");
    expect(session.metadata.configuration).not.toHaveProperty("buffer");
    expect(session.metadata.configuration).not.toHaveProperty("logs");
  });
  it("observes Ready and Playing separately, once, and suppresses all callbacks after disposal", async () => {
    const f = fixture(); const session = await f.session();
    const ready = f.events.get("ready")!; const playing = f.events.get("playing")!;
    ready({}); ready({}); playing({}); playing({});
    expect(f.mark.mock.calls.filter(([name]) => name === "sdkReady")).toHaveLength(1);
    expect(f.mark.mock.calls.filter(([name]) => name === "sdkPlaying")).toHaveLength(1);
    await session.dispose(); const marks = f.mark.mock.calls.length;
    ready({}); playing({}); expect(f.context.mark).toHaveBeenCalledTimes(marks);
    expect(f.player.destroy).toHaveBeenCalledTimes(1); expect(f.events.size).toBe(0);
  });
  it("cancels a pending load promptly and never plays after its late resolution", async () => {
    const f = fixture(); const session = await f.session(); const started = session.start();
    const rejected = expect(started).rejects.toMatchObject({ name: "AbortError" });
    f.controller.abort(); await rejected; f.load.resolve(); await drain();
    expect(f.player.play).not.toHaveBeenCalled(); await session.dispose();
    expect(f.player.destroy).toHaveBeenCalledTimes(1);
  });
  it("preserves a numeric load failure without retaining provider messages or allowing a play request", async () => {
    const f = fixture(); const session = await f.session(); const started = session.start();
    const rejected = expect(started).rejects.toThrow("load-failed");
    f.load.reject({ code: 1208, message: "private-license private-url" }); await rejected;
    expect(f.context.fatal).toHaveBeenCalledWith("load-failed", 1208);
    expect(f.player.play).not.toHaveBeenCalled(); expect(f.player.destroy).toHaveBeenCalledTimes(1);
  });
  it("preserves SDK error codes and cancels a pending play", async () => {
    const f = fixture(); const session = await f.session(); const started = session.start();
    const rejected = expect(started).rejects.toThrow("sdk-error");
    f.load.resolve(); await drain(); f.events.get("error")?.({ code: 2003, message: "private" }); await rejected;
    expect(f.context.fatal).toHaveBeenCalledWith("sdk-error", 2003); f.play.resolve(); await drain();
    expect(f.context.mark).not.toHaveBeenCalledWith("playResolved");
  });
  it("rejects native fallback or a substituted media element instead of attributing it to MSE", async () => {
    for (const altered of ["native", "video"] as const) {
      const f = fixture(); const session = await f.session();
      if (altered === "native") f.player.getPlayerType.mockReturnValue("native");
      else f.player.getVideoElement.mockReturnValue({} as HTMLVideoElement);
      const started = session.start(); const rejected = expect(started).rejects.toThrow("unsupported");
      f.load.resolve(); await rejected;
      expect(f.context.fatal).toHaveBeenCalledWith("unsupported", undefined); expect(f.player.play).not.toHaveBeenCalled();
    }
  });
  it("keeps SDK controls usable after startup and maps a live target through the observed media-time delta", async () => {
    const f = fixture(); const session = await f.session(); f.load.resolve(); f.play.resolve(); await session.start();
    session.playback!.seek(40); expect(f.player.seek).toHaveBeenCalledWith(40);
    session.playback!.pause(); await session.playback!.play(); expect(f.player.pause).toHaveBeenCalledOnce();
    f.player.isLive.mockReturnValue(true); f.video.currentTime = 100;
    session.playback!.seek(95); expect(f.player.timeShift).toHaveBeenCalledWith(-15);
    expect(() => session.playback!.seek(120)).toThrow("Invalid playback target");
    f.player.getMaxTimeShift.mockReturnValue(NaN);
    expect(() => session.playback!.seek(95)).toThrow("Invalid playback target");
    expect(f.player.timeShift).toHaveBeenCalledTimes(1);
  });
  it("retains cleanup failure while still destroying the player after listener removal fails", async () => {
    const f = fixture(); const session = await f.session(); f.player.off.mockImplementationOnce(() => { throw new Error("private"); });
    const first = session.dispose(); expect(session.dispose()).toBe(first);
    await expect(first).rejects.toThrow("cleanup failed"); expect(f.player.destroy).toHaveBeenCalledTimes(1);
  });
  it("keeps missing provider statistics null and sanitizes selected audio language", async () => {
    const f = fixture(); const session = await f.session(); f.load.resolve(); f.play.resolve(); await session.start();
    expect(session.sample()).toEqual({ mediaEngine: "media-source", audioLanguage: "en", workerActive: null,
      loadLatencySeconds: null, timeToFirstFrameSeconds: null, bandwidthEstimateBps: null });
    f.player.getAudio.mockReturnValue({ lang: "private-secret-too-long-and-not-a-language" });
    expect(session.sample().audioLanguage).toBeNull();
  });
  it("rejects a used element, unavailable MSE, invalid profile and pre-aborted creation before constructing", async () => {
    for (const bad of ["video", "mse", "profile", "abort"] as const) {
      const f = fixture();
      if (bad === "video") Object.defineProperty(f.video, "currentSrc", { value: "blob:used" });
      if (bad === "mse") vi.stubGlobal("MediaSource", undefined);
      if (bad === "profile") Object.defineProperty(f.context, "profile", { value: "invalid" });
      if (bad === "abort") f.controller.abort();
      await expect(f.create(f.context)).rejects.toThrow(); expect(f.construct).not.toHaveBeenCalled();
      vi.stubGlobal("MediaSource", class {});
    }
  });
});
