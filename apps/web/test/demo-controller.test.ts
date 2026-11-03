import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoOptions, DemoSample, DemoSeek, DemoSource, DemoStartOptions, DemoStartup } from "../src/startup/demo-contract";
const state = vi.hoisted(() => ({ instances: [] as any[], active: new Set<any>(), maxActive: 0,
  events: [] as string[], holdStarts: false, startThrows: false, failStartNumber: 0, failAll: false,
  holdStartEngine: null as string | null, orderSeed: 0,
  rejectDisposalFor: null as any, deferDisposalFor: null as any }));
vi.mock("../src/i18n", () => ({ pick: (value: { en: string }) => value.en }));
vi.mock("../src/startup/demo-session", () => ({ DemoSession: class {
  options: DemoOptions; startOptions: DemoStartOptions | null = null;
  constructor(options: DemoOptions) { this.options = options; state.instances.push(this); state.active.add(this);
    state.maxActive = Math.max(state.maxActive, state.active.size); state.events.push(`create:${options.engine}`); }
  emit(sample: DemoSample) { this.options.onSample?.(sample); }
  start = vi.fn(async (options: DemoStartOptions): Promise<DemoStartup> => {
    this.startOptions = options; state.events.push(`start:${this.options.engine}`);
    if (state.startThrows) throw new Error("fixture-start-failed");
    if (state.failAll || state.events.filter((event) => event.startsWith("start:")).length === state.failStartNumber) {
      return { status: "failure", failureCode: "sdk-error", sdkCode: null, marks: {}, metadata: null, frameCallbackAvailable: true };
    }
    if (state.holdStarts || this.options.engine === state.holdStartEngine) return new Promise((resolve) => {
      const finish = () => resolve({ status: "cancelled", failureCode: "aborted", sdkCode: null,
        marks: {}, metadata: null, frameCallbackAvailable: true });
      options.signal.addEventListener("abort", finish, { once: true });
      if (options.signal.aborted) finish();
    });
    this.emit(sample());
    return options.source.format === "dash" && this.options.engine === "hls"
      ? { status: "failure", failureCode: "unsupported", sdkCode: null, marks: {}, metadata: null, frameCallbackAvailable: true }
      : { status: "success", failureCode: null, sdkCode: null, marks: { constructorStart: 0, nativePlaying: 30 }, metadata: null, frameCallbackAvailable: true };
  });
  seek = vi.fn(async (targetSeconds: number): Promise<DemoSeek> => ({ status: "success", failureCode: null,
    targetSeconds, latencyMs: 25, buffered: false, frameCallbackAvailable: true }));
  setNetworkRate = vi.fn(async (rate: number | null) => ({ support: "ready", rateBytesPerSecond: rate,
    shapedResponses: 1, deliveredBytes: 1024, skippedResponses: 0 }));
  play = vi.fn(async () => {}); pause = vi.fn();
  finishDisposal: (() => void) | null = null;
  dispose = vi.fn(async () => {
    if (state.rejectDisposalFor === this) throw new Error("fixture-cleanup-failed");
    if (state.deferDisposalFor === this) await new Promise<void>((resolve) => { this.finishDisposal = resolve; });
    state.active.delete(this); state.events.push(`dispose:${this.options.engine}`);
  });
} }));
import { DemoComparison } from "../src/startup/demo-controller";
import { metricDuration, safeDemoExport } from "../src/startup/demo-results";

function sample(overrides: Partial<DemoSample> = {}): DemoSample {
  return { elapsedMs: 30, mediaTime: 3, width: 640, height: 360, bufferSeconds: 8, stalled: false,
    paused: false, droppedFrames: 0, durationSeconds: 60, seekableStart: 0, seekableEnd: 60, ...overrides };
}
const source: DemoSource = { url: "https://example.invalid/media/test.m3u8", format: "hls", custom: false, label: "Clip" };
const engines = ["web-x", "bitmovin-8", "hls", "shaka"] as const;
const owners: DemoComparison[] = [];
function fixture() {
  const ui = { stages: new Map(engines.map((engine) => [engine, {} as HTMLElement])) as any,
    update: vi.fn(), status: vi.fn(), network: vi.fn() };
  const app = new DemoComparison(ui); owners.push(app); return { app, ui };
}
async function flush() { for (let i = 0; i < 12; i += 1) await Promise.resolve(); }
async function measured(app: DemoComparison, selected = source, network = false) {
  const pending = app.measure(selected, network); await vi.runAllTimersAsync(); await pending;
}
beforeEach(() => {
  vi.useFakeTimers(); state.instances.length = 0; state.active.clear(); state.events.length = 0; state.maxActive = 0; state.holdStarts = false; state.startThrows = false; state.rejectDisposalFor = null; state.deferDisposalFor = null;
  state.failStartNumber = 0; state.failAll = false; state.holdStartEngine = null; state.orderSeed = 0;
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  vi.stubGlobal("crypto", { getRandomValues: (values: Uint32Array) => { values[0] = state.orderSeed; return values; } });
});
afterEach(async () => {
  await Promise.all(owners.splice(0).map((app) => app.dispose())); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("demo orchestration (mock sessions; no SDK/browser/network qualification)", () => {
  it("leaves a successful player visible when the last measured engine fails", async () => {
    const { app } = fixture(); state.orderSeed = 3; state.failStartNumber = 4; await measured(app);
    expect(app.records).toHaveLength(4);
    expect(app.records[3]).toMatchObject({ engine: "bitmovin-8", startup: { status: "failure" } });
    expect(app.records.find((record) => record.engine === app.selected)!.startup!.status).toBe("success");
    expect(app.hasPlayback).toBe(true); expect(state.active.size).toBe(1);
  });
  it("keeps playback actions unavailable and reports failure when no engine can play", async () => {
    const { app, ui } = fixture(); state.failAll = true; await measured(app);
    expect(app.hasPlayback).toBe(false);
    expect(ui.status.mock.calls[ui.status.mock.calls.length - 1]![0]).toContain("No player could play");
  });
  it("measures each engine sequentially and disposes the prior instance before creating the next", async () => {
    const { app } = fixture(); await measured(app);
    expect(new Set(app.records.map((record) => record.engine))).toEqual(new Set(engines));
    expect(app.records).toHaveLength(4); expect(state.maxActive).toBe(1);
    expect(state.instances.slice(0, 3).every((session) => session.dispose.mock.calls.length === 1)).toBe(true);
    expect(state.instances[3].dispose).not.toHaveBeenCalled();
    expect(state.instances.every((session) => session.options.container)).toBe(true);
    expect(app.records.find((record) => record.engine === "bitmovin-8")).toMatchObject({
      startup: { status: "success" }, seek: { status: "success", targetSeconds: 40, latencyMs: 25 }, phase: "complete",
    });
    for (let i = 1; i < 4; i += 1) {
      expect(state.events.indexOf(`dispose:${state.instances[i - 1].options.engine}`))
        .toBeLessThan(state.events.indexOf(`create:${state.instances[i].options.engine}`));
    }
    expect(app.running).toBe(false);
  });
  it("Stop aborts the current operation, disposes owned sessions, then a new run replaces rather than appends results", async () => {
    const { app } = fixture(); state.holdStarts = true;
    const pending = app.measure(source, false); await flush(); expect(state.instances).toHaveLength(1);
    const old = state.instances[0]; app.cancel(); await pending;
    expect(old.startOptions.signal.aborted).toBe(true); expect(old.dispose).toHaveBeenCalledOnce();
    expect(state.active.size).toBe(0); expect(app.running).toBe(false);
    state.holdStarts = false; let maximum = 0;
    const original = (app as any).ui.update;
    (app as any).ui.update = () => { maximum = Math.max(maximum, app.records.length); original(); };
    await measured(app); expect(app.records).toHaveLength(4); expect(maximum).toBeLessThanOrEqual(4);
    await measured(app); expect(app.records).toHaveLength(4); expect(maximum).toBeLessThanOrEqual(4);
  });
  it("Stop cancels the fourth v8 start and releases every measured session", async () => {
    const { app } = fixture(); state.orderSeed = 3; state.holdStartEngine = "bitmovin-8";
    const pending = app.measure(source, false); await vi.runAllTimersAsync();
    expect(app.records).toHaveLength(4);
    const current = state.instances[3]; expect(current.options.engine).toBe("bitmovin-8");
    expect(app.records.slice(0, 3).every((record) => record.startup?.status === "success")).toBe(true);
    app.cancel(); await pending;
    expect(current.startOptions.signal.aborted).toBe(true);
    expect(app.records[3]!.startup).toMatchObject({ status: "cancelled", failureCode: "aborted" });
    expect(state.instances.every((session) => session.dispose.mock.calls.length === 1)).toBe(true);
    expect(state.active.size).toBe(0); expect(app.running).toBe(false); expect(app.hasPlayback).toBe(false);
  });
  it("retains the fourth v8 player after successful startup and seek", async () => {
    const { app } = fixture(); state.orderSeed = 3; await measured(app);
    expect(app.selected).toBe("bitmovin-8"); expect(app.hasPlayback).toBe(true);
    expect(state.instances[3].options.engine).toBe("bitmovin-8");
    expect(state.instances[3].dispose).not.toHaveBeenCalled();
    await app.play(); app.pause(); await app.seek();
    expect(state.instances[3].play).toHaveBeenCalledOnce(); expect(state.instances[3].pause).toHaveBeenCalledOnce();
    expect(state.instances[3].seek).toHaveBeenCalledTimes(2);
  });
  it("parallel previews never add or modify measurement records, including later samples", async () => {
    const { app } = fixture(); await measured(app); const recorded = JSON.stringify(app.records);
    app.parallel = true; await app.preview(); expect(state.active.size).toBe(4);
    expect(new Set(state.instances.slice(-4).map((session) => session.options.engine))).toEqual(new Set(engines));
    for (const session of state.instances.slice(-4)) session.emit(sample({ mediaTime: 15, width: 1920, height: 1080 }));
    expect(JSON.stringify(app.records)).toBe(recorded); expect(app.records).toHaveLength(4);
  });
  it("a new measured run releases all parallel preview sessions and restores sequential ownership", async () => {
    const { app } = fixture(); await measured(app); app.parallel = true; await app.preview();
    const previews = state.instances.slice(-4); app.parallel = false; state.maxActive = 0;
    await measured(app); expect(previews.every((session) => session.dispose.mock.calls.length === 1)).toBe(true);
    expect(state.maxActive).toBe(1); expect(app.records).toHaveLength(4);
  });
  it("retains unsupported custom DASH outcomes as failures with absent metrics, never zero-valued measurements", async () => {
    const { app } = fixture(); const custom: DemoSource = { ...source, format: "dash", custom: true,
      url: "https://example.invalid/private.mpd?token=private", label: "Custom DASH" };
    await measured(app, custom); const unsupported = app.records.find((record) => record.engine === "hls")!;
    expect(unsupported.startup).toMatchObject({ status: "failure", failureCode: "unsupported", marks: {} });
    expect(unsupported.seek).toBeNull(); expect(metricDuration(unsupported.startup!.marks, "constructorStart", "nativePlaying")).toBeNull();
    const exported = safeDemoExport(app.records, "dash", true);
    expect(exported.trials.find((trial) => trial.engine === "hls")!.startup!.marks).toEqual({});
    expect(JSON.stringify(exported)).not.toContain("private");
  });
  it("does not overwrite a failed start with the successful-completion status", async () => {
    const { app, ui } = fixture(); state.startThrows = true;
    await measured(app); expect(app.records).toHaveLength(1);
    expect(app.records[0]!.startup).toMatchObject({ status: "failure", failureCode: "initialization-failed", marks: {} });
    expect(ui.status.mock.calls[ui.status.mock.calls.length - 1]![0]).toContain("stopped");
  });
  it("does not start a new measurement after a retained session cleanup fails", async () => {
    const { app } = fixture(); await measured(app); const before = state.instances.length;
    state.rejectDisposalFor = state.instances[state.instances.length - 1];
    await measured(app); expect(state.instances).toHaveLength(before); expect(app.records).toHaveLength(0);
    state.rejectDisposalFor = null;
  });
  it("serializes overlapping preview disposal and only starts the latest requested preview", async () => {
    const { app } = fixture(); await measured(app); const before = state.instances.length;
    const retained = state.instances[before - 1]; state.deferDisposalFor = retained;
    const first = app.preview("hls"); await flush();
    const latest = app.preview("shaka"); await flush(); const duringCleanup = state.instances.length;
    retained.finishDisposal(); await Promise.all([first, latest]);
    expect(duringCleanup).toBe(before); expect(state.instances).toHaveLength(before + 1);
    expect(state.instances[state.instances.length - 1].options.engine).toBe("shaka");
    expect(state.active.size).toBe(1);
  });
  it("Stop during a network phase never re-enables or queries a positive rate after cancellation", async () => {
    const { app } = fixture(); const operation = app.measure(source, true);
    await vi.advanceTimersByTimeAsync(2000); const session = state.instances[0];
    const before = session.setNetworkRate.mock.calls.filter(([rate]: [number | null]) => rate !== null).length;
    app.cancel(); await operation;
    const after = session.setNetworkRate.mock.calls.filter(([rate]: [number | null]) => rate !== null).length;
    expect(after).toBe(before); expect(session.dispose).toHaveBeenCalledOnce(); expect(state.active.size).toBe(0);
  });
  it("does not label a new rate phase confirmed from unchanged cumulative delivery counters", async () => {
    const { app, ui } = fixture(); await measured(app, source, true);
    for (const record of app.records) {
      expect(record.networkPhases).toHaveLength(3);
      expect(record.networkPhases!.every((phase) => phase.deliveredBytes === 0 && !phase.controlled)).toBe(true);
    }
    const messages = ui.network.mock.calls.map(([message]) => message as string);
    expect(messages.some((message) => message.includes("not confirmed"))).toBe(true);
  });
});
