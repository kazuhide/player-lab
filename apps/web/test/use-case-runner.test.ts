import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateUseCaseDriver, PreparationPolicy, UseCaseDriver, UseCaseDriverOptions } from "../src/startup/use-cases/contracts";
import { UseCaseSweep, type SweepResult } from "../src/startup/use-cases/runner";

const factory = vi.hoisted(() => ({ create: vi.fn<CreateUseCaseDriver>() }));
vi.mock("../src/startup/use-cases/webx", () => ({ createDriver: factory.create }));

// Controlled native observations only; no SDK, decoder or performance trial runs here.
class VideoDouble extends EventTarget {
  paused = true;
  ended = false;
  readyState = 2;
  videoWidth = 640;
  videoHeight = 360;
  currentTime = 0;
  webkitAudioDecodedByteCount = 0;
  readonly frames = new Map<number, VideoFrameRequestCallback>();
  private nextFrame = 0;
  requestVideoFrameCallback = (callback: VideoFrameRequestCallback) => {
    const id = ++this.nextFrame; this.frames.set(id, callback); return id;
  };
  cancelVideoFrameCallback = (id: number) => { this.frames.delete(id); };
  emit(name: string) { this.dispatchEvent(new Event(name)); }
  present(mediaTime: number) {
    this.currentTime = mediaTime;
    const callbacks = [...this.frames.entries()];
    this.frames.clear();
    for (const [id, callback] of callbacks) callback(clock.value, {
      mediaTime, presentationTime: clock.value, expectedDisplayTime: clock.value,
      presentedFrames: id, processingDuration: 0, width: 640, height: 360,
    });
  }
}

function gate() {
  let resolve!: () => void; let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const clock = { value: 0 };
const open: Array<{ sweep: UseCaseSweep; result: Promise<SweepResult>; pending: ReturnType<typeof gate> }> = [];
async function drain() { await vi.advanceTimersByTimeAsync(0); }

interface FixtureOptions {
  reused?: boolean;
  lookahead?: number;
  pendingLookahead?: boolean;
  pendingSourceId?: string;
  policy?: PreparationPolicy;
  warmupMs?: number;
  cancelPreparationOnStop?: boolean;
}
async function begin({ reused = false, lookahead = 1, pendingLookahead = false,
  pendingSourceId = pendingLookahead ? "source-3" : "", policy = "on-demand", warmupMs = 0,
  cancelPreparationOnStop = false }: FixtureOptions = {}) {
  const sweep = new UseCaseSweep({ replaceChildren: vi.fn() } as unknown as HTMLElement);
  const pending = gate(), activations: Array<{ sourceId: string; video: VideoDouble }> = [];
  const preparedIds: string[] = [];
  const shared = new VideoDouble();
  let options!: UseCaseDriverOptions;
  const driver: UseCaseDriver = {
    engine: "web-x", supportedPolicies: ["on-demand", "decoded"], configuration: {},
    prepare: (source) => {
      preparedIds.push(source.id);
      return source.id === pendingSourceId ? pending.promise : Promise.resolve();
    },
    activate: async (sourceId, observe) => {
      const video = reused ? shared : new VideoDouble();
      video.paused = true;
      observe(video as unknown as HTMLVideoElement);
      video.currentTime = 0;
      activations.push({ sourceId, video });
      return video as unknown as HTMLVideoElement;
    },
    state: () => ({ video: null, bufferSeconds: 12, readyState: 2 }),
    remove: async () => {}, dispose: vi.fn(async () => {}),
  };
  factory.create.mockImplementation(async (value) => {
    options = value;
    if (cancelPreparationOnStop) value.signal.addEventListener("abort", () => {
      pending.reject(new DOMException("Preparation cancelled during disposal.", "AbortError"));
    }, { once: true });
    return driver;
  });
  const result = sweep.run({ engine: "web-x", policy, warmupMs, lookahead, steps: 1 });
  open.push({ sweep, result, pending });
  await vi.dynamicImportSettled(); await drain();
  return { sweep, result, pending, activations, preparedIds, driver, get options() { return options; } };
}

function movingFrames(video: VideoDouble, audioBytes: number) {
  video.paused = false; video.webkitAudioDecodedByteCount = audioBytes;
  clock.value += 10; video.emit("playing"); video.present(0.02);
  clock.value += 10; video.present(0.12);
}
async function beginTransition(options: Parameters<typeof begin>[0] = {}) {
  const f = await begin(options);
  expect(f.activations.map((row) => row.sourceId)).toEqual(["source-0"]);
  movingFrames(f.activations[0]!.video, 100); await drain();
  expect(f.activations.map((row) => row.sourceId)).toEqual(["source-0", "source-1"]);
  expect(f.activations[1]!.video.frames.size).toBe(1);
  return { ...f, video: f.activations[1]!.video };
}

beforeEach(() => {
  vi.useFakeTimers(); clock.value = 0; factory.create.mockReset();
  vi.stubGlobal("performance", { now: () => clock.value });
  vi.stubGlobal("location", { href: "http://localhost/use-cases.html" });
});
afterEach(async () => {
  for (const f of open) { f.pending.resolve(); await f.sweep.stop(); }
  await Promise.allSettled(open.splice(0).map((f) => f.result));
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("source-switching native playback observations", () => {
  it("fails a fatal SDK error after activation resolves even if buffered native frames keep advancing", async () => {
    const f = await beginTransition();
    f.options.event("error", "source-1");
    movingFrames(f.video, 100); await drain();
    const result = await f.result;
    expect(f.video).toMatchObject({ paused: false, currentTime: 0.12 });
    expect(result).toMatchObject({ status: "failure", failureStage: "sdk-source-error",
      transitions: [{ sourceId: "source-1", status: "failure" }] });
    expect(result.events).toContainEqual(expect.objectContaining({ name: "error", sourceId: "source-1" }));
  });

  it("retains a failed lookahead source and fails the trial while the foreground still has playable media", async () => {
    const f = await beginTransition({ lookahead: 3, pendingLookahead: true });
    f.pending.reject(new Error("Controlled preparation failure"));
    f.options.event("error", "source-3");
    movingFrames(f.video, 100); await drain();
    const result = await f.result;
    expect(result).toMatchObject({ status: "failure", failureStage: "sdk-source-error" });
    expect(result.preparation).toContainEqual(expect.objectContaining({ sourceId: "source-3", failed: true }));
    expect(result.events).toContainEqual(expect.objectContaining({ name: "error", sourceId: "source-3" }));
  });

  it("fails a decoded preparation rejection without an SDK error event instead of retrying activation", async () => {
    const f = await begin({ policy: "decoded", pendingSourceId: "source-1", warmupMs: 25 });
    movingFrames(f.activations[0]!.video, 100); await drain();
    f.pending.reject(new Error("Controlled decoded preparation failure"));
    await vi.advanceTimersByTimeAsync(25);
    for (const row of f.activations.slice(1)) movingFrames(row.video, 100);
    await drain();
    const result = await f.result;
    expect(result).toMatchObject({ status: "failure", failureStage: "source-preparation-error" });
    expect(result.preparation).toContainEqual(expect.objectContaining({ sourceId: "source-1", failed: true }));
    expect(f.preparedIds.filter((id) => id === "source-1")).toHaveLength(1);
    expect(f.activations.map((row) => row.sourceId)).toEqual(["source-0"]);
    expect(result.events.some((event) => event.name === "error")).toBe(false);
  });

  it("fails an unused lookahead preparation rejection without an SDK error event while native playback continues", async () => {
    const f = await beginTransition({ lookahead: 3, pendingSourceId: "source-3" });
    f.pending.reject(new Error("Controlled lookahead preparation failure")); await drain();
    movingFrames(f.video, 100); await drain();
    const result = await f.result;
    expect(f.video).toMatchObject({ paused: false, currentTime: 0.12 });
    expect(result).toMatchObject({ status: "failure", failureStage: "source-preparation-error" });
    expect(result.preparation).toContainEqual(expect.objectContaining({ sourceId: "source-3", failed: true }));
    expect(result.events.some((event) => event.name === "error")).toBe(false);
  });

  it("retains preparation failure queued just after the final qualifying native frame", async () => {
    const f = await beginTransition({ lookahead: 3, pendingSourceId: "source-3" });
    movingFrames(f.video, 100);
    f.pending.reject(new Error("Controlled preparation failure after frame qualification"));
    await drain();
    expect(await f.result).toMatchObject({ status: "failure", failureStage: "source-preparation-error" });
  });

  it("keeps successful playback when disposal intentionally cancels unfinished lookahead preparation", async () => {
    const f = await beginTransition({ lookahead: 3, pendingSourceId: "source-3", cancelPreparationOnStop: true });
    movingFrames(f.video, 100); await drain();
    expect(await f.result).toMatchObject({ status: "success", failureStage: null });
    expect(f.options.signal.aborted).toBe(true);
  });

  it("does not qualify a reused video's unchanged audio counter as audio from its next source", async () => {
    const f = await beginTransition({ reused: true });
    movingFrames(f.video, 100); await vi.advanceTimersByTimeAsync(20_000);
    const result = await f.result;
    expect(result.status).toBe("failure");
    expect(result.transitions[0]).toMatchObject({ status: "failure", reusedVideo: true,
      audioDecodedBytesBefore: 100, audioDecodedBytes: 100, audioCounterResetObserved: false,
      marks: { qualifiedMs: null } });
    expect(result.transitions[0]!.marks.movingFrameMs).not.toBeNull();
  });

  it("qualifies fresh audio after a reused video's counter resets below the previous source's total", async () => {
    const f = await beginTransition({ reused: true });
    f.video.webkitAudioDecodedByteCount = 0; f.video.emit("emptied");
    movingFrames(f.video, 20); await vi.advanceTimersByTimeAsync(20_000);
    const result = await f.result;
    expect(result.status).toBe("success");
    expect(result.transitions[0]).toMatchObject({ status: "success", reusedVideo: true,
      audioDecodedBytesBefore: 100, audioDecodedBytes: 20, audioCounterResetObserved: true });
    expect(result.transitions[0]!.marks.qualifiedMs).not.toBeNull();
  });
});
