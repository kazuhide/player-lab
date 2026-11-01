import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterContext, AdapterSession, CreateAdapter, EngineId, ProviderSample } from "../src/startup/contract";
import { SDK_VERSIONS } from "../src/startup/contract";

const adapter = vi.hoisted(() => ({ create: vi.fn<CreateAdapter>() }));
vi.mock("../src/startup/adapters/hls", () => ({ createAdapter: adapter.create }));
vi.mock("../src/startup/adapters/shaka", () => ({ createAdapter: adapter.create }));
vi.mock("../src/startup/adapters/webx", () => ({ createAdapter: adapter.create }));
import { preloadEngine, runBrowserTrial, unavailableTrial } from "../src/startup/runner";
import type { BrowserTrial } from "../src/startup/runner";

// Controlled public adapter/video boundaries. No SDK, browser, decoder or performance trial runs here.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class VideoDouble extends EventTarget {
  paused = true;
  ended = false;
  readyState = 0;
  videoWidth = 0;
  videoHeight = 0;
  currentTime = 0;
  readonly frames = new Map<number, VideoFrameRequestCallback>();
  private nextFrame = 0;
  requestVideoFrameCallback = (callback: VideoFrameRequestCallback): number => {
    const id = ++this.nextFrame;
    this.frames.set(id, callback);
    return id;
  };
  cancelVideoFrameCallback = (id: number): void => { this.frames.delete(id); };
  getVideoPlaybackQuality = () => ({ creationTime: 0, droppedVideoFrames: 0, totalVideoFrames: 0 });
  emit(type: string) { this.dispatchEvent(new Event(type)); }
  frame(mediaTime: number, presentationTime: number): void {
    const entry = [...this.frames.entries()][0];
    if (!entry) throw new Error("No owned frame callback is pending");
    const [id, callback] = entry;
    this.frames.delete(id);
    callback(presentationTime, { mediaTime, presentationTime, expectedDisplayTime: presentationTime,
      presentedFrames: id, processingDuration: 0, width: 640, height: 360 });
  }
}

const clock = { value: 0 };
const origin = 100_000;
const sample: ProviderSample = { mediaEngine: "media-source", audioLanguage: "en", workerActive: false,
  loadLatencySeconds: 0, timeToFirstFrameSeconds: 0, bandwidthEstimateBps: 0 };
const open: Array<{ abort: AbortController; creation: ReturnType<typeof deferred<AdapterSession>>;
  started: ReturnType<typeof deferred<void>>; disposed: ReturnType<typeof deferred<void>>;
  session: AdapterSession; result: Promise<BrowserTrial> }> = [];

async function drain() { await vi.advanceTimersByTimeAsync(0); }
async function begin(options: { pendingStart?: boolean; pendingCreate?: boolean; pendingDispose?: boolean;
  frames?: boolean; engine?: EngineId; preaborted?: boolean;
  measurementClock?: Pick<Performance, "timeOrigin" | "now">; preloaded?: { start: number; end: number } } = {}) {
  const video = new VideoDouble();
  if (options.frames === false) Reflect.set(video, "requestVideoFrameCallback", undefined);
  const abort = new AbortController();
  if (options.preaborted) abort.abort();
  const creation = deferred<AdapterSession>();
  const started = deferred<void>();
  const disposed = deferred<void>();
  const engine = options.engine ?? "hls";
  const session: AdapterSession = {
    metadata: { engine, name: "Adapter test double", version: SDK_VERSIONS[engine], readyEvent: null,
      playingEvent: null, loadCompletion: "promise", attachCompletion: "promise-resolution",
      configuration: {}, unavailable: {}, sampleLimitations: {} },
    start: vi.fn(() => started.promise), sample: vi.fn(() => sample), dispose: vi.fn(() => disposed.promise),
  };
  let context: AdapterContext | null = null;
  adapter.create.mockImplementation((value) => {
    context = value;
    value.mark("constructorStart");
    return creation.promise.then((created) => { value.mark("constructorEnd"); return created; });
  });
  if (!options.pendingCreate) creation.resolve(session);
  if (!options.pendingStart) started.resolve(undefined);
  if (!options.pendingDispose) disposed.resolve(undefined);
  const result = runBrowserTrial({ engine, video: video as unknown as HTMLVideoElement, container: {} as HTMLElement,
    url: "https://fixture.invalid/public.m3u8", licenseKey: "test-only-key", profile: "default",
    selectedAt: origin, signal: abort.signal,
    ...(options.measurementClock ? { clock: options.measurementClock } : {}),
    ...(options.preloaded ? { preloaded: options.preloaded } : {}) });
  const fixture = { video, abort, creation, started, disposed, session, result,
    get context(): AdapterContext {
      if (!context) throw new Error("Adapter has not been created");
      return context;
    } };
  open.push(fixture);
  await vi.dynamicImportSettled();
  await drain();
  return fixture;
}

type Fixture = Awaited<ReturnType<typeof begin>>;
function playingFrames(f: Fixture) {
  Object.assign(f.video, { paused: false, readyState: 2, videoWidth: 640, videoHeight: 360, currentTime: 0.05 });
  clock.value = 10; f.video.emit("playing"); f.video.frame(0, 10);
  clock.value = 20; f.video.currentTime = 0.2; f.video.frame(0.04, 20);
}

beforeEach(() => {
  vi.useFakeTimers(); adapter.create.mockReset(); clock.value = 0;
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("performance", { timeOrigin: origin, now: () => clock.value, getEntriesByType: () => [] });
  vi.stubGlobal("PerformanceObserver", { supportedEntryTypes: [] });
});
afterEach(async () => {
  for (const f of open) {
    f.abort.abort(); f.creation.resolve(f.session); f.started.resolve(undefined); f.disposed.resolve(undefined);
  }
  await Promise.allSettled(open.map((f) => f.result));
  open.length = 0; vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("common startup observer", () => {
  it.each(["web-x", "hls", "shaka"] as const)("observes playing and moving frames for %s through the public adapter boundary", async (engine) => {
    const f = await begin({ engine }); playingFrames(f);
    const result = await f.result;
    expect(result).toMatchObject({ status: "success", failureCode: null, frameCallbackAvailable: true,
      marks: { nativePlaying: 10, firstFrame: 10, firstMovingFrame: 20, advanced: 20 },
      video: { width: 640, height: 360, advancedSeconds: 0.2, droppedFrames: 0, totalFrames: 0 }, cleanupMs: 0 });
    expect(f.video.frames.size).toBe(0);
  });

  it("does not call loadeddata a frame or complete a buffered but unplayed video", async () => {
    const f = await begin();
    Object.assign(f.video, { readyState: 2, videoWidth: 640, videoHeight: 360, currentTime: 0.2, paused: false });
    f.video.emit("loadeddata"); await vi.advanceTimersByTimeAsync(1000);
    let settled = false; void f.result.then(() => { settled = true; }); await drain();
    expect(settled).toBe(false);
    f.abort.abort(); const result = await f.result;
    expect(result.status).toBe("cancelled"); expect(result.marks.loadedData).toBe(0);
    expect(result.marks).not.toHaveProperty("firstFrame");
    expect(result.marks).not.toHaveProperty("firstMovingFrame");
  });

  it("waits for the genuine start promise even after playing, advancing and moving frames", async () => {
    const f = await begin({ pendingStart: true });
    let settled = false; void f.result.then(() => { settled = true; });
    playingFrames(f); await drain();
    expect(settled).toBe(false);
    clock.value = 50; f.started.resolve(undefined);
    const result = await f.result;
    expect(result.status).toBe("success");
    expect(result.marks).toMatchObject({ nativePlaying: 10, firstFrame: 10, firstMovingFrame: 20, advanced: 20 });
  });

  it("retains a late start rejection after browser playback has already advanced", async () => {
    const f = await begin({ pendingStart: true }); playingFrames(f); await drain();
    f.started.reject(new Error("private SDK payload"));
    const result = await f.result;
    expect(result).toMatchObject({ status: "failure", failureCode: "load-failed" });
    expect(JSON.stringify(result)).not.toContain("private SDK payload");
  });

  it("stops SDK and native marks in the same turn as a terminal fatal event", async () => {
    const f = await begin();
    f.context.fatal("sdk-error", 7001);
    f.context.mark("sdkReady"); f.video.emit("loadeddata"); f.video.emit("playing");
    const result = await f.result;
    expect(result).toMatchObject({ status: "failure", failureCode: "sdk-error", sdkCode: 7001 });
    expect(result.marks).not.toHaveProperty("sdkReady");
    expect(result.marks).not.toHaveProperty("loadedData");
    expect(result.marks).not.toHaveProperty("nativePlaying");
  });

  it("awaits and retains a cleanup rejection from a session returned after abort", async () => {
    const f = await begin({ pendingCreate: true, pendingDispose: true });
    let settled = false; void f.result.then(() => { settled = true; });
    f.abort.abort(); await drain(); expect(settled).toBe(false);
    f.creation.resolve(f.session); await drain(); expect(settled).toBe(false);
    f.disposed.reject(new Error("private cleanup payload"));
    const result = await f.result;
    expect(result).toMatchObject({ status: "failure", failureCode: "cleanup-failed" });
    expect(JSON.stringify(result)).not.toContain("private cleanup payload");
  });

  it("retains the trial deadline when SDK abort notification synchronously reports aborted", async () => {
    const f = await begin();
    f.context.signal.addEventListener("abort", () => f.context.fatal("aborted"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await f.result).toMatchObject({ status: "failure", failureCode: "deadline" });
    expect(f.context.signal.aborted).toBe(true);
  });

  it("keeps user cancellation distinct from the trial deadline with the same SDK notification", async () => {
    const f = await begin();
    f.context.signal.addEventListener("abort", () => f.context.fatal("aborted"));
    f.abort.abort();
    expect(await f.result).toMatchObject({ status: "cancelled", failureCode: "aborted" });
  });


  it("proves playing and advancement without substituting loadeddata when rVFC is unavailable", async () => {
    const f = await begin({ frames: false });
    Object.assign(f.video, { paused: false, readyState: 2, videoWidth: 640, videoHeight: 360, currentTime: 0.2 });
    f.video.emit("loadeddata"); clock.value = 15; f.video.emit("playing");
    await vi.advanceTimersByTimeAsync(50);
    const result = await f.result;
    expect(result).toMatchObject({ status: "success", frameCallbackAvailable: false, marks: { nativePlaying: 15, advanced: 15 } });
    expect(result.marks).not.toHaveProperty("firstFrame");
    expect(result.marks).not.toHaveProperty("firstMovingFrame");
  });

  it.each([
    ["paused", { paused: true }], ["ended", { ended: true }],
    ["not playable", { readyState: 1 }], ["zero width", { videoWidth: 0 }],
    ["zero height", { videoHeight: 0 }], ["stationary currentTime", { currentTime: 0 }],
  ] as const)("does not report playback success for %s video", async (_reason, state) => {
    const f = await begin({ pendingStart: true });
    playingFrames(f); Object.assign(f.video, state); f.started.resolve(undefined);
    let settled = false; void f.result.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(100); expect(settled).toBe(false);
    f.abort.abort(); expect((await f.result).status).toBe("cancelled");
  });

  it("requires the native playing event even if SDK events and advancing frames are present", async () => {
    const f = await begin();
    Object.assign(f.video, { paused: false, readyState: 2, videoWidth: 640, videoHeight: 360, currentTime: 0.2 });
    f.context.mark("sdkReady"); f.context.mark("sdkPlaying"); f.context.mark("playResolved");
    f.video.frame(0, 0); clock.value = 10; f.video.frame(0.04, 10);
    let settled = false; void f.result.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(100); expect(settled).toBe(false);
    f.abort.abort(); const result = await f.result;
    expect(result.marks).toMatchObject({ sdkReady: 0, sdkPlaying: 0, playResolved: 0, firstMovingFrame: 10 });
    expect(result.marks).not.toHaveProperty("nativePlaying");
  });

  it("requires moving rVFC media time rather than repeated callbacks for the same frame", async () => {
    const f = await begin();
    Object.assign(f.video, { paused: false, readyState: 2, videoWidth: 640, videoHeight: 360, currentTime: 0.2 });
    f.video.emit("playing"); f.video.frame(0, 0); clock.value = 10; f.video.frame(0, 10);
    let settled = false; void f.result.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(100); expect(settled).toBe(false);
    f.abort.abort(); const result = await f.result;
    expect(result.marks).toMatchObject({ firstFrame: 0, advanced: 0 });
    expect(result.marks).not.toHaveProperty("firstMovingFrame");
  });

  it("preserves a first observation at zero and never replaces it with a repeated event", async () => {
    const f = await begin({ pendingStart: true });
    Object.assign(f.video, { paused: false, readyState: 2, videoWidth: 640, videoHeight: 360, currentTime: 0.2 });
    f.context.mark("sdkReady"); f.video.emit("loadeddata"); f.video.emit("playing"); f.video.frame(0, 0);
    clock.value = 10;
    f.context.mark("sdkReady"); f.video.emit("loadeddata"); f.video.emit("playing"); f.video.frame(0.04, 10);
    clock.value = 20; f.video.frame(0.08, 20); f.started.resolve(undefined);
    expect(await f.result).toMatchObject({ status: "success",
      marks: { sdkReady: 0, loadedData: 0, nativePlaying: 0, firstFrame: 0, firstMovingFrame: 10, advanced: 0 },
      sample: { loadLatencySeconds: 0, timeToFirstFrameSeconds: 0, bandwidthEstimateBps: 0 },
      video: { droppedFrames: 0, totalFrames: 0 }, cleanupMs: 0 });
  });

  it("ignores retained callbacks, native events and SDK errors after returning a terminal result", async () => {
    const f = await begin();
    const retained = [...f.video.frames.values()][0]!;
    playingFrames(f); const result = await f.result;
    const snapshot = JSON.stringify(result);
    clock.value = 100;
    f.context.mark("sdkReady"); f.context.fatal("sdk-error", 7011); f.video.emit("loadeddata"); f.video.emit("error");
    retained(100, { mediaTime: 10, presentationTime: 100, expectedDisplayTime: 100, presentedFrames: 50,
      processingDuration: 0, width: 640, height: 360 });
    expect(JSON.stringify(result)).toBe(snapshot);
    expect(f.video.frames.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });

  it("does not create or start an adapter for an already cancelled trial", async () => {
    const f = await begin({ preaborted: true });
    expect(await f.result).toMatchObject({ status: "cancelled", failureCode: "aborted", marks: {}, metadata: null, sample: null });
    expect(adapter.create).not.toHaveBeenCalled(); expect(f.session.start).not.toHaveBeenCalled();
    expect(f.video.frames.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for partial creation and its disposal after cancellation without starting playback", async () => {
    const f = await begin({ pendingCreate: true, pendingDispose: true });
    let settled = false; void f.result.then(() => { settled = true; });
    f.abort.abort(); await drain(); expect(settled).toBe(false);
    expect(f.context.signal.aborted).toBe(true);
    f.creation.resolve(f.session); await drain();
    expect(f.session.dispose).toHaveBeenCalledTimes(1); expect(settled).toBe(false);
    clock.value = 7; f.disposed.resolve(undefined);
    expect(await f.result).toMatchObject({ status: "cancelled", failureCode: "aborted", metadata: null, sample: null, cleanupMs: 7 });
    expect(f.session.start).not.toHaveBeenCalled();
  });

  it("awaits the active session disposal and observes its actual duration", async () => {
    const f = await begin({ pendingDispose: true });
    let settled = false; void f.result.then(() => { settled = true; });
    playingFrames(f); await drain(); expect(settled).toBe(false);
    expect(f.context.signal.aborted).toBe(true); expect(f.session.dispose).toHaveBeenCalledTimes(1);
    clock.value = 35; f.disposed.resolve(undefined);
    expect(await f.result).toMatchObject({ status: "success", cleanupMs: 15 });
  });

  it("retains active-session cleanup rejection instead of publishing playback success", async () => {
    const f = await begin({ pendingDispose: true });
    playingFrames(f); await drain(); f.disposed.reject(new Error("private disposal payload"));
    const result = await f.result;
    expect(result).toMatchObject({ status: "failure", failureCode: "cleanup-failed" });
    expect(JSON.stringify(result)).not.toContain("private disposal payload");
  });

  it("bounds a hung cleanup without turning it into success or cancellation", async () => {
    const f = await begin({ pendingDispose: true }); playingFrames(f); await drain();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await f.result).toMatchObject({ status: "failure", failureCode: "cleanup-failed" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains the first SDK fatal code including the real numeric value zero", async () => {
    const f = await begin();
    f.context.fatal("configuration-rejected", 0); f.context.fatal("sdk-error", 99); f.video.emit("error");
    expect(await f.result).toMatchObject({ status: "failure", failureCode: "configuration-rejected", sdkCode: 0 });
  });

  it("uses one supplied parent clock despite different child origin and presentation timestamps", async () => {
    vi.stubGlobal("performance", { timeOrigin: origin - 0.10009765625, now: () => 500,
      getEntriesByType: () => [] });
    const parentClock = { timeOrigin: origin, now: () => clock.value };
    const f = await begin({ measurementClock: parentClock, pendingStart: true });
    f.context.mark("sdkReady");
    Object.assign(f.video, { paused: false, readyState: 2, videoWidth: 640, videoHeight: 360, currentTime: 0.05 });
    clock.value = 10; f.video.emit("playing"); f.video.frame(0, 9_000);
    clock.value = 20; f.video.currentTime = 0.2; f.video.frame(0.04, 9_100);
    clock.value = 50; f.started.resolve(undefined);
    expect(await f.result).toMatchObject({ status: "success", marks: { sdkImportStart: 0, sdkImportEnd: 0,
      constructorStart: 0, constructorEnd: 0, sdkReady: 0, nativePlaying: 10, firstFrame: 10, firstMovingFrame: 20, advanced: 20 } });
  });

  it("records preload import bounds on the supplied clock without constructing an adapter", async () => {
    const parentClock = { timeOrigin: origin, now: vi.fn().mockReturnValueOnce(5).mockReturnValueOnce(8) };
    vi.stubGlobal("performance", { timeOrigin: origin - 500, now: () => 200, getEntriesByType: () => [] });
    expect(await preloadEngine("shaka", parentClock)).toEqual({ start: origin + 5, end: origin + 8 });
    expect(parentClock.now).toHaveBeenCalledTimes(2); expect(adapter.create).not.toHaveBeenCalled();
  });

  it("retains negative preselection preload offsets instead of clamping them to zero", async () => {
    const f = await begin({ preloaded: { start: origin - 20, end: origin - 10 } }); playingFrames(f);
    expect((await f.result).marks).toMatchObject({ sdkImportStart: -20, sdkImportEnd: -10, constructorStart: 0 });
  });

  it("keeps unobserved document attempts missing instead of filling observations with zeros", () => {
    expect(unavailableTrial("deadline")).toEqual({ status: "failure", failureCode: "deadline", sdkCode: null,
      marks: {}, metadata: null, sample: null, frameCallbackAvailable: false, video: null, resources: null,
      longTasks: null, javascriptHeapDeltaBytes: null, cleanupMs: null });
    expect(unavailableTrial("aborted").status).toBe("cancelled");
  });

});
