import { describe, expect, it } from "vitest";
import {
  initialMetrics,
  metricsSnapshot,
  reduceMetrics,
  type MetricsEvent,
  type MetricsState,
} from "../src/analytics/metrics";

function run(events: MetricsEvent[]): MetricsState {
  return events.reduce(reduceMetrics, initialMetrics());
}

describe("startup time", () => {
  it("is the load → first-playing gap", () => {
    const s = run([
      { type: "load", t: 0 },
      { type: "playing", t: 1500 },
    ]);
    expect(metricsSnapshot(s).startupMs).toBe(1500);
  });
  it("only counts the first playing", () => {
    const s = run([
      { type: "load", t: 0 },
      { type: "playing", t: 1000 },
      { type: "paused", t: 2000 },
      { type: "playing", t: 5000 },
    ]);
    expect(metricsSnapshot(s).startupMs).toBe(1000);
  });
});

describe("rebuffering", () => {
  it("updates the ratio during uninterrupted playback without mutating settled totals", () => {
    const s = run([
      { type: "load", t: 0 },
      { type: "playing", t: 1000 },
      { type: "stallStart", t: 6000 },
      { type: "stallEnd", t: 8000 },
    ]);
    const before = { ...s };
    expect(metricsSnapshot(s, 8000).rebufferRatio).toBeCloseTo(2 / 7);
    const current = metricsSnapshot(s, 108000);
    expect(current.watchedMs).toBe(105000);
    expect(current.rebufferMs).toBe(2000);
    expect(current.rebufferRatio).toBeCloseTo(2 / 107);
    expect(metricsSnapshot(s, 108000)).toEqual(current);
    expect(s).toEqual(before);
    const paused = reduceMetrics(s, { type: "paused", t: 108000 });
    expect(metricsSnapshot(paused, 208000)).toEqual(current);
  });
  it("includes an ongoing stall without double-counting later events", () => {
    const s = run([
      { type: "load", t: 0 },
      { type: "playing", t: 1000 },
      { type: "stallStart", t: 6000 },
    ]);
    expect(metricsSnapshot(s, 7000).rebufferMs).toBe(1000);
    expect(metricsSnapshot(s, 8000).rebufferMs).toBe(2000);
    const resumed = reduceMetrics(s, { type: "stallEnd", t: 8000 });
    expect(metricsSnapshot(resumed, 9000)).toMatchObject({ watchedMs: 6000, rebufferMs: 2000 });
  });
  it("does not count duplicate stall events or buffering while paused", () => {
    let s = run([
      { type: "load", t: 0 },
      { type: "playing", t: 1000 },
      { type: "stallStart", t: 6000 },
      { type: "stallStart", t: 7000 },
    ]);
    expect(metricsSnapshot(s, 8000)).toMatchObject({ rebufferMs: 2000, rebufferCount: 1 });
    s = reduceMetrics(s, { type: "paused", t: 8000 });
    s = reduceMetrics(s, { type: "stallStart", t: 9000 });
    expect(metricsSnapshot(s, 18000)).toMatchObject({ watchedMs: 5000, rebufferMs: 2000, rebufferCount: 1 });
  });
  it("accumulates stall time and ratio during playback", () => {
    const s = run([
      { type: "load", t: 0 },
      { type: "playing", t: 1000 }, // startup 1000
      { type: "stallStart", t: 6000 }, // watched += 5000
      { type: "stallEnd", t: 8000 }, // rebuffer += 2000
      { type: "paused", t: 10000 }, // watched += 2000 → 7000
    ]);
    const m = metricsSnapshot(s);
    expect(m.watchedMs).toBe(7000);
    expect(m.rebufferMs).toBe(2000);
    expect(m.rebufferCount).toBe(1);
    expect(m.rebufferRatio).toBeCloseTo(2000 / 9000);
  });
  it("does not count pre-startup buffering as a rebuffer", () => {
    const s = run([
      { type: "load", t: 0 },
      { type: "stallStart", t: 200 }, // before first frame → ignored
      { type: "playing", t: 1000 },
    ]);
    const m = metricsSnapshot(s);
    expect(m.rebufferCount).toBe(0);
    expect(m.rebufferMs).toBe(0);
  });
});

describe("session boundaries", () => {
  it("does not accrue time before the first frame", () => {
    expect(metricsSnapshot(initialMetrics(), 5000)).toMatchObject({ watchedMs: 0, rebufferMs: 0 });
    expect(metricsSnapshot(run([{ type: "load", t: 0 }]), 5000))
      .toMatchObject({ watchedMs: 0, rebufferMs: 0 });
  });
  it("freezes final totals when playback finishes", () => {
    const s = run([
      { type: "load", t: 0 },
      { type: "playing", t: 1000 },
      { type: "ended", t: 6000 },
    ]);
    expect(s.phase).toBe("idle");
    expect(metricsSnapshot(s, 60000)).toMatchObject({ watchedMs: 5000, rebufferMs: 0 });
  });
  it("clears the previous source and active stall on unload", () => {
    const s = run([
      { type: "load", t: 0 },
      { type: "playing", t: 1000 },
      { type: "stallStart", t: 6000 },
      { type: "unload", t: 8000 },
    ]);
    expect(s.phase).toBe("idle");
    expect(metricsSnapshot(s, 60000)).toEqual(metricsSnapshot(initialMetrics()));
  });
});

describe("errors, seek, live latency", () => {
  it("counts errors", () => {
    const s = run([{ type: "error" }, { type: "error" }]);
    expect(metricsSnapshot(s).errorCount).toBe(2);
  });
  it("measures seek time from seek to seeked", () => {
    const s = run([
      { type: "seek", t: 100 },
      { type: "seeked", t: 350 },
    ]);
    expect(metricsSnapshot(s).lastSeekMs).toBe(250);
  });
  it("records live latency", () => {
    const s = run([{ type: "liveLatency", seconds: 8.5 }]);
    expect(metricsSnapshot(s).liveLatencySec).toBe(8.5);
  });
  it("resets per session on load", () => {
    const s = run([
      { type: "error" },
      { type: "load", t: 0 },
      { type: "playing", t: 500 },
    ]);
    const m = metricsSnapshot(s);
    expect(m.errorCount).toBe(0);
    expect(m.startupMs).toBe(500);
  });
});
