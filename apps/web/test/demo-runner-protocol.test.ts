import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({ construct: vi.fn(), start: vi.fn(), seek: vi.fn(), play: vi.fn(), pause: vi.fn(), network: vi.fn(), dispose: vi.fn() }));
vi.mock("../src/startup/demo-session", () => ({ DemoRuntime: class {
  constructor(options: unknown) { runtime.construct(options); }
  start = runtime.start; seek = runtime.seek; play = runtime.play; pause = runtime.pause;
  setNetworkRate = runtime.network; dispose = runtime.dispose;
} }));
import { bootDemoRunner } from "../src/startup/demo-runner-page";

const origin = "https://player-lab.invalid"; const channel = "d550c41b-52d5-4a8d-8a75-498dc58d045f";
let surface: EventTarget; let owner: { performance: { timeOrigin: number; now: () => number }; postMessage: ReturnType<typeof vi.fn> };
function emit(type: string, id: number, payload: unknown = {}, source: unknown = owner, from = origin) {
  const event = new Event("message");
  Object.defineProperties(event, { source: { value: source }, origin: { value: from }, data: { value: { type, channel, operationId: id, payload } } });
  surface.dispatchEvent(event);
}
async function drain() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
const source = { url: "https://media.invalid/asset.m3u8", format: "hls", label: "asset", custom: true };
function selectEngine(engine: string): void {
  vi.stubGlobal("location", new URL(`${origin}/demo-runner.html?demo=1&engine=${engine}&channel=${channel}`));
}
beforeEach(() => {
  Object.values(runtime).forEach((fn) => fn.mockReset());
  runtime.start.mockResolvedValue({ status: "failure", failureCode: "unsupported" }); runtime.dispose.mockResolvedValue(undefined);
  surface = new EventTarget(); owner = { performance: { timeOrigin: 1000, now: () => 20 }, postMessage: vi.fn() };
  vi.stubGlobal("window", surface); vi.stubGlobal("parent", owner);
  selectEngine("hls");
  vi.stubGlobal("document", { querySelector: () => ({}), getElementById: () => ({}) });
});
afterEach(() => vi.unstubAllGlobals());

describe("retained child command boundary", () => {
  it.each(["web-x", "bitmovin-8", "hls", "shaka"])("boots %s with the parent clock and accepts only its exact owner/origin/channel", async (engine) => {
    selectEngine(engine);
    bootDemoRunner(); expect(runtime.construct).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ engine, clock: owner.performance }));
    expect(owner.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "ready", channel }, origin);
    emit("start", 1, { source }, {}); emit("start", 1, { source }, owner, "https://other.invalid");
    const wrong = new Event("message"); Object.defineProperties(wrong, { source: { value: owner }, origin: { value: origin }, data: { value: { type: "start", channel: "other", operationId: 1, payload: { source } } } }); surface.dispatchEvent(wrong);
    await drain(); expect(runtime.start).not.toHaveBeenCalled();
    emit("start", 1, { source, selectedAt: 1000 }); await drain();
    expect(runtime.start).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ source, selectedAt: 1000, signal: expect.any(AbortSignal) }));
  });
  it("returns v8 startup and target-seek results on the same retained child channel", async () => {
    selectEngine("bitmovin-8");
    const startup = { status: "success", failureCode: null, sdkCode: null, metadata: null,
      marks: { nativePlaying: 20, firstFrame: 24, firstMovingFrame: 40 }, frameCallbackAvailable: true };
    const seek = { status: "success", failureCode: null, targetSeconds: 40, latencyMs: 25,
      buffered: false, frameCallbackAvailable: true };
    runtime.start.mockResolvedValue(startup); runtime.seek.mockResolvedValue(seek);
    bootDemoRunner(); emit("start", 1, { source, profile: "startup", selectedAt: 1000 }); await drain();
    expect(owner.postMessage).toHaveBeenCalledWith({ type: "response", channel, operationId: 1, result: startup }, origin);
    emit("seek", 2, { targetSeconds: 40 }); await drain();
    expect(runtime.seek).toHaveBeenCalledExactlyOnceWith(40, expect.any(AbortSignal));
    expect(owner.postMessage).toHaveBeenCalledWith({ type: "response", channel, operationId: 2, result: seek }, origin);
    emit("dispose", 3); await drain();
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(owner.postMessage).toHaveBeenCalledWith({ type: "response", channel, operationId: 3, result: undefined }, origin);
  });
  it.each(["bitmovin", "bitmovin8", "unknown"])("does not construct a runtime for unregistered engine %s", (engine) => {
    selectEngine(engine); bootDemoRunner();
    expect(runtime.construct).not.toHaveBeenCalled(); expect(owner.postMessage).not.toHaveBeenCalled();
  });
  it("rejects malformed tuning, profile, time and stale operation IDs", async () => {
    bootDemoRunner();
    const invalid = [{ tuning: null }, { tuning: [] }, { tuning: { unknown: true } }, { tuning: { hlsWorker: 1 } },
      { tuning: { webXLoadControl: 3 } }, { profile: "other" }, { selectedAt: Infinity }, { selectedAt: NaN }];
    invalid.forEach((fields, i) => emit("start", i + 1, { source, ...fields })); await drain(); expect(runtime.start).not.toHaveBeenCalled();
    emit("start", 9, { source, tuning: { hlsWorker: false, shakaPrefetchLimit: 0 } }); await drain();
    emit("start", 9, { source }); emit("start", 8, { source }); await drain(); expect(runtime.start).toHaveBeenCalledTimes(1);
  });
  it.each(["hls", "bitmovin-8"])("cancels only the matching %s operation and releases the runtime on pagehide", async (engine) => {
    selectEngine(engine);
    let finish!: () => void; runtime.start.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    bootDemoRunner(); emit("start", 1, { source });
    const signal = runtime.start.mock.calls[0]![0].signal as AbortSignal;
    emit("cancel", 2); emit("cancel", 1, {}, {}); expect(signal.aborted).toBe(false);
    emit("cancel", 1); expect(signal.aborted).toBe(true); finish(); await drain();
    surface.dispatchEvent(new Event("pagehide")); expect(runtime.dispose).toHaveBeenCalledTimes(1);
  });
});
