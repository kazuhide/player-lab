import { describe, expect, it, vi } from "vitest";
import { createRuntimeMonitor, type RuntimeReadablePlayer } from "../src/runtimeObservation";

function player(): RuntimeReadablePlayer & { licenseKey: string; nativeId: string } {
  return {
    licenseKey: "never-serialize-this", nativeId: "never-serialize-this-id", isDestroyed: false,
    getCurrentTime: vi.fn(async () => 5.25), getDuration: vi.fn(async () => 60),
    isLive: vi.fn(async () => false), isPlaying: vi.fn(async () => true), isMuted: vi.fn(async () => true),
    getAvailableSubtitles: vi.fn(async () => [{ identifier: "player-lab-external", url: "never-serialize-this-url", label: "never-serialize-this-label" }]),
    getSubtitleTrack: vi.fn(async () => ({ identifier: "player-lab-external", language: "never-serialize-this-language" })),
  };
}

describe("opt-in real-SDK runtime observations", () => {
  it("serializes only allowlisted measurements from public getters", async () => {
    const monitor = createRuntimeMonitor();
    const native = player();
    const owner = monitor.attach(native);
    owner.viewReady();
    owner.sourceLoad();
    owner.event("sourceLoaded");
    await monitor.sample();
    const report = monitor.report();
    expect(report.owner).toMatchObject({ generation: 1, viewReady: true, sourceLoads: 1, sourceLoaded: 1,
      sample: { time: 5.25, duration: 60, live: false, playing: true, muted: true, subtitleCount: 1, externalSubtitleAvailable: true, externalSubtitleSelected: true } });
    expect(JSON.stringify(report)).not.toContain("never-serialize");
  });

  it("does not read before view readiness or publish a retiring owner's pending reads", async () => {
    const changed = vi.fn();
    const monitor = createRuntimeMonitor(changed);
    const native = player();
    let finish!: (time: number) => void;
    vi.mocked(native.getCurrentTime).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const owner = monitor.attach(native);
    await monitor.sample();
    expect(native.getCurrentTime).not.toHaveBeenCalled();
    owner.viewReady();
    const pending = monitor.sample();
    native.isDestroyed = true;
    owner.retire();
    const next = monitor.attach(player());
    next.viewReady();
    const before = changed.mock.calls.length;
    finish(99);
    await pending;
    expect(changed).toHaveBeenCalledTimes(before);
    expect(monitor.report().owner?.generation).toBe(2);
    expect(monitor.report().owner?.sample).toBeNull();
    expect(monitor.report().retired).toEqual([{ generation: 1, wrapperDestroyed: true }]);
    owner.event("sourceLoaded");
    expect(monitor.report().owner?.sourceLoaded).toBe(0);
  });

  it("reports getter failures without copying SDK messages and permits a later sample", async () => {
    const monitor = createRuntimeMonitor();
    const native = player();
    vi.mocked(native.getDuration).mockRejectedValueOnce(new Error("never-serialize-sdk-message"));
    const owner = monitor.attach(native);
    owner.viewReady();
    owner.event("error", 1003);
    await monitor.sample();
    expect(monitor.report().owner).toMatchObject({ readFailures: 1, errorCodes: [1003], sample: null });
    await monitor.sample();
    expect(monitor.report().owner?.sample?.duration).toBe(60);
    expect(JSON.stringify(monitor.report())).not.toContain("never-serialize");
  });

  it("keeps live infinity JSON-safe and records unconfirmed wrapper retirement honestly", async () => {
    const monitor = createRuntimeMonitor();
    const native = player();
    vi.mocked(native.getDuration).mockResolvedValue(Infinity);
    vi.mocked(native.isLive).mockResolvedValue(true);
    const owner = monitor.attach(native);
    owner.viewReady();
    await monitor.sample();
    expect(monitor.report().owner?.sample).toMatchObject({ duration: null, live: true });
    owner.retire();
    expect(monitor.report().owner).toBeNull();
    expect(monitor.report().retired).toEqual([{ generation: 1, wrapperDestroyed: false }]);
  });

  it("compares a real clipboard read without publishing code and discards an older comparison", async () => {
    const monitor = createRuntimeMonitor();
    monitor.appliedCode("never-serialize-code-one");
    let finish!: (code: string) => void;
    const pending = monitor.checkClipboard(() => new Promise((resolve) => { finish = resolve; }));
    monitor.appliedCode("never-serialize-code-two");
    finish("never-serialize-code-one");
    await pending;
    expect(monitor.report().code.clipboardMatches).toBeNull();
    await monitor.checkClipboard(async () => "never-serialize-code-two");
    expect(monitor.report().code).toMatchObject({ generation: 2, clipboardMatches: true, readFailed: false });
    expect(JSON.stringify(monitor.report())).not.toContain("never-serialize");
  });

  it("rejects pending getter results when the same owner loads another source", async () => {
    const monitor = createRuntimeMonitor();
    const native = player();
    let finish!: (time: number) => void;
    vi.mocked(native.getCurrentTime).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const owner = monitor.attach(native); owner.viewReady(); owner.sourceLoad();
    const read = monitor.sample();
    owner.sourceLoad(); finish(99); await read;
    expect(monitor.report().owner?.sample).toBeNull();
  });

  it("collects five timed public getter samples and cancels a batch across source changes", async () => {
    vi.useFakeTimers();
    try {
      const monitor = createRuntimeMonitor();
      const native = player();
      const owner = monitor.attach(native); owner.viewReady(); owner.sourceLoad();
      const batch = monitor.sampleBatch();
      await vi.advanceTimersByTimeAsync(4000); await batch;
      expect(monitor.report().batch?.samples).toHaveLength(5);
      expect(monitor.report().batch?.generation).toBe(1);
      const cancelled = monitor.sampleBatch();
      await vi.advanceTimersByTimeAsync(800); owner.sourceLoad();
      await vi.advanceTimersByTimeAsync(4000); await cancelled;
      expect(monitor.report().batch).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
