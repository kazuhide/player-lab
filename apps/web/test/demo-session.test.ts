import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoRuntime } from "../src/startup/demo-session";
import type { AdapterContext, AdapterSession, DemoEngineId, StartupProfile, StartupTuning } from "../src/startup/contract";
import type { DemoSource } from "../src/startup/demo-contract";
const routes = vi.hoisted(() => ({ compact: vi.fn(), hls: vi.fn(), dash: vi.fn() }));
vi.mock("../src/startup/adapters/webx-clear-fmp4", () => ({ createAdapter: routes.compact }));
vi.mock("../src/startup/adapters/webx", () => ({ createAdapter: routes.hls }));
vi.mock("../src/startup/adapters/webx-dash", () => ({ createAdapter: routes.dash }));

class Video extends EventTarget {
  paused = false; ended = false; seeking = false; readyState = 2;
  videoWidth = 640; videoHeight = 360; currentTime = 0; duration = 120;
  muted = false; defaultMuted = false; autoplay = false; playsInline = false;
  controls = false; playbackRate = 1; defaultPlaybackRate = 1;
  buffered = ranges([[0, 20]]); seekable = ranges([[0, 120]]);
  frames = new Map<number, VideoFrameRequestCallback>(); next = 0;
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  requestVideoFrameCallback(callback: VideoFrameRequestCallback) { const id = ++this.next; this.frames.set(id, callback); return id; }
  cancelVideoFrameCallback(id: number) { this.frames.delete(id); }
  getVideoPlaybackQuality() { return { droppedVideoFrames: 0, totalVideoFrames: 10 }; }
  frame(time: number) {
    this.currentTime = time;
    const callbacks = [...this.frames.values()]; this.frames.clear();
    for (const callback of callbacks) callback(999_999, { mediaTime: time } as VideoFrameCallbackMetadata);
  }
  emit(type: string) { this.dispatchEvent(new Event(type)); }
}
function ranges(values: number[][]): TimeRanges {
  return { length: values.length, start: (i) => values[i]![0]!, end: (i) => values[i]![1]! };
}
const metadata = { engine: "hls", name: "fixture", version: "1.7.4", readyEvent: null, playingEvent: null,
  loadCompletion: "unavailable", attachCompletion: "synchronous-return", configuration: {}, unavailable: {}, sampleLimitations: {} } as const;
const runtimes: DemoRuntime[] = [];
async function drain() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
async function fixture(options: { frames?: boolean; engine?: DemoEngineId; format?: "hls" | "dash";
  createGate?: Promise<void>; startGate?: Promise<void>; source?: DemoSource; profile?: StartupProfile; tuning?: StartupTuning } = {}) {
  const video = new Video();
  if (options.frames === false) Object.defineProperty(video, "requestVideoFrameCallback", { value: undefined });
  const controller = new AbortController(); let context!: AdapterContext;
  const disposal = vi.fn(async () => {});
  const playback = { play: video.play, pause: video.pause, seek: vi.fn((value: number) => { video.currentTime = value; video.emit("seeking"); }) };
  const session: AdapterSession = { metadata, start: vi.fn(async () => { await options.startGate; }),
    sample: () => ({ mediaEngine: "unknown", audioLanguage: null, workerActive: null,
      loadLatencySeconds: null, timeToFirstFrameSeconds: null, bandwidthEstimateBps: null }), dispose: disposal, playback };
  const load = vi.fn(async () => async (value: AdapterContext) => { context = value; await options.createGate; return session; });
  const sample = vi.fn();
  const runtime = new DemoRuntime({ engine: options.engine ?? "hls", video: video as unknown as HTMLVideoElement,
    container: {} as HTMLElement, onSample: sample, clock: { timeOrigin: 0, now: () => Date.now() }, loadAdapter: load });
  runtimes.push(runtime);
  const started = runtime.start({ source: options.source ?? { url: "https://media.invalid/asset", format: options.format ?? "hls", label: "asset", custom: true },
    ...(options.profile === undefined ? {} : { profile: options.profile }),
    ...(options.tuning === undefined ? {} : { tuning: options.tuning }),
    signal: controller.signal, selectedAt: 0 });
  await drain();
  return { runtime, video, controller, context, disposal, playback, load, sample, started };
}
async function playing(f: Awaited<ReturnType<typeof fixture>>) {
  f.video.emit("playing"); f.video.frame(0); await vi.advanceTimersByTimeAsync(20); f.video.frame(0.2);
  return f.started;
}
beforeEach(() => {
  Object.values(routes).forEach((route) => route.mockReset());
  vi.useFakeTimers(); vi.setSystemTime(0);
  vi.stubGlobal("location", new URL("https://player-lab.invalid/comparison-runner.html?demo=1"));
  vi.stubGlobal("window", { setTimeout, clearTimeout, setInterval, clearInterval });
});
afterEach(async () => { await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose().catch(() => {}))); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("retained comparison runtime", () => {
  const fixed: DemoSource = { url: "https://player-lab.invalid/player-lab/web/media/vod-baseline/comparison-360p.m3u8",
    format: "hls", custom: false, label: "fixture" };
  const workerCases: readonly { name: string; engine: DemoEngineId; source: DemoSource;
    profile?: StartupProfile; expected?: boolean }[] = [
    { name: "matching explicit startup", engine: "hls", source: fixed, profile: "startup", expected: false },
    { name: "matching implicit startup", engine: "hls", source: fixed, expected: false },
    { name: "default profile", engine: "hls", source: fixed, profile: "default" },
    { name: "custom URL", engine: "hls", source: { ...fixed, custom: true }, profile: "startup" },
    { name: "adaptive network source", engine: "hls", source: { ...fixed, url: fixed.url.replace("comparison-360p", "master") }, profile: "startup" },
    { name: "other origin", engine: "hls", source: { ...fixed, url: fixed.url.replace("player-lab.invalid", "media.invalid") }, profile: "startup" },
    { name: "Shaka", engine: "shaka", source: fixed, profile: "startup" },
    { name: "Web X", engine: "web-x", source: fixed, profile: "startup" },
    { name: "Bitmovin v8", engine: "bitmovin-8", source: fixed, profile: "startup" },
  ];
  it.each(workerCases)("scopes calibrated hls worker policy to $name", async (choice) => {
    vi.stubEnv("BASE_URL", "/player-lab/web/");
    const f = await fixture({ engine: choice.engine, source: choice.source,
      ...(choice.profile === undefined ? {} : { profile: choice.profile }) });
    expect(f.context.tuning?.hlsWorker).toBe(choice.expected);
    if (choice.expected === undefined) expect(f.context.tuning).toBeUndefined();
    expect((await playing(f)).status).toBe("success");
  });
  it.each([true, false])("preserves an explicit hlsWorker=%s and other caller tuning", async (hlsWorker) => {
    vi.stubEnv("BASE_URL", "/player-lab/web/");
    const tuning = Object.freeze({ hlsWorker, shakaPrefetchLimit: 2 as const });
    const f = await fixture({ source: fixed, profile: "startup", tuning });
    expect(f.context.tuning).toEqual(tuning);
    expect(tuning).toEqual({ hlsWorker, shakaPrefetchLimit: 2 });
    expect((await playing(f)).status).toBe("success");
  });
  it("retains other tuning when adding the calibrated worker setting", async () => {
    vi.stubEnv("BASE_URL", "/player-lab/web/");
    const tuning = Object.freeze({ shakaPrefetchLimit: 0 as const });
    const f = await fixture({ source: fixed, profile: "startup", tuning });
    expect(f.context.tuning).toEqual({ shakaPrefetchLimit: 0, hlsWorker: false });
    expect(tuning).toEqual({ shakaPrefetchLimit: 0 });
    expect((await playing(f)).status).toBe("success");
  });
  it("retains playback after genuine startup and disposes exactly once on explicit close", async () => {
    const f = await fixture(); const result = await playing(f);
    expect(result).toMatchObject({ status: "success", failureCode: null, marks: { firstFrame: 0, firstMovingFrame: 20, advanced: 20 } });
    expect(f.disposal).not.toHaveBeenCalled();
    f.runtime.pause(); expect(f.video.paused).toBe(true);
    await f.runtime.play(); expect(f.video.paused).toBe(false);
    await f.runtime.dispose(); await f.runtime.dispose(); expect(f.disposal).toHaveBeenCalledTimes(1);
    expect(f.video.frames.size).toBe(0);
  });
  it("does not report a download stall while buffered playback keeps advancing", async () => {
    const f = await fixture(); await playing(f);
    f.video.readyState = 4;
    f.video.frame(1); f.video.emit("stalled");
    await vi.advanceTimersByTimeAsync(125); f.video.frame(1.25);
    await vi.advanceTimersByTimeAsync(125);
    expect(f.sample).toHaveBeenLastCalledWith(expect.objectContaining({ mediaTime: 1.25, bufferSeconds: 18.75, stalled: false }));
    expect(f.disposal).not.toHaveBeenCalled();
  });
  it("reports playback waiting until playing resumes", async () => {
    const f = await fixture(); await playing(f);
    f.video.emit("waiting");
    expect(f.sample).toHaveBeenLastCalledWith(expect.objectContaining({ stalled: true }));
    f.video.readyState = 4; f.video.frame(0.4); f.video.emit("playing");
    expect(f.sample).toHaveBeenLastCalledWith(expect.objectContaining({ mediaTime: 0.4, stalled: false }));
  });
  it("never accepts seeked, old queued frames, or a stationary target frame as seek completion", async () => {
    const f = await fixture(); await playing(f);
    const seeking = f.runtime.seek(40, new AbortController().signal); let done = false; void seeking.then(() => { done = true; });
    f.video.emit("seeked"); f.video.frame(0.3); f.video.frame(0.4); await drain(); expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(30); f.video.frame(40); f.video.frame(40); await drain(); expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(20); f.video.frame(40.04);
    expect(await seeking).toMatchObject({ status: "success", latencyMs: 50, targetSeconds: 40, buffered: false });
    expect(f.playback.seek).toHaveBeenCalledWith(40); expect(f.disposal).not.toHaveBeenCalled();
  });
  it("cancels only the active seek while keeping the retained player usable", async () => {
    const f = await fixture(); await playing(f); const cancel = new AbortController();
    const first = f.runtime.seek(10, cancel.signal); cancel.abort();
    expect(await first).toMatchObject({ status: "cancelled", failureCode: "aborted", latencyMs: null, buffered: true });
    const second = f.runtime.seek(11, new AbortController().signal); f.video.frame(11); f.video.frame(11.04);
    expect(await second).toMatchObject({ status: "success" }); expect(f.disposal).not.toHaveBeenCalled();
  });
  it("keeps unavailable compositor timing missing and never fakes a successful frame measure", async () => {
    const f = await fixture({ frames: false }); f.video.emit("playing"); f.video.currentTime = 0.2;
    await vi.advanceTimersByTimeAsync(50); expect(await f.started).toMatchObject({ status: "success", frameCallbackAvailable: false });
    expect(await f.runtime.seek(10, new AbortController().signal)).toMatchObject({ status: "failure", failureCode: "unsupported", latencyMs: null });
    expect(f.playback.seek).toHaveBeenCalledWith(10);
  });
  it("reports hls.js DASH as unsupported before importing or creating an SDK", async () => {
    const f = await fixture({ format: "dash" });
    expect(await f.started).toMatchObject({ status: "failure", failureCode: "unsupported" }); expect(f.load).not.toHaveBeenCalled();
  });
  it("rejects invalid or out-of-window targets without changing the source", async () => {
    const f = await fixture(); await playing(f); f.video.seekable = ranges([[30, 60]]);
    for (const target of [NaN, -1, 20, 61]) expect(await f.runtime.seek(target, new AbortController().signal)).toMatchObject({ status: "failure", latencyMs: null });
    expect(f.playback.seek).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(f.sample).toHaveBeenLastCalledWith(expect.objectContaining({ seekableStart: 30, seekableEnd: 60, durationSeconds: 120, droppedFrames: 0 }));
  });
  it("retains the seek deadline and leaves missing timing null", async () => {
    const f = await fixture(); await playing(f);
    const seeking = f.runtime.seek(40, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await seeking).toMatchObject({ status: "failure", failureCode: "deadline", latencyMs: null });
    expect(f.disposal).not.toHaveBeenCalled();
  });
  it("does not let a superseded seek's late play rejection cancel its replacement", async () => {
    const f = await fixture(); await playing(f);
    let reject!: (reason: Error) => void;
    f.playback.play.mockImplementationOnce(() => new Promise<void>((_, no) => { reject = no; }));
    const first = f.runtime.seek(10, new AbortController().signal);
    const second = f.runtime.seek(40, new AbortController().signal);
    expect(await first).toMatchObject({ status: "cancelled", latencyMs: null });
    reject(new Error("private old play rejection")); await drain();
    f.video.frame(40); f.video.frame(40.04);
    expect(await second).toMatchObject({ status: "success", targetSeconds: 40 });
  });
  it("bounds a hung SDK cleanup and preserves cleanup failure", async () => {
    const f = await fixture(); await playing(f);
    f.disposal.mockImplementation(() => new Promise<void>(() => {}));
    const closed = expect(f.runtime.dispose()).rejects.toThrow("cleanup-failed");
    await vi.advanceTimersByTimeAsync(5_000); await closed;
    expect(f.video.frames.size).toBe(0);
  });
  it("routes supported DASH engines to the actual DASH adapter boundary", async () => {
    for (const engine of ["web-x", "bitmovin-8", "shaka"] as const) {
      const f = await fixture({ engine, format: "dash" }); await playing(f);
      expect(f.load).toHaveBeenCalledExactlyOnceWith(engine, {
        url: "https://media.invalid/asset", format: "dash", label: "asset", custom: true,
      });
    }
  });
  it.each([
    { path: "comparison-360p.m3u8", format: "hls", custom: false, selected: "compact" },
    { path: "comparison-360p.m3u8", format: "hls", custom: true, selected: "hls" },
    { path: "master.m3u8", format: "hls", custom: false, selected: "hls" },
    { path: "other.m3u8", format: "hls", custom: false, selected: "hls" },
    { path: "manifest.mpd", format: "dash", custom: true, selected: "dash" },
  ] as const)("imports the $selected Web X adapter only after validated $path selection", async (choice) => {
    vi.stubEnv("BASE_URL", "/player-lab/web/");
    const base = "https://player-lab.invalid/player-lab/web/";
    vi.stubGlobal("location", new URL(`${base}demo-runner.html?demo=1`));
    const video = new Video();
    const dispose = vi.fn(async () => {});
    const session: AdapterSession = { metadata, start: vi.fn(async () => {}), dispose,
      sample: () => ({ mediaEngine: "unknown", audioLanguage: null, workerActive: null,
        loadLatencySeconds: null, timeToFirstFrameSeconds: null, bandwidthEstimateBps: null }) };
    for (const route of Object.values(routes)) route.mockResolvedValue(session);
    const runtime = new DemoRuntime({ engine: "web-x", video: video as unknown as HTMLVideoElement,
      container: {} as HTMLElement, clock: { timeOrigin: 0, now: () => Date.now() } });
    runtimes.push(runtime);
    expect(Object.values(routes).every((route) => route.mock.calls.length === 0)).toBe(true);
    const started = runtime.start({ source: { url: `${base}media/vod-baseline/${choice.path}`, format: choice.format,
      custom: choice.custom, label: "asset" }, signal: new AbortController().signal, selectedAt: 0 });
    await vi.dynamicImportSettled(); await drain();
    video.emit("playing"); video.frame(0); await vi.advanceTimersByTimeAsync(20); video.frame(0.2);
    const result = await started;
    expect(result).toMatchObject({ status: "success", marks: { sdkImportStart: 0 } });
    expect(result.marks.sdkImportEnd).toBeGreaterThanOrEqual(result.marks.sdkImportStart!);
    expect(routes[choice.selected]).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      url: `${base}media/vod-baseline/${choice.path}`,
    }));
    for (const [name, route] of Object.entries(routes)) if (name !== choice.selected) expect(route).not.toHaveBeenCalled();
    await runtime.dispose(); expect(dispose).toHaveBeenCalledOnce();
  });
  it("preserves observed frame/advancement times while awaiting a late genuine start promise", async () => {
    let resolve!: () => void; const gate = new Promise<void>((yes) => { resolve = yes; });
    const f = await fixture({ startGate: gate });
    f.video.emit("playing"); f.video.frame(0); await vi.advanceTimersByTimeAsync(20); f.video.frame(0.2);
    let done = false; void f.started.then(() => { done = true; }); await drain(); expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(80); resolve(); await vi.advanceTimersByTimeAsync(50);
    expect(await f.started).toMatchObject({ status: "success", marks: { firstMovingFrame: 20, advanced: 20 } });
  });
  it("retains cleanup failure from a session that is created after cancellation", async () => {
    let resolve!: () => void; const gate = new Promise<void>((yes) => { resolve = yes; });
    const f = await fixture({ createGate: gate }); f.disposal.mockRejectedValue(new Error("private late cleanup"));
    f.controller.abort(); await drain(); resolve();
    const result = await f.started; expect(result).toMatchObject({ status: "failure", failureCode: "cleanup-failed" });
    expect(JSON.stringify(result)).not.toContain("private late cleanup"); expect(f.disposal).toHaveBeenCalledTimes(1);
  });
  it("latches the first moving target frame while a genuine play promise settles later", async () => {
    const f = await fixture(); await playing(f);
    let resolve!: () => void;
    f.playback.play.mockImplementationOnce(() => new Promise<void>((yes) => { resolve = yes; }));
    const seek = f.runtime.seek(40, new AbortController().signal); let done = false; void seek.then(() => { done = true; });
    f.video.frame(40); await vi.advanceTimersByTimeAsync(50); f.video.frame(40.04);
    await vi.advanceTimersByTimeAsync(50); f.video.frame(40.08); await drain(); expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(20); resolve();
    expect(await seek).toMatchObject({ status: "success", latencyMs: 50 });
  });
});
