import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoRuntime } from "../src/startup/demo-session";
import type { AdapterContext, AdapterSession } from "../src/startup/contract";

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
async function fixture(options: { frames?: boolean; engine?: "hls" | "shaka" | "web-x"; format?: "hls" | "dash";
  createGate?: Promise<void>; startGate?: Promise<void> } = {}) {
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
  const started = runtime.start({ source: { url: "https://media.invalid/asset", format: options.format ?? "hls", label: "asset", custom: true },
    signal: controller.signal, selectedAt: 0 });
  await drain();
  return { runtime, video, controller, context, disposal, playback, load, sample, started };
}
async function playing(f: Awaited<ReturnType<typeof fixture>>) {
  f.video.emit("playing"); f.video.frame(0); await vi.advanceTimersByTimeAsync(20); f.video.frame(0.2);
  return f.started;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  vi.stubGlobal("location", new URL("https://player-lab.invalid/comparison-runner.html?demo=1"));
  vi.stubGlobal("window", { setTimeout, clearTimeout, setInterval, clearInterval });
});
afterEach(async () => { await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose().catch(() => {}))); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("retained comparison runtime", () => {
  it("retains playback after genuine startup and disposes exactly once on explicit close", async () => {
    const f = await fixture(); const result = await playing(f);
    expect(result).toMatchObject({ status: "success", failureCode: null, marks: { firstFrame: 0, firstMovingFrame: 20, advanced: 20 } });
    expect(f.disposal).not.toHaveBeenCalled();
    f.runtime.pause(); expect(f.video.paused).toBe(true);
    await f.runtime.play(); expect(f.video.paused).toBe(false);
    await f.runtime.dispose(); await f.runtime.dispose(); expect(f.disposal).toHaveBeenCalledTimes(1);
    expect(f.video.frames.size).toBe(0);
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
    for (const engine of ["web-x", "shaka"] as const) {
      const f = await fixture({ engine, format: "dash" }); await playing(f);
      expect(f.load).toHaveBeenCalledExactlyOnceWith(engine, "dash");
    }
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
