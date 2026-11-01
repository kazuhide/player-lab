import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdapter } from "../src/startup/adapters/webx";
import type { AdapterContext, ProviderSample, StartupProfile, StartupTuning } from "../src/startup/contract";

const sdk = vi.hoisted(() => ({ player: undefined as unknown, construct: vi.fn<(config: unknown) => void>() }));

vi.mock("@bitmovin/player-web-x/bundles/playerx-hls", () => ({
  Player: (config: unknown) => {
    sdk.construct(config);
    return sdk.player;
  },
}));

type TestEvent = Record<string, unknown>;
type Listener = (event: TestEvent) => void;

function eventBus(Type: Record<string, string>) {
  const handlers = new Map<string, Set<Listener>>();
  return {
    Type,
    on: vi.fn((type: string, listener: Listener) => {
      const listeners = handlers.get(type) ?? new Set<Listener>();
      listeners.add(listener);
      handlers.set(type, listeners);
    }),
    off: vi.fn((type: string, listener: Listener) => { handlers.get(type)?.delete(listener); }),
    emit(type: string, event: TestEvent = {}) {
      for (const listener of handlers.get(type) ?? []) listener(event);
    },
    listeners: (type: string) => [...(handlers.get(type) ?? [])],
    count: () => [...handlers.values()].reduce((sum, listeners) => sum + listeners.size, 0),
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

// These are provider/element doubles. No browser, media decoder or SDK is executed.
function fixture(profile: StartupProfile = "default", tuning?: StartupTuning) {
  const playback = deferred();
  const sourceEvents = eventBus({ Ready: "ready", Playing: "playing" });
  const source = {
    id: "test-source",
    events: sourceEvents,
    play: vi.fn(() => playback.promise),
    loadControl: 0,
    currentTime: 4,
    playbackRate: 2,
  };
  const playerEvents = eventBus({ VideoAttached: "video-attached", PlayerError: "player-error", SourceError: "source-error" });
  const player = {
    events: playerEvents,
    sources: { add: vi.fn(() => source), attachVideo: vi.fn<(source: unknown, options: unknown) => void>() },
    dispose: vi.fn<() => Promise<void>>(async () => {}),
  };
  const controller = new AbortController();
  const context = {
    video: { playsInline: false, controls: true, muted: false, defaultMuted: false, playbackRate: 2 } as unknown as HTMLVideoElement,
    container: {} as HTMLElement,
    url: "https://example.invalid/stream.m3u8?access_token=fake-token",
    licenseKey: "fake-player-license",
    profile,
    ...(tuning === undefined ? {} : { tuning }),
    signal: controller.signal,
    mark: vi.fn<AdapterContext["mark"]>(),
    fatal: vi.fn<AdapterContext["fatal"]>(),
  } satisfies AdapterContext;
  sdk.player = player;
  return { source, player, sourceEvents, playerEvents, context, controller, playback };
}

beforeEach(() => {
  vi.clearAllMocks();
  sdk.construct.mockReset();
});

describe("native Web X startup adapter", () => {
  it("uses the provided elements and stages a native source without attaching or requesting play", async () => {
    const f = fixture();
    const session = await createAdapter(f.context);

    expect(sdk.construct).toHaveBeenCalledWith(expect.objectContaining({
      key: f.context.licenseKey,
      defaultVideoElement: f.context.video,
      defaultContainer: f.context.container,
      playback: { muted: true, autoplay: false, preventSeeking: false },
    }));
    expect(sdk.construct.mock.calls[0]?.[0]).not.toHaveProperty("defaultLogLevel");
    expect(f.player.sources.add).toHaveBeenCalledWith({
      resources: [{ url: f.context.url, type: "hls" }], contentType: "content",
    }, { attach: false, loadControl: 0 });
    expect(f.context.mark.mock.calls.map(([name]) => name)).toEqual(["constructorStart", "constructorEnd"]);
    expect(f.source.currentTime).toBe(0);
    expect(f.source.playbackRate).toBe(1);
    expect(f.context.video).toMatchObject({ muted: true, defaultMuted: true, playsInline: true, controls: false, playbackRate: 1 });
    expect(f.player.sources.attachVideo).not.toHaveBeenCalled();
    expect(f.source.play).not.toHaveBeenCalled();
    await session.dispose();
  });

  it("exports no credentials or URL and retains reasons for every unknown provider observation", async () => {
    const f = fixture();
    const session = await createAdapter(f.context);
    expect(session.metadata.loadCompletion).toBe("unavailable");
    expect(session.metadata.unavailable.loadComplete).toBeTruthy();
    expect(session.sample()).toEqual({
      mediaEngine: "unknown", audioLanguage: null, workerActive: null,
      loadLatencySeconds: null, timeToFirstFrameSeconds: null, bandwidthEstimateBps: null,
    });
    for (const field of Object.keys(session.sample()) as Array<keyof ProviderSample>) {
      expect(session.metadata.sampleLimitations[field]).toBeTruthy();
    }
    const exported = JSON.stringify([session.metadata, session.sample()]);
    for (const excluded of [f.context.licenseKey, f.context.url, "fake-token"]) expect(exported).not.toContain(excluded);
    await session.dispose();
  });

  it("requests play without waiting for Ready and maps genuine owned events separately from promise settlement", async () => {
    const f = fixture();
    const session = await createAdapter(f.context);
    const start = session.start();
    expect(f.player.sources.attachVideo).toHaveBeenCalledWith(f.source, { video: f.context.video, container: f.context.container });
    expect(f.source.loadControl).toBe(2);
    expect(f.source.play).toHaveBeenCalledTimes(1);
    expect(f.context.mark.mock.calls.map(([name]) => name)).toEqual([
      "constructorStart", "constructorEnd", "attachStart", "loadStart", "playRequest",
    ]);

    f.playerEvents.emit("video-attached", { sourceId: "other-source", videoElement: f.context.video });
    f.playerEvents.emit("video-attached", { sourceId: f.source.id, videoElement: {} });
    expect(f.context.mark).not.toHaveBeenCalledWith("attachComplete");
    f.playerEvents.emit("video-attached", { sourceId: f.source.id, videoElement: f.context.video });
    f.sourceEvents.emit("ready", { timestamp: 9999999999999 });
    f.sourceEvents.emit("playing");
    f.sourceEvents.emit("ready");
    f.sourceEvents.emit("playing");
    for (const name of ["attachComplete", "sdkReady", "sdkPlaying"] as const) {
      expect(f.context.mark.mock.calls.filter(([mark]) => mark === name)).toEqual([[name]]);
    }
    expect(f.context.mark).not.toHaveBeenCalledWith("playResolved");
    expect(f.context.mark).not.toHaveBeenCalledWith("loadComplete");
    f.playback.resolve();
    await start;
    expect(f.context.mark).toHaveBeenCalledWith("playResolved");
    expect(session.start()).toBe(start);
    expect(f.source.play).toHaveBeenCalledTimes(1);
    await session.dispose();
  });

  it.each([0, 1, 2] as const)("records startup loadControl %s without inventing a load-completion event", async (loadControl) => {
    const f = fixture("startup", { webXLoadControl: loadControl });
    const session = await createAdapter(f.context);
    const start = session.start();
    expect(sdk.construct.mock.calls[0]?.[0]).toHaveProperty("defaultLogLevel", 0);
    expect(f.source.loadControl).toBe(loadControl);
    expect(session.metadata.configuration.startLoadControl).toBe(loadControl);
    if (loadControl === 0) {
      expect(f.context.mark).not.toHaveBeenCalledWith("loadStart");
      expect(session.metadata.unavailable.loadStart).toBeTruthy();
    } else expect(f.context.mark).toHaveBeenCalledWith("loadStart");
    expect(f.context.mark).not.toHaveBeenCalledWith("loadComplete");
    f.playback.resolve();
    await start;
    await session.dispose();
  });

  it("rejects a runtime value outside the public tuning candidates before constructing the SDK", async () => {
    const f = fixture("startup", { webXLoadControl: 9 } as unknown as StartupTuning);
    await expect(createAdapter(f.context)).rejects.toMatchObject({ message: "Web X startup failed (configuration-rejected)." });
    expect(f.context.fatal).toHaveBeenCalledExactlyOnceWith("configuration-rejected");
    expect(sdk.construct).not.toHaveBeenCalled();
  });

  it("keeps default policy separate from startup-only tuning", async () => {
    const f = fixture("default", { webXLoadControl: 0 });
    const session = await createAdapter(f.context);
    const start = session.start();
    expect(f.source.loadControl).toBe(2);
    expect(sdk.construct.mock.calls[0]?.[0]).not.toHaveProperty("defaultLogLevel");
    f.playback.resolve();
    await start;
    await session.dispose();
  });

  it("does not initialize an already aborted trial", async () => {
    const f = fixture();
    f.controller.abort();
    await expect(createAdapter(f.context)).rejects.toMatchObject({ message: "Web X startup failed (aborted)." });
    expect(sdk.construct).not.toHaveBeenCalled();
  });

  it("settles its own abort while SDK play is pending, awaits disposal, and ignores queued callbacks", async () => {
    const f = fixture();
    const disposed = deferred();
    f.player.dispose.mockImplementation(() => disposed.promise);
    const session = await createAdapter(f.context);
    const start = session.start();
    const [queuedReady] = f.sourceEvents.listeners("ready");
    const [queuedError] = f.playerEvents.listeners("player-error");
    expect(queuedReady).toBeTypeOf("function");
    expect(queuedError).toBeTypeOf("function");
    const rejected = expect(start).rejects.toMatchObject({ message: "Web X startup failed (aborted)." });
    f.controller.abort();
    await rejected;
    const markCount = f.context.mark.mock.calls.length;
    queuedReady?.({});
    queuedError?.({ message: "fake-sdk-detail" });
    expect(f.context.mark.mock.calls).toHaveLength(markCount);
    expect(f.context.fatal).toHaveBeenCalledExactlyOnceWith("aborted");

    let complete = false;
    const cleanup = session.dispose().then(() => { complete = true; });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(complete).toBe(false);
    disposed.resolve();
    await cleanup;
    expect(f.player.dispose).toHaveBeenCalledTimes(1);
    expect(f.sourceEvents.count()).toBe(0);
    expect(f.playerEvents.count()).toBe(0);
    f.playback.reject(new Error("fake-late-sdk-detail"));
    await Promise.resolve();
  });

  it("filters other source failures and reports only the generic owned SDK failure", async () => {
    const f = fixture();
    const session = await createAdapter(f.context);
    const rejected = expect(session.start()).rejects.toMatchObject({ message: "Web X startup failed (sdk-error)." });
    f.playerEvents.emit("source-error", { sourceId: "other-source", error: new Error("fake-sdk-detail") });
    expect(f.context.fatal).not.toHaveBeenCalled();
    f.playerEvents.emit("source-error", { sourceId: f.source.id, error: new Error("fake-sdk-detail") });
    await rejected;
    expect(f.context.fatal).toHaveBeenCalledExactlyOnceWith("sdk-error");
    await session.dispose();
    f.playback.reject(new Error("fake-late-sdk-detail"));
  });

  it("sanitizes a rejected SDK play promise", async () => {
    const f = fixture();
    const session = await createAdapter(f.context);
    const rejected = expect(session.start()).rejects.toMatchObject({ message: "Web X startup failed (play-rejected)." });
    f.playback.reject(new Error("fake-sdk-detail"));
    await rejected;
    expect(f.context.fatal).toHaveBeenCalledExactlyOnceWith("play-rejected");
    await session.dispose();
  });

  it("sanitizes constructor failure without fabricating a returned constructor milestone", async () => {
    const f = fixture();
    sdk.construct.mockImplementation(() => { throw new Error("fake-sdk-detail"); });
    await expect(createAdapter(f.context)).rejects.toMatchObject({ message: "Web X startup failed (initialization-failed)." });
    expect(f.context.fatal).toHaveBeenCalledExactlyOnceWith("initialization-failed");
    expect(f.context.mark.mock.calls).toEqual([["constructorStart"]]);
  });

  it("classifies attachment failure before sending a play request", async () => {
    const f = fixture();
    f.player.sources.attachVideo.mockImplementation(() => { throw new Error("fake-sdk-detail"); });
    const session = await createAdapter(f.context);
    await expect(session.start()).rejects.toMatchObject({ message: "Web X startup failed (load-failed)." });
    expect(f.source.play).not.toHaveBeenCalled();
    await session.dispose();
  });

  it("awaits partial-creation cleanup before rejecting when source creation fails", async () => {
    const f = fixture();
    const disposed = deferred();
    f.player.dispose.mockImplementation(() => disposed.promise);
    f.player.sources.add.mockImplementation(() => { throw new Error("fake-sdk-detail"); });
    const creation = createAdapter(f.context);
    const rejected = expect(creation).rejects.toMatchObject({ message: "Web X startup failed (initialization-failed)." });
    let settled = false;
    void creation.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    try { expect(settled).toBe(false); } finally { disposed.resolve(); }
    await rejected;
    expect(f.player.dispose).toHaveBeenCalledTimes(1);
    expect(f.playerEvents.count()).toBe(0);
  });

  it("still disposes native resources when removing one listener fails", async () => {
    const f = fixture();
    const session = await createAdapter(f.context);
    f.sourceEvents.off.mockImplementationOnce(() => { throw new Error("fake-sdk-detail"); });
    await expect(session.dispose()).rejects.toMatchObject({ message: "Web X startup failed (cleanup-failed)." });
    expect(f.player.dispose).toHaveBeenCalledTimes(1);
  });

  it("retains one sanitized, awaitable cleanup rejection for repeated disposal", async () => {
    const f = fixture();
    const session = await createAdapter(f.context);
    f.player.dispose.mockRejectedValue(new Error("fake-sdk-detail"));
    await expect(session.dispose()).rejects.toMatchObject({ message: "Web X startup failed (cleanup-failed)." });
    await expect(session.dispose()).rejects.toMatchObject({ message: "Web X startup failed (cleanup-failed)." });
    expect(f.player.dispose).toHaveBeenCalledTimes(1);
  });
});
